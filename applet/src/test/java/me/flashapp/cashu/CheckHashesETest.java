package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import javacard.security.RandomData;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D250: the check of every signature hashes e again from Rx, Px and the message (the red team's A4-3), where it took the e
 * step 6 left in the scratch. jCardSim only; the time (one tagged hash, about 8 ms by JCAlgTest's figures) is not shown.
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
}
