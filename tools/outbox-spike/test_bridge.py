import importlib.util
from pathlib import Path
import unittest

s = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('probe_bridge.py'))
b = importlib.util.module_from_spec(s)
s.loader.exec_module(b)


def wrapped(ins, p1, p2, body):
    return list(bytes([0x84, ins, p1, p2, len(body) + 8]) + body + bytes(9))


class BridgeTest(unittest.TestCase):
    def test_probe_commands_only(self):
        for instance in b.PROBE[1:]:
            command = wrapped(0xe6, 0x0c, 0, b.field(b.PACKAGE) + b.field(instance) + b.field(instance) + b'\x01\0\x02\xc9\0\0')
            self.assertEqual(b.validate_command(command), bytes(command))
        for aid in b.PROBE:
            b.validate_command(wrapped(0xe4, 0, 0, b'\x4f' + b.field(aid)))
        b.validate_command(wrapped(0xe6, 2, 0, b.field(b.PACKAGE) + b.field(b.ISD) + b'\0\0\0'))
        b.validate_command(wrapped(0xe8, 0x80, 0, b'\xc4\x01\0'))

    def test_registry_only_mode_refuses_every_private_mutation(self):
        reads = [list(b.select(b.ISD)), list(bytes.fromhex('80CA9F7F00')),
                 list(bytes.fromhex('8050010008') + bytes(9)),
                 wrapped(0x82, 1, 0, bytes(8)),
                 wrapped(0xf2, 0x40, 2, b'\x4f\0')]
        for command in reads:
            self.assertEqual(b.validate_command(command, registry_only=True), bytes(command))
        writes = [list(b.COMMIT), wrapped(0xe8, 0x80, 0, b'\xc4\x01\0'),
                  wrapped(0xe4, 0, 0, b'\x4f' + b.field(b.PACKAGE)),
                  wrapped(0xe6, 2, 0, b.field(b.PACKAGE) + b.field(b.ISD) + b'\0\0\0')]
        for command in writes:
            with self.assertRaises(ValueError):
                b.validate_command(command, registry_only=True)

    def test_control_selection_cannot_enable_dummy_publication(self):
        b.validate_command(list(bytes.fromhex('B07D000010')))
        self.assertTrue(b.pool_probe_selected(list(b'PROBE') + [1, 0x40, 0], 0x90, 0))
        for size in [256, 4096, 16384]:
            self.assertTrue(b.pool_probe_selected(list(b'PROBE') + [2, size >> 8, size & 255], 0x90, 0))
        self.assertFalse(b.pool_probe_selected(list(b'PROBE') + [1, 0x10, 0], 0x90, 0))
        self.assertFalse(b.pool_probe_selected(list(b'PROBE') + [2, 0x20, 0], 0x90, 0))
        for data in [list(b'PROBE') + [2, 0, 0], list(b'PROBE') + [3, 0x40, 0], list(b'WRONG') + [2, 0x40, 0]]:
            self.assertFalse(b.pool_probe_selected(data, 0x90, 0))

    def test_cleanup_only_mode_allows_only_private_deletion(self):
        for aid in b.PROBE:
            command = wrapped(0xe4, 0, 0, b'\x4f' + b.field(aid))
            self.assertEqual(b.validate_command(command, cleanup_only=True), bytes(command))
        forbidden = [list(b.COMMIT), wrapped(0xe8, 0x80, 0, b'\xc4\x01\0'),
                     wrapped(0xe6, 2, 0, b.field(b.PACKAGE) + b.field(b.ISD) + b'\0\0\0')]
        for aid in [b.ISD] + b.PRODUCTION + [bytes.fromhex('A0000001515350')]:
            forbidden.append(wrapped(0xe4, 0, 0, b'\x4f' + b.field(aid)))
        for command in forbidden:
            with self.assertRaises(ValueError):
                b.validate_command(command, cleanup_only=True)

    def test_manager_keys_production_deletes_and_malformed_commands_refused(self):
        bad = [wrapped(0xd8, 1, 0x81, bytes(67)), [True], [0, 1],
               wrapped(0xe8, 5, 0, b'payload'),
               list(bytes.fromhex('8050000008') + bytes(9))]
        for aid in [b.ISD] + b.PRODUCTION:
            bad.append(wrapped(0xe4, 0, 0, b'\x4f' + b.field(aid)))
        for command in bad:
            with self.assertRaises(ValueError):
                b.validate_command(command)


if __name__ == '__main__':
    unittest.main()
