package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.FullPointLoadTest.GOOD;
import static me.flashapp.cashu.FullPointLoadTest.fullPiece;
import static me.flashapp.cashu.FullPointLoadTest.loadFull;
import static me.flashapp.cashu.FullPointLoadTest.whole;
import static me.flashapp.cashu.FullPointLoadTest.withC;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.payWithChange;
import static me.flashapp.cashu.KeysetKeysTest.show;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.Map;
import javacard.security.KeyAgreement;
import javacardx.crypto.Cipher;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D255: a piece loaded in the 33-byte form has its C's form checked alone (02 or 03, an x under p) and is stored as it came;
 * the 04 form is still held to the curve by the chip's key agreement, and LOAD_CHANGE's points are held to it as before.
 * The red team's applet pass (REDTEAM-curve-check-applet.md) planted such pieces and read every command back; this keeps the
 * parts of it that are the rule.
 */
class FormOnlyTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("D255: a 33-byte C whose x has no root is stored as it came (9000) and pays as any piece does, the card computing nothing with it (BEGIN, an output, SIGN: 9000); its nonce sent again with a good C is refused 6A94, a piece's identity being its nonce")
    void aNoRootCIsStoredAndPays() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] noRoot = withC(c.piece(UnitsTest.SAT_A, 32), ReaderChecksTest.offCurve());
        int place = c.load(noRoot).getData()[0] & 0xFF;
        assertArrayEquals(Arrays.copyOfRange(noRoot, 44, 77), Arrays.copyOfRange(c.slot(place), 45, 78), "the C as it came");
        assertEquals(32, readUint32(c.balance(0), 0), "counted as the card counts every piece");
        byte[] again = noRoot.clone();
        System.arraycopy(hexToBytes(GOOD[0]), 0, again, 44, 33);
        assertEquals(SW_PIECE_ON_CARD, c.load(again).getSW(), "the same nonce with a good C");
        c.tap();
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(31, blinded(41)))));
        assertEquals(64, c.sign().getData().length, "signed: the mint is what refuses it");
    }

    @Test
    @DisplayName("D255: the form checks still refuse, 6A80 with nothing written: a prefix other than 02 or 03 (00, 01, 04, 05, FF), and an x at or over p (p, p + 1, 2^256 - 1)")
    void theFormIsStillChecked() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Map<String, byte[]> before = c.snapshot();
        for (int prefix : new int[] { 0x00, 0x01, 0x04, 0x05, 0xFF }) {
            byte[] cc = hexToBytes(GOOD[0]);
            cc[0] = (byte) prefix;
            assertEquals(SW_WRONG_DATA, c.load(withC(c.piece(UnitsTest.SAT_A, 8), cc)).getSW(), "prefix " + prefix);
        }
        BigInteger[] xs = { SECP_P, SECP_P.add(BigInteger.ONE), BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE) };
        for (BigInteger x : xs) {
            byte[] cc = concat(new byte[] { 2 }, unsigned32(x));
            assertEquals(SW_WRONG_DATA, c.load(withC(c.piece(UnitsTest.SAT_A, 8), cc)).getSW(), "x = " + x.toString(16));
        }
        c.assertUnchanged(before, "nothing written");
    }

    @Test
    @DisplayName("D255: the 04 form is still held to the curve: G's x with a y that is not G's is refused 6A80, never stored as the other point; and LOAD_CHANGE still refuses a C_ off the curve (6A80, the opening still owed), by the agreement and by the card's own test alike")
    void theWholeFormAndTheChangeAreStillHeldToTheCurve() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_WRONG_DATA, loadFull(c, fullPiece(c.piece(UnitsTest.SAT_A, 8), FullPointLoadTest.bad().get("G with y + 1"))).getSW());
        c.assertUnchanged(before, "nothing written");
        for (boolean byAgreement : new boolean[] { true, false }) {
            UnitsTest.Card d = KeysetKeysTest.card();
            FullPointLoadTest.setCurveByAgreement(d, byAgreement);
            taught(d, A);
            int place = d.put(-1, A.id8(), 64);
            byte[] row = payWithChange(d, place, 8, A.keyFor(8), null);
            d.power();
            assertEquals(SW_OK, show(d, row[0], A, 8));
            byte[] answer = mintAnswer(A.privFor(8), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
            byte[] off = answer.clone();
            off[64] ^= 1;
            assertEquals(SW_WRONG_DATA, d.sw(loadChangeCommand(row[0], off)), "C_ off the curve, by agreement " + byAgreement);
            assertEquals(SW_OK, d.sw(loadChangeCommand(row[0], answer)), "and the right answer goes on");
        }
    }

    @Test
    @DisplayName("D255: what each form's check costs, counted (simulator only for time): the 33-byte form, no power of the chip's RSA and no key agreement (two powers, the cube and Euler's test, before D255); the 04 form, one key agreement and no power")
    void whatEachFormsCheckCosts() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Object applet = c.applet();
        SchnorrHW s = ChipEnginesTest.signerOf(c);
        PerPaymentKeyTest.CountingCipher rsa = (PerPaymentKeyTest.CountingCipher) PerPaymentKeyTest.wrap(applet, CashuApplet.class, "rsa", o -> new PerPaymentKeyTest.CountingCipher((Cipher) o));
        PerPaymentKeyTest.CountingAgreement curve = new PerPaymentKeyTest.CountingAgreement((KeyAgreement) SchnorrHWSignTest.hidden(s, "curveKA"));
        FullPointLoadTest.agreesThrough(s, curve);
        int p0 = rsa.powers, a0 = curve.made;
        assertEquals(SW_OK, c.load(c.piece(UnitsTest.SAT_A, 8)).getSW());
        int compactPowers = rsa.powers - p0, compactAsks = curve.made - a0;
        p0 = rsa.powers;
        a0 = curve.made;
        assertEquals(SW_OK, loadFull(c, fullPiece(c.piece(UnitsTest.SAT_A, 8), whole(hexToBytes(GOOD[1])))).getSW());
        int wholePowers = rsa.powers - p0, wholeAsks = curve.made - a0;
        System.out.println("D255 the check of a loaded C, counted: the 33-byte form " + compactPowers + " RSA powers, " + compactAsks
            + " key agreements; the 04 form " + wholePowers + " RSA powers, " + wholeAsks + " key agreement");
        assertEquals(0, compactPowers, "the 33-byte form: no power");
        assertEquals(0, compactAsks, "and no agreement");
        assertEquals(0, wholePowers, "the 04 form: no power");
        assertEquals(1, wholeAsks, "one agreement");
    }
}
