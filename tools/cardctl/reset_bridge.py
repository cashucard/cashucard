"""Private stdin/stdout PC/SC transport for the reviewed local reset runner.

No keys are arguments. Cardkit supplies already wrapped commands; this bridge
adds no command, retry or log. Importing it does not load PC/SC or open a reader.
"""
import argparse
import json
import sys

from read_only_preflight import ALLOWLIST as READ_ONLY

DELETABLE = frozenset(bytes.fromhex(aid) for aid in (
    'D2760000850101', 'F043415348554341524401',
    'F04341534855434152444D', 'F0434153485543415244',
))


class BridgeFailure(Exception):
    def __init__(self, code):
        self.code = code


def validate_command(command):
    if not isinstance(command, list) or any(type(v) is not int or not 0 <= v <= 255 for v in command):
        raise ValueError('invalid command')
    apdu = bytes(command)
    if apdu in READ_ONLY:
        return apdu
    if len(apdu) < 6 or len(apdu) != apdu[4] + 6 or apdu[-1] != 0:
        raise ValueError('invalid command framing')
    cla, ins, p1, p2, lc = apdu[:5]
    if cla == 0x80 and ins == 0x50 and p2 == 0 and lc == 8:
        return apdu
    if cla != 0x84:
        raise ValueError('command not permitted')
    if ins == 0x82 and p1 == 1 and p2 == 0 and lc == 16:
        return apdu
    if lc < 8:
        raise ValueError('missing command MAC')
    data = apdu[5:-9]
    if ins == 0xf2 and p1 in (0x40, 0x20) and p2 in (2, 3) and data == bytes.fromhex('4F00'):
        return apdu
    if ins == 0xe4 and p1 == p2 == 0 and len(data) >= 2 and data[0] == 0x4f and data[1] == len(data) - 2 and data[2:] in DELETABLE:
        return apdu
    if ins == 0xd8 and p1 != 0 and p2 == 0x81 and len(data) == 67 and data[0] == p1 and all(data[at:at+2] == bytes([0x80, 16]) and data[at+18] == 3 for at in (1, 23, 45)):
        return apdu
    raise ValueError('command not permitted')


def emit(value):
    print(json.dumps(value), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reader', required=True)
    args = parser.parse_args()
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD
    matches = [r for r in readers() if str(r) == args.reader]
    if len(matches) != 1:
        raise BridgeFailure('reader-not-found' if not matches else 'reader-not-unique')
    connection = matches[0].createConnection()
    connected = False
    try:
        try:
            connection.connect(disposition=SCARD_LEAVE_CARD)
        except Exception:
            raise BridgeFailure('card-connect-failed') from None
        connected = True
        emit({'ready': True})
        while True:
            line = sys.stdin.readline(4097)
            if not line:
                return
            if len(line) > 4096 or not line.endswith('\n'):
                raise ValueError('invalid message')
            value = json.loads(line)
            if value == {'close': True}:
                return
            if not isinstance(value, dict) or set(value) != {'apdu'}:
                raise ValueError('invalid message')
            try:
                command = validate_command(value['apdu'])
            except ValueError:
                raise BridgeFailure('command-not-permitted') from None
            try:
                data, sw1, sw2 = connection.transmit(list(command))
            except Exception:
                raise BridgeFailure('transport-failed') from None
            emit({'reply': data + [sw1, sw2]})
    finally:
        if connected:
            connection.disconnect()


if __name__ == '__main__':
    try:
        main()
    except BridgeFailure as error:
        emit({'error': error.code})
        sys.exit(1)
    except Exception:
        emit({'error': 'bridge-stopped'})
        sys.exit(1)
