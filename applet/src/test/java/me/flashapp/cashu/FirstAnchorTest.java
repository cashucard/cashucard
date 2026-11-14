package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.WeakClockTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The first set-up's anchor (D204). A card that has never taken a real header holds a far header to twice the floor's work
 * (D203), a bar fixed when the floor was set: one such header, cheap against a network that has grown, set a clock that was
 * not weak, and became the hardest, and the set-up's tip, older, moved nothing. Now the header a card's first set-up takes,
 * the claim's anchor or the simple card's `SET_HEADER`, while the card holds nothing, is an anchor as the empty card's reset's
 * is: it becomes the clock even where it is older, and the hardest where it is harder. So a card set up by the text has the
 * network's own block as its hardest before it holds anything, and a far header costs half of that block's work, the case
 * the keeper accepted (option A). Round 13a's probe (R13aProbeTest) is the first test here; round 13b's claim probe (t2) the
 * second.
 *
 * The network here: WeakClockTest's (NET_BITS, four times the tests' floor's work, as the network's blocks were to the floor
 * built in when it was set), and the network grown (GROWN_BITS, twice that). The cheap far header is r13a's: CLOCK_BITS, just
 * over twice the floor's work, the least a card with no hardest holds to be not weak.
 */
class FirstAnchorTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** The network once its difficulty has doubled since the floor was set: eight times the tests' floor's work. */
    static final long GROWN_BITS = 0x20100000L;
    static byte[] grown(long t) { return mine(t, GROWN_BITS, 0); }
    /** r13a's far header: just over twice the floor's work, made once and good on every card with no hardest. */
    static byte[] cheap(long t) { return mine(t, CLOCK_BITS, 13); }
    /** A header just over the floor's work: not weak to a card whose hardest is the cheap header. */
    static byte[] overTheFloor(long t) { return mine(t, 0x207FFFFEL, 13); }

    static long bits(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_BITS_OFFSET); }
    static long le(long bits) { return readUint32(le32(bits), 0); }

    /** A card's first set-up with no owner, by the text: the PIN, the day's limit of 1,000 by the PIN, the record, the tip. */
    static UnitsTest.Card simpleSetUp(UnitsTest.Card c, byte[] tip) throws Exception {
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(1000), u32(1000), u32(0))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(setHeaderCommand(tip)), "the set-up's last step: the tip");
        return c;
    }

    /** A card's first set-up with an owner, by the text: the PIN, the record, the claim with the tip as its anchor; then the owner's day's limit of 1,000. */
    static UnitsTest.Card ownedSetUp(UnitsTest.Card c, byte[] tip) throws Exception {
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, tip))), "the claim, the tip its anchor");
        assertEquals(SW_OK, c.limits(1000, 1000, 0, 7, 0));
        return c;
    }

    @Test
    @DisplayName("r13a 1, the case D204 closes at set-up: a card that never took a real header, given a far header of just over twice the floor's work, is at it, not weak, its hardest that header; the network's older block moves nothing outside a set-up, and a header just over the floor's work is then not weak")
    void aCardThatNeverTookARealHeader() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(cheap(F))), "a stranger, no PIN, a fresh card");
        assertEquals(0, weak(c), "not weak: twice the floor's work, the bar of a card with no hardest");
        assertEquals(F, clock(c));
        assertEquals(le(CLOCK_BITS), bits(c), "and its hardest");
        assertEquals(SW_OK, header(c, grown(T0)), "the network's newest block, older, outside any set-up");
        assertEquals(F, clock(c), "moves nothing");
        assertEquals(le(CLOCK_BITS), bits(c), "and raises no hardest (D201: no older header raises it)");
        assertEquals(SW_OK, header(c, floorAt(F + 2 * WeakClockTest.DAY)), "a header at the floor's work, later");
        assertEquals(1, weak(c), "is weak, by a hair");
        assertEquals(SW_OK, header(c, overTheFloor(F + 3 * WeakClockTest.DAY)), "one just over the floor's work");
        assertEquals(0, weak(c), "is not: on such a card the next far header costs about the floor's work");
        // the way out, before it holds anything: its first set-up, whose tip is its anchor
        simpleSetUp(c, grown(T0 + 60));
        assertEquals(T0 + 60, clock(c), "the set-up's tip brings the clock back");
        assertEquals(0, weak(c));
        assertEquals(le(GROWN_BITS), bits(c), "and is the hardest");
    }

    @Test
    @DisplayName("r13b t2: the claim's anchor brings back a far clock that is not weak, the network's own work or the cheap header's, and becomes the hardest where it is harder")
    void theClaimsAnchorBringsBackAClockThatIsNotWeak() throws Exception {
        for (byte[] far : new byte[][] { net(F), cheap(F) }) {
            UnitsTest.Card c = new UnitsTest.Card();
            assertEquals(SW_OK, c.sw(setHeaderCommand(far)));
            assertEquals(0, weak(c));
            ownedSetUp(c, grown(T0));
            assertEquals(T0, clock(c), "the claim's anchor is the clock");
            assertEquals(0, weak(c));
            assertEquals(le(GROWN_BITS), bits(c), "and the hardest");
        }
        // an anchor less hard than the far header: the clock comes back, the hardest stays (nothing lowers it, D203)
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(grown(F))));
        ownedSetUp(c, net(T0));
        assertEquals(T0, clock(c));
        assertEquals(0, weak(c), "half the hardest's work is not weak");
        assertEquals(le(GROWN_BITS), bits(c), "the hardest stays");
    }

    @Test
    @DisplayName("A card set up by the text, with an owner or without, after a stranger's cheap far header in transit: the tip is its clock and its hardest; the same header given again later is weak, and the card pays down to empty a day's limit a day")
    void anHonestlySetUpCardIsNotFrozenByTheCheapHeader() throws Exception {
        for (boolean owner : new boolean[] { false, true }) {
            UnitsTest.Card c = new UnitsTest.Card();
            assertEquals(SW_OK, c.sw(setHeaderCommand(cheap(F))), "in transit: the cheap far header");
            if (owner) ownedSetUp(c, grown(T0)); else simpleSetUp(c, grown(T0));
            assertEquals(T0, clock(c), "owner=" + owner);
            assertEquals(le(GROWN_BITS), bits(c));
            c.tap();
            int[] p = new int[3];
            for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
            assertEquals(SW_OK, pay(c, p[0]), "day 1");
            assertEquals(SW_OK, header(c, cheap(F)), "the stranger again, the same header");
            assertEquals(1, weak(c), "weak now: less than half the work of the tip the card was set up with");
            assertEquals(SW_OVER_LIMIT, pay(c, p[1]), "no day begins at a weak clock");
            ResponseAPDU r = owner ? ownersRefresh(c, grown(T0 + HOUR)) : holdersRefresh(c, grown(T0 + HOUR));
            assertEquals(SW_OK, r.getSW());
            assertEquals(T0 + HOUR, clock(c), "REFRESH brings it back");
            assertEquals(SW_OK, header(c, grown(T0 + WeakClockTest.DAY + 120)));
            assertEquals(SW_OK, pay(c, p[1]), "day 2");
            assertEquals(SW_OK, header(c, grown(T0 + 2 * WeakClockTest.DAY + 180)));
            assertEquals(SW_OK, pay(c, p[2]), "day 3: the last piece");
            c.tap();
            assertEquals(0, readUint32(c.balance(0), 0), "the card is empty, owner=" + owner);
        }
    }

    @Test
    @DisplayName("What is left on a card set up by the text: a far header with half the work of the tip it took is not weak (option A, accepted); one just under half is weak")
    void whatIsLeft() throws Exception {
        UnitsTest.Card c = simpleSetUp(new UnitsTest.Card(), grown(T0));
        assertEquals(SW_OK, header(c, net(F)), "half the tip's work, far");
        assertEquals(0, weak(c), "not weak: the cost the keeper accepted");
        assertEquals(F, clock(c));
        UnitsTest.Card d = simpleSetUp(new UnitsTest.Card(), grown(T0));
        assertEquals(SW_OK, header(d, mine(F, 0x20200001L, 13)), "a little under half");
        assertEquals(1, weak(d));
    }

    @Test
    @DisplayName("The cheap header near the tip, not far (it passes a two-hour check), before the set-up: the set-up's tip, an hour older, is the clock and the hardest, so the cheap header does not stay the bar")
    void aCheapHeaderNearTheTip() throws Exception {
        for (boolean owner : new boolean[] { false, true }) {
            UnitsTest.Card c = new UnitsTest.Card();
            assertEquals(SW_OK, c.sw(setHeaderCommand(cheap(T0 + HOUR))));
            if (owner) ownedSetUp(c, grown(T0)); else simpleSetUp(c, grown(T0));
            assertEquals(T0, clock(c), "owner=" + owner);
            assertEquals(le(GROWN_BITS), bits(c), "the bar is the tip's");
            assertEquals(SW_OK, header(c, cheap(F)), "the cheap far header");
            assertEquals(1, weak(c), "is weak now");
        }
    }

    @Test
    @DisplayName("Only the first set-up's, and only while the card holds nothing: an older header moves no clock in a later tap, nor in a first set-up whose card holds a piece or is owed change")
    void onlyTheFirstSetUpsAnchor() throws Exception {
        // a later tap: SET_HEADER is as it was
        UnitsTest.Card c = simpleSetUp(new UnitsTest.Card(), grown(T0 + HOUR));
        assertEquals(SW_OK, header(c, grown(T0)), "an older header, the next tap");
        assertEquals(T0 + HOUR, clock(c), "moves nothing");
        // a first set-up whose card holds a piece already
        UnitsTest.Card d = new UnitsTest.Card();
        assertEquals(SW_OK, d.sw(setHeaderCommand(cheap(F))));
        d.power();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        d.pin();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        d.put(-1, A.id8(), 1000);
        assertEquals(SW_OK, d.sw(setHeaderCommand(grown(T0))), "the tip after a load");
        assertEquals(F, clock(d), "moves nothing: the card holds a piece");
        assertEquals(le(CLOCK_BITS), bits(d));
        // and the claim of a card that holds a piece is refused as before (6A8D), anchor or not
        assertEquals(SW_CARD_IN_USE, d.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, grown(T0)))));
        // a first set-up whose card is owed change, and holds no piece
        UnitsTest.Card e = new UnitsTest.Card();
        assertEquals(SW_OK, e.sw(setHeaderCommand(cheap(F))));
        e.power();
        assertEquals(SW_OK, e.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        e.pin();
        assertEquals(SW_OK, e.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        int place = e.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(e, A);
        KeysetKeysTest.payWithChange(e, place, 8, A.keyFor(8), null);
        assertEquals(0, readUint32(e.balance(0), 0), "nothing unspent on the card, change owed");
        assertEquals(SW_OK, e.sw(setHeaderCommand(grown(T0))), "the tip, change owed");
        assertEquals(F, clock(e), "moves nothing: change is owed to the card");
    }

    @Test
    @DisplayName("The first set-up's anchor that is weak: a header at the floor's work, older, is taken as the reset's anchor is (the clock at it, weak, no hardest); the next header that is not weak moves it on")
    void aWeakFirstAnchor() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(cheap(F))));
        simpleSetUp(c, floorAt(T0));
        assertEquals(T0, clock(c));
        assertEquals(1, weak(c));
        assertEquals(le(CLOCK_BITS), bits(c), "the hardest stays");
        assertEquals(SW_OK, header(c, grown(T0 + 60)));
        assertEquals(T0 + 60, clock(c));
        assertEquals(0, weak(c));
        assertEquals(le(GROWN_BITS), bits(c));
    }
}
