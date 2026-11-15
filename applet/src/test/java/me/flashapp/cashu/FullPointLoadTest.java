package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import javacard.security.CryptoException;
import javacard.security.KeyAgreement;
import javacard.security.PrivateKey;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D206: LOAD_PROOF's P2 bit 3 (08), each piece's C whole (04 || x || y), held to the curve by the chip's key agreement in place
 * of Euler's test of x, and stored compressed exactly as the 33-byte form stores it. At each SET_CARD the card tests the agreement
 * (G taken, G with y one more refused); where that fails, the 04 form is 6B00 and the reader sends the 33-byte form.
 */
class FullPointLoadTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger P = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.valueOf(0x1000003D1L));
    static final int P2_FULL = 0x0A, P2_FULL_UNIT = 0x0B;

    static byte[] be32(BigInteger v) {
        byte[] b = v.toByteArray(), out = new byte[32];
        if (b.length > 32) b = Arrays.copyOfRange(b, b.length - 32, b.length);
        System.arraycopy(b, 0, out, 32 - b.length, b.length);
        return out;
    }
    static BigInteger rhs(BigInteger x) { return x.pow(3).add(BigInteger.valueOf(7)).mod(P); }
    static boolean square(BigInteger v) { return v.signum() == 0 || v.modPow(P.subtract(BigInteger.ONE).shiftRight(1), P).equals(BigInteger.ONE); }
    static BigInteger root(BigInteger v) { return v.modPow(P.add(BigInteger.ONE).shiftRight(2), P); }
    /** 04 || x || y, each as 32 bytes (taken mod 2^256, so that x = p and the like can be written). */
    static byte[] full(BigInteger x, BigInteger y) { return concat(new byte[] { 4 }, be32(x), be32(y)); }
    /** A compressed point whole: y the root of x's parity. */
    static byte[] whole(byte[] c33) {
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(c33, 1, 33)), y = root(rhs(x));
        if (y.testBit(0) != (c33[0] == 3)) y = P.subtract(y);
        return full(x, y);
    }
    /** The 81-byte piece in the 04 form: C whole (`c65`, whatever its bytes) in place of the 33 bytes, the date after it. */
    static byte[] fullPiece(byte[] piece81, byte[] c65) {
        return concat(Arrays.copyOfRange(piece81, 0, 44), c65, Arrays.copyOfRange(piece81, 77, 81));
    }
    static byte[] withC(byte[] piece81, byte[] c33) {
        byte[] p = piece81.clone();
        System.arraycopy(c33, 0, p, 44, 33);
        return p;
    }

    static final byte[] G = hexToBytes("0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8");
    static final BigInteger GX = new BigInteger(1, Arrays.copyOfRange(G, 1, 33)), GY = new BigInteger(1, Arrays.copyOfRange(G, 33, 65));
    /** Points a mint made: four of testnut's keys (sat), two real pieces' C (unblinded, chip run 21), and -G, of odd y. */
    static final String[] GOOD = {
        "02ad8c30cbdeba49737010f7cd86a0471a6aa02aeae4574394c1b1e2ab246db487",
        "02d45c40d68127be3b627defa66637d6b02e58866ef2c91dfae5ca342238b56d8c",
        "02289ebd5bbe58da44e097786c4e3a6c2a3f275e779fd8fe996cd13c651c9a46dc",
        "034c2c568cda5e78b402d2c34edffa8ba79ce8944e480c2fb18e5978073dcab8f7",
        "02eb9b90cd2eaca62cc11cf59ce74c2ac9f4cdb62c81348c0a5350f3f45fae951c",
        "020e5112340156dacb246468d31b479bcc2cc7dfb89c20392e291b72ce59d49a19",
        "0379BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
    };

    /** Every case SETW-REPORT.md tried on the chip that is not a point of the curve in its one encoding, by name. */
    static Map<String, byte[]> bad() {
        Map<String, byte[]> m = new LinkedHashMap<>();
        BigInteger nx = BigInteger.valueOf(5);
        while (square(rhs(nx))) nx = nx.add(BigInteger.ONE);
        m.put("x on no point, y anything", full(nx, BigInteger.valueOf(1234567)));
        // the twist: the same x, y with y^2 = 3 * (x^3 + 7), 3 a non-square
        BigInteger d = BigInteger.valueOf(3);
        while (square(d)) d = d.add(BigInteger.ONE);
        m.put("a point of the twist", full(nx, root(d.multiply(rhs(nx)).mod(P))));
        m.put("G's x, a wrong y", full(GX, BigInteger.valueOf(987654321)));
        m.put("G with y + 1", full(GX, GY.add(BigInteger.ONE)));
        m.put("G with y - 1", full(GX, GY.subtract(BigInteger.ONE)));
        m.put("G's x, the other root + 1", full(GX, P.subtract(GY).add(BigInteger.ONE)));
        m.put("G's x, y = 0", full(GX, BigInteger.ZERO));
        m.put("x = p, y of G", full(P, GY));
        m.put("x = 2^256 - 1", full(BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE), GY));
        m.put("G's x, y = p", full(GX, P));
        m.put("G's x, y = p + 1", full(GX, P.add(BigInteger.ONE)));
        m.put("G's x, y = 2^256 - 1", full(GX, BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE)));
        // a wrap of a good point: x = 1 is on the curve where 8 is a square; x + p is its x again, mod p
        BigInteger y1 = root(BigInteger.valueOf(8));
        assertTrue(y1.multiply(y1).mod(P).equals(BigInteger.valueOf(8)), "x = 1 is a point of the curve");
        m.put("x = p + 1 (the point of x = 1, wrapped)", full(P.add(BigInteger.ONE), y1));
        m.put("04 and 64 zeros (infinity)", full(BigInteger.ZERO, BigInteger.ZERO));
        m.put("P-256's generator", hexToBytes("046B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C2964FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5"));
        m.put("G's x, P-256's y", concat(Arrays.copyOfRange(G, 0, 33), hexToBytes("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5")));
        for (int prefix : new int[] { 0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0xFF }) {
            byte[] g = G.clone();
            g[0] = (byte) prefix;
            m.put("G with prefix " + String.format("%02X", prefix), g);
        }
        m.put("65 bytes of FF", filled(65, 0xFF));
        m.put("65 zero bytes", new byte[65]);
        return m;
    }
    static byte[] filled(int n, int v) { byte[] b = new byte[n]; Arrays.fill(b, (byte) v); return b; }

    static ResponseAPDU loadFull(UnitsTest.Card c, byte[]... pieces) { return c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, P2_FULL, concat(pieces), 256)); }

    /** What a load leaves on a card, everything that lasts (the clock and the tap's state aside: they are the same on both). */
    static Map<String, byte[]> kept(UnitsTest.Card c) throws Exception { return c.snapshot(); }

    // =========================================================================
    // Good points
    // =========================================================================

    @Test
    @DisplayName("D206: good points in the 04 form go on (G, -G, four of testnut's keys, two real pieces' C), each stored exactly as the same piece in the 33-byte form is, on a twin card; one a command (two in one are 6700), and with the mint's proof (P1 = 1), with the unit first (P2 0B)")
    void goodPointsGoOnStoredTheSame() throws Exception {
        UnitsTest.Card a = UnitsTest.owned(UnitsTest.SAT), b = UnitsTest.owned(UnitsTest.SAT);
        assertTrue(curveByAgreement(a), "the simulator's agreement holds to the curve: the set-up's test passed");
        String[] cs = concat2s(new String[] { "02" + toHex(G).substring(2, 66) }, GOOD);
        for (String hex : cs) {
            byte[] piece = withC(a.piece(UnitsTest.SAT_A, 8), hexToBytes(hex));
            assertEquals(SW_OK, b.load(piece).getSW(), "the 33-byte form of " + hex);
            ResponseAPDU r = loadFull(a, fullPiece(piece, whole(hexToBytes(hex))));
            assertEquals(SW_OK, r.getSW(), "the 04 form of " + hex);
        }
        // one piece a command in this form: two are a length it does not take (6700, nothing written), and each then goes on alone
        byte[] p1 = withC(a.piece(UnitsTest.SAT_A, 16), hexToBytes(GOOD[0])), p2 = withC(a.piece(UnitsTest.SAT_A, 32), hexToBytes(GOOD[3]));
        assertEquals(SW_OK, b.load(p1, p2).getSW());
        Map<String, byte[]> one = kept(a);
        assertEquals(SW_WRONG_LENGTH, loadFull(a, fullPiece(p1, whole(hexToBytes(GOOD[0]))), fullPiece(p2, whole(hexToBytes(GOOD[3])))).getSW(), "two in one command");
        a.assertUnchanged(one, "two in one command");
        assertEquals(SW_OK, loadFull(a, fullPiece(p1, whole(hexToBytes(GOOD[0])))).getSW());
        assertEquals(SW_OK, loadFull(a, fullPiece(p2, whole(hexToBytes(GOOD[3])))).getSW());
        // with the mint's proof, and the unit first
        byte[] p3 = withC(a.piece(UnitsTest.SAT_A, 64), hexToBytes(GOOD[4])), proof = filled(96, 0x5A);
        assertEquals(SW_OK, b.loadAsWithProof(UnitsTest.SAT, p3, proof).getSW());
        ResponseAPDU withProof = a.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, P2_FULL_UNIT, concat(new byte[] { 0 }, fullPiece(p3, whole(hexToBytes(GOOD[4]))), proof), 256));
        assertEquals(SW_OK, withProof.getSW());
        assertEquals(1, withProof.getData()[1], "its proof kept");
        Map<String, byte[]> ka = kept(a), kb = kept(b);
        for (String n : ka.keySet()) assertArrayEquals(kb.get(n), ka.get(n), "stored the same either way: " + n);
        assertEquals(readUint32(b.balance(0), 0), readUint32(a.balance(0), 0));
        assertEquals(8 * cs.length + 16 + 32 + 64, readUint32(a.balance(0), 0));
    }

    static String[] concat2s(String[] a, String[] b) {
        String[] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    @Test
    @DisplayName("D206: a piece loaded in the 04 form pays as the same piece loaded in the 33-byte form does: the same signature on twin cards, the place spent")
    void aPieceLoadedWholePays() throws Exception {
        UnitsTest.Card a = UnitsTest.owned(UnitsTest.SAT), b = UnitsTest.owned(UnitsTest.SAT);
        byte[] piece = withC(a.piece(UnitsTest.SAT_A, 64), hexToBytes(GOOD[5]));
        b.piece(UnitsTest.SAT_A, 64);
        int pb = b.load(piece).getData()[0], pa = loadFull(a, fullPiece(piece, whole(hexToBytes(GOOD[5])))).getData()[0];
        assertEquals(pb, pa);
        ResponseAPDU sa = a.pay(pa), sb = b.pay(pb);
        assertEquals(SW_OK, sa.getSW());
        assertEquals(64, sa.getData().length, "signed");
        assertArrayEquals(sb.getData(), sa.getData(), "the same signature: the card signed the same piece");
        assertEquals(CashuApplet.STATUS_SPENT, a.field("proofStorage")[pa * CashuApplet.PROOF_SIZE]);
    }

    // =========================================================================
    // Bad points and bad forms
    // =========================================================================

    @Test
    @DisplayName("D206: every case the chip was tried with that is no point of the curve in its one encoding is refused 6A80 with nothing written: no-curve x, the twist, wrong y, y +- 1, the other root + 1, y = 0, x = p, x = 2^256 - 1, y = p, y = p + 1, y = 2^256 - 1, wraps, zeros, P-256's G and y, every other prefix")
    void badPointsAreRefused() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Map<String, byte[]> before = kept(c);
        byte[] piece = c.piece(UnitsTest.SAT_A, 8);
        for (Map.Entry<String, byte[]> e : bad().entrySet()) {
            assertEquals(65, e.getValue().length, e.getKey());
            assertEquals(SW_WRONG_DATA, loadFull(c, fullPiece(piece, e.getValue())).getSW(), e.getKey());
            for (Map.Entry<String, byte[]> k : before.entrySet()) assertArrayEquals(k.getValue(), c.field(k.getKey()), e.getKey() + ": nothing written in " + k.getKey());
        }
        // with the mint's proof (P1 = 1) the same: 6A80, nothing written
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, P2_FULL, concat(fullPiece(piece, bad().get("G with y + 1")), filled(96, 1)), 256)), "with a proof");
        c.assertUnchanged(before, "with a proof");
        // and the good piece goes on after them
        assertEquals(SW_OK, loadFull(c, fullPiece(c.piece(UnitsTest.SAT_A, 8), whole(hexToBytes(GOOD[0])))).getSW());
        assertEquals(8, readUint32(c.balance(0), 0));
        assertEquals(1, c.count());
    }

    @Test
    @DisplayName("D206: lengths are the card's own: a piece of 112 or 114 bytes, the 33-byte C sent with P2 08 (81 bytes, and 81 + 96 with P1 = 1), a 33-byte C of prefix 04, a C of 66 bytes, three and a half pieces, a proof a byte short or long: 6700, nothing written; P2 08 without bit 1 is 6A86, bit 2 (04) and bits past 3 are 6B00")
    void lengthsAndBits() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Map<String, byte[]> before = kept(c);
        byte[] piece = c.piece(UnitsTest.SAT_A, 8), fp = fullPiece(piece, whole(hexToBytes(GOOD[0])));
        assertEquals(113, fp.length);
        byte[] c04 = withC(piece, Arrays.copyOf(G, 33));
        for (byte[] d : new byte[][] { Arrays.copyOf(fp, 112), Arrays.copyOf(fp, 114), piece, c04,
                                       concat(Arrays.copyOfRange(piece, 0, 44), G, new byte[] { 0 }, Arrays.copyOfRange(piece, 77, 81)),
                                       concat(fp, fp, Arrays.copyOf(fp, 56)) }) {
            assertEquals(SW_WRONG_LENGTH, loadFull(c, d).getSW(), d.length + " bytes");
        }
        for (int n : new int[] { 95, 97 }) {
            assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, P2_FULL, concat(fp, new byte[n]), 256)), "a proof of " + n);
        }
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, P2_FULL, concat(piece, filled(96, 1)), 256)), "the 33-byte form with a proof");
        assertEquals(0x6A86, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 0x08, fp, 256)), "the 04 form without the word on keys per load");
        for (int p2 : new int[] { 0x04, 0x06, 0x0E, 0x0F, 0x12, 0x1A, 0x80 }) {
            assertEquals(0x6B00, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, p2, fp, 256)), "P2 " + p2);
        }
        c.assertUnchanged(before, "nothing written");
        assertEquals(SW_OK, loadFull(c, fp).getSW(), "and the piece goes on");
    }

    // =========================================================================
    // The set-up's test of the agreement
    // =========================================================================

    static boolean curveByAgreement(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("curveByAgreement");
        f.setAccessible(true);
        return f.getBoolean(c.applet());
    }
    static void setCurveByAgreement(UnitsTest.Card c, boolean v) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("curveByAgreement");
        f.setAccessible(true);
        f.setBoolean(c.applet(), v);
    }
    static Object schnorr(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("schnorrHW");
        f.setAccessible(true);
        return f.get(c.applet());
    }
    /** SchnorrHW.checksCurve, the set-up's test, run again (by reflection: this file is compiled against the build before D206 too, to fail first). */
    static boolean checks(SchnorrHW s) throws Exception {
        java.lang.reflect.Method m = SchnorrHW.class.getDeclaredMethod("checksCurve");
        m.setAccessible(true);
        return (Boolean) m.invoke(s);
    }
    static java.lang.reflect.Field ecdhField() throws Exception {
        java.lang.reflect.Field f = SchnorrHW.class.getDeclaredField("ecdh");
        f.setAccessible(true);
        return f;
    }

    /** An agreement that takes every point (a chip that does not hold to the curve: good points answered right, others with made-up bytes), or refuses every one, around the real one. */
    static final class Agreement extends KeyAgreement {
        final KeyAgreement real;
        final boolean takesAll;
        Agreement(KeyAgreement real, boolean takesAll) { this.real = real; this.takesAll = takesAll; }
        @Override public void init(PrivateKey k) { real.init(k); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] p, short off, short len, byte[] out, short outOff) {
            if (!takesAll) CryptoException.throwIt(CryptoException.ILLEGAL_VALUE);
            try {
                return real.generateSecret(p, off, len, out, outOff);
            } catch (RuntimeException x) {
                // a point off the curve, answered as if it were one
                Arrays.fill(out, outOff, outOff + 65, (byte) 1);
                out[outOff] = 4;
                return (short) 65;
            }
        }
    }

    @Test
    @DisplayName("D206: the set-up's test of the agreement: false before the first SET_CARD (none in the constructor), then the simulator's holds (G taken, G with y + 1 refused); an agreement that takes every point fails it, and so does one that refuses every point; a SET_CARD on such a chip keeps the 04 form refused (6B00)")
    void theInstallTestsTheAgreement() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertFalse(curveByAgreement(c), "nothing known before the first SET_CARD: the constructor runs no agreement (the chip's first create is kept light)");
        c.ready(UnitsTest.SAT, false);
        assertTrue(curveByAgreement(c), "set at the first SET_CARD");
        SchnorrHW s = (SchnorrHW) schnorr(c);
        assertTrue(checks(s));
        KeyAgreement real = (KeyAgreement) ecdhField().get(s);
        try {
            ecdhField().set(s, new Agreement(real, true));
            assertFalse(checks(s), "a chip that takes a point off the curve is not leaned on");
            ecdhField().set(s, new Agreement(real, false));
            assertFalse(checks(s), "nor one that refuses G");
        } finally {
            ecdhField().set(s, real);
        }
        assertTrue(checks(s));
        // a SET_CARD on a chip whose agreement takes every point: the flag goes false and the 04 form is 6B00
        UnitsTest.Card d = new UnitsTest.Card();
        SchnorrHW ds = (SchnorrHW) schnorr(d);
        KeyAgreement dreal = (KeyAgreement) ecdhField().get(ds);
        ecdhField().set(ds, new Agreement(dreal, true));
        try {
            assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
            d.pin();
            assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))), "set up: the framing check's points are all on the curve");
        } finally {
            ecdhField().set(ds, dreal);
        }
        assertFalse(curveByAgreement(d), "a chip that takes off-curve points: the flag is false");
        d.pin();
        assertEquals(0x6B00, loadFull(d, fullPiece(d.piece(UnitsTest.SAT_A, 8), whole(hexToBytes(GOOD[0])))).getSW());
    }

    @Test
    @DisplayName("D206: on a chip whose agreement failed the set-up's test the 04 form is 6B00 before anything is read (one piece, two, with a proof) and nothing is written; the 33-byte form goes on as ever and the same piece is stored as it would be")
    void aChipThatFailedTheTestTakesOnlyTheShortForm() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        setCurveByAgreement(c, false);
        Map<String, byte[]> before = kept(c);
        byte[] piece = withC(c.piece(UnitsTest.SAT_A, 8), hexToBytes(GOOD[1])), fp = fullPiece(piece, whole(hexToBytes(GOOD[1])));
        assertEquals(0x6B00, loadFull(c, fp).getSW());
        assertEquals(0x6B00, loadFull(c, fp, fp).getSW());
        assertEquals(0x6B00, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, P2_FULL, concat(fp, filled(96, 1)), 256)));
        assertEquals(0x6B00, loadFull(c, new byte[3]).getSW(), "before the length is looked at");
        c.assertUnchanged(before, "nothing written");
        assertEquals(SW_OK, c.load(piece).getSW(), "the 33-byte form");
        assertEquals(8, readUint32(c.balance(0), 0));
    }
}
