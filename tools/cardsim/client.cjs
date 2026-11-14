"use strict"
/*
 * client.cjs — zero-dependency Node client for the cardsim bridge, protocol 3.0.
 *
 *   const { CardSim, CardError, encode, constants } = require("./client.cjs")
 *   const sim = new CardSim()                       // http://127.0.0.1:9876
 *   await sim.waitReady()
 *   await sim.reset()                               // fresh card; same card key P every time (see below)
 *   await sim.fixture({ pin: "1234", mint, owner: true })     // the first set-up: PIN, record, the owner's claim
 *   await sim.select(); await sim.verifyPin("1234")
 *   const { key } = await sim.groupKeys(date)       // the card's key for that date, P + t*G: lock the pieces to it
 *   await sim.fixture({ pin: "1234", proofs: [...] })          // loads under the PIN, P2 02
 *
 * Node 18+ (global fetch, node:crypto). The helpers port tools/cardctl/cardctl.py's Card class: the same bytes on the
 * wire (asserted against test_apdu.py's vectors and the applet's recorded LOAD_CHANGE in client.test.cjs),
 * CardError(sw, context) on any status word but 9000, and the same argument checks before any transport. The pure
 * encoders are exported as `encode.*` for a fake NFC transport that needs the bytes without the HTTP, the owner's proof
 * as `ownerProof` (ECDSA P-256 with node:crypto), and a keyset's ID and tree as `keyset*` (KEYSET_KEYS).
 *
 * This file, the four routes and their bodies are the contract flash-pos and flash-mobile pin by CASHU_JAVACARD_REF.
 *
 * Protocol 3.0, in what a reader does (spec/APDU.md, "What 3.0 changes"):
 *   - Keys per load. Every piece is locked to the card's key for its date, P + t*G, never to the card's key P that
 *     GET_PUBKEY answers. A loader gets the key from GROUP_KEYS (the PIN in the tap) or works it out from c
 *     (cashu-crypto.dateKeys); LOAD_PROOF and LOAD_CHANGE carry the loader's word on it (P2 bit 1, 02). A till sends
 *     SPEND_ALL_BEGIN with P1 02 (03 when it reads units) and is answered the pieces' worth, t and the date's refund
 *     key; it builds the secrets with P + t*G.
 *   - PIN before money. A card with no PIN takes and pays nothing (6A97). Every LOAD_PROOF and CLEAR_SPENT wants the
 *     PIN given in this tap; the owner's ALLOW_LOAD is a grant that opens no load and answers 6200.
 *   - The card finishes its own change. SPEND_ALL_CHANGE names the mint's key K and the keyset (45 bytes), in a keyset
 *     the card was taught (KEYSET_KEYS, under the PIN); GET_CHANGE answers 83-byte openings (number, amount, keyset,
 *     date, B_, K) with no blinding factor; any reader shows the opening's key in the keyset's tree (KEYSET_KEYS P1 3)
 *     and hands the mint's answer to LOAD_CHANGE, which checks its DLEQ proof and unblinds it on the card.
 *   - Held commands. An owner's claim (SET_OWNER on a card with no owner) is asked six times, the first five answered
 *     6A98, keep holding; VERIFY_PIN on a card with no owner answers 6A98 while it serves the wait of wrong tries. The
 *     client sends such a command again while the card answers 6A98, within a bound.
 *
 * Nothing here retries an APDU. A replayed LOAD_PROOF burns a slot, and a payment's SPEND_ALL_SIGN is not asked twice
 * (SPEND_ALL_AGAIN gives the signature again): a transport error on /apdu is thrown to the caller, who knows whether
 * the command was idempotent. A 6A98 is the card asking for the same command again, not a failure. waitReady() is the
 * one bounded retry loop, and it only reads /state.
 *
 * Three facts about the simulator a loader has to know (CardSim.java header):
 *   - SELECT starts a tap: a re-SELECT drops a verified PIN, the owner's nonce and the owner's grant. What lasts for the
 *     time in the field (a payment signed, an owner claimed) lasts until the card is out of the field, which only a
 *     fixture does (it ends with the card out of the field and back). There is no /tap; call select() where the app
 *     would tap.
 *   - /reset does not change the card key P. Every install yields the same P, but a new secret c, and so new keys per
 *     date: read GROUP_KEYS after every reset, and mint fresh pieces per run.
 *   - /state reads with neither the PIN nor the owner's grant, so the card's history (the day's window and count, the
 *     rolls, the arming, the last header, a spent place's piece) reads as zeros there.
 */
const nodeCrypto = require("node:crypto")

const CLA = 0xb0

const INS = Object.freeze({
  GET_INFO: 0x01,
  GET_PUBKEY: 0x10,
  GET_BALANCE: 0x11,
  GET_PROOF_COUNT: 0x12,
  GET_PROOF: 0x13,
  GET_SLOT_STATUS: 0x14,
  AUTH: 0x15,
  GET_CARD: 0x16,
  GET_PIECES: 0x17,
  GET_LOG: 0x18,
  GET_CHANGE: 0x19,
  GET_DLEQ: 0x1a,
  GET_OUTBOX: 0x1b,
  CERT_READ: 0x1c,
  GROUP_KEYS: 0x1d,
  SPEND_ALL_BEGIN: 0x22,
  SPEND_ALL_OUTPUTS: 0x23,
  SPEND_ALL_SIGN: 0x24,
  SPEND_ALL_AGAIN: 0x25,
  SPEND_ALL_CHANGE: 0x26,
  LOAD_CHANGE: 0x27,
  LOAD_PROOF: 0x30,
  CLEAR_SPENT: 0x31,
  SET_CARD: 0x32,
  SET_LIMIT_PIN: 0x33,
  SET_LIMIT: 0x34,
  SET_HEADER: 0x36,
  TELL_TIME: 0x37,
  KEYSET_KEYS: 0x38,
  VERIFY_PIN: 0x40,
  SET_PIN: 0x41,
  CHANGE_PIN: 0x42,
  SET_OWNER: 0x43,
  GET_NONCE: 0x44,
  ALLOW_LOAD: 0x45,
  LOCK_CARD: 0x50,
  RESET_CARD: 0x51,
  SET_TAG: 0x52,
  REFRESH: 0x53,
  CERT_WRITE: 0x54,
})

const SW = Object.freeze({
  OK: 0x9000,
  GRANT_GIVEN: 0x6200,
  WRONG_LENGTH: 0x6700,
  SECURITY_NOT_SATISFIED: 0x6982,
  PIN_BLOCKED: 0x6983,
  PIN_NOT_SET: 0x6984,
  CONDITIONS_NOT_SATISFIED: 0x6985,
  CARD_LOCKED: 0x6986,
  WRONG_DATA: 0x6a80,
  NOT_FOUND: 0x6a82,
  SLOT_OUT_OF_RANGE: 0x6a83,
  NO_SPACE: 0x6a84,
  INCORRECT_P1P2: 0x6a86,
  SLOT_EMPTY: 0x6a88,
  NO_CARD_RECORD: 0x6a8c,
  CARD_IN_USE: 0x6a8d,
  NO_REFUND_KEY: 0x6a8e,
  OVER_LIMIT: 0x6a8f,
  NO_OWNER: 0x6a90,
  OWNER_PROOF: 0x6a91,
  LITTLE_WORK: 0x6a93,
  PIECE_ON_CARD: 0x6a94,
  PIN_NEEDED: 0x6a94,
  TOO_MANY: 0x6a96,
  NO_PIN: 0x6a97,
  KEEP_HOLDING: 0x6a98,
  NO_RATE: 0x6a99,
  TWO_UNITS: 0x6a9a,
  OTHER_UNIT: 0x6a9b,
  NO_TABLE_ROOM: 0x6a9c,
  NOT_THIS_TAP: 0x6a9d,
  ENTER_PIN: 0x6a9e,
  KEYS_NOT_SHOWN: 0x6a9f,
  WRONG_P1P2: 0x6b00,
  INS_NOT_SUPPORTED: 0x6d00,
  CLA_NOT_SUPPORTED: 0x6e00,
  CRYPTO_ERROR: 0x6f00,
})

// The card's applet's whole AID first, then the package AID, "CASHUCARD" after F0 (D19), as a fallback
// (cardctl.select, D25). On a chip the package AID alone is a partial name and reaches the opener, made first,
// which answers 9000 with no version; the bridge does the same, so a 9000 without a version falls through.
const PACKAGE_AID = Buffer.from("F0434153485543415244", "hex")
const APPLET_AID = Buffer.from("F043415348554341524401", "hex")
const SELECT_AIDS = Object.freeze([APPLET_AID, PACKAGE_AID])
// Withdrawn: a card that answers these, or does not answer the shared AID (D19, since 2.0), needs an update.
const OLD_AIDS = Object.freeze({ upstream0x: Buffer.from("D2760000850102", "hex"), foxy1x: Buffer.from("F0464F585943415244", "hex") })

