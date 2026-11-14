// node --test tools/cardsim/client.test.cjs
//
// Pure tests always run: the encoders are asserted against spec/APDU.md's tables, the vectors in
// tools/cardctl/test_apdu.py and the applet's recorded LOAD_CHANGE (applet/target/load-change-vector.json, written by
// CashuAppletTest.testARecordedLoadChange), so the JS client and the Python driver put the same bytes on the wire. The
// integration tests need a running bridge and run only with CARDSIM_URL set (CI starts the jar first):
//
//   CARDSIM_URL=http://127.0.0.1:9876 node --test tools/cardsim/client.test.cjs
//
// The swap at a real mint is e2e-swap.test.cjs (CARDSIM_URL and MINT_URL).
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const nodeCrypto = require("node:crypto")
const {
  CardSim, CardError, CardSimError, encode, constants, validateFixture, validateSlotAmount, parseInfo, parseProof, parseCard,
  parseChange, parseBegin, parseGroupKeys, parseLoadChange, describeSw, ownerProof, ownerData, ownerPublicKey, limitValue,
  uncompressedPoint, compressedPoint, keysetTail, keysetId, keysetLeaf, keysetLevels, keysetPath, foldPath, keysetFromMint,
} = require("./client.cjs")
const cc = require("./cashu-crypto.cjs")

const hex = s => Buffer.from(s.replace(/\s+/g, ""), "hex")
const bytes = n => Buffer.from(Array.from({ length: n }, (_, i) => i))
const g33 = k => cc.compressed(cc.mul(BigInt(k)))
const g65 = k => cc.uncompressed(cc.mul(BigInt(k)))
// The TEST owner key's public half, as tools/cardctl/p256.py makes it.
const TEST_OWNER_PUB = "0414bc3b7ffd3c105a4248d9ea59d36e4704e6beffa71f528730cd88f83434d5074445b3f6384158fd90c9f890179dbfc5c6b2a927bf5e3c8d8231b5e813e8dae9"
// test_apdu.py's _KS8
const KS8 = hex("00ad268c4d1f5826")

// The applet's recorded LOAD_CHANGE: the file the applet's suite writes, or the same constants as test_apdu.py holds them.
const LC_FILE = path.resolve(__dirname, "../../applet/target/load-change-vector.json")
const LC_VECTOR = fs.existsSync(LC_FILE) ? JSON.parse(fs.readFileSync(LC_FILE, "utf8")) : {
  mint_private_key_8: "0000000000000000000000000000000000000000000000000000000000000008",
  mint_dleq_nonce: "0000000000000000000000000000000000000000000000000000000000000107",
  K: "022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01",
  spend_all_change: "b02600002d00000008022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a0100f1e4f5c2b1a09021",
  spend_all_change_response: "0214d74d45b98f556be3ecb84cb7b0570f0fa6815dca1d8251c43d7ae55b003758",
  get_change_response: "01000000000800f1e4f5c2b1a090000000000214d74d45b98f556be3ecb84cb7b0570f0fa6815dca1d8251c43d7ae55b003758022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01",
  load_change: "b0270002c2043d23f51fbd7a6e2e2d270450468fb69e0fb096ddf6ddc2a7744a2b69b4065de1b4fd673bf45286cd427f446da1f5583195dcdd37fa71e0d276f0a2a4a49f454f042f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a015c4da8a741539949293d082a132d13b4c2e213d6ba5b7617b5da2cb76cbde90456befa8e9ead09858672757331d0c0375e961db21e90868afd87ed1b62fba245b5f7d474f5684c2c3393ab998e8601bd7f5333c395f2f3e06c9aabc1777090ad53",
  load_change_response: "020100f1e4f5c2b1a09000000008f60f52083006f305833a08f2d7b9a94614665a29cae239f8af980e36252db426030af3843a771002220ba6f792934279fb8bb1493f9f03e41b45c5bb4e498aeb1100000000",
  C: "030af3843a771002220ba6f792934279fb8bb1493f9f03e41b45c5bb4e498aeb11",
}

// The CI mint's keyset as the applet's KeysetKeysTest records it (test_apdu.py reads the same file): 64 keys for 2^0 to
// 2^63, its version 01 ID with the tail, and the version 00 ID of the same keys.
function ciKeysets() {
  const src = fs.readFileSync(path.resolve(__dirname, "../../applet/src/test/java/me/flashapp/cashu/KeysetKeysTest.java"), "utf8")
  const at = src.indexOf("CI_KEYS = {")
  const block = src.slice(at, src.indexOf("};", at))
  const keys = [...block.matchAll(/"(0[23][0-9a-f]{64})"/g)].map((m, i) => [1n << BigInt(i), Buffer.from(m[1], "hex")])
  return {
    keys,
    v01: src.match(/CI_V01_ID = "([0-9a-f]{66})"/)[1],
    tail: src.match(/CI_V01_TAIL = "([^"]+)"/)[1],
    v00: src.match(/CI_V00_ID = "([0-9a-f]{16})"/)[1],
  }
}

// ── encoders: spec/APDU.md's tables and test_apdu.py's vectors ───────────────

test("select uses the applet's 11-byte AID, F0 CASHUCARD 01, with the 10-byte package AID as the fallback (D25)", () => {
  assert.deepEqual(encode.select(), hex("00A404000BF043415348554341524401"))
  assert.deepEqual(encode.select(constants.APPLET_AID), hex("00A404000BF043415348554341524401"))
  assert.deepEqual(encode.select(constants.PACKAGE_AID), hex("00A404000AF0434153485543415244"))
  assert.deepEqual(constants.SELECT_AIDS, [constants.APPLET_AID, constants.PACKAGE_AID])
  assert.deepEqual(constants.PACKAGE_AID, Buffer.concat([Buffer.from([0xf0]), Buffer.from("CASHUCARD")]))
  assert.deepEqual(constants.APPLET_AID, Buffer.concat([constants.PACKAGE_AID, Buffer.from([0x01])]))
  assert.deepEqual(constants.OLD_AIDS.upstream0x, hex("D2760000850102"))
  assert.deepEqual(constants.OLD_AIDS.foxy1x, hex("F0464F585943415244"))
  assert.deepEqual(constants.VERSION, { major: 3, minor: 0 }, "SELECT answers 03 00")
})

test("the INS of 3.0 (spec/APDU.md, Commands, by INS)", () => {
  const want = {
    GET_INFO: 0x01, GET_PUBKEY: 0x10, GET_BALANCE: 0x11, GET_PROOF_COUNT: 0x12, GET_PROOF: 0x13, GET_SLOT_STATUS: 0x14,
    AUTH: 0x15, GET_CARD: 0x16, GET_PIECES: 0x17, GET_LOG: 0x18, GET_CHANGE: 0x19, GET_DLEQ: 0x1a, GET_OUTBOX: 0x1b,
    CERT_READ: 0x1c, GROUP_KEYS: 0x1d, SPEND_ALL_BEGIN: 0x22, SPEND_ALL_OUTPUTS: 0x23, SPEND_ALL_SIGN: 0x24,
    SPEND_ALL_AGAIN: 0x25, SPEND_ALL_CHANGE: 0x26, LOAD_CHANGE: 0x27, LOAD_PROOF: 0x30, CLEAR_SPENT: 0x31, SET_CARD: 0x32,
    SET_LIMIT_PIN: 0x33, SET_LIMIT: 0x34, SET_HEADER: 0x36, TELL_TIME: 0x37, KEYSET_KEYS: 0x38, VERIFY_PIN: 0x40,
    SET_PIN: 0x41, CHANGE_PIN: 0x42, SET_OWNER: 0x43, GET_NONCE: 0x44, ALLOW_LOAD: 0x45, LOCK_CARD: 0x50, RESET_CARD: 0x51,
    SET_TAG: 0x52, REFRESH: 0x53, CERT_WRITE: 0x54,
  }
  assert.deepEqual({ ...constants.INS }, want)
})

test("read command encodings match spec/APDU.md", () => {
  assert.deepEqual(encode.getInfo(), hex("B0010400 00"), "the longest form, P1 = 4 (59 bytes on 3.0)")
  assert.deepEqual(encode.getInfo(2), hex("B0010200 00"))
  assert.deepEqual(encode.getInfo(0), hex("B0010000 00"))
  assert.deepEqual(encode.getPubkey(), hex("B0100000 21"))
  assert.deepEqual(encode.getBalance(), hex("B0110000 04"))
  assert.deepEqual(encode.getProofCount(), hex("B0120000 01"))
  assert.deepEqual(encode.getSlotStatus(), hex("B0140000 80"))
  assert.deepEqual(encode.getProof(100), hex("B0136400 52"))
  assert.deepEqual(encode.getCard(), hex("B0160000 00"))
  assert.deepEqual(encode.getCard(2), hex("B0160200 00"), "the keyset table")
  assert.throws(() => encode.getCard(3), /getCardSecret/)
  assert.deepEqual(encode.getCardSecret(), hex("B0160300 00"), "c sealed to the refund key: no data (test_apdu.py)")
  assert.deepEqual(encode.getCardSecret(g65(7)).subarray(0, 5), hex("B0160300 41"), "with E, 65 bytes")
  assert.equal(encode.getCardSecret(g65(7)).length, 5 + 65 + 1)
  assert.throws(() => encode.getCardSecret(g33(7)), /65 bytes beginning 04/)
  assert.deepEqual(encode.getNonce(), hex("B0440000 10"))
  assert.deepEqual(encode.getNonce(1), hex("B0440100 71"), "the PIN key: 113 bytes (test_apdu.py)")
  assert.deepEqual(encode.auth(bytes(16)), Buffer.concat([hex("B0150000 10"), bytes(16), hex("50")]))
  assert.deepEqual(encode.getChange(1), hex("B0190100 00"), "test_apdu.py: B019010000")
  assert.throws(() => encode.getChange(256), /0 to 255/)
  assert.deepEqual(encode.getDleq(3), hex("B01A03FF 00"))
  assert.deepEqual(encode.getDleq(3, 4), hex("B01A0304 00"))
  assert.deepEqual(encode.getOutboxScope(), hex("B01B0000 00"))
  assert.deepEqual(encode.getOutboxPage(0), hex("B01B0100 03 0000FF 00"))
  assert.deepEqual(encode.getOutboxPage(510, 49), hex("B01B0100 03 01FE31 00"))
  assert.throws(() => encode.getOutboxPage(-1), RangeError)
  assert.throws(() => encode.getOutboxPage(0x10000), RangeError)
  assert.throws(() => encode.getOutboxPage(0, 0), RangeError)
  assert.throws(() => encode.getOutboxPage(0, 256), RangeError)
  assert.deepEqual(encode.getPieces(0, 3), hex("B0170003 00"))
  // CERT_READ (test_apdu.py: B01CFF0000, then the pages B01C000000 …)
  assert.deepEqual(encode.certRead(), hex("B01CFF00 00"))
  assert.deepEqual(encode.certRead(0), hex("B01C0000 00"))
  assert.deepEqual(encode.certRead(3), hex("B01C0300 00"))
  assert.throws(() => encode.certRead(4), /FF or 0 to 3/)
  // GROUP_KEYS (test_apdu.py: B01D000004 ‖ date ‖ 62)
  assert.deepEqual(encode.groupKeys(1900000000), hex("B01D0000 04 713FB300 62"))
  assert.deepEqual(encode.groupKeys(0), hex("B01D0000 04 00000000 62"), "the date 0, for undated pieces")
  assert.throws(() => encode.groupKeys(2 ** 32), /date/)
})

