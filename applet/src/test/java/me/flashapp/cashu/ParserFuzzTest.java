package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;

import javacard.framework.OwnerPIN;
import javacard.security.ECPublicKey;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.*;

/**
 * The parser: every instruction, in every life state the card has, with P1/P2 over the interesting values and every
 * data length a short APDU carries, random data. The card's whole state (persistent and RAM, the PIN object and the owner
 * key) is put back before each command. Looked for: 6F00 (an exception the applet did not mean: an offset unchecked, an
 * array overrun, a null), and a refusal that wrote persistent memory first.
 */
class ParserFuzzTest {

    /** The applet's whole state, saved and put back. */
    static final class Saved {
        final Map<Field, Object> refs = new HashMap<>();
        final Map<Field, Object> copies = new HashMap<>();
        byte[] pinValue, triesLeft;
        boolean[] flags;
        Object pinSize;
        byte[] ownerW;

        Saved(Object applet) throws Exception {
            for (Field f : applet.getClass().getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers())) continue;
                f.setAccessible(true);
                Object v = f.get(applet);
                refs.put(f, v);
                if (v instanceof byte[]) copies.put(f, ((byte[]) v).clone());
                if (v instanceof short[]) copies.put(f, ((short[]) v).clone());
                if (v instanceof OwnerPIN) {
                    pinValue = ((byte[]) field(OwnerPIN.class, "pinValue").get(v)).clone();
                    triesLeft = ((byte[]) field(OwnerPIN.class, "triesLeft").get(v)).clone();
                    flags = ((boolean[]) field(OwnerPIN.class, "flags").get(v)).clone();
                    pinSize = field(OwnerPIN.class, "pinSize").get(v);
                }
                if (f.getName().equals("ownerKey") && ((ECPublicKey) v).isInitialized()) {
                    ownerW = new byte[65];
                    ((ECPublicKey) v).getW(ownerW, (short) 0);
                }
            }
        }

        void restore(Object applet) throws Exception {
            for (Map.Entry<Field, Object> e : refs.entrySet()) {
                Field f = e.getKey();
                if (Modifier.isFinal(f.getModifiers())) continue;
                if (f.get(applet) != e.getValue()) f.set(applet, e.getValue());
                Object c = copies.get(f);
                if (c instanceof byte[]) System.arraycopy(c, 0, e.getValue(), 0, ((byte[]) c).length);
                if (c instanceof short[]) System.arraycopy(c, 0, e.getValue(), 0, ((short[]) c).length);
                if (e.getValue() instanceof OwnerPIN) {
                    Object p = e.getValue();
                    System.arraycopy(pinValue, 0, field(OwnerPIN.class, "pinValue").get(p), 0, pinValue.length);
                    System.arraycopy(triesLeft, 0, field(OwnerPIN.class, "triesLeft").get(p), 0, triesLeft.length);
                    System.arraycopy(flags, 0, field(OwnerPIN.class, "flags").get(p), 0, flags.length);
                    field(OwnerPIN.class, "pinSize").set(p, pinSize);
                }
                if (f.getName().equals("ownerKey") && ownerW != null) ((ECPublicKey) e.getValue()).setW(ownerW, (short) 0, (short) 65);
            }
        }

        /** The persistent arrays that differ from what was saved: name and the first byte that differs. */
        List<String> persistentDiff(Object applet) throws Exception {
            List<String> out = new ArrayList<>();
            for (Map.Entry<Field, Object> e : refs.entrySet()) {
                Field f = e.getKey();
                boolean tr = false;
                for (String t : TearHook.TRANSIENT) if (t.equals(f.getName())) tr = true;
                if (tr) continue;
                Object now = f.get(applet);
                if (now != e.getValue()) { out.add(f.getName() + " (reference changed)"); continue; }
                Object c = copies.get(f);
                if (c instanceof byte[]) {
                    byte[] a = (byte[]) c, b = (byte[]) now;
                    for (int i = 0; i < a.length; i++) if (a[i] != b[i]) { out.add(f.getName() + "[" + i + "] " + a[i] + "->" + b[i]); break; }
                }
            }
            return out;
        }
    }

    static Field field(Class<?> c, String n) throws Exception {
        Field f = c.getDeclaredField(n);
        f.setAccessible(true);
        return f;
    }

    static final int[] INS = { 0x00, 0x01, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x20, 0x21,
        0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2E, 0x2F, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x40, 0x41,
        0x42, 0x43, 0x44, 0x45, 0x46, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0xA4, 0xC0, 0xCA, 0xFF };
    static final int[] P1S = { 0, 1, 2, 3, 4, 7, 8, 0x7F, 0x80, 0xFF };
    static final int[] P2S = { 0, 1, 2, 3, 0xAD, 0xDE, 0xFF };
    static final int[] LENS = { 0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 16, 17, 18, 19, 32, 33, 34, 37, 38, 41, 45, 46, 64, 65, 66, 72, 73, 74,
        80, 81, 82, 96, 97, 100, 113, 145, 146, 162, 163, 164, 165, 177, 178, 179, 194, 195, 200, 233, 244, 245, 246, 247, 250, 253, 254, 255 };

    final Map<String, Integer> sixF = new LinkedHashMap<>();
    final Map<String, Integer> wroteThenRefused = new LinkedHashMap<>();
    final Map<String, Integer> accepted = new TreeMap<>();
    long sent;

    /** Every command over the card as `make` leaves it. */
    void fuzz(String state, TearSweepTest.Step make) throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        c.scenario = state;
        make.run(c);
        c.teachForChange = false;
        TearHook.refresh();
        Saved saved = new Saved(c.applet);
        Random rnd = new Random(state.hashCode());
        for (int ins : INS) {
            for (int p1 : P1S) {
                for (int p2 : P2S) {
                    for (int len : LENS) {
                        byte[] data = new byte[len];
                        int pattern = rnd.nextInt(4);
                        if (pattern == 0) rnd.nextBytes(data);
                        else if (pattern == 1) Arrays.fill(data, (byte) 0xFF);
                        else if (pattern == 2) { rnd.nextBytes(data); if (len > 0) data[0] = (byte) rnd.nextInt(80); }
                        // pattern 3: zeros
                        one(c, saved, state, ins, p1, p2, data, len % 3 == 0 ? 0 : 256);
                    }
                }
            }
        }
    }

    void one(TearSweepTest.Card c, Saved saved, String state, int ins, int p1, int p2, byte[] data, int le) throws Exception {
        saved.restore(c.applet);
        c.rt.clearTx();
        TearHook.depth = 0;
        TearHook.lastThrown = null;
        CommandAPDU cmd = data.length == 0 ? (le == 0 ? new CommandAPDU(0xB0, ins, p1, p2) : new CommandAPDU(0xB0, ins, p1, p2, le))
            : (le == 0 ? new CommandAPDU(0xB0, ins, p1, p2, data) : new CommandAPDU(0xB0, ins, p1, p2, data, le));
        ResponseAPDU r = c.raw(cmd);
        sent++;
        int sw = r.getSW();
        String key = String.format("%s INS %02X", state, ins);
        if (sw == 0x6F00) {
            Throwable t = TearHook.lastThrown;
            String where = "?";
            if (t != null) for (StackTraceElement e : t.getStackTrace()) if (e.getClassName().startsWith("me.flashapp.cashu.CashuApplet")) { where = e.getMethodName() + ":" + e.getLineNumber(); break; }
            String k = String.format("%s P1 %02X P2 %02X Lc %d: %s at %s  e.g. %s", key, p1, p2, data.length, t, where, toHex(cmd.getBytes()));
            String dedupe = key + " " + (t == null ? "?" : t.getClass().getSimpleName()) + " " + where;
            if (!sixF.containsKey(dedupe)) System.out.println("6F00 " + k);
            sixF.merge(dedupe, 1, Integer::sum);
        } else if (sw != 0x9000 && sw != 0x6200 && sw != 0x6A98 && (sw & 0xFFF0) != 0x63C0 && sw != 0x6983) {
            List<String> d = saved.persistentDiff(c.applet);
            if (!d.isEmpty()) {
                String k = String.format("%s P2 %02X SW %04X wrote %s", key, p2, sw, d);
                String dedupe = String.format("%s SW %04X %s", key, sw, d.toString().replaceAll("\\[\\d+\\] -?\\d+->-?\\d+", ""));
                if (!wroteThenRefused.containsKey(dedupe)) System.out.println("WROTE-THEN-REFUSED " + k + "  e.g. " + toHex(cmd.getBytes()));
                wroteThenRefused.merge(dedupe, 1, Integer::sum);
            }
        }
        if (sw == 0x9000) accepted.merge(key, 1, Integer::sum);
    }

    void report() {
        System.out.println("===== PARSER FUZZ: " + sent + " commands");
        System.out.println("6F00 sites: " + sixF);
        System.out.println("refusals that wrote: " + wroteThenRefused);
        System.out.println("accepted (9000) per state and INS: " + accepted);
        System.out.println("transactions left open: " + TearHook.leftOpen);
        assertEquals(java.util.Collections.emptyMap(), sixF, "no command answers 6F00");
        assertEquals(java.util.Collections.emptyList(), new ArrayList<>(TearHook.leftOpen), "no command leaves a transaction open");
    }

    /** The report, and no refusal that wrote persistent memory first. */
    void reportNothingWritten() {
        report();
        assertEquals(java.util.Collections.emptyMap(), wroteThenRefused, "no refusal writes first");
    }

    // ---- the life states ----------------------------------------------------------------------------------------------

    static void pinOnly(TearSweepTest.Card c) {
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
    }

    static void openSetUp(TearSweepTest.Card c) {
        pinOnly(c);
        assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
        assertEquals(SW_OK, c.sim.transmitCommand(setTimeCommand(T0)).getSW());
        int sw = TearSweepTest.loadP(c, PROOF_1).getSW();
        System.out.println("open card load: " + Integer.toHexString(sw));
    }

    static void owned(TearSweepTest.Card c) {
        TearSweepTest.readyWithTwo(c, 100_000);
    }

    @Test
    void fuzzOne() throws Exception {
        long t = System.currentTimeMillis();
        fuzz("OWNED_PIN", ParserFuzzTest::owned);
        System.out.println("ms " + (System.currentTimeMillis() - t));
        reportNothingWritten();
    }

    @Test
    void fuzzAllStates() throws Exception {
        fuzz("FRESH", c -> { });
        fuzz("PIN_ONLY", ParserFuzzTest::pinOnly);
        fuzz("OPEN_SETUP", ParserFuzzTest::openSetUp);
        fuzz("OWNED_PIN", ParserFuzzTest::owned);
        fuzz("OWNED_NO_PIN", c -> { owned(c); c.sim.reset(); c.select(); });
        fuzz("MID_PAYMENT", c -> {
            owned(c);
            assertEquals(SW_OK, c.sw(CashuAppletTest.spendBegin(new byte[] { 0, 1 })));
        });
        fuzz("OWED_CHANGE", c -> {
            TearSweepTest.readyOwed(c);
        });
        fuzz("BLOCKED", c -> {
            owned(c);
            for (int i = 0; i < 3; i++) c.raw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, WRONG_PIN));
        });
        fuzz("LOCKED", c -> {
            TearSweepTest.ready(c, 0);
            byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(ownerProof(L_LOCK, OWNER, n, new byte[0]), new byte[0]))));
        });
        fuzz("AFTER_RESET", c -> {
            TearSweepTest.ready(c, 0);
            byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0]))));
        });
        reportNothingWritten();
    }

    @Test
    void detectorsWork() throws Exception {
        // a NullPointerException must show as 6F00 with its site, and a write before a refusal must be seen
        TearSweepTest.Card c = new TearSweepTest.Card();
        owned(c);
        TearHook.refresh();
        Saved saved = new Saved(c.applet);
        field(c.applet.getClass(), "cardLog").set(c.applet, null);
        one(c, new Saved(c.applet), "SANITY-null-cardLog", 0x18, 0, 0, new byte[0], 256);
        saved.restore(c.applet);
        System.out.println("sanity 6F00: " + sixF);
        assertEquals(1, sixF.size(), "a null planted in the log shows as 6F00 with its site");
    }

    /** The commands under the owner's proof, with a good proof over a value of every length the APDU leaves room for. */
    @Test
    void ownerProofValues() throws Exception {
        String[][] cmds = { { "42", "CashuCard/change-pin" }, { "43", "CashuCard/set-owner" }, { "45", "CashuCard/load" },
            { "50", "CashuCard/lock" }, { "51", "CashuCard/reset" }, { "52", "CashuCard/tag" }, { "53", "CashuCard/refresh" },
            { "34", "CashuCard/set-limit" }, { "32", "CashuCard/set-card" } };
        for (String state : new String[] { "OWNED_PIN", "OWNED_EMPTY", "LOCKED" }) {
            TearSweepTest.Card c = new TearSweepTest.Card();
            if (state.equals("OWNED_PIN")) owned(c); else TearSweepTest.ready(c, 0);
            if (state.equals("LOCKED")) {
                byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(ownerProof(L_LOCK, OWNER, n, new byte[0]), new byte[0]))));
            }
            TearHook.refresh();
            Saved saved = new Saved(c.applet);
            Random rnd = new Random(7);
            for (String[] cmd : cmds) {
                int ins = Integer.parseInt(cmd[0], 16);
                for (int[] pp : new int[][] { { 0, 0 }, { 1, 0 }, { 0, 0xAD }, { 0, 0xDE }, { 1, 1 }, { 2, 0 }, { 0xFF, 0xFF } }) {
                    for (int vlen = 0; vlen <= 180; vlen++) {
                        saved.restore(c.applet);
                        c.rt.clearTx();
                        byte[] n = c.raw(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
                        byte[] v = new byte[vlen];
                        rnd.nextBytes(v);
                        if (vlen > 0 && rnd.nextBoolean()) v[0] = 0x04;
                        byte[] proof = ownerProof(cmd[1], OWNER, n, v);
                        byte[] data = ownerData(proof, v);
                        if (data.length > 255) continue;
                        Saved before = new Saved(c.applet);
                        TearHook.lastThrown = null;
                        ResponseAPDU r = c.raw(new CommandAPDU(CLA, ins, pp[0], pp[1], data, 256));
                        int sw = r.getSW();
                        sent++;
                        String key = String.format("%s INS %02X P1 %02X P2 %02X value %d", state, ins, pp[0], pp[1], vlen);
                        if (sw == 0x6F00) {
                            Throwable t = TearHook.lastThrown;
                            String where = "?";
                            if (t != null) for (StackTraceElement e : t.getStackTrace()) if (e.getClassName().startsWith("me.flashapp.cashu.CashuApplet")) { where = e.getMethodName() + ":" + e.getLineNumber(); break; }
                            System.out.println("6F00 " + key + ": " + t + " at " + where);
                            sixF.merge(String.format("%s INS %02X %s", state, ins, where), 1, Integer::sum);
                        } else if (sw != 0x9000) {
                            List<String> d = before.persistentDiff(c.applet);
                            d.removeIf(x -> x.startsWith("cardRecord[158]") || x.startsWith("cardRecord[205]") || x.startsWith("cardRecord[206]")
                                || x.startsWith("cardRecord[207]") || x.startsWith("cardRecord[208]") || x.startsWith("cardRecord[163]"));
                            if (!d.isEmpty()) {
                                String k = String.format("%s INS %02X SW %04X", state, ins, sw);
                                if (!wroteThenRefused.containsKey(k)) System.out.println("WROTE-THEN-REFUSED " + key + String.format(" SW %04X ", sw) + d);
                                wroteThenRefused.merge(k, 1, Integer::sum);
                            }
                        } else {
                            accepted.merge(key.replaceAll(" value \\d+", "") + " value " + vlen, 1, Integer::sum);
                        }
                    }
                }
            }
        }
        report();
    }

    /** Extended lengths, which this applet does not declare (no ExtendedLength): what jCardSim makes of them. */
    @Test
    void extendedLengths() throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        owned(c);
        TearHook.refresh();
        Saved saved = new Saved(c.applet);
        for (int ins : INS) {
            for (int len : new int[] { 256, 300, 600, 1000, 4000 }) {
                saved.restore(c.applet);
                c.rt.clearTx();
                TearHook.lastThrown = null;
                ResponseAPDU r;
                try {
                    r = c.raw(new CommandAPDU(CLA, ins, 0, 0, new byte[len], 65536));
                } catch (Exception e) {
                    System.out.println(String.format("EXT INS %02X len %d: the simulator threw %s", ins, len, e));
                    continue;
                }
                if (r.getSW() != 0x6700 && r.getSW() != 0x6D00) System.out.println(String.format("EXT INS %02X len %d: %04X %d bytes %s", ins, len, r.getSW(), r.getData().length, TearHook.lastThrown));
            }
            saved.restore(c.applet);
            ResponseAPDU r = c.raw(new CommandAPDU(CLA, ins, 0, 0, 65536));
            if (r.getSW() == 0x6F00) System.out.println(String.format("EXT-LE INS %02X: 6F00 %s", ins, TearHook.lastThrown));
        }
    }

    static void certified(TearSweepTest.Card c) {
        byte[] k = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
        byte[] head = concat("CCP-CERT".getBytes(), new byte[] { 1, 1 }, Arrays.copyOf(k, 33), new byte[6]);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, 0x54, 0, 0, concat(new byte[] { 0, 0 }, head))));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, 0x54, 1, 0, concat(new byte[] { 0, (byte) head.length }, sha256(head)))));
        assertEquals(1, c.send(new CommandAPDU(CLA, 0x1C, 0xFF, 0, 256)).getData()[0]);
    }

    @Test
    void fuzzMoreStates() throws Exception {
        fuzz("CERTIFIED_FRESH", ParserFuzzTest::certified);
        fuzz("CERTIFIED_OWNED", c -> { certified(c); owned(c); });
        fuzz("CERTIFIED_AFTER_RESET", c -> {
            certified(c);
            TearSweepTest.ready(c, 0);
            byte[] n = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0]))));
        });
        fuzz("TEACHING", c -> {
            owned(c);
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, 0x38, 0, 0, hexToBytes(KEYSET))));
        });
        fuzz("OPEN_HELD", c -> {
            openSetUp(c);
            c.sim.reset(); c.select();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_GET_LOG, 0, 0, 256)));
        });
        fuzz("CLAIMED_TAP", c -> {
            TearSweepTest.ready(c, 0);
            c.sim.reset(); c.select();
        });
        reportNothingWritten();
    }
}
