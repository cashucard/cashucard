"""Closed phase PC/SC bridge. Request validation precedes PC/SC imports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parent))
import probe_bridge as common
from phase_wire import PhasePolicy

READER = 'ACS ACR122U PICC Interface'

def request(file, digest):
    p = Path(file)
    if not p.is_absolute() or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest): raise ValueError('request path/hash')
    parent = p.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077: raise ValueError('private request directory')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_nlink != 1 or s.st_mode & 0o077 or s.st_size > 1024 * 1024: raise ValueError('private request')
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or hashlib.sha256(raw).hexdigest() != digest: raise ValueError('request hash')
    return PhasePolicy(json.loads(raw))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reader', required=True); p.add_argument('--request', required=True); p.add_argument('--sha256', required=True)
    p.add_argument('--site-packages', required=True)
    args = p.parse_args()
    if args.reader != READER: raise ValueError('named reader')
    policy = request(args.request, args.sha256)
    if not policy.commands: raise ValueError('no reader work')
    site = Path(args.site_packages)
    if not site.is_absolute() or site.resolve(strict=True) != site or site.name != 'site-packages' or not site.is_dir(): raise ValueError('isolated site-packages')
    sys.path.append(str(site))
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD, SCARD_SHARE_EXCLUSIVE
    started = time.monotonic()
    found = [r for r in common.checked('reader-enumeration-failed', readers) if str(r) == READER]
    if len(found) != 1: raise common.BridgeFailure('reader-unavailable')
    c = common.checked('reader-connect-failed', found[0].createConnection)
    connected = False
    try:
        common.checked('reader-connect-failed', lambda: c.connect(mode=SCARD_SHARE_EXCLUSIVE, disposition=SCARD_LEAVE_CARD)); connected = True
        common.emit({'ready': True})
        while True:
            line = sys.stdin.readline(4097)
            if not line: return
            if len(line) > 4096 or not line.endswith('\n'): raise common.BridgeFailure('bridge-input-invalid')
            value = common.checked('bridge-input-invalid', lambda: json.loads(line))
            if value == {'close': True}: return
            if not isinstance(value, dict) or set(value) != {'apdu'}: raise common.BridgeFailure('bridge-input-invalid')
            if time.monotonic() - started > 120: raise common.BridgeFailure('drill-bound-exceeded')
            a = common.checked('bridge-command-refused', lambda: policy.before(value['apdu']))
            data, sw1, sw2 = common.checked('reader-transmit-failed', lambda: c.transmit(list(a)))
            policy.after(a, data, sw1, sw2)
            # The host durably receives a bad-status reply too; the policy then
            # blocks further transmissions instead of losing that evidence.
            common.emit({'reply': data + [sw1, sw2]})
    finally:
        if connected:
            common.checked('reader-close-failed', c.disconnect)

if __name__ == '__main__':
    try: main()
    except Exception as e:
        common.emit(common.failure_message(e)); sys.exit(1)
