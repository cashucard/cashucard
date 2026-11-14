package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * An owner replaced (SET_OWNER on an owned card, D197) is a hand-over: what was the last owner's goes with it. The record's
 * refund key (c is sealed to the PIN key, and no dated piece is taken, until the next owner's SET_CARD names its own), the
 * day's counts, the day of loads, the clock's last header hash, the rolls and the arming, the paid list and the keyset
 * entries nothing names. The limits, the rate, the allowance, the roll budget and the clock's time stay.
 */
class HandOverTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final long D1 = 1_900_000_000L;

    /** The next owner, after a hand-over: its CHANGE_PIN with NEW_PIN, then a new tap with NEW_PIN and its grant. */
    static void nextOwnerTakesOver(UnitsTest.Card c) {
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0,
            ownerData(LinkingTest.nextOwnerProof(c, L_PIN, NEW_PIN), NEW_PIN))), "the next owner's CHANGE_PIN");
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_GRANT, LinkingTest.nextOwnerGrant(c));
    }

    /** A new tap with the next owner's PIN. */
    static void nextOwnersTap(UnitsTest.Card c) {
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
    }

    /** The next owner's SET_CARD under its proof, with `refund`. */
    static int nextOwnersRecord(UnitsTest.Card c, byte[] refund) {
        byte[] r = record(MINT, refund);
        return c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(LinkingTest.nextOwnerProof(c, L_CARD, r), r)));
    }

    @Test
    @DisplayName("a hand-over takes the record's refund key and its y with it: GET_CARD P1 = 3 seals the next owner's c to the PIN key (the sealed-to-refund form, no data, is 6700), the last owner's r opens nothing, and a dated piece is refused 6A8E with nothing written")
    void theRefundKeyGoesWithTheLastOwner() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);       // the record's refund key: REFUND, the last owner's r = 1
        byte[] pinKey = LinkingTest.ownPinKey(c);
        assertFalse(Arrays.equals(new byte[32], Arrays.copyOfRange(c.field("chain"), 32, 64)), "the refund key's y kept before");
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c), "the hand-over");
        byte[] cNew = Arrays.copyOf(c.field("chain"), 32);
        assertArrayEquals(new byte[33], Arrays.copyOfRange(c.record(), CashuApplet.CARD_REFUND_OFFSET, CashuApplet.CARD_REFUND_OFFSET + 33), "no refund key in the record");
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.field("chain"), 32, 64), "and no y");
        c.power();
        assertArrayEquals(new byte[33], Arrays.copyOfRange(c.getCard(0), 7, 40), "GET_CARD says none");
        nextOwnerTakesOver(c);
        // c is sealed to the PIN key, for the next owner's grant: the form with no data (sealed to a refund key) is gone
        Object[] toRefund = LinkingTest.sealedToRefund(c);
        assertEquals(SW_WRONG_LENGTH, ((ResponseAPDU) toRefund[0]).getSW(), "no c sealed to a refund key");
        Object[] got = LinkingTest.readC(c, pinKey, 5);
        assertEquals(SW_OK, got[1]);
        assertArrayEquals(cNew, (byte[]) got[0], "c, sealed to the PIN key and opened by the reader that sent E");
        // a dated piece is refused, with nothing written; the day of loads is not counted
        byte[] pm = c.field("pinMarks").clone();
        ResponseAPDU dated = c.load(buildProof(UnitsTest.SAT_A, 500, 91, D1));
        assertEquals(CashuApplet.SW_NO_REFUND_KEY & 0xFFFF, dated.getSW(), "a dated piece on a card with no refund key");
        assertEquals(0, c.info(0)[3], "nothing loaded");
        assertArrayEquals(pm, c.field("pinMarks"), "no load counted");
    }

    @Test
    @DisplayName("after a hand-over an undated piece is loaded and paid as on a card with no refund key: its keys name no refund key (BEGIN and GROUP_KEYS answer R as zeros), and the payment verifies under P + t*G of the next owner's c")
    void anUndatedPieceNeedsNoRefundKey() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        c.power();
        nextOwnerTakesOver(c);
        nextOwnersTap(c);
        DateKeys k = DateKeys.of(c.applet());
        int place = PerPaymentKeyTest.load(c, 300, 92, 0);
        ResponseAPDU g = PerPaymentKeyTest.groupKeys(c, 0);
        assertEquals(SW_OK, g.getSW());
        assertArrayEquals(k.key(0), Arrays.copyOfRange(g.getData(), 32, 65));
        assertArrayEquals(new byte[33], Arrays.copyOfRange(g.getData(), 65, 98), "no refund key for the date 0");
        nextOwnersTap(c);
        ResponseAPDU b = c.beginAs(0, place);
        assertEquals(SW_OK, b.getSW());
        assertArrayEquals(new byte[33], Arrays.copyOfRange(b.getData(), 36, 69), "BEGIN: no refund key");
        ResponseAPDU s = c.sign();
        assertEquals(64, s.getData().length, "paid");
    }

    @Test
    @DisplayName("after a hand-over the next owner's SET_CARD under its proof names its own refund key: c is sealed to that key and opened with its r (and not with the last owner's), and a dated piece is taken, its refund key R' + u*G of the next owner's c")
    void theNextOwnerNamesItsOwnRefundKey() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        c.power();
        nextOwnerTakesOver(c);
        assertEquals(SW_OK, nextOwnersRecord(c, LinkingTest.REFUND_7), "the next owner's record, its refund key 7G");
        byte[] cNew = Arrays.copyOf(c.field("chain"), 32);
        nextOwnersTap(c);
        assertEquals(SW_GRANT, LinkingTest.nextOwnerGrant(c));
        Object[] a = LinkingTest.sealedToRefund(c);
        ResponseAPDU r = (ResponseAPDU) a[0];
        assertEquals(SW_OK, r.getSW());
        assertArrayEquals(cNew, LinkingTest.openToRefund(r.getData(), LinkingTest.R7, (byte[]) a[1]), "opened with the next owner's r");
        assertFalse(Arrays.equals(cNew, LinkingTest.openToRefund(r.getData(), BigInteger.ONE, (byte[]) a[1])), "not with the last owner's");
        nextOwnersTap(c);
        int place = PerPaymentKeyTest.load(c, 500, 93, D1);
        ResponseAPDU b = PerPaymentKeyTest.begin(c, place);
        assertEquals(SW_OK, b.getSW());
        BigInteger u = DateKeys.tweak("CashuCard/refund-key", cNew, D1);
        assertArrayEquals(compressed(ecMulTest(LinkingTest.R7.add(u).mod(DateKeys.N), SECP_GX, SECP_GY)), Arrays.copyOfRange(b.getData(), 36, 69),
            "the piece's refund key is the next owner's r + u");
    }

    @Test
    @DisplayName("a hand-over takes the day's counts with it (the window and what it signed for, the no-PIN window's start and count, the day of loads, its count and the change it counted): the next owner's grant reads zeros and its first payment has the whole day's limit; the limits, rate and allowance stay")
    void theDayStartsAgainForTheNextOwner() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 0), "a day's limit of 1000");
        c.tap();
        LinkingTest.payOne(c, 777, 41, 0);
        byte[] rec = c.record();
        assertEquals(777, readUint32(rec, CashuApplet.CARD_SPENT_OFFSET));
        assertTrue(readUint32(rec, CashuApplet.CARD_WINDOW_OFFSET) != 0, "a window begun");
        /* the no-PIN window's start with no count (a window's end torn between its two writes leaves it so; the old owner's
         * proof ends a window that has a count), and the change counted */
        System.arraycopy(u32(1_800_000_123L), 0, rec, CashuApplet.CARD_NOPIN_START_OFFSET, 4);
        c.field("pinMarks")[CashuApplet.PM_COUNTED] = 1;
        byte[] pm = c.field("pinMarks");
        assertTrue(pm[CashuApplet.PM_LOADS] != 0 || pm[CashuApplet.PM_LOADS + 1] != 0, "a load counted");
        byte[] limits = Arrays.copyOfRange(rec, CashuApplet.CARD_LIMIT_OFFSET, CashuApplet.CARD_LIMIT_OFFSET + 4);
        byte[] settings = Arrays.copyOfRange(rec, CashuApplet.CARD_TAP_LIMIT_OFFSET, CashuApplet.CARD_NOPIN_SPENT_OFFSET);
        byte[] rate = Arrays.copyOfRange(rec, CashuApplet.CARD_RATE_OFFSET, CashuApplet.CARD_RATE_OFFSET + 4);
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        // at once, before the next owner's first proof (which ends a no-PIN window of itself): the no-PIN window's start and count
        rec = c.record();
        assertArrayEquals(new byte[4], Arrays.copyOfRange(rec, CashuApplet.CARD_NOPIN_START_OFFSET, CashuApplet.CARD_NOPIN_START_OFFSET + 4), "the no-PIN window's start, at the hand-over");
        assertArrayEquals(new byte[4], Arrays.copyOfRange(rec, CashuApplet.CARD_NOPIN_SPENT_OFFSET, CashuApplet.CARD_NOPIN_SPENT_OFFSET + 4), "the no-PIN count, at the hand-over");
        c.power();
        assertArrayEquals(new byte[4], Arrays.copyOfRange(c.info(1), 38, 42), "GET_INFO's no-PIN count, to anyone, before the next owner's first proof");
        nextOwnerTakesOver(c);
        byte[] info = c.info(0);
        assertArrayEquals(new byte[8], Arrays.copyOfRange(info, 21, 29), "the next owner's grant: no window, nothing signed for");
        rec = c.record();
        assertArrayEquals(new byte[8], Arrays.copyOfRange(rec, CashuApplet.CARD_WINDOW_OFFSET, CashuApplet.CARD_WINDOW_OFFSET + 8), "the window and its count");
        assertArrayEquals(new byte[4], Arrays.copyOfRange(rec, CashuApplet.CARD_NOPIN_START_OFFSET, CashuApplet.CARD_NOPIN_START_OFFSET + 4), "the no-PIN window's start");
        assertArrayEquals(new byte[4], Arrays.copyOfRange(rec, CashuApplet.CARD_NOPIN_SPENT_OFFSET, CashuApplet.CARD_NOPIN_SPENT_OFFSET + 4), "the no-PIN count");
        assertArrayEquals(new byte[CashuApplet.PM_FORGET - CashuApplet.PM_LOAD_DAY], Arrays.copyOfRange(c.field("pinMarks"), CashuApplet.PM_LOAD_DAY, CashuApplet.PM_FORGET),
            "the day of loads, its count and the change it counted");
        assertArrayEquals(limits, Arrays.copyOfRange(rec, CashuApplet.CARD_LIMIT_OFFSET, CashuApplet.CARD_LIMIT_OFFSET + 4), "the day's limit stays");
        assertArrayEquals(settings, Arrays.copyOfRange(rec, CashuApplet.CARD_TAP_LIMIT_OFFSET, CashuApplet.CARD_NOPIN_SPENT_OFFSET), "the limit on one payment and the allowance stay");
        assertArrayEquals(rate, Arrays.copyOfRange(rec, CashuApplet.CARD_RATE_OFFSET, CashuApplet.CARD_RATE_OFFSET + 4), "the rate stays");
        // the next owner's first payment: 300 under the limit of 1000, the last owner's 777 not counted
        nextOwnersTap(c);
        int place = PerPaymentKeyTest.load(c, 300, 42, 0);
        nextOwnersTap(c);
        assertEquals(64, c.pay(place).getData().length, "the next owner's payment of 300");
        assertEquals(300, readUint32(c.record(), CashuApplet.CARD_SPENT_OFFSET));
    }

    @Test
    @DisplayName("a hand-over empties the paid list (its next row and its round), so it answers the next owner nothing of the last owner's pieces: a nonce the last owner paid is loaded (not 6A94), and the card pays it only under the next owner's keys, which the piece's secret never named")
    void thePaidListGoesWithTheLastOwner() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        DateKeys before = DateKeys.of(c.applet());
        LinkingTest.payOne(c, 8, 55, 0);     // the last owner's piece, nonce 55
        byte[] paid = c.field("paid");
        assertTrue(paid[CashuApplet.PAID_NEXT] != 0 || paid[CashuApplet.PAID_NEXT + 1] != 0, "a row in use");
        paid[CashuApplet.PAID_ROUND] = 1;    // and a ring gone round, as a card that has signed for 1,024 pieces
        c.tap();
        assertEquals(SW_PIECE_ON_CARD, c.load(buildProof(UnitsTest.SAT_A, 3, 55, 0)).getSW(), "the last owner's own PIN: the list answers");
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        assertEquals(0, paid[CashuApplet.PAID_NEXT] | paid[CashuApplet.PAID_NEXT + 1] | paid[CashuApplet.PAID_ROUND], "the list emptied");
        c.power();
        nextOwnerTakesOver(c);
        nextOwnersTap(c);
        ResponseAPDU seen = c.load(buildProof(UnitsTest.SAT_A, 3, 55, 0));
        assertEquals(SW_OK, seen.getSW(), "the last owner's paid nonce is loaded: the list says nothing of it");
        DateKeys after = DateKeys.of(c.applet());
        assertFalse(Arrays.equals(before.key(0), after.key(0)), "the card's key for the date 0 is the next owner's, not the one the piece's secret named");
    }

    @Test
    @DisplayName("a hand-over lets go every keyset entry nothing names (reclaim): a dead entry of the other unit does not keep the card in format 5, GET_CARD P1 = 2 shows no entry, and the next owner's 4-byte SET_LIMIT is taken")
    void aDeadEntryGoesWithTheLastOwner() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.grant();
        int usd = c.put(UnitsTest.USD, UnitsTest.USD_A, 500);
        c.tap();
        assertEquals(64, c.pay(usd).getData().length, "the usd piece paid");
        assertEquals(5, c.info(0)[8], "format 5 before");
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        c.power();
        nextOwnerTakesOver(c);
        assertEquals(4, c.info(0)[8], "format 4 after");
        assertArrayEquals(new byte[] { 0 }, c.getCard(2), "no entry in use");
        byte[] v = u32(5000);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(LinkingTest.nextOwnerProof(c, L_LIMIT, v), v))),
            "the next owner's 4-byte SET_LIMIT, nothing of the other unit held");
    }

    @Test
    @DisplayName("a hand-over takes the clock's last header hash, the rolls and the arming with it: the next owner's grant reads zeros at GET_CARD 44..76, 76 and 78; the clock's time and hardest difficulty and the roll budget stay, and the next tap takes a later header (the hash its own), refuses to go back to an older one, and the next owner's REFRESH is taken")
    void theClockGoesOnForTheNextOwner() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        LinkingTest.payOne(c, 8, 61, 0);
        long t0 = readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET) + 600;
        assertEquals(SW_OK, c.sw(setTimeCommand(t0)));
        byte[] rec = c.record();
        rec[CashuApplet.CARD_ROLLS_OFFSET] = 3;
        rec[CashuApplet.CARD_BUDGET_OFFSET] = 5;
        rec[CashuApplet.CARD_ARMED_OFFSET] = 1;
        assertFalse(Arrays.equals(new byte[32], Arrays.copyOfRange(rec, CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32)), "the last owner's last header");
        byte[] clock = Arrays.copyOfRange(rec, CashuApplet.CARD_NOW_OFFSET, CashuApplet.CARD_NOW_OFFSET + 4);
        byte[] bits = Arrays.copyOfRange(rec, CashuApplet.CARD_BITS_OFFSET, CashuApplet.CARD_BITS_OFFSET + 4);
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        rec = c.record();
        assertArrayEquals(new byte[32], Arrays.copyOfRange(rec, CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32), "the header hash, at the hand-over");
        assertEquals(0, rec[CashuApplet.CARD_ROLLS_OFFSET], "the rolls, at the hand-over");
        assertEquals(0, rec[CashuApplet.CARD_ARMED_OFFSET], "the arming, at the hand-over");
        c.power();
        nextOwnerTakesOver(c);
        byte[] card = c.getCard(0);
        assertArrayEquals(new byte[33], Arrays.copyOfRange(card, 44, 77), "the next owner's grant: no header hash, no rolls");
        assertEquals(5, card[77], "the budget stays");
        assertEquals(1, card[78], "armed again by the next owner's own PIN and proof, not the last owner's");
        rec = c.record();
        assertArrayEquals(clock, Arrays.copyOfRange(rec, CashuApplet.CARD_NOW_OFFSET, CashuApplet.CARD_NOW_OFFSET + 4), "the clock's time stays");
        assertArrayEquals(bits, Arrays.copyOfRange(rec, CashuApplet.CARD_BITS_OFFSET, CashuApplet.CARD_BITS_OFFSET + 4), "the hardest difficulty stays");
        // the next tap: an older header moves nothing, a later one is taken
        nextOwnersTap(c);
        assertEquals(SW_OK, c.sw(setTimeCommand(t0 - 3600)));
        assertArrayEquals(clock, Arrays.copyOfRange(c.record(), CashuApplet.CARD_NOW_OFFSET, CashuApplet.CARD_NOW_OFFSET + 4), "an older header: the clock does not go back");
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32), "nor is its hash taken");
        assertEquals(SW_OK, c.sw(setTimeCommand(t0 + 600)));
        assertEquals(t0 + 600, readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET), "a later header moves the clock");
        assertEquals(blockHash(blockAt(t0 + 600)), toHex(Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32)), "and its hash is the one kept");
        // the next owner's REFRESH
        byte[] h = blockAt(t0 + 1200);
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_REFRESH, 0, 0, ownerData(LinkingTest.nextOwnerProof(c, L_REFRESH, h), h), 4));
        assertEquals(SW_OK, r.getSW(), "the next owner's REFRESH");
        assertEquals(t0 + 1200, readUint32(r.getData(), 0));
    }

    @Test
    @DisplayName("a reset takes the clock's last header hash as a hand-over does: after RESET_CARD and the next holder's set-up, GET_CARD 44..76 to the next holder reads no hash of the last holder's; the clock's time stays, and the next tap's later header is taken with its own hash")
    void aResetTakesTheLastHeaderHashToo() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        LinkingTest.payOne(c, 8, 61, 0);
        long t0 = readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET) + 600;
        assertEquals(SW_OK, c.sw(setTimeCommand(t0)));
        byte[] hash = Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32);
        assertEquals(blockHash(blockAt(t0)), toHex(hash), "the last holder's last header");
        c.tap();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CLEAR_SPENT, 0, 0, 1)));
        CertificateTest.reset(c);
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32), "the header hash, at the reset");
        assertEquals(t0, readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET), "the clock's time stays");
        c.power();
        CertificateTest.setUpAgain(c);
        c.power();
        c.pin();
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.getCard(0), 44, 76), "the next holder's GET_CARD: no header hash of the last holder's");
        assertEquals(SW_OK, c.sw(setTimeCommand(t0 + 600)));
        assertEquals(blockHash(blockAt(t0 + 600)), toHex(Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32)), "a later header is taken, with its own hash");
    }

    @Test
    @DisplayName("a forgotten PIN replaced (FORGET_HISTORY alone) keeps the refund key, the day's counts, the paid list and the entries: only a hand-over takes them")
    void aForgottenPinKeepsTheMoneysRecord() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        c.tap();
        int p = c.put(-1, UnitsTest.SAT_A, 60);
        c.tap();
        assertEquals(64, c.pay(p).getData().length);
        byte[] rec = c.record().clone(), paid = Arrays.copyOf(c.field("paid"), CashuApplet.PAID_SIGS), book = c.book().clone();
        byte[] marks = Arrays.copyOfRange(c.field("pinMarks"), CashuApplet.PM_LOAD_DAY, CashuApplet.PM_FORGET);
        c.power();
        SimpleCardTest.threeWrong(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the forgotten PIN replaced");
        assertArrayEquals(rec, c.record(), "the record whole");
        assertArrayEquals(paid, Arrays.copyOf(c.field("paid"), CashuApplet.PAID_SIGS), "the paid list whole");
        assertArrayEquals(marks, Arrays.copyOfRange(c.field("pinMarks"), CashuApplet.PM_LOAD_DAY, CashuApplet.PM_FORGET), "the day of loads");
        for (int e = 0; e < 6; e++) assertEquals(book[e * 41 + 8], c.book()[e * 41 + 8], "entry " + e);
    }
}
