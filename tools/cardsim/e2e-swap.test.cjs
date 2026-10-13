// node --test tools/cardsim/e2e-swap.test.cjs
//
// The 2.0 card against a real mint (DECISIONS D18; the architect's decision 6): pieces minted at a Nutshell mint,
// format-4 SIG_ALL secrets locked to the card's key, their DLEQ checked; loaded with the mint's proof; paid with one
// card signature over the inputs, a till's outputs and the card's own change; the swap accepted by the mint; the
// change unblinded, checked and loaded back. Runs only with both a bridge and a mint, and the keyset the mint is
// expected to use, which the test asserts rather than accepts (the architect's decision 6: prove the keyset-id length
// forge's active keyset uses):
//
//   EXPECT_KEYSET_ID_BYTES   8 or 33: the length of the mint's active sat keyset id (required)
//   EXPECT_INPUT_FEE_PPK     that keyset's input_fee_ppk (optional; asserted when given)
//
// Forge's active sat keyset is 8 bytes (`00…`, a pre-v2 id) with input_fee_ppk 0 (GET /v1/keysets, 2026-10-12): a
// Nutshell 0.20.3 serving a keyset an older release made, which CI reproduces by making the keyset first as 0.19.2
// (VERSION=0.19.2) and then restarting plain 0.20.3 on the same database. A fresh 0.20.3 makes a 33-byte `01…` id with
// a fee of 100, and CI runs that too:
//
//   # forge's shape: 8-byte id, no fee
//   docker volume create nutv1
//   docker run -d --name nutv1 -p 127.0.0.1:3339:3338 -v nutv1:/app/data -e MINT_BACKEND_BOLT11_SAT=FakeWallet \
//     -e MINT_LISTEN_HOST=0.0.0.0 -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY -e MINT_INPUT_FEE_PPK=0 \
//     -e VERSION=0.19.2 cashubtc/nutshell:0.20.3 poetry run mint        # wait for /v1/keysets, then:
//   docker rm -f nutv1 && docker run -d --name nutv1 … (the same, without VERSION)
//   CARDSIM_URL=http://127.0.0.1:9876 MINT_URL=http://127.0.0.1:3339 EXPECT_KEYSET_ID_BYTES=8 EXPECT_INPUT_FEE_PPK=0 \
//     node --test tools/cardsim/e2e-swap.test.cjs
//
//   # a fresh 0.20.3: 33-byte id, fee 100
//   docker run -d -p 127.0.0.1:3338:3338 -e MINT_BACKEND_BOLT11_SAT=FakeWallet -e MINT_LISTEN_HOST=0.0.0.0 \
//     -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY cashubtc/nutshell:0.20.3 poetry run mint
//   CARDSIM_URL=http://127.0.0.1:9876 MINT_URL=http://127.0.0.1:3338 EXPECT_KEYSET_ID_BYTES=33 EXPECT_INPUT_FEE_PPK=100 \
//     node --test tools/cardsim/e2e-swap.test.cjs
//
// Nutshell 0.20.3 is the public release nearest forge's 0.20.3.1, the mint both apps pin. Zero dependencies: the
// Cashu arithmetic is cashu-crypto.cjs.
const test = require("node:test")
const assert = require("node:assert/strict")
const nodeCrypto = require("node:crypto")
const { CardSim, constants } = require("./client.cjs")
const cc = require("./cashu-crypto.cjs")

const CARDSIM = process.env.CARDSIM_URL
const MINT = process.env.MINT_URL
const run = { skip: CARDSIM && MINT ? false : "set CARDSIM_URL and MINT_URL to swap at a mint" }

