// node --test tools/cardsim/cashu-crypto.test.cjs
//
// The Cashu arithmetic the cardsim e2e trusts, held to published vectors and to the card's own: NUT-00's
// hash_to_curve, the applet's spec/vectors/secret.json (each date's keys from c, format-4 secrets naming them,
// messages, BIP-340 signatures under the date's key, AUTH under the card's key), and a
// blind signature and its NUT-12 proof made here with a known mint key, checked both ways and refused when altered;
// BIP-340 signing held to BIP-340's own vectors, and c sealed to a refund key opened with its r.
const test = require("node:test")
const assert = require("node:assert/strict")
const nodeCrypto = require("node:crypto")
const path = require("node:path")
const cc = require("./cashu-crypto.cjs")
const vectors = require(path.resolve(__dirname, "../../spec/vectors/secret.json"))

test("hash_to_curve matches NUT-00's test vectors", () => {
  const cases = {
    ["00".repeat(32)]: "024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725",
    ["00".repeat(31) + "01"]: "022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf",
    ["00".repeat(31) + "02"]: "026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f",
  }
  for (const [x, Y] of Object.entries(cases)) assert.equal(cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(x, "hex")))), Y, x)
})

// An independent derivation of a date's keys for the vectors below: the tweak is hashed here with node:crypto and the
// point arithmetic is cashu-crypto's, so dateKeys() is checked against the spec's formula, not against itself.
const sha = (...parts) => nodeCrypto.createHash("sha256").update(Buffer.concat(parts)).digest()
function independentKeys(c, date, P, R) {
  const d = Buffer.alloc(4)
  d.writeUInt32BE(date)
  const t = BigInt("0x" + sha(Buffer.from("CashuCard/key"), Buffer.from(c, "hex"), d).toString("hex")) % cc.N
  const key = cc.compressed(cc.add(cc.point(P), cc.mul(t)))
  let refund = Buffer.alloc(33)
  if (date !== 0) {
    const u = BigInt("0x" + sha(Buffer.from("CashuCard/refund-key"), Buffer.from(c, "hex"), d).toString("hex")) % cc.N
    refund = cc.compressed(cc.add(cc.point(R), cc.mul(u)))
  }
  return { t: t.toString(16).padStart(64, "0"), key: key.toString("hex"), refund: refund.toString("hex") }
}

