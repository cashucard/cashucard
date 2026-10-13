package me.flashapp.cashu;

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
 * D15 (applet 0.5) let a holder take the PIN off a personalised card with
 * CLEAR_PIN. D18 superseded it: on the shared 2.0 protocol no command takes a
 * PIN off a card. A card is set up with a PIN or without one, the owner's
 * proof changes it (CHANGE_PIN), and only RESET_CARD, on an empty card and by
 * the owner's proof, returns a card to no PIN, with a new key.
 *
 * This suite keeps the CLEAR_PIN suite's two concerns and asks them of 2.0:
 *
 * 1. The shape, in the source: the only writes of pinState 0 are the wipe of
 *    RESET_CARD. A reader with the PIN cannot turn a PIN card into a no-PIN
 *    card, which would let any later reader spend it under its limits. (0x43,
 *    which was CLEAR_PIN, is SET_OWNER on 2.0: a 0.5 reader's bytes there
 *    change nothing.)
 * 2. pinState 0 over a partly spent counter, set on the card directly, is
 *    harmless: no command reads the counter behind a card with no PIN, and a
 *    PIN added later starts with three fresh tries. And a successful
 *    OwnerPIN.check refills the counter by itself, which the applet leans on.
 *
 * It was ClearPinTest (D15) until 2.0; it is named for what it tests now.
 */
class OwnerPinRemovalTest {

    private static final byte CLA = CashuAppletTest.CLA;
    private static final int SW_OK = CashuAppletTest.SW_OK;

    // ── the shape, in the source ─────────────────────────────────────────────

    @Test
    @DisplayName("no command but RESET_CARD writes pinState 0: a PIN cannot be taken off a 2.0 card by a reader")
    void onlyTheResetWritesPinStateZero() throws Exception {
        String src = new String(
            java.nio.file.Files.readAllBytes(
                SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        List<String> violations = pinRemovalViolations(src);
        assertTrue(violations.isEmpty(), String.join("\n", violations));
    }

    @Test
    @DisplayName("the scan fails a CLEAR_PIN put back, a pinState 0 written outside the reset, and a reset that no longer writes it")
    void theScanCanSayNo() {
        String reset = " private void processResetCard(APDU apdu) { requireOwnerProof(LABEL_RESET, buf, dataLen); pinState[0] = (byte) 0; }";
        String good = "class A {" + reset + " private void processChangePin(APDU apdu) { pinState[0] = (byte) 1; } }";
        String clearPinBack = "class A {" + reset
            + " private void processClearPin(APDU apdu) { if (!pin.check(buf, off, len)) failPinCheck(); pinState[0] = (byte) 0; } }";
        String elsewhere = "class A {" + reset
            + " private void processSetLimit(APDU apdu) { pinState[0] = (byte) 0; } }";
        String noReset = "class A { private void processChangePin(APDU apdu) { pinState[0] = (byte) 1; } }";
        assertTrue(pinRemovalViolations(good).isEmpty(), String.join("\n", pinRemovalViolations(good)));
        assertFalse(pinRemovalViolations(clearPinBack).isEmpty(), "a CLEAR_PIN put back passed");
        assertFalse(pinRemovalViolations(elsewhere).isEmpty(), "pinState 0 written by another command passed");
        assertFalse(pinRemovalViolations(noReset).isEmpty(), "a source with no reset's wipe passed");
    }

    /**
     * Violations of "only RESET_CARD takes a PIN off": a processClearPin in the
     * source, or a write of pinState 0 in any method but processResetCard, or
     * none in processResetCard (the reset must still wipe the PIN).
     */
    static List<String> pinRemovalViolations(String rawSrc) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(rawSrc);
        List<String> violations = new ArrayList<>();
        if (src.contains("void processClearPin(")) violations.add("processClearPin is back: 2.0 has no CLEAR_PIN (D18)");
        int[] depth = SchnorrHWMathTest.braceDepths(src);
        boolean inReset = false;
        String needle = "pinState[0] = (byte) 0";
        for (int at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
            String method = enclosingMethod(src, depth, at);
            if ("processResetCard".equals(method)) inReset = true;
            else violations.add("pinState 0 is written in " + method + ": only RESET_CARD takes a PIN off a card");
        }
        if (!inReset) violations.add("processResetCard no longer writes pinState 0: a reset card must come back with no PIN");
        return violations;
    }

    /** The name of the method whose body holds position `at`: the last `void name(` or `name(` declaration at class depth + 1 before it. */
    private static String enclosingMethod(String src, int[] depth, int at) {
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("(?:private|public|static|protected)[\\w\\s<>\\[\\]]*?\\s(\\w+)\\s*\\([^)]*\\)\\s*\\{").matcher(src);
        String name = "(no method)";
        while (m.find() && m.start() < at) {
            int open = m.end() - 1;
            int close = open;
            while (close < src.length() && !(src.charAt(close) == '}' && depth[close] == depth[open])) close++;
            if (at > open && at < close) name = m.group(1);
        }
        return name;
    }

    // ── pinState 0 over a partly spent counter ───────────────────────────────

    private CardSimulator sim;
    private byte[] pinState;
    private OwnerPIN pin;

    /** A card set up as the phone sets one up (PIN, record, owner, a header), the PIN verified. */
    private void readyCard() throws Exception {
        CashuAppletTest.ExposedRuntime runtime = new CashuAppletTest.ExposedRuntime();
        sim = new CardSimulator(runtime);
        AID aid = AIDUtil.create(CashuAppletTest.AID_HEX);
        sim.installApplet(aid, CashuApplet.class);
        assertEquals(SW_OK, reselect());
        CashuAppletTest.readyOn(sim, 0);
        Applet applet = runtime.appletAt(aid);
        java.lang.reflect.Field field = CashuApplet.class.getDeclaredField("pinState");
        field.setAccessible(true);
        pinState = (byte[]) field.get(applet);
        java.lang.reflect.Field pinField = CashuApplet.class.getDeclaredField("pin");
        pinField.setAccessible(true);
        pin = (OwnerPIN) pinField.get(applet);
    }

    private int reselect() {
        return sim.transmitCommand(new CommandAPDU(
            0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))).getSW();
    }

