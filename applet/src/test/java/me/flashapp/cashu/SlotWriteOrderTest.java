package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.base.SimulatorRuntime;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javacard.framework.Applet;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ENG-620: a proof slot survives the card leaving the field mid-write.
 *
 * A slot is status[1] ‖ keyset[8] ‖ amount[4] ‖ nonce[32] ‖ C[33] ‖ date[4], and every
 * reader trusts the status byte: GET_BALANCE sums the UNSPENT slots and
 * SPEND_ALL_SIGN signs for them. So the status byte is the slot's commit. It is
 * written as a single byte, which the JCRE makes atomic, and only after every
 * other write to the slot, so a tear leaves a slot in its old state and never
 * in a new state over old bytes. Written first, it once let a tear turn an
 * empty slot into a phantom UNSPENT proof, and a torn CLEAR_SPENT followed by
 * a torn LOAD_PROOF resurrect a spent proof's amount.
 *
 * jCardSim cannot tear a write, so this is checked two ways, as D10 is: the
 * order is scanned in the source, and the states a tear can now leave are set
 * in the slot storage directly and shown to be harmless to every command.
 *
 * Software 1.20 keeps beside each place the mint's proof for its piece (`dleq`,
 * one record of 96 bytes for each place). The status byte is still the commit,
 * and the record is written before the place's data and so long before it: a
 * tear then leaves an EMPTY place with some record beside it, which nothing
 * serves, and the next load writes its own record over it, or zeros. The same two
 * ways hold it.
 */
class SlotWriteOrderTest {

    // ── the order, in the source ─────────────────────────────────────────────

    @Test
    @DisplayName("every slot writer commits the status byte last, and no bulk write covers it")
    void appletCommitsTheStatusByteLast() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(
                SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);

        List<String> violations = slotWriteViolations(src);
        assertTrue(violations.isEmpty(), String.join("\n", violations));

