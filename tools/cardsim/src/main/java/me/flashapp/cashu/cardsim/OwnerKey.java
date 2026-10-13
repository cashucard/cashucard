package me.flashapp.cashu.cardsim;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPrivateKeySpec;

/**
 * An owner key (P-256) the bridge can sign the owner's proofs with, for fixtures that set an owner, limits or load
 * under the owner's grant (spec/APDU.md, "The owner's proof").
 *
 * <p>{@link #TEST} is the deterministic test owner key every tool in this repository shares: the private key is
 * SHA-256("cashu-javacard/cardctl test owner key") mod n, the same as tools/cardctl/p256.py's TEST_OWNER_PRIVATE and
 * client.cjs's TEST_OWNER_PRIVATE. Anyone with the repository holds it: simulated and bench cards only.
 */
final class OwnerKey {

    static final BigInteger P = new BigInteger("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF", 16);
    static final BigInteger A = P.subtract(BigInteger.valueOf(3));
    static final BigInteger N = new BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16);
    static final BigInteger GX = new BigInteger("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296", 16);
    static final BigInteger GY = new BigInteger("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5", 16);

    static final OwnerKey TEST = new OwnerKey(testPrivate());

    final BigInteger d;
    /** 04 || X || Y, 65 bytes: what SET_OWNER takes. */
    final byte[] pub;

    OwnerKey(BigInteger d) {
        if (d.signum() <= 0 || d.compareTo(N) >= 0) throw new IllegalArgumentException("an owner key is 0 < d < n");
        this.d = d;
        BigInteger[] q = mul(d, new BigInteger[] { GX, GY });
        pub = new byte[65];
        pub[0] = 0x04;
        put32(q[0], pub, 1);
        put32(q[1], pub, 33);
    }

    static OwnerKey fromHex(String hex) {
        byte[] b = Hex.parse(hex);
        if (b.length != 32) throw new IllegalArgumentException("ownerKey must be 32 bytes (64 hex chars), got " + b.length);
        return new OwnerKey(new BigInteger(1, b));
    }

    private static BigInteger testPrivate() {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest("cashu-javacard/cardctl test owner key".getBytes(StandardCharsets.US_ASCII));
            return new BigInteger(1, h).mod(N);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The owner's proof: an ECDSA signature (SHA-256, DER) over label || nonce || value. */
    byte[] proof(String label, byte[] nonce, byte[] value) {
        try {
            AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
            params.init(new ECGenParameterSpec("secp256r1"));
            ECParameterSpec spec = params.getParameterSpec(ECParameterSpec.class);
            PrivateKey key = KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(d, spec));
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initSign(key);
            s.update(label.getBytes(StandardCharsets.US_ASCII));
            s.update(nonce);
            s.update(value);
            return s.sign();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** An owner's command's data: the proof's length, the proof, then the value it was made over. */
    byte[] data(String label, byte[] nonce, byte[] value) {
        byte[] proof = proof(label, nonce, value);
        byte[] out = new byte[1 + proof.length + value.length];
        out[0] = (byte) proof.length;
        System.arraycopy(proof, 0, out, 1, proof.length);
        System.arraycopy(value, 0, out, 1 + proof.length, value.length);
        return out;
    }

    private static void put32(BigInteger v, byte[] out, int at) {
        byte[] b = v.toByteArray();
        int len = Math.min(b.length, 32);
        System.arraycopy(b, b.length - len, out, at + 32 - len, len);
    }

    private static BigInteger[] add(BigInteger[] p, BigInteger[] q) {
        if (p == null) return q;
        if (q == null) return p;
        BigInteger lam;
        if (p[0].equals(q[0])) {
            if (!p[1].equals(q[1]) || p[1].signum() == 0) return null;
            lam = p[0].pow(2).multiply(BigInteger.valueOf(3)).add(A).multiply(p[1].shiftLeft(1).modInverse(P)).mod(P);
        } else {
            lam = q[1].subtract(p[1]).multiply(q[0].subtract(p[0]).modInverse(P)).mod(P);
        }
        BigInteger x = lam.pow(2).subtract(p[0]).subtract(q[0]).mod(P);
        return new BigInteger[] { x, lam.multiply(p[0].subtract(x)).subtract(p[1]).mod(P) };
    }

    private static BigInteger[] mul(BigInteger k, BigInteger[] p) {
        BigInteger[] r = null;
        for (int i = k.bitLength() - 1; i >= 0; i--) {
            r = add(r, r);
            if (k.testBit(i)) r = add(r, p);
        }
        return r;
    }
}
