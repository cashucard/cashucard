package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.TearSweepTest.*;
import static org.junit.jupiter.api.Assertions.*;

import javacard.framework.ISOException;
import javacard.security.CryptoException;
import javacard.security.Key;
import javacardx.crypto.Cipher;
import javax.smartcardio.CommandAPDU;
import me.flashapp.cashu.TearSweepTest.Card;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The independent review of merge-3.0 (28866bf), S2. SPEND_ALL_CHANGE caught only a CryptoException from the change's
 * arithmetic (blindChange: hash to the curve on the chip's RSA, then Y + r*G); a 6F00 that the arithmetic raises itself (an
 * ISOException: powModP's guard of an x at or over p, the key agreement's framing check) left the payment open, with allNet
 * already counting this change, so a later output or change could be refused 6A80 for room it never took. The spec says a
 * refusal of SPEND_ALL_CHANGE gives the payment up: now that 6F00 does too, nothing burned, no opening drafted.
 */
class ChangeFaultTest {

    static final CommandAPDU SIGN = new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64);

    @AfterEach
    void noLimit() { TearHook.fullAt = null; TearHook.tearAfterCommit = null; }

    /** The applet's RSA (the p*p keys of the change's hash to the curve, D214's fallback on the simulator), answering 6F00 inside blindChange while armed. */
    static final class FaultyCipher extends Cipher {
        final Cipher in;
        boolean armed = true;
        FaultyCipher(Cipher in) { this.in = in; }
        @Override public void init(Key k, byte m) throws CryptoException { in.init(k, m); }
        @Override public void init(Key k, byte m, byte[] b, short o, short l) throws CryptoException { in.init(k, m, b, o, l); }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public byte getPaddingAlgorithm() { return in.getPaddingAlgorithm(); }
        @Override public byte getCipherAlgorithm() { return in.getCipherAlgorithm(); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException {
            // only inside the change's own arithmetic (blindChange), not K's curve check before it
            if (armed && java.util.Arrays.stream(Thread.currentThread().getStackTrace()).anyMatch(f -> f.getMethodName().equals("blindChange"))) {
                ISOException.throwIt(CashuApplet.SW_CRYPTO_ERROR);
            }
            return in.doFinal(a, o, l, out, oo);
        }
        @Override public short update(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException { return in.update(a, o, l, out, oo); }
    }

    @Test
    @DisplayName("S2: a 6F00 raised inside the change's arithmetic gives the payment up (6985 to SIGN), nothing burned and no opening drafted; the same payment begun again makes its change and is signed")
    void aSixFZeroInTheChangeGivesThePaymentUp() throws Exception {
        Card c = ShapeAfterSignTest.cardWith(2, 100);
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ShapeAfterSignTest.ones(1))).getSW());
        FaultyCipher faulty = (FaultyCipher) PerPaymentKeyTest.wrap(c.applet, c.applet.getClass(), "rsa", o -> new FaultyCipher((Cipher) o));

        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, c.sw(changeCommand(1, mintKey())), "the change's arithmetic: 6F00");
        assertEquals(0x6985, c.sw(SIGN), "the payment is given up");
        assertEquals(CashuApplet.STATUS_UNSPENT, c.status(0), "nothing burned");
        for (int k = 0; k < CashuApplet.CHANGE_MOST; k++) assertEquals(CashuApplet.OPEN_EMPTY, c.f("openState")[k], "no opening drafted: " + k);

        faulty.armed = false;
        assertEquals(SW_OK, c.send(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, ShapeAfterSignTest.ones(1))).getSW());
        assertEquals(33, c.send(changeCommand(98, mintKey())).getData().length, "the change, up to the whole of the rest");
        assertEquals(64, signThrough(c::send).getData().length, "signed");
    }
}
