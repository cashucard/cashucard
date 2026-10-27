"""Private PC/SC pipe for the explicitly approved resource probe; no retries."""
import argparse
import json
import sys

PACKAGE = bytes.fromhex('F0434153485550524F4245')
ISD = bytes.fromhex('A000000151000000')
PRODUCTION = [bytes.fromhex(value) for value in (
    'F0434153485543415244', 'F04341534855434152444D',
    'F043415348554341524401', 'D2760000850101')]
PROBE = [PACKAGE, PACKAGE + b'\x4d', PACKAGE + b'\x01']


def select(aid):
    return bytes([0, 0xa4, 4, 0, len(aid)]) + aid + b'\0'


READ_ONLY = {select(aid) for aid in [ISD] + PRODUCTION + PROBE}
READ_ONLY.update([bytes.fromhex('80CA9F7F00'), bytes.fromhex('B07D000018'), bytes.fromhex('B07D000010')])
COMMIT = bytes.fromhex('B07E000001')


def field(value):
    return bytes([len(value)]) + value


def validate_command(value, *, registry_only=False, cleanup_only=False):
    if not isinstance(value, list) or any(type(v) is not int or not 0 <= v <= 255 for v in value):
        raise ValueError('invalid command')
    apdu = bytes(value)
    if registry_only and cleanup_only:
        raise ValueError('choose one reader mode')
    if registry_only or cleanup_only:
        allowed = (0xa4, 0xca, 0x50, 0x82, 0xf2) + ((0xe4,) if cleanup_only else ())
        if len(apdu) < 2 or apdu[1] not in allowed:
            raise ValueError('command outside reader mode')
    if apdu in READ_ONLY or apdu == COMMIT:
        return apdu
    if len(apdu) < 6 or len(apdu) != apdu[4] + 6 or apdu[-1] != 0:
        raise ValueError('invalid framing')
    cla, ins, p1, p2, lc = apdu[:5]
    if cla == 0x80 and ins == 0x50 and p1 == 1 and p2 == 0 and lc == 8:
        return apdu
    if cla != 0x84 or lc < 8:
        raise ValueError('secure command required')
    body = apdu[5:-9]
    if ins == 0x82 and p1 == 1 and p2 == 0 and lc == 16:
        return apdu
    if ins == 0xf2 and p1 in (0x40, 0x20) and p2 in (2, 3) and body == b'\x4f\0':
        return apdu
    if ins == 0xe8 and p1 in (0, 0x80) and body:
        return apdu
    if ins == 0xe6 and p2 == 0:
        if p1 == 2 and body == field(PACKAGE) + field(ISD) + b'\0\0\0':
            return apdu
        for instance in PROBE[1:]:
            if p1 == 0x0c and body == field(PACKAGE) + field(instance) + field(instance) + b'\x01\0\x02\xc9\0\0':
                return apdu
    if ins == 0xe4 and p1 == p2 == 0 and body in [b'\x4f' + field(aid) for aid in PROBE]:
        return apdu
    raise ValueError('command not permitted')


def emit(value):
    print(json.dumps(value), flush=True)


def pool_probe_selected(data, sw1, sw2):
    return (sw1 == 0x90 and sw2 == 0 and len(data) == 8 and bytes(data[:5]) == b'PROBE' and
            data[5] in (1, 2) and bytes(data[6:8]) == b'\x40\0')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reader', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--registry-only', action='store_true')
    modes.add_argument('--cleanup-only', action='store_true')
    args = parser.parse_args()
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD, SCARD_SHARE_EXCLUSIVE
    matches = [r for r in readers() if str(r) == args.reader]
    if len(matches) != 1:
        raise ValueError('named reader unavailable')
    connection = matches[0].createConnection()
    connected = False
    try:
        connection.connect(mode=SCARD_SHARE_EXCLUSIVE, disposition=SCARD_LEAVE_CARD)
        connected = True
        emit({'ready': True})
        selected_probe = False
        while True:
            line = sys.stdin.readline(4097)
            if not line:
                return
            if len(line) > 4096 or not line.endswith('\n'):
                raise ValueError('invalid message')
            message = json.loads(line)
            if message == {'close': True}:
                return
            if not isinstance(message, dict) or set(message) != {'apdu'}:
                raise ValueError('invalid message')
            command = validate_command(message['apdu'], registry_only=args.registry_only, cleanup_only=args.cleanup_only)
            if command == COMMIT and not selected_probe:
                raise ValueError('probe selection required')
            data, sw1, sw2 = connection.transmit(list(command))
            if command[:2] == b'\0\xa4':
                selected_probe = (command == select(PROBE[2]) and pool_probe_selected(data, sw1, sw2))
            emit({'reply': data + [sw1, sw2]})
    finally:
        if connected:
            connection.disconnect()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        emit({'error': 'probe-bridge-stopped'})
        sys.exit(1)
