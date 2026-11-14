// node --test tools/cardsim/e2e-swap.test.cjs
//
// The 3.0 card against a real mint (DECISIONS D18, D183, D190, D197): the card set up as a wallet sets it up (the PIN,
// the record, the owner's claim); the card's key for the date 0 read under the PIN (GROUP_KEYS); pieces minted at a
// Nutshell mint as format-4 SIG_ALL secrets locked to that key, their DLEQ checked; loaded under the PIN with the
// mint's proof; the mint's keyset taught to the card (KEYSET_KEYS), checked by the card against its ID; paid with one
// card signature by that key over the inputs, a till's outputs and the card's own change, bound to the mint's key; the
// swap accepted by the mint; then, in a new tap with no PIN, each opening's key shown in the keyset's tree and the
// mint's answer handed to LOAD_CHANGE, which checks its DLEQ and unblinds it on the card. The change is asked for only
// after the mint's /v1/info says NUT-12 and NUT-09 (a mint with no DLEQ would burn the inputs and answer change nobody
// can load). The same round runs again with dated pieces (D197): locked to the card's key for a date 30 days ahead,
// with that date as their NUT-11 locktime and the date's refund key R + u*G, paid and their dated change loaded back.
// And the refund: a card with a refund key R and no owner, c read sealed to R under the PIN and opened with r, pieces
// of a date already past loaded and never paid, then taken back at the mint by r + u alone (the signature of the
// date's refund key over the SIG_ALL message), as a wallet that kept c with r takes back a lost card's pieces; the
// mint is also shown to refuse that key before the date, and r without u. Runs only with both a bridge and a mint,
// and the keyset the mint is expected to use, which the test asserts rather than accepts (the architect's decision 6:
// prove the keyset-id length forge's active keyset uses):
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
const { CardSim, constants, keysetFromMint } = require("./client.cjs")
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

/** The mint's active sat keyset, asserted against EXPECT_KEYSET_ID_BYTES and EXPECT_INPUT_FEE_PPK, with its keys and as KEYSET_KEYS teaches it. */
async function activeKeyset() {
  const expected = expectedKeyset()
  const { keysets } = await mint("GET", "/v1/keysets")
  const keyset = keysets.find(k => k.active && k.unit === "sat")
  assert.ok(keyset, "an active sat keyset")
  assert.equal(keyset.id.length / 2, expected.bytes, `the mint's active sat keyset id is ${expected.bytes} bytes (EXPECT_KEYSET_ID_BYTES), got ${keyset.id}`)
  assert.equal(keyset.id.slice(0, 2), expected.bytes === 8 ? "00" : "01", "a pre-v2 id begins 00, a v2 id 01")
  if (expected.fee !== undefined) assert.equal(keyset.input_fee_ppk || 0, expected.fee, "input_fee_ppk (EXPECT_INPUT_FEE_PPK)")
  const stored = keyset.id.slice(0, 16)
  assert.equal(expandKeyset(stored, keysets).id, keyset.id, "the card's 8 bytes name exactly this keyset")
  const served = (await mint("GET", `/v1/keys/${keyset.id}`)).keysets[0]
  // the keyset as KEYSET_KEYS teaches it, its keys checked against its ID here first (the fee is in a v2 ID's tail)
  const ks = keysetFromMint(served, { inputFeePpk: keyset.input_fee_ppk || 0, finalExpiry: keyset.final_expiry === null ? undefined : keyset.final_expiry })
  assert.equal(ks.id.toString("hex"), keyset.id)
  return { keyset, keysets, keys: served.keys, ks, stored, fee: n => Math.ceil(((keyset.input_fee_ppk || 0) * n) / 1000) }
}

/**
 * Pieces minted to the card at the mint: format-4 SIG_ALL secrets naming `key` (the card's key for `date`, P + t*G) and,
 * for a dated piece, the date's refund key (its locktime is the date), each signature's DLEQ checked. Answers the pieces
 * as a /fixture takes them, with their secrets.
 */
