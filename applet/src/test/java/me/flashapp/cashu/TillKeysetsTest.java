package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D219, from the red team of 2026-11-19 (card 2.3 at 4d057fb, finding F1 and F3; its proofs RT23TableTest and the reading of
 * KEYSET_KEYS' end). D214's reclaim spared every keyset taught and never loaded, for good: a till with the PIN for one tap
 * taught keysets of its own making and held the keyset table until a reset, and the holder's next new keyset was refused
 * 6A9C. Now an entry waiting for its first piece is spared only while it was entered in the card's first set-up (the holder's
 * own, which the phone teaches at set-up and loads later) or taught in this time in the field (D214's case: three taught in a
 * tap); the set-up's entry does not count toward the two without the mark. And keys already taught are replaced by other keys
 * only under the holder's say.
 */
class TillKeysetsTest {

    static final int SAT = UnitsTest.SAT;
    static final int NO_ROOM = UnitsTest.SW_NO_TABLE_ROOM, NOT_THIS_TAP = UnitsTest.SW_NOT_THIS_TAP;

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** A keyset nobody's mint has: keys the till made up, its ID worked out from them as NUT-02 says (free to make). */
    static Keyset junk(int salt) { return new Keyset(0, powers(1), 900 + salt, ""); }

    /** How many of the till's made-up keysets (`from` to `to`) have an entry. */
    static int planted(UnitsTest.Card c, int from, int to) throws Exception {
        int n = 0;
        for (int i = from; i <= to; i++) if (c.entryOf(junk(i).id8()) >= 0) n++;
        return n;
    }