test("loadProof: P2 02 (the word on keys per load), 81 bytes with the date, 177 with the mint's proof (P1 1, Le 2), the unit first with P2 03", () => {
  const sent = encode.loadProof("0059534ce0bfa19a", 4096, bytes(32), Buffer.concat([Buffer.from([2]), bytes(32)]), 1900000000)
  assert.deepEqual(sent.subarray(0, 4), hex("B0300002"), "test_apdu.py with date_keys: B0300002")
  assert.equal(sent[4], 81, "Lc is 81")
  const payload = sent.subarray(5, 5 + 81)
  assert.deepEqual(payload.subarray(0, 8), hex("0059534ce0bfa19a"))
  assert.equal(payload.readUInt32BE(8), 4096)
  assert.deepEqual(payload.subarray(12, 44), bytes(32))
  assert.equal(payload[44], 2)
  assert.equal(payload.readUInt32BE(77), 1900000000)
  assert.equal(sent[sent.length - 1], 0x01, "Le")
  const withProof = encode.loadProof("0059534ce0bfa19a", 8, bytes(32), Buffer.concat([Buffer.from([2]), bytes(32)]), 0,
    { e: "01".repeat(32), s: "02".repeat(32), r: "03".repeat(32) })
  assert.deepEqual(withProof.subarray(0, 4), hex("B0300102"))
  assert.equal(withProof[4], 177)
  assert.deepEqual(withProof.subarray(5 + 81, 5 + 177), Buffer.concat([hex("01".repeat(32)), hex("02".repeat(32)), hex("03".repeat(32))]))
  assert.equal(withProof[withProof.length - 1], 0x02)
  const usd = encode.loadProof("0059534ce0bfa19a", 8, bytes(32), g33(3), 0, null, { unit: 1 })
  assert.deepEqual(usd.subarray(0, 6), hex("B0300003 52 01"), "P2 03, Lc 82, the unit first")
  assert.deepEqual(usd.subarray(6, 14), hex("0059534ce0bfa19a"))
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 8, bytes(32), g33(3), 0, null, { unit: 2 }), /unit/)
})

test("loadProof round-trips the keyset id and the date through parseProof", () => {
  const sent = encode.loadProof("008288762774ace1", 8, Buffer.alloc(32), Buffer.concat([Buffer.from([2]), Buffer.alloc(32)]), 7)
  const written = sent.subarray(5, 5 + 81)
  const p = parseProof(0, Buffer.concat([Buffer.from([1]), written]))
  assert.equal(p.keysetId, "008288762774ace1")
  assert.equal(p.date, 7)
})

test("the payment's encodings: BEGIN P1 02 (03 with units) Le 45, OUTPUTS 37 bytes each (the keyset first with P1 01), CHANGE 45 bytes, SIGN and AGAIN ask for 64", () => {
  assert.deepEqual(encode.spendAllBegin([0, 5, 127]), hex("B0220200 03 00057F 45"))
  assert.deepEqual(encode.spendAllBegin([0, 1]), hex("b022020002000145"), "the applet's recorded BEGIN")
  assert.deepEqual(encode.spendAllBegin([3], { units: true }), hex("B0220300 01 03 45"), "a reader that reads units")
  const out = encode.spendAllOutputs([{ amount: 16, B_: "02" + "11".repeat(32) }, { amount: 2, B_: "03" + "22".repeat(32) }])
  assert.deepEqual(out.subarray(0, 5), hex("B0230000 4A"))
  assert.equal(out.length, 5 + 74, "no Le")
  assert.equal(out.readUInt32BE(5), 16)
  const named = encode.spendAllOutputs([{ amount: 16, B_: "02" + "11".repeat(32) }], KS8)
  assert.deepEqual(named.subarray(0, 13), Buffer.concat([hex("B0230100 2D"), KS8]), "P1 01: the keyset (8), then the outputs")
  assert.equal(named.length, 5 + 8 + 37)
  // SPEND_ALL_CHANGE (test_apdu.py: B02600002D ‖ 64 ‖ K ‖ _KS8 ‖ 21)
  const K = g33(9)
  assert.deepEqual(encode.spendAllChange(64, K, KS8), Buffer.concat([hex("B0260000 2D 00000040"), K, KS8, hex("21")]))
  assert.deepEqual(encode.spendAllChange(64, g65(9), KS8), encode.spendAllChange(64, K, KS8), "K given in 04 form is sent compressed")
  assert.deepEqual(encode.spendAllChange(8, LC_VECTOR.K, hex(LC_VECTOR.spend_all_change).subarray(-9, -1)), hex(LC_VECTOR.spend_all_change), "the applet's recorded SPEND_ALL_CHANGE")
  assert.deepEqual(encode.spendAllSign(), hex("B0240000 40"))
  assert.deepEqual(encode.spendAllAgain(), hex("B0250000 40"))
  assert.deepEqual(encode.spendAllAgain("ab".repeat(32)), Buffer.concat([hex("B0250100 20"), hex("ab".repeat(32)), hex("40")]))
  assert.throws(() => encode.spendAllOutputs(Array(7).fill({ amount: 1, B_: "02" + "11".repeat(32) })), /1 to 6/)
  assert.throws(() => encode.spendAllOutputs([{ amount: 1, B_: "02" + "11".repeat(32) }], KS8.subarray(0, 7)), /8 bytes/)
  assert.throws(() => encode.spendAllBegin([]), /1 to 128/)
  assert.throws(() => encode.spendAllChange(3, K, KS8), /power of two/)
  assert.throws(() => encode.spendAllChange(0, K, KS8), /below 2\*\*32/)
  assert.throws(() => encode.spendAllChange(64, "02" + "00".repeat(32), KS8), /not a point/)
  assert.throws(() => encode.spendAllChange(64, K, KS8.subarray(0, 7)), /8 bytes/)
  assert.throws(() => encode.spendAllChange(64), /K/)
})

test("LOAD_CHANGE: P1 the opening, P2 02, Lc C2, C_ and K in the 04 form, Le 53; 02/03 points are written out", () => {
  const c_ = g65(5), k = g65(6), e = bytes(32), s = Buffer.from(Array.from({ length: 32 }, (_, i) => 32 + i))
  // test_apdu.py: B0270602C2 ‖ c_ ‖ k ‖ e ‖ s ‖ 53
  assert.deepEqual(encode.loadChange(6, c_, k, e, s), Buffer.concat([hex("B0270602 C2"), c_, k, e, s, hex("53")]))
  assert.deepEqual(encode.loadChange(6, g33(5), g33(6), e, s), encode.loadChange(6, c_, k, e, s), "the compressed forms")
  // the applet's recorded LOAD_CHANGE, from the mint's answer as a mint gives it: C_ compressed
  const v = hex(LC_VECTOR.load_change)
  const data = v.subarray(5, 5 + 194)
  const mintC_ = cc.compressed(cc.point(data.subarray(0, 65)))
  assert.deepEqual(encode.loadChange(0, mintC_, LC_VECTOR.K, data.subarray(130, 162), data.subarray(162, 194)), v)
  // every argument checked before anything is sent (test_apdu.py's list)
  const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(31), Buffer.from([1]), Buffer.alloc(32)])
  for (const args of [[8, c_, k, e, s], [-1, c_, k, e, s], [0, offCurve, k, e, s], [0, c_, offCurve, e, s],
    [0, c_, k, e.subarray(0, 31), s], [0, c_, k, e, Buffer.concat([s, Buffer.alloc(1)])], [0, "02" + "00".repeat(32), k, e, s]]) {
    assert.throws(() => encode.loadChange(...args), args[0] + "")
  }
})

test("KEYSET_KEYS encodings: begin with the tail (none for version 00), keys of 41 bytes six to a command, finish Le 00, show (test_apdu.py's vectors)", () => {
  const { keys, v01, tail, v00 } = ciKeysets()
  assert.equal(keys.length, 64)
  assert.deepEqual(encode.keysetKeysBegin(hex(v01.slice(0, 16)), tail), Buffer.concat([hex("B0380000"), Buffer.from([8 + tail.length]), hex(v01.slice(0, 16)), Buffer.from(tail)]))
  assert.deepEqual(encode.keysetKeysBegin(hex(v00)), Buffer.concat([hex("B0380000 08"), hex(v00)]), "no Le, no tail")
  assert.deepEqual(encode.keysetKeysKeys(keys.slice(0, 6)), Buffer.concat([hex("B0380100 F6"), ...keys.slice(0, 6).map(([a, k]) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(a); return Buffer.concat([b, k]) })]))
  assert.deepEqual(encode.keysetKeysKeys(keys.slice(63)), Buffer.concat([hex("B0380100 29"), hex("8000000000000000"), keys[63][1]]), "2^63, eight bytes")
  assert.deepEqual(encode.keysetKeysFinish(), hex("B0380200 00"))
  const p = [0, 1, 2].map(i => Buffer.alloc(32, i))
  assert.deepEqual(encode.keysetKeysShow(4, 5, p), Buffer.concat([hex("B0380300"), Buffer.from([3 + 96, 4, 5, 3]), ...p]))
  assert.deepEqual(encode.keysetKeysShow(4, 5, p, keys[2][1]), Buffer.concat([hex("B0380300"), Buffer.from([3 + 96 + 33, 4, 5, 3]), ...p, keys[2][1]]))
  assert.deepEqual(encode.keysetKeysShow(4, 5, p, keys[2][1], KS8), Buffer.concat([hex("B0380300"), Buffer.from([3 + 96 + 41, 4, 5, 3]), ...p, keys[2][1], KS8]))
  assert.deepEqual(encode.keysetKeysShow(0, 0, []), hex("B038030003000000"))
  // test_apdu.py's refusals before anything is sent
  const two = [Buffer.alloc(32), Buffer.alloc(32)]
  for (const bad of [
    () => encode.keysetKeysBegin(Buffer.alloc(7)), () => encode.keysetKeysBegin(Buffer.alloc(8), "|unit:sat"),
    () => encode.keysetKeysBegin(hex("0200000000000000")), () => encode.keysetKeysBegin(hex("0100000000000000"), ""),
    () => encode.keysetKeysBegin(hex("0100000000000000"), "|unit:eur"), () => encode.keysetKeysBegin(hex("0100000000000000"), "|unit:sats"),
    () => encode.keysetKeysBegin(hex("0100000000000000"), "|unit:sat|" + "x".repeat(55)),
    () => encode.keysetKeysKeys([]), () => encode.keysetKeysKeys(keys.slice(0, 7)), () => encode.keysetKeysKeys([[0, keys[0][1]]]),
    () => encode.keysetKeysKeys([[1n << 64n, keys[0][1]]]), () => encode.keysetKeysKeys([[1, g65(3)]]),
    () => encode.keysetKeysShow(8, 0, two), () => encode.keysetKeysShow(0, 4, two), () => encode.keysetKeysShow(0, 0, Array(7).fill(Buffer.alloc(32))),
    () => encode.keysetKeysShow(0, 0, [Buffer.alloc(31)]), () => encode.keysetKeysShow(0, 0, two, null, KS8),
    () => encode.keysetKeysShow(0, 0, two, g65(3)), () => encode.keysetKeysShow(0, 0, two, keys[0][1], Buffer.alloc(7)),
  ]) assert.throws(bad, bad.toString())
  // the widest tail a version 01 ID takes, and the units it names
  for (const t of ["|unit:sat|" + "x".repeat(54), "|unit:usd", "|unit:sat|input_fee_ppk:100"]) encode.keysetKeysBegin(hex("0100000000000000"), t)
})

