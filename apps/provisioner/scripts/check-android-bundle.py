#!/usr/bin/env python3
"""Inspect a built AAB using bundletool/readelf; no device or store connection."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ANDROID = '{http://schemas.android.com/apk/res/android}'


def check_manifest(xml):
    manifest = ET.fromstring(xml)
    sdk = manifest.find('uses-sdk')
    app = manifest.find('application')
    compile_sdk = int(manifest.attrib[ANDROID + 'compileSdkVersion'])
    target_sdk = int(sdk.attrib[ANDROID + 'targetSdkVersion'])
    if manifest.attrib['package'] != 'com.islandbitcoin.provisioner':
        raise ValueError('unexpected application identity')
    if target_sdk < 36 or compile_sdk < target_sdk:
        raise ValueError('compile SDK must cover target SDK 36 or newer')
    if app.attrib.get(ANDROID + 'debuggable', 'false') != 'false':
        raise ValueError('release must not be debuggable')
    return {'compile_sdk': compile_sdk, 'target_sdk': target_sdk}


def check_loads(output):
    loads = [line.split() for line in output.splitlines()
             if line.strip().startswith('LOAD ')]
    if not loads or any(int(line[-1], 16) < 16384 or
                        int(line[1], 16) % 16384 != int(line[2], 16) % 16384
                        for line in loads):
        raise ValueError('64-bit ELF LOAD segments require 16KB alignment')


def inspect(bundle, readelf):
    jar = os.environ.get('BUNDLETOOL_JAR')
    tool = ['java', '-jar', jar] if jar else ['bundletool']

    def dump(kind):
        return subprocess.check_output(tool + ['dump', kind, '--bundle=' + str(bundle)],
                                       text=True, stderr=subprocess.PIPE)

    subprocess.run(tool + ['validate', '--bundle=' + str(bundle)],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    result = check_manifest(dump('manifest'))
    config = json.loads(dump('config'))
    native = config.get('optimizations', {}).get('uncompressNativeLibraries', {})
    if not native.get('enabled') or native.get('alignment') != 'PAGE_ALIGNMENT_16K':
        raise ValueError('bundle must request 16KB native ZIP alignment')
    checked = []
    with zipfile.ZipFile(bundle) as archive, tempfile.TemporaryDirectory() as scratch:
        library = Path(scratch) / 'library.so'
        for name in archive.namelist():
            if name.endswith('.so') and any('/' + abi + '/' in name
                                           for abi in ('arm64-v8a', 'x86_64')):
                library.write_bytes(archive.read(name))
                output = subprocess.check_output([readelf, '-lW', str(library)],
                                                 text=True, stderr=subprocess.PIPE)
                check_loads(output)
                checked.append(name)
    if not any('/arm64-v8a/' in name for name in checked):
        raise ValueError('bundle must include checked arm64 native libraries')
    result.update(native_64bit_libraries_checked=len(checked),
                  aab_sha256=hashlib.sha256(bundle.read_bytes()).hexdigest())
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--readelf', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.bundle, args.readelf), indent=2))
    except (ValueError, KeyError, AttributeError, IndexError, TypeError, OSError,
            subprocess.CalledProcessError,
            ET.ParseError, zipfile.BadZipFile) as error:
        # Do not echo subprocess arguments, paths or captured output.
        print('Android bundle verification failed: ' + type(error).__name__)
        raise SystemExit(1)
