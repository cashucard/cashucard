"use strict"
/*
 * cashu-crypto.cjs — the little Cashu and secp256k1 a test of the card needs, zero-dependency (Node 18+, BigInt and
 * node:crypto only), so the cardsim e2e can mint, check and swap without a wallet library:
 *
 *   - secp256k1 points (affine, BigInt), compressed and uncompressed encodings;
 *   - NUT-00 hash_to_curve, blinding and unblinding;
 *   - NUT-12 DLEQ verification, of a blind signature (e, s) and of a proof (e, s, r) as the card keeps it;
 *   - BIP-340 verification, for the card's AUTH and payment signatures;
 *   - the keys per load (protocol 2.3, spec/APDU.md "Keys per load"): a date's tweak t, the card's key for the date
 *     P + t*G and the refund key for the date R + u*G, worked out from the card's secret c;
 *   - the format-4 secret the card signs (NUT-CCP's card proofs), which names the card's key for the piece's date, and
 *     the NUT-11 SIG_ALL message.
 *
 * Speed is irrelevant: a test makes a few dozen points. Checked in cashu-crypto.test.cjs against NUT-00's vectors, the
 * card's own spec/vectors/secret.json, and (with CARDSIM_URL and MINT_URL set) a real Nutshell mint.
 */
const crypto = require("node:crypto")

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n]

const mod = (a, m = P) => ((a % m) + m) % m
function pow(b, e, m) {
  let r = 1n
  b = mod(b, m)
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}
const inv = (a, m = P) => pow(a, m - 2n, m)

function add(p, q) {
  if (!p) return q
  if (!q) return p
  if (p[0] === q[0]) {
    if (mod(p[1] + q[1]) === 0n) return null
    const l = mod(3n * p[0] * p[0] * inv(2n * p[1]))
    const x = mod(l * l - 2n * p[0])
    return [x, mod(l * (p[0] - x) - p[1])]
  }
  const l = mod((q[1] - p[1]) * inv(q[0] - p[0]))
  const x = mod(l * l - p[0] - q[0])
  return [x, mod(l * (p[0] - x) - p[1])]
}
const neg = p => (p ? [p[0], mod(-p[1])] : null)
function mul(k, p = G) {
  let r = null
  let q = p
  k = mod(k, N)
  while (k > 0n) {
    if (k & 1n) r = add(r, q)
    q = add(q, q)
    k >>= 1n
  }
  return r
}

/** Bytes from a Buffer, a Uint8Array or a hex string (every string here is hex). */
const buf = b => (typeof b === "string" ? Buffer.from(b.replace(/^0x/i, ""), "hex") : Buffer.from(b))
const hexOf = b => buf(b).toString("hex")
const int = b => BigInt("0x" + (buf(b).toString("hex") || "0"))
const bytes32 = n => Buffer.from(n.toString(16).padStart(64, "0"), "hex")
const sha256 = (...parts) => crypto.createHash("sha256").update(Buffer.concat(parts.map(x => Buffer.from(x)))).digest()

function liftX(x) {
  if (x >= P) return null
  const y2 = mod(x * x * x + 7n)
  const y = pow(y2, (P + 1n) / 4n, P)
  if (mod(y * y) !== y2) return null
  return [x, y]
}

/** A point from 33 (02/03) or 65 (04) bytes, or hex; null for one that is not on the curve. */
function point(b) {
  b = buf(b)
  if (b.length === 33 && (b[0] === 2 || b[0] === 3)) {
    const p = liftX(int(b.subarray(1)))
    if (!p) return null
    return (p[1] & 1n) === BigInt(b[0] & 1) ? p : [p[0], mod(-p[1])]
  }
  if (b.length === 65 && b[0] === 4) {
    const p = [int(b.subarray(1, 33)), int(b.subarray(33))]
    return mod(p[1] * p[1]) === mod(p[0] ** 3n + 7n) ? p : null
  }
  return null
}
const compressed = p => Buffer.concat([Buffer.from([p[1] & 1n ? 3 : 2]), bytes32(p[0])])
const uncompressed = p => Buffer.concat([Buffer.from([4]), bytes32(p[0]), bytes32(p[1])])

// ── NUT-00 ────────────────────────────────────────────────────────────────────
const DOMAIN = Buffer.from("Secp256k1_HashToCurve_Cashu_")

