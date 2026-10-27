#!/usr/bin/env python3
"""Build an isolated resource probe from the current applet's install path."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = 'F0:43:41:53:48:55:50:52:4F:42:45'

PROCESS = '''    public void process(APDU apdu) {
        byte[] b = apdu.getBuffer();
        if (selectingApplet()) {
            b[0] = 0x50; b[1] = 0x52; b[2] = 0x4F; b[3] = 0x42; b[4] = 0x45;
            b[5] = 1;
            Util.setShort(b, (short) 6, (short) probePool.length);
            apdu.setOutgoingAndSend((short) 0, (short) 8);
            return;
        }
        if (b[ISO7816.OFFSET_CLA] != (byte) 0xB0 || b[ISO7816.OFFSET_P1] != 0 ||
            b[ISO7816.OFFSET_P2] != 0) {
            ISOException.throwIt(ISO7816.SW_INCORRECT_P1P2);
        }
        if (b[ISO7816.OFFSET_INS] == (byte) 0x7D) {
            // Counts are 32-bit, two shorts per memory pool (JC 3.0.4+).
            for (short i = 0; i < 8; i++) {
                Util.setShort(b, (short) (i * 2), probeStats[i]);
            }
            Util.setShort(b, (short) 16, JCSystem.getMaxCommitCapacity());
            Util.setShort(b, (short) 18, JCSystem.getUnusedCommitCapacity());
            Util.setShort(b, (short) 20, (short) probePool.length);
            b[22] = probePool[0];
            b[23] = 1;
            apdu.setOutgoingAndSend((short) 0, (short) 24);
            return;
        }
        if (b[ISO7816.OFFSET_INS] == (byte) 0x7E) {
            JCSystem.beginTransaction();
            try {
                // A conservative dummy publication footprint. No proof is used.
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
        // Every production payment, setup, PIN and load command is disabled.
        ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
    }'''


def source_probe(source, size):
    if size < 256 or size > 24576 or size % 256:
        raise ValueError('pool size must be a multiple of 256, from 256 to 24576')
    anchor = 'public class CashuApplet extends Applet implements TagSwitch {'
    if source.count(anchor) != 1 or source.count('        schnorrHW.init();') != 1:
        raise ValueError('applet install anchors changed; review the probe generator')
    source = source.replace(anchor, anchor + '\n    private final byte[] probePool;\n    private final short[] probeStats;')
    source = source.replace('        schnorrHW.init();', f'''        schnorrHW.init();
        probeStats = new short[8];
        JCSystem.getAvailableMemory(probeStats, (short) 0, JCSystem.MEMORY_TYPE_PERSISTENT);
        probePool = new byte[(short) {size}];
        JCSystem.getAvailableMemory(probeStats, (short) 2, JCSystem.MEMORY_TYPE_PERSISTENT);
        JCSystem.getAvailableMemory(probeStats, (short) 4, JCSystem.MEMORY_TYPE_TRANSIENT_RESET);
        JCSystem.getAvailableMemory(probeStats, (short) 6, JCSystem.MEMORY_TYPE_TRANSIENT_DESELECT);''')
    source, count = re.subn(r'    public void process\(APDU apdu\) \{.*?\n    }', lambda _: PROCESS, source, flags=re.S)
    if count != 1:
        raise ValueError('applet process anchor changed; review the probe generator')
    return source


def prepare(output, size):
    # Refuse reuse so an old CAP cannot be mistaken for this build.
    output.mkdir(parents=True, exist_ok=False)
    sources = ROOT / 'applet/src/main/java/me/flashapp/cashu'
    destination = output / 'src/me/flashapp/cashu'
    destination.mkdir(parents=True)
    hashes = {}
    for file in sorted(sources.glob('*.java')):
        raw = file.read_bytes()
        hashes[file.name] = hashlib.sha256(raw).hexdigest()
        text = source_probe(raw.decode(), size) if file.name == 'CashuApplet.java' else raw.decode()
        (destination / file.name).write_text(text)
    build = ET.parse(ROOT / 'applet/build.xml')
    project = build.getroot()
    project.set('basedir', str(ROOT / 'applet'))
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
        for arg in args:
            if arg.get('value') == 'applet/${cap.file}':
                arg.set('value', '${cap.file}')
    build.write(output / 'build.xml', encoding='unicode')
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='new scratch directory')
    parser.add_argument('--pool-bytes', type=int, default=16384)
    parser.add_argument('--sdk', type=Path, default=Path.home() / '.javacard/sdks/jc305u4_kit')
    args = parser.parse_args()
    output = args.output.resolve()
    if not (args.sdk / 'lib/api_classic.jar').is_file():
        parser.error('JavaCard 3.0.5 SDK is missing')
    # Validate before creating files.
    source_probe((ROOT / 'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text(), args.pool_bytes)
    hashes = prepare(output, args.pool_bytes)
    cap = output / 'resource-probe.cap'
    subprocess.run(['ant', '-f', str(output / 'build.xml'), 'cap',
        '-Dsrc.dir=' + str(output / 'src'), '-Dcap.file=' + str(cap),
        '-Djc.sdk=' + str(args.sdk.resolve())], check=True)
    manifest = {'sourceCommit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'toolSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'kind': 'resource-probe-only', 'poolBytes': args.pool_bytes,
        'packageAid': PACKAGE.replace(':', ''), 'sources': hashes,
        'capSha256': hashlib.sha256(cap.read_bytes()).hexdigest()}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Probe built; no reader or card operation was performed.')


if __name__ == '__main__':
    main()
