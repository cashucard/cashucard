package me.flashapp.cashu;

import java.math.BigInteger;

/**
 * Wrong engines whose fault is in the way the multiplication is done, outside the family of SchnorrHWSignTest (which reads a
 * Y or the scalar otherwise): each is a fault a chip's library could have. The G path is a base (the key agreement) or a
 * generator (the point addition) that is G, X and Y.
 * <ul>
 * <li>gBlind: the G path only, s + n with the carry out of 256 bits lost, so [s - (2^256 - n)]G for s from 2^256 - n up;</li>
 * <li>gTable: the G path only, a table of 4-bit windows for G whose entry 2 is -2G;</li>
 * <li>win7: every base, a 4-bit fixed window whose entry 7 is -7P;</li>
 * <li>comb2: every base, a comb of 4 teeth 64 bits apart whose entry 2 (2^64 P) is negated;</li>
 * <li>dbl: the point addition by the formula for two distinct points, with no case for a point added to itself (1/0 taken as
 * 0), and the point at infinity answered as 04 and zeros;</li>
 * <li>jac: the answer left in Jacobian form (X Z^2, Y Z^3 with Z = 2);</li>
 * <li>leOut: the answer's X given little-endian;</li>
 * <li>leS: the scalar read little-endian;</li>
 * <li>and the forms "window/w/e/path", "comb/w/e/path" and "wnaf/w/e/path": entry e of a fixed window of w bits, of a comb of
 * w teeth, or of a NAF of width w (e odd; the entry serves e and -e), stored negated, where path is "G" (the G path only),
 * "other" (every other base or generator) or "all".</li>
 * </ul>
 * Each fault of a table is the scalar changed: entry e used at the places M stands for gives [s - 2 e M] in place of [s]. The
 * answers are worked out by the discrete logarithm where the points are among those the framing check uses, and on the curve
 * otherwise.
 */
final class MethodModels {
    static final BigInteger P = CashuAppletTest.SECP_P, N = CashuAppletTest.SECP_N;
    static final BigInteger TWO256 = BigInteger.ONE.shiftLeft(256);
    /** The named ones; "dbl" is answered right wherever the two points added differ. */
    static final String[] NAMED = { "gBlind", "gTable", "win7", "comb2", "dbl", "jac", "leOut", "leS" };

    static boolean is(String how) {
        if (how == null) return false;
        for (String a : NAMED) if (a.equals(how)) return true;
        return how.startsWith("window/") || how.startsWith("comb/") || how.startsWith("wnaf/");
    }

    // ── [x]G, fast: a table of 2^i G and Jacobian sums ──────────────────────
    private static final BigInteger[][] POW2G = new BigInteger[256][];
    static {
        BigInteger[] q = { CashuAppletTest.SECP_GX, CashuAppletTest.SECP_GY };
        for (int i = 0; i < 256; i++) { POW2G[i] = q; q = CashuAppletTest.ecAddTest(q[0], q[1], q[0], q[1]); }
    }
    /** [x]G, null for the point at infinity. */
    static BigInteger[] mulG(BigInteger x) {
        x = x.mod(N);
        BigInteger X = null, Y = null, Z = null;
        for (int i = 0; i < 256; i++) {
            if (!x.testBit(i)) continue;
            BigInteger[] a = POW2G[i];
            if (X == null) { X = a[0]; Y = a[1]; Z = BigInteger.ONE; continue; }
            BigInteger zz = Z.multiply(Z).mod(P), u2 = a[0].multiply(zz).mod(P), s2 = a[1].multiply(Z).multiply(zz).mod(P);
            BigInteger h = u2.subtract(X).mod(P), r = s2.subtract(Y).mod(P);
            if (h.signum() == 0) {
                if (r.signum() != 0) { X = null; continue; }
                // a point added to itself: double (a = 0)
                BigInteger A = X.multiply(X).mod(P), B = Y.multiply(Y).mod(P), C = B.multiply(B).mod(P);
                BigInteger D = X.add(B).pow(2).subtract(A).subtract(C).shiftLeft(1).mod(P), E = A.multiply(BigInteger.valueOf(3)).mod(P);
                BigInteger X3 = E.multiply(E).subtract(D.shiftLeft(1)).mod(P);
                Y = E.multiply(D.subtract(X3)).subtract(C.shiftLeft(3)).mod(P);
                Z = Y.multiply(Z).shiftLeft(1).mod(P);
                X = X3;
                continue;
            }
            BigInteger hh = h.multiply(h).mod(P), hhh = h.multiply(hh).mod(P), v = X.multiply(hh).mod(P);
            BigInteger X3 = r.multiply(r).subtract(hhh).subtract(v.shiftLeft(1)).mod(P);
            Y = r.multiply(v.subtract(X3)).subtract(Y.multiply(hhh)).mod(P);
            Z = Z.multiply(h).mod(P);
            X = X3;
        }
        if (X == null) return null;
        BigInteger zi = Z.modInverse(P), zi2 = zi.multiply(zi).mod(P);
        return new BigInteger[] { X.multiply(zi2).mod(P), Y.multiply(zi2).multiply(zi).mod(P) };
    }

