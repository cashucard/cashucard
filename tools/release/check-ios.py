"""Validate a signed IPA locally; no device, account or store connection."""
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile


def check_identity(info, entitlements, profile, version, build):
    assert info['CFBundleIdentifier'] == 'com.islandbitcoin.provisioner'
    assert info['CFBundleShortVersionString'] == version
    assert str(info['CFBundleVersion']) == str(build)
    assert not entitlements.get('get-task-allow')
    assert entitlements['application-identifier'] == 'H7UAM79QQP.com.islandbitcoin.provisioner'
    assert 'TAG' in entitlements['com.apple.developer.nfc.readersession.formats']
    assert profile['TeamIdentifier'] == ['H7UAM79QQP']
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices')
    assert not profile['Entitlements'].get('get-task-allow')
    assert profile['Entitlements']['application-identifier'] == entitlements['application-identifier']
    assert 'TAG' in profile['Entitlements']['com.apple.developer.nfc.readersession.formats']
    assert 'F043415348554341524401' in info['com.apple.developer.nfc.readersession.iso7816.select-identifiers']


def inspect(ipa, manifest):
    with tempfile.TemporaryDirectory(prefix='cashu-ipa-') as temporary:
        subprocess.run(['ditto', '-x', '-k', str(ipa), temporary], check=True)
        apps = list((Path(temporary)/'Payload').glob('*.app'))
        assert len(apps) == 1
        app = apps[0]
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        entitlements = plistlib.loads(subprocess.check_output(['codesign', '-d', '--entitlements', ':-', str(app)]))
        profile = plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(app/'embedded.mobileprovision')]))
        info = plistlib.loads((app/'Info.plist').read_bytes())
        check_identity(info, entitlements, profile, manifest['version'], manifest['provisionerBuild'])
        print('IPA identity, distribution profile, signature and NFC entitlement verified.')


if __name__ == '__main__':
    inspect(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()))
