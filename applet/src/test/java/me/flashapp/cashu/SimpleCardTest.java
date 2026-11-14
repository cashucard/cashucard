package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Simple cards (D196): a card with no owner has its limits, no-PIN allowance, window switch, rate, mint and unit set once, in
 * its first set-up, and never again; it is claimed only there. A first set-up is opened by the SET_PIN that gives a PIN to a
 * card with none (new, or reset), and ended by the next selection. The way back is a reset by the PIN, held for, on an empty
 * card; the forgotten-PIN path opens no first set-up. A factory record goes only on a card that has never had a PIN.
 */
class SimpleCardTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** A card set up with no owner and still in its first set-up: the selection of its SET_PIN, not yet ended. */
    static UnitsTest.Card inFirstSetUp(int unit) {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(unit))));
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        return c;
    }

    /** A card with no owner whose holder set `v` in its first set-up; then a new tap with the PIN. */
    static UnitsTest.Card setUpWith(byte[] v) {
        UnitsTest.Card c = inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_OK, byPin(c, v));
        c.tap();
        return c;
    }

    static int byPin(UnitsTest.Card c, byte[] v) { return c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, v)); }
    static byte[] eighteen(long day, long tap, long allowance, int budget, long rate, int sw) {
        return concat(u32(day), u32(tap), u32(allowance), new byte[] { (byte) budget }, u32(rate), new byte[] { (byte) sw });
    }
    static long at(UnitsTest.Card c, int off) throws Exception { return readUint32(c.record(), off); }
    static int raw(UnitsTest.Card c, CommandAPDU a) { return c.sim.transmitCommand(a).getSW(); }

    static final CommandAPDU RESET_BY_PIN = new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM);
    static final byte[] LOOSE = eighteen(1_000_000, 1_000_000, 1_000_000, 30, 0, 1);

    /** The reset of a card with no owner by its PIN, asked until it is through: { the askings answered 6A98, the last word }. */
    static int[] resetByPin(UnitsTest.Card c) {
        int n = 0;
        ResponseAPDU r;
        while ((r = c.sim.transmitCommand(RESET_BY_PIN)).getSW() == SW_KEEP_HOLDING && n < 200) {
            assertEquals(0, r.getData().length, "keep holding, and nothing else");
            n++;
        }
        return new int[] { n, r.getSW() };
    }

    /** VERIFY_PIN asked through its wait: the last word. */
    static int verify(UnitsTest.Card c, byte[] pin) { return PinWaitTest.asked(c, pin)[1]; }

    static void threeWrong(UnitsTest.Card c) {
        for (int k = 1; k <= 3; k++) assertEquals(0x63C0 | k, verify(c, WRONG_PIN));
    }

    // =========================================================================
    // Set once
    // =========================================================================

    @Test
    @DisplayName("The PIN form of SET_LIMIT and SET_CARD go through any number of times in the first set-up, and after it neither goes through (6A91), not even a tighter value, with nothing written")
    void theNumbersAndTheRecordAreSetOnce() throws Exception {
        UnitsTest.Card c = inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_OK, byPin(c, eighteen(1000, 100, 50, 30, 1500, 1)), "anything");
        assertEquals(SW_OK, byPin(c, eighteen(2000, 200, 60, 20, 1400, 0)), "and anything again");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.USD))), "the record again, another unit");
        c.tap();
        byte[] before = c.record().clone();
        HolderTest.hold(c);
        assertEquals(SW_OWNER_PROOF, byPin(c, eighteen(1000, 100, 0, 7, 1400, 0)), "a tighter value");
        assertEquals(SW_OWNER_PROOF, byPin(c, u32(1)), "four bytes");
        assertEquals(SW_OWNER_PROOF, byPin(c, LOOSE), "a looser one");
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.USD))), "the same record");
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))), "another unit");
        assertArrayEquals(before, c.record(), "nothing written");
    }

    @Test
    @DisplayName("The first set-up is told apart by the SET_PIN that gives a PIN to a card with none (new, or reset): a persistent mark that every selection ends; a SET_PIN on a card that has a PIN, its own replaced or a forgotten one, opens none, and neither does a factory record")
    void whatTellsTheFirstSetUpApart() throws Exception {
        UnitsTest.Card c = inFirstSetUp(UnitsTest.SAT);
        assertEquals(1, c.field("pinMarks")[CashuApplet.PM_FIRST], "a new card's SET_PIN");
        c.select();
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FIRST], "a SELECT ends it");
        c.pin();
        HolderTest.hold(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the holder's PIN replaced, under it");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FIRST], "opens none");
        // a card a stranger gave a PIN on its way to its holder, with the factory record: the holder's SET_PIN is not a first set-up
        UnitsTest.Card f = new UnitsTest.Card();
        assertEquals(SW_OK, f.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND, "FX1"))), "the issuer's factory record");
        assertEquals(SW_OK, f.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "a stranger's PIN: the first set-up is the stranger's");
        f.power();
        assertEquals(0, f.field("pinMarks")[CashuApplet.PM_FIRST], "ended by the field");
        assertEquals(SW_SECURITY_NOT_SATIS, f.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the holder's SET_PIN wants the PIN the card has");
        assertEquals(0, f.field("pinMarks")[CashuApplet.PM_FIRST]);
        // the forgotten-PIN path on an empty card opens none
        threeWrong(f);
        assertEquals(SW_OK, f.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "three wrong tries, then a new PIN");
        assertEquals(0, f.field("pinMarks")[CashuApplet.PM_FIRST], "and no first set-up");
        f.pin();
        assertEquals(SW_OWNER_PROOF, byPin(f, u32(1)));
    }

    // =========================================================================
    // A reader handed the PIN, on a card it emptied
    // =========================================================================

    @Test
    @DisplayName("A reader handed the PIN takes the whole balance, turns its field off and on, gives the PIN and holds the history: the factory record is 6A80, the holder's own PIN set again opens no first set-up, every value by the PIN is 6A91, and a stranger with no PIN pays nothing of the holder's next load")
    void aReaderWithThePinLoosensNothing() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(100), u32(100), u32(0)));
        int p1 = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p1).getData().length, "the holder pays all 60 at the till");
        c.power();
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)), "the PIN it was handed");
        HolderTest.hold(c);
        byte[] before = c.record().clone();
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND))), "a factory record over the holder's: no record after the first set-up");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the holder's PIN, set again under itself");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FIRST], "no first set-up");
        c.pin();
        assertEquals(SW_OWNER_PROOF, byPin(c, LOOSE), "loose numbers");
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))), "the record");
        assertArrayEquals(before, c.record(), "nothing written");
        c.tap();
        int p2 = c.put(-1, A.id8(), 50);
        c.power();
        assertEquals(SW_PIN_NEEDED, c.pay(p2).getSW(), "no allowance: a stranger is refused");
        assertEquals(50, readUint32(c.balance(0), 0));
    }

    @Test
    @DisplayName("A reader handed the PIN cannot claim the card it emptied (6A91): a card set up with no owner is never claimed, and the holder's next load stays the holder's")
    void aReaderWithThePinClaimsNothing() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(100), u32(100), u32(0)));
        int p1 = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p1).getData().length);
        c.power();
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)), "the claim, refused before any asking");
        HolderTest.hold(c);
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)), "and in a held tap");
        assertEquals(0, c.field("ownerSet")[0]);
    }

    @Test
    @DisplayName("A day's limit cannot be lowered on an emptied card by the PIN (6A91): the holder's next load is never held below its pieces")
    void aReaderWithThePinTightensNothing() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(1000), u32(1000), u32(0)));
        int p1 = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p1).getData().length);
        c.power();
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        HolderTest.hold(c);
        assertEquals(SW_OWNER_PROOF, byPin(c, concat(u32(1), u32(1), u32(0))), "a day of 1");
        c.tap();
        int p2 = c.put(-1, A.id8(), 500);
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 3 * 86_400)));
        c.tap();
        assertEquals(64, c.pay(p2).getData().length, "the holder's 500 pays");
    }

    // =========================================================================
    // A stranger with no PIN
    // =========================================================================

    @Test
    @DisplayName("A stranger with no PIN, on an empty card set up with no owner: three wrong tries and a PIN of its own (the forgotten-PIN path) open no first set-up: no claim, no factory record, no number, no record")
    void aStrangerOpensNoFirstSetUp() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(2000), u32(1000), u32(0)));
        int p = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p).getData().length, "the card spent to empty");
        c.power();
        threeWrong(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "a new PIN on an empty card");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FIRST]);
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OTHER_OWNER)), "no claim");
        HolderTest.hold(c);
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", REFUND))), "no factory record");
        assertEquals(SW_OWNER_PROOF, byPin(c, LOOSE), "no number");
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))), "no record");
        assertEquals(0, c.field("ownerSet")[0]);
        assertEquals(2000, at(c, CashuApplet.CARD_LIMIT_OFFSET), "the holder's numbers");
        assertEquals(0, at(c, CashuApplet.CARD_NOPIN_LIMIT_OFFSET));
    }

    @Test
    @DisplayName("The forgotten-PIN path takes the history with it: the log, the receipts, the last packet (GET_OUTBOX 6A88), the last signature and the signatures kept for SPEND_ALL_AGAIN")
    void theForgottenPinTakesTheWholeHistory() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        int a = c.put(-1, UnitsTest.SAT_A, 60);
        byte[] slotA = c.slot(a);
        byte[] toA = PaymentRecoveryTest.out(60, 1);
        c.tap();
        assertEquals(64, PaymentRecoveryTest.payTo(c, a, toA).getData().length);
        c.power();
        threeWrong(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)), "the last signature");
        assertEquals(SW_SLOT_EMPTY, PaymentRecoveryTest.again(c, PaymentRecoveryTest.messageOf(c, slotA, toA)).getSW(), "by its message");
        HolderTest.hold(c);
        assertEquals(SW_SLOT_EMPTY, HistoryPrivacyTest.page(c).getSW(), "the last packet");
        byte[] paid = c.field("paid");
        assertTrue(allZero(Arrays.copyOfRange(paid, CashuApplet.PAID_SIGS, paid.length)), "the signatures kept");
        assertTrue(allZero(c.field("lastSig")), "the last signature's bytes");
    }

    static boolean allZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    // =========================================================================
    // The factory record
    // =========================================================================

    @Test
    @DisplayName("A factory record goes on a card that has never had a PIN and holds no holder's record, and on no other: not over a holder's record, not in a first set-up, not on a reset card, not by an owner (6A80)")
    void aFactoryRecordOnlyOnANewCard() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND, "FX1"))), "a new card");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND, "EL1"))), "and again");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))), "a holder's record before the PIN");
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND))), "not over it");
        UnitsTest.Card d = inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_WRONG_DATA, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND))), "not in a first set-up");
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        byte[] fac = record("-", NO_REFUND);
        assertEquals(SW_WRONG_DATA, o.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(o.proofFor(L_CARD, fac), fac))), "not by an owner");
        assertEquals(SW_OK, o.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(o.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(SW_WRONG_DATA, o.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND))), "not on a card reset: it has had a PIN");
        assertEquals(SW_OK, o.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))), "a holder's record goes on");
    }

    // =========================================================================
    // The way back: a reset by the PIN
    // =========================================================================

    @Test
    @DisplayName("A holder with no phone who wants one as owner empties the card, resets it by the PIN in a held tap (sixty askings), and sets it up again: the phone claims it in the new first set-up")
    void theWayBackToAPhone() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(1000), u32(500), u32(100)));
        byte[] oldKey = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
        int p = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p).getData().length, "the card emptied");
        c.tap();
        HolderTest.hold(c);
        int[] r = resetByPin(c);
        assertEquals(SW_OK, r[1], "the reset");
        assertEquals(CashuApplet.RESET_ASKINGS - 1, r[0], "held for");
        assertEquals(0, c.field("pinState")[0], "no PIN");
        assertEquals(0, c.field("ownerSet")[0]);
        assertEquals(0, c.record()[CashuApplet.CARD_SET_OFFSET], "no record");
        assertEquals(0, at(c, CashuApplet.CARD_LIMIT_OFFSET), "no limits");
        assertEquals(0, at(c, CashuApplet.CARD_NOPIN_LIMIT_OFFSET));
        assertFalse(Arrays.equals(oldKey, c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData()), "a new card key");
        assertTrue(allZero(c.field("cardLog")), "no history");
        // a phone sets it up again and claims it, in the same selection
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(1, c.field("pinMarks")[CashuApplet.PM_FIRST], "a first set-up again");
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)), "claimed");
        assertEquals(1, c.field("ownerSet")[0]);
        c.tap();
        assertEquals(SW_OK, c.limits(0, 0, 0, 7, 0), "the owner's limits");
    }

    @Test
    @DisplayName("Or set up again by the PIN alone, with numbers of the holder's choosing")
    void setUpAgainByThePin() throws Exception {
        UnitsTest.Card c = setUpWith(concat(u32(1000), u32(500), u32(0)));
        HolderTest.hold(c);
        assertEquals(SW_OK, resetByPin(c)[1], "an unused card");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, byPin(c, concat(u32(3000), u32(800), u32(0))));
        assertEquals(3000, at(c, CashuApplet.CARD_LIMIT_OFFSET));
    }

    @Test
    @DisplayName("A reset by the PIN: no data, the PIN given, a held tap, an empty card, then the askings; in order 6A97, 6982, 6982 (no hold), 6985 (a tap that paid), 6700, 6A8D; any other command between the askings begins them again")
    void theResetByThePinIsAskedFor() throws Exception {
        UnitsTest.Card n = new UnitsTest.Card();
        assertEquals(SW_NO_PIN, raw(n, RESET_BY_PIN), "no PIN");
        UnitsTest.Card c = setUpWith(concat(u32(1000), u32(500), u32(0)));
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, raw(c, RESET_BY_PIN), "the PIN not given");
        c.pin();
        assertEquals(SW_SECURITY_NOT_SATIS, raw(c, RESET_BY_PIN), "no hold");
        int p = c.put(-1, A.id8(), 60);
        HolderTest.hold(c);
        assertEquals(SW_WRONG_LENGTH, raw(c, new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, new byte[] { 1 })), "data");
        assertEquals(SW_CARD_IN_USE, raw(c, RESET_BY_PIN), "money on the card");
        c.tap();
        assertEquals(64, c.pay(p).getData().length);
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(c, RESET_BY_PIN), "a tap that paid");
        c.tap();
        HolderTest.hold(c);
        for (int k = 0; k < 30; k++) assertEquals(SW_KEEP_HOLDING, raw(c, RESET_BY_PIN), "asking " + k);
        c.info(0);
        int[] r = resetByPin(c);
        assertEquals(CashuApplet.RESET_ASKINGS - 1, r[0], "begun again");
        assertEquals(SW_OK, r[1]);
    }

    @Test
    @DisplayName("A card set up by a stranger on its way to its holder: the holder replaces the forgotten PIN, resets the card by it and sets it up as its own")
    void aCardSetUpBeforeItsHolder() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(SW_OK, byPin(c, LOOSE), "the stranger's numbers");
        c.power();
        threeWrong(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the holder's PIN");
        c.pin();
        assertEquals(SW_OWNER_PROOF, byPin(c, concat(u32(100), u32(100), u32(0))), "the numbers stay");
        HolderTest.hold(c);
        assertEquals(SW_OK, resetByPin(c)[1]);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(SW_OK, byPin(c, eighteen(100, 100, 0, 7, 0, 0)), "the holder's own");
        assertEquals(0, at(c, CashuApplet.CARD_NOPIN_LIMIT_OFFSET));
    }

    // =========================================================================
    // Owned cards
    // =========================================================================

    @Test
    @DisplayName("An owned card as before: the owner's form sets any number with money on the card, the PIN form is 6A91, the owner's reset wants its proof")
    void anOwnedCardAsBefore() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(SW_OK, c.limits(100, 10, 5, 3, 1000));
        c.put(-1, A.id8(), 64);
        assertEquals(SW_OK, c.ownerLimit(eighteen(0, 0, 500, 30, 10, 1)), "every field looser, money on the card");
        assertEquals(SW_OK, c.ownerLimit(eighteen(50, 5, 0, 1, 2000, 0)), "and tighter");
        assertEquals(SW_OWNER_PROOF, byPin(c, u32(1)), "the PIN form");
        HolderTest.hold(c);
        assertEquals(SW_OWNER_PROOF, raw(c, RESET_BY_PIN), "a reset by the PIN alone: the proof is wanted");
    }
    // =========================================================================
    // Limits before the record
    // =========================================================================

    @Test
    @DisplayName("Limits set before a card has a holder's record are in the unit the record names: a usd card set up limits first keeps its cents, nothing turned by the rate, and takes the holder's first top-up")
    void limitsBeforeTheRecordAreInItsUnit() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        // $100 a day, $50 a payment, $20 with no PIN, in cents; 100,000 sats to the dollar
        assertEquals(SW_OK, byPin(c, eighteen(10_000, 5_000, 2_000, 7, 100_000, 0)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.USD))), "the record, a usd card");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        assertEquals(10_000, at(c, CashuApplet.CARD_LIMIT_OFFSET), "the day's limit as sent");
        assertEquals(5_000, at(c, CashuApplet.CARD_TAP_LIMIT_OFFSET), "the limit on one payment as sent");
        assertEquals(2_000, at(c, CashuApplet.CARD_NOPIN_LIMIT_OFFSET), "the allowance as sent");
        assertEquals(100_000, c.rate(), "the rate as sent");
        assertEquals(SW_OK, c.load(c.piece(UnitsTest.USD_A, 500)).getSW(), "the holder's first top-up, $5");
    }

    @Test
    @DisplayName("Limits with no rate, then a record of the other unit: the record is taken (nothing to turn), the limits as sent")
    void limitsWithNoRateBeforeTheRecord() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, byPin(c, concat(u32(10_000), u32(5_000), u32(2_000))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.USD))), "the record, a usd card");
        assertEquals(10_000, at(c, CashuApplet.CARD_LIMIT_OFFSET));
        assertEquals(2_000, at(c, CashuApplet.CARD_NOPIN_LIMIT_OFFSET));
        // and a holder's record of the other unit after it, in the same set-up, is turned at the rate as ever: with none, 6A99
        assertEquals(UnitsTest.SW_NO_RATE, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
    }
}
