package me.flashapp.cashu;

import javacard.framework.ISOException;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.KeyAgreement;
import javacard.security.KeyBuilder;
import java.math.BigInteger;
import java.util.Arrays;
import java.util.Map;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A signature is verified before it leaves the card (SchnorrHW.sign's step 8, BIP-340's "if Verify fails, abort").
 *
 * Why: d is in RAM and e*d is a multiplication in software, and AUTH signs for any reader, with no PIN, as often as it likes.
 * A fault in that multiplication, or one bit of d flipped, makes a signature whose error s'*G - R - e*P = e*delta*G leaves
 * few values for delta; enough of them give d. Here the faults are modelled as keys that do not agree (a public key object
 * naming another key, a private key one bit off, a date's point that is not P + t*G): each must be refused 6F00 with the
 * caller's buffer as it was and nothing of s in the signer's scratch. And the waits (`signatureWork`) keep the work they had:
 * a signature with no check, which never leaves the card.
 *
 * jCardSim's engines are the simulator's, not the chip's (D10): a scalar of 0, a sum at infinity and an engine's answer
 * written over its own input are cases this does not reach, and the check's time on a chip is not measured here.
 */
class SignatureCheckTest {

    @org.junit.jupiter.api.BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @org.junit.jupiter.api.AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger FP = SECP_P, FN = SECP_N;
    static final Object[][] KEYS = SchnorrHWSignTest.KEYS;

    static SchnorrHW signer() {
        SchnorrHW s = new SchnorrHW();
        s.init();
        return s;
    }

    static byte[] msg(int b) {
        byte[] m = new byte[32];
        for (int i = 0; i < 32; i++) m[i] = (byte) (b ^ (i * 7));
        return m;
    }

    static BigInteger[] times(BigInteger k) { return ecMulTest(k.mod(FN), SECP_GX, SECP_GY); }

    static byte[] point65(BigInteger[] w) { return SchnorrHWSignTest.point(w[0], w[1]); }

    /** The x of the 65-byte or 33-byte key, as BIP-340 names it. */
    static byte[] xOf(byte[] w) { return Arrays.copyOfRange(w, 1, 33); }

    /** `out`, 96 bytes of 0xA5: what a refused signature must leave as it found. */
    static byte[] untouched() {
        byte[] out = new byte[96];
        Arrays.fill(out, (byte) 0xA5);
        return out;
    }

    static int refusal(Runnable r) {
        try { r.run(); } catch (ISOException e) { return e.getReason() & 0xFFFF; }
        return 0x9000;
    }

    /** The signer's scratch and work, all zero: nothing of d, k, e*d or s is left. */
    static void leftNothing(SchnorrHW s, String what) throws Exception {
        assertTrue(SchnorrHWSignTest.allZero((byte[]) SchnorrHWSignTest.hidden(s, "sc")), what + ": the scratch is zero");
        assertTrue(SchnorrHWSignTest.allZero((byte[]) SchnorrHWSignTest.hidden(s, "work")), what + ": the work, s among it, is zero");
    }

    /**
     * A public key object that answers getW in the form a chip may give: "65" as 04 || X || Y, "33" as 02/03 || X, of the
     * point it was made with, whatever the simulator's own key would answer.
     */
    static final class ChipPublicKey implements ECPublicKey {
        final ECPublicKey real;
        final byte[] w65;
        final boolean compressed;
        ChipPublicKey(BigInteger[] w, boolean compressed) {
            this.w65 = point65(w);
            this.compressed = compressed;
            this.real = SchnorrHWSignTest.pubOf(toHex(w65));
        }
        @Override public short getW(byte[] b, short o) {
            if (!compressed) { System.arraycopy(w65, 0, b, o, 65); return 65; }
            b[o] = (byte) ((w65[64] & 1) == 0 ? 2 : 3);
            System.arraycopy(w65, 1, b, o + 1, 32);
            return 33;
        }
        @Override public void setW(byte[] b, short o, short l) { real.setW(b, o, l); }
        @Override public void setFieldFP(byte[] b, short o, short l) { real.setFieldFP(b, o, l); }
        @Override public void setFieldF2M(short e) { real.setFieldF2M(e); }
        @Override public void setFieldF2M(short e1, short e2, short e3) { real.setFieldF2M(e1, e2, e3); }
        @Override public void setA(byte[] b, short o, short l) { real.setA(b, o, l); }
        @Override public void setB(byte[] b, short o, short l) { real.setB(b, o, l); }
        @Override public void setG(byte[] b, short o, short l) { real.setG(b, o, l); }
        @Override public void setR(byte[] b, short o, short l) { real.setR(b, o, l); }
        @Override public void setK(short k) { real.setK(k); }
        @Override public short getField(byte[] b, short o) { return real.getField(b, o); }
        @Override public short getA(byte[] b, short o) { return real.getA(b, o); }
        @Override public short getB(byte[] b, short o) { return real.getB(b, o); }
        @Override public short getG(byte[] b, short o) { return real.getG(b, o); }
        @Override public short getR(byte[] b, short o) { return real.getR(b, o); }
        @Override public short getK() { return real.getK(); }
        @Override public void copyDomainParametersFrom(javacard.security.ECKey src) { real.copyDomainParametersFrom(src); }
        @Override public boolean isInitialized() { return true; }
        @Override public void clearKey() { real.clearKey(); }
        @Override public byte getType() { return real.getType(); }
        @Override public short getSize() { return real.getSize(); }
    }

    /** A key agreement in front of the simulator's that counts its calls and keeps each answer. */
    static final class Counted extends KeyAgreement {
        final KeyAgreement real;
        final java.util.List<byte[]> answers = new java.util.ArrayList<>();
        Counted(byte alg) { real = KeyAgreement.getInstance(alg, false); }
        @Override public void init(javacard.security.PrivateKey k) { real.init(k); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] pub, short off, short len, byte[] out, short outOff) {
            short n = real.generateSecret(pub, off, len, out, outOff);
            answers.add(Arrays.copyOfRange(out, outOff, outOff + n));
            return n;
        }
    }

    /** A signer whose two engines count their calls: {signer, the key agreement, the point addition}. */
    static Object[] countedSigner() throws Exception {
        SchnorrHW s = new SchnorrHW();
        Counted ecdh = new Counted(KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY), gm = new Counted(KeyAgreement.ALG_EC_PACE_GM);
        SchnorrHWSignTest.setHidden(s, "ecdh", ecdh);
        SchnorrHWSignTest.setHidden(s, "gm", gm);
        s.init();
        return new Object[] { s, ecdh, gm };
    }

    // =========================================================================
    // (a) the signatures that verify still do, and are checked on the card
    // =========================================================================

    @Test
    @DisplayName("Every signature sign() gives still verifies off the card, for keys of both parities and getW in either form (65 and 33 bytes), and was checked on the card first: one key agreement for R and one for [e]Q, a third ([d]G) where getW gives 33 bytes, and one point addition for [s]G - T; out holds the 64 bytes and nothing past them")
    void everySignatureIsCheckedAndStillVerifies() throws Exception {
        for (boolean compressed : new boolean[] { false, true }) {
            for (Object[] k : KEYS) {
                Object[] c = countedSigner();
                SchnorrHW s = (SchnorrHW) c[0];
                Counted ecdh = (Counted) c[1], gm = (Counted) c[2];
                byte[] w = hexToBytes((String) k[1]);
                byte[] m = msg(w[3]), out = untouched();
                ChipPublicKey pub = new ChipPublicKey(SchnorrHWSignTest.xy(w, 0), compressed);
                assertEquals(64, s.sign(SchnorrHWSignTest.keyOf((String) k[0]), pub, m, (short) 0, out, (short) 8));
                assertTrue(schnorrVerify(xOf(w), m, Arrays.copyOfRange(out, 8, 72)), "verifies: d = " + k[0] + (compressed ? ", getW 33" : ", getW 65"));
                assertArrayEquals(Arrays.copyOf(untouched(), 8), Arrays.copyOf(out, 8), "nothing before it");
                assertArrayEquals(Arrays.copyOfRange(untouched(), 72, 96), Arrays.copyOfRange(out, 72, 96), "nothing after it");
                assertEquals(compressed ? 3 : 2, ecdh.answers.size(), "the key agreement: R, [e]Q" + (compressed ? " and [d]G" : ""));
                assertEquals(1, gm.answers.size(), "the point addition: [s]G - T");
                // the check's R' is R, and the T it added is [e]Q negated
                byte[] r = ecdh.answers.get(0), rCheck = gm.answers.get(0);
                assertArrayEquals(Arrays.copyOfRange(out, 8, 40), xOf(rCheck), "R' has R's x");
                assertFalse(new BigInteger(1, Arrays.copyOfRange(rCheck, 33, 65)).testBit(0), "and an even Y");
                assertArrayEquals(xOf(r), xOf(rCheck), "the R of the nonce, whatever its parity");
                leftNothing(s, "after a signature");
            }
        }
    }

    // =========================================================================
    // (b) a key that does not agree: refused, nothing out
    // =========================================================================

    @Test
    @DisplayName("sign() refuses 6F00 a public key object that names another key than the private one, getW of 65 bytes or of 33, and a private key one bit off its public key (a bit of d flipped): the caller's buffer is as it was, byte for byte, the scratch and the work are zero, the key holds G's x, and the signer signs after it")
    void aKeyThatDoesNotAgreeIsRefused() throws Exception {
        SchnorrHW s = signer();
        for (boolean compressed : new boolean[] { false, true }) {
            for (int i = 0; i < KEYS.length; i++) {
                final int at = i;
                Object[] mine = KEYS[i], other = KEYS[(i + 1) % KEYS.length];
                ECPublicKey wrong = new ChipPublicKey(SchnorrHWSignTest.xy(hexToBytes((String) other[1]), 0), compressed);
                byte[] out = untouched();
                String what = "d = " + mine[0] + " under the key of " + other[0] + (compressed ? ", getW 33" : ", getW 65");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR, refusal(() -> s.sign(SchnorrHWSignTest.keyOf((String) mine[0]), wrong, msg(at), (short) 0, out, (short) 8)), what);
                assertArrayEquals(untouched(), out, what + ": out untouched");
                leftNothing(s, what);
                SchnorrHWSignTest.leftAtG(s, what);
            }
            // d one bit off: the private key's scalar flipped in its lowest bit, the public key the true one
            for (Object[] k : KEYS) {
                BigInteger d = new BigInteger((String) k[0], 16).flipBit(0);
                ECPublicKey pub = new ChipPublicKey(SchnorrHWSignTest.xy(hexToBytes((String) k[1]), 0), compressed);
                byte[] out = untouched();
                String what = "d = " + k[0] + " with its lowest bit flipped" + (compressed ? ", getW 33" : ", getW 65");
                assertEquals(CashuApplet.SW_CRYPTO_ERROR, refusal(() -> s.sign(SchnorrHWSignTest.keyOf(toHex(SchnorrHWSignTest.u32(d))), pub, msg(5), (short) 0, out, (short) 0)), what);
                assertArrayEquals(untouched(), out, what + ": out untouched");
                leftNothing(s, what);
            }
        }
        byte[] w = hexToBytes((String) KEYS[4][1]), out = new byte[64];
        s.sign(SchnorrHWSignTest.keyOf((String) KEYS[4][0]), SchnorrHWSignTest.pubOf((String) KEYS[4][1]), msg(9), (short) 0, out, (short) 0);
        assertTrue(schnorrVerify(xOf(w), msg(9), out), "and it signs after them");
    }

    @Test
    @DisplayName("A getW of 33 bytes is made whole by [d]G with the card's private key in the key agreement, never by a square root: the key agreement is asked for G under the private key; a getW of 65 bytes that does not begin 04, or of another length, is refused 6F00 before any signature is made")
    void aShortGetWIsMadeWholeByTheKeyAgreement() throws Exception {
        Object[] c = countedSigner();
        SchnorrHW s = (SchnorrHW) c[0];
        Counted ecdh = (Counted) c[1];
        Object[] k = KEYS[3];
        byte[] w = hexToBytes((String) k[1]);
        s.sign(SchnorrHWSignTest.keyOf((String) k[0]), new ChipPublicKey(SchnorrHWSignTest.xy(w, 0), true), msg(1), (short) 0, new byte[64], (short) 0);
        assertTrue(ecdh.answers.stream().anyMatch(a -> Arrays.equals(a, w)), "[d]G, the whole point, came of the key agreement");
        for (byte lead : new byte[] { 0x00, 0x06 }) {
            ChipPublicKey odd = new ChipPublicKey(SchnorrHWSignTest.xy(w, 0), false);
            odd.w65[0] = lead;
            byte[] out = untouched();
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, refusal(() -> s.sign(SchnorrHWSignTest.keyOf((String) k[0]), odd, msg(2), (short) 0, out, (short) 0)), "a lead byte of " + lead);
            assertArrayEquals(untouched(), out);
        }
    }

    // =========================================================================
    // (c) and (d) a date's key (D197)
    // =========================================================================

    /** t, then the 33-byte P + t*G: what a payment's `group` holds for the signer. */
    static byte[] dateKey(BigInteger d, BigInteger t, BigInteger tPoint) {
        return concat(SchnorrHWSignTest.u32(t), compressed(times(d.add(tPoint))));
    }

    @Test
    @DisplayName("Under a date's key (D197) sign() refuses 6F00, out untouched, a point at g + 32 that is not P + t*G (P + (t + 1)*G), and P + t*G with its parity byte the other one; the true point signs and verifies under x(P + t*G); getW of 65 bytes and of 33")
    void aDatesPointMustBePPlusTG() throws Exception {
        SchnorrHW s = signer();
        java.util.Random r = new java.util.Random(197);
        for (boolean compressed : new boolean[] { false, true }) {
            for (Object[] k : KEYS) {
                BigInteger d = new BigInteger((String) k[0], 16), t = new BigInteger(255, r).add(BigInteger.ONE);
                ECPublicKey pub = new ChipPublicKey(SchnorrHWSignTest.xy(hexToBytes((String) k[1]), 0), compressed);
                ECPrivateKey priv = SchnorrHWSignTest.keyOf((String) k[0]);
                byte[] good = dateKey(d, t, t), m = msg(t.intValue()), sig = new byte[64];
                s.sign(priv, pub, good, (short) 0, m, (short) 0, sig, (short) 0);
                assertTrue(schnorrVerify(Arrays.copyOfRange(good, 33, 65), m, sig), "verifies under P + t*G: d = " + k[0]);
                byte[] notIt = dateKey(d, t, t.add(BigInteger.ONE)), flipped = good.clone();
                flipped[32] ^= 1;
                for (byte[] g : new byte[][] { notIt, flipped }) {
                    byte[] out = untouched();
                    String what = (g == notIt ? "P + (t + 1)*G" : "P + t*G with the other parity") + ", d = " + k[0] + (compressed ? ", getW 33" : ", getW 65");
                    assertEquals(CashuApplet.SW_CRYPTO_ERROR, refusal(() -> s.sign(priv, pub, g, (short) 0, m, (short) 0, out, (short) 0)), what);
                    assertArrayEquals(untouched(), out, what + ": out untouched");
                    leftNothing(s, what);
                }
            }
        }
    }

    @Test
    @DisplayName("A date's key whose P + t*G has an odd Y, signed until the nonce's R has had an odd Y as well as an even one: every signature verifies under x(P + t*G), the check lifting both to an even Y")
    void anOddDateKeyAndAnOddRStillVerify() throws Exception {
        Object[] c = countedSigner();
        SchnorrHW s = (SchnorrHW) c[0];
        Counted ecdh = (Counted) c[1];
        Object[] k = KEYS[2];
        BigInteger d = new BigInteger((String) k[0], 16), t = BigInteger.ONE;
        while (!times(d.add(t))[1].testBit(0)) t = t.add(BigInteger.ONE);
        byte[] g = dateKey(d, t, t);
        assertEquals(3, g[32], "P + t*G has an odd Y");
        ECPublicKey pub = SchnorrHWSignTest.pubOf((String) k[1]);
        boolean oddR = false, evenR = false;
        for (int i = 0; i < 64 && !(oddR && evenR); i++) {
            ecdh.answers.clear();
            byte[] m = msg(i), sig = new byte[64];
            s.sign(SchnorrHWSignTest.keyOf((String) k[0]), pub, g, (short) 0, m, (short) 0, sig, (short) 0);
            assertTrue(schnorrVerify(Arrays.copyOfRange(g, 33, 65), m, sig), "signature " + i);
            boolean odd = (ecdh.answers.get(0)[64] & 1) == 1;
            oddR |= odd;
            evenR |= !odd;
        }
        assertTrue(oddR && evenR, "both parities of R were met");
    }

    // =========================================================================
    // (e) the waits' work
    // =========================================================================

    @Test
    @DisplayName("signatureWork is a signature's work as it was before the check: the same steps (one key agreement, R, and no point addition), 64 bytes written at out that are a signature, nothing past them, and the scratch and work zero after it; sign() over the same key is the same work and the check (two key agreements and a point addition more where getW is 65 bytes)")
    void theWaitsKeepTheirWork() throws Exception {
        Object[] c = countedSigner();
        SchnorrHW s = (SchnorrHW) c[0];
        Counted ecdh = (Counted) c[1], gm = (Counted) c[2];
        Object[] k = KEYS[5];
        byte[] w = hexToBytes((String) k[1]), m = msg(3), out = untouched();
        ChipPublicKey pub = new ChipPublicKey(SchnorrHWSignTest.xy(w, 0), false);
        assertEquals(64, s.signatureWork(SchnorrHWSignTest.keyOf((String) k[0]), pub, m, (short) 0, out, (short) 0));
        assertEquals(1, ecdh.answers.size(), "R and nothing else");
        assertEquals(0, gm.answers.size(), "no check");
        assertTrue(schnorrVerify(xOf(w), m, Arrays.copyOf(out, 64)), "a signature's work: the 64 bytes are a signature");
        assertArrayEquals(Arrays.copyOfRange(untouched(), 64, 96), Arrays.copyOfRange(out, 64, 96), "nothing written past the 64 bytes its caller clears");
        leftNothing(s, "after the work");
        SchnorrHWSignTest.leftAtG(s, "after the work");
        // with a key that does not agree the work is done all the same, and refused nothing: it is never sent
        ChipPublicKey other = new ChipPublicKey(SchnorrHWSignTest.xy(hexToBytes((String) KEYS[0][1]), 0), false);
        assertEquals(64, s.signatureWork(SchnorrHWSignTest.keyOf((String) k[0]), other, m, (short) 0, new byte[64], (short) 0), "the work is not checked");
        ecdh.answers.clear();
        gm.answers.clear();
        s.sign(SchnorrHWSignTest.keyOf((String) k[0]), pub, m, (short) 0, new byte[64], (short) 0);
        assertEquals(2, ecdh.answers.size());
        assertEquals(1, gm.answers.size());
    }

    @Test
    @DisplayName("In the applet the waits (work: a payment's, the PIN's, a held tap's) are signatureWork, cleared after it, and every signature that leaves the card is sign(): AUTH, a payment's (SIG_ALL), the settlement record's descriptor and the PIN key's signature")
    void theAppletSignsWithTheCheckAndWaitsWithout() throws Exception {
        String code = appletCode();
        String work = body(code, "private void work(", "private void requireOwnerPoint(");
        assertTrue(work.contains("schnorrHW.signatureWork(cardPrivKey, cardPubKey, scratch, X_MSG, buf, (short) 0);"), "the waits do the work with no check");
        assertTrue(work.contains("Util.arrayFillNonAtomic(buf, (short) 0, (short) 64, (byte) 0);"), "and clear it");
        assertEquals(1, code.split("schnorrHW\\.signatureWork\\(", -1).length - 1, "work() and nothing else");
        for (String site : new String[] {
                "schnorrHW.sign(cardPrivKey, cardPubKey, scratch, X_MSG, buf, AUTH_NONCE_LEN);",
                "schnorrHW.sign(cardPrivKey, cardPubKey, group, (short) 0, scratch, X_MSG, buf, (short) 1);",
                "schnorrHW.sign(cardPrivKey, cardPubKey, buf, (short) 68, scratch, X_MSG, buf, (short) 0);",
                "schnorrHW.sign(cardPrivKey, cardPubKey, scratch, X_MSG, buf, sigAt);" }) {
            assertEquals(1, code.split(java.util.regex.Pattern.quote(site), -1).length - 1, site);
        }
        assertEquals(4, code.split("schnorrHW\\.sign\\(", -1).length - 1, "four signatures leave the card, each by sign()");
    }

    // =========================================================================
    // A signature refused in the applet: what the card is left as
    // =========================================================================

    /** The card's public key object replaced by one that names another key (d = 3): every signature the card makes is refused. */
    static Object wrongKey(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("cardPubKey");
        f.setAccessible(true);
        Object was = f.get(c.applet());
        f.set(c.applet(), new ChipPublicKey(SchnorrHWSignTest.xy(hexToBytes((String) KEYS[0][1]), 0), false));
        return was;
    }

    static void putBack(UnitsTest.Card c, Object key) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("cardPubKey");
        f.setAccessible(true);
        f.set(c.applet(), key);
    }

    @Test
    @DisplayName("A signature the card's check refuses, in the applet: AUTH answers 6F00 with no data; a payment's SPEND_ALL_SIGN answers 6F00 after its waits with nothing burned, counted, logged or kept (the places unspent, burnPending 0, the last signature and SPEND_ALL_AGAIN as they were), the payment given up (6985 to SIGN again); and once the key agrees again the same places are paid")
    void aRefusedSignatureLeavesTheCardAsItWas() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int a = c.put(-1, KEYSET, 16), b = c.put(-1, KEYSET, 32);
        assertEquals(64, c.pay(a).getData().length, "a first payment, whose signature SPEND_ALL_AGAIN keeps");
        byte[] again = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)).getData();
        assertEquals(64, again.length);
        c.tap();
        Object key = wrongKey(c);

        ResponseAPDU auth = c.send(new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 80));
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, auth.getSW(), "AUTH");
        assertEquals(0, auth.getData().length, "and nothing with it");

        Map<String, byte[]> before = c.snapshot();
        byte[] lastSig = c.field("lastSig").clone(), paid = c.field("paid").clone();
        ResponseAPDU refused = c.pay(b);
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, refused.getSW(), "the payment's signature");
        assertEquals(0, refused.getData().length);
        assertTrue(c.waits > 0, "after the waits, which are work and were not refused");
        c.assertUnchanged(before, "a refused signature");
        assertArrayEquals(lastSig, c.field("lastSig"), "no signature kept");
        assertArrayEquals(paid, c.field("paid"), "nothing on the paid list");
        assertEquals(0, c.field("burnPending")[0], "nothing burned");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment was given up");
        assertArrayEquals(again, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)).getData(), "SPEND_ALL_AGAIN gives the last payment's signature, as before");

        putBack(c, key);
        c.tap();
        assertEquals(64, c.pay(b).getData().length, "the same place paid once the key agrees");
    }

    @Test
    @DisplayName("GET_NONCE P1 = 1, whose PIN key signature is made at the first asking and kept: refused 6F00 with nothing kept (pinKeySig's flag 0) and no nonce live; once the key agrees it signs and keeps it")
    void aRefusedPinKeySignatureIsNotKept() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        Object key = wrongKey(c);
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, c.sw(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)));
        assertEquals(0, c.field("pinKeySig")[0], "nothing kept");
        assertEquals(0, c.field("nonceLive")[0], "and no nonce given");
        putBack(c, key);
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_OK, r.getSW());
        assertEquals(1, c.field("pinKeySig")[0], "kept once signed");
        assertNotNull(r.getData());
    }
}
