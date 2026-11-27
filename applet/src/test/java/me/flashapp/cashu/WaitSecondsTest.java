package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D258, the project lead's rule that each hold keeps its seconds: the claim's, the history's, the reset's and the PIN's counts are each
 * the least whole count whose time on the 3.2 file is no less than 3.1's count took on the base file, from the chip run of
 * 2026-11-26 on card 57723320 (the reader's medians, milliseconds; the smaller where the 3.2 file has two). A hold of N askings
 * is N - 1 askings' work. A payment's wait is the exception, by the project lead's decision of 2026-11-26: it keeps its COUNT, 2 a
 * limit's worth (0.72 s on that reader against 0.93 s on the base, about 1.0 s in a phone's field by an estimate, not measured), which is pinned here on purpose.
 */
class WaitSecondsTest {

    // base file (00-base-3b9b5a4) and 3.2 file (17-final-a43 at 0249e32)
    static final double SIGN_BASE = 463.3, SIGN_NOW = 361.4;
    static final double CLAIM_BASE = 538.4, CLAIM_NOW = 414.2;
    static final double PIN_BASE = 484.8, PIN_NOW = 352.6;
    static final double HISTORY_BASE = 476.1, HISTORY_NOW = 360.0;
    static final double RESET_BASE = 491.3, RESET_NOW = 361.4;

    /** The least whole count of `now` no shorter than `old` of `base`. */
    static int least(long old, double base, double now) {
        long n = (long) Math.ceil(old * base / now - 1e-9);
        while (n * now < old * base) n++;
        while (n > 0 && (n - 1) * now >= old * base) n--;
        return (int) n;
    }

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    @Test
    @DisplayName("D258: each hold's count is the least whose seconds on the 3.2 file are no fewer than 3.1's count took on the base file: the claim 5, the history 4, the reset 6, the PIN's stretch 22 and its most owed 22,527; a payment's wait keeps 3.1's count, 2 and 2, and its most 508, by the project lead's decision")
    void eachCountKeepsItsSeconds() {
        // the payment's wait keeps its count, not its seconds (the project lead, 2026-11-26): shorter on purpose, 0.72 s against 0.93 s
        assertEquals(2, CashuApplet.WAIT_MORE_SIGNS, "a limit's worth past the first: 3.1's two, by the project lead's decision, not the rule's three");
        assertEquals(2, CashuApplet.WAIT_SECOND_SIGNS, "a second payment in the tap: 3.1's two, by the project lead's decision");
        assertTrue(least(2, SIGN_BASE, SIGN_NOW) > CashuApplet.WAIT_MORE_SIGNS, "the rule alone would say three: the decision, not an oversight");
        assertEquals(least(4 - 1, CLAIM_BASE, CLAIM_NOW) + 1, CashuApplet.CLAIM_ASKINGS, "the claim");
        assertEquals(least(3 - 1, HISTORY_BASE, HISTORY_NOW) + 1, CashuApplet.HISTORY_ASKINGS, "the history");
        assertEquals(least(4 - 1, RESET_BASE, RESET_NOW) + 1, CashuApplet.RESET_ASKINGS, "the reset by the PIN");
        assertEquals(least(16, PIN_BASE, PIN_NOW), CashuApplet.PIN_STRETCH, "the PIN's stretch");
        assertEquals(least(16384, PIN_BASE, PIN_NOW), CashuApplet.PIN_OWED_MOST, "the PIN's most owed");
        // a ceiling, not a wait of its own: 255 limits' worth, which a wrapped sum waits, 508 as in 3.1
        assertEquals(CashuApplet.WAIT_MORE_SIGNS * (CashuApplet.WAIT_UNITS_MOST - 1), CashuApplet.WAIT_SIGNS_MOST);
        assertEquals(508, CashuApplet.WAIT_SIGNS_MOST, "the most a payment waits keeps its count");
        assertEquals(255, CashuApplet.WAIT_UNITS_MOST, "limits' worth, not seconds: unchanged");
    }

    @Test
    @DisplayName("D258: the PIN's wait after every count of wrong tries in a row is the least no shorter than 3.1's 2^w: 2, 3, 6, 11 ... 11,264, then 22,527 from the fifteenth wrong try on")
    void everyPinWaitKeepsItsSeconds() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        c.power();
        byte[] m = c.field("pinMarks");
        for (int w = 0; w <= 15; w++) {
            m[0] = (byte) w; m[1] = 0; m[2] = 0;
            assertEquals(0x63C0 | Math.min(15, w + 1), PinWaitTest.verify(c, CashuAppletTest.WRONG_PIN).getSW(), "wrong try " + (w + 1));
            int want = least(w < 14 ? 1 << w : 16384, PIN_BASE, PIN_NOW);
            assertArrayEquals(new int[] { Math.min(15, w + 1), want }, PinWaitTest.marks(c), "owed after " + (w + 1) + " wrong tries in a row");
        }
    }
}
