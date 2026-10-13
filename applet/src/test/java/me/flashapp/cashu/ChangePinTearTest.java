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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * D22 (fix 4c): a CHANGE_PIN torn between its two writes.
 *
 * CHANGE_PIN writes the new PIN (OwnerPIN.update, which also refills the tries) and then pinState 1. On a blocked
 * card, torn between the two, 1.20 was left with pinState 2 over a new PIN with three tries: VERIFY_PIN keyed on the
 * counter alone, so it verified, and the gates that key on the verified flag (a payment) opened while those that key on
 * pinState 1 (a load) refused. A card that GET_INFO calls blocked paid. In 2.0 pinState is the PIN's commit byte: every
 * PIN gate reads it, and a card torn there is blocked until the owner's CHANGE_PIN is sent again.
 *
 * jCardSim cannot tear a write, and its transactions do not roll back, so the torn state is set on the card directly
 * (the ExposedRuntime pattern of SlotWriteOrderTest), and the order is scanned in the source.
 */
class ChangePinTearTest {

    private static final byte CLA = CashuAppletTest.CLA;
    private static final int SW_OK = CashuAppletTest.SW_OK;

    private CardSimulator sim;
    private CashuAppletTest.ExposedRuntime runtime;
    private byte[] pinState;
    private OwnerPIN pin;

