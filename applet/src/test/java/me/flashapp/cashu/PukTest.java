package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javacard.framework.Applet;
import javacard.framework.OwnerPIN;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * D16 (ENG-617) gave a 0.6 card a PUK: the one credential that took a PIN off
 * a blocked card. D18 superseded it. On the shared 2.0 protocol the owner key
 * is the authority above the PIN, and its proof (CHANGE_PIN, no old PIN) is
 * the way out of a blocked PIN.
 *
 * This suite keeps the PUK suite's three questions and asks them of what
 * replaced the PUK:
 *
 * 1. The ENG-615 invariant still holds: a blocked PIN gates every command
 *    until the owner's CHANGE_PIN succeeds, and nothing else (SET_PIN, a wrong
 *    proof, the owner's load grant, the no-PIN allowance) opens it.
 * 2. Who may unblock: the owner's proof alone, on any funds and any PIN state;
 *    a wrong proof costs no PIN try, so the unblock cannot be used to block.
 *    The 0.6 SET_PUK and UNBLOCK_PIN opcodes (0x44, 0x45) are GET_NONCE and
 *    ALLOW_LOAD on 2.0, and a 0.6 reader's bytes there change nothing.
 * 3. The write order, scanned in the source as D14's is: CHANGE_PIN checks the
 *    proof before it writes, and commits pinState after the PIN (D22).
 */
class PukTest {

    private static final byte CLA = CashuAppletTest.CLA;
    private static final int SW_OK = CashuAppletTest.SW_OK;
    private static final int SW_PIN_BLOCKED = CashuAppletTest.SW_PIN_BLOCKED;
    private static final int SW_OWNER_PROOF = CashuAppletTest.SW_OWNER_PROOF;
    private static final int SW_SECURITY_NOT_SATIS = CashuAppletTest.SW_SECURITY_NOT_SATIS;
    private static final int SW_PIN_NEEDED = CashuAppletTest.SW_PIN_NEEDED;
    private static final byte[] TEST_PIN = CashuAppletTest.TEST_PIN;
    private static final byte[] WRONG_PIN = CashuAppletTest.WRONG_PIN;
    private static final byte[] NEW_PIN = CashuAppletTest.NEW_PIN;
    /** What a 0.6 personaliser sent as SET_PUK's data: the PUK's length and an 8-digit PUK. */
    private static final byte[] OLD_SET_PUK_DATA = concat(new byte[] { 8 }, "12345678".getBytes());
    /** What a 0.6 reader sent as UNBLOCK_PIN's data: PUK length, PUK, new PIN length, new PIN. */
    private static final byte[] OLD_UNBLOCK_DATA = concat(new byte[] { 8 }, "12345678".getBytes(), new byte[] { 4 }, NEW_PIN);

    private CardSimulator sim;
    private byte[] pinState;
    private OwnerPIN pin;

    // ── the order, in the source ─────────────────────────────────────────────

    @Test
    @DisplayName("CHANGE_PIN checks the owner's proof before it writes anything, writes the PIN, then commits pinState 1 (D22)")
    void changePinChecksTheProofAndCommitsTheStateLast() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(
                SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        List<String> violations = changePinViolations(src);
        assertTrue(violations.isEmpty(), String.join("\n", violations));
    }

