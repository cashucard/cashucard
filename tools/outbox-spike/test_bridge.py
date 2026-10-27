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
