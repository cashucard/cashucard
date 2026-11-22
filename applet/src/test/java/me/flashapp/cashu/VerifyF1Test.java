package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D228, from the security review of 2026-11-21 (applet-money-1, its verifier's VerifyF1Test). Under D226 the set-up bit went to
 * the first keyset of a unit still waiting for its first piece, so a relay in the holder's set-up selection that taught a
 * made-up keyset and then loaded a made-up piece under it freed the bit for the next one, and filled the table with set-up
 * entries no reclaim lets go: the holder's next keyset was 6A9C even with the owner's grant. Now a unit has one set-up bit in
 * the set-up, loaded or not.
 */
class VerifyF1Test {
    @BeforeEach void theTestFloor() { useTheTestFloor(); }
    @AfterAll static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("D228 (applet-money-1): the phone teaches and loads its keyset in the set-up, then a relay teaches and loads made-up keysets one at a time: none gets the set-up bit, the third teaching is 6A9C, no more than two go in, and the holder's next keyset goes in with the owner's grant")
    void teachThenLoadCannotFillTheTable() throws Exception {
        UnitsTest.Card c = SetUpEntriesTest.setUpSelection();
        taught(c, A);
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 32)).getSW());
        int[] teaches = new int[7];
        for (int i = 1; i <= 6; i++) {
            Keyset j = SetUpEntriesTest.junk(i);
            teaches[i] = teach(c, j).getSW();
            if (teaches[i] == SW_OK) assertEquals(SW_OK, c.load(c.piece(j.id8(), 1)).getSW(), "the load under made-up keyset " + i);
        }
        assertEquals(UnitsTest.SW_NO_TABLE_ROOM, teaches[3], "the third made-up keyset finds no room");
        int junkEntries = 0;
        for (int i = 1; i <= 6; i++) {
            if (c.entryOf(SetUpEntriesTest.junk(i).id8()) < 0) continue;
            junkEntries++;
            assertFalse(SetUpEntriesTest.setUpBit(c, SetUpEntriesTest.junk(i)), "no set-up bit for made-up keyset " + i);
        }
        assertTrue(junkEntries <= 2, "at most the two unmarked: " + junkEntries);
        assertTrue(SetUpEntriesTest.setUpBit(c, A), "the phone's own keyset keeps the bit");

        for (int i = 0; i < 3; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        c.tap();
        c.grant();
        assertEquals(SW_OK, teach(c, B).getSW(), "the holder's next keyset with the owner's grant (6A9C at a2da664)");
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW());
    }
}
