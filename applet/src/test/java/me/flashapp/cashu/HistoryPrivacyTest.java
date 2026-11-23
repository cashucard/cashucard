package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_INFO;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_PROOF;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_OUTPUTS;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_EMPTY;
import static me.flashapp.cashu.CashuAppletTest.blinded;
import static me.flashapp.cashu.CashuAppletTest.output;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.readUint32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the card tells a reader that has given neither the PIN nor the owner's grant in its tap (3.0): no history. GET_OUTBOX's
 * packet goes only to the reader in the time in the field that signed the payment, or with the holder's say; GET_PROOF
 * answers a spent place as an empty one; GET_INFO says zeros for the day's window, what the day signed for, the last
 * payment's unit and the no-PIN window's start, and the counts of places as they are (D196).
 */
class HistoryPrivacyTest {

    static final byte INS_GET_OUTBOX = (byte) 0x1B;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static ResponseAPDU page(UnitsTest.Card c) {
        return c.send(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, new byte[] { 0, 0, (byte) 0xFF }, 256));
    }

    /** A till's payment of `place`, one output of `amount`. */
    static void tillPays(UnitsTest.Card c, int place, long amount, int seed) {
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(amount, blinded(seed)))));
        assertEquals(64, c.sign().getData().length);
    }

    @Test
    @DisplayName("GET_OUTBOX P1 = 1 (the packet) answers the reader in the time in the field that signed the payment and the holder's say (the grant, or a held tap); to a stranger it is 6982; P1 = 0 (the scope) as the packet, and to a reader with the PIN")
    void thePacketIsTheTillsAndTheHolders() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        int a = c.put(-1, UnitsTest.SAT_A, 64);
        c.tap();
        tillPays(c, a, 64, 11);
        assertEquals(SW_OK, page(c).getSW(), "the till that took the payment, in its time in the field");
        byte[] packet = page(c).getData();
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, page(c).getSW(), "a stranger: 6982");
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(scope()), "the scope, to a stranger: 6982");
        c.pin();
        assertEquals(SW_SECURITY_NOT_SATIS, page(c).getSW(), "the PIN alone, in another time in the field: 6982");
        assertEquals(SW_OK, c.sw(scope()), "the scope, to a reader with the PIN");
        // the holder's say on a card with no owner: the PIN in a held tap
        assertEquals(SW_OK, c.log(0).getSW(), "the history held for");
        assertArrayEquals(packet, page(c).getData(), "the holder reads it");
        // and on an owned card the owner's grant
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        int b = o.put(-1, UnitsTest.SAT_A, 32);
        o.tap();
        tillPays(o, b, 32, 12);
        assertEquals(SW_OK, o.sw(scope()), "the scope, to the till that took the payment");
        o.power();
        assertEquals(SW_SECURITY_NOT_SATIS, page(o).getSW());
        assertEquals(SW_SECURITY_NOT_SATIS, o.sw(scope()));
        o.send(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0, ownerData(o.proofFor(L_LOAD, new byte[0]), new byte[0])));
        assertEquals(SW_OK, page(o).getSW(), "the owner's grant");
        assertEquals(SW_OK, o.sw(scope()), "and the scope");
    }

    static CommandAPDU scope() { return new CommandAPDU(CLA, INS_GET_OUTBOX, 0, 0, 256); }

    static final byte INS_GET_PIECES = (byte) 0x17;

    /** GET_PIECES P2 = 0 from place 0: the places it names (0x80 marks a spent one), read from its entries. */
    static java.util.List<Integer> listed(UnitsTest.Card c) {
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_PIECES, 0, 0, 256));
        assertEquals(SW_OK, r.getSW());
        byte[] d = r.getData();
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (int at = 1; at < d.length; ) {
            int tag = d[at++] & 0xFF;
            out.add(tag);
            if ((tag & 0x80) == 0) at += 81;
        }
        return out;
    }

    /** A card with a place paid by the holder and one unspent: {spent, unspent}. */
    static int[] onePaid(UnitsTest.Card c) {
        int a = c.put(-1, UnitsTest.SAT_A, 64);
        int b = c.put(-1, UnitsTest.SAT_A, 32);
        c.tap();
        assertEquals(64, c.pay(a).getData().length);
        return new int[] { a, b };
    }

    @Test
    @DisplayName("GET_PIECES P2 = 0 lists a spent place only to a reader with the PIN or the grant; to anyone else it is not listed, and the unspent places are")
    void theListingNamesNoSpentPlaceToAStranger() {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int[] p = onePaid(c);
        assertEquals(java.util.Arrays.asList(p[0] | 0x80, p[1]), listed(c), "with the PIN: the spent place and the unspent one");
        c.power();
        assertEquals(java.util.Arrays.asList(p[1]), listed(c), "a stranger: the unspent one only");
        c.grant();
        assertEquals(java.util.Arrays.asList(p[0] | 0x80, p[1]), listed(c), "with the grant: both");
    }

    @Test
    @DisplayName("GET_PIECES P2 = 2 answers a spent place as an empty one (82 zeros) to a reader with neither the PIN nor the grant; with either, whole; an unspent place to anyone")
    void aSpentPlaceIsEmptyInTheBatch() {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int[] p = onePaid(c);
        byte[] whole = c.slot(p[0]);
        CommandAPDU some = new CommandAPDU(CLA, INS_GET_PIECES, 0, 2, new byte[] { (byte) p[0], (byte) p[1] }, 256);
        byte[] told = c.send(some).getData();
        assertArrayEquals(whole, Arrays.copyOfRange(told, 0, 82), "with the PIN: the spent place whole");
        c.power();
        ResponseAPDU r = c.send(some);
        assertEquals(SW_OK, r.getSW());
        assertEquals(164, r.getData().length, "the same length");
        assertArrayEquals(new byte[82], Arrays.copyOfRange(r.getData(), 0, 82), "a stranger: the spent place as an empty one");
        assertArrayEquals(Arrays.copyOfRange(told, 82, 164), Arrays.copyOfRange(r.getData(), 82, 164), "the unspent place whole, to anyone");
        c.grant();
        assertArrayEquals(told, c.send(some).getData(), "with the grant: as the card holds them");
    }

    @Test
    @DisplayName("GET_CARD to a reader with neither the PIN nor the grant: zeros for the last header's hash and the rolls (44..76), the arming (78) and the no-PIN window's start (83..86); the hardest header's bits and the budget as they are; to a reader with either, as the card holds them")
    void getCardTellsAStrangerNoHistory() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] rec = c.record();
        for (int i = 0; i < 65; i++) rec[CashuApplet.CARD_BITS_OFFSET + i] = (byte) (0x11 + i);
        byte[] told = c.getCard(0);
        byte[] expect = Arrays.copyOfRange(rec, CashuApplet.CARD_BITS_OFFSET, CashuApplet.CARD_BITS_OFFSET + 65);
        Arrays.fill(expect, 39, 43, (byte) 0);
        expect[CashuApplet.CARD_CLOCK_WEAK_OFFSET - CashuApplet.CARD_BITS_OFFSET] = 0;
        assertArrayEquals(expect, Arrays.copyOfRange(told, 40, 105), "with the PIN: the record's times, the rate and whether the clock is weak (D201) as zeros");
        c.power();
        byte[] stranger = c.getCard(0);
        assertEquals(told.length, stranger.length, "the same length");
        assertArrayEquals(Arrays.copyOfRange(told, 0, 44), Arrays.copyOfRange(stranger, 0, 44), "the record and the hardest bits");
        assertArrayEquals(new byte[33], Arrays.copyOfRange(stranger, 44, 77), "no header hash, no rolls");
        assertEquals(told[77], stranger[77], "the budget");
        assertEquals(0, stranger[78], "no arming");
        assertArrayEquals(new byte[8], Arrays.copyOfRange(stranger, 79, 87), "the rate and the no-PIN window's start as zeros");
        assertArrayEquals(Arrays.copyOfRange(told, 87, told.length), Arrays.copyOfRange(stranger, 87, told.length), "and the rest");
        c.grant();
        byte[] granted = c.getCard(0);
        assertArrayEquals(Arrays.copyOfRange(told, 0, 78), Arrays.copyOfRange(granted, 0, 78), "with the grant: as the card holds them");
        assertEquals(1, granted[78], "the grant's proof arms the allowance, and the arming is said");
        assertArrayEquals(Arrays.copyOfRange(told, 79, told.length), Arrays.copyOfRange(granted, 79, told.length));
    }


    @Test
    @DisplayName("GET_PROOF answers a spent place as an empty one (6A88) to a reader with neither the PIN nor the grant; with either, the place as it is; an unspent place to anyone")
    void aSpentPlaceIsHistory() {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int a = c.put(-1, UnitsTest.SAT_A, 64);
        int b = c.put(-1, UnitsTest.SAT_A, 32);
        c.tap();
        assertEquals(64, c.pay(a).getData().length);
        assertEquals(2, c.slot(a)[0], "with the PIN: spent");
        c.power();
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, INS_GET_PROOF, a, 0, 256)), "a stranger: as empty");
        assertEquals(1, c.slot(b)[0], "an unspent place, to anyone");
        c.send(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0, ownerData(c.proofFor(L_LOAD, new byte[0]), new byte[0])));
        assertEquals(2, c.slot(a)[0], "with the grant: spent");
    }

    @Test
    @DisplayName("GET_INFO to a reader with neither the PIN nor the grant: the counts of places as they are (D196), and zeros for the day's window and what it signed for (21..28), the last payment's unit (50) and the no-PIN window's start (51..54); to a reader with either, as the card holds them")
    void getInfoTellsAStrangerNoHistory() {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(SW_OK, c.limits(1000, 0, 500, 7, 0), "a day and an allowance");
        int a = c.put(-1, UnitsTest.SAT_A, 64);
        c.put(-1, UnitsTest.SAT_A, 32);
        c.power();
        assertEquals(64, c.pay(a).getData().length, "paid with no PIN, under the allowance");
        c.tap();
        byte[] told = c.send(new CommandAPDU(CLA, INS_GET_INFO, 4, 0, 256)).getData();
        assertEquals(1, told[4], "with the PIN: one place spent");
        assertTrue(readUint32(told, 21) != 0 && readUint32(told, 25) == 64, "the day's window and what it signed for");
        assertEquals(0x80, told[50] & 0xFF, "the last payment's unit");
        assertTrue(readUint32(told, 51) != 0, "the no-PIN window's start");
        c.power();
        byte[] stranger = c.send(new CommandAPDU(CLA, INS_GET_INFO, 4, 0, 256)).getData();
        assertEquals(59, stranger.length);
        assertArrayEquals(new byte[2], Arrays.copyOfRange(stranger, 57, 59), "no loads left said");
        assertArrayEquals(Arrays.copyOfRange(told, 3, 6), Arrays.copyOfRange(stranger, 3, 6), "the counts of places as they are, spent among them (D196): a wallet frees spent places by them");
        assertArrayEquals(new byte[8], Arrays.copyOfRange(stranger, 21, 29), "no window, nothing signed for");
        assertEquals(0, stranger[50], "no last unit");
        assertArrayEquals(new byte[4], Arrays.copyOfRange(stranger, 51, 55), "no no-PIN window's start");
        assertArrayEquals(Arrays.copyOfRange(told, 34, 42), Arrays.copyOfRange(stranger, 34, 42), "the allowance and its count, which a till needs, as they are");
        assertEquals(told[3], stranger[3], "the unspent pieces, which a till pays with");
        assertArrayEquals(Arrays.copyOfRange(told, 12, 16), Arrays.copyOfRange(stranger, 12, 16), "and the day's limit");
    }
}
