package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.security.MessageDigest;
import javacard.security.RandomData;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D257: a count that never comes again mixed into BIP-340's aux (the red team's recommended fix for C-f7bdac4-1), so that a
 * generator that is stuck never gives two signings one nonce. jCardSim only: the persistent write's time (one a time in the
 * field) is the chip run's to measure.
 */
class CountedAuxTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger D = new BigInteger("2B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFE", 16);
    static final BigInteger[] PT = ecMulTest(D, SECP_GX, SECP_GY);

    /** A signer of its own with the count, as the applet gives it, and a generator that is stuck. */
    static SchnorrHW counted(boolean chip, byte[] steps, byte[] here) throws Exception {
        SchnorrHW s = chip ? SignHardeningTest.chipSigner(new SignHardeningTest.Rec()) : new SchnorrHW();
        if (!chip) s.init();
        SchnorrHWSignTest.setHidden(s, "rng", SignHardeningTest.fixedRng());
        s.counted(steps, here);
        return s;
    }
    static byte[] sign(SchnorrHW s, byte[] msg) throws Exception {
        byte[] sig = new byte[64];
        assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(D)), SignHardeningTest.ecPub(point65(PT)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(PT[0]), msg, sig));
        return sig;
    }

    @Test
    @DisplayName("D257: with the generator stuck, 600 signings of one message (across two cut powers, past two wraps of the RAM count) have 600 different R; the persistent count is stepped once a time in the field and once each 255 signings after the first, never run back; with no count (a signer of its own, as BIP-340's vectors have it) the stuck generator gives one R every time")
    void aStuckGeneratorNeverGivesOneNonceTwice() throws Exception {
        for (boolean chip : new boolean[] { false, true }) {
            byte[] steps = new byte[4], here = new byte[1];
            SchnorrHW s = counted(chip, steps, here);
            byte[] msg = new byte[32];
            msg[0] = 0x42;
            Set<String> rs = new HashSet<>();
            long last = -1;
            for (int i = 0; i < 600; i++) {
                if (i == 100 || i == 400) here[0] = 0;               // the power cut: the RAM count gone
                byte[] sig = sign(s, msg);
                rs.add(toHex(Arrays.copyOf(sig, 32)));
                long now = new BigInteger(1, steps).longValue();
                assertTrue(now >= last, "never run back");
                last = now;
            }
            assertEquals(600, rs.size(), (chip ? "the chip's path" : "the bytecode's path") + ": every R its own");
            // the steps: the first signing, each 255 after it in one time in the field, and the first after each power cut
            // (0..99: 1 step; 100..399: steps at 100, 355; 400..599: steps at 400): 4 in all, on the chip's path also its
            // chipMulInit-free signer the same (one signing a sign() there)
            assertEquals(4, new BigInteger(1, steps).intValue(), "four steps for 600 signings across two power cuts");
        }
        SchnorrHW bare = new SchnorrHW();
        bare.init();
        SchnorrHWSignTest.setHidden(bare, "rng", SignHardeningTest.fixedRng());
        byte[] msg = new byte[32];
        assertArrayEquals(Arrays.copyOf(sign(bare, msg), 32), Arrays.copyOf(sign(bare, msg), 32), "no count: one R, as BIP-340 with one aux");
    }

    @Test
    @DisplayName("D257: the aux is the generator's 32 bytes with the count XORed into its last five (the persistent four, then the RAM one), so that a test vector of a given aux is had again by giving the generator that aux XOR the count: BIP-340's own signing of the aux that comes out, worked here by BigInteger, is the card's signature byte for byte")
    void theCountIsXoredIntoTheAux() throws Exception {
        byte[] steps = { 0, 0, 1, 2 }, here = new byte[1];
        SchnorrHW s = new SchnorrHW();
        s.init();
        s.counted(steps, here);
        byte[] gen = new byte[32];
        for (int i = 0; i < 32; i++) gen[i] = (byte) (0xA0 + i);
        SchnorrHWSignTest.setHidden(s, "rng", new RandomData() {
            @Override public void generateData(byte[] b, short o, short l) { System.arraycopy(gen, 0, b, o, l); }
            @Override public short nextBytes(byte[] b, short o, short l) { generateData(b, o, l); return (short) (o + l); }
            @Override public void setSeed(byte[] b, short o, short l) { }
            @Override public byte getAlgorithm() { return ALG_SECURE_RANDOM; }
        });
        byte[] msg = sha256("D257".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] sig = sign(s, msg);
        // the first signing of the time in the field: steps 0x00000102 stepped to 0x00000103, the RAM count 1
        assertArrayEquals(new byte[] { 0, 0, 1, 3 }, steps);
        assertEquals(2, here[0], "and the RAM count stepped past the one used");
        byte[] aux = gen.clone();
        aux[27] ^= 0; aux[28] ^= 0; aux[29] ^= 1; aux[30] ^= 3; aux[31] ^= 1;
        assertArrayEquals(bip340(D, msg, aux), sig, "BIP-340's signature of that aux");
    }

    /** BIP-340's Sign(sk, m, a), by BigInteger. */
    static byte[] bip340(BigInteger sk, byte[] m, byte[] a) throws Exception {
        BigInteger n = N;
        BigInteger[] p = ecMulTest(sk, SECP_GX, SECP_GY);
        BigInteger d = p[1].testBit(0) ? n.subtract(sk) : sk;
        byte[] t = xor(be(d), tagged("BIP0340/aux", a));
        BigInteger k0 = new BigInteger(1, tagged("BIP0340/nonce", concat(t, be(p[0]), m))).mod(n);
        BigInteger[] r = ecMulTest(k0, SECP_GX, SECP_GY);
        BigInteger k = r[1].testBit(0) ? n.subtract(k0) : k0;
        BigInteger e = new BigInteger(1, tagged("BIP0340/challenge", concat(be(r[0]), be(p[0]), m))).mod(n);
        return concat(be(r[0]), be(k.add(e.multiply(d)).mod(n)));
    }
    static byte[] tagged(String tag, byte[] m) {
        byte[] h = sha256(tag.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return sha256(concat(h, h, m));
    }
    static byte[] xor(byte[] a, byte[] b) {
        byte[] o = new byte[a.length];
        for (int i = 0; i < a.length; i++) o[i] = (byte) (a[i] ^ b[i]);
        return o;
    }

    @Test
    @DisplayName("D257: the red team's nonce fault (a stuck generator, and one bit of k flipped as step 3's hash answers, before R = kG) no longer gives the key, on either path: the faulted signature verifies, as before, but the good one of the same message has another nonce, and the attacker's search finds no d")
    void theNonceFaultGivesNoKey() throws Exception {
        for (boolean chip : new boolean[] { false, true }) {
            SchnorrHW s = counted(chip, new byte[4], new byte[1]);
            FlipDigest f = new FlipDigest((MessageDigest) SchnorrHWSignTest.hidden(s, "sha256"));
            SchnorrHWSignTest.setHidden(s, "sha256", f);
            byte[] msg = new byte[32];
            msg[0] = 0x42;
            byte[] sig1 = sign(s, msg);
            f.armed = true;
            byte[] sig2 = sign(s, msg);
            assertNull(recover(sig1, sig2, msg, 255 - f.bit), (chip ? "the chip's path" : "the bytecode's path") + ": no key from the two");
        }
    }

    @Test
    @DisplayName("D257: the red team's first message fault (a stuck generator, and the caller's message flipped at step 4) gives no two signatures of one R with the count, on either path, whatever the check reads")
    void theMessageFaultGivesNoSecondR() throws Exception {
        for (boolean chip : new boolean[] { false, true }) {
            SchnorrHW s = counted(chip, new byte[4], new byte[1]);
            FlipMessageAtR ka = new FlipMessageAtR((javacard.security.KeyAgreement) SchnorrHWSignTest.hidden(s, "ecdh"));
            SchnorrHWSignTest.setHidden(s, "ecdh", ka);
            byte[] msg = new byte[32];
            msg[0] = 0x42;
            byte[] good = sign(s, msg);
            ka.msg = msg;
            ka.armed = true;
            byte[] second = new byte[64];
            try {
                if (s.sign(SignHardeningTest.ecPriv(be(D)), SignHardeningTest.ecPub(point65(PT)), msg, (short) 0, second, (short) 0) == 64)
                    assertFalse(Arrays.equals(Arrays.copyOf(good, 32), Arrays.copyOf(second, 32)), "another R");
            } catch (ISOException x) {
                assertEquals(CashuApplet.SW_CRYPTO_ERROR, x.getReason());
            }
        }
    }

    /** The signer's key agreement, flipping one bit of `msg` at its first answer once armed (step 4: R = kG). */
    static final class FlipMessageAtR extends javacard.security.KeyAgreement {
        final javacard.security.KeyAgreement real;
        byte[] msg;
        boolean armed;
        int calls;
        FlipMessageAtR(javacard.security.KeyAgreement real) { this.real = real; }
        @Override public void init(javacard.security.PrivateKey k) { real.init(k); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] pub, short off, short len, byte[] out, short outOff) {
            if (armed && calls++ == 0) msg[5] ^= 0x01;
            return real.generateSecret(pub, off, len, out, outOff);
        }
    }

    /** The signer's SHA-256, one bit of the answer of its second doFinal flipped once armed (step 3: the nonce's hash). */
    static final class FlipDigest extends MessageDigest {
        final MessageDigest real;
        boolean armed;
        int calls;
        final int bit = 8 * 31 + 3;
        FlipDigest(MessageDigest real) { this.real = real; }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public byte getLength() { return real.getLength(); }
        @Override public void update(byte[] b, short o, short l) { real.update(b, o, l); }
        @Override public void reset() { real.reset(); }
        @Override public short doFinal(byte[] b, short o, short l, byte[] out, short oo) {
            short r = real.doFinal(b, o, l, out, oo);
            if (armed && ++calls == 2) out[oo + bit / 8] ^= (byte) (1 << (7 - bit % 8));
            return r;
        }
    }

    /** The red team's search: d from two signatures of one message whose nonces differ by +-2^shift (with BIP-340's negations), or null. */
    static BigInteger recover(byte[] sig1, byte[] sig2, byte[] msg, int shift) throws Exception {
        BigInteger e1 = SignHardeningTest.challenge(Arrays.copyOf(sig1, 32), be(PT[0]), msg);
        BigInteger e2 = SignHardeningTest.challenge(Arrays.copyOf(sig2, 32), be(PT[0]), msg);
        BigInteger s1 = new BigInteger(1, Arrays.copyOfRange(sig1, 32, 64)), s2 = new BigInteger(1, Arrays.copyOfRange(sig2, 32, 64));
        BigInteger delta = BigInteger.ONE.shiftLeft(shift);
        for (int b = -1; b <= 1; b += 2) for (int c = -1; c <= 1; c += 2) {
            BigInteger num = s2.subtract(s1.multiply(BigInteger.valueOf(c))).subtract(delta.multiply(BigInteger.valueOf(b)));
            BigInteger den = e2.subtract(e1.multiply(BigInteger.valueOf(c))).mod(N);
            if (den.signum() == 0) continue;
            BigInteger cand = num.multiply(den.modInverse(N)).mod(N);
            if (ecMulTest(cand, SECP_GX, SECP_GY)[0].equals(PT[0])) return cand;
        }
        return null;
    }

    @Test
    @DisplayName("D257: the search above finds the key where the count is not given (the red team's proof, on a signer of its own): the test can say yes")
    void theSearchFindsTheKeyWithNoCount() throws Exception {
        SchnorrHW s = new SchnorrHW();
        s.init();
        SchnorrHWSignTest.setHidden(s, "rng", SignHardeningTest.fixedRng());
        FlipDigest f = new FlipDigest((MessageDigest) SchnorrHWSignTest.hidden(s, "sha256"));
        SchnorrHWSignTest.setHidden(s, "sha256", f);
        byte[] msg = new byte[32];
        msg[0] = 0x42;
        byte[] sig1 = sign(s, msg);
        f.armed = true;
        byte[] sig2 = sign(s, msg);
        BigInteger d = recover(sig1, sig2, msg, 255 - f.bit);
        assertTrue(D.equals(d) || N.subtract(D).equals(d), "the key, with no count");
    }

    @Test
    @DisplayName("D257: the step is written before it is used, and never in a transaction: a signing whose generator fails after the step leaves the count stepped (a tear there the same); the next time in the field steps it again, so no count of a cut signing comes back; a signing asked inside a transaction is refused 6F00 with the count as it was")
    void theCountIsSteppedBeforeUseAndNeverInATransaction() throws Exception {
        byte[] steps = new byte[4], here = new byte[1];
        SchnorrHW s = new SchnorrHW();
        s.init();
        s.counted(steps, here);
        RandomData fails = new RandomData() {
            @Override public void generateData(byte[] b, short o, short l) { throw new RuntimeException("the field cut"); }
            @Override public short nextBytes(byte[] b, short o, short l) { generateData(b, o, l); return (short) (o + l); }
            @Override public void setSeed(byte[] b, short o, short l) { }
            @Override public byte getAlgorithm() { return ALG_SECURE_RANDOM; }
        };
        RandomData real = (RandomData) SchnorrHWSignTest.hidden(s, "rng");
        SchnorrHWSignTest.setHidden(s, "rng", fails);
        byte[] msg = new byte[32], sig = new byte[64];
        assertThrows(RuntimeException.class, () -> s.sign(SignHardeningTest.ecPriv(be(D)), SignHardeningTest.ecPub(point65(PT)), msg, (short) 0, sig, (short) 0));
        assertArrayEquals(new byte[] { 0, 0, 0, 1 }, steps, "stepped before the aux was drawn");
        here[0] = 0;                                                     // the power cut
        SchnorrHWSignTest.setHidden(s, "rng", real);
        sign(s, msg);
        assertArrayEquals(new byte[] { 0, 0, 0, 2 }, steps, "the next time in the field steps it again: 1 is never used with a count of its own");
        here[0] = 0;
        JCSystem.beginTransaction();
        try {
            ISOException x = assertThrows(ISOException.class, () -> s.sign(SignHardeningTest.ecPriv(be(D)), SignHardeningTest.ecPub(point65(PT)), msg, (short) 0, sig, (short) 0));
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, x.getReason());
        } finally {
            JCSystem.abortTransaction();
        }
        assertArrayEquals(new byte[] { 0, 0, 0, 2 }, steps, "inside a transaction: refused, nothing stepped");
    }

    @Test
    @DisplayName("D257: on a card, the count is the install's (four bytes kept, one of RAM cleared at power loss); AUTHs in one time in the field step it once, a new time in the field once again; with both of the card's generators stuck, so that two AUTHs of one reader nonce sign one message, the two have two R")
    void onACardTheCountStepsOnceATimeInTheField() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] steps = c.field("signCount");
        assertEquals(JCSystem.NOT_A_TRANSIENT_OBJECT, JCSystem.isTransient(steps), "kept");
        assertEquals(JCSystem.CLEAR_ON_RESET, JCSystem.isTransient(c.field("signCountHere")), "and its RAM part cleared at power loss");
        c.power();
        long s0 = new BigInteger(1, steps).longValue();
        CommandAPDU auth = new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 256);
        SchnorrHW signer = ChipEnginesTest.signerOf(c);
        SchnorrHWSignTest.setHidden(signer, "rng", SignHardeningTest.fixedRng());
        ChipEnginesTest.set(c.applet(), CashuApplet.class, "rng", SignHardeningTest.fixedRng());   // the card's 16 bytes of AUTH too
        byte[] a1 = c.send(auth).getData(), a2 = c.send(auth).getData();
        assertArrayEquals(Arrays.copyOf(a1, 16), Arrays.copyOf(a2, 16), "the card's 16 bytes the same: one message signed twice");
        assertFalse(Arrays.equals(Arrays.copyOfRange(a1, 16, 48), Arrays.copyOfRange(a2, 16, 48)), "two R with the generators stuck");
        assertEquals(s0 + 1, new BigInteger(1, steps).longValue(), "one step for the time in the field");
        c.power();
        assertEquals(64 + 16, c.send(auth).getData().length);
        assertEquals(s0 + 2, new BigInteger(1, steps).longValue(), "and one for the next");
    }
}
