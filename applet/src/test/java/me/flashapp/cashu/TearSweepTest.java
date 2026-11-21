package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.base.SimulatorRuntime;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javacard.framework.Applet;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The tear sweep: every command that writes, torn after each single persistent write (and half way through each
 * NonAtomic copy/fill outside a transaction), with a chip's transaction semantics (TearHook), then the card out of the
 * field and back: the card's state is read by every read command (no 6F00) and checked for money it lost or made, and the
 * command is sent again.
 */
class TearSweepTest {

    static final class RT extends SimulatorRuntime {
        Applet appletAt(AID aid) { return getApplet(aid); }
        void clearTx() { transactionDepth = 0; }
    }

    static Class<? extends Applet> CLS;
    static final List<String> WRONG = new ArrayList<>();
    static final Map<String, String> SUMMARY = new LinkedHashMap<>();

    @SuppressWarnings("unchecked")
    static synchronized Class<? extends Applet> cls() throws Exception {
        if (CLS == null) {
            Path classes = Paths.get(CashuApplet.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            TearLoader l = new TearLoader(TearSweepTest.class.getClassLoader(), classes);
            CLS = (Class<? extends Applet>) l.loadClass("me.flashapp.cashu.CashuApplet");
            java.lang.reflect.Field f = CLS.getDeclaredField("FLOOR_BITS");
            f.setAccessible(true);
            System.arraycopy(TEST_FLOOR, 0, (byte[]) f.get(null), 0, 4);
        }
        return CLS;
    }

    /** One card with the instrumented applet. */
    static final class Card {
        final RT rt = new RT();
        final CardSimulator sim = new CardSimulator(rt);
        final AID aid = AIDUtil.create(AID_HEX);
        final Object applet;
        String scenario;
        int k;
        byte[] pin = TEST_PIN;

        Card() throws Exception {
            TearHook.reset();
            sim.installApplet(aid, cls());
            applet = rt.appletAt(aid);
            TearHook.attach(applet);
            select();
        }

        /** Whether a SPEND_ALL_CHANGE first marks the table's keysets taught (off for the parser: it watches every write). */
        boolean teachForChange = true;

        ResponseAPDU raw(CommandAPDU c) {
            // a change is made only in a taught keyset: the tests' keysets are names, marked taught here as KEYSET_KEYS would mark them
            if (teachForChange && c.getINS() == (CashuApplet.INS_SPEND_ALL_CHANGE & 0xFF)) {
                byte[] book = f("book");
                for (int e = 0; book != null && e < 6; e++) if ((book[e * 41 + 8] & 0x40) != 0) book[e * 41 + 8] |= 0x02;
            }
            TearHook.refresh();
            ResponseAPDU r = sim.transmitCommand(c);
            if (TearHook.depth > 0 && TearHook.tornAt == null) {
                String s = String.format("INS %02X answered %04X with a transaction open (began @%s): a chip rolls it back, jCardSim keeps it",
                    c.getINS(), r.getSW(), TearHook.beganAt);
                if (!TearHook.leftOpen.contains(s)) TearHook.leftOpen.add(s);
                TearHook.rollback();
                rt.clearTx();
            }
            return r;
        }

        ResponseAPDU send(CommandAPDU c) { return held(this::raw, c); }

        int sw(CommandAPDU c) { return send(c).getSW(); }

        void select() { assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR))).getSW()); }

        void powerCycle() {
            if (TearHook.tornInTx) TearHook.rollback();
            TearHook.depth = 0;
            sim.reset();
            rt.clearTx();
            select();
        }

        byte[] f(String name) {
            try {
                java.lang.reflect.Field fl = applet.getClass().getDeclaredField(name);
                fl.setAccessible(true);
                return (byte[]) fl.get(applet);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }

        long balance() { return readUint32(send(new CommandAPDU(CLA, INS_GET_BALANCE, 0, 0, 4)).getData(), 0); }

        byte status(int place) { return f("proofStorage")[place * 82]; }

        void wrong(String what) {
            String s = scenario + ": " + what + "  [torn after event " + k + ": " + TearHook.tornAt + "]";
            WRONG.add(s);
            System.out.println("WRONG " + s);
        }

        /** Every read a phone or a till makes of a card it meets: none may fail with 6F00 (an exception the applet did not mean). */
        void probe() {
            int[][] reads = { { INS_GET_INFO, 0 }, { INS_GET_INFO, 1 }, { INS_GET_INFO, 2 }, { INS_GET_INFO, 3 }, { INS_GET_BALANCE, 0 },
                { INS_GET_BALANCE, 1 }, { INS_GET_PROOF_COUNT, 0 }, { INS_GET_SLOT_STATUS, 0 }, { INS_GET_PIECES, 0 }, { INS_GET_CARD, 0 },
                { INS_GET_CARD, 2 }, { INS_GET_CHANGE, 0 }, { 0x1B, 0 }, { 0x1C, 0xFF }, { INS_GET_PUBKEY, 0 }, { INS_GET_PROOF, 0 },
                { INS_GET_DLEQ, 0 } };
            for (int[] r : reads) {
                int p2 = r[0] == (INS_GET_DLEQ & 0xFF) ? 1 : 0;
                ResponseAPDU a = raw(new CommandAPDU(CLA, r[0], r[1], p2, 256));
                if (a.getSW() == 0x6F00) wrong(String.format("read INS %02X P1 %02X answers 6F00 after the tear", r[0], r[1]));
            }
        }
    }

    interface Step { void run(Card c) throws Exception; }
    interface Act { void run(Card c) throws Exception; }
    interface Check { void run(Card c) throws Exception; }

    /**
     * The sweep: count the persistent writes `act` makes on a card `setup` left, then for each k a new card, the same setup,
     * `act` torn after write k, the card out of the field and back, the reads, and `check`.
     */
    static void sweep(String name, Step setup, Act act, Check check) throws Exception {
        int wrongBefore = WRONG.size(), nonAtomicBefore = TearHook.nonAtomicInTx.size();
        Card c = new Card();
        c.scenario = name;
        setup.run(c);
        TearHook.count = 0;
        TearHook.target = 0;
        TearHook.trace = new ArrayList<>();
        act.run(c);
        int total = TearHook.count;
        List<String> trace = TearHook.trace;
        TearHook.trace = null;
        System.out.println("=== " + name + ": " + total + " persistent writes");
        for (String t : trace) System.out.println("    " + t);
        // the untorn run must pass the check too
        c.k = 0;
        c.powerCycle();
        c.probe();
        check.run(c);
        for (int k = 1; k <= total; k++) {
            Card t = new Card();
            t.scenario = name;
            t.k = k;
            setup.run(t);
            TearHook.count = 0;
            TearHook.target = k;
            try {
                act.run(t);
            } catch (AssertionError | RuntimeException e) {
                // the act's own asserts fail on a torn answer: expected
            }
            if (TearHook.tornAt == null) {
                t.wrong("event " + k + " was not reached on a second run (the run is not the same)");
            }
            String at = TearHook.tornAt;
            TearHook.target = 0;
            t.powerCycle();
            TearHook.tornAt = at;
            t.probe();
            try {
                check.run(t);
            } catch (AssertionError | RuntimeException e) {
                t.wrong("check failed: " + e);
            }
        }
        SUMMARY.put(name, total + " writes, each torn");
        assertEquals(java.util.Collections.emptyList(), WRONG.subList(wrongBefore, WRONG.size()), name + ": every tear leaves a card that holds its money and answers every read");
        assertEquals(java.util.Collections.emptyList(), TearHook.nonAtomicInTx.subList(nonAtomicBefore, TearHook.nonAtomicInTx.size()),
            name + ": no NonAtomic write to persistent memory inside a transaction (a chip does not roll it back)");
    }

    @AfterAll
    static void report() {
        System.out.println("===== TEAR SWEEP SUMMARY");
        SUMMARY.forEach((k, v) -> System.out.println(k + ": " + v));
        System.out.println("===== commands that left a transaction open:");
        for (String s : TearHook.leftOpen) System.out.println("  " + s);
        System.out.println("===== NonAtomic writes inside a transaction (they survive a rollback on a chip):");
        for (String s : TearHook.nonAtomicInTx) System.out.println("  " + s);
        System.out.println("===== WRONG (" + WRONG.size() + ")");
        for (String s : WRONG) System.out.println("  " + s);
    }

    // ---- set-ups -----------------------------------------------------------------------------------------------------

    static void ready(Card c, long limit) {
        readyOn(c.sim, limit);
        TearHook.refresh();
    }

    static ResponseAPDU loadP(Card c, byte[] proof) {
        return c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, proof, 0, proof.length, 1));
    }

    static final byte[] DLEQ = new byte[96];
    static {
        for (int i = 0; i < 96; i++) DLEQ[i] = (byte) (i + 1);
    }

    static byte[] OUT_1000 = concat(u32(1000), mintKey());

    /** A payment of places 0 and 1 (1,500): one output of 1,000 to the till, 500 of change the card makes for itself. */
    static ResponseAPDU pay(Card c) {
        ResponseAPDU b = c.send(CashuAppletTest.spendBegin(new byte[] { 0, 1 }));
        if (b.getSW() != SW_OK) return b;
        ResponseAPDU o = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, OUT_1000));
        if (o.getSW() != SW_OK) return o;
        ResponseAPDU ch = c.send(changeCommand(500, mintKey()));
        if (ch.getSW() != SW_OK) return ch;
        return signThrough(c::send);
    }

    // ---- the sweeps ----------------------------------------------------------------------------------------------------

    @Test
    void loadWithProof() throws Exception {
        sweep("LOAD_PROOF P1=1", c -> ready(c, 0),
            c -> c.send(loadWithProofCommand(PROOF_1, DLEQ)),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                long b = c.balance();
                if (b != 0 && b != 1000) c.wrong("balance " + b);
                ResponseAPDU again = c.send(loadWithProofCommand(PROOF_1, DLEQ));
                if (b == 0 && again.getSW() != SW_OK) c.wrong(String.format("reload after a torn load answers %04X", again.getSW()));
                if (b == 1000 && again.getSW() != SW_PIECE_ON_CARD) c.wrong(String.format("reload of a piece on the card answers %04X", again.getSW()));
                if (c.balance() != 1000) c.wrong("after the reload the balance is " + c.balance());
                int place = -1;
                for (int i = 0; i < 128; i++) if (c.status(i) == 1) { if (place >= 0) c.wrong("two places unspent"); place = i; }
                byte[] d = c.send(getDleqCommand(place, 255)).getData();
                if (d.length < 97 || d[0] != 1 || !Arrays.equals(Arrays.copyOfRange(d, 1, 97), DLEQ)) c.wrong("GET_DLEQ does not give the piece's own proof: " + toHex(d));
            });
    }

    @Test
    void loadBatch() throws Exception {
        byte[] three = concat(PROOF_1, PROOF_2, buildProof("0059534ce0bfa19a", 250, 3));
        sweep("LOAD_PROOF x3", c -> ready(c, 0),
            c -> c.send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, three, 0, three.length, 3)),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                long b = c.balance();
                if (b != 0 && b != 1000 && b != 1500 && b != 1750) c.wrong("balance " + b);
                // the wallet sends each piece alone after a lost answer
                for (byte[] p : new byte[][] { PROOF_1, PROOF_2, buildProof("0059534ce0bfa19a", 250, 3) }) {
                    int sw = loadP(c, p).getSW();
                    if (sw != SW_OK && sw != SW_PIECE_ON_CARD) c.wrong(String.format("reload answers %04X", sw));
                }
                if (c.balance() != 1750) c.wrong("after the reloads the balance is " + c.balance());
                // the log: what was loaded, as the card counts it
            });
    }

    static void readyWithTwo(Card c, long limit) {
        ready(c, limit);
        assertEquals(SW_OK, loadP(c, PROOF_1).getSW());
        assertEquals(SW_OK, loadP(c, PROOF_2).getSW());
        // a new tap for the payment: a load is in this one
        c.sim.reset();
        c.select();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        TearHook.refresh();
    }

    static final byte[][] REF_BODY = new byte[1][];
    static final CommandAPDU AGAIN_CMD = new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64);

    @Test
    void payment() throws Exception {
        sweep("PAYMENT (BEGIN, OUTPUTS, CHANGE, SIGN) with a daily limit", c -> readyWithTwo(c, 100_000),
            c -> pay(c),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                byte s0 = c.status(0), s1 = c.status(1);
                ResponseAPDU again = c.send(AGAIN_CMD);
                boolean signed = again.getSW() == SW_OK;
                byte[] rec = c.f("cardRecord");
                long spent = readUint32(rec, 193);
                byte[] os = c.f("openState");
                if (signed) {
                    if (s0 != 2 || s1 != 2) c.wrong("a signature is given again (SPEND_ALL_AGAIN) and the places are " + s0 + "," + s1 + ": signed and still spendable");
                    if (spent != 1500) c.wrong("signed, and the day counts " + spent + " (the pieces whole, the change with them)");
                    if (os[0] != 2) c.wrong("signed, and the change's opening is in state " + os[0] + " (not owed)");
                    if (c.balance() != 0) c.wrong("signed, balance " + c.balance());
                } else {
                    if (s0 != 1 || s1 != 1) c.wrong("no signature to be had, and the places are " + s0 + "," + s1 + ": burned for nothing");
                    if (spent != 0) c.wrong("no signature, and the day counts " + spent);
                    if (os[0] == 2) c.wrong("no signature, and the change's opening is owed");
                    // the till tries again
                    ResponseAPDU r = pay(c);
                    if (r.getSW() != SW_OK || r.getData().length != 64) c.wrong(String.format("the payment again answers %04X", r.getSW()));
                    else if (readUint32(c.f("cardRecord"), 193) != 1500) c.wrong("paid again, and the day counts " + readUint32(c.f("cardRecord"), 193));
                }
                // the assisted-settlement record (2.2): whole or none, never a mix
                byte[] ob = c.f("outbox");
                if (ob != null && ob[0] == 1) {
                    int bodyLen = ((ob[2] & 0xFF) << 8) | (ob[3] & 0xFF);
                    byte[] body = Arrays.copyOfRange(ob, 4, 4 + bodyLen);
                    if (REF_BODY[0] == null) REF_BODY[0] = body;
                    else if (signed && !Arrays.equals(REF_BODY[0], body)) c.wrong("the record is marked whole and its body is not the payment's");
                    ResponseAPDU sc = c.raw(new CommandAPDU(CLA, 0x1B, 0, 0, 256));
                    if (sc.getSW() != SW_OK) c.wrong(String.format("GET_OUTBOX scope answers %04X on a whole record", sc.getSW()));
                    else {
                        // the descriptor: the BIP-340 signature of the card's key for the date 0 (D197) over SHA-256(tag||tag||body)
                        byte[] desc = Arrays.copyOfRange(c.f("outbox"), 4 + bodyLen, 4 + bodyLen + 64);
                        byte[] tag = sha256("CashuCard/assisted-settlement/v1".getBytes());
                        byte[] msg = sha256(concat(tag, tag, body));
                        byte[] key = DateKeys.of(c.applet).key(0);
                        try {
                            if (!schnorrVerify(extractPubkeyX(key), msg, desc)) c.wrong("the record's descriptor does not verify after the read");
                        } catch (Exception e) { c.wrong("descriptor check threw " + e); }
                    }
                } else if (signed && TearHook.tornAt == null) {
                    c.wrong("an untorn payment left no record");
                }
                int b = c.sw(CashuAppletTest.spendBegin(new byte[] { 0 }));
                if (b == SW_OK) c.wrong("after the payment, place 0 can be named again");
            });
    }

    /** The same payment with no change and no limit, on a card with a no-PIN allowance (the no-PIN window's writes). */
    @Test
    void paymentNoPin() throws Exception {
        sweep("PAYMENT with no PIN under the allowance", c -> {
                readyWithTwo(c, 0);
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                byte[] v = concat(u32(100_000), u32(0), u32(5_000));
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(ownerProof(L_LIMIT, OWNER, n, v), v))));
                c.sim.reset();
                c.select();
                TearHook.refresh();
            },
            c -> {
                c.send(CashuAppletTest.spendBegin(new byte[] { 0, 1 }));
                c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(1500), mintKey())));
                signThrough(c::send);
            },
            c -> {
                byte s0 = c.status(0), s1 = c.status(1);
                ResponseAPDU again = c.send(AGAIN_CMD);   // a no-PIN signature is given again with no PIN
                boolean signed = again.getSW() == SW_OK;
                byte[] rec = c.f("cardRecord");
                long npSpent = readUint32(rec, 205);
                if (signed && (s0 != 2 || s1 != 2)) c.wrong("signed and still spendable: " + s0 + "," + s1);
                if (signed && npSpent != 1500) c.wrong("signed with no PIN, and the no-PIN count is " + npSpent);
                if (!signed && (s0 != 1 || s1 != 1)) c.wrong("burned for nothing: " + s0 + "," + s1);
                if (!signed && npSpent != 0) c.wrong("not signed, and the no-PIN count is " + npSpent);
            });
    }

    @Test
    void clearSpent() throws Exception {
        sweep("CLEAR_SPENT after a payment", c -> {
                readyWithTwo(c, 0);
                ResponseAPDU r = pay(c);
                assertEquals(64, r.getData().length);
                c.sim.reset();
                c.select();
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
                TearHook.refresh();
            },
            c -> c.send(new CommandAPDU(CLA, INS_CLEAR_SPENT, 0, 0, 1)),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                for (int i = 0; i < 128; i++) if (c.status(i) == 1) c.wrong("place " + i + " is UNSPENT after a torn clear");
                if (c.balance() != 0) c.wrong("balance " + c.balance());
                c.send(new CommandAPDU(CLA, INS_CLEAR_SPENT, 0, 0, 1));
                for (int i = 0; i < 2; i++) if (c.status(i) != 0) c.wrong("place " + i + " not freed by the next clear: " + c.status(i));
                // a piece the card signed for is never taken again (the paid list)
                int sw = loadP(c, PROOF_1).getSW();
                if (sw == SW_OK) c.wrong("a piece the card signed for is loaded again after a torn clear");
            });
    }

    static void readyOwed(Card c) {
        readyWithTwo(c, 0);
        ResponseAPDU r = pay(c);
        assertEquals(64, r.getData().length);
        c.sim.reset();
        c.select();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        TearHook.refresh();
        shownByHand(c.f("openKeys"), 0);
    }

    static byte[] answerFor(Card c) {
        byte[] row = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData();
        return mintAnswer(Arrays.copyOfRange(row, 18, 51));
    }

    @Test
    void loadChange() throws Exception {
        final byte[][] ans = new byte[1][];
        sweep("LOAD_CHANGE", c -> { readyOwed(c); ans[0] = answerFor(c); },
            c -> c.send(loadChangeCommand(0, ans[0])),
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                long b = c.balance();
                byte os = c.f("openState")[0];
                if (b != 0 && b != 500) c.wrong("balance " + b);
                if (b == 0 && os != 2) c.wrong("the change is not on the card and its opening is not owed (" + os + "): lost");
                shownByHand(c.f("openKeys"), 0);
                int sw = c.send(loadChangeCommand(0, ans[0])).getSW();
                if (sw != SW_OK && sw != SW_PIECE_ON_CARD && sw != SW_SLOT_EMPTY) c.wrong(String.format("LOAD_CHANGE again answers %04X", sw));
                if (c.balance() != 500) c.wrong("after LOAD_CHANGE again the balance is " + c.balance() + " (opening " + c.f("openState")[0] + ")");
                if (c.f("openState")[0] != 0) c.wrong("after LOAD_CHANGE again the opening is " + c.f("openState")[0]);
            });
    }

    // ---- PIN, owner, reset ----

    @Test
    void verifyWrongPin() throws Exception {
        sweep("VERIFY_PIN wrong", c -> ready(c, 0),
            c -> c.send(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)),
            c -> {
                byte[] info = c.send(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256)).getData();
                int tries = info[9];
                byte ps = c.f("pinState")[0];
                if (tries > 2) c.wrong("a wrong PIN torn left the tries at " + tries + " (a free guess); pinState " + ps);
                int sw = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (sw != SW_OK) c.wrong(String.format("the right PIN after a torn wrong one answers %04X (tries %d, pinState %d)", sw, tries, ps));
            });
    }

    @Test
    void setPinFresh() throws Exception {
        sweep("SET_PIN on a new card", c -> { },
            c -> c.send(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)),
            c -> {
                byte ps = c.f("pinState")[0];
                int v = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (ps != 0 && v != SW_OK) c.wrong(String.format("pinState %d and the PIN answers %04X", ps, v));
                if (ps == 0) {
                    int s = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN));
                    if (s != SW_OK) c.wrong(String.format("SET_PIN again answers %04X", s));
                }
                if (c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)) != SW_OK) c.wrong("the PIN does not verify in the end");
            });
    }

    @Test
    void changePinOwner() throws Exception {
        sweep("CHANGE_PIN (owner)", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0, ownerData(ownerProof(L_PIN, OWNER, n, NEW_PIN), NEW_PIN)));
            },
            c -> {
                int o = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                int nw = o == SW_OK ? -1 : c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN));
                if (o != SW_OK && nw != SW_OK) c.wrong(String.format("neither PIN verifies (old %04X, new %04X)", o, nw));
            });
    }

    @Test
    void claimOwner() throws Exception {
        // a card set up with PIN and record, no owner: the claim's last asking writes
        sweep("SET_OWNER claim (held)", c -> {
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
                TearHook.refresh();
            },
            c -> c.send(setOwnerOpenCommand(OWNER)),
            c -> {
                byte os = c.f("ownerSet")[0];
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (os == 0) {
                    // the power cut ended the first set-up (D196): the claim is not taken again; the way back is a reset by the PIN
                    int s = c.sw(setOwnerOpenCommand(OWNER));
                    if (s != SW_OWNER_PROOF) c.wrong(String.format("the claim again answers %04X", s));
                    return;
                }
                // the owner's proof works
                c.select();
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                int t = c.sw(new CommandAPDU(CLA, INS_SET_TAG, 1, 0, ownerData(ownerProof(L_TAG, OWNER, n, new byte[] { 1 }), new byte[] { 1 })));
                if (t != SW_OK) c.wrong(String.format("the claimed owner's proof answers %04X", t));
            });
    }

    @Test
    void ownerHandover() throws Exception {
        sweep("SET_OWNER by the old owner's proof", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, OTHER_OWNER.pub), OTHER_OWNER.pub)));
            },
            c -> {
                int ok = 0;
                for (Key k : new Key[] { OWNER, OTHER_OWNER }) {
                    byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                    if (c.sw(new CommandAPDU(CLA, INS_SET_TAG, 1, 0, ownerData(ownerProof(L_TAG, k, n, new byte[] { 1 }), new byte[] { 1 })))
                        == SW_OK) ok++;
                }
                if (ok != 1) c.wrong(ok + " owners' proofs work (ownerSet " + c.f("ownerSet")[0] + ")");
            });
    }

    @Test
    void resetCard() throws Exception {
        sweep("RESET_CARD (owner)", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0])));
            },
            c -> {
                byte os = c.f("ownerSet")[0];
                byte ps = c.f("pinState")[0];
                if (os != 0) {
                    byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                    int s = c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0])));
                    if (s != SW_OK) {
                        c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                        n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                        int s2 = c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0])));
                        c.wrong(String.format("torn reset; the owner's reset again answers %04X (with the PIN %04X); pinState %d", s, s2, ps));
                    }
                }
                // a reset card is set up by the next person
                int a = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN));
                if (a != SW_OK) c.wrong(String.format("after the reset, SET_PIN answers %04X (ownerSet %d pinState %d)", a, c.f("ownerSet")[0], c.f("pinState")[0]));
            });
    }

    @Test
    void setCardOwner() throws Exception {
        byte[] rec = record("https://other.mint/x", REFUND);
        sweep("SET_CARD (owner)", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(ownerProof(L_CARD, OWNER, n, rec), rec)));
            },
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (loadP(c, PROOF_1).getSW() != SW_OK) c.wrong("a load after a torn SET_CARD is refused");
            });
    }

    @Test
    void setLimitOwner17() throws Exception {
        byte[] v = concat(u32(50_000), u32(10_000), u32(2_000), new byte[] { 9 }, u32(1500));
        sweep("SET_LIMIT (owner, 17 bytes)", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(ownerProof(L_LIMIT, OWNER, n, v), v)));
            },
            c -> {
                byte[] r = c.f("cardRecord");
                long lim = readUint32(r, 2);
                if (lim != 0 && lim != 50_000) c.wrong("limit " + lim);
                if (lim == 50_000 && readUint32(r, 159) != 1500) c.wrong("limit set and rate " + readUint32(r, 159));
            });
    }

    @Test
    void lockCard() throws Exception {
        sweep("LOCK_CARD", c -> ready(c, 0),
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(ownerProof(L_LOCK, OWNER, n, new byte[0]), new byte[0])));
            },
            c -> { });
    }

    @Test
    void verifyRightPinArmsNothing() throws Exception {
        sweep("VERIFY_PIN right (arms nothing, D208)", c -> {
                ready(c, 0);
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                byte[] v = concat(u32(100_000), u32(0), u32(5_000));
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(ownerProof(L_LIMIT, OWNER, n, v), v))));
                c.f("cardRecord")[158] = 0;   // disarmed, so that an arming by the PIN would show
                c.sim.reset();
                c.select();
                TearHook.refresh();
            },
            c -> c.send(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)),
            c -> {
                int sw = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                if (sw != SW_OK) c.wrong(String.format("the right PIN after a torn one answers %04X", sw));
                if (c.f("cardRecord")[158] != 0) c.wrong("a VERIFY_PIN armed the no-PIN allowance (D208)");
            });
    }

    // ---- round two: the rest of D23's sites ----

    /** The keyset entry of the opening 0's keyset set by hand to "keys known", its top the leaf of (amount, key): a path of depth 0. */
    static void teachByHand(Card c, byte[] key33) {
        byte[] book = c.f("book"), open = c.f("changeOpen");
        int e = -1;
        for (int i = 0; i < 6; i++) if ((book[i * 41 + 8] & 0x40) != 0 && Arrays.equals(Arrays.copyOfRange(book, i * 41, i * 41 + 8), Arrays.copyOfRange(open, 4, 12))) e = i;
        assertTrue(e >= 0, "the opening's keyset has an entry");
        byte[] leaf = sha256(concat(new byte[] { 0 }, new byte[4], Arrays.copyOfRange(open, 0, 4), key33));
        System.arraycopy(leaf, 0, book, e * 41 + 9, 32);
        book[e * 41 + 8] |= 0x02;
    }

    static final byte[] OTHER_K = keyOf(java.math.BigInteger.valueOf(0xBEEFL));

    @Test
    void showKeyOther() throws Exception {
        sweep("KEYSET_KEYS P1=3 another key (showKey)", c -> {
                readyOwed(c);
                teachByHand(c, OTHER_K);
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                assertEquals(SW_GRANT, c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0]))));
            },
            c -> assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, 0x38, 3, 0, concat(new byte[] { 0, 0, 0 }, OTHER_K)))),
            c -> {
                byte[] ok = c.f("openKeys");
                byte shown = ok[66];
                byte[] k = Arrays.copyOfRange(ok, 33, 66);
                boolean isOther = Arrays.equals(k, OTHER_K), isMint = Arrays.equals(k, mintKey());
                if (!isOther && !isMint) {
                    c.wrong("the opening's key is neither: " + toHex(k) + " (shown " + shown + ")");
                    int bound = c.sw(new CommandAPDU(CLA, 0x38, 3, 0, new byte[] { 0, 0, 0 }));
                    int lc = c.sw(loadChangeCommand(0, mintAnswer(Arrays.copyOfRange(ok, 0, 33))));
                    c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                    byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                    c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0])));
                    int again = c.sw(new CommandAPDU(CLA, 0x38, 3, 0, concat(new byte[] { 0, 0, 0 }, OTHER_K)));
                    c.wrong(String.format("  then: show the bound key %04X, LOAD_CHANGE %04X; the holder's rebinding sent again %04X, key now other: %s",
                        bound, lc, again, Arrays.equals(Arrays.copyOfRange(c.f("openKeys"), 33, 66), OTHER_K)));
                }
                // torn inside the binding's transaction, the opening is as it was: the mint's key, shown as it was before
                // (this test's top holds the other key alone, set by hand); never shown under a key that is neither
                if (shown == 1 && !isOther && !isMint) c.wrong("shown, and bound to a key that is neither");
                if (c.f("openState")[0] != 2) c.wrong("the opening is no longer owed: " + c.f("openState")[0]);
            });
    }

    // ---- the day's loads (D191, D195) ----

    static int loadsOf(Card c) { byte[] m = c.f("pinMarks"); return ((m[8] & 0xFF) << 8) | (m[9] & 0xFF); }

    @Test
    void loadCountsFirst() throws Exception {
        for (boolean newDay : new boolean[] { false, true }) {
            sweep("LOAD_PROOF counted with the day's loads" + (newDay ? ", a new day beginning" : ""), c -> {
                    ready(c, 0);
                    byte[] m = c.f("pinMarks");
                    m[4] = 0; m[5] = 0; m[6] = 0; m[7] = newDay ? 0 : (byte) 1;   // a day begun long ago, or one whose day the clock is still in
                    if (!newDay) System.arraycopy(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET, m, 4, 4);
                    m[8] = 0; m[9] = 7;
                },
                c -> assertEquals(SW_OK, loadP(c, PROOF_1).getSW()),
                c -> {
                    int n = loadsOf(c);
                    boolean on = c.status(0) == 1;
                    long began = readUint32(c.f("pinMarks"), 4), now = readUint32(c.f("cardRecord"), CashuApplet.CARD_NOW_OFFSET);
                    int counted = newDay ? 1 : 8;
                    if (n != 7 && n != counted) c.wrong("loads " + n);
                    if (on && n != counted) c.wrong("a piece on the card that the day did not count: loads " + n);
                    if (newDay && (n == 1) != (began == now)) c.wrong("the count and its day apart: loads " + n + ", began " + began);
                });
        }
    }

    // ---- the PIN's wait on a card with no owner (D195) ----

    static void readyNoOwner(Card c) {
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
        c.sim.reset(); c.select();
        TearHook.refresh();
    }

    /** The marks as { wrong tries in a row, askings owed }. */
    static int[] marks(Card c) {
        byte[] m = c.f("pinMarks");
        return new int[] { m[0], ((m[1] & 0xFF) << 8) | (m[2] & 0xFF) };
    }

    /** A VERIFY_PIN asked as long as the card holds, however long: the last answer. */
    static ResponseAPDU throughTheWait(Card c, byte[] pin) {
        ResponseAPDU r;
        int n = 0;
        do { r = c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, pin)); } while (r.getSW() == SW_KEEP_HOLDING && ++n < 200);
        return r;
    }

    /** After a tear: the marks are one of `allowed`, the PIN is not blocked, and the right PIN, after the wait the card asks, opens it and sets the marks to nothing. */
    static void pinWaitHolds(Card c, int[][] allowed) {
        int[] m = marks(c);
        boolean ok = false;
        for (int[] a : allowed) ok |= a[0] == m[0] && a[1] == m[1];
        if (!ok) c.wrong("the PIN's marks are " + m[0] + " wrong, " + m[1] + " owed");
        if (c.f("pinState")[0] != 1) c.wrong("pinState " + c.f("pinState")[0]);
        int sw = throughTheWait(c, TEST_PIN).getSW();
        if (sw != SW_OK) c.wrong(String.format("the right PIN after its wait answers %04X", sw));
        if (marks(c)[0] != 0 || marks(c)[1] != 0) c.wrong("the right PIN left marks " + marks(c)[0] + "/" + marks(c)[1]);
    }

    @Test
    void verifyWrongPinNoOwner() throws Exception {
        sweep("VERIFY_PIN wrong on a card with no owner, after the wait of its first wrong try", c -> {
                readyNoOwner(c);
                assertEquals(0x63C1, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)).getSW());
                assertArrayEquals(new int[] { 1, 1 }, marks(c));
            },
            c -> assertEquals(0x63C2, throughTheWait(c, WRONG_PIN).getSW()),
            c -> pinWaitHolds(c, new int[][] { { 1, 1 }, { 1, 0 }, { 2, 2 } }));
    }

    @Test
    void verifyRightPinNoOwner() throws Exception {
        sweep("VERIFY_PIN right on a card with no owner, after a wait", c -> {
                readyNoOwner(c);
                assertEquals(0x63C1, c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN)).getSW());
            },
            c -> assertEquals(SW_OK, throughTheWait(c, TEST_PIN).getSW()),
            c -> pinWaitHolds(c, new int[][] { { 1, 1 }, { 1, 0 }, { 2, 2 }, { 0, 0 } }));
    }

    @Test
    void verifyLongWaitNoOwner() throws Exception {
        sweep("VERIFY_PIN wrong on a card with no owner owing two stretches (pulled mid-wait)", c -> {
                readyNoOwner(c);
                byte[] m = c.f("pinMarks");
                m[0] = 6; m[1] = 0; m[2] = 32;   // the sixth wrong try in a row: 32 askings owed, two stretches of 16
            },
            c -> assertEquals(0x63C7, throughTheWait(c, WRONG_PIN).getSW()),
            c -> pinWaitHolds(c, new int[][] { { 6, 32 }, { 6, 16 }, { 6, 0 }, { 7, 64 } }));
    }

    @Test
    void setPinBlockedOpenCard() throws Exception {
        sweep("SET_PIN on a blocked card with no owner (the history wiped first)", c -> {
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
                assertEquals(SW_OK, loadP(c, PROOF_1).getSW());
                c.sim.reset(); c.select();
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                c.send(CashuAppletTest.spendBegin(new byte[] { 0 }));
                c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(1000), mintKey())));
                assertEquals(64, signThrough(c::send).getData().length);
                c.sim.reset(); c.select();
                // blocked by hand: the chip's counter run out (a card with no owner never runs it out itself, D195), then a command finds it
                try {
                    java.lang.reflect.Field f = c.applet.getClass().getDeclaredField("pin");
                    f.setAccessible(true);
                    javacard.framework.OwnerPIN pin = (javacard.framework.OwnerPIN) f.get(c.applet);
                    while (pin.getTriesRemaining() > 0) pin.check(WRONG_PIN, (short) 0, (byte) 4);
                } catch (ReflectiveOperationException e) {
                    throw new IllegalStateException(e);
                }
                c.raw(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256));
                assertEquals(2, c.f("pinState")[0]);
                TearHook.refresh();
            },
            c -> c.send(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)),
            c -> {
                byte ps = c.f("pinState")[0];
                int v = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, NEW_PIN));
                if (ps == 1 && v != SW_OK) c.wrong(String.format("state 1 and the new PIN answers %04X", v));
                if (ps == 2) {
                    int s = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN));
                    if (s != SW_OK) c.wrong(String.format("blocked still, SET_PIN again answers %04X", s));
                }
            });
    }

    @Test
    void certWrite() throws Exception {
        byte[] key = new byte[33];
        sweep("CERT_WRITE page then seal", c -> {
                byte[] k65 = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
                System.arraycopy(k65, 0, key, 0, Math.min(33, k65.length));
            },
            c -> {
                byte[] k65 = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
                byte[] head = concat("CCP-CERT".getBytes(), new byte[] { 1, 1 }, k65.length == 33 ? k65 : Arrays.copyOf(k65, 33), new byte[6]);
                c.send(new CommandAPDU(CLA, 0x54, 0, 0, concat(new byte[] { 0, 0 }, head)));
                c.send(new CommandAPDU(CLA, 0x54, 1, 0, concat(new byte[] { 0, (byte) head.length }, sha256(head))));
            },
            c -> {
                byte[] st = c.send(new CommandAPDU(CLA, 0x1C, 0xFF, 0, 256)).getData();
                if (st[0] == 1) {
                    byte[] page = c.send(new CommandAPDU(CLA, 0x1C, 0, 0, 256)).getData();
                    if (page.length != ((st[2] & 0xFF) << 8 | (st[3] & 0xFF))) c.wrong("sealed, and the page is " + page.length + " bytes");
                }
            });
    }

    @Test
    void paymentThreeChanges() throws Exception {
        sweep("PAYMENT with three change outputs", c -> readyWithTwo(c, 0),
            c -> {
                if (c.sw(CashuAppletTest.spendBegin(new byte[] { 0, 1 })) != SW_OK) return;
                if (c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(800), mintKey()))) != SW_OK) return;
                if (c.sw(changeCommand(400, mintKey())) != SW_OK) return;
                if (c.sw(changeCommand(200, mintKey())) != SW_OK) return;
                if (c.sw(changeCommand(100, mintKey())) != SW_OK) return;
                signThrough(c::send);
            },
            c -> {
                c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN));
                boolean signed = c.send(AGAIN_CMD).getSW() == SW_OK;
                byte[] os = c.f("openState");
                int owed = 0, draft = 0;
                for (int k = 0; k < 8; k++) { if (os[k] == 2) owed++; if (os[k] == 1) draft++; }
                if (signed && owed != 3) c.wrong("signed, " + owed + " openings owed");
                if (!signed && owed != 0) c.wrong("not signed, " + owed + " openings owed");
                // the next payment lets every draft go
                if (!signed) {
                    c.send(CashuAppletTest.spendBegin(new byte[] { 0 }));
                    for (int k = 0; k < 8; k++) if (c.f("openState")[k] == 1) c.wrong("a draft left after BEGIN");
                }
            });
    }

    @Test
    void letGoOwner() throws Exception {
        sweep("RESET_CARD P1=1 let-go (owner)", TearSweepTest::readyOwed,
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_RESET_CARD, 1, 0, ownerData(ownerProof(L_RESET, OWNER, n, new byte[] { 0 }), new byte[] { 0 })));
            },
            c -> {
                byte os = c.f("openState")[0];
                if (os != 0 && os != 2) c.wrong("opening state " + os);
            });
    }
}
