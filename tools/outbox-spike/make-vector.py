#!/usr/bin/env python3
"""Independent test encoder: synthetic points and published BIP-340 scalar 3.

Uses the existing Python reference signer, independently of the Node codec.
There is no transport, credential input or hardware access.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/cardctl'))
from test_bip340 import reference_sign
from bip340 import G, _point_mul, tagged_hash, verify


def point(scalar):
    x, y = _point_mul(G, scalar)
    return bytes([2 + y % 2]) + x.to_bytes(32, 'big')


def encode(v):
    context, ids, proofs, outputs, identity = [v[k] for k in
        ('context', 'keysets', 'proofs', 'outputs', 'identity')]
    key = bytes.fromhex(context['cardKey'])
    assert key == point(3), 'encoder accepts only the published test key'
    assert context['unit'] == 0
    assert identity['installation'] == context['installation']

    def secret(p):
        return ('["P2PK",{"nonce":"' + p['nonce'] + '","data":"' + key.hex()
                + '","tags":[["sigflag","SIG_ALL"]]}]')

    text = ''.join(secret(p) + p['C'] for p in proofs)
    text += ''.join(str(o['amount']) + o['B_'] for o in outputs)
    message = hashlib.sha256(text.encode()).digest()
    pub, payment = reference_sign(3, message, bytes(32))
    assert verify(pub, message, payment)
    mint = context['mint'].encode()
    body = bytearray(b'CCP-AS\x01' + key + bytes.fromhex(context['installation']))
    body += struct.pack('>QBI', int(identity['id']), identity['index'], identity['generation'])
    body += b'\x01' + struct.pack('>H', len(mint)) + mint + b'\x00' + bytes([len(proofs)])
    for p in proofs:
        kid = bytes.fromhex(ids[p['keysetRef']])
        body += struct.pack('>BII', p['slot'], p['generation'], p['amount'])
        body += bytes([len(kid)]) + kid + bytes.fromhex(p['nonce'] + p['C'])
    body += bytes([len(outputs)])
    for o in outputs:
        kid = bytes.fromhex(ids[o['keysetRef']])
        body += struct.pack('>I', o['amount']) + bytes([len(kid)]) + kid + bytes.fromhex(o['B_'])
    body += payment
    descriptor_message = tagged_hash('CashuCard/assisted-settlement/v1', bytes(body))
    pub, descriptor = reference_sign(3, descriptor_message, bytes(32))
    assert verify(pub, descriptor_message, descriptor)
    compact = bytes([1, len(outputs)])
    for o in outputs:
        compact += struct.pack('>IB', o['amount'], o['keysetRef']) + bytes.fromhex(o['B_'])
    compact += payment + descriptor
    return dict(body=bytes(body).hex(), packet=(bytes(body) + descriptor).hex(),
                packetId=hashlib.sha256(body).hexdigest(), paymentMessage=message.hex(),
                descriptorMessage=descriptor_message.hex(), compact=compact.hex())


def fixture():
    ids = ['01' + '23' * 32, '0077010203040506']
    installation = '31' * 32
    return dict(status='Candidate prototype vector; no production wire assignment',
        testKey='BIP-340 published test secret scalar 3, zero auxiliary randomness',
        context=dict(cardKey=point(3).hex(), installation=installation,
                     mint='https://mint.example.com/Bitcoin', unit=0), keysets=ids,
        proofs=[dict(slot=7, generation=9, amount=8, keysetRef=0, keysetPrefix=ids[0][:16],
                     nonce='11'*32, C=point(5).hex(), date=0),
                dict(slot=3, generation=11, amount=4, keysetRef=1, keysetPrefix=ids[1][:16],
                     nonce='22'*32, C=point(7).hex(), date=0)],
        identity=dict(installation=installation, id='9007199254740993', index=2, generation=19),
        outputs=[dict(amount=8, keysetRef=1, B_=point(11).hex()),
                 dict(amount=4, keysetRef=0, B_=point(13).hex())])


if sys.argv[1:] == ['--encode']:
    print(json.dumps(encode(json.load(sys.stdin))))
elif sys.argv[1:] in ([], ['--check']):
    value = fixture()
    value['expected'] = encode(value)
    signatures = bytes.fromhex(value['expected']['compact'])[-128:]
    value['paymentSignature'] = signatures[:64].hex()
    value['descriptorSignature'] = signatures[64:].hex()
    if sys.argv[1:]:
        path = Path(__file__).resolve().parent / 'fixtures/assisted-settlement-v1.json'
        assert json.loads(path.read_text()) == value, 'candidate vector differs from independent encoder'
        print('Candidate vector verified with independent Python encoder and reference test signer.')
    else:
        print(json.dumps(value, indent=2))
else:
    raise SystemExit('usage: make-vector.py [--check | --encode]')
