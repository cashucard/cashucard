// Local-only recovery verifier. Real mint persistence is exercised separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('./cashu-crypto.cjs');
const {localOrigin, verifyRestored} = require('./assisted-settlement.cjs');

function fixture() {
  const a = 0x1234567890abcdefn;
  const K = cc.compressed(cc.mul(a));
  const outputs = [1, 2].map(amount => ({
    id: '00test', amount,
    B_: cc.hexOf(cc.blind(`test output ${amount}`, BigInt(amount + 4)).B_),
  }));
  const signatures = outputs.map(o => {
    const C_ = cc.compressed(cc.mul(a, cc.point(o.B_)));
    const p = 0x42n;
    const e = cc.int(cc.hashE(cc.mul(p), cc.mul(p, cc.point(o.B_)), cc.point(K), cc.point(C_)));
    const s = (p + e * a) % cc.N;
    return {id: o.id, amount: o.amount, C_: cc.hexOf(C_),
      dleq: {e: cc.hexOf(cc.bytes32(e)), s: cc.hexOf(cc.bytes32(s))}};
  });
  return {outputs, response: {outputs: structuredClone(outputs), signatures},
    keys: {'1': cc.hexOf(K), '2': cc.hexOf(K)}};
}

test('rehearsal origins are loopback HTTP only, with no URL decoration', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(localOrigin(`http://${host}:4338/`), `http://${host}:4338`);
  }
  for (const url of ['https://forge.flashapp.me', 'http://example.com',
    'http://localhost.evil.test', 'http://user@localhost', 'http://localhost/path',
    'http://localhost?mint=other', 'http://localhost/#other']) {
    assert.throws(() => localOrigin(url));
  }
});

test('restore covers exact outputs and maps reordered response pairs by B_', () => {
  const {outputs, response, keys} = fixture();
  const expected = structuredClone(response.signatures);
  response.outputs.reverse();
  response.signatures.reverse();
  assert.deepEqual(verifyRestored(outputs, response, keys), expected);
});

test('missing, duplicate, substituted or incorrectly paired restore evidence is refused', () => {
  const mutations = [
    r => r.outputs.pop(),
    r => r.signatures.pop(),
    r => {r.outputs[1] = r.outputs[0];},
    r => {r.outputs[0].B_ = '02' + 'aa'.repeat(32);},
    r => {r.outputs[0].id = 'other';},
    r => {r.signatures[0].amount = 2;},
    r => {r.signatures[0].id = 'other';},
    r => {delete r.signatures[0].dleq;},
    r => {r.signatures[0].dleq.s = '00'.repeat(32);},
    r => r.signatures.reverse(),
  ];
  for (const mutate of mutations) {
    const {outputs, response, keys} = fixture();
    mutate(response);
    assert.throws(() => verifyRestored(outputs, response, keys));
  }
  const {outputs, response, keys} = fixture();
  assert.throws(() => verifyRestored([outputs[0], outputs[0]], response, keys));
});
