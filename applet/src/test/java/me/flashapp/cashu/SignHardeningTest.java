package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.*;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import javacard.framework.ISOException;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.KeyBuilder;
import javacardx.crypto.Cipher;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The review's findings on the signature's path, made permanent. D217 the product of e and d is never given to the chip's
 * RSA as a function of d alone (a fresh random split of d, four squarings); D218 every signature is checked on the card against
 * the key before it leaves (a failing chip path is given up and redone by the bytecode, and a signature that fails then is not
 * released); D219 the set-up's known answers ask the engines for distinct operands at full width; and a sign-time engine failure
 * falls back and clears chipMul. Each test failed on the 7d760e5 file first (see the fix-24 report).
 */
class SignHardeningTest {
    @BeforeEach void floor() { useTheTestFloor(); }
    @AfterAll static void built() { useFloor(BUILT_FLOOR); }

    static ECPrivateKey ecPriv(byte[] d) {
        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        CashuApplet.curve(priv); priv.setS(d, (short) 0, (short) 32); return priv;
    }
    static ECPublicKey ecPub(byte[] w) {
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        CashuApplet.curve(pub); pub.setW(w, (short) 0, (short) 65); return pub;
    }

    /** An engine that records every input and can fault the k-th squaring after the call counter is zeroed. */
    static class Rec extends Engine {
        final List<BigInteger> ins = new ArrayList<>();
        int call = 0, faultAt = -1, flipInBit = -1, flipOutBit = -1, throwAt = -1;
        Rec() { super(null); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
            ins.add(new BigInteger(1, Arrays.copyOfRange(a, o, o + l)));
            if (call == throwAt) javacard.security.CryptoException.throwIt(javacard.security.CryptoException.ILLEGAL_VALUE);
            if (call == faultAt && flipInBit >= 0) a[o + 63 - flipInBit / 8] ^= (byte) (1 << (flipInBit % 8));
            call++;
            short r = super.doFinal(a, o, l, out, oo);
            if (call - 1 == faultAt && flipOutBit >= 0) out[oo + 63 - flipOutBit / 8] ^= (byte) (1 << (flipOutBit % 8));
            return r;
        }
    }

    static javacard.security.RandomData fixedRng() {
        return new javacard.security.RandomData() {
            @Override public void generateData(byte[] b, short o, short l) { for (short i = 0; i < l; i++) b[(short)(o + i)] = (byte) (i + 1); }
            @Override public short nextBytes(byte[] b, short o, short l) { generateData(b, o, l); return (short)(o + l); }
            @Override public void setSeed(byte[] b, short o, short l) { }
            @Override public byte getAlgorithm() { return ALG_SECURE_RANDOM; }
        };
    }

    static BigInteger challenge(byte[] rx, byte[] px, byte[] msg) throws Exception {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
        byte[] tag = md.digest("BIP0340/challenge".getBytes());
        md.reset(); md.update(tag); md.update(tag); md.update(rx); md.update(px); md.update(msg);
        return new BigInteger(1, md.digest()).mod(N);
    }

    static SchnorrHW chipSigner(Rec eng) throws Exception {
        SchnorrHW s = signerWith(eng);
        assertTrue(s.chipMulInit());
        s.chipMul = true;
        eng.ins.clear(); eng.call = 0;
        return s;
    }

    // ---- MEDIUM-1: d is never alone in the engine ----

