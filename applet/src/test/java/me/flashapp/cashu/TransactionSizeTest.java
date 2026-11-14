package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import me.flashapp.cashu.TearSweepTest.Card;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Map;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The card's largest transactions, driven to their worst case under the tear harness, which counts each transaction's
 * writes, bytes, arrays and 64-byte pages (TearHook.TX_MAX); printed for the chip run, the payment's held to a bound. A
 * chip's transaction has a commit buffer of its own size and jCardSim has none, so the harness also plays a full buffer
 * (TearHook.fullAt, fullBytes): the card's answer when a transaction does not fit.
 */
class TransactionSizeTest {

    /** The worst payment's transaction may log no more writes than this, nor more bytes (2.2's worst was about 27 and 112). */
    static final int SIGN_WRITES_MOST = 20, SIGN_BYTES_MOST = 140;
    /** The worst hand-over's and the worst claim's transactions, as measured (D203) and as the chip-run checklist states them. */
    static final int HAND_OVER_WRITES = 9, HAND_OVER_BYTES = 113;
    /** The claim at its worst: 12 writes and 156 bytes with the first set-up's anchor (D204), the day of loads among them;
     * 11 and 152 before it, a no-PIN window begun with no clock among them (D203's 10 and 148 left that write out). */
    static final int CLAIM_WRITES = 12, CLAIM_BYTES = 156;

    @AfterEach
    void noLimit() { TearHook.fullAt = null; TearHook.fullOverhead = 0; TearHook.fullHit.clear(); TearHook.tearAfterCommit = null; }

