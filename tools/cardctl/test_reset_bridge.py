"""Reader-free checks for the reset bridge's command boundary."""
import unittest
import reset_bridge as b


class ResetBridgeTest(unittest.TestCase):
    def wrapped(self, ins, p1, p2, data):
        return [0x84, ins, p1, p2, len(data) + 8] + data + [0] * 8 + [0]

    def test_known_reset_commands_are_allowed(self):
        for apdu in b.READ_ONLY:
            b.validate_command(list(apdu))
        b.validate_command([0x80, 0x50, 0, 0, 8] + [0] * 8 + [0])
        b.validate_command([0x84, 0x82, 1, 0, 16] + [0] * 16 + [0])
        for aid in b.DELETABLE:
            b.validate_command(self.wrapped(0xe4, 0, 0, [0x4f, len(aid)] + list(aid)))
        for p1 in (0x40, 0x20):
            for p2 in (2, 3):
                b.validate_command(self.wrapped(0xf2, p1, p2, [0x4f, 0]))
        keys = [1] + ([0x80, 16] + [0] * 16 + [3] + [0] * 3) * 3
        b.validate_command(self.wrapped(0xd8, 1, 0x81, keys))

    def test_unapproved_writes_and_malformed_commands_never_reach_pcsc(self):
        forbidden = [
            [0xb0, 0x71, 0, 0, 0],  # owner command
            self.wrapped(0xe8, 0x80, 0, [1]),  # LOAD
            self.wrapped(0xe4, 0, 0, [0x4f, 8] + list(bytes.fromhex('A000000151000000'))),
            self.wrapped(0xe4, 0, 0x80, [0x4f, 7] + list(bytes.fromhex('D2760000850101'))),
            self.wrapped(0xd8, 1, 0x81, [0] * 67),
            self.wrapped(0xd8, 2, 0x81, [1] + ([0x80, 16] + [0] * 16 + [3] + [0] * 3) * 3),
            [0x84, 0x82, 3, 0, 16] + [0] * 16 + [0],
            [0x80, 0x50, 0, 0, 8] + [0] * 7 + [0],
            [True, 0xa4, 0, 0],
            [256], [],
        ]
        for apdu in forbidden:
            with self.subTest(apdu=apdu):
                with self.assertRaises(ValueError):
                    b.validate_command(apdu)


if __name__ == '__main__':
    unittest.main()