/** The keyset shape the run must find, from EXPECT_KEYSET_ID_BYTES (8 or 33, required) and EXPECT_INPUT_FEE_PPK (optional). */
function expectedKeyset(env = process.env) {
  const bytes = Number(env.EXPECT_KEYSET_ID_BYTES)
  if (![8, 33].includes(bytes)) {
    throw new Error(`set EXPECT_KEYSET_ID_BYTES to 8 (forge's pre-v2 keyset) or 33 (a NUT-02 v2 keyset), got ${JSON.stringify(env.EXPECT_KEYSET_ID_BYTES)}`)
  }
  const fee = env.EXPECT_INPUT_FEE_PPK === undefined || env.EXPECT_INPUT_FEE_PPK === "" ? undefined : Number(env.EXPECT_INPUT_FEE_PPK)
  if (fee !== undefined && !(Number.isInteger(fee) && fee >= 0)) throw new Error(`EXPECT_INPUT_FEE_PPK must be a whole number, got ${env.EXPECT_INPUT_FEE_PPK}`)
  return { bytes, fee }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function mint(method, path, body) {
  const res = await fetch(MINT.replace(/\/+$/, "") + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`mint ${path} answered ${res.status}: ${text}`)
  return json
}

/** Powers of two that sum to n, largest first: how a mint's keys split an amount. */
function split(n) {
  const out = []
  for (let bit = 1 << 20; bit >= 1; bit >>= 1) if (n & bit) out.push(bit)
  return out
}

/** The full keyset id a card's 8 stored bytes name: the one keyset whose id begins with them, or a refusal (Foxy's rule). */
function expandKeyset(prefixHex, keysets) {
  const found = keysets.filter(k => k.id.toLowerCase().startsWith(prefixHex.toLowerCase()))
  if (found.length !== 1) throw new Error(`keyset prefix ${prefixHex} names ${found.length} keysets`)
  return found[0]
}

test("a SIG_ALL swap at a Nutshell mint: mint to the card with DLEQ, pay with one card signature and the card's own change, load the change back", run, async () => {
  const sim = new CardSim(CARDSIM, { timeoutMs: 15000 })
  await sim.waitReady()

  // the mint's active sat keyset, and the length of its id (8 bytes on older mints, 33 from NUT-02 v2)
  const expected = expectedKeyset()
  const { keysets } = await mint("GET", "/v1/keysets")
  const keyset = keysets.find(k => k.active && k.unit === "sat")
  assert.ok(keyset, "an active sat keyset")
  assert.equal(keyset.id.length / 2, expected.bytes, `the mint's active sat keyset id is ${expected.bytes} bytes (EXPECT_KEYSET_ID_BYTES), got ${keyset.id}`)
  assert.equal(keyset.id.slice(0, 2), expected.bytes === 8 ? "00" : "01", "a pre-v2 id begins 00, a v2 id 01")
  if (expected.fee !== undefined) assert.equal(keyset.input_fee_ppk || 0, expected.fee, "input_fee_ppk (EXPECT_INPUT_FEE_PPK)")
  console.log(`# mint keyset ${keyset.id} (${keyset.id.length / 2} bytes), input_fee_ppk ${keyset.input_fee_ppk || 0}`)
  const stored = keyset.id.slice(0, 16)
  assert.equal(expandKeyset(stored, keysets).id, keyset.id, "the card's 8 bytes name exactly this keyset")
  const keys = (await mint("GET", `/v1/keys/${keyset.id}`)).keysets[0].keys

  // a fresh card, set up as flash-mobile does it, and its key
  const { pubkey } = await sim.reset()
  await sim.fixture({ pin: "1234", mint: MINT, owner: true })

  // mint 64 sats to the card: format-4 SIG_ALL secrets locked to its key, each signature's DLEQ checked
  const quote = await mint("POST", "/v1/mint/quote/bolt11", { amount: 64, unit: "sat" })
  for (let i = 0; i < 50; i++) {
    const q = await mint("GET", `/v1/mint/quote/bolt11/${quote.quote}`)
    if (q.state === "PAID" || q.paid === true) break
    await sleep(200)
  }
  const amounts = [32, 16, 8, 4, 4]
  const blinded = amounts.map(amount => {
    const nonce = cc.hexOf(nodeCrypto.randomBytes(32))
    const secret = cc.cardSecret(nonce, pubkey)
    return { amount, nonce, secret, ...cc.blind(secret) }
  })
  const minted = await mint("POST", "/v1/mint/bolt11", {
    quote: quote.quote,
    outputs: blinded.map(b => ({ amount: b.amount, id: keyset.id, B_: cc.hexOf(b.B_) })),
  })
  const pieces = minted.signatures.map((sig, i) => {
    const b = blinded[i]
    const K = keys[String(sig.amount)]
    assert.ok(sig.dleq, "the mint gives NUT-12 proofs")
    assert.ok(cc.verifyBlindDleq(b.B_, sig.C_, sig.dleq.e, sig.dleq.s, K), `the mint's DLEQ for ${sig.amount}`)
    const C = cc.hexOf(cc.unblind(sig.C_, b.r, K))
    const r = cc.hexOf(cc.bytes32(b.r))
    assert.ok(cc.verifyProofDleq(b.secret, C, sig.dleq.e, sig.dleq.s, r, K), "the proof's DLEQ, as a later holder checks it")
    return { keysetId: stored, amount: sig.amount, nonce: b.nonce, C, dleq: { e: sig.dleq.e, s: sig.dleq.s, r } }
  })

  // onto the card, each with the mint's proof (LOAD_PROOF P1 = 1)
  const loaded = await sim.fixture({ proofs: pieces })
  assert.equal(loaded.balance, 64)

  // a reader checks each piece offline from what the card gives back: the nonce, C and the mint's proof
  for (const slot of loaded.slots.filter(s => s.status === "unspent")) {
    const secret = cc.cardSecret(slot.nonce, pubkey)
    const K = keys[String(slot.amount)]
    assert.ok(slot.dleq, `slot ${slot.slot} keeps its proof`)
    assert.ok(cc.verifyProofDleq(secret, slot.C, slot.dleq.e, slot.dleq.s, slot.dleq.r, K), `slot ${slot.slot}: real, by the mint's key`)
    assert.equal(slot.keysetId, stored)
  }

  // a till: pay 24 with the pieces of 32 and 16, its own outputs, the card's change, and the mint's fee
  const fee = Math.ceil(((keyset.input_fee_ppk || 0) * 2) / 1000)
  const price = 24
  const changeTotal = 48 - price - fee
  const tillOutputs = split(price).map(amount => {
    const secret = cc.hexOf(nodeCrypto.randomBytes(32))
    const b = cc.blind(secret)
    return { amount, secret, r: b.r, B_: cc.hexOf(b.B_) }
  })
  await sim.select()
  await sim.verifyPin("1234")
  assert.equal(await sim.spendAllBegin([0, 1]), 48)
  await sim.spendAllOutputs(tillOutputs.map(o => ({ amount: o.amount, B_: o.B_ })))
  const change = []
  for (const amount of split(changeTotal)) change.push({ amount, B_: cc.hexOf(await sim.spendAllChange(amount)) })
  const { signature } = await sim.spendAllSign()
  const inputs = loaded.slots.slice(0, 2).map(s => ({ amount: s.amount, secret: cc.cardSecret(s.nonce, pubkey), C: s.C }))
  const outputs = [...tillOutputs.map(o => ({ amount: o.amount, B_: o.B_ })), ...change]
  assert.ok(cc.schnorrVerify(Buffer.from(pubkey, "hex"), cc.sigAllMessage(inputs, outputs), signature), "one SIG_ALL signature, checked here first")

  // the swap: the signature is the first input's witness, the others carry none, the outputs in the order signed
  const swapped = await mint("POST", "/v1/swap", {
    inputs: inputs.map((p, i) => ({
      amount: p.amount, id: expandKeyset(stored, keysets).id, secret: p.secret, C: p.C,
      ...(i === 0 ? { witness: JSON.stringify({ signatures: [cc.hexOf(signature)] }) } : {}),
    })),
    outputs: outputs.map(o => ({ amount: o.amount, id: keyset.id, B_: o.B_ })),
  })
  assert.equal(swapped.signatures.length, outputs.length, "the mint signed every output")

  // the card's pieces are spent at the mint
  const ys = inputs.map(p => cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(p.secret, "utf8")))))
  const states = await mint("POST", "/v1/checkstate", { Ys: ys })
  assert.deepEqual(states.states.map(s => s.state), ["SPENT", "SPENT"])

  // the till's own pieces are real
  tillOutputs.forEach((o, i) => {
    const sig = swapped.signatures[i]
    assert.ok(cc.verifyBlindDleq(o.B_, sig.C_, sig.dleq.e, sig.dleq.s, keys[String(o.amount)]), `the till's ${o.amount}`)
  })

  // the change: unblinded with the openings the card kept, checked, and loaded back in the tap after the payment (no PIN)
  await sim.select()
  const openings = []
  for (let page = 0; ; page++) {
    const got = await sim.getChange(page)   // three openings to a page
    openings.push(...got)
    if (got.length < 3) break
  }
  assert.equal(openings.length, change.length)
  for (let i = 0; i < change.length; i++) {
    const sig = swapped.signatures[tillOutputs.length + i]
    const o = openings[i]
    const K = keys[String(o.amount)]
    assert.ok(cc.verifyBlindDleq(change[i].B_, sig.C_, sig.dleq.e, sig.dleq.s, K), "the change's DLEQ")
    const C = cc.hexOf(cc.unblind(sig.C_, Buffer.from(o.r, "hex"), K))
    const slot = await sim.loadProof(o.keysetId, o.amount, o.nonce, C, o.date, { e: sig.dleq.e, s: sig.dleq.s, r: o.r })
    assert.ok(slot < constants.MAX_PROOFS)
  }
  const after = await sim.state()
  assert.equal(after.balance, 64 - 48 + changeTotal, "the change is back on the card")
  assert.deepEqual(await sim.getChange(0), [], "and its openings let go")
})

test("the run names the keyset it expects: EXPECT_KEYSET_ID_BYTES is 8 or 33, and a fee is a whole number", () => {
  assert.deepEqual(expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "8", EXPECT_INPUT_FEE_PPK: "0" }), { bytes: 8, fee: 0 })
  assert.deepEqual(expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "33" }), { bytes: 33, fee: undefined })
  assert.throws(() => expectedKeyset({}), /EXPECT_KEYSET_ID_BYTES/)
  assert.throws(() => expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "16" }), /8 \(forge's pre-v2 keyset\) or 33/)
  assert.throws(() => expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "8", EXPECT_INPUT_FEE_PPK: "-1" }), /whole number/)
})