const VERSION = Object.freeze({ major: 3, minor: 0 })
/** GET_OUTBOX (2.2): the scope's length, and the most bytes one page answers. */
const OUTBOX_SCOPE_LEN = 45
const OUTBOX_PAGE = 255
const MAX_PROOFS = 128
const PROOF_SIZE = 82
const DLEQ_LEN = 96
const HEADER_LEN = 80
const OUTPUT_LEN = 37
const LOCK_CONFIRM_BYTE = 0xde
const MAX_SLOT_AMOUNT = 2 ** 32
const PIN_MIN_LEN = 4, PIN_MAX_LEN = 8
const ROLL_BUDGET_DEFAULT = 7, ROLL_BUDGET_MOST = 30
const STATUS_NAMES = Object.freeze({ 0: "empty", 1: "unspent", 2: "spent" })
const PIN_STATE_NAMES = Object.freeze({ 0: "none", 1: "set", 2: "blocked" })
/** SPEND_ALL_BEGIN's P1 (3.0): bit 1, the reader builds the secrets with the keys per load (always); bit 0, it reads units. */
const BEGIN_DATE_KEYS = 0x02, BEGIN_UNITS = 0x01
/** SPEND_ALL_BEGIN's answer: the pieces' worth (4), t (32), the date's refund key R + u*G (33). */
const BEGIN_ANSWER_LEN = 69
/** LOAD_PROOF's and LOAD_CHANGE's P2 bit 1 (3.0): the loader's word that the pieces are locked to the card's keys for their date. LOAD_PROOF's bit 0: the unit first. */
const LOAD_DATE_KEYS = 0x02, LOAD_UNIT_FIRST = 0x01
/** GROUP_KEYS' answer: t (32), P + t*G (33), R + u*G (33). */
const GROUP_KEYS_LEN = 98
/** The card's own change (3.0): GET_CHANGE rows, three to a page, eight openings; SPEND_ALL_CHANGE's data; LOAD_CHANGE's data and answer. */
const CHANGE_ROW_LEN = 83, CHANGE_PAGE = 3, CHANGE_MOST = 8
const SPEND_ALL_CHANGE_LEN = 45
const LOAD_CHANGE_LEN = 194, LOAD_CHANGE_ANSWER_LEN = 83
const EC_POINT_LEN = 65
/** KEYSET_KEYS (3.0): a key on the wire is amount (8) || K (33); six to a command, 64 to a keyset; a tail of 64 at most; a path of 6 at most. */
const KEYSET_KEY_WIRE = 41, KEYSET_KEYS_PER_COMMAND = 6, KEYSET_KEYS_MOST = 64, KEYSET_TAIL_MOST = 64, KEYSET_PATH_MOST = 6
const KEYSET_UNITS = Object.freeze(["sat", "usd"])
/** CERT_READ (3.0): P1 FF the state (4 bytes), P1 00 to 03 pages of 256. */
const CERT_STATE = 0xff, CERT_PAGE = 256, CERT_PAGES = 4
/** GET_NONCE P1 = 1 (3.0): the nonce (16), the PIN key (33), the card key's signature over it (64). */
const PIN_KEY_ANSWER_LEN = 113
/** Held commands (3.0): a claim is six askings; a VERIFY_PIN on a card with no owner waits at most 16,384 askings, in stretches of 16, then the try. */
const CLAIM_MOST = 10
const PIN_WAIT_MOST = 16384 + 16384 / 16 + 2
/** GET_INFO P1 = 4, bytes 55 and 56: the profiles a card keeps, one bit each (spec/APDU.md, GET_INFO). */
const PROFILE_NAMES = Object.freeze([
  [55, 0, "PIN before money"], [55, 1, "the no-PIN window"], [55, 2, "the owner claimed slowly"],
  [55, 3, "the wait on every payment"], [55, 4, "two units on one card"], [55, 5, "a holder with no phone"],
  [55, 6, "keyset keys"], [55, 7, "the paid list"], [56, 0, "the certificate"], [56, 1, "keys per load"],
])
const LAST_UNIT_NAMES = Object.freeze({ 0x00: "none", 0x80: "the card's", 0xa0: "the other" })
const UNIT_NAMES = Object.freeze({ 0: "sat", 1: "usd" })

// The owner's proof labels (spec/APDU.md, "The owner's proof").
const LABEL = Object.freeze({
  CHANGE_PIN: "CashuCard/change-pin",
  SET_LIMIT: "CashuCard/set-limit",
  SET_OWNER: "CashuCard/set-owner",
  SET_CARD: "CashuCard/set-card",
  LOAD: "CashuCard/load",
  LOCK: "CashuCard/lock",
  RESET: "CashuCard/reset",
  TAG: "CashuCard/tag",
  REFRESH: "CashuCard/refresh",
})

// The deterministic TEST owner key, shared with cardctl (p256.TEST_OWNER_PRIVATE) and the bridge (OwnerKey.TEST):
// SHA-256("cashu-javacard/cardctl test owner key") mod n. Anyone with the repository holds it: simulated cards only.
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const TEST_OWNER_PRIVATE = (BigInt("0x" + nodeCrypto.createHash("sha256").update("cashu-javacard/cardctl test owner key").digest("hex")) % P256_N)
  .toString(16).padStart(64, "0")

// The words of spec/APDU.md's Error Code Summary, as cardctl's SW_MEANINGS says them.
const SW_MEANINGS = {
  0x9000: "success",
  0x6200: "the owner's grant given for this tap (ALLOW_LOAD); it opens no load",
  0x6700: "wrong length",
  0x6982: "security condition not satisfied: the PIN (or the owner's grant, or a held tap) not given in this tap",
  0x6983: "PIN blocked — the owner's change-pin unblocks it",
  0x6984: "PIN not set",
  0x6985: "conditions not satisfied (already spent / no payment begun / already locked / a payment in a time in the field that claimed an owner or read a history)",
  0x6986: "card locked by LOCK_CARD — writes disabled",
  0x6a80: "wrong data (not a point, a bad refund key or unit, a budget outside 1-30, a key not bound, a proof that does not hold, a path that does not reach the top, outputs and change past the pieces)",
  0x6a82: "not found — no 2.x applet on this card (a 0.x or 1.x card needs an update)",
  0x6a83: "slot or opening out of range, or an offset at or past the end",
  0x6a84: "no space — no slot, no change opening, or no room the card could reserve",
  0x6a86: "incorrect P1/P2: a payment begun without P1 bit 1, or a load without P2 bit 1 (no word on keys per load)",
  0x6a88: "slot is empty (or spent, to a reader with neither the PIN nor the grant), an opening not owed, a keyset in no entry, no record",
  0x6a8c: "no card record (or a factory record) — set the card up first",
  0x6a8d: "card in use — something unspent, or change owed, where only an empty card may be changed",
  0x6a8e: "a dated piece on a card with no refund key",
  0x6a8f: "over the day's limit (a payment, or a piece loaded), or past the day's 300 pieces",
  0x6a90: "no owner — set the owner first",
  0x6a91: "the owner's proof is missing or not the owner's, or not open to an owned card; on a card with no owner past its first set-up, a record, a number or a claim",
  0x6a93: "too little work in the block header",
  0x6a94: "already on the card or on the paid list (LOAD_PROOF), or an opening's piece already on it / the PIN needed for this payment (SPEND_ALL_SIGN)",
  0x6a96: "too many places for one signature, or a transaction the chip cannot hold",
  0x6a97: "no PIN — the card takes and pays nothing until it is given one",
  0x6a98: "keep holding — a held count not yet through; send the same command again",
  0x6a99: "no rate — a payment or a load of the other unit on a card with a limit set and no rate",
  0x6a9a: "two units in one payment, or a place whose keyset is in no entry",
  0x6a9b: "the other unit — a keyset in the table as the other unit than the command names",
  0x6a9c: "no room in the keyset table, or a label of the other unit on a card with no table",
  0x6a9d: "not this tap's to start — a new keyset of the other unit without the holder's say",
  0x6a9e: "limit reached, enter the PIN — past what the no-PIN window has left",
  0x6a9f: "keys not shown — the keyset's keys not taught to the card, or the opening's key not shown to be one of them",
  0x6b00: "wrong P1/P2 (a missing confirmation byte)",
  0x6d00: "instruction not supported",
  0x6e00: "class not supported",
  0x6f00: "signing failed (hardware error)",
}

function describeSw(sw) {
  if (sw in SW_MEANINGS) return SW_MEANINGS[sw]
  if ((sw & 0xfff0) === 0x63c0) return `wrong PIN — ${sw & 0x0f} (tries left on a card with an owner; wrong tries in a row on one with none)`
  return "unknown status word"
}

const hex4 = sw => sw.toString(16).toUpperCase().padStart(4, "0")

/** The card answered something other than 9000. `sw` is a number; `context` names the command. */
class CardError extends Error {
  constructor(sw, context = "") {
    const where = context ? ` during ${context}` : ""
    super(`card returned ${hex4(sw)}${where}: ${describeSw(sw)}`)
    this.name = "CardError"
    this.sw = sw
    this.context = context
  }
}

/** The bridge answered a non-2xx (400 bad request, 409 refused fixture, 404/405/500). */
class CardSimError extends Error {
  constructor(status, body, path) {
    const detail = body && body.error ? body.error : JSON.stringify(body)
    super(`cardsim ${path} answered ${status}: ${detail}`)
    this.name = "CardSimError"
    this.status = status
    this.body = body
  }
}

// ── bytes ─────────────────────────────────────────────────────────────────────

/** A Buffer from a Buffer/Uint8Array or a hex string (case-insensitive, 0x tolerated). */
function toBytes(value, what = "value") {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === "string") {
    const s = value.replace(/\s+/g, "")
    const bare = /^0x/i.test(s) ? s.slice(2) : s
    if (bare.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(bare)) throw new TypeError(`${what} is not valid hex: ${value}`)
    return Buffer.from(bare, "hex")
  }
  throw new TypeError(`${what} must be a Buffer or a hex string`)
}

function expectLen(buf, len, what) {
  if (buf.length !== len) throw new RangeError(`${what} must be ${len} bytes, got ${buf.length}`)
  return buf
}

/** A PIN as bytes: a digit string is encoded as its ASCII bytes, as cardctl does. */
function secretBytes(value, what, min, max) {
  const b = typeof value === "string" ? Buffer.from(value, "utf8") : toBytes(value, what)
  if (b.length < min || b.length > max) throw new RangeError(`${what} must be ${min}-${max} bytes, got ${b.length}`)
  return b
}

const u32 = (v, what) => {
  if (!Number.isInteger(v) || v < 0 || v >= MAX_SLOT_AMOUNT) throw new RangeError(`${what} must be an integer, 0 <= n < 2^32, got ${v}`)
  const b = Buffer.alloc(4)
  b.writeUInt32BE(v)
  return b
}

/**
 * cardctl.validate_slot_amount: a positive power of two below 2^32. A mint keyset has no key for amount 3, so a piece
 * carrying one is refused on redemption, after the slot is burned.
 */
function validateSlotAmount(value, where = "") {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${where}amount must be a positive integer, got ${typeof value} ${JSON.stringify(value)}`)
  }
  if (!(value > 0 && value < MAX_SLOT_AMOUNT)) {
    throw new RangeError(`${where}amount must be a positive integer below 2**32 (the card's amount field is a 4-byte uint), got ${value}`)
  }
  if (!isPowerOfTwo(value)) {
    throw new RangeError(`${where}amount must be a positive power of two — a mint keyset has no key for other denominations, so the proof is rejected on redemption after the slot is already burned. Got ${value}.`)
  }
  return value
}

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && Math.log2(n) % 1 === 0
}

/** CLA B0 ‖ INS ‖ P1 ‖ P2 [‖ Lc ‖ data] [‖ Le] — cardctl.Card.send's framing. */
function apdu(ins, p1 = 0, p2 = 0, data = null, le = null) {
  const parts = [Buffer.from([CLA, ins, p1, p2])]
  if (data && data.length) parts.push(Buffer.from([data.length]), data)
  if (le !== null && le !== undefined) parts.push(Buffer.from([le]))
  return Buffer.concat(parts)
}

function slotIndex(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PROOFS) {
    throw new RangeError(`slot must be an integer in 0..${MAX_PROOFS - 1}, got ${slot}`)
  }
  return slot
}

/** An owner's command's data: the proof's length (1), the proof, then the value it was made over. */
function ownerData(proof, value = Buffer.alloc(0)) {
  const p = toBytes(proof, "proof")
  if (p.length < 1 || p.length > 72) throw new RangeError(`an owner's proof is a DER signature of at most 72 bytes, got ${p.length}`)
  return Buffer.concat([Buffer.from([p.length]), p, toBytes(value, "value")])
}

