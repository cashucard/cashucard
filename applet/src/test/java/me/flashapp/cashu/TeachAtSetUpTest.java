package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Map;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D213: a keyset is taught before its first piece. KEYSET_KEYS for a keyset in no entry of the table enters it as its first
 * piece would (the PIN given in the tap; the card's unit or the last payment's without the holder's say, either with it), of
 * the unit its version 01 tail names or the card's (version 00). The entry is made at the teaching's begin, after every other
 * check of it; the keys are marked known only at the end, with the top, in one transaction, and only when they are the ID's. A
 * teaching refused later or given up leaves an entry that names no piece and has no keys known, which the reclaim lets go.
 */
class TeachAtSetUpTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final Keyset USD_KS = new Keyset(1, powers(8), 7, "|unit:usd");
    static final int ENTRY = UnitsTest.ENTRY;

    @Test
    @DisplayName("D213: an owner's card just set up is taught testnut-like keysets with no piece on it (version 01 with its fee, version 00): each answers its ID, is entered in use of the card's unit and marked (the owner's grant), its keys known; the first load of the keyset goes into that entry, keys still known; a second teaching replaces the top in the same entry")
    void anOwnersCardIsTaughtAtSetUp() throws Exception {
        UnitsTest.Card c = card();
        assertEquals(0, c.inUse(), "nothing on the card, no entry");
        taught(c, V1);
        taught(c, A);
        assertEquals(2, c.inUse());
        assertEquals(0x40 | 0x80 | 0x02, c.stateOf(V1.id8()), "in use, marked, keys known, sat");
        assertEquals(0x40 | 0x80 | 0x02, c.stateOf(A.id8()));
        assertArrayEquals(top(V1), topKept(c, V1.id8()));
        int e = c.entryOf(V1.id8());
        int place = c.put(-1, V1.id8(), 64);
        assertEquals(e, c.entryOf(V1.id8()), "the first piece goes into the taught entry");
        assertTrue(keysKnown(c, V1.id8()));
        assertEquals(2, c.inUse(), "no other entry");
        taught(c, V1);
        assertEquals(e, c.entryOf(V1.id8()));
        assertEquals(64, c.pay(place).getData().length, "and it pays");
    }

    @Test
    @DisplayName("D213: a simple card (no owner) is taught its own unit's keyset under the PIN alone, unmarked; the other unit's (a usd tail on a sat card) needs the holder's say (6A9D, nothing entered), and with the owner's grant it is entered as usd")
    void unitsAndTheSay() throws Exception {
        UnitsTest.Card simple = new UnitsTest.Card().ready(UnitsTest.SAT, false);
        taught(simple, V1);
        assertEquals(0x40 | 0x02, simple.stateOf(V1.id8()), "in use, keys known, sat, not marked");
        Map<String, byte[]> before = simple.snapshot();
        assertEquals(UnitsTest.SW_NOT_THIS_TAP, teach(simple, USD_KS).getSW(), "the other unit, no say");
        simple.assertUnchanged(before, "nothing entered: the say is asked at the end, with the entry chosen, as a load asks it");
        UnitsTest.Card owned = card();
        taught(owned, USD_KS);
        assertEquals(0x40 | 0x80 | 0x02 | 0x01, owned.stateOf(USD_KS.id8()), "usd, with the owner's grant");
        UnitsTest.Card ungranted = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(UnitsTest.SW_NOT_THIS_TAP, teach(ungranted, USD_KS).getSW(), "an owner's card without the grant in the tap");
        taught(ungranted, V1);
        assertEquals(0x40 | 0x02, ungranted.stateOf(V1.id8()), "its own unit under the PIN alone, unmarked");
    }

    @Test
    @DisplayName("D213, D220: a teaching refused at its begin enters nothing (a tail of no unit 6A80, an ID version the card cannot hash 6A80, no PIN in the tap 6982: the table as it was); one that began is entered only at its end, once its keys hold (D220; D213 entered it at the begin), so one refused at the end (keys that are not the ID's, out of order) or cut by another command (6985) leaves no entry at all")
    void aTeachingRefusedEntersNothing() throws Exception {
        UnitsTest.Card c = card();
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), "|unit:eur", wires(V1)).getSW(), "a tail of no unit the card knows");
        assertEquals(SW_WRONG_DATA, begin(c, "02aa000000000001", "").getSW(), "an ID version not 00 or 01");
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, begin(c, V1.id8(), V1.tail).getSW(), "no PIN in this tap");
        c.assertUnchanged(before, "nothing entered, not a byte of the table");
        assertEquals(0, c.inUse());
        // begun, then refused at the end or cut: no entry is made (D220, which made the entry at the end; D213 left one that the reclaim let go)
        byte[][] off = wires(V1);
        off[3] = off[4];
        c.pin();
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), V1.tail, wires(A)).getSW(), "keys that are not the ID's");
        assertTrue(!keysKnown(c, V1.id8()), "no keys kept");
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), V1.tail, off).getSW(), "keys out of order");
        assertTrue(!keysKnown(c, V1.id8()), "no keys kept");
        assertEquals(SW_OK, begin(c, V1.id8(), V1.tail).getSW());
        assertEquals(SW_OK, keys(c, Arrays.copyOfRange(wires(V1), 0, 6)));
        c.balance(0);
        assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW(), "given up by a read between");
        assertTrue(!keysKnown(c, V1.id8()), "no keys kept of a teaching given up");
        assertEquals(-1, c.entryOf(V1.id8()), "no entry was ever made");
        assertEquals(0, c.inUse());
    }

    @Test
    @DisplayName("D213, D220: within the table's six entries: a card whose six entries each name a piece answers 6A9C to a seventh keyset taught, nothing written; an entry a teaching made that names no piece and has had none is kept by the reclaim (D220: it waits for its first piece; D213 let it go), keys known, and a teaching again of it is taken")
    void withinTheSixEntries() throws Exception {
        UnitsTest.Card c = card();
        for (int i = 1; i <= 6; i++) c.put(-1, "00aa00000000000" + i, 1);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(UnitsTest.SW_NO_TABLE_ROOM, teach(c, V1).getSW(), "no room");
        c.assertUnchanged(before, "nothing written");
        UnitsTest.Card d = card();
        taught(d, V1);
        assertEquals(SW_OK, d.clearSpent(), "CLEAR_SPENT reclaims");
        assertTrue(d.entryOf(V1.id8()) >= 0 && keysKnown(d, V1.id8()), "a keyset taught and not yet loaded is kept (D220)");
        taught(d, V1);
        assertTrue(keysKnown(d, V1.id8()));
    }

    @Test
    @DisplayName("D213: KEYSET_KEYS on a card with no table yet (no SET_CARD) is 6A88 as before, with nothing written")
    void noTableNoEntry() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_SLOT_EMPTY, begin(c, V1.id8(), V1.tail).getSW());
    }
}
