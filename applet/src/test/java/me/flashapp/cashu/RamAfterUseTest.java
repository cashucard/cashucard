package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.licel.jcardsim.base.ApduCase;
import com.licel.jcardsim.base.SimulatorRuntime;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import java.math.BigInteger;
import java.util.Arrays;
import javacard.framework.AID;
import javacard.framework.APDU;
import javacard.framework.Applet;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the sealed commands leave in RAM: the APDU buffer and `scratch` (whose first bytes are the seal's room) are kept by a
 * chip until they are next written, so a command that opened or made a seal zeroes its secret parts before it answers. The
 * runtime here keeps the APDU buffer from one command to the next, past the new command's own bytes, as a chip does (the
 * simulator's own zeroes it before every command), and loses it at a power cut; and the key agreement keeps nothing of the
 * PIN key after a sealed command.
 */
class RamAfterUseTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** A runtime whose APDU buffer keeps what the last command left past the new command's bytes, and is zeroes after a power cut. */
    static final class ChipRuntime extends SimulatorRuntime {
        @Override
        protected void resetAPDU(APDU apdu, ApduCase c, byte[] cmd) {
            byte[] b = apdu.getBuffer();
            byte[] keep = b.clone();
            super.resetAPDU(apdu, c, cmd);
            if (cmd != null) {
                int from = Math.min(cmd.length, b.length);
                System.arraycopy(keep, from, b, from, b.length - from);
            }
        }
        @Override
        public void reset() {
            super.reset();
            Arrays.fill(buffer(), (byte) 0);
        }
        Applet appletAt(AID aid) { return getApplet(aid); }
        byte[] buffer() {
            try {
                java.lang.reflect.Field f = SimulatorRuntime.class.getDeclaredField("shortAPDU");
                f.setAccessible(true);
                return ((APDU) f.get(this)).getBuffer();
            } catch (ReflectiveOperationException x) {
                throw new AssertionError(x);
            }
        }
    }

    static final class Chip {
        final ChipRuntime rt = new ChipRuntime();
        final CardSimulator sim = new CardSimulator(rt);
        final AID aid = AIDUtil.create(AID_HEX);
        Chip() { sim.installApplet(aid, CashuApplet.class); select(); }
        ResponseAPDU send(CommandAPDU c) { return held(sim::transmitCommand, c); }
        int sw(CommandAPDU c) { return send(c).getSW(); }
        void select() { assertEquals(SW_OK, sw(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR)))); }
        void power() { sim.reset(); select(); }
        Object field(String n) throws Exception {
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(n);
            f.setAccessible(true);
            return f.get(rt.appletAt(aid));
        }
        /** The PIN key made the tests' own (PIN_D): the compressed key. */
        byte[] ownPinKey() throws Exception {
            ((javacard.security.ECPrivateKey) field("pinPrivKey")).setS(unsigned32(PIN_D), (short) 0, (short) 32);
            BigInteger[] w = ecMulTest(PIN_D, SECP_GX, SECP_GY);
            ((javacard.security.ECPublicKey) field("pinPubKey")).setW(concat(new byte[] { 4 }, unsigned32(w[0]), unsigned32(w[1])), (short) 0, (short) 65);
            return compressed(w);
        }
        byte[] nonce() {
            ResponseAPDU n = send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
            assertEquals(SW_OK, n.getSW());
            return Arrays.copyOf(n.getData(), 16);
        }
        /** The seal's room: the first 99 bytes of scratch. */
        byte[] sealRoom() throws Exception { return Arrays.copyOf((byte[]) field("scratch"), 99); }
    }

    /** A PIN whose every window of four bytes is its own. */
    static final byte[] PIN = { 0x39, 0x37, 0x31, 0x35, 0x38, 0x32, 0x36, 0x30 };
    static final BigInteger R7 = BigInteger.valueOf(7);
    static final byte[] REFUND_7 = compressed(ecMulTest(R7, SECP_GX, SECP_GY));

    /** Whether any four bytes in a row of `secret` are somewhere in `in`. */
    static boolean holdsAnyOf(byte[] secret, byte[] in) {
        for (int i = 0; i + 4 <= secret.length; i++) {
            byte[] w = Arrays.copyOfRange(secret, i, i + 4);
            for (int j = 0; j + 4 <= in.length; j++) if (Arrays.equals(w, Arrays.copyOfRange(in, j, j + 4))) return true;
        }
        return false;
    }

    /** A card with no owner, the PIN, a record with refund key 7G; then a new tap with the PIN. */
    static Chip refundCard() throws Exception {
        Chip c = new Chip();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))));
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
        return c;
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 sealed to the refund key zeroes its scalar k (buffer 163..195) and the seal's room (k*R's x and the block) before it answers: after it, and after the next command, the buffer holds no k and the room is zeros; the answer still opens to c with r")
    void cSealedToTheRefundKeyLeavesNoScalar() throws Exception {
        Chip c = refundCard();
        byte[] chain = Arrays.copyOf((byte[]) c.field("chain"), 32);
        byte[] nonce = c.nonce();
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, 256));
        assertEquals(SW_OK, r.getSW());
        assertArrayEquals(chain, LinkingTest.openToRefund(r.getData(), R7, nonce), "c, opened with r");
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.rt.buffer(), 163, 195), "no k in the buffer");
        assertArrayEquals(new byte[99], c.sealRoom(), "the seal's room zeros");
        c.send(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256));
        assertArrayEquals(new byte[32], Arrays.copyOfRange(c.rt.buffer(), 163, 195), "and none after the next command");
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 sealed to the PIN key (no refund key, the first set-up) zeroes the seal's room (the x the PIN key and E share, and the block) before it answers; the answer still opens to c")
    void cSealedToThePinKeyLeavesNoSharedSecret() throws Exception {
        Chip c = new Chip();
        byte[] pinKey = c.ownPinKey();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
        byte[] chain = Arrays.copyOf((byte[]) c.field("chain"), 32);
        byte[] nonce = c.nonce();
        byte[][] ks = agreed(EPH[2], pinKey);
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, ks[0], 256));
        assertEquals(SW_OK, r.getSW());
        byte[] block = sealBlock(1, ks[1], ks[0], nonce, INS_GET_CARD, new byte[0]);
        byte[] opened = new byte[32];
        for (int i = 0; i < 32; i++) opened[i] = (byte) (r.getData()[i] ^ block[i]);
        assertArrayEquals(chain, opened, "c, opened");
        assertArrayEquals(new byte[99], c.sealRoom(), "the seal's room zeros");
        assertFalse(holdsAnyOf(ks[1], c.rt.buffer()), "no part of the shared x in the buffer");
    }

    @Test
    @DisplayName("A sealed VERIFY_PIN, right or wrong, leaves no part of the PIN in the buffer and zeros in the seal's room, after it and after the next command; so does a clear one")
    void aSealedVerifyLeavesNoPin() throws Exception {
        byte[] wrong = { 0x30, 0x36, 0x32, 0x38, 0x35, 0x31, 0x37, 0x39 };
        for (byte[] tried : new byte[][] { PIN, wrong }) {
            Chip c = new Chip();
            byte[] pinKey = c.ownPinKey();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
            c.power();
            byte[] nonce = c.nonce();
            int sw = c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, envelope(EPH[3], pinKey, nonce, INS_VERIFY_PIN, pinBlock(tried))));
            assertEquals(tried == PIN ? SW_OK : 0x63C1, sw);
            String what = tried == PIN ? "the right PIN" : "a wrong PIN";
            assertFalse(holdsAnyOf(tried, c.rt.buffer()), what + ": no part of it in the buffer");
            assertArrayEquals(new byte[99], c.sealRoom(), what + ": the seal's room zeros");
            c.send(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256));
            assertFalse(holdsAnyOf(tried, c.rt.buffer()), what + ": nor after the next command");
        }
        Chip c = new Chip();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
        c.send(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 1));
        assertFalse(holdsAnyOf(PIN, c.rt.buffer()), "the clear form: no part of the PIN in the buffer");
    }

    @Test
    @DisplayName("A sealed SET_PIN and a sealed CHANGE_PIN leave no part of the new PIN in the buffer and zeros in the seal's room; the PIN they set is the one sent")
    void aSealedSetOrChangeLeavesNoPin() throws Exception {
        // SET_PIN, sealed, on a card with no PIN
        Chip s = new Chip();
        byte[] pinKey = s.ownPinKey();
        byte[] nonce = s.nonce();
        assertEquals(SW_OK, s.sw(new CommandAPDU(CLA, INS_SET_PIN, 1, 0, envelope(EPH[1], pinKey, nonce, INS_SET_PIN, pinBlock(PIN)))));
        assertFalse(holdsAnyOf(PIN, s.rt.buffer()), "SET_PIN: no part of the PIN in the buffer");
        assertArrayEquals(new byte[99], s.sealRoom(), "SET_PIN: the seal's room zeros");
        assertEquals(SW_OK, s.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)), "the PIN set");
        // CHANGE_PIN, sealed, by the owner
        Chip c = new Chip();
        byte[] key = c.ownPinKey();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)));
        c.power();
        byte[] n = c.nonce();
        byte[] proof = ownerProof(L_PIN, OWNER, n, PIN);
        byte[] clear = concat(new byte[] { (byte) proof.length }, proof, pinBlock(PIN));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 1, 0, envelope(EPH[2], key, n, INS_CHANGE_PIN, clear))));
        assertFalse(holdsAnyOf(PIN, c.rt.buffer()), "CHANGE_PIN: no part of the PIN in the buffer");
        assertArrayEquals(new byte[99], c.sealRoom(), "CHANGE_PIN: the seal's room zeros");
        c.power();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)), "the PIN changed");
    }

    /** The scalar a simulator key agreement keeps from its last init (jCardSim's engine holds the key's parameters). Simulator only. */
    static BigInteger kept(javacard.security.KeyAgreement ka) throws Exception {
        java.lang.reflect.Field eng = ka.getClass().getDeclaredField("engine");
        eng.setAccessible(true);
        Object engine = eng.get(ka);
        java.lang.reflect.Field kf = engine.getClass().getDeclaredField("key");
        kf.setAccessible(true);
        Object params = kf.get(engine);
        return params == null ? null : (BigInteger) params.getClass().getMethod("getD").invoke(params);
    }

    @Test
    @DisplayName("After a sealed VERIFY_PIN and a GET_CARD P1 = 3 sealed to the PIN key, the key agreement holds G's x, not the PIN key, through a power cut (simulator only: the copy read is jCardSim's)")
    void theKeyAgreementKeepsNoPinKey() throws Exception {
        Chip c = new Chip();
        byte[] pinKey = c.ownPinKey();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
        java.lang.reflect.Field f = SchnorrHW.class.getDeclaredField("ecdh");
        f.setAccessible(true);
        javacard.security.KeyAgreement ecdh = (javacard.security.KeyAgreement) f.get(c.field("schnorrHW"));
        byte[] nonce = c.nonce();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, envelope(EPH[3], pinKey, nonce, INS_VERIFY_PIN, pinBlock(PIN)))));
        assertEquals(SECP_GX, kept(ecdh), "after a sealed VERIFY_PIN: G's x");
        assertFalse(PIN_D.equals(kept(ecdh)));
        c.nonce();
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, agreed(EPH[1], pinKey)[0], 256)).getSW());
        assertEquals(SECP_GX, kept(ecdh), "after c sealed to the PIN key: G's x");
        c.power();
        assertEquals(SECP_GX, kept(ecdh), "and after a power cut");
    }

    @Test
    @DisplayName("SET_CARD asks the point addition for [13]G + (-[2]G) too, before it writes anything: one that frames its answer otherwise (04 || Y || X, another point, X right and Y not) is refused 6F00 and the card has no record; the real framing sets the card up")
    void setCardRefusesAPointAdditionThatFramesOtherwise() throws Exception {
        for (String frame : new String[] { "yx", "other", "negy" }) {
            Chip c = new Chip();
            SchnorrHWSignTest.WatchedAgreement gm = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
            gm.frame = frame;
            SchnorrHWSignTest.setHidden((SchnorrHW) c.field("schnorrHW"), "gm", gm);
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
            assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))), frame + ": refused");
            assertEquals(0, ((byte[]) c.field("cardRecord"))[CashuApplet.CARD_SET_OFFSET], frame + ": no record");
            gm.frame = "";
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))), frame + ": the real framing sets it up");
        }
    }

    @Test
    @DisplayName("SET_CARD refuses (6F00) a chip whose key agreement or point addition gets the point wrong, in the key agreement, the point addition or both: an engine that answers the even root, the odd root, the plain root or p less it, one that takes Y's parity from X, one that negates the Y of each point it is given, one that works a scalar above n/2 as [n - s] and does not put the sign back, one that takes the point or generator by X alone (with the even root, or the root of X's parity), one that takes the point it adds by X alone (with the odd root, p less the root, or the root of X's parity), one that takes the generator by X alone and works a scalar above n/2 as [n - s] at once, and one right only for G; and the faults of the method itself (SchnorrHWSignTest.METHOD_FAULTS: a G path that blinds the scalar and loses the carry, a G table or a window or comb with an entry negated, an answer left Jacobian or given little-endian, a scalar read little-endian); the card has no record, and the real engines set it up")
    void setCardRefusesEnginesThatGetYWrong() throws Exception {
        java.util.List<String> engines = new java.util.ArrayList<>(java.util.Arrays.asList(SchnorrHWSignTest.WRONG_ENGINES));
        engines.addAll(java.util.Arrays.asList(SchnorrHWSignTest.METHOD_FAULTS));
        for (String how : engines) {
            for (int which = 0; which < 3; which++) {
                String what = how + (which == 0 ? ", the key agreement" : which == 1 ? ", the point addition" : ", both");
                Chip c = new Chip();
                SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
                SchnorrHWSignTest.WatchedAgreement gm = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
                if (which != 1) ecdh.frame = how;
                if (which != 0) gm.frame = how;
                SchnorrHWSignTest.setHidden((SchnorrHW) c.field("schnorrHW"), "ecdh", ecdh);
                SchnorrHWSignTest.setHidden((SchnorrHW) c.field("schnorrHW"), "gm", gm);
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, PIN)));
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, PIN)));
                assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))), what + ": refused");
                assertEquals(0, ((byte[]) c.field("cardRecord"))[CashuApplet.CARD_SET_OFFSET], what + ": no record");
                ecdh.frame = "";
                gm.frame = "";
                assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))), what + ": the real engines set it up");
            }
        }
    }

    /** A command whose data is `data`, refused `sw` on chip `c`, leaves no four bytes of it in the buffer, after it and after the next command. */
    static void refusedLeavesNone(Chip c, String what, int ins, int p1, byte[] data, int sw) {
        assertEquals(sw, c.sim.transmitCommand(new CommandAPDU(CLA, ins, p1, 0, data)).getSW(), what);
        assertFalse(holdsAnyOf(data, c.rt.buffer()), what + ": no part of its data in the buffer");
        c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 1));
        assertFalse(holdsAnyOf(data, c.rt.buffer()), what + ": nor after the next command");
    }

    /** An owned card on this runtime (PIN TEST_PIN, refund 7G, OWNER), in a new tap. */
    static Chip ownedChip() throws Exception {
        Chip c = new Chip();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND_7))));
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)));
        c.power();
        return c;
    }

    @Test
    @DisplayName("A VERIFY_PIN answered 6A98 for the wait a card with no owner owes leaves none of its data in the buffer, after it and after the next command: the clear PIN, a sealed form's 120 bytes and 100 clear bytes, each as many as its header said, though the wait's work writes over the header")
    void aPinCommandHeldForItsWaitLeavesNone() throws Exception {
        byte[] secret = { 0x39, 0x37, 0x31, 0x35, 0x38, 0x32, 0x36, 0x30 };
        byte[] sealed = new byte[120], long100 = new byte[100];
        for (int i = 0; i < sealed.length; i++) sealed[i] = (byte) (0x80 + i);
        for (int i = 0; i < long100.length; i++) long100[i] = (byte) (0x10 + i);
        Chip c = new Chip();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, secret)));
        c.power();
        for (int i = 0; i < 3; i++) c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, new byte[] { 0x30, 0x30, 0x30, 0x30 }));
        refusedLeavesNone(c, "VERIFY_PIN, the right PIN, a wait owed (clear)", INS_VERIFY_PIN, 0, secret, 0x6A98);
        refusedLeavesNone(c, "VERIFY_PIN, a wait owed (sealed)", INS_VERIFY_PIN, 1, sealed, 0x6A98);
        refusedLeavesNone(c, "VERIFY_PIN, a wait owed, 100 bytes (clear)", INS_VERIFY_PIN, 0, long100, 0x6A98);
    }

    @Test
    @DisplayName("A PIN command refused before it takes its data leaves none of it in the buffer, after it and after the next command: VERIFY_PIN on a card with no PIN (6984), with P1 2 (6A86), after a hand-over (6982) and on a blocked card (6983); SET_PIN with P1 2 (6A86), on an owned card (6A91), a new PIN with the old one not given (6982) and on a locked card (6986); CHANGE_PIN with P1 2 (6A86), on a card with no owner (6A90) and on a locked card whose PIN is not blocked (6986); clear and sealed")
    void aPinCommandRefusedBeforeItsDataLeavesNone() throws Exception {
        byte[] secret = { 0x39, 0x37, 0x31, 0x35, 0x38, 0x32, 0x36, 0x30 };
        byte[] sealed = new byte[120];
        for (int i = 0; i < sealed.length; i++) sealed[i] = (byte) (0x80 + i);
        for (byte[] data : new byte[][] { secret, sealed }) {
            int p1 = data == sealed ? 1 : 0;
            String form = data == sealed ? " (sealed)" : " (clear)";
            // VERIFY_PIN
            refusedLeavesNone(new Chip(), "VERIFY_PIN, no PIN" + form, INS_VERIFY_PIN, p1, data, 0x6984);
            Chip c = new Chip();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, secret)));
            c.power();
            refusedLeavesNone(c, "VERIFY_PIN, P1 2" + form, INS_VERIFY_PIN, 2, data, 0x6A86);
            c = ownedChip();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
            byte[] n = c.nonce();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, OTHER_OWNER.pub), OTHER_OWNER.pub))));
            refusedLeavesNone(c, "VERIFY_PIN, after a hand-over" + form, INS_VERIFY_PIN, p1, data, 0x6982);
            c = ownedChip();
            for (int i = 0; i < 3; i++) c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, new byte[] { 0x30, 0x30, 0x30, 0x30 }));
            refusedLeavesNone(c, "VERIFY_PIN, blocked" + form, INS_VERIFY_PIN, p1, data, 0x6983);
            // SET_PIN
            refusedLeavesNone(new Chip(), "SET_PIN, P1 2" + form, INS_SET_PIN, 2, data, 0x6A86);
            refusedLeavesNone(ownedChip(), "SET_PIN, an owned card" + form, INS_SET_PIN, p1, data, 0x6A91);
            c = new Chip();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
            c.power();
            refusedLeavesNone(c, "SET_PIN, the PIN not given" + form, INS_SET_PIN, p1, data, 0x6982);
            // CHANGE_PIN
            refusedLeavesNone(new Chip(), "CHANGE_PIN, P1 2" + form, INS_CHANGE_PIN, 2, data, 0x6A86);
            refusedLeavesNone(new Chip(), "CHANGE_PIN, no owner" + form, INS_CHANGE_PIN, p1, data, 0x6A90);
            // a locked card (the lock comes before SET_PIN's owner check)
            c = ownedChip();
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(ownerProof(L_LOCK, OWNER, c.nonce(), new byte[0]), new byte[0]))));
            refusedLeavesNone(c, "CHANGE_PIN, locked" + form, INS_CHANGE_PIN, p1, data, 0x6986);
            refusedLeavesNone(c, "SET_PIN, locked" + form, INS_SET_PIN, p1, data, 0x6986);
        }
    }
}