/**
 * The owner's proof: an ECDSA signature (P-256, SHA-256, DER) by the owner's private key (32 bytes hex, default the
 * TEST key) over label || nonce (16) || value.
 */
function ownerProof(label, nonce, value = Buffer.alloc(0), privateKeyHex = TEST_OWNER_PRIVATE) {
  const n = expectLen(toBytes(nonce, "nonce"), 16, "nonce")
  const key = ownerKey(privateKeyHex)
  return nodeCrypto.sign("sha256", Buffer.concat([Buffer.from(label, "ascii"), n, toBytes(value, "value")]), { key, dsaEncoding: "der" })
}

/** A node:crypto KeyObject for a P-256 private key given as 32 bytes of hex. */
function ownerKey(privateKeyHex = TEST_OWNER_PRIVATE) {
  const d = expectLen(toBytes(privateKeyHex, "owner key"), 32, "owner key")
  const ecdh = nodeCrypto.createECDH("prime256v1")
  ecdh.setPrivateKey(d)
  const pub = ecdh.getPublicKey()
  const b64 = b => b.toString("base64url")
  return nodeCrypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64(d), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) }, format: "jwk" })
}

/** The owner's public key, 65 bytes 04 || X || Y, as SET_OWNER takes it. */
function ownerPublicKey(privateKeyHex = TEST_OWNER_PRIVATE) {
  const ecdh = nodeCrypto.createECDH("prime256v1")
  ecdh.setPrivateKey(expectLen(toBytes(privateKeyHex, "owner key"), 32, "owner key"))
  return ecdh.getPublicKey()
}

/**
 * SET_LIMIT's value (and SET_LIMIT_PIN's): 4, 8, 12, 13, 17 or 18 bytes, each longer form every field before it and
 * more (cardctl.limit_value): the day's limit, the limit on one payment, the no-PIN allowance, the rollover budget (1 to
 * 30), the rate (sats to the dollar, 0 none) and the no-PIN window's switch (0 the window of 24 hours, 1 none). A field
 * left out leaves what it sets as it is, so a longer form needs every field before it given.
 */
function limitValue({ day, payment, allowance, rollBudget, rate, noPinWindow } = {}) {
  if (noPinWindow !== undefined && rate === undefined) throw new TypeError("noPinWindow is the eighteenth byte: give rate too (0 for none)")
  if (rate !== undefined && rollBudget === undefined) throw new TypeError("rate is bytes 13 to 16: give rollBudget too")
  if (rollBudget !== undefined && (payment === undefined || allowance === undefined)) throw new TypeError("rollBudget is the thirteenth byte: give payment and allowance too")
  if (allowance !== undefined && payment === undefined) throw new TypeError("allowance is bytes 8 to 11: give payment too")
  if (rollBudget !== undefined && !(Number.isInteger(rollBudget) && rollBudget >= 1 && rollBudget <= ROLL_BUDGET_MOST)) {
    throw new RangeError(`rollBudget must be 1 to ${ROLL_BUDGET_MOST}, got ${rollBudget}`)
  }
  if (noPinWindow !== undefined && noPinWindow !== 0 && noPinWindow !== 1) throw new RangeError(`noPinWindow is 0 (the window of 24 hours) or 1 (none), got ${noPinWindow}`)
  const parts = [u32(day, "day")]
  if (payment !== undefined) parts.push(u32(payment, "payment"))
  if (allowance !== undefined) parts.push(u32(allowance, "allowance"))
  if (rollBudget !== undefined) parts.push(Buffer.from([rollBudget]))
  if (rate !== undefined) parts.push(u32(rate, "rate"))
  if (noPinWindow !== undefined) parts.push(Buffer.from([noPinWindow]))
  return Buffer.concat(parts)
}

// ── points (secp256k1), as LOAD_CHANGE and SPEND_ALL_CHANGE take them ─────────

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn
function powMod(b, e, m) {
  let r = 1n
  b %= m
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}
const big = b => BigInt("0x" + b.toString("hex"))
const be32 = n => Buffer.from(n.toString(16).padStart(64, "0"), "hex")

/** The 65-byte form 04 || x || y of a point given as 33 bytes (02/03) or 65 (04); RangeError for bytes that are not a point. */
function uncompressedPoint(value, what = "point") {
  const b = toBytes(value, what)
  if (b.length === EC_POINT_LEN && b[0] === 0x04) {
    const x = big(b.subarray(1, 33)), y = big(b.subarray(33))
    if (x < SECP_P && y < SECP_P && (y * y - x * x * x - 7n) % SECP_P === 0n) return Buffer.from(b)
  } else if (b.length === 33 && (b[0] === 0x02 || b[0] === 0x03)) {
    const x = big(b.subarray(1))
    if (x < SECP_P) {
      const y2 = (x * x * x + 7n) % SECP_P
      let y = powMod(y2, (SECP_P + 1n) / 4n, SECP_P)
      if ((y * y) % SECP_P === y2) {
        if ((y & 1n) !== BigInt(b[0] & 1)) y = SECP_P - y
        return Buffer.concat([Buffer.from([4]), be32(x), be32(y)])
      }
    }
  }
  throw new RangeError(`${what} is not a point of secp256k1 (33 bytes 02/03 or 65 bytes 04): ${b.toString("hex")}`)
}

/** The 33-byte form 02/03 || x of a point given as 33 or 65 bytes; RangeError for bytes that are not a point. */
function compressedPoint(value, what = "point") {
  const u = uncompressedPoint(value, what)
  return Buffer.concat([Buffer.from([2 | (u[64] & 1)]), u.subarray(1, 33)])
}

// ── a keyset's keys and the tree the card keeps of them (KEYSET_KEYS) ────────
// As cardctl's keyset_id, keyset_leaf, keyset_levels, keyset_path and fold_path: leaves SHA-256(00 || amount (8) || K),
// padded to a power of two with SHA-256(02), nodes SHA-256(01 || left || right).

const sha256 = (...parts) => nodeCrypto.createHash("sha256").update(Buffer.concat(parts)).digest()
const KEYSET_PAD = sha256(Buffer.from([0x02]))

/** A key's amount as 8 bytes, big-endian: a number or a BigInt, 1 to 2^64 - 1 (a mint lists 2^63 as text). */
function amount8(amount) {
  const a = typeof amount === "bigint" ? amount : typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : Number.isSafeInteger(amount) ? BigInt(amount) : -1n
  if (a < 1n || a >= 1n << 64n) throw new RangeError(`a key's amount is 1 to 2^64 - 1, got ${amount}`)
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(a)
  return b
}

/** A key as KEYSET_KEYS P1 1 takes it: amount (8) || K (33, compressed). */
function keysetKeyWire(amount, K) {
  const k = toBytes(K, "K")
  if (k.length !== 33 || (k[0] !== 2 && k[0] !== 3)) throw new RangeError("a keyset's key is 33 bytes beginning 02 or 03")
  return Buffer.concat([amount8(amount), k])
}

/** NUT-02's text after the keys for a version 01 ID: |unit:U, then |input_fee_ppk:F where the fee is not 0, then |final_expiry:T where the keyset has one. */
function keysetTail(unit, inputFeePpk = 0, finalExpiry = null) {
  let tail = `|unit:${unit}`
  if (inputFeePpk) tail += `|input_fee_ppk:${inputFeePpk}`
  if (finalExpiry !== null && finalExpiry !== undefined) tail += `|final_expiry:${finalExpiry}`
  return Buffer.from(tail, "ascii")
}

/** The tail KEYSET_KEYS P1 0 takes after a keyset of `version`: none for 00; for 01 `|unit:sat` or `|unit:usd`, then the end or `|`, 64 bytes at most. */
function checkKeysetTail(version, tail) {
  if (version !== 0 && version !== 1) throw new RangeError(`a keyset ID of version 00 or 01, got ${version}`)
  if (version === 0) {
    if (tail.length) throw new RangeError("a version 00 ID hashes the keys alone: no tail")
    return
  }
  const text = tail.toString("latin1")
  const named = KEYSET_UNITS.some(u => text.startsWith(`|unit:${u}`) && ["", "|"].includes(text.slice(6 + u.length, 7 + u.length)))
  if (!named || tail.length > KEYSET_TAIL_MOST) throw new RangeError(`a version 01 tail names its unit first, |unit:sat or |unit:usd, then the end or |, ${KEYSET_TAIL_MOST} bytes at most: ${JSON.stringify(text)}`)
}

/** NUT-02's ID of `keys` ([amount, K] in increasing order of amount): version 00, 00 || SHA-256(the keys end to end)[:7]; version 01, 01 || SHA-256("amount:K hex" joined by "," || tail). */
function keysetId(version, keys, tail = Buffer.alloc(0)) {
  if (version === 0) return Buffer.concat([Buffer.from([0]), sha256(...keys.map(([, k]) => toBytes(k, "K"))).subarray(0, 7)])
  const text = keys.map(([a, k]) => `${BigInt(a)}:${toBytes(k, "K").toString("hex")}`).join(",")
  return Buffer.concat([Buffer.from([1]), sha256(Buffer.from(text, "ascii"), toBytes(tail, "tail"))])
}

/** A leaf of the card's tree: SHA-256(00 || amount (8) || K). */
function keysetLeaf(amount, K) {
  return sha256(Buffer.from([0x00]), keysetKeyWire(amount, K))
}

/** The tree's levels, the leaves first (padded to a power of two with SHA-256(02)), the top last. */
function keysetLevels(keys) {
  let level = keys.map(([a, k]) => keysetLeaf(a, k))
  let size = 1
  while (size < level.length) size *= 2
  while (level.length < size) level.push(KEYSET_PAD)
  const levels = [level]
  while (level.length > 1) {
    const up = []
    for (let i = 0; i < level.length; i += 2) up.push(sha256(Buffer.from([0x01]), level[i], level[i + 1]))
    level = up
    levels.push(level)
  }
  return levels
}

/** The path of leaf `index`: its sibling, then each node's sibling up to the top. */
function keysetPath(keys, index) {
  const levels = keysetLevels(keys)
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) throw new RangeError(`leaf ${index} of ${keys.length}`)
  const path = []
  for (let h = 0; h < levels.length - 1; h++) path.push(levels[h][(index >> h) ^ 1])
  return path
}

/** The top a leaf and its path reach, as the card folds them: bit i of the index is 1 where the node at height i is a right child. */
function foldPath(leaf, index, path) {
  let node = leaf
  path.forEach((sibling, i) => {
    node = (index >> i) & 1 ? sha256(Buffer.from([0x01]), sibling, node) : sha256(Buffer.from([0x01]), node, sibling)
  })
  return node
}

