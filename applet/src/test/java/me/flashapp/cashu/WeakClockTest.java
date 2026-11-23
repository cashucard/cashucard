package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The way back from a header far ahead on a card that holds money (D201). A header with less than half the work of the
 * hardest the card has taken is weak: one at the floor's work (a quarter of the network's) is, the network's own are not.
 * At a weak clock no day the card counts ends and none begins at it, so a far header at the floor's work freezes no day's
 * limit: the days go on where they were. REFRESH, the holder's (P1 01, the PIN in a held tap) or the owner's, brings a weak
 * clock back to an older header that is not weak, and the days then end by the clock as before. A far header with the
 * network's own work is a clock like any other: the owner's REFRESH that asks it (a byte 01 after the header) brings that
 * one back too, with the windows begun after the header beginning again at it, keeping what they counted; a holder with no
 * owner has no such form, which would give a reader that has the PIN new days (D20).
 *
 * The network here: headers mined at NET_BITS, a quarter of the target of the tests' floor (TEST_BITS), so four times its
 * work, as the network's blocks are to the floor built into the applet. Far headers are mined at the tests' floor.
 */
class WeakClockTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** The network's work in these tests: a target of 2^253, four times the work of the tests' floor (2^255). */
    static final long NET_BITS = 0x20200000L;
    static final long F = 3_000_000_000L, TOP = 0xFFFFFF00L, DAY = 86_400L, HOUR = 3_600L;

    /** A block of the network's at time `t`. */
    static byte[] net(long t) { return mine(t, NET_BITS, 0); }
    static long clock(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_NOW_OFFSET); }
    static int weak(UnitsTest.Card c) throws Exception { return c.record()[CashuApplet.CARD_CLOCK_WEAK_OFFSET]; }
    static long window(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_WINDOW_OFFSET); }
    static long noPinStart(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_NOPIN_START_OFFSET); }
    static int header(UnitsTest.Card c, byte[] h) { c.power(); return c.sw(setHeaderCommand(h)); }

    /** REFRESH P1 01 by the holder of a card with no owner: the PIN given in this tap, a held tap. The card's answer. */
    static ResponseAPDU holdersRefresh(UnitsTest.Card c, byte[] h) {
        c.tap();
        HolderTest.hold(c);
        return c.send(new CommandAPDU(CLA, INS_REFRESH, 1, 0, h, 4));
    }
    /** The owner's REFRESH with `value` (a header, or a header and 01). */
    static ResponseAPDU ownersRefresh(UnitsTest.Card c, byte[] value) {
        c.power();
        return c.send(new CommandAPDU(CLA, INS_REFRESH, 0, 0, ownerData(c.proofFor(L_REFRESH, value), value), 4));
    }
    static byte[] back(byte[] h) { return concat(h, new byte[] { 1 }); }
    /** The holder's reset by the PIN with an anchor, asked until it is through: the last word. */
    static int holdersResetWith(UnitsTest.Card c, byte[] anchor) {
        c.tap();
        HolderTest.hold(c);
        CommandAPDU reset = new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, anchor);
        ResponseAPDU r;
        int n = 0;
        while ((r = c.sim.transmitCommand(reset)).getSW() == SW_KEEP_HOLDING && n < 200) n++;
        return r.getSW();
    }
    static int pay(UnitsTest.Card c, int place) {
        c.tap();
        ResponseAPDU r = c.pay(place);
        return r.getSW() == SW_OK && r.getData().length == 64 ? SW_OK : r.getSW();
    }

    /** A card with no owner, its day's limit 1,000 set in its first set-up (no one can change it), three pieces of 1,000, the network's clock. */
    static UnitsTest.Card simpleCard(int[] p) throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(concat(u32(1000), u32(1000), u32(0)));
        for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
        assertEquals(SW_OK, header(c, net(T0 + 60)), "the network's header: the hardest the card has taken");
        assertEquals(0, weak(c));
        return c;
    }
    /** A card with an owner, its day's limit 1,000, locked by its owner where `lock`, three pieces of 1,000, the network's clock. */
    static UnitsTest.Card ownedCard(int[] p, boolean lock) throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(SW_OK, c.limits(1000, 1000, 0, 7, 0));
        c.tap();
        for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
        assertEquals(SW_OK, header(c, net(T0 + 60)));
        if (lock) {
            c.tap();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(c.proofFor(L_LOCK, new byte[0]), new byte[0]))));
        }
        return c;
    }

    @Test
    @DisplayName("A holder with no phone: a stranger's far header at the floor's work begins no new day and freezes none; the holder's REFRESH by the PIN brings the clock back, and the card pays down to empty a day's limit a day, then resets (at 3,000,000,000 and at a day past four bytes)")
    void aSimpleCardIsPaidToEmpty() throws Exception {
        for (long far : new long[] { F, TOP }) {
            int[] p = new int[3];
            UnitsTest.Card c = simpleCard(p);
            assertEquals(SW_OK, pay(c, p[0]), "day 1: the day's limit spent");
            long began = window(c);
            assertEquals(SW_OK, header(c, floorAt(far)), "a stranger, no PIN, a far header at the floor's work");
            assertEquals(far, clock(c), "the clock goes there, as before");
            assertEquals(1, weak(c), "and it is weak");
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "no new day begins at a weak clock: the day's limit is spent");
            assertEquals(began, window(c), "the window where it was");
            ResponseAPDU r = holdersRefresh(c, net(T0 + HOUR));
            assertEquals(SW_OK, r.getSW(), "the holder's REFRESH with the network's newest header");
            assertEquals(T0 + HOUR, readUint32(r.getData(), 0), "answers the clock, brought back");
            assertEquals(0, weak(c));
            assertEquals(began, window(c), "the day is where it was");
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "and it has not ended: no day was given");
            assertEquals(SW_OK, header(c, net(T0 + DAY + 120)), "a day on, by the network");
            assertEquals(SW_OK, pay(c, p[1]), "day 2");
            assertEquals(SW_OK, header(c, net(T0 + 2 * DAY + 180)));
            assertEquals(SW_OK, pay(c, p[2]), "day 3: the last piece");
            c.tap();
            assertEquals(SW_OK, c.clearSpent());
            assertEquals(0, c.count(), "the card is empty");
            assertEquals(SW_OK, holdersResetWith(c, net(T0 + 2 * DAY + 240)), "and the holder's reset goes");
        }
    }

    @Test
    @DisplayName("A card with an owner, locked or not: the stranger's far header at the floor's work begins no new day; the owner's REFRESH brings the clock back; the card pays down to empty and the owner's reset goes")
    void anOwnedCardIsPaidToEmpty() throws Exception {
        for (boolean lock : new boolean[] { true, false }) {
            int[] p = new int[3];
            UnitsTest.Card c = ownedCard(p, lock);
            assertEquals(SW_OK, pay(c, p[0]));
            assertEquals(SW_OK, header(c, floorAt(F)));
            assertEquals(1, weak(c));
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]));
            ResponseAPDU r = ownersRefresh(c, net(T0 + HOUR));
            assertEquals(SW_OK, r.getSW());
            assertEquals(T0 + HOUR, clock(c), "the owner's REFRESH, as the phone sends it, brings a weak clock back");
            assertEquals(SW_OK, header(c, net(T0 + DAY + 120)));
            assertEquals(SW_OK, pay(c, p[1]));
            assertEquals(SW_OK, header(c, net(T0 + 2 * DAY + 180)));
            assertEquals(SW_OK, pay(c, p[2]));
            c.tap();
            assertEquals(0, readUint32(c.balance(0), 0), "the card is empty (a locked card frees no place: its reset does)");
            assertEquals(SW_OK, c.sw(FarHeaderTest.ownersReset(c, net(T0 + 2 * DAY + 240))), "lock=" + lock);
        }
    }

    @Test
    @DisplayName("A far header with the network's own work: the day rolls at it as before and freezes; the owner's REFRESH that asks it (01 after the header) brings the clock back, the window begins again at the header with what it counted, and the card pays down to empty, locked or not")
    void theOwnersBackFormFreesAFarHeaderOfTheNetworksWork() throws Exception {
        for (boolean lock : new boolean[] { true, false }) {
            int[] p = new int[3];
            UnitsTest.Card c = ownedCard(p, lock);
            assertEquals(SW_OK, pay(c, p[0]));
            assertEquals(SW_OK, header(c, net(F)), "a far header with the network's work");
            assertEquals(0, weak(c), "is not weak: to the card it is the network's newest block");
            assertEquals(SW_OK, pay(c, p[1]), "the day is over by it, and a new one begins at it, as before");
            assertEquals(F, window(c));
            assertEquals(SW_OVER_LIMIT, pay(c, p[2]), "and that day does not end");
            assertEquals(SW_OK, ownersRefresh(c, net(T0 + DAY + HOUR)).getSW());
            assertEquals(F, clock(c), "the owner's REFRESH as the phone sends it moves no clock that is not weak");
            long spent = c.spentToday();
            assertEquals(SW_OK, ownersRefresh(c, back(net(T0 + DAY + HOUR))).getSW(), "the form that asks it");
            assertEquals(T0 + DAY + HOUR, clock(c), "the clock back at the owner's header");
            assertEquals(T0 + DAY + HOUR, window(c), "the window begun after it begins again at it");
            assertEquals(spent, c.spentToday(), "keeping what it counted");
            assertEquals(SW_OVER_LIMIT, pay(c, p[2]), "no day was given");
            assertEquals(SW_OK, header(c, net(T0 + 2 * DAY + 2 * HOUR)));
            assertEquals(SW_OK, pay(c, p[2]), "a day on, the last piece");
            c.tap();
            assertEquals(0, readUint32(c.balance(0), 0), "the card is empty");
            assertEquals(SW_OK, c.sw(FarHeaderTest.ownersReset(c, net(T0 + 2 * DAY + 3 * HOUR))), "lock=" + lock);
        }
    }

    @Test
    @DisplayName("The owner's back form brings back the day of loads begun after its header, with its count (D203); one begun before it stays")
    void theBackFormBringsTheDayOfLoadsBack() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = ownedCard(p, false);
        assertEquals(SW_OK, header(c, net(F)));
        c.tap();
        c.put(-1, A.id8(), 1);
        assertEquals(F, LoadCapTest.dayBegan(c), "a day of loads begun at the far clock");
        int loads = LoadCapTest.loads(c);
        assertEquals(SW_OK, ownersRefresh(c, back(net(T0 + HOUR))).getSW());
        assertEquals(T0 + HOUR, clock(c));
        assertEquals(T0 + HOUR, LoadCapTest.dayBegan(c), "the day of loads begins again at the owner's header");
        assertEquals(loads, LoadCapTest.loads(c), "with its count");
        // a day of loads begun before the owner's header stays where it is
        UnitsTest.Card d = ownedCard(new int[3], false);
        d.tap();
        d.put(-1, A.id8(), 1);
        long began = LoadCapTest.dayBegan(d);
        assertEquals(SW_OK, header(d, net(F)));
        assertEquals(SW_OK, ownersRefresh(d, back(net(T0 + HOUR))).getSW());
        assertEquals(began, LoadCapTest.dayBegan(d), "a day of loads begun before the header: not moved");
        // the holder's REFRESH, which brings back only a weak clock, moves no day of loads
        int[] q = new int[3];
        UnitsTest.Card s = simpleCard(q);
        assertEquals(SW_OK, header(s, floorAt(F)));
        long sBegan = LoadCapTest.dayBegan(s);
        assertEquals(SW_OK, holdersRefresh(s, net(T0 + HOUR)).getSW());
        assertEquals(sBegan, LoadCapTest.dayBegan(s), "the holder's REFRESH moves no day of loads");
        // nor one begun at a far clock that was not weak, which a weak header then moved on: the holder brings the clock back, not the day
        int[] r = new int[3];
        UnitsTest.Card h = simpleCard(r);
        assertEquals(SW_OK, header(h, net(F)), "a far header of the network's work");
        h.tap();
        h.put(-1, A.id8(), 1);
        assertEquals(F, LoadCapTest.dayBegan(h), "a day of loads begun at it");
        assertEquals(SW_OK, header(h, floorAt(F + 60)), "a weak header after it");
        assertEquals(1, weak(h));
        assertEquals(T0 + HOUR, readUint32(holdersRefresh(h, net(T0 + HOUR)).getData(), 0), "the holder brings the weak clock back");
        assertEquals(F, LoadCapTest.dayBegan(h), "and not the day of loads");
    }

    @Test
    @DisplayName("An owned card freed by the back form takes loads and makes change again a day after the owner's header, though its day of loads began at the far clock with 300 counted")
    void anOwnedCardFreedByTheBackFormLoadsAgain() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        assertEquals(SW_OK, header(c, net(T0 + 60)));
        assertEquals(SW_OK, header(c, net(F)), "a far header with the network's work");
        assertEquals(0, weak(c));
        c.tap();
        c.grant();
        int place = c.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(c, A);
        assertEquals(F, LoadCapTest.dayBegan(c), "the day of loads begun at the far clock");
        assertEquals(SW_OK, ownersRefresh(c, back(net(T0 + HOUR))).getSW(), "the owner's back form");
        assertEquals(T0 + HOUR, clock(c));
        assertEquals(T0 + HOUR, LoadCapTest.dayBegan(c), "brings the day of loads back with the clock");
        LoadCapTest.setLoads(c, 300);   // REFLECTION: stands for the loads of that day, as LoadCapTest does
        c.tap();
        c.grant();
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 2)).getSW(), "the same day: 300 counted");
        assertEquals(SW_OK, header(c, net(T0 + DAY + 2 * HOUR)), "a day after the owner's header, by the network");
        c.tap();
        c.grant();
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 2)).getSW(), "a load goes on");
        assertEquals(1, LoadCapTest.loads(c), "in a new day of loads");
        c.tap();
        byte[] named = java.util.Arrays.copyOfRange(c.slot(place), 1, 9);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, c.send(changeCommand(8, A.keyFor(8), named)).getSW(), "and a payment makes change");
    }

    @Test
    @DisplayName("REFRESH with a P1 other than 00 and 01: 6B00, the owner's back form too, and the clock stays")
    void refreshWithAnotherP1() throws Exception {
        UnitsTest.Card o = ownedCard(new int[3], false);
        assertEquals(SW_OK, header(o, net(F)));
        byte[] v = back(net(T0 + HOUR));
        for (int p1 : new int[] { 2, 0x80, 0xFF }) {
            o.power();
            int sw = o.sw(new CommandAPDU(CLA, INS_REFRESH, p1, 0, ownerData(o.proofFor(L_REFRESH, v), v), 4));
            assertEquals(0x6B00, sw, "P1 " + p1);
            assertEquals(F, clock(o));
        }
    }

    @Test
    @DisplayName("A reader with the PIN gains no day: the holder's REFRESH never brings back a clock that is not weak, and a far header with the network's work on a card with no owner stays where it is (the limit of D201)")
    void theHoldersRefreshBringsBackOnlyAWeakClock() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = simpleCard(p);
        assertEquals(SW_OK, header(c, net(T0 + 10 * DAY)));
        assertEquals(SW_OK, pay(c, p[0]));
        long began = window(c);
        ResponseAPDU r = holdersRefresh(c, net(T0 + 2 * DAY));
        assertEquals(SW_OK, r.getSW(), "a REFRESH with an older header of the network's");
        assertEquals(T0 + 10 * DAY, readUint32(r.getData(), 0), "moves nothing");
        assertEquals(began, window(c));
        assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "and gives no day");
        assertEquals(SW_WRONG_LENGTH, holdersRefresh(c, back(net(T0 + 2 * DAY))).getSW(), "the holder has no back form");
        // a far header with the network's own work on a card with no owner: its day rolls at it, and nothing the holder may send brings it back
        assertEquals(SW_OK, header(c, net(F)));
        assertEquals(SW_OK, pay(c, p[1]), "the day rolls at it, as before");
        assertEquals(SW_OVER_LIMIT, pay(c, p[2]));
        assertEquals(F, readUint32(holdersRefresh(c, net(T0 + 10 * DAY + HOUR)).getData(), 0), "the clock stays");
        assertEquals(SW_OVER_LIMIT, pay(c, p[2]), "the piece waits for that day's end (D201: the cost accepted)");
    }

    @Test
    @DisplayName("At a weak clock no day ends and none begins at it: the day of loads counts on, GET_INFO's loads left with it; an owner's new day's limit and a no-PIN window begin with no clock, and the first header that is not weak anchors them")
    void atAWeakClockNoDayEndsOrBegins() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = ownedCard(p, false);
        c.tap();
        c.put(-1, A.id8(), 1);
        long loadDay = LoadCapTest.dayBegan(c);
        int loads = LoadCapTest.loads(c);
        assertEquals(SW_OK, header(c, floorAt(F)));
        c.tap();
        c.put(-1, A.id8(), 1);
        assertEquals(loadDay, LoadCapTest.dayBegan(c), "the day of loads does not end at a weak clock");
        assertEquals(loads + 1, LoadCapTest.loads(c), "and counts on");
        c.tap();
        byte[] info = c.info(4);
        assertEquals(300 - loads - 1, ((info[57] & 0xFF) << 8) | (info[58] & 0xFF), "GET_INFO's loads left with it");
        // the owner's new number for the day, and a no-PIN allowance with a payment under it
        c.tap();
        assertEquals(SW_OK, c.limits(2000, 1000, 1000, 7, 0));
        assertEquals(0, window(c), "a new day's limit begins with no clock at a weak one");
        assertEquals(SW_OK, header(c, floorAt(F + 60)), "a later weak header");
        assertEquals(0, window(c), "anchors nothing");
        c.power();
        ResponseAPDU noPin = c.pay(p[0]);
        assertEquals(64, noPin.getData().length, "a payment with no PIN, under the allowance");
        assertEquals(0, noPinStart(c), "its window begun with no clock");
        assertTrue(readUint32(c.record(), CashuApplet.CARD_NOPIN_SPENT_OFFSET) > 0);
        assertEquals(SW_OK, ownersRefresh(c, net(T0 + HOUR)).getSW());
        assertEquals(T0 + HOUR, window(c), "the header that brings the clock back anchors the day's window");
        // (the owner's proof has ended the no-PIN window, D186; one begun with no clock is anchored as the day's is)
        UnitsTest.Card d = ownedCard(new int[3], false);
        assertEquals(SW_OK, d.limits(1000, 1000, 1000, 7, 0));
        assertEquals(SW_OK, header(d, floorAt(F)));
        d.tap();
        int q = d.put(-1, A.id8(), 10);
        d.power();
        assertEquals(64, d.pay(q).getData().length);
        assertEquals(0, noPinStart(d));
        assertEquals(SW_OK, header(d, net(F + 60)), "a later header of the network's work");
        assertEquals(0, weak(d));
        assertEquals(F + 60, noPinStart(d), "anchors the no-PIN window begun with no clock");
    }

    @Test
    @DisplayName("A weak header later than the clock moves it, as any; a later one that is not weak moves it on and ends the weakness; an older weak header moves nothing, and SET_HEADER never brings a clock back")
    void weakAndNotWeak() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = simpleCard(p);
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OK, header(c, floorAt(T0 + HOUR)), "a weak header an hour on");
        assertEquals(T0 + HOUR, clock(c));
        assertEquals(1, weak(c));
        assertEquals(SW_OK, header(c, net(T0 + 2 * HOUR)));
        assertEquals(0, weak(c), "a later header of the network's: not weak");
        assertEquals(SW_OK, header(c, floorAt(F)));
        assertEquals(SW_OK, header(c, net(T0 + 3 * HOUR)), "SET_HEADER of an older header");
        assertEquals(F, clock(c), "never brings a clock back");
        assertEquals(F, readUint32(holdersRefresh(c, floorAt(T0 + 3 * HOUR)).getData(), 0), "nor does REFRESH with a weak header");
        assertEquals(1, weak(c));
        UnitsTest.Card o = ownedCard(new int[3], false);
        assertEquals(SW_OK, header(o, floorAt(F)));
        assertEquals(F, readUint32(ownersRefresh(o, back(floorAt(T0 + HOUR))).getData(), 0), "nor the owner's back form with a weak header");
        assertEquals(SW_WRONG_LENGTH, ownersRefresh(o, concat(net(T0 + HOUR), new byte[] { 2 })).getSW(), "a byte after the header other than 01");
        assertEquals(F, clock(o));
    }

    @Test
    @DisplayName("Whether the clock is weak stays with its time through a reset with no anchor, and a claim's anchor that is not weak brings the clock back; GET_CARD says it as zero")
    void theWeaknessStaysWithTheClock() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = simpleCard(p);
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OK, header(c, floorAt(F)));
        c.tap();
        byte[] card = c.getCard(0);
        assertEquals(1, weak(c));
        assertEquals(0, card[40 + CashuApplet.CARD_CLOCK_WEAK_OFFSET - CashuApplet.CARD_BITS_OFFSET], "GET_CARD: zero");
        // the card emptied a piece a day, after the holder's REFRESH
        assertEquals(SW_OK, holdersRefresh(c, net(T0 + HOUR)).getSW());
        for (int d = 1; d <= 2; d++) {
            assertEquals(SW_OK, header(c, net(T0 + d * DAY + 60 * d)));
            assertEquals(SW_OK, pay(c, p[d]));
        }
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0, c.count());
        assertEquals(SW_OK, header(c, floorAt(F)));
        assertEquals(1, weak(c));
        c.tap();
        HolderTest.hold(c);
        int[] r = SimpleCardTest.resetByPin(c);
        assertEquals(SW_OK, r[1], "the reset by the PIN, no anchor");
        assertEquals(F, clock(c), "the clock stays");
        assertEquals(1, weak(c), "and it is still weak");
        // the next holder's first set-up, and a claim with the network's header
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, net(T0 + 3 * DAY + HOUR)))));
        assertEquals(T0 + 3 * DAY + HOUR, clock(c), "the claim's anchor brings the weak clock back");
        assertEquals(0, weak(c));
    }

    @Test
    @DisplayName("A reader with the PIN and a weak far header, again and again, gains no day: at the far clock no day begins, and the clock brought back ends none early")
    void aWeakFarHeaderGivesNoDay() throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = simpleCard(p);
        assertEquals(SW_OK, pay(c, p[0]));
        for (int round = 0; round < 3; round++) {
            assertEquals(SW_OK, header(c, floorAt(F)));
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "round " + round + ": at the far clock");
            assertEquals(SW_OK, holdersRefresh(c, net(T0 + HOUR)).getSW());
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "round " + round + ": back at the network's");
        }
        assertEquals(1000, c.spentToday(), "one day's limit, and no more");
    }
}
