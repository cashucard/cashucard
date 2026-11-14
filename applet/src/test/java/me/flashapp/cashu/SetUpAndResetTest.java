package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import me.flashapp.cashu.TearSweepTest.Card;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.ArrayList;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A simple card's set-up and its way back: the reset by the PIN ends the held tap with the rest of the time in the field; a
 * forgotten PIN replaced is the new PIN and no history, or the old PIN and all of it, wherever the card is pulled away; and the
 * set-up order in which a cut leaves a card that takes nothing.
 */
class SetUpAndResetTest {

    @org.junit.jupiter.api.BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void report() { useFloor(BUILT_FLOOR); TearSweepTest.report(); }

    static final CommandAPDU VERIFY = new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN);

    @Test
    @DisplayName("the reset by the PIN clears the held tap (TAP_READ, TAP_ARMED) with the PIN: a new PIN in the same selection has no hold it did not ask for")
    void theResetEndsTheHeldTap() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(SimpleCardTest.eighteen(1000, 500, 0, 7, 0, 0));
        int p = c.put(-1, KeysetKeysTest.A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p).getData().length);
        c.power();
        c.pin();
        assertEquals(SW_OK, c.log(0).getSW(), "the history held for");
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1], "the reset by the PIN");
        assertEquals(0, c.field("tapOpen")[2] & (CashuApplet.TAP_READ | CashuApplet.TAP_ARMED), "nothing of the held tap or the arming is left");
        assertEquals(SW_OK, SimpleCardTest.raw(c, new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        // a command that wants a held tap: the let-go of an opening (none is owed) asks for the hold first
        assertEquals(SW_SECURITY_NOT_SATIS, SimpleCardTest.raw(c, new CommandAPDU(CLA, INS_RESET_CARD, 1, 0, new byte[] { 0 })),
            "no hold in this selection: 6982, not the 6A88 of an opening not owed");
    }

    /** A simple card with a payment in its history, then three wrong tries in a new tap: its PIN forgotten. */
    static final byte[][] HASH = new byte[1][];
    static void forgotten(Card c) {
        readyNoOwner(c);
        assertEquals(SW_OK, c.sw(VERIFY));
        assertEquals(SW_OK, loadP(c, PROOF_1).getSW());
        c.powerCycle();
        assertEquals(SW_OK, c.sw(VERIFY));
        byte[] slot = c.send(new CommandAPDU(CLA, INS_GET_PROOF, 0, 0, 256)).getData();
        byte[] out = output(1000, mintKey());
        HASH[0] = DateKeys.of(c.applet).hash(new byte[][] { slot }, new byte[][] { out });
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out)).getSW());
        assertEquals(64, signThrough(c::send).getData().length);
        c.powerCycle();
        assertEquals(0x63C1, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)).getSW());
        assertEquals(0x63C2, throughTheWait(c, WRONG_PIN).getSW());
        assertEquals(0x63C3, throughTheWait(c, WRONG_PIN).getSW());
        TearHook.refresh();
    }

    @Test
    @DisplayName("a forgotten PIN replaced (SET_PIN after three wrong tries), torn at every write: the new PIN and no history, or the old PIN and all of the history; never the old PIN and the history gone")
    void aForgottenPinIsReplacedWithItsHistoryOrNotAtAll() throws Exception {
        sweep("SET_PIN replacing a forgotten PIN", SetUpAndResetTest::forgotten,
            c -> c.raw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)),
            c -> {
                boolean replaced = c.f("pinMarks")[0] == 0;
                byte[] log = c.f("cardLog"), ls = c.f("lastSig"), paid = c.f("paid"), ob = c.f("outbox");
                boolean logKept = !Arrays.equals(new byte[4], Arrays.copyOf(log, 4)), sigKept = ls[0] != 0;
                boolean keptKept = !Arrays.equals(new byte[65 * 16], Arrays.copyOfRange(paid, CashuApplet.PAID_SIGS, CashuApplet.PAID_SIGS + 65 * 16));
                boolean receiptsKept = !Arrays.equals(new byte[4], Arrays.copyOf(c.f("cardReceipts"), 4));
                if (replaced) {
                    if (logKept || sigKept || keptKept || receiptsKept || ob[0] != 0) c.wrong("the new PIN, and history left: log " + logKept + " last signature " + sigKept + " kept " + keptKept + " receipts " + receiptsKept + " packet " + ob[0]);
                    if (throughTheWait(c, NEW_PIN).getSW() != SW_OK) c.wrong("the new PIN does not open the card");
                } else {
                    if (!(logKept && sigKept && keptKept && receiptsKept)) c.wrong("the old PIN, and history gone: log " + logKept + " last signature " + sigKept + " kept " + keptKept + " receipts " + receiptsKept);
                    if (throughTheWait(c, TEST_PIN).getSW() != SW_OK) c.wrong("the old PIN does not open the card");
                    ResponseAPDU a = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, HASH[0], 64));
                    if (a.getSW() != SW_OK) c.wrong(String.format("the holder's last payment by its hash: %04X", a.getSW()));
                }
            });
    }

    /** An owned card that has paid all it held (no change), its history and a settlement record kept; then a new tap with the PIN. */
    static byte[] CHAIN_BEFORE;
    static void paidOut(Card c) {
        // a day's limit, so that the payment counts a day
        readyWithTwo(c, 100_000);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0, 1 })).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(OUT_1000, u32(500), mintKey()))));
        assertEquals(64, signThrough(c::send).getData().length);
        c.powerCycle();
        assertEquals(SW_OK, c.sw(VERIFY));
        // the clock's last header, a roll spent and the arming (D198): the last owner's, to go with it
        assertEquals(SW_OK, c.sw(setTimeCommand(readUint32(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET) + 600)));
        c.f("cardRecord")[CashuApplet.CARD_ROLLS_OFFSET] = 2;
        c.f("cardRecord")[CashuApplet.CARD_ARMED_OFFSET] = 1;
        CHAIN_BEFORE = Arrays.copyOf(c.f("chain"), 32);
        TearHook.refresh();
    }

    /** SET_OWNER replacing the owner of a card `paidOut` left, as the last owner sends it. */
    static void handOver(Card c) {
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        c.raw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, OTHER_OWNER.pub), OTHER_OWNER.pub)));
    }

    /**
     * After a hand-over torn anywhere, out of the field and back: the last owner whole (its key, c, the PIN taken, the history,
     * the spent places, the refund key, the day's counts, the day of loads, the clock's last header hash, the rolls and the
     * arming, the paid list and its entry), or the next owner with
     * all of them gone, a new PIN owed and nothing else owed; never a mix.
     */
    static void handOverWhole(Card c) {
        boolean newC = !Arrays.equals(CHAIN_BEFORE, Arrays.copyOf(c.f("chain"), 32));
        byte[] marks = c.f("pinMarks");
        boolean owed = (marks[CashuApplet.PM_FORGET] & CashuApplet.PIN_OWED) != 0;
        byte[] log = c.f("cardLog"), ls = c.f("lastSig"), ob = c.f("outbox"), rc = c.f("cardReceipts"), rec = c.f("cardRecord"), paid = c.f("paid"), book = c.f("book");
        boolean history = !Arrays.equals(new byte[4], Arrays.copyOf(log, 4)) || ls[0] != 0 || !Arrays.equals(new byte[4], Arrays.copyOf(rc, 4));
        boolean spent = c.status(0) == 2 || c.status(1) == 2;
        boolean refund = !Arrays.equals(new byte[33], Arrays.copyOfRange(rec, CashuApplet.CARD_REFUND_OFFSET, CashuApplet.CARD_REFUND_OFFSET + 33))
            || !Arrays.equals(new byte[32], Arrays.copyOfRange(c.f("chain"), 32, 64));
        boolean day = !Arrays.equals(new byte[8], Arrays.copyOfRange(rec, CashuApplet.CARD_WINDOW_OFFSET, CashuApplet.CARD_WINDOW_OFFSET + 8));
        boolean loads = !Arrays.equals(new byte[CashuApplet.PM_FORGET - CashuApplet.PM_LOAD_DAY], Arrays.copyOfRange(marks, CashuApplet.PM_LOAD_DAY, CashuApplet.PM_FORGET));
        boolean list = (paid[CashuApplet.PAID_NEXT] | paid[CashuApplet.PAID_NEXT + 1] | paid[CashuApplet.PAID_ROUND]) != 0;
        boolean entry = false;
        for (int e = 0; e < 6; e++) entry |= book[e * 41 + 8] != 0;
        // the clock's last header hash, the rolls and the arming
        boolean clock = !Arrays.equals(new byte[33], Arrays.copyOfRange(rec, CashuApplet.CARD_HEADER_OFFSET, CashuApplet.CARD_HEADER_OFFSET + 33))
            || rec[CashuApplet.CARD_ARMED_OFFSET] != 0;
        if (newC != owed) c.wrong("a new c " + newC + " but the new PIN owed " + owed);
        String what = "history " + history + " spent places " + spent + " record " + ob[0] + " refund key " + refund + " day " + day + " loads " + loads + " paid list " + list + " entry " + entry + " clock " + clock;
        if (newC) {
            if (history || spent || ob[0] != 0 || refund || day || loads || list || entry || clock) c.wrong("the next owner, and the last owner's left: " + what);
            if (marks[CashuApplet.PM_FORGET] != CashuApplet.PIN_OWED) c.wrong("the next owner, and more than the new PIN owed: " + marks[CashuApplet.PM_FORGET]);
            if (c.sw(VERIFY) != SW_SECURITY_NOT_SATIS) c.wrong("the next owner, and the old PIN still taken");
        } else {
            if (!(history && spent && ob[0] == 1 && refund && day && loads && list && entry && clock)) c.wrong("the last owner, and its own gone: " + what);
            if (c.sw(VERIFY) != SW_OK) c.wrong("the last owner, and its PIN refused");
        }
    }

    @Test
    @DisplayName("an owner replaced (SET_OWNER on an owned card), torn at every write: the last owner whole (its key, c, the PIN taken, the history, the spent places, the refund key, the day's counts, the day of loads, the clock's last header hash, the rolls and the arming, the paid list and its entry), or the next owner with all of them gone and a new PIN owed; never a mix")
    void aHandOverIsWholeOrNotAtAll() throws Exception {
        sweep("SET_OWNER replacing an owner", SetUpAndResetTest::paidOut, SetUpAndResetTest::handOver, SetUpAndResetTest::handOverWhole);
    }

    @Test
    @DisplayName("an owner replaced, torn twice: after the commit (at each write of what it takes down after it), then inside the next command's taking down (the SELECT that follows, at each of its writes): out of the field and back, the next owner with all of the last owner's gone and a new PIN owed")
    void aHandOverTornTwiceIsWhole() throws Exception {
        int wrongBefore = WRONG.size(), nonAtomicBefore = TearHook.nonAtomicInTx.size();
        // the writes of the hand-over, and the last one in its transaction
        Card c = new Card();
        c.scenario = "SET_OWNER torn twice";
        paidOut(c);
        TearHook.count = 0;
        TearHook.target = 0;
        TearHook.trace = new ArrayList<>();
        handOver(c);
        List<String> trace = TearHook.trace;
        TearHook.trace = null;
        int total = TearHook.count, committed = 0;
        for (int i = 0; i < trace.size(); i++) if (trace.get(i).contains(" [tx] ")) committed = i + 1;
        assertTrue(committed > 0 && committed < total, "writes after the commit: " + committed + " of " + total);
        int pairs = 0;
        for (int k1 = committed + 1; k1 <= total; k1++) {
            // how many writes the next command's taking down makes after this first cut
            int second = 0;
            for (int k2 = 0; k2 == 0 || k2 <= second; k2++) {
                Card t = new Card();
                t.scenario = "SET_OWNER torn twice";
                t.k = k1;
                paidOut(t);
                TearHook.count = 0;
                TearHook.target = k1;
                try {
                    handOver(t);
                } catch (AssertionError | RuntimeException e) {
                    // the act's own asserts fail on a torn answer: expected
                }
                if (TearHook.tornAt == null) t.wrong("event " + k1 + " was not reached on a second run");
                String first = TearHook.tornAt;
                if (TearHook.tornInTx) t.wrong("event " + k1 + " is in the transaction: " + first);
                // out of the field, and the SELECT that brings it back torn at its write k2 (none for k2 = 0: counted)
                TearHook.depth = 0;
                t.sim.reset();
                t.rt.clearTx();
                TearHook.tornAt = null;
                TearHook.count = 0;
                TearHook.target = k2;
                try {
                    t.raw(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR)));
                } catch (AssertionError | RuntimeException e) {
                    // torn
                }
                if (k2 == 0) {
                    second = TearHook.count;
                    // a cut after the mark's own write (the last) leaves nothing owed but the new PIN: the next command writes nothing
                    if ((second == 0) != (k1 == total)) t.wrong("after a cut at " + first + " the next command wrote " + second);
                    continue;
                }
                if (TearHook.tornAt == null) t.wrong("the next command's write " + k2 + " was not reached");
                String at = first + " then " + TearHook.tornAt;
                TearHook.target = 0;
                t.powerCycle();
                TearHook.tornAt = at;
                t.probe();
                try {
                    handOverWhole(t);
                    if (Arrays.equals(CHAIN_BEFORE, Arrays.copyOf(t.f("chain"), 32))) t.wrong("torn after the commit, and the last owner's c");
                } catch (AssertionError | RuntimeException e) {
                    t.wrong("check failed: " + e);
                }
                pairs++;
            }
        }
        System.out.println("=== SET_OWNER torn twice: " + (total - committed) + " cuts after the commit, " + pairs + " pairs");
        SUMMARY.put("SET_OWNER torn twice", pairs + " pairs of cuts");
        assertTrue(pairs > total - committed - 1, "a second cut for each first but the mark's");
        assertEquals(java.util.Collections.emptyList(), WRONG.subList(wrongBefore, WRONG.size()), "every pair of cuts leaves the next owner whole");
        assertEquals(java.util.Collections.emptyList(), TearHook.nonAtomicInTx.subList(nonAtomicBefore, TearHook.nonAtomicInTx.size()));
    }

    @Test
    @DisplayName("a simple card set up numbers first (SET_LIMIT_PIN, then SET_CARD) and cut between the two takes nothing (6A8C) until it is set up again")
    void numbersBeforeTheRecord() throws Exception {
        Card d = new Card();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, d.sw(VERIFY));
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1_000), u32(500), u32(0)))));
        d.powerCycle();
        assertEquals(SW_OK, d.sw(VERIFY));
        assertEquals(CashuApplet.SW_NO_CARD_RECORD, (short) loadP(d, buildProof(KEYSET, 1000, 130)).getSW());
        // and in one selection, numbers then record: a card that keeps them
        Card e = new Card();
        assertEquals(SW_OK, e.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, e.sw(VERIFY));
        assertEquals(SW_OK, e.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1_000), u32(500), u32(0)))));
        assertEquals(SW_OK, e.sw(setCardOpenCommand(record(MINT, REFUND))));
        assertEquals(1_000, readUint32(e.f("cardRecord"), CashuApplet.CARD_LIMIT_OFFSET));
    }

    /**
     * What a stranger's commands write into key objects, whose data lasts on a chip: printed for the chip run. The signer's
     * working key (`SchnorrHW.tmpPriv`) is a persistent key: jCardSim builds no transient EC key (KeyBuilder answers
     * TYPE_EC_FP_PRIVATE_TRANSIENT_DESELECT with an exception), so it stays persistent until a chip shows that its key
     * agreements take a transient one.
     */
    @Test
    @DisplayName("what BEGIN and AUTH, which anyone may send, write into key data: printed")
    void whatAStrangerWritesIntoKeyData() throws Exception {
        Card c = new Card();
        ready(c, 0);
        assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 1000, 61, 1_900_000_000L)).getSW());
        c.powerCycle();
        TearHook.refresh();
        CommandAPDU[] cmds = { CashuAppletTest.spendBegin(new byte[] { 0 }), new CommandAPDU(CLA, 0x15, 0, 0, new byte[16], 256) };
        List<String> out = new ArrayList<>();
        for (CommandAPDU a : cmds) {
            TearHook.keyBytes = 0;
            TearHook.keyCalls = 0;
            ResponseAPDU r = c.raw(a);
            assertEquals(SW_OK, r.getSW());
            out.add(String.format("INS %02X: %d writes of key data (%d bytes)", a.getINS(), TearHook.keyCalls, TearHook.keyBytes));
        }
        System.out.println("KEY DATA " + out);
    }
    @Test
    @DisplayName("a forgotten PIN replaced steps the record's generation, as the reset does: the next packet's (payment id, generation) is one no packet had")
    void aForgottenPinStepsTheGeneration() throws Exception {
        Card c = new Card();
        forgotten(c);
        long gen = readUint32(c.f("outGen"), 0);
        byte[] ob = c.f("outbox");
        int len = ((ob[2] & 0xFF) << 8) | (ob[3] & 0xFF);
        byte[] body = Arrays.copyOfRange(ob, 4, 4 + len);
        long pid1 = readUint32(body, 7 + 33 + 32 + 4), gen1 = readUint32(body, 7 + 33 + 32 + 8 + 1);
        assertEquals(1, pid1);
        assertEquals(gen, gen1);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the forgotten PIN replaced");
        assertEquals(gen + 1, readUint32(c.f("outGen"), 0), "the generation stepped with the history gone");
        // a payment under the new PIN: payment id 1 again, of the next generation
        c.powerCycle();
        assertEquals(SW_OK, throughTheWait(c, NEW_PIN).getSW());
        assertEquals(SW_OK, loadP(c, buildProof(KEYSET, 700, 77)).getSW());
        c.powerCycle();
        assertEquals(SW_OK, throughTheWait(c, NEW_PIN).getSW());
        int place = -1;
        for (int i = 0; i < 128; i++) if (c.status(i) == 1) place = i;
        assertEquals(64, TransactionSizeTest.payPlace(c, place, 700).getData().length);
        long[] s = TransactionSizeTest.scope(c);
        assertEquals(SW_OK, s[0]);
        assertEquals(1, s[1]);
        assertEquals(gen + 1, s[2], "not the pair the packet before the forget had");
    }

    @Test
    @DisplayName("a forgotten PIN replaced takes the other unit's count, the receipts' units and the last payment's unit with the history: the new PIN's holder reads none of them")
    void aForgottenPinTakesTheOtherUnitsCount() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        c.tap();
        assertEquals(SW_OK, c.log(0).getSW(), "the holder's say: the PIN and a held tap");
        int usd = c.put(UnitsTest.USD, "00aabbccddeeff00", 4321);
        int sat = c.put(-1, KEYSET, 1234);
        c.tap();
        assertEquals(64, c.pay(usd).getData().length, "a payment in dollars");
        c.tap();
        assertEquals(64, c.pay(sat).getData().length, "a payment in sats");
        c.tap();
        ResponseAPDU before = c.log(2);
        assertEquals(SW_OK, before.getSW());
        assertEquals(4321, readUint32(before.getData(), 16), "the other unit's count, ever");
        c.power();
        SimpleCardTest.threeWrong(c);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "the forgotten PIN replaced");
        c.power();
        assertEquals(SW_OK, SimpleCardTest.verify(c, NEW_PIN));
        ResponseAPDU after = c.log(2);
        assertEquals(SW_OK, after.getSW());
        assertEquals(0, readUint32(after.getData(), 4), "sats signed for, ever: none");
        assertEquals(0, readUint32(after.getData(), 16), "the other unit's, ever: none");
        byte[] book = c.field("book");
        for (int k = CashuApplet.BOOK_LAST; k < CashuApplet.BOOK_LEN; k++) assertEquals(0, book[k], "book[" + k + "]: the last unit, the other unit's count and the receipts' units gone");
        assertTrue(book[8] != 0, "the keyset table itself (a setting) stays");
    }
}
