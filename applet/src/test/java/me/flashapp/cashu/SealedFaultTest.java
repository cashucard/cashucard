package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import javacard.security.CryptoException;
import javacard.security.Key;
import javacardx.crypto.Cipher;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D254 (the red team's A5-e): in a sealed command, an exception of the card's own engines, in the curve check of the reader's
 * point or after it, is the card's fault and answers 6F00 with no PIN try counted; only a point that is no point (6A80) or a
 * tag that does not match is an envelope that does not open. The red team proved on 3.2 that an engine exception there cost a
 * try with the right PIN (`anEngineExceptionInASealedPinCostsATry`).
 */
class SealedFaultTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    /** The applet's RSA, passed through, and throwing at doFinal while armed (as a Cipher used without a fresh init may). */
    static final class Stale extends Cipher {
        final Cipher real;
        boolean armed;
        int calls;
        Stale(Cipher real) { this.real = real; }
        @Override public void init(Key k, byte m) { real.init(k, m); }
        @Override public void init(Key k, byte m, byte[] b, short o, short l) { real.init(k, m, b, o, l); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public byte getPaddingAlgorithm() { return real.getPaddingAlgorithm(); }
        @Override public byte getCipherAlgorithm() { return real.getCipherAlgorithm(); }
        @Override public short update(byte[] a, short o, short l, byte[] out, short oo) { return real.update(a, o, l, out, oo); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) {
            calls++;
            if (armed) CryptoException.throwIt(CryptoException.INVALID_INIT);
            return real.doFinal(a, o, l, out, oo);
        }
    }

    /** A card with a PIN and the tests' PIN key, in a new tap. */
    static RamAfterUseTest.Chip chip(byte[][] pinKey) throws Exception {
        RamAfterUseTest.Chip c = new RamAfterUseTest.Chip();
        pinKey[0] = c.ownPinKey();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, RamAfterUseTest.PIN)));
        c.power();
        return c;
    }
    static int tries(RamAfterUseTest.Chip c) throws Exception { return ((javacard.framework.OwnerPIN) c.field("pin")).getTriesRemaining(); }
    static int sealedVerify(RamAfterUseTest.Chip c, BigInteger e, byte[] key, byte[] nonce) {
        return c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, envelope(e, key, nonce, INS_VERIFY_PIN, pinBlock(RamAfterUseTest.PIN))));
    }

    @Test
    @DisplayName("D254: the RSA engine throwing in the sealed VERIFY_PIN's curve check (even once asked again, D248) answers 6F00 with the right PIN, costs no try and uses the sixteen bytes up; with the engine working again the same PIN opens")
    void anEngineExceptionInTheCurveCheckCostsNoTry() throws Exception {
        byte[][] key = new byte[1][];
        RamAfterUseTest.Chip c = chip(key);
        int before = tries(c);
        Stale stale = new Stale((Cipher) c.field("rsa"));
        RedTeamFields.set(c.rt.appletAt(c.aid), "rsa", stale);
        stale.armed = true;
        byte[] nonce = c.nonce();
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, sealedVerify(c, EPH[3], key[0], nonce), "the card's fault: 6F00");
        assertTrue(stale.calls > 0, "the curve check asked the RSA");
        assertEquals(before, tries(c), "and no try is gone");
        assertEquals(0x6985, sealedVerify(c, EPH[3], key[0], nonce), "the sixteen bytes used up");
        stale.armed = false;
        assertEquals(SW_OK, sealedVerify(c, EPH[3], key[0], c.nonce()), "the engine working again: the right PIN opens");
    }

    @Test
    @DisplayName("D254: the PIN key's agreement throwing after the curve check passed answers 6F00 and costs no try")
    void anAgreementExceptionAfterTheCheckCostsNoTry() throws Exception {
        byte[][] key = new byte[1][];
        RamAfterUseTest.Chip c = chip(key);
        int before = tries(c);
        SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        SchnorrHWSignTest.setHidden((SchnorrHW) c.field("schnorrHW"), "ecdh", ecdh);
        byte[] nonce = c.nonce();                           // (GET_NONCE P1 = 1 signs the PIN key by the same agreement: asked first)
        ecdh.fail = true;
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, sealedVerify(c, EPH[3], key[0], nonce), "6F00");
        assertEquals(before, tries(c), "no try is gone");
        ecdh.fail = false;
        assertEquals(SW_OK, sealedVerify(c, EPH[3], key[0], c.nonce()), "and then it opens");
    }

    @Test
    @DisplayName("D254: an envelope that does not open still costs a try: a tag that is not this sum's (sealed to another key), and a reader's point that is no point of the curve (6A80 in the curve check)")
    void anEnvelopeThatDoesNotOpenStillCostsATry() throws Exception {
        byte[][] key = new byte[1][];
        RamAfterUseTest.Chip c = chip(key);
        int before = tries(c);
        byte[] other = compressed(ecMulTest(BigInteger.valueOf(12345), SECP_GX, SECP_GY));
        assertEquals(0x63C0, sealedVerify(c, EPH[3], other, c.nonce()) & 0xFFF0, "sealed to another key: a wrong PIN's answer");
        assertEquals(before - 1, tries(c), "a try");
        RamAfterUseTest.Chip d = chip(key);
        int b2 = tries(d);
        byte[] env = envelope(EPH[3], key[0], d.nonce(), INS_VERIFY_PIN, pinBlock(RamAfterUseTest.PIN));
        env[64] ^= 1;                                            // E's y one off: no point of the curve
        assertEquals(0x63C0, d.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, env)) & 0xFFF0, "a point that is no point: a wrong PIN's answer");
        assertEquals(b2 - 1, tries(d), "a try");
    }

    /** Fields of the applet by name. */
    static final class RedTeamFields {
        static void set(Object o, String name, Object v) throws Exception {
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
            f.setAccessible(true);
            f.set(o, v);
        }
    }
}
