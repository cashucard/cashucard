package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.HolderTest.keepHolding;
import static me.flashapp.cashu.HolderTest.raw;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A claim right after the set-up's record is one asking (D221, amending D187): where the card's first set-up had its PIN set
 * and then its record written (SET_CARD) in this time in the field, SET_OWNER on the card with no owner sets the owner at its
 * first asking. Everywhere else the claim is held for CLAIM_ASKINGS askings, as before. Each test here pairs what the mark
 * leaves held with what it lets through, so that each fails on a card without the mark.
 *
 * The mark is a bit of the CLEAR_ON_RESET tapOpen[2] (TAP_SETUP, 0x10), read here by reflection where a test says what it is.
 */
class ClaimAfterSetUpTest {

    static final int SAT = UnitsTest.SAT;
    static final int TAP_SETUP = 0x10;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static int setPin(UnitsTest.Card c, byte[] pin) { return c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, pin)); }
    static int setCard(UnitsTest.Card c) { return c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))); }

    /** The set-up as a phone makes it, in one tap: SET_PIN, VERIFY_PIN, SET_CARD, the clock. The card is marked (TAP_SETUP). */
    static UnitsTest.Card setUp() { return SimpleCardTest.inFirstSetUp(SAT); }

    /** A card whose record was written before its PIN, in the same tap: its first set-up, unmarked, and its claim held. */
    static UnitsTest.Card recordBeforePin() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, setCard(c), "a record on a card with no PIN, as anyone may write it while it is set up");
        assertEquals(SW_OK, setPin(c, TEST_PIN));
        c.pin();
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "a record before the PIN is no mark");
        return c;
    }

    /** The claim held for, as D187 has it: CLAIM_ASKINGS - 1 askings answered 6A98, then the owner set. */
    static void heldClaim(UnitsTest.Card c, String what) throws Exception {
        keepHolding(c, setOwnerOpenCommand(OWNER), CLAIM_ASKINGS - 1, what);
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW(), what + ": the last asking");
        assertEquals(1, c.field("ownerSet")[0], what + ": the owner set");
    }

    /** The claim at its first asking (D221). */
    static void quickClaim(UnitsTest.Card c, String what) throws Exception {
        assertEquals(SW_OK, raw(c, setOwnerOpenCommand(OWNER)).getSW(), what + ": the first asking sets the owner");
        assertEquals(1, c.field("ownerSet")[0], what + ": the owner set");
        assertEquals(0, c.field("nonceLive")[1], what + ": nothing left counted");
    }

    @Test
    @DisplayName("(a) The PIN set, then the record written, then the claim, all in one tap: the owner is set at the first asking, with an anchor and with the owner's c too; the claim's other rules stand (no payment in that time in the field, through a SELECT)")
    void theClaimRightAfterTheRecordIsOneAsking() throws Exception {
        UnitsTest.Card c = setUp();
        quickClaim(c, "plain");
        assertEquals(TAP_SETUP, c.field("tapOpen")[2] & TAP_SETUP, "the PIN set, then the record written: the mark, which the claim leaves");
        int place = c.put(-1, A.id8(), 64);
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(place).getSW(), "no payment in the time in the field that claimed");
        c.select();
        c.pin();
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.begin(place).getSW(), "nor after a SELECT");
        c.tap();
        assertEquals(64, c.pay(place).getData().length, "a new time in the field pays");

        // with an anchor: the header taken at the one asking
        c = setUp();
        CommandAPDU anchored = new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0 + 60)));
        assertEquals(SW_OK, raw(c, anchored).getSW(), "an anchored claim, at the first asking");
        assertEquals(T0 + 60, readUint32(c.info(0), 17), "the anchor taken");

        // with the owner's c (D202): the envelope, then the claim with its check, at the first asking
        c = setUp();
        byte[] s = OwnerCTest.s(OwnerCTest.WORDS, OwnerCTest.cardKey(c));
        assertEquals(SW_OK, c.sw(OwnerCTest.stage(OwnerCTest.envelope(s, OwnerCTest.pinKey(c), OwnerCTest.E1))));
        assertEquals(SW_OK, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, OwnerCTest.check(s)))).getSW(), "the claim with c, at the first asking");
        assertArrayEquals(OwnerCTest.c(s, 1), OwnerCTest.cOf(c), "the owner's c taken");
    }

    @Test
    @DisplayName("(b) No SET_CARD under the PIN in this tap: a record written before the PIN, in this tap or in an earlier one, leaves the claim held for four askings; the same card given its record again under the PIN claims at once")
    void noRecordUnderThePinIsFourAskings() throws Exception {
        heldClaim(recordBeforePin(), "the record before the PIN, in this tap");

        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, setCard(c), "the record, with no PIN");
        c.power();
        assertEquals(SW_OK, setPin(c, TEST_PIN), "a later tap: the PIN, the first set-up");
        c.pin();
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP);
        heldClaim(c, "the record in an earlier tap");

        // the control: the same steps and the record written again under the PIN
        c = recordBeforePin();
        assertEquals(SW_OK, setCard(c), "the record again, now under the PIN");
        quickClaim(c, "the record written under the PIN");
    }

    @Test
    @DisplayName("(c) A PIN from an earlier time in the field (or an earlier selection): the record is fixed (6A91) and the claim refused (6A91) before any asking counts; the mark of a set-up does not outlive its field")
    void aPinFromAnEarlierFieldClaimsNothing() throws Exception {
        // a record of the holder's before the PIN, so that only the PIN's field is in question
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, setCard(c));
        assertEquals(SW_OK, setPin(c, TEST_PIN));
        c.tap();
        assertEquals(SW_OWNER_PROOF, setCard(c), "the record after the first set-up's field ended");
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "no mark");
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "no claim");
        assertEquals(0, c.field("nonceLive")[1], "nothing counted");

        // the same with a SELECT between the PIN and the record, in one field
        c = new UnitsTest.Card();
        assertEquals(SW_OK, setCard(c));
        assertEquals(SW_OK, setPin(c, TEST_PIN));
        c.select();
        c.pin();
        assertEquals(SW_OWNER_PROOF, setCard(c), "the record after a SELECT");
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "no mark");
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "no claim");

        // a marked set-up taken out of the field: the mark is RAM, gone with the power, and the claim with the first set-up
        c = setUp();
        c.tap();
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "gone with the field");
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "no claim in the next tap");

        // the control: no break between the PIN and the record
        quickClaim(setUp(), "the PIN and the record in one selection");
    }

    @Test
    @DisplayName("(d) A reset clears the mark: a set-up's record, a reset by the PIN in the same field, then a record before the new PIN holds the claim for four askings; a set-up after a reset earns its own mark; and so after the owner's reset")
    void aResetClearsTheMark() throws Exception {
        // a reset by the PIN of the marked card, in the same time in the field
        UnitsTest.Card c = setUp();
        HolderTest.hold(c);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1], "reset by the PIN");
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "the reset took the mark");
        assertEquals(SW_OK, setCard(c), "a record with no PIN, after the reset");
        assertEquals(SW_OK, setPin(c, TEST_PIN), "the next holder's PIN");
        c.pin();
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "still no mark");
        heldClaim(c, "after a reset, the record before the PIN");

        // the same card's next holder, whose own set-up writes the record under the PIN: one asking
        c = setUp();
        HolderTest.hold(c);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1]);
        assertEquals(SW_OK, setPin(c, TEST_PIN));
        c.pin();
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "the new PIN alone is no mark");
        assertEquals(SW_NO_CARD_RECORD, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "the reset took the record: no claim without one");
        assertEquals(SW_OK, setCard(c));
        quickClaim(c, "a set-up after a reset, its record under its own PIN");

        // the owner's reset, in the field of the claim
        c = setUp();
        quickClaim(c, "the first owner");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))), "the owner's reset");
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "the owner's reset took the mark too");
        assertEquals(SW_OK, setCard(c));
        assertEquals(SW_OK, setPin(c, TEST_PIN));
        c.pin();
        heldClaim(c, "after the owner's reset, the record before the PIN");
    }

    @Test
    @DisplayName("(e) A SET_CARD that is refused sets no mark (a refund key that is no point, a length that is not the mint's, a factory record, a unit that is none): the claim is still held; a good SET_CARD after them sets it")
    void aRefusedSetCardSetsNothing() throws Exception {
        UnitsTest.Card c = recordBeforePin();
        byte[] badRefund = REFUND.clone();
        badRefund[0] = 0x04;
        assertEquals(SW_WRONG_DATA, c.sw(setCardOpenCommand(record(MINT, badRefund))), "a refund key that is no point");
        byte[] lying = record("0123456789", REFUND);
        lying[99] = 20;
        assertEquals(SW_WRONG_LENGTH, c.sw(setCardOpenCommand(lying)), "a length that is not its mint's");
        assertEquals(SW_WRONG_DATA, c.sw(setCardOpenCommand(record("-", REFUND))), "a factory record on a card that has had a PIN");
        byte[] noUnit = UnitsTest.recordIn(SAT);
        noUnit[0] = 7;
        assertEquals(SW_WRONG_DATA, c.sw(setCardOpenCommand(noUnit)), "a unit that is none");
        assertEquals(0, c.field("tapOpen")[2] & TAP_SETUP, "no mark from any of them");
        keepHolding(c, setOwnerOpenCommand(OWNER), CLAIM_ASKINGS - 1, "held, after the refused records");
        assertEquals(SW_OK, setCard(c), "a good record, which also begins the count again");
        quickClaim(c, "after a good record under the PIN");
    }

    @Test
    @DisplayName("The mark opens no other door: a payment in the field still bars the claim (6985), money on the card (6A8D), a PIN not given (6982), a SELECT (6A91, though the mark survives it), a key off the curve (6A80 at the one asking); a PIN replaced after the record keeps the mark, and the claim is under the new PIN")
    void theMarkOpensNoOtherDoor() throws Exception {
        UnitsTest.Card c = setUp();
        int place = c.put(-1, A.id8(), 64);
        assertEquals(SW_CARD_IN_USE, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "money on the card");
        assertEquals(64, c.pay(place).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(SW_CONDITIONS_NOT_SATIS, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "a time in the field that paid");
        assertEquals(0, c.field("ownerSet")[0]);

        c = setUp();
        c.select();
        assertEquals(TAP_SETUP, c.field("tapOpen")[2] & TAP_SETUP, "the mark is the field's, and outlives a SELECT");
        c.pin();
        assertEquals(SW_OWNER_PROOF, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "but a SELECT ends the first set-up, and the claim with it");

        c = setUp();
        byte[] off = OWNER.pub.clone();
        off[64] ^= 0x02;
        assertEquals(SW_WRONG_DATA, raw(c, new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, off)).getSW(), "a key off the curve, at the one asking");
        assertEquals(0, c.field("ownerSet")[0]);
        quickClaim(c, "a key of the curve after it");

        // a PIN replaced after the record (D196: under the PIN it replaces): the PIN not given, then given
        c = setUp();
        assertEquals(SW_OK, setPin(c, NEW_PIN), "the PIN replaced");
        assertEquals(SW_SECURITY_NOT_SATIS, raw(c, setOwnerOpenCommand(OWNER)).getSW(), "the new PIN not given");
        assertEquals(0, c.field("nonceLive")[1], "nothing counted");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(TAP_SETUP, c.field("tapOpen")[2] & TAP_SETUP, "the record was written under the set-up's PIN: the mark stays");
        quickClaim(c, "under the new PIN");
    }
}
