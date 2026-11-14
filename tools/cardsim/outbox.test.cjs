// node --test tools/cardsim/outbox.test.cjs
//
// ENG-819 (D175): the card's GET_OUTBOX, read through the bridge and decoded by the portable relay
// (tools/assisted-relay/relay.js, required by path: without it this file fails, it does not skip). The fixture case
// always runs; the bridge cases need a running bridge and run only with CARDSIM_URL set (CI starts the jar first):
//
//   CARDSIM_URL=http://127.0.0.1:9876 node --test tools/cardsim/outbox.test.cjs
//
// Like client.test.cjs it resets the bridge: run the two one after the other (--test-concurrency=1), never at once.
//
// The bridge case also holds the recorded packet, tools/assisted-relay/fixtures/packet-2in2out-494.hex (a packet this
// test verified, written by it), to the bytes the simulator serves for the same payment. On protocol 2.3 some fields
// differ on every run of the bridge or with the keyset the card was taught: the payment's key (the card's key for the
// date 0, P + t*G, whose t comes from the card's secret c, drawn at install), the installation (drawn at install), the
// keyset of each input and output (a keyset whose keys the test holds, so the card makes change in it), the change's B_
// (its nonce and blinding factor), and so the witness and the descriptor that sign over them. Every other byte, 236 of
// 494, must be the fixture's. ENG-820 builds on that file and never invents bytes. To write it again after a
// deliberate change to the packet: CARDSIM_URL=... OUTBOX_WRITE_FIXTURE=1 node --test tools/cardsim/outbox.test.cjs
//
// 2.3 says the scope (P1 0) and the packet (P1 1) in the time in the field that signed the payment, where the till that
// took it reads them; after the card has left the field (a fixture takes it out and back), the scope wants the PIN or
// the owner's grant and the packet the holder's say (the owner's grant on an owned card), 6982 otherwise.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { CardSim, CardError, constants, keysetId, keysetFromMint } = require("./client.cjs")
const cc = require("./cashu-crypto.cjs")
const { decodePacket } = require("../assisted-relay/relay.js")

const MINT = "https://mint.test"
const FIXTURE = path.join(__dirname, "..", "assisted-relay", "fixtures", "packet-2in2out-494.hex")
const crypto = {
  hash: b => [...cc.sha256(Buffer.from(b))],
  verify: (sig, msg, key) => cc.schnorrVerify(Buffer.from(key), Buffer.from(msg), Buffer.from(sig)),
  point: b => {
    try {
      return !!cc.point(Buffer.from(b))
    } catch {
      return false
    }
  },
}
const pointOf = k => cc.hexOf(cc.compressed(cc.mul(k)))
// a keyset the test holds the keys of, 1 to 8 (version 00), so that the card is taught it and makes its change in it
const KEYS = [1n, 2n, 4n, 8n].map((a, i) => [a, cc.compressed(cc.mul(BigInt(9100 + i)))])
const KEYSET = keysetFromMint({ id: keysetId(0, KEYS).toString("hex"), unit: "sat", keys: Object.fromEntries(KEYS.map(([a, k]) => [a.toString(), cc.hexOf(k)])) })
const KEYSET_HEX = KEYSET.keyset8.toString("hex")
// the two pieces and the till's one output: real points, so the relay's point checks are met
const PIECES = [
  { keysetId: KEYSET_HEX, amount: 8, nonce: "11".repeat(32), C: pointOf(11n) },
  { keysetId: KEYSET_HEX, amount: 4, nonce: "22".repeat(32), C: pointOf(13n) },
]
const TILL = { amount: 8, B_: pointOf(17n) }
const CHANGE = 4
// the packet's layout (spec/APDU.md, GET_OUTBOX): the header less the mint, an input, an output, the two signatures
const SIZE = 89 + MINT.length + 1 + 2 * 83 + 1 + 2 * 46 + 64 + 64

// the fields that differ from run to run, or with the keyset taught: [from, to) (the payment's key, the installation,
// each input's and output's keyset, the change's B_, the witness, the descriptor)
const INPUTS_AT = 89 + MINT.length + 1
const OUTPUTS_AT = INPUTS_AT + 2 * 83 + 1
const VARIES = [[7, 40], [40, 72],
  [INPUTS_AT + 10, INPUTS_AT + 18], [INPUTS_AT + 83 + 10, INPUTS_AT + 83 + 18],
  [OUTPUTS_AT + 5, OUTPUTS_AT + 13], [OUTPUTS_AT + 46 + 5, OUTPUTS_AT + 46 + 13],
  [OUTPUTS_AT + 46 + 13, OUTPUTS_AT + 2 * 46], [SIZE - 128, SIZE - 64], [SIZE - 64, SIZE]]
const masked = packet => {
  const m = Buffer.from(packet)
  for (const [from, to] of VARIES) m.fill(0, from, to)
  return m
}

function policyOf(packet, cardKey) {
  return { mint: MINT, cardKey, installation: Buffer.from(packet.subarray(40, 72)).toString("hex") }
}

