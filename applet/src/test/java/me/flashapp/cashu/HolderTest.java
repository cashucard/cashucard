package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.CLAIM_ASKINGS;
import static me.flashapp.cashu.CashuAppletTest.HISTORY_ASKINGS;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_CHANGE;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_INFO;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_LOG;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_NONCE;
import static me.flashapp.cashu.CashuAppletTest.INS_REFRESH;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_LIMIT;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_OWNER;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_VERIFY_PIN;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.L_OWNER;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.MINT;
import static me.flashapp.cashu.CashuAppletTest.NEW_PIN;
import static me.flashapp.cashu.CashuAppletTest.NO_REFUND;
import static me.flashapp.cashu.CashuAppletTest.OTHER_OWNER;
import static me.flashapp.cashu.CashuAppletTest.OWNER;
import static me.flashapp.cashu.CashuAppletTest.REFUND;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SW_CARD_IN_USE;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_INCORRECT_P1P2;
import static me.flashapp.cashu.CashuAppletTest.SW_KEEP_HOLDING;
import static me.flashapp.cashu.CashuAppletTest.SW_NO_CARD_RECORD;
import static me.flashapp.cashu.CashuAppletTest.SW_NO_PIN;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_GRANT;
import static me.flashapp.cashu.CashuAppletTest.SW_OWNER_PROOF;
import static me.flashapp.cashu.CashuAppletTest.SW_PIN_BLOCKED;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.T0;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.WRONG_PIN;
import static me.flashapp.cashu.CashuAppletTest.blockAt;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.keyOf;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.ownerProof;
import static me.flashapp.cashu.CashuAppletTest.readUint32;
import static me.flashapp.cashu.CashuAppletTest.record;
import static me.flashapp.cashu.CashuAppletTest.setOwnerOpenCommand;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.TILL;
import static me.flashapp.cashu.KeysetKeysTest.lastRow;
import static me.flashapp.cashu.KeysetKeysTest.loadChange;
import static me.flashapp.cashu.KeysetKeysTest.payWithChange;
import static me.flashapp.cashu.KeysetKeysTest.rebind;
import static me.flashapp.cashu.KeysetKeysTest.shown;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.Arrays;

/**
 * The owner claimed slowly (3.0, D187) and a holder with no phone (3.0, D189): SET_OWNER on a card with no owner is a claim of
 * six askings under the PIN, never in a time in the field that paid, after which that time in the field pays nothing; the
 * card of a holder with no phone is loaded and set under its PIN, its history held for over ten askings, and a held tap
 * stands where the owner's grant or proof stands; a factory record is no record; REFRESH P1 = 1. And the owner's key is a
 * point of P-256, which the card checks itself.
 *
 * A phone sends a held command again for as long as the card answers 6A98; the tests here send each asking themselves
 * (`raw`), and the card's other answers through UnitsTest's card, which asks again as a phone does.
 */
class HolderTest {

    static final int SW_INCORRECT_P1 = SW_INCORRECT_P1P2;
    static final int SAT = UnitsTest.SAT;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    /** One asking, sent once: what the card answered to it. */
    static ResponseAPDU raw(UnitsTest.Card c, CommandAPDU cmd) { return c.sim.transmitCommand(cmd); }
    static CommandAPDU logCommand(int p1) { return new CommandAPDU(CLA, INS_GET_LOG, p1, 0, 256); }

    /** `n` askings, each answered 6A98 with no data. */
    static void keepHolding(UnitsTest.Card c, CommandAPDU cmd, int n, String what) {
        for (int k = 1; k <= n; k++) {
            ResponseAPDU r = raw(c, cmd);
            assertEquals(SW_KEEP_HOLDING, r.getSW(), what + ": asking " + k + ", keep holding");
            assertEquals(0, r.getData().length, what + ": asking " + k + ", nothing else");
        }
    }

    /** A card with a PIN, a record and a clock and no owner, the card of a holder with no phone: a new tap with the PIN. */
    static UnitsTest.Card noOwner() { return new UnitsTest.Card().ready(SAT, false); }

    /** A card with a PIN, a record and a clock and no owner, still in its first set-up (D196): the one card a claim is made on. */
    static UnitsTest.Card claimable() { return SimpleCardTest.inFirstSetUp(SAT); }

    /** The history held for, as a phone holds it (D189): the tap is then a held tap. */
    static void hold(UnitsTest.Card c) { assertEquals(SW_OK, c.log(0).getSW(), "the history, held for"); }

    // =========================================================================
    // The owner claimed slowly (D187)
    // =========================================================================

