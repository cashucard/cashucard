package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D258, the project lead's rule that each wait keeps its seconds: every count of the card's own work is the least whole count whose
 * time on the 3.2 file is no less than 3.1's count took on the base file, from the chip run of 2026-11-26 on card 57723320
 * (the reader's medians, milliseconds; the smaller where the 3.2 file has two). A hold of N askings is N - 1 askings' work.
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
    @DisplayName("D258: each count is the least whose seconds on the 3.2 file are no fewer than 3.1's count took on the base file: the waits 3 and 3, the claim 5, the history 4, the reset 6, the PIN's stretch 22 and its most owed 22,527; the most a payment waits stays 255 limits' worth, 762")
    void eachCountKeepsItsSeconds() {
        assertEquals(least(2, SIGN_BASE, SIGN_NOW), CashuApplet.WAIT_MORE_SIGNS, "a limit's worth past the first");
        assertEquals(least(2, SIGN_BASE, SIGN_NOW), CashuApplet.WAIT_SECOND_SIGNS, "a second payment in the tap");
        assertEquals(least(4 - 1, CLAIM_BASE, CLAIM_NOW) + 1, CashuApplet.CLAIM_ASKINGS, "the claim");
        assertEquals(least(3 - 1, HISTORY_BASE, HISTORY_NOW) + 1, CashuApplet.HISTORY_ASKINGS, "the history");
        assertEquals(least(4 - 1, RESET_BASE, RESET_NOW) + 1, CashuApplet.RESET_ASKINGS, "the reset by the PIN");
        assertEquals(least(16, PIN_BASE, PIN_NOW), CashuApplet.PIN_STRETCH, "the PIN's stretch");
        assertEquals(least(16384, PIN_BASE, PIN_NOW), CashuApplet.PIN_OWED_MOST, "the PIN's most owed");
        // a ceiling, not a wait of its own: 255 limits' worth, which a wrapped sum waits; no shorter than 3.1's 508 either
        assertEquals(CashuApplet.WAIT_MORE_SIGNS * (CashuApplet.WAIT_UNITS_MOST - 1), CashuApplet.WAIT_SIGNS_MOST);
        assertTrue(CashuApplet.WAIT_SIGNS_MOST >= least(508, SIGN_BASE, SIGN_NOW), "the most a payment waits is no shorter");
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