/**
 * A mint's keyset as NUT-01 serves it ({id, unit, keys: {"1": "02..", ...}}, from GET /v1/keys/{id}), with NUT-02's
 * input_fee_ppk and final_expiry from GET /v1/keysets (given in `opts`, or on the document). Answers what KEYSET_KEYS
 * teaches: { id, keyset8, version, unit, keys: [[BigInt amount, Buffer K]] in increasing order of amount, tail }, after
 * checking the keys hash to the ID; a version 00 keyset's n-th key is for 2^n with none left out, as the card holds it.
 */
function keysetFromMint(doc, { inputFeePpk, finalExpiry } = {}) {
  if (!doc || typeof doc !== "object" || typeof doc.id !== "string" || !doc.keys || typeof doc.keys !== "object") throw new TypeError("a keyset of the NUT-01 shape {id, unit, keys}")
  const id = toBytes(doc.id, "the keyset's id")
  if (!(id.length === 8 && id[0] === 0) && !(id.length === 33 && id[0] === 1)) throw new RangeError(`a keyset id of version 00 (8 bytes) or 01 (33), got ${doc.id}`)
  const keys = Object.entries(doc.keys).map(([a, k]) => {
    if (!/^\d+$/.test(a)) throw new RangeError(`the amount ${JSON.stringify(a)} is not a whole number`)
    const K = toBytes(k, `the key for ${a}`)
    compressedPoint(K, `the key for ${a}`)
    if (K.length !== 33) throw new RangeError(`the key for ${a} is 33 bytes`)
    amount8(BigInt(a))
    return [BigInt(a), K]
  }).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
  if (keys.length < 1 || keys.length > KEYSET_KEYS_MOST) throw new RangeError(`${keys.length} keys; the card is taught 1 to ${KEYSET_KEYS_MOST}`)
  const version = id[0]
  const unit = String(doc.unit || "")
  let tail = Buffer.alloc(0)
  if (version === 0) {
    keys.forEach(([a], i) => { if (a !== 1n << BigInt(i)) throw new RangeError("a version 00 keyset's n-th key is for 2^n, from 1, with none left out") })
  } else {
    if (!KEYSET_UNITS.includes(unit)) throw new RangeError(`the unit ${JSON.stringify(unit)}; the card holds keysets of ${KEYSET_UNITS.join(" and ")}`)
    const fee = inputFeePpk !== undefined ? inputFeePpk : doc.input_fee_ppk || 0
    const expiry = finalExpiry !== undefined ? finalExpiry : doc.final_expiry
    tail = keysetTail(unit, Number(fee || 0), expiry === undefined ? null : expiry)
    checkKeysetTail(version, tail)
  }
  const worked = keysetId(version, keys, tail)
  if (!worked.equals(id)) throw new Error(`the keys and the tail ${JSON.stringify(tail.toString())} hash to ${worked.toString("hex")}, not the keyset's id ${doc.id}` + (version === 1 ? " (a keyset with a fee needs its input_fee_ppk, from GET /v1/keysets)" : ""))
  return { id, keyset8: id.subarray(0, 8), version, unit, keys, tail }
}

function keysetBytes(keyset) {
  return expectLen(toBytes(keyset, "keyset"), 8, "a keyset")
}

function dateU32(date) {
  return u32(date, "date")
}

function openingNumber(k) {
  if (!Number.isInteger(k) || k < 0 || k >= CHANGE_MOST) throw new RangeError(`an opening is 0 to ${CHANGE_MOST - 1}, got ${k}`)
  return k
}

/** Pure encoders: the bytes each command puts on the wire. Argument checks throw before any transport. */
const encode = Object.freeze({
  select: (aid = APPLET_AID) => Buffer.concat([Buffer.from([0x00, 0xa4, 0x04, 0x00, aid.length]), aid]),
  /** GET_INFO: P1 = 4 (59 bytes on 3.0), the longest; 0 to 3 for the shorter forms. */
  getInfo: (p1 = 4) => apdu(INS.GET_INFO, p1, 0, null, 0x00),
  getPubkey: () => apdu(INS.GET_PUBKEY, 0, 0, null, 0x21),
  getBalance: () => apdu(INS.GET_BALANCE, 0, 0, null, 0x04),
  getProofCount: () => apdu(INS.GET_PROOF_COUNT, 0, 0, null, 0x01),
  getSlotStatus: () => apdu(INS.GET_SLOT_STATUS, 0, 0, null, MAX_PROOFS),
  getProof: slot => apdu(INS.GET_PROOF, slotIndex(slot), 0, null, PROOF_SIZE),
  auth: reader => apdu(INS.AUTH, 0, 0, expectLen(toBytes(reader, "reader nonce"), 16, "AUTH's reader nonce"), 0x50),
  /** GET_CARD: P1 = 0 the record (109 bytes and the mint), 2 the keyset table. */
  getCard: (p1 = 0) => {
    if (p1 !== 0 && p1 !== 2) throw new RangeError("GET_CARD P1 is 0 (the record) or 2 (the keyset table); getCardSecret is P1 3")
    return apdu(INS.GET_CARD, p1, 0, null, 0x00)
  },
  /** GET_CARD P1 = 3: the card's secret c, sealed, after GET_NONCE P1 = 1. With `E` (65, 04 || x || y) on a card with no refund key. */
  getCardSecret: (E = null) => {
    if (E === null) return apdu(INS.GET_CARD, 3, 0, null, 0x00)
    const e = toBytes(E, "E")
    if (e.length !== EC_POINT_LEN || e[0] !== 0x04) throw new RangeError("E is 65 bytes beginning 04")
    return apdu(INS.GET_CARD, 3, 0, e, 0x00)
  },
  getPieces: (first = 0, form = 0) => apdu(INS.GET_PIECES, slotIndex(first), form, null, 0x00),
  getChange: (page = 0) => {
    if (!Number.isInteger(page) || page < 0 || page > 0xff) throw new RangeError(`a GET_CHANGE page is 0 to 255, got ${page}`)
    return apdu(INS.GET_CHANGE, page, 0, null, 0x00)
  },
  getDleq: (first, second = null) => apdu(INS.GET_DLEQ, slotIndex(first), second === null ? 0xff : slotIndex(second), null, 0x00),
  /** GET_OUTBOX P1 = 0: the scope of the last payment's packet, 45 bytes (index, payment id, generation, SHA-256 of the body). */
  getOutboxScope: () => apdu(INS.GET_OUTBOX, 0, 0, null, 0x00),
  /** GET_OUTBOX P1 = 1: `count` (1 to 255) bytes of the packet from `offset` (0 to 65535), or as many as are left. */
  getOutboxPage: (offset, count = OUTBOX_PAGE) => {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff) throw new RangeError(`offset must be an integer in 0..65535, got ${offset}`)
    if (!Number.isInteger(count) || count < 1 || count > OUTBOX_PAGE) throw new RangeError(`count must be an integer in 1..${OUTBOX_PAGE}, got ${count}`)
    return apdu(INS.GET_OUTBOX, 1, 0, Buffer.from([offset >> 8, offset & 0xff, count]), 0x00)
  },
  /** CERT_READ: P1 = FF the state, 0 to 3 a page of 256. */
  certRead: (p1 = CERT_STATE) => {
    if (p1 !== CERT_STATE && !(Number.isInteger(p1) && p1 >= 0 && p1 < CERT_PAGES)) throw new RangeError(`CERT_READ P1 is FF or 0 to ${CERT_PAGES - 1}, got ${p1}`)
    return apdu(INS.CERT_READ, p1, 0, null, 0x00)
  },
  /** GROUP_KEYS: the keys of one date (4 bytes; 0 for undated pieces). Le 62: t, P + t*G, R + u*G. */
  groupKeys: date => apdu(INS.GROUP_KEYS, 0, 0, dateU32(date), GROUP_KEYS_LEN),
  /** SPEND_ALL_BEGIN: P1 02 (the secrets built with the keys per load), 03 for a reader that reads units; Le 45. */
  spendAllBegin: (slots, { units = false } = {}) => {
    if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_PROOFS) throw new RangeError(`a payment names 1 to ${MAX_PROOFS} slots`)
    return apdu(INS.SPEND_ALL_BEGIN, BEGIN_DATE_KEYS | (units ? BEGIN_UNITS : 0), 0, Buffer.from(slots.map(slotIndex)), BEGIN_ANSWER_LEN)
  },
  /** SPEND_ALL_OUTPUTS: up to six outputs, amount (4) || B_ (33); with `keyset` (8), P1 01 and the keyset first, for the payment's record. */
  spendAllOutputs: (outputs, keyset = null) => {
    if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 6) throw new RangeError("1 to 6 outputs to a command")
    const body = outputs.map(o => Buffer.concat([u32(o.amount, "output amount"), expectLen(toBytes(o.B_, "B_"), 33, "B_")]))
    if (keyset === null) return apdu(INS.SPEND_ALL_OUTPUTS, 0, 0, Buffer.concat(body))
    return apdu(INS.SPEND_ALL_OUTPUTS, 1, 0, Buffer.concat([keysetBytes(keyset), ...body]))
  },
  /** SPEND_ALL_CHANGE: the change amount (4) || K, the mint's key for it (33, compressed; 65 is compressed here) || the keyset it is signed in (8). Le 21. */
  spendAllChange: (amount, K, keyset) => {
    const k = compressedPoint(K, "K")
    return apdu(INS.SPEND_ALL_CHANGE, 0, 0, Buffer.concat([u32(validateSlotAmount(amount, "change "), "change"), k, keysetBytes(keyset)]), 0x21)
  },
  spendAllSign: () => apdu(INS.SPEND_ALL_SIGN, 0, 0, null, 0x40),
  /** SPEND_ALL_AGAIN: the last signature; with `messageHash` (32), P1 01, the signature of the payment whose SIG_ALL message hashes to it. */
  spendAllAgain: (messageHash = null) => {
    if (messageHash === null) return apdu(INS.SPEND_ALL_AGAIN, 0, 0, null, 0x40)
    return apdu(INS.SPEND_ALL_AGAIN, 1, 0, expectLen(toBytes(messageHash, "the message's hash"), 32, "the message's hash"), 0x40)
  },
  /**
   * LOAD_CHANGE: opening `k` (0 to 7) made into its piece from the mint's answer for its B_: C_ and K (65 bytes each,
   * 04 || x || y; 33-byte points are written out here), e and s (32 each). P2 02, the loader's word on keys per load. Le 53.
   */
  loadChange: (k, C_, K, e, s) => {
    const data = Buffer.concat([uncompressedPoint(C_, "C_"), uncompressedPoint(K, "K"), expectLen(toBytes(e, "e"), 32, "e"), expectLen(toBytes(s, "s"), 32, "s")])
    return apdu(INS.LOAD_CHANGE, openingNumber(k), LOAD_DATE_KEYS, expectLen(data, LOAD_CHANGE_LEN, "LOAD_CHANGE's data"), LOAD_CHANGE_ANSWER_LEN)
  },
  /**
   * LOAD_PROOF: one piece, keyset (8) || amount (4) || nonce (32) || C (33) || date (4), and with `dleq` the mint's proof
   * e || s || r (P1 1). P2 02: the loader's word that the piece is locked to the card's keys for its date (P + t*G and,
   * dated, R + u*G), never to the card's key P; 03 with `unit` (0 sat, 1 usd) first.
   */
  loadProof: (keyset, amount, nonce, C, date = 0, dleq = null, { unit } = {}) => {
    const kid = expectLen(toBytes(keyset, "keysetId"), 8, "keysetId")
    validateSlotAmount(amount)
    const n = expectLen(toBytes(nonce, "nonce"), 32, "nonce")
    const c = expectLen(toBytes(C, "C"), 33, "C")
    const body = [kid, u32(amount, "amount"), n, c, u32(date, "date")]
    if (dleq) body.push(expectLen(Buffer.concat(["e", "s", "r"].map(k => expectLen(toBytes(dleq[k], `dleq.${k}`), 32, `dleq.${k}`))), DLEQ_LEN, "dleq"))
    if (unit !== undefined && unit !== 0 && unit !== 1) throw new RangeError(`a unit is 0 (sat) or 1 (usd), got ${unit}`)
    if (unit !== undefined) body.unshift(Buffer.from([unit]))
    return apdu(INS.LOAD_PROOF, dleq ? 1 : 0, LOAD_DATE_KEYS | (unit !== undefined ? LOAD_UNIT_FIRST : 0), Buffer.concat(body), dleq ? 0x02 : 0x01)
  },
  clearSpent: () => apdu(INS.CLEAR_SPENT, 0, 0, null, 0x01),
  setHeader: header => apdu(INS.SET_HEADER, 0, 0, expectLen(toBytes(header, "header"), HEADER_LEN, "a block header"), 0x04),
  /** KEYSET_KEYS P1 0, under the PIN: the keyset (an entry of the card's table) and the tail NUT-02 hashes after its keys. */
  keysetKeysBegin: (keyset, tail = Buffer.alloc(0)) => {
    const ks = keysetBytes(keyset)
    const t = typeof tail === "string" ? Buffer.from(tail, "latin1") : toBytes(tail, "tail")
    checkKeysetTail(ks[0], t)
    return apdu(INS.KEYSET_KEYS, 0, 0, Buffer.concat([ks, t]))
  },
  /** KEYSET_KEYS P1 1: one to six keys, [amount, K], in increasing order of amount. */
  keysetKeysKeys: keys => {
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > KEYSET_KEYS_PER_COMMAND) throw new RangeError(`one to ${KEYSET_KEYS_PER_COMMAND} keys to a command`)
    return apdu(INS.KEYSET_KEYS, 1, 0, Buffer.concat(keys.map(([a, k]) => keysetKeyWire(a, k))))
  },
  /** KEYSET_KEYS P1 2: the card ends the ID and keeps the tree's top where the ID is the keyset's; answers the ID it worked out. */
  keysetKeysFinish: () => apdu(INS.KEYSET_KEYS, 2, 0, null, 0x00),
  /**
   * KEYSET_KEYS P1 3: opening `opening`'s key shown to be its keyset's, by the leaf's index and its path (the leaf's sibling
   * first, 0 to 6 nodes). With `otherKey` (33) the opening is bound to that key, and with `otherKeyset` (8) moved to it.
   */
  keysetKeysShow: (opening, index, path, otherKey = null, otherKeyset = null) => {
    openingNumber(opening)
    if (!Array.isArray(path) || path.length > KEYSET_PATH_MOST) throw new RangeError(`a path is 0 to ${KEYSET_PATH_MOST} nodes`)
    const nodes = path.map((n, i) => expectLen(toBytes(n, `path[${i}]`), 32, `path[${i}]`))
    if (!Number.isInteger(index) || index < 0 || index >= 1 << nodes.length) throw new RangeError(`a leaf's index under a path of ${nodes.length} is 0 to ${(1 << nodes.length) - 1}, got ${index}`)
    if (otherKeyset !== null && otherKey === null) throw new TypeError("another keyset is named only with another key")
    const parts = [Buffer.from([opening, index, nodes.length]), ...nodes]
    if (otherKey !== null) {
      const k = toBytes(otherKey, "the other key")
      if (k.length !== 33 || (k[0] !== 2 && k[0] !== 3)) throw new RangeError("the other key is 33 bytes beginning 02 or 03")
      parts.push(k)
    }
    if (otherKeyset !== null) parts.push(keysetBytes(otherKeyset))
    return apdu(INS.KEYSET_KEYS, 3, 0, Buffer.concat(parts))
  },
  verifyPin: pin => apdu(INS.VERIFY_PIN, 0, 0, secretBytes(pin, "pin", PIN_MIN_LEN, PIN_MAX_LEN)),
  setPin: pin => apdu(INS.SET_PIN, 0, 0, secretBytes(pin, "pin", PIN_MIN_LEN, PIN_MAX_LEN)),
  /** GET_NONCE: P1 = 0, 16 bytes for one owner's proof; P1 = 1, the nonce, the PIN key and the card key's signature over it (113). */
  getNonce: (p1 = 0) => {
    if (p1 !== 0 && p1 !== 1) throw new RangeError("GET_NONCE P1 is 0 or 1")
    return p1 === 0 ? apdu(INS.GET_NONCE, 0, 0, null, 0x10) : apdu(INS.GET_NONCE, 1, 0, null, PIN_KEY_ANSWER_LEN)
  },
  changePin: (proof, newPin) => apdu(INS.CHANGE_PIN, 0, 0, ownerData(proof, secretBytes(newPin, "new pin", PIN_MIN_LEN, PIN_MAX_LEN))),
  /** SET_OWNER: the owner's key (65) and the anchor header (80); on an owned card the old owner's proof first. On a card with no owner it is a claim, asked six times. */
  setOwner: (ownerPub, anchor = null, proof = null) => {
    const value = Buffer.concat([expectLen(toBytes(ownerPub, "owner key"), 65, "the owner key"), anchor ? expectLen(toBytes(anchor, "anchor"), HEADER_LEN, "the anchor header") : Buffer.alloc(0)])
    return apdu(INS.SET_OWNER, 0, 0, proof ? ownerData(proof, value) : value)
  },
  allowLoad: proof => apdu(INS.ALLOW_LOAD, 0, 0, ownerData(proof)),
  setLimit: (proof, value) => apdu(INS.SET_LIMIT, 0, 0, ownerData(proof, value)),
  refresh: (proof, header) => apdu(INS.REFRESH, 0, 0, ownerData(proof, expectLen(toBytes(header, "header"), HEADER_LEN, "a block header")), 0x04),
  lockCard: proof => apdu(INS.LOCK_CARD, 0, LOCK_CONFIRM_BYTE, ownerData(proof)),
})