async function mintToCard({ keyset, keys, stored }, amounts, key, date = 0, refund = null) {
  const quote = await mint("POST", "/v1/mint/quote/bolt11", { amount: amounts.reduce((a, b) => a + b, 0), unit: "sat" })
  for (let i = 0; i < 50; i++) {
    const q = await mint("GET", `/v1/mint/quote/bolt11/${quote.quote}`)
    if (q.state === "PAID" || q.paid === true) break
    await sleep(200)
  }
  const blinded = amounts.map(amount => {
    const nonce = cc.hexOf(nodeCrypto.randomBytes(32))
    const secret = cc.cardSecret(nonce, key, date, refund)
    return { amount, nonce, secret, ...cc.blind(secret) }
  })
  const minted = await mint("POST", "/v1/mint/bolt11", {
    quote: quote.quote,
    outputs: blinded.map(b => ({ amount: b.amount, id: keyset.id, B_: cc.hexOf(b.B_) })),
  })
  return minted.signatures.map((sig, i) => {
    const b = blinded[i]
    const K = keys[String(sig.amount)]
    assert.ok(sig.dleq, "the mint gives NUT-12 proofs")
    assert.ok(cc.verifyBlindDleq(b.B_, sig.C_, sig.dleq.e, sig.dleq.s, K), `the mint's DLEQ for ${sig.amount}`)
    const C = cc.hexOf(cc.unblind(sig.C_, b.r, K))
    const r = cc.hexOf(cc.bytes32(b.r))
    assert.ok(cc.verifyProofDleq(b.secret, C, sig.dleq.e, sig.dleq.s, r, K), "the proof's DLEQ, as a later holder checks it")
    return { keysetId: stored, amount: sig.amount, nonce: b.nonce, C, date, dleq: { e: sig.dleq.e, s: sig.dleq.s, r }, secret: b.secret }
  })
}

/** Fresh outputs for a wallet or a till: plain secrets, blinded, that split `total` as the mint's keys do. */
function plainOutputs(total) {
  return split(total).map(amount => {
    const secret = cc.hexOf(nodeCrypto.randomBytes(32))
    const b = cc.blind(secret)
    return { amount, secret, r: b.r, B_: cc.hexOf(b.B_) }
  })
}

const ys = secrets => secrets.map(secret => cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(secret, "utf8")))))

/**
 * The reader's rule before it asks the card for change: the mint's GET /v1/info says NUT-12 (the DLEQ that LOAD_CHANGE
 * needs: without it the change can never be loaded, and the inputs are spent) and NUT-09 (restore, the way back to a
 * swap answer lost on its way). tools/cardctl's check_change_mint is the same rule.
 */
async function assertMintGivesChangeBack() {
  const info = await mint("GET", "/v1/info")
  for (const nut of ["12", "9"]) assert.equal(info.nuts?.[nut]?.supported, true, `the mint's /v1/info says NUT-${nut}: only then is the card asked for change`)
  return info
}

/**
 * The card set up as a wallet sets it up, pieces minted to its key for `date` and loaded under the PIN, the mint's keyset
 * taught, a payment with a till's outputs and the card's own change, the swap at the mint, and the change loaded back
 * with LOAD_CHANGE in a new tap with no PIN. A dated payment (date not 0) needs a refund key on the card: its pieces and
 * its change carry the date as their locktime and the date's refund key.
 */
