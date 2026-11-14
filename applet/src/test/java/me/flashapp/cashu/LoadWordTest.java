package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The reader's word on keys per load at a load (D197): LOAD_PROOF and LOAD_CHANGE take a piece only from a reader that sets
 * P2 bit 1 (02), its word that the piece is locked to the keys of its date (P + t*G), as SPEND_ALL_BEGIN wants P1 bit 1 of a
 * payer. A reader that locks a piece to the card key alone gets 6A86 before the piece is read, and nothing is written.
 */
class LoadWordTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final int SW_INCORRECT_P1P2 = 0x6A86;

    @Test
    @DisplayName("LOAD_PROOF with P2 00 or 01 (no word on keys per load): 6A86, nothing read and nothing written; with 02 or 03 the piece goes on")
    void loadProofWantsTheWord() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Map<String, byte[]> before = PerPaymentKeyTest.persistent(c);
        byte[] piece = buildProof(UnitsTest.SAT_A, 1000, 91, 0);
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 0, piece, 256)), "P2 00");
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 1, concat(new byte[] { 0 }, piece), 256)), "P2 01");
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, 0, concat(piece, new byte[96]), 256)), "P1 01 P2 00");
        // before the data is read: a length that is no piece is the same 6A86
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 0, new byte[3], 256)), "P2 00, three bytes");
        for (Map.Entry<String, byte[]> e : before.entrySet()) {
            assertArrayEquals(e.getValue(), PerPaymentKeyTest.field(c, e.getKey()), "nothing written: " + e.getKey());
        }
        assertEquals(0, readUint32(c.balance(0), 0));
        // a P2 past the two bits is what it was (6B00)
        assertEquals(0x6B00, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 4, piece, 256)), "P2 04");
        assertEquals(0x6B00, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 6, piece, 256)), "P2 06");
        // with the word
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, piece, 256)), "P2 02");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 3, concat(new byte[] { 0 }, buildProof(UnitsTest.SAT_A, 500, 92, 0)), 256)), "P2 03, the unit first");
        assertEquals(1500, readUint32(c.balance(0), 0));
    }

    @Test
    @DisplayName("a loader that locks a piece to the card key alone (P1 00 P2 00) is refused: the card never takes a piece it cannot pay")
    void aPieceLockedToTheCardKeyAloneIsNotTaken() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        ResponseAPDU l = c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 0, buildProof(UnitsTest.SAT_A, 1000, 91, 0), 256));
        assertEquals(SW_INCORRECT_P1P2, l.getSW());
        assertEquals(0, readUint32(c.balance(0), 0), "nothing counted");
        assertEquals(0, c.count(), "no place taken");
    }

    @Test
    @DisplayName("LOAD_CHANGE without P2 bit 1: 6A86 before anything, the opening still owed; with it, the change goes on")
    void loadChangeWantsTheWord() throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        TearSweepTest.readyOwed(c);
        byte[] answer = TearSweepTest.answerFor(c);
        byte[] owed = c.f("openState").clone(), log = c.f("cardLog").clone();
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_CHANGE, 0, 0, answer, 256)), "P2 00");
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_CHANGE, 0, 1, answer, 256)), "P2 01");
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_CHANGE, 9, 0, answer, 256)), "before the opening's number is read");
        assertArrayEquals(owed, c.f("openState"), "the opening still owed");
        assertArrayEquals(log, c.f("cardLog"));
        assertEquals(0, c.balance());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_CHANGE, 0, 2, answer, 256)), "P2 02");
        assertEquals(500, c.balance());
    }
}
