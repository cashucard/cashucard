package me.flashapp.cashu;

import javacard.framework.ISOException;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.KeyBuilder;
import java.math.BigInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Drives {@link SchnorrHW#sign} directly with keys of our choosing.
 *
 * Why this cannot be done through the applet: {@code SchnorrHW.sign()} branches
 * on the parity of the card public key's y-coordinate — if P.y is odd it must
 * sign with d = n − d rather than d. On a real card the parity is a coin flip
 * per card. Under jCardSim it is not random at all: {@code KeyPairImpl} seeds
 * its generator with {@code SecureRandomNullProvider}, so every simulator ever
 * created generates the <em>same</em> keypair, and that keypair has an even y
 * (…F678). Installing a thousand simulators exercises the even-y path a
 * thousand times and the odd-y path zero times.
 *
 * That is the whole reason this file exists. A broken d = n − d normalisation
 * would have left every applet-level signature test green while half of all
 * cards in the field produced signatures every mint rejects. Here the private
 * key is chosen, so both branches run on every single test run, deterministically.
 *
 * Public keys are the true d·G values for each d (independently computed), so a
 * wrong point would fail before the signature is even looked at.
 */
class SchnorrHWSignTest {

    // ── secp256k1 parameters, same values the applet installs on its keys ────
    private static final byte[] SECP_P = CashuAppletTest.hexToBytes(
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
    private static final byte[] SECP_A = new byte[32];
    private static final byte[] SECP_B = CashuAppletTest.hexToBytes(
        "0000000000000000000000000000000000000000000000000000000000000007");
    private static final byte[] SECP_N = CashuAppletTest.hexToBytes(
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
    private static final byte[] SECP_G = CashuAppletTest.hexToBytes(
        "04"
        + "79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"
        + "483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8");

    /** { private key d, uncompressed public key 04||X||Y, "is P.y odd" }. */
    static final Object[][] KEYS = {
        { "0000000000000000000000000000000000000000000000000000000000000003",
          "04F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9"
          + "388F7B0F632DE8140FE337E62A37F3566500A99934C2231B6CB9FD7584B8E672",
          Boolean.FALSE },
        { "0000000000000000000000000000000000000000000000000000000000000002",
          "04C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5"
          + "1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52A",
          Boolean.FALSE },
        { "B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF",
          "04DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659"
          + "2CE19B946C4EE58546F5251D441A065EA50735606985E5B228788BEC4E582898",
          Boolean.FALSE },
        { "0000000000000000000000000000000000000000000000000000000000000006",
          "04FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A1460297556"
          + "AE12777AACFBB620F3BE96017F45C560DE80F0F6518FE4A03C870C36B075F297",
          Boolean.TRUE },
        { "0000000000000000000000000000000000000000000000000000000000000009",
          "04ACD484E2F0C7F65309AD178A9F559ABDE09796974C57E714C35F110DFC27CCBE"
          + "CC338921B0A7D9FD64380971763B61E9ADD888A4375F8E0F05CC262AC64F9C37",
          Boolean.TRUE },
        { "0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710",
          "0425D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517"
          + "0CFEB7AC4341CB6441C702568A8C0FBDC873B0CF5C8181FDAFE3AEE6F49CD4A9",
          Boolean.TRUE },
    };

    @Test
    @DisplayName("sign() verifies for both P.y parities, including the d = n - d path")
    void signVerifiesForBothPubkeyParities() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();

        byte[] msg = new byte[32];
        for (int i = 0; i < 32; i++) msg[i] = (byte) (0x5A ^ i);

        int evenKeys = 0, oddKeys = 0;
        for (Object[] k : KEYS) {
            byte[] d     = CashuAppletTest.hexToBytes((String) k[0]);
            byte[] w     = CashuAppletTest.hexToBytes((String) k[1]);
            boolean yOdd = (Boolean) k[2];

            assertEquals(65, w.length, "public key must be uncompressed 04||X||Y");
            assertEquals(yOdd, CashuAppletTest.pubkeyYIsOdd(w),
                "test data is inconsistent: declared parity does not match the point");
            if (yOdd) oddKeys++; else evenKeys++;

            ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
            ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
            setCurve(priv, pub);
            priv.setS(d, (short) 0, (short) 32);
            pub.setW(w, (short) 0, (short) 65);

            byte[] sig = new byte[64];
            assertEquals(64, schnorr.sign(priv, pub, msg, (short) 0, sig, (short) 0),
                "sign() must report a 64-byte signature");

            assertTrue(CashuAppletTest.schnorrVerify(
                    java.util.Arrays.copyOfRange(w, 1, 33), msg, sig),
                "signature must verify for d=" + k[0] + " (P.y "
                    + (yOdd ? "odd — the d = n - d normalisation is wrong"
                            : "even — the plain-d path is wrong") + ")");
        }

        assertTrue(oddKeys > 0, "no odd-y key in the corpus: the d = n - d branch is untested");
        assertTrue(evenKeys > 0, "no even-y key in the corpus: the plain-d branch is untested");
    }

    /**
     * The scratch buffers are allocated once in the constructor and reused for
     * every signature, so a helper that reads a stale byte instead of writing it
     * would only misbehave from the second signature onward.
     *
     * "Repeatable" here means every call keeps producing a <em>valid</em>
     * signature — not the same bytes. Signature bytes must not repeat; that is
     * the aux-randomness property asserted below and in
     * {@link #signUsesAFreshNonce()}.
     */
    @Test
    @DisplayName("sign() keeps producing valid, non-repeating signatures across many calls")
    void signIsRepeatableAcrossCalls() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();

        // An odd-y key, so the reused-scratch path covers the normalisation too.
        byte[] d = CashuAppletTest.hexToBytes(
            "0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710");
        byte[] w = CashuAppletTest.hexToBytes(
            "0425D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517"
            + "0CFEB7AC4341CB6441C702568A8C0FBDC873B0CF5C8181FDAFE3AEE6F49CD4A9");
        byte[] pubX = java.util.Arrays.copyOfRange(w, 1, 33);

        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        priv.setS(d, (short) 0, (short) 32);
        pub.setW(w, (short) 0, (short) 65);

        byte[] first = null;
        for (int i = 0; i < 16; i++) {
            byte[] msg = new byte[32];
            java.util.Arrays.fill(msg, (byte) i);
            byte[] sig = new byte[64];
            schnorr.sign(priv, pub, msg, (short) 0, sig, (short) 0);
            assertTrue(CashuAppletTest.schnorrVerify(pubX, msg, sig),
                "signature " + i + " must verify — reused scratch buffers leaked state");

            // Re-signing a fixed message on the same instance must keep verifying
            // no matter how much scratch has been churned since. It must NOT
            // reproduce the earlier signature — see signUsesAFreshNonce below.
            byte[] again = new byte[64];
            byte[] msg0 = new byte[32];
            schnorr.sign(priv, pub, msg0, (short) 0, again, (short) 0);
            assertTrue(CashuAppletTest.schnorrVerify(pubX, msg0, again),
                "re-signature of the all-zero message after call " + i + " must verify");
            if (first == null) {
                first = again;
            } else {
                assertFalse(java.util.Arrays.equals(first, again),
                    "re-signing the same message after call " + i
                        + " reproduced an earlier signature: the nonce is a pure "
                        + "function of (d, msg) and the aux randomness is not reaching k");
            }
        }
    }

    /**
     * The finding this test exists for: {@code sign()} used to derive k as
     * {@code taggedHash("BIP0340/nonce", d ‖ zeros32 ‖ msg)} — a deterministic
     * nonce, under a class header claiming BIP-340. Every such signature
     * verifies, so nothing else in this suite noticed.
     *
     * It matters because this is a bearer card sitting in an attacker-controlled
     * NFC field. With k a pure function of (d, msg), a fault injected after R is
     * emitted but before e is folded in yields two signatures sharing k, and
     * {@code d = (s1 − s2)/(e1 − e2)} recovers the card key outright — every
     * proof on the card, and every proof ever loaded onto it, becomes spendable.
     * BIP-340's auxiliary randomness exists to close exactly this.
     *
     * So: same key, same message, many signatures. Each must verify, and the R
     * values must all differ. A regression to a deterministic nonce collapses
     * every R to one value and fails here.
     *
     * Scoped to a single signer on purpose. jCardSim backs
     * {@code RandomData.ALG_SECURE_RANDOM} with an unseeded BouncyCastle
     * {@code DigestRandomGenerator}, so two freshly constructed simulators walk
     * the same byte stream — comparing signatures <em>across</em> instances
     * would test the simulator's seeding, not the applet. Within one instance
     * the generator advances, which is exactly the property under test.
     */
    @Test
    @DisplayName("sign() draws a fresh nonce per call (BIP-340 aux randomness)")
    void signUsesAFreshNonce() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();

        byte[] d = CashuAppletTest.hexToBytes(
            "B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF");
        byte[] w = CashuAppletTest.hexToBytes(
            "04DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659"
            + "2CE19B946C4EE58546F5251D441A065EA50735606985E5B228788BEC4E582898");
        byte[] pubX = java.util.Arrays.copyOfRange(w, 1, 33);

        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        priv.setS(d, (short) 0, (short) 32);
        pub.setW(w, (short) 0, (short) 65);

        byte[] msg = CashuAppletTest.hexToBytes(
            "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89");

        java.util.Set<String> seenR = new java.util.HashSet<>();
        for (int i = 0; i < 24; i++) {
            byte[] sig = new byte[64];
            assertEquals(64, schnorr.sign(priv, pub, msg, (short) 0, sig, (short) 0));
            assertTrue(CashuAppletTest.schnorrVerify(pubX, msg, sig),
                "signature " + i + " over the fixed message must verify");
            String r = bytesToHex(java.util.Arrays.copyOfRange(sig, 0, 32));
            assertTrue(seenR.add(r),
                "R repeated on signature " + i + " over an identical message — the "
                    + "nonce is deterministic, so a fault-injected replay recovers "
                    + "the card private key from the two s values");
        }
        assertEquals(24, seenR.size(), "every signature must use its own nonce");
    }

    /**
     * The finding this test exists for: {@code sign()} called
     * {@code privKey.getS(sc, SC_D)} and threw the returned length away, then
     * unconditionally read 32 bytes at {@code sc[SC_D..SC_D+31]} — while the
     * exactly analogous {@code pubKey.getW} length three lines later <em>was</em>
     * checked.
     *
     * The JavaCard API does not promise that {@code getS} left-pads: it returns
     * the scalar's byte length with the value right-aligned, so a card that
     * strips leading zero bytes is spec-legal, and roughly one generated key in
     * 256 has a zero high byte. Two wrong answers exist here. Trusting the
     * length folds the tail of the shared scratchpad into d, and every signature
     * fails verification while the proofs stay P2PK-locked to that key —
     * unspendable. <em>Refusing</em> the card is no better: the card key is
     * generated on-card, so a short scalar is luck, not a defect, and rejecting
     * it bricks working hardware at random. sign() must right-align.
     *
     * jCardSim always returns 32, so nothing else in this suite can surface any
     * of it; the stand-in below reports its length the way a stripping card
     * would. The scratchpad is deliberately dirtied by a preceding signature so
     * that a missing zero-pad shows up as a wrong d rather than as a lucky read
     * of a still-zero buffer.
     */
    @Test
    @DisplayName("sign() right-aligns a getS shorter than 32 bytes instead of failing")
    void signRightAlignsShortPrivateScalar() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();

        byte[] msg = CashuAppletTest.hexToBytes(
            "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89");

        // Churn the scratchpad with a full-width 32-byte key first, so sc[0..31]
        // holds a foreign scalar when the short key is read over it.
        ECPrivateKey dirtyPriv = (ECPrivateKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey dirtyPub = (ECPublicKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(dirtyPriv, dirtyPub);
        dirtyPriv.setS(CashuAppletTest.hexToBytes((String) KEYS[2][0]), (short) 0, (short) 32);
        dirtyPub.setW(CashuAppletTest.hexToBytes((String) KEYS[2][1]), (short) 0, (short) 65);
        schnorr.sign(dirtyPriv, dirtyPub, msg, (short) 0, new byte[64], (short) 0);

        // d = 3: 31 leading zero bytes, i.e. squarely in the class of keys a
        // leading-zero-stripping card misreports.
        byte[] d = CashuAppletTest.hexToBytes((String) KEYS[0][0]);
        byte[] w = CashuAppletTest.hexToBytes((String) KEYS[0][1]);
        byte[] pubX = java.util.Arrays.copyOfRange(w, 1, 33);

        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        priv.setS(d, (short) 0, (short) 32);
        pub.setW(w, (short) 0, (short) 65);

        // Control leg: with a full-width getS this exact key signs and verifies,
        // so a failure below is about the short length and not about d = 3.
        byte[] good = new byte[64];
        assertEquals(64, schnorr.sign(priv, pub, msg, (short) 0, good, (short) 0));
        assertTrue(CashuAppletTest.schnorrVerify(pubX, msg, good),
            "control signature with a 32-byte getS must verify");

        ECPrivateKey stripping = new LeadingZeroStrippingPrivateKey(priv);
        assertEquals(1, stripping.getS(new byte[32], (short) 0),
            "the stand-in must actually report a short length, or this test is vacuous");

        byte[] sig = new byte[64];
        assertEquals(64, schnorr.sign(stripping, pub, msg, (short) 0, sig, (short) 0),
            "a spec-legal card whose getS strips leading zeros must still sign");
        assertTrue(CashuAppletTest.schnorrVerify(pubX, msg, sig),
            "the short scalar must be right-aligned and zero-padded — a signature that "
                + "fails to verify means the scratchpad tail was folded into d");
    }

    /**
     * The complement of the test above: right-aligning is only safe for a length
     * that fits. A card reporting 0 or more than 32 bytes is not a
     * leading-zero-stripping card, it is a card this applet does not understand,
     * and padding whatever it wrote would sign with a scalar nobody chose.
     */
    @Test
    @DisplayName("sign() refuses a getS length outside 1..32")
    void signRejectsOutOfRangePrivateScalarLength() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();

        byte[] d = CashuAppletTest.hexToBytes((String) KEYS[2][0]);
        byte[] w = CashuAppletTest.hexToBytes((String) KEYS[2][1]);

        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(
            KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        priv.setS(d, (short) 0, (short) 32);
        pub.setW(w, (short) 0, (short) 65);

        byte[] msg = new byte[32];
        for (short bogus : new short[] { 0, 33, -1 }) {
            ECPrivateKey liar = new FixedLengthPrivateKey(priv, bogus);
            byte[] sig = new byte[64];
            ISOException thrown = org.junit.jupiter.api.Assertions.assertThrows(
                ISOException.class,
                () -> schnorr.sign(liar, pub, msg, (short) 0, sig, (short) 0),
                "a getS length of " + bogus + " must be refused, not padded");
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, thrown.getReason(),
                "an out-of-range getS length must report SW_CRYPTO_ERROR");
        }
    }

    /** One group order: the signer reduces against the array the key objects are given. */
    @Test
    @DisplayName("The signer and the key objects share one n")
    void oneGroupOrder() throws Exception {
        assertTrue(java.util.Arrays.equals(SECP_N, CashuApplet.SECP256K1_N), "n as the curve has it");
        String signer = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("src/main/java/me/flashapp/cashu/SchnorrHW.java")));
        assertFalse(signer.contains("0xBA,(byte)0xAE"), "no copy of n in the signer");
        assertTrue(signer.contains("CashuApplet.curve(tmpPriv)"), "the signer's key gets the applet's curve");
    }

    /**
     * DELTA is not an independent constant: mulModN's reduction is only correct
     * while DELTA == 2^256 − n. Editing one without the other is silent, so
     * init() asserts the identity. Mutating the static array here is the only
     * way to exercise that assertion; the original byte is restored in a finally
     * block, and Surefire runs these tests on one thread.
     */
    @Test
    @DisplayName("init() refuses a DELTA that is not 2^256 - n")
    void initRejectsDeltaInconsistentWithN() throws Exception {
        java.lang.reflect.Field f = SchnorrHW.class.getDeclaredField("DELTA");
        f.setAccessible(true);
        byte[] delta = (byte[]) f.get(null);
        byte original = delta[31];
        try {
            delta[31] ^= (byte) 0x01;
            SchnorrHW schnorr = new SchnorrHW();
            ISOException thrown = org.junit.jupiter.api.Assertions.assertThrows(
                ISOException.class, schnorr::init,
                "a DELTA that is not 2^256 - n must fail the install");
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, thrown.getReason());
        } finally {
            delta[31] = original;
        }

        // The constant is back: a signer built now must still work.
        SchnorrHW restored = new SchnorrHW();
        restored.init();
    }

    // ── The temporary key, the chip's framing, the points it is sent ────────

    private static final BigInteger FP = new BigInteger(1, SECP_P);
    private static final BigInteger FN = new BigInteger(1, SECP_N);

    static Object hidden(SchnorrHW s, String name) throws Exception {
        java.lang.reflect.Field f = SchnorrHW.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(s);
    }

    static void setHidden(SchnorrHW s, String name, Object value) throws Exception {
        java.lang.reflect.Field f = SchnorrHW.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(s, value);
    }

    static ECPrivateKey keyOf(String hexD) {
        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        priv.setS(CashuAppletTest.hexToBytes(hexD), (short) 0, (short) 32);
        return priv;
    }

    static ECPublicKey pubOf(String hexW) {
        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        setCurve(priv, pub);
        pub.setW(CashuAppletTest.hexToBytes(hexW), (short) 0, (short) 65);
        return pub;
    }

    static boolean allZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    static byte[] u32(BigInteger v) {
        byte[] raw = v.toByteArray(), out = new byte[32];
        int len = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - len, out, 32 - len, len);
        return out;
    }

    static byte[] point(BigInteger x, BigInteger y) {
        byte[] out = new byte[65];
        out[0] = 4;
        System.arraycopy(u32(x), 0, out, 1, 32);
        System.arraycopy(u32(y), 0, out, 33, 32);
        return out;
    }

    /** The root (x^3 + 7)^((p+1)/4) mod p: the Y an engine that works Y out again by the plain square root answers. */
    static BigInteger plainRoot(BigInteger x) {
        return x.pow(3).add(BigInteger.valueOf(7)).mod(FP).modPow(FP.add(BigInteger.ONE).shiftRight(2), FP);
    }

    /** [k]G, 04 || X || Y. */
    static byte[] timesG(long k) {
        BigInteger[] w = CashuAppletTest.ecMulTest(BigInteger.valueOf(k), CashuAppletTest.SECP_GX, CashuAppletTest.SECP_GY);
        return point(w[0], w[1]);
    }

    private static int refusal(Runnable r) {
        try { r.run(); } catch (ISOException e) { return e.getReason() & 0xFFFF; }
        return 0x9000;
    }

    private static byte[] taggedHash(String tag, byte[]... parts) throws Exception {
        java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
        byte[] t = d.digest(tag.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        d.update(t);
        d.update(t);
        for (byte[] p : parts) d.update(p);
        return d.digest();
    }

    /** A signer whose temporary key is one of this test's, as a chip that gives the key in RAM would have it: wiped by clearKey, its curve set again at each use. */
    private static SchnorrHW signerWithKeyInRam() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        setHidden(schnorr, "tmpPriv", KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false));
        setHidden(schnorr, "keyInRam", Boolean.TRUE);
        return schnorr;
    }

    /**
     * A key agreement that stands in front of the simulator's: it counts the points it is given and, as told, answers as a chip
     * whose framing differs would (`frame`, FRAMINGS: "" as the real one, "bare" the 64 bytes X || Y, "lead00" 65 bytes that do
     * not begin 04, "short" 33 bytes, "yx" 04 || Y || X, "other" 04 and the coordinates of another point, 3G, "negy"
     * 04 || X || p - Y, "hyb" the hybrid form 06 or 07 || X || Y, "comp65" 02 or 03 || X || Y, "ret64" and "ret66" the right
     * 65 bytes with another length), as an engine that gets the point wrong would (`model`, a member of the family of wrong
     * engines, see FAMILY_IN; or `frame` set to one of WRONG_ENGINES, each a member of that family by name: "even", "odd",
     * "root", "negroot" and "xbit" the answer's Y read as the even root, the odd root, the root (x^3 + 7)^((p+1)/4), p less it,
     * or the root whose parity is X's; "notG" the answer negated where the base or generator is not G; "negin" the point it is
     * given (the key agreement's base, the point the addition adds) taken with its Y negated; "hi" a scalar s above n/2 worked
     * as [n - s] with the sign not put back; "inEven" and "inXbit" the point it is given (the key agreement) or the key's
     * generator (the point addition) taken by X alone, with the even root or the root whose parity is X's; "hOdd", "hNegroot"
     * and "hXbit" the point it is given (the key agreement's base, the point the addition adds) taken by X alone, with the odd
     * root, p less the root, or the root whose parity is X's; "evenHi" inEven and hi at once), or throws as a chip may part
     * way through a signature (`fail`), or refuses to be initialised (`refuseInit`). `scalars` holds the scalar of each key
     * it is initialised with.
     */
    static final class WatchedAgreement extends javacard.security.KeyAgreement {
        final javacard.security.KeyAgreement real;
        final java.util.List<byte[]> given = new java.util.ArrayList<>();
        String frame = "";
        /** A member of the family of wrong engines (FAMILY_IN), or null: {base, scalar, answer} on the key agreement, {generator, point added, scalar, middle point, answer} on the point addition. */
        String[] model;
        boolean fail, refuseInit;
        /** The call (1 for the first) at which it throws, 0 for none; and the call whose answer's Y it negates, 0 for none. */
        int failOn, negateOn;

        WatchedAgreement(byte alg) { real = javacard.security.KeyAgreement.getInstance(alg, false); }

        /** The generator of each key it is initialised with (the point the generic mapping multiplies). */
        final java.util.List<byte[]> generators = new java.util.ArrayList<>();
        final java.util.List<byte[]> scalars = new java.util.ArrayList<>();
        /** The scalar of the key at each point it is given (as `given`). */
        final java.util.List<BigInteger> askedBy = new java.util.ArrayList<>();
        @Override public void init(javacard.security.PrivateKey k) {
            if (refuseInit) javacard.security.CryptoException.throwIt(javacard.security.CryptoException.ILLEGAL_VALUE);
            if (k instanceof ECPrivateKey && k.isInitialized()) {
                byte[] g = new byte[65];
                short n = ((ECPrivateKey) k).getG(g, (short) 0);
                generators.add(java.util.Arrays.copyOf(g, n));
                byte[] sk = new byte[32];
                ((ECPrivateKey) k).getS(sk, (short) 0);
                scalars.add(sk);
                byte[] s = new byte[33];
                lastS = new BigInteger(1, java.util.Arrays.copyOf(s, ((ECPrivateKey) k).getS(s, (short) 0)));
                lastG = n == 65 ? xy(g, 0) : null;
            }
            real.init(k);
        }
        /** The scalar and generator of the key it was last initialised with. */
        BigInteger lastS;
        BigInteger[] lastG;
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] pub, short off, short len, byte[] out, short outOff) {
            given.add(java.util.Arrays.copyOfRange(pub, off, off + len));
            askedBy.add(lastS);
            if (fail || given.size() == failOn) javacard.security.CryptoException.throwIt(javacard.security.CryptoException.ILLEGAL_USE);
            boolean gm = real.getAlgorithm() == javacard.security.KeyAgreement.ALG_EC_PACE_GM;
            if (given.size() == negateOn) {
                byte[] full = new byte[65];
                real.generateSecret(pub, off, len, full, (short) 0);
                System.arraycopy(negate(full), 0, out, outOff, 65);
                return 65;
            }
            if (model == null && MethodModels.is(frame) && len == 65) {
                // a fault of the method (MethodModels), worked out from the key's scalar and generator and the point given
                System.arraycopy(MethodModels.answer(frame, gm, lastS, lastG, xy(pub, off)), 0, out, outOff, 65);
                return 65;
            }
            String[] m = model != null ? model : named(frame, gm);
            if (m != null && len == 65) {
                // worked out here, by the model's rules, from the key's scalar and generator and the point given
                BigInteger[] r = modelAnswer(m, lastS, gm ? lastG : null, xy(pub, off));
                System.arraycopy(r == null ? new byte[] { 4 } : point(r[0], r[1]), 0, out, outOff, r == null ? 1 : 65);
                if (r == null) java.util.Arrays.fill(out, outOff + 1, outOff + 65, (byte) 0);
                return 65;
            }
            byte[] full = new byte[65];
            short n = real.generateSecret(pub, off, len, full, (short) 0);
            BigInteger fy = new BigInteger(1, java.util.Arrays.copyOfRange(full, 33, 65));
            switch (frame) {
                case "hyb": System.arraycopy(full, 0, out, outOff, 65); out[outOff] = (byte) (6 | (fy.testBit(0) ? 1 : 0)); return 65;
                case "comp65": System.arraycopy(full, 0, out, outOff, 65); out[outOff] = (byte) (2 | (fy.testBit(0) ? 1 : 0)); return 65;
                case "ret64": System.arraycopy(full, 0, out, outOff, 65); return 64;
                case "ret66": System.arraycopy(full, 0, out, outOff, 65); return 66;
                case "bare": System.arraycopy(full, 1, out, outOff, 64); return 64;
                case "lead00": System.arraycopy(full, 0, out, outOff, 65); out[outOff] = 0; return 65;
                case "short": System.arraycopy(full, 0, out, outOff, 33); return 33;
                case "yx": out[outOff] = 4; System.arraycopy(full, 33, out, outOff + 1, 32); System.arraycopy(full, 1, out, outOff + 33, 32); return 65;
                case "other": System.arraycopy(CashuAppletTest.hexToBytes((String) KEYS[0][1]), 0, out, outOff, 65); return 65;
                case "negy": {
                    System.arraycopy(full, 0, out, outOff, 33);
                    System.arraycopy(u32(FP.subtract(fy)), 0, out, outOff + 33, 32);
                    return 65;
                }
                default: System.arraycopy(full, 0, out, outOff, n); return n;
            }
        }
    }

    /** The framings and the named wrong engines WatchedAgreement can answer as (see its comment). */
    static final String[] FRAMINGS = { "bare", "lead00", "short", "yx", "other", "negy", "hyb", "comp65", "ret64", "ret66" };
    static final String[] WRONG_ENGINES = { "even", "root", "negin", "odd", "negroot", "xbit", "hi", "inEven", "notG", "hOdd", "hNegroot", "hXbit", "inXbit", "evenHi" };

    /** A named wrong engine as a member of the family: {base, scalar, answer} (the key agreement) or {generator, point added, scalar, middle, answer} (the point addition); null for none. */
    static String[] named(String how, boolean gm) {
        switch (how) {
            case "even": case "odd": case "root": case "negroot": case "xbit": case "notG":
                return gm ? new String[] { "id", "id", "id", "id", how } : new String[] { "id", "id", how };
            case "negin": return gm ? new String[] { "id", "neg", "id", "id", "id" } : new String[] { "neg", "id", "id" };
            case "hi": return gm ? new String[] { "id", "id", "hi", "id", "id" } : new String[] { "id", "hi", "id" };
            case "inEven": return gm ? new String[] { "even", "id", "id", "id", "id" } : new String[] { "even", "id", "id" };
            case "inXbit": return gm ? new String[] { "xbit", "id", "id", "id", "id" } : new String[] { "xbit", "id", "id" };
            case "evenHi": return gm ? new String[] { "even", "id", "hi", "id", "id" } : new String[] { "even", "hi", "id" };
            case "hOdd": return gm ? new String[] { "id", "odd", "id", "id", "id" } : new String[] { "odd", "id", "id" };
            case "hNegroot": return gm ? new String[] { "id", "negroot", "id", "id", "id" } : new String[] { "negroot", "id", "id" };
            case "hXbit": return gm ? new String[] { "id", "xbit", "id", "id", "id" } : new String[] { "xbit", "id", "id" };
            default: return null;
        }
    }

    // ── The family of wrong engines: every rule of each part, crossed ──────
    //
    // A key agreement {base, scalar, answer} answers the answer rule of [scalar rule (s)] (base rule (P)); a point addition
    // {generator, point added, scalar, middle, answer} answers the answer rule of (the middle rule of [scalar rule (s)]
    // (generator rule (g))) + (point-added rule (H)). Each rule over a point keeps its X and gives it a Y: "id" its own, "neg"
    // p - Y, "even" and "odd" the root of that parity, "root" the root (x^3 + 7)^((p+1)/4), "negroot" p less it, "xbit" and
    // "nxbit" the root whose parity is X's or is not, "notG" its own where the point (a point given) or the base or generator
    // (an answer) is G and p - Y where not; over an answer only: "sp" and "nsp" the parity of the scalar or not, "hib" the
    // scalar's top bit, "ip" and "nip" the parity of the point given (the base, or the point added) or not, "gp" and "ngp"
    // that of the generator (the base, on the key agreement) or not, "ixor" the point given's parity XOR the scalar's. Each
    // scalar rule: "id", "modn" s mod n (the same for every s under n), "hi" [n - s] for s above n/2, "lo" [n - s] for s
    // below it. The family holds every combination, two or more faults at once among them.
    static final String[] FAMILY_IN = { "id", "even", "odd", "root", "negroot", "xbit", "neg", "notG", "nxbit" };
    static final String[] FAMILY_SCALAR = { "id", "hi", "modn", "lo" };
    static final String[] FAMILY_MID = { "id", "even", "odd", "root", "negroot", "xbit", "neg", "nxbit" };
    static final String[] FAMILY_OUT = { "id", "even", "odd", "root", "negroot", "xbit", "neg", "notG", "nxbit", "sp", "nsp", "hib", "ip", "nip", "gp", "ngp", "ixor" };

    /** Every member of the family, of the point addition (`gm`) or the key agreement. */
    static java.util.List<String[]> family(boolean gm) {
        java.util.List<String[]> all = new java.util.ArrayList<>();
        for (String a : FAMILY_IN) for (String b : gm ? FAMILY_IN : new String[] { "" }) for (String s : FAMILY_SCALAR)
            for (String mid : gm ? FAMILY_MID : new String[] { "" }) for (String o : FAMILY_OUT)
                all.add(gm ? new String[] { a, b, s, mid, o } : new String[] { a, s, o });
        return all;
    }

    private static final java.util.Map<String, BigInteger[]> TIMES = new java.util.concurrent.ConcurrentHashMap<>();

    /** [k]p, null for the point at infinity. */
    static BigInteger[] times(BigInteger k, BigInteger[] p) {
        if (p == null || k.mod(FN).signum() == 0) return null;
        String key = k.mod(FN).toString(16) + ":" + p[0].toString(16) + ":" + p[1].toString(16);
        BigInteger[] r = TIMES.get(key);
        if (r == null) {
            r = CashuAppletTest.ecMulTest(k.mod(FN), p[0], p[1]);
            TIMES.put(key, r);
        }
        return r;
    }

    /** a + b, null for the point at infinity. */
    static BigInteger[] plus(BigInteger[] a, BigInteger[] b) {
        if (a == null) return b;
        if (b == null) return a;
        return CashuAppletTest.ecAddTest(a[0], a[1], b[0], b[1]);
    }

    private static boolean isG(BigInteger[] q) {
        return q != null && q[0].equals(CashuAppletTest.SECP_GX) && q[1].equals(CashuAppletTest.SECP_GY);
    }

    /** The point q (X kept) with the Y the rule gives it; s the scalar asked, in the point given, gen the generator (null for a point given). */
    static BigInteger[] lift(String rule, BigInteger[] q, BigInteger s, BigInteger[] in, BigInteger[] gen) {
        if (q == null) return null;
        BigInteger x = q[0], r = plainRoot(x);
        int odd;
        switch (rule) {
            case "id": return q;
            case "neg": return new BigInteger[] { x, FP.subtract(q[1]).mod(FP) };
            case "notG": return isG(gen == null ? q : gen) ? q : new BigInteger[] { x, FP.subtract(q[1]).mod(FP) };
            case "root": return new BigInteger[] { x, r };
            case "negroot": return new BigInteger[] { x, FP.subtract(r) };
            case "even": odd = 0; break;
            case "odd": odd = 1; break;
            case "xbit": odd = x.testBit(0) ? 1 : 0; break;
            case "nxbit": odd = x.testBit(0) ? 0 : 1; break;
            case "sp": odd = s.testBit(0) ? 1 : 0; break;
            case "nsp": odd = s.testBit(0) ? 0 : 1; break;
            case "hib": odd = s.testBit(255) ? 1 : 0; break;
            case "ip": odd = in[1].testBit(0) ? 1 : 0; break;
            case "nip": odd = in[1].testBit(0) ? 0 : 1; break;
            case "gp": odd = gen[1].testBit(0) ? 1 : 0; break;
            case "ngp": odd = gen[1].testBit(0) ? 0 : 1; break;
            case "ixor": odd = in[1].testBit(0) != s.testBit(0) ? 1 : 0; break;
            default: throw new IllegalArgumentException(rule);
        }
        return new BigInteger[] { x, r.testBit(0) == (odd == 1) ? r : FP.subtract(r) };
    }

    /** The scalar the rule works with in place of s. */
    static BigInteger scalarBy(String rule, BigInteger s) {
        switch (rule) {
            case "id": case "modn": return s.mod(FN);
            case "hi": return s.compareTo(FN.shiftRight(1)) > 0 ? FN.subtract(s) : s;
            case "lo": return s.compareTo(FN.shiftRight(1)) < 0 ? FN.subtract(s) : s;
            default: throw new IllegalArgumentException(rule);
        }
    }

    /** The answer of the model m: the key agreement ({base, scalar, answer}, g null) for [s]p; the point addition ({generator, point added, scalar, middle, answer}) for [s]g + p. Null for the point at infinity. */
    static BigInteger[] modelAnswer(String[] m, BigInteger s, BigInteger[] g, BigInteger[] p) {
        if (m.length == 3) return lift(m[2], times(scalarBy(m[1], s), lift(m[0], p, s, p, null)), s, p, p);
        BigInteger[] mid = lift(m[3], times(scalarBy(m[2], s), lift(m[0], g, s, g, null)), s, g, g);
        return lift(m[4], plus(mid, lift(m[1], p, s, p, null)), s, p, g);
    }

    /** Where `want` is in `list`, or -1. */
    static int indexOf(java.util.List<byte[]> list, byte[] want) {
        for (int i = 0; i < list.size(); i++) if (java.util.Arrays.equals(list.get(i), want)) return i;
        return -1;
    }

    /** X and Y of the 65-byte point at b[off]. */
    static BigInteger[] xy(byte[] b, int off) {
        return new BigInteger[] { new BigInteger(1, java.util.Arrays.copyOfRange(b, off + 1, off + 33)), new BigInteger(1, java.util.Arrays.copyOfRange(b, off + 33, off + 65)) };
    }

    /** The even one of the two roots of x^3 + 7. */
    static BigInteger evenRoot(BigInteger x) {
        BigInteger y = plainRoot(x);
        return y.testBit(0) ? FP.subtract(y) : y;
    }

    /** a + b on the curve. */
    static BigInteger[] sum(BigInteger[] a, BigInteger[] b) {
        return CashuAppletTest.ecAddTest(a[0], a[1], b[0], b[1]);
    }

    @Test
    @DisplayName("The temporary key is asked for cleared on deselect first, and is persistent only where the chip throws on that type or its room: a signer made here says which it got, as the simulator answers, and still signs")
    void theTemporaryKeyIsAskedForInRamFirst() throws Exception {
        boolean simulatorHasIt;
        try {
            KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE_TRANSIENT_DESELECT, KeyBuilder.LENGTH_EC_FP_256, false);
            simulatorHasIt = true;
        } catch (javacard.framework.CardRuntimeException e) {
            simulatorHasIt = false;   // jCardSim 3.0.6: NO_SUCH_ALGORITHM, so the fallback is the path the simulator takes
        }
        SchnorrHW schnorr = new SchnorrHW();
        assertEquals(simulatorHasIt, (Boolean) hidden(schnorr, "keyInRam"), "keyInRam says which kind of key the signer got");
        assertEquals(simulatorHasIt ? KeyBuilder.TYPE_EC_FP_PRIVATE_TRANSIENT_DESELECT : KeyBuilder.TYPE_EC_FP_PRIVATE,
            ((ECPrivateKey) hidden(schnorr, "tmpPriv")).getType());
        schnorr.init();
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("SchnorrHW.java")), java.nio.charset.StandardCharsets.UTF_8)).replaceAll("\\s+", " ");
        String built = "ECPrivateKey k = null; byte type = KeyBuilder.TYPE_EC_FP_PRIVATE_TRANSIENT_DESELECT; while (k == null) { try { k = (ECPrivateKey) KeyBuilder.buildKey(type, KeyBuilder.LENGTH_EC_FP_256, false); CashuApplet.curve(k); k.setS(CashuApplet.SECP256K1_G, (short) 1, (short) 32); } catch (CardRuntimeException e) { if (type == KeyBuilder.TYPE_EC_FP_PRIVATE) throw e; type = KeyBuilder.TYPE_EC_FP_PRIVATE; k = null; } } tmpPriv = k; keyInRam = type != KeyBuilder.TYPE_EC_FP_PRIVATE; }";
        assertTrue(src.contains(built),
            "in RAM first, used once (G's x) inside the fallback, the persistent kind only where the chip throws on that, and keyInRam says which");
        int ctor = src.indexOf("SchnorrHW() {"), at = src.indexOf(built);
        String before = src.substring(ctor, at);
        for (String made : new String[] { "ecdh = KeyAgreement.getInstance(", "gm = KeyAgreement.getInstance(", "rng = RandomData.getInstance(", "sha256 = MessageDigest.getInstance(", "JCSystem.makeTransientByteArray(" }) {
            assertTrue(before.contains(made), "the temporary key is built after " + made + ", and is the constructor's last object");
        }
        assertEquals(src.indexOf("void init()"), src.indexOf("void init()", at), "and the constructor ends with it");
        assertEquals(3, src.split("finally \\{ rest\\(\\);", -1).length - 1, "addTo, mul and agree wipe the key and the agreements on every way out (the framing check is made of mul and addToG)");
        assertTrue(src.contains("finally { Util.arrayFillNonAtomic(sc, (short)0, (short)256, (byte)0); Util.arrayFillNonAtomic(work, (short)0, WORK_LEN, (byte)0); rest(); }"),
            "sign zeroes its scratch and work, then wipes the key, on every way out");
        assertEquals(3, src.split("tmpPriv\\.setS\\(", -1).length - 2, "and sign, addTo and mul are the only uses that put a scalar in it (besides rest's public one)");
        byte[] msg = new byte[32], sig = new byte[64];
        schnorr.sign(keyOf((String) KEYS[3][0]), pubOf((String) KEYS[3][1]), msg, (short) 0, sig, (short) 0);
        assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(CashuAppletTest.hexToBytes((String) KEYS[3][1]), 1, 33), msg, sig));
    }

    @Test
    @DisplayName("What a signature leaves behind does not give the card key: after sign() returns, the temporary key holds G's x and not the nonce (from which d = (s - k) / e would follow), and the scratch that held d, k and e*d is zero, for keys of both parities")
    void aSignatureLeavesNothingThatGivesTheKey() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();
        ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
        byte[] gx = java.util.Arrays.copyOfRange(SECP_G, 1, 33);
        for (Object[] key : KEYS) {
            BigInteger d = new BigInteger((String) key[0], 16);
            byte[] w = CashuAppletTest.hexToBytes((String) key[1]);
            byte[] msg = new byte[32];
            for (int i = 0; i < 32; i++) msg[i] = (byte) (0x77 ^ i ^ w[5]);
            byte[] sig = new byte[64];
            schnorr.sign(keyOf((String) key[0]), pubOf((String) key[1]), msg, (short) 0, sig, (short) 0);
            assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(w, 1, 33), msg, sig));
            BigInteger e = new BigInteger(1, taggedHash("BIP0340/challenge", java.util.Arrays.copyOfRange(sig, 0, 32), java.util.Arrays.copyOfRange(w, 1, 33), msg)).mod(FN);
            BigInteger s = new BigInteger(1, java.util.Arrays.copyOfRange(sig, 32, 64));
            if (tmp.isInitialized()) {
                byte[] left = new byte[32];
                short n = tmp.getS(left, (short) 0);
                BigInteger k = new BigInteger(1, java.util.Arrays.copyOf(left, n));
                for (BigInteger guess : new BigInteger[] { k, FN.subtract(k).mod(FN) }) {
                    BigInteger dGuess = s.subtract(guess).multiply(e.modInverse(FN)).mod(FN);
                    assertFalse(dGuess.equals(d) || dGuess.equals(FN.subtract(d)), "the temporary key still held the nonce of the signature, and gave the card key " + key[0]);
                }
                org.junit.jupiter.api.Assertions.assertArrayEquals(gx, java.util.Arrays.copyOf(left, n), "it holds G's x, a public number");
            }
            assertTrue(allZero((byte[]) hidden(schnorr, "sc")), "the scratch that held d and k is zero (d = " + key[0] + ")");
            assertTrue(allZero((byte[]) hidden(schnorr, "work")), "the work that held e*d is zero (d = " + key[0] + ")");
        }
    }

    @Test
    @DisplayName("A signature the chip's key agreement refuses part way (after the nonce is in the key) leaves neither the nonce in the key nor d and k in the scratch, and the signer still signs after it")
    void aSignatureRefusedPartWayIsWipedToo() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement chip = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        setHidden(schnorr, "ecdh", chip);
        schnorr.init();
        ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
        byte[] msg = new byte[32];
        for (int i = 0; i < 32; i++) msg[i] = (byte) (0xA7 ^ i);
        chip.fail = true;
        org.junit.jupiter.api.Assertions.assertThrows(javacard.security.CryptoException.class,
            () -> schnorr.sign(keyOf((String) KEYS[5][0]), pubOf((String) KEYS[5][1]), msg, (short) 0, new byte[64], (short) 0));
        if (tmp.isInitialized()) {
            byte[] left = new byte[32];
            short n = tmp.getS(left, (short) 0);
            org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), java.util.Arrays.copyOf(left, n), "the key holds G's x, not the nonce, after the throw");
        }
        assertTrue(allZero((byte[]) hidden(schnorr, "sc")), "the scratch is zero after the throw");
        assertTrue(allZero((byte[]) hidden(schnorr, "work")), "and the work");
        chip.fail = false;
        byte[] sig = new byte[64];
        schnorr.sign(keyOf((String) KEYS[5][0]), pubOf((String) KEYS[5][1]), msg, (short) 0, sig, (short) 0);
        assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(CashuAppletTest.hexToBytes((String) KEYS[5][1]), 1, 33), msg, sig));
    }

    /** The scalar a simulator key agreement keeps from its last init (jCardSim's engine holds the key's parameters). Simulator only. */
    private static BigInteger keptScalar(javacard.security.KeyAgreement ka) throws Exception {
        if (ka instanceof WatchedAgreement) ka = ((WatchedAgreement) ka).real;
        java.lang.reflect.Field eng = ka.getClass().getDeclaredField("engine");
        eng.setAccessible(true);
        Object engine = eng.get(ka);
        java.lang.reflect.Field kf = engine.getClass().getDeclaredField("key");
        kf.setAccessible(true);
        Object params = kf.get(engine);
        return params == null ? null : (BigInteger) params.getClass().getMethod("getD").invoke(params);
    }

    @Test
    @DisplayName("Neither key agreement keeps a secret after a use: a KeyAgreement may hold its own copy of the scalar it was last given (the simulator's does), so after SET_CARD's framing check, a signature, a signature refused part way, an addToG, a mul and an agree, the signer's two agreements hold G's x and not 11 or 13, the nonce, the blinding factor or the key agreed with, and the card key cannot be had from what they hold and the signature; with the key in RAM and with the persistent one (simulator only: the copy read is jCardSim's)")
    void theKeyAgreementsKeepNoSecret() throws Exception {
        BigInteger gx = new BigInteger(1, java.util.Arrays.copyOfRange(SECP_G, 1, 33));
        for (boolean ram : new boolean[] { false, true }) {
            SchnorrHW schnorr = ram ? signerWithKeyInRam() : new SchnorrHW();
            WatchedAgreement chip = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
            setHidden(schnorr, "ecdh", chip);
            schnorr.init();
            javacard.security.KeyAgreement gm = (javacard.security.KeyAgreement) hidden(schnorr, "gm");
            String how = ram ? "key in RAM" : "persistent key";
            BigInteger afterInstall = keptScalar(chip);
            assertTrue(afterInstall == null || afterInstall.equals(gx), how + ": after the install the agreement holds nothing, or G's x");
            schnorr.checkFraming(new byte[65], (short) 0);
            assertEquals(gx, keptScalar(chip), how + ": after the framing check the agreement holds G's x, and not 11");
            for (Object[] key : KEYS) {
                BigInteger d = new BigInteger((String) key[0], 16);
                byte[] w = CashuAppletTest.hexToBytes((String) key[1]);
                byte[] msg = new byte[32];
                for (int i = 0; i < 32; i++) msg[i] = (byte) (0x19 ^ i ^ w[7]);
                byte[] sig = new byte[64];
                schnorr.sign(keyOf((String) key[0]), pubOf((String) key[1]), msg, (short) 0, sig, (short) 0);
                assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(w, 1, 33), msg, sig));
                BigInteger kept = keptScalar(chip);
                BigInteger e = new BigInteger(1, taggedHash("BIP0340/challenge", java.util.Arrays.copyOfRange(sig, 0, 32), java.util.Arrays.copyOfRange(w, 1, 33), msg)).mod(FN);
                BigInteger s = new BigInteger(1, java.util.Arrays.copyOfRange(sig, 32, 64));
                for (BigInteger guess : new BigInteger[] { kept, FN.subtract(kept).mod(FN) }) {
                    BigInteger dGuess = s.subtract(guess).multiply(e.modInverse(FN)).mod(FN);
                    assertFalse(dGuess.equals(d) || dGuess.equals(FN.subtract(d)), how + ": the key agreement still held the nonce, and gave the card key " + key[0]);
                }
                assertEquals(gx, kept, how + ": the key agreement holds G's x after a signature");
                assertEquals(gx, keptScalar(gm), how + ": and so does the point addition");
            }
            chip.fail = true;
            org.junit.jupiter.api.Assertions.assertThrows(javacard.security.CryptoException.class,
                () -> schnorr.sign(keyOf((String) KEYS[2][0]), pubOf((String) KEYS[2][1]), new byte[32], (short) 0, new byte[64], (short) 0));
            chip.fail = false;
            assertEquals(gx, keptScalar(chip), how + ": after a signature refused part way, G's x");
            BigInteger r = new BigInteger("1D2C3B4A5968778695A4B3C2D1E0F00112233445566778899AABBCCDDEEFF00", 16);
            schnorr.addToG(u32(r), (short) 0, CashuAppletTest.hexToBytes((String) KEYS[1][1]), (short) 0, new byte[65], (short) 0);
            assertEquals(gx, keptScalar(gm), how + ": after addToG the point addition holds G's x, not the blinding factor");
            assertEquals(gx, keptScalar(chip), how + ": and the agreement too");
            schnorr.mul(u32(r), (short) 0, CashuAppletTest.hexToBytes((String) KEYS[1][1]), (short) 0, new byte[65], (short) 0);
            assertEquals(gx, keptScalar(chip), how + ": after mul the agreement holds G's x, not the scalar");
            schnorr.agree(keyOf((String) KEYS[4][0]), CashuAppletTest.hexToBytes((String) KEYS[1][1]), (short) 0, (short) 65, new byte[65], (short) 0);
            assertEquals(gx, keptScalar(chip), how + ": after agree the agreement holds G's x, not the key it was handed");
            assertEquals(gx, keptScalar(gm), how + ": and the point addition too");
        }
    }

    @Test
    @DisplayName("A temporary key in RAM holds nothing after a signature, an addToG and SET_CARD's framing check, nor after a signature or an addToG refused part way, and its curve is set again before each use; sign() leaves its scratch and work zero (simulator only: the key in RAM is this test's, as jCardSim's own may have none)")
    void theTemporaryKeyHoldsNothingAfterAnyUse() throws Exception {
        SchnorrHW schnorr = signerWithKeyInRam();
        ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
        schnorr.init();
        schnorr.checkFraming(new byte[65], (short) 0);
        assertFalse(tmp.isInitialized(), "the check of the framing leaves nothing in it");

        byte[] msg = new byte[32];
        for (int i = 0; i < 32; i++) msg[i] = (byte) (0xC3 ^ i);
        for (Object[] k : KEYS) {
            byte[] sig = new byte[64];
            assertEquals(64, schnorr.sign(keyOf((String) k[0]), pubOf((String) k[1]), msg, (short) 0, sig, (short) 0));
            assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(CashuAppletTest.hexToBytes((String) k[1]), 1, 33), msg, sig), "the signature still verifies");
            assertFalse(tmp.isInitialized(), "no nonce in the key after the signature (d = " + k[0] + ")");
            assertTrue(allZero((byte[]) hidden(schnorr, "sc")), "the scratch that held d and k is zero");
            assertTrue(allZero((byte[]) hidden(schnorr, "work")), "the work that held e*d is zero");
        }

        // refused part way: a getS of no length is refused, and the key and scratch are wiped all the same
        ECPrivateKey broken = new FixedLengthPrivateKey(keyOf((String) KEYS[2][0]), (short) 0);
        assertEquals(CashuApplet.SW_CRYPTO_ERROR, refusal(() -> schnorr.sign(broken, pubOf((String) KEYS[2][1]), msg, (short) 0, new byte[64], (short) 0)));
        assertFalse(tmp.isInitialized());
        assertTrue(allZero((byte[]) hidden(schnorr, "sc")), "the scratch is zero after a refused signature too");

        // addToG: a blinding factor in, nothing left; and one the chip refuses (a point that is none), wiped on the way out
        byte[] r = u32(new BigInteger("1D2C3B4A5968778695A4B3C2D1E0F00112233445566778899AABBCCDDEEFF00", 16));
        byte[] two = CashuAppletTest.hexToBytes((String) KEYS[1][1]);
        byte[] out = new byte[65];
        schnorr.addToG(r, (short) 0, two, (short) 0, out, (short) 0);
        assertFalse(tmp.isInitialized(), "after addToG");
        byte[] bad = two.clone();
        bad[64] ^= 1;
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> schnorr.addToG(r, (short) 0, bad, (short) 0, out, (short) 0));
        assertFalse(tmp.isInitialized(), "after a refused addToG");
        // the key still works after all of it: the curve is set again before each use
        byte[] sig = new byte[64];
        schnorr.sign(keyOf((String) KEYS[0][0]), pubOf((String) KEYS[0][1]), msg, (short) 0, sig, (short) 0);
        assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(CashuAppletTest.hexToBytes((String) KEYS[0][1]), 1, 33), msg, sig));
    }

    @Test
    @DisplayName("Where the chip gives only a persistent temporary key (the fallback), each use leaves G's x in it, public, with the curve kept: a signature and an addToG still give the right answers and no nonce or factor stays")
    void aPersistentTemporaryKeyIsLeftHoldingAPublicNumber() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        ECPrivateKey persistent = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        persistent.setFieldFP(SECP_P, (short) 0, (short) 32);
        persistent.setA(SECP_A, (short) 0, (short) 32);
        persistent.setB(SECP_B, (short) 0, (short) 32);
        persistent.setG(SECP_G, (short) 0, (short) 65);
        persistent.setR(SECP_N, (short) 0, (short) 32);
        persistent.setK((short) 1);
        setHidden(schnorr, "tmpPriv", persistent);
        setHidden(schnorr, "keyInRam", Boolean.FALSE);
        schnorr.init();
        schnorr.checkFraming(new byte[65], (short) 0);
        byte[] gx = java.util.Arrays.copyOfRange(SECP_G, 1, 33), s = new byte[32];
        assertEquals(32, persistent.getS(s, (short) 0));
        org.junit.jupiter.api.Assertions.assertArrayEquals(gx, s, "after the framing check: G's x");

        byte[] msg = new byte[32];
        for (int i = 0; i < 32; i++) msg[i] = (byte) (0x3C ^ i);
        for (Object[] k : KEYS) {
            byte[] sig = new byte[64];
            schnorr.sign(keyOf((String) k[0]), pubOf((String) k[1]), msg, (short) 0, sig, (short) 0);
            assertTrue(CashuAppletTest.schnorrVerify(java.util.Arrays.copyOfRange(CashuAppletTest.hexToBytes((String) k[1]), 1, 33), msg, sig));
            persistent.getS(s, (short) 0);
            org.junit.jupiter.api.Assertions.assertArrayEquals(gx, s, "after a signature: G's x, not the nonce");
            assertTrue(persistent.isInitialized(), "and the curve kept: nothing to write again to persistent memory at the next use");
        }
        byte[] out = new byte[65], two = CashuAppletTest.hexToBytes((String) KEYS[1][1]);
        schnorr.addToG(u32(BigInteger.ONE), (short) 0, two, (short) 0, out, (short) 0);
        org.junit.jupiter.api.Assertions.assertArrayEquals(CashuAppletTest.hexToBytes((String) KEYS[0][1]), out, "G + 2G by addToG");
        persistent.getS(s, (short) 0);
        org.junit.jupiter.api.Assertions.assertArrayEquals(gx, s, "after addToG");
    }

    @Test
    @DisplayName("The framing check (asked at every SET_CARD) refuses a chip whose key agreement frames its answer otherwise: [11]G answered as the bare 64 bytes X || Y, as 65 bytes that do not begin 04, as 33 bytes, as 04 || Y || X, as 04 and the coordinates of another point, or with X right and Y not, is refused 6F00; the real framing passes, the check asked the key agreement for [11]G, [n - 1]([11]G), [2](-G) and [n - 1](2G) first, nine points in all, and leaves nothing in the temporary key")
    void theFramingCheckRefusesAnotherFraming() throws Exception {
        for (String frame : new String[] { "bare", "lead00", "short", "yx", "other", "negy" }) {
            SchnorrHW schnorr = new SchnorrHW();
            WatchedAgreement chip = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
            chip.frame = frame;
            setHidden(schnorr, "ecdh", chip);
            schnorr.init();
            ISOException thrown = org.junit.jupiter.api.Assertions.assertThrows(ISOException.class, () -> schnorr.checkFraming(new byte[65], (short) 0), "a framing \"" + frame + "\" must be refused");
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, thrown.getReason());
            ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
            if (tmp.isInitialized()) {
                byte[] s = new byte[32];
                tmp.getS(s, (short) 0);
                org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), s, "the refused check leaves G's x in the key, not 11");
            }
        }
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement chip = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        setHidden(schnorr, "ecdh", chip);
        schnorr.init();
        assertEquals(0, chip.given.size(), "the install asks the chip for nothing");
        schnorr.checkFraming(new byte[65], (short) 0);
        assertEquals(9, chip.given.size(), "the check asked the key agreement for nine points (the last five: G, 2G, G, 2G and G, theFramingCheckAsksTheGeneratorAndAHashScalar)");
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, chip.given.get(0), "the first of G");
        assertEquals(BigInteger.valueOf(11), chip.askedBy.get(0), "and that was [11]G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(timesG(11), chip.given.get(1), "the second of [11]G, a point other than G");
        assertEquals(FN.subtract(BigInteger.ONE), chip.askedBy.get(1), "by n - 1, a scalar above n/2");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(SECP_G), chip.given.get(2), "the third of -G, whose X and Y parities differ");
        assertEquals(BigInteger.TWO, chip.askedBy.get(2), "by 2");
        org.junit.jupiter.api.Assertions.assertArrayEquals(timesG(2), chip.given.get(3), "the fourth of 2G, a point other than G whose Y is even and the plain root");
        assertEquals(FN.subtract(BigInteger.ONE), chip.askedBy.get(3), "by n - 1");
    }

    /** The 65-byte point p with its Y made p - Y. */
    static byte[] negate(byte[] p) {
        BigInteger[] q = xy(p, 0);
        return point(q[0], FP.subtract(q[1]));
    }

    @Test
    @DisplayName("The framing check asks the point addition too: [13]G + (-[2]G), two distinct points, by the generic mapping answered as the bare 64 bytes, as 65 bytes that do not begin 04, as 33 bytes, as 04 || Y || X, as another point, or with X right and Y not, is refused 6F00 and leaves G's x in the key; the real framing passes, and the point addition was asked eight times, first [13]G + (-[2]G), [n - 2]([11]G) + [11]G with its key's generator [11]G, and [4](-G) + 2G with its key's generator -G, X and Y")
    void theFramingCheckAsksThePointAdditionToo() throws Exception {
        for (String frame : new String[] { "bare", "lead00", "short", "yx", "other", "negy" }) {
            SchnorrHW schnorr = new SchnorrHW();
            WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
            gm.frame = frame;
            setHidden(schnorr, "gm", gm);
            schnorr.init();
            assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), "a point addition framed \"" + frame + "\"");
            ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
            if (tmp.isInitialized()) {
                byte[] s = new byte[32];
                tmp.getS(s, (short) 0);
                org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), s, "the refused check leaves G's x in the key, not 13");
            }
        }
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
        setHidden(schnorr, "gm", gm);
        schnorr.init();
        byte[] out = new byte[65];
        schnorr.checkFraming(out, (short) 0);
        assertEquals(8, gm.given.size(), "the point addition was asked eight times (the last five: theFramingCheckAsksTheGeneratorAndAHashScalar)");
        byte[] twoG = CashuAppletTest.hexToBytes((String) KEYS[1][1]);
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(new BigInteger(1, java.util.Arrays.copyOfRange(twoG, 1, 33)), FP.subtract(new BigInteger(1, java.util.Arrays.copyOfRange(twoG, 33, 65)))),
            gm.given.get(0), "first for -[2]G, two distinct points added");
        int thirteen = indexOf(gm.scalars, u32(BigInteger.valueOf(13))), nLess2 = indexOf(gm.scalars, u32(FN.subtract(BigInteger.TWO)));
        assertTrue(thirteen >= 0, "its key's scalar 13");
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, gm.generators.get(thirteen), "with its key's generator G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(timesG(11), gm.given.get(1), "then for [11]G");
        assertTrue(nLess2 > thirteen, "by its key's scalar n - 2, above n/2");
        org.junit.jupiter.api.Assertions.assertArrayEquals(timesG(11), gm.generators.get(nLess2), "with its key's generator [11]G, a point other than G");
        int four = indexOf(gm.scalars, u32(BigInteger.valueOf(4)));
        assertTrue(four > nLess2, "then by its key's scalar 4");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(SECP_G), gm.generators.get(four), "with its key's generator -G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(timesG(2), gm.given.get(2), "for 2G, a point added whose Y is even and the plain root");
    }

    @Test
    @DisplayName("The framing check holds the whole answer of both engines, X and Y, at [11]G, a point whose Y is odd and is not the plain root (x^3 + 7)^((p+1)/4): a key agreement or a point addition that answers the even root, that works Y out again by the plain root, or that negates the Y of each point it is given is refused 6F00, each engine alone and both together, and leaves G's x in the key")
    void theFramingCheckHoldsTheYAnEngineCouldGetWrong() throws Exception {
        byte[] eleven = timesG(11);
        BigInteger x11 = new BigInteger(1, java.util.Arrays.copyOfRange(eleven, 1, 33)), y11 = new BigInteger(1, java.util.Arrays.copyOfRange(eleven, 33, 65));
        assertTrue(y11.testBit(0), "[11]G's Y is odd: an engine that answers the even root gets it wrong");
        assertFalse(y11.equals(plainRoot(x11)), "[11]G's Y is not the plain root: an engine that works Y out by it gets it wrong");
        byte[] two = timesG(2);
        assertFalse(java.util.Arrays.equals(timesG(15), eleven), "[13]G + [2]G (H's Y negated) is not [11]G");
        for (String how : new String[] { "even", "root", "negin" }) {
            for (int which = 0; which < 3; which++) {
                SchnorrHW schnorr = new SchnorrHW();
                WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
                WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
                if (which != 1) ecdh.frame = how;
                if (which != 0) gm.frame = how;
                setHidden(schnorr, "ecdh", ecdh);
                setHidden(schnorr, "gm", gm);
                schnorr.init();
                String what = how + (which == 0 ? ", the key agreement" : which == 1 ? ", the point addition" : ", both");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), what + ": refused");
                ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
                if (tmp.isInitialized()) {
                    byte[] k = new byte[32];
                    tmp.getS(k, (short) 0);
                    org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), k, what + ": G's x left in the key");
                }
            }
        }
        assertTrue(two[64] % 2 == 0, "(and the old points' Y, 2G's and G's, are even and the plain root, which these engines answer right)");
        assertTrue(new BigInteger(1, java.util.Arrays.copyOfRange(two, 33, 65)).equals(plainRoot(new BigInteger(1, java.util.Arrays.copyOfRange(two, 1, 33)))));
    }

    @Test
    @DisplayName("The framing check refuses 6F00 every named wrong engine, on the key agreement alone, the point addition alone and both, at the ask the points were chosen for, and leaves G's x in the key: each framing (bare, lead00, short, yx, other, negy, hyb, comp65, ret64, ret66) and each engine that gets the point wrong (even, root, negin, odd, negroot, xbit, hi, inEven, notG, hOdd, hNegroot, hXbit, inXbit, evenHi). The key agreement is asked [11]G = 11G, [n - 1](11G) = -11G, [2](-G) = -2G and [n - 1](2G) = -2G; the point addition [13]G + (-2G) = 11G, [n - 2](11G) + 11G = -11G with the generator 11G, and [4](-G) + 2G = -2G with the generator -G; the real engines pass")
    void theFramingCheckRefusesEveryEngineModel() throws Exception {
        BigInteger[] e11 = xy(timesG(11), 0), m11 = { e11[0], FP.subtract(e11[1]) };
        assertTrue(e11[1].testBit(0) && !e11[1].equals(plainRoot(e11[0])), "[11]G: Y odd and not the plain root");
        assertTrue(!m11[1].testBit(0) && m11[1].equals(plainRoot(m11[0])) && m11[0].testBit(0), "-[11]G: Y even, the plain root, and X odd");
        BigInteger[] g = xy(SECP_G, 0), mg = { g[0], FP.subtract(g[1]) }, two = xy(timesG(2), 0);
        assertTrue(!mg[0].testBit(0) && mg[1].testBit(0) && !mg[1].equals(plainRoot(mg[0])), "-G: X even, Y odd and not the plain root (its parities differ)");
        assertTrue(two[0].testBit(0) && !two[1].testBit(0) && two[1].equals(plainRoot(two[0])), "2G: X odd, Y even and the plain root (its parities differ)");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(m11[0], m11[1]), point(times(FN.subtract(BigInteger.ONE), e11)[0], times(FN.subtract(BigInteger.ONE), e11)[1]), "[n - 1](11G) is -11G");
        BigInteger[] b = times(FN.subtract(BigInteger.TWO), e11);
        assertFalse(b[0].equals(e11[0]), "[n - 2]([11]G) is not [11]G or -[11]G: two distinct points are added");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(m11[0], m11[1]), point(sum(b, e11)[0], sum(b, e11)[1]), "[n - 2]([11]G) + [11]G is -[11]G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(timesG(2)), point(times(BigInteger.TWO, mg)[0], times(BigInteger.TWO, mg)[1]), "[2](-G) is -2G");
        BigInteger[] f = times(BigInteger.valueOf(4), mg);
        assertFalse(f[0].equals(two[0]), "[4](-G) is not 2G or -2G: two distinct points are added");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(timesG(2)), point(sum(f, two)[0], sum(f, two)[1]), "[4](-G) + 2G is -2G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(timesG(2)), point(times(FN.subtract(BigInteger.ONE), two)[0], times(FN.subtract(BigInteger.ONE), two)[1]), "[n - 1](2G) is -2G");
        assertTrue(FN.subtract(BigInteger.TWO).compareTo(FN.shiftRight(1)) > 0, "n - 1 and n - 2 are above n/2");
        // the ask of each engine at which each is refused: the key agreement's, then the point addition's
        java.util.Map<String, int[]> want = new java.util.LinkedHashMap<>();
        for (String f2 : FRAMINGS) want.put(f2, new int[] { 1, 1 });
        for (String m : new String[] { "even", "root", "negin" }) want.put(m, new int[] { 1, 1 });
        for (String m : new String[] { "odd", "negroot", "xbit", "hi", "inEven", "notG" }) want.put(m, new int[] { 2, 2 });
        for (String m : new String[] { "hOdd", "hNegroot" }) want.put(m, new int[] { 1, 3 });
        for (String m : new String[] { "hXbit", "inXbit", "evenHi" }) want.put(m, new int[] { 3, 3 });
        assertEquals(FRAMINGS.length + WRONG_ENGINES.length, want.size(), "every framing and named engine has its row");
        StringBuilder table = new StringBuilder(String.format("%-9s | %-15s | %-15s | %s%n", "model", "key agreement", "point addition", "both"));
        for (java.util.Map.Entry<String, int[]> row : want.entrySet()) {
            String how = row.getKey();
            String[] cells = new String[3];
            for (int which = 0; which < 3; which++) {
                SchnorrHW schnorr = new SchnorrHW();
                WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
                WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
                if (which != 1) ecdh.frame = how;
                if (which != 0) gm.frame = how;
                setHidden(schnorr, "ecdh", ecdh);
                setHidden(schnorr, "gm", gm);
                schnorr.init();
                String what = how + (which == 0 ? ", the key agreement" : which == 1 ? ", the point addition" : ", both");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), what + ": refused");
                ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
                if (tmp.isInitialized()) {
                    byte[] k = new byte[32];
                    tmp.getS(k, (short) 0);
                    org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), k, what + ": G's x left in the key");
                }
                if (which < 2) {
                    int asked = which == 0 ? ecdh.given.size() : gm.given.size();
                    assertEquals(row.getValue()[which], asked, what + ": refused at that engine's ask " + row.getValue()[which]);
                    cells[which] = "refused, ask " + asked;
                } else {
                    cells[which] = "refused";
                }
            }
            table.append(String.format("%-9s | %-15s | %-15s | %s%n", how, cells[0], cells[1], cells[2]));
        }
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
        setHidden(schnorr, "ecdh", ecdh);
        setHidden(schnorr, "gm", gm);
        schnorr.init();
        schnorr.checkFraming(new byte[65], (short) 0);
        assertEquals(9, ecdh.given.size(), "the real engines pass: the key agreement asked nine times");
        assertEquals(8, gm.given.size(), "and the point addition eight times");
        table.append(String.format("%-9s | %-15s | %-15s | %s%n", "right", "passes", "passes", "passes"));
        System.out.print(table);
    }

    /** The key agreement and the point addition of the family that answer as the true engine at every input (the rest of the family is wrong somewhere). The four point additions that take the point added as it is where it is G and negated elsewhere (".../notG/...") answer as the true engine except where G is the point added: the point addition's fourth ask, [n - 2]G + G, adds G and refuses them. */
    static final String[] FAMILY_RIGHT_KA = { "id/id/id", "id/modn/id", "neg/id/neg", "neg/modn/neg", "notG/id/notG", "notG/modn/notG" };
    static final String[] FAMILY_RIGHT_GM = { "id/id/id/id/id", "id/id/modn/id/id", "id/neg/id/neg/neg", "id/neg/modn/neg/neg",
        "neg/id/id/neg/id", "neg/id/modn/neg/id", "neg/neg/id/id/neg", "neg/neg/modn/id/neg" };

    @Test
    @DisplayName("The framing check refuses 6F00 every wrong engine of the family (each rule of the base or generator, the point added, the scalar, the middle point and the answer, crossed: 612 key agreements and 44,064 point additions), each engine alone, and both together with the members the other engine's last ask is needed for, and leaves G's x in the key and G as its generator; the members it passes are exactly those that answer as the true engine at every input (6 and 8), and each of them answers right at 24 random inputs. Counts at each ask: key agreement 305, 171, 124, 6; point addition 34,416, 9,324, 312, and 4 at its fourth (the members that negate every point added but G, refused where G is added). And each fault of the method outside the family (METHOD_FAULTS) on one engine, with each member that answers as the true engine on the other, is refused")
    void theFramingCheckRefusesTheWholeFamily() throws Exception {
        java.util.Random rnd = new java.util.Random(10);
        int[][] wantAt = { { 0, 305, 171, 124, 6, 0, 0, 0, 0, 0 }, { 0, 34416, 9324, 312, 4, 0, 0, 0, 0 } };
        java.util.List<String[]> lastOfKa = new java.util.ArrayList<>(), lastOfGm = new java.util.ArrayList<>();
        StringBuilder report = new StringBuilder();
        for (int which = 0; which < 2; which++) {
            boolean onGm = which == 1;
            SchnorrHW schnorr = new SchnorrHW();
            WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
            WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
            setHidden(schnorr, "ecdh", ecdh);
            setHidden(schnorr, "gm", gm);
            schnorr.init();
            WatchedAgreement engine = onGm ? gm : ecdh;
            // the other engine right, worked out the same way
            (onGm ? ecdh : gm).model = onGm ? new String[] { "id", "id", "id" } : new String[] { "id", "id", "id", "id", "id" };
            int[] at = new int[onGm ? 9 : 10];
            java.util.List<String> passing = new java.util.ArrayList<>();
            byte[] out = new byte[65], g = new byte[65];
            ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
            for (String[] m : family(onGm)) {
                engine.model = m;
                engine.given.clear();
                int sw = refusal(() -> schnorr.checkFraming(out, (short) 0));
                String name = String.join("/", m);
                if (sw == 0x9000) {
                    passing.add(name);
                } else {
                    assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, sw, name);
                    at[engine.given.size()]++;
                    if (engine.given.size() == (onGm ? 3 : 4)) (onGm ? lastOfGm : lastOfKa).add(m);
                }
                if (tmp.isInitialized()) {
                    tmp.getG(g, (short) 0);
                    org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, g, name + ": the key's generator is G after the check");
                }
            }
            org.junit.jupiter.api.Assertions.assertArrayEquals(wantAt[which], at, (onGm ? "the point addition" : "the key agreement") + ": refused at each ask " + java.util.Arrays.toString(at));
            assertEquals(java.util.Arrays.asList(onGm ? FAMILY_RIGHT_GM : FAMILY_RIGHT_KA), passing, "the members that pass are those that answer as the true engine");
            // each that passes answers right where the card uses it: mul() and addTo() of random scalars, points and generators (G among them)
            for (String name : passing) {
                engine.model = name.split("/");
                for (int i = 0; i < 24; i++) {
                    BigInteger t = new BigInteger(256, rnd).mod(FN.subtract(BigInteger.ONE)).add(BigInteger.ONE);
                    BigInteger[] q = i % 3 == 0 ? xy(SECP_G, 0) : times(new BigInteger(250, rnd).add(BigInteger.ONE), xy(SECP_G, 0));
                    BigInteger[] h = times(new BigInteger(250, rnd).add(BigInteger.ONE), xy(SECP_G, 0));
                    BigInteger[] want = onGm ? sum(times(t, q), h) : times(t, q);
                    if (onGm) schnorr.addTo(u32(t), (short) 0, point(q[0], q[1]), (short) 0, point(h[0], h[1]), (short) 0, out, (short) 0);
                    else schnorr.mul(u32(t), (short) 0, point(q[0], q[1]), (short) 0, out, (short) 0);
                    org.junit.jupiter.api.Assertions.assertArrayEquals(point(want[0], want[1]), out, name + " answers as the true engine");
                }
            }
            report.append(String.format("%s: %d members, refused at each ask %s, passing %d (each answers as the true engine)%n",
                onGm ? "point addition" : "key agreement", family(onGm).size(), java.util.Arrays.toString(java.util.Arrays.copyOfRange(at, 1, at.length)), passing.size()));
        }
        assertEquals(612, family(false).size());
        assertEquals(44064, family(true).size());
        // both wrong at once: each wrong member of one engine with each member of the other that only the other's last ask refuses
        int pairs = 0;
        for (int which = 0; which < 2; which++) {
            boolean onGm = which == 1;
            SchnorrHW schnorr = new SchnorrHW();
            WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
            WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
            setHidden(schnorr, "ecdh", ecdh);
            setHidden(schnorr, "gm", gm);
            schnorr.init();
            java.util.List<String[]> partners = onGm ? lastOfKa : lastOfGm;
            java.util.List<String> right = java.util.Arrays.asList(onGm ? FAMILY_RIGHT_GM : FAMILY_RIGHT_KA);
            for (String[] partner : partners.subList(0, Math.min(partners.size(), onGm ? 2 : 6))) {
                (onGm ? ecdh : gm).model = partner;
                for (String[] m : family(onGm)) {
                    if (right.contains(String.join("/", m))) continue;
                    (onGm ? gm : ecdh).model = m;
                    assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), String.join("/", m) + " with " + String.join("/", partner));
                    pairs++;
                }
            }
        }
        report.append("both wrong: " + pairs + " pairs, each refused\n");
        // and outside the family: each fault of the method (MethodModels) on one engine, with each member of the family that
        // answers as the true engine on the other (theFramingCheckRefusesTheMethodFaults has the true engines themselves)
        int outside = 0;
        for (int which = 0; which < 2; which++) {
            boolean onGm = which == 1;
            for (String how : METHOD_FAULTS) for (String right : onGm ? FAMILY_RIGHT_KA : FAMILY_RIGHT_GM) {
                WatchedAgreement[] e = new WatchedAgreement[2];
                SchnorrHW schnorr = watched(onGm ? null : how, onGm ? how : null, e);
                e[onGm ? 0 : 1].model = right.split("/");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), how + " with " + right);
                leftAtG(schnorr, how + " with " + right);
                outside++;
            }
        }
        report.append("a fault of the method on one engine, the other answering as the true engine by the family's rules: " + outside + ", each refused\n");
        System.out.print(report);
    }

    /** The faults of the method the framing check refuses (MethodModels), each engine alone and both. */
    static final String[] METHOD_FAULTS = { "gBlind", "gTable", "win7", "comb2", "jac", "leOut", "leS" };
    /** The scalar of the framing check's asks of a pseudo-random scalar: SHA-256("BIP0340/aux"), which the signer keeps (tagHashAux). */
    static final BigInteger AUX = new BigInteger(1, sha256Of("BIP0340/aux"));
    /** The second: BIP-340's tagged hash of nothing under "BIP0340/nonce", SHA-256(SHA-256(tag) || SHA-256(tag)). */
    static final BigInteger NONCE_OF_NOTHING = new BigInteger(1, sha256Of2(sha256Of("BIP0340/nonce")));

    static byte[] sha256Of2(byte[] t) {
        try {
            java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
            d.update(t);
            return d.digest(t);
        } catch (java.security.NoSuchAlgorithmException e) { throw new AssertionError(e); }
    }

    static byte[] sha256Of(String s) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes(java.nio.charset.StandardCharsets.US_ASCII)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new AssertionError(e); }
    }

    /** A signer whose engines are watched, the key agreement's and the point addition's frames given (null for the real one). */
    static SchnorrHW watched(String ecdhFrame, String gmFrame, WatchedAgreement[] engines) throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement ecdh = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
        if (ecdhFrame != null) ecdh.frame = ecdhFrame;
        if (gmFrame != null) gm.frame = gmFrame;
        setHidden(schnorr, "ecdh", ecdh);
        setHidden(schnorr, "gm", gm);
        schnorr.init();
        engines[0] = ecdh;
        engines[1] = gm;
        return schnorr;
    }

    /** The key's generator is G and its scalar G's x (or a key in RAM holds nothing) after the check. */
    static void leftAtG(SchnorrHW schnorr, String what) throws Exception {
        ECPrivateKey tmp = (ECPrivateKey) hidden(schnorr, "tmpPriv");
        if (!tmp.isInitialized()) return;
        byte[] g = new byte[65], k = new byte[32];
        tmp.getG(g, (short) 0);
        tmp.getS(k, (short) 0);
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, g, what + ": the key's generator is G after the check");
        org.junit.jupiter.api.Assertions.assertArrayEquals(java.util.Arrays.copyOfRange(SECP_G, 1, 33), k, what + ": G's x left in the key");
    }

    @Test
    @DisplayName("The framing check asks the generator with a scalar of the full width and a pseudo-random scalar on G and on 2G: after the seven asks of the family, the key agreement [n - 1]G = -G, the point addition [n - 2]G + G = -G (the generator G), then, with k = SHA-256(\"BIP0340/aux\") (the signer's tagHashAux), the key agreement [k](2G), the point addition [k - 1](2G) + 2G (the generator 2G), the point addition [2k - 2]G + 2G (the generator G) and the key agreement [2k]G, the last three held to the first, and the same four with m, BIP-340's tagged hash of nothing under \"BIP0340/nonce\" (from the signer's tagHashNonce): seventeen engine calls, nine of the key agreement and eight of the point addition, and the points added are distinct; neither k - 1, m - 1, 2k nor 2m borrows or carries at the last byte")
    void theFramingCheckAsksTheGeneratorAndAHashScalar() throws Exception {
        WatchedAgreement[] e = new WatchedAgreement[2];
        SchnorrHW schnorr = watched(null, null, e);
        org.junit.jupiter.api.Assertions.assertArrayEquals(sha256Of("BIP0340/aux"), (byte[]) hidden(schnorr, "tagHashAux"), "k is the signer's own tagHashAux");
        assertTrue(AUX.compareTo(FN) < 0 && AUX.testBit(255), "k is under n and of the full width (its top bit set)");
        org.junit.jupiter.api.Assertions.assertArrayEquals(sha256Of("BIP0340/nonce"), (byte[]) hidden(schnorr, "tagHashNonce"), "m is made from the signer's own tagHashNonce");
        BigInteger m = NONCE_OF_NOTHING, twoM = m.shiftLeft(1).mod(FN);
        assertTrue(m.signum() > 0 && m.compareTo(FN) < 0, "m is under n");
        for (BigInteger t : new BigInteger[] { AUX, m }) {
            assertTrue((t.intValue() & 0xFF) != 0, "t's last byte is not 0: t - 1 does not borrow");
            BigInteger sum = t.subtract(BigInteger.ONE).shiftLeft(1).mod(FN);
            assertTrue((sum.intValue() & 0xFF) <= 0xFD, "(2t - 2) mod n's last byte takes 2 with no carry");
            assertEquals(t.shiftLeft(1).mod(FN), sum.add(BigInteger.TWO), "and is 2t mod n");
        }
        schnorr.checkFraming(new byte[65], (short) 0);
        assertEquals(9, e[0].given.size(), "the key agreement is asked nine times");
        assertEquals(8, e[1].given.size(), "the point addition eight times");
        BigInteger n1 = FN.subtract(BigInteger.ONE), n2 = FN.subtract(BigInteger.TWO), k2 = AUX.shiftLeft(1).mod(FN);
        byte[] twoG = timesG(2);
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, e[0].given.get(4), "the key agreement's fifth: G");
        assertEquals(n1, e[0].askedBy.get(4), "by n - 1");
        org.junit.jupiter.api.Assertions.assertArrayEquals(twoG, e[0].given.get(5), "its sixth: 2G");
        assertEquals(AUX, e[0].askedBy.get(5), "by k");
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, e[0].given.get(6), "its seventh: G");
        assertEquals(k2, e[0].askedBy.get(6), "by 2k mod n");
        org.junit.jupiter.api.Assertions.assertArrayEquals(twoG, e[0].given.get(7), "its eighth: 2G");
        assertEquals(m, e[0].askedBy.get(7), "by m");
        org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, e[0].given.get(8), "its ninth: G");
        assertEquals(twoM, e[0].askedBy.get(8), "by 2m mod n");
        Object[][] gmWant = { { SECP_G, n2, SECP_G }, { twoG, AUX.subtract(BigInteger.ONE), twoG }, { SECP_G, k2.subtract(BigInteger.TWO), twoG },
            { twoG, m.subtract(BigInteger.ONE), twoG }, { SECP_G, twoM.subtract(BigInteger.TWO), twoG } };
        int last = indexOf(e[1].scalars, u32(BigInteger.valueOf(4)));
        for (int i = 0; i < gmWant.length; i++) {
            assertEquals(gmWant[i][1], e[1].askedBy.get(3 + i), "the point addition's ask " + (4 + i) + ": its scalar");
            int at = last + 1;
            while (at < e[1].scalars.size() && !java.util.Arrays.equals(e[1].scalars.get(at), u32((BigInteger) gmWant[i][1]))) at++;
            assertTrue(at < e[1].scalars.size(), "its key, after the last ask's");
            last = at;
            org.junit.jupiter.api.Assertions.assertArrayEquals((byte[]) gmWant[i][0], e[1].generators.get(at), "its generator");
            org.junit.jupiter.api.Assertions.assertArrayEquals((byte[]) gmWant[i][2], e[1].given.get(3 + i), "the point added");
        }
        BigInteger[] g = xy(SECP_G, 0), two = xy(twoG, 0), want = times(k2, g);
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(SECP_G), point(times(n1, g)[0], times(n1, g)[1]), "[n - 1]G is -G");
        BigInteger[] m2 = times(n2, g);
        assertFalse(m2[0].equals(g[0]), "[n - 2]G is not G or -G: two distinct points are added");
        org.junit.jupiter.api.Assertions.assertArrayEquals(negate(SECP_G), point(sum(m2, g)[0], sum(m2, g)[1]), "[n - 2]G + G is -G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(want[0], want[1]), point(times(AUX, two)[0], times(AUX, two)[1]), "[k](2G) is [2k]G");
        BigInteger[] a = times(AUX.subtract(BigInteger.ONE), two), b = times(k2.subtract(BigInteger.TWO), g);
        assertFalse(a[0].equals(two[0]) || b[0].equals(two[0]), "[k - 1](2G) and [2k - 2]G are not 2G or -2G: two distinct points are added");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(want[0], want[1]), point(sum(a, two)[0], sum(a, two)[1]), "[k - 1](2G) + 2G is [2k]G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(want[0], want[1]), point(sum(b, two)[0], sum(b, two)[1]), "[2k - 2]G + 2G is [2k]G");
        BigInteger[] wantM = times(twoM, g), c = times(m.subtract(BigInteger.ONE), two), d = times(twoM.subtract(BigInteger.TWO), g);
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(wantM[0], wantM[1]), point(times(m, two)[0], times(m, two)[1]), "[m](2G) is [2m]G");
        assertFalse(c[0].equals(two[0]) || d[0].equals(two[0]), "[m - 1](2G) and [2m - 2]G are not 2G or -2G: two distinct points are added");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(wantM[0], wantM[1]), point(sum(c, two)[0], sum(c, two)[1]), "[m - 1](2G) + 2G is [2m]G");
        org.junit.jupiter.api.Assertions.assertArrayEquals(point(wantM[0], wantM[1]), point(sum(d, two)[0], sum(d, two)[1]), "[2m - 2]G + 2G is [2m]G");
        assertTrue(n2.compareTo(TWO256_LESS_N()) >= 0 && k2.compareTo(TWO256_LESS_N()) >= 0, "the scalars on G are 2^256 - n or more: past where an engine's blinding (s + n) carries out of 256 bits");
    }

    static BigInteger TWO256_LESS_N() { return BigInteger.ONE.shiftLeft(256).subtract(FN); }

    @Test
    @DisplayName("The framing check refuses 6F00 a chip whose multiplication itself is wrong, outside the family (MethodModels): a G path that blinds the scalar with n and loses the carry, a G table whose entry 2 is -2G, a 4-bit window whose entry 7 is -7P, a comb whose entry 2 is negated, an answer left Jacobian, an X given little-endian, a scalar read little-endian; on the key agreement alone, the point addition alone and both, and each on the key agreement with each on the point addition; the first four only at an ask after the seven of the family; the key's generator G and its scalar G's x after it. A point addition with no case for a point added to itself passes: the check adds distinct points, as the card does")
    void theFramingCheckRefusesTheMethodFaults() throws Exception {
        StringBuilder table = new StringBuilder(String.format("%-7s | %-28s | %-28s | %s%n", "fault", "key agreement", "point addition", "both"));
        for (String how : METHOD_FAULTS) {
            String[] cells = new String[3];
            for (int which = 0; which < 3; which++) {
                WatchedAgreement[] e = new WatchedAgreement[2];
                SchnorrHW schnorr = watched(which != 1 ? how : null, which != 0 ? how : null, e);
                String what = how + (which == 0 ? ", the key agreement" : which == 1 ? ", the point addition" : ", both");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), what + ": refused");
                leftAtG(schnorr, what);
                int calls = e[0].given.size() + e[1].given.size();
                if (how.equals("gBlind") || how.equals("gTable") || how.equals("win7") || how.equals("comb2")) {
                    assertTrue(calls > 7, what + ": past the seven asks of the family (refused at call " + calls + ")");
                }
                cells[which] = "refused at call " + calls + " (" + e[0].given.size() + " + " + e[1].given.size() + ")";
            }
            table.append(String.format("%-7s | %-28s | %-28s | %s%n", how, cells[0], cells[1], cells[2]));
        }
        int pairs = 0;
        for (String a : METHOD_FAULTS) for (String b : METHOD_FAULTS) {
            WatchedAgreement[] e = new WatchedAgreement[2];
            SchnorrHW schnorr = watched(a, b, e);
            assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), a + " with " + b);
            pairs++;
        }
        WatchedAgreement[] e = new WatchedAgreement[2];
        SchnorrHW schnorr = watched(null, "dbl", e);
        assertEquals(0x9000, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), "dbl passes: no ask adds a point to itself");
        table.append("each of the key agreement's with each of the point addition's: " + pairs + " pairs, each refused\n");
        System.out.print(table);
    }

    @Test
    @DisplayName("A chip that throws at any one of the framing check's seventeen engine calls, nine of the key agreement and eight of the point addition, is refused (the chip's exception goes on up, and the check does not pass), and the key's generator is G and its scalar G's x after it; so is one that answers its Y negated at any one of them (6F00)")
    void theFramingCheckRefusesAThrowOrAWrongAnswerAtEveryCall() throws Exception {
        for (int which = 0; which < 2; which++) {
            for (int call = 1; call <= (which == 0 ? 9 : 8); call++) {
                for (boolean wrong : new boolean[] { false, true }) {
                    WatchedAgreement[] e = new WatchedAgreement[2];
                    SchnorrHW schnorr = watched(null, null, e);
                    String what = (which == 0 ? "the key agreement" : "the point addition") + ", call " + call + (wrong ? ", Y negated" : ", a throw");
                    if (wrong) e[which].negateOn = call; else e[which].failOn = call;
                    int sw = 0x9000;
                    try { schnorr.checkFraming(new byte[65], (short) 0); }
                    catch (ISOException x) { sw = x.getReason() & 0xFFFF; }
                    catch (javacard.security.CryptoException x) { sw = -1; }
                    assertTrue(sw != 0x9000, what + ": refused");
                    if (wrong) assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, sw, what);
                    assertEquals(call, e[which].given.size(), what + ": no call after it");
                    leftAtG(schnorr, what);
                }
            }
        }
    }

    /** The asks of the framing check: {key agreement (0) or point addition (1), on the G path, scalar}. */
    static Object[][] frameAsks() {
        BigInteger n1 = FN.subtract(BigInteger.ONE), n2 = FN.subtract(BigInteger.TWO), k2 = AUX.shiftLeft(1).mod(FN);
        BigInteger m = NONCE_OF_NOTHING, m2 = m.shiftLeft(1).mod(FN);
        return new Object[][] {
            { 0, true, BigInteger.valueOf(11) }, { 1, true, BigInteger.valueOf(13) }, { 0, false, n1 }, { 1, false, n2 },
            { 0, false, BigInteger.TWO }, { 1, false, BigInteger.valueOf(4) }, { 0, false, n1 },
            { 0, true, n1 }, { 1, true, n2 }, { 0, false, AUX }, { 1, false, AUX.subtract(BigInteger.ONE) },
            { 1, true, k2.subtract(BigInteger.TWO) }, { 0, true, k2 },
            { 0, false, m }, { 1, false, m.subtract(BigInteger.ONE) }, { 1, true, m2.subtract(BigInteger.TWO) }, { 0, true, m2 } };
    }

    @Test
    @DisplayName("A table entry stored negated, in a fixed window, a comb or a NAF of 3, 4 or 5 bits, on the G path, on every other base, or on all, in the key agreement, the point addition or both, is refused 6F00 exactly where one of the framing check's scalars on that path and engine uses the entry, and every entry is used on both paths of each engine: 1,080 refused, none passing")
    void theFramingCheckRefusesEveryTableEntryItsScalarsUse() throws Exception {
        Object[][] asks = frameAsks();
        StringBuilder report = new StringBuilder();
        int refused = 0, passed = 0;
        for (String method : new String[] { "window", "comb", "wnaf" }) for (int w = 3; w <= 5; w++) {
            java.util.List<Integer> entries = new java.util.ArrayList<>();
            if (method.equals("wnaf")) { for (int x = 1; x < 1 << (w - 1); x += 2) entries.add(x); }
            else for (int x = 1; x < 1 << w; x++) entries.add(x);
            for (String path : new String[] { "G", "other", "all" }) {
                for (int which = 0; which < 3; which++) {
                    java.util.List<Integer> unused = new java.util.ArrayList<>();
                    for (int entry : entries) {
                        String how = method + "/" + w + "/" + entry + "/" + path;
                        boolean used = false;
                        for (Object[] a : asks) {
                            int eng = (Integer) a[0];
                            boolean onPath = path.equals("all") || ((Boolean) a[1]) == path.equals("G");
                            if ((which == 2 || which == eng) && onPath && MethodModels.uses(method, (BigInteger) a[2], w, entry)) used = true;
                        }
                        WatchedAgreement[] e = new WatchedAgreement[2];
                        SchnorrHW schnorr = watched(which != 1 ? how : null, which != 0 ? how : null, e);
                        int sw = refusal(() -> schnorr.checkFraming(new byte[65], (short) 0));
                        String what = how + (which == 0 ? ", the key agreement" : which == 1 ? ", the point addition" : ", both");
                        assertEquals(used ? CashuApplet.SW_CRYPTO_ERROR & 0xFFFF : 0x9000, sw, what + (used ? ": a scalar uses the entry, refused" : ": no scalar uses the entry"));
                        if (used) refused++; else { passed++; unused.add(entry); }
                    }
                    assertEquals(java.util.Collections.emptyList(), unused, method + " w=" + w + " " + path + " " + which + ": the entries no scalar uses");
                    report.append(String.format("%-6s w=%d %-5s %-14s: %2d of %2d entries used%s%n", method, w, path,
                        which == 0 ? "key agreement" : which == 1 ? "point addition" : "both", entries.size() - unused.size(), entries.size(), unused.isEmpty() ? "" : ", never " + unused));
                }
            }
        }
        assertEquals(1080, refused, "table faults refused");
        assertEquals(0, passed, "and none passing");
        report.append("table faults refused " + refused + ", passing " + passed + " (each where no scalar uses the entry)\n");
        System.out.print(report);
    }

    @Test
    @DisplayName("The framing check leaves the temporary key's generator G, whether it passes or is refused at a point addition asked with another generator (11G, -G): with the persistent key, whose generator the check sets; and a key in RAM is left holding nothing")
    void theFramingCheckLeavesTheGeneratorG() throws Exception {
        for (String[] gmModel : new String[][] { null, { "id", "id", "id", "id", "odd" }, { "id", "odd", "id", "id", "id" } }) {
            SchnorrHW schnorr = new SchnorrHW();
            ECPrivateKey persistent = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
            CashuApplet.curve(persistent);
            persistent.setS(java.util.Arrays.copyOfRange(SECP_G, 1, 33), (short) 0, (short) 32);
            setHidden(schnorr, "tmpPriv", persistent);
            setHidden(schnorr, "keyInRam", Boolean.FALSE);
            WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
            gm.model = gmModel;
            setHidden(schnorr, "gm", gm);
            schnorr.init();
            String what = gmModel == null ? "the real engines" : String.join("/", gmModel);
            assertEquals(gmModel == null ? 0x9000 : CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refusal(() -> schnorr.checkFraming(new byte[65], (short) 0)), what);
            assertEquals(gmModel == null ? 8 : gmModel[1].equals("odd") ? 3 : 2, gm.given.size(), what + ": the point addition's asks");
            byte[] g = new byte[65];
            assertEquals(65, persistent.getG(g, (short) 0));
            org.junit.jupiter.api.Assertions.assertArrayEquals(SECP_G, g, what + ": the key's generator is G after the check");
        }
        SchnorrHW ram = signerWithKeyInRam();
        ram.init();
        ram.checkFraming(new byte[65], (short) 0);
        assertFalse(((ECPrivateKey) hidden(ram, "tmpPriv")).isInitialized(), "a key in RAM holds nothing after the check");
    }

    @Test
    @DisplayName("Each wrong engine the framing check refuses would get a point the card uses wrong: over twelve random scalars, points and generators, mul() on the key agreement and addTo() on the point addition each answer another point at least once for every model (none of them is harmless to a card that uses a variable base)")
    void eachWrongEngineGetsAPointTheCardUsesWrong() throws Exception {
        java.util.Random r = new java.util.Random(9);
        for (String how : WRONG_ENGINES) {
            for (int which = 0; which < 2; which++) {
                SchnorrHW schnorr = new SchnorrHW();
                WatchedAgreement engine = new WatchedAgreement(which == 0 ? javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY : javacard.security.KeyAgreement.ALG_EC_PACE_GM);
                engine.frame = how;
                setHidden(schnorr, which == 0 ? "ecdh" : "gm", engine);
                schnorr.init();
                int wrong = 0;
                for (int i = 0; i < 12; i++) {
                    BigInteger t = new BigInteger(256, r).mod(FN.subtract(BigInteger.ONE)).add(BigInteger.ONE);
                    BigInteger[] q = CashuAppletTest.ecMulTest(new BigInteger(250, r).add(BigInteger.ONE), CashuAppletTest.SECP_GX, CashuAppletTest.SECP_GY);
                    BigInteger[] h = CashuAppletTest.ecMulTest(new BigInteger(250, r).add(BigInteger.ONE), CashuAppletTest.SECP_GX, CashuAppletTest.SECP_GY);
                    byte[] out = new byte[65];
                    BigInteger[] want = CashuAppletTest.ecMulTest(t, q[0], q[1]);
                    if (which == 0) {
                        schnorr.mul(u32(t), (short) 0, point(q[0], q[1]), (short) 0, out, (short) 0);
                    } else {
                        schnorr.addTo(u32(t), (short) 0, point(q[0], q[1]), (short) 0, point(h[0], h[1]), (short) 0, out, (short) 0);
                        want = sum(want, h);
                    }
                    if (!java.util.Arrays.equals(out, point(want[0], want[1]))) wrong++;
                }
                assertTrue(wrong > 0, how + (which == 0 ? ", the key agreement" : ", the point addition") + ": wrong for none of 12");
            }
        }
    }

    @Test
    @DisplayName("A signature whose wipe the chip refuses (the point addition refuses its re-initialisation) leaves its scratch and work zero all the same: they are zeroed before the key is wiped")
    void aRefusedWipeStillLeavesTheScratchZero() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        WatchedAgreement gm = new WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
        setHidden(schnorr, "gm", gm);
        schnorr.init();
        gm.refuseInit = true;
        byte[] msg = new byte[32];
        for (int i = 0; i < 32; i++) msg[i] = (byte) (0x5D ^ i);
        org.junit.jupiter.api.Assertions.assertThrows(javacard.security.CryptoException.class,
            () -> schnorr.sign(keyOf((String) KEYS[3][0]), pubOf((String) KEYS[3][1]), msg, (short) 0, new byte[64], (short) 0));
        assertTrue(allZero((byte[]) hidden(schnorr, "sc")), "the scratch that held d and k is zero");
        assertTrue(allZero((byte[]) hidden(schnorr, "work")), "the work that held e*d is zero");
    }

    @Test
    @DisplayName("The framing a key agreement must have: [2]G by agree() is the 65 bytes 04 || X || Y of 2G, byte for byte; framed() refuses an answer of 64 bytes, of 33, of 66, or of 65 that does not begin 04 with 6F00; agree() takes only 65 bytes and answers 65 (its callers hold the point to the curve first, CashuApplet.requireFullPoint)")
    void theFramingSelfTestVector() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();
        byte[] out = new byte[65];
        assertEquals(65, schnorr.agree(keyOf("0000000000000000000000000000000000000000000000000000000000000002"), SECP_G, (short) 0, (short) 65, out, (short) 0));
        org.junit.jupiter.api.Assertions.assertArrayEquals(CashuAppletTest.hexToBytes((String) KEYS[1][1]), out, "[2]G is 2G, framed 04 || X || Y");

        java.lang.reflect.Method framed = SchnorrHW.class.getDeclaredMethod("framed", short.class, byte[].class, short.class);
        framed.setAccessible(true);
        byte[] good = out.clone();
        framed.invoke(null, (short) 65, good, (short) 0);   // nothing thrown
        byte[] lead02 = good.clone();
        lead02[0] = 2;
        Object[][] bad = { { (short) 64, good }, { (short) 33, good }, { (short) 66, good }, { (short) 65, new byte[65] }, { (short) 65, lead02 } };
        for (Object[] b : bad) {
            try {
                framed.invoke(null, b[0], b[1], (short) 0);
                org.junit.jupiter.api.Assertions.fail("a framing of " + b[0] + " bytes beginning " + ((byte[]) b[1])[0] + " was taken");
            } catch (java.lang.reflect.InvocationTargetException e) {
                assertEquals(CashuApplet.SW_CRYPTO_ERROR, ((ISOException) e.getCause()).getReason());
            }
        }
        ECPrivateKey two = keyOf("0000000000000000000000000000000000000000000000000000000000000002");
        assertEquals(0x6A80, refusal(() -> schnorr.agree(two, SECP_G, (short) 0, (short) 64, out, (short) 0)));
    }

    /** Points that are no point of the curve, each 65 bytes beginning 04 (and two that do not): y one off, y = p, x = p, x + p for a point whose x is small, a point of the twist, (0, 0), all ones, and 02 and 00 lead bytes. */
    static java.util.List<byte[]> pointsThatAreNone() {
        BigInteger gx = new BigInteger(1, java.util.Arrays.copyOfRange(SECP_G, 1, 33));
        BigInteger gy = new BigInteger(1, java.util.Arrays.copyOfRange(SECP_G, 33, 65));
        java.util.List<byte[]> refused = new java.util.ArrayList<>();
        refused.add(point(gx, gy.add(BigInteger.ONE).mod(FP)));
        refused.add(point(gx, FP));
        refused.add(point(FP, gy));
        refused.add(point(BigInteger.ZERO, BigInteger.ZERO));
        BigInteger[] small = smallPoint();
        refused.add(point(small[0].add(FP), small[1]));
        refused.add(twistPoint());
        byte[] ones = new byte[65];
        java.util.Arrays.fill(ones, (byte) 0xFF);
        ones[0] = 4;
        refused.add(ones);
        byte[] lead02 = SECP_G.clone(); lead02[0] = 2; refused.add(lead02);
        byte[] lead00 = SECP_G.clone(); lead00[0] = 0; refused.add(lead00);
        return refused;
    }

    /** The point of the curve with the smallest x: its x + p is the same number mod p, and is not under p. */
    static BigInteger[] smallPoint() {
        BigInteger exp = FP.add(BigInteger.ONE).shiftRight(2);
        for (BigInteger sx = BigInteger.ONE; ; sx = sx.add(BigInteger.ONE)) {
            BigInteger v = sx.pow(3).add(BigInteger.valueOf(7)).mod(FP), y = v.modPow(exp, FP);
            if (y.multiply(y).mod(FP).equals(v)) return new BigInteger[] { sx, y };
        }
    }

    /** A point of the twist: x^3 + 7 no square, and y the root of its negative, so y^2 = -(x^3 + 7). */
    static byte[] twistPoint() {
        BigInteger exp = FP.add(BigInteger.ONE).shiftRight(2);
        for (BigInteger tx = BigInteger.valueOf(2); ; tx = tx.add(BigInteger.ONE)) {
            BigInteger v = tx.pow(3).add(BigInteger.valueOf(7)).mod(FP), y = v.modPow(exp, FP);
            if (!y.multiply(y).mod(FP).equals(v)) {
                BigInteger ty = FP.subtract(v).modPow(exp, FP);
                if (ty.multiply(ty).mod(FP).equals(FP.subtract(v))) return point(tx, ty);
            }
        }
    }

    /**
     * An {@link ECPrivateKey} that behaves like a card whose {@code getS} strips
     * leading zero bytes: the value is right, the length is short, and the
     * caller's buffer keeps whatever it held beyond it.
     */
    private static final class LeadingZeroStrippingPrivateKey extends DelegatingPrivateKey {
        LeadingZeroStrippingPrivateKey(ECPrivateKey delegate) { super(delegate); }

        @Override
        public short getS(byte[] buf, short off) {
            byte[] full = new byte[32];
            short len = delegate.getS(full, (short) 0);
            short lead = 0;
            while (lead < (short) (len - 1) && full[lead] == 0) lead++;
            short stripped = (short) (len - lead);
            System.arraycopy(full, lead, buf, off, stripped);
            return stripped;
        }
    }

    /**
     * An {@link ECPrivateKey} whose {@code getS} writes the real scalar but
     * reports a length the applet cannot work with — a card outside the range
     * the spec allows, rather than a merely stripping one.
     */
    private static final class FixedLengthPrivateKey extends DelegatingPrivateKey {
        private final short reported;

        FixedLengthPrivateKey(ECPrivateKey delegate, short reported) {
            super(delegate);
            this.reported = reported;
        }

        @Override
        public short getS(byte[] buf, short off) {
            delegate.getS(buf, off);
            return reported;
        }
    }

    /** Everything an {@link ECPrivateKey} must implement, forwarded verbatim. */
    private static abstract class DelegatingPrivateKey implements ECPrivateKey {
        protected final ECPrivateKey delegate;

        DelegatingPrivateKey(ECPrivateKey delegate) { this.delegate = delegate; }

        @Override public short getS(byte[] b, short o) { return delegate.getS(b, o); }
        @Override public void setS(byte[] b, short o, short l) { delegate.setS(b, o, l); }
        @Override public void setFieldFP(byte[] b, short o, short l) { delegate.setFieldFP(b, o, l); }
        @Override public void setFieldF2M(short e) { delegate.setFieldF2M(e); }
        @Override public void setFieldF2M(short e1, short e2, short e3) {
            delegate.setFieldF2M(e1, e2, e3);
        }
        @Override public void setA(byte[] b, short o, short l) { delegate.setA(b, o, l); }
        @Override public void setB(byte[] b, short o, short l) { delegate.setB(b, o, l); }
        @Override public void setG(byte[] b, short o, short l) { delegate.setG(b, o, l); }
        @Override public void setR(byte[] b, short o, short l) { delegate.setR(b, o, l); }
        @Override public void setK(short k) { delegate.setK(k); }
        @Override public short getField(byte[] b, short o) { return delegate.getField(b, o); }
        @Override public short getA(byte[] b, short o) { return delegate.getA(b, o); }
        @Override public short getB(byte[] b, short o) { return delegate.getB(b, o); }
        @Override public short getG(byte[] b, short o) { return delegate.getG(b, o); }
        @Override public short getR(byte[] b, short o) { return delegate.getR(b, o); }
        @Override public short getK() { return delegate.getK(); }
        @Override public void copyDomainParametersFrom(javacard.security.ECKey src) {
            delegate.copyDomainParametersFrom(src);
        }
        @Override public boolean isInitialized() { return delegate.isInitialized(); }
        @Override public void clearKey() { delegate.clearKey(); }
        @Override public byte getType() { return delegate.getType(); }
        @Override public short getSize() { return delegate.getSize(); }
    }

    private static String bytesToHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02X", x));
        return sb.toString();
    }

    private static void setCurve(ECPrivateKey priv, ECPublicKey pub) {
        priv.setFieldFP(SECP_P, (short) 0, (short) 32);
        priv.setA(SECP_A, (short) 0, (short) 32);
        priv.setB(SECP_B, (short) 0, (short) 32);
        priv.setG(SECP_G, (short) 0, (short) 65);
        priv.setR(SECP_N, (short) 0, (short) 32);
        priv.setK((short) 1);

        pub.setFieldFP(SECP_P, (short) 0, (short) 32);
        pub.setA(SECP_A, (short) 0, (short) 32);
        pub.setB(SECP_B, (short) 0, (short) 32);
        pub.setG(SECP_G, (short) 0, (short) 65);
        pub.setR(SECP_N, (short) 0, (short) 32);
        pub.setK((short) 1);
    }

    // ---- what the key objects keep after a call ---------------------------------------------------------------

    static final java.math.BigInteger N_ = new java.math.BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);

    /** The scalar a key agreement object keeps of the key it was last given (jCardSim's own copy), or null where it keeps none. */
    static java.math.BigInteger keptBy(SchnorrHW s, String field) throws Exception {
        java.lang.reflect.Field fe = SchnorrHW.class.getDeclaredField(field);
        fe.setAccessible(true);
        Object ka = fe.get(s);
        java.lang.reflect.Field eng = ka.getClass().getDeclaredField("engine");
        eng.setAccessible(true);
        Object full = eng.get(ka);
        if (full == null) return null;
        java.lang.reflect.Field kf = full.getClass().getDeclaredField("key");
        kf.setAccessible(true);
        Object params = kf.get(full);
        return params == null ? null : (java.math.BigInteger) params.getClass().getMethod("getD").invoke(params);
    }

    /** The scalar the temporary key holds. */
    static java.math.BigInteger heldBy(SchnorrHW s) throws Exception {
        java.lang.reflect.Field fk = SchnorrHW.class.getDeclaredField("tmpPriv");
        fk.setAccessible(true);
        byte[] b = new byte[32];
        short n = ((ECPrivateKey) fk.get(s)).getS(b, (short) 0);
        return new java.math.BigInteger(1, java.util.Arrays.copyOf(b, n));
    }

    /** Whether k (or n - k) and the signature give the private key dEff: s = k + e*d. */
    static boolean givesTheKey(java.math.BigInteger k, byte[] sig, java.math.BigInteger e, java.math.BigInteger dEff) {
        if (k == null) return false;
        java.math.BigInteger sv = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(sig, 32, 64));
        for (java.math.BigInteger c : new java.math.BigInteger[] { k, N_.subtract(k).mod(N_) }) {
            if (sv.subtract(c).multiply(e.modInverse(N_)).mod(N_).equals(dEff)) return true;
        }
        return false;
    }

    @Test
    @DisplayName("no secret scalar outlasts the call that uses it: after sign() neither the temporary key nor the key agreement holds a nonce that, with the signature, gives the key; after addToG() and mul() neither holds the scalar given; each holds G's x")
    void noSecretOutlastsTheCall() throws Exception {
        SchnorrHW schnorr = new SchnorrHW();
        schnorr.init();
        java.math.BigInteger gx = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(SECP_G, 1, 33));
        for (Object[] k : KEYS) {
            byte[] d = CashuAppletTest.hexToBytes((String) k[0]);
            byte[] w = CashuAppletTest.hexToBytes((String) k[1]);
            ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
            ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
            setCurve(priv, pub);
            priv.setS(d, (short) 0, (short) 32);
            pub.setW(w, (short) 0, (short) 65);
            byte[] msg = new byte[32];
            msg[0] = 1;
            byte[] sig = new byte[64];
            schnorr.sign(priv, pub, msg, (short) 0, sig, (short) 0);
            java.security.MessageDigest h = java.security.MessageDigest.getInstance("SHA-256");
            byte[] tag = h.digest("BIP0340/challenge".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            h.update(tag); h.update(tag); h.update(sig, 0, 32); h.update(w, 1, 32); h.update(msg);
            java.math.BigInteger e = new java.math.BigInteger(1, h.digest()).mod(N_);
            java.math.BigInteger dv = new java.math.BigInteger(1, d);
            java.math.BigInteger dEff = (Boolean) k[2] ? N_.subtract(dv) : dv;
            assertFalse(givesTheKey(heldBy(schnorr), sig, e, dEff), "the temporary key gives the card key for d=" + k[0]);
            assertFalse(givesTheKey(keptBy(schnorr, "ecdh"), sig, e, dEff), "the key agreement gives the card key for d=" + k[0]);
            assertEquals(gx, heldBy(schnorr), "the temporary key holds G's x");
            assertEquals(gx, keptBy(schnorr, "ecdh"), "and so does the key agreement");
        }
        java.math.BigInteger secret = new java.math.BigInteger("1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF", 16);
        byte[] sb = CashuAppletTest.hexToBytes(secret.toString(16));
        byte[] out = new byte[65];
        schnorr.addToG(sb, (short) 0, SECP_G, (short) 0, out, (short) 0);
        assertEquals(gx, heldBy(schnorr), "after addToG the temporary key holds G's x");
        assertEquals(gx, keptBy(schnorr, "gm"), "and so does the generic mapping");
        schnorr.mul(sb, (short) 0, SECP_G, (short) 0, out, (short) 0);
        assertEquals(gx, heldBy(schnorr), "after mul the temporary key holds G's x");
        assertEquals(gx, keptBy(schnorr, "ecdh"), "and so does the key agreement");
    }
}