/** NUT-00 hash_to_curve: Y = '02' || SHA-256(SHA-256(DOMAIN || x) || counter (4, little-endian)), the first on the curve. */
function hashToCurve(message) {
  const msgHash = sha256(DOMAIN, Buffer.from(message))
  for (let c = 0; c < 2 ** 16; c++) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32LE(c)
    const p = point(Buffer.concat([Buffer.from([2]), sha256(msgHash, counter)]))
    if (p) return p
  }
  throw new Error("no point found")
}

/** B_ = Y + r*G for a secret's text; r is a 32-byte scalar (fresh when not given). Returns { B_, r, Y }. */
function blind(secret, r = null) {
  const rr = r === null ? mod(int(crypto.randomBytes(32)), N) || 1n : (typeof r === "bigint" ? r : int(r))
  const Y = hashToCurve(Buffer.from(secret, "utf8"))
  return { B_: compressed(add(Y, mul(rr))), r: rr, Y }
}

/** C = C_ - r*K. */
function unblind(C_, r, K) {
  return compressed(add(point(C_), neg(mul(typeof r === "bigint" ? r : int(r), point(K)))))
}

// ── NUT-12 ────────────────────────────────────────────────────────────────────
/** hash(R1, R2, K, C_) = SHA-256 of the four uncompressed points' hex, concatenated as text (Nutshell's hash_e). */
function hashE(...points) {
  return sha256(Buffer.from(points.map(p => hexOf(uncompressed(p))).join(""), "utf8"))
}

/** The mint's DLEQ on a blind signature: R1 = s*G - e*K, R2 = s*B_ - e*C_, e == hash(R1, R2, K, C_). */
function verifyBlindDleq(B_, C_, e, s, K) {
  const [b, c, k] = [point(B_), point(C_), point(K)]
  if (!b || !c || !k) return false
  const ee = int(e), ss = int(s)
  const R1 = add(mul(ss), neg(mul(ee, k)))
  const R2 = add(mul(ss, b), neg(mul(ee, c)))
  if (!R1 || !R2) return false
  return hexOf(hashE(R1, R2, k, c)) === hexOf(bytes32(ee))
}

/** The DLEQ a holder checks for a piece (e, s, r kept on the card): C_ = C + r*K, B_ = Y + r*G, then the blind check. */
function verifyProofDleq(secret, C, e, s, r, K) {
  const rr = int(r)
  const Y = hashToCurve(Buffer.from(secret, "utf8"))
  const C_ = compressed(add(point(C), mul(rr, point(K))))
  const B_ = compressed(add(Y, mul(rr)))
  return verifyBlindDleq(B_, C_, e, s, K)
}

// ── BIP-340 ───────────────────────────────────────────────────────────────────
function taggedHash(tag, msg) {
  const t = sha256(Buffer.from(tag, "utf8"))
  return sha256(t, t, msg)
}

/** BIP-340 verify: `pub` 32 (x-only) or 33 (compressed) bytes, `msg` 32 bytes, `sig` 64 bytes. */
function schnorrVerify(pub, msg, sig) {
  pub = buf(pub)
  sig = buf(sig)
  const px = pub.length === 33 ? pub.subarray(1) : pub
  const P_ = liftX(int(px))
  if (!P_ || sig.length !== 64) return false
  const Pe = (P_[1] & 1n) === 0n ? P_ : [P_[0], mod(-P_[1])]
  const r = int(sig.subarray(0, 32)), s = int(sig.subarray(32))
  if (r >= P || s >= N) return false
  const e = mod(int(taggedHash("BIP0340/challenge", Buffer.concat([sig.subarray(0, 32), px, buf(msg)]))), N)
  const R = add(mul(s), neg(mul(e, Pe)))
  return !!R && (R[1] & 1n) === 0n && R[0] === r
}

// ── the card ─────────────────────────────────────────────────────────────────
// Keys per load (2.3): t = SHA-256("CashuCard/key" || c || date (4, big-endian)) mod n, and the card's key for the date
// is P + t*G; u = SHA-256("CashuCard/refund-key" || c || date) mod n, and the refund key for the date is R + u*G.
const LABEL_KEY = "CashuCard/key"
const LABEL_REFUND_KEY = "CashuCard/refund-key"