    private static final java.util.Map<String, BigInteger> LOGS = new java.util.HashMap<>();
    static {
        for (long k : new long[] { 1, 2, 11 }) {
            for (BigInteger d : new BigInteger[] { BigInteger.valueOf(k), N.subtract(BigInteger.valueOf(k)) }) {
                BigInteger[] q = mulG(d);
                LOGS.put(q[0].toString(16) + ":" + q[1].toString(16), d);
            }
        }
    }
    /** The discrete logarithm of q where it is one of ±G, ±2G, ±11G; else null. */
    static BigInteger log(BigInteger[] q) { return q == null ? null : LOGS.get(q[0].toString(16) + ":" + q[1].toString(16)); }

    static boolean isG(BigInteger[] q) { return q != null && q[0].equals(CashuAppletTest.SECP_GX) && q[1].equals(CashuAppletTest.SECP_GY); }

    // ── The scalar each fault works with ───────────────────────────────────
    /** The scalar s with its table entry e of a fixed window of w bits negated: s - 2 e M, M the places the entry is used at. */
    static BigInteger window(BigInteger s, int w, int e) {
        BigInteger m = BigInteger.ZERO;
        for (int i = 0; i * w < 256; i++) if ((s.shiftRight(i * w).intValue() & ((1 << w) - 1)) == e) m = m.setBit(i * w);
        return s.subtract(m.multiply(BigInteger.valueOf(2L * e)));
    }
    /** The scalar s with entry e of a comb of w teeth (columns d = 256 / w, rounded up, apart) negated. */
    static BigInteger comb(BigInteger s, int w, int e) {
        int d = (256 + w - 1) / w;
        BigInteger t = BigInteger.ZERO, m = BigInteger.ZERO;
        for (int j = 0; j < w; j++) if ((e >> j & 1) != 0) t = t.setBit(d * j);
        for (int col = 0; col < d; col++) {
            int idx = 0;
            for (int j = 0; j < w; j++) if (s.testBit(col + d * j)) idx |= 1 << j;
            if (idx == e) m = m.setBit(col);
        }
        return s.subtract(m.multiply(t).shiftLeft(1));
    }
    /** The digits of s's NAF of width w, from the lowest place: digit at place i, or 0. */
    static int[] naf(BigInteger s, int w) {
        int[] ds = new int[260];
        BigInteger k = s;
        for (int i = 0; k.signum() > 0; i++) {
            if (k.testBit(0)) {
                int m = k.mod(BigInteger.ONE.shiftLeft(w)).intValue();
                if (m >= 1 << (w - 1)) m -= 1 << w;
                ds[i] = m;
                k = k.subtract(BigInteger.valueOf(m));
            }
            k = k.shiftRight(1);
        }
        return ds;
    }
    /** The scalar s with the NAF entry e (for the digits e and -e) negated. */
    static BigInteger wnaf(BigInteger s, int w, int e) {
        int[] ds = naf(s, w);
        BigInteger m = BigInteger.ZERO;
        for (int i = 0; i < ds.length; i++) if (Math.abs(ds[i]) == e) m = m.add(BigInteger.valueOf(ds[i]).shiftLeft(i));
        return s.subtract(m.shiftLeft(1));
    }
    /** Whether the fault's table entry is used for s (the entries the sweep's "used" means). */
    static boolean uses(String method, BigInteger s, int w, int e) {
        switch (method) {
            case "window": return !window(s, w, e).equals(s);
            case "comb": return !comb(s, w, e).equals(s);
            default: return !wnaf(s, w, e).equals(s);
        }
    }
    static BigInteger rev(BigInteger s) {
        byte[] b = SchnorrHWSignTest.u32(s), o = new byte[32];
        for (int i = 0; i < 32; i++) o[i] = b[31 - i];
        return new BigInteger(1, o);
    }

