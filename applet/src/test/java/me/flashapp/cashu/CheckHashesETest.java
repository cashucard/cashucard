package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import javacard.framework.ISOException;
import javacard.security.KeyAgreement;
import javacard.security.MessageDigest;
import javacard.security.PrivateKey;
import javacard.security.RandomData;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D250: the check of every signature hashes e again from Rx, Px and the message (the red team's A4-3), where it took the e
 * step 6 left in the scratch; and step 6 hashes the message as step 3 read it, so that a message that changes between the
 * nonce's hash and the check fails the check (the red team's C-A4-3-1). jCardSim only; the time (measured on the chip: about
 * 17 ms a plain signature, 28 ms a payment's last SIGN) is not shown.
 */
class CheckHashesETest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("D250: a fault in e after its hash (one bit of the scratch's e flipped as the chip's product begins, so s = k + e'd) is caught by the check, which hashes e again: that signature is refused and the bytecode signs again with a fresh nonce, and the one that leaves verifies; at c816133 to f394b29 the check read the same faulted e and the faulted signature left")
    void aFaultInEAfterItsHashIsCaught() throws Exception {
        for (int bit = 0; bit < 3; bit++) {
            SignHardeningTest.Rec eng = new SignHardeningTest.Rec();
            SchnorrHW s = SignHardeningTest.chipSigner(eng);
            byte[] sc = (byte[]) SchnorrHWSignTest.hidden(s, "sc");
            RandomData real = (RandomData) SchnorrHWSignTest.hidden(s, "rng");
            int[] calls = { 0 };
            final int flip = bit;
            RandomData faulty = new RandomData() {
                @Override public void generateData(byte[] b, short o, short l) {
                    real.generateData(b, o, l);
                    // the second draw of a signature is d1, the product's first step: e (sc[192..224)) is faulted there
                    if (++calls[0] == 2) sc[192 + 31 - flip * 7] ^= (byte) (1 << flip);
                }
                @Override public short nextBytes(byte[] b, short o, short l) { generateData(b, o, l); return (short) (o + l); }
                @Override public void setSeed(byte[] b, short o, short l) { }
                @Override public byte getAlgorithm() { return ALG_SECURE_RANDOM; }
            };
            SchnorrHWSignTest.setHidden(s, "rng", faulty);
            SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
            SchnorrHWSignTest.setHidden(s, "ecdh", ecdh);
            BigInteger d = new BigInteger("7A11E5C0DE7A11E5C0DE7A11E5C0DE7A11E5C0DE7A11E5C0DE7A11E5C0DE7A11", 16).add(BigInteger.valueOf(bit));
            BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
            byte[] msg = new byte[32], sig = new byte[64];
            msg[1] = (byte) (9 + bit);
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "the signature that leaves verifies, bit " + bit);
            assertEquals(4, ecdh.given.size(), "R and [e]Q of the refused try, then the bytecode's R and [e]Q, bit " + bit);
        }
    }

    /** The signer's SHA-256, passed through, with one bit of its `at`-th answer (counted from 1) flipped while armed. */
    static final class FlipDigest extends MessageDigest {
        final MessageDigest in;
        int done, at = -1, bit;
        FlipDigest(MessageDigest in) { this.in = in; }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public byte getLength() { return in.getLength(); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
            short n = in.doFinal(a, o, l, out, oo);
            if (++done == at) out[oo + 31 - bit / 8] ^= (byte) (1 << (bit % 8));
            return n;
        }
        @Override public void update(byte[] a, short o, short l) { in.update(a, o, l); }
        @Override public void reset() { in.reset(); }
    }

    @Test
    @DisplayName("D250, on the bytecode's path (the red team's second pass): a fault in e as its hash answers (one bit of step 6's challenge flipped, the third tagged hash of a signature) is caught by the check, which hashes e again: 6F00, nothing written to the caller's buffer; the same signer then signs and the signature verifies; at f394b29 the check read the faulted e and the faulted signature left")
    void aFaultInEIsCaughtOnTheBytecodesPathToo() throws Exception {
        for (int bit = 0; bit < 3; bit++) {
            SchnorrHW s = new SchnorrHW();
            s.init();
            assertFalse(s.chipMul, "the bytecode's product");
            FlipDigest sha = new FlipDigest((MessageDigest) SchnorrHWSignTest.hidden(s, "sha256"));
            SchnorrHWSignTest.setHidden(s, "sha256", sha);
            BigInteger d = new BigInteger("6E0D5EC0DE6E0D5EC0DE6E0D5EC0DE6E0D5EC0DE6E0D5EC0DE6E0D5EC0DE6E01", 16).add(BigInteger.valueOf(bit));
            BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
            byte[] msg = new byte[32], sig = new byte[64];
            msg[2] = (byte) (40 + bit);
            sha.at = 3;
            sha.bit = bit * 11;
            ISOException x = assertThrows(ISOException.class, () -> s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0), "bit " + bit);
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, x.getReason());
            assertEquals(4, sha.done, "aux, nonce, challenge, and the check's challenge again, bit " + bit);
            assertTrue(Arrays.equals(new byte[64], sig), "nothing of it written out");
            sha.at = -1;
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "and then it signs, bit " + bit);
        }
    }

    /** The signer's key agreement, which flips one bit of `msg` at its first answer while armed (step 4: R = kG). */
    static final class FlipMessageAtR extends KeyAgreement {
        final KeyAgreement real;
        byte[] msg;
        boolean armed;
        int calls;
        FlipMessageAtR(KeyAgreement real) { this.real = real; }
        @Override public void init(PrivateKey k) { real.init(k); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] pub, short off, short len, byte[] out, short outOff) {
            if (armed && calls++ == 0) msg[5] ^= 0x01;
            return real.generateSecret(pub, off, len, out, outOff);
        }
    }

    @Test
    @DisplayName("D250 (the red team's C-A4-3-1, proved on 4f610e6 by recovering d): with a stuck generator, one fault in the caller's message between the nonce's hash and the challenge's no longer gives a signature of the same R and another e: on the bytecode's path the check, hashing e from the message as it is now where step 6 hashed step 3's, refuses it (6F00); on the chip's path the refused signature is made again by the bytecode from the message as it now is, with another R; no two signatures leave with one R")
    void aMessageFaultAfterTheNonceGivesNoSecondSignatureOfOneR() throws Exception {
        BigInteger d = new BigInteger("2B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFE", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        for (boolean chip : new boolean[] { false, true }) {
            SchnorrHW s = chip ? SignHardeningTest.chipSigner(new SignHardeningTest.Rec()) : new SchnorrHW();
            if (!chip) s.init();
            SchnorrHWSignTest.setHidden(s, "rng", SignHardeningTest.fixedRng());
            FlipMessageAtR ka = new FlipMessageAtR((KeyAgreement) SchnorrHWSignTest.hidden(s, "ecdh"));
            SchnorrHWSignTest.setHidden(s, "ecdh", ka);
            byte[] msg = new byte[32];
            msg[0] = 0x42;
            byte[] m0 = msg.clone(), m1 = msg.clone();
            m1[5] ^= 0x01;
            byte[] good = new byte[64], second = new byte[64];
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, good, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), m0, good));
            ka.msg = msg;
            ka.armed = true;
            String path = chip ? "the chip's path" : "the bytecode's path";
            if (!chip) {
                ISOException x = assertThrows(ISOException.class, () -> s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, second, (short) 0));
                assertEquals(CashuApplet.SW_CRYPTO_ERROR, x.getReason(), path + ": refused");
                assertTrue(Arrays.equals(new byte[64], second), path + ": nothing written out");
            } else {
                assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, second, (short) 0));
                assertTrue(Arrays.equals(m1, msg), "the caller's message is the faulted one now");
                assertTrue(schnorrVerify(be(pt[0]), m1, second), path + ": the signature that leaves is the message's as it now is");
                assertFalse(Arrays.equals(Arrays.copyOf(good, 32), Arrays.copyOf(second, 32)), path + ": with another R, so another nonce");
            }
        }
    }
}