function dateBytes(date) {
  if (!Number.isInteger(date) || date < 0 || date >= 2 ** 32) throw new RangeError(`a date is 0 to 2^32 - 1, got ${date}`)
  const d = Buffer.alloc(4)
  d.writeUInt32BE(date)
  return d
}

/** SHA-256(label || c (32) || date (4)) mod n: t with "CashuCard/key", u with "CashuCard/refund-key". */
function dateTweak(label, c, date) {
  const cc = buf(c)
  if (cc.length !== 32) throw new RangeError(`the card's secret c is 32 bytes, got ${cc.length}`)
  return mod(int(sha256(Buffer.from(label, "ascii"), cc, dateBytes(date))), N)
}

/** P + t*G: the card's key for the date whose tweak is t (32 bytes, as SPEND_ALL_BEGIN and GROUP_KEYS answer it). */
function tweakedKey(key, t) {
  const p = point(key)
  if (!p) throw new Error("not a point of the curve")
  const sum = add(p, mul(typeof t === "bigint" ? t : int(t)))
  if (!sum) throw new Error("the tweak cancels the key")
  return compressed(sum)
}

/**
 * A date's keys from the card's secret c, as GROUP_KEYS answers them: { t (32), key: P + t*G (33), refund: R + u*G (33) }.
 * The refund is 33 zeros for the date 0 (an undated piece names no refund key) and on a card with no refund key R.
 */
function dateKeys(c, cardKey, refundKey, date) {
  const t = dateTweak(LABEL_KEY, c, date)
  const key = tweakedKey(cardKey, t)
  let refund = Buffer.alloc(33)
  if (refundKey && buf(refundKey).some(b => b !== 0) && date !== 0) refund = tweakedKey(refundKey, dateTweak(LABEL_REFUND_KEY, c, date))
  return { t: bytes32(t), key, refund }
}

/**
 * The format-4 secret a card signs (NUT-CCP's card proofs), on 2.3 under the keys per load: `dateKey` is the card's key
 * for the piece's date, P + t*G (never the card's key P itself: no 2.3 card signs with P alone), and a dated piece names
 * the date's refund key, R + u*G, in its refund tag; SIG_ALL last. dateKeys() works both out.
 */
function cardSecret(nonce, dateKey, date = 0, dateRefund = null) {
  // hex text as given, in lower case; bytes as their hex
  const text = v => (typeof v === "string" ? v.toLowerCase() : hexOf(v))
  const head = `["P2PK",{"nonce":"${text(nonce)}","data":"${text(dateKey)}","tags":[`
  if (!date) return head + '["sigflag","SIG_ALL"]]}]'
  if (!dateRefund || !buf(dateRefund).some(b => b !== 0)) throw new Error("a dated piece names the refund key for its date")
  return head + `["locktime","${date}"],["refund","${text(dateRefund)}"],["sigflag","SIG_ALL"]]}]`
}

/** The NUT-11 SIG_ALL message: every input's secret and C (hex), then every output's amount (decimal) and B_ (hex). */
function sigAllMessage(inputs, outputs) {
  let m = ""
  for (const i of inputs) m += i.secret + hexOf(i.C)
  for (const o of outputs) m += String(o.amount) + hexOf(o.B_)
  return sha256(Buffer.from(m, "utf8"))
}

/**
 * A payment's signature checked as a mint checks it: BIP-340 under the key its secrets name, the card's key for the
 * payment's date (P + t*G), over the SIG_ALL message.
 */
function verifyPayment(dateKey, inputs, outputs, signature) {
  return schnorrVerify(dateKey, sigAllMessage(inputs, outputs), signature)
}

/** AUTH's message: SHA-256(T || T || reader (16) || card (16) || card key (33)), T = SHA-256("CashuCard/auth"). AUTH is under P. */
function authMessage(reader, card, key) {
  return taggedHash("CashuCard/auth", Buffer.concat([buf(reader), buf(card), buf(key)]))
}

module.exports = {
  P, N, G, add, neg, mul, point, compressed, uncompressed, sha256, buf, hexOf, int, bytes32,
  hashToCurve, blind, unblind, hashE, verifyBlindDleq, verifyProofDleq, taggedHash, schnorrVerify,
  LABEL_KEY, LABEL_REFUND_KEY, dateTweak, tweakedKey, dateKeys, cardSecret, sigAllMessage, verifyPayment, authMessage,
}