        // A scan that matched nothing would prove nothing: LOAD_PROOF,
        // CLEAR_SPENT and SPEND_ALL_SIGN each commit a status byte.
        long commits = slotWrites(src).stream().filter(w -> w.status).count();
        assertTrue(commits >= 3, "expected the three status commits, found " + commits);
    }

    @Test
    @DisplayName("the scan fails a status-first load, a whole-slot clear and a write after the commit")
    void theScanCanSayNo() {
        String statusFirst = "class A { void load() {"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_UNSPENT;"
            + " Util.arrayCopy(buf, (short) 5, proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN);"
            + " } }";
        String wholeSlot = "class A { void clear() {"
            + " Util.arrayFillNonAtomic(proofStorage, base, PROOF_SIZE, (byte) 0);"
            + " } }";
        String afterCommit = "class A { void f() {"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_SPENT;"
            + " proofStorage[(short)(base + 9)] = (byte) 0;"
            + " } }";
        // A status byte written without naming its offset is still a commit.
        String unnamedStatus = "class A { void clear() {"
            + " proofStorage[base] = STATUS_EMPTY;"
            + " Util.arrayFillNonAtomic(proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN, (byte) 0);"
            + " } }";
        String good = "class A {"
            + " void load() {"
            + "  Util.arrayCopy(buf, (short) 5, proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN);"
            + "  proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_UNSPENT;"
            + " }"
            + " void clear() {"
            + "  for (short i = 0; i < MAX_PROOFS; i++) {"
            + "   Util.arrayFillNonAtomic(proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN, (byte) 0);"
            + "   proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_EMPTY;"
            + "  }"
            + " }"
            + " boolean read() { return proofStorage[(short)(base + PROOF_STATUS_OFFSET)] == STATUS_UNSPENT; }"
            + " }";

        assertFalse(slotWriteViolations(statusFirst).isEmpty(), "status-first load passed");
        assertFalse(slotWriteViolations(wholeSlot).isEmpty(), "whole-slot fill passed");
        assertFalse(slotWriteViolations(afterCommit).isEmpty(), "write after the commit passed");
        assertFalse(slotWriteViolations(unnamedStatus).isEmpty(), "unnamed status commit passed");
        assertTrue(slotWriteViolations(good).isEmpty(), String.join("\n", slotWriteViolations(good)));
    }

    /** One write to proofStorage, in the comment-stripped source. */
    private static final class SlotWrite {
        final int at;
        final boolean status;
        final String text;

        SlotWrite(int at, boolean status, String text) {
            this.at = at;
            this.status = status;
            this.text = text;
        }
    }

    // proofStorage[...] = …, and the compound forms; not ==.
    private static final Pattern ELEMENT_WRITE = Pattern.compile(
        "proofStorage\\s*\\[([^\\]]*)\\]\\s*(?:[-+*/%&|^]|<<|>>>?)?=(?!=)([^;]*);");
    private static final Pattern BULK_WRITE = Pattern.compile(
        "Util\\.(arrayCopy|arrayCopyNonAtomic|arrayFill|arrayFillNonAtomic)\\s*\\(");
    // Any slot field offset but the status byte's.
    private static final Pattern DATA_OFFSET = Pattern.compile("PROOF_(?!STATUS_)[A-Z_]*OFFSET");

    private static List<SlotWrite> slotWrites(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        List<SlotWrite> writes = new ArrayList<>();
        Matcher element = ELEMENT_WRITE.matcher(src);
        while (element.find()) {
            boolean status = element.group(1).contains("PROOF_STATUS_OFFSET")
                || element.group(2).contains("STATUS_");
            writes.add(new SlotWrite(element.start(), status, element.group().trim()));
        }
        Matcher bulk = BULK_WRITE.matcher(src);
        while (bulk.find()) {
            List<String> args = arguments(src, bulk.end() - 1);
            boolean fill = bulk.group(1).startsWith("arrayFill");
            String destination = args.get(fill ? 0 : 2).trim();
            if (destination.equals("proofStorage")) {
                writes.add(new SlotWrite(bulk.start(), false, bulk.group() + String.join(",", args) + ")"));
            }
        }
        writes.sort((a, b) -> Integer.compare(a.at, b.at));
        return writes;
    }

    /**
     * Violations of the slot commit rule in a source file:
     * - a bulk write (arrayCopy/arrayFill) into proofStorage whose offset does
     *   not name a data field, and so can start at the status byte;
     * - any write to proofStorage after a status write in the same method.
     */
    static List<String> slotWriteViolations(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        int[] method = methodBodies(src);
        List<String> violations = new ArrayList<>();
        List<SlotWrite> writes = slotWrites(rawSrc);

        Matcher bulk = BULK_WRITE.matcher(src);
        while (bulk.find()) {
            List<String> args = arguments(src, bulk.end() - 1);
            boolean fill = bulk.group(1).startsWith("arrayFill");
            if (!args.get(fill ? 0 : 2).trim().equals("proofStorage")) continue;
            String offset = args.get(fill ? 1 : 3);
            if (!DATA_OFFSET.matcher(offset).find()) {
                violations.add("a bulk write into proofStorage can cover the status byte (offset '"
                    + offset.trim() + "'): write the data fields, then the status byte alone");
            }
        }

        for (int i = 0; i < writes.size(); i++) {
            SlotWrite commit = writes.get(i);
            if (!commit.status) continue;
            for (int j = i + 1; j < writes.size(); j++) {
                SlotWrite later = writes.get(j);
                if (method[later.at] != method[commit.at] || method[commit.at] < 0) break;
                if (!later.status) {
                    violations.add("'" + later.text + "' writes the slot after its status byte was"
                        + " committed ('" + commit.text + "'): a tear between them leaves the new"
                        + " status over old bytes");
                }
            }
        }
        return violations;
    }

    /** For each index, the open brace of the method body it sits in, or -1. */
    private static int[] methodBodies(String src) {
        int[] depth = SchnorrHWMathTest.braceDepths(src);
        int[] method = new int[src.length()];
        int current = -1;
        for (int i = 0; i < src.length(); i++) {
            if (src.charAt(i) == '{' && depth[i] == 2) current = i;
            method[i] = depth[i] >= 2 ? current : -1;
        }
        return method;
    }

    /** The top-level comma-separated arguments of the call whose '(' is at `open`. */
    private static List<String> arguments(String src, int open) {
        List<String> args = new ArrayList<>();
        int depth = 0;
        int start = open + 1;
        for (int i = open; i < src.length(); i++) {
            char c = src.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                if (--depth == 0) {
                    args.add(src.substring(start, i));
                    return args;
                }
            } else if (c == ',' && depth == 1) {
                args.add(src.substring(start, i));
                start = i + 1;
            }
        }
        throw new IllegalStateException("unbalanced call at " + open);
    }

    // ── the states a tear can now leave ──────────────────────────────────────

    /** A runtime that hands the test its applet, so a slot can be set to what a tear leaves. */
    private static final class ExposedRuntime extends SimulatorRuntime {
        Applet appletAt(AID aid) {
            return getApplet(aid);
        }
    }

    private static final byte CLA = CashuAppletTest.CLA;
    private CardSimulator sim;
    private byte[] storage;
    /** The text kept beside each place for a payment to hash (CashuApplet.slotHex), live. */
    private byte[] hex;
    /** The card's own log (cardLog) and its receipts (cardReceipts), live: what a tear before their write leaves is set by putting back what they were. */
    private byte[] cardLog, cardReceipts;
    /** The store of the mint's proofs (1.20), live: the set-up has reserved it. */
    private byte[] proofStore;
    /** The payment's note and its list of places, live: what a tear after the commit and before the marking leaves is set by hand. */
    private byte[] burnPending, burnList;

    private void freshCard() throws Exception {
        ExposedRuntime runtime = new ExposedRuntime();
        sim = new CardSimulator(runtime);
        AID aid = AIDUtil.create(CashuAppletTest.AID_HEX);
        sim.installApplet(aid, CashuApplet.class);
        ResponseAPDU select = sim.transmitCommand(new CommandAPDU(
            0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR)));
        assertEquals(CashuAppletTest.SW_OK, select.getSW());
        // the fork loads nothing without a PIN, an owner, a card record and a time; with no limit set it spends what it holds
        CashuAppletTest.readyOn(sim, 0);
        java.lang.reflect.Field field = CashuApplet.class.getDeclaredField("proofStorage");
        field.setAccessible(true);
        storage = (byte[]) field.get(runtime.appletAt(aid));
        java.lang.reflect.Field hexField = CashuApplet.class.getDeclaredField("slotHex");
        hexField.setAccessible(true);
        hex = (byte[]) hexField.get(runtime.appletAt(aid));
        java.lang.reflect.Field logField = CashuApplet.class.getDeclaredField("cardLog");
        logField.setAccessible(true);
        cardLog = (byte[]) logField.get(runtime.appletAt(aid));
        java.lang.reflect.Field receiptField = CashuApplet.class.getDeclaredField("cardReceipts");
        receiptField.setAccessible(true);
        cardReceipts = (byte[]) receiptField.get(runtime.appletAt(aid));
        java.lang.reflect.Field storeField = CashuApplet.class.getDeclaredField("dleq");
        storeField.setAccessible(true);
        proofStore = (byte[]) storeField.get(runtime.appletAt(aid));
        assertTrue(proofStore != null && proofStore.length == 128 * 96, "the set-up reserved the store of the mint's proofs");
        java.lang.reflect.Field pendingField = CashuApplet.class.getDeclaredField("burnPending");
        pendingField.setAccessible(true);
        burnPending = (byte[]) pendingField.get(runtime.appletAt(aid));
        java.lang.reflect.Field listField = CashuApplet.class.getDeclaredField("burnList");
        listField.setAccessible(true);
        burnList = (byte[]) listField.get(runtime.appletAt(aid));
        applet = runtime.appletAt(aid);
    }

    /** The applet, for the arrays the D23 tests set by hand. */
    private Applet applet;

    private byte[] live(String name) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return (byte[]) f.get(applet);
    }

    /** The card taken out of the field and put back: a new power-up, the applet selected, the PIN typed again. */
    private void powerCycle() {
        sim.reset();
        assertEquals(CashuAppletTest.SW_OK, send(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))).getSW());
        assertEquals(CashuAppletTest.SW_OK, send(new CommandAPDU(CLA, CashuAppletTest.INS_VERIFY_PIN, 0, 0, CashuAppletTest.TEST_PIN)).getSW());
    }

    private ResponseAPDU log() {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_LOG, 0, 0, 256));
    }

    private ResponseAPDU send(CommandAPDU apdu) {
        return sim.transmitCommand(apdu);
    }

    private ResponseAPDU load(byte[] proof) {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, proof, 0, proof.length, 1));
    }

    /** LOAD_PROOF with P1 = 1 (1.20): the piece and the mint's proof for it. */
    private ResponseAPDU loadWithProof(byte[] piece, byte[] proof) {
        return send(CashuAppletTest.loadWithProofCommand(piece, proof));
    }

    /** What GET_DLEQ answers for one place: 01 and the 96 bytes, or 00. */
    private byte[] dleqAt(int place) {
        ResponseAPDU r = send(CashuAppletTest.getDleqCommand(place, 255));
        assertEquals(CashuAppletTest.SW_OK, r.getSW());
        return r.getData();
    }

    /** A payment of that one piece: named, and signed for. The answer of whichever of the two refused, or the signature. */
    private ResponseAPDU spend(int slot) {
        ResponseAPDU begun = send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { (byte) slot }, 4));
        if (begun.getSW() != CashuAppletTest.SW_OK) return begun;
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_SIGN, 0, 0, 64));
    }

    /** Whether `sig` is the card's for a payment of that one piece, which is what was sent to LOAD_PROOF, into no outputs. */
    private boolean signedFor(byte[] sig, byte[] sentProof) throws Exception {
        byte[] key = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_PUBKEY, 0, 0, 256)).getData();
        byte[] message = CashuAppletTest.sha256(CashuAppletTest.allMessage(key, CashuAppletTest.REFUND,
            new byte[][] { CashuAppletTest.asSlot(sentProof) }, new byte[0][]).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return CashuAppletTest.schnorrVerify(CashuAppletTest.extractPubkeyX(key), message, sig);
    }

    private ResponseAPDU clearSpent() {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_CLEAR_SPENT, 0, 0, 1));
    }

    private ResponseAPDU proofAt(int slot) {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_PROOF, slot, 0, 82));
    }

    private long balance() {
        byte[] b = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_BALANCE, 0, 0, 4)).getData();
        return ((b[0] & 0xFFL) << 24) | ((b[1] & 0xFFL) << 16) | ((b[2] & 0xFFL) << 8) | (b[3] & 0xFFL);
    }

    private byte[] statuses() {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_SLOT_STATUS, 0, 0,
            CashuAppletTest.MAX_PROOFS)).getData();
    }

    private int proofCount() {
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_PROOF_COUNT, 0, 0, 1)).getData()[0];
    }

    private byte[] slotBytes(int slot) {
        return Arrays.copyOfRange(storage, slot * 82, slot * 82 + 82);
    }

    @Test
    @DisplayName("a LOAD_PROOF torn before its commit leaves an empty slot: no read sees it, and the next load takes it whole")
    void aTornLoadLeavesTheSlotEmpty() throws Exception {
        freshCard();
        // What LOAD_PROOF leaves when the card goes between the copy and the
        // commit: the proof's 81 bytes are in, the status still says EMPTY.
        System.arraycopy(CashuAppletTest.PROOF_1, 0, storage, 1, 81);

        assertEquals(0, statuses()[0]);
        assertEquals(0, balance());
        assertEquals(0, proofCount());
        assertEquals(CashuAppletTest.SW_SLOT_EMPTY, proofAt(0).getSW());
        assertEquals(CashuAppletTest.SW_SLOT_EMPTY, spend(0).getSW());

        ResponseAPDU loaded = load(CashuAppletTest.PROOF_2);
        assertEquals(CashuAppletTest.SW_OK, loaded.getSW());
        assertEquals(0, loaded.getData()[0], "the torn slot is the first empty one and is reused");
        byte[] slot = proofAt(0).getData();
        assertEquals(1, slot[0]);
        assertArrayEquals(CashuAppletTest.PROOF_2, Arrays.copyOfRange(slot, 1, 82),
            "nothing of the torn load's bytes survives the next one");
        assertEquals(500, balance());
    }

    @Test
    @DisplayName("the same at a place above 63: a LOAD_PROOF torn before its commit at place 100 leaves it empty, which no read sees, and the next load takes it whole")
    void aTornLoadAbove63LeavesTheSlotEmpty() throws Exception {
        freshCard();
        for (int i = 0; i < 100; i++) {
            assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 1 + i, i + 10)).getSW());
        }
        long before = balance();
        System.arraycopy(CashuAppletTest.PROOF_1, 0, storage, 100 * 82 + 1, 81);
        assertEquals(0, statuses()[100] & 0xFF);
        assertEquals(before, balance(), "the torn bytes are not counted");
        assertEquals(CashuAppletTest.SW_SLOT_EMPTY, proofAt(100).getSW());
        assertEquals(CashuAppletTest.SW_SLOT_EMPTY, spend(100).getSW());
        assertEquals(100, proofCount());
        ResponseAPDU loaded = load(CashuAppletTest.PROOF_2);
        assertEquals(CashuAppletTest.SW_OK, loaded.getSW());
        assertEquals(100, loaded.getData()[0] & 0xFF, "the torn place is the first empty one, and is reused");
        assertArrayEquals(CashuAppletTest.PROOF_2, Arrays.copyOfRange(proofAt(100).getData(), 1, 82), "nothing of the torn load survives");
        assertEquals(before + 500, balance());
        ResponseAPDU paid = spend(100);
        assertEquals(CashuAppletTest.SW_OK, paid.getSW());
        assertEquals(64, paid.getData().length);
    }

    @Test
    @DisplayName("a LOAD_PROOF torn after the text kept beside the place was written leaves an empty place with another piece's text beside it, and so does junk there: the next load writes its own over it, and a payment hashes the piece that is there")
    void aTornLoadLeavesItsTextBehindAndTheNextLoadWritesOverIt() throws Exception {
        for (int junk = 0; junk < 3; junk++) {
            freshCard();
            // What LOAD_PROOF leaves when the card goes after the nonce's and the C's text were written (they are written first)
            // and before the slot's data was: the text of PROOF_1 beside place 0, which is still empty. Or junk, or text of another length.
            byte[] text = (CashuAppletTest.toHex(java.util.Arrays.copyOfRange(CashuAppletTest.PROOF_1, 12, 44))
                + CashuAppletTest.toHex(java.util.Arrays.copyOfRange(CashuAppletTest.PROOF_1, 44, 77))).getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            assertEquals(130, text.length);
            if (junk == 0) System.arraycopy(text, 0, hex, 0, 130);
            else if (junk == 1) java.util.Arrays.fill(hex, (byte) 'z');
            else java.util.Arrays.fill(hex, 0, 65, (byte) 'a');
            assertEquals(0, statuses()[0]);
            assertEquals(0, balance());
            assertEquals(CashuAppletTest.SW_SLOT_EMPTY, spend(0).getSW(), "an empty place is never paid with, whatever is beside it");

            ResponseAPDU loaded = load(CashuAppletTest.PROOF_2);
            assertEquals(CashuAppletTest.SW_OK, loaded.getSW());
            assertEquals(0, loaded.getData()[0], "the empty place is reused");
            String own = CashuAppletTest.toHex(java.util.Arrays.copyOfRange(CashuAppletTest.PROOF_2, 12, 44))
                + CashuAppletTest.toHex(java.util.Arrays.copyOfRange(CashuAppletTest.PROOF_2, 44, 77));
            assertEquals(own, new String(hex, 0, 130, java.nio.charset.StandardCharsets.US_ASCII), "the text beside the place is the piece's own, all of it");
            ResponseAPDU paid = spend(0);
            assertEquals(CashuAppletTest.SW_OK, paid.getSW());
            assertTrue(signedFor(paid.getData(), CashuAppletTest.PROOF_2), "and a payment hashes it");
            assertFalse(signedFor(paid.getData(), CashuAppletTest.PROOF_1), "and not what a torn load left");
        }
    }

    @Test
    @DisplayName("a LOAD_PROOF whose log write was lost (the card went after the pieces were stored and before the log's transaction) leaves the pieces good: unspent, counted, paid with; the log lacks the load, and the next command that writes it writes it right")
    void aLoadWhoseLogWriteIsLostLeavesThePiecesGood() throws Exception {
        freshCard();
        byte[] logBefore = cardLog.clone();
        ResponseAPDU batch = send(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0,
            CashuAppletTest.concat(CashuAppletTest.PROOF_1, CashuAppletTest.PROOF_2), 3));
        assertEquals(CashuAppletTest.SW_OK, batch.getSW());
        assertArrayEquals(new byte[] { 0, 1 }, batch.getData());
        assertEquals(1, cardLog[3], "the log has the load in it");
        // the log's transaction never happened: the card is taken away, and the log is as it was
        System.arraycopy(logBefore, 0, cardLog, 0, logBefore.length);
        powerCycle();
        assertEquals(1500, balance(), "the pieces are on the card");
        assertEquals(1, statuses()[0]);
        assertEquals(1, statuses()[1]);
        assertArrayEquals(CashuAppletTest.PROOF_1, Arrays.copyOfRange(proofAt(0).getData(), 1, 82));
        ResponseAPDU empty = log();
        assertEquals(CashuAppletTest.SW_OK, empty.getSW());
        assertArrayEquals(new byte[16], empty.getData(), "and the log says nothing of them: no tap, no entry");
        // they are paid with, and the log is then written as a tap's, in the first entry
        ResponseAPDU paid = spend(0);
        assertEquals(CashuAppletTest.SW_OK, paid.getSW());
        assertTrue(signedFor(paid.getData(), CashuAppletTest.PROOF_1));
        byte[] d = log().getData();
        assertEquals(16 + 20, d.length, "one tap: the counts, and one entry of twenty bytes (1.15)");
        assertEquals(1, CashuAppletTest.readUint32(d, 0));
        assertEquals(1000, CashuAppletTest.readUint32(d, 20), "sats signed for");
        assertEquals(0, d[27], "nothing put on in it: that load is not in the log");
        assertEquals(500, balance());
    }

    @Test
    @DisplayName("a payment whose receipt was lost (the card went after the burn and before the receipt's transaction) is in the log and has no receipt; its signature is still asked for again; the next payment's receipt is the first, and the ring goes on from its own count")
    void aPaymentWhoseReceiptIsLostIsInTheLogAndHasNone() throws Exception {
        freshCard();
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_1).getSW());
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_2).getSW());
        byte[] receiptsBefore = cardReceipts.clone();
        ResponseAPDU paid = spend(0);
        assertEquals(CashuAppletTest.SW_OK, paid.getSW());
        assertEquals(1, cardReceipts[3], "the receipt was written");
        System.arraycopy(receiptsBefore, 0, cardReceipts, 0, receiptsBefore.length);
        powerCycle();
        assertEquals(1000, CashuAppletTest.readUint32(log().getData(), 4), "the payment is in the log");
        assertEquals(500, balance(), "and burned");
        ResponseAPDU again = send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_AGAIN, 0, 0, 64));
        assertEquals(CashuAppletTest.SW_OK, again.getSW());
        assertArrayEquals(paid.getData(), again.getData(), "its signature can still be asked for");
        // the owner reads the receipts: none
        assertEquals(CashuAppletTest.SW_OK, allowLoad());
        ResponseAPDU none = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_LOG, 1, 0, 256));
        assertEquals(CashuAppletTest.SW_OK, none.getSW());
        assertArrayEquals(new byte[4], none.getData(), "the payment has no receipt");
        // the next payment has one, and it is the first
        ResponseAPDU second = spend(1);
        assertEquals(CashuAppletTest.SW_OK, second.getSW());
        assertEquals(CashuAppletTest.SW_OK, allowLoad());
        ResponseAPDU one = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_LOG, 1, 0, 256));
        assertEquals(4 + CashuAppletTest.RECEIPT_LEN, one.getData().length, "a receipt is 77 bytes since 1.15");
        assertEquals(1, CashuAppletTest.readUint32(one.getData(), 0));
        assertEquals(500, CashuAppletTest.readUint32(one.getData(), 4 + 8), "what its pieces were worth: after the block's time and the time told");
        assertEquals(1500, CashuAppletTest.readUint32(log().getData(), 4), "and the log has both");
    }

    /** The owner's grant, in this tap. */
    private int allowLoad() {
        byte[] nonce = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16)).getData();
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, nonce, new byte[0]);
        return send(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0, CashuAppletTest.ownerData(proof, new byte[0]))).getSW();
    }

    @Test
    @DisplayName("a CLEAR_SPENT torn mid-slot leaves it spent: never counted or signed for, still answered by GET_PROOF with fields zeroed, and the next CLEAR_SPENT finishes it")
    void aTornClearLeavesTheSlotSpent() throws Exception {
        freshCard();
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_1).getSW());
        assertEquals(CashuAppletTest.SW_OK, spend(0).getSW());
        // What CLEAR_SPENT leaves when the card goes mid-fill: part of the data
        // zeroed, the status still SPENT.
        Arrays.fill(storage, 1, 40, (byte) 0);

        assertEquals(2, statuses()[0]);
        assertEquals(0, balance());
        assertEquals(0x6985, spend(0).getSW(), "a spent slot is never signed for again");

        // Unlike the empty slot a torn LOAD_PROOF leaves, this one is still
        // read: GET_PROOF returns it as a spent slot whose fields are partly
        // zeroed, and its data is no longer a proof (spec/APDU.md, CLEAR_SPENT).
        // A reader has to check a spent slot's data before it trusts it;
        // cardctl dump skips one that fails.
        ResponseAPDU halfCleared = proofAt(0);
        assertEquals(CashuAppletTest.SW_OK, halfCleared.getSW());
        byte[] read = halfCleared.getData();
        assertEquals(82, read.length);
        assertEquals(2, read[0], "a half-cleared slot still reads as spent");
        assertArrayEquals(new byte[4], Arrays.copyOfRange(read, 9, 13),
            "the amount GET_PROOF reports is the zeroed one, not the proof's");

        ResponseAPDU cleared = clearSpent();
        assertEquals(CashuAppletTest.SW_OK, cleared.getSW());
        assertEquals(1, cleared.getData()[0]);
        assertArrayEquals(new byte[82], slotBytes(0));
    }

    @Test
    @DisplayName("CLEAR_SPENT empties a spent slot's bytes as well as its status, and leaves unspent slots alone")
    void clearSpentEmptiesTheWholeSlot() throws Exception {
        freshCard();
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_1).getSW());
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_2).getSW());
        byte[] unspent = slotBytes(1);
        assertEquals(CashuAppletTest.SW_OK, spend(0).getSW());

        ResponseAPDU cleared = clearSpent();
        assertEquals(1, cleared.getData()[0]);
        assertArrayEquals(new byte[82], slotBytes(0));
        assertArrayEquals(unspent, slotBytes(1));
        assertEquals(500, balance());
    }

    // ── the mint's proof kept beside each place (1.20) ───────────────────────

    // A write into the store: a fill, whose first argument is the store, or a copy, whose third is.
    private static final Pattern STORE_WRITE = Pattern.compile(
        "Util\\.arrayFill(?:NonAtomic)?\\s*\\(\\s*dleq\\b|Util\\.arrayCopy(?:NonAtomic)?\\s*\\(\\s*[^,]+,\\s*[^,]+,\\s*dleq\\b");

    /**
     * Violations of the store's order in a source file: a write into the store (`dleq`) that comes, in a method, after a write to a
     * place (`proofStorage`, its data or its status byte). The record goes first, so that a place that goes UNSPENT holds its own
     * proof or zeros and never the one a piece before it left, and a tear leaves an EMPTY place, which nothing serves.
     */
    static List<String> storeWriteViolations(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        int[] method = methodBodies(src);
        List<SlotWrite> places = slotWrites(rawSrc);
        List<String> violations = new ArrayList<>();
        Matcher store = STORE_WRITE.matcher(src);
        while (store.find()) {
            for (SlotWrite place : places) {
                if (method[place.at] >= 0 && method[place.at] == method[store.start()] && place.at < store.start()) {
                    violations.add("'" + store.group().trim() + "...' writes the store after the place was written ('" + place.text
                        + "'): the record goes first, and the status byte last");
                }
            }
        }
        return violations;
    }

    @Test
    @DisplayName("LOAD_PROOF writes the place's record in the store before the place's data and before its status byte, and no method writes the store after it has written a place")
    void appletWritesTheRecordBeforeThePlace() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(
                SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        List<String> violations = storeWriteViolations(src);
        assertTrue(violations.isEmpty(), String.join("\n", violations));

        // a scan that matched nothing would prove nothing: the load writes the record, and the reset zeros the store
        String code = SchnorrHWMathTest.stripCommentsAndCharLiterals(src);
        int from = code.indexOf("private short loadOne(");
        String loadOne = code.substring(from, code.indexOf("private void processClearSpent(", from));
        Matcher record = STORE_WRITE.matcher(loadOne);
        assertTrue(record.find(), "the load writes the record");
        int data = loadOne.indexOf("Util.arrayCopy(buf, in, proofStorage");
        int status = loadOne.indexOf("STATUS_UNSPENT", data);
        assertTrue(record.start() < data && data < status, "the record, then the place's data, then its status byte");
        int hexAt = loadOne.lastIndexOf("slotHex");
        assertTrue(hexAt < record.start(), "and the text for the hash was written before that");
        int stores = 0;
        Matcher all = STORE_WRITE.matcher(code);
        while (all.find()) stores++;
        assertEquals(3, stores, "the load's copy and fill of a record, and the reset's fill of the store: three writes in all");
    }

    @Test
    @DisplayName("the scan of the store's order fails a record written after the data, after the status byte, and by a fill after either, and passes the record first")
    void theScanOfTheStoreCanSayNo() {
        String good = "class A { void load() {"
            + " Util.arrayCopyNonAtomic(buf, proofAt, dleq, record, DLEQ_LEN);"
            + " Util.arrayCopy(buf, in, proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN);"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_UNSPENT;"
            + " } void reset() { Util.arrayFillNonAtomic(dleq, (short) 0, (short) 12288, (byte) 0); } }";
        String afterData = "class A { void load() {"
            + " Util.arrayCopy(buf, in, proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN);"
            + " Util.arrayCopyNonAtomic(buf, proofAt, dleq, record, DLEQ_LEN);"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_UNSPENT;"
            + " } }";
        String afterStatus = "class A { void load() {"
            + " Util.arrayCopy(buf, in, proofStorage, (short)(base + PROOF_KEYSET_OFFSET), PROOF_DATA_LEN);"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_UNSPENT;"
            + " Util.arrayCopyNonAtomic(buf, proofAt, dleq, record, DLEQ_LEN);"
            + " } }";
        String fillAfterStatus = "class A { void clear() {"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_EMPTY;"
            + " Util.arrayFillNonAtomic(dleq, record, DLEQ_LEN, (byte) 0);"
            + " } }";
        String elsewhere = "class A { void clear() {"
            + " proofStorage[(short)(base + PROOF_STATUS_OFFSET)] = STATUS_EMPTY;"
            + " } void reset() { Util.arrayFillNonAtomic(dleq, (short) 0, (short) 12288, (byte) 0); } }";

        assertTrue(storeWriteViolations(good).isEmpty(), String.join("\n", storeWriteViolations(good)));
        assertTrue(storeWriteViolations(elsewhere).isEmpty(), "a method of its own is not the load's: " + String.join("\n", storeWriteViolations(elsewhere)));
        assertFalse(storeWriteViolations(afterData).isEmpty(), "a record after the data passed");
        assertFalse(storeWriteViolations(afterStatus).isEmpty(), "a record after the status byte passed");
        assertFalse(storeWriteViolations(fillAfterStatus).isEmpty(), "a fill after the status byte passed");
    }

    @Test
    @DisplayName("a LOAD_PROOF torn after the place's record was written (the record goes first) leaves an EMPTY place with another piece's proof beside it, and so does junk or half a record: nothing serves it, a payment cannot name it, and the next load writes its own record over it, a plain one zeros")
    void aTornLoadLeavesItsRecordBehindAndTheNextLoadWritesOverIt() throws Exception {
        for (int junk = 0; junk < 3; junk++) {
            for (boolean withProof : new boolean[] { false, true }) {
                freshCard();
                // What LOAD_PROOF leaves when the card goes after the record was written and before the place's data: some record beside
                // place 0, which is still empty. Another piece's proof, or junk, or half a record.
                if (junk == 0) System.arraycopy(CashuAppletTest.dleqProof(7), 0, proofStore, 0, 96);
                else if (junk == 1) Arrays.fill(proofStore, 0, 96, (byte) 0xA5);
                else Arrays.fill(proofStore, 0, 40, (byte) 1);
                String what = "junk " + junk + (withProof ? ", the next load with a proof" : ", the next load plain");
                assertEquals(0, statuses()[0], what);
                assertEquals(0, balance(), what);
                assertEquals(CashuAppletTest.SW_SLOT_EMPTY, proofAt(0).getSW(), what);
                assertEquals(CashuAppletTest.SW_SLOT_EMPTY, spend(0).getSW(), what + ": an empty place is never paid with");
                assertArrayEquals(new byte[] { 0 }, dleqAt(0), what + ": nor does it serve the record that is beside it");

                byte[] mine = CashuAppletTest.dleqProof(8);
                ResponseAPDU loaded = withProof ? loadWithProof(CashuAppletTest.PROOF_2, mine) : load(CashuAppletTest.PROOF_2);
                assertEquals(CashuAppletTest.SW_OK, loaded.getSW(), what);
                assertEquals(0, loaded.getData()[0], what + ": the empty place is reused");
                assertArrayEquals(withProof ? CashuAppletTest.dleqHeld(mine) : new byte[] { 0 }, dleqAt(0), what + ": the piece's own proof, or none, and not what a tear left");
                assertArrayEquals(withProof ? mine : new byte[96], Arrays.copyOfRange(proofStore, 0, 96), what + ": the whole record is the piece's own");
                assertArrayEquals(CashuAppletTest.PROOF_2, Arrays.copyOfRange(proofAt(0).getData(), 1, 82), what);
            }
        }
    }

    @Test
    @DisplayName("a payment torn between its commit and the marking of its places serves no proof for them: the next command marks them spent first, and GET_DLEQ answers 00 for each, while the piece beside them keeps its proof")
    void aPaymentTornBeforeItsPlacesAreMarkedServesNoProof() throws Exception {
        freshCard();
        byte[] a = CashuAppletTest.dleqProof(1), b = CashuAppletTest.dleqProof(2);
        assertEquals(CashuAppletTest.SW_OK, loadWithProof(CashuAppletTest.PROOF_1, a).getSW());
        assertEquals(CashuAppletTest.SW_OK, loadWithProof(CashuAppletTest.PROOF_2, b).getSW());
        assertArrayEquals(CashuAppletTest.dleqHeld(a), dleqAt(0));
        byte[] storeBefore = proofStore.clone();
        assertEquals(CashuAppletTest.SW_OK, spend(0).getSW());
        assertArrayEquals(storeBefore, proofStore, "the payment wrote nothing to the store");
        // the card went after the commit and before the marking: the note stands, the list names the place, and the status byte still says unspent
        storage[0] = 1;
        burnPending[0] = 1;
        assertEquals(1, burnList[0], "the list names one place");
        assertEquals(0, burnList[1], "place 0");
        powerCycle();
        assertArrayEquals(new byte[] { 0 }, dleqAt(0), "the place is spent, as its payment committed, before anything looks at it: no proof is given for it");
        assertEquals(2, statuses()[0]);
        assertEquals(0, burnPending[0], "and the note is taken down");
        assertArrayEquals(CashuAppletTest.dleqHeld(b), dleqAt(1), "the piece beside it keeps its proof");
        assertArrayEquals(storeBefore, proofStore, "and the store is as it was");
    }

    // ── D23 (fix 4d): every persistent write outside a transaction, reviewed ─────────────────────────────────────

    /**
     * The applet's persistent state: the arrays made with `new` in the constructor (and `dleq`, made by the first
     * SET_CARD), and the key and PIN objects. A write to any of them outside a JCSystem transaction lasts as it is
     * written, one call at a time, and a tear between two such calls is a state the card must tolerate.
     */
    static final String[] PERSISTENT = { "proofStorage", "slotHex", "dleq", "cardLocked", "pinState", "cardRecord", "ownerSet", "tagOff",
        "changeDue", "cardLog", "cardReceipts", "changeOpen", "openState", "lastSig", "burnList", "burnPending", "pinKeySig" };

    /**
     * Every method with a persistent write outside a transaction, the number of such writes in it, and why a tear between them
     * is safe: the review of D23, one line a site. A method that gains such a write, or a new method with one, fails the test
     * until it is reviewed here and in docs/DECISIONS.md D23.
     */
    static final String[][] REVIEWED = {
        { "initCardKeypair", "1", "install time: no card exists until install() returns" },
        { "initPinKey", "1", "install time" },
        { "processSpendAllBegin", "1", "one byte per opening (a draft let go), each atomic; a tear leaves drafts the next BEGIN lets go" },
        { "processSpendAllChange", "4", "an EMPTY opening's fields, then openState DRAFT: the state byte is the opening's commit" },
        { "blindChange", "1", "r of the opening SPEND_ALL_CHANGE is filling, before its state byte" },
        { "processGetChange", "1", "one byte: a pending opening whose piece is back on the card, let go" },
        { "clearOpening", "1", "one byte: the opening of change just loaded, let go" },
        { "processSpendAllSign", "2", "burnList, read only while burnPending is set, and burnPending is set in the payment's transaction after it" },
        { "finishBurn", "1", "status bytes of a committed payment, idempotent, before burnPending is cleared in a transaction of its own" },
        { "loadOne", "7", "D14/D17: record, hex, data, then the status byte last; changeDue after it (a tear leaves the change grant for one more tap, which opens loading only)" },
        { "freeSpent", "2", "D14: data zeroed, then the status byte EMPTY last" },
        { "writeHeader", "4", "a helper: every caller holds a transaction around it (CashuAppletTest pins the callers)" },
        { "failPinCheck", "1", "one byte; the counter's decrement before it is the JCRE's, and a tear between leaves a counter at 0, which VERIFY_PIN and the allowance read as blocked (D22)" },
        { "processSetPin", "2", "the allowance zeroed on a card with no PIN, before the PIN's transaction: each copy atomic, and a card with no PIN has no allowance" },
        { "processLockCard", "1", "one byte" },
        { "processResetCard", "14", "the bulk wipes, then who the card is in one transaction, last: torn before it, the card is still its owner's, who resets it again" },
        { "processSetTag", "1", "one byte" },
        { "logEntry", "4", "a helper: every caller holds a transaction around it" },
        { "armAllowance", "1", "one byte (D20)" },
    };

    @Test
    @DisplayName("D23: every persistent write outside a transaction is in a method reviewed for tearing, and each reviewed method has the number of them it was reviewed with")
    void everyWriteOutsideATransactionIsReviewed() throws Exception {
        String src = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        java.util.Map<String, Integer> found = writesOutsideTransactions(src);
        java.util.Map<String, Integer> reviewed = new java.util.TreeMap<>();
        for (String[] r : REVIEWED) reviewed.put(r[0], Integer.parseInt(r[1]));
        assertEquals(reviewed, new java.util.TreeMap<>(found), "the methods with writes outside a transaction, and how many: review a change in DECISIONS D23 and here");
    }

    @Test
    @DisplayName("D23: the inventory counts a write outside a transaction, not one inside, and not one inside a transaction whose catch aborts it")
    void theInventoryCanSayNo() {
        String src = "class A {\n"
            + "    private void inside() { JCSystem.beginTransaction(); cardRecord[0] = 1; Util.arrayCopy(a, (short) 0, cardLog, (short) 0, (short) 4); JCSystem.commitTransaction(); }\n"
            + "    private void outside() { pinState[0] = (byte) 1; Util.arrayFillNonAtomic(cardLog, (short) 0, (short) 4, (byte) 0); }\n"
            + "    private void aborted() { JCSystem.beginTransaction(); try { k.setW(b, o, l); } catch (CryptoException e) { JCSystem.abortTransaction(); ISOException.throwIt(x); } ownerSet[0] = (byte) 1; JCSystem.commitTransaction(); }\n"
            + "    private void reads() { if (pinState[0] == (byte) 1) { x = cardRecord[0]; } Util.arrayCopyNonAtomic(cardRecord, (short) 0, buf, (short) 0, (short) 4); }\n"
            + "}\n";
        java.util.Map<String, Integer> found = writesOutsideTransactions(src);
        assertEquals(java.util.Collections.singletonMap("outside", 2), found);
    }

    /** Method name -> the persistent writes in it that are not between a beginTransaction and its commitTransaction. */
    static java.util.Map<String, Integer> writesOutsideTransactions(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        StringBuilder alt = new StringBuilder();
        for (String a : PERSISTENT) alt.append(alt.length() == 0 ? "" : "|").append(a);
        String names = "(?:" + alt + ")";
        Pattern write = Pattern.compile(
            "\\b" + names + "\\s*\\[[^\\]]*\\]\\s*(?:[-+|&^]|<<|>>)?=(?!=)"
            + "|Util\\.arrayCopy(?:NonAtomic)?\\s*\\([^;]*?,[^;]*?,\\s*" + names + "\\s*,"
            + "|Util\\.arrayFill(?:NonAtomic)?\\s*\\(\\s*" + names + "\\s*,"
            + "|\\baddUint32Stop\\s*\\(\\s*(?:cardLog|cardReceipts)\\s*,"
            + "|\\b(?:ownerKey\\.setW|cardKeyPair\\.genKeyPair|pinKeyPair\\.genKeyPair|pin\\.update)\\s*\\(");
        Pattern method = Pattern.compile("\\n    (?:private|public|protected|static)[^\\n;=]*?(\\w+)\\s*\\([^)]*\\)\\s*\\{");
        java.util.Map<String, Integer> out = new java.util.LinkedHashMap<>();
        Matcher m = method.matcher(src);
        while (m.find()) {
            int open = m.end() - 1, depth = 0, close = open;
            for (int i = open; i < src.length(); i++) {
                char c = src.charAt(i);
                if (c == '{') depth++;
                else if (c == '}' && --depth == 0) { close = i; break; }
            }
            String body = src.substring(open, close);
            Matcher w = write.matcher(body);
            int outside = 0;
            while (w.find()) {
                String before = body.substring(0, w.start());
                int begun = count(before, "JCSystem.beginTransaction()"), committed = count(before, "JCSystem.commitTransaction()");
                if (begun <= committed) outside++;
            }
            if (outside > 0) out.merge(m.group(1), outside, Integer::sum);
        }
        return out;
    }

    private static int count(String s, String what) {
        int n = 0;
        for (int at = s.indexOf(what); at >= 0; at = s.indexOf(what, at + 1)) n++;
        return n;
    }

    @Test
    @DisplayName("D23: a SPEND_ALL_CHANGE torn before its opening's state byte leaves an EMPTY opening with bytes in it: GET_CHANGE serves nothing, and the next change takes the opening whole")
    void aTornChangeOpeningIsNeverServed() throws Exception {
        freshCard();
        byte[] changeOpen = live("changeOpen"), openState = live("openState");
        java.util.Arrays.fill(changeOpen, 0, CashuApplet.OPEN_LEN, (byte) 0x5A);   // the amount, keyset, date, nonce and r of a change never committed
        assertEquals(CashuApplet.OPEN_EMPTY, openState[0], "the state byte, the commit, was never written");
        powerCycle();
        ResponseAPDU change = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_CHANGE, 0, 0, 256));
        assertEquals(CashuAppletTest.SW_OK, change.getSW());
        assertEquals(0, change.getData()[0], "no opening is served");
        assertEquals(1, change.getData().length);
        // a payment that makes change takes the first EMPTY opening and writes all of it, the state byte last
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_1).getSW());
        assertEquals(CashuAppletTest.SW_OK, send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { 0 }, 4)).getSW());
        assertEquals(CashuAppletTest.SW_OK, send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_CHANGE, 0, 0, CashuAppletTest.u32(500), 256)).getSW());
        assertEquals(CashuApplet.OPEN_DRAFT, openState[0], "the opening, now a draft");
        assertEquals(500, CashuAppletTest.readUint32(changeOpen, CashuApplet.OPEN_AMOUNT), "its amount is this change's, not the torn one's");
        assertTrue(changeOpen[CashuApplet.OPEN_R] != 0x5A || changeOpen[CashuApplet.OPEN_R + 1] != 0x5A, "and its r is new");
    }

    @Test
    @DisplayName("D23: a change load torn after its status byte and before changeDue is cleared leaves the change grant for one more tap: it opens loading, and no payment")
    void aTornChangeLoadLeavesTheGrantForLoadingOnly() throws Exception {
        freshCard();
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_1).getSW());
        live("changeDue")[0] = 1;   // the note a payment leaves, still standing as a tear after the change's status byte would leave it
        sim.reset();
        assertEquals(CashuAppletTest.SW_OK, send(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))).getSW());
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { 0 }, 4)).getSW() == CashuAppletTest.SW_OK
            ? send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW() : -1, "no payment without the PIN: the grant is not the PIN");
        assertEquals(1, storage[CashuAppletTest.SLOT * 0] , "the piece is unspent");
        assertEquals(CashuAppletTest.SW_OK, load(CashuAppletTest.PROOF_2).getSW(), "a load, which the grant is for");
        assertEquals(0, live("changeDue")[0], "and the load that used it takes the note down");
    }
}
