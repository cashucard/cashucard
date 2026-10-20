"""Bounded installation inspection. Never authenticates, writes or retries."""
import argparse
import json
import re
import sys

from cardctl import decode_info

SELECT_ISD = bytes.fromhex('00A4040008A00000015100000000')
GET_CPLC = bytes.fromhex('80CA9F7F00')
SELECT_CARD = bytes.fromhex('00A404000BF04341534855434152440100')
GET_INFO = bytes.fromhex('B001000000')
GET_PUBKEY = bytes.fromhex('B010000021')
SELECT_TAG = bytes.fromhex('00A4040007D276000085010100')
ALLOWLIST = frozenset((SELECT_ISD, GET_CPLC, SELECT_CARD, GET_INFO, GET_PUBKEY, SELECT_TAG))


class PreflightError(Exception):
    pass


def validate_identity(expected_chip):
    if not re.fullmatch(r'cplc-v1:[0-9a-f]{24}', expected_chip):
        raise PreflightError('invalid expected identity')


def inspect_card(transmit, expected_chip):
    """transmit returns (data bytes, SW). Only public state leaves this function."""
    validate_identity(expected_chip)

    def send(apdu, allowed=(0x9000,)):
        if apdu not in ALLOWLIST:
            raise PreflightError('command is not read-only allowlisted')
        data, sw = transmit(apdu)
        if sw not in allowed:
            raise PreflightError('unexpected status word %04X' % sw)
        return bytes(data), sw

    send(SELECT_ISD)
    cplc, _ = send(GET_CPLC)
    if len(cplc) != 45 or cplc[:3] != bytes.fromhex('9F7F2A'):
        raise PreflightError('malformed CPLC')
    serial = cplc[15:19]
    if serial in (bytes(4), bytes([255]) * 4):
        raise PreflightError('unusable CPLC serial')
    chip = 'cplc-v1:' + (cplc[3:7] + cplc[13:21]).hex()
    if chip != expected_chip:
        raise PreflightError('chip identity mismatch')
    selected, sw = send(SELECT_CARD, (0x9000, 0x6A82))
    if sw == 0x6A82:
        return {'chip_id': chip, 'installation': 'absent', 'authentication_attempted': False}
    if selected != bytes([2, 1]):
        raise PreflightError('unexpected applet version')
    info, _ = send(GET_INFO)
    if len(info) != 30 or info[:2] != bytes([2, 1]):
        raise PreflightError('malformed 2.1 info')
    decoded = decode_info(info)
    key, _ = send(GET_PUBKEY)
    if len(key) != 33 or key[0] not in (2, 3):
        raise PreflightError('malformed installation public key')
    _, tag = send(SELECT_TAG, (0x9000, 0x6A82))
    return {
        'chip_id': chip, 'installation': 'present', 'installation_id': key.hex(),
        'unspent': decoded['unspent'], 'spent': decoded['spent'],
        'empty_slots': decoded['empty'], 'pin_state': decoded['pin_state'],
        'has_owner': decoded['has_owner'], 'record_set': decoded['record_set'],
        'locked': decoded['locked'], 'tag_present': tag == 0x9000,
        'authentication_attempted': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reader', required=True, help='exact PC/SC reader name; no index fallback')
    parser.add_argument('--expect-chip', required=True)
    args = parser.parse_args()
    validate_identity(args.expect_chip)
    # Native imports occur only on explicit execution, never in reader-free tests.
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD
    matches = [reader for reader in readers() if str(reader) == args.reader]
    if len(matches) != 1:
        raise PreflightError('expected exactly one matching named reader')
    result = inspect_connection(matches[0].createConnection(), args.expect_chip, SCARD_LEAVE_CARD)
    print(json.dumps(result, sort_keys=True))


def inspect_connection(connection, expected_chip, leave_card):
    """One connection; pyscard takes disposition on connect, not disconnect."""
    connected = False
    try:
        try:
            connection.connect(disposition=leave_card)
            connected = True
        except Exception:
            raise PreflightError('reader connection failed; no retry performed') from None

        def transmit(apdu):
            try:
                data, sw1, sw2 = connection.transmit(list(apdu))
            except Exception:
                raise PreflightError('read transport failed; no retry performed') from None
            return bytes(data), (sw1 << 8) | sw2

        return inspect_card(transmit, expected_chip)
    finally:
        if connected:
            connection.disconnect()


if __name__ == '__main__':
    try:
        main()
    except PreflightError as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('preflight transport unavailable; no retry performed', file=sys.stderr)
        sys.exit(1)