function assertPayment(p, { cardKey, signature, change, keyset = PIECES[0].keysetId }) {
  assert.equal(p.mint, MINT)
  assert.equal(p.cardKey, cardKey)
  assert.equal(p.index, 0)
  assert.equal(p.paymentId, "1", "the first payment's receipt count")
  assert.equal(p.generation, 1, "a card that has never been reset")
  assert.deepEqual(p.inputs.map(i => [i.slot, i.generation, i.amount, i.id, i.nonce, i.C]),
    PIECES.map((x, slot) => [slot, 1, x.amount, keyset, x.nonce, x.C]))
  for (const i of p.inputs) assert.equal(i.secret, cc.cardSecret(i.nonce, cardKey), "the relay's secret is the card's")
  assert.deepEqual(p.outputs, [
    { amount: TILL.amount, id: keyset, B_: TILL.B_ },
    { amount: CHANGE, id: keyset, B_: change },
  ], "the till's output under the first input's keyset (no keyset named), then the card's change under the one SPEND_ALL_CHANGE named")
  if (signature) assert.equal(p.witness, signature, "the witness is the payment's signature")
  assert.equal(p.paymentMessage, cc.hexOf(cc.sigAllMessage(
    p.inputs.map(i => ({ secret: i.secret, C: i.C })), p.outputs.map(o => ({ amount: o.amount, B_: o.B_ })))),
  "and it is over the SIG_ALL message of these inputs and outputs")
}

test("the recorded 2-in/2-out packet decodes with the relay: 494 bytes, both signatures the card key's", () => {
  const packet = Buffer.from(fs.readFileSync(FIXTURE, "utf8").trim(), "hex")
  assert.equal(packet.length, SIZE)
  assert.equal(SIZE, 494)
  const cardKey = packet.subarray(7, 40).toString("hex")
  const p = decodePacket([...packet], policyOf(packet, cardKey), crypto)
  assertPayment(p, { cardKey, change: p.outputs[1].B_, keyset: p.inputs[0].id })
  assert.throws(() => decodePacket([...packet], { ...policyOf(packet, cardKey), mint: "https://other.test" }, crypto), /context/)
  const torn = Buffer.from(packet)
  torn[torn.length - 1] ^= 1
  assert.throws(() => decodePacket([...torn], policyOf(packet, cardKey), crypto), /signature/, "a descriptor byte changed")
})

const URL = process.env.CARDSIM_URL
const integration = { skip: URL ? false : "set CARDSIM_URL to run against a bridge" }

test("a 2-in/2-out payment on the bridge: GET_OUTBOX serves a packet relay.js decodes, under the card's key for the date 0, its scope is the card's, and it is the recorded fixture byte for byte but for what varies", integration, async () => {
  const sim = new CardSim(URL)
  await sim.waitReady()
  await sim.reset()
  await sim.fixture({ pin: "1234", mint: MINT, owner: true, proofs: PIECES })
  assert.deepEqual(await sim.select(), constants.VERSION)
  // GET_OUTBOX asks who is reading before it looks for a record: a stranger is told 6982 whether one is kept or not
  await assert.rejects(sim.getOutboxScope(), e => e instanceof CardError && e.sw === 0x6982, "a stranger before a payment: 6982")
  await sim.verifyPin("1234")
  await assert.rejects(sim.getOutboxScope(), e => e instanceof CardError && e.sw === 0x6a88, "the PIN before a payment: no record, 6A88")
  await sim.teachKeyset(KEYSET)
  const begun = await sim.spendAllBegin([0, 1])
  assert.equal(begun.total, 12)
  await sim.spendAllOutputs([TILL])
  const change = cc.hexOf(await sim.spendAllChange(CHANGE, KEYSET.keys[2][1], KEYSET.keyset8))
  const { signature } = await sim.spendAllSign()
  const P = cc.hexOf(await sim.getPubkey())
  const cardKey = cc.hexOf(cc.tweakedKey(P, begun.t))

  // the time in the field that signed the payment: a new tap, the PIN not given, still the paying till's
  await sim.select()
  const packet = await sim.getOutbox()
  assert.equal(packet.length, SIZE, "494 bytes: 255 and 239")
  assert.equal(cc.hexOf(packet.subarray(7, 40)), cardKey, "the packet names the card's key for the date 0, P + t*G")
  assert.notEqual(cardKey, P, "never the card's key P")
  const p = decodePacket([...packet], policyOf(packet, cardKey), crypto)
  assertPayment(p, { cardKey, signature: cc.hexOf(signature), change })
  assert.equal(p.scope, cc.hexOf(await sim.getOutboxScope()), "the relay's scope is the card's")
  assert.deepEqual(await sim.getOutbox(), packet, "a second read is the same bytes: the descriptor is kept")

  // out of the field and back (a fixture ends so): the scope wants the PIN or the grant, the packet the holder's say
  await sim.fixture({})
  await assert.rejects(sim.getOutboxScope(), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "a stranger is not told where the card last paid")
  await sim.verifyPin("1234")
  assert.equal(cc.hexOf(await sim.getOutboxScope()), p.scope, "the PIN: the scope")
  await assert.rejects(sim.getOutboxPage(0), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "the PIN alone is not the owner's say")
  await sim.allowLoad()
  assert.deepEqual(await sim.getOutbox(), packet, "the owner's grant: the packet")
  assert.equal(cc.hexOf(await sim.spendAllAgain()), cc.hexOf(signature), "and SPEND_ALL_AGAIN's")

  if (process.env.OUTBOX_WRITE_FIXTURE === "1") fs.writeFileSync(FIXTURE, packet.toString("hex") + "\n")
  const recorded = Buffer.from(fs.readFileSync(FIXTURE, "utf8").trim(), "hex")
  assert.equal(recorded.length, packet.length)
  const fixed = VARIES.reduce((n, [from, to]) => n - (to - from), SIZE)
  assert.equal(fixed, 236)
  assert.equal(masked(packet).toString("hex"), masked(recorded).toString("hex"),
    "the simulator serves the recorded fixture, byte for byte but for what varies")
})
