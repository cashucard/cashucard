package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * One header at the floor's work with a time far ahead (D199, D200). Anyone holding the card can give it one, and the card's
 * clock goes there; the day of loads then begins at that time and does not end, so after 300 more loads LOAD_PROOF answers
 * 6A8F. What the card does about it: the change a payment makes is counted in the day of loads when the payment is signed,
 * so owed change always goes on (LOAD_CHANGE is never refused for the count) and change the day has no room for is never
 * made; and the owner's reset or hand-over of an empty card, with an anchor (a real header), brings the clock back to the
 * anchor even where it is older than the clock, and the day of loads begins again. Nothing else moves the clock back. A
 * day whose end is past what four bytes hold never ends (it is not read as over). Headers here are mined at the tests'
 * floor (half of all hashes); on a chip the same header needs the built floor's work, a quarter of a block's.
 */
class FarHeaderTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** Far ahead, and a day past it still fits four bytes (2065). */
    static final long F = 3_000_000_000L;
    /** So far ahead that a day past it does not fit four bytes. */
    static final long TOP = 0xFFFFFF00L;

    static long clock(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET); }
    static int header(UnitsTest.Card c, long t) { return c.sw(setTimeCommand(t)); }
    static int loadOne(UnitsTest.Card c) { return c.load(c.piece(A.id8(), 1)).getSW(); }

    /** The clock moved to `t` by a stranger's header, then a tap with the PIN, one load (the day of loads begins at `t`) and the count set to `loads`. */
    static void frozenAt(UnitsTest.Card c, long t, int loads) throws Exception {
        c.power();
        assertEquals(SW_OK, header(c, t), "a stranger's far header, no PIN");
        assertEquals(t, clock(c));
        c.tap();
        assertEquals(SW_OK, loadOne(c));
        assertEquals(t, LoadCapTest.dayBegan(c), "the day of loads begins at the far time");
        LoadCapTest.setLoads(c, loads);   // REFLECTION: stands for the loads (made for real in theRunWithRealLoads)
    }

    static CommandAPDU ownersReset(UnitsTest.Card c, byte[] anchor) {
        return new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, anchor), anchor));
    }
    static CommandAPDU handOver(UnitsTest.Card c, byte[] anchor) {
        byte[] v = concat(OTHER_OWNER.pub, anchor);
        return new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(c.proofFor(L_OWNER, v), v));
    }
    /** Every place paid away and freed: the card empty. */
    static void emptied(UnitsTest.Card c) {
        c.tap();
        for (int p = 0; p < CashuApplet.MAX_PROOFS; p++) {
            byte[] s = c.slot(p);
            if (s.length > 0 && s[0] == 1) assertEquals(64, c.pay(p).getData().length, "place " + p + " paid away");
        }
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0, c.info(0)[29], "no change owed");
    }

    /** `n` real LOAD_PROOFs of 1-sat pieces, three to a command, the places paid away sixteen to a payment and freed as the card fills. */
    static void realLoads(UnitsTest.Card c, int n) {
        List<Integer> places = new ArrayList<>();
        for (int done = 0; done < n; ) {
            int k = Math.min(3, n - done);
            byte[][] ps = new byte[k][];
            for (int i = 0; i < k; i++) ps[i] = c.piece(A.id8(), 1);
            ResponseAPDU r = c.load(ps);
            assertEquals(SW_OK, r.getSW(), "real load at " + done);
            assertEquals(k, r.getData().length, "the whole batch went on");
            for (byte b : r.getData()) places.add(b & 0xFF);
            done += k;
            if (places.size() >= 96 || done == n) {
                c.tap();
                for (int i = 0; i < places.size(); i += 16) {
                    int[] g = places.subList(i, Math.min(places.size(), i + 16)).stream().mapToInt(Integer::intValue).toArray();
                    assertEquals(64, c.pay(g).getData().length, "paid away");
                }
                assertEquals(SW_OK, c.clearSpent());
                places.clear();
            }
        }
    }

    @Test
    @DisplayName("The far header's run with real loads: a stranger's header far ahead, 299 real loads, a payment whose change is the day's 300th; its LOAD_CHANGE goes on with no PIN, the 301st load is 6A8F, a payment's change is 6A8F at SPEND_ALL_CHANGE; then the card emptied and the owner's anchored reset: the clock back, and the next holder loads at once")
    void theRunWithRealLoads() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(c, A);
        c.power();
        assertEquals(SW_OK, header(c, F), "a stranger's far header");
        c.tap();
        realLoads(c, 299);
        assertEquals(299, LoadCapTest.loads(c));
        assertEquals(F, LoadCapTest.dayBegan(c));
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, big, 8, A.keyFor(8), null);
        assertEquals(300, LoadCapTest.loads(c));
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 8));
        ResponseAPDU lc = KeysetKeysTest.loadChange(c, row, A.privFor(8));
        assertEquals(SW_OK, lc.getSW(), "the owed change on, no PIN");
        int changePlace = lc.getData()[0] & 0xFF;
        c.tap();
        assertEquals(SW_OVER_LIMIT, loadOne(c), "the 301st");
        assertEquals(SW_OK, c.begin(changePlace).getSW());
        assertEquals(SW_OVER_LIMIT, c.send(changeCommand(4, A.keyFor(4), hexToBytes(A.id8()))).getSW(), "no change past the day");
        assertEquals(0, c.info(0)[29], "nothing owed, ever");
        c.tap();
        assertEquals(64, c.pay(changePlace).getData().length, "the change spent whole");
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(SW_OK, c.sw(ownersReset(c, blockAt(T0 + 86_400))), "the owner's anchored reset");
        assertEquals(T0 + 86_400, clock(c));
        CertificateTest.setUpAgain(c);
        assertEquals(SW_OK, loadOne(c), "the next holder loads");
    }

    // =====================================================================================================================
    // Change is counted when it is made
    // =====================================================================================================================

    @Test
    @DisplayName("Owed change goes on a frozen card: after a far header, the payment's change is counted at its signature, the 300th of the day; LOAD_CHANGE puts it on, with no PIN, counting nothing; the next payment's change has no room and is refused at SPEND_ALL_CHANGE (6A8F), the payment given up and nothing owed; a payment with no change still goes")
    void owedChangeGoesOnAFrozenCard() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64), other = c.put(-1, A.id8(), 32);
        KeysetKeysTest.taught(c, A);
        frozenAt(c, F, 299);

        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, big, 8, A.keyFor(8), null);
        assertEquals(300, LoadCapTest.loads(c), "the change counted at the signature");
        assertEquals(F, LoadCapTest.dayBegan(c));
        assertEquals(0, LoadCapTest.left(c), "and said: no loads left");
        assertEquals(SW_OVER_LIMIT, loadOne(c), "a load past the day");

        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 8));
        ResponseAPDU lc = KeysetKeysTest.loadChange(c, row, A.privFor(8));
        assertEquals(SW_OK, lc.getSW(), "the owed change goes on, the day's count full");
        assertEquals(0, c.info(0)[29], "nothing owed");
        assertEquals(300, LoadCapTest.loads(c), "and counts nothing more");

        // no room: the change is not made, the payment is given up, nothing burned or owed
        c.tap();
        assertEquals(SW_OK, c.begin(other).getSW());
        byte[] marks = c.field("pinMarks").clone();
        ResponseAPDU ch = c.send(changeCommand(8, A.keyFor(8), hexToBytes(A.id8())));
        assertEquals(SW_OVER_LIMIT, ch.getSW(), "change past the day's room");
        assertEquals(0, ch.getData().length);
        assertEquals(0x6985, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW(), "the payment given up");
        assertArrayEquals(marks, c.field("pinMarks"), "nothing counted");
        assertEquals(0, c.info(0)[29], "nothing owed");
        assertEquals(1, c.slot(other)[0], "nothing burned");

        // a payment with no change goes
        c.tap();
        assertEquals(64, c.pay(other).getData().length, "paid whole");
        assertEquals(300, LoadCapTest.loads(c));
    }

    @Test
    @DisplayName("SPEND_ALL_CHANGE counts the change before it in the payment: with room for one piece, the first change output is made and the second is 6A8F, the payment given up, nothing owed")
    void theChangeBeforeItCounts() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(c, A);
        LoadCapTest.setLoads(c, 299);
        c.tap();
        assertEquals(SW_OK, c.begin(big).getSW());
        assertEquals(SW_OK, c.send(changeCommand(8, A.keyFor(8), hexToBytes(A.id8()))).getSW(), "the 300th");
        assertEquals(SW_OVER_LIMIT, c.send(changeCommand(16, A.keyFor(16), hexToBytes(A.id8()))).getSW(), "the 301st");
        assertEquals(0x6985, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW(), "the payment given up");
        assertEquals(0, c.info(0)[29], "nothing owed");
        assertEquals(299, LoadCapTest.loads(c), "nothing counted");
        assertEquals(1, c.slot(big)[0], "nothing burned");
    }

    @Test
    @DisplayName("SPEND_ALL_SIGN asks the day's room again before it signs: a count that has no room for the payment's change is 6A8F, nothing signed, burned, counted or owed")
    void theSignatureAsksAgain() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(c, A);
        c.tap();
        assertEquals(SW_OK, c.begin(big).getSW());
        assertEquals(SW_OK, c.send(changeCommand(8, A.keyFor(8), hexToBytes(A.id8()))).getSW());
        LoadCapTest.setLoads(c, 300);   // REFLECTION: between the change and the signature, as no command can be
        byte[] marks = c.field("pinMarks").clone();
        ResponseAPDU s = c.sign();
        assertEquals(SW_OVER_LIMIT, s.getSW(), "refused before it signs");
        assertEquals(0, s.getData().length);
        assertArrayEquals(marks, c.field("pinMarks"), "nothing counted");
        assertEquals(1, c.slot(big)[0], "nothing burned");
        assertEquals(0, c.info(0)[29], "nothing owed");
    }

    @Test
    @DisplayName("The change is counted in the day of loads that runs, or begins one at the card's now where the day is over; a payment with no change leaves the day of loads as it is")
    void theChangeBeginsADay() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64), small = c.put(-1, A.id8(), 2);
        KeysetKeysTest.taught(c, A);
        assertEquals(T0, LoadCapTest.dayBegan(c));
        assertEquals(SW_OK, header(c, T0 + 86_400 + 5));
        c.tap();
        byte[] marks = c.field("pinMarks").clone();
        assertEquals(64, c.pay(small).getData().length);
        assertArrayEquals(marks, c.field("pinMarks"), "no change: the day of loads untouched");
        c.tap();
        KeysetKeysTest.payWithChange(c, big, 8, A.keyFor(8), null);
        assertEquals(T0 + 86_400 + 5, LoadCapTest.dayBegan(c), "a new day, begun at the card's now");
        assertEquals(1, LoadCapTest.loads(c), "with the change in it");
    }

    // =====================================================================================================================
    // The owner's anchored reset or hand-over brings the clock back
    // =====================================================================================================================

    @Test
    @DisplayName("A frozen card is freed by its owner's reset once empty: the anchor, a real header older than the clock, becomes the clock with its difficulty and its hash, and the day of loads begins again; the next holder loads at once")
    void theOwnersResetBringsTheClockBack() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        frozenAt(c, F, 300);
        assertEquals(SW_OVER_LIMIT, loadOne(c), "frozen");
        emptied(c);
        byte[] anchor = blockAt(T0 + 3_600);
        assertEquals(SW_OK, c.sw(ownersReset(c, anchor)), "the owner's reset with an anchor");
        assertEquals(T0 + 3_600, clock(c), "the clock back at the anchor");
        assertArrayEquals(Arrays.copyOfRange(anchor, 72, 76), Arrays.copyOfRange(c.record(), CashuApplet.CARD_BITS_OFFSET, CashuApplet.CARD_BITS_OFFSET + 4), "its difficulty the hardest taken");
        assertEquals(blockHash(anchor), toHex(Arrays.copyOfRange(c.record(), CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 32)), "its hash");
        assertEquals(0, LoadCapTest.loads(c), "the day of loads begun again");
        assertEquals(0, LoadCapTest.dayBegan(c));
        CertificateTest.setUpAgain(c);
        assertEquals(SW_OK, loadOne(c), "the next holder loads");
        assertEquals(T0 + 3_600, LoadCapTest.dayBegan(c), "in a day of the real clock");
        assertEquals(SW_OK, header(c, T0 + 7_200));
        assertEquals(T0 + 7_200, clock(c), "and real headers move it on");
    }

    @Test
    @DisplayName("A reset with no anchor keeps the clock where it is (a frozen one too), and still begins the day of loads again with the new c")
    void aResetWithNoAnchorKeepsTheClock() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        frozenAt(c, F, 300);
        emptied(c);
        assertEquals(SW_OK, c.sw(ownersReset(c, new byte[0])));
        assertEquals(F, clock(c), "the clock kept");
        assertEquals(0, LoadCapTest.loads(c), "the count begun again");
        CertificateTest.setUpAgain(c);
        assertEquals(SW_OK, loadOne(c), "a new day of loads, at the far clock");
        assertEquals(F, LoadCapTest.dayBegan(c));
    }

    @Test
    @DisplayName("A frozen card is freed by its owner's hand-over once empty: the anchor older than the clock becomes the clock, and the next owner loads; a clock so far ahead that a day past it does not fit four bytes is freed the same way, and until then its day never ends")
    void theOwnersHandOverBringsTheClockBack() throws Exception {
        for (long far : new long[] { F, TOP }) {
            UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
            frozenAt(c, far, 300);
            assertEquals(SW_OVER_LIMIT, loadOne(c), "frozen at " + far);
            if (far == TOP) {
                assertEquals(SW_OK, header(c, 0xFFFFFFFFL));
                assertEquals(SW_OVER_LIMIT, loadOne(c), "a day that cannot end is not over");
                assertEquals(0, LoadCapTest.left(c));
            }
            emptied(c);
            assertEquals(SW_OK, c.sw(handOver(c, blockAt(T0 + 600))), "the hand-over with an anchor");
            assertEquals(T0 + 600, clock(c), "the clock back at the anchor");
            c.power();
            HandOverTest.nextOwnerTakesOver(c);
            assertEquals(SW_OK, loadOne(c), "the next owner loads");
            assertEquals(T0 + 600, LoadCapTest.dayBegan(c));
        }
    }

    @Test
    @DisplayName("The holder of a card with no owner brings a far clock back with its reset by the PIN, the anchor as the data of every asking")
    void theHoldersResetBringsTheClockBack() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, header(c, F));
        c.tap();
        HolderTest.hold(c);
        byte[] anchor = blockAt(T0 + 900);
        CommandAPDU reset = new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, anchor);
        int n = 0;
        ResponseAPDU r;
        while ((r = c.sim.transmitCommand(reset)).getSW() == SW_KEEP_HOLDING && n < 200) n++;
        assertEquals(SW_OK, r.getSW(), "reset after " + n + " askings");
        assertEquals(CashuApplet.RESET_ASKINGS - 1, n);
        assertEquals(T0 + 900, clock(c), "the clock back at the anchor");
    }

    @Test
    @DisplayName("Neither the reset nor the hand-over takes an anchor on a card with anything unspent or any change owed (6A8D), and the clock stays where it is")
    void notOnACardThatHoldsMoney() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int big = c.put(-1, A.id8(), 64), other = c.put(-1, A.id8(), 4);
        KeysetKeysTest.taught(c, A);
        c.power();
        assertEquals(SW_OK, header(c, F));
        c.tap();
        assertEquals(SW_CARD_IN_USE, c.sw(ownersReset(c, blockAt(T0 + 60))), "a piece on the card");
        assertEquals(SW_CARD_IN_USE, c.sw(handOver(c, blockAt(T0 + 60))));
        assertEquals(F, clock(c));
        assertEquals(64, c.pay(other).getData().length);
        c.tap();
        KeysetKeysTest.payWithChange(c, big, 8, A.keyFor(8), null);
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(1, c.info(0)[29], "change owed, nothing unspent");
        assertEquals(SW_CARD_IN_USE, c.sw(ownersReset(c, blockAt(T0 + 60))), "change owed");
        assertEquals(SW_CARD_IN_USE, c.sw(handOver(c, blockAt(T0 + 60))));
        assertEquals(F, clock(c), "the clock where it was");
    }

    @Test
    @DisplayName("A reset's anchor is held to SET_HEADER's checks before anything is written: a header without its own work is 6A93, data other than 0 or 80 bytes after the proof 6700, a proof not over the anchor 6A91; the card as it was")
    void theResetsAnchorIsChecked() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.power();
        assertEquals(SW_OK, header(c, F));
        c.tap();
        java.util.Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_LITTLE_WORK, c.sw(ownersReset(c, unmined(T0 + 60, TEST_BITS))), "no work");
        assertEquals(SW_WRONG_LENGTH, c.sw(ownersReset(c, Arrays.copyOf(blockAt(T0 + 60), 79))), "79 bytes");
        assertEquals(SW_WRONG_LENGTH, c.sw(ownersReset(c, concat(blockAt(T0 + 60), new byte[1]))), "81 bytes");
        byte[] a = blockAt(T0 + 60);
        byte[] proof = c.proofFor(L_RESET, new byte[0]);
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(proof, a))), "the proof over no anchor");
        c.assertUnchanged(before, "nothing written");
        assertEquals(F, clock(c));
    }

    @Test
    @DisplayName("Nothing else moves the clock back: SET_HEADER and REFRESH older than the clock leave it where it is; a claim's anchor, the first set-up's of an empty card, brings it back (D204)")
    void nothingElseMovesItBack() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.power();
        assertEquals(SW_OK, header(c, F));
        assertEquals(SW_OK, header(c, T0 + 60));
        assertEquals(F, clock(c), "SET_HEADER");
        byte[] h = blockAt(T0 + 120);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0, ownerData(c.proofFor(L_REFRESH, h), h), 4)));
        assertEquals(F, clock(c), "REFRESH");
        c.tap();
        assertEquals(SW_OK, c.sw(ownersReset(c, new byte[0])));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0 + 180)))), "a claim with an older anchor");
        assertEquals(T0 + 180, clock(c), "a claim: the first set-up's anchor (D204, FirstAnchorTest)");
    }
}
