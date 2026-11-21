package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D226, from the red team of 2026-11-19, round two (R2, RT23R2TableTest at 6864627). D223 gave the set-up bit to every entry
 * made in the card's first set-up, and nothing limited how many: whoever spoke in the set-up selection (a relay in the
 * holder's set-up tap, or a seller who sets the card up and hands it over) taught five made-up keysets that every reclaim
 * spared for good, and the mint's next keyset was 6A9C even with the owner's grant. Now a keyset taught in the set-up gets the
 * bit only where no entry of its unit is a set-up's still waiting for its first piece (one a unit, the first), and a
 * hand-over takes the bit off every entry so that its reclaim frees them.
 */
class SetUpEntriesTest {

    static final int SAT = UnitsTest.SAT;
    static final int NO_ROOM = UnitsTest.SW_NO_TABLE_ROOM;
    static final Keyset USD_KS = new Keyset(1, powers(64), 11, "|unit:usd");

    @BeforeEach void theTestFloor() { useTheTestFloor(); }
    @AfterAll static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static Keyset junk(int salt) { return TillKeysetsTest.junk(salt); }

    static boolean setUpBit(UnitsTest.Card c, Keyset k) throws Exception { return (c.rawStateOf(k.id8()) & 0x08) != 0; }

    /** The set-up selection of an owned card: the PIN, the record, the claim, a header; nothing taught yet. */
    static UnitsTest.Card setUpSelection() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))));
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)));
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        return c;
    }

    @Test
    @DisplayName("D226 (red team R2, the proof): made-up keysets taught beside the phone's in the set-up selection get no set-up bit, count toward the two unmarked (two, not five), and are gone after the set-up tap; the mint's next keyset goes in with the PIN alone")
    void aSetUpSelectionCannotFillTheTable() throws Exception {
        UnitsTest.Card c = setUpSelection();
        taught(c, A);                                         // the phone's own set-up teaching
        int extra = 0;
        for (int i = 1; i <= 6; i++) if (teach(c, junk(i)).getSW() == SW_OK) extra++;   // the relay's, same selection
        assertTrue(extra <= 2, "at most the two unmarked beside the set-up's own: " + extra);
        assertTrue(setUpBit(c, A), "the set-up's own keyset keeps the bit");
        for (int i = 1; i <= 6; i++) if (c.entryOf(junk(i).id8()) >= 0) assertFalse(setUpBit(c, junk(i)), "no bit for made-up keyset " + i);

        for (int i = 0; i < 2; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        assertEquals(0, TillKeysetsTest.planted(c, 1, 6), "the made-up keysets are let go after the set-up tap");
        assertTrue(c.entryOf(A.id8()) >= 0, "the set-up's own stays, waiting for its first piece");

        c.tap();
        c.put(-1, A.id8(), 64);                               // the first deposit
        c.tap();
        assertEquals(SW_OK, teach(c, B).getSW(), "the mint's new keyset, PIN alone (6A9C at 6864627)");
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW());
    }

    @Test
    @DisplayName("D226: a relay that teaches first in the set-up selection takes the one bit; the phone's keyset is kept for the tap and, if no piece comes, let go after it, and the holder still has four entries and teaches the mint's keysets with the PIN alone")
    void theRelayFirst() throws Exception {
        UnitsTest.Card c = setUpSelection();
        assertEquals(SW_OK, teach(c, junk(1)).getSW());
        assertTrue(setUpBit(c, junk(1)), "the first of the unit has the bit");
        taught(c, A);
        assertFalse(setUpBit(c, A), "one waiting set-up entry of a unit");
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(1, TillKeysetsTest.planted(c, 1, 1), "the relay's one is kept: the most a relay keeps of a unit");
        assertEquals(-1, c.entryOf(A.id8()), "the phone's, never loaded and not this tap's, is let go");
        // the holder: teaches A again and B, PIN alone, loads both
        taught(c, A);
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 32)).getSW());
        taught(c, B);
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW());
    }

    @Test
    @DisplayName("D226, the honest set-up: one keyset taught per unit (the card's, and on a card with no owner under the held tap the other unit's too) each keeps the set-up bit, survives taps and reclaims, and takes its first deposit")
    void oneKeysetPerUnitKeepsTheBit() throws Exception {
        // owned: the card's own currency, as Foxy's cardTeachAtSetUp
        UnitsTest.Card c = TillKeysetsTest.setUpTeaching(true, A);
        for (int i = 0; i < 3; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        assertTrue(c.entryOf(A.id8()) >= 0 && setUpBit(c, A), "kept for good while waiting");
        c.tap();
        c.put(-1, A.id8(), 64);
        assertEquals(0x04, c.rawStateOf(A.id8()) & 0x04, "loaded");

        // no owner: a held tap in the set-up, both units taught
        UnitsTest.Card d = new UnitsTest.Card();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        d.pin();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))));
        assertEquals(SW_OK, d.sw(setTimeCommand(T0)));
        HolderTest.hold(d);
        taught(d, A);
        taught(d, USD_KS);
        assertTrue(setUpBit(d, A) && setUpBit(d, USD_KS), "one a unit: both have it");
        assertEquals(SW_OK, teach(d, junk(1)).getSW());
        assertFalse(setUpBit(d, junk(1)), "a second sat keyset in the set-up does not");
        for (int i = 0; i < 3; i++) { d.tap(); assertEquals(SW_OK, d.clearSpent()); }
        assertTrue(d.entryOf(A.id8()) >= 0 && d.entryOf(USD_KS.id8()) >= 0, "both kept");
        assertEquals(-1, d.entryOf(junk(1).id8()), "the second let go");
    }

    @Test
    @DisplayName("D226: a set-up keyset loaded in the set-up frees the unit's one waiting bit for the next keyset taught there (the bit is for waiting entries only)")
    void aLoadedSetUpEntryLeavesTheBitFree() throws Exception {
        UnitsTest.Card c = setUpSelection();
        taught(c, A);
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 32)).getSW());
        taught(c, B);
        assertTrue(setUpBit(c, B), "A is loaded: B is the unit's waiting set-up entry");
    }

    @Test
    @DisplayName("D226: a hand-over takes the set-up bit off: the last owner's set-up keyset, never loaded, is let go with the hand-over's reclaim, and the next owner's set-up of the table is empty")
    void aHandOverFreesTheSetUpEntry() throws Exception {
        UnitsTest.Card c = TillKeysetsTest.setUpTeaching(true, A);
        assertTrue(c.entryOf(A.id8()) >= 0 && setUpBit(c, A));
        c.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(c));
        c.power();
        HandOverTest.nextOwnerTakesOver(c);
        assertEquals(-1, c.entryOf(A.id8()), "let go at the hand-over");
        assertEquals(0, c.inUse(), "no entry in use");
    }

    @Test
    @DisplayName("D226: a reset empties the table, the set-up's entries with it, and the next set-up's one keyset gets the bit again")
    void aResetAndANewSetUp() throws Exception {
        UnitsTest.Card c = setUpSelection();
        taught(c, A);
        c.tap();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        c.power();
        assertEquals(0, c.inUse(), "the table empty after the reset");
        // the next set-up, on the same card
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))));
        taught(c, B);
        assertTrue(setUpBit(c, B), "the next set-up's one keyset has the bit");
        assertEquals(SW_OK, teach(c, junk(1)).getSW());
        assertFalse(setUpBit(c, junk(1)), "and a second does not");
    }

    @Test
    @DisplayName("D226 (round three, R5, the reviewer's proof): made-up pieces loaded under made-up keysets in the set-up selection get no set-up bit and count toward the two unmarked: two go in, not five, and the holder's next keyset goes in with the owner's grant")
    void loadsInTheSetUpSelectionCannotFillTheTable() throws Exception {
        UnitsTest.Card c = setUpSelection();
        taught(c, A);
        int planted = 0;
        for (int i = 1; i <= 6; i++) if (c.load(c.piece(junk(i).id8(), 1)).getSW() == SW_OK) planted++;
        assertEquals(2, planted, "the two unmarked, as after the set-up (5 at 82ddd3b)");
        for (int i = 1; i <= 6; i++) if (c.entryOf(junk(i).id8()) >= 0) assertFalse(setUpBit(c, junk(i)), "no bit for a load's entry " + i);
        for (int i = 0; i < 3; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        c.tap();
        c.grant();
        assertEquals(SW_OK, teach(c, B).getSW(), "the holder's next keyset with the owner's grant (6A9C at 82ddd3b)");
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW());
    }

    @Test
    @DisplayName("D226, the honest set-up: one keyset taught and its first 45 pieces loaded in the same selection keeps the set-up bit, loaded; one loaded with no teaching first is an ordinary entry; either way the holder's next keyset goes in with the PIN alone")
    void aSetUpThatTeachesAndLoads() throws Exception {
        UnitsTest.Card c = setUpSelection();
        taught(c, A);
        for (int i = 0; i < 45; i++) assertEquals(SW_OK, c.load(c.piece(A.id8(), 1)).getSW(), "load " + i);
        assertEquals(0x08 | 0x04, c.rawStateOf(A.id8()) & 0x0C, "set-up and loaded");
        c.tap();
        taught(c, B);
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW(), "the mint's next keyset, PIN alone");

        UnitsTest.Card d = setUpSelection();
        for (int i = 0; i < 45; i++) assertEquals(SW_OK, d.load(d.piece(A.id8(), 1)).getSW(), "load " + i);
        assertFalse(setUpBit(d, A), "a load's entry has no set-up bit");
        taught(d, A);
        assertFalse(setUpBit(d, A), "nor does teaching it after");
        d.tap();
        taught(d, B);
        assertEquals(SW_OK, d.load(d.piece(B.id8(), 32)).getSW(), "the next keyset, PIN alone: A and B the two unmarked");
    }

    @Test
    @DisplayName("D226, a card with no owner: its set-up under a held tap teaches and loads its keyset, and pays from it after")
    void aCardWithNoOwnerSetsUpAndLoads() throws Exception {
        UnitsTest.Card d = new UnitsTest.Card();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        d.pin();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))));
        assertEquals(SW_OK, d.sw(setTimeCommand(T0)));
        taught(d, A);
        assertTrue(setUpBit(d, A));
        int p = d.put(-1, A.id8(), 64);
        d.tap();
        assertEquals(64, d.pay(p).getData().length);
    }
}