    @BeforeEach
    void readyCardWithAPiece() throws Exception {
        runtime = new CashuAppletTest.ExposedRuntime();
        sim = new CardSimulator(runtime);
        AID aid = AIDUtil.create(CashuAppletTest.AID_HEX);
        sim.installApplet(aid, CashuApplet.class);
        assertEquals(SW_OK, reselect());
        CashuAppletTest.readyOn(sim, 0);
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.PROOF_1, 1)).getSW());
        Applet applet = runtime.appletAt(aid);
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("pinState");
        f.setAccessible(true);
        pinState = (byte[]) f.get(applet);
        java.lang.reflect.Field p = CashuApplet.class.getDeclaredField("pin");
        p.setAccessible(true);
        pin = (OwnerPIN) p.get(applet);
    }

    private int reselect() {
        return sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))).getSW();
    }

    private void newTap() {
        sim.reset();
        assertEquals(SW_OK, reselect());
    }

    private int send(int ins, byte[] data) { return sim.transmitCommand(new CommandAPDU(CLA, ins, 0, 0, data)).getSW(); }
    private int verify(byte[] p) { return send(CashuAppletTest.INS_VERIFY_PIN, p); }

    private int pay() {
        ResponseAPDU begun = sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { 0 }, 4));
        if (begun.getSW() != SW_OK) return begun.getSW();
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW();
    }

    private int pieceStatus() {
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_PROOF, 0, 0, 256)).getData()[0] & 0xFF;
    }

    private byte[] nonce() {
        return sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16)).getData();
    }

    private int changePin(byte[] newPin) {
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_PIN, CashuAppletTest.OWNER, nonce(), newPin);
        return send(CashuAppletTest.INS_CHANGE_PIN, CashuAppletTest.ownerData(proof, newPin));
    }

    private int allowLoad() {
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, nonce(), new byte[0]);
        return send(CashuAppletTest.INS_ALLOW_LOAD, CashuAppletTest.ownerData(proof, new byte[0]));
    }

    private int setAllowance(long sats) {
        byte[] value = CashuAppletTest.concat(CashuAppletTest.u32(0), CashuAppletTest.u32(0), CashuAppletTest.u32(sats));
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), value);
        return send(CashuAppletTest.INS_SET_LIMIT_OWNER, CashuAppletTest.ownerData(proof, value));
    }

    /** The card a torn CHANGE_PIN on a blocked card leaves: the new PIN written (and the tries refilled with it), pinState still 2. */
    private void tearAChangePinOnABlockedCard() {
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(0x63C1, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(CashuAppletTest.SW_PIN_BLOCKED, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(2, pinState[0]);
        pin.update(CashuAppletTest.NEW_PIN, (short) 0, (byte) CashuAppletTest.NEW_PIN.length);
        assertEquals(CashuApplet.PIN_MAX_TRIES, pin.getTriesRemaining(), "the PIN's write refilled the tries");
        assertEquals(2, pinState[0], "and the state byte, the commit, was never written");
    }

    @Test
    @DisplayName("torn CHANGE_PIN: VERIFY_PIN with the new PIN is 6983 on the state byte alone, and costs no try")
    void verifyRefusesTheTornState() {
        tearAChangePinOnABlockedCard();
        newTap();
        assertEquals(CashuAppletTest.SW_PIN_BLOCKED, verify(CashuAppletTest.NEW_PIN), "the new PIN does not open a card whose state says blocked");
        assertEquals(CashuAppletTest.SW_PIN_BLOCKED, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(CashuApplet.PIN_MAX_TRIES, pin.getTriesRemaining(), "refused before the check: no try spent");
    }

    @Test
    @DisplayName("torn CHANGE_PIN: a payment is refused (no PIN, no allowance) and burns nothing; a load is refused, even with the owner's grant")
    void spendAndLoadRefuseTheTornState() {
        assertEquals(SW_OK, setAllowance(5000), "an allowance, which a blocked card must not have");
        tearAChangePinOnABlockedCard();
        newTap();
        verify(CashuAppletTest.NEW_PIN);
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(), "a payment on the torn card");
        assertEquals(1, pieceStatus(), "the piece is unspent");
        assertEquals(CashuAppletTest.SW_SECURITY_NOT_SATIS,
            sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.PROOF_2, 1)).getSW(), "a load");
        assertEquals(SW_OK, allowLoad());
        assertEquals(CashuAppletTest.SW_SECURITY_NOT_SATIS,
            sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.PROOF_2, 1)).getSW(),
            "a load with the owner's grant: a blocked PIN waives nothing");
        assertEquals(2, sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_GET_INFO, 0, 0, 256)).getData()[7], "GET_INFO says blocked, and is right");
    }

    @Test
    @DisplayName("a verified session over state 2, set directly, opens no gate: the byte, not the flag, says whether the PIN is good")
    void aVerifiedFlagOverStateTwoOpensNothing() throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("pinVerifiedFlag");
        f.setAccessible(true);
        tearAChangePinOnABlockedCard();
        newTap();
        // the flag is transient memory: set it as a verify that ran before the tear would have left it
        byte[] flag = (byte[]) f.get(appletOf());
        flag[0] = 1;
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(), "the payment gate");
        assertEquals(1, pieceStatus());
        flag[0] = 1;
        assertEquals(CashuAppletTest.SW_SECURITY_NOT_SATIS, sim.transmitCommand(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_AGAIN, 0, 0, 64)).getSW(),
            "SPEND_ALL_AGAIN's gate (requirePinIfSet)");
    }

    @Test
    @DisplayName("the owner finishes a torn CHANGE_PIN by sending it again: state 1, the new PIN verifies and pays")
    void theOwnerFinishesIt() {
        tearAChangePinOnABlockedCard();
        newTap();
        assertEquals(SW_OK, changePin(CashuAppletTest.NEW_PIN));
        assertEquals(1, pinState[0]);
        assertEquals(SW_OK, verify(CashuAppletTest.NEW_PIN));
        assertEquals(SW_OK, pay());
        assertEquals(2, pieceStatus());
    }

    @Test
    @DisplayName("a check torn before failPinCheck wrote state 2 (state 1, no tries) has no allowance either, and VERIFY_PIN is 6983")
    void aTornFailedCheckHasNoAllowance() {
        assertEquals(SW_OK, setAllowance(5000));
        assertEquals(0x63C2, verify(CashuAppletTest.WRONG_PIN));
        assertEquals(0x63C1, verify(CashuAppletTest.WRONG_PIN));
        // the third wrong check's counter decrement landed, its pinState 2 did not
        assertFalse(pin.check(CashuAppletTest.WRONG_PIN, (short) 0, (byte) 4));
        assertEquals(0, pin.getTriesRemaining());
        assertEquals(1, pinState[0]);
        newTap();
        assertEquals(CashuAppletTest.SW_PIN_BLOCKED, verify(CashuAppletTest.TEST_PIN));
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(), "no allowance on a card whose counter is spent");
        assertEquals(1, pieceStatus());
    }

    // ── the order, in the source ─────────────────────────────────────────────

    @Test
    @DisplayName("VERIFY_PIN refuses state 2 before it checks; CHANGE_PIN and SET_PIN write the PIN then pinState 1 inside one transaction")
    void theSourceKeepsTheOrder() throws Exception {
        String src = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")),
            java.nio.charset.StandardCharsets.UTF_8);
        List<String> v = tearViolations(src);
        assertTrue(v.isEmpty(), String.join("\n", v));
    }

    @Test
    @DisplayName("the scan fails a VERIFY_PIN keyed on the counter alone and a CHANGE_PIN outside a transaction")
    void theScanCanSayNo() {
        String verifyGood = " private void processVerifyPin(APDU apdu) { if (pinState[0] == (byte) 2 || pin.getTriesRemaining() == 0) ISOException.throwIt(SW_PIN_BLOCKED); boolean ok = pin.check(buf, o, l); }";
        String change = " private void processChangePin(APDU apdu) { JCSystem.beginTransaction(); pin.update(buf, at, n); pinState[0] = (byte) 1; JCSystem.commitTransaction(); }";
        String set = " private void processSetPin(APDU apdu) { JCSystem.beginTransaction(); pin.update(buf, at, n); pinState[0] = (byte) 1; JCSystem.commitTransaction(); }";
        String good = "class A {" + verifyGood + change + set + " }";
        assertTrue(tearViolations(good).isEmpty(), String.join("\n", tearViolations(good)));
        String counterOnly = good.replace("pinState[0] == (byte) 2 || ", "");
        assertFalse(tearViolations(counterOnly).isEmpty(), "VERIFY_PIN keyed on the counter alone passed");
        String noTxn = good.replace(change, " private void processChangePin(APDU apdu) { pin.update(buf, at, n); pinState[0] = (byte) 1; }");
        assertFalse(tearViolations(noTxn).isEmpty(), "CHANGE_PIN outside a transaction passed");
    }

    static List<String> tearViolations(String raw) {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(raw);
        List<String> out = new ArrayList<>();
        String verify = body(src, "void processVerifyPin(");
        if (verify == null) out.add("no processVerifyPin");
        else {
            int state = verify.indexOf("pinState[0] == (byte) 2");
            int check = verify.indexOf("pin.check(");
            if (state < 0) out.add("VERIFY_PIN does not refuse pinState 2 on the byte alone");
            else if (check >= 0 && check < state) out.add("VERIFY_PIN checks the PIN before it reads the state byte");
        }
        for (String m : new String[] { "void processChangePin(", "void processSetPin(" }) {
            String b = body(src, m);
            if (b == null) { out.add("no " + m); continue; }
            int begin = b.indexOf("JCSystem.beginTransaction()");
            int update = b.indexOf("pin.update(");
            int state = b.indexOf("pinState[0] = (byte) 1");
            int commit = b.indexOf("JCSystem.commitTransaction()");
            if (begin < 0 || commit < 0 || update < 0 || state < 0 || !(begin < update && update < state && state < commit)) {
                out.add(m + " does not write the PIN then pinState 1 inside one transaction");
            }
        }
        return out;
    }

    private static String body(String src, String decl) {
        int d = src.indexOf(decl);
        if (d < 0) return null;
        int open = src.indexOf('{', d);
        int depth = 0;
        for (int i = open; i < src.length(); i++) {
            char c = src.charAt(i);
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return src.substring(open, i);
        }
        return null;
    }

    private Applet appletOf() {
        return runtime.appletAt(AIDUtil.create(CashuAppletTest.AID_HEX));
    }
}
