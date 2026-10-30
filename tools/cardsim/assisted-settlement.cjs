/* Local-mint feasibility rehearsal for the signed-swap and restore path.
 * capture/relay/recover run as separate processes. Only capture/recover read
 * merchant openings; relay accepts the public signed swap alone. Restart the
 * isolated mint between relay and recover to test NUT-09 persistence.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {CardSim} = require('./client.cjs');
const cc = require('./cashu-crypto.cjs');

function localOrigin(value) {
  const u = new URL(value);
  assert.equal(u.protocol, 'http:');
  assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname), 'rehearsal requires a loopback mint/simulator');
  assert.ok(!u.username && !u.password && u.pathname === '/' && !u.search && !u.hash);
  return u.origin;
}
async function request(origin, route, body) {
  const r = await fetch(localOrigin(origin) + route, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'content-type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(`local mint ${route}: HTTP ${r.status}, code ${value.code ?? 'unknown'}`);
  return value;
}
const split = n => {
  const result = [];
  for (let amount = 1; amount <= n; amount *= 2) if (Math.floor(n / amount) % 2) result.push(amount);
  return result.reverse();
};
const newOutput = amount => {
  const secret = crypto.randomBytes(32).toString('hex');
  const b = cc.blind(secret);
  return {amount, secret, B_: cc.hexOf(b.B_), r: cc.hexOf(cc.bytes32(b.r))};
};
const yOf = p => cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(p.secret, 'utf8'))));

/** Restore arrays may be reordered, but must cover each distinct output exactly. */
function verifyRestored(outputs, response, keys) {
  assert.ok(outputs.length > 0 && outputs.length <= 128);
  assert.equal(new Set(outputs.map(o => o.B_)).size, outputs.length, 'outputs must be fresh and distinct');
  assert.equal(response.outputs.length, outputs.length, 'restore must cover every original output');
  assert.equal(response.signatures.length, outputs.length);
  const expected = new Map(outputs.map(o => [o.B_, o]));
  const verified = new Map();
  response.outputs.forEach((got, index) => {
    const want = expected.get(got.B_);
    assert.ok(want && !verified.has(got.B_), 'restore output unknown or duplicated');
    const sig = response.signatures[index];
    assert.equal(got.amount, want.amount);
    assert.equal(got.id, want.id);
    assert.equal(sig.amount, want.amount);
    assert.equal(sig.id, want.id);
    assert.ok(sig.dleq, 'restore must retain blinded DLEQ');
    assert.ok(cc.verifyBlindDleq(got.B_, sig.C_, sig.dleq.e, sig.dleq.s, keys[String(want.amount)]), 'restored DLEQ must verify');
    verified.set(got.B_, sig);
  });
  return outputs.map(o => verified.get(o.B_));
}
async function states(origin, inputs) {
  const Ys = inputs.map(yOf);
  const response = await request(origin, '/v1/checkstate', {Ys});
  assert.equal(response.states.length, Ys.length);
  const actual = new Map(response.states.map(s => [s.Y, s.state]));
  assert.equal(actual.size, Ys.length);
  return Ys.map(Y => {assert.ok(actual.has(Y)); return actual.get(Y);});
}
const save = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

