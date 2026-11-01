"""Offline fixed-fixture wire policy. Importing never loads PC/SC."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('_phase_bip340', HERE.parent / 'cardctl/bip340.py')
_bip = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bip)
verify, tagged_hash = _bip.verify, _bip.tagged_hash
V = json.loads((HERE / 'fixtures/compact-capacity-v1.json').read_text())
PINS = json.loads((HERE / 'pixel-streamed.json').read_text())
SELECT_ISD = bytes.fromhex('00a4040008a00000015100000000')
SELECT = bytes.fromhex('00a404000bf04341534855434d50540100')
CPLC = bytes.fromhex('80ca9f7f00')

def cmd(ins, data=b''):
    return bytes([0xb0, ins, 0, 0]) + (bytes([len(data)]) + data if data else b'') + b'\0'

def load(p):
    return cmd(0x71, bytes([p['slot']]) + p['generation'].to_bytes(4, 'big') +
        bytes([p['keysetRef']]) + p['amount'].to_bytes(4, 'big') + bytes.fromhex(p['nonce'] + p['C']))

def output(o):
    return cmd(0x73, o['amount'].to_bytes(4, 'big') + bytes([o['keysetRef']]) + bytes.fromhex(o['B_']))

MINT = V['context']['mint'].encode()
SETUP = cmd(0x7e, bytes(8) + bytes.fromhex(V['context']['installation']) + bytes([len(MINT)]) + MINT)
KEYSET = cmd(0x78, bytes([0, 33]) + bytes.fromhex(V['keysets'][0]))
RELOAD = load(dict(V['proofs'][46], slot=0, generation=2))
READS = {SELECT_ISD, SELECT, CPLC, cmd(0x7a), cmd(0x7d), cmd(0x76)}
for index in range(45):
    READS.add(cmd(0x7c, bytes([index])))
    READS.update(cmd(0x75, bytes([index, offset >> 8, offset & 255, size])) for offset, size in ((0, 255), (255, 175)))

def unhex(value, limit=261, empty=False):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[0-9a-f]{2})*', value) or (not empty and not value) or len(value) > limit * 2:
        raise ValueError('hex framing')
    return bytes.fromhex(value)

def scope_valid(data, phase):
    if len(data) != 45 or data[0] >= 45:
        return False
    index, identity, generation = data[0], int.from_bytes(data[1:9], 'big'), int.from_bytes(data[9:13], 'big')
    if phase == 5:
        return index == 0 and identity == generation == 1
    return phase == 7 and ((index == 0 and identity == 46 and generation == 2) or
        (index > 0 and identity == index + 1 and generation == 1))

def allowed(a, mode, phase):
    if a in READS:
        return True
    if mode != 'execute':
        return False
    if phase == 0:
        return a in {SETUP, KEYSET, *(load(p) for p in V['proofs'][:46])}
    if phase in (1, 2, 3):
        start = (phase - 1) * 15
        return a == cmd(0x74) or a in {cmd(0x72, bytes([1, 1, i])) for i in range(start, start + 15)} or a in {output(o) for o in V['outputs'][start:start + 15]}
    if phase == 4:
        return a == cmd(0x72, bytes([1, 1, 45]))
    if phase == 5 and a in {RELOAD, cmd(0x72, bytes([1, 1, 0])), output(V['outputs'][45]), cmd(0x74)}:
        return True
    return len(a) == 51 and a[:5] == bytes.fromhex('b07700002d') and a[-1] == 0 and scope_valid(a[5:50], phase)

def validate_check(check):
    if not isinstance(check, dict) or type(check.get('sw')) is not int or not 0 <= check['sw'] <= 65535:
        raise ValueError('response check')
    keys = set(check)
    if keys == {'sw', 'data'}:
        unhex(check['data'], 255, True)
    elif keys in ({'sw', 'length'}, {'sw', 'maxLength'}):
        n = check.get('length', check.get('maxLength'))
        if type(n) is not int or not 0 <= n <= 255: raise ValueError('response size')
    elif keys == {'sw', 'length', 'prefix'}:
        prefix = unhex(check['prefix'])
        if check['length'] != 45 or len(prefix) != 13: raise ValueError('scope prefix')
    elif keys == {'sw', 'kind', 'id'}:
        if check['kind'] != 'cplc' or check['id'] != PINS['chip']: raise ValueError('chip check')
    elif keys == {'sw', 'kind', 'ready'}:
        if check['kind'] != 'diagnostics' or type(check['ready']) is not int or check['ready'] not in (0, 2): raise ValueError('diagnostics check')
    else:
        raise ValueError('response check fields')

def command_check(a, c, program):
    """A request cannot weaken write receipts or replace a fixed-size export."""
    if a == SELECT: return c == {'sw': 0x9000, 'data': b'CPROT\x02'.hex()}
    if a == SELECT_ISD: return c == {'sw': 0x9000, 'maxLength': 255}
    if a == CPLC: return c == {'sw': 0x9000, 'kind': 'cplc', 'id': PINS['chip']}
    ins = a[1]
    if ins == 0x7a: return c == {'sw': 0x9000, 'data': program['binding']['key']}
    if ins in (0x7e, 0x78, 0x73): return c == {'sw': 0x9000, 'data': '01'}
    if ins == 0x71: return c == {'sw': 0x9000, 'data': bytes([a[5]]).hex()}
    if ins == 0x72:
        return c == ({'sw': 0x6a84, 'data': ''} if program['phase'] == 4 else {'sw': 0x9000, 'data': bytes([a[7]]).hex()})
    if ins == 0x77: return c == {'sw': 0x9000, 'data': '01'} or program['phase'] == 5 and c == {'sw': 0x6985, 'data': ''}
    if ins == 0x75:
        return c.get('sw') == 0x9000 and (c == {'sw': 0x9000, 'length': a[8]} or
            set(c) == {'sw', 'data'} and len(bytes.fromhex(c['data'])) == a[8])
    if ins == 0x74:
        if set(c) != {'sw', 'length', 'prefix'} or c['sw'] != 0x9000 or c['length'] != 45: return False
        prefix = bytes.fromhex(c['prefix']); index = prefix[0]
        expected_id, expected_gen = (46, 2) if program['phase'] == 5 else (index + 1, 1)
        return index < 45 and int.from_bytes(prefix[1:9], 'big') == expected_id and int.from_bytes(prefix[9:13], 'big') == expected_gen
    if ins == 0x76:
        return set(c) == {'sw', 'data'} and c['sw'] == 0x9000 and len(bytes.fromhex(c['data'])) == 6
    return True

def matches(data, sw, check):
    if sw != check['sw']: return False
    if 'data' in check: return data == bytes.fromhex(check['data'])
    if 'length' in check:
        return len(data) == check['length'] and data.startswith(bytes.fromhex(check.get('prefix', '')))
    if 'maxLength' in check: return len(data) <= check['maxLength']
    if check['kind'] == 'cplc':
        return len(data) == 45 and data[:3] == bytes.fromhex('9f7f2a') and data[15:19] not in (bytes(4), b'\xff' * 4) and \
            'cplc-v1:' + (data[3:7] + data[13:21]).hex() == check['id']
    words = [int.from_bytes(data[i:i + 2], 'big') for i in range(0, min(len(data), 14), 2)]
    ready = check['ready']
    return len(data) == 16 and data[14:] == bytes([ready, 5]) and all(n <= 32767 for n in words[:5]) and \
        128 <= words[4] <= words[3] and words[5:] == ([16384, 12288] if ready == 2 else [0, 0])

def retirement_packet(value, binding, phase):
    if not isinstance(value, dict) or set(value) != {'scope', 'packet'}: raise ValueError('retirement evidence')
    scope, packet = unhex(value['scope']), unhex(value['packet'], 430)
    if not scope_valid(scope, phase): raise ValueError('retirement identity')
    index, identity, generation = scope[0], int.from_bytes(scope[1:9], 'big'), int.from_bytes(scope[9:13], 'big')
    replacement = identity == 46
    p = dict(V['proofs'][46], slot=0, generation=2) if replacement else V['proofs'][index]
    o = V['outputs'][45 if replacement else index]
    key = bytes.fromhex(binding['key'])
    kid, out_kid = [bytes.fromhex(V['keysets'][ref]) for ref in (p['keysetRef'], o['keysetRef'])]
    prefix = b'CCP-AS\x01' + key + bytes.fromhex(V['context']['installation']) + struct.pack('>QBI', identity, index, generation)
    prefix += b'\x01' + struct.pack('>H', len(MINT)) + MINT + b'\x00\x01'
    prefix += struct.pack('>BII', p['slot'], p['generation'], p['amount']) + bytes([len(kid)]) + kid + bytes.fromhex(p['nonce'] + p['C'])
    prefix += b'\x01' + struct.pack('>I', o['amount']) + bytes([len(out_kid)]) + out_kid + bytes.fromhex(o['B_'])
    if len(packet) != len(prefix) + 128 or packet[:-128] != prefix or hashlib.sha256(packet[:-64]).digest() != scope[13:]: raise ValueError('canonical retirement packet')
    secret = '["P2PK",{"nonce":"' + p['nonce'].lower() + '","data":"' + key.hex() + '","tags":[["sigflag","SIG_ALL"]]}]'
    message = hashlib.sha256((secret + p['C'].lower() + str(o['amount']) + o['B_'].lower()).encode()).digest()
    if not verify(key[1:], message, packet[-128:-64]) or not verify(key[1:], tagged_hash('CashuCard/assisted-settlement/v1', packet[:-64]), packet[-64:]):
        raise ValueError('retirement signature')
    return scope

class PhasePolicy:
    def __init__(self, program):
        if not isinstance(program, dict) or set(program) != {'format', 'mode', 'binding', 'phase', 'step', 'commands', 'retirements'} or program['format'] != 'compact-phase-wire-v1':
            raise ValueError('wire program')
        b = program['binding']
        if set(b) != {'runId', 'key', 'runtimeSha256', 'chip', 'image', 'recipe', 'recipeSha256', 'sourceSha256', 'installation'} or b['recipe'] != 'compact-many-records-v1' or not re.fullmatch(r'[0-9a-f]{32}', b['runId']) or any(not re.fullmatch(r'[0-9a-f]{64}', b[k]) for k in ('runtimeSha256', 'recipeSha256', 'sourceSha256')):
            raise ValueError('binding fields')
        if b['chip'] != PINS['chip'] or b['installation'] != V['context']['installation'] or b['image'] != {k: PINS[k] for k in ('source', 'manifest', 'cap', 'load')} or not re.fullmatch(r'(02|03)[0-9a-f]{64}', b['key']):
            raise ValueError('fixed binding')
        if program['mode'] not in ('execute', 'reconcile') or type(program['phase']) is not int or not 0 <= program['phase'] <= 8 or type(program['step']) is not int or not 0 <= program['step'] <= 160:
            raise ValueError('wire operation')
        self.commands = program['commands']
        if not isinstance(self.commands, list) or len(self.commands) > 160: raise ValueError('command bound')
        self.at = 0
        self.pending = None
        self.failed = False
        for entry in self.commands:
            if not isinstance(entry, dict) or set(entry) != {'frame', 'check'} or not allowed(unhex(entry['frame']), program['mode'], program['phase']):
                raise ValueError('wire command')
            validate_check(entry['check'])
            if not command_check(unhex(entry['frame']), entry['check'], program): raise ValueError('weakened response check')
        required = {unhex(c['frame'])[5:50] for c in self.commands if c['frame'].startswith('b077')}
        evidence = program['retirements']
        if not isinstance(evidence, list) or len(evidence) != len(required): raise ValueError('retirement proof count')
        observed = {retirement_packet(r, b, program['phase']) for r in evidence}
        if observed != required: raise ValueError('retirement proof scopes')
        if not self.commands:
            if program['phase'] != 8 or program['mode'] != 'execute': raise ValueError('empty invocation')
            return
        if len(self.commands) < 5 or [unhex(c['frame']) for c in self.commands[:5]] != [SELECT_ISD, CPLC, SELECT, cmd(0x7a), cmd(0x7d)]:
            raise ValueError('admission fence')
        if self.commands[0]['check'] != {'sw': 0x9000, 'maxLength': 255} or \
           self.commands[1]['check'] != {'sw': 0x9000, 'kind': 'cplc', 'id': b['chip']} or \
           self.commands[2]['check'] != {'sw': 0x9000, 'data': b'CPROT\x02'.hex()} or \
           self.commands[3]['check'] != {'sw': 0x9000, 'data': b['key']} or self.commands[4]['check'].get('kind') != 'diagnostics' or self.commands[4]['check']['sw'] != 0x9000:
            raise ValueError('admission checks')
        expected_ready = 0 if program['phase'] == 0 and program['step'] < 2 else 2
        if self.commands[4]['check']['ready'] != expected_ready: raise ValueError('setup state')
        if program['mode'] == 'execute' and expected_ready == 2:
            if len(self.commands) < 6 or unhex(self.commands[5]['frame']) != cmd(0x76) or set(self.commands[5]['check']) != {'sw', 'data'} or self.commands[5]['check']['sw'] != 0x9000 or len(unhex(self.commands[5]['check']['data'])) != 6:
                raise ValueError('state fence')

    def before(self, value):
        if self.failed or self.pending is not None or self.at >= len(self.commands):
            self.failed = True
            raise ValueError('policy stopped')
        if not isinstance(value, list) or any(type(v) is not int or not 0 <= v <= 255 for v in value):
            self.failed = True
            raise ValueError('APDU bytes')
        a = bytes(value)
        if a != bytes.fromhex(self.commands[self.at]['frame']):
            self.failed = True
            raise ValueError('unexpected command')
        self.pending = a
        return a

    def after(self, a, data, sw1, sw2):
        if self.pending != a:
            self.failed = True
            raise ValueError('missing intent')
        self.failed = not matches(bytes(data), sw1 * 256 + sw2, self.commands[self.at]['check'])
        self.pending = None
        self.at += 1

def check_trace(value):
    policy = PhasePolicy(value['program'])
    for row in value['trace']:
        a = policy.before(list(unhex(row['frame'])))
        raw = unhex(row['reply'], 257)
        if len(raw) < 2: raise ValueError('reply')
        policy.after(a, raw[:-2], raw[-2], raw[-1])
        if policy.failed: raise ValueError('response mismatch')
    if value['complete'] and policy.at != len(policy.commands): raise ValueError('incomplete trace')
    return {'ok': True, 'commands': policy.at}

if __name__ == '__main__':
    try:
        raw = sys.stdin.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024: raise ValueError('input bound')
        print(json.dumps(check_trace(json.loads(raw))))
    except (ValueError, KeyError, TypeError, IndexError):
        print(json.dumps({'ok': False}))
        sys.exit(1)