// ── parsers ───────────────────────────────────────────────────────────────────

/** GET_INFO's 30, 42, 43, 51 or 59 bytes (spec/APDU.md, GET_INFO), each form the one before it and more. */
function parseInfo(b) {
  if (b.length < 30) throw new RangeError(`GET_INFO returned ${b.length} bytes, expected 30, 42, 43, 51 or 59: ${b.toString("hex")}`)
  const info = {
    version: `${b[0]}.${b[1]}`,
    major: b[0],
    minor: b[1],
    maxSlots: b[2],
    unspent: b[3],
    spent: b[4],
    empty: b[5],
    capsRaw: b[6],
    pinState: b[7],
    format: b[8],
    tries: b[9],
    locked: b[10] === 1,
    recordSet: b[11] === 1,
    dailyLimit: b.readUInt32BE(12),
    hasOwner: b[16] === 1,
    now: b.readUInt32BE(17),
    windowStart: b.readUInt32BE(21),
    spentToday: b.readUInt32BE(25),
    changeOwed: b[29] === 1,
  }
  if (b.length >= 42) Object.assign(info, { paymentLimit: b.readUInt32BE(30), allowance: b.readUInt32BE(34), nopinSpent: b.readUInt32BE(38) })
  if (b.length >= 43) info.tagOff = b[42] === 1
  if (b.length >= 51) {
    Object.assign(info, {
      keysetTable: b[43] === 1, rate: b.readUInt32BE(44), entries: b[48], unmarked: b[49],
      lastUnitRaw: b[50], lastUnit: LAST_UNIT_NAMES[b[50]] || `unknown(${b[50].toString(16)})`,
    })
  }
  if (b.length >= 55) info.noPinWindowStart = b.readUInt32BE(51)
  // a card that answers less than 57 bytes to P1 = 4 keeps none of the profiles
  if (b.length >= 57) {
    info.profilesRaw = b.readUInt16BE(55)
    info.profiles = PROFILE_NAMES.filter(([at, bit]) => (b[at] >> bit) & 1).map(([, , name]) => name)
    info.keysPerLoad = ((b[56] >> 1) & 1) === 1
  }
  if (b.length >= 59) info.loadsLeft = b.readUInt16BE(57)
  return info
}

/** A piece as GET_PROOF gives it after its status byte (81): keyset (8), amount (4), nonce (32), C (33), date (4). */
function parsePiece(b) {
  if (b.length !== PROOF_SIZE - 1) throw new RangeError(`a piece is ${PROOF_SIZE - 1} bytes, got ${b.length}`)
  return {
    keysetId: b.subarray(0, 8).toString("hex"),
    amount: b.readUInt32BE(8),
    nonce: b.subarray(12, 44).toString("hex"),
    C: b.subarray(44, 77).toString("hex"),
    date: b.readUInt32BE(77),
  }
}

/** GET_PROOF's 82 bytes as a slot (lower-case hex, `status` named). */
function parseProof(slot, b) {
  if (b.length !== PROOF_SIZE) throw new RangeError(`GET_PROOF returned ${b.length} bytes, expected ${PROOF_SIZE}`)
  return { slot, status: STATUS_NAMES[b[0]] || `unknown(${b[0]})`, ...parsePiece(b.subarray(1)) }
}

/**
 * GET_CARD P1 = 0 (spec/APDU.md, GET_CARD): 109 bytes and the mint. Bytes 44 to 76, 78 and 83 to 86 are the card's
 * history, zeros to a reader with neither the PIN nor the owner's grant in this tap.
 */