    @Test
    @DisplayName("A claim is six askings of the same data: the first five answered 6A98 with nothing, no owner set; the sixth sets it on the empty card; and no payment is taken for the rest of that time in the field, through a SELECT, until the card leaves the field")
    void theClaimIsHeldForSixAskings() throws Exception {
        UnitsTest.Card c = claimable();
        for (int k = 1; k < CLAIM_ASKINGS; k++) {
            ResponseAPDU r = raw(c, setOwnerOpenCommand(OWNER));
            assertEquals(SW_KEEP_HOLDING, r.getSW(), "asking " + k);
            assertEquals(0, r.getData().length);
            assertEquals(0, c.field("ownerSet")[0], "no owner yet after asking " + k);
            assertEquals(k, c.field("nonceLive")[1], "the count, in RAM");
        }
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "the sixth");
        assertEquals(1, c.info(0)[16], "the owner is set");
        int place = c.put(-1, A.id8(), 64);
        assertEquals(64, readUint32(c.balance(0), 0), "a piece loaded under the PIN in the same time in the field");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(place).getSW(), "no payment in the time in the field that claimed");
        c.select();
        c.pin();
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(place).getSW(), "nor after a SELECT");
        c.tap();
        assertEquals(64, c.pay(place).getData().length, "a new time in the field pays");
    }

    @Test
    @DisplayName("Any other command between askings begins the count again (GET_INFO, an asking of the history, a SELECT with the PIN given again), and so does other data (another key, the same key with an anchor); a SET_OWNER refused for its own data neither counts nor ends the count")
    void theCountBeginsAgain() throws Exception {
        UnitsTest.Card c = claimable();
        keepHolding(c, setOwnerOpenCommand(OWNER), 3, "three");
        c.info(0);
        keepHolding(c, setOwnerOpenCommand(OWNER), 5, "after GET_INFO, from the first");
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW());

        c = claimable();
        keepHolding(c, setOwnerOpenCommand(OWNER), 4, "four");
        assertEquals(SW_KEEP_HOLDING, raw(c, logCommand(0)).getSW(), "an asking of the history");
        keepHolding(c, setOwnerOpenCommand(OWNER), 5, "after the history's asking, from the first");
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW());

        c = claimable();
        keepHolding(c, setOwnerOpenCommand(OWNER), 5, "five");
        c.select();
        c.pin();
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "a SELECT ends the first set-up, and the claim with it (D196)");
        assertEquals(0, c.field("ownerSet")[0]);

        c = claimable();
        keepHolding(c, setOwnerOpenCommand(OWNER), 5, "five of one key");
        keepHolding(c, setOwnerOpenCommand(OTHER_OWNER), 5, "another key, from the first");
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OTHER_OWNER)).getSW());
        assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0,
            ownerData(ownerProof(L_LOAD, OTHER_OWNER, c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData(), new byte[0]), new byte[0]))),
            "the owner is the key asked for six times");

        c = claimable();
        CommandAPDU anchored = new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0 + 60)));
        keepHolding(c, setOwnerOpenCommand(OWNER), 5, "five with no anchor");
        keepHolding(c, anchored, 5, "the same key with an anchor is other data");
        assertEquals(SW_OK, raw(c, anchored).getSW());
        assertEquals(T0 + 60, readUint32(c.info(0), 17), "the anchor taken at the sixth");

        c = claimable();
        keepHolding(c, setOwnerOpenCommand(OWNER), 3, "three");
        assertEquals(SW_WRONG_LENGTH, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, new byte[64])).getSW(), "a key of 64 bytes");
        byte[] notUncompressed = OWNER.pub.clone();
        notUncompressed[0] = 0x02;
        assertEquals(SW_WRONG_DATA, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, notUncompressed)).getSW(), "a key not beginning 04");
        assertEquals(SW_WRONG_DATA, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, new byte[80]))).getSW(), "an anchor whose bits no header carries");
        keepHolding(c, setOwnerOpenCommand(OWNER), 2, "the count went on");
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "the sixth good asking");
    }

    @Test
    @DisplayName("A claim is under the PIN set (6A97) and given in this tap (6982), never in a time in the field that paid (6985, through a RESET_CARD too), and never while change is owed (6A8D): each refused at the first asking, with nothing counted")
    void aClaimIsUnderThePin() throws Exception {
        UnitsTest.Card bare = new UnitsTest.Card();
        assertEquals(SW_NO_PIN, raw(bare, setOwnerOpenCommand(OWNER)).getSW(), "no PIN");
        assertEquals(SW_OK, bare.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_SECURITY_NOT_SATIS, raw(bare, setOwnerOpenCommand(OWNER)).getSW(), "the PIN not given");
        assertEquals(0, bare.field("nonceLive")[1], "nothing counted");

        UnitsTest.Card c = claimable();
        int place = c.put(-1, A.id8(), 64);
        assertEquals(SW_CARD_IN_USE, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "money on the card");
        assertEquals(64, c.pay(place).getData().length);
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "a time in the field that paid");
        assertEquals(0, c.field("nonceLive")[1], "nothing counted");
        c.select();
        c.pin();
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "after a SELECT, no first set-up (D196)");
        assertEquals(0, c.field("nonceLive")[1], "nothing counted");

        // RESET_CARD leaves the time in the field as it was: one that paid claims nothing, reset or not
        UnitsTest.Card r = UnitsTest.owned(SAT);
        assertEquals(64, r.pay(r.put(-1, A.id8(), 64)).getData().length);
        assertEquals(SW_OK, r.clearSpent());
        assertEquals(SW_OK, r.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(r.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(SW_OK, r.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        r.pin();
        assertEquals(SW_OK, r.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(r, setOwnerOpenCommand(OWNER)).getSW(), "reset, and still a time in the field that paid");
        r.tap();
        assertEquals(SW_OWNER_PROOF, r.sw(setOwnerOpenCommand(OWNER)), "and a new one is past the first set-up (D196)");
        // and one that claimed pays nothing, reset or not
        UnitsTest.Card q = claimable();
        assertEquals(SW_OK, q.sw(setOwnerOpenCommand(OWNER)));
        assertEquals(SW_OK, q.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(q.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(SW_OK, q.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        q.pin();
        assertEquals(SW_OK, q.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        int p = q.put(-1, A.id8(), 16);
        assertEquals(SW_CONDITIONS_NOT_SATIS, q.begin(p).getSW(), "claimed in this time in the field, reset since: no payment");
        q.tap();
        assertEquals(64, q.pay(p).getData().length, "a new time in the field pays");
    }

    // =========================================================================
    // The owner's key is a point of P-256
    // =========================================================================

    /** The card's own check of an owner's key (`requireOwnerPoint`), called straight: 9000, or the word it refused with. */
    static int ownerPoint(UnitsTest.Card c, byte[] key) throws Exception {
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod("requireOwnerPoint", byte[].class, short.class);
        m.setAccessible(true);
        try {
            m.invoke(c.applet(), concat(new byte[7], key), (short) 7);
            return SW_OK;
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof javacard.framework.ISOException) return ((javacard.framework.ISOException) e.getCause()).getReason() & 0xFFFF;
            throw e;
        }
    }

    static final BigInteger P256_P = new BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16);
    static final BigInteger P256_B = new BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16);

    static byte[] point(BigInteger x, BigInteger y) {
        return concat(new byte[] { 4 }, CashuAppletTest.unsigned32(x), CashuAppletTest.unsigned32(y));
    }
    static byte[] unsigned64(BigInteger n) {
        return concat(CashuAppletTest.unsigned32(n.shiftRight(256)), CashuAppletTest.unsigned32(n));
    }
    static boolean onCurve(BigInteger x, BigInteger y) {
        return y.multiply(y).subtract(x.pow(3)).add(x.multiply(BigInteger.valueOf(3))).subtract(P256_B).mod(P256_P).signum() == 0;
    }

    @Test
    @DisplayName("An owner's key that is not a point of P-256 is refused (6A80) and not written: a claim's sixth asking, and an owner's handover under a good proof; the card checks it itself, whatever the chip's key object would take")
    void anOwnerKeyOffTheCurveIsRefused() throws Exception {
        byte[] off = OWNER.pub.clone();
        off[64] ^= 0x02;   // y off by two: the same x, and no point
        UnitsTest.Card c = claimable();
        keepHolding(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, off), CLAIM_ASKINGS - 1, "a key off the curve is held for as any");
        assertEquals(SW_WRONG_DATA, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, off)).getSW(), "and refused at the sixth");
        assertEquals(0, c.info(0)[16], "no owner");
        keepHolding(c, setOwnerOpenCommand(OWNER), CLAIM_ASKINGS - 1, "a key of the curve, from the first");
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW());
        // an owner's handover: the old owner's good proof over a key that is no point
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, off), off))), "a handover to no point");
        byte[] past = point(P256_P, BigInteger.ONE);
        n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, past), past))), "an x of p");
        n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0]))), "the owner is the one it was");
    }

    @Test
    @DisplayName("An owner's key with x or y at P-256's p or past it is refused before any arithmetic is done with it: with the chip's RSA taken away, the answer is 6A80 and nothing is thrown")
    void aCoordinatePastPIsRefusedFirst() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        java.lang.reflect.Field rsa = CashuApplet.class.getDeclaredField("rsa");
        rsa.setAccessible(true);
        rsa.set(c.applet(), null);
        BigInteger top = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE);
        for (BigInteger v : new BigInteger[] { P256_P, P256_P.add(BigInteger.ONE), top }) {
            assertEquals(SW_WRONG_DATA, ownerPoint(c, point(BigInteger.ONE, v)), "y of " + v.toString(16));
            assertEquals(SW_WRONG_DATA, ownerPoint(c, point(v, BigInteger.ONE)), "x of " + v.toString(16));
        }
    }

    @Test
    @DisplayName("The sum of the owner's key check is kept under N, the RSA modulus: N - 1 and one more is 0, and two numbers whose sum passes 2^512 come back to their sum less N")
    void theSumIsKeptUnderN() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        java.lang.reflect.Method term = CashuApplet.class.getDeclaredMethod("p256Term", byte[].class, short.class, byte.class, short.class);
        term.setAccessible(true);
        java.lang.reflect.Field fn = CashuApplet.class.getDeclaredField("RSA_PP");
        fn.setAccessible(true);
        BigInteger n = new BigInteger(1, (byte[]) fn.get(null));
        byte[] scratch = c.field("scratch");
        byte[] one = new byte[32];
        one[31] = 1;
        System.arraycopy(unsigned64(n.subtract(BigInteger.ONE)), 0, scratch, 0, 64);
        term.invoke(c.applet(), one, (short) 0, (byte) 0, (short) 1);
        assertArrayEquals(new byte[64], Arrays.copyOfRange(scratch, 0, 64), "N - 1 and one is N, which is 0");
        BigInteger big = n.subtract(BigInteger.valueOf(5));
        byte[] x = CashuAppletTest.unsigned32(BigInteger.ONE.shiftLeft(255));
        System.arraycopy(unsigned64(big), 0, scratch, 0, 64);
        term.invoke(c.applet(), x, (short) 0, (byte) 0, (short) 3);
        assertEquals(big.add(BigInteger.ONE.shiftLeft(255).multiply(BigInteger.valueOf(3))).mod(n), new BigInteger(1, Arrays.copyOfRange(scratch, 0, 64)), "taken mod N");
    }

    @Test
    @DisplayName("A held tap's count is set to nothing at the top of every command but the one it counts, a SELECT among them, before the card answers the SELECT (read from the source: the simulator clears the RAM on a SELECT of the same applet, which a chip need not)")
    void aSelectBeginsTheCountAgain() throws Exception {
        String code = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8));
        int process = code.indexOf("public void process(APDU apdu)");
        String body = code.substring(process, code.indexOf("switch (buf[ISO7816.OFFSET_INS])", process));
        int reset = body.indexOf("nonceLive[1] = (byte) 0;"), select = body.indexOf("if (selectingApplet())");
        assertTrue(reset > 0 && select > reset, "the count is set to nothing before the SELECT is answered");
        String cond = body.substring(body.lastIndexOf("if (", reset), reset);
        assertFalse(cond.contains("selectingApplet"), "whatever the command is, a SELECT too");
        assertTrue(cond.contains("INS_SET_OWNER") && cond.contains("INS_GET_LOG"), "the two commands it counts");
    }

    @Test
    @DisplayName("The card's check of an owner's key, against the curve's equation worked out here: every key of P-256 passes (the generator, its negation, random keys and their negations); a point with x or y moved by one, an x or a y of p or more, and points of other curves (b moved) are refused")
    void theOwnerPointCheckIsTheCurves() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        java.util.List<byte[]> good = new java.util.ArrayList<>();
        good.add(OWNER.pub);
        good.add(OTHER_OWNER.pub);
        BigInteger gx = new BigInteger("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", 16);
        BigInteger gy = new BigInteger("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5", 16);
        good.add(point(gx, gy));
        for (int i = 0; i < 24; i++) good.add(new CashuAppletTest.Key().pub);
        for (byte[] k : good) {
            BigInteger x = new BigInteger(1, Arrays.copyOfRange(k, 1, 33)), y = new BigInteger(1, Arrays.copyOfRange(k, 33, 65));
            assertTrue(onCurve(x, y));
            assertEquals(SW_OK, ownerPoint(c, k), "a key of the curve");
            assertEquals(SW_OK, ownerPoint(c, point(x, P256_P.subtract(y))), "and its negation");
            for (BigInteger[] moved : new BigInteger[][] { { x, y.add(BigInteger.ONE).mod(P256_P) }, { x.add(BigInteger.ONE).mod(P256_P), y },
                                                          { x, y.subtract(BigInteger.ONE).mod(P256_P) }, { x.xor(BigInteger.ONE.shiftLeft(200)), y } }) {
                if (onCurve(moved[0], moved[1])) continue;
                assertEquals(SW_WRONG_DATA, ownerPoint(c, point(moved[0], moved[1])), "a point moved off the curve");
            }
            assertEquals(SW_WRONG_DATA, ownerPoint(c, point(x.add(P256_P), y)), "x past p, the same point mod p");
            assertEquals(SW_WRONG_DATA, ownerPoint(c, point(x, y.add(P256_P))), "y past p");
        }
        // points of the curves beside it, with another b: x with a square root of x^3 - 3x + b' that is not on P-256
        java.util.Random rnd = new java.util.Random(7);
        int found = 0;
        while (found < 16) {
            BigInteger x = new BigInteger(255, rnd), rhs = x.pow(3).subtract(x.multiply(BigInteger.valueOf(3))).add(BigInteger.valueOf(5)).mod(P256_P);
            BigInteger y = rhs.modPow(P256_P.add(BigInteger.ONE).shiftRight(2), P256_P);
            if (!y.multiply(y).mod(P256_P).equals(rhs)) continue;
            found++;
            assertFalse(onCurve(x, y));
            assertEquals(SW_WRONG_DATA, ownerPoint(c, point(x, y)), "a point of y^2 = x^3 - 3x + 5");
        }
        assertEquals(SW_WRONG_DATA, ownerPoint(c, point(BigInteger.ZERO, BigInteger.ZERO)), "zeros");
        assertEquals(SW_WRONG_DATA, ownerPoint(c, point(P256_P.subtract(BigInteger.ONE), P256_P.subtract(BigInteger.ONE))), "p - 1 twice");
    }

    // =========================================================================
    // A holder with no phone (D189)
    // =========================================================================

    @Test
    @DisplayName("The history of a card with a PIN and no owner is held for: the PIN given (6982), never in a time in the field that paid (6985), nine askings answered 6A98 and the tenth the log; then the log and the receipts are open to the PIN for the rest of the time in the field, through a SELECT, and no payment is taken in it; any other command begins the count again, and a P1 over 3 neither counts nor ends it")
    void theHistoryIsHeldFor() throws Exception {
        UnitsTest.Card c = noOwner();
        int place = c.put(-1, A.id8(), 64);
        int second = c.put(-1, A.id8(), 32);
        assertEquals(64, c.pay(place).getData().length);
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(c, logCommand(0)).getSW(), "a time in the field that paid");
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(c, logCommand(1)).getSW(), "the receipts with it");
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, raw(c, logCommand(0)).getSW(), "the PIN not given");
        c.pin();
        keepHolding(c, logCommand(0), HISTORY_ASKINGS - 1, "nine askings");
        ResponseAPDU log = raw(c, logCommand(0));
        assertEquals(SW_OK, log.getSW(), "the tenth");
        assertEquals(1, readUint32(log.getData(), 0), "the log: one tap, the loads and the payment");
        assertEquals(SW_OK, raw(c, logCommand(1)).getSW(), "the receipts at once: one hold");
        assertEquals(SW_OK, raw(c, logCommand(3)).getSW());
        c.select();
        assertEquals(SW_SECURITY_NOT_SATIS, raw(c, logCommand(0)).getSW(), "after a SELECT, the PIN again");
        c.pin();
        assertEquals(SW_OK, raw(c, logCommand(2)).getSW(), "and no hold again in the same time in the field");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(second).getSW(), "no payment in a held tap");
        c.tap();
        assertEquals(SW_KEEP_HOLDING, raw(c, logCommand(0)).getSW(), "a new time in the field is held again");
        // the count: another command begins it again; a P1 over 3 neither counts nor ends it
        c.tap();
        keepHolding(c, logCommand(0), 5, "five");
        assertEquals(SW_INCORRECT_P1, raw(c, logCommand(4)).getSW(), "P1 = 4");
        keepHolding(c, logCommand(1), 4, "the count went on, the receipts' askings with the log's");
        assertEquals(SW_OK, raw(c, logCommand(1)).getSW(), "the tenth");
        c.tap();
        keepHolding(c, logCommand(0), 5, "five");
        c.info(0);
        keepHolding(c, logCommand(0), HISTORY_ASKINGS - 1, "after GET_INFO, from the first");
        assertEquals(SW_OK, raw(c, logCommand(0)).getSW());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(second).getSW(), "and pays nothing");
        // an owned card: the log to the PIN, with no hold, as before
        UnitsTest.Card owned = UnitsTest.owned(SAT);
        assertEquals(SW_OK, raw(owned, logCommand(0)).getSW(), "an owner's card: no hold");
        assertEquals(SW_SECURITY_NOT_SATIS, raw(owned, logCommand(1)).getSW(), "and its receipts are the grant's");
    }

    @Test
    @DisplayName("The guest is told the limit on one payment and the rate (GET_INFO 30 to 33 and 44 to 47) under the PIN in a held tap, on a card with no owner, and zeros otherwise")
    void theGuestIsToldTheLimitInAHeldTap() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(SAT);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(0), u32(500), u32(0), new byte[] { 7 }, u32(1000)))), "in the first set-up");
        c.tap();
        assertEquals(500, readUint32(c.record(), CashuApplet.CARD_TAP_LIMIT_OFFSET));
        byte[] info = c.info(3);
        assertEquals(0, readUint32(info, 30), "the PIN alone: zeros");
        assertEquals(0, readUint32(info, 44));
        hold(c);
        info = c.info(3);
        assertEquals(500, readUint32(info, 30), "a held tap: the limit on one payment");
        assertEquals(1000, readUint32(info, 44), "and the rate");
        assertEquals(500, readUint32(c.info(4), 30), "in the longest form too");
        c.select();
        assertEquals(0, readUint32(c.info(3), 30), "after a SELECT, without the PIN given again: zeros");
        c.pin();
        assertEquals(500, readUint32(c.info(1), 30), "with it: the held tap stands");
    }

    @Test
    @DisplayName("A card with no owner whose log has taps in it: SET_PIN answers 6985 in a time in the field that paid and 6982 with no hold, before anything is written, and goes through in a held tap; SET_CARD and SET_LIMIT_PIN answer 6A91 in every tap after the first set-up (D196), the no-PIN window untouched")
    void aUsedCardIsRewrittenOnlyInAHeldTap() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(SAT);
        byte[] limits = concat(u32(0), u32(0), u32(100), new byte[] { 7 }, u32(0), new byte[] { 1 });
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, limits)), "a card never used: no hold (its first set-up)");
        int place = c.put(-1, A.id8(), 64);
        c.power();
        assertEquals(64, c.pay(place).getData().length, "with no PIN: the allowance");
        long noPin = readUint32(c.record(), CashuApplet.CARD_NOPIN_SPENT_OFFSET);
        assertEquals(64, noPin, "a no-PIN window runs");
        c.pin();
        assertEquals(SW_OK, c.clearSpent(), "nothing unspent");
        CommandAPDU setCard = new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("https://other.example.com", NO_REFUND));
        CommandAPDU setLimit = new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, limits);
        CommandAPDU setPin = new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN);
        java.util.Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_OWNER_PROOF, c.sw(setCard), "SET_CARD in a tap that paid: after the first set-up");
        assertEquals(SW_OWNER_PROOF, c.sw(setLimit), "SET_LIMIT_PIN");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(setPin), "SET_PIN");
        c.assertUnchanged(before, "a tap that paid");
        c.tap();
        before = c.snapshot();
        assertEquals(SW_OWNER_PROOF, c.sw(setCard), "SET_CARD with no hold");
        assertEquals(SW_OWNER_PROOF, c.sw(setLimit), "SET_LIMIT_PIN");
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(setPin), "SET_PIN");
        c.assertUnchanged(before, "no hold: the no-PIN window still runs");
        assertEquals(64, readUint32(c.record(), CashuApplet.CARD_NOPIN_SPENT_OFFSET));
        hold(c);
        before = c.snapshot();
        assertEquals(SW_OWNER_PROOF, c.sw(setCard), "SET_CARD in a held tap");
        assertEquals(SW_OWNER_PROOF, c.sw(setLimit), "SET_LIMIT_PIN, the same values");
        c.assertUnchanged(before, "the numbers and the record set once");
        assertEquals(SW_OK, c.sw(setPin), "SET_PIN");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)), "the new PIN is the card's");
    }

    @Test
    @DisplayName("A card set up (a PIN not blocked and a record of the holder's) keeps its PIN: a new one wants it (6982); a blocked PIN is replaced with nothing owed, with no PIN asked, and the log and the receipts go with it; the numbers stay")
    void aSetUpCardKeepsItsPin() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(SAT);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(0), u32(300), u32(100)))));
        c.tap();
        assertEquals(64, c.pay(c.put(-1, A.id8(), 64)).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the PIN it has, not given");
        assertEquals(0x63C1, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)));
        assertEquals(0x63C2, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)), "wrong tries wait, and never block (D195)");
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the PIN is kept (three wrong tries in a row: PinWaitTest)");
        // a blocked PIN (the chip's counter run out by hand: the card never runs it out itself)
        javacard.framework.OwnerPIN pin = (javacard.framework.OwnerPIN) ReaderChecksTest.pinOf(c);
        while (pin.getTriesRemaining() > 0) pin.check(WRONG_PIN, (short) 0, (byte) 4);
        c.power();
        assertTrue(readUint32(c.field("cardLog"), 0) > 0 && readUint32(c.field("cardReceipts"), 0) > 0, "a history");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "blocked: replaced with no PIN asked");
        assertArrayEquals(new byte[CashuApplet.LOG_LEN], c.field("cardLog"), "the log gone with it");
        assertArrayEquals(new byte[CashuApplet.RECEIPTS_LEN], c.field("cardReceipts"), "and the receipts");
        assertEquals(300, readUint32(c.record(), CashuApplet.CARD_TAP_LIMIT_OFFSET), "the holder's numbers stay");
        assertEquals(100, readUint32(c.record(), CashuApplet.CARD_NOPIN_LIMIT_OFFSET));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(3, c.info(0)[9], "three tries");
        // a card not used yet keeps its PIN as well, and wants no hold
        UnitsTest.Card d = noOwner();
        d.power();
        assertEquals(SW_SECURITY_NOT_SATIS, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)));
        d.pin();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "under the PIN it has");
    }

    @Test
    @DisplayName("A factory record (its mint \"-\" alone) is no record: LOAD_PROOF 6A8C; a PIN a stranger set on it is the card's first set-up, and the holder's SET_PIN wants that PIN (6982), the stranger's numbers staying (D196: the holder's way back is the forgotten PIN and a reset by it); a mint that only begins with \"-\" is the holder's")
    void aFactoryRecordIsNoRecord() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND, "FX1"))), "the issuer's factory record, with no PIN");
        assertEquals(1, c.info(0)[11], "a record is written");
        byte[] stranger = { '9', '9', '9', '9' };
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, stranger)), "a stranger's PIN");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, stranger)));
        assertEquals(SW_NO_CARD_RECORD, c.load(c.piece(A.id8(), 16)).getSW(), "a factory record takes no piece");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(500), u32(9000), new byte[] { 30 }, u32(1234), new byte[] { 1 }))),
            "and numbers under the stranger's PIN, in its first set-up");
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the holder's PIN wants the stranger's");
        assertEquals(9000, readUint32(c.record(), CashuApplet.CARD_NOPIN_LIMIT_OFFSET), "whose numbers stay");
        // "-x" is a mint
        UnitsTest.Card dash = new UnitsTest.Card();
        assertEquals(SW_OK, dash.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, stranger)));
        assertEquals(SW_OK, dash.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, stranger)));
        assertEquals(SW_OK, dash.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-x", NO_REFUND))));
        assertEquals(SW_OK, dash.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(0), u32(500), u32(9000)))));
        dash.power();
        assertEquals(SW_SECURITY_NOT_SATIS, dash.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "a mint of \"-x\" is a holder's record");
        assertEquals(9000, readUint32(dash.record(), CashuApplet.CARD_NOPIN_LIMIT_OFFSET), "and its numbers stay");
        // a record of "-" with two characters' length is a mint too
        UnitsTest.Card two = new UnitsTest.Card();
        assertEquals(SW_OK, two.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, stranger)));
        assertEquals(SW_OK, two.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, stranger)));
        assertEquals(SW_OK, two.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("--", NO_REFUND))));
        assertEquals(SW_OK, two.load(two.piece(A.id8(), 16)).getSW(), "\"--\" takes a piece");
    }

    @Test
    @DisplayName("REFRESH P1 = 1, the header alone: a card with no owner, under the PIN given in this tap and a held tap (6A91 owned, 6A97 with no PIN, 6982 with the PIN not given or no hold, 6985 in a time in the field that paid, 6700 for another length); it takes the header as SET_HEADER does and sets the rolls to 0")
    void refreshByThePinInAHeldTap() throws Exception {
        byte[] header = blockAt(T0 + 600);
        CommandAPDU refresh = new CommandAPDU(CLA, INS_REFRESH, 1, 0, header, 4);
        UnitsTest.Card owned = UnitsTest.owned(SAT);
        assertEquals(SW_OWNER_PROOF, owned.sw(refresh), "an owned card has its proof");
        assertEquals(SW_NO_PIN, new UnitsTest.Card().sw(refresh), "no PIN");
        UnitsTest.Card c = noOwner();
        c.record()[CashuApplet.CARD_ROLLS_OFFSET] = 5;
        assertEquals(64, c.pay(c.put(-1, A.id8(), 64)).getData().length);
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(refresh), "a time in the field that paid");
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(refresh), "the PIN not given");
        c.pin();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(refresh), "no hold");
        assertEquals(5, c.record()[CashuApplet.CARD_ROLLS_OFFSET]);
        hold(c);
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_REFRESH, 1, 0, concat(new byte[] { 0 }, header), 4)), "a proof's length before it");
        ResponseAPDU r = c.send(refresh);
        assertEquals(SW_OK, r.getSW(), "in a held tap");
        assertEquals(T0 + 600, readUint32(r.getData(), 0), "the card's now, the header's");
        assertEquals(0, c.record()[CashuApplet.CARD_ROLLS_OFFSET], "the rolls to 0");
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_REFRESH, 1, 0, new byte[80], 4)), "a header whose bits no header carries");
    }

    @Test
    @DisplayName("On a card with no owner a held tap is the holder's say: an opening a reader bound to its own key is bound to the mint's (KEYSET_KEYS P1 = 3 with another key) and an opening is given up (RESET_CARD P1 = 1) only in a held tap: 6985 in the tap that paid, 6982 with the PIN and no hold")
    void aHeldTapIsTheHoldersSay() throws Exception {
        UnitsTest.Card c = noOwner();
        int place = c.put(-1, A.id8(), 64);
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, keyOf(TILL), null);
        int k = row[0];
        assertEquals(SW_CONDITIONS_NOT_SATIS, rebind(c, k, A, 8), "the tap that paid");
        CommandAPDU letGo = new CommandAPDU(CLA, INS_RESET_CARD, 1, k, new byte[] { (byte) k });
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(letGo), "nor is anything given up in it");
        c.tap();
        assertEquals(SW_SECURITY_NOT_SATIS, rebind(c, k, A, 8), "the PIN and no hold");
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(letGo));
        hold(c);
        assertEquals(SW_OK, rebind(c, k, A, 8), "a held tap");
        assertTrue(shown(c, k));
        assertArrayEquals(A.keyFor(8), Arrays.copyOfRange(lastRow(c), 50, 83), "bound to the mint's key");
        c.power();
        assertEquals(SW_OK, loadChange(c, row, A.privFor(8)).getSW(), "and the mint's answer goes on, with no PIN");
        // a second opening, given up in a held tap
        c.tap();
        int other = c.put(-1, A.id8(), 32);
        byte[] row2 = payWithChange(c, other, 4, keyOf(TILL), null);
        int k2 = row2[0];
        c.tap();
        hold(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 1, k2, new byte[] { (byte) k2 })), "given up in a held tap");
        assertEquals(0, c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData()[0], "nothing owed");
        byte[] log = c.log(0).getData();
        assertEquals(CashuApplet.LOG_FLAG_LET_GO, log[16 + 10] & CashuApplet.LOG_FLAG_LET_GO, "written in the log");
    }

    @Test
    @DisplayName("A held tap on a card with no owner is the holder's say for a load's new keyset of the other unit: marked, where with the PIN alone a new keyset of the other unit that is not the last payment's is refused (6A9D)")
    void aHeldTapMarksANewKeyset() throws Exception {
        UnitsTest.Card c = noOwner();
        assertEquals(UnitsTest.SW_NOT_THIS_TAP, c.loadAs(UnitsTest.USD, c.piece(UnitsTest.USD_A, 100)).getSW(), "the PIN alone");
        hold(c);
        assertEquals(SW_OK, c.loadAs(UnitsTest.USD, c.piece(UnitsTest.USD_A, 100)).getSW(), "a held tap");
        assertEquals(CashuApplet.ENTRY_MARK & 0xFF, c.stateOf(UnitsTest.USD_A) & CashuApplet.ENTRY_MARK & 0xFF, "entered with the holder's mark");
    }

    @Test
    @DisplayName("The time in the field's marks (TAP_PAID, TAP_CLAIMED, TAP_READ) are three bits of the CLEAR_ON_RESET byte beside the allowance's arming, gone with the power and kept through a SELECT; the held count is one CLEAR_ON_DESELECT byte")
    void theMarksAreRam() throws Exception {
        assertEquals(0x01, CashuApplet.TAP_ARMED);
        assertEquals(0x02, CashuApplet.TAP_PAID);
        assertEquals(0x04, CashuApplet.TAP_CLAIMED);
        assertEquals(0x08, CashuApplet.TAP_READ);
        UnitsTest.Card c = noOwner();
        hold(c);
        assertEquals(CashuApplet.TAP_READ, c.field("tapOpen")[2] & CashuApplet.TAP_READ);
        c.select();
        assertEquals(CashuApplet.TAP_READ, c.field("tapOpen")[2] & CashuApplet.TAP_READ, "kept through a SELECT");
        c.power();
        assertEquals(0, c.field("tapOpen")[2], "gone with the power");
        assertEquals(2, c.field("nonceLive").length, "the nonce's mark and the held count");
    }
}