    @Test
    @DisplayName("the scan fails a write before the proof, a state-first CHANGE_PIN, a missing commit and a redundant counter reset")
    void theScanCanSayNo() {
        String good = "class A { private void processChangePin(APDU apdu) {"
            + " short at = requireOwnerProof(LABEL_CHANGE_PIN, buf, dataLen);"
            + " pin.update(buf, at, (byte) newLen);"
            + " pinState[0] = (byte) 1;"
            + " pinVerifiedFlag[0] = (byte) 0;"
            + " } }";
        String writeBeforeProof = "class A { private void processChangePin(APDU apdu) {"
            + " pin.update(buf, at, (byte) newLen);"
            + " short at = requireOwnerProof(LABEL_CHANGE_PIN, buf, dataLen);"
            + " pinState[0] = (byte) 1;"
            + " } }";
        String stateFirst = "class A { private void processChangePin(APDU apdu) {"
            + " short at = requireOwnerProof(LABEL_CHANGE_PIN, buf, dataLen);"
            + " pinState[0] = (byte) 1;"
            + " pin.update(buf, at, (byte) newLen);"
            + " } }";
        String noCommit = "class A { private void processChangePin(APDU apdu) {"
            + " short at = requireOwnerProof(LABEL_CHANGE_PIN, buf, dataLen);"
            + " pin.update(buf, at, (byte) newLen);"
            + " } }";
        String counterReset = "class A { private void processChangePin(APDU apdu) {"
            + " short at = requireOwnerProof(LABEL_CHANGE_PIN, buf, dataLen);"
            + " pin.update(buf, at, (byte) newLen);"
            + " pin.resetAndUnblock();"
            + " pinState[0] = (byte) 1;"
            + " } }";
        assertTrue(changePinViolations(good).isEmpty(), String.join("\n", changePinViolations(good)));
        assertFalse(changePinViolations(writeBeforeProof).isEmpty(), "a PIN written before the proof passed");
        assertFalse(changePinViolations(stateFirst).isEmpty(), "pinState written before the PIN passed");
        assertFalse(changePinViolations(noCommit).isEmpty(), "a CHANGE_PIN that never commits pinState passed");
        assertFalse(changePinViolations(counterReset).isEmpty(), "a redundant counter reset passed");
    }

    /**
     * Violations of the CHANGE_PIN write rules in processChangePin:
     * - the owner's proof (requireOwnerProof) does not come before the first
     *   persistent write: a wrong proof must change nothing;
     * - the PIN (pin.update) is not written, or pinState 1 is not written, or
     *   pinState 1 comes before the PIN: the state byte is the commit (D22), and
     *   a card torn between the two must read as it did before, never as a
     *   card whose new PIN is "set";
     * - the counter is reset by hand: OwnerPIN.update already refills it, and a
     *   second write is one more place to tear.
     */
    static List<String> changePinViolations(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        List<String> violations = new ArrayList<>();
        int decl = src.indexOf("void processChangePin(");
        if (decl < 0) {
            violations.add("no processChangePin in the source");
            return violations;
        }
        int open = src.indexOf('{', decl);
        int[] depth = SchnorrHWMathTest.braceDepths(src);
        int close = open;
        while (close < src.length() && !(src.charAt(close) == '}' && depth[close] == depth[open])) close++;
        String body = src.substring(open, close);

        int proof = body.indexOf("requireOwnerProof(LABEL_CHANGE_PIN");
        int update = body.indexOf("pin.update(");
        int state = body.indexOf("pinState[0] = (byte) 1");
        if (proof < 0) violations.add("processChangePin never checks the owner's proof");
        if (update < 0) violations.add("processChangePin never writes the PIN");
        if (state < 0) violations.add("processChangePin never commits pinState 1");
        if (proof >= 0 && update >= 0 && update < proof) {
            violations.add("processChangePin writes the PIN before the owner's proof: a wrong proof must change nothing");
        }
        if (update >= 0 && state >= 0 && state < update) {
            violations.add("processChangePin writes pinState before the PIN: torn between them, the card would read as set over the old PIN's state");
        }
        if (body.contains("pin.resetAndUnblock()")) {
            violations.add("processChangePin resets the counter by hand: OwnerPIN.update already refills it");
        }
        return violations;
    }

    // ── a card in the holder's hands ─────────────────────────────────────────

