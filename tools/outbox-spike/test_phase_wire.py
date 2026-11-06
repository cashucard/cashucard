"""Offline policy tests; no reader enumeration or PC/SC import."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent))
import phase_wire as w
import phase_bridge as bridge

def program():
    b = {'key': w.V['context']['cardKey'], 'chip': w.PINS['chip'], 'installation': w.V['context']['installation'],
        'image': {k: w.PINS[k] for k in ('source', 'manifest', 'cap', 'load')}, 'runId': '11' * 16,
        'runtimeSha256': '22' * 32, 'recipeSha256': '33' * 32, 'sourceSha256': '44' * 32, 'recipe': 'compact-many-records-v1'}
    rows = [
        (w.SELECT_ISD, {'sw': 0x9000, 'maxLength': 255}),
        (w.CPLC, {'sw': 0x9000, 'kind': 'cplc', 'id': b['chip']}),
        (w.SELECT, {'sw': 0x9000, 'data': b'CPROT\x02'.hex()}),
        (w.cmd(0x7a), {'sw': 0x9000, 'data': b['key']}),
        (w.cmd(0x7d), {'sw': 0x9000, 'kind': 'diagnostics', 'ready': 0}),
        (w.SETUP, {'sw': 0x9000, 'data': '01'})]
    return {'format': 'compact-phase-wire-v1', 'mode': 'execute', 'binding': b, 'phase': 0, 'step': 0,
        'commands': [{'frame': a.hex(), 'check': check} for a, check in rows], 'retirements': []}

def data(row):
    c = row['check']
    if 'data' in c: return bytes.fromhex(c['data'])
    if c.get('kind') == 'cplc':
        d = bytearray(45); d[:3] = bytes.fromhex('9f7f2a'); key = bytes.fromhex(w.PINS['chip'].split(':')[1])
        d[3:7] = key[:4]; d[13:21] = key[4:]
        return bytes(d)
    if c.get('kind') == 'diagnostics': return bytes.fromhex('7fff0a0e0a0014001400000000000005')
    return b''

class WirePolicy(unittest.TestCase):
    def test_retirement_requires_independent_packet_evidence(self):
        p = program(); p['phase'] = 5; p['commands'][4]['check']['ready'] = 2
        scope = b'\0' + (1).to_bytes(8, 'big') + (1).to_bytes(4, 'big') + b'\x11' * 32
        p['commands'][-1] = {'frame': w.cmd(0x76).hex(), 'check': {'sw': 0x9000, 'data': bytes([19, 0, 1, 45, 82, 0]).hex()}}
        p['commands'].append({'frame': w.cmd(0x77, scope).hex(), 'check': {'sw': 0x9000, 'data': '01'}})
        with self.assertRaises(ValueError): w.PhasePolicy(p)

    def test_exact_order_and_identity_fence_precede_mutation(self):
        p = program(); policy = w.PhasePolicy(p)
        for row in p['commands']:
            a = policy.before(list(bytes.fromhex(row['frame'])))
            policy.after(a, data(row), 0x90, 0)
        self.assertFalse(policy.failed)
        with self.assertRaises(ValueError): policy.before(list(w.SETUP))
        bad = w.PhasePolicy(p)
        with self.assertRaises(ValueError): bad.before(list(w.SETUP))
        with self.assertRaises(ValueError): bad.before(list(w.SELECT_ISD))
        bad = w.PhasePolicy(p)
        a = bad.before(list(w.SELECT_ISD)); bad.after(a, b'', 0x90, 0)
        a = bad.before(list(w.CPLC)); c = bytearray(data(p['commands'][1])); c[15] ^= 1
        bad.after(a, c, 0x90, 0)
        with self.assertRaises(ValueError): bad.before(list(w.SELECT))

    def test_management_wrong_fixture_and_recovery_mutations_are_refused(self):
        for a in [bytes.fromhex('8050010008000000000000000000'), bytes.fromhex('84d8018108000000000000000000'), bytes.fromhex('84e4000008000000000000000000'), w.load(w.V['proofs'][100]), w.cmd(0x74)]:
            p = program(); p['commands'][-1]['frame'] = a.hex()
            with self.assertRaises(ValueError): w.PhasePolicy(p)
        p = program(); p['mode'] = 'reconcile'
        with self.assertRaises(ValueError): w.PhasePolicy(p)
        p = program(); p['commands'][3]['check']['data'] = '02' + '00' * 32
        with self.assertRaises(ValueError): w.PhasePolicy(p)
        p = program(); p['commands'][4]['check']['sw'] = 0x6f00
        with self.assertRaises(ValueError): w.PhasePolicy(p)
        p = program(); p['commands'][-1]['check'] = {'sw': 0x9000, 'maxLength': 255}
        with self.assertRaises(ValueError): w.PhasePolicy(p)

    def test_mutated_or_bad_response_latches_stop_and_diagnostics_are_strict(self):
        for value in [[True], [256], '00']:
            policy = w.PhasePolicy(program())
            with self.assertRaises(ValueError): policy.before(value)
            self.assertTrue(policy.failed)
        p = program(); policy = w.PhasePolicy(p)
        for row in p['commands'][:4]:
            a = policy.before(list(bytes.fromhex(row['frame']))); policy.after(a, data(row), 0x90, 0)
        row = p['commands'][4]; d = bytearray(data(row)); d[6:10] = bytes(4)
        a = policy.before(list(bytes.fromhex(row['frame']))); policy.after(a, d, 0x90, 0)
        with self.assertRaises(ValueError): policy.before(list(w.SETUP))

    def test_request_hash_permissions_and_trace_validation_are_offline(self):
        p = program()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); root.chmod(0o700); file = root / 'request.json'
            raw = json.dumps(p).encode(); file.write_bytes(raw); file.chmod(0o600)
            digest = hashlib.sha256(raw).hexdigest()
            self.assertEqual(len(bridge.request(str(file), digest).commands), 6)
            with self.assertRaises(ValueError): bridge.request(str(file), '00' * 32)
            file.chmod(0o644)
            with self.assertRaises(ValueError): bridge.request(str(file), digest)
        trace = [{'frame': row['frame'], 'reply': (data(row) + bytes.fromhex('9000')).hex()} for row in p['commands']]
        self.assertTrue(w.check_trace({'program': p, 'trace': trace, 'complete': True})['ok'])
        with self.assertRaises(ValueError): w.check_trace({'program': p, 'trace': trace[:-1], 'complete': True})
        self.assertNotIn('smartcard.System', sys.modules)

if __name__ == '__main__': unittest.main()