test("the card's vectors: each piece's t, key and refund key for its date, worked out from c two ways", () => {
  assert.equal(vectors.c, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
  for (const p of vectors.pieces) {
    const mine = independentKeys(vectors.c, p.date, vectors.cardKey, vectors.refundKey)
    assert.deepEqual({ t: p.t, key: p.key, refund: p.refund }, mine, `date ${p.date}: the vector is the spec's formula`)
    const k = cc.dateKeys(vectors.c, vectors.cardKey, vectors.refundKey, p.date)
    assert.deepEqual({ t: cc.hexOf(k.t), key: cc.hexOf(k.key), refund: cc.hexOf(k.refund) }, mine, `date ${p.date}: dateKeys`)
    assert.equal(cc.hexOf(cc.tweakedKey(vectors.cardKey, p.t)), p.key, "P + t*G from the t a till is given")
    if (p.date === 0) assert.equal(p.refund, "00".repeat(33), "the date 0 names no refund key")
  }
  assert.equal(cc.hexOf(cc.dateKeys(vectors.c, vectors.cardKey, "00".repeat(33), 5).refund), "00".repeat(33), "nor a card with no refund key")
  assert.equal(cc.hexOf(cc.dateKeys(vectors.c, vectors.cardKey, null, 5).refund), "00".repeat(33))
  assert.throws(() => cc.dateKeys(vectors.c.slice(2), vectors.cardKey, null, 0), /32 bytes/)
  assert.throws(() => cc.dateKeys(vectors.c, vectors.cardKey, null, 2 ** 32), /date/)
  assert.throws(() => cc.dateKeys(vectors.c, vectors.cardKey, null, -1), /date/)
})

test("the card's vectors: the format-4 secret names the date's key and refund key; its message; the signature is under the date's key", () => {
  for (const p of vectors.pieces) {
    const secret = cc.cardSecret(p.nonce, p.key, p.date, p.refund)
    assert.equal(secret, p.secret)
    assert.ok(secret.includes(`"data":"${p.key}"`) && !secret.includes(vectors.cardKey), "never the card's key P")
    if (p.date !== 0) assert.ok(secret.includes(`["locktime","${p.date}"],["refund","${p.refund}"]`), "the date's refund key")
    const message = cc.sigAllMessage([{ secret, C: p.C }], [])
    assert.equal(cc.hexOf(message), p.message, "a payment of one piece and no outputs")
    assert.ok(cc.schnorrVerify(p.key, message, p.signature), "BIP-340 under P + t*G")
    assert.ok(cc.verifyPayment(p.key, [{ secret, C: p.C }], [], p.signature))
    assert.ok(!cc.schnorrVerify(vectors.cardKey, message, p.signature), "and not under the card's key P")
    const bad = Buffer.from(p.signature, "hex")
    bad[63] ^= 1
    assert.ok(!cc.schnorrVerify(p.key, message, bad), "a signature with a bit flipped fails")
  }
  assert.throws(() => cc.cardSecret("ab".repeat(32), vectors.pieces[1].key, 5), /refund key/)
  assert.throws(() => cc.cardSecret("ab".repeat(32), vectors.pieces[1].key, 5, "00".repeat(33)), /refund key/)
})

test("the card's AUTH vector: the tagged message and its signature", () => {
  const a = vectors.auth
  assert.equal(a.tag, "CashuCard/auth")
  const m = cc.authMessage(a.readerNonce, a.cardNonce, vectors.cardKey)
  assert.equal(cc.hexOf(m), a.message)
  assert.ok(cc.schnorrVerify(vectors.cardKey, m, a.signature))
})

test("a blind signature and its DLEQ, made here with a known mint key, verify blind and as a proof, and fail when altered", () => {
  const a = 0x1234567890abcdefn
  const K = cc.compressed(cc.mul(a))
  const secret = cc.cardSecret("cd".repeat(32), vectors.pieces[0].key)
  const { B_, r } = cc.blind(secret, 5n)
  const C_ = cc.compressed(cc.mul(a, cc.point(B_)))
  // the mint's DLEQ: R1 = p*G, R2 = p*B_, e = hash(R1, R2, K, C_), s = p + e*a
  const p = 0x42n
  const e = cc.int(cc.hashE(cc.mul(p), cc.mul(p, cc.point(B_)), cc.point(K), cc.point(C_)))
  const s = (p + e * a) % cc.N
  const [eh, sh] = [cc.hexOf(cc.bytes32(e)), cc.hexOf(cc.bytes32(s))]
  assert.ok(cc.verifyBlindDleq(B_, C_, eh, sh, K))
  const C = cc.unblind(C_, r, K)
  assert.equal(cc.hexOf(C), cc.hexOf(cc.compressed(cc.mul(a, cc.hashToCurve(Buffer.from(secret))))), "C = a*Y")
  assert.ok(cc.verifyProofDleq(secret, C, eh, sh, cc.bytes32(r), K))
  assert.ok(!cc.verifyProofDleq(secret.replace("cd", "ce"), C, eh, sh, cc.bytes32(r), K), "another secret")
  assert.ok(!cc.verifyBlindDleq(B_, C_, eh, cc.hexOf(cc.bytes32(s + 1n)), K), "another s")
  assert.ok(!cc.verifyBlindDleq(B_, C_, eh, sh, cc.compressed(cc.mul(a + 1n))), "another mint key")
})

// BIP-340's test-vectors.csv, its signing cases: the secret key, the aux bytes and the message give the signature, byte
// for byte (the same four tools/cardctl/test_bip340.py verifies).
const BIP340_SIGNING = [
  ["0000000000000000000000000000000000000000000000000000000000000003", "F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9",
    "0000000000000000000000000000000000000000000000000000000000000000", "0000000000000000000000000000000000000000000000000000000000000000",
    "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0"],
  ["B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF", "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    "0000000000000000000000000000000000000000000000000000000000000001", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A"],
  ["C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9", "DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8",
    "C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906", "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C",
    "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7"],
  ["0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710", "25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517",
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    "7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3"],
]

test("BIP-340 signing reproduces BIP-340's own vectors, and a fresh signature verifies under its key and no other", () => {
  for (const [sk, pk, aux, msg, sig] of BIP340_SIGNING) {
    assert.equal(cc.hexOf(cc.bytes32(cc.mul(cc.int(sk))[0])), pk.toLowerCase(), "the vector's public key")
    assert.equal(cc.hexOf(cc.schnorrSign(sk, msg, aux)), sig.toLowerCase())
    assert.ok(cc.schnorrVerify(pk, msg, sig))
  }
  const d = cc.int(cc.sha256(Buffer.from("a refund key")))
  const msg = cc.sha256(Buffer.from("a SIG_ALL message"))
  const sig = cc.schnorrSign(d, msg)
  assert.ok(cc.schnorrVerify(cc.compressed(cc.mul(d)), msg, sig))
  assert.ok(!cc.schnorrVerify(cc.compressed(cc.mul(d + 1n)), msg, sig), "not under another key")
  assert.throws(() => cc.schnorrSign(0n, msg), /private key/)
})

test("c sealed to the refund key opens with r: r*K = k*R, the seal's block over x(k*R), K, the sixteen bytes and 16", () => {
  const r = 0x5eed5eedn, k = 0x0badf00dn
  const R = cc.mul(r)
  const nonce = Buffer.alloc(16, 0xa5)
  const c = Buffer.from(vectors.c, "hex")
  const K = cc.uncompressed(cc.mul(k))
  const block = cc.sha256(Buffer.from("CashuCard/seal"), Buffer.from([1]), cc.bytes32(cc.mul(k, R)[0]), K, nonce, Buffer.from([0x16]))
  const answer = Buffer.concat([K, Buffer.from(c.map((b, i) => b ^ block[i]))])
  assert.equal(cc.hexOf(cc.openCardSecret(answer, nonce, r)), vectors.c)
  assert.notEqual(cc.hexOf(cc.openCardSecret(answer, nonce, r + 1n)), vectors.c, "another key opens nothing")
  assert.throws(() => cc.openCardSecret(answer.subarray(1), nonce, r), /97 bytes/)
})
