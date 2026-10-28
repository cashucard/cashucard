#!/usr/bin/env python3
"""Build an isolated resource probe from the current applet's install path."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'F0:43:41:53:48:55:50:52:4F:42:45'

DUMMY = """        if (b[ISO7816.OFFSET_INS] == (byte) 0x7E) {
            JCSystem.beginTransaction();
            try {
                for (short i = 0; i < 128; i++) {
                    probePool[i] = (byte) (probePool[i] ^ 1);
                }
                JCSystem.commitTransaction();
            } catch (TransactionException error) {
                if (JCSystem.getTransactionDepth() != 0) { JCSystem.abortTransaction(); }
                ISOException.throwIt((short) (0x6F00 | error.getReason()));
            }
            b[0] = probePool[0];
            apdu.setOutgoingAndSend((short) 0, (short) 1);
            return;
        }
"""

PROCESS = """    public void process(APDU apdu) {
        byte[] b = apdu.getBuffer();
        if (selectingApplet()) {
            b[0] = 0x50; b[1] = 0x52; b[2] = 0x4F; b[3] = 0x42; b[4] = 0x45;
            b[5] = 2;
            Util.setShort(b, (short) 6, (short) __SIZE__);
            apdu.setOutgoingAndSend((short) 0, (short) 8);
            return;
        }
        if (b[ISO7816.OFFSET_CLA] != (byte) 0xB0 || b[ISO7816.OFFSET_P1] != 0 ||
            b[ISO7816.OFFSET_P2] != 0) {
            ISOException.throwIt(ISO7816.SW_INCORRECT_P1P2);
        }
        if (b[ISO7816.OFFSET_INS] == (byte) 0x7D) {
            // Optional diagnostics run after install. These counters cap at 32767.
            short persistent = JCSystem.getAvailableMemory(JCSystem.MEMORY_TYPE_PERSISTENT);
            short reset = JCSystem.getAvailableMemory(JCSystem.MEMORY_TYPE_TRANSIENT_RESET);
            short deselect = JCSystem.getAvailableMemory(JCSystem.MEMORY_TYPE_TRANSIENT_DESELECT);
            Util.setShort(b, (short) 0, persistent);
            Util.setShort(b, (short) 2, reset);
            Util.setShort(b, (short) 4, deselect);
            Util.setShort(b, (short) 6, JCSystem.getMaxCommitCapacity());
            Util.setShort(b, (short) 8, JCSystem.getUnusedCommitCapacity());
            Util.setShort(b, (short) 10, (short) __SIZE__);
            b[12] = __MARKER__;
            b[13] = 2;
            b[14] = (byte) ((persistent == 32767 ? 1 : 0) |
                (reset == 32767 ? 2 : 0) | (deselect == 32767 ? 4 : 0));
            b[15] = 0;
            apdu.setOutgoingAndSend((short) 0, (short) 16);
            return;
        }
__DUMMY__        ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
    }"""


def process_probe(size):
    return PROCESS.replace('__SIZE__', str(size)).replace(
        '__MARKER__', 'probePool[0]' if size else '0').replace('__DUMMY__', DUMMY if size else '')


def source_probe(source, size, segments=1):
    if size != 0 and (size < 256 or size > 24576 or size % 256):
        raise ValueError('pool size must be zero (control) or a multiple of 256, from 256 to 24576')
    if segments not in (1, 4) or (segments == 4 and size != 16384):
        raise ValueError('segmented profile requires four 4096-byte arrays')
    anchor = 'public class CashuApplet extends Applet implements TagSwitch {'
    if source.count(anchor) != 1 or source.count('        schnorrHW.init();') != 1:
        raise ValueError('applet install anchors changed; review the probe generator')
    if size:
        names = ['probePool'] + ['probePool' + str(i) for i in range(1, segments)]
        source = source.replace(anchor, anchor + ''.join('\n    private final byte[] ' + name + ';' for name in names))
        allocations = ''.join('\n        ' + name + f' = new byte[(short) {size // segments}];' for name in names)
        source = source.replace('        schnorrHW.init();', '        schnorrHW.init();' + allocations)
    source, count = re.subn(r'    public void process\(APDU apdu\) \{.*?\n    }',
        lambda _: process_probe(size), source, flags=re.S)
    if count != 1:
        raise ValueError('applet process anchor changed; review the probe generator')
    return source


def prepare(output, size, segments=1):
    # Refuse reuse so an old CAP cannot be mistaken for this build.
    output.mkdir(parents=True, exist_ok=False)
    sources = ROOT / 'applet/src/main/java/me/flashapp/cashu'
    destination = output / 'src/me/flashapp/cashu'
    destination.mkdir(parents=True)
    hashes = {}
    for file in sorted(sources.glob('*.java')):
        raw = file.read_bytes()
        hashes[file.name] = hashlib.sha256(raw).hexdigest()
        text = source_probe(raw.decode(), size, segments) if file.name == 'CashuApplet.java' else raw.decode()
        (destination / file.name).write_text(text)
    build = ET.parse(ROOT / 'applet/build.xml')
    project = build.getroot()
    project.set('basedir', str(output))
    for name, value in {'src.dir': output / 'src', 'target.dir': output / 'target',
                        'cap.file': output / 'resource-probe.cap'}.items():
        project.find("property[@name='" + name + "']").set('value', str(value))
    safe = {'-check-plugin', 'download-plugin', '-checksum-plugin', '-plugin-mismatch',
            'verify-plugin', 'setup', 'cap'}
    for target in list(project.findall('target')):
        if target.get('name') not in safe:
            project.remove(target)
    version = project.find("property[@name='ant.javacard.version']").get('value')
    cached = ROOT / 'applet/target' / ('ant-javacard-' + version + '.jar')
    if cached.is_file():
        (output / 'target').mkdir()
        shutil.copyfile(cached, output / 'target' / cached.name)
    # The copied converter is still checked against the inherited SHA-256 pin.

    cap_target = project.find("target[@name='cap']")
    cap = cap_target.find('javacard/cap')
    cap.set('aid', PACKAGE)
    cap.set('version', '0.0')
    for applet in cap.findall('applet'):
        suffix = applet.get('aid').split(':')[-1]
        applet.set('aid', PACKAGE + ':' + suffix)
    # The production size/AID guard applies to the released CAP. This artifact
    # uses its own AIDs and is never copied to the production asset directory.
    for command in list(cap_target.findall('exec')):
        args = command.findall('arg')
        if any(a.get('value') == 'tools/refcheck.py' for a in args):
            cap_target.remove(command)
        command.set('dir', str(output))
        for arg in args:
            if arg.get('value') == 'tools/stripcap.py':
                arg.set('value', str(ROOT / 'tools/stripcap.py'))
            if arg.get('value') == 'applet/${cap.file}':
                arg.set('value', '${cap.file}')
    for echo in cap_target.findall('echo'):
        echo.set('message', 'Isolated resource probe: ${cap.file}')
    build.write(output / 'build.xml', encoding='unicode')
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new scratch directory')
    parser.add_argument('--pool-bytes', type=int, default=16384)
    parser.add_argument('--segments', type=int, choices=[1,4], default=1)
    parser.add_argument('--sdk', type=Path, default=Path.home() / '.javacard/sdks/jc305u4_kit')
    args = parser.parse_args()
    output = args.output.resolve()
    if not (args.sdk / 'lib/api_classic.jar').is_file():
        parser.error('JavaCard 3.0.5 SDK is missing')
    # Validate before creating files.
    source_probe((ROOT / 'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text(), args.pool_bytes, args.segments)
    hashes = prepare(output, args.pool_bytes, args.segments)
    cap = output / 'resource-probe.cap'
    subprocess.run(['ant', '-f', str(output / 'build.xml'), 'cap',
        '-Dsrc.dir=' + str(output / 'src'), '-Dcap.file=' + str(cap),
        '-Djc.sdk=' + str(args.sdk.resolve())], check=True)
    spec = importlib.util.spec_from_file_location('cardkit_assets', ROOT / 'tools/cardkit/make-assets.py')
    assets = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(assets)
    load_file = assets.load_file(str(cap))
    (output / 'load-file.bin').write_bytes(load_file)
    manifest = {'sourceCommit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'toolSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'kind': 'resource-probe-only', 'poolBytes': args.pool_bytes,
        'packageAid': PACKAGE.replace(':', ''), 'sources': hashes,
        'probeFormat': 2, 'probeProfile': ('constructor-control' if args.pool_bytes == 0 else
            'segmented-pool-allocation' if args.segments == 4 else 'pool-allocation'),
        'poolLayout': '4x4096' if args.segments == 4 else 'single',
        'capSha256': hashlib.sha256(cap.read_bytes()).hexdigest(),
        'loadFileSize': len(load_file), 'loadFileSha256': hashlib.sha256(load_file).hexdigest()}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Probe built; no reader or card operation was performed.')


if __name__ == '__main__':
    main()