    /** A card set up as Foxy sets one up, in one selection: the PIN, the record, the claim (one asking, D215) when `owner`, and its own currency's keyset `ks` taught there (the set-up's teaching); then a new tap with the PIN. */
    static UnitsTest.Card setUpTeaching(boolean owner, Keyset ks) throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(SAT))));
        if (owner) assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)), "the claim right after the record: one asking (D215)");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        taught(c, ks);
        assertEquals(0x08, c.rawStateOf(ks.id8()) & 0x08, "entered in the first set-up");
        assertEquals(0x40 | 0x02, c.stateOf(ks.id8()), "and to a reader as before (GET_CARD's state byte): in use, keys known, sat, no mark");
        c.tap();
        return c;
    }

    @Test
    @DisplayName("D219 (red team F1, owned card): a till with the PIN and no grant plants one made-up keyset (the cap of two unmarked holds in its tap); after its tap the entry is freed, and the holder's top-up into the mint's new keyset, PIN alone, answers 9000, teaching first as Foxy does or loading straight away")
    void ownedCard_aTillsKeysetIsFreedAfterItsTap() throws Exception {
        for (boolean teachFirst : new boolean[] { true, false }) {
            UnitsTest.Card c = new UnitsTest.Card().ready(SAT, true);
            int a = c.put(-1, A.id8(), 64);                       // the holder's money, keyset A (unmarked: no grant)

            c.tap();                                              // the till's tap: PIN only
            int ok = 0;
            for (int i = 1; i <= 3; i++) if (teach(c, junk(i)).getSW() == SW_OK) ok++;
            assertEquals(1, ok, "one made-up keyset: A and it are the two unmarked");
            assertEquals(NO_ROOM, teach(c, junk(4)).getSW(), "a second is refused in the till's own tap");
            assertEquals(SW_OK, c.clearSpent(), "a reclaim in the till's tap");
            assertEquals(1, planted(c, 1, 4), "keeps the keyset it taught in this tap (D214)");

            for (int i = 0; i < 2; i++) {                         // later taps: the holder pays and loads A again
                c.tap();
                assertEquals(64, c.pay(a).getData().length);
                c.tap();
                assertEquals(SW_OK, c.clearSpent());
                a = c.put(-1, A.id8(), 64);
            }
            assertEquals(0, planted(c, 1, 4), "the till's keyset is gone at the first reclaim after its tap");

            c.tap();                                              // the mint moves to B: the holder, PIN alone
            if (teachFirst) taught(c, B);
            assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW(), "the new keyset goes in");
            if (teachFirst) assertTrue(keysKnown(c, B.id8()), "B taught and loaded");
        }
    }

    @Test
    @DisplayName("D219 (red team F1, owned card, the proof's order): the till's keyset still in the table when the holder comes (no reclaim between): the holder's load of a new keyset with the PIN alone frees it there and goes in")
    void ownedCard_theHoldersLoadFreesTheTillsKeyset() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, true);
        c.put(-1, A.id8(), 64);
        c.tap();
        assertEquals(SW_OK, teach(c, junk(1)).getSW());
        c.tap();
        assertEquals(1, planted(c, 1, 1), "still there: nothing has reclaimed since");
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW(), "the holder's load of B, the PIN alone (6A9C before D219)");
        assertEquals(0, planted(c, 1, 1));
        assertEquals(0x40 | 0x04, c.rawStateOf(B.id8()) & 0xC7, "B: in use, loaded, unmarked");
    }

    @Test
    @DisplayName("D219 (red team F1, simple card): a till with the PIN and a held tap (the say: marked entries) fills the table with five made-up keysets; after its tap they are freed, and the holder's next two rotations (B, then C while B holds money) go in")
    void simpleCard_aTillCannotFillTheTable() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, false);
        int a = c.put(-1, A.id8(), 64);
        c.tap();
        HolderTest.hold(c);
        int taughtNow = 0;
        for (int i = 1; i <= 6; i++) if (teach(c, junk(i)).getSW() == SW_OK) taughtNow++;
        assertEquals(5, taughtNow, "the table full in the till's tap");
        assertEquals(NO_ROOM, teach(c, junk(7)).getSW());

        c.tap();
        assertEquals(64, c.pay(a).getData().length);
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0, planted(c, 1, 7), "every made-up keyset is freed after the till's tap");
        assertEquals(0, c.inUse());

        c.tap();
        HolderTest.hold(c);
        taught(c, B);
        c.put(-1, B.id8(), 32);
        Keyset cKs = new Keyset(0, powers(32), 77, "");
        c.tap();
        HolderTest.hold(c);
        taught(c, cKs);
        assertEquals(SW_OK, c.load(c.piece(cKs.id8(), 32)).getSW(), "the next rotation while B holds money (6A9C before D219)");
        assertTrue(c.entryOf(B.id8()) >= 0 && c.entryOf(cKs.id8()) >= 0);
    }

    @Test
    @DisplayName("D219: the holder's set-up entry (taught in the first set-up, Foxy's cardTeachAtSetUp) stays through any number of taps and reclaims until its first piece, does not count toward the two unmarked, and the till's keysets beside it go; the first deposit goes into it, and a later mint keyset change goes in under the PIN alone")
    void theSetUpEntryStaysAndAKeysetChangeGoesIn() throws Exception {
        UnitsTest.Card c = setUpTeaching(true, A);
        int setUp = c.entryOf(A.id8());

        // a till's tap, PIN alone: the set-up entry does not count, so it can plant two, and no more
        c.tap();
        int ok = 0;
        for (int i = 1; i <= 3; i++) if (teach(c, junk(i)).getSW() == SW_OK) ok++;
        assertEquals(2, ok, "the set-up's entry is not one of the two unmarked");

        // taps later, reclaims: the set-up entry stays, the till's go
        for (int i = 0; i < 3; i++) {
            c.tap();
            assertEquals(SW_OK, c.clearSpent());
        }
        assertEquals(setUp, c.entryOf(A.id8()), "the set-up's entry stays, never loaded");
        assertTrue(keysKnown(c, A.id8()));
        assertEquals(0, planted(c, 1, 3), "the till's are freed");

        // the first deposit, PIN alone: into the set-up's entry, keys still known; it pays with change
        c.tap();
        int place = c.put(-1, A.id8(), 64);
        assertEquals(setUp, c.entryOf(A.id8()), "the first piece goes into the set-up's entry");
        assertEquals(1, c.inUse());
        assertTrue(keysKnown(c, A.id8()));
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        assertEquals(SW_OK, show(c, row[0], A, 8), "its change's key shown from the set-up's teaching");

        // the mint's keyset change: another till first, then the holder, PIN alone, teaching B and loading it
        c.tap();
        assertEquals(SW_OK, teach(c, junk(5)).getSW());
        c.tap();
        taught(c, B);
        assertEquals(SW_OK, c.load(c.piece(B.id8(), 32)).getSW(), "the mint's new keyset goes in");
        assertTrue(keysKnown(c, A.id8()) && keysKnown(c, B.id8()));
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0, planted(c, 5, 5), "and the till's goes at the next reclaim");
    }

    @Test
    @DisplayName("D219: a set-up entry left waiting (the mint moved to K1 before the first deposit) does not block the holder: K1 and then K2, each under the PIN alone, go in beside it while K1 holds money, and a till's keyset between them is freed")
    void aStaleSetUpEntryBlocksNothing() throws Exception {
        UnitsTest.Card c = setUpTeaching(true, A);
        Keyset k1 = new Keyset(0, powers(32), 31, ""), k2 = new Keyset(0, powers(32), 32, "");
        taught(c, k1);
        c.put(-1, k1.id8(), 64);
        c.tap();
        assertEquals(SW_OK, teach(c, junk(1)).getSW(), "a till's keyset: K1 and it are the two unmarked");
        c.tap();
        taught(c, k2);
        assertEquals(SW_OK, c.load(c.piece(k2.id8(), 32)).getSW());
        assertTrue(c.entryOf(A.id8()) >= 0 && keysKnown(c, A.id8()), "the set-up's entry still waits");
        assertEquals(0, planted(c, 1, 1));
    }

    @Test
    @DisplayName("D219: a simple card's set-up entry (no owner) is the holder's as well: kept across taps, never loaded")
    void aSimpleCardsSetUpEntry() throws Exception {
        UnitsTest.Card c = setUpTeaching(false, A);
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertTrue(keysKnown(c, A.id8()));
        c.tap();
        assertEquals(SW_OK, teach(c, junk(1)).getSW());
        assertEquals(SW_OK, teach(c, junk(2)).getSW(), "two unmarked beside the set-up's");
        assertEquals(NO_ROOM, teach(c, junk(3)).getSW());
    }

    @Test
    @DisplayName("D219: a keyset taught in an earlier tap and never loaded is let go by a reclaim after that tap (only the set-up's waits across taps), and the same keyset taught again in the tap that loads it goes in")
    void anOldWaitingKeysetIsLetGo() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        taught(c, V1);
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(-1, c.entryOf(V1.id8()), "taught in another tap, never loaded: let go");
        c.grant();
        taught(c, V1);
        assertEquals(SW_OK, c.load(c.piece(V1.id8(), 5)).getSW());
        assertTrue(keysKnown(c, V1.id8()));
    }

    @Test
    @DisplayName("D219: GET_CARD's table and GET_INFO's count say the state as before: the set-up and fresh bits are the card's own; byte 49 counts the entries that count toward the two")
    void whatAReaderIsTold() throws Exception {
        UnitsTest.Card c = setUpTeaching(true, A);
        byte[] t = c.send(new CommandAPDU(CLA, INS_GET_CARD, 2, 0, 256)).getData();
        assertEquals(1, t[0]);
        assertEquals(0x42, t[9] & 0xFF, "in use, keys known, sat");
        taught(c, B);
        assertEquals(0x10, c.rawStateOf(B.id8()) & 0x18, "fresh, not of the set-up");
        byte[] info = c.send(new CommandAPDU(CLA, INS_GET_INFO, 3, 0, 256)).getData();
        assertEquals(2, info[48], "two in use");
        assertEquals(1, info[49], "one counts toward the two unmarked: B");
    }

    @Test
    @DisplayName("D219 (red team F3): keys already taught are not replaced under the PIN alone: the same keys taught again keep the top (9000); other keys whose ID shares the 8 bytes (a 56-bit match, stood in for by the top changed on the card) are refused 6A9D with the top kept, and taken with the owner's grant")
    void taughtKeysAreNotReplacedWithoutTheSay() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, true);
        c.put(-1, A.id8(), 64);
        taught(c, A);
        byte[] top = topKept(c, A.id8());
        c.tap();
        taught(c, A);
        assertArrayEquals(top, topKept(c, A.id8()), "the same keys: the same top");

        // a top other than the one these keys make: what a 56-bit collision would give the till
        int e = c.entryOf(A.id8());
        byte[] other = top.clone();
        other[0] ^= 1;
        System.arraycopy(other, 0, c.book(), e * UnitsTest.ENTRY + 9, 32);
        assertEquals(NOT_THIS_TAP, teach(c, A).getSW(), "other keys under the PIN alone");
        assertArrayEquals(other, topKept(c, A.id8()), "nothing replaced");
        c.grant();
        taught(c, A);
        assertArrayEquals(top, topKept(c, A.id8()), "with the owner's grant the keys are taught again");
    }

    @Test
    @DisplayName("D219: in the source, the reclaim spares a waiting entry only with the set-up bit, or the fresh bit while this time in the field taught")
    void theSourceSaysSo() throws Exception {
        String code = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8);
        String reclaim = code.substring(code.indexOf("private void reclaim("), code.indexOf("private boolean limitWithNoRate("));
        assertTrue(reclaim.contains("((st & ENTRY_SETUP) != 0 || ((st & ENTRY_FRESH) != 0 && (tapOpen[2] & TAP_TAUGHT) != 0))"), reclaim);
        assertEquals(Arrays.asList(0x08, 0x10, 0x20), Arrays.asList((int) CashuApplet.ENTRY_SETUP, (int) CashuApplet.ENTRY_FRESH, (int) CashuApplet.TAP_TAUGHT));
    }
}
