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


class BridgeFailure(Exception):
    def __init__(self, code, error=None):
        super().__init__(code)
        self.code = code
        value = getattr(error, 'hresult', -1)
        self.pcsc_code = ('%08x' % (value & 0xffffffff)
            if type(value) is int and value != -1 and -(1 << 31) <= value < (1 << 32) else None)


def checked(code, operation):
    try:
        return operation()
    except Exception as error:
        raise BridgeFailure(code, error) from None


def failure_message(error):
    if not isinstance(error, BridgeFailure):
        return {'error': 'probe-bridge-stopped'}
    return {'error': error.code, **({'pcscCode': error.pcsc_code} if error.pcsc_code is not None else {})}


def select(aid):
    return bytes([0, 0xa4, 4, 0, len(aid)]) + aid + b'\0'


READ_ONLY = {select(aid) for aid in [ISD] + PRODUCTION + PROBE}
READ_ONLY.update([bytes.fromhex('80CA9F7F00'), bytes.fromhex('B07D000018'), bytes.fromhex('B07D000010')])
COMMIT = bytes.fromhex('B07E000001')
RESERVATIONS = {bytes.fromhex('B07C000002010003'), bytes.fromhex('B07C000002100003'), bytes.fromhex('B07C000002400003')}


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
    if apdu in READ_ONLY or apdu == COMMIT or apdu in RESERVATIONS:
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
    if sw1 != 0x90 or sw2 != 0 or len(data) != 8 or bytes(data[:5]) != b'PROBE':
        return False
    size = data[6] * 256 + data[7]
    return (data[5] == 1 and size == 16384) or (data[5] == 2 and size in (256, 4096, 16384)) or (data[5] == 3 and size in (256, 4096, 16384))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reader', required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--registry-only', action='store_true')
    modes.add_argument('--cleanup-only', action='store_true')
    args = parser.parse_args()
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD, SCARD_SHARE_EXCLUSIVE
    matches = [r for r in checked('reader-enumeration-failed', readers) if str(r) == args.reader]
    if len(matches) != 1:
        raise BridgeFailure('reader-unavailable')
    connection = checked('reader-connect-failed', matches[0].createConnection)
    connected = False
    try:
        checked('reader-connect-failed', lambda: connection.connect(mode=SCARD_SHARE_EXCLUSIVE, disposition=SCARD_LEAVE_CARD))
        connected = True
        emit({'ready': True})
        selected_probe = False
        reservation_selected = False
        reservation_sent = False
        while True:
            line = sys.stdin.readline(4097)
            if not line:
                return
            if len(line) > 4096 or not line.endswith('\n'):
                raise BridgeFailure('bridge-input-invalid')
            message = checked('bridge-input-invalid', lambda: json.loads(line))
            if message == {'close': True}:
                return
            if not isinstance(message, dict) or set(message) != {'apdu'}:
                raise BridgeFailure('bridge-input-invalid')
            command = checked('bridge-command-refused', lambda: validate_command(message['apdu'], registry_only=args.registry_only, cleanup_only=args.cleanup_only))
            if command == COMMIT and not selected_probe:
                raise BridgeFailure('bridge-command-refused')
            if command in RESERVATIONS:
                if not reservation_selected or reservation_sent:
                    raise BridgeFailure('bridge-command-refused')
                reservation_sent = True
            data, sw1, sw2 = checked('reader-transmit-failed', lambda: connection.transmit(list(command)))
            if command[:2] == b'\0\xa4':
                selected_probe = (command == select(PROBE[2]) and pool_probe_selected(data, sw1, sw2))
                reservation_selected = (command == select(PROBE[2]) and sw1 == 0x90 and sw2 == 0 and bytes(data) == b'PROBE\x03\x00\x00')
            if command in RESERVATIONS and sw1 == 0x90 and sw2 == 0 and data == [0, 0, 0]:
                selected_probe = True
            emit({'reply': data + [sw1, sw2]})
    finally:
        if connected:
            prior_failure = sys.exc_info()[0] is not None
            try:
                checked('reader-close-failed', connection.disconnect)
            except BridgeFailure:
                if not prior_failure:
                    raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(failure_message(error))
        sys.exit(1)
