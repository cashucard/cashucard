package me.flashapp.cashu;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The applet's arithmetic in the field of secp256k1, which a change output's
 * point is made in (1.12), against BigInteger: the reduction of a 512-bit
 * number mod p, and the small helpers around it. Reflection into the
 * private statics; nothing of a card is needed.
 */
class FieldReductionTest {
    static final BigInteger P = new BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16);

    static byte[] fixed(BigInteger v, int len) {
        byte[] raw = v.toByteArray(), out = new byte[len];
        int n = Math.min(raw.length, len);
        System.arraycopy(raw, raw.length - n, out, len - n, n);
        return out;
    }

    private static Method method(String name, Class<?>... types) throws Exception {
        Method m = CashuApplet.class.getDeclaredMethod(name, types);
        m.setAccessible(true);
        return m;
    }

    @Test
    @DisplayName("reduceModP: a 512-bit number mod p, in its low 32 bytes with the high 32 cleared, for the edges and three hundred random numbers")
    void reduceModPMatchesBigInteger() throws Exception {
        Method m = method("reduceModP", byte[].class, short.class, byte[].class, short.class);
        SecureRandom rnd = new SecureRandom();
        BigInteger pp = P.multiply(P);
        BigInteger[] edges = { BigInteger.ZERO, BigInteger.ONE, P.subtract(BigInteger.ONE), P, P.add(BigInteger.ONE), P.shiftLeft(1),
            pp.subtract(BigInteger.ONE), pp.subtract(P), P.shiftLeft(256), P.shiftLeft(256).add(P), BigInteger.ONE.shiftLeft(512).subtract(BigInteger.ONE),
            BigInteger.ONE.shiftLeft(256), BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE) };
        for (int i = 0; i < edges.length + 300; i++) {
            BigInteger v = i < edges.length ? edges[i] : new BigInteger(512, rnd);
            byte[] buf = new byte[300], work = new byte[200];
            System.arraycopy(fixed(v, 64), 0, buf, 96, 64);
            m.invoke(null, buf, (short) 96, work, (short) 120);
            assertEquals(v.mod(P), new BigInteger(1, Arrays.copyOfRange(buf, 128, 160)), "v = " + v.toString(16));
            for (int k = 96; k < 128; k++) assertEquals(0, buf[k], "the high half is cleared, v = " + v.toString(16));
            for (int k = 0; k < 96; k++) assertEquals(0, buf[k], "nothing before the number is touched");
            for (int k = 160; k < 300; k++) assertEquals(0, buf[k], "nor after it");
            for (int k = 0; k < 120; k++) assertEquals(0, work[k], "the working room is the forty bytes asked for, and nothing before them");
            for (int k = 160; k < 200; k++) assertEquals(0, work[k], "nor after them");
        }
    }

    @Test
    @DisplayName("add7ModP and negateModP: v + 7 mod p and p - v, for the edges and a hundred random numbers under p")
    void smallHelpersMatchBigInteger() throws Exception {
        Method add7 = method("add7ModP", byte[].class, short.class);
        Method neg = method("negateModP", byte[].class, short.class);
        SecureRandom rnd = new SecureRandom();
        BigInteger[] edges = { BigInteger.ZERO, BigInteger.ONE, BigInteger.valueOf(6), P.subtract(BigInteger.valueOf(8)), P.subtract(BigInteger.valueOf(7)),
            P.subtract(BigInteger.valueOf(6)), P.subtract(BigInteger.ONE) };
        for (int i = 0; i < edges.length + 100; i++) {
            BigInteger v = i < edges.length ? edges[i] : new BigInteger(256, rnd).mod(P);
            byte[] buf = new byte[64];
            System.arraycopy(fixed(v, 32), 0, buf, 16, 32);
            add7.invoke(null, buf, (short) 16);
            assertEquals(v.add(BigInteger.valueOf(7)).mod(P), new BigInteger(1, Arrays.copyOfRange(buf, 16, 48)), "v + 7, v = " + v.toString(16));
            if (v.signum() == 0) continue;
            System.arraycopy(fixed(v, 32), 0, buf, 16, 32);
            neg.invoke(null, buf, (short) 16);
            assertEquals(P.subtract(v), new BigInteger(1, Arrays.copyOfRange(buf, 16, 48)), "p - v, v = " + v.toString(16));
        }
    }

    @Test
    @DisplayName("cmp256: the unsigned order of 32-byte numbers, where a signed compare would get the high bit wrong")
    void cmp256IsUnsigned() throws Exception {
        Method cmp = method("cmp256", byte[].class, short.class, byte[].class, short.class);
        byte[] a = fixed(BigInteger.ONE.shiftLeft(255), 32), b = fixed(BigInteger.ONE, 32), p = fixed(P, 32);
        assertEquals((short) 1, cmp.invoke(null, a, (short) 0, b, (short) 0), "2^255 is more than 1");
        assertEquals((short) -1, cmp.invoke(null, b, (short) 0, a, (short) 0));
        assertEquals((short) 0, cmp.invoke(null, p, (short) 0, p, (short) 0));
        assertEquals((short) -1, cmp.invoke(null, fixed(P.subtract(BigInteger.ONE), 32), (short) 0, p, (short) 0), "p - 1 is under p");
        assertEquals((short) 1, cmp.invoke(null, fixed(BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE), 32), (short) 0, p, (short) 0), "2^256 - 1 is over p");
    }
}
