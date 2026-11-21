package me.flashapp.cashu;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import javacard.security.ECPublicKey;

/**
 * Keys per load (D197), as a reader that holds the card's secret c works them out, written here by hand from the rule and
 * not from the applet's code: for a date D, t = SHA-256("CashuCard/key" || c || D) mod n and the card's key for the date
 * P + t*G; u = SHA-256("CashuCard/refund-key" || c || D) mod n and the refund key for it R + u*G (none where the record has
 * none). Every secret of a piece of date D names those two keys, and a payment of that date is signed under P + t*G.
 *
 * One of these is the keys of one card at one moment: P, R and c read from it (`of`). The suites rebuild a payment's message
 * and check its signature through it.
 */
final class DateKeys {
    static final BigInteger P = new BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16);
    static final BigInteger N = new BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);
    static final BigInteger[] G = { new BigInteger("79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", 16),
                                    new BigInteger("483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", 16) };

    /** The card's key P (33), its refund key R (33, zeros for none) and its secret c (32). */
    final byte[] card, refund, c;

    DateKeys(byte[] card, byte[] refund, byte[] c) {
        this.card = card.clone();
        this.refund = refund.clone();
        this.c = c.clone();
    }

    /** The keys of the card that is `applet` now: its key, the refund key of its record, and c. */
    static DateKeys of(Object applet) {
        try {
            ECPublicKey pub = (ECPublicKey) field(applet, "cardPubKey");
            byte[] w = new byte[65];
            short len = pub.getW(w, (short) 0);
            // compressed (the simulator's form) as it is; uncompressed (a chip's), by the parity of y
            byte[] key = Arrays.copyOf(w, 33);
            if (len == 65) key[0] = (byte) ((w[64] & 1) == 0 ? 2 : 3);
            byte[] record = (byte[]) field(applet, "cardRecord");
            byte[] chain = (byte[]) field(applet, "chain");
            return new DateKeys(key, Arrays.copyOfRange(record, CashuApplet.CARD_REFUND_OFFSET, CashuApplet.CARD_REFUND_OFFSET + 33), Arrays.copyOf(chain, 32));
        } catch (ReflectiveOperationException x) {
            throw new AssertionError(x);
        }
    }

    private static Object field(Object applet, String name) throws ReflectiveOperationException {
        // the applet's own class: a suite may load it with a class loader of its own (TearLoader)
        java.lang.reflect.Field f = applet.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f.get(applet);
    }

    /** SHA-256(label || c || date) mod n. */
    static BigInteger tweak(String label, byte[] c, long date) {
        return new BigInteger(1, CashuAppletTest.sha256(CashuAppletTest.concat(label.getBytes(StandardCharsets.US_ASCII), c, CashuAppletTest.u32(date)))).mod(N);
    }
    BigInteger t(long date) { return tweak("CashuCard/key", c, date); }
    BigInteger u(long date) { return tweak("CashuCard/refund-key", c, date); }
    /** t as the card answers it: 32 bytes. */
    byte[] tBytes(long date) { return fixed(t(date)); }

    /** The card's key for the date, P + t*G, compressed. */
    byte[] key(long date) { return comp(add(point(card), mul(t(date), G))); }
    /** The refund key for the date, R + u*G, compressed; 33 zeros where the card has no refund key. */
    byte[] refund(long date) {
        if (isZero(refund)) return new byte[33];
        return comp(add(point(refund), mul(u(date), G)));
    }

    /** A piece's secret, of this nonce and date, as the card's keys for that date make it. */
    String secret(byte[] nonce, long date) { return CashuAppletTest.secretText(nonce, key(date), date, refund(date)); }

    /** The text a payment's one signature is over (CashuAppletTest.allMessage), each piece's secret with its date's keys. */
    String message(byte[][] slotData, byte[][] outputs) {
        StringBuilder m = new StringBuilder();
        for (byte[] d : slotData) {
            m.append(secret(Arrays.copyOfRange(d, 13, 45), CashuAppletTest.readUint32(d, 78))).append(CashuAppletTest.toHex(Arrays.copyOfRange(d, 45, 78)));
        }
        for (byte[] o : outputs) m.append(CashuAppletTest.readUint32(o, 0)).append(CashuAppletTest.toHex(Arrays.copyOfRange(o, 4, 37)));
        return m.toString();
    }
    /** SHA-256 of `message`: what the card signs. */
    byte[] hash(byte[][] slotData, byte[][] outputs) { return CashuAppletTest.sha256(message(slotData, outputs).getBytes(StandardCharsets.UTF_8)); }

    /** Whether `sig` is the card's, under its key for `date`, over `digest`. */
    boolean verifies(long date, byte[] digest, byte[] sig) {
        try {
            return CashuAppletTest.schnorrVerify(CashuAppletTest.extractPubkeyX(key(date)), digest, sig);
        } catch (Exception x) {
            throw new AssertionError(x);
        }
    }
    /** Whether `sig` is the card's for a payment of those pieces into those outputs: over their message, under the first piece's date's key. */
    boolean signed(byte[] sig, byte[][] slotData, byte[][] outputs) {
        long date = slotData.length == 0 ? 0 : CashuAppletTest.readUint32(slotData[0], 78);
        return verifies(date, hash(slotData, outputs), sig);
    }

    // ---- the curve, by BigInteger ------------------------------------------------------------------------------------

    static BigInteger[] add(BigInteger[] a, BigInteger[] b) {
        if (a == null) return b;
        if (b == null) return a;
        BigInteger l;
        if (a[0].equals(b[0])) {
            if (!a[1].equals(b[1])) return null;
            l = a[0].pow(2).multiply(BigInteger.valueOf(3)).multiply(a[1].shiftLeft(1).modInverse(P)).mod(P);
        } else {
            l = b[1].subtract(a[1]).multiply(b[0].subtract(a[0]).modInverse(P)).mod(P);
        }
        BigInteger x = l.pow(2).subtract(a[0]).subtract(b[0]).mod(P);
        return new BigInteger[] { x, l.multiply(a[0].subtract(x)).subtract(a[1]).mod(P) };
    }
    static BigInteger[] mul(BigInteger k, BigInteger[] p) {
        BigInteger[] r = null;
        for (int i = k.bitLength() - 1; i >= 0; i--) {
            r = add(r, r);
            if (k.testBit(i)) r = add(r, p);
        }
        return r;
    }
    /** A compressed point (33) as x and y. */
    static BigInteger[] point(byte[] c) {
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(c, 1, 33));
        BigInteger y = x.pow(3).add(BigInteger.valueOf(7)).mod(P).modPow(P.add(BigInteger.ONE).shiftRight(2), P);
        if (y.testBit(0) != (c[0] == 3)) y = P.subtract(y);
        return new BigInteger[] { x, y };
    }
    static byte[] comp(BigInteger[] p) {
        byte[] out = new byte[33];
        System.arraycopy(fixed(p[0]), 0, out, 1, 32);
        out[0] = (byte) (p[1].testBit(0) ? 3 : 2);
        return out;
    }
    static byte[] fixed(BigInteger v) {
        byte[] b = v.toByteArray(), out = new byte[32];
        int n = Math.min(32, b.length);
        System.arraycopy(b, b.length - n, out, 32 - n, n);
        return out;
    }
    static boolean isZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }
}
