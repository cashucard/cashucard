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
 * A card that has taken no hardest header yet (D203): a fresh card, and every card after `SET_CARD` or a reset, which keep
 * the hardest. Before any, a header with less than twice the floor's work is weak, and a weak header is never the hardest:
 * a stranger's far header at the floor's work freezes no day on a card in the box, in its set-up or after its reset, and the
 * holder's `REFRESH` brings the clock back, as on a card that has taken the network's.
 *
 * The network here is WeakClockTest's (NET_BITS, four times the work of the tests' floor); far headers are mined at the
 * tests' floor (`floorAt`).
 */
class NoHardestTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static long bits(UnitsTest.Card c) throws Exception { return readUint32(c.record(), CashuApplet.CARD_BITS_OFFSET); }
    /** The hardest bits as the header carries them (little-endian), read as a number. */
    static long le(long bits) { return readUint32(le32(bits), 0); }

    @Test
    @DisplayName("A fresh card, the first header of all: one at the floor's work is weak and sets no bar; one with twice the floor's work is not weak and is the hardest; one just under twice is weak")
    void theFirstHeaderOfAll() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(floorAt(F))), "a stranger, a fresh card, a far header at the floor's work");
        assertEquals(1, weak(c), "weak: a card with no hardest wants twice the floor's work");
        assertEquals(0, bits(c), "and it sets no hardest");
        assertEquals(SW_OK, c.sw(setHeaderCommand(floorAt(F + 60))), "a second one a minute on");
        assertEquals(1, weak(c), "is weak too: the first set no bar for it");
        assertEquals(0, bits(c));
        UnitsTest.Card d = new UnitsTest.Card();
        assertEquals(SW_OK, d.sw(setHeaderCommand(mine(T0, 0x203FFFFFL, 0))), "twice the floor's work, no more");
        assertEquals(0, weak(d), "is not weak");
        assertEquals(le(0x203FFFFFL), bits(d), "and is the hardest");
        UnitsTest.Card e = new UnitsTest.Card();
        assertEquals(SW_OK, e.sw(setHeaderCommand(mine(T0, 0x20400000L, 0))), "a little under twice the floor's work");
        assertEquals(1, weak(e));
        assertEquals(0, bits(e));
        UnitsTest.Card n = new UnitsTest.Card();
        assertEquals(SW_OK, n.sw(setHeaderCommand(net(T0))), "the network's");
        assertEquals(0, weak(n));
        assertEquals(le(WeakClockTest.NET_BITS), bits(n));
    }

    @Test
    @DisplayName("The real network's newest block, at the floor built in, on a fresh card: not weak, the hardest")
    void theRealNetworkOnAFreshCard() throws Exception {
        useFloor(BUILT_FLOOR);
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(hexToBytes(TIP))));
        assertEquals(TIP_TIME, clock(c));
        assertEquals(0, weak(c));
        assertEquals(le(TIP_BITS), bits(c));
    }

    @Test
    @DisplayName("A simple card set up by the text, with its tip and with no header at all: a stranger's far header at the floor's work after it is weak, the holder's REFRESH brings the clock back, and the card pays down to empty a day's limit a day")
    void aSimpleCardWithNoHeaderBeforeTheStranger() throws Exception {
      for (boolean tip : new boolean[] { true, false }) {
        int[] p = new int[3];
        UnitsTest.Card c;
        if (tip) {
            c = SimpleCardTest.setUpWith(concat(u32(1000), u32(1000), u32(0)));
        } else {
            // the set-up with no header: the PIN, the numbers, the record
            c = new UnitsTest.Card();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
            c.pin();
            assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(1000), u32(1000), u32(0))));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
            c.tap();
            assertEquals(0, bits(c), "no header yet");
        }
        for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
        long began = window(c);
        assertEquals(SW_OK, header(c, floorAt(F)), "a stranger, no PIN, a far header at the floor's work");
        assertEquals(1, weak(c), "weak, tip=" + tip);
        assertEquals(SW_OK, pay(c, p[0]), "the first day's payment");
        assertEquals(began, window(c), "no day begins at a weak clock");
        assertEquals(SW_OVER_LIMIT, pay(c, p[1]));
        ResponseAPDU r = holdersRefresh(c, net(T0 + HOUR));
        assertEquals(SW_OK, r.getSW());
        assertEquals(T0 + HOUR, readUint32(r.getData(), 0), "the holder's REFRESH brings the clock back");
        assertEquals(tip ? T0 : T0 + HOUR, window(c), "the day where it began, or anchored at the header that brought the clock back");
        assertEquals(SW_OK, header(c, net(T0 + WeakClockTest.DAY + 2 * HOUR)));
        assertEquals(SW_OK, pay(c, p[1]), "day 2");
        assertEquals(SW_OK, header(c, net(T0 + 2 * WeakClockTest.DAY + 3 * HOUR)));
        assertEquals(SW_OK, pay(c, p[2]), "day 3: the last piece");
        c.tap();
        assertEquals(0, readUint32(c.balance(0), 0), "the card is empty");
      }
    }

    @Test
    @DisplayName("A fresh card touched first by a stranger's far header at the floor's work, then set up by the text (its day's limit before SET_CARD, the tip last): the day begins at no clock, the set-up's tip brings the clock back and begins it (D204), and the card pays down to empty a day's limit a day")
    void aFreshCardTouchedFirstByAStranger() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(floorAt(F))));
        assertEquals(1, weak(c));
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(1000), u32(1000), u32(0))));
        assertEquals(0, window(c), "the day's limit set at a weak clock begins with no clock");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(setHeaderCommand(net(T0 + 60))), "the set-up's last step: the tip");
        assertEquals(T0 + 60, clock(c), "the set-up's tip, the first set-up's anchor, brings the clock back (D204)");
        assertEquals(T0 + 60, window(c), "and the day begins at it");
        c.tap();
        int[] p = new int[3];
        for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OVER_LIMIT, pay(c, p[1]));
        assertEquals(T0 + HOUR, readUint32(holdersRefresh(c, net(T0 + HOUR)).getData(), 0), "the holder brings the clock back");
        assertEquals(SW_OK, header(c, net(T0 + WeakClockTest.DAY + 2 * HOUR)));
        assertEquals(SW_OK, pay(c, p[1]));
        assertEquals(SW_OK, header(c, net(T0 + 2 * WeakClockTest.DAY + 3 * HOUR)));
        assertEquals(SW_OK, pay(c, p[2]));
        c.tap();
        assertEquals(0, readUint32(c.balance(0), 0), "the card is empty");
    }

    /** A simple card paid down to empty and reset by the PIN with no anchor, `farFirst` given just before the reset. */
    static UnitsTest.Card resetWithNoAnchor(byte[] farFirst) throws Exception {
        int[] p = new int[3];
        UnitsTest.Card c = simpleCard(p);
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OK, header(c, net(T0 + WeakClockTest.DAY + 120)));
        assertEquals(SW_OK, pay(c, p[1]));
        assertEquals(SW_OK, header(c, net(T0 + 2 * WeakClockTest.DAY + 180)));
        assertEquals(SW_OK, pay(c, p[2]));
        c.tap();
        assertEquals(SW_OK, c.clearSpent());
        if (farFirst != null) assertEquals(SW_OK, header(c, farFirst));
        c.tap();
        HolderTest.hold(c);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1], "the holder's reset, no anchor");
        return c;
    }

    /** The next holder's first set-up: PIN, record, the tip, a day's limit of 1,000, two pieces of 1,000. */
    static int[] setUpAgain(UnitsTest.Card c, long tip) throws Exception {
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(setHeaderCommand(net(tip))));
        assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(1000), u32(1000), u32(0))));
        int[] p = { c.put(-1, A.id8(), 1000), c.put(-1, A.id8(), 1000) };
        c.tap();
        return p;
    }

    @Test
    @DisplayName("A reset with no anchor keeps the hardest: a stranger's far header at the floor's work after it is weak, and the next holder's day is not frozen")
    void theResetKeepsTheHardest() throws Exception {
        UnitsTest.Card c = resetWithNoAnchor(null);
        assertEquals(le(WeakClockTest.NET_BITS), bits(c), "the hardest stays through the reset");
        assertEquals(SW_OK, header(c, floorAt(F)), "a stranger, no PIN");
        assertEquals(1, weak(c), "weak");
        int[] p = setUpAgain(c, T0 + 3 * WeakClockTest.DAY);
        assertEquals(le(WeakClockTest.NET_BITS), bits(c), "and through the next holder's SET_CARD");
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(T0 + 3 * WeakClockTest.DAY + HOUR, readUint32(holdersRefresh(c, net(T0 + 3 * WeakClockTest.DAY + HOUR)).getData(), 0), "the holder brings the clock back");
        assertEquals(SW_OK, header(c, net(T0 + 9 * WeakClockTest.DAY)));
        assertEquals(SW_OK, pay(c, p[1]), "six days on: the day ended");
    }

    @Test
    @DisplayName("A weak clock kept through a reset stays weak through the next set-up and a second stranger's header at the floor's work: the holder's way back stays")
    void aWeakClockStaysWeakThroughAResetAndASetUp() throws Exception {
        UnitsTest.Card c = resetWithNoAnchor(floorAt(F));
        assertEquals(1, weak(c), "the weak clock kept through the reset");
        int[] p = setUpAgain(c, T0 + 3 * WeakClockTest.DAY);
        assertEquals(SW_OK, header(c, floorAt(F + 60)), "a stranger's second far header at the floor's work");
        assertEquals(1, weak(c), "still weak");
        assertEquals(T0 + 3 * WeakClockTest.DAY + HOUR, readUint32(holdersRefresh(c, net(T0 + 3 * WeakClockTest.DAY + HOUR)).getData(), 0), "the holder's way back");
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OK, header(c, net(T0 + 9 * WeakClockTest.DAY)));
        assertEquals(SW_OK, pay(c, p[1]), "not frozen");
    }

    @Test
    @DisplayName("The way out named at set-up: a fresh card whose clock a far header of twice the floor's work set (not weak) is given a PIN, held for and reset by it with the tip as its anchor in one tap; the clock is back, and the card is set up and pays a day's limit a day")
    void aFreshCardWithAFarClockIsResetWithAnAnchor() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(setHeaderCommand(blockAt(F))), "a far header with twice the floor's work");
        assertEquals(0, weak(c), "not weak: the cost accepted");
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "a PIN for the reset alone");
        c.pin();
        HolderTest.hold(c);
        int n = 0;
        ResponseAPDU r;
        CommandAPDU reset = new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, net(T0));
        while ((r = c.sim.transmitCommand(reset)).getSW() == SW_KEEP_HOLDING && n < 200) n++;
        assertEquals(SW_OK, r.getSW(), "the reset by the PIN with the tip as its anchor");
        assertEquals(T0, clock(c), "the clock at the tip");
        assertEquals(0, weak(c));
        c.power();
        int[] p = new int[3];
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the set-up");
        c.pin();
        assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(1000), u32(1000), u32(0))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(T0, window(c), "the day begins at the tip");
        c.tap();
        for (int i = 0; i < 3; i++) p[i] = c.put(-1, A.id8(), 1000);
        assertEquals(SW_OK, pay(c, p[0]));
        assertEquals(SW_OVER_LIMIT, pay(c, p[1]));
        assertEquals(SW_OK, header(c, net(T0 + WeakClockTest.DAY + 60)));
        assertEquals(SW_OK, pay(c, p[1]), "a day on");
    }

    @Test
    @DisplayName("SET_CARD keeps the hardest, the owner's and the PIN's: a far header at the floor's work after it is weak")
    void setCardKeepsTheHardest() throws Exception {
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(SW_OK, header(o, net(T0 + 60)));
        o.tap();
        byte[] v = UnitsTest.recordIn(UnitsTest.SAT);
        assertEquals(SW_OK, o.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(o.proofFor(L_CARD, v), v))), "the owner's SET_CARD");
        assertEquals(le(WeakClockTest.NET_BITS), bits(o), "the hardest stays");
        assertEquals(SW_OK, header(o, floorAt(F)));
        assertEquals(1, weak(o), "a far header at the floor's work is weak");
    }
}