test("a keyset's ID is NUT-02's: the version 01 and 00 IDs the applet's suite records for the CI mint's keys", () => {
  const { keys, v01, tail, v00 } = ciKeysets()
  assert.equal(tail, "|unit:sat|input_fee_ppk:100")
  assert.equal(keysetId(1, keys, Buffer.from(tail)).toString("hex"), v01)
  assert.equal(keysetId(0, keys).toString("hex"), v00)
  assert.deepEqual(keysetTail("sat", 100), Buffer.from(tail))
  assert.notEqual(keysetId(1, keys, keysetTail("sat")).toString("hex"), v01, "the fee is in the ID")
  assert.deepEqual(keysetTail("usd", 0, 1900000000), Buffer.from("|unit:usd|final_expiry:1900000000"))
})

// An independent build of the tree, by halves (test_apdu.py's _subtree): the leaves padded with SHA-256(02).
const sha = (...parts) => nodeCrypto.createHash("sha256").update(Buffer.concat(parts)).digest()
function leafOf(a, k) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(a)); return sha(Buffer.from([0]), b, k) }
function subtree(leaves, lo, size) {
  if (size === 1) return lo < leaves.length ? leaves[lo] : sha(Buffer.from([2]))
  return sha(Buffer.from([1]), subtree(leaves, lo, size / 2), subtree(leaves, lo + size / 2, size / 2))
}
const width = n => (n > 1 ? 2 ** Math.ceil(Math.log2(n)) : 1)
const indTop = keys => subtree(keys.map(([a, k]) => leafOf(a, k)), 0, width(keys.length))
const indPath = (keys, i) => { const l = keys.map(([a, k]) => leafOf(a, k)); const out = []; for (let h = 0; 2 ** h < width(keys.length); h++) out.push(subtree(l, ((i >> h) ^ 1) << h, 2 ** h)); return out }

test("the keyset tree against an independent build: the top, every leaf's path, the fold", () => {
  const ci = ciKeysets().keys
  const odd = [1, 2, 5, 10, 20, 50, 100].map((a, i) => [BigInt(a), g33(4001 + i)])
  for (const keys of [ci, ci.slice(0, 7), ci.slice(0, 3), ci.slice(0, 1), ci.slice(0, 2), ci.slice(0, 33), odd]) {
    const top = keysetLevels(keys).at(-1)[0]
    assert.deepEqual(top, indTop(keys), `${keys.length} keys`)
    for (let i = 0; i < keys.length; i++) {
      const p = keysetPath(keys, i)
      assert.deepEqual(p, indPath(keys, i), `${keys.length} keys, leaf ${i}`)
      assert.deepEqual(foldPath(keysetLeaf(...keys[i]), i, p), top)
    }
    if (keys.length > 1) assert.notDeepEqual(foldPath(keysetLeaf(...keys[0]), 1, keysetPath(keys, 0)), top, "an index off by one does not reach the top")
  }
  assert.deepEqual(keysetLevels(ci.slice(0, 1)).at(-1)[0], leafOf(...ci[0]), "a single key is its own top")
  assert.deepEqual(keysetPath(ci.slice(0, 1), 0), [])
  assert.deepEqual(keysetLevels(ci.slice(0, 7))[0][7], sha(Buffer.from([2])), "seven keys pad one leaf with SHA-256(02)")
})

test("keysetFromMint takes NUT-01's keys, checks them against the ID (the fee in a version 01 tail) and orders them by amount", () => {
  const { keys, v01, v00 } = ciKeysets()
  const doc = (id, unit, ks) => ({ id, unit, keys: Object.fromEntries([...ks].reverse().map(([a, k]) => [a.toString(), k.toString("hex")])) })
  const a = keysetFromMint(doc(v01, "sat", keys), { inputFeePpk: 100 })
  assert.deepEqual(a.id, hex(v01))
  assert.deepEqual(a.keyset8, hex(v01.slice(0, 16)))
  assert.deepEqual(a.keys, keys, "in increasing order of amount, 2^63 a BigInt")
  assert.deepEqual(a.tail, Buffer.from("|unit:sat|input_fee_ppk:100"))
  assert.deepEqual(keysetFromMint({ ...doc(v01, "sat", keys), input_fee_ppk: 100 }).id, hex(v01), "the fee on the document")
  const b = keysetFromMint(doc(v00, "sat", keys))
  assert.deepEqual(b.keyset8, hex(v00))
  assert.equal(b.tail.length, 0)
  assert.throws(() => keysetFromMint(doc(v01, "sat", keys)), /input_fee_ppk/, "the fee left out")
  assert.throws(() => keysetFromMint(doc(v01, "usd", keys), { inputFeePpk: 100 }), /hash to/)
  assert.throws(() => keysetFromMint(doc(v01, "eur", keys), { inputFeePpk: 100 }), /unit/)
  assert.throws(() => keysetFromMint(doc(v00, "sat", keys.slice(1))), /2\^n/)
  assert.throws(() => keysetFromMint(doc(v00.slice(0, -2) + "00", "sat", keys)), /hash to/)
  assert.throws(() => keysetFromMint(doc(v00, "sat", [...keys, [1n << 64n, keys[0][1]]])), /2\^64|1 to 64/)
  assert.throws(() => keysetFromMint(doc(v00, "sat", [[1n, Buffer.concat([Buffer.from([2]), Buffer.alloc(32)])]])), /not a point/)
  assert.throws(() => keysetFromMint(doc("02" + v00.slice(2), "sat", keys)), /version 00/)
})

test("clearSpent, setHeader, verifyPin, setPin encodings", () => {
  assert.deepEqual(encode.clearSpent(), hex("B0310000 01"))
  assert.deepEqual(encode.setHeader(bytes(80)), Buffer.concat([hex("B0360000 50"), bytes(80), hex("04")]))
  assert.deepEqual(encode.verifyPin("1234"), Buffer.concat([hex("B0400000"), Buffer.from([4]), Buffer.from("1234")]))
  assert.deepEqual(encode.setPin("1234"), Buffer.concat([hex("B0410000"), Buffer.from([4]), Buffer.from("1234")]))
})

test("points: 02/03 and 04 forms of one point, refused when not on the curve", () => {
  for (let k = 1; k < 20; k++) {
    assert.deepEqual(uncompressedPoint(g33(k)), g65(k))
    assert.deepEqual(compressedPoint(g65(k)), g33(k))
    assert.deepEqual(uncompressedPoint(g65(k)), g65(k))
  }
  assert.throws(() => uncompressedPoint("02" + "11".repeat(32)), /not a point/)
  const flipped = Buffer.from(g65(3)); flipped[64] ^= 1
  assert.throws(() => uncompressedPoint(flipped), /not a point/)
  assert.throws(() => uncompressedPoint("05" + "11".repeat(32)), /not a point/)
})

// ── the owner's proof ────────────────────────────────────────────────────────

test("the TEST owner key is cardctl's, and ownerProof verifies over label || nonce || value", () => {
  assert.equal(ownerPublicKey().toString("hex"), TEST_OWNER_PUB)
  const nonce = bytes(16), value = Buffer.from("5678")
  const proof = ownerProof(constants.LABEL.CHANGE_PIN, nonce, value)
  const pub = nodeCrypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: hex(TEST_OWNER_PUB).subarray(1, 33).toString("base64url"), y: hex(TEST_OWNER_PUB).subarray(33).toString("base64url") }, format: "jwk" })
  assert.ok(nodeCrypto.verify("sha256", Buffer.concat([Buffer.from("CashuCard/change-pin"), nonce, value]), { key: pub, dsaEncoding: "der" }, proof))
  for (const label of Object.values(constants.LABEL)) assert.match(label, /^CashuCard\//)
  const data = ownerData(proof, value)
  assert.equal(data[0], proof.length)
  assert.deepEqual(data.subarray(1 + proof.length), value)
})

test("the owner's commands: CHANGE_PIN, SET_OWNER with the anchor, ALLOW_LOAD, SET_LIMIT, REFRESH, LOCK_CARD", () => {
  const proof = Buffer.alloc(70, 7)
  assert.deepEqual(encode.changePin(proof, "5678").subarray(0, 6), hex("B0420000 4B 46"))
  assert.deepEqual(encode.setOwner(TEST_OWNER_PUB), Buffer.concat([hex("B0430000 41"), hex(TEST_OWNER_PUB)]))
  assert.deepEqual(encode.setOwner(TEST_OWNER_PUB, bytes(80)), Buffer.concat([hex("B0430000 91"), hex(TEST_OWNER_PUB), bytes(80)]))
  assert.deepEqual(encode.setOwner(TEST_OWNER_PUB, null, proof).subarray(0, 6), hex("B0430000 88 46"))
  assert.deepEqual(encode.allowLoad(proof), Buffer.concat([hex("B0450000 47 46"), proof]))
  assert.deepEqual(encode.setLimit(proof, limitValue({ day: 100 })).subarray(0, 5), hex("B0340000 4B"))
  assert.deepEqual(encode.setLimit(proof, limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 7, rate: 0, noPinWindow: 1 })).subarray(0, 5), hex("B0340000 59"), "18 bytes of value")
  assert.deepEqual(encode.refresh(proof, bytes(80)).subarray(-1), hex("04"), "Le 4: the clock")
  assert.deepEqual(encode.refresh(proof, bytes(80)).subarray(0, 5), hex("B0530000 97"))
  assert.deepEqual(encode.lockCard(proof).subarray(0, 4), hex("B05000DE"))
})

