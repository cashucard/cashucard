package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D252: a load's places looked for once a piece, and the mint's proof of zeros found by the chip's own compare (the two small
 * items of A6 of the 3.2 speed review). The simulator shows the places and the answers; neither saving (a walk of the 128
 * places, about 9 ms; a 96-byte loop, about 4 ms) is shown: simulator only for speed.
 */
class LoadWalkTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static byte[] three(UnitsTest.Card c) {
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, concat(c.piece(UnitsTest.SAT_A, 8), c.piece(UnitsTest.SAT_A, 8), c.piece(UnitsTest.SAT_A, 8)), 256));
        assertEquals(SW_OK, r.getSW());
        return r.getData();
    }

    @Test
    @DisplayName("D252 (the red team's A6-5): a LOAD_PROOF of three pieces takes three distinct places, the first three empty ones: 0, 1, 2 on an empty card; 1, 3, 5 on one whose places 1 and 3 were freed (spent and cleared); and on a card with two places left, the two, the third piece refused with nothing written over")
    void threePiecesTakeThreeDistinctPlaces() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertArrayEquals(new byte[] { 0, 1, 2 }, three(c), "an empty card");
        for (int i = 0; i < 2; i++) c.put(-1, UnitsTest.SAT_A, 8);
        assertEquals(SW_OK, c.pay(1).getSW());
        c.tap();
        assertEquals(SW_OK, c.pay(3).getSW());
        c.tap();
        assertEquals(SW_OK, c.clearSpent(), "places 1 and 3 freed");
        assertArrayEquals(new byte[] { 1, 3, 5 }, three(c), "the holes first, then the next place");
        byte[][] slots = new byte[6][];
        for (int i = 0; i < 6; i++) slots[i] = c.slot(i);
        for (int i = 0; i < 6; i++) for (int j = i + 1; j < 6; j++) assertFalse(Arrays.equals(slots[i], slots[j]), "places " + i + " and " + j + " hold two pieces");
        // up to 126 places taken, then three pieces: two go on
        while (c.count() < 126) c.put(-1, UnitsTest.SAT_A, 8);
        byte[] got = three(c);
        assertEquals(2, got.length, "two of the three went on");
        assertTrue(got[0] != got[1], "in two places");
        assertEquals(128, c.count(), "the card full");
    }

    @Test
    @DisplayName("D252 (the red team's A6-6): a piece whose mint's proof is all zeros is refused 6A80, and one whose proof has a single byte other than zero, first, in the middle or last, is taken, as before; the check reads no array of zeros")
    void aProofOfZerosIsRefusedAndOneByteIsEnough() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] none = new byte[96];
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, 2, concat(c.piece(UnitsTest.SAT_A, 8), none), 256)), "a proof of zeros");
        for (int at : new int[] { 0, 47, 95 }) {
            byte[] p = new byte[96];
            p[at] = (byte) (at == 95 ? 0x80 : 1);
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, 2, concat(c.piece(UnitsTest.SAT_A, 8), p), 256)), "one byte at " + at);
        }
        String src = WipesTest.source("CashuApplet.java");
        int[] z = SchnorrHWMathTest.bodyRange(src, "private static boolean zeros(");
        String zeros = src.substring(z[0], z[1]).replaceAll("\\s+", " ");
        assertTrue(zeros.contains("a[off] == (byte) 0 && Util.arrayCompare(a, off, a, (short)(off + 1), (short)(len - 1)) == (byte) 0"), "the bytes compared with themselves one place on: no array of zeros read");
    }

    @Test
    @DisplayName("D252: loadOne walks no places of its own: its caller gives it the place, LOAD_PROOF looking again from the place after each piece stored, LOAD_CHANGE once; and the proof's check of zeros is the chip's compare")
    void loadOneIsGivenItsPlace() throws Exception {
        String src = WipesTest.source("CashuApplet.java");
        int[] l = SchnorrHWMathTest.bodyRange(src, "private short loadOne(");
        String loadOne = src.substring(l[0], l[1]);
        assertFalse(loadOne.contains("emptySlot("), "loadOne looks for no place");
        assertTrue(loadOne.contains("zeros(buf, proofAt, DLEQ_LEN)"), "the proof of zeros by the chip's compare");
        int[] p = SchnorrHWMathTest.bodyRange(src, "private void processLoadProof(");
        String load = src.substring(p[0], p[1]).replaceAll("\\s+", " ");
        assertTrue(load.contains("done++; slot = emptySlot((short)(slot + 1));"), "the next piece's place looked for after each piece stored");
    }
}