async function payAtMint({ date = 0 } = {}) {
  const sim = new CardSim(CARDSIM, { timeoutMs: 15000 })
  await sim.waitReady()

  // the mint's active sat keyset, and the length of its id (8 bytes on older mints, 33 from NUT-02 v2)
  const mk = await activeKeyset()
  const { keyset, keysets, keys, ks, stored } = mk
  console.log(`# mint keyset ${keyset.id} (${keyset.id.length / 2} bytes), input_fee_ppk ${keyset.input_fee_ppk || 0}, date ${date}`)

  // a fresh card, set up as a wallet sets it up: the PIN, the record (with a refund key for dated pieces) and the owner's claim
  const { pubkey: P } = await sim.reset()
  const R = date ? cc.compressed(cc.mul(cc.int(nodeCrypto.randomBytes(32)) % cc.N || 1n)) : null
  await sim.fixture({ pin: "1234", mint: MINT, ...(R ? { refundKey: cc.hexOf(R) } : {}), owner: true })
  // the card's key for the date, under the PIN: what the pieces are locked to, never P
  await sim.select()
  await sim.verifyPin("1234")
  const { t, key, refund } = await sim.groupKeys(date)
  assert.equal(cc.hexOf(cc.tweakedKey(P, t)), cc.hexOf(key), "GROUP_KEYS answers P + t*G")
  if (date) assert.ok(refund.some(b => b !== 0), "a dated piece names the date's refund key R + u*G")
  else assert.deepEqual(refund, Buffer.alloc(33), "an undated piece names no refund key")

  // mint 64 sats to the card: format-4 SIG_ALL secrets locked to its key for the date, each signature's DLEQ checked
  const pieces = await mintToCard(mk, [32, 16, 8, 4, 4], key, date, date ? refund : null)
  if (date) assert.ok(pieces[0].secret.includes(`["locktime","${date}"],["refund","${cc.hexOf(refund)}"]`), "the date is the pieces' NUT-11 locktime")

  // onto the card under the PIN (P2 02, the word on keys per load), each with the mint's proof (P1 1)
  const loaded = await sim.fixture({ pin: "1234", proofs: pieces.map(({ secret, ...p }) => p) })
  assert.equal(loaded.balance, 64)

  // a reader checks each piece offline from what the card gives back: the nonce, C and the mint's proof
  for (const slot of loaded.slots.filter(s => s.status === "unspent")) {
    const secret = cc.cardSecret(slot.nonce, key, slot.date, date ? refund : null)
    const K = keys[String(slot.amount)]
    assert.equal(slot.date, date, `slot ${slot.slot} keeps its date`)
    assert.ok(slot.dleq, `slot ${slot.slot} keeps its proof`)
    assert.ok(cc.verifyProofDleq(secret, slot.C, slot.dleq.e, slot.dleq.s, slot.dleq.r, K), `slot ${slot.slot}: real, by the mint's key`)
    assert.equal(slot.keysetId, stored)
  }

  // the holder's phone teaches the card the mint's keyset (the PIN in the tap): change is made only in a taught one
  await sim.select()
  await sim.verifyPin("1234")
  await assert.rejects(
    (async () => { await sim.spendAllBegin([0, 1]); await sim.spendAllChange(16, keys["16"], ks.keyset8) })(),
    e => e.sw === constants.SW.KEYS_NOT_SHOWN, "a keyset not taught: no change in it (6A9F)")
  assert.deepEqual(await sim.teachKeyset(ks), ks.id, "the card works out the keyset's ID from its keys")

  // a till: pay 24 with the pieces of 32 and 16, its own outputs, the card's change bound to the mint's keys, and the fee
  const fee = mk.fee(2)
  const price = 24
  const changeTotal = 48 - price - fee
  const tillOutputs = plainOutputs(price)
  const begun = await sim.spendAllBegin([0, 1])
  assert.equal(begun.total, 48)
  assert.deepEqual(begun.t, t, `the payment's date is ${date}: the t GROUP_KEYS answered`)
  assert.deepEqual(begun.refund, refund, "and its refund key")
  const paymentKey = cc.tweakedKey(P, begun.t)
  await sim.spendAllOutputs(tillOutputs.map(o => ({ amount: o.amount, B_: o.B_ })), ks.keyset8)
  // the card's change is asked for only at a mint that gives it back (NUT-12 and NUT-09)
  await assertMintGivesChangeBack()
  const change = []
  for (const amount of split(changeTotal)) change.push({ amount, B_: cc.hexOf(await sim.spendAllChange(amount, keys[String(amount)], ks.keyset8)) })
  const { signature } = await sim.spendAllSign()
  const inputs = loaded.slots.slice(0, 2).map(s => ({ amount: s.amount, secret: cc.cardSecret(s.nonce, paymentKey, date, date ? begun.refund : null), C: s.C }))
  const outputs = [...tillOutputs.map(o => ({ amount: o.amount, B_: o.B_ })), ...change]
  assert.ok(cc.verifyPayment(paymentKey, inputs, outputs, signature), "one SIG_ALL signature by P + t*G, checked here first")
  assert.ok(!cc.schnorrVerify(P, cc.sigAllMessage(inputs, outputs), signature), "and not by P")

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
  const states = await mint("POST", "/v1/checkstate", { Ys: ys(inputs.map(p => p.secret)) })
  assert.deepEqual(states.states.map(s => s.state), ["SPENT", "SPENT"])

  // the till's own pieces are real
  tillOutputs.forEach((o, i) => {
    const sig = swapped.signatures[i]
    assert.ok(cc.verifyBlindDleq(o.B_, sig.C_, sig.dleq.e, sig.dleq.s, keys[String(o.amount)]), `the till's ${o.amount}`)
  })

  // the change, in a new tap with no PIN: each opening (no blinding factor in it), its key shown in the keyset's tree,
  // then the mint's answer, which the card checks (DLEQ) and unblinds itself
  await sim.select()
  const openings = await sim.owedChange()
  assert.equal(openings.length, change.length)
  for (let i = 0; i < change.length; i++) {
    const sig = swapped.signatures[tillOutputs.length + i]
    const o = openings.find(x => x.B_ === change[i].B_)
    assert.ok(o, `the opening of the change's ${change[i].amount}`)
    assert.equal(o.K, keys[String(o.amount)], "bound to the mint's key for its amount")
    assert.equal(o.keysetId, stored)
    assert.equal(o.date, date, "the change is of the payment's date")
    assert.ok(sig.dleq, "the mint's answer for the change carries its DLEQ: without it the change could never be loaded")
    assert.ok(cc.verifyBlindDleq(o.B_, sig.C_, sig.dleq.e, sig.dleq.s, o.K), "the change's DLEQ, checked here too")
    await sim.showOpeningKey(o, ks)
    const got = await sim.loadChange(o.number, sig.C_, o.K, sig.dleq.e, sig.dleq.s)
    assert.equal(got.piece.amount, o.amount)
    assert.equal(got.piece.keysetId, stored)
    assert.equal(got.piece.date, date)
    assert.equal(got.proofKept, true)
    // the piece is the card's own: its secret names the payment's key (and a dated one the date's refund key), and the
    // proof it kept holds as a wallet checks it
    const secret = cc.cardSecret(got.piece.nonce, paymentKey, got.piece.date, date ? begun.refund : null)
    const dleq = await sim.getDleq(got.slot)
    assert.ok(cc.verifyProofDleq(secret, got.piece.C, dleq.subarray(1, 33), dleq.subarray(33, 65), dleq.subarray(65, 97), o.K), "the change piece is real, by the mint's key")
    const [state] = (await mint("POST", "/v1/checkstate", { Ys: ys([secret]) })).states
    assert.equal(state.state, "UNSPENT", "and unspent at the mint")
  }
  const after = await sim.state()
  assert.equal(after.balance, 64 - 48 + changeTotal, "the change is back on the card")
  assert.deepEqual(await sim.owedChange(), [], "and its openings let go")
}

