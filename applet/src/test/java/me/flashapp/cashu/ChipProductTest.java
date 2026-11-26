package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.Random;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D246: the signature's product e·d on the chip's RSA, its bytecode trimmed (A2 of the 3.2 speed review): q = e/4 worked out
 * once for both products, and the operands q + d_i and q - d_i taken mod n. What the engine is given is read from it (the
 * squarings' inputs); the time is not shown (simulator only).
 */
class ChipProductTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger FOUR_INV = BigInteger.valueOf(4).modInverse(N);

    @Test
    @DisplayName("D246: each of 40 signatures (keys of both parities, under a date's key too) gives the engine four inputs, all under n: u1, v1 for e*d1 and u2, v2 for e*d2, with u_i + v_i = e/2 (2q, q the quarter of e mod n, worked out once) and the two halves of u_i - v_i adding up to the key, d1 + d2 = d; 3.2 at c816133 gave e + d_i and |e - d_i|, whose sum is twice the larger")
    void theEngineIsGivenTheQuarterAndTheShares() throws Exception {
        Random rnd = new Random(242);
        int odd = 0;
        for (int i = 0; i < 40; i++) {
            BigInteger d = new BigInteger(255, rnd).add(BigInteger.ONE), t = i % 4 == 3 ? new BigInteger(255, rnd) : null;
            BigInteger key = t == null ? d : d.add(t).mod(N);
            BigInteger[] pt = ecMulTest(key, SECP_GX, SECP_GY);
            if (pt[1].testBit(0)) odd++;
            BigInteger dEff = pt[1].testBit(0) ? N.subtract(key) : key;
            byte[] msg = new byte[32];
            rnd.nextBytes(msg);
            SignHardeningTest.Rec eng = new SignHardeningTest.Rec();
            SchnorrHW s = SignHardeningTest.chipSigner(eng);
            byte[] sig = new byte[64];
            if (t == null) {
                assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            } else {
                BigInteger[] w = ecMulTest(d, SECP_GX, SECP_GY);
                byte[] g = concat(be(t), compressed(pt));
                assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(w)), g, (short) 0, msg, (short) 0, sig, (short) 0));
            }
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "the signature verifies, " + i);
            assertEquals(4, eng.ins.size(), "four squarings");
            for (BigInteger x : eng.ins) assertTrue(x.compareTo(N) < 0, "every input under n (the engine answers garbage at or over it)");
            BigInteger e = SignHardeningTest.challenge(Arrays.copyOfRange(sig, 0, 32), be(pt[0]), msg);
            BigInteger halfE = e.multiply(FOUR_INV).shiftLeft(1).mod(N);
            BigInteger u1 = eng.ins.get(0), v1 = eng.ins.get(1), u2 = eng.ins.get(2), v2 = eng.ins.get(3);
            assertEquals(halfE, u1.add(v1).mod(N), "u1 + v1 is 2q, the half of e, " + i);
            assertEquals(halfE, u2.add(v2).mod(N), "and u2 + v2, the same q for both products, " + i);
            BigInteger two = BigInteger.TWO.modInverse(N);
            BigInteger d1 = u1.subtract(v1).multiply(two).mod(N), d2 = u2.subtract(v2).multiply(two).mod(N);
            assertEquals(dEff, d1.add(d2).mod(N), "the shares add up to the key, " + i);
            assertTrue(!d1.equals(dEff) && !d2.equals(dEff), "and neither is the key alone");
        }
        assertTrue(odd > 5 && odd < 35, "both parities: " + odd + " odd");
    }

    @Test
    @DisplayName("D246: the same key and message sign with other shares each time (a fresh d1), and a fault in any of the four squarings is still caught by the check and the signature made again by the bytecode (D218), which verifies")
    void freshSharesAndTheCheckStillCatchesAFault() throws Exception {
        BigInteger d = new BigInteger("5C0FFEE5C0FFEE5C0FFEE5C0FFEE5C0FFEE5C0FFEE5C0FFEE5C0FFEE5C0FFEE", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32];
        msg[3] = 3;
        BigInteger firstU = null;
        SignHardeningTest.Rec eng = new SignHardeningTest.Rec();
        SchnorrHW s = SignHardeningTest.chipSigner(eng);
        for (int k = 0; k < 4; k++) {
            eng.ins.clear();
            eng.call = 0;
            eng.faultAt = k;
            eng.flipOutBit = 40 + k;
            byte[] sig = new byte[64];
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "a fault in squaring " + k + " never leaves the card: the bytecode's signature verifies");
            assertEquals(4, eng.ins.size(), "the chip's try was given up after its four squarings, " + k);
            if (firstU == null) firstU = eng.ins.get(0);
            else assertTrue(!firstU.equals(eng.ins.get(0)), "a fresh share each time");
        }
    }
}
