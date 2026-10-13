// node --test tools/cardsim/cashu-crypto.test.cjs
//
// The Cashu arithmetic the cardsim e2e trusts, held to published vectors and to the card's own: NUT-00's
// hash_to_curve, the applet's spec/vectors/secret.json (format-4 secrets, messages, BIP-340 signatures, AUTH), and a
// blind signature and its NUT-12 proof made here with a known mint key, checked both ways and refused when altered.
const test = require("node:test")
const assert = require("node:assert/strict")
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

test("the card's vectors: the format-4 secret text, its message, and the card's BIP-340 signature", () => {
  for (const p of vectors.pieces) {
    const secret = cc.cardSecret(p.nonce, vectors.cardKey, p.date, vectors.refundKey)
    assert.equal(secret, p.secret)
    const message = cc.sigAllMessage([{ secret, C: p.C }], [])
    assert.equal(cc.hexOf(message), p.message, "a payment of one piece and no outputs")
    assert.ok(cc.schnorrVerify(vectors.cardKey, message, p.signature))
    const bad = Buffer.from(p.signature, "hex")
    bad[63] ^= 1
    assert.ok(!cc.schnorrVerify(vectors.cardKey, message, bad), "a signature with a bit flipped fails")
  }
  assert.throws(() => cc.cardSecret("ab".repeat(32), vectors.cardKey, 5), /refund key/)
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
  const secret = cc.cardSecret("cd".repeat(32), vectors.cardKey)
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