test("limitValue is 4, 8, 12, 13, 17 or 18 bytes, and refuses a form that would zero what it was not given", () => {
  assert.equal(limitValue({ day: 1 }).length, 4)
  assert.equal(limitValue({ day: 1, payment: 0 }).length, 8)
  assert.equal(limitValue({ day: 1, payment: 0, allowance: 5 }).length, 12)
  assert.deepEqual(limitValue({ day: 1, payment: 2, allowance: 3, rollBudget: 7 }), hex("00000001 00000002 00000003 07"))
  assert.deepEqual(limitValue({ day: 1, payment: 2, allowance: 3, rollBudget: 7, rate: 95000 }), hex("00000001 00000002 00000003 07 00017318"), "17: the rate, sats to the dollar")
  assert.deepEqual(limitValue({ day: 1, payment: 2, allowance: 3, rollBudget: 7, rate: 0, noPinWindow: 1 }), hex("00000001 00000002 00000003 07 00000000 01"), "18: the no-PIN window's switch")
  assert.throws(() => limitValue({ day: 1, rollBudget: 7 }), /payment and allowance/)
  assert.throws(() => limitValue({ day: 1, allowance: 7 }), /give payment/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rate: 5 }), /give rollBudget/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 7, noPinWindow: 1 }), /give rate/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 7, rate: 0, noPinWindow: 2 }), /0 .* or 1/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 0 }), /1 to 30/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 31 }), /1 to 30/)
  assert.throws(() => limitValue({ day: 1, payment: 0, allowance: 0, rollBudget: 7, rate: 2 ** 32 }), /rate/)
})

// ── parsers ──────────────────────────────────────────────────────────────────

// test_apdu.py's INFO_43 and INFO_59
const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const INFO_43 = Buffer.concat([Buffer.from([2, 0, 128, 3, 1, 124, 0xff, 1, 4, 3, 0, 1]), u32be(5000), Buffer.from([1]),
  u32be(1791814824), u32be(1791800000), u32be(100), Buffer.from([0]), u32be(0), u32be(250), u32be(50), Buffer.from([0])])
const INFO_59 = Buffer.concat([Buffer.from([3, 0]), INFO_43.subarray(2), Buffer.from([1]), u32be(95000), Buffer.from([3, 1, 0x80]),
  u32be(1791700000), Buffer.from([0xff, 0x03]), Buffer.from([298 >> 8, 298 & 0xff])])

test("parseInfo reads 30, 42, 43, 51 and 59 bytes (test_apdu.py's INFO_43 and INFO_59)", () => {
  assert.equal(INFO_43.length, 43)
  assert.equal(INFO_59.length, 59)
  const i = parseInfo(INFO_43)
  assert.equal(i.version, "2.0")
  assert.equal(i.maxSlots, 128)
  assert.equal(i.unspent, 3)
  assert.equal(i.pinState, 1)
  assert.equal(i.format, 4)
  assert.equal(i.dailyLimit, 5000)
  assert.equal(i.hasOwner, true)
  assert.equal(i.now, 1791814824)
  assert.equal(i.windowStart, 1791800000)
  assert.equal(i.spentToday, 100)
  assert.equal(i.changeOwed, false)
  assert.equal(i.allowance, 250)
  assert.equal(i.nopinSpent, 50)
  assert.equal(i.tagOff, false)
  assert.equal(parseInfo(INFO_43.subarray(0, 30)).allowance, undefined)
  const j = parseInfo(INFO_59)
  assert.equal(j.version, "3.0")
  assert.equal(j.keysetTable, true)
  assert.equal(j.rate, 95000)
  assert.equal(j.entries, 3)
  assert.equal(j.unmarked, 1)
  assert.equal(j.lastUnit, "the card's")
  assert.equal(j.noPinWindowStart, 1791700000)
  assert.equal(j.profilesRaw, 0xff03)
  assert.deepEqual(j.profiles, ["PIN before money", "the no-PIN window", "the owner claimed slowly", "the wait on every payment",
    "two units on one card", "a holder with no phone", "keyset keys", "the paid list", "the certificate", "keys per load"])
  assert.equal(j.keysPerLoad, true)
  assert.equal(j.loadsLeft, 298)
  const k = parseInfo(INFO_59.subarray(0, 51))
  assert.equal(k.rate, 95000)
  assert.equal(k.profiles, undefined, "fewer than 57 bytes: no profiles")
  const owed = Buffer.from(INFO_59); owed[29] = 1; owed[56] = 0x01
  assert.equal(parseInfo(owed).changeOwed, true, "byte 29: change owed")
  assert.equal(parseInfo(owed).keysPerLoad, false)
  assert.throws(() => parseInfo(INFO_43.subarray(0, 9)), /expected 30, 42, 43, 51 or 59/)
})

test("parseProof decodes the 82-byte slot with the full 16-char keyset id and the date", () => {
  const body = Buffer.concat([Buffer.from([1]), hex("0059534ce0bfa19a"), Buffer.from([0, 0, 4, 0xd2]), bytes(32), Buffer.from([2]), bytes(32), hex("713fb300")])
  const p = parseProof(4, body)
  assert.equal(p.slot, 4)
  assert.equal(p.status, "unspent")
  assert.equal(p.keysetId, "0059534ce0bfa19a")
  assert.equal(p.amount, 1234)
  assert.equal(p.C, "02" + bytes(32).toString("hex"))
  assert.equal(p.date, 1900000000)
  assert.throws(() => parseProof(0, body.subarray(4)), /expected 82/)
})

test("parseCard reads 3.0's 109 bytes and the mint: the rollover bytes, the no-PIN window's start and switch", () => {
  const mint = Buffer.from("http://m")
  const rec = Buffer.alloc(109 + mint.length)
  hex("040101 00001388").copy(rec, 0)
  g33(1).copy(rec, 7)
  bytes(32).copy(rec, 44)
  rec[76] = 2; rec[77] = 0; rec[78] = 1
  rec.writeUInt32BE(1791700000, 83)
  rec[87] = 1
  rec[105] = mint.length
  mint.copy(rec, 106)
  Buffer.from("FX1").copy(rec, 106 + mint.length)
  const c = parseCard(rec)
  assert.equal(c.unit, 1)
  assert.equal(c.unitName, "usd")
  assert.equal(c.dailyLimit, 5000)
  assert.equal(c.refundKey, g33(1).toString("hex"))
  assert.equal(c.rolls, 2)
  assert.equal(c.rollBudget, 7, "budget 0 is the default, 7")
  assert.equal(c.allowanceArmed, true)
  assert.equal(c.noPinWindowStart, 1791700000)
  assert.equal(c.noPinWindow, 1)
  assert.equal(c.mint, "http://m")
  assert.equal(c.design, "FX1")
  assert.throws(() => parseCard(rec.subarray(0, 106 + mint.length)), /109/, "the design's three bytes are part of 3.0's answer")
})

test("parseChange reads 83-byte openings (number, amount, keyset, date, B_, K) and refuses 2.2's 80-byte ones (test_apdu.py's rows)", () => {
  const row = (n, amount, keyset, date, b_, k) => { const r = Buffer.alloc(83); r[0] = n; r.writeUInt32BE(amount, 1); keyset.copy(r, 5); r.writeUInt32BE(date, 13); b_.copy(r, 17); k.copy(r, 50); return r }
  const b_ = g33(11), k = g33(12)
  const rows = Buffer.concat([row(5, 64, KS8, 1900000000, b_, k), row(7, 1, KS8, 0, k, b_)])
  assert.deepEqual(parseChange(Buffer.concat([Buffer.from([2]), rows])), [
    { number: 5, amount: 64, keysetId: KS8.toString("hex"), date: 1900000000, B_: b_.toString("hex"), K: k.toString("hex") },
    { number: 7, amount: 1, keysetId: KS8.toString("hex"), date: 0, B_: k.toString("hex"), K: b_.toString("hex") },
  ])
  assert.deepEqual(parseChange(Buffer.from([0])), [])
  for (const body of [Buffer.concat([Buffer.from([2]), rows.subarray(0, 83)]), Buffer.concat([Buffer.from([1]), rows.subarray(0, 80)]),
    Buffer.concat([Buffer.from([4]), rows, rows]), Buffer.concat([Buffer.from([1]), row(8, 1, KS8, 0, k, b_)]), Buffer.alloc(0)]) {
    assert.throws(() => parseChange(body), RangeError, body.subarray(0, 2).toString("hex"))
  }
  // the applet's recorded GET_CHANGE answer: opening 0, 8 sats in the vector's keyset, B_ and K as recorded
  const [rec] = parseChange(hex(LC_VECTOR.get_change_response))
  assert.equal(rec.number, 0)
  assert.equal(rec.amount, 8)
  assert.equal(rec.B_, LC_VECTOR.spend_all_change_response)
  assert.equal(rec.K, LC_VECTOR.K)
})

test("parseBegin reads 69 bytes (the worth, t, R + u*G); parseGroupKeys 98; parseLoadChange 83 (the applet's recorded answer)", () => {
  const begin = Buffer.concat([hex("00000030"), Buffer.alloc(32, 7), g33(9)])
  assert.deepEqual(parseBegin(begin), { total: 48, t: Buffer.alloc(32, 7), refund: g33(9) })
  assert.throws(() => parseBegin(begin.subarray(0, 4)), /expected 69/, "2.2's four bytes")
  const gk = Buffer.concat([Buffer.alloc(32, 1), g33(2), Buffer.alloc(33)])
  assert.deepEqual(parseGroupKeys(gk), { t: Buffer.alloc(32, 1), key: g33(2), refund: Buffer.alloc(33) })
  assert.throws(() => parseGroupKeys(gk.subarray(0, 97)), /expected 98/)
  const lc = parseLoadChange(hex(LC_VECTOR.load_change_response))
  assert.equal(lc.slot, 2)
  assert.equal(lc.proofKept, true)
  assert.equal(lc.piece.amount, 8)
  assert.equal(lc.piece.C, LC_VECTOR.C)
  assert.equal(lc.piece.date, 0)
  assert.equal(lc.piece.keysetId, hex(LC_VECTOR.spend_all_change).subarray(-9, -1).toString("hex"))
  assert.throws(() => parseLoadChange(hex(LC_VECTOR.load_change_response).subarray(0, 82)), /expected 83/)
})

