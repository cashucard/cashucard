"""Private read-only child of spent-audit.cjs. Never authenticates or writes.

Raw spent-slot material goes only through the parent's private pipe. Do not
invoke this child to inspect a card manually: use the parent summary instead.
"""
import argparse
import json
import re
import sys

from cardctl import decode_info
from read_only_preflight import SELECT_ISD, GET_CPLC, SELECT_CARD, GET_INFO, GET_PUBKEY

GET_CARD = bytes.fromhex('B016000000')
GET_SLOT_STATUS = bytes.fromhex('B014000080')


class AuditReadError(Exception):
    pass


def validate_expected(chip, installation, count):
    if not re.fullmatch(r'cplc-v1:[0-9a-f]{24}', chip) or not re.fullmatch(r'(02|03)[0-9a-f]{64}', installation) or not 1 <= count <= 128:
        raise AuditReadError('invalid expected state')


def inspect_spent(transmit, expected_chip, expected_installation, expected_count):
    validate_expected(expected_chip, expected_installation, expected_count)
    allowed = {SELECT_ISD, GET_CPLC, SELECT_CARD, GET_INFO, GET_PUBKEY, GET_CARD, GET_SLOT_STATUS}
    allowed.update(bytes([0xb0, 0x13, slot, 0, 0x52]) for slot in range(128))

    def send(command):
        if command not in allowed:
            raise AuditReadError('command not read-only')
        data, sw = transmit(command)
        if sw != 0x9000:
            raise AuditReadError('read rejected')
        return bytes(data)

    def chip():
        send(SELECT_ISD)
        value = send(GET_CPLC)
        if len(value) != 45 or value[:3] != bytes.fromhex('9F7F2A') or value[15:19] in (bytes(4), bytes([255])*4):
            raise AuditReadError('invalid CPLC')
        identity = 'cplc-v1:' + (value[3:7] + value[13:21]).hex()
        if identity != expected_chip:
            raise AuditReadError('chip mismatch')

    def info():
        data = send(GET_INFO)
        if len(data) != 30 or data[:2] != bytes([2, 1]):
            raise AuditReadError('unsupported info')
        value = decode_info(data)
        if value['max_slots'] != 128 or value['unspent'] != 0 or value['spent'] != expected_count or value['empty'] != 128-expected_count or not value['has_owner'] or value['pin_state'] != 'set' or not value['record_set'] or value['locked'] or value['format'] != 4:
            raise AuditReadError('card state mismatch')
        return value

    chip()
    if send(SELECT_CARD) != bytes([2, 1]):
        raise AuditReadError('unsupported applet')
    first = info()
    key = send(GET_PUBKEY)
    if key.hex() != expected_installation:
        raise AuditReadError('installation mismatch')
    record = send(GET_CARD)
    if len(record) < 109 or len(record) != 109+record[105] or record[0] != 4 or record[1] != 1 or record[2] != 0:
        raise AuditReadError('card record mismatch')
    try:
        mint = record[106:106+record[105]].decode('ascii')
    except UnicodeError:
        raise AuditReadError('card record mismatch') from None
    statuses = send(GET_SLOT_STATUS)
    if len(statuses) != 128 or any(s not in (0, 2) for s in statuses) or statuses.count(2) != expected_count:
        raise AuditReadError('slot state mismatch')
    pieces = []
    for slot, status in enumerate(statuses):
        if status != 2:
            continue
        raw = send(bytes([0xb0, 0x13, slot, 0, 0x52]))
        if len(raw) != 82 or raw[0] != 2:
            raise AuditReadError('spent slot mismatch')
        pieces.append({'slot':slot, 'status':2, 'keyset_id':raw[1:9].hex(),
            'amount':int.from_bytes(raw[9:13], 'big'), 'nonce':raw[13:45].hex(),
            'C':raw[45:78].hex(), 'date':int.from_bytes(raw[78:82], 'big')})
    if info() != first or send(GET_PUBKEY) != key:
        raise AuditReadError('card changed during audit')
    chip()
    return {'chip_id':expected_chip, 'installation_id':key.hex(), 'version':'2.1',
        'unspent':0, 'spent':expected_count, 'has_owner':True, 'pin_state':'set',
        'record_set':True, 'locked':False, 'mint':mint, 'refund_key':record[7:40].hex(), 'pieces':pieces}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reader', required=True)
    parser.add_argument('--expect-chip', required=True)
    parser.add_argument('--expect-installation', required=True)
    parser.add_argument('--expected-spent', required=True, type=int)
    args = parser.parse_args()
    validate_expected(args.expect_chip, args.expect_installation, args.expected_spent)
    if sys.stdout.isatty() or sys.stdin.readline(32) != 'cashu-spent-audit-v1\n':
        raise AuditReadError('private parent pipe required')
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD
    matches = [r for r in readers() if str(r) == args.reader]
    if len(matches) != 1:
        raise AuditReadError('named reader unavailable')
    connection = matches[0].createConnection()
    connected = False
    try:
        connection.connect(disposition=SCARD_LEAVE_CARD)
        connected = True
        def transmit(apdu):
            data, sw1, sw2 = connection.transmit(list(apdu))
            return bytes(data), (sw1 << 8) | sw2
        result = inspect_spent(transmit, args.expect_chip, args.expect_installation, args.expected_spent)
        print(json.dumps(result))
    finally:
        if connected:
            connection.disconnect()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('{"error":"spent-audit-reader-stopped"}', file=sys.stderr)
        sys.exit(1)