function parseCard(b) {
  if (b.length < 106) throw new RangeError(`GET_CARD returned ${b.length} bytes, expected 109 and the mint`)
  const mintLen = b[105]
  if (b.length < 109 + mintLen) throw new RangeError(`GET_CARD returned ${b.length} bytes, expected ${109 + mintLen}: 109 and a mint of ${mintLen}`)
  return {
    format: b[0],
    recordSet: b[1] === 1,
    unit: b[2],
    unitName: UNIT_NAMES[b[2]] || `unknown(${b[2]})`,
    dailyLimit: b.readUInt32BE(3),
    refundKey: b.subarray(7, 40).toString("hex"),
    hardestBits: b.subarray(40, 44).toString("hex"),
    lastHeader: b.subarray(44, 76).toString("hex"),
    rolls: b[76],
    rollBudget: b[77] || ROLL_BUDGET_DEFAULT,
    allowanceArmed: b[78] === 1,
    noPinWindowStart: b.readUInt32BE(83),
    noPinWindow: b[87],
    mint: b.subarray(106, 106 + mintLen).toString("ascii"),
    design: b.subarray(106 + mintLen, 109 + mintLen).toString("ascii"),
  }
}

/**
 * GET_CHANGE (3.0): a count (0 to 3), then that many openings of 83 bytes: the opening's number (LOAD_CHANGE's P1),
 * amount, keyset, date, the blinded message B_ and K, the mint's key it is bound to. No nonce and no blinding factor:
 * only the card finishes its change.
 */
function parseChange(b) {
  if (!b.length || b[0] > CHANGE_PAGE || b.length !== 1 + b[0] * CHANGE_ROW_LEN) {
    throw new RangeError(`GET_CHANGE returned ${b.length} bytes, not a count of 0 to ${CHANGE_PAGE} and ${CHANGE_ROW_LEN}-byte openings: ${b.toString("hex")}`)
  }
  const out = []
  for (let i = 0; i < b[0]; i++) {
    const o = b.subarray(1 + i * CHANGE_ROW_LEN, 1 + (i + 1) * CHANGE_ROW_LEN)
    if (o[0] >= CHANGE_MOST) throw new RangeError(`GET_CHANGE named opening ${o[0]}; a card has ${CHANGE_MOST}`)
    out.push({
      number: o[0], amount: o.readUInt32BE(1), keysetId: o.subarray(5, 13).toString("hex"), date: o.readUInt32BE(13),
      B_: o.subarray(17, 50).toString("hex"), K: o.subarray(50, 83).toString("hex"),
    })
  }
  return out
}

/** SPEND_ALL_BEGIN's 69 bytes: { total, t (32), refund: R + u*G (33; zeros for an undated payment or no refund key) }. */
function parseBegin(b) {
  if (b.length !== BEGIN_ANSWER_LEN) throw new RangeError(`SPEND_ALL_BEGIN returned ${b.length} bytes, expected ${BEGIN_ANSWER_LEN}`)
  return { total: b.readUInt32BE(0), t: Buffer.from(b.subarray(4, 36)), refund: Buffer.from(b.subarray(36, 69)) }
}

/** GROUP_KEYS' 98 bytes: { t (32), key: P + t*G (33), refund: R + u*G (33; zeros for the date 0 or no refund key) }. */
function parseGroupKeys(b) {
  if (b.length !== GROUP_KEYS_LEN) throw new RangeError(`GROUP_KEYS returned ${b.length} bytes, expected ${GROUP_KEYS_LEN}`)
  return { t: Buffer.from(b.subarray(0, 32)), key: Buffer.from(b.subarray(32, 65)), refund: Buffer.from(b.subarray(65, 98)) }
}

/** LOAD_CHANGE's 83 bytes: the slot, whether the mint's proof was kept with the piece, and the piece (81). */
function parseLoadChange(b) {
  if (b.length !== LOAD_CHANGE_ANSWER_LEN) throw new RangeError(`LOAD_CHANGE returned ${b.length} bytes, expected ${LOAD_CHANGE_ANSWER_LEN}`)
  return { slot: b[0], proofKept: b[1] === 1, piece: parsePiece(b.subarray(2)) }
}

// ── fixture validation (mirrors Fixture.java's checks on the body) ───────────

const FIXTURE_KEYS = new Set(["pin", "mint", "refundKey", "owner", "ownerKey", "anchor", "headers", "proofs", "spentSlots", "limits", "blockedPin"])
const PROOF_KEYS = new Set(["keysetId", "amount", "nonce", "C", "date", "dleq"])
const LIMIT_KEYS = new Set(["day", "payment", "allowance", "rollBudget", "rate", "noPinWindow"])

function isHexOf(value, bytes) {
  if (typeof value !== "string") return false
  const s = /^0x/i.test(value) ? value.slice(2) : value
  return s.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(s)
}

/**
 * The checks the server can run on the body alone, so a malformed fixture fails here, in the test's own stack. The
 * checks against the card as it is (a PIN, a record or an owner set by an earlier fixture, the first set-up over) are
 * the server's (400 CardSimError). Throws on the first problem; returns the fixture unchanged.
 */
function validateFixture(f) {
  if (!f || typeof f !== "object" || Array.isArray(f)) throw new TypeError("fixture must be an object")
  if ("puk" in f) throw new TypeError("puk: there is no PUK on a 2.0 card (D18); the owner's change-pin unblocks a PIN")
  if ("appletVersion" in f) throw new TypeError("appletVersion: the 0.x version masks are gone (D18)")
  for (const k of Object.keys(f)) if (!FIXTURE_KEYS.has(k)) throw new TypeError(`unknown fixture key: ${k}`)
  if (f.pin !== undefined) secretBytes(f.pin, "pin", PIN_MIN_LEN, PIN_MAX_LEN)
  if (f.blockedPin !== undefined && typeof f.blockedPin !== "boolean") throw new TypeError("blockedPin must be true or false")
  if (f.blockedPin && f.pin === undefined) throw new TypeError("blockedPin requires pin")
  if (f.mint !== undefined && (typeof f.mint !== "string" || f.mint.length < 1 || f.mint.length > 77 || !/^[\x00-\x7f]*$/.test(f.mint))) throw new TypeError("mint must be 1-77 ASCII characters")
  if (f.refundKey !== undefined && (f.mint === undefined || !isHexOf(f.refundKey, 33))) throw new TypeError("refundKey is 33 bytes, given with mint")
  if (f.owner !== undefined && typeof f.owner !== "boolean") throw new TypeError("owner must be true or false")
  if (f.owner !== undefined && f.ownerKey !== undefined) throw new TypeError("give owner or ownerKey, not both")
  if (f.ownerKey !== undefined && !isHexOf(f.ownerKey, 32)) throw new TypeError("ownerKey must be 32 bytes (64 hex chars)")
  if (f.anchor !== undefined && (!isHexOf(f.anchor, HEADER_LEN) || !(f.owner || f.ownerKey))) throw new TypeError("anchor is an 80-byte header, given with owner or ownerKey")
  if (f.headers !== undefined && (!Array.isArray(f.headers) || !f.headers.every(h => isHexOf(h, HEADER_LEN)))) throw new TypeError("headers must be 80-byte hex headers")
  if (f.limits !== undefined) {
    if (!f.limits || typeof f.limits !== "object" || Array.isArray(f.limits)) throw new TypeError("limits must be an object")
    for (const k of Object.keys(f.limits)) if (!LIMIT_KEYS.has(k)) throw new TypeError(`unknown key in limits: ${k}`)
    for (const k of ["day", "payment", "allowance", "rate"]) if (f.limits[k] !== undefined) u32(f.limits[k], `limits.${k}`)
    const b = f.limits.rollBudget
    if (b !== undefined && !(Number.isInteger(b) && b >= 1 && b <= ROLL_BUDGET_MOST)) throw new RangeError(`limits.rollBudget must be 1 to ${ROLL_BUDGET_MOST}`)
    const w = f.limits.noPinWindow
    if (w !== undefined && w !== 0 && w !== 1) throw new RangeError("limits.noPinWindow is 0 (the window of 24 hours) or 1 (none)")
  }
  const proofs = f.proofs === undefined ? [] : f.proofs
  if (!Array.isArray(proofs)) throw new TypeError("proofs must be an array")
  if (proofs.length > MAX_PROOFS) throw new RangeError(`proofs has ${proofs.length} entries; the card has ${MAX_PROOFS} slots`)
  if (proofs.length && f.pin === undefined) throw new TypeError("proofs need pin: a load wants the PIN given in this tap (3.0), and a card with no PIN takes nothing (6A97)")
  const nonces = new Set()
  proofs.forEach((p, i) => {
    const where = `proofs[${i}]`
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new TypeError(`${where} must be an object`)
    for (const k of Object.keys(p)) if (!PROOF_KEYS.has(k)) throw new TypeError(`unknown key in ${where}: ${k}`)
    for (const k of ["keysetId", "amount", "nonce", "C"]) if (!(k in p)) throw new TypeError(`${where} is missing ${k}`)
    if (!isHexOf(p.keysetId, 8)) throw new TypeError(`${where}.keysetId must be 8 bytes (16 hex chars)`)
    if (!isHexOf(p.nonce, 32)) throw new TypeError(`${where}.nonce must be 32 bytes (64 hex chars)`)
    if (!isHexOf(p.C, 33) || !/^(0x)?0[23]/i.test(p.C)) throw new TypeError(`${where}.C must be 33 bytes with a 02/03 prefix`)
    if (typeof p.amount !== "number" || !Number.isInteger(p.amount) || p.amount < 1 || p.amount >= MAX_SLOT_AMOUNT) throw new RangeError(`${where}.amount must satisfy 1 <= amount < 2^32`)
    if (p.date !== undefined) u32(p.date, `${where}.date`)
    if (p.dleq !== undefined && !(p.dleq && ["e", "s", "r"].every(k => isHexOf(p.dleq[k], 32)) && Object.keys(p.dleq).length === 3)) throw new TypeError(`${where}.dleq must be {e, s, r}, 32 bytes each`)
    const n = p.nonce.toLowerCase().replace(/^0x/, "")
    if (nonces.has(n)) throw new TypeError(`${where} repeats a nonce: the card refuses a piece already on it (6A94)`)
    nonces.add(n)
  })
  if (f.spentSlots !== undefined) {
    if (!Array.isArray(f.spentSlots)) throw new TypeError("spentSlots must be an array")
    const seen = new Set()
    f.spentSlots.forEach((s, i) => {
      if (!Number.isInteger(s) || s < 0 || s >= proofs.length) throw new RangeError(`spentSlots[${i}] = ${s} is not an index into proofs (${proofs.length} entries)`)
      if (seen.has(s)) throw new RangeError(`spentSlots repeats ${s}`)
      seen.add(s)
    })
  }
  return f
}

// ── the bridge ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

