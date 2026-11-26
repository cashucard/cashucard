package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.payWithChange;
import static me.flashapp.cashu.KeysetKeysTest.show;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;
import javacard.framework.ISOException;
import javacard.security.CryptoException;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.Key;
import javacard.security.KeyBuilder;
import javacard.security.RSAPrivateKey;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import javacardx.crypto.Cipher;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D214, D215, D216 (and D213 beside them): what the card asks of the chip's own engines, and what it does where a chip does
 * not hold to them.
 *
 *   D214  the field's arithmetic on the chip's RSA with p itself, padded to 64 bytes, for the modulus: the answer is under p at
 *         once (no reduction by bytecode); keys made and held to known answers at SET_CARD, the p*p keys kept as the fallback;
 *   D215  LOAD_CHANGE's K, C_ and the unblinded C held to the curve by the chip's key agreement (D212's), where the set-up's
 *         test of the agreement held;
 *   D216  e*d mod n in the signature by two squarings on the RSA engine (modulus n padded), 4ab = (a+b)^2 - (a-b)^2, its inputs
 *         reduced below n first, the bytecode multiplication kept as the fallback; its known answers held at SET_CARD.
 *
 * jCardSim refuses a padded modulus ("not composite"), so a test of the engine path puts an engine of its own in the card's
 * place: `Engine` computes with BigInteger what the chip's RSA does (a power mod the key's modulus, 64 bytes in and out), and,
 * as the chip does, answers garbage for an input at or over the modulus. The card makes its own keys' moduli and exponents
 * into the keys it is given (`Key`), so the engine can only be right if the card set them right.
 */
class ChipEnginesTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger P = new BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16);
    static final BigInteger N = new BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);
    /** The root's exponent, (p+1)/4 + (p-1)/2: odd, and for a square v the root of it, v^((p+1)/4), as v^((p-1)/2) is 1. */
    static final BigInteger ROOT_EXP = P.add(BigInteger.ONE).shiftRight(2).add(P.subtract(BigInteger.ONE).shiftRight(1));
    static final BigInteger GX = new BigInteger("79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", 16);
    static final BigInteger GY = new BigInteger("483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", 16);

    // =========================================================================
    // The chip's RSA, as a test has it
    // =========================================================================

    /** An RSA key that keeps whatever modulus and exponent the card sets in it. */
    static final class FakeKey implements RSAPrivateKey {
        BigInteger mod, exp;
        int modLen;
        public void setModulus(byte[] b, short o, short l) { mod = new BigInteger(1, Arrays.copyOfRange(b, o, o + l)); modLen = l; }
        public void setExponent(byte[] b, short o, short l) { exp = new BigInteger(1, Arrays.copyOfRange(b, o, o + l)); }
        public short getModulus(byte[] b, short o) { return 0; }
        public short getExponent(byte[] b, short o) { return 0; }
        public boolean isInitialized() { return mod != null && exp != null; }
        public void clearKey() { mod = null; exp = null; }
        public byte getType() { return KeyBuilder.TYPE_RSA_PRIVATE; }
        public short getSize() { return KeyBuilder.LENGTH_RSA_512; }
    }

    /**
     * The chip's RSA for a FakeKey: x^e mod m for the 64 bytes in, 64 bytes out; for x at or over m, garbage (what the chip
     * answers: no error). `lie` makes it wrong (the last byte of every answer changed), `refuse` makes every use throw. A key
     * that is not a FakeKey goes to the real engine (the simulator's), if there is one.
     *
     * As a chip's engine (D248, the red team's A3-e): init copies the key's modulus and exponent, so a key written after it is
     * not seen until the next init; and what it was given is lost at `forget` (a power cut or a selection: the card's
     * `onSelect`), after which a power throws INVALID_INIT, as a chip's may, until it is given a key again.
     */
    static class Engine extends Cipher {
        final Cipher real;
        FakeKey key;
        BigInteger mod, exp;
        boolean held;
        int powers, oldPowers, garbage;
        /** Every init, of a FakeKey (D247: an engine is given its key once a command; D248, once a selection). */
        int inits;
        /** Every power asked of it while it held nothing (D248): each one answered INVALID_INIT. */
        int stale;
        boolean lie, refuse;
        /** Every power's key modulus, in order. */
        final List<BigInteger> moduli = new ArrayList<>();
        Engine(Cipher real) { this.real = real; }
        void forget() { held = false; }
        @Override public void init(Key k, byte m) throws CryptoException {
            held = true;
            if (k instanceof FakeKey) { key = (FakeKey) k; mod = key.mod; exp = key.exp; inits++; return; }
            key = null;
            real.init(k, m);
        }
        @Override public void init(Key k, byte m, byte[] b, short o, short l) throws CryptoException { init(k, m); }
        @Override public byte getAlgorithm() { return Cipher.ALG_RSA_NOPAD; }
        @Override public byte getPaddingAlgorithm() { return Cipher.PAD_NULL; }
        @Override public byte getCipherAlgorithm() { return Cipher.ALG_RSA_NOPAD; }
        @Override public short update(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException { throw new UnsupportedOperationException(); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException {
            if (!held) { stale++; CryptoException.throwIt(CryptoException.INVALID_INIT); }
            if (key == null) { oldPowers++; return real.doFinal(a, o, l, out, oo); }
            if (refuse) CryptoException.throwIt(CryptoException.ILLEGAL_VALUE);
            powers++;
            moduli.add(mod);
            assertEquals(64, l, "the chip's RSA takes the modulus' length");
            BigInteger x = new BigInteger(1, Arrays.copyOfRange(a, o, o + l)), r;
            if (x.compareTo(mod) >= 0) {
                garbage++;
                r = new BigInteger(1, sha256(a, o, l)).shiftLeft(256).xor(BigInteger.valueOf(0x5A5A5A5AL));
            } else {
                r = x.modPow(exp, mod);
            }
            if (lie) r = r.xor(BigInteger.ONE);
            byte[] b = r.toByteArray(), res = new byte[64];
            System.arraycopy(b, Math.max(0, b.length - 64), res, 64 - Math.min(64, b.length), Math.min(64, b.length));
            System.arraycopy(res, 0, out, oo, 64);
            return 64;
        }
        private static byte[] sha256(byte[] a, int o, int l) { return CashuAppletTest.sha256(Arrays.copyOfRange(a, o, o + l)); }
    }

    static Object get(Object owner, Class<?> cls, String name) throws Exception {
        java.lang.reflect.Field f = cls.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(owner);
    }
    static void set(Object owner, Class<?> cls, String name, Object v) throws Exception {
        java.lang.reflect.Field f = cls.getDeclaredField(name);
        f.setAccessible(true);
        f.set(owner, v);
    }
    static boolean flag(Object owner, Class<?> cls, String name) throws Exception { return (Boolean) get(owner, cls, name); }
    static SchnorrHW signerOf(UnitsTest.Card c) throws Exception { return (SchnorrHW) get(c.applet(), CashuApplet.class, "schnorrHW"); }

    /**
     * The engines a card is given in place of the chip's: `field` for the p*p keys and the padded keys' known answers (`rsa`),
     * `own` the four padded keys' engines of their own (D247: the cube's, the root's, Euler's, the square's), `sign` for the
     * signature's squaring. Every Cipher the applet makes is one of these (the red team's A3-e).
     */
    static final class Engines {
        Engine field, sign;
        final Engine[] own = new Engine[4];
        Engine[] all() { return new Engine[] { field, own[0], own[1], own[2], own[3], sign }; }
        /** A power cut or a selection: every engine loses what it was given. */
        void forget() { for (Engine x : all()) x.forget(); }
        /** The field's padded powers, on `rsa` and the engines of their own. */
        int fieldPowers() { int n = field.powers; for (Engine x : own) n += x.powers; return n; }
        int fieldGarbage() { int n = field.garbage; for (Engine x : own) n += x.garbage; return n; }
        List<BigInteger> fieldModuli() { List<BigInteger> m = new ArrayList<>(field.moduli); for (Engine x : own) m.addAll(x.moduli); return m; }
        int stale() { int n = 0; for (Engine x : all()) n += x.stale; return n; }
        void zero() { for (Engine x : all()) { x.powers = 0; x.oldPowers = 0; x.garbage = 0; } }
    }
    static final String[] OWN = { "rsaCubeE", "rsaRootE", "rsaEulerE", "rsaSquareE" };

    /** A card (not yet set up) whose chip is `Engine`s: the card's own RSA wrapped with fake padded keys (the square's too), the padded keys' own engines, and the signer's squaring engine; each forgets what it was given at every selection, as a chip's may. */
    static UnitsTest.Card unsetCard(Engines e) throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        Object applet = c.applet();
        e.field = new Engine((Cipher) get(applet, CashuApplet.class, "rsa"));
        set(applet, CashuApplet.class, "rsa", e.field);
        set(applet, CashuApplet.class, "rsaCubeP", new FakeKey());
        set(applet, CashuApplet.class, "rsaRootP", new FakeKey());
        set(applet, CashuApplet.class, "rsaEulerP", new FakeKey());
        set(applet, CashuApplet.class, "rsaSquareP", new FakeKey());
        for (int i = 0; i < 4; i++) {
            e.own[i] = new Engine(null);
            set(applet, CashuApplet.class, OWN[i], e.own[i]);
        }
        e.sign = new Engine(null);
        SchnorrHW s = signerOf(c);
        set(s, SchnorrHW.class, "rsaC", e.sign);
        set(s, SchnorrHW.class, "sqKey", new FakeKey());
        c.onSelect.add(e::forget);
        return c;
    }
    /** A card set up on those engines, with the owner's grant in the tap (as KeysetKeysTest.card). */
    static UnitsTest.Card setUpCard(Engines e) throws Exception {
        UnitsTest.Card c = unsetCard(e).ready(UnitsTest.SAT, true);
        c.grant();
        return c;
    }

    // =========================================================================
    // On the simulator, which refuses the padded keys: the old paths, and nothing lost
    // =========================================================================

    @Test
    @DisplayName("D214, D216: the simulator refuses the padded keys: a SET_CARD on it succeeds all the same, and leaves fieldP and chipMul false (the p*p keys and the bytecode multiplication stay in use); false before any SET_CARD; a payment with change and its LOAD_CHANGE are then right as ever (the change's C is k * hash_to_curve(its secret))")
    void theSimulatorKeepsTheOldPaths() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertFalse(flag(c.applet(), CashuApplet.class, "fieldP"), "nothing known before the first SET_CARD");
        assertFalse(flag(signerOf(c), SchnorrHW.class, "chipMul"), "nor of the signature's engine");
        c.ready(UnitsTest.SAT, true);
        assertFalse(flag(c.applet(), CashuApplet.class, "fieldP"), "the simulator refuses the padded modulus: the old keys stay");
        assertFalse(flag(signerOf(c), SchnorrHW.class, "chipMul"), "and the signature's squaring");
        c.grant();
        changeIsRight(c, 4);
    }

    /** Pays a piece of 512 with `n` change outputs (1, 2, 4 ...) and writes them all back: each loaded piece's C is held to k * hash_to_curve(its secret), as NUT-00 makes the point. */
    static void changeIsRight(UnitsTest.Card c, int n) throws Exception {
        taught(c, A);
        int place = c.put(-1, A.id8(), 512);
        assertEquals(SW_OK, c.begin(place).getSW());
        for (int i = 0; i < n; i++) assertEquals(SW_OK, c.send(changeCommand(1L << i, A.keyFor(1L << i), hexToBytes(A.id8()))).getSW(), "change output " + i);
        assertEquals(64, c.sign().getData().length, "signed");
        c.power();
        DateKeys keys = DateKeys.of(c.applet());
        byte[] opens = c.field("changeOpen");
        List<byte[]> rows = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            byte[] d = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, page, 0, 256)).getData();
            for (int i = 0; i < (d[0] & 0xFF); i++) rows.add(Arrays.copyOfRange(d, 1 + 83 * i, 1 + 83 * (i + 1)));
        }
        assertEquals(n, rows.size());
        for (byte[] row : rows) {
            long amount = readUint32(row, 1);
            byte[] kept = Arrays.copyOfRange(opens, CashuApplet.OPEN_LEN * (row[0] & 0xFF), CashuApplet.OPEN_LEN * ((row[0] & 0xFF) + 1));
            byte[] secret = new DateKeys(keys.card, REFUND, keys.c).secret(Arrays.copyOfRange(kept, 16, 48), readUint32(kept, 12)).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            BigInteger[] y = hashToCurve(secret);
            assertEquals(SW_OK, show(c, row[0], A, amount));
            ResponseAPDU r = KeysetKeysTest.loadChange(c, row, A.privFor(amount));
            assertEquals(SW_OK, r.getSW(), "the change of " + amount + " written back");
            byte[] cc = Arrays.copyOfRange(r.getData(), 2 + 44, 2 + 77);
            assertArrayEquals(compressed(ecMulTest(A.privFor(amount), y[0], y[1])), cc, "C = k * hash_to_curve(secret) for the change of " + amount);
        }
        assertEquals(n, rows.size(), "every output written back");
    }

    // =========================================================================
    // D214: the field's arithmetic on the chip's RSA with p padded
    // =========================================================================

    @Test
    @DisplayName("D214: on an engine that holds, SET_CARD makes the three padded keys (modulus p, 32 zero bytes before it, 64 in all; the exponents of the cube, Euler's test and the root), runs their known answers (2^3, Euler 4, root 4, and the cube, Euler's test and root of G's curve side) and sets fieldP; a payment with change then makes every change point (hash_to_curve, NUT-00) and writes it back through the padded keys alone: not one power of the p*p keys")
    void thePaddedKeysDoTheField() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = unsetCard(e);
        c.ready(UnitsTest.SAT, true);
        c.grant();
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"), "the self-test held");
        for (BigInteger m : e.fieldModuli()) assertEquals(P, m, "every power so far is mod p");
        Object applet = c.applet();
        for (String n : new String[] { "rsaCubeP", "rsaRootP", "rsaEulerP" }) {
            FakeKey k = (FakeKey) get(applet, CashuApplet.class, n);
            assertEquals(P, k.mod, n + "'s modulus is p");
            assertEquals(64, k.modLen, n + "'s modulus is 64 bytes: p padded with zeros before it");
        }
        assertEquals(BigInteger.valueOf(3), ((FakeKey) get(applet, CashuApplet.class, "rsaCubeP")).exp);
        assertEquals(P.subtract(BigInteger.ONE).shiftRight(1), ((FakeKey) get(applet, CashuApplet.class, "rsaEulerP")).exp);
        assertEquals(ROOT_EXP, ((FakeKey) get(applet, CashuApplet.class, "rsaRootP")).exp, "the root's exponent is the p*p key's: (p+1)/4 + (p-1)/2, odd as an RSA exponent is, and the same root of a square");
        e.zero();
        changeIsRight(c, 8);
        assertTrue(e.fieldPowers() > 8 * 3, "the padded keys did the cube, Euler's test and the root of every change point and of every piece written back");
        assertEquals(0, e.field.oldPowers, "no power of the p*p keys");
        assertEquals(0, e.fieldGarbage(), "and not one input at or over the modulus (p): the chip answers garbage there");
    }

    @Test
    @DisplayName("D214/D216: where the padded keys fail their known answers (an engine that answers wrong, one that refuses every power, one that answers 8 for the cube of 2 but is wrong on a full-width value), fieldP stays false, the SET_CARD succeeds, and the change is right on the p*p keys")
    void aFieldEngineThatFailsIsNotUsed() throws Exception {
        for (String how : new String[] { "lie", "refuse", "wide" }) {
            Engines e = new Engines();
            UnitsTest.Card c = unsetCard(e);
            if (how.equals("lie")) e.field.lie = true;
            if (how.equals("refuse")) e.field.refuse = true;
            if (how.equals("wide")) {
                // right on small values, wrong above 2^128: a chip whose engine drops the high bytes
                set(c.applet(), CashuApplet.class, "rsa", new Engine((Cipher) get(c.applet(), CashuApplet.class, "rsa")) {
                    @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
                        short n = super.doFinal(a, o, l, out, oo);
                        if (key != null && !isZero16(out, oo + 32)) Arrays.fill(out, oo + 32, oo + 48, (byte) 0);
                        return n;
                    }
                    boolean isZero16(byte[] b, int off) { for (int i = 0; i < 16; i++) if (b[off + i] != 0) return false; return true; }
                });
            }
            c.ready(UnitsTest.SAT, true);
            assertFalse(flag(c.applet(), CashuApplet.class, "fieldP"), how + ": the padded keys are not leaned on");
            c.grant();
            changeIsRight(c, 3);
        }
    }

    @Test
    @DisplayName("D214: a padded power of an x at or over p is refused (6F00, nothing computed): the chip answers garbage for it, so the card never asks; the callers' x are under p, and a value at p and over p is stopped where the card would otherwise take the garbage")
    void aValueAtOrOverPIsNeverGivenToThePaddedKeys() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"));
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod("powModP", RSAPrivateKey.class, byte[].class, short.class);
        m.setAccessible(true);
        RSAPrivateKey cube = (RSAPrivateKey) get(c.applet(), CashuApplet.class, "rsaCube");
        for (BigInteger x : new BigInteger[] { P, P.add(BigInteger.ONE), BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE) }) {
            byte[] a = new byte[128];
            System.arraycopy(unsigned32(x), 0, a, 32, 32);
            int before = e.fieldPowers();
            java.lang.reflect.InvocationTargetException t = assertThrows(java.lang.reflect.InvocationTargetException.class, () -> m.invoke(c.applet(), cube, a, (short) 0));
            assertTrue(t.getCause() instanceof ISOException, "refused: " + t.getCause());
            assertEquals(CashuApplet.SW_CRYPTO_ERROR, ((ISOException) t.getCause()).getReason());
            assertEquals(before, e.fieldPowers(), "no power was asked of the engine");
        }
        // and the values under p are the engine's: p - 1 cubed is p - 1
        byte[] a = new byte[128];
        System.arraycopy(unsigned32(P.subtract(BigInteger.ONE)), 0, a, 32, 32);
        m.invoke(c.applet(), cube, a, (short) 0);
        assertArrayEquals(unsigned32(P.subtract(BigInteger.ONE)), Arrays.copyOfRange(a, 96, 128));
    }

    @Test
    @DisplayName("D214: the padded powers against Python's: 75 values (0, 1, 2, p - 1, p - 2, G's x and y, the half of p, and random ones) each cubed, raised to (p - 1)/2 and to (p + 1)/4, the answers under p at once and equal to pow(x, e, p)")
    void paddedPowersAreRight() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"));
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod("powModP", RSAPrivateKey.class, byte[].class, short.class);
        m.setAccessible(true);
        Random rnd = new Random(2311);
        List<BigInteger> xs = new ArrayList<>(Arrays.asList(BigInteger.ZERO, BigInteger.ONE, BigInteger.TWO, P.subtract(BigInteger.ONE), P.subtract(BigInteger.TWO), GX, GY, P.shiftRight(1), P.shiftRight(1).add(BigInteger.ONE)));
        while (xs.size() < 25) xs.add(new BigInteger(256, rnd).mod(P));
        String[] keys = { "rsaCube", "rsaEuler", "rsaRoot" };
        BigInteger[] exps = { BigInteger.valueOf(3), P.subtract(BigInteger.ONE).shiftRight(1), ROOT_EXP };
        int n = 0;
        for (BigInteger x : xs) {
            for (int k = 0; k < 3; k++) {
                byte[] a = new byte[128];
                System.arraycopy(unsigned32(x), 0, a, 32, 32);
                m.invoke(c.applet(), get(c.applet(), CashuApplet.class, keys[k]), a, (short) 0);
                BigInteger want = x.modPow(exps[k], P);
                assertEquals(want, new BigInteger(1, Arrays.copyOfRange(a, 96, 128)), keys[k] + " of " + x.toString(16));
                assertArrayEquals(new byte[32], Arrays.copyOfRange(a, 64, 96), "under p: the answer's high half is zero");
                n++;
            }
        }
        assertEquals(75, n);
    }

    @Test
    @DisplayName("D214: hash_to_curve through the padded keys, NUT-00's way: 40 change secrets' points (five payments of eight outputs, each with its own random nonce, so the counters run from 0 to several) found by the card are k * the reference's Y (see changeIsRight), the Euler test taking a counter only where x^3 + 7 is a square")
    void hashToCurveByThePaddedKeys() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        e.field.oldPowers = 0;   // the set-up's own (the refund key's y, the owner's point) are the p*p keys'
        for (int i = 0; i < 5; i++) {
            changeIsRight(c, 8);
            c.tap();
            c.grant();
        }
        assertEquals(0, e.field.oldPowers);
    }

    // =========================================================================
    // D215: the curve test of LOAD_CHANGE's points by the chip's key agreement
    // =========================================================================

    /** A LOAD_CHANGE of a payment of 64 with one change output of 8, run on `c` after wrapping the card's engines: the counts it made. */
    static int[] loadChangeCounts(UnitsTest.Card c, boolean byAgreement) throws Exception {
        Object applet = c.applet();
        PerPaymentKeyTest.CountingCipher rsa = (PerPaymentKeyTest.CountingCipher) PerPaymentKeyTest.wrap(applet, CashuApplet.class, "rsa", o -> new PerPaymentKeyTest.CountingCipher((Cipher) o));
        PerPaymentKeyTest.CountingAgreement ecdh = (PerPaymentKeyTest.CountingAgreement) PerPaymentKeyTest.wrap(signerOf(c), SchnorrHW.class, "ecdh", o -> new PerPaymentKeyTest.CountingAgreement((javacard.security.KeyAgreement) o));
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("curveByAgreement");
        f.setAccessible(true);
        f.setBoolean(applet, byAgreement);
        taught(c, A);
        int place = c.put(-1, A.id8(), 64);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 8));
        int p0 = rsa.powers, a0 = ecdh.made;
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(8)).getSW());
        return new int[] { rsa.powers - p0, ecdh.made - a0 };
    }

    @Test
    @DisplayName("D215: LOAD_CHANGE's K, C_ and the unblinded C are held to the curve by the chip's key agreement (three agreements, and no Euler test of theirs: the RSA does nothing, 3.2 keeping the opening's B_ whole); where the set-up's agreement test did not hold, the old tests run (six powers with the square, no extra agreement)")
    void loadChangeChecksByAgreement() throws Exception {
        int[] by = loadChangeCounts(KeysetKeysTest.card(), true), old = loadChangeCounts(KeysetKeysTest.card(), false);
        // 3.2 (D244): B_ is kept whole (its y beside it), so its cube and root are gone from both paths
        assertEquals(0, by[0], "by the agreement: no RSA power at all, B_ kept whole");
        assertEquals(6, old[0], "by Euler's test: K's two and C_'s two (by the square, D244: a cube and a square where a cube, Euler and a root were three), and the unblinded C's cube and Euler");
        assertEquals(3, by[1] - old[1], "and three key agreements more");
    }

    @Test
    @DisplayName("D215: a K or a C_ off the curve is refused 6A80 by the agreement path and by the old path alike, with the opening still owed; so is a C_ that is no point at all, and the unblinded C's own check never takes a bad C (a K moved off by one on the wrong curve side): the piece is not written")
    void offCurvePointsAreRefusedEitherWay() throws Exception {
        for (boolean byAgreement : new boolean[] { true, false }) {
            UnitsTest.Card c = KeysetKeysTest.card();
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("curveByAgreement");
            f.setAccessible(true);
            f.setBoolean(c.applet(), byAgreement);
            taught(c, A);
            int place = c.put(-1, A.id8(), 64);
            byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
            c.power();
            assertEquals(SW_OK, show(c, row[0], A, 8));
            byte[] answer = mintAnswer(A.privFor(8), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
            assertEquals(194, answer.length);
            Map<String, byte[]> before = c.snapshot();
            for (int at : new int[] { 64, 63 + 65, 1, 33, 130 - 1, 65 + 40 }) {
                byte[] bad = answer.clone();
                bad[at] ^= 1;
                int sw = c.sw(loadChangeCommand(row[0], bad));
                assertEquals(SW_WRONG_DATA, sw, "byte " + at + " changed, by agreement " + byAgreement);
            }
            c.assertUnchanged(before, "nothing written");
            assertEquals(SW_OK, c.sw(loadChangeCommand(row[0], answer)), "and the right answer still goes on, by agreement " + byAgreement);
        }
    }

    @Test
    @DisplayName("D215: a chip whose key agreement takes every point fails the set-up's test: curveByAgreement false, so LOAD_CHANGE tests its points by Euler's test and refuses an off-curve C_ 6A80, which the lying agreement would have taken")
    void aLyingAgreementIsNotLeanedOn() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        SchnorrHW s = signerOf(c);
        javacard.security.KeyAgreement real = (javacard.security.KeyAgreement) FullPointLoadTest.ecdhField().get(s);
        FullPointLoadTest.ecdhField().set(s, new FullPointLoadTest.Agreement(real, true));
        c.ready(UnitsTest.SAT, true);
        c.grant();
        assertFalse(FullPointLoadTest.curveByAgreement(c), "the test failed");
        taught(c, A);
        int place = c.put(-1, A.id8(), 64);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 8));
        byte[] answer = mintAnswer(A.privFor(8), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
        byte[] offCurve = answer.clone();
        offCurve[64] ^= 1;
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(row[0], offCurve)), "an off-curve C_ is refused by Euler's test");
    }

    // =========================================================================
    // D216: e * d mod n on the chip's RSA
    // =========================================================================

    static byte[] be(BigInteger v) { return unsigned32(v); }

    /** The signature engine on a signer of its own: `chipMulInit` run on `engine`'s FakeKey. */
    static SchnorrHW signerWith(Engine engine) throws Exception {
        SchnorrHW s = new SchnorrHW();
        s.init();
        set(s, SchnorrHW.class, "rsaC", engine);
        set(s, SchnorrHW.class, "sqKey", new FakeKey());
        return s;
    }

    static BigInteger product(byte[] a, byte[] b) { return new BigInteger(1, a).multiply(new BigInteger(1, b)).mod(N); }

    @Test
    @DisplayName("D216: the chip's multiplication mod n (two squarings, 4ab = (a+b)^2 - (a-b)^2, two halvings) against Python's: 340 products (0, 1, 2, n - 1, n - 2, n/2, (n+1)/2, 2^255 and the like in every pairing, a*a, and random ones), each the same as a * b mod n; the engine is asked for exactly two squarings, both of inputs under n (it answers garbage over the modulus, and none was given)")
    void theChipsProductsAreRight() throws Exception {
        Engine eng = new Engine(null);
        SchnorrHW s = signerWith(eng);
        assertTrue(s.chipMulInit(), "the squaring's known answers hold");
        eng.powers = 0;
        eng.garbage = 0;
        BigInteger half = N.shiftRight(1);
        BigInteger[] special = { BigInteger.ZERO, BigInteger.ONE, BigInteger.TWO, N.subtract(BigInteger.ONE), N.subtract(BigInteger.TWO), half, half.add(BigInteger.ONE),
            BigInteger.ONE.shiftLeft(255), BigInteger.ONE.shiftLeft(128), GX, GY };
        List<BigInteger[]> pairs = new ArrayList<>();
        for (BigInteger a : special) for (BigInteger b : special) pairs.add(new BigInteger[] { a, b });
        Random rnd = new Random(340);
        while (pairs.size() < 340) pairs.add(new BigInteger[] { new BigInteger(256, rnd).mod(N), new BigInteger(256, rnd).mod(N) });
        byte[] w = new byte[256];
        int n = 0;
        for (BigInteger[] ab : pairs) {
            byte[] a = be(ab[0]), b = be(ab[1]), out = new byte[32];
            s.mulModNChip(a, (short) 0, b, (short) 0, out, (short) 0, w, (short) 0);
            assertEquals(ab[0].multiply(ab[1]).mod(N), new BigInteger(1, out), "a = " + ab[0].toString(16) + " b = " + ab[1].toString(16));
            n++;
        }
        assertEquals(340, n);
        assertEquals(0, eng.garbage, "never an input at or over n");
        assertEquals(2 * 340, eng.powers, "two squarings a product");
        for (BigInteger m : eng.moduli) assertEquals(N, m, "modulus n");
        // and a*a, in one place
        byte[] a = be(GX), out = new byte[32];
        s.mulModNChip(a, (short) 0, a, (short) 0, out, (short) 0, w, (short) 0);
        assertEquals(GX.multiply(GX).mod(N), new BigInteger(1, out));
    }

    @Test
    @DisplayName("D216: inputs at or over n (n, n + 1, 2^256 - 1: a 256-bit value can be over n) are reduced below n before the engine sees them: the product is the product of their residues, and the engine is never given a value at or over its modulus (it answers garbage there); the inputs are reduced where they are, as the doc says")
    void inputsOverNAreReducedFirst() throws Exception {
        Engine eng = new Engine(null);
        SchnorrHW s = signerWith(eng);
        assertTrue(s.chipMulInit());
        eng.powers = 0;
        BigInteger top = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE);
        BigInteger[] vals = { N, N.add(BigInteger.ONE), N.add(BigInteger.valueOf(12345)), top, top.subtract(BigInteger.ONE), BigInteger.valueOf(7) };
        byte[] w = new byte[256];
        for (BigInteger x : vals) {
            for (BigInteger y : vals) {
                byte[] a = be(x), b = be(y), out = new byte[32];
                s.mulModNChip(a, (short) 0, b, (short) 0, out, (short) 0, w, (short) 0);
                assertEquals(x.mod(N).multiply(y.mod(N)).mod(N), new BigInteger(1, out), x.toString(16) + " * " + y.toString(16));
            }
        }
        assertEquals(0, eng.garbage, "the chip was never handed a value at or over n");
    }

    @Test
    @DisplayName("D216: the self-test of the squaring (3^2 = 9, (n - 1)^2 = 1, G's x times G's y both ways round) holds on an engine that holds; an engine that lies, refuses, or is wrong only on a full-width value fails it, and chipMul is then false")
    void theSquaringSelfTest() throws Exception {
        for (String how : new String[] { "ok", "lie", "refuse", "wide" }) {
            Engine eng = new Engine(null) {
                @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
                    short n = super.doFinal(a, o, l, out, oo);
                    if (key != null && how.equals("wide")) {
                        boolean big = false;
                        for (int i = 0; i < 16; i++) if (out[oo + 32 + i] != 0) big = true;
                        if (big) out[oo + 63] ^= 4;
                    }
                    return n;
                }
            };
            eng.lie = how.equals("lie");
            eng.refuse = how.equals("refuse");
            SchnorrHW s = signerWith(eng);
            assertEquals(how.equals("ok"), s.chipMulInit(), how);
            // and the self-test leaves nothing of itself in the signer's work or scratch
            assertTrue(isZero(get(s, SchnorrHW.class, "work"), 0), "work is clear after the self-test: " + how);
        }
    }
    static boolean isZero(Object arr, int from) {
        for (byte b : (byte[]) arr) if (b != 0) return false;
        return true;
    }

    private static ECPrivateKey ecPriv(byte[] d) {
        ECPrivateKey priv = (ECPrivateKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PRIVATE, KeyBuilder.LENGTH_EC_FP_256, false);
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        CashuApplet.curve(priv);
        priv.setS(d, (short) 0, (short) 32);
        return priv;
    }
    private static ECPublicKey ecPub(byte[] w) {
        ECPublicKey pub = (ECPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_EC_FP_PUBLIC, KeyBuilder.LENGTH_EC_FP_256, false);
        CashuApplet.curve(pub);
        pub.setW(w, (short) 0, (short) 65);
        return pub;
    }

    @Test
    @DisplayName("D216, D217: BIP-340 signatures by the chip's multiplication verify: 30 signatures under keys of both P.y parities (and the date form, d + t), 0, 1 and n - 1 among the keys, over random messages; each verified with the BIP-340 reference (schnorrVerify), four squarings a signature (the split of D217), nothing of d or k left in the signer's work or scratch afterwards")
    void signaturesByTheChipVerify() throws Exception {
        Engine eng = new Engine(null);
        SchnorrHW s = signerWith(eng);
        assertTrue(s.chipMulInit());
        s.chipMul = true;
        eng.powers = 0;
        Random rnd = new Random(30);
        List<BigInteger> ds = new ArrayList<>(Arrays.asList(BigInteger.ONE, BigInteger.TWO, BigInteger.valueOf(3), BigInteger.valueOf(6), N.subtract(BigInteger.ONE), N.subtract(BigInteger.TWO)));
        while (ds.size() < 30) ds.add(new BigInteger(255, rnd).add(BigInteger.ONE));
        int odd = 0, even = 0;
        for (BigInteger d : ds) {
            BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
            byte[] w = point65(pt);
            if (pt[1].testBit(0)) odd++; else even++;
            byte[] msg = new byte[32];
            rnd.nextBytes(msg);
            byte[] sig = new byte[64];
            assertEquals(64, s.sign(ecPriv(be(d)), ecPub(w), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig), "the signature under d = " + d.toString(16));
            assertTrue(isZero(get(s, SchnorrHW.class, "sc"), 0), "sc is cleared after the signature");
            assertTrue(isZero(get(s, SchnorrHW.class, "work"), 0), "work is cleared after the signature");
        }
        assertTrue(odd > 3 && even > 3, "both parities: " + odd + " odd, " + even + " even");
        assertEquals(4 * ds.size(), eng.powers, "four squarings a signature (D217: two products, e*d1 and e*d2, of two each; D216 made it two)");
        assertEquals(0, eng.garbage, "of inputs under n alone");
        // keys per load: d + t, the public key P + t*G given after t
        BigInteger d = BigInteger.valueOf(0x123456789ABCDEFL), t = N.subtract(BigInteger.valueOf(5));
        BigInteger[] pd = ecMulTest(d.add(t).mod(N), SECP_GX, SECP_GY);
        byte[] g = concat(be(t), compressed(pd));
        byte[] msg = new byte[32];
        rnd.nextBytes(msg);
        byte[] sig = new byte[64];
        ECPrivateKey priv = ecPriv(be(d));
        // the card's own public key object is given too: D207's check makes Q = W + t*G from it and holds it to the point named
        assertEquals(64, s.sign(priv, ecPub(point65(ecMulTest(d, SECP_GX, SECP_GY))), g, (short) 0, msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pd[0]), msg, sig), "the date's key");
    }

    @Test
    @DisplayName("D216: with chipMul false (a failed self-test, or a chip with no such keys) the signature is by the bytecode multiplication, as before, and verifies; the engine is not asked for anything")
    void withoutTheChipTheBytecodeSigns() throws Exception {
        Engine eng = new Engine(null);
        SchnorrHW s = signerWith(eng);
        eng.refuse = true;
        assertFalse(s.chipMulInit(), "an engine that refuses");
        assertFalse(flag(s, SchnorrHW.class, "chipMul"));
        BigInteger d = BigInteger.valueOf(0xCAFEBABEL);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32], sig = new byte[64];
        Arrays.fill(msg, (byte) 7);
        eng.powers = 0;
        assertEquals(64, s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        assertEquals(0, eng.powers);
    }

    @Test
    @DisplayName("D216: SET_CARD on an engine that holds makes the signature's squaring key (modulus n padded to 64 bytes, exponent 2) and sets chipMul; a payment's SIGN, a held asking's work and AUTH are then signed through it (two squarings each), and the payment's signature is the card's own: it verifies under P + t*G; on a SET_CARD whose engine fails the squaring's test chipMul is false")
    void aCardSignsThroughTheChip() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(signerOf(c), SchnorrHW.class, "chipMul"));
        FakeKey k = (FakeKey) get(signerOf(c), SchnorrHW.class, "sqKey");
        assertEquals(N, k.mod);
        assertEquals(64, k.modLen);
        assertEquals(BigInteger.TWO, k.exp);
        e.sign.powers = 0;
        int place = c.put(-1, A.id8(), 64);
        ResponseAPDU r = c.pay(place);
        assertEquals(SW_OK, r.getSW());
        assertEquals(64, r.getData().length);
        assertTrue(e.sign.powers >= 2 * (1 + c.waits), "the signature and every asking's work went through the chip: " + e.sign.powers + " squarings, " + c.waits + " waits");
        assertEquals(0, e.sign.garbage);
        // a second card whose signing engine lies: the set-up's test fails and the signature is the bytecode's
        Engines f = new Engines();
        UnitsTest.Card d = unsetCard(f);
        f.sign.lie = true;
        d.ready(UnitsTest.SAT, true);
        assertFalse(flag(signerOf(d), SchnorrHW.class, "chipMul"));
        assertTrue(flag(d.applet(), CashuApplet.class, "fieldP"), "the two are decided apart");
        f.sign.powers = 0;
        int p = d.put(-1, A.id8(), 64);
        assertEquals(64, d.pay(p).getData().length);
        assertEquals(0, f.sign.powers);
    }

    @Test
    @DisplayName("D216: the signature through the chip is the same as the bytecode's for the same nonce: with the randomness fixed, s = k + e*d mod n is byte for byte the same either way")
    void theSameSignatureEitherWay() throws Exception {
        BigInteger d = BigInteger.valueOf(0x7777777777L).shiftLeft(100).add(BigInteger.valueOf(31337));
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32];
        Arrays.fill(msg, (byte) 0x42);
        byte[][] sigs = new byte[2][];
        for (int how = 0; how < 2; how++) {
            Engine eng = new Engine(null);
            SchnorrHW s = signerWith(eng);
            assertTrue(s.chipMulInit());
            s.chipMul = how == 1;
            // the same randomness: an RandomData that gives the same bytes every time
            set(s, SchnorrHW.class, "rng", new javacard.security.RandomData() {
                @Override public void generateData(byte[] b, short o, short l) { for (short i = 0; i < l; i++) b[(short)(o + i)] = (byte) (i + 1); }
                @Override public short nextBytes(byte[] b, short o, short l) { generateData(b, o, l); return (short)(o + l); }
                @Override public void setSeed(byte[] b, short o, short l) { }
                @Override public byte getAlgorithm() { return ALG_SECURE_RANDOM; }
            });
            byte[] sig = new byte[64];
            s.sign(ecPriv(be(d)), ecPub(point65(pt)), msg, (short) 0, sig, (short) 0);
            sigs[how] = sig;
            assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        }
        assertArrayEquals(sigs[0], sigs[1], "the same signature, bytecode and chip");
    }
}