test("describeSw names the words of 3.0: 6200, 6A86, 6A97 to 6A9F", () => {
  assert.match(describeSw(0x63c2), /wrong PIN — 2/)
  assert.match(describeSw(0x6983), /change-pin/)
  assert.match(describeSw(0x6a8f), /day's limit.*300 pieces/)
  assert.match(describeSw(0x6a91), /owner's proof/)
  assert.match(describeSw(0x6a82), /needs an update/)
  assert.match(describeSw(0x6200), /grant given.*opens no load/)
  assert.match(describeSw(0x6a86), /keys per load/)
  assert.match(describeSw(0x6a97), /no PIN/)
  assert.match(describeSw(0x6a98), /keep holding/)
  assert.match(describeSw(0x6a99), /no rate/)
  assert.match(describeSw(0x6a9a), /two units/)
  assert.match(describeSw(0x6a9b), /other unit/)
  assert.match(describeSw(0x6a9c), /keyset table/)
  assert.match(describeSw(0x6a9d), /holder's say/)
  assert.match(describeSw(0x6a9e), /enter the PIN/)
  assert.match(describeSw(0x6a9f), /keys not shown/)
  for (const sw of [0x6200, 0x6a86, 0x6a97, 0x6a98, 0x6a99, 0x6a9a, 0x6a9b, 0x6a9c, 0x6a9d, 0x6a9e, 0x6a9f]) assert.ok(Object.values(constants.SW).includes(sw), sw.toString(16))
  assert.equal(describeSw(0x1234), "unknown status word")
  const e = new CardError(0x6982, "LOAD_PROOF")
  assert.equal(e.sw, 0x6982)
  assert.match(e.message, /6982 during LOAD_PROOF/)
})

// ── argument checks: before any transport ────────────────────────────────────

test("amount and length checks throw before any transport", async () => {
  const sim = new CardSim("http://127.0.0.1:1", { fetch: async () => { throw new Error("transport reached") } })
  const n = bytes(32), c = Buffer.concat([Buffer.from([2]), bytes(32)])
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 2 ** 32, n, c), /below 2\*\*32/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 0, n, c), /below 2\*\*32/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 3, n, c), /power of two/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", "8", n, c), /positive integer/)
  assert.throws(() => encode.loadProof("0059534c", 8, n, c), /keysetId must be 8 bytes/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 8, bytes(31), c), /nonce must be 32 bytes/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 8, n, bytes(34)), /C must be 33 bytes/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 8, n, c, -1), /date/)
  assert.throws(() => encode.loadProof("0059534ce0bfa19a", 8, n, c, 0, { e: "01".repeat(32), s: "02".repeat(32) }), /dleq.r/)
  assert.throws(() => encode.getProof(128), /slot must be/)
  assert.throws(() => encode.auth(bytes(15)), /16 bytes/)
  assert.throws(() => encode.setHeader(bytes(79)), /80 bytes/)
  assert.throws(() => encode.verifyPin("123"), /pin must be 4-8 bytes/)
  assert.throws(() => encode.setOwner(TEST_OWNER_PUB, bytes(79)), /80 bytes/)
  assert.throws(() => ownerData(Buffer.alloc(73)), /at most 72/)
  assert.equal(validateSlotAmount(2 ** 31), 2 ** 31)
  await assert.rejects(sim.loadProof("0059534ce0bfa19a", 3, n, c), /power of two/)
  await assert.rejects(sim.loadChange(8, g33(1), g33(2), n, n), /0 to 7/)
  await assert.rejects(sim.spendAllChange(8, "02" + "11".repeat(32), KS8), /not a point/)
  await assert.rejects(sim.groupKeys(-1), /date/)
  await assert.rejects(sim.apdu("B0"), /at least CLA INS P1 P2/)
})

test("validateFixture mirrors the server's checks on the body, and refuses the 0.x keys by name", () => {
  const proof = { keysetId: "0059534ce0bfa19a", amount: 8, nonce: "ab".repeat(32), C: "02" + "11".repeat(32) }
  assert.deepEqual(validateFixture({}), {})
  const full = {
    pin: "1234", mint: "http://m", refundKey: "02" + "11".repeat(32), owner: true, anchor: "00".repeat(80), headers: ["00".repeat(80)],
    proofs: [{ ...proof, date: 5, dleq: { e: "01".repeat(32), s: "02".repeat(32), r: "03".repeat(32) } }], spentSlots: [0],
    limits: { day: 1, payment: 0, allowance: 1, rollBudget: 7, rate: 95000, noPinWindow: 1 }, blockedPin: true,
  }
  assert.deepEqual(validateFixture(full), full)
  assert.throws(() => validateFixture({ puk: "12345678" }), /no PUK/)
  assert.throws(() => validateFixture({ appletVersion: "0.6" }), /version masks are gone/)
  assert.throws(() => validateFixture({ bogus: 1 }), /unknown fixture key: bogus/)
  assert.throws(() => validateFixture({ blockedPin: true }), /blockedPin requires pin/)
  assert.throws(() => validateFixture({ pin: "123" }), /pin must be 4-8/)
  assert.throws(() => validateFixture({ owner: true, ownerKey: "11".repeat(32) }), /not both/)
  assert.throws(() => validateFixture({ anchor: "00".repeat(80) }), /given with owner/)
  assert.throws(() => validateFixture({ refundKey: "02" + "11".repeat(32) }), /given with mint/)
  assert.throws(() => validateFixture({ limits: { week: 1 } }), /unknown key in limits/)
  assert.throws(() => validateFixture({ limits: { rollBudget: 31 } }), /1 to 30/)
  assert.throws(() => validateFixture({ limits: { noPinWindow: 2 } }), /noPinWindow/)
  assert.throws(() => validateFixture({ limits: { rate: -1 } }), /rate/)
  assert.throws(() => validateFixture({ mint: "http://m", owner: true, proofs: [proof] }), /proofs need pin/, "3.0: a load wants the PIN in its tap")
  assert.throws(() => validateFixture({ pin: "1234", proofs: [{ ...proof, C: "05" + "11".repeat(32) }] }), /02\/03 prefix/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [{ ...proof, amount: 2 ** 32 }] }), /amount/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [{ ...proof, spent: false }] }), /unknown key in proofs\[0\]: spent/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [{ ...proof, dleq: { e: "01".repeat(32) } }] }), /dleq must be/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [proof, { ...proof, C: "03" + "11".repeat(32) }] }), /repeats a nonce/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [proof], spentSlots: [7] }), /not an index/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: [proof], spentSlots: [0, 0] }), /repeats 0/)
  assert.throws(() => validateFixture({ pin: "1234", proofs: Array.from({ length: 129 }, (_, i) => ({ ...proof, nonce: i.toString(16).padStart(64, "0") })) }), /129 entries/)
  assert.throws(() => validateFixture(null), /must be an object/)
})

// ── 3.0's flows on a fake transport: the bytes in order ──────────────────────

/** A fake bridge that expects `script` ([apdu hex, answer hex]) in order and fails the test on any other APDU. */
const scripted = (script, seen = []) => async (url, init) => {
  const h = JSON.parse(init.body).hex.toLowerCase()
  const at = seen.length
  seen.push(h)
  assert.ok(at < script.length, `APDU ${at} beyond the script: ${h}`)
  assert.equal(h, script[at][0].toLowerCase().replace(/\s+/g, ""), `APDU ${at}`)
  return { ok: true, status: 200, text: async () => JSON.stringify({ hex: script[at][1].replace(/\s+/g, "") }) }
}

test("the change flow on the wire: BEGIN P1 02 → OUTPUTS → CHANGE with K and the keyset → SIGN → GET_CHANGE → KEYSET_KEYS show → LOAD_CHANGE, as the applet recorded it", async () => {
  const v = LC_VECTOR
  const keyset = hex(v.spend_all_change).subarray(-9, -1)
  // a keyset whose key for 8 is the vector's mint key, 8*G: the leaf the opening's key is shown by
  const keys = [1n, 2n, 4n, 8n].map(a => [a, g33(a)])
  assert.equal(keys[3][1].toString("hex"), v.K)
  const t = Buffer.alloc(32, 0x5a)
  const signature = Buffer.alloc(64, 0x33)
  const path = keysetPath(keys, 3)
  const loadData = hex(v.load_change).subarray(5, 5 + 194)
  const seen = []
  const script = [
    ["b022020002000145", "00000028" + t.toString("hex") + "00".repeat(33) + "9000"],
    ["b023000025000000200211bccaf554963e836ce04494fec4e539d8ddbf3bac412c761f8e7849adf26f2c", "9000"],
    [v.spend_all_change, v.spend_all_change_response + "9000"],
    ["b024000040", "00019000"],
    ["b024000040", signature.toString("hex") + "9000"],
    ["b019000000", v.get_change_response + "9000"],
    ["b0380300" + (3 + 64).toString(16) + "000302" + path.map(p => p.toString("hex")).join(""), "9000"],
    [v.load_change, v.load_change_response + "9000"],
  ]
  const sim = new CardSim("http://127.0.0.1:9", { fetch: scripted(script, seen) })
  const begun = await sim.spendAllBegin([0, 1])
  assert.deepEqual(begun, { total: 40, t, refund: Buffer.alloc(33) })
  await sim.spendAllOutputs([{ amount: 32, B_: "0211bccaf554963e836ce04494fec4e539d8ddbf3bac412c761f8e7849adf26f2c" }])
  assert.equal((await sim.spendAllChange(8, v.K, keyset)).toString("hex"), v.spend_all_change_response)
  assert.deepEqual(await sim.spendAllSign(), { signature, waits: 1 })
  const [opening] = await sim.owedChange()
  assert.deepEqual(opening, { number: 0, amount: 8, keysetId: keyset.toString("hex"), date: 0, B_: v.spend_all_change_response, K: v.K })
  assert.equal(await sim.showOpeningKey(opening, { id: keyset, keys }), 3)
  // the mint answers B_ with C_ compressed, as a mint does; the client writes out C_ and K
  const c_ = cc.compressed(cc.point(loadData.subarray(0, 65)))
  const got = await sim.loadChange(opening.number, c_, opening.K, loadData.subarray(130, 162), loadData.subarray(162))
  assert.equal(got.slot, 2)
  assert.equal(got.proofKept, true)
  assert.equal(got.piece.C, v.C)
  assert.equal(seen.length, script.length, "every APDU of the script, no more")
  // the mint's answer the vector carries is NUT-12's, worked out here from the published key 8 and the nonce 0x107
  const k8 = BigInt("0x" + v.mint_private_key_8), p = BigInt("0x" + v.mint_dleq_nonce)
  const B = cc.point(v.spend_all_change_response)
  const C_ = cc.mul(k8, B)
  const e = cc.hashE(cc.mul(p), cc.mul(p, B), cc.point(v.K), C_)
  assert.deepEqual(cc.uncompressed(C_), loadData.subarray(0, 65))
  assert.deepEqual(e, loadData.subarray(130, 162))
  assert.deepEqual(cc.bytes32((p + cc.int(e) * k8) % cc.N), loadData.subarray(162, 194))
  assert.ok(cc.verifyBlindDleq(v.spend_all_change_response, C_ && cc.compressed(C_), e, loadData.subarray(162), v.K))
})