test("a SIG_ALL swap at a Nutshell mint: mint to the card's key for the date 0 with DLEQ, load under the PIN, teach the keyset, pay with one card signature and the card's own change, load the change back with LOAD_CHANGE", run, async () => {
  await payAtMint({ date: 0 })
})

test("a dated payment at a Nutshell mint: pieces locked to the card's key for a date 30 days ahead, with that date as their locktime and the date's refund key, loaded under the PIN, paid through SPEND_ALL_*, the swap accepted, the dated change loaded back", run, async () => {
  // a wallet picks D in the future, at least 8 days past its first load of the week (spec/APDU.md, The load date)
  await payAtMint({ date: Math.floor(Date.now() / 1000) + 30 * 86400 })
})

/** A wallet's swap of pieces by the refund key's signature alone, over the SIG_ALL message: what the mint answers. */
async function refundSwap(mk, pieces, priv) {
  const total = pieces.reduce((a, p) => a + p.amount, 0)
  const outputs = plainOutputs(total - mk.fee(pieces.length))
  const inputs = pieces.map(p => ({ amount: p.amount, secret: p.secret, C: p.C }))
  const signature = cc.schnorrSign(priv, cc.sigAllMessage(inputs, outputs))
  const body = {
    inputs: inputs.map((p, i) => ({
      amount: p.amount, id: mk.keyset.id, secret: p.secret, C: p.C,
      ...(i === 0 ? { witness: JSON.stringify({ signatures: [cc.hexOf(signature)] }) } : {}),
    })),
    outputs: outputs.map(o => ({ amount: o.amount, id: mk.keyset.id, B_: o.B_ })),
  }
  return { outputs, body }
}

