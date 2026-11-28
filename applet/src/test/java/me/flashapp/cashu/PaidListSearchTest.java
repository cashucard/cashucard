package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D253: the paid list's rows and the filled places held to a loaded piece's nonce by a first-byte test before the whole
 * compare. Every row in use is still compared whole where its first byte is the nonce's: the answers here are those of
 * 3b9b5a4 for every case. jCardSim cannot count the chip's compares (Util.arrayCompare is the simulator's own, not the
 * applet's), so the saving, about 141 µs a row on a J3R180 by the chip run's slope, is not shown: simulator only for speed.
 */
class PaidListSearchTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final int ROW = CashuApplet.PAID_ROW, ROWS = CashuApplet.PAID_ROWS, NEXT = CashuApplet.PAID_NEXT, ROUND = CashuApplet.PAID_ROUND;

    /** A piece of 8 whose nonce (at 12 in the 81 bytes) is `nonce`. */
    static byte[] piece(UnitsTest.Card c, byte[] nonce) {
        byte[] p = c.piece(UnitsTest.SAT_A, 8);
        System.arraycopy(nonce, 0, p, 12, 32);
        return p;
    }
    /** The paid list set as a card that has paid `next` rows (round: gone past the end): every row filled with bytes of `lead`. */
    static void list(UnitsTest.Card c, int next, boolean round, byte lead) throws Exception {
        byte[] paid = c.field("paid");
        for (int r = 0; r < ROWS; r++) {
            for (int i = 0; i < ROW; i++) paid[r * ROW + i] = (byte) (i == 0 ? lead : r * 7 + i);
        }
        paid[NEXT] = (byte) (next >> 8);
        paid[NEXT + 1] = (byte) next;
        paid[ROUND] = (byte) (round ? 1 : 0);
    }
    static void row(UnitsTest.Card c, int r, byte[] nonce) throws Exception {
        System.arraycopy(nonce, 0, c.field("paid"), r * ROW, ROW);
    }
    static byte[] nonce(int seed) {
        byte[] n = new byte[32];
        for (int i = 0; i < 32; i++) n[i] = (byte) (seed * 31 + i * 17 + 5);
        return n;
    }
    static int load(UnitsTest.Card c, byte[] nonce) { return c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, piece(c, nonce), 256)); }

    @Test
    @DisplayName("D253: a nonce on the paid list is refused 6A94 at the first row, at the last row in use, and (once the ring has gone round) at the last row of all and at a row past the next one; a nonce that differs from a row only in its last byte, or only in its first, goes on; a row past the next one on a list that has not gone round holds nothing: as on 3b9b5a4")
    void thePaidListIsSearchedWhole() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte lead = nonce(1)[0];
        // rows 0 to 4 in use, every row's first byte the nonces' own
        list(c, 5, false, lead);
        int k = 1;
        for (int r : new int[] { 0, 4 }) {
            byte[] n = nonce(k++);
            row(c, r, n);
            assertEquals(SW_PIECE_ON_CARD, load(c, n), "row " + r + " in use: refused");
        }
        byte[] stale = nonce(k++);
        row(c, 5, stale);
        assertEquals(SW_OK, load(c, stale), "row 5, the next, not in use: the piece goes on");
        byte[] last = nonce(k++);
        row(c, 3, last);
        byte[] lastByte = last.clone();
        lastByte[ROW - 1] ^= 1;
        assertEquals(SW_OK, load(c, lastByte), "differs in the row's last byte only: goes on");
        byte[] firstByte = last.clone();
        firstByte[0] ^= 0x40;
        assertEquals(SW_OK, load(c, firstByte), "differs in the first byte only: goes on");
        assertEquals(SW_PIECE_ON_CARD, load(c, last), "the row itself: refused");
        // gone round, next = 3: every row is in use
        UnitsTest.Card d = UnitsTest.owned(UnitsTest.SAT);
        list(d, 3, true, lead);
        for (int r : new int[] { ROWS - 1, 7, 2, 3 }) {
            byte[] n = nonce(100 + r);
            row(d, r, n);
            assertEquals(SW_PIECE_ON_CARD, load(d, n), "gone round: row " + r + " refused");
        }
        assertEquals(SW_OK, load(d, nonce(999)), "a nonce on no row goes on");
    }

    @Test
    @DisplayName("D253: a nonce on a filled place is refused 6A94 though every other place's nonce begins with the same byte; one that differs from it only in its last byte goes on; as on 3b9b5a4")
    void theFilledPlacesAreSearchedWhole() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] base = nonce(7);
        for (int i = 0; i < 6; i++) {
            byte[] n = base.clone();
            n[31] = (byte) (0x10 + i);
            assertEquals(SW_OK, load(c, n), "place " + i);
        }
        byte[] again = base.clone();
        again[31] = 0x13;
        assertEquals(SW_PIECE_ON_CARD, load(c, again), "the fourth place's nonce: refused");
        byte[] other = base.clone();
        other[31] = 0x30;
        assertEquals(SW_OK, load(c, other), "the same first 31 bytes, another last: goes on");
    }

    @Test
    @DisplayName("D253: in loadOne every row in use is read, its first byte before the whole compare, with nothing kept between loads; slotWithNonce does the same for the filled places")
    void everyRowIsReadAndNoneSkipped() throws Exception {
        String src = WipesTest.source("CashuApplet.java");
        int[] l = SchnorrHWMathTest.bodyRange(src, "private short loadOne(");
        String loadOne = src.substring(l[0], l[1]).replaceAll("\\s+", " ");
        assertTrue(loadOne.contains("for (short r = 0; r < rows; r += PAID_ROW) { if (paid[r] == first && Util.arrayCompare(paid, r, buf, nonce, PAID_ROW) == 0) return SW_PIECE_ON_CARD; }"),
            "each row in use, from the first, its first byte and then the whole row");
        int[] s = SchnorrHWMathTest.bodyRange(src, "private short slotWithNonce(");
        String slot = src.substring(s[0], s[1]).replaceAll("\\s+", " ");
        assertTrue(slot.contains("&& proofStorage[(short)(at + PROOF_NONCE_OFFSET)] == first && Util.arrayCompare(proofStorage, (short)(at + PROOF_NONCE_OFFSET), a, off, (short) 32) == 0"),
            "each filled place, its nonce's first byte and then the whole nonce");
        assertTrue(Arrays.asList(ProofStoreTest.methodsNaming(src, "paid").toArray()).contains("loadOne"));
    }
}
