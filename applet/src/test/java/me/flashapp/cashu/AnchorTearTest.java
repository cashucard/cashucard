package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import me.flashapp.cashu.TearSweepTest.Card;
import static org.junit.jupiter.api.Assertions.assertEquals;

import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The anchors torn at every persistent write (TearSweepTest.sweep): round 13a's hand-over with an anchor (R13aTearTest, made
 * permanent, at the tests' floor so that the hand-over goes through: its untorn run is held to be the new owner's), and the
 * first set-up's anchor (D204) in `SET_HEADER` and in a claim, on a card a stranger's far header set, its day's window begun
 * at that far clock. Every tear leaves the old card or the new one: never a clock brought back with its window left far.
 */
class AnchorTearTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void report() {
        useFloor(BUILT_FLOOR);
        TearSweepTest.report();
    }

    static final long F = 3_000_000_000L;
    static long le(long bits) { return readUint32(le32(bits), 0); }

    @Test
    void aHandOverWithAnAnchorTorn() throws Exception {
        sweep("r13a: the hand-over with an anchor, a weak far clock and every day begun", c -> {
                ready(c, 0);
                useTheTestFloor();
                byte[] rec = c.f("cardRecord");
                byte[] pm = c.f("pinMarks");
                putUint32(rec, CashuApplet.CARD_NOW_OFFSET, F);
                rec[CashuApplet.CARD_CLOCK_WEAK_OFFSET] = 1;
                putUint32(rec, CashuApplet.CARD_LIMIT_OFFSET, 1000);
                putUint32(rec, CashuApplet.CARD_WINDOW_OFFSET, F + 100);
                putUint32(rec, CashuApplet.CARD_NOPIN_START_OFFSET, F + 100);
                putUint32(pm, CashuApplet.PM_LOAD_DAY, F + 100);
                rec[CashuApplet.CARD_HEADER_OFFSET] = 7;
                rec[CashuApplet.CARD_ROLLS_OFFSET] = 3;
                System.arraycopy(le32(0x20300000L), 0, rec, CashuApplet.CARD_BITS_OFFSET, 4);
            },
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                byte[] v = concat(OTHER_OWNER.pub, WeakClockTest.net(T0 + 600));
                c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, v), v)));
            },
            c -> {
                byte[] rec = c.f("cardRecord");
                byte[] pm = c.f("pinMarks");
                long now = readUint32(rec, CashuApplet.CARD_NOW_OFFSET), bits = readUint32(rec, CashuApplet.CARD_BITS_OFFSET);
                boolean newOwner = now == T0 + 600;
                if (c.k == 0 && !newOwner) c.wrong("the untorn hand-over did not go through: now=" + now);
                if (newOwner) {
                    if (readUint32(rec, CashuApplet.CARD_WINDOW_OFFSET) != 0 || readUint32(pm, CashuApplet.PM_LOAD_DAY) != 0
                        || readUint32(rec, CashuApplet.CARD_NOPIN_START_OFFSET) != 0 || rec[CashuApplet.CARD_HEADER_OFFSET] != 0
                        || rec[CashuApplet.CARD_ROLLS_OFFSET] != 0) c.wrong("the new owner's card with the last owner's days left");
                    if (rec[CashuApplet.CARD_CLOCK_WEAK_OFFSET] != 0) c.wrong("the anchor's clock weak");
                    if (bits != le(WeakClockTest.NET_BITS)) c.wrong("the anchor, harder, not the hardest: " + Long.toHexString(bits));
                } else {
                    if (now != F || readUint32(rec, CashuApplet.CARD_WINDOW_OFFSET) != F + 100 || bits != le(0x20300000L))
                        c.wrong("the old owner's card changed: now=" + now + " bits=" + Long.toHexString(bits));
                }
            });
    }

    /** A fresh card a stranger's far header (not weak) set, in its first set-up: the PIN, a day's limit by the PIN, the record. */
    static void farFirstSetUp(Card c) {
        useTheTestFloor();
        assertEquals(SW_OK, c.sw(setHeaderCommand(FirstAnchorTest.cheap(F))));
        c.powerCycle();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(1000), u32(0)))));
        assertEquals(SW_OK, c.sw(setCardOpenCommand(UnitsTest.recordIn(UnitsTest.SAT))));
        TearHook.refresh();
    }

    /** All new (the clock, the window and the hardest at the tip) or all old (at the far header). */
    static void newOrOld(Card c) {
        byte[] rec = c.f("cardRecord");
        long now = readUint32(rec, CashuApplet.CARD_NOW_OFFSET), window = readUint32(rec, CashuApplet.CARD_WINDOW_OFFSET);
        long bits = readUint32(rec, CashuApplet.CARD_BITS_OFFSET);
        boolean anchored = now == T0 && window == T0 && bits == le(FirstAnchorTest.GROWN_BITS);
        boolean before = now == F && window == F && bits == le(CLOCK_BITS);
        if (c.k == 0 && !anchored) c.wrong("the untorn first set-up's anchor not taken: now=" + now + " window=" + window);
        if (!anchored && !before) c.wrong("half an anchor: now=" + now + " window=" + window + " bits=" + Long.toHexString(bits));
    }

    @Test
    void theFirstSetUpsSetHeaderTorn() throws Exception {
        sweep("D204: SET_HEADER, the first set-up's anchor, on a card a far header set, its window begun there",
            AnchorTearTest::farFirstSetUp,
            c -> c.send(setHeaderCommand(FirstAnchorTest.grown(T0))),
            AnchorTearTest::newOrOld);
    }

    @Test
    void theFirstSetUpsClaimTorn() throws Exception {
        sweep("D204: the claim's anchor, the first set-up's, on a card a far header set, its window begun there",
            AnchorTearTest::farFirstSetUp,
            c -> c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, FirstAnchorTest.grown(T0)))),
            c -> {
                newOrOld(c);
                boolean owned = c.f("ownerSet")[0] == 1;
                long now = readUint32(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET);
                if (owned != (now == T0)) c.wrong("the owner and the anchor apart: owned=" + owned + " now=" + now);
            });
    }
}