class CardSim {
  /**
   * @param {string} url   the bridge, default http://127.0.0.1:9876
   * @param {{fetch?: Function, timeoutMs?: number}} [opts]
   *   fetch: a fetch to use instead of the global one (tests).
   *   timeoutMs: per-request deadline, default 5000, the same 5 s both apps' transports put on /apdu.
   */
  constructor(url = "http://127.0.0.1:9876", { fetch, timeoutMs = 5000 } = {}) {
    this.url = url.replace(/\/+$/, "")
    this.fetch = fetch || globalThis.fetch
    if (typeof this.fetch !== "function") throw new TypeError("no fetch: Node 18+ or pass { fetch }")
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`)
    this.timeoutMs = timeoutMs
  }

  /** One HTTP round trip, no retry, bounded by `timeoutMs`. Non-2xx → CardSimError. */
  async request(method, path, body) {
    const res = await this.fetch(this.url + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    const text = await res.text()
    let parsed
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = { error: text } }
    if (!res.ok) throw new CardSimError(res.status, parsed, path)
    return parsed
  }

  /** One APDU, never retried. Returns {data: Buffer, sw: number}; a non-9000 status word is returned, not thrown. */
  async apdu(command) {
    const bytes = toBytes(command, "apdu")
    if (bytes.length < 4) throw new RangeError("an APDU is at least CLA INS P1 P2 (4 bytes)")
    const r = await this.request("POST", "/apdu", { hex: bytes.toString("hex") })
    const resp = Buffer.from(r.hex, "hex")
    return { data: resp.subarray(0, resp.length - 2), sw: resp.readUInt16BE(resp.length - 2) }
  }

  /** A brand-new card (same key as before: mint per run). Returns the state document. */
  reset() {
    return this.request("POST", "/reset")
  }

  /** Validate locally, then apply additively. Returns the state document; a refused step is a CardSimError(409). */
  fixture(f) {
    return this.request("POST", "/fixture", validateFixture(f))
  }

  state() {
    return this.request("GET", "/state")
  }

  /** The only retrying call: poll /state until the bridge answers, at most `attempts` times. */
  async waitReady({ attempts = 50, intervalMs = 200 } = {}) {
    let last
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.state()
      } catch (e) {
        last = e
        if (i + 1 < attempts) await sleep(intervalMs)
      }
    }
    throw new Error(`cardsim at ${this.url} not ready after ${attempts} attempts: ${last && last.message}`)
  }

  /** Send and require 9000; CardError(sw, context) otherwise. Returns the data. */
  async send(command, context) {
    const { data, sw } = await this.apdu(command)
    if (sw !== SW.OK) throw new CardError(sw, context)
    return data
  }

  // ── the card ──────────────────────────────────────────────────────────

  /**
   * SELECT by the applet's whole AID, then the package AID (D25). Returns {major, minor}. A 9000 with no version is
   * another applet of the package (the opener, which a partial name reaches) and counts as no answer. Throws the last
   * CardError, or an Error naming the AID that answered 9000 with no version when that was the last answer.
   */
  async select() {
    let last
    for (const aid of SELECT_AIDS) {
      let v
      try {
        v = await this.send(encode.select(aid), "SELECT")
      } catch (e) {
        if (!(e instanceof CardError)) throw e
        last = e
        continue
      }
      if (v.length >= 2) return { major: v[0], minor: v[1] }
      last = new Error(`SELECT ${aid.toString("hex").toUpperCase()} answered 9000 with no version: not the card's applet`)
    }
    throw last
  }

  /**
   * The same command sent again for as long as the card answers 6A98, keep holding (an owner's claim, a VERIFY_PIN
   * serving the wait of wrong tries), and no more than `most` times. Returns the data of the answer that ends it.
   */
  async held(command, context, most) {
    for (let asked = 1; ; asked++) {
      const { data, sw } = await this.apdu(command)
      if (sw === SW.OK) return data
      if (sw !== SW.KEEP_HOLDING || asked >= most) throw new CardError(sw, context)
    }
  }

  /** GET_INFO: P1 = 4 by default (59 bytes on 3.0: the keyset table, the rate, the no-PIN window, the profiles, the loads left). */
  async getInfo(p1 = 4) { return parseInfo(await this.send(encode.getInfo(p1), "GET_INFO")) }
  /** GET_PUBKEY: the card's key P (33). For AUTH and a certificate; never lock ecash to it (keys per load). */
  async getPubkey() { return this.send(encode.getPubkey(), "GET_PUBKEY") }
  async getBalance() { return (await this.send(encode.getBalance(), "GET_BALANCE")).readUInt32BE(0) }
  async getProofCount() { return (await this.send(encode.getProofCount(), "GET_PROOF_COUNT"))[0] }
  /** One status byte per slot, as numbers (0 empty, 1 unspent, 2 spent). */
  async getSlotStatus() { return Array.from(await this.send(encode.getSlotStatus(), "GET_SLOT_STATUS")) }
  /** A slot. A spent one answers 6A88 to a reader with neither the PIN nor the owner's grant in this tap. */
  async getProof(slot) { return parseProof(slot, await this.send(encode.getProof(slot), `GET_PROOF slot ${slot}`)) }
  async getCard() { return parseCard(await this.send(encode.getCard(), "GET_CARD")) }
  /**
   * GET_CARD P1 = 3: the card's secret c, sealed (97 bytes with a refund key, 32 with E on a card with none), right after
   * getNonce(1), whose sixteen bytes it uses up. The raw answer: the holder of the refund key's r (or of E's private
   * half) opens it.
   */
  async getCardSecret(E = null) { return this.send(encode.getCardSecret(E), "GET_CARD c") }
  /** GROUP_KEYS (3.0): a date's keys, under the PIN given in this tap or the owner's grant: { t, key: P + t*G, refund: R + u*G }. */
  async groupKeys(date) { return parseGroupKeys(await this.send(encode.groupKeys(date), "GROUP_KEYS")) }
  /** CERT_READ (3.0): the state, then the pages to the container's length. { sealed, version, length, container }. Public. */
  async certRead() {
    const state = await this.send(encode.certRead(CERT_STATE), "CERT_READ state")
    if (state.length !== 4) throw new Error(`CERT_READ P1 FF returned ${state.length} bytes, expected 4`)
    const out = { sealed: state[0] === 1, version: state[1], length: state.readUInt16BE(2), container: Buffer.alloc(0) }
    if (!out.sealed) return out
    if (!(out.length > 0 && out.length <= CERT_PAGE * CERT_PAGES)) throw new Error(`CERT_READ: a sealed container of ${out.length} bytes; a card keeps 1 to ${CERT_PAGE * CERT_PAGES}`)
    const pages = []
    for (let page = 0; page * CERT_PAGE < out.length; page++) {
      const b = await this.send(encode.certRead(page), `CERT_READ page ${page}`)
      const want = Math.min(CERT_PAGE, out.length - page * CERT_PAGE)
      if (b.length !== want) throw new Error(`CERT_READ page ${page} returned ${b.length} bytes, expected ${want}`)
      pages.push(b)
    }
    out.container = Buffer.concat(pages)
    return out
  }
  /** AUTH: { card: 16 bytes, signature: 64 bytes } over the tagged message (cashu-crypto.authMessage), by the card's key P. */
  async auth(reader) {
    const b = await this.send(encode.auth(reader), "AUTH")
    return { card: b.subarray(0, 16), signature: b.subarray(16) }
  }
  /** GET_CHANGE (3.0): one page of openings owed, up to three, 83 bytes each (parseChange). No PIN. */
  async getChange(page = 0) { return parseChange(await this.send(encode.getChange(page), `GET_CHANGE page ${page}`)) }
  /** Every opening owed: pages from 0 until one answers fewer than three. An opening seen twice (let go between pages) is listed once. */
  async owedChange() {
    const rows = []
    for (let page = 0; page <= CHANGE_MOST / CHANGE_PAGE; page++) {
      const got = await this.getChange(page)
      for (const r of got) if (!rows.some(x => x.number === r.number)) rows.push(r)
      if (got.length < CHANGE_PAGE) break
    }
    return rows
  }
  async getDleq(first, second = null) { return this.send(encode.getDleq(first, second), "GET_DLEQ") }
  /**
   * GET_OUTBOX's scope (2.2): 45 bytes. 3.0 says it in the time in the field that signed the payment, and otherwise to
   * the PIN or the owner's grant in this tap (6982). A card with no record throws CardError 6A88.
   */
  async getOutboxScope() {
    const scope = await this.send(encode.getOutboxScope(), "GET_OUTBOX scope")
    if (scope.length !== OUTBOX_SCOPE_LEN) throw new Error(`GET_OUTBOX: a scope of ${scope.length} bytes, expected ${OUTBOX_SCOPE_LEN}`)
    return scope
  }
  async getOutboxPage(offset, count = OUTBOX_PAGE) { return this.send(encode.getOutboxPage(offset, count), `GET_OUTBOX page at ${offset}`) }
  /**
   * The last payment's whole packet (body || descriptor): the scope, then pages of 255 until one comes back short (or the
   * next offset is past the end, 6A83), then the scope again, which must not have changed: a packet read across a new
   * payment is refused, never mixed. Throws CardError 6A88 with no record, and 6982 outside the paying time in the field
   * without the holder's say.
   */
  async getOutbox() {
    const before = await this.getOutboxScope()
    const parts = []
    for (let offset = 0; offset <= 0xffff; offset += OUTBOX_PAGE) {
      const { data, sw } = await this.apdu(encode.getOutboxPage(offset, OUTBOX_PAGE))
      if (sw === SW.SLOT_OUT_OF_RANGE && offset > 0) break
      if (sw !== SW.OK) throw new CardError(sw, `GET_OUTBOX page at ${offset}`)
      parts.push(data)
      if (data.length < OUTBOX_PAGE) break
    }
    const after = await this.getOutboxScope()
    if (!before.equals(after)) throw new Error("GET_OUTBOX: the record changed while it was read")
    return Buffer.concat(parts)
  }
  /** GET_NONCE: P1 = 0, 16 bytes for one owner's proof; P1 = 1, { nonce, pinKey, signature } for sealing (113 bytes). */
  async getNonce(p1 = 0) {
    const b = await this.send(encode.getNonce(p1), p1 ? "GET_NONCE PIN key" : "GET_NONCE")
    if (p1 === 0) return b
    if (b.length !== PIN_KEY_ANSWER_LEN) throw new Error(`GET_NONCE P1 = 1 returned ${b.length} bytes, expected ${PIN_KEY_ANSWER_LEN}`)
    return { nonce: b.subarray(0, 16), pinKey: b.subarray(16, 49), signature: b.subarray(49) }
  }

  /**
   * SPEND_ALL_BEGIN (3.0): the payment's places, P1 02 (03 with `units`: the reader reads units). Answers { total, t,
   * refund }: what the pieces are worth, the tweak of the payment's date (the card's key for it is P + t*G,
   * cashu-crypto.tweakedKey) and the date's refund key R + u*G (zeros for an undated payment).
   */
  async spendAllBegin(slots, opts = {}) { return parseBegin(await this.send(encode.spendAllBegin(slots, opts), "SPEND_ALL_BEGIN")) }
  /** The till's outputs, six to a command; with `keyset` (8 bytes), P1 01 on each, naming the keyset they are posted under. */
  async spendAllOutputs(outputs, keyset = null) {
    for (let i = 0; i < outputs.length; i += 6) await this.send(encode.spendAllOutputs(outputs.slice(i, i + 6), keyset), "SPEND_ALL_OUTPUTS")
  }
  /** One change output the card makes for itself, bound to the mint's key K for `amount` and made in `keyset` (taught to the card); answers its B_, 33 bytes. */
  async spendAllChange(amount, K, keyset) {
    const b = await this.send(encode.spendAllChange(amount, K, keyset), "SPEND_ALL_CHANGE")
    if (b.length !== 33) throw new Error(`SPEND_ALL_CHANGE returned ${b.length} bytes, expected 33`)
    return b
  }
  /** SPEND_ALL_SIGN, sent again for as long as the card answers "not yet" (00 01; 3.0: every payment waits a floor). Answers { signature, waits }. Not idempotent. */
  async spendAllSign({ maxWaits = 1100 } = {}) {
    for (let waits = 0; waits <= maxWaits; waits++) {
      const b = await this.send(encode.spendAllSign(), "SPEND_ALL_SIGN")
      if (b.length === 64) return { signature: b, waits }
      if (b.length !== 2) throw new Error(`SPEND_ALL_SIGN answered ${b.length} bytes: neither a signature nor "not yet"`)
    }
    throw new Error(`the card made the payment wait more than ${maxWaits} times`)
  }
  async spendAllAgain(messageHash = null) { return this.send(encode.spendAllAgain(messageHash), "SPEND_ALL_AGAIN") }
  /**
   * LOAD_CHANGE (3.0): opening `k` made into its piece from the mint's answer for its B_ (C_, K, and the DLEQ e and s),
   * which the card checks and unblinds. Any reader, no PIN, once the opening's key is shown (showOpeningKey). Answers
   * { slot, proofKept, piece }. Not idempotent: a second LOAD_CHANGE of the same opening is 6A88.
   */
  async loadChange(k, C_, K, e, s) { return parseLoadChange(await this.send(encode.loadChange(k, C_, K, e, s), `LOAD_CHANGE opening ${k}`)) }

  // KEYSET_KEYS (3.0)
  async keysetKeysBegin(keyset, tail) { await this.send(encode.keysetKeysBegin(keyset, tail), "KEYSET_KEYS begin") }
  async keysetKeysKeys(keys) { await this.send(encode.keysetKeysKeys(keys), "KEYSET_KEYS keys") }
  async keysetKeysFinish() {
    const id = await this.send(encode.keysetKeysFinish(), "KEYSET_KEYS finish")
    if (id.length !== 8 && id.length !== 33) throw new Error(`KEYSET_KEYS P1 2 returned ${id.length} bytes, expected 8 or 33`)
    return id
  }
  async keysetKeysShow(opening, index, path, otherKey = null, otherKeyset = null) {
    await this.send(encode.keysetKeysShow(opening, index, path, otherKey, otherKeyset), `KEYSET_KEYS show opening ${opening}`)
  }
  /**
   * Teaches the card a keyset (keysetFromMint's answer), under the PIN given in this tap: begin, the keys six to a command,
   * finish. The card answers the ID it worked out, which must be the keyset's. A card that was taught it keeps the tree's
   * top in the keyset's entry (an entry a piece of it made); the card's change is made only in a keyset it was taught.
   */
  async teachKeyset(ks) {
    await this.keysetKeysBegin(ks.keyset8, ks.tail)
    for (let i = 0; i < ks.keys.length; i += KEYSET_KEYS_PER_COMMAND) await this.keysetKeysKeys(ks.keys.slice(i, i + KEYSET_KEYS_PER_COMMAND))
    const id = await this.keysetKeysFinish()
    if (!id.equals(ks.id)) throw new Error(`KEYSET_KEYS: the card worked out ${id.toString("hex")}, not ${ks.id.toString("hex")}`)
    return id
  }
  /**
   * KEYSET_KEYS P1 3 for an opening (a getChange row): its key shown to be one of the keyset's (keysetFromMint's answer),
   * by the path of the leaf (its amount, its K) in the keyset's tree. Any reader, no PIN. With `otherKey` (and
   * `otherKeyset`, another taught keyset of its unit), the opening is bound to that key instead, under the PIN and the
   * holder's say, in a tap that paid nothing; the leaf is then the other key's.
   */
  async showOpeningKey(opening, ks, { otherKey = null, otherKeyset = null } = {}) {
    const K = compressedPoint(otherKey !== null ? otherKey : opening.K, "K")
    const index = ks.keys.findIndex(([a, k]) => a === BigInt(opening.amount) && k.equals(K))
    if (index < 0) throw new Error(`the keyset ${ks.id.toString("hex")} has no key ${K.toString("hex")} for ${opening.amount}`)
    await this.keysetKeysShow(opening.number, index, keysetPath(ks.keys, index), otherKey === null ? null : K, otherKeyset)
    return index
  }

  /** LOAD_PROOF (3.0: P2 02, the word that the piece is locked to the card's keys for its date). Wants the PIN given in this tap. Returns the slot. Not idempotent: a replay is 6A94. */
  async loadProof(keyset, amount, nonce, C, date = 0, dleq = null, opts = {}) {
    return (await this.send(encode.loadProof(keyset, amount, nonce, C, date, dleq, opts), "LOAD_PROOF"))[0]
  }
  /** CLEAR_SPENT: the PIN given in this tap. Only once every spent piece is shown spent at the mint (NUT-CCP). */
  async clearSpent() { return (await this.send(encode.clearSpent(), "CLEAR_SPENT"))[0] }
  async setHeader(header) { return (await this.send(encode.setHeader(header), "SET_HEADER")).readUInt32BE(0) }
  /** VERIFY_PIN, sent again while the card answers 6A98 (a card with no owner serving the wait of wrong tries). */
  async verifyPin(pin) { await this.held(encode.verifyPin(pin), "VERIFY_PIN", PIN_WAIT_MOST) }
  async setPin(pin) { await this.send(encode.setPin(pin), "SET_PIN") }
  /**
   * An owner's claim (SET_OWNER on a card with no owner): the PIN given in this tap, in the card's first set-up, on an
   * empty card; the same data asked six times, the first five answered 6A98. After a claim no payment is signed in that
   * time in the field (6985).
   */
  async claimOwner(anchor = null, ownerKeyHex = TEST_OWNER_PRIVATE) {
    await this.held(encode.setOwner(ownerPublicKey(ownerKeyHex), anchor), "SET_OWNER", CLAIM_MOST)
  }

  // the owner's commands: GET_NONCE, then the command with a proof signed by `ownerKeyHex` (default the TEST key)
  async changePin(newPin, ownerKeyHex = TEST_OWNER_PRIVATE) {
    const pin = secretBytes(newPin, "new pin", PIN_MIN_LEN, PIN_MAX_LEN)
    await this.send(encode.changePin(ownerProof(LABEL.CHANGE_PIN, await this.getNonce(), pin, ownerKeyHex), pin), "CHANGE_PIN")
  }
  /**
   * ALLOW_LOAD, the owner's grant for this tap. A 3.0 card answers 6200 where the grant is given: it opens no load (a load
   * wants the PIN) and signs nothing; under it the history is read, GET_INFO says the limit on one payment and the rate,
   * and a second payment in the time in the field waits the floor alone. A 9000 is a card of 2.2 or earlier, whose grant
   * opens loads with no PIN: refused here.
   */
  async allowLoad(ownerKeyHex = TEST_OWNER_PRIVATE) {
    const { sw } = await this.apdu(encode.allowLoad(ownerProof(LABEL.LOAD, await this.getNonce(), Buffer.alloc(0), ownerKeyHex)))
    if (sw === SW.GRANT_GIVEN) return
    if (sw === SW.OK) throw new Error("ALLOW_LOAD answered 9000: a card of 2.2 or earlier, whose grant opens a load with no PIN; a card of 3.0 answers 6200")
    throw new CardError(sw, "ALLOW_LOAD")
  }
  async setLimit(limits, ownerKeyHex = TEST_OWNER_PRIVATE) {
    const value = limitValue(limits)
    await this.send(encode.setLimit(ownerProof(LABEL.SET_LIMIT, await this.getNonce(), value, ownerKeyHex), value), "SET_LIMIT")
  }
  async refresh(header, ownerKeyHex = TEST_OWNER_PRIVATE) {
    const h = expectLen(toBytes(header, "header"), HEADER_LEN, "a block header")
    return (await this.send(encode.refresh(ownerProof(LABEL.REFRESH, await this.getNonce(), h, ownerKeyHex), h), "REFRESH")).readUInt32BE(0)
  }
}

