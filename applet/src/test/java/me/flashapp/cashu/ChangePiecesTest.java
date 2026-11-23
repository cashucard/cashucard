package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.loadChange;
import static me.flashapp.cashu.KeysetKeysTest.show;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The card makes up to eight change pieces itself (D195, D183): one SPEND_ALL_CHANGE each, in one payment, as many as it has
 * openings free (CHANGE_MOST, eight); a reader that stops at four pays as before, and the rest stay free for another payment.
 */
class ChangePiecesTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static CommandAPDU change(long amount) { return changeCommand(amount, A.keyFor(amount), hexToBytes(A.id8())); }

    /** Every opening GET_CHANGE lists, page by page (three a page). */
    static List<byte[]> rows(UnitsTest.Card c) {
        List<byte[]> out = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            byte[] d = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, page, 0, 256)).getData();
            for (int i = 0; i < (d[0] & 0xFF); i++) out.add(Arrays.copyOfRange(d, 1 + 83 * i, 1 + 83 * (i + 1)));
        }
        return out;
    }

    @Test
    @DisplayName("Eight change pieces in one payment, each its own SPEND_ALL_CHANGE (1, 2, 4 ... 128 of a piece of 512): signed; GET_CHANGE lists eight over three pages; each shown and written back by LOAD_CHANGE, 255 on the card; a ninth in the same payment is 6A84 and gives the payment up")
    void eightPiecesInOnePayment() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int place = c.put(-1, A.id8(), 512);
        taught(c, A);
        assertEquals(SW_OK, c.begin(place).getSW());
        for (int i = 0; i < 8; i++) {
            ResponseAPDU r = c.send(change(1L << i));
            assertEquals(SW_OK, r.getSW(), "change piece " + (i + 1));
            assertEquals(33, r.getData().length);
        }
        assertEquals(64, c.sign().getData().length, "one signature for the payment and its eight pieces of change");
        List<byte[]> owed = rows(c);
        assertEquals(8, owed.size(), "eight openings owed");
        c.power();
        for (byte[] row : owed) {
            long amount = readUint32(row, 1);
            assertEquals(SW_OK, show(c, row[0], A, amount));
            assertEquals(SW_OK, loadChange(c, row, A.privFor(amount)).getSW(), "the piece of " + amount + " written back");
        }
        assertEquals(255, readUint32(c.balance(0), 0));

        // a ninth: no opening free while eight are owed
        UnitsTest.Card d = KeysetKeysTest.card();
        int p = d.put(-1, A.id8(), 1024);
        taught(d, A);
        assertEquals(SW_OK, d.begin(p).getSW());
        for (int i = 0; i < 8; i++) assertEquals(SW_OK, d.send(change(1L << i)).getSW());
        assertEquals(SW_NO_SPACE, d.send(change(256)).getSW(), "the ninth");
        assertEquals(SW_CONDITIONS_NOT_SATIS, d.sign().getSW(), "and the payment is given up");
        assertEquals(0, rows(d).size(), "nothing owed: the drafts are let go at the next BEGIN");
    }

    @Test
    @DisplayName("A reader that stops at four pays as before; with four owed, the next payment makes four more and a fifth is 6A84; each written back frees its opening")
    void fourAndFourMore() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int a = c.put(-1, A.id8(), 64), b = c.put(-1, A.id8(), 64);
        taught(c, A);
        assertEquals(SW_OK, c.begin(a).getSW());
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, c.send(change(1L << i)).getSW());
        assertEquals(64, c.sign().getData().length, "four pieces of change");
        assertEquals(4, rows(c).size());
        c.tap();
        c.grant();
        assertEquals(SW_OK, c.begin(b).getSW());
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, c.send(change(1L << i)).getSW(), "four more");
        assertEquals(SW_NO_SPACE, c.send(change(16)).getSW(), "a fifth, with eight owed");
        c.tap();
        c.grant();
        int e = c.put(-1, A.id8(), 64);
        byte[] first = rows(c).get(0);
        assertEquals(SW_OK, show(c, first[0], A, readUint32(first, 1)));
        assertEquals(SW_OK, loadChange(c, first, A.privFor(readUint32(first, 1))).getSW(), "one written back");
        c.tap();
        assertEquals(SW_OK, c.begin(e).getSW());
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, c.send(change(1L << i)).getSW(), "the second payment again");
        assertEquals(SW_OK, c.send(change(16)).getSW(), "and a fifth, in the opening freed");
        assertEquals(64, c.sign().getData().length);
    }
}