async function capture(dir, mintOrigin, simOrigin) {
  mintOrigin = localOrigin(mintOrigin);
  simOrigin = localOrigin(simOrigin);
  fs.mkdirSync(dir, {mode: 0o700});
  const {keysets} = await request(mintOrigin, '/v1/keysets');
  const keyset = keysets.find(k => k.active && k.unit === 'sat');
  assert.ok(keyset);
  const keys = (await request(mintOrigin, `/v1/keys/${keyset.id}`)).keysets[0].keys;
  const sim = new CardSim(simOrigin);
  await sim.waitReady();
  const {pubkey} = await sim.reset();
  await sim.fixture({pin: '1234', mint: mintOrigin, owner: true});
  const quote = await request(mintOrigin, '/v1/mint/quote/bolt11', {amount: 12, unit: 'sat'});
  let paid = false;
  for (let i = 0; i < 100; i++) {
    const status = await request(mintOrigin, `/v1/mint/quote/bolt11/${quote.quote}`);
    if (status.state === 'PAID') {paid = true; break;}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(paid, 'test mint must use FakeWallet');
  const funding = [8, 4].map(amount => {
    const nonce = crypto.randomBytes(32).toString('hex');
    const secret = cc.cardSecret(nonce, pubkey);
    const b = cc.blind(secret);
    return {amount, nonce, secret, B_: cc.hexOf(b.B_), r: cc.hexOf(cc.bytes32(b.r))};
  });
  const fundingOutputs = funding.map(o => ({amount: o.amount, id: keyset.id, B_: o.B_}));
  const minted = await request(mintOrigin, '/v1/mint/bolt11', {quote: quote.quote, outputs: fundingOutputs});
  const signatures = verifyRestored(fundingOutputs, {outputs: fundingOutputs, signatures: minted.signatures}, keys);
  const proofs = funding.map((o, i) => ({keysetId: keyset.id.slice(0, 16), amount: o.amount, nonce: o.nonce,
    C: cc.hexOf(cc.unblind(signatures[i].C_, o.r, keys[String(o.amount)])),
    dleq: {...signatures[i].dleq, r: o.r}}));
  await sim.fixture({proofs});
  const inputs = funding.map((o, i) => ({amount: o.amount, id: keyset.id, secret: o.secret, C: proofs[i].C}));
  const feePpk = keyset.input_fee_ppk ?? 0;
  const merchantAmount = 12 - Math.ceil(feePpk * inputs.length / 1000);
  const openings = split(merchantAmount).map(newOutput);
  const outputs = openings.map(o => ({amount: o.amount, id: keyset.id, B_: o.B_}));
  // This survives a lost SIGN answer. Never put these openings in the relay packet.
  save(dir, 'merchant-prepared.json', {mintOrigin, pubkey, inputs, outputs, openings, merchantAmount, feePpk});
  await sim.select();
  await sim.verifyPin('1234');
  assert.equal(await sim.spendAllBegin([0, 1]), 12);
  await sim.spendAllOutputs(outputs);
  const {signature} = await sim.spendAllSign();
  const witness = cc.hexOf(signature);
  assert.ok(cc.schnorrVerify(pubkey, cc.sigAllMessage(inputs, outputs), witness));
  const packet = {kind: 'local-rehearsal-only', mintOrigin, pubkey,
    inputs: inputs.map((p, i) => ({...p, ...(i ? {} : {witness: JSON.stringify({signatures: [witness]})})})), outputs};
  save(dir, 'relay-packet.json', packet);
  assert.deepEqual(await states(mintOrigin, inputs), ['UNSPENT', 'UNSPENT']);
  console.log('Captured signed payment; both inputs remain unspent at the local mint.');
}

async function relay(dir) {
  const packet = read(dir, 'relay-packet.json'); // No merchant opening read.
  const witness = JSON.parse(packet.inputs[0].witness).signatures[0];
  assert.ok(cc.schnorrVerify(packet.pubkey, cc.sigAllMessage(packet.inputs, packet.outputs), witness));
  assert.deepEqual(await states(packet.mintOrigin, packet.inputs), ['UNSPENT', 'UNSPENT']);
  // Intentionally discard the successful response. Recovery must use NUT-09.
  await request(packet.mintOrigin, '/v1/swap', {inputs: packet.inputs, outputs: packet.outputs});
  const keys = (await request(packet.mintOrigin, `/v1/keys/${packet.outputs[0].id}`)).keysets[0].keys;
  const response = await request(packet.mintOrigin, '/v1/restore', {outputs: packet.outputs});
  verifyRestored(packet.outputs, response, keys);
  assert.deepEqual(await states(packet.mintOrigin, packet.inputs), ['SPENT', 'SPENT']);
  await assert.rejects(request(packet.mintOrigin, '/v1/swap', {inputs: packet.inputs, outputs: packet.outputs}));
  save(dir, 'relay-confirmed.json', {allInputsSpent: true, allOutputsRestorableWithDleq: true});
  console.log('Relay settled exact signed outputs without merchant secrets; lost-response restore and duplicate rejection passed.');
}

async function recover(dir) {
  const preparation = read(dir, 'merchant-prepared.json');
  const {mintOrigin, outputs, openings, feePpk, merchantAmount} = preparation;
  const keys = (await request(mintOrigin, `/v1/keys/${outputs[0].id}`)).keysets[0].keys;
  const response = await request(mintOrigin, '/v1/restore', {outputs});
  const signatures = verifyRestored(outputs, response, keys);
  const proofs = outputs.map((o, i) => ({id: o.id, amount: o.amount, secret: openings[i].secret,
    C: cc.hexOf(cc.unblind(signatures[i].C_, openings[i].r, keys[String(o.amount)]))}));
  assert.equal(proofs.reduce((n, p) => n + p.amount, 0), merchantAmount);
  if (fs.existsSync(path.join(dir, 'merchant-redeemed.json'))) {
    assert.deepEqual(await states(mintOrigin, proofs), proofs.map(() => 'SPENT'));
    console.log('Restore still returns already-redeemed outputs: issuance is not evidence for another merchant credit.');
    return;
  }
  assert.deepEqual(await states(mintOrigin, proofs), proofs.map(() => 'UNSPENT'));
  const fee = Math.ceil(feePpk * proofs.length / 1000);
  const recipients = split(merchantAmount - fee).map(newOutput);
  const payoutOutputs = recipients.map(o => ({amount: o.amount, id: outputs[0].id, B_: o.B_}));
  save(dir, 'merchant-redeem-intent.json', {proofs, recipients});
  const result = await request(mintOrigin, '/v1/swap', {inputs: proofs, outputs: payoutOutputs});
  verifyRestored(payoutOutputs, {outputs: payoutOutputs, signatures: result.signatures}, keys);
  save(dir, 'merchant-redeemed.json', {merchantAmount, redeemFee: fee, proceeds: merchantAmount - fee});
  console.log('Merchant recovered and redeemed every original output after process/mint restart.');
}

module.exports = {localOrigin, verifyRestored};
if (require.main === module) {
  const [action, dir, mintOrigin, simOrigin] = process.argv.slice(2);
  const actions = {capture: () => capture(dir, mintOrigin, simOrigin), relay: () => relay(dir), recover: () => recover(dir)};
  Promise.resolve().then(() => {assert.ok(actions[action] && dir); return actions[action]();})
    .catch(error => {console.error(error.message); process.exitCode = 1;});
}