    private int send(int ins, int p2, byte[] data) {
        return sim.transmitCommand(new CommandAPDU(CLA, ins, 0, p2, data)).getSW();
    }

    private int verify(byte[] p) { return send(CashuAppletTest.INS_VERIFY_PIN, 0, p); }

    private int infoPinState() {
        ResponseAPDU info = sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_INFO, 0, 0, 256));
        return info.getData()[7] & 0xFF;
    }

    private byte[] nonce() {
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16)).getData();
    }

    @Test
    @DisplayName("0x43 was CLEAR_PIN; on 2.0 it is SET_OWNER, and a 0.5 reader's CLEAR_PIN bytes leave the PIN on")
    void theOldClearPinOpcodeTakesNothingOff() throws Exception {
        readyCard();
        // 0.5's CLEAR_PIN data: the PIN's length, then the PIN
        byte[] oldClear = CashuAppletTest.concat(new byte[] { 4 }, CashuAppletTest.TEST_PIN);
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, send(0x43, 0, oldClear),
            "SET_OWNER on an owned card: no proof in a PIN, nothing written");
        assertEquals(1, infoPinState(), "the PIN is still set");
        assertEquals(SW_OK, verify(CashuAppletTest.TEST_PIN), "and still the PIN");
    }

    @Test
    @DisplayName("a no-PIN card over a partly spent counter never reads it: VERIFY_PIN is 6984, and a PIN added later starts with three tries")
    void aNoPinCardNeverReadsThePartlySpentCounterBehindIt() throws Exception {
        readyCard();
        // Run the counter down to one try: a successful VERIFY_PIN refills it, so the two wrong tries come after it.
        assertEquals(SW_OK, verify(CashuAppletTest.TEST_PIN));
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(0x63C1, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(1, pin.getTriesRemaining());
        // pinState 0 over an OwnerPIN at one try: no command makes this state (only RESET_CARD writes 0, and it makes a new card),
        // so it is set here, to show the state is one the applet tolerates
        pinState[0] = 0;

        assertEquals(0, infoPinState(), "GET_INFO reports no PIN");
        assertEquals(CashuAppletTest.SW_PIN_NOT_SET, verify(CashuAppletTest.TEST_PIN), "nothing to verify, whatever the counter says");
        assertEquals(CashuAppletTest.SW_PIN_NOT_SET, verify(CashuAppletTest.WRONG_PIN), "and a wrong PIN never reaches the counter");
        assertEquals(0, infoPinState(), "so the card can never report itself blocked from here");

        // ADD PIN (1.16): the owner's grant and SET_PIN on an owned card with no PIN. OwnerPIN.update starts it at three tries.
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, nonce(), new byte[0]);
        assertEquals(SW_OK, send(CashuAppletTest.INS_ALLOW_LOAD, 0, CashuAppletTest.ownerData(proof, new byte[0])));
        assertEquals(SW_OK, send(CashuAppletTest.INS_SET_PIN, 0, CashuAppletTest.NEW_PIN));
        assertEquals(1, infoPinState());
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN), "three fresh tries, not one");
        assertEquals(0x63C1, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(SW_OK, verify(CashuAppletTest.NEW_PIN));
    }

    @Test
    @DisplayName("a successful OwnerPIN.check refills the counter on its own, and the owner's CHANGE_PIN starts the new PIN full")
    void theCheckRefillsTheCounter() throws Exception {
        readyCard();
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(0x63C1, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(1, pin.getTriesRemaining());
        assertEquals(SW_OK, verify(CashuAppletTest.TEST_PIN));
        assertEquals(CashuApplet.PIN_MAX_TRIES, pin.getTriesRemaining(), "a successful check resets the counter; nothing in the applet wrote it");

        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN));
        byte[] newPin = CashuAppletTest.NEW_PIN;
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_PIN, CashuAppletTest.OWNER, nonce(), newPin);
        assertEquals(SW_OK, send(CashuAppletTest.INS_CHANGE_PIN, 0, CashuAppletTest.ownerData(proof, newPin)));
        assertEquals(CashuApplet.PIN_MAX_TRIES, pin.getTriesRemaining(), "OwnerPIN.update starts the new PIN at its limit");
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN), "three fresh tries");
        assertEquals(SW_OK, verify(newPin));
    }
}
