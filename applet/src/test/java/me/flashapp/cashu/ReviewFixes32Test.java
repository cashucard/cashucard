package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D244: the fixes of 3.2 from the outside review of 3.1 at de39f68. A reset torn anywhere is the old card or a new one, never
 * the old owner under a new card key (APP-H1); a reset clears the self-tests' verdicts (APP-M2); a forgotten PIN's replacement
 * frees the spent places and draws a new c (APP-M1); a hand-over on a chip whose key writes take no part in a transaction
 * never gives the next owner the last owner's c (APP-M5); LOAD_CHANGE refuses an s at or over n (APP-L5). The tear harness
 * draws a key pair of its own at every genKeyPair here (`TearHook.freshKeys`), which jCardSim's generator does not.
 */
class ReviewFixes32Test {

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterEach
    void plainHarness() {
        TearHook.freshKeys = false;
        TearHook.keysOutsideTx = false;
        TearHook.tearAfterCommit = null;
        TearHook.target = 0;
        TearHook.trace = null;
    }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static byte[] pub(TearSweepTest.Card c) { return c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }

    static int ownerReset(TearSweepTest.Card c, Key owner) {
        byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        return c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, owner, n, new byte[0]), new byte[0])));
    }

    static Object get(Object o, String name) throws Exception {
        java.lang.reflect.Field f = o.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f.get(o);
    }

    static void set(Object o, String name, Object v) throws Exception {
        java.lang.reflect.Field f = o.getClass().getDeclaredField(name);
        f.setAccessible(true);
        f.set(o, v);
    }

    // ---- APP-H1: the reset's keys after its commit ----------------------------------------------------------------------

    @Test
    @DisplayName("D244 (APP-H1): a RESET_CARD by the owner torn after any of its writes, with a key pair of its own at every draw, is the old card under its old key with its owner (who resets it again) or a new card under a new key with no owner; never the owner kept under a key its owner's key was not worked out from")
    void aResetTornAnywhereIsTheOldCardOrANewOne() throws Exception {
        TearHook.freshKeys = true;
        final byte[][] before = new byte[1][];
        sweep("RESET_CARD (owner), keys drawn fresh", c -> { ready(c, 0); before[0] = pub(c); },
            c -> ownerReset(c, OWNER),
            c -> {
                byte os = c.f("ownerSet")[0];
                byte[] now = pub(c);
                if ((c.f("pinMarks")[CashuApplet.PM_FORGET] & CashuApplet.ROTATE_KEYS) != 0) c.wrong("the new keys still owed after a command");
                if (os == 1) {
                    if (!Arrays.equals(now, before[0])) c.wrong("the owner kept under a new card key: an owner's key worked out from the card's no longer works it");
                    int s = ownerReset(c, OWNER);
                    if (s != SW_OK) c.wrong(String.format("the owner's reset again answers %04X", s));
                    if (Arrays.equals(pub(c), before[0])) c.wrong("the reset done again left the old key");
                } else if (Arrays.equals(now, before[0])) {
                    c.wrong("a new card under the old card's key");
                }
                int a = c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN));
                if (a != SW_OK) c.wrong(String.format("after the reset, SET_PIN answers %04X", a));
            });
    }

    @Test
    @DisplayName("D244 (APP-H1): a RESET_CARD torn right after the commit that makes it a new card has its new keys drawn at the next command, before GET_PUBKEY answers: a new key, the PIN key's signature let go, and the mark down")
    void aResetTornAfterItsCommitDrawsItsKeysAtTheNextCommand() throws Exception {
        TearHook.freshKeys = true;
        TearSweepTest.Card t = new TearSweepTest.Card();
        ready(t, 0);
        byte[] old = pub(t);
        byte[] oldPin = Arrays.copyOfRange(t.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), 16, 49);
        assertEquals(1, t.f("pinKeySig")[0], "the PIN key's signature made at the first asking");
        TearHook.tearAfterCommit = "processResetCard";
        try {
            ownerReset(t, OWNER);
        } catch (Throwable torn) {
            // the card left the field
        }
        assertNotNull(TearHook.tornAt, "the reset was torn");
        assertTrue(TearHook.tornAt.startsWith("after the commit @processResetCard"), TearHook.tornAt);
        assertEquals(CashuApplet.ROTATE_KEYS, t.f("pinMarks")[CashuApplet.PM_FORGET], "the keys owed, and nothing else");
        assertEquals(0, t.f("ownerSet")[0], "a new card");
        t.powerCycle();
        assertEquals(0, t.f("pinMarks")[CashuApplet.PM_FORGET], "drawn at the SELECT, the mark down");
        assertFalse(Arrays.equals(old, pub(t)), "a new card key");
        assertEquals(0, t.f("pinKeySig")[0], "the old PIN key's signature let go");
        byte[] newPin = Arrays.copyOfRange(t.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), 16, 49);
        assertFalse(Arrays.equals(oldPin, newPin), "a new PIN key");
    }

    // ---- APP-M2: the verdicts with selfTested -------------------------------------------------------------------------------

    @Test
    @DisplayName("D244 (APP-M2): a RESET_CARD clears the self-tests' verdicts with selfTested (curveByAgreement, fieldP, the square's, SchnorrHW.chipMul) in its last transaction, and the next SET_CARD works them out again; GET_INFO P1 = 4's byte 56 says fieldP (bit 2), and not after the reset")
    void aResetClearsTheVerdicts() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Object applet = c.applet();
        assertTrue((Boolean) get(applet, "selfTested"));
        assertTrue((Boolean) get(applet, "fieldSquare"), "the square held to its known answers in the simulator (over the p*p modulus: fieldP is false here)");
        // a verdict each, set as a chip that passed sets them, or as a glitch would plant them
        set(applet, "curveByAgreement", true);
        set(applet, "fieldP", true);
        Object signer = get(applet, "schnorrHW");
        set(signer, "chipMul", true);
        assertEquals(0x07, c.info(4)[56], "the certificate, keys per load, and the field's arithmetic over p (INFO_FLAG_FIELD_P)");
        set(applet, "fieldP", false);
        assertEquals(0x03, c.info(4)[56], "and without it, bit 2 clear");
        set(applet, "fieldP", true);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertFalse((Boolean) get(applet, "selfTested"));
        assertFalse((Boolean) get(applet, "curveByAgreement"), "the key agreement's verdict");
        assertFalse((Boolean) get(applet, "fieldP"), "the field's");
        assertFalse((Boolean) get(applet, "fieldSquare"), "the square's");
        assertFalse((Boolean) get(signer, "chipMul"), "the signature's squaring's");
        assertEquals(0x03, c.info(4)[56], "bit 2 clear until the next SET_CARD works fieldP out again");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertTrue((Boolean) get(applet, "selfTested"), "the next SET_CARD ran the self-tests");
        assertTrue((Boolean) get(applet, "fieldSquare"), "and the square's known answers again");
        assertFalse((Boolean) get(applet, "fieldP"), "fieldP as the simulator answers it: false (it refuses p for a modulus)");
    }

    // ---- APP-M1: a forgotten PIN's replacement -----------------------------------------------------------------------------

    @Test
    @DisplayName("D244 (APP-M1): a forgotten PIN replaced on an empty card with no owner frees the spent places and their proofs, empties the paid list and draws a new c, so the reader that replaced it reads no piece and no date's keys of the holder before it")
    void aForgottenPinsReplacementFreesTheSpentPlacesAndDrawsANewC() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        int p = c.put(-1, KeysetKeysTest.A.id8(), 64);
        c.tap();
        assertEquals(64, c.pay(p).getData().length, "paid: one spent place");
        c.power();
        for (int k = 1; k <= 3; k++) assertEquals(0x63C0 | k, PinWaitTest.asked(c, WRONG_PIN)[1]);
        byte[] cBefore = Arrays.copyOf(c.field("chain"), 32);
        assertEquals(1, c.info(0)[4], "one spent place before");
        assertTrue(Util16.get(c.field("paid"), 1024 * 8) > 0, "a row on the paid list");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "three wrong tries on an empty card: replaced");
        assertEquals(0, c.info(0)[4], "no spent place left");
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, INS_GET_PROOF, p, 0, 256)), "the holder's spent piece is gone");
        assertFalse(Arrays.equals(cBefore, Arrays.copyOf(c.field("chain"), 32)), "a new c: no date's keys of the holder before");
        assertEquals(0, Util16.get(c.field("paid"), 1024 * 8), "the paid list empty");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FORGET], "and nothing owed");
        assertEquals(SW_OK, PinWaitTest.verify(c, NEW_PIN).getSW(), "the new PIN");
    }

    /** A big-endian short. */
    static final class Util16 {
        static int get(byte[] a, int off) { return ((a[off] & 0xFF) << 8) | (a[off + 1] & 0xFF); }
    }

    // ---- APP-M5: a hand-over on a chip whose key writes take no part in a transaction ------------------------------------------

    @Test
    @DisplayName("D244 (APP-M5): a hand-over torn after any write, on a chip whose key writes take no part in a transaction, leaves one owner; and where the next owner's key is the card's, the card's c is not the last owner's and its history is owed to go or gone")
    void aHandOverNeverGivesTheNextOwnerTheLastOwnersC() throws Exception {
        TearHook.keysOutsideTx = true;
        final byte[][] cOld = new byte[1][];
        sweep("SET_OWNER by the old owner's proof, key writes outside the transaction", c -> { ready(c, 0); cOld[0] = Arrays.copyOf(c.f("chain"), 32); },
            c -> {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, OTHER_OWNER.pub), OTHER_OWNER.pub)));
            },
            c -> {
                boolean[] works = new boolean[2];
                Key[] keys = { OWNER, OTHER_OWNER };
                for (int i = 0; i < 2; i++) {
                    byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                    works[i] = c.sw(new CommandAPDU(CLA, INS_SET_TAG, 1, 0, ownerData(ownerProof(L_TAG, keys[i], n, new byte[] { 1 }), new byte[] { 1 }))) == SW_OK;
                }
                if (works[0] == works[1]) c.wrong("owners' proofs that work: the last's " + works[0] + ", the next's " + works[1]);
                if (works[1] && Arrays.equals(cOld[0], Arrays.copyOf(c.f("chain"), 32))) c.wrong("the next owner has the last owner's c");
                if (works[1] && (c.f("pinMarks")[CashuApplet.PM_FORGET] & CashuApplet.PIN_OWED) == 0) c.wrong("the next owner has the last owner's PIN");
            });
    }

    // ---- APP-L5: s under n ----------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("D244 (APP-L5): LOAD_CHANGE refuses an s at or over n (6A80): nothing is written, the opening stays owed, and the right answer goes on after it")
    void aLoadChangeWithAnSOverNIsRefused() throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        readyOwed(c);
        byte[] good = answerFor(c);
        byte[] at = good.clone();
        System.arraycopy(unsigned32(SECP_N), 0, at, CashuApplet.LC_S, 32);
        byte[] over = good.clone();
        Arrays.fill(over, CashuApplet.LC_S, CashuApplet.LC_S + 32, (byte) 0xFF);
        long b = c.balance();
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(0, at)), "s = n");
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(0, over)), "s = 2^256 - 1");
        assertEquals(b, c.balance(), "nothing written");
        assertEquals(CashuApplet.OPEN_PENDING, c.f("openState")[0], "the opening still owed");
        assertEquals(SW_OK, c.sw(loadChangeCommand(0, good)), "the mint's own answer goes on");
        assertEquals(b + 500, c.balance());
    }

    // ---- PERF-CARD-04: the staged outputs in RAM, the record a buffer at a time -----------------------------------------------

    @Test
    @DisplayName("D244: the staged outputs are RAM that a selection clears (CLEAR_ON_DESELECT), reserved at the first SET_CARD")
    void theStagedOutputsAreRam() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] stage = (byte[]) get(c.applet(), "outStage");
        assertNotNull(stage);
        assertEquals(CashuApplet.OUT_STAGE_LEN, stage.length);
        assertEquals(javacard.framework.JCSystem.CLEAR_ON_DESELECT, javacard.framework.JCSystem.isTransient(stage), "RAM cleared at a selection");
    }

    @Test
    @DisplayName("D244: a payment's settlement record is written in a few parts of up to 256 bytes and one transaction (the one that marks it whole), where 3.1 wrote it in some sixty small writes after a transaction of its own; the record served is the same")
    void theRecordIsWrittenABufferAtATime() throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        readyWithTwo(c, 0);
        TearHook.trace = new ArrayList<>();
        assertEquals(64, pay(c).getData().length, "paid, with change");
        List<String> trace = TearHook.trace;
        TearHook.trace = null;
        int parts = 0, commits = 0, small = 0;
        for (String t : trace) {
            if (!t.contains("@writeOutbox")) continue;
            if (t.contains("commit @writeOutbox")) commits++;
            if (t.contains("arrayCopyNonAtomic outbox[") && !t.contains("HALF")) parts++;
            if (t.contains(" outbox[") && !t.contains("arrayCopyNonAtomic") && !t.contains("[tx]")) small++;
        }
        assertEquals(1, commits, "one transaction, the one that marks the record whole: " + trace);
        assertTrue(parts >= 2 && parts <= 4, "the body in a few parts: " + parts);
        assertTrue(small <= 1, "and no other write but the descriptor's mark: " + small);
        ResponseAPDU scope = c.send(new CommandAPDU(CLA, 0x1B, 0, 0, 256));
        assertEquals(SW_OK, scope.getSW(), "the record is there");
    }

    // ---- PERF-CARD-05: B_'s y kept, LOAD_CHANGE one transaction ---------------------------------------------------------------

    @Test
    @DisplayName("D244: SPEND_ALL_CHANGE keeps B_'s y beside B_ (OPEN_KEYS_ROW 99), GET_CHANGE still answers B_ and K compressed (83 bytes a row), and LOAD_CHANGE commits the piece, the opening, the day and the log in one transaction")
    void anOpeningKeepsItsYAndLoadChangeIsOneTransaction() throws Exception {
        assertEquals(99, CashuApplet.OPEN_KEYS_ROW);
        assertEquals(66, CashuApplet.OPEN_KEYS_LEN);
        TearSweepTest.Card c = new TearSweepTest.Card();
        readyOwed(c);
        byte[] page = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData();
        assertEquals(1 + 83, page.length, "one row, 83 bytes as in 3.1");
        byte[] b33 = Arrays.copyOfRange(page, 18, 51);
        BigInteger[] b = decompressed(b33);
        byte[] keys = c.f("openKeys");
        assertArrayEquals(b33, Arrays.copyOfRange(keys, 0, 33), "B_ compressed");
        assertArrayEquals(unsigned32(b[1]), Arrays.copyOfRange(keys, 67, 99), "and its y");
        byte[] ans = answerFor(c);
        int loadsBefore = loadsLogged(c.f("cardLog"));
        TearHook.trace = new ArrayList<>();
        assertEquals(SW_OK, c.sw(loadChangeCommand(0, ans)));
        List<String> trace = TearHook.trace;
        TearHook.trace = null;
        long commits = trace.stream().filter(t -> t.contains(" commit @")).count();
        assertEquals(1, commits, "one transaction: " + trace);
        assertEquals(500, c.balance());
        assertEquals(loadsBefore + 1, loadsLogged(c.f("cardLog")), "the log has the piece put on, in that commit");
    }

    /** The pieces put on, summed over the log's eight entries. */
    static int loadsLogged(byte[] log) {
        int n = 0;
        for (int e = 0; e < 8; e++) n += log[CashuApplet.LOG_HEAD_LEN + e * CashuApplet.LOG_ENTRY_LEN + CashuApplet.LOG_E_LOADS] & 0xFF;
        return n;
    }

    // ---- PERF-CARD-07: the square ----------------------------------------------------------------------------------------------

    static byte[] p65(BigInteger x, BigInteger y) { return concat(new byte[] { 4 }, unsigned32(x), unsigned32(y)); }

    @Test
    @DisplayName("D244: requireFullPoint by the square holds a point to the curve exactly, as Euler's test and the root did: G and -G pass; y + 1, y = 0, x or y at p or over, and a twist's x refused (6A80); the same answers with the square's verdict off")
    void theSquareHoldsAPointToTheCurve() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Object applet = c.applet();
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod("requireFullPoint", byte[].class, short.class);
        m.setAccessible(true);
        BigInteger twistX = BigInteger.ONE;
        while (liftX(twistX) != null) twistX = twistX.add(BigInteger.ONE);
        BigInteger[] g = { SECP_GX, SECP_GY };
        BigInteger[] eleven = ecMulTest(BigInteger.valueOf(11), SECP_GX, SECP_GY);
        Object[][] cases = {
            { p65(g[0], g[1]), true, "G" },
            { p65(g[0], SECP_P.subtract(g[1])), true, "-G" },
            { p65(eleven[0], eleven[1]), true, "11G" },
            { p65(g[0], g[1].add(BigInteger.ONE)), false, "G's x, y + 1" },
            { p65(g[0], BigInteger.ZERO), false, "y = 0" },
            { p65(BigInteger.ZERO, BigInteger.ZERO), false, "(0, 0)" },
            { p65(g[0], g[1].add(SECP_P).mod(BigInteger.ONE.shiftLeft(256))), false, "y + p (under 2^256)" },
            { p65(SECP_P, g[1]), false, "x = p" },
            { p65(twistX, BigInteger.valueOf(2)), false, "an x on the twist" },
            { concat(new byte[] { 2 }, unsigned32(g[0]), unsigned32(g[1])), false, "not the 04 form" },
        };
        for (boolean square : new boolean[] { true, false }) {
            set(applet, "fieldSquare", square);
            for (Object[] k : cases) {
                byte[] buf = concat(new byte[7], (byte[]) k[0]);
                boolean ok;
                try {
                    m.invoke(applet, buf, (short) 7);
                    ok = true;
                } catch (java.lang.reflect.InvocationTargetException e) {
                    assertTrue(e.getCause() instanceof javacard.framework.ISOException, k[2] + ": " + e.getCause());
                    assertEquals(SW_WRONG_DATA, ((javacard.framework.ISOException) e.getCause()).getReason() & 0xFFFF, (String) k[2]);
                    ok = false;
                }
                assertEquals(k[1], ok, k[2] + (square ? " (the square)" : " (Euler and the root)"));
            }
        }
    }

    @Test
    @DisplayName("D244: blindChange by the square and by Euler's test makes the same points, each the one its opening gives, and leaves B_'s y at buf[33..65)")
    void blindChangeBothWays() throws Exception {
        com.licel.jcardsim.smartcardio.CardSimulator sim;
        CashuAppletTest.ExposedRuntime fresh = new CashuAppletTest.ExposedRuntime();
        sim = new com.licel.jcardsim.smartcardio.CardSimulator(fresh);
        sim.installApplet(com.licel.jcardsim.utils.AIDUtil.create(AID_HEX), CashuApplet.class);
        sim.selectApplet(com.licel.jcardsim.utils.AIDUtil.create(AID_HEX));
        readyOn(sim, 0);
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, buildProof(KEYSET, 100, 1), 1)).getSW());
        javacard.framework.Applet applet = fresh.appletAt(com.licel.jcardsim.utils.AIDUtil.create(AID_HEX));
        assertEquals(SW_OK, sim.transmitCommand(spendBegin(new byte[] { 0 })).getSW());
        DateKeys keys = DateKeys.of(applet);
        java.lang.reflect.Method blind = CashuApplet.class.getDeclaredMethod("blindChange", short.class, short.class, byte[].class);
        blind.setAccessible(true);
        byte[] changeOpen = (byte[]) get(applet, "changeOpen");
        for (boolean square : new boolean[] { true, false }) {
            set(applet, "fieldSquare", square);
            for (int i = 0; i < 60; i++) {
                int open = (i % 8) * 80;
                byte[] buf = new byte[261];
                blind.invoke(applet, (short) 0, (short) open, buf);
                byte[] made = Arrays.copyOfRange(buf, 0, 33);
                byte[] nonce = Arrays.copyOfRange(changeOpen, open + 16, open + 48), r = Arrays.copyOfRange(changeOpen, open + 48, open + 80);
                byte[] secret = keys.secret(nonce, 0).getBytes(java.nio.charset.StandardCharsets.UTF_8);
                assertArrayEquals(made, blindedFor(secret, r), (square ? "the square" : "Euler") + ", round " + i);
                assertArrayEquals(unsigned32(decompressed(made)[1]), Arrays.copyOfRange(buf, 33, 65), "and B_'s y beside it, round " + i);
            }
        }
    }
}