test("teachKeyset: begin with the tail, the keys six to a command, finish, and the ID the card answers must be the keyset's", async () => {
  const { keys, v01, tail } = ciKeysets()
  const ks = keysetFromMint({ id: v01, unit: "sat", keys: Object.fromEntries(keys.map(([a, k]) => [a.toString(), k.toString("hex")])) }, { inputFeePpk: 100 })
  const script = [[encode.keysetKeysBegin(ks.keyset8, tail).toString("hex"), "9000"]]
  for (let i = 0; i < 64; i += 6) script.push([encode.keysetKeysKeys(keys.slice(i, i + 6)).toString("hex"), "9000"])
  script.push(["b038020000", v01 + "9000"])
  const seen = []
  const sim = new CardSim("http://127.0.0.1:9", { fetch: scripted(script, seen) })
  assert.deepEqual(await sim.teachKeyset(ks), hex(v01))
  assert.equal(seen.length, 1 + 11 + 1, "64 keys are eleven commands")
  const wrong = new CardSim("http://127.0.0.1:9", { fetch: scripted([...script.slice(0, -1), ["b038020000", v01.slice(0, -2) + "00" + "9000"]]) })
  await assert.rejects(wrong.teachKeyset(ks), /worked out/)
})

test("showOpeningKey sends the opening's number, and the index and path of the leaf of its amount and K; with another key, that key's leaf and the key", async () => {
  const keys = [1n, 2n, 4n, 8n, 16n].map((a, i) => [a, g33(300 + i)])
  const ks = { id: KS8, keys }
  const opening = { number: 5, amount: 4, K: keys[2][1].toString("hex") }
  const path = keysetPath(keys, 2).map(p => p.toString("hex")).join("")
  const seen = []
  const sim = new CardSim("http://127.0.0.1:9", { fetch: scripted([
    ["b0380300" + (3 + 96).toString(16) + "050203" + path, "9000"],
    ["b0380300" + (3 + 96 + 33 + 8).toString(16) + "050203" + path + keys[2][1].toString("hex") + "0011223344556677", "9000"],
  ], seen) })
  assert.equal(await sim.showOpeningKey(opening, ks), 2, "the leaf of 4")
  // an opening a reader bound to a key that is not the mint's: the holder binds it to the mint's key (and keyset)
  const misbound = { ...opening, K: g33(999).toString("hex") }
  await assert.rejects(sim.showOpeningKey(misbound, ks), /no key/)
  assert.equal(await sim.showOpeningKey(misbound, ks, { otherKey: keys[2][1], otherKeyset: "0011223344556677" }), 2)
  assert.equal(seen.length, 2)
  for (const [o, k] of [[opening, keys[2]], [{ ...opening, number: 0 }, keys[2]]]) {
    assert.deepEqual(foldPath(keysetLeaf(...k), 2, keysetPath(keys, 2)), keysetLevels(keys).at(-1)[0], `opening ${o.number}: the path reaches the top`)
  }
})

test("allowLoad takes 6200 as the grant, refuses 9000 (a card whose grant opens loads) and throws any other word", async () => {
  const nonce = "00".repeat(16)
  const answer = sw => { let n = 0; return async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ hex: n++ === 0 ? nonce + "9000" : sw }) }) }
  await new CardSim("http://127.0.0.1:9", { fetch: answer("6200") }).allowLoad()
  await assert.rejects(new CardSim("http://127.0.0.1:9", { fetch: answer("9000") }).allowLoad(), /9000.*6200/)
  await assert.rejects(new CardSim("http://127.0.0.1:9", { fetch: answer("6A91") }).allowLoad(), e => e instanceof CardError && e.sw === 0x6a91)
})

test("an owner's claim is the same SET_OWNER sent while the card answers 6A98 (six askings), bounded; VERIFY_PIN holds the same way", async () => {
  const claim = encode.setOwner(ownerPublicKey()).toString("hex")
  const seen = []
  const sim = new CardSim("http://127.0.0.1:9", { fetch: scripted([...Array(5).fill([claim, "6A98"]), [claim, "9000"]], seen) })
  await sim.claimOwner()
  assert.equal(seen.length, 6)
  const refused = new CardSim("http://127.0.0.1:9", { fetch: scripted([[claim, "6A98"], [claim, "6A98"], [claim, "6985"]]) })
  await assert.rejects(refused.claimOwner(), e => e instanceof CardError && e.sw === 0x6985)
  const sent = []
  const forever = new CardSim("http://127.0.0.1:9", { fetch: async (url, init) => { sent.push(1); return { ok: true, status: 200, text: async () => JSON.stringify({ hex: "6A98" }) } } })
  await assert.rejects(forever.claimOwner(), e => e instanceof CardError && e.sw === 0x6a98)
  assert.equal(sent.length, constants.CLAIM_MOST, "no more askings than a held tap's most")
  const pin = encode.verifyPin("1234").toString("hex")
  const waited = []
  await new CardSim("http://127.0.0.1:9", { fetch: scripted([...Array(40).fill([pin, "6A98"]), [pin, "9000"]], waited) }).verifyPin("1234")
  assert.equal(waited.length, 41)
  await assert.rejects(new CardSim("http://127.0.0.1:9", { fetch: scripted([[pin, "6A98"], [pin, "63C1"]]) }).verifyPin("1234"), e => e.sw === 0x63c1)
})

test("groupKeys, certRead and getChange pages on the wire", async () => {
  const gk = Buffer.concat([Buffer.alloc(32, 1), g33(2), Buffer.alloc(33)])
  const sim = new CardSim("http://127.0.0.1:9", { fetch: scripted([["b01d00000400000000" + "62", gk.toString("hex") + "9000"]]) })
  assert.deepEqual(await sim.groupKeys(0), { t: Buffer.alloc(32, 1), key: g33(2), refund: Buffer.alloc(33) })
  const container = Buffer.concat([Buffer.from(Array.from({ length: 512 }, (_, i) => i & 0xff)), Buffer.from(Array.from({ length: 76 }, (_, i) => i))])
  const cert = new CardSim("http://127.0.0.1:9", { fetch: scripted([["b01cff0000", "0101024c9000"], ["b01c000000", container.subarray(0, 256).toString("hex") + "9000"],
    ["b01c010000", container.subarray(256, 512).toString("hex") + "9000"], ["b01c020000", container.subarray(512).toString("hex") + "9000"]]) })
  assert.deepEqual(await cert.certRead(), { sealed: true, version: 1, length: 588, container })
  assert.deepEqual(await new CardSim("http://127.0.0.1:9", { fetch: scripted([["b01cff0000", "000000009000"]]) }).certRead(), { sealed: false, version: 0, length: 0, container: Buffer.alloc(0) })
  await assert.rejects(new CardSim("http://127.0.0.1:9", { fetch: scripted([["b01cff0000", "0101024c9000"], ["b01c000000", "00".repeat(255) + "9000"]]) }).certRead(), /expected 256/)
  // owedChange: pages until a short one; an opening seen twice is listed once
  const row = n => { const r = Buffer.alloc(83); r[0] = n; r.writeUInt32BE(2 ** n, 1); g33(3).copy(r, 17); g33(3).copy(r, 50); return r.toString("hex") }
  const page = (...ns) => ns.length.toString(16).padStart(2, "0") + ns.map(row).join("") + "9000"
  const rows = await new CardSim("http://127.0.0.1:9", { fetch: scripted([["b019000000", page(0, 1, 2)], ["b019010000", page(2, 4)]]) }).owedChange()
  assert.deepEqual(rows.map(r => r.number), [0, 1, 2, 4])
})

// ── transport: never retried ─────────────────────────────────────────────────

test("apdu() calls fetch exactly once and throws on a transport failure (no retry)", async () => {
  let calls = 0
  const sim = new CardSim("http://127.0.0.1:1", { fetch: async () => { calls++; throw new Error("ECONNREFUSED") } })
  await assert.rejects(sim.apdu("B001000000"), /ECONNREFUSED/)
  assert.equal(calls, 1)
})

test("apdu() posts lower-case hex to /apdu and parses data‖SW; a refusal is returned, not thrown", async () => {
  const seen = []
  const fetch = async (url, init) => {
    seen.push({ url, init })
    return { ok: true, status: 200, text: async () => JSON.stringify({ hex: "6A88", sw: "6A88" }) }
  }
  const sim = new CardSim("http://127.0.0.1:9/", { fetch })
  const r = await sim.apdu("B0 13 00 00 52")
  assert.equal(seen[0].url, "http://127.0.0.1:9/apdu")
  assert.equal(seen[0].init.method, "POST")
  assert.deepEqual(JSON.parse(seen[0].init.body), { hex: "b013000052" })
  assert.equal(r.sw, 0x6a88)
  assert.equal(r.data.length, 0)
  await assert.rejects(sim.getProof(0), e => e instanceof CardError && e.sw === 0x6a88 && /GET_PROOF slot 0/.test(e.message))
  assert.equal(seen.length, 2)
})

test("a non-2xx from the bridge is a CardSimError carrying the body", async () => {
  const fetch = async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ error: "VERIFY_PIN", sw: "6983", state: { generation: 2 } }) })
  const sim = new CardSim("http://127.0.0.1:9", { fetch })
  await assert.rejects(sim.fixture({ pin: "5678" }), e => e instanceof CardSimError && e.status === 409 && e.body.sw === "6983")
})

test("every request carries an AbortSignal and a wedged bridge fails the call at timeoutMs", async () => {
  // A real server that accepts the request and never answers: the shape of a /fixture stuck behind a long request on
  // the bridge's one card thread. A real socket keeps the event loop alive until the unref'd AbortSignal timer fires.
  const http = require("node:http")
  const hits = []
  const sockets = new Set()
  const server = http.createServer(req => { hits.push(req.url) })
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)) })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const seen = []
    const fetch = (url, init) => { seen.push(init); return globalThis.fetch(url, init) }
    const sim = new CardSim(`http://127.0.0.1:${server.address().port}`, { fetch, timeoutMs: 250 })
    const started = Date.now()
    await assert.rejects(sim.fixture({ pin: "1234" }), e => e.name === "TimeoutError")
    assert.ok(Date.now() - started < 2000, "failed at the deadline, not the 360-minute CI default")
    assert.ok(seen[0].signal instanceof AbortSignal)
    assert.equal(seen.length, 1, "a timed-out request is not retried")
    // Aborting can prevent dispatch entirely. A server hit is not guaranteed,
    // even after fetch has been called; waiting cannot deliver an aborted request.
    // seen.length above proves there is no retry, with or without socket delivery.
    assert.ok(hits.length <= 1, "at most one request reached the server")
  } finally {
    for (const s of sockets) s.destroy()
    await new Promise(resolve => server.close(resolve))
  }

  const ok = async () => ({ ok: true, status: 200, text: async () => "{}" })
  const dflt = new CardSim("http://127.0.0.1:9", { fetch: ok })
  assert.equal(dflt.timeoutMs, 5000, "the default matches the apps' 5 s transport deadline")
  assert.throws(() => new CardSim("http://127.0.0.1:9", { fetch: ok, timeoutMs: 0 }), RangeError)
  assert.throws(() => new CardSim("http://127.0.0.1:9", { fetch: ok, timeoutMs: Infinity }), RangeError)
})

