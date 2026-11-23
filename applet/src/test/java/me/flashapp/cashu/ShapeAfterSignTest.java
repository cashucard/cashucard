package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import static org.junit.jupiter.api.Assertions.*;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import me.flashapp.cashu.TearSweepTest.Card;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D225, from the red team of 2026-11-19, round two (R1, RT23R2WaitTest at 6864627). D224's 6AA0 was asked only at the first
 * SPEND_ALL_SIGN: while the payment waited (a second payment in the tap, or one over the limit on one payment) the card still
 * took SPEND_ALL_CHANGE, and SPEND_ALL_OUTPUTS before any change, so a till passed the check and then added a seventeenth output,
 * or the card's change to a payment of 33 pieces, and the card signed with change owed and no settlement record. Now the shape
 * the first SIGN checked is the shape signed: OUTPUTS and CHANGE after it give the payment up (6985), and the SIGN that signs
 * after a wait asks D224's check again.
 */
class ShapeAfterSignTest {

    static final CommandAPDU SCOPE = new CommandAPDU(CLA, 0x1B, 0, 0, 256);
    static final CommandAPDU SIGN = new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64);
    static final int CONDITIONS = 0x6985;

    @AfterEach
    void noLimit() { TearHook.fullAt = null; TearHook.tearAfterCommit = null; }

    static Card cardWith(int pieces, long each) throws Exception {
        Card c = new Card();
        ready(c, 0);
        for (int i = 0; i < pieces; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, each, 100 + i)).getSW(), "load " + i);
        c.powerCycle();
        assertEquals(SW_OK, c.sw(TransactionSizeTest.VERIFY));
        TearHook.refresh();
        return c;
    }

    static byte[] ones(int n) { byte[] o = new byte[0]; for (int k = 0; k < n; k++) o = concat(o, output(1, mintKey())); return o; }

    /** Payment 1 of the tap (place 0, one output, no change): makes the next one wait. */
    static void firstPayment(Card c) {
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(1))).getSW());
        assertEquals(64, signThrough(c::send).getData().length, "payment 1 signed");
    }

    static int owed(Card c) {
        int owed = 0;
        for (int k = 0; k < CashuApplet.CHANGE_MOST; k++) if (c.f("openState")[k] == CashuApplet.OPEN_PENDING) owed++;
        return owed;
    }

    /** Places from..to-1 unspent, no opening owed, and the payment given up. */
    static void nothingSigned(Card c, int from, int to) {
        for (int i = from; i < to; i++) assertEquals(CashuApplet.STATUS_UNSPENT, c.status(i), "place " + i + " not burned");
        assertEquals(0, owed(c), "no opening owed");
        assertEquals(CONDITIONS, c.sw(SIGN), "the payment is given up");
    }

    @Test
    @DisplayName("D225 (red team R1): the card's change added while a payment waits, a seventeenth output after D224's check, gives the payment up 6985; nothing signed, nothing owed")
    void changeDuringTheWait() throws Exception {
        Card c = cardWith(4, 100);
        firstPayment(c);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1, 2 })).getSW());
        for (int at = 0; at < 15; at += 5) assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(5))).getSW());
        assertEquals(SW_OK, c.send(changeCommand(1, mintKey())).getSW());
        ResponseAPDU w = c.send(SIGN);
        assertEquals(2, w.getData().length, "the payment waits");
        assertEquals(CONDITIONS, c.send(changeCommand(1, mintKey())).getSW(), "no change once the first SIGN was asked");
        nothingSigned(c, 1, 3);
    }

    @Test
    @DisplayName("D225 (red team R1): 33 pieces with no change pass the first SIGN; the card's change added in the wait gives the payment up 6985")
    void thirtyThreePiecesChangeDuringTheWait() throws Exception {
        Card c = cardWith(34, 10);
        firstPayment(c);
        byte[] places = new byte[33];
        for (int i = 0; i < 33; i++) places[i] = (byte)(i + 1);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(places)).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(1))).getSW());
        assertEquals(2, c.send(SIGN).getData().length, "the payment waits");
        assertEquals(CONDITIONS, c.send(changeCommand(1, mintKey())).getSW(), "the card's change, after the check: refused");
        nothingSigned(c, 1, 34);
    }

    @Test
    @DisplayName("D225: an output added while a payment waits gives the payment up 6985, with or without change before it")
    void outputsDuringTheWait() throws Exception {
        Card c = cardWith(4, 100);
        firstPayment(c);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1, 2 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(5))).getSW());
        assertEquals(2, c.send(SIGN).getData().length, "the payment waits");
        assertEquals(CONDITIONS, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(1))).getSW(), "no output after the first SIGN");
        nothingSigned(c, 1, 3);
    }

    @Test
    @DisplayName("D225, the honest path: a second payment in the tap with the card's change waits and is signed with what it named before its first SIGN, its change owed and its record written")
    void aWaitingPaymentWithChangeCompletes() throws Exception {
        Card c = cardWith(4, 100);
        firstPayment(c);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1, 2 })).getSW());
        for (int at = 0; at < 15; at += 5) assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(5))).getSW());
        assertEquals(SW_OK, c.send(changeCommand(1, mintKey())).getSW());
        assertEquals(2, c.send(SIGN).getData().length, "the payment waits");
        ResponseAPDU s = signThrough(c::send);
        assertEquals(SW_OK, s.getSW());
        assertEquals(64, s.getData().length, "signed after the wait");
        assertEquals(1, owed(c), "its change owed");
        assertEquals(SW_OK, c.raw(SCOPE).getSW(), "and its settlement record written");
        assertEquals(CashuApplet.STATUS_UNSPENT, c.status(3), "the place it did not name untouched");
    }

    @Test
    @DisplayName("D225, the honest path: a second payment in the tap with no change waits and is signed")
    void aWaitingPaymentWithoutChangeCompletes() throws Exception {
        Card c = cardWith(4, 100);
        firstPayment(c);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(3))).getSW());
        assertEquals(2, c.send(SIGN).getData().length, "the payment waits");
        assertEquals(64, signThrough(c::send).getData().length, "signed after the wait");
    }

    @Test
    @DisplayName("D225, the second line: a shape no record can hold, found at the SIGN that signs after a wait, is refused 6AA0 with nothing signed")
    void theSigningSignAsksAgain() throws Exception {
        Card c = cardWith(4, 100);
        firstPayment(c);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1, 2 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ones(2))).getSW());
        assertEquals(SW_OK, c.send(changeCommand(1, mintKey())).getSW());
        assertEquals(2, c.send(SIGN).getData().length, "the payment waits");
        c.f("outStage")[0] = (byte) 0xFF;          // as if the staged outputs had been marked not recordable in the wait
        assertEquals(0x6AA0, signThrough(c::send).getSW(), "refused at the signing SIGN");
        nothingSigned(c, 1, 3);
    }
}
