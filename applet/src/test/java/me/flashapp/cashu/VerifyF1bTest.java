package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D228, applet-money-1 in Foxy's flow (the review verifier's VerifyF1bTest): the phone only teaches its keyset in the set-up
 * (cardTeachAtSetUp), and the relay loads a 1-sat made-up piece under that real keyset to free the set-up bit, then teaches
 * and loads made-up keysets. With one set-up bit a unit, loaded or not, the load frees nothing.
 */
class VerifyF1bTest {
    @BeforeEach void theTestFloor() { useTheTestFloor(); }
    @AfterAll static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("D228 (applet-money-1, Foxy's flow): a relay's load under the phone's set-up keyset frees no set-up bit: made-up keysets taught and loaded after it get none, the third teaching is 6A9C, no more than two go in, and the holder's next keyset goes in with the owner's grant")
    void relayLoadsUnderThePhonesKeysetCannotFillTheTable() throws Exception {
        UnitsTest.Card c = SetUpEntriesTest.setUpSelection();
        taught(c, A);                                              // the phone's only set-up step
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 1)).getSW());  // the relay: a made-up piece under the real keyset
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

        for (int i = 0; i < 3; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        c.tap();
        c.grant();
        assertEquals(SW_OK, teach(c, B).getSW(), "the holder's next keyset with the owner's grant (6A9C at a2da664)");
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW());
    }
}