test("waitReady is bounded", async () => {
  let calls = 0
  const sim = new CardSim("http://127.0.0.1:1", { fetch: async () => { calls++; throw new Error("down") } })
  await assert.rejects(sim.waitReady({ attempts: 3, intervalMs: 1 }), /not ready after 3 attempts/)
  assert.equal(calls, 3)
})

test("select tries the applet's whole AID first, falls back to the package AID and rethrows the last CardError", async () => {
  const sent = []
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body).hex)
    const answer = sent.length === 1 ? { hex: "6A82", sw: "6A82" } : { hex: "03009000", sw: "9000" }
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) }
  }
  const sim = new CardSim("http://127.0.0.1:9", { fetch })
  assert.deepEqual(await sim.select(), { major: 3, minor: 0 })
  assert.deepEqual(sent, ["00a404000bf043415348554341524401", "00a404000af0434153485543415244"])

  const dead = new CardSim("http://127.0.0.1:9", { fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ hex: "6A82", sw: "6A82" }) }) })
  await assert.rejects(dead.select(), e => e instanceof CardError && e.sw === 0x6a82)
})

/** A fake bridge that answers SELECT as the chip does (ENG-681): the package AID reaches the opener, 9000 and no body. */
const chipFetch = sent => async (url, init) => {
  const h = JSON.parse(init.body).hex.toUpperCase()
  sent.push(h)
  const answer = h === "00A404000BF043415348554341524401" ? { hex: "03009000", sw: "9000" }
    : h === "00A404000AF0434153485543415244" ? { hex: "9000", sw: "9000" }
    : { hex: "6D00", sw: "6D00" }
  return { ok: true, status: 200, text: async () => JSON.stringify(answer) }
}

test("on a chip's answers, select reaches the card's applet with its first SELECT, never the opener", async () => {
  const sent = []
  const sim = new CardSim("http://127.0.0.1:9", { fetch: chipFetch(sent) })
  assert.deepEqual(await sim.select(), { major: 3, minor: 0 })
  assert.deepEqual(sent, ["00A404000BF043415348554341524401"])
})

test("a 9000 with no version falls through to the next AID, and is no answer when it is the last", async () => {
  // the whole AID is not answered and the package AID reaches the opener: no card applet
  let n = 0
  const opener = new CardSim("http://127.0.0.1:9", {
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(n++ === 0 ? { hex: "6A82", sw: "6A82" } : { hex: "9000", sw: "9000" }) }),
  })
  await assert.rejects(opener.select(), e => !(e instanceof CardError) && /F0434153485543415244 answered 9000 with no version/.test(e.message))
  // an empty 9000 to the whole AID is passed over for the package AID's version
  const sent = []
  const empty = new CardSim("http://127.0.0.1:9", {
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body).hex)
      return { ok: true, status: 200, text: async () => JSON.stringify(sent.length === 1 ? { hex: "9000", sw: "9000" } : { hex: "03009000", sw: "9000" }) }
    },
  })
  assert.deepEqual(await empty.select(), { major: 3, minor: 0 })
  assert.deepEqual(sent, ["00a404000bf043415348554341524401", "00a404000af0434153485543415244"])
})

/** A fake card holding `packet` behind GET_OUTBOX: the scope is `scopes` in turn (the last one repeated). */
const outboxFetch = (packet, scopes, sent = []) => {
  let n = 0
  return async (url, init) => {
    const b = Buffer.from(JSON.parse(init.body).hex, "hex")
    sent.push(b.toString("hex").toUpperCase())
    let answer
    if (b[1] === 0x1b && b[2] === 0) answer = Buffer.concat([scopes[Math.min(n++, scopes.length - 1)], Buffer.from([0x90, 0])])
    else if (b[1] === 0x1b && b[2] === 1) {
      const offset = b.readUInt16BE(5), count = b[7]
      answer = offset >= packet.length ? Buffer.from([0x6a, 0x83]) : Buffer.concat([packet.subarray(offset, offset + count), Buffer.from([0x90, 0])])
    } else answer = Buffer.from([0x6d, 0])
    return { ok: true, status: 200, text: async () => JSON.stringify({ hex: answer.toString("hex") }) }
  }
}

test("getOutbox reads the scope, pages of 255 to the first short one, and the scope again", async () => {
  const packet = Buffer.from(Array.from({ length: 559 }, (_, i) => i & 0xff))
  const scope = Buffer.alloc(45, 7)
  const sent = []
  const sim = new CardSim("http://127.0.0.1:9", { fetch: outboxFetch(packet, [scope], sent) })
  assert.deepEqual(await sim.getOutbox(), packet)
  assert.deepEqual(sent, ["B01B000000", "B01B0100030000FF00", "B01B01000300FFFF00", "B01B01000301FEFF00", "B01B000000"])
})

test("getOutbox ends at 6A83 when the packet is a whole number of pages, and refuses a record that changed while it was read", async () => {
  const packet = Buffer.alloc(510, 1)
  const sim = new CardSim("http://127.0.0.1:9", { fetch: outboxFetch(packet, [Buffer.alloc(45, 1)]) })
  assert.deepEqual(await sim.getOutbox(), packet)
  const moved = new CardSim("http://127.0.0.1:9", { fetch: outboxFetch(packet, [Buffer.alloc(45, 1), Buffer.alloc(45, 2)]) })
  await assert.rejects(moved.getOutbox(), /changed while it was read/)
  const none = new CardSim("http://127.0.0.1:9", { fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ hex: "6A88" }) }) })
  await assert.rejects(none.getOutbox(), e => e instanceof CardError && e.sw === 0x6a88)
})

// ── integration: only with a running bridge ──────────────────────────────────

const URL = process.env.CARDSIM_URL
const integration = { skip: URL ? false : "set CARDSIM_URL to run against a bridge" }

/** n points to stand in for mints' C and tills' B_: real points, so nothing about them is fake but who made them. */
const pointHex = k => cc.hexOf(cc.compressed(cc.mul(BigInt(k))))

/**
 * A mint of our own for the bridge: a version 00 keyset of `n` keys (2^0 up), each private key known, so the test signs
 * the card's change as a mint would (C_ = k*B_ and NUT-12's e and s) and the card checks it.
 */
function testMint(n = 8, salt = 7000) {
  const priv = Array.from({ length: n }, (_, i) => BigInt(salt + i + 1))
  const keys = priv.map((k, i) => [1n << BigInt(i), cc.compressed(cc.mul(k))])
  const id = keysetId(0, keys)
  const ks = keysetFromMint({ id: id.toString("hex"), unit: "sat", keys: Object.fromEntries(keys.map(([a, k]) => [a.toString(), k.toString("hex")])) })
  const sign = (amount, B_) => {
    const k = priv[Math.log2(amount)]
    const B = cc.point(B_)
    const C_ = cc.mul(k, B)
    const p = BigInt(salt) * 31n + BigInt(amount)
    const e = cc.hashE(cc.mul(p), cc.mul(p, B), cc.mul(k), C_)
    return { C_: cc.compressed(C_), e, s: cc.bytes32((p + cc.int(e) * k) % cc.N), K: cc.compressed(cc.mul(k)), k }
  }
  return { ks, keyset: ks.keyset8.toString("hex"), key: amount => cc.hexOf(keys[Math.log2(amount)][1]), sign }
}

/** A card set up as a wallet sets one up on 3.0: the first set-up in one fixture, then the date's keys read under the PIN. */
async function setUp(sim, extra = {}) {
  const fresh = await sim.reset()
  await sim.fixture({ pin: "1234", mint: "http://127.0.0.1:3338", owner: true, ...extra })
  await sim.select()
  await sim.verifyPin("1234")
  const keys = await sim.groupKeys(0)
  return { P: fresh.pubkey, ...keys }
}

test("the bridge answers both SELECTs as the chip does: the whole AID 03 00, the package AID the opener's bare 9000", integration, async () => {
  const sim = new CardSim(URL)
  await sim.waitReady()
  await sim.reset()
  const byPackage = await sim.apdu(encode.select(constants.PACKAGE_AID))
  assert.equal(byPackage.sw, constants.SW.OK)
  assert.equal(byPackage.data.length, 0, "the opener answers with no version")
  assert.equal((await sim.apdu(encode.getInfo())).sw, constants.SW.INS_NOT_SUPPORTED, "and refuses the next command")
  const whole = await sim.apdu(encode.select(constants.APPLET_AID))
  assert.equal(whole.sw, constants.SW.OK)
  assert.deepEqual(whole.data, Buffer.from([3, 0]))
  const info = await sim.getInfo()
  assert.equal(info.version, "3.0")
  assert.equal(info.keysPerLoad, true, "GET_INFO P1 4 byte 56 bit 1")
  assert.equal(info.profilesRaw, 0xff03)
  await sim.apdu(encode.select(constants.PACKAGE_AID))
  assert.deepEqual(await sim.select(), { major: 3, minor: 0 })
})

test("reset → fixture {pin, mint, owner, blockedPin} → pinState 2 → the owner's changePin → verifyPin; a card with no PIN takes nothing (6A97)", integration, async () => {
  const sim = new CardSim(URL)
  await sim.waitReady()
  const fresh = await sim.reset()
  assert.equal(fresh.pubkey.length, 66)
  assert.equal(fresh.slots.length, 128)
  assert.equal(fresh.version, "3.0")
  assert.deepEqual(await sim.select(), { major: 3, minor: 0 })
  await assert.rejects(sim.loadProof("0059534ce0bfa19a", 8, "11".repeat(32), pointHex(5)), e => e instanceof CardError && e.sw === constants.SW.NO_PIN)
  await assert.rejects(sim.spendAllBegin([0]), e => e.sw === constants.SW.NO_PIN)
  const state = await sim.fixture({ pin: "1234", mint: "http://m", owner: true, blockedPin: true })
  assert.equal(state.pinState, 2)
  assert.equal(state.ownerKey, TEST_OWNER_PUB)
  assert.equal((await sim.getInfo()).pinState, 2)
  await assert.rejects(sim.verifyPin("1234"), e => e instanceof CardError && e.sw === constants.SW.PIN_BLOCKED)
  await sim.changePin("5678")
  await sim.verifyPin("5678")
  assert.ok((await sim.send(Buffer.from("B018000000", "hex"), "GET_LOG")).length > 0, "the session is open")
  await sim.select()
  await assert.rejects(sim.send(Buffer.from("B018000000", "hex"), "GET_LOG"), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "SELECT dropped the session")
  await sim.allowLoad()
  await assert.rejects(sim.loadProof("0059534ce0bfa19a", 8, "11".repeat(32), pointHex(5)), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "the grant (6200) opens no load")
  assert.equal((await sim.state()).pubkey, fresh.pubkey, "the key is deterministic across the run")
})