    /** The scalar the model multiplies by in place of s, on the G path or not. */
    static BigInteger scalar(String how, BigInteger s, boolean gPath) {
        switch (how) {
            case "gBlind": if (!gPath) return s; BigInteger t = s.add(N); return t.compareTo(TWO256) >= 0 ? t.subtract(TWO256) : t;
            case "gTable": return gPath ? window(s, 4, 2) : s;
            case "win7": return window(s, 4, 7);
            case "comb2": return comb(s, 4, 2);
            case "leS": return rev(s);
            default: break;
        }
        String[] f = how.split("/");
        if (f.length == 4) {
            boolean on = f[3].equals("all") || f[3].equals("G") == gPath;
            if (!on) return s;
            int w = Integer.parseInt(f[1]), e = Integer.parseInt(f[2]);
            return f[0].equals("window") ? window(s, w, e) : f[0].equals("comb") ? comb(s, w, e) : wnaf(s, w, e);
        }
        return s;
    }

    /** The model's answer, 04 || X || Y: the key agreement ([s]in) or the point addition ([s]g + in). */
    static byte[] answer(String how, boolean gm, BigInteger s, BigInteger[] g, BigInteger[] in) {
        BigInteger[] base = gm ? g : in;
        BigInteger k = scalar(how, s, isG(base));
        BigInteger[] r;
        BigInteger lb = log(base), lh = gm ? log(in) : BigInteger.ZERO;
        if (lb != null && lh != null && !how.equals("dbl")) {
            r = mulG(k.multiply(lb).add(lh));
        } else {
            BigInteger[] m = SchnorrHWSignTest.times(k, base);
            if (!gm) r = m;
            else if (how.equals("dbl") && m != null && m[0].equals(in[0])) {
                // the formula for two distinct points, with 1/0 taken as 0: the slope is 0
                r = new BigInteger[] { m[0].shiftLeft(1).negate().mod(P), m[1].negate().mod(P) };
            } else r = SchnorrHWSignTest.plus(m, in);
        }
        byte[] out = new byte[65];
        out[0] = 4;
        if (r == null) return out;
        BigInteger x = r[0], y = r[1];
        if (how.equals("jac")) { x = x.shiftLeft(2).mod(P); y = y.shiftLeft(3).mod(P); }
        byte[] xb = SchnorrHWSignTest.u32(x);
        if (how.equals("leOut")) { byte[] o = new byte[32]; for (int i = 0; i < 32; i++) o[i] = xb[31 - i]; xb = o; }
        System.arraycopy(xb, 0, out, 1, 32);
        System.arraycopy(SchnorrHWSignTest.u32(y), 0, out, 33, 32);
        return out;
    }
}
