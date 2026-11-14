package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What ties a card to the mint's swaps (D197, D198): the keys of a date (GROUP_KEYS) go to a reader told the history only;
 * SPEND_ALL_AGAIN by a message's hash answers a reader without the PIN for no-PIN payments only, and the same 6A88 for every
 * other hash; c goes out only sealed, and on a card with no owner only in its first set-up; an undated payment names no
 * refund key.
 */
class LinkingTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final long D1 = 1_900_000_000L, D2 = 1_900_086_401L;

    static ResponseAPDU againByHash(UnitsTest.Card c, byte[] h) { return c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, h, 64)); }

    /** A payment of one piece of `date` to a till's output: { the message's hash, the signature }. */
    static byte[][] payOne(UnitsTest.Card c, long amount, int seed, long date) throws Exception {
        DateKeys k = DateKeys.of(c.applet());
        int place = PerPaymentKeyTest.load(c, amount, seed, date);
        byte[] slot = c.slot(place);
        byte[] out = output(amount, blinded(seed + 100));
        return payPlace(c, k, place, slot, out);
    }
    static byte[][] payPlace(UnitsTest.Card c, DateKeys k, int place, byte[] slot, byte[] out) {
        assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out)));
        byte[] sig = c.sign().getData();
        assertEquals(64, sig.length);
        String msg = k.message(new byte[][] { slot }, new byte[][] { out });
        return new byte[][] { sha256(msg.getBytes(StandardCharsets.UTF_8)), sig };
    }

    @Test
    @DisplayName("GROUP_KEYS: 6982 to a stranger, and to a tap that paid with no PIN; the keys to the PIN given in this tap or the owner's grant")
    void groupKeysGoToAReaderToldTheHistory() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = DateKeys.of(c.applet());
        payOne(c, 8, 21, D1);
        // a stranger, with the date the mint saw in the swap's secrets: nothing
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, PerPaymentKeyTest.groupKeys(c, D1).getSW(), "a stranger, a spent date");
        assertEquals(SW_SECURITY_NOT_SATIS, PerPaymentKeyTest.groupKeys(c, D2).getSW(), "a stranger, any date");
        // the PIN in this tap
        c.pin();
        ResponseAPDU g = PerPaymentKeyTest.groupKeys(c, D1);
        assertEquals(SW_OK, g.getSW());
        assertArrayEquals(k.key(D1), Arrays.copyOfRange(g.getData(), 32, 65));
        // the owner's grant
        c.power();
        c.grant();
        assertEquals(SW_OK, PerPaymentKeyTest.groupKeys(c, D2).getSW(), "the grant");
        // a till paid with no PIN, in its paying tap: it has the payment's t from BEGIN, and no other date
        c.tap();
        assertEquals(SW_OK, c.limits(0, 0, 1000, 7, 0));
        int place = PerPaymentKeyTest.load(c, 8, 22, D2);
        c.power();
        assertEquals(64, c.pay(place).getData().length, "paid with no PIN, under the allowance");
        assertEquals(SW_SECURITY_NOT_SATIS, PerPaymentKeyTest.groupKeys(c, D1).getSW(), "the paying tap, no PIN");
    }

    @Test
    @DisplayName("SPEND_ALL_AGAIN P1 = 1 without the PIN: the signature of a no-PIN payment by its hash; 6A88 for a payment under the PIN, for any other hash and for zeros, so no hash is told to be the card's")
    void againByHashIsNoOracle() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[][] underPin = payOne(c, 64, 21, D1);
        c.tap();
        assertEquals(SW_OK, c.limits(0, 0, 1000, 7, 0));
        DateKeys k = DateKeys.of(c.applet());
        int place = PerPaymentKeyTest.load(c, 32, 23, D2);
        byte[] slot = c.slot(place);
        c.power();
        byte[][] noPin = payPlace(c, k, place, slot, output(32, blinded(123)));
        // later: a stranger, no PIN, no grant
        c.power();
        byte[] other = underPin[0].clone();
        other[0] ^= 1;
        assertEquals(SW_SLOT_EMPTY, againByHash(c, underPin[0]).getSW(), "the card's own payment under the PIN: the same word as another card's");
        assertEquals(SW_SLOT_EMPTY, againByHash(c, other).getSW(), "a swap of another card");
        assertEquals(SW_SLOT_EMPTY, againByHash(c, new byte[32]).getSW(), "zeros (an empty receipt) answer as any hash does");
        ResponseAPDU r = againByHash(c, noPin[0]);
        assertEquals(SW_OK, r.getSW(), "a no-PIN payment's signature, again, with no PIN");
        assertArrayEquals(noPin[1], r.getData());
        // with the PIN given: every kept signature by its hash, and zeros still nothing
        c.pin();
        ResponseAPDU p = againByHash(c, underPin[0]);
        assertEquals(SW_OK, p.getSW());
        assertArrayEquals(underPin[1], p.getData());
        assertEquals(SW_SLOT_EMPTY, againByHash(c, new byte[32]).getSW(), "zeros, with the PIN");
        // a stranger's empty card: zeros are 6A88 too
        UnitsTest.Card fresh = UnitsTest.owned(UnitsTest.SAT);
        fresh.power();
        assertEquals(SW_SLOT_EMPTY, againByHash(fresh, new byte[32]).getSW(), "a card that has paid nothing");
    }

    // ---- c, sealed ----

    static final java.math.BigInteger PIN_D = CashuAppletTest.PIN_D;

    /** The card's PIN key made the tests' own scalar (the arithmetic of the envelope is the test's, and slow). */
    static byte[] ownPinKey(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field fp = CashuApplet.class.getDeclaredField("pinPrivKey"), fw = CashuApplet.class.getDeclaredField("pinPubKey");
        fp.setAccessible(true);
        fw.setAccessible(true);
        ((javacard.security.ECPrivateKey) fp.get(c.applet())).setS(unsigned32(PIN_D), (short) 0, (short) 32);
        java.math.BigInteger[] w = ecMulTest(PIN_D, SECP_GX, SECP_GY);
        ((javacard.security.ECPublicKey) fw.get(c.applet())).setW(concat(new byte[] { 4 }, unsigned32(w[0]), unsigned32(w[1])), (short) 0, (short) 65);
        return compressed(w);
    }

    /** GET_CARD P1 = 3 sealed, as a phone asks it: GET_NONCE P1 = 1, then E (65); c opened from the answer, or null and the word.
     * On a card with a refund key the answer is sealed to it (`openToRefund`), opened here with the tests' refund key's r, 1. */
    static Object[] readC(UnitsTest.Card c, byte[] pinKey, int eph) {
        ResponseAPDU n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_OK, n.getSW());
        byte[] nonce = Arrays.copyOf(n.getData(), 16);
        byte[][] ks = agreed(EPH[eph], pinKey);
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, ks[0], 256));
        if (r.getSW() != SW_OK) return new Object[] { null, r.getSW() };
        if (r.getData().length == 97) return new Object[] { openToRefund(r.getData(), BigInteger.ONE, nonce), SW_OK };
        assertEquals(32, r.getData().length);
        byte[] block = sealBlock(1, ks[1], ks[0], nonce, INS_GET_CARD, new byte[0]);
        byte[] cc = new byte[32];
        for (int i = 0; i < 32; i++) cc[i] = (byte) (r.getData()[i] ^ block[i]);
        return new Object[] { cc, SW_OK };
    }

    /** c from GET_CARD P1 = 3's answer on a card with a refund key, K (65) then c XOR the block, by the refund key's r: the
     * shared point r*K = k*R, and the block as the PIN's seal makes it, with K in E's place. */
    static byte[] openToRefund(byte[] answer, BigInteger r, byte[] nonce) {
        assertEquals(97, answer.length);
        byte[] kk = Arrays.copyOf(answer, 65);
        assertEquals(4, kk[0]);
        BigInteger[] shared = ecMulTest(r, new BigInteger(1, Arrays.copyOfRange(kk, 1, 33)), new BigInteger(1, Arrays.copyOfRange(kk, 33, 65)));
        byte[] block = sealBlock(1, unsigned32(shared[0]), kk, nonce, INS_GET_CARD, new byte[0]);
        byte[] cc = new byte[32];
        for (int i = 0; i < 32; i++) cc[i] = (byte) (answer[65 + i] ^ block[i]);
        return cc;
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 with an E that is no point of the curve (one bit of y) is refused 6A80, and the card's key agreement is never given it; a good E after it is agreed once")
    void aSealedCAskedWithAnEOffTheCurveGivesTheChipNothing() throws Exception {
        UnitsTest.Card n = new UnitsTest.Card();
        byte[] pinKey = ownPinKey(n);
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        n.pin();
        SchnorrHWSignTest.WatchedAgreement chip = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        java.lang.reflect.Field fs = CashuApplet.class.getDeclaredField("schnorrHW");
        fs.setAccessible(true);
        SchnorrHWSignTest.setHidden((SchnorrHW) fs.get(n.applet()), "ecdh", chip);
        assertEquals(SW_OK, n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getSW());
        byte[] e = agreed(EPH[0], pinKey)[0].clone();
        e[64] ^= 1;
        assertEquals(SW_WRONG_DATA, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, e, 256)), "an E off the curve");
        assertFalse(chip.given.stream().anyMatch(g -> Arrays.equals(g, e)), "the chip was not given it");
        Object[] got = readC(n, pinKey, 1);
        assertEquals(SW_OK, got[1]);
        byte[] good = agreed(EPH[1], pinKey)[0];
        assertEquals(1, chip.given.stream().filter(g -> Arrays.equals(g, good)).count(), "a good E is agreed once");
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 answers c sealed to the card's PIN key under GET_NONCE's sixteen bytes (c XOR block 1), never in the clear: the owner's grant, or on a card with no owner the PIN in its first set-up only")
    void cIsSealedAndGivenInTheFirstSetUpOnly() throws Exception {
        // a card with no owner, in its first set-up: c, sealed
        UnitsTest.Card n = new UnitsTest.Card();
        byte[] pinKey = ownPinKey(n);
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        n.pin();
        Object[] got = readC(n, pinKey, 0);
        byte[] c = Arrays.copyOf(PerPaymentKeyTest.field(n, "chain"), 32);
        assertArrayEquals(c, (byte[]) got[0], "c, opened");
        // the answer is not c in the clear
        ResponseAPDU nn = n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        ResponseAPDU again = n.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, agreed(EPH[1], pinKey)[0], 256));
        assertEquals(SW_OK, again.getSW());
        assertFalse(Arrays.equals(c, again.getData()), "never c itself");
        // the sixteen bytes are good once
        assertEquals(SW_CONDITIONS_NOT_SATIS, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, agreed(EPH[1], pinKey)[0], 256)), "the nonce used up");
        // no data, or not a point: no c
        n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_WRONG_LENGTH, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256)), "the clear form is gone");
        // the first set-up over (a new selection), on a card with no refund key: the PIN, even in a held tap, gets no c
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, NO_REFUND))));
        assertEquals(SW_OK, n.sw(setTimeCommand(T0)));
        n.tap();
        assertEquals(SW_OK, n.log(0).getSW(), "the history held for");
        assertEquals(SW_SECURITY_NOT_SATIS, readC(n, pinKey, 2)[1], "the PIN in a held tap, after the first set-up");
        n.power();
        assertEquals(SW_SECURITY_NOT_SATIS, readC(n, pinKey, 2)[1], "a stranger");
        // a card with an owner: the grant
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        byte[] ok = ownPinKey(o);
        byte[] oc = Arrays.copyOf(PerPaymentKeyTest.field(o, "chain"), 32);
        o.power();
        assertEquals(SW_SECURITY_NOT_SATIS, readC(o, ok, 3)[1], "a stranger");
        o.pin();
        assertEquals(SW_SECURITY_NOT_SATIS, readC(o, ok, 3)[1], "the PIN alone, on an owned card");
        o.grant();
        assertArrayEquals(oc, (byte[]) readC(o, ok, 4)[0], "the owner's grant: c, opened");
    }

    /** A refund key whose r the test knows and is not 1: 7*G. */
    static final BigInteger R7 = BigInteger.valueOf(7);
    static final byte[] REFUND_7 = compressed(ecMulTest(R7, SECP_GX, SECP_GY));

    /** GET_NONCE P1 = 1 then GET_CARD P1 = 3 with no data: { the answer, the sixteen bytes }. */
    static Object[] sealedToRefund(UnitsTest.Card c) {
        ResponseAPDU n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_OK, n.getSW());
        return new Object[] { c.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256)), Arrays.copyOf(n.getData(), 16) };
    }

    @Test
    @DisplayName("on a card with a refund key, GET_CARD P1 = 3 seals c to the refund key (K = k*G, c XOR the block of k*R's x) and gives it at any tap to the holder's say: the PIN on a card with no owner, the grant on an owned one")
    void cIsSealedToTheRefundKeyAtAnyTap() throws Exception {
        UnitsTest.Card n = new UnitsTest.Card();
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        n.pin();
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))));
        assertEquals(SW_OK, n.sw(setTimeCommand(T0)));
        byte[] c = Arrays.copyOf(PerPaymentKeyTest.field(n, "chain"), 32);
        // a later tap, the PIN given: c, sealed to R, opened with r
        n.tap();
        Object[] a = sealedToRefund(n);
        ResponseAPDU r = (ResponseAPDU) a[0];
        assertEquals(SW_OK, r.getSW(), "the PIN, after the first set-up");
        assertArrayEquals(c, openToRefund(r.getData(), R7, (byte[]) a[1]), "c, opened with the refund key's r");
        assertFalse(Arrays.equals(c, openToRefund(r.getData(), BigInteger.ONE, (byte[]) a[1])), "and not with another r");
        // a fresh k at each asking: two answers share nothing
        Object[] b = sealedToRefund(n);
        byte[] second = ((ResponseAPDU) b[0]).getData();
        assertFalse(Arrays.equals(Arrays.copyOf(r.getData(), 65), Arrays.copyOf(second, 65)), "a new K");
        assertArrayEquals(c, openToRefund(second, R7, (byte[]) b[1]));
        // the sixteen bytes are good once; and with none live, 6985
        assertEquals(SW_CONDITIONS_NOT_SATIS, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256)), "the nonce used up");
        // a stranger: no PIN
        n.power();
        n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_SECURITY_NOT_SATIS, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256)), "a stranger");
        // an owned card with a refund key (the tests' r = 1): the grant at any tap; the PIN alone, not
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        byte[] oc = Arrays.copyOf(PerPaymentKeyTest.field(o, "chain"), 32);
        o.tap();
        o.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_SECURITY_NOT_SATIS, o.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256)), "the PIN alone, on an owned card");
        o.grant();
        Object[] g = sealedToRefund(o);
        assertEquals(SW_OK, ((ResponseAPDU) g[0]).getSW());
        assertArrayEquals(oc, openToRefund(((ResponseAPDU) g[0]).getData(), BigInteger.ONE, (byte[]) g[1]), "the grant: c, opened");
    }

    @Test
    @DisplayName("an undated payment: BEGIN answers R_D as zeros (its secret has no refund key), a dated one R + u*G; GROUP_KEYS of the date 0 the same")
    void anUndatedPaymentNamesNoRefundKey() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = DateKeys.of(c.applet());
        int undated = PerPaymentKeyTest.load(c, 8, 77, 0);
        int dated = PerPaymentKeyTest.load(c, 8, 78, D1);
        ResponseAPDU b = PerPaymentKeyTest.begin(c, undated);
        assertEquals(SW_OK, b.getSW());
        assertArrayEquals(new byte[33], Arrays.copyOfRange(b.getData(), 36, 69), "the date 0: no refund key");
        ResponseAPDU d = PerPaymentKeyTest.begin(c, dated);
        assertEquals(SW_OK, d.getSW());
        assertArrayEquals(k.refund(D1), Arrays.copyOfRange(d.getData(), 36, 69), "a date: R + u*G");
        ResponseAPDU g = PerPaymentKeyTest.groupKeys(c, 0);
        assertEquals(SW_OK, g.getSW());
        assertArrayEquals(new byte[33], Arrays.copyOfRange(g.getData(), 65, 98), "GROUP_KEYS, the date 0");
        assertArrayEquals(k.key(0), Arrays.copyOfRange(g.getData(), 32, 65));
        // and the undated payment is paid as before
        c.tap();
        assertEquals(64, c.pay(undated).getData().length);
    }
    // =====================================================================================================================
    // An owner replaced: a new c
    // =====================================================================================================================

    /** The owner hands the card on with SET_OWNER: the old owner's proof over the new key. */
    static int replaceOwner(UnitsTest.Card c) {
        byte[] v = OTHER_OWNER.pub;
        return c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(c.proofFor(L_OWNER, v), v)));
    }

    @Test
    @DisplayName("an owner replaced (SET_OWNER on an owned card) draws a new c in the same transaction: neither the next owner nor the last can work out the other's date keys from c")
    void anOwnerReplacedDrawsANewC() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] pinKey = ownPinKey(c);
        DateKeys k = DateKeys.of(c.applet());
        // the first owner pays from D1; the mint keeps the key
        c.tap();
        int place = PerPaymentKeyTest.load(c, 8, 51, D1);
        payPlace(c, k, place, c.slot(place), output(8, blinded(151)));
        byte[] mintSaw = k.key(D1);
        c.tap();
        c.grant();
        byte[] cOld = (byte[]) readC(c, pinKey, 0)[0];
        assertArrayEquals(Arrays.copyOf(PerPaymentKeyTest.field(c, "chain"), 32), cOld);
        // the owner hands the card on: nothing unspent, the owner replaced with its proof
        c.tap();
        assertEquals(SW_OK, replaceOwner(c), "owner replaced");
        byte[] cNow = Arrays.copyOf(PerPaymentKeyTest.field(c, "chain"), 32);
        assertFalse(Arrays.equals(cOld, cNow), "a new c");
        // the next owner, its own grant: its c gives a D1 key the mint never saw
        c.power();
        ResponseAPDU n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
        byte[] proof = ownerProof(L_LOAD, OTHER_OWNER, n.getData(), new byte[0]);
        assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(proof, new byte[0]))));
        byte[] cNew = (byte[]) readC(c, pinKey, 1)[0];
        assertArrayEquals(cNow, cNew);
        assertFalse(Arrays.equals(mintSaw, DateKeys.of(c.applet()).key(D1)), "the next owner's D1 key is not the one the mint saw");
    }

    @Test
    @DisplayName("an owner replaced lets the settlement record go in the same transaction: the next owner's grant reads no packet (6A88), so none is signed with a key the packet does not name")
    void anOwnerReplacedLetsTheRecordGo() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        // the first owner pays an undated piece: a payment that leaves a record
        c.tap();
        payOne(c, 8, 61, 0);
        assertEquals(1, PerPaymentKeyTest.field(c, "outbox")[0], "the payment left a record");
        c.tap();
        assertEquals(SW_OK, replaceOwner(c), "owner replaced");
        assertEquals(0, PerPaymentKeyTest.field(c, "outbox")[0], "the record let go with the owner");
        // the next owner, with its own grant: no record to read in either form
        c.power();
        ResponseAPDU n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
        byte[] proof = ownerProof(L_LOAD, OTHER_OWNER, n.getData(), new byte[0]);
        assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(proof, new byte[0]))));
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, 0x1B, 0, 0, 256)), "no scope");
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, 0x1B, 1, 0, new byte[] { 0, 0, (byte) 0xFF }, 256)), "no packet");
    }

    /** The next owner's proof over `value` under `label`, after a nonce asked for in this tap. */
    static byte[] nextOwnerProof(UnitsTest.Card c, String label, byte[] value) {
        ResponseAPDU n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
        return ownerProof(label, OTHER_OWNER, n.getData(), value);
    }
    static int nextOwnerGrant(UnitsTest.Card c) {
        return c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(nextOwnerProof(c, L_LOAD, new byte[0]), new byte[0])));
    }
    static int pinOnly(UnitsTest.Card c, int ins, int p1, byte[] data) {
        return c.sw(data == null ? new CommandAPDU(CLA, ins, p1, 0, 256) : new CommandAPDU(CLA, ins, p1, 0, data, 256));
    }

    @Test
    @DisplayName("a hand-over (SET_OWNER on an owned card) clears the history as a reset does, the spent places and their kept proofs freed, and asks for a new PIN: VERIFY_PIN answers 6982 in that tap and every later one, through power cuts, until the next owner's CHANGE_PIN; the money's settings stay")
    void aHandOverClearsTheHistoryAndAsksForANewPin() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        payOne(c, 8, 71, 0);
        // a mint's proof kept beside the spent piece (as LOAD_PROOF P1 = 1 keeps one)
        java.util.Arrays.fill(PerPaymentKeyTest.field(c, "dleq"), 0, 96, (byte) 0x5A);
        byte[] genBefore = PerPaymentKeyTest.field(c, "outGen").clone();
        byte[] limitBefore = Arrays.copyOfRange(PerPaymentKeyTest.field(c, "cardRecord"), 0, 60);
        // the refund key goes with the last owner (the next names its own with SET_CARD); the rest of these settings stay
        Arrays.fill(limitBefore, CashuApplet.CARD_REFUND_OFFSET, CashuApplet.CARD_REFUND_OFFSET + 33, (byte) 0);
        c.tap();
        assertEquals(SW_OK, replaceOwner(c), "owner replaced");
        // in the same tap the PIN given before the hand-over opens nothing
        assertEquals(SW_SECURITY_NOT_SATIS, pinOnly(c, INS_GET_LOG, 0, null), "the PIN of this tap no longer reads the log");
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)), "nor is it taken again");
        // through power cuts and SELECTs: the PIN alone opens nothing
        for (int round = 0; round < 2; round++) {
            c.power();
            c.select();
            assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)), "the old PIN, round " + round);
            assertEquals(SW_SECURITY_NOT_SATIS, pinOnly(c, INS_GET_LOG, 1, null), "GET_LOG");
            assertEquals(SW_SECURITY_NOT_SATIS, pinOnly(c, CashuApplet.INS_GROUP_KEYS, 0, u32(0)), "GROUP_KEYS");
            assertEquals(SW_SECURITY_NOT_SATIS, pinOnly(c, 0x1B, 0, null), "GET_OUTBOX");
        }
        // the history is gone, for the next owner as for anyone: the places freed, no proof kept, no receipt, a new generation
        assertEquals(SW_GRANT, nextOwnerGrant(c));
        byte[] info = c.info(0);
        assertEquals(0, info[4], "no spent place");
        assertEquals(128, info[5] & 0xFF, "every place empty");
        assertEquals(0L, readUint32(c.log(1).getData(), 0), "no receipt");
        byte[] last = PerPaymentKeyTest.field(c, "lastSig");
        assertTrue(Arrays.equals(new byte[last.length], last), "no signature kept");
        byte[] dleq = PerPaymentKeyTest.field(c, "dleq");
        assertTrue(Arrays.equals(new byte[dleq.length], dleq), "no mint's proof kept");
        assertFalse(Arrays.equals(genBefore, PerPaymentKeyTest.field(c, "outGen")), "a new generation");
        assertArrayEquals(limitBefore, Arrays.copyOfRange(PerPaymentKeyTest.field(c, "cardRecord"), 0, 60), "the record's settings stay");
        // the next owner sets a new PIN with its proof, and the PIN opens the card again
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0, ownerData(nextOwnerProof(c, L_PIN, NEW_PIN), NEW_PIN))), "the next owner's CHANGE_PIN");
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)), "the new PIN");
        assertEquals(SW_OK, pinOnly(c, INS_GET_LOG, 0, null));
        assertEquals(SW_OK, pinOnly(c, CashuApplet.INS_GROUP_KEYS, 0, u32(0)));
        c.power();
        assertEquals(0x63C2, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)), "the old PIN is a wrong one now");
    }

    @Test
    @DisplayName("a reset after a hand-over leaves a new card whose first PIN works: the new PIN owed goes with the owner")
    void aResetAfterAHandOverTakesTheNewPinOwedWithIt() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, replaceOwner(c));
        c.power();
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OTHER_OWNER, n, new byte[0]), new byte[0]))), "the next owner resets");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)), "the new card's first PIN");
    }

    @Test
    @DisplayName("an owner is replaced only with no change owed (6A8D), as a reset: change to come would be locked to the old c's keys")
    void anOwnerIsReplacedOnlyWithNoChangeOwed() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int p = c.put(-1, KeysetKeysTest.A.id8(), 1024);
        KeysetKeysTest.taught(c, KeysetKeysTest.A);
        c.tap();
        KeysetKeysTest.payWithChange(c, p, 512, KeysetKeysTest.A.keyFor(512), null);
        assertEquals(0, c.info(0)[3], "nothing unspent");
        byte[] chain = PerPaymentKeyTest.field(c, "chain").clone();
        c.tap();
        assertEquals(SW_CARD_IN_USE, replaceOwner(c), "change owed");
        assertArrayEquals(chain, PerPaymentKeyTest.field(c, "chain"), "c as it was");
        assertEquals(1, PerPaymentKeyTest.field(c, "ownerSet")[0]);
    }
}