test("the old AIDs select nothing: an app reads it as a card that needs an update", integration, async () => {
  const sim = new CardSim(URL)
  await sim.reset()
  for (const aid of [constants.OLD_AIDS.upstream0x, constants.OLD_AIDS.foxy1x]) {
    const { sw } = await sim.apdu(encode.select(aid))
    assert.notEqual(sw, constants.SW.OK, aid.toString("hex"))
  }
})

test("keys per load on the bridge: GROUP_KEYS is P + t*G under the PIN, BEGIN P1 02 answers the same t, the signature is under that key and not P; BEGIN without bit 1 is 6A86", integration, async () => {
  const sim = new CardSim(URL)
  const { P, t, key, refund } = await setUp(sim)
  assert.equal(cc.hexOf(cc.tweakedKey(P, t)), key.toString("hex"), "P + t*G")
  assert.deepEqual(refund, Buffer.alloc(33), "the date 0 names no refund key")
  await sim.select()
  await assert.rejects(sim.groupKeys(0), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "GROUP_KEYS wants the PIN or the grant")
  const pieces = [32, 16, 8].map((amount, i) => ({ keysetId: "00ad268c4d1f5826", amount, nonce: cc.hexOf(nodeCrypto.randomBytes(32)), C: pointHex(1000 + i) }))
  await sim.fixture({ pin: "1234", proofs: pieces })
  await sim.select()
  const old = Buffer.from(encode.spendAllBegin([0])); old[2] = 0
  assert.equal((await sim.apdu(old)).sw, constants.SW.INCORRECT_P1P2, "2.2's BEGIN: nothing burned")
  await sim.verifyPin("1234")
  const begun = await sim.spendAllBegin([0, 1])
  assert.equal(begun.total, 48, "what the two pieces are worth")
  assert.deepEqual(begun.t, t, "the payment's date is 0: its t is GROUP_KEYS'")
  const outputs = [{ amount: 16, B_: pointHex(7) }, { amount: 32, B_: pointHex(8) }]
  await sim.spendAllOutputs(outputs)
  const { signature } = await sim.spendAllSign()
  const inputs = pieces.slice(0, 2).map(p => ({ secret: cc.cardSecret(p.nonce, key), C: p.C }))
  assert.ok(cc.verifyPayment(key, inputs, outputs, signature), "one SIG_ALL signature by P + t*G")
  assert.ok(!cc.schnorrVerify(P, cc.sigAllMessage(inputs, outputs), signature), "never by P")
  assert.deepEqual(await sim.spendAllAgain(), signature, "the same signature, asked again")
  const after = await sim.state()
  assert.deepEqual(after.slots.slice(0, 3).map(s => s.status), ["spent", "spent", "unspent"])
  assert.equal(after.slots[0].nonce, pieces[0].nonce, "/state reads in the app's tap, the PIN given in it: the spent piece is said")
  await sim.select()
  const stranger = await sim.state()
  assert.equal(stranger.slots[0].status, "spent")
  assert.equal(stranger.slots[0].nonce, undefined, "a new tap with no PIN: a spent place is history, and /state says no piece for it")
  assert.equal(stranger.slots[2].nonce, pieces[2].nonce, "an unspent one is said to anyone")
})

test("the card's own change on the bridge: teach the keyset, pay with change bound to K, show each opening's key, LOAD_CHANGE the mint's answer with no PIN", integration, async () => {
  const sim = new CardSim(URL)
  const mint = testMint()
  const { P, key } = await setUp(sim)
  const pieces = [32, 16].map(amount => ({ keysetId: mint.keyset, amount, nonce: cc.hexOf(nodeCrypto.randomBytes(32)), C: pointHex(2000 + amount) }))
  await sim.fixture({ pin: "1234", proofs: pieces })
  await sim.select()
  await sim.verifyPin("1234")
  // change is made only in a keyset the card was taught
  assert.equal((await sim.spendAllBegin([0, 1])).total, 48)
  await sim.spendAllOutputs([{ amount: 8, B_: pointHex(31) }])
  await assert.rejects(sim.spendAllChange(32, mint.key(32), mint.keyset), e => e.sw === constants.SW.KEYS_NOT_SHOWN)
  assert.deepEqual(await sim.teachKeyset(mint.ks), mint.ks.id)
  const till = [{ amount: 8, B_: pointHex(31) }]
  await sim.spendAllBegin([0, 1])
  await sim.spendAllOutputs(till, mint.keyset)
  const change = []
  for (const amount of [32, 8]) change.push({ amount, B_: cc.hexOf(await sim.spendAllChange(amount, mint.key(amount), mint.keyset)) })
  const { signature } = await sim.spendAllSign()
  const inputs = pieces.map(p => ({ secret: cc.cardSecret(p.nonce, key), C: p.C }))
  assert.ok(cc.verifyPayment(key, inputs, [...till, ...change], signature), "the change is in the message, after the till's outputs")
  // a new tap, no PIN: the openings, their keys shown, the mint's answers loaded
  await sim.select()
  assert.equal((await sim.getInfo()).changeOwed, true, "GET_INFO byte 29: change owed")
  const openings = await sim.owedChange()
  assert.deepEqual(openings.map(o => [o.amount, o.B_, o.K, o.keysetId]), change.map(c => [c.amount, c.B_, mint.key(c.amount), mint.keyset]))
  for (const o of openings) {
    const a = mint.sign(o.amount, o.B_)
    await assert.rejects(sim.loadChange(o.number, a.C_, a.K, a.e, a.s), e => e.sw === constants.SW.KEYS_NOT_SHOWN, "the key not shown yet")
    await sim.showOpeningKey(o, mint.ks)
    const bad = Buffer.from(a.e); bad[31] ^= 1
    await assert.rejects(sim.loadChange(o.number, a.C_, a.K, bad, a.s), e => e.sw === constants.SW.WRONG_DATA, "a proof that does not hold")
    const got = await sim.loadChange(o.number, a.C_, a.K, a.e, a.s)
    assert.equal(got.piece.amount, o.amount)
    assert.equal(got.piece.keysetId, mint.keyset)
    // the card's own secret: its key for the date, the payment's date; C = k*Y, and the proof it kept holds
    const secret = cc.cardSecret(got.piece.nonce, key, got.piece.date)
    assert.equal(got.piece.C, cc.hexOf(cc.compressed(cc.mul(a.k, cc.hashToCurve(Buffer.from(secret))))), "C = k*Y of the card's change secret")
    const dleq = await sim.getDleq(got.slot)
    assert.equal(dleq[0], 1)
    assert.ok(cc.verifyProofDleq(secret, got.piece.C, dleq.subarray(1, 33), dleq.subarray(33, 65), dleq.subarray(65, 97), a.K), "the proof kept with the piece, r its own blinding factor")
    await assert.rejects(sim.loadChange(o.number, a.C_, a.K, a.e, a.s), e => e.sw === constants.SW.SLOT_EMPTY, "an opening not owed any more")
  }
  assert.deepEqual(await sim.owedChange(), [], "the openings let go")
  assert.equal((await sim.state()).balance, 40, "8 paid out, 40 back as change")
  assert.ok(P)
})

test("a full card: 128 pieces, then LOAD_PROOF is 6A84; the PIN in the tap frees a spent place and loads into it", integration, async () => {
  const sim = new CardSim(URL)
  await sim.reset()
  const proofs = Array.from({ length: 128 }, (_, i) => ({
    keysetId: "0059534ce0bfa19a", amount: 2 ** (i % 20), nonce: i.toString(16).padStart(2, "0").repeat(32), C: pointHex(i + 1),
  }))
  const state = await sim.fixture({ pin: "1234", mint: "http://m", owner: true, proofs, spentSlots: [1] })
  assert.equal(state.slots.filter(s => s.status === "unspent").length, 127)
  assert.equal(state.slots[1].status, "spent")
  await sim.select()
  assert.deepEqual((await sim.getSlotStatus()).slice(0, 3), [1, 2, 1])
  assert.equal(await sim.getProofCount(), 128)
  await assert.rejects(sim.getProof(1), e => e.sw === constants.SW.SLOT_EMPTY, "a spent place, to a reader with no PIN, is an empty one")
  await assert.rejects(sim.clearSpent(), e => e.sw === constants.SW.SECURITY_NOT_SATISFIED, "CLEAR_SPENT wants the PIN in the tap")
  await sim.verifyPin("1234")
  assert.equal((await sim.getProof(1)).nonce, "01".repeat(32))
  assert.equal(await sim.clearSpent(), 1)
  assert.equal(await sim.loadProof("0059534ce0bfa19a", 2, "ff".repeat(32), pointHex(999)), 1, "the freed slot")
  await assert.rejects(
    sim.loadProof("0059534ce0bfa19a", 2, "fe".repeat(32), pointHex(998)),
    e => e instanceof CardError && e.sw === constants.SW.NO_SPACE,
  )
})

test("a refused fixture step is a CardSimError(409) and state keeps fixtureError", integration, async () => {
  const sim = new CardSim(URL)
  await sim.reset()
  await sim.fixture({ pin: "1234" })
  await assert.rejects(sim.fixture({ pin: "5678" }), e => e instanceof CardSimError && e.status === 409 && e.body.error === "VERIFY_PIN")
  assert.deepEqual((await sim.state()).fixtureError, { step: "VERIFY_PIN", sw: "63C1" }, "a card with no owner counts wrong tries in a row")
})

test("the 0.x fixture keys are refused locally and by the bridge; so are a load with no PIN and a claim after the first set-up", integration, async () => {
  const sim = new CardSim(URL)
  await sim.reset()
  await assert.rejects(sim.request("POST", "/fixture", { puk: "12345678" }), e => e instanceof CardSimError && e.status === 400)
  await assert.rejects(sim.request("POST", "/fixture", { appletVersion: "0.6" }), e => e instanceof CardSimError && e.status === 400)
  await assert.rejects(sim.request("POST", "/fixture", { mint: "http://m", owner: true, proofs: [{ keysetId: "0059534ce0bfa19a", amount: 8, nonce: "11".repeat(32), C: pointHex(3) }] }),
    e => e instanceof CardSimError && e.status === 400)
  await sim.fixture({ pin: "1234", mint: "http://m" })
  await assert.rejects(sim.request("POST", "/fixture", { pin: "1234", owner: true }), e => e instanceof CardSimError && e.status === 400 && /first set-up/.test(e.body.error))
})