    /** A card set up as the phone sets one up (PIN, record, owner, a header), holding one piece, the PIN verified. */
    private void readyCardWithAPiece() throws Exception {
        CashuAppletTest.ExposedRuntime runtime = new CashuAppletTest.ExposedRuntime();
        sim = new CardSimulator(runtime);
        AID aid = AIDUtil.create(CashuAppletTest.AID_HEX);
        sim.installApplet(aid, CashuApplet.class);
        assertEquals(SW_OK, reselect());
        CashuAppletTest.readyOn(sim, 0);
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0,
            CashuAppletTest.PROOF_1, 1)).getSW(), "a piece, loaded under the verified PIN");
        Applet applet = runtime.appletAt(aid);
        pinState = (byte[]) field(applet, "pinState");
        pin = (OwnerPIN) field(applet, "pin");
    }

    private static Object field(Applet applet, String name) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(applet);
    }

    private static byte[] concat(byte[]... parts) { return CashuAppletTest.concat(parts); }

    private int reselect() {
        return sim.transmitCommand(new CommandAPDU(
            0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))).getSW();
    }

    /** A new tap: the card out of the field and back, selected, nothing verified. */
    private void newTap() {
        sim.reset();
        assertEquals(SW_OK, reselect());
    }

    private int send(int ins, int p2, byte[] data) {
        return sim.transmitCommand(new CommandAPDU(CLA, ins, 0, p2, data)).getSW();
    }

    private int verify(byte[] p) { return send(CashuAppletTest.INS_VERIFY_PIN, 0, p); }

    private byte[] nonce() {
        ResponseAPDU r = sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16));
        assertEquals(SW_OK, r.getSW());
        return r.getData();
    }

    /** The owner's phone changing the PIN: a nonce, a proof over the new PIN, CHANGE_PIN. */
    private int changePin(CashuAppletTest.Key key, byte[] newPin) {
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_PIN, key, nonce(), newPin);
        return send(CashuAppletTest.INS_CHANGE_PIN, 0, CashuAppletTest.ownerData(proof, newPin));
    }

    private int allowLoad() {
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, nonce(), new byte[0]);
        return send(CashuAppletTest.INS_ALLOW_LOAD, 0, CashuAppletTest.ownerData(proof, new byte[0]));
    }

    /** A payment of the piece in place 0 and no outputs: BEGIN, then SIGN. The status of whichever step ended it. */
    private int pay() {
        ResponseAPDU begun = sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { 0 }, 4));
        if (begun.getSW() != SW_OK) return begun.getSW();
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW();
    }

    private int loadProof2() {
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.PROOF_2, 1)).getSW();
    }

    private byte[] info() {
        ResponseAPDU r = sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_INFO, 0, 0, 256));
        assertEquals(SW_OK, r.getSW());
        return r.getData();
    }

    private int infoPinState() { return info()[7] & 0xFF; }
    private int infoTries() { return info()[9] & 0xFF; }
    private int pieceStatus() {
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_PROOF, 0, 0, 256)).getData()[0] & 0xFF;
    }

    /** Three wrong VERIFY_PINs: the unauthenticated block any reader in range can send. */
    private void blockThePin() {
        assertEquals(0x63C2, verify(WRONG_PIN));
        assertEquals(0x63C1, verify(WRONG_PIN));
        assertEquals(SW_PIN_BLOCKED, verify(WRONG_PIN));
        assertEquals(2, infoPinState(), "the PIN is blocked");
    }

    private void assertTheBlockedPinGates(String when) {
        assertEquals(SW_PIN_NEEDED, pay(), "a payment " + when + ": a blocked card has no no-PIN allowance");
        assertEquals(1, pieceStatus(), "the piece is unspent " + when + ": the gate ran before the burn");
        assertEquals(SW_SECURITY_NOT_SATIS, loadProof2(), "LOAD_PROOF " + when);
        assertEquals(SW_PIN_BLOCKED, verify(TEST_PIN), "VERIFY_PIN with the right PIN " + when);
        assertEquals(SW_OWNER_PROOF, send(CashuAppletTest.INS_SET_PIN, 0, NEW_PIN), "SET_PIN on an owned card " + when);
        assertEquals(2, infoPinState(), "still blocked " + when);
    }

    // ── GET_INFO ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GET_INFO has no PUK byte: thirty bytes, format 4, and byte 9 is the PIN's tries left")
    void getInfoHasNoPukState() throws Exception {
        readyCardWithAPiece();
        byte[] d = info();
        assertEquals(30, d.length, "the 0.6 answer was nine bytes with the PUK state at byte 8; 2.0's is thirty");
        assertEquals(CashuApplet.FORMAT, d[8], "byte 8 is the format on 2.0, not a PUK state");
        assertEquals(CashuApplet.PIN_MAX_TRIES, d[9], "byte 9 is the PIN's tries left");
    }

    // ── what a 0.6 reader's PUK commands do to a 2.0 card ────────────────────

    @Test
    @DisplayName("0x44 and 0x45 were SET_PUK and UNBLOCK_PIN; on 2.0 they are GET_NONCE and ALLOW_LOAD, and a 0.6 reader's bytes unblock nothing")
    void theOldPukOpcodesUnblockNothing() throws Exception {
        readyCardWithAPiece();
        newTap();
        blockThePin();
        // SET_PUK's bytes at 0x44: GET_NONCE reads no data, so it answers a nonce and writes nothing persistent
        ResponseAPDU r = sim.transmitCommand(new CommandAPDU(CLA, 0x44, 0, 0, OLD_SET_PUK_DATA, 16));
        assertEquals(SW_OK, r.getSW(), "GET_NONCE");
        assertEquals(16, r.getData().length, "a nonce, nothing else");
        // UNBLOCK_PIN's bytes at 0x45: ALLOW_LOAD takes them as a proof, which they are not
        assertEquals(SW_OWNER_PROOF, send(0x45, 0, OLD_UNBLOCK_DATA), "ALLOW_LOAD refuses a PUK and a PIN as a proof");
        assertTheBlockedPinGates("after a 0.6 unblock attempt");
        assertEquals(SW_PIN_BLOCKED, verify(NEW_PIN), "the PIN the old UNBLOCK_PIN named was never set");
    }

    // ── the blocked PIN and the owner's way out ──────────────────────────────

    @Test
    @DisplayName("a blocked PIN gates every command until the owner's CHANGE_PIN; then the old PIN is gone, the new one pays, and the counter is full")
    void aBlockedPinGatesUntilTheOwnersChangePin() throws Exception {
        readyCardWithAPiece();
        newTap();
        blockThePin();
        assertTheBlockedPinGates("while blocked");
        newTap();
        assertTheBlockedPinGates("in a new tap");

        assertEquals(SW_OK, changePin(CashuAppletTest.OWNER, NEW_PIN), "the owner's proof unblocks, with no old PIN");
        assertEquals(1, infoPinState(), "set, not blocked");
        assertEquals(CashuApplet.PIN_MAX_TRIES, infoTries(), "three fresh tries");
        assertEquals(0x63C2, verify(TEST_PIN), "the old PIN is gone");
        assertEquals(SW_OK, verify(NEW_PIN), "the new PIN verifies");
        assertEquals(SW_OK, pay(), "and pays");
        assertEquals(2, pieceStatus(), "the piece is spent");
    }

    @Test
    @DisplayName("nothing but the owner's proof opens a blocked PIN: another key's proof, a proof for another PIN, a used nonce and the load grant all leave it blocked")
    void nothingElseOpensABlockedPin() throws Exception {
        readyCardWithAPiece();
        newTap();
        blockThePin();
        assertEquals(SW_OWNER_PROOF, changePin(CashuAppletTest.OTHER_OWNER, NEW_PIN), "another key's proof");
        byte[] n = nonce();
        byte[] forOther = CashuAppletTest.ownerProof(CashuAppletTest.L_PIN, CashuAppletTest.OWNER, n, TEST_PIN);
        assertEquals(SW_OWNER_PROOF, send(CashuAppletTest.INS_CHANGE_PIN, 0, CashuAppletTest.ownerData(forOther, NEW_PIN)),
            "a proof made for another PIN");
        byte[] n2 = nonce();
        byte[] good = CashuAppletTest.ownerProof(CashuAppletTest.L_PIN, CashuAppletTest.OWNER, n2, NEW_PIN);
        assertEquals(SW_OWNER_PROOF, send(CashuAppletTest.INS_CHANGE_PIN, 0, CashuAppletTest.ownerData(
            CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, n2, new byte[0]), NEW_PIN)),
            "a proof under another command's label");
        assertEquals(SW_OWNER_PROOF, send(CashuAppletTest.INS_CHANGE_PIN, 0, CashuAppletTest.ownerData(good, NEW_PIN)),
            "the right proof over a nonce already tried: one try a nonce");
        assertEquals(SW_OK, allowLoad(), "the owner's load grant");
        assertEquals(SW_SECURITY_NOT_SATIS, loadProof2(), "opens no load on a blocked card");
        assertTheBlockedPinGates("after every wrong way");
    }

    @Test
    @DisplayName("a wrong owner's proof costs no PIN try: ten in a row leave the tries as they were, and the next right proof works")
    void aWrongProofCostsNoTry() throws Exception {
        readyCardWithAPiece();
        newTap();
        assertEquals(0x63C2, verify(WRONG_PIN));
        assertEquals(2, infoTries());
        for (int i = 0; i < 10; i++) {
            assertEquals(SW_OWNER_PROOF, changePin(CashuAppletTest.OTHER_OWNER, NEW_PIN), "wrong proof " + i);
        }
        assertEquals(2, infoTries(), "a wrong proof is not a wrong PIN");
        assertEquals(1, infoPinState());
        assertEquals(SW_OK, changePin(CashuAppletTest.OWNER, NEW_PIN));
        assertEquals(SW_OK, verify(NEW_PIN));
    }

    @Test
    @DisplayName("CHANGE_PIN on a card whose PIN is set, not blocked, replaces it: a forgotten PIN is the same operation")
    void aForgottenPinIsReplacedTheSameWay() throws Exception {
        readyCardWithAPiece();
        newTap();
        assertEquals(SW_OK, changePin(CashuAppletTest.OWNER, NEW_PIN), "no old PIN, no session");
        assertEquals(0x63C2, verify(TEST_PIN), "the old PIN is gone");
        assertEquals(SW_OK, verify(NEW_PIN));
    }

    @Test
    @DisplayName("a card with no owner has nobody to unblock it: CHANGE_PIN is 6A90, and the open card's SET_PIN is the way")
    void anOpenCardIsNotUnblockedByAProof() throws Exception {
        CashuAppletTest.ExposedRuntime runtime = new CashuAppletTest.ExposedRuntime();
        sim = new CardSimulator(runtime);
        sim.installApplet(AIDUtil.create(CashuAppletTest.AID_HEX), CashuApplet.class);
        assertEquals(SW_OK, reselect());
        assertEquals(SW_OK, send(CashuAppletTest.INS_SET_PIN, 0, TEST_PIN));
        blockThePin();
        assertEquals(CashuAppletTest.SW_NO_OWNER, send(CashuAppletTest.INS_CHANGE_PIN, 0,
            CashuAppletTest.ownerData(new byte[8], NEW_PIN)), "no owner, no proof to give");
        assertEquals(2, infoPinState());
        assertEquals(SW_OK, send(CashuAppletTest.INS_SET_PIN, 0, NEW_PIN), "an open card holds nothing: SET_PIN sets a PIN and unblocks");
        assertEquals(SW_OK, verify(NEW_PIN));
    }

    @Test
    @DisplayName("after LOCK_CARD, CHANGE_PIN is 6986: a locked card keeps the PIN it has, blocked or not")
    void aLockedCardKeepsItsPin() throws Exception {
        readyCardWithAPiece();
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOCK, CashuAppletTest.OWNER, nonce(), new byte[0]);
        assertEquals(SW_OK, send(CashuAppletTest.INS_LOCK_CARD, 0xDE, CashuAppletTest.ownerData(proof, new byte[0])));
        newTap();
        blockThePin();
        assertEquals(CashuAppletTest.SW_NOT_ALLOWED, changePin(CashuAppletTest.OWNER, NEW_PIN));
        assertEquals(2, infoPinState());
        assertArrayEquals(new byte[] { 2 }, pinState.clone(), "the state byte itself");
        assertEquals(0, pin.getTriesRemaining());
    }
}
