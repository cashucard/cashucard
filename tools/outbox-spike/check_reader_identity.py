"""One fixed SELECT/CPLC sequence; no authentication, writes or retry."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe_bridge as common
from compact_recovery_bridge import trim_cplc

READER = 'ACS ACR122U PICC Interface'
FRAMES = (common.select(common.ISD), bytes.fromhex('80ca9f7f00'))


def inspect(readers, share_exclusive, leave_card, save):
    result = {'plan': 'switched-card-identity-v1', 'reader': READER,
              'commands': 0, 'readerClosed': None, 'status': 'stopped'}
    connection = None
    connected = False
    began = time.monotonic()
    try:
        save('consumed', {'plan': result['plan'], 'consumed': True})
        matches = [r for r in common.checked('reader-enumeration-failed', readers) if str(r) == READER]
        if len(matches) != 1:
            raise common.BridgeFailure('reader-unavailable')
        connection = common.checked('reader-connect-failed', matches[0].createConnection)
        common.checked('reader-connect-failed', lambda: connection.connect(mode=share_exclusive, disposition=leave_card))
        connected = True
        for index, frame in enumerate(FRAMES, 1):
            if time.monotonic()-began >= 30:
                raise common.BridgeFailure('identity-time-bound')
            save('intent-'+str(index), {'frame': frame.hex()})
            result['commands'] = index
            reply = common.checked('reader-transmit-failed', lambda: connection.transmit(list(frame)))
            data, sw1, sw2 = trim_cplc(frame, reply)
            if len(data) > 256 or any(type(v) is not int or not 0 <= v <= 255 for v in data):
                raise common.BridgeFailure('identity-reply-invalid')
            sw = bytes([sw1, sw2]).hex()
            save('reply-'+str(index), {'data': bytes(data).hex(), 'sw': sw})
            if sw != '9000':
                raise common.BridgeFailure('identity-status-refused')
            if index == 2:
                if len(data) != 45 or bytes(data[:3]) != bytes.fromhex('9f7f2a'):
                    raise common.BridgeFailure('identity-cplc-invalid')
                result['cplc'] = bytes(data).hex()
        result['status'] = 'read-complete'
    except Exception as error:
        result.update(common.failure_message(error))
    finally:
        if connected:
            try:
                common.checked('reader-close-failed', connection.disconnect)
                result['readerClosed'] = True
            except Exception:
                result['readerClosed'] = False
                result['status'] = 'stopped'
                result['closeFailure'] = 'reader-close-uncertain'
        save('result', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', required=True)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise ValueError('isolated Python required')
    directory = Path(args.evidence_dir)
    s = directory.lstat()
    if not directory.is_absolute() or not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
        raise ValueError('private evidence directory required')
    # Refuse every existing receipt; a failed check cannot become a second pass.
    if any(directory.glob('*.json')):
        raise ValueError('identity pass already used')
    def save(name, value):
        fd = os.open(directory/(name+'.json'), os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        fd = os.open(directory, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    site = HERE.parent/'cardctl/.venv/lib/python3.15/site-packages'
    sys.path.append(str(site.resolve(strict=True)))
    # This import does not enumerate; inspect() syncs consumption before readers().
    from smartcard.System import readers
    from smartcard.scard import SCARD_SHARE_EXCLUSIVE, SCARD_LEAVE_CARD
    result = inspect(readers, SCARD_SHARE_EXCLUSIVE, SCARD_LEAVE_CARD, save)
    print(json.dumps(result))
    if result['status'] != 'read-complete' or result['readerClosed'] is not True:
        sys.exit(1)


if __name__ == '__main__':
    try: main()
    except Exception:
        print(json.dumps({'status':'stopped','error':'identity-startup-refused'}))
        sys.exit(1)
