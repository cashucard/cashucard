"""Reader-free tests: exact read sequence and refusals before private slot data."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

import spent_audit_reader as a

CHIP = 'cplc-v1:4790d3213180072976207515'
CPLC = bytes.fromhex('9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000')
KEY = bytes.fromhex('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')


class AuditTests(unittest.TestCase):
    def fixture(self, change=None):
        info = bytearray(30)
        info[:6] = bytes([2, 1, 128, 0, 2, 126])
        info[7] = 1
        info[8] = 4
        info[11] = info[16] = 1
        record = bytearray(109 + len(b'https://mint.test'))
        record[:2] = bytes([4, 1])
        record[105] = len(b'https://mint.test')
        record[106:106+record[105]] = b'https://mint.test'
        statuses = bytearray(128)
        statuses[2] = statuses[9] = 2
        proofs = {}
        for slot, amount in [(2, 1), (9, 2)]:
            proofs[slot] = bytes([2])+bytes.fromhex('ab'*8)+amount.to_bytes(4,'big')+bytes([slot])*32+KEY+bytes(4)
        replies = {a.SELECT_ISD:b'', a.GET_CPLC:CPLC, a.SELECT_CARD:bytes([2,1]),
            a.GET_INFO:info, a.GET_PUBKEY:KEY, a.GET_CARD:record, a.GET_SLOT_STATUS:statuses}
        if change:
            change(replies, proofs)
        log = []
        def send(command):
            log.append(command)
            if command[:2] == bytes([0xb0,0x13]):
                return proofs[command[2]], 0x9000
            return replies[command], 0x9000
        return send, log

    def test_only_named_spent_slots_are_read_and_no_authentication_or_write_is_possible(self):
        tx, log = self.fixture()
        result = a.inspect_spent(tx, CHIP, KEY.hex(), 2)
        self.assertEqual([p['slot'] for p in result['pieces']], [2,9])
        self.assertEqual(result['mint'], 'https://mint.test')
        self.assertEqual([v[2] for v in log if v[1] == 0x13], [2,9])
        self.assertTrue(all(v[1] in (0xa4,0xca,0x01,0x10,0x16,0x14,0x13) for v in log))
        self.assertEqual(len(log), 13)  # two proof reads plus eleven identity/state reads
        self.assertEqual(log[-2:], [a.SELECT_ISD,a.GET_CPLC])

    def test_wrong_chip_key_or_unspent_state_stops_before_proof_read(self):
        for mutation in [
            lambda r,p:r.update({a.GET_CPLC:CPLC[:-1]}),
            lambda r,p:r.update({a.GET_PUBKEY:bytes([3])+KEY[1:]}),
            lambda r,p:r[a.GET_INFO].__setitem__(3,1),
            lambda r,p:r.update({a.SELECT_CARD:bytes([2,0])}),
        ]:
            tx, log = self.fixture(mutation)
            with self.assertRaises(a.AuditReadError):
                a.inspect_spent(tx,CHIP,KEY.hex(),2)
            self.assertFalse(any(v[1] == 0x13 for v in log))

    def test_bitmap_record_and_proof_disagreement_stop_without_retry(self):
        for mutation in [
            lambda r,p:r[a.GET_SLOT_STATUS].__setitem__(2,1),
            lambda r,p:r.update({a.GET_CARD:r[a.GET_CARD][:-1]}),
            lambda r,p:p.update({2:bytes([1])+p[2][1:]}),
        ]:
            tx, log = self.fixture(mutation)
            with self.assertRaises(a.AuditReadError):
                a.inspect_spent(tx,CHIP,KEY.hex(),2)
            reads=[v for v in log if v[1] == 0x13]
            self.assertEqual(len(reads),len(set(reads)))

    def test_standalone_child_has_no_reader_access_or_raw_output(self):
        run = subprocess.run([sys.executable,str(Path(a.__file__)), '--reader','not-a-reader',
            '--expect-chip',CHIP,'--expect-installation',KEY.hex(),'--expected-spent','2'],
            input='',text=True,capture_output=True)
        self.assertNotEqual(run.returncode,0)
        self.assertEqual(run.stdout,'')
        self.assertEqual(json.loads(run.stderr),{'error':'spent-audit-reader-stopped'})


if __name__ == '__main__':
    unittest.main()
