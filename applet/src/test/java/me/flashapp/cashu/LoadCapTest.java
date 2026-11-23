package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A card loads at most 300 pieces a day by its own clock (D191, D195), LOAD_PROOF's and the change of the payments it signs
 * (D200, counted at the signature), so that the paid list's 1,024 rows take four days of loads to go round (a little over
 * three days at the least). A load past it is 6A8F with nothing written; a day of loads begins at the first load a day or
 * more after the last began; a card with no clock loads a day's pieces until its first header. The count is in lasting
 * memory, written with its day in one atomic copy before the piece.
 */
class LoadCapTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static int loads(UnitsTest.Card c) throws Exception {
        byte[] m = c.field("pinMarks");
        return ((m[CashuApplet.PM_LOADS] & 0xFF) << 8) | (m[CashuApplet.PM_LOADS + 1] & 0xFF);
    }
    static long dayBegan(UnitsTest.Card c) throws Exception { return readUint32(c.field("pinMarks"), CashuApplet.PM_LOAD_DAY); }
    static void setLoads(UnitsTest.Card c, int n) throws Exception {
        c.field("pinMarks")[CashuApplet.PM_LOADS] = (byte) (n >> 8);
        c.field("pinMarks")[CashuApplet.PM_LOADS + 1] = (byte) n;
    }

    @Test
    @DisplayName("Each piece loaded counts, one a piece of a batch, from the day the first load begins at the card's now; the 300th goes on, the 301st is 6A8F with nothing written; a batch across the line answers the pieces that went on")
    void threeHundredADay() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(0, loads(c));
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 1), c.piece(A.id8(), 2), c.piece(A.id8(), 4)).getSW());
        assertEquals(3, loads(c), "three pieces, three loads");
        assertEquals(T0, dayBegan(c), "the day began at the card's now");
        setLoads(c, 298);
        ResponseAPDU r = c.load(c.piece(A.id8(), 8), c.piece(A.id8(), 16), c.piece(A.id8(), 32));
        assertEquals(SW_OK, r.getSW());
        assertEquals(2, r.getData().length, "two of the batch went on, the 299th and the 300th");
        assertEquals(300, loads(c));
        java.util.Map<String, byte[]> before = c.snapshot();
        byte[] marks = c.field("pinMarks").clone();
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 64)).getSW(), "the 301st");
        c.assertUnchanged(before, "nothing written");
        assertEquals(Arrays.toString(marks), Arrays.toString(c.field("pinMarks")), "nor the count");
    }

    @Test
    @DisplayName("A day of loads ends a day after it began by the card's clock: a header a second short of it loads nothing more, one at the day loads, and the count begins again at its now")
    void theDayEndsByTheClock() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.put(-1, A.id8(), 1);
        setLoads(c, 300);
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 2)).getSW());
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_399)));
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 2)).getSW(), "a second short of a day");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_400)));
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 2)).getSW(), "a day after");
        assertEquals(1, loads(c));
        assertEquals(T0 + 86_400, dayBegan(c));
    }

    @Test
    @DisplayName("A card that has taken no header loads 300 pieces and then nothing until its first header, which begins a day of loads")
    void noClockOneDaysPieces() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 1)).getSW(), "no header: loads");
        assertEquals(0, dayBegan(c));
        setLoads(c, 300);
        c.power();
        c.pin();
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 2)).getSW(), "no clock, no new day: a new time in the field brings none");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 2)).getSW(), "the first header begins a day");
        assertEquals(1, loads(c));
    }

    @Test
    @DisplayName("Change counts when it is made (D200): the payment's signature counts it in the day of loads, and its LOAD_CHANGE counts nothing and goes on with the day's count full")
    void changeCounts() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int place = c.put(-1, A.id8(), 64);
        KeysetKeysTest.taught(c, A);
        int before = loads(c);
        byte[] row = KeysetKeysTest.payWithChange(c, place, 8, A.keyFor(8), null);
        assertEquals(before + 1, loads(c), "counted at the signature");
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 8));
        setLoads(c, 300);
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(8)).getSW(), "never refused for the count");
        assertEquals(0, c.info(0)[29], "nothing owed");
        assertEquals(300, loads(c), "and not counted again");
    }

    @Test
    @DisplayName("RESET_CARD begins the day of loads again with the new c (D200): the day, the count and the change counted go to nothing in its last transaction")
    void aResetBeginsTheDayAgain() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int q = c.put(-1, A.id8(), 1), p = c.put(-1, A.id8(), 2);
        setLoads(c, 250);
        c.field("pinMarks")[CashuApplet.PM_COUNTED] = (byte) 0x05;
        assertEquals(64, c.pay(q, p).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(0, loads(c));
        assertEquals(0, dayBegan(c));
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_COUNTED]);
    }
    static int left(UnitsTest.Card c) {
        byte[] i = c.info(4);
        assertEquals(59, i.length, "GET_INFO P1 = 4: 59 bytes");
        return ((i[57] & 0xFF) << 8) | (i[58] & 0xFF);
    }

    @Test
    @DisplayName("GET_INFO P1 = 4 says the loads left today (57, 58) to a reader told the history: 300 less the day's count, 300 again when a day has passed by the card's clock, and zeros to anyone else")
    void theLoadsLeftAreSaid() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(300, left(c), "none loaded yet");
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 1), c.piece(A.id8(), 2), c.piece(A.id8(), 4)).getSW());
        assertEquals(297, left(c));
        setLoads(c, 300);
        assertEquals(0, left(c), "the day's loads all made");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_399)));
        assertEquals(0, left(c), "a second short of a day");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_400)));
        assertEquals(300, left(c), "a day after: a new day's, before its first load");
        setLoads(c, 120);
        c.power();
        assertEquals(0, left(c), "a stranger: zeros");
        c.pin();
        assertEquals(300, left(c), "the PIN: told");
    }
}