    @Test
    @DisplayName("D217: no operand the RSA engine is given is a function of d alone: with e public (it is the signature's own challenge), none of the four inputs of a signature, 25 signatures under random keys, gives d, n - d, or any of e + d, e - d, d - e, e + (n - d) (what the masks of D216 gave: u = e + d and v = |e - d|), and the same key and message sign with other inputs each time")
    void theEngineNeverSeesDAlone() throws Exception {
        Random rnd = new Random(24);
        for (int i = 0; i < 25; i++) {
            BigInteger d = new BigInteger(255, rnd).add(BigInteger.ONE);
            BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
            byte[] msg = new byte[32]; rnd.nextBytes(msg);
            Rec eng = new Rec();
            SchnorrHW s = chipSigner(eng);
            byte[] sig = new byte[64];
            assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig));
            assertEquals(4, eng.ins.size(), "four squarings: two products of two");
            BigInteger e = challenge(Arrays.copyOfRange(sig, 0, 32), be(pt[0]), msg);
            for (BigInteger x : eng.ins) {
                for (BigInteger dd : new BigInteger[] { d, N.subtract(d) }) {
                    assertNotEquals(dd, x.mod(N));
                    assertNotEquals(dd, x.subtract(e).mod(N), "the input minus e is d");
                    assertNotEquals(dd, e.subtract(x).mod(N), "e minus the input is d");
                    assertNotEquals(dd, x.add(e).mod(N), "the input plus e is d");
                }
            }
            List<BigInteger> first = new ArrayList<>(eng.ins);
            eng.ins.clear();
            s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, new byte[64], (short) 0);
            assertNotEquals(first, eng.ins, "a fresh split each signature");
        }
    }

    @Test
    @DisplayName("D217: the shares are zeroed on every way out: after a signature, after one whose engine refuses, and after one whose engine is faulted, sc and work hold nothing (the shares sat in them)")
    void theSharesAreClearedOnEveryWayOut() throws Exception {
        BigInteger d = BigInteger.valueOf(0xC0FFEE).shiftLeft(100).add(BigInteger.valueOf(5));
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32];
        for (String how : new String[] { "ok", "refuse-late", "fault" }) {
            Rec eng = new Rec();
            SchnorrHW s = chipSigner(eng);
            if (how.equals("fault")) { eng.faultAt = 2; eng.flipOutBit = 9; }
            if (how.equals("refuse-late")) eng.throwAt = 2;
            byte[] sig = new byte[64];
            assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0), how);
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), how);
            assertTrue(isZero(get(s, SchnorrHW.class, "work"), 0), "work: " + how);
            assertTrue(isZero(get(s, SchnorrHW.class, "sc"), 0), "sc: " + how);
        }
    }

    // ---- MEDIUM-2 and -3: every signature is checked, none unchecked leaves ----

    @Test
    @DisplayName("D218: a fault in any one of the four squarings, in its input or its output, in 8 bit places each, never lets a bad signature leave: the card withholds it and signs again by the bytecode, the answer verifies, and chipMul is cleared")
    void aFaultedSquaringReleasesNoBadSignature() throws Exception {
        BigInteger d = new BigInteger("123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32]; Arrays.fill(msg, (byte) 9);
        int[] bits = { 0, 1, 17, 100, 128, 200, 254, 255 };
        for (int at = 0; at < 4; at++) for (boolean input : new boolean[] { false, true }) for (int bit : bits) {
            Rec eng = new Rec();
            SchnorrHW s = chipSigner(eng);
            eng.faultAt = at;
            if (input) eng.flipInBit = bit; else eng.flipOutBit = bit;
            byte[] sig = new byte[64];
            assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "squaring " + at + (input ? " input" : " output") + " bit " + bit);
            assertFalse(flag(s, SchnorrHW.class, "chipMul"), "the chip's path is given up");
        }
    }

    @Test
    @DisplayName("D218: a fault in a squaring's input with the randomness stuck (the same nonce twice) gives no bad signature and no d: both signatures verify, and the attack of the review (the difference of the two, 256 bit places and both signs) finds nothing")
    void aFaultAndARepeatedNonceGiveNothing() throws Exception {
        BigInteger d = new BigInteger("0badc0ffee0ddf00d123456789abcdef0123456789abcdef0123456789abcd", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32]; Arrays.fill(msg, (byte) 0x42);
        byte[][] sigs = new byte[2][];
        for (int how = 0; how < 2; how++) {
            Rec eng = new Rec();
            SchnorrHW s = chipSigner(eng);
            set(s, SchnorrHW.class, "rng", fixedRng());
            eng.faultAt = how == 1 ? 0 : -1; eng.flipInBit = 100;
            sigs[how] = new byte[64];
            s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sigs[how], (short) 0);
            assertTrue(schnorrVerify(be(pt[0]), msg, sigs[how]), "signature " + how);
        }
        byte[] rx = Arrays.copyOfRange(sigs[0], 0, 32);
        BigInteger s0 = new BigInteger(1, Arrays.copyOfRange(sigs[0], 32, 64)), s1 = new BigInteger(1, Arrays.copyOfRange(sigs[1], 32, 64));
        BigInteger e = challenge(rx, be(pt[0]), msg);
        BigInteger delta = s1.subtract(s0).mod(N);
        for (int i = 0; i < 256; i++) for (int sg = -1; sg <= 1; sg += 2) {
            BigInteger den = BigInteger.TWO.pow(i + 1).multiply(BigInteger.valueOf(sg)).mod(N);
            BigInteger num = delta.shiftLeft(2).subtract(BigInteger.ONE.shiftLeft(2 * i)).mod(N);
            BigInteger u = num.multiply(den.modInverse(N)).mod(N);
            BigInteger de = u.subtract(e).mod(N);
            if (de.signum() == 0) continue;
            assertNotEquals(pt[0], ecMulTest(de, SECP_GX, SECP_GY)[0], "d recovered at bit " + i);
        }
    }

    @Test
    @DisplayName("D218: a signature that cannot be shown to be the key's is not released, on either path: a private key whose public key is another's gives 6F00 with the output zeroed (bytecode path), and the chip path is given up first and ends the same way")
    void aSignatureNotTheKeysIsWithheld() throws Exception {
        BigInteger d = BigInteger.valueOf(0xCAFEBABEL), other = BigInteger.valueOf(0xDEADBEEFL);
        BigInteger[] wrong = ecMulTest(other, SECP_GX, SECP_GY);
        byte[] msg = new byte[32];
        for (boolean chip : new boolean[] { false, true }) {
            Rec eng = new Rec();
            SchnorrHW s = signerWith(eng);
            assertTrue(s.chipMulInit());
            s.chipMul = chip;
            byte[] sig = new byte[64];
            Arrays.fill(sig, (byte) 0x55);
            ISOException t = assertThrows(ISOException.class, () -> s.sign(ecPriv(be(d)), ecPub(point65(wrong)), msg, (short) 0, sig, (short) 0));
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, t.getReason());
            assertArrayEquals(new byte[64], sig, "nothing of a signature is left in the output");
            assertFalse(flag(s, SchnorrHW.class, "chipMul"));
            assertTrue(isZero(get(s, SchnorrHW.class, "work"), 0));
            assertTrue(isZero(get(s, SchnorrHW.class, "sc"), 0));
        }
    }

    @Test
    @DisplayName("D218: the check is the engines' and costs a bounded number of them: one signature is three runs of the chip's key agreement (the nonce's R, P and -e*P) and one of its point addition (s*G - e*P)")
    void theCheckCostsFourEngineRuns() throws Exception {
        BigInteger d = BigInteger.valueOf(0x1234567L);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32];
        SchnorrHW s = new SchnorrHW();
        s.init();
        javacard.security.KeyAgreement ecdh = (javacard.security.KeyAgreement) get(s, SchnorrHW.class, "ecdh"), gm = (javacard.security.KeyAgreement) get(s, SchnorrHW.class, "gm");
        PerPaymentKeyTest.CountingAgreement c1 = new PerPaymentKeyTest.CountingAgreement(ecdh), c2 = new PerPaymentKeyTest.CountingAgreement(gm);
        set(s, SchnorrHW.class, "ecdh", c1);
        set(s, SchnorrHW.class, "gm", c2);
        byte[] sig = new byte[64];
        s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0);
        assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        assertEquals(3, c1.made, "R = k*G, P = d*G and -e*P");
        assertEquals(1, c2.made, "s*G - e*P");
    }

    // ---- LOW-4, -5: the known answers ----

    @Test
    @DisplayName("D219: the squaring's known answers ask the engine for distinct squarings (3, n - 1, and the sum and the difference of each of three pairs: eight in all, no two the same), and most of them of the full width, at or above 2^255 and under n")
    void theSquaringKnownAnswersAreDistinctAndWide() throws Exception {
        Rec eng = new Rec();
        SchnorrHW s = signerWith(eng);
        assertTrue(s.chipMulInit());
        assertEquals(8, eng.ins.size(), "two squarings and three products' pairs");
        assertEquals(eng.ins.size(), new java.util.HashSet<>(eng.ins).size(), "no squaring asked twice");
        long wide = eng.ins.stream().filter(x -> x.testBit(255) && x.compareTo(N) < 0).count();
        assertTrue(wide >= 4, "full-width operands: " + wide);
        assertEquals(0, eng.garbage);
    }

    @Test
    @DisplayName("D219: an engine wrong for one of the new pairs' operands alone (the sum of G's y and n less G's x, which D216's test never asked for) fails the set-up: chipMul false")
    void anEngineWrongOnTheSecondPairIsRefused() throws Exception {
        BigInteger bad = GY.add(N.subtract(GX)).mod(N);
        Engine eng = new Engine(null) {
            @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
                BigInteger x = new BigInteger(1, Arrays.copyOfRange(a, o, o + l));
                short n = super.doFinal(a, o, l, out, oo);
                if (key != null && x.equals(bad)) out[oo + 63] ^= 2;
                return n;
            }
        };
        assertFalse(signerWith(eng).chipMulInit());
    }

    @Test
    @DisplayName("D219: the field's known answers (D214) reach the top of the range: p - 1 and p - 2 (above 2^255 and under p) are cubed, taken by Euler's test and rooted, so an engine wrong for every x of 2^255 and over (which the old answers, all of them with the top bit clear, passed) leaves fieldP false, the change right on the p*p keys; and an engine that holds is taken")
    void theFieldKnownAnswersReachTheTop() throws Exception {
        for (boolean wrongHigh : new boolean[] { true, false }) {
            Engines e = new Engines();
            UnitsTest.Card c = unsetCard(e);
            Object applet = c.applet();
            List<BigInteger> seen = new ArrayList<>();
            set(applet, CashuApplet.class, "rsa", new Engine((Cipher) get(applet, CashuApplet.class, "rsa")) {
                @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
                    BigInteger x = new BigInteger(1, Arrays.copyOfRange(a, o, o + l));
                    if (key != null) seen.add(x);
                    short r = super.doFinal(a, o, l, out, oo);
                    if (wrongHigh && key != null && x.testBit(255)) out[oo + 63] ^= 1;
                    return r;
                }
            });
            c.ready(UnitsTest.SAT, true);
            assertEquals(!wrongHigh, flag(applet, CashuApplet.class, "fieldP"), wrongHigh ? "wrong from 2^255 up: not leaned on" : "an engine that holds is taken");
            assertTrue(seen.contains(P.subtract(BigInteger.ONE)), "p - 1 was asked");
            if (!wrongHigh) assertTrue(seen.contains(P.subtract(BigInteger.TWO)), "and p - 2");
            c.grant();
            changeIsRight(c, 3);
        }
    }

    // ---- LOW-6: a sign-time failure falls back ----

    @Test
    @DisplayName("D217/D218: an engine that refuses after the set-up (chipMul true) does not stop signing: the signature is made by the bytecode, verifies, chipMul is cleared, and the next signature is the bytecode's with no asking of the engine")
    void aSignTimeEngineFailureFallsBack() throws Exception {
        Rec eng = new Rec();
        SchnorrHW s = chipSigner(eng);
        eng.refuse = true;
        BigInteger d = BigInteger.valueOf(0xCAFEBABEL);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32], sig = new byte[64];
        assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        assertFalse(flag(s, SchnorrHW.class, "chipMul"));
        eng.refuse = false;
        eng.powers = 0;
        assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        assertEquals(0, eng.powers);
        assertTrue(isZero(get(s, SchnorrHW.class, "work"), 0));
        assertTrue(isZero(get(s, SchnorrHW.class, "sc"), 0));
    }
}
