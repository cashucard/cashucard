package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 3.1 (the project owner, 2026-11-21: a person must not hold a card longer than the protection needs). D231: SET_CARD's
 * self-tests run once in the card's life, their verdicts kept. D232: the one-asking claim right after a set-up's record is a
 * blank card's alone, one that had no PIN when this time in the field began; a card that had one is held for CLAIM_ASKINGS
 * whatever came between. D233: a card's first PIN, set by SET_PIN on a card that had none, stands as given for the rest of
 * that selection, so the reader sends no VERIFY_PIN after it; a SELECT ends it, and a PIN replaced is never given by its SET_PIN.
 */
class HoldNoLongerThanNeededTest {

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static boolean flag(UnitsTest.Card c, String name) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.getBoolean(c.applet());
    }

    @Test
    @DisplayName("D232 and D233: a blank card is set up and claimed in one tap: SET_PIN (no VERIFY_PIN after it), SET_CARD, and the owner set at the first asking")
    void aBlankCardIsSetUpAndClaimedInOneTap() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(c, TEST_PIN), "the first PIN");
        assertEquals(1, c.field("pinVerifiedFlag")[0], "chosen by this reader in this selection: it stands as given (D233)");
        assertEquals(SW_OK, ClaimAfterSetUpTest.setCard(c), "the record, with no VERIFY_PIN between");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        ClaimAfterSetUpTest.quickClaim(c, "a blank card's first set-up");
    }

    @Test
    @DisplayName("D233: the first PIN as given does not outlive a SELECT, and a PIN that replaces one (a forgotten PIN) is never given by its SET_PIN")
    void theFirstPinAsGivenEndsWithTheSelection() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(c, TEST_PIN));
        assertEquals(1, c.field("pinVerifiedFlag")[0]);
        c.select();
        assertEquals(0, c.field("pinVerifiedFlag")[0], "a SELECT ends it: the PIN is asked for again");
        // a set-up card whose PIN is forgotten: the new one is set with no PIN asked, and is not given by that
        UnitsTest.Card s = SimpleCardTest.setUpWith(concat(u32(1000), u32(500), u32(0)));
        s.power();
        SimpleCardTest.threeWrong(s);
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(s, NEW_PIN), "a forgotten PIN replaced");
        assertEquals(0, s.field("pinVerifiedFlag")[0], "a card that had a PIN: its replacement is not given by its SET_PIN");
    }

    @Test
    @DisplayName("D232: a card that had a PIN when the tap began (a simple card, reset by its PIN and set up again in the same tap) is claimed only after CLAIM_ASKINGS askings, and no order of commands makes it fewer")
    void aCardThatHadAPinIsHeldForEveryAsking() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(concat(u32(1000), u32(500), u32(0)));
        c.tap();
        c.pin();
        HolderTest.hold(c);
        int[] r = SimpleCardTest.resetByPin(c);
        assertEquals(SW_OK, r[1], "reset by its PIN, held for");
        assertEquals(0, c.field("pinState")[0], "no PIN now");
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(c, NEW_PIN), "a first PIN again, in the same tap");
        assertEquals(SW_OK, ClaimAfterSetUpTest.setCard(c), "and a record");
        assertTrue((c.field("tapOpen")[2] & 0x80) != 0, "the tap began with a PIN on the card (TAP_HADPIN)");
        ClaimAfterSetUpTest.heldClaim(c, "a card that had a PIN when the tap began");
        // with a SELECT between: the first set-up ends, and the claim is refused outright
        UnitsTest.Card d = SimpleCardTest.setUpWith(concat(u32(1000), u32(500), u32(0)));
        d.tap();
        d.pin();
        HolderTest.hold(d);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(d)[1]);
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(d, NEW_PIN));
        d.select();
        assertEquals(SW_SECURITY_NOT_SATIS, ClaimAfterSetUpTest.setCard(d), "after a SELECT the new PIN is not given (D233)");
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN)));
        assertEquals(SW_OWNER_PROOF, ClaimAfterSetUpTest.setCard(d), "and the SELECT ended the first set-up: no record, so no claim, in it");
    }

    @Test
    @DisplayName("D231: the set-up's self-tests run at the first SET_CARD and are kept: a SET_CARD after it, on the same card after a reset, writes the record alone")
    void theSelfTestsRunOnceInTheCardsLife() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertFalse(flag(c, "selfTested"), "a new card has run none");
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(c, TEST_PIN));
        assertEquals(SW_OK, ClaimAfterSetUpTest.setCard(c));
        assertTrue(flag(c, "selfTested"), "the first SET_CARD runs them and keeps the verdict");
        boolean curve = flag(c, "curveByAgreement"), field = flag(c, "fieldP");
        // the verdicts are never asked again: set them by hand, and a later SET_CARD leaves them
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("curveByAgreement");
        f.setAccessible(true);
        f.setBoolean(c.applet(), !curve);
        assertEquals(SW_OK, ClaimAfterSetUpTest.setCard(c), "a second record in the same first set-up");
        assertEquals(!curve, flag(c, "curveByAgreement"), "not worked out again");
        assertEquals(field, flag(c, "fieldP"));
        f.setBoolean(c.applet(), curve);
    }
}
