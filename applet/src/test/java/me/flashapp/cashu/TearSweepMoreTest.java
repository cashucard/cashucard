package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import me.flashapp.cashu.TearSweepTest.Card;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/**
 * More of the tear sweep (TearSweepTest.sweep: the act torn after every persistent write, a chip's transactions, NonAtomic
 * halves; the power cut; the card read and checked) over 3.0's later commands and states: SPEND_ALL_AGAIN by the message's
 * hash after a torn payment and another (D194, D196), the ring of kept signatures going round, the forgotten PIN, the first
 * set-up, the PIN's wait at its cap, the sealed PIN on a card with no owner, LOAD_CHANGE giving the day back (D196), a batch at
 * the day's loads, the mend's move, and a reset by the PIN (D196).
 */
class TearSweepMoreTest {

    @AfterAll
    static void report() { TearSweepTest.report(); }

    static final byte[] OUT_A = output(1000, b33(11)), OUT_B = output(500, b33(22));

    static byte[] b33(int seed) {
        byte[] b = new byte[33];
        b[0] = 0x02;
        for (int i = 1; i < 33; i++) b[i] = (byte) (seed + i);
        return b;
    }

    static byte[] key(Card c) { return c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }

    static ResponseAPDU again(Card c, byte[] hash) { return c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, hash, 64)); }

    static ResponseAPDU payOne(Card c, int place, byte[] out) {
        ResponseAPDU b = c.send(CashuAppletTest.spendBegin(new byte[] { (byte) place }));
        if (b.getSW() != SW_OK) return b;
        ResponseAPDU o = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out));
        if (o.getSW() != SW_OK) return o;
        return signThrough(c::send);
    }

    static void tap(Card c) {
        c.sim.reset();
        c.select();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        TearHook.refresh();
    }

    static final byte[][] HASH = new byte[2][];

    // ---- 1. SPEND_ALL_AGAIN by the message's hash (D194): a payment torn after its commit, then another payment ----

    @Test
    void againByHashAfterATornPaymentAndAnother() throws Exception {
        sweep("PAYMENT torn, then another payment, then SPEND_ALL_AGAIN P1=1 for the first", c -> {
                readyWithTwo(c, 0);
                HASH[0] = DateKeys.of(c.applet).hash(new byte[][] { c.send(new CommandAPDU(CLA, INS_GET_PROOF, 0, 0, 256)).getData() },
                    new byte[][] { OUT_A });
                HASH[1] = DateKeys.of(c.applet).hash(new byte[][] { c.send(new CommandAPDU(CLA, INS_GET_PROOF, 1, 0, 256)).getData() },
                    new byte[][] { OUT_B });
            },
            c -> assertEquals(64, payOne(c, 0, OUT_A).getData().length),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (c.status(0) != 2) return;   // nothing burned: the till pays again, as the base sweep checks
                DateKeys k = DateKeys.of(c.applet);
                ResponseAPDU now = again(c, HASH[0]);
                // the holder walks to the next till before the first asks again
                assertEquals(64, payOne(c, 1, OUT_B).getData().length, "the second payment");
                tap(c);
                ResponseAPDU later = again(c, HASH[0]);
                boolean good = later.getSW() == SW_OK && k.verifies(0, HASH[0], later.getData());
                if (!good) c.wrong(String.format("payment 1 burned its piece; after payment 2, AGAIN P1=1 for it answers %04X (right after the tear it answered %04X; P1=0 now gives payment 2's): its signature is gone",
                    later.getSW(), now.getSW()));
            });
    }

    // ---- 2. the forgotten PIN: three wrong tries in a row on an empty card with no owner, then SET_PIN (D195 3b) ----

    static void threeWrong(Card c) {
        readyNoOwner(c);
        assertEquals(0x63C1, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)).getSW());
        assertEquals(0x63C2, throughTheWait(c, WRONG_PIN).getSW());
        assertEquals(0x63C3, throughTheWait(c, WRONG_PIN).getSW());
        TearHook.refresh();
    }

    @Test
    void forgottenPin() throws Exception {
        sweep("SET_PIN replacing a forgotten PIN (three wrong in a row, empty card, no owner)", TearSweepMoreTest::threeWrong,
            c -> assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN))),
            c -> {
                int[] m = marks(c);
                if (c.f("pinMarks")[3] != 0) c.wrong("the first set-up mark is " + c.f("pinMarks")[3] + " after a power cut");
                if (!(m[0] == 3 && m[1] == 4) && !(m[0] == 0 && m[1] == 0)) c.wrong("marks " + m[0] + "/" + m[1]);
                if (m[0] == 3) {
                    int s = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN));
                    if (s != SW_OK) c.wrong(String.format("the old PIN's marks left; SET_PIN again answers %04X", s));
                }
                // and the history went with the old PIN: the last signature and the last packet among it (D196)
                if (m[0] == 0 && (c.f("lastSig")[0] != 0 || c.f("outbox")[0] != 0)) c.wrong("a new PIN, and the last signature or packet still kept");
                int v = throughTheWait(c, NEW_PIN).getSW();
                if (v != SW_OK) c.wrong(String.format("the new PIN answers %04X", v));
                if (c.f("pinState")[0] != 1) c.wrong("pinState " + c.f("pinState")[0]);
            });
    }

    // ---- 3. the first set-up (D196) ----

    static final byte[] LOOSE18 = concat(u32(10_000), u32(5_000), u32(1_000), new byte[] { 7 }, u32(0), new byte[] { 0 });
    static final byte[] TIGHT18 = concat(u32(8_000), u32(4_000), u32(500), new byte[] { 5 }, u32(0), new byte[] { 0 });

    static void firstSetUpWithLimits(Card c) {
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(setTimeCommand(T0)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, LOOSE18)).getSW());
        c.sim.reset(); c.select();
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        TearHook.refresh();
    }

    static long[] limits(Card c) {
        byte[] r = c.f("cardRecord");
        return new long[] { readUint32(r, CashuApplet.CARD_LIMIT_OFFSET), readUint32(r, CashuApplet.CARD_TAP_LIMIT_OFFSET),
            readUint32(r, CashuApplet.CARD_NOPIN_LIMIT_OFFSET), r[CashuApplet.CARD_BUDGET_OFFSET] };
    }

    // ---- 4. the first set-up byte: SET_PIN and a loose SET_LIMIT_PIN in one selection, torn anywhere ----

    @Test
    void firstSetUpTorn() throws Exception {
        sweep("first set-up: SET_PIN, VERIFY, SET_CARD, SET_LIMIT_PIN 18 bytes in one selection", c -> { },
            c -> {
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
                assertEquals(SW_OK, c.sw(setCardOpenCommand(record(MINT, REFUND))));
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, LOOSE18)));
            },
            c -> {
                if (c.f("pinMarks")[3] != 0) c.wrong("after the power cut the first set-up mark is still " + c.f("pinMarks")[3]);
                if (c.f("pinState")[0] == 0) return;
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                long[] l = limits(c);
                // after the cut the first set-up is over: no number by the PIN, whatever was set (D196)
                int sw = c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(0), u32(0), u32(2_000))));
                if (sw == SW_OK) c.wrong("after the cut the PIN alone set the limits, which were " + Arrays.toString(l));
            });
    }

    // ---- 5. the PIN's wait at its cap ----

    @Test
    void verifyAtTheCap() throws Exception {
        sweep("VERIFY_PIN wrong, the fifteenth in a row (owed 16,384 after)", c -> {
                readyNoOwner(c);
                byte[] m = c.f("pinMarks");
                m[0] = 14; m[1] = 0; m[2] = 0;
            },
            c -> assertEquals(0x63CF, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)).getSW()),
            c -> {
                int[] m = marks(c);
                if (!(m[0] == 14 && m[1] == 0) && !(m[0] == 15 && m[1] == 16384)) c.wrong("marks " + m[0] + "/" + m[1]);
                if (c.f("pinState")[0] != 1) c.wrong("pinState " + c.f("pinState")[0]);
                // the wait served by hand, then the right PIN
                byte[] mk = c.f("pinMarks"); mk[1] = 0; mk[2] = 0;
                int sw = c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW();
                if (sw != SW_OK) c.wrong(String.format("the right PIN answers %04X", sw));
            });
    }

    // ---- 6. a sealed VERIFY_PIN on a card with no owner: one that opens to a wrong PIN, and one that does not open ----

    static byte[] envelopeFor(Card c, byte[] pin, String spoil) {
        ResponseAPDU k = c.raw(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_OK, k.getSW());
        byte[] nonce = Arrays.copyOfRange(k.getData(), 0, 16), pk = Arrays.copyOfRange(k.getData(), 16, 49);
        return spoiled(envelope(EPH[0], pk, nonce, INS_VERIFY_PIN & 0xFF, pinBlock(pin)), spoil);
    }

    @Test
    void sealedVerifyNoOwner() throws Exception {
        for (String spoil : new String[] { "", "tag" }) {
            sweep("VERIFY_PIN sealed, " + (spoil.isEmpty() ? "a wrong PIN" : "an envelope that does not open") + ", card with no owner",
                TearSweepMoreTest::readyNoOwnerTapped,
                c -> {
                    byte[] env = envelopeFor(c, WRONG_PIN, spoil);
                    assertEquals(0x63C1, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, env)).getSW());
                },
                c -> pinWaitHolds(c, new int[][] { { 0, 0 }, { 1, 1 } }));
        }
    }

    static void readyNoOwnerTapped(Card c) { readyNoOwner(c); }

    // ---- 7. LOAD_CHANGE on a card with a day's limit: the count of loads and the day given back ----

    @Test
    void loadChangeGivesTheDayBack() throws Exception {
        final byte[][] ans = new byte[1][];
        sweep("LOAD_CHANGE on a card with a day's limit (load count, day given back)", c -> {
                readyWithTwo(c, 100_000);
                assertEquals(64, pay(c).getData().length);
                tap(c);
                shownByHand(c.f("openKeys"), 0);
                assertEquals(1500, readUint32(c.f("cardRecord"), CashuApplet.CARD_SPENT_OFFSET), "the day counts the pieces whole");
                ans[0] = answerFor(c);
            },
            c -> assertEquals(SW_OK, c.send(loadChangeCommand(0, ans[0])).getSW()),
            c -> {
                long b = c.balance(), spent = readUint32(c.f("cardRecord"), CashuApplet.CARD_SPENT_OFFSET);
                int loads = loadsOf(c);
                if (b == 500 && loads != 3) c.wrong("the change on the card and loads " + loads);
                if (b == 500 && spent != 1000) c.wrong("the change is back on the card and the day still counts " + spent + " (not given back)");
                if (b == 0 && spent != 1500) c.wrong("no change on the card and the day counts " + spent);
                shownByHand(c.f("openKeys"), 0);
                int sw = c.send(loadChangeCommand(0, ans[0])).getSW();
                long spentAfter = readUint32(c.f("cardRecord"), CashuApplet.CARD_SPENT_OFFSET);
                if (c.balance() != 500) c.wrong(String.format("LOAD_CHANGE again %04X, balance %d", sw, c.balance()));
                if (spentAfter != 1000) c.wrong(String.format("after LOAD_CHANGE again (%04X) the day counts %d: the change's 500 never given back", sw, spentAfter));
            });
    }

    // ---- 8. a batch of three at the day's cap: 298 loaded, the third refused ----

    @Test
    void loadBatchAtTheCap() throws Exception {
        byte[] p3 = buildProof("0059534ce0bfa19a", 250, 3);
        byte[] three = concat(PROOF_1, PROOF_2, p3);
        sweep("LOAD_PROOF x3 with 298 loaded today", c -> {
                ready(c, 0);
                byte[] m = c.f("pinMarks");
                System.arraycopy(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET, m, 4, 4);
                m[8] = 0x01; m[9] = 0x2A;   // 298
            },
            c -> c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, three, 0, three.length, 3)),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                int loads = loadsOf(c);
                int on = 0;
                for (int i = 0; i < 128; i++) if (c.status(i) == 1) on++;
                if (loads > 300) c.wrong("loads " + loads);
                if (on > loads - 298) c.wrong(on + " pieces on, " + (loads - 298) + " counted");
                int sw3 = loadP(c, p3).getSW();
                if (sw3 == SW_OK && loadsOf(c) > 300) c.wrong("a piece past 300");
            });
    }

    // ---- 9. the mend's move: KEYSET_KEYS P1=3 with another key AND another keyset (D194) ----

    static final byte[] KS2 = hexToBytes("00aabbccddeeff01");
    static final BigInteger OTHER_PRIV = BigInteger.valueOf(0xBEEFL);

    static void secondKeyset(Card c) {
        readyOwed(c);
        byte[] book = c.f("book"), open = c.f("changeOpen");
        int free = -1;
        for (int i = 0; i < 6; i++) if ((book[i * 41 + 8] & 0x40) == 0) { free = i; break; }
        assertTrue(free >= 0);
        System.arraycopy(KS2, 0, book, free * 41, 8);
        byte[] leaf = sha256(concat(new byte[] { 0 }, new byte[4], Arrays.copyOfRange(open, 0, 4), OTHER_K));
        System.arraycopy(leaf, 0, book, free * 41 + 9, 32);
        book[free * 41 + 8] = (byte) (0x40 | 0x02);
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0]))));
        TearHook.refresh();
    }

    @Test
    void mendMoves() throws Exception {
        sweep("KEYSET_KEYS P1=3 another key and another keyset (the mend's move)", TearSweepMoreTest::secondKeyset,
            c -> assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, 0x38, 3, 0, concat(new byte[] { 0, 0, 0 }, OTHER_K, KS2)))),
            c -> {
                byte[] ok = c.f("openKeys"), open = c.f("changeOpen");
                byte[] k = Arrays.copyOfRange(ok, 33, 66), ks = Arrays.copyOfRange(open, 4, 12);
                boolean was = Arrays.equals(k, mintKey()) && Arrays.equals(ks, hexToBytes(KEYSET));
                boolean moved = Arrays.equals(k, OTHER_K) && Arrays.equals(ks, KS2);
                if (!was && !moved) c.wrong("the opening is half moved: key " + toHex(k) + " keyset " + toHex(ks));
                if (ok[66] != 1) c.wrong("the shown mark is " + ok[66]);
                if (c.f("openState")[0] != 2) c.wrong("opening state " + c.f("openState")[0]);
                if (moved) {
                    byte[] b = Arrays.copyOfRange(ok, 0, 33);
                    int sw = c.send(loadChangeCommand(0, mintAnswer(OTHER_PRIV, b, BigInteger.valueOf(99)))).getSW();
                    if (sw != SW_OK) c.wrong(String.format("moved, and LOAD_CHANGE under the new key answers %04X", sw));
                    else if (!Arrays.equals(Arrays.copyOfRange(c.f("proofStorage"), 1, 9), KS2) && c.status(0) != 1) {
                        // the change goes in the first free place: find it
                    }
                }
            });
    }

    // ---- 10. the ring of receipts going round: payment 17 replaces receipt 1 and its kept signature ----

    @Test
    void againWhenTheRingGoesRound() throws Exception {
        final byte[][] sig1 = new byte[1][];
        sweep("PAYMENT whose receipt replaces the oldest of 16 (kept signatures)", c -> {
                readyWithTwo(c, 0);
                HASH[0] = DateKeys.of(c.applet).hash(new byte[][] { c.send(new CommandAPDU(CLA, INS_GET_PROOF, 0, 0, 256)).getData() },
                    new byte[][] { OUT_A });
                HASH[1] = DateKeys.of(c.applet).hash(new byte[][] { c.send(new CommandAPDU(CLA, INS_GET_PROOF, 1, 0, 256)).getData() },
                    new byte[][] { OUT_B });
                sig1[0] = payOne(c, 0, OUT_A).getData();
                assertEquals(64, sig1[0].length);
                // fifteen payments more, as the count says: the next receipt is the first one's place
                c.f("cardReceipts")[3] = 16;
                tap(c);
            },
            c -> assertEquals(64, payOne(c, 1, OUT_B).getData().length),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                DateKeys k = DateKeys.of(c.applet);
                ResponseAPDU a1 = again(c, HASH[0]), a2 = again(c, HASH[1]);
                if (a1.getSW() == SW_OK && !Arrays.equals(a1.getData(), sig1[0])) c.wrong("AGAIN for payment 1 gives another signature");
                if (a2.getSW() == SW_OK && !k.verifies(0, HASH[1], a2.getData())) c.wrong("AGAIN for payment 2 gives a signature that is not over its message");
                if (a1.getSW() == SW_OK && a2.getSW() == SW_OK) c.wrong("both kept: the ring holds 16");
                boolean burned = c.status(1) == 2;
                ResponseAPDU last = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64));
                if (burned && a2.getSW() != SW_OK) {
                    boolean lastIs2 = last.getSW() == SW_OK && k.verifies(0, HASH[1], last.getData());
                    c.wrong(String.format("payment 2 burned; P1=1 for it %04X (P1=0 gives it: %s), and payment 1's P1=1 %04X", a2.getSW(), lastIs2, a1.getSW()));
                }
            });
    }

    // ---- 11. the claim on an emptied card (D195): a card that paid out everything ----

    // ---- 11. a reset by the PIN of an empty card with no owner (D196) ----

    static int resetByPin(Card c) {
        ResponseAPDU r;
        int n = 0;
        while ((r = c.raw(new CommandAPDU(CLA, INS_RESET_CARD, 0, 0xAD))).getSW() == SW_KEEP_HOLDING && n++ < 100) { }
        return r.getSW();
    }

    static void emptiedAndHeld(Card c) {
        readyNoOwner(c);
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, loadP(c, PROOF_1).getSW());
        tap(c);
        assertEquals(64, payOne(c, 0, OUT_A).getData().length);
        tap(c);
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_GET_LOG, 0, 0, 256)).getSW());
        TearHook.refresh();
    }

    @Test
    void resetByThePin() throws Exception {
        sweep("RESET_CARD by the PIN, held for, on an emptied card with no owner", TearSweepMoreTest::emptiedAndHeld,
            c -> assertEquals(SW_OK, resetByPin(c)),
            c -> {
                if (c.f("ownerSet")[0] != 0) c.wrong("an owner");
                if (c.f("pinState")[0] == 0) {
                    // a new card: set up again, a first set-up
                    int s = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN));
                    if (s != SW_OK || c.f("pinMarks")[3] != 1) c.wrong(String.format("reset, and SET_PIN %04X opens a first set-up %d", s, c.f("pinMarks")[3]));
                    return;
                }
                // the old card still: reset again, as the holder does
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                int h = c.send(new CommandAPDU(CLA, INS_GET_LOG, 0, 0, 256)).getSW();
                int again = resetByPin(c);
                if (h != SW_OK || again != SW_OK) c.wrong(String.format("not reset, and again: history %04X, reset %04X", h, again));
                if (c.f("pinState")[0] != 0) c.wrong("reset again, and still a PIN");
            });
    }
}