test("the refund key at a Nutshell mint: a lost card's dated pieces, past their date, taken back by r + u alone, as a wallet that kept c with r; refused before the date, and refused to r without u", run, async () => {
  const sim = new CardSim(CARDSIM, { timeoutMs: 15000 })
  await sim.waitReady()
  const mk = await activeKeyset()

  // a card with a refund key R and no owner: the wallet keeps r, and reads c sealed to R under the PIN (GET_CARD P1 3)
  const r = cc.int(nodeCrypto.randomBytes(32)) % cc.N || 1n
  const R = cc.compressed(cc.mul(r))
  const { pubkey: P } = await sim.reset()
  await sim.fixture({ pin: "1234", mint: MINT, refundKey: cc.hexOf(R) })
  const now = Math.floor(Date.now() / 1000)
  const past = now - 86400 // a day ago: the refund key spends from D
  const ahead = now + 30 * 86400
  await sim.select()
  await sim.verifyPin("1234")
  const keysPast = await sim.groupKeys(past)
  const keysAhead = await sim.groupKeys(ahead)
  const { nonce } = await sim.getNonce(1)
  const c = cc.openCardSecret(await sim.getCardSecret(), nonce, r)
  for (const [date, k] of [[past, keysPast], [ahead, keysAhead]]) {
    const mine = cc.dateKeys(c, P, R, date)
    assert.deepEqual([cc.hexOf(mine.t), cc.hexOf(mine.key), cc.hexOf(mine.refund)], [cc.hexOf(k.t), cc.hexOf(k.key), cc.hexOf(k.refund)],
      `the date ${date}'s keys worked out from c and R are the ones GROUP_KEYS answers`)
  }
  const refundPriv = date => (r + cc.dateTweak(cc.LABEL_REFUND_KEY, c, date)) % cc.N
  assert.equal(cc.hexOf(cc.compressed(cc.mul(refundPriv(past)))), cc.hexOf(keysPast.refund), "r + u is the private key of R + u*G")

  // pieces of a date already past, minted to the card and loaded; then the card is lost, and none was paid
  const pieces = await mintToCard(mk, [16, 8, 8], keysPast.key, past, keysPast.refund)
  const loaded = await sim.fixture({ pin: "1234", proofs: pieces.map(({ secret, ...p }) => p) })
  assert.equal(loaded.balance, 32)
  // and one of a date 30 days ahead, whose refund is not open yet
  const early = await mintToCard(mk, [8], keysAhead.key, ahead, keysAhead.refund)

  // the refund key before the piece's date: the mint holds to the locktime
  const before = await refundSwap(mk, early, refundPriv(ahead))
  await assert.rejects(mint("POST", "/v1/swap", before.body), e => (console.log(`# before the date: ${e.message}`), /answered 400/.test(e.message)),
    "the refund key spends nothing before the piece's date")
  // r alone, without the date's u: not the key the secret names
  const bare = await refundSwap(mk, pieces, r)
  await assert.rejects(mint("POST", "/v1/swap", bare.body), e => (console.log(`# r without u: ${e.message}`), /answered 400/.test(e.message)),
    "r alone is not the date's refund key")
  const unspent = await mint("POST", "/v1/checkstate", { Ys: ys([...pieces, ...early].map(p => p.secret)) })
  assert.deepEqual(unspent.states.map(s => s.state), ["UNSPENT", "UNSPENT", "UNSPENT", "UNSPENT"], "neither refusal spent anything")

  // the refund: r + u for the past date, one SIG_ALL signature as the first input's witness, the wallet's own outputs
  const { outputs, body } = await refundSwap(mk, pieces, refundPriv(past))
  const swapped = await mint("POST", "/v1/swap", body)
  assert.equal(swapped.signatures.length, outputs.length, "the mint signed every output")
  const spent = await mint("POST", "/v1/checkstate", { Ys: ys(pieces.map(p => p.secret)) })
  assert.deepEqual(spent.states.map(s => s.state), ["SPENT", "SPENT", "SPENT"], "the lost card's pieces are spent at the mint")
  // the wallet's new pieces are real (the mint's DLEQ) and unspent: the value came back
  const fresh = outputs.map((o, i) => {
    const sig = swapped.signatures[i]
    const K = mk.keys[String(o.amount)]
    assert.ok(sig.dleq && cc.verifyBlindDleq(o.B_, sig.C_, sig.dleq.e, sig.dleq.s, K), `the refund's ${o.amount}`)
    return { amount: o.amount, secret: o.secret, C: cc.hexOf(cc.unblind(sig.C_, o.r, K)) }
  })
  assert.equal(fresh.reduce((a, p) => a + p.amount, 0), 32 - mk.fee(pieces.length))
  const back = await mint("POST", "/v1/checkstate", { Ys: ys(fresh.map(p => p.secret)) })
  assert.ok(back.states.every(s => s.state === "UNSPENT"), "the wallet's pieces are unspent")
  console.log(`# refunded ${32 - mk.fee(pieces.length)} of 32 (fee ${mk.fee(pieces.length)}) by R + u*G for the date ${past}`)
})

test("the run names the keyset it expects: EXPECT_KEYSET_ID_BYTES is 8 or 33, and a fee is a whole number", () => {
  assert.deepEqual(expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "8", EXPECT_INPUT_FEE_PPK: "0" }), { bytes: 8, fee: 0 })
  assert.deepEqual(expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "33" }), { bytes: 33, fee: undefined })
  assert.throws(() => expectedKeyset({}), /EXPECT_KEYSET_ID_BYTES/)
  assert.throws(() => expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "16" }), /8 \(forge's pre-v2 keyset\) or 33/)
  assert.throws(() => expectedKeyset({ EXPECT_KEYSET_ID_BYTES: "8", EXPECT_INPUT_FEE_PPK: "-1" }), /whole number/)
})
