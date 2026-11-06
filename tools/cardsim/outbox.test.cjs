// node --test tools/cardsim/outbox.test.cjs
//
// ENG-819 (D175): the 2.2 card's GET_OUTBOX, read through the bridge and decoded by the portable relay
// (tools/assisted-relay/relay.js, required by path: without it this file fails, it does not skip). The fixture case
// always runs; the bridge cases need a running bridge and run only with CARDSIM_URL set (CI starts the jar first):
//
//   CARDSIM_URL=http://127.0.0.1:9876 node --test tools/cardsim/outbox.test.cjs
//
// Like client.test.cjs it resets the bridge: run the two one after the other (--test-concurrency=1), never at once.
//
// The bridge case also holds the recorded packet, tools/assisted-relay/fixtures/packet-2in2out-494.hex (a packet this
// test verified, written by it), to the bytes the simulator serves for the same payment. Four fields are the card's
// random draws and differ on every run of the bridge: the installation (drawn at install), the change's B_ (its nonce
// and blinding factor), and so the witness and the descriptor that sign over them. Every other byte, 301 of 494, must
// be the fixture's. ENG-820 builds on that file and never invents bytes. To write it again after a deliberate change to
// the packet: CARDSIM_URL=... OUTBOX_WRITE_FIXTURE=1 node --test tools/cardsim/outbox.test.cjs
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { CardSim, CardError, constants } = require("./client.cjs")
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
// the two pieces and the till's one output: real points, so the relay's point checks are met
const PIECES = [
  { keysetId: "00ad268c4d1f5826", amount: 8, nonce: "11".repeat(32), C: pointOf(11n) },
  { keysetId: "00ad268c4d1f5826", amount: 4, nonce: "22".repeat(32), C: pointOf(13n) },
]
const TILL = { amount: 8, B_: pointOf(17n) }
const CHANGE = 4
// the packet's layout (spec/APDU.md, GET_OUTBOX): the header less the mint, an input, an output, the two signatures
const SIZE = 89 + MINT.length + 1 + 2 * 83 + 1 + 2 * 46 + 64 + 64

// the packet's random fields: [from, to) (the installation, the change's B_, the witness, the descriptor)
const OUTPUTS_AT = 89 + MINT.length + 1 + 2 * 83 + 1
const RANDOM = [[40, 72], [OUTPUTS_AT + 46 + 13, OUTPUTS_AT + 2 * 46], [SIZE - 128, SIZE - 64], [SIZE - 64, SIZE]]
const masked = packet => {
  const m = Buffer.from(packet)
  for (const [from, to] of RANDOM) m.fill(0, from, to)
  return m
}

function policyOf(packet, cardKey) {
  return { mint: MINT, cardKey, installation: Buffer.from(packet.subarray(40, 72)).toString("hex") }
}

function assertPayment(p, { cardKey, signature, change }) {
  assert.equal(p.mint, MINT)
  assert.equal(p.cardKey, cardKey)
  assert.equal(p.index, 0)
  assert.equal(p.paymentId, "1", "the first payment's receipt count")
  assert.equal(p.generation, 1, "a card that has never been reset")
  assert.deepEqual(p.inputs.map(i => [i.slot, i.generation, i.amount, i.id, i.nonce, i.C]),
    PIECES.map((x, slot) => [slot, 1, x.amount, x.keysetId, x.nonce, x.C]))
  for (const i of p.inputs) assert.equal(i.secret, cc.cardSecret(i.nonce, cardKey), "the relay's secret is the card's")
  assert.deepEqual(p.outputs, [
    { amount: TILL.amount, id: PIECES[0].keysetId, B_: TILL.B_ },
    { amount: CHANGE, id: PIECES[0].keysetId, B_: change },
  ], "the till's output, then the card's change, both under the first input's keyset")
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
  assertPayment(p, { cardKey, change: p.outputs[1].B_ })
  assert.throws(() => decodePacket([...packet], { ...policyOf(packet, cardKey), mint: "https://other.test" }, crypto), /context/)
  const torn = Buffer.from(packet)
  torn[torn.length - 1] ^= 1
  assert.throws(() => decodePacket([...torn], policyOf(packet, cardKey), crypto), /signature/, "a descriptor byte changed")
})

const URL = process.env.CARDSIM_URL
const integration = { skip: URL ? false : "set CARDSIM_URL to run against a bridge" }

test("a 2-in/2-out payment on the bridge: GET_OUTBOX serves a packet relay.js decodes, its scope is the card's, and it is the recorded fixture byte for byte", integration, async () => {
  const sim = new CardSim(URL)
  await sim.waitReady()
  await sim.reset()
  await sim.fixture({ pin: "1234", mint: MINT, owner: true, proofs: PIECES })
  assert.deepEqual(await sim.select(), constants.VERSION)
  await assert.rejects(sim.getOutboxScope(), e => e instanceof CardError && e.sw === 0x6a88, "no record before a payment")
  await sim.verifyPin("1234")
  assert.equal(await sim.spendAllBegin([0, 1]), 12)
  await sim.spendAllOutputs([TILL])
  const change = cc.hexOf(await sim.spendAllChange(CHANGE))
  const { signature } = await sim.spendAllSign()
  const cardKey = cc.hexOf(await sim.getPubkey())

  // public: a new tap, the PIN not given
  await sim.select()
  const packet = await sim.getOutbox()
  assert.equal(packet.length, SIZE, "494 bytes: 255 and 239")
  const p = decodePacket([...packet], policyOf(packet, cardKey), crypto)
  assertPayment(p, { cardKey, signature: cc.hexOf(signature), change })
  assert.equal(p.scope, cc.hexOf(await sim.getOutboxScope()), "the relay's scope is the card's")
  assert.deepEqual(await sim.getOutbox(), packet, "a second read is the same bytes: the descriptor is kept")
  await sim.verifyPin("1234")
  assert.equal(cc.hexOf(await sim.spendAllAgain()), cc.hexOf(signature), "and SPEND_ALL_AGAIN's")

  if (process.env.OUTBOX_WRITE_FIXTURE === "1") fs.writeFileSync(FIXTURE, packet.toString("hex") + "\n")
  const recorded = Buffer.from(fs.readFileSync(FIXTURE, "utf8").trim(), "hex")
  assert.equal(recorded.length, packet.length)
  const fixed = RANDOM.reduce((n, [from, to]) => n - (to - from), SIZE)
  assert.equal(fixed, 301)
  assert.equal(masked(packet).toString("hex"), masked(recorded).toString("hex"),
    "the simulator serves the recorded fixture, byte for byte but for the card's random draws")
})
