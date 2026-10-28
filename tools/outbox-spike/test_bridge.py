import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import io
import json
import types
import sys

s = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('probe_bridge.py'))
b = importlib.util.module_from_spec(s)
s.loader.exec_module(b)


def wrapped(ins, p1, p2, body):
    return list(bytes([0x84, ins, p1, p2, len(body) + 8]) + body + bytes(9))


class BridgeTest(unittest.TestCase):
    def test_fixed_transport_error_preserves_only_public_pcsc_code(self):
        class CardError(Exception):
            hresult = -2146435050
            def __str__(self): raise AssertionError('exception text must stay private')
        def fail(): raise CardError()
        with self.assertRaises(b.BridgeFailure) as caught:
            b.checked('reader-transmit-failed',fail)
        self.assertEqual(b.failure_message(caught.exception), {'error':'reader-transmit-failed','pcscCode':'80100016'})
        self.assertEqual(b.failure_message(ValueError('secret authentication text')), {'error':'probe-bridge-stopped'})

    def test_disconnect_failure_preserves_the_original_transmit_failure(self):
        class CardError(Exception): hresult = 0x80100016
        class Connection:
            def connect(self, **kwargs): pass
            def disconnect(self): raise RuntimeError('private disconnect text')
            def transmit(self, command): raise CardError('private transmit text')
        reader = types.SimpleNamespace(createConnection=lambda: Connection())
        modules = {'smartcard.System': types.SimpleNamespace(readers=lambda: [reader]),
            'smartcard.scard': types.SimpleNamespace(SCARD_LEAVE_CARD=0,SCARD_SHARE_EXCLUSIVE=1)}
        text = json.dumps({'apdu': list(b.select(b.ISD))}) + '\n'
        with patch.dict(sys.modules,modules), patch.object(sys,'argv',['bridge','--reader',str(reader)]), patch.object(sys,'stdin',io.StringIO(text)), patch.object(sys,'stdout',io.StringIO()):
            with self.assertRaises(b.BridgeFailure) as caught: b.main()
        self.assertEqual(b.failure_message(caught.exception), {'error':'reader-transmit-failed','pcscCode':'80100016'})

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
        for data in [list(b'PROBE') + [2, 0, 0], list(b'PROBE') + [4, 0x40, 0], list(b'WRONG') + [2, 0x40, 0]]:
            self.assertFalse(b.pool_probe_selected(data, 0x90, 0))

    def test_post_install_reservation_is_bounded_and_requires_selected_fresh_probe(self):
        for command in b.RESERVATIONS:
            self.assertEqual(b.validate_command(list(command)), command)
            for mode in ['registry_only', 'cleanup_only']:
                with self.assertRaises(ValueError):
                    b.validate_command(list(command), **{mode: True})
        with self.assertRaises(ValueError):
            b.validate_command(list(bytes.fromhex('B07C000002200003')))
        reserve = list(bytes.fromhex('B07C000002010003'))
        for commands, expected in [([reserve], 0), ([list(b.select(b.PROBE[2])), reserve, reserve], 1)]:
            sent = []
            class Connection:
                def connect(self, **kwargs): pass
                def disconnect(self): pass
                def transmit(self, command):
                    sent.append(bytes(command))
                    return (list(b'PROBE') + [3,0,0] if bytes(command) == b.select(b.PROBE[2]) else [0,0,0], 0x90,0)
            reader = types.SimpleNamespace(createConnection=lambda: Connection())
            modules = {'smartcard.System': types.SimpleNamespace(readers=lambda: [reader]),
                'smartcard.scard': types.SimpleNamespace(SCARD_LEAVE_CARD=0,SCARD_SHARE_EXCLUSIVE=1)}
            text = ''.join(json.dumps({'apdu': c}) + '\n' for c in commands)
            with patch.dict(sys.modules,modules), patch.object(sys,'argv',['bridge','--reader',str(reader)]), patch.object(sys,'stdin',io.StringIO(text)), patch.object(sys,'stdout',io.StringIO()):
                with self.assertRaises(b.BridgeFailure): b.main()
            self.assertEqual(sum(c in b.RESERVATIONS for c in sent), expected)

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