const constants = Object.freeze({
  CLA, INS, SW, PACKAGE_AID, APPLET_AID, SELECT_AIDS, OLD_AIDS, VERSION, OUTBOX_SCOPE_LEN, OUTBOX_PAGE, MAX_PROOFS, PROOF_SIZE, DLEQ_LEN, HEADER_LEN, OUTPUT_LEN,
  LOCK_CONFIRM_BYTE, MAX_SLOT_AMOUNT, PIN_MIN_LEN, PIN_MAX_LEN, ROLL_BUDGET_DEFAULT, ROLL_BUDGET_MOST, STATUS_NAMES,
  PIN_STATE_NAMES, LABEL, TEST_OWNER_PRIVATE, BEGIN_DATE_KEYS, BEGIN_UNITS, BEGIN_ANSWER_LEN, LOAD_DATE_KEYS, LOAD_UNIT_FIRST,
  GROUP_KEYS_LEN, CHANGE_ROW_LEN, CHANGE_PAGE, CHANGE_MOST, SPEND_ALL_CHANGE_LEN, LOAD_CHANGE_LEN, LOAD_CHANGE_ANSWER_LEN,
  KEYSET_KEY_WIRE, KEYSET_KEYS_PER_COMMAND, KEYSET_KEYS_MOST, KEYSET_TAIL_MOST, KEYSET_PATH_MOST, KEYSET_UNITS, CERT_STATE,
  CERT_PAGE, CERT_PAGES, PIN_KEY_ANSWER_LEN, CLAIM_MOST, PIN_WAIT_MOST, PROFILE_NAMES, LAST_UNIT_NAMES, UNIT_NAMES,
})

module.exports = {
  CardSim, CardError, CardSimError, encode, constants,
  validateFixture, validateSlotAmount, parseInfo, parseProof, parsePiece, parseCard, parseChange, parseBegin, parseGroupKeys,
  parseLoadChange, describeSw, toBytes, ownerProof, ownerData, ownerPublicKey, limitValue, uncompressedPoint, compressedPoint,
  keysetTail, keysetId, keysetLeaf, keysetLevels, keysetPath, foldPath, keysetFromMint,
}
