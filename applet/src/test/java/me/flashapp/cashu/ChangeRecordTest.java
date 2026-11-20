package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import static org.junit.jupiter.api.Assertions.*;

import javax.smartcardio.CommandAPDU;
import me.flashapp.cashu.TearSweepTest.Card;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D220, from the red team of 2026-11-19 and the keeper's decision of the same day. (1) A payment that makes the card's own
 * change is refused at SIGN (6AA0, given up, nothing written or signed) in a shape that leaves no settlement record: a
 * seventeenth output, an output of nothing (the earlier review's L5), or more than 32 pieces (the red team's O1 on
 * outbox-lean, which applies here too). (2) The last payment's record is let go in the payment's own commit (red team F2,
 * RT23TearTest): a payment torn after its commit no longer leaves the one before it served as the last.
 */
class ChangeRecordTest {

    static final int NO_RECORD = 0x6AA0;
    static final CommandAPDU SCOPE = new CommandAPDU(CLA, 0x1B, 0, 0, 256);

    @AfterEach
    void noLimit() { TearHook.fullAt = null; TearHook.tearAfterCommit = null; }

    /** A card with `pieces` pieces of `each` (dated `date`, 0 for none), in a new tap with the PIN given. */
    static Card cardWith(int pieces, long each, long date) throws Exception {
        Card c = new Card();
        ready(c, 0);
        for (int i = 0; i < pieces; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, each, 100 + i, date)).getSW(), "load " + i);
        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));
        TearHook.refresh();
        return c;
    }

    /**
     * Pay places 0 .. n-1 into `tills` outputs of 1 each (one of 0 where `zero`) and `change` of the card's own change of 1
     * each: the SIGN's answer (the signature, or the refusal).
     */
    static int pay(Card c, int n, int tills, int change, boolean zero) {
        byte[] places = new byte[n];
        for (int i = 0; i < n; i++) places[i] = (byte) i;
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(places)).getSW(), "begin " + n);
        for (int at = 0; at < tills; at += 6) {
            byte[] outs = new byte[0];
            for (int k = at; k < Math.min(tills, at + 6); k++) outs = concat(outs, output(zero && k == 0 ? 0 : 1, mintKey()));
            assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, outs)).getSW(), "outputs");
        }
        for (int k = 0; k < change; k++) assertEquals(SW_OK, c.send(changeCommand(1, mintKey())).getSW(), "change " + k);
        return signThrough(c::send).getSW();
    }

    /** Nothing of a refused payment is on the card: no place spent, no opening owed, no receipt, and the payment given up. */
    static void nothingWritten(Card c, int n, long receipts) throws Exception {
        for (int i = 0; i < n; i++) assertEquals(CashuApplet.STATUS_UNSPENT, c.status(i), "place " + i + " not burned");
        for (int k = 0; k < CashuApplet.CHANGE_MOST; k++) assertNotEquals(CashuApplet.OPEN_PENDING, c.f("openState")[k], "no opening owed");
        assertEquals(receipts, readUint32(c.f("cardReceipts"), 0), "no receipt");
        assertEquals(0, c.f("burnPending")[0]);
        assertEquals(ISO7816_CONDITIONS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment is given up");
    }
    static final int ISO7816_CONDITIONS = 0x6985;

    @Test
    @DisplayName("D220: a payment with the card's change and a seventeenth output is refused 6AA0 at SIGN, nothing written or signed; sixteen are signed with their record; and with no change of the card's, seventeen are still paid, with no record, as before")
    void aSeventeenthOutputWithChange() throws Exception {
        Card c = cardWith(4, 100, 0);
        assertEquals(NO_RECORD, pay(c, 2, 16, 1, false), "16 + the card's change: 17 outputs");
        nothingWritten(c, 4, 0);
        assertEquals(SW_OK, pay(c, 2, 15, 1, false), "15 + the card's change: 16 outputs, signed");
        assertEquals(SW_OK, c.raw(SCOPE).getSW(), "and recorded");
        Card d = cardWith(2, 100, 0);
        assertEquals(SW_OK, pay(d, 1, 17, 0, false), "no change: 17 outputs paid");
        assertEquals(SW_SLOT_EMPTY, d.raw(SCOPE).getSW(), "with no record, as before");
    }

    @Test
    @DisplayName("D220: a payment with the card's change and an output of nothing (the review's L5) is refused 6AA0; with no change it is paid with no record, as before")
    void anOutputOfNothingWithChange() throws Exception {
        Card c = cardWith(3, 100, 0);
        assertEquals(NO_RECORD, pay(c, 1, 2, 1, true));
        nothingWritten(c, 3, 0);
        assertEquals(SW_OK, pay(c, 1, 2, 0, true));
        assertEquals(SW_SLOT_EMPTY, c.raw(SCOPE).getSW());
    }

    @Test
    @DisplayName("D220 (red team O1, on this branch too): 33 pieces with the card's change are refused 6AA0, nothing written or signed; 32 pieces with change are signed and recorded; 33 with no change are paid with no record, as before")
    void thirtyThreePiecesWithChange() throws Exception {
        Card c = cardWith(33, 10, 0);
        assertEquals(NO_RECORD, pay(c, 33, 1, 1, false));
        nothingWritten(c, 33, 0);
        assertEquals(SW_OK, pay(c, 33, 1, 0, false), "no change: paid");
        assertEquals(SW_SLOT_EMPTY, c.raw(SCOPE).getSW(), "with no record");
        Card d = cardWith(32, 10, 0);
        assertEquals(SW_OK, pay(d, 32, 1, 1, false));
        assertEquals(SW_OK, d.raw(SCOPE).getSW(), "32 with change: recorded");
    }

    @Test
    @DisplayName("D220: Foxy's largest real shape is never refused: 20 pieces, 12 outputs of the till and 4 of the card's change (16), undated (recorded) and dated (no record: what the card is refuses nothing)")
    void foxysLargestShape() throws Exception {
        Card c = cardWith(20, 100, 0);
        assertEquals(SW_OK, pay(c, 20, 12, 4, false));
        assertEquals(SW_OK, c.raw(SCOPE).getSW(), "recorded");
        Card d = cardWith(20, 100, T0 + 30 * DAY);
        assertEquals(SW_OK, pay(d, 20, 12, 4, false), "dated pieces with change: signed");
        assertEquals(SW_SLOT_EMPTY, d.raw(SCOPE).getSW(), "the packet has no field for a date: no record, as before");
        // and the shape Foxy must not send now: 12 of its own outputs and 8 of the card's change (20 outputs)
        Card e = cardWith(20, 100, 0);
        assertEquals(NO_RECORD, pay(e, 20, 12, 8, false), "more than 16 outputs with change: Foxy caps its outputs first");
    }

    @Test
    @DisplayName("D220 (red team F2, RT23TearTest): a payment torn right after its commit has its receipt from the next command, and no record is served as the last payment's: the record before it was let go in the commit")
    void aPaymentTornAfterItsCommitLeavesNoOldRecord() throws Exception {
        Card c = new Card();
        ready(c, 0);
        for (int i = 0; i < 3; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 81 + i)).getSW());
        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));
        TearHook.refresh();
        assertEquals(64, TransactionSizeTest.payPlace(c, 0, 1000).getData().length, "payment 1");
        long[] s1 = TransactionSizeTest.scope(c);
        assertEquals(SW_OK, s1[0]);
        assertEquals(1, s1[1], "payment 1's record");

        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));
        TearHook.refresh();
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(1000, mintKey()))).getSW());
        TearHook.tearAfterCommit = "processSpendAllSign";
        try { signThrough(c::send); } catch (Throwable torn) { }
        assertNotNull(TearHook.tornAt, "torn after the commit");
        assertEquals(1, c.f("burnPending")[0]);

        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));   // the next command finishes the burn and the receipt
        assertEquals(2, readUint32(c.f("cardReceipts"), 0), "payment 2 is committed and has its receipt");
        long[] s2 = TransactionSizeTest.scope(c);
        assertEquals(SW_SLOT_EMPTY, s2[0], "no record: payment 1's is not served as the last (it was before D220)");

        // the next payment records as ever
        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));
        TearHook.refresh();
        assertEquals(64, TransactionSizeTest.payPlace(c, 2, 1000).getData().length);
        long[] s3 = TransactionSizeTest.scope(c);
        assertEquals(SW_OK, s3[0]);
        assertEquals(3, s3[1], "payment 3's record");
    }
}
