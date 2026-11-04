"""Independent ordered policy for the one unset-up cleanup. No PC/SC imports."""
import json
from pathlib import Path

PROFILE = json.loads((Path(__file__).parent / 'unset-up-profile.json').read_text())
ISD = bytes.fromhex('00a4040008a00000015100000000')
CPLC = bytes.fromhex('80ca9f7f00')
SELECT = bytes.fromhex('00a404000bf04341534855434d50540100')
DIAG = bytes.fromhex('b07d000000')
KEY = bytes.fromhex('b07a000000')

def frames(raw):
    result = []
    at = 0
    while at < len(raw):
        start = at
        if at + 2 > len(raw) or raw[at] != 0xe3:
            raise ValueError('registry framing')
        size = raw[at + 1]; at += 2
        if size == 0x81:
            if at >= len(raw) or raw[at] < 128: raise ValueError('registry length')
            size = raw[at]; at += 1
        elif size == 0x82:
            if at + 2 > len(raw) or raw[at] == 0: raise ValueError('registry length')
            size = int.from_bytes(raw[at:at+2], 'big'); at += 2
        elif size >= 0x80:
            raise ValueError('registry length')
        if at + size > len(raw): raise ValueError('registry truncation')
        at += size
        result.append(raw[start:at])
    return result

EXPECTED = {p['kind']: frames(bytes.fromhex(p['data'])) for p in PROFILE['registry']}
BASELINE = [f for f in EXPECTED['load-files'] if bytes.fromhex(PROFILE['package']) not in f]
STAGES = [('isd', 0), ('cplc', 0), ('isd', 0), ('init', 0), ('auth', 0),
    ('applications', 0), ('load-files', 0), ('select', 0), ('diag', 0), ('key', 0),
    ('isd', 1), ('cplc', 1), ('isd', 1), ('init', 1), ('auth', 1),
    ('applications', 1), ('load-files', 1),
    *[('delete', aid) for aid in PROFILE['deletionAids']],
    ('applications', 2), ('load-files', 2), ('isd', 2), ('cplc', 2)]

def secure(a, ins, p1, p2, body):
    return len(a) == len(body) + 14 and a[:5] == bytes([0x84, ins, p1, p2, len(body)+8]) and a[5:-9] == body and a[-1] == 0

class UnsetUpPolicy:
    def __init__(self, expected_key=None):
        self.key = bytes.fromhex(PROFILE['key']) if expected_key is None else bytes(expected_key)
        if len(self.key) != 33 or self.key[0] not in (2,3): raise ValueError('key shape')
        self.index = 0; self.total = 0; self.failed = False; self.pending = None
        self.page = 0; self.registry = bytearray()

    @property
    def complete(self):
        return not self.failed and self.index == len(STAGES) and self.pending is None

    def before(self, value):
        try:
            if self.failed or self.pending is not None or self.index >= len(STAGES) or self.total >= 64:
                raise ValueError('cleanup stopped')
            if not isinstance(value, list) or any(type(v) is not int or not 0 <= v <= 255 for v in value):
                raise ValueError('invalid APDU')
            a = bytes(value)
            if not 5 <= len(a) <= 261: raise ValueError('short frame')
            kind, phase = STAGES[self.index]
            admitted = False
            if kind == 'isd': admitted = a == ISD
            elif kind == 'cplc': admitted = a == CPLC
            elif kind == 'select': admitted = a == SELECT
            elif kind == 'diag': admitted = a == DIAG
            elif kind == 'key': admitted = a == KEY
            elif kind == 'init': admitted = len(a) == 14 and a[:5] == bytes.fromhex('8050010008') and a[-1] == 0
            elif kind == 'auth': admitted = len(a) == 22 and a[:5] == bytes.fromhex('8482010010') and a[-1] == 0
            elif kind in ('applications', 'load-files'):
                admitted = self.page < 4 and secure(a, 0xf2, 0x40 if kind == 'applications' else 0x20, 2 if self.page == 0 else 3, bytes.fromhex('4f00'))
            elif kind == 'delete':
                aid = bytes.fromhex(phase)
                admitted = secure(a, 0xe4, 0, 0, bytes([0x4f,len(aid)])+aid)
            if not admitted: raise ValueError('command outside exact cleanup stage')
            self.pending = a; self.total += 1
            return a
        except Exception:
            self.failed = True
            raise

    def after(self, a, data, sw1, sw2):
        try:
            if self.failed or self.pending != bytes(a): raise ValueError('reply order')
            if not isinstance(data, (list, bytes, bytearray)) or any(type(v) is not int or not 0 <= v <= 255 for v in data): raise ValueError('reply bytes')
            data = bytes(data)
            if len(data) > 256 or type(sw1) is not int or type(sw2) is not int: raise ValueError('reply size')
            kind, phase = STAGES[self.index]
            self.pending = None
            if kind in ('applications', 'load-files'):
                if (sw1,sw2) == (0x6a,0x88):
                    if self.page or data: raise ValueError('registry absence')
                elif (sw1,sw2) == (0x63,0x10):
                    if not data or self.page >= 3: raise ValueError('registry continuation')
                    self.registry.extend(data); self.page += 1
                    return True
                elif (sw1,sw2) != (0x90,0): raise ValueError('registry status')
                self.registry.extend(data)
                got = frames(bytes(self.registry))
                want = ([] if kind == 'applications' else BASELINE) if phase == 2 else EXPECTED[kind]
                if len(got) != len(want) or len(set(got)) != len(got) or set(got) != set(want): raise ValueError('registry mismatch')
                self.registry.clear(); self.page = 0
            else:
                if (sw1,sw2) != (0x90,0): raise ValueError('status mismatch')
                if kind == 'cplc' and data != bytes.fromhex(PROFILE['cplc']): raise ValueError('chip mismatch')
                if kind == 'init' and (len(data)!=28 or data[10:12]!=b'\x01\x02'): raise ValueError('factory handshake')
                if kind == 'auth' and data: raise ValueError('authentication reply')
                if kind == 'select' and data != b'CPROT\x02': raise ValueError('private version')
                if kind == 'diag':
                    words = [int.from_bytes(data[i:i+2],'big') for i in (0,2,4,6,8)]
                    if len(data)!=16 or data[10:]!=bytes.fromhex('000000000005') or any(v>32767 for v in words) or words[4]>words[3] or min(words[3:])<128: raise ValueError('unset-up diagnostics')
                if kind == 'key' and data != self.key: raise ValueError('installation key')
                if kind == 'delete' and data not in (b'',b'\0'): raise ValueError('delete receipt')
            self.index += 1
            return True
        except Exception:
            self.failed = True
            return False