    static final CommandAPDU VERIFY = new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN);
    /** A refund key whose y is odd (03): k*G for the first k that gives one. */
    static final byte[] ODD;
    static {
        byte[] o = null;
        for (int k = 2; o == null; k++) {
            byte[] p = DateKeys.comp(DateKeys.mul(BigInteger.valueOf(k), DateKeys.G));
            if (p[0] == 3) o = p;
        }
        ODD = o;
    }

    static void ownerLimit(Card c, byte[] v) {
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(ownerProof(L_LIMIT, OWNER, n, v), v))));
    }

    /** The largest transaction seen begun in `method`: { writes, bytes, arrays, pages }. */
    static int[] tx(String method) {
        int[] most = null;
        for (Map.Entry<String, int[]> e : TearHook.TX_MAX.entrySet()) {
            if (e.getKey().startsWith(method + ":") && (most == null || e.getValue()[1] > most[1])) most = e.getValue();
        }
        return most;
    }
    static void forget(String method) { TearHook.TX_MAX.keySet().removeIf(k -> k.startsWith(method + ":")); }

    static void print(String when) {
        System.out.println("===== TRANSACTIONS " + when);
        for (Map.Entry<String, int[]> e : TearHook.TX_MAX.entrySet()) {
            int[] v = e.getValue();
            System.out.println(String.format("TX %-34s writes %3d  bytes %4d  arrays %2d  pages64 %2d  %s", e.getKey(), v[0], v[1], v[2], v[3],
                TearHook.TX_MAX_WHAT.get(e.getKey())));
        }
    }

    /** The payment's transaction at its worst: a day that rolls (not the first), a no-PIN payment that begins a window and
     * takes the arming, a new tap's log entry, the paid list going round, eight openings of change, a payment that waited. */
    @Test
    @DisplayName("the worst payment's transaction: printed, and no more writes or bytes than the bound")
    void worstPayment() throws Exception {
        Card c = new Card();
        ready(c, 0);
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 90 + i)).getSW());
        // day 100,000, one payment 100 (so it waits), allowance 100,000, budget 7, no rate, the window of 24 hours
        ownerLimit(c, concat(u32(100_000), u32(100), u32(100_000), new byte[] { 7 }, u32(0), new byte[] { 0 }));
        byte[] rec = c.f("cardRecord");
        long now = readUint32(rec, CashuApplet.CARD_NOW_OFFSET);
        putUint32(rec, CashuApplet.CARD_WINDOW_OFFSET, now - 3 * 86400);
        putUint32(rec, CashuApplet.CARD_SPENT_OFFSET, 10);
        putUint32(rec, CashuApplet.CARD_NOPIN_START_OFFSET, now - 3 * 86400);
        putUint32(rec, CashuApplet.CARD_NOPIN_SPENT_OFFSET, 10);
        rec[CashuApplet.CARD_ARMED_OFFSET] = 1;
        byte[] paid = c.f("paid");
        paid[CashuApplet.PAID_NEXT] = 0x03; paid[CashuApplet.PAID_NEXT + 1] = (byte) 0xFF;   // row 1023: this payment goes round
        c.sim.reset(); c.select();                                                         // a new tap, no PIN
        TearHook.refresh();
        forget("processSpendAllSign");
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0, 1, 2 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(2000, mintKey()))).getSW());
        for (int k = 0; k < 8; k++) assertEquals(SW_OK, c.send(changeCommand(100, mintKey())).getSW(), "change " + k);
        ResponseAPDU s = signThrough(c::send);
        assertEquals(64, s.getData().length, String.format("%04X", s.getSW()));
        print("after the worst payment");
        int[] v = tx("processSpendAllSign");
        System.out.println(String.format("WORST SIGN tx: writes %d bytes %d arrays %d pages64 %d", v[0], v[1], v[2], v[3]));
        int[] r = tx("finishBurn");
        System.out.println(String.format("RECEIPT tx: writes %d bytes %d arrays %d pages64 %d", r[0], r[1], r[2], r[3]));
        assertTrue(v[0] <= SIGN_WRITES_MOST, "the worst payment's writes: " + v[0]);
        assertTrue(v[1] <= SIGN_BYTES_MOST, "the worst payment's bytes: " + v[1]);
    }

    /** SET_CARD at its worst (owner form): a new unit with a rate (five figures turned), a refund key, a mint of 77 characters, a design. */
    @Test
    @DisplayName("SET_CARD's worst transaction, printed")
    void worstSetCard() throws Exception {
        Card c = new Card();
        ready(c, 0);
        ownerLimit(c, concat(u32(100_000), u32(5_000), u32(1_000), new byte[] { 7 }, u32(100_000), new byte[] { 1 }));
        forget("processSetCard");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, worstRecord(c))));
        int[] v = tx("processSetCard");
        System.out.println(String.format("WORST SET_CARD tx: writes %d bytes %d arrays %d pages64 %d", v[0], v[1], v[2], v[3]));
        print("after the worst SET_CARD");
    }
    static byte[] worstRecord(Card c) {
        String mint = "https://" + "m".repeat(CashuApplet.CARD_MINT_MAX - 8);
        byte[] v = concat(record(mint, TearSweepMoreTest.b33(5)), "AB1".getBytes());
        v[0] = (byte) (c.f("cardRecord")[CashuApplet.CARD_UNIT_OFFSET] ^ 1);
        System.arraycopy(ODD, 0, v, 1, 33);
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        return ownerData(ownerProof(L_CARD, OWNER, n, v), v);
    }

    /** The owner's REFRESH that brings the clock back (D201), at its worst: the clock, whether it is weak, the day's window and the day of loads brought back (D203), the hardest bits, the hash and the rolls. */
    @Test
    @DisplayName("the owner's REFRESH that brings a far clock back, at its worst: its transaction printed, and held to 12 writes and 64 bytes")
    void refreshThatBringsTheClockBack() throws Exception {
        Card c = new Card();
        ready(c, 0);
        useTheTestFloor();
        try {
            byte[] rec = c.f("cardRecord");
            putUint32(rec, CashuApplet.CARD_NOW_OFFSET, 3_000_000_000L);
            putUint32(rec, CashuApplet.CARD_WINDOW_OFFSET, 3_000_000_000L);
            putUint32(c.f("pinMarks"), CashuApplet.PM_LOAD_DAY, 3_000_000_000L);
            System.arraycopy(le32(TEST_BITS), 0, rec, CashuApplet.CARD_BITS_OFFSET, 4);
            rec[CashuApplet.CARD_ROLLS_OFFSET] = 3;
            forget("processRefresh");
            byte[] v = concat(mine(T0 + 600, 0x20200000L, 0), new byte[] { 1 });
            byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0, ownerData(ownerProof(L_REFRESH, OWNER, n, v), v), 4)));
            assertEquals(T0 + 600, readUint32(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET));
            assertEquals(T0 + 600, readUint32(c.f("cardRecord"), CashuApplet.CARD_WINDOW_OFFSET));
            assertEquals(T0 + 600, readUint32(c.f("pinMarks"), CashuApplet.PM_LOAD_DAY), "the day of loads brought back with it");
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after the owner's REFRESH that brings the clock back");
        int[] t = tx("processRefresh");
        System.out.println(String.format("REFRESH BACK tx: writes %d bytes %d arrays %d pages64 %d", t[0], t[1], t[2], t[3]));
        assertTrue(t[0] <= 12 && t[1] <= 64, "the REFRESH's transaction: " + java.util.Arrays.toString(t));
    }

    /** A claim with a block header, in a first set-up. */
    @Test
    @DisplayName("a claim's transaction, printed")
    void claimWithHeader() throws Exception {
        Card c = new Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
        useTheTestFloor();
        try {
            ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0))));
            assertEquals(SW_OK, r.getSW());
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after a claim with a header");
    }

    /** A claim with a block header and the owner's c (D202), in a first set-up: the c and its count are in the claim's transaction. */
    @Test
    @DisplayName("a claim with a header and the owner's c (D202): its transaction printed, and held to 12 writes and 160 bytes")
    void claimWithHeaderAndTheOwnersC() throws Exception {
        Card c = new Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
        forget("processSetOwner");
        useTheTestFloor();
        try {
            byte[] p = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
            byte[] q = OwnerCTest.pinKeyOf(c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), p);
            byte[] s = OwnerCTest.s(OwnerCTest.WORDS, p);
            assertEquals(SW_OK, c.sw(OwnerCTest.stage(OwnerCTest.envelope(s, q, OwnerCTest.E1))));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0), OwnerCTest.check(s)))));
            assertArrayEquals(OwnerCTest.c(s, 1), java.util.Arrays.copyOf(c.f("chain"), 32));
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after a claim with a header and the owner's c");
        int[] t = tx("processSetOwner");
        System.out.println(String.format("CLAIM WITH C tx: writes %d bytes %d arrays %d pages64 %d", t[0], t[1], t[2], t[3]));
        assertTrue(t[0] <= 12 && t[1] <= 160, "the claim's transaction: " + java.util.Arrays.toString(t));
    }

    /** An owner replaced with a header and the next owner's c (D202): the worst SET_OWNER there is. */
    @Test
    @DisplayName("an owner replaced with a header and the next owner's c (D202): its transaction printed, and held to 20 writes and 160 bytes")
    void replacementWithHeaderAndTheNextOwnersC() throws Exception {
        Card c = new Card();
        ready(c, 0);
        forget("processSetOwner");
        useTheTestFloor();
        try {
            byte[] p = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
            byte[] s = OwnerCTest.s(OwnerCTest.OTHER_WORDS, p);
            byte[] answer = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
            byte[] n = java.util.Arrays.copyOf(answer, 16);
            assertEquals(SW_OK, c.sw(OwnerCTest.stage(OwnerCTest.envelope(s, OwnerCTest.pinKeyOf(answer, p), OwnerCTest.E2))));
            byte[] v = concat(OTHER_OWNER.pub, blockAt(T0 + 600), OwnerCTest.check(s));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, v), v))));
            assertArrayEquals(OwnerCTest.c(s, 1), java.util.Arrays.copyOf(c.f("chain"), 32));
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after an owner replaced with a header and the next owner's c");
        int[] t = tx("processSetOwner");
        System.out.println(String.format("HAND-OVER WITH C tx: writes %d bytes %d arrays %d pages64 %d", t[0], t[1], t[2], t[3]));
        assertTrue(t != null && t[0] <= 20 && t[1] <= 160, "the replacement's transaction: " + java.util.Arrays.toString(t));
    }

    @Test
    @DisplayName("an owner replaced with a header (the worst SET_OWNER): its transaction printed, and held to 20 writes and 160 bytes")
    void replacementWithHeader() throws Exception {
        Card c = new Card();
        ready(c, 0);
        forget("processSetOwner");
        useTheTestFloor();
        try {
            byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            byte[] v = concat(OTHER_OWNER.pub, blockAt(T0 + 600));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, v), v))));
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after an owner replaced with a header");
        int[] t = tx("processSetOwner");
        assertTrue(t != null && t[0] <= 20 && t[1] <= 160, "the replacement's transaction: " + java.util.Arrays.toString(t));
    }

    /** The hand-over's worst state (D203): a weak clock, a day's limit whose window began with no clock, an anchor harder than
     * the hardest, and the next owner's c. The anchor writes the clock, its weakness and the hardest alone: the window, the
     * hash and the rolls are the hand-over's to clear, and none of them is written in its transaction. */
    @Test
    @DisplayName("an owner replaced at its worst (a weak clock, a window begun with no clock, a harder anchor, the next owner's c): the transaction printed, held to HAND_OVER_WRITES and HAND_OVER_BYTES, and no day anchored in it")
    void replacementAtItsWorst() throws Exception {
        Card h = new Card();
        ready(h, 0);
        useTheTestFloor();
        try {
            byte[] rec = h.f("cardRecord");
            putUint32(rec, CashuApplet.CARD_NOW_OFFSET, 3_000_000_000L);
            rec[CashuApplet.CARD_CLOCK_WEAK_OFFSET] = 1;
            putUint32(rec, CashuApplet.CARD_LIMIT_OFFSET, 1000);
            putUint32(rec, CashuApplet.CARD_WINDOW_OFFSET, 0);
            System.arraycopy(le32(TEST_BITS), 0, rec, CashuApplet.CARD_BITS_OFFSET, 4);
            forget("processSetOwner");
            byte[] p = h.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
            byte[] s = OwnerCTest.s(OwnerCTest.OTHER_WORDS, p);
            byte[] answer = h.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
            byte[] n = java.util.Arrays.copyOf(answer, 16);
            assertEquals(SW_OK, h.sw(OwnerCTest.stage(OwnerCTest.envelope(s, OwnerCTest.pinKeyOf(answer, p), OwnerCTest.E2))));
            byte[] v = concat(OTHER_OWNER.pub, mine(T0 + 600, 0x20100000L, 0), OwnerCTest.check(s));
            assertEquals(SW_OK, h.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, v), v))));
            assertEquals(T0 + 600, readUint32(h.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET));
            assertEquals(0, readUint32(h.f("cardRecord"), CashuApplet.CARD_WINDOW_OFFSET), "the window cleared by the hand-over");
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after an owner replaced at its worst");
        int[] t = tx("processSetOwner");
        String what = TearHook.TX_MAX_WHAT.entrySet().stream().filter(e -> e.getKey().startsWith("processSetOwner")).map(Map.Entry::getValue).findFirst().orElse("");
        System.out.println(String.format("HAND-OVER WORST tx: writes %d bytes %d arrays %d pages64 %d  %s", t[0], t[1], t[2], t[3], what));
        assertTrue(t[0] <= HAND_OVER_WRITES && t[1] <= HAND_OVER_BYTES, "the hand-over's transaction: " + java.util.Arrays.toString(t));
        assertTrue(!what.contains("cardRecord[189") && !what.contains("cardRecord[124") && !what.contains("cardRecord[156"), "no window, hash or rolls in it: " + what);
    }

    /** The claim's worst state (D203): a weak clock kept through a reset, the holder's day's limit set in the first set-up at it
     * (its window begun with no clock), an anchor harder than the hardest, and the owner's c. */
    @Test
    @DisplayName("a claim at its worst (a weak clock, a window begun with no clock, a harder anchor, the owner's c): the transaction printed and held to CLAIM_WRITES and CLAIM_BYTES")
    void claimAtItsWorst() throws Exception {
        Card c = new Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
        useTheTestFloor();
        try {
            byte[] cr = c.f("cardRecord");
            putUint32(cr, CashuApplet.CARD_NOW_OFFSET, 3_000_000_000L);
            cr[CashuApplet.CARD_CLOCK_WEAK_OFFSET] = 1;
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(1000), u32(0)))));
            assertEquals(0, readUint32(c.f("cardRecord"), CashuApplet.CARD_WINDOW_OFFSET), "begun with no clock at a weak one");
            forget("processSetOwner");
            byte[] p = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
            byte[] q = OwnerCTest.pinKeyOf(c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), p);
            byte[] s = OwnerCTest.s(OwnerCTest.WORDS, p);
            assertEquals(SW_OK, c.sw(OwnerCTest.stage(OwnerCTest.envelope(s, q, OwnerCTest.E1))));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, mine(T0 + 600, 0x20100000L, 0), OwnerCTest.check(s)))));
            assertEquals(T0 + 600, readUint32(c.f("cardRecord"), CashuApplet.CARD_WINDOW_OFFSET), "the claim's anchor anchors the window");
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after a claim at its worst");
        int[] t = tx("processSetOwner");
        String what = TearHook.TX_MAX_WHAT.entrySet().stream().filter(e -> e.getKey().startsWith("processSetOwner")).map(Map.Entry::getValue).findFirst().orElse("");
        System.out.println(String.format("CLAIM WORST tx: writes %d bytes %d arrays %d pages64 %d  %s", t[0], t[1], t[2], t[3], what));
        assertTrue(t[0] <= CLAIM_WRITES && t[1] <= CLAIM_BYTES, "the claim's transaction: " + java.util.Arrays.toString(t));
    }

    /** The claim's worst state with the first set-up's anchor (D204): a far clock that is not weak, the day's window and the
     * day of loads begun at it (both brought back to the anchor), a no-PIN window begun with no clock, a harder anchor and the
     * owner's c. No set-up by the text reaches it (the owner's limits come after the claim, and nothing is loaded before it). */
    @Test
    @DisplayName("a claim with the first set-up's anchor at its worst (a far clock not weak, the window and the day of loads begun at it, a no-PIN window begun with no clock, a harder anchor, the owner's c): held to CLAIM_WRITES and CLAIM_BYTES")
    void claimWithTheFirstAnchorAtItsWorst() throws Exception {
        Card c = new Card();
        useTheTestFloor();
        try {
            assertEquals(SW_OK, c.sw(setHeaderCommand(FirstAnchorTest.cheap(3_000_000_000L))));
            c.sim.reset();
            c.select();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
            assertEquals(SW_OK, c.sw(VERIFY));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(1000), u32(0)))));
            assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
            byte[] cr = c.f("cardRecord");
            assertEquals(3_000_000_000L, readUint32(cr, CashuApplet.CARD_WINDOW_OFFSET), "the window begun at the far clock");
            putUint32(c.f("pinMarks"), CashuApplet.PM_LOAD_DAY, 3_000_000_000L);
            putUint32(cr, CashuApplet.CARD_NOPIN_SPENT_OFFSET, 1);
            forget("processSetOwner");
            byte[] p = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
            byte[] q = OwnerCTest.pinKeyOf(c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), p);
            byte[] s = OwnerCTest.s(OwnerCTest.WORDS, p);
            assertEquals(SW_OK, c.sw(OwnerCTest.stage(OwnerCTest.envelope(s, q, OwnerCTest.E1))));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, mine(T0 + 600, 0x20100000L, 0), OwnerCTest.check(s)))));
            assertEquals(T0 + 600, readUint32(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET), "the clock at the anchor");
            assertEquals(T0 + 600, readUint32(c.f("cardRecord"), CashuApplet.CARD_WINDOW_OFFSET), "the window brought back to it");
            assertEquals(T0 + 600, readUint32(c.f("pinMarks"), CashuApplet.PM_LOAD_DAY), "and the day of loads");
        } finally {
            useFloor(BUILT_FLOOR);
        }
        print("after a claim with the first set-up's anchor at its worst");
        int[] t = tx("processSetOwner");
        String what = TearHook.TX_MAX_WHAT.entrySet().stream().filter(e -> e.getKey().startsWith("processSetOwner")).map(Map.Entry::getValue).findFirst().orElse("");
        System.out.println(String.format("CLAIM FIRST-ANCHOR WORST tx: writes %d bytes %d arrays %d pages64 %d  %s", t[0], t[1], t[2], t[3], what));
        assertTrue(t[0] <= CLAIM_WRITES && t[1] <= CLAIM_BYTES, "the claim's transaction: " + java.util.Arrays.toString(t));
    }

    /** The payment's transaction in the cases a till meets most: with the PIN, and with no PIN under the allowance. */
    @Test
    @DisplayName("the payment's transaction in the common cases, printed")
    void typicalPayments() throws Exception {
        String[] names = { "PIN given, owned card, a day's limit, a new tap, no change",
            "PIN given, owned card, a day's limit, a new tap, one change output",
            "no PIN under the allowance, a day's limit, a new tap, the window running, no change",
            "no PIN under the allowance, a day's limit, a new tap, a new window (armed), one change output",
            "PIN given, no limits, the tap's entry already made (a second payment in the tap), no change" };
        for (int sc = 0; sc < names.length; sc++) {
            Card c = new Card();
            ready(c, 0);
            for (int i = 0; i < 4; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 90 + i)).getSW());
            if (sc != 4) ownerLimit(c, concat(u32(100_000), u32(100_000), u32(100_000), new byte[] { 7 }, u32(0), new byte[] { 0 }));
            byte[] rec = c.f("cardRecord");
            long now = readUint32(rec, CashuApplet.CARD_NOW_OFFSET);
            if (sc == 2) { putUint32(rec, CashuApplet.CARD_NOPIN_SPENT_OFFSET, 10); putUint32(rec, CashuApplet.CARD_NOPIN_START_OFFSET, now); rec[CashuApplet.CARD_ARMED_OFFSET] = 0; }
            if (sc == 3) { putUint32(rec, CashuApplet.CARD_NOPIN_SPENT_OFFSET, 10); putUint32(rec, CashuApplet.CARD_NOPIN_START_OFFSET, now - 2 * 86400); rec[CashuApplet.CARD_ARMED_OFFSET] = 1; }
            c.sim.reset(); c.select();
            if (sc == 0 || sc == 1 || sc == 4) assertEquals(SW_OK, c.sw(VERIFY));
            if (sc == 4) {
                assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 3 })).getSW());
                c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(1000, mintKey())));
                assertEquals(64, signThrough(c::send).getData().length);
            }
            TearHook.refresh();
            forget("processSpendAllSign");
            assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0, 1 })).getSW());
            boolean change = sc == 1 || sc == 3;
            assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(change ? 1500 : 2000, mintKey()))).getSW());
            if (change) assertEquals(SW_OK, c.send(changeCommand(500, mintKey())).getSW());
            ResponseAPDU s = signThrough(c::send);
            assertEquals(64, s.getData().length, names[sc] + String.format(" %04X", s.getSW()));
            int[] v = tx("processSpendAllSign");
            System.out.println(String.format("TYPICAL SIGN tx: writes %d bytes %d arrays %d pages64 %d : %s", v[0], v[1], v[2], v[3], names[sc]));
        }
    }

    // ---- a transaction that does not fit ----

    /** A card with one piece of 1000 in place 0, the PIN given in a new tap. */
    static Card onePiece() throws Exception {
        Card c = new Card();
        ready(c, 0);
        assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 61)).getSW());
        c.sim.reset(); c.select();
        assertEquals(SW_OK, c.sw(VERIFY));
        TearHook.refresh();
        return c;
    }

    @Test
    @DisplayName("a receipt that does not fit the chip's transaction: the payment stands and is answered, the card keeps working, AGAIN gives the signature, and only the receipt and its kept signature are lost")
    void aReceiptThatDoesNotFitLosesOnlyTheReceipt() throws Exception {
        Card c = onePiece();
        byte[] slot = c.send(new CommandAPDU(CLA, INS_GET_PROOF, 0, 0, 256)).getData();
        byte[] h = DateKeys.of(c.applet).hash(new byte[][] { slot }, new byte[][] { OUT_1000 });
        TearHook.fullAt = "finishBurn";
        TearHook.fullBytes = 40;
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, OUT_1000)).getSW());
        ResponseAPDU s = signThrough(c::send);
        assertEquals(SW_OK, s.getSW(), "the payment is answered");
        assertEquals(64, s.getData().length);
        assertEquals(0, c.f("burnPending")[0], "nothing owed: the card is not stuck");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256)), "the next command");
        TearHook.fullAt = null;
        c.powerCycle();
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(CashuApplet.STATUS_SPENT, c.status(0), "the piece is spent");
        assertEquals(0, c.balance());
        ResponseAPDU a = c.send(AGAIN_CMD);
        assertEquals(SW_OK, a.getSW());
        assertArrayEquals(s.getData(), a.getData(), "AGAIN P1 = 0: the signature");
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, h, 64)), "no receipt: AGAIN by its hash 6A88");
        assertEquals(0, readUint32(c.f("cardReceipts"), 0), "no receipt counted");
        // and the next payment's receipt is written as ever
        assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 500, 62)).getSW());
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 1 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(500, mintKey()))).getSW());
        assertEquals(64, signThrough(c::send).getData().length);
        assertEquals(1, readUint32(c.f("cardReceipts"), 0));
    }

    @Test
    @DisplayName("a payment committed as the card left the field, whose receipt does not fit at the next selection: SELECT answers, the card works, the signature is there again")
    void aReceiptOwedThatDoesNotFitAtTheNextSelection() throws Exception {
        Card c = onePiece();
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, OUT_1000)).getSW());
        TearHook.tearAfterCommit = "processSpendAllSign";
        try { signThrough(c::send); } catch (Throwable torn) { }
        assertEquals(1, c.f("burnPending")[0], "committed, the receipt owed");
        TearHook.fullAt = "finishBurn";
        TearHook.fullBytes = 40;
        c.powerCycle();
        assertEquals(0, c.f("burnPending")[0]);
        assertEquals(SW_OK, c.sw(VERIFY));
        TearHook.fullAt = null;
        assertEquals(CashuApplet.STATUS_SPENT, c.status(0));
        ResponseAPDU a = c.send(AGAIN_CMD);
        assertEquals(SW_OK, a.getSW());
        assertEquals(64, a.getData().length);
    }

    @Test
    @DisplayName("SET_CARD whose transaction does not fit: 6A96, and the record and c as they were")
    void aRecordThatDoesNotFit() throws Exception {
        Card c = onePiece();
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, OUT_1000)).getSW());
        assertEquals(64, signThrough(c::send).getData().length);
        byte[] rec = c.f("cardRecord").clone(), chain = c.f("chain").clone();
        byte[] v = worstRecord(c);
        TearHook.fullAt = "processSetCard";
        TearHook.fullBytes = 40;
        assertEquals(0x6A96, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, v)));
        TearHook.fullAt = null;
        // as it was, but for the arming an owner's good proof gives before the record is looked at (D186)
        rec[CashuApplet.CARD_ARMED_OFFSET] = c.f("cardRecord")[CashuApplet.CARD_ARMED_OFFSET];
        assertArrayEquals(rec, c.f("cardRecord"), "the record as it was");
        assertArrayEquals(chain, c.f("chain"), "c and the refund key's y as they were");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256)));
    }

    @Test
    @DisplayName("a payment whose transaction does not fit: 6A96, nothing burned, nothing owed")
    void aPaymentThatDoesNotFit() throws Exception {
        Card c = onePiece();
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, OUT_1000)).getSW());
        TearHook.fullAt = "processSpendAllSign";
        TearHook.fullBytes = 40;
        assertEquals(0x6A96, signThrough(c::send).getSW());
        TearHook.fullAt = null;
        assertEquals(0, c.f("burnPending")[0]);
        assertEquals(1000, c.balance());
        assertEquals(CashuApplet.STATUS_UNSPENT, c.status(0));
    }
    /** GET_OUTBOX P1 = 0, the record's scope: { SW, payment id, generation } (the id and the generation -1 with no record). */
    static long[] scope(Card c) {
        ResponseAPDU r = c.raw(new CommandAPDU(CLA, 0x1B, 0, 0, 256));
        if (r.getSW() != SW_OK) return new long[] { r.getSW(), -1, -1 };
        return new long[] { r.getSW(), readUint32(r.getData(), 5), readUint32(r.getData(), 9) };
    }

    static ResponseAPDU payPlace(Card c, int place, long amount) {
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { (byte) place })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(amount, mintKey()))).getSW());
        return signThrough(c::send);
    }

    @Test
    @DisplayName("a payment whose receipt does not fit leaves no settlement record: no packet carries another payment's id, nor id 0; the next payment's id is the next")
    void aReceiptThatDoesNotFitLeavesNoRecord() throws Exception {
        Card c = new Card();
        ready(c, 0);
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 71 + i)).getSW());
        c.powerCycle();
        assertEquals(SW_OK, c.sw(VERIFY));
        TearHook.refresh();
        // the card's first payment, its receipt given up: no record, where one would have carried the payment id 0
        TearHook.fullAt = "finishBurn";
        TearHook.fullBytes = 100;
        assertEquals(64, payPlace(c, 0, 1000).getData().length, "the payment is answered");
        TearHook.fullAt = null;
        assertEquals(SW_SLOT_EMPTY, scope(c)[0], "no record for a payment whose receipt is lost");
        // one whose receipt fits: id 1
        assertEquals(64, payPlace(c, 1, 1000).getData().length);
        long[] s1 = scope(c);
        assertEquals(SW_OK, s1[0]);
        assertEquals(1, s1[1], "the payment id is the receipt count, stepped by this payment");
        // the next, its receipt given up: no record, where one would have carried the id 1 again
        TearHook.fullAt = "finishBurn";
        TearHook.fullBytes = 100;
        assertEquals(64, payPlace(c, 2, 1000).getData().length);
        TearHook.fullAt = null;
        assertEquals(SW_SLOT_EMPTY, scope(c)[0], "no record, and not the payment before's");
        // and the one after: id 2, never one a packet had before
        assertEquals(64, payPlace(c, 3, 1000).getData().length);
        long[] s3 = scope(c);
        assertEquals(SW_OK, s3[0]);
        assertEquals(2, s3[1]);
        assertEquals(s1[2], s3[2], "the same generation");
    }

    /** A claim with a block header, in a first set-up, at the given commit buffer (bytes); the answer. */
    static int claimAt(Card c, int bytes) {
        TearHook.fullAt = "processSetOwner";
        TearHook.fullBytes = bytes;
        try {
            return c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0)))).getSW();
        } finally {
            TearHook.fullAt = null;
        }
    }

    static byte[] ownerW(Card c) throws Exception {
        java.lang.reflect.Field f = c.applet.getClass().getDeclaredField("ownerKey");
        f.setAccessible(true);
        javacard.security.ECPublicKey k = (javacard.security.ECPublicKey) f.get(c.applet);
        if (!k.isInitialized()) return null;
        byte[] w = new byte[65];
        int n = k.getW(w, (short) 0);
        return java.util.Arrays.copyOf(w, n);
    }

    @Test
    @DisplayName("a claim whose transaction does not fit: 6A96, nothing written (no owner, the clock as it was), and the claim goes through after")
    void aClaimThatDoesNotFit() throws Exception {
        Card c = new Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
        useTheTestFloor();
        try {
            byte[] rec = c.f("cardRecord").clone();
            byte[] key = ownerW(c);
            for (int bytes : new int[] { 16, 30, 60, 100 }) {
                assertEquals(0x6A96, claimAt(c, bytes), "a buffer of " + bytes + " bytes");
                assertEquals(0, c.f("ownerSet")[0], "no owner");
                // where the flag and the clock alone do not fit, the key, written last, is never reached (on a chip whose key
                // writes take no part in a transaction, nothing else would undo it)
                if (bytes <= 30) assertArrayEquals(key, ownerW(c), "the owner key as it was, at " + bytes + " bytes");
                assertArrayEquals(rec, c.f("cardRecord"), "the record and the clock as they were");
                assertEquals(1, c.f("pinMarks")[CashuApplet.PM_FIRST], "still the first set-up");
            }
            assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, blockAt(T0)))).getSW(), "claimed after");
            assertEquals(1, c.f("ownerSet")[0]);
        } finally {
            useFloor(BUILT_FLOOR);
        }
    }
}
