"""No PC/SC imports, card or reader: exact read allowlist and stop conditions."""
import unittest
import read_only_preflight as p

CHIP = 'cplc-v1:4790d3213180072976207515'
CPLC = bytes.fromhex('9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000')
KEY = bytes.fromhex('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')


class PreflightTest(unittest.TestCase):
    def transport(self, replies):
        log = []
        def send(apdu):
            log.append(apdu)
            return replies[len(log) - 1]
        return send, log

    def test_absent_stops_after_identity_and_full_aid_selection(self):
        send, log = self.transport([(b'', 0x9000), (CPLC, 0x9000), (b'', 0x6A82)])
        self.assertEqual(p.inspect_card(send, CHIP)['installation'], 'absent')
        self.assertEqual(log, [p.SELECT_ISD, p.GET_CPLC, p.SELECT_CARD])

    def test_identity_mismatch_or_malformed_identity_stops_before_applet(self):
        for data in [CPLC, CPLC[:-1], CPLC[:15] + bytes(4) + CPLC[19:]]:
            with self.subTest(data=data):
                send, log = self.transport([(b'', 0x9000), (data, 0x9000)])
                with self.assertRaises(p.PreflightError):
                    p.inspect_card(send, 'cplc-v1:' + '00' * 12)
                self.assertEqual(log, [p.SELECT_ISD, p.GET_CPLC])

    def test_full_inspection_reports_public_state_with_no_authentication(self):
        info = bytearray(30)
        info[:2] = bytes([2, 1])
        info[2:6] = bytes([128, 1, 2, 125])
        info[7] = 1
        info[16] = 1
        send, log = self.transport([(b'', 0x9000), (CPLC, 0x9000), (bytes([2, 1]), 0x9000), (info, 0x9000), (KEY, 0x9000), (b'', 0x9000)])
        result = p.inspect_card(send, CHIP)
        self.assertEqual((result['unspent'], result['spent'], result['has_owner']), (1, 2, True))
        self.assertEqual(result['installation_id'], KEY.hex())
        self.assertFalse(result['authentication_attempted'])
        self.assertEqual(log, [p.SELECT_ISD, p.GET_CPLC, p.SELECT_CARD, p.GET_INFO, p.GET_PUBKEY, p.SELECT_TAG])

    def test_unknown_version_stops_without_retry(self):
        send, log = self.transport([(b'', 0x9000), (CPLC, 0x9000), (bytes([2, 0]), 0x9000)])
        with self.assertRaises(p.PreflightError):
            p.inspect_card(send, CHIP)
        self.assertEqual(len(log), 3)


if __name__ == '__main__':
    unittest.main()
