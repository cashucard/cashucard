package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D223's limit, from the red team of 2026-11-19, round two (R3, the second proof of RT23R2TableTest at 6864627). The card checks
 * no mint's signature at a load, so a till with the PIN (and the say, a held tap, on a card with no owner) loads one made-up
 * piece under each of five made-up keysets: each entry is then named by an unspent place, and no reclaim frees it. This is not
 * fixed in the card (no reclaim may free an entry an unspent place names: that place could be real money, which would then pay
 * nothing, 6A9A). The way out is the holder's: pay the made-up pieces away, as any payment, and the entries go at the next
 * reclaim. This test pins both: the table held, and the way out working.
 */
class TableWayOutTest {

    static final int SAT = UnitsTest.SAT;
    static final int NO_ROOM = UnitsTest.SW_NO_TABLE_ROOM;

    @BeforeEach void theTestFloor() { useTheTestFloor(); }
    @AfterAll static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("D223's limit (red team R3): made-up pieces loaded under made-up keysets hold the table through any reclaim (6A9C for the holder's next keyset); the holder pays them away and the next keyset goes in")
    void loadedMadeUpPiecesArePaidAway() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, false);   // a card with no owner
        int a = c.put(-1, A.id8(), 64);                                // the holder's money in A

        c.tap();                                                       // the till: PIN and a held tap
        HolderTest.hold(c);
        int[] junk = new int[5];
        for (int i = 0; i < 5; i++) junk[i] = c.put(-1, TillKeysetsTest.junk(i + 1).id8(), 1);
        assertEquals(NO_ROOM, c.load(c.piece(TillKeysetsTest.junk(6).id8(), 1)).getSW(), "the table full");

        for (int i = 0; i < 2; i++) { c.tap(); assertEquals(SW_OK, c.clearSpent()); }
        assertEquals(5, TillKeysetsTest.planted(c, 1, 5), "named by unspent places: no reclaim frees them (the limit)");
        c.tap();
        HolderTest.hold(c);
        assertEquals(NO_ROOM, teach(c, B).getSW(), "the holder's next keyset, even with the say");

        // the way out: the holder pays the made-up pieces away (one payment; they are of one unit), and the next reclaim frees them
        c.tap();
        assertEquals(64, c.pay(junk).getData().length, "the made-up pieces signed for and burned");
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0, TillKeysetsTest.planted(c, 1, 5), "their entries let go");
        c.tap();
        taught(c, B);
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW(), "the mint's next keyset goes in");
        c.tap();
        assertEquals(64, c.pay(a).getData().length, "the holder's own piece still pays");
    }
}
