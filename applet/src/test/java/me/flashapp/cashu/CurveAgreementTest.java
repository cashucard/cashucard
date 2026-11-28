package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.FullPointLoadTest.GOOD;
import static me.flashapp.cashu.FullPointLoadTest.fullPiece;
import static me.flashapp.cashu.FullPointLoadTest.loadFull;
import static me.flashapp.cashu.FullPointLoadTest.whole;
import static me.flashapp.cashu.FullPointLoadTest.withC;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javacard.security.KeyAgreement;
import javacard.security.PrivateKey;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D251: agrees() (the curve test of a piece loaded in the 04 form and of LOAD_CHANGE's points, D212, D215) on a key and a key
 * agreement of its own (the agrees() half of A5 of the 3.2 speed review), with the red team's A5-c and A5-d. jCardSim only:
 * the counts are its, the time (about 11 ms an ask, by JCAlgTest's figures) is not shown.
 */
class CurveAgreementTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static PerPaymentKeyTest.CountingAgreement counted(UnitsTest.Card c) throws Exception {
        SchnorrHW s = ChipEnginesTest.signerOf(c);
        PerPaymentKeyTest.CountingAgreement ka = new PerPaymentKeyTest.CountingAgreement((KeyAgreement) SchnorrHWSignTest.hidden(s, "curveKA"));
        FullPointLoadTest.agreesThrough(s, ka);
        return ka;
    }
    /** An agreement whose first ask throws CryptoException, whatever it was given, and then answers as the real one. */
    static final class ThrowsOnce extends KeyAgreement {
        final KeyAgreement in;
        boolean once = true;
        ThrowsOnce(KeyAgreement in) { this.in = in; }
        @Override public void init(PrivateKey k) { in.init(k); }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public short generateSecret(byte[] a, short o, short l, byte[] out, short oo) {
            if (once) { once = false; javacard.security.CryptoException.throwIt(javacard.security.CryptoException.INVALID_INIT); }
            return in.generateSecret(a, o, l, out, oo);
        }
    }
    static int loadWhole(UnitsTest.Card c, int k) {
        byte[] p = withC(c.piece(UnitsTest.SAT_A, 8), hexToBytes(GOOD[k % GOOD.length]));
        return loadFull(c, fullPiece(p, whole(hexToBytes(GOOD[k % GOOD.length])))).getSW();
    }

    @Test
    @DisplayName("D251 (the red team's A5-c): agrees() asks an agreement of its own, given its own persistent key at G's x, never the temporary key; three pieces in the 04 form in one selection (three commands) give it its key once, and a new selection once again")
    void agreesHasAKeyOfItsOwnGivenOnceASelection() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertTrue(FullPointLoadTest.curveByAgreement(c));
        SchnorrHW s = ChipEnginesTest.signerOf(c);
        Object own = SchnorrHWSignTest.hidden(s, "curveKey"), tmp = SchnorrHWSignTest.hidden(s, "tmpPriv");
        PerPaymentKeyTest.CountingAgreement ka = counted(c);
        for (int selection = 0; selection < 2; selection++) {
            c.tap();
            int i0 = ka.inits, m0 = ka.made;
            for (int k = 0; k < 3; k++) assertEquals(SW_OK, loadWhole(c, 3 * selection + k), "piece " + k);
            assertEquals(1, ka.inits - i0, "given its key once in the selection, " + selection);
            assertEquals(3, ka.made - m0, "asked three times");
        }
        for (PrivateKey k : ka.given) {
            assertSame(own, k, "its own key");
            assertTrue(k != tmp, "never the temporary key");
        }
        byte[] gx = new byte[32];
        assertEquals(32, ((javacard.security.ECPrivateKey) own).getS(gx, (short) 0));
        assertEquals(SECP_GX, new java.math.BigInteger(1, gx), "holding G's x, a public number");
    }

    @Test
    @DisplayName("D251 (the red team's A5-d): an agreement that lost what it was given throws at its next ask; it is given its key again and asked once more, and the good piece goes on; a point off the curve is still refused 6A80, after its one more ask; and at SET_CARD a lost first ask does not turn the 04 form off for the set-up life")
    void aLostAgreementIsAskedOnceMoreAndStillRefusesABadPoint() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        PerPaymentKeyTest.CountingAgreement ka = counted(c);
        assertEquals(SW_OK, loadWhole(c, 0));
        ka.lost = true;
        int i0 = ka.inits, m0 = ka.made;
        assertEquals(SW_OK, loadWhole(c, 1), "the good piece goes on");
        assertEquals(i0 + 1, ka.inits, "given its key again");
        assertEquals(m0 + 2, ka.made, "and asked once more");
        byte[] bad = FullPointLoadTest.bad().get("G with y + 1");
        assertEquals(SW_WRONG_DATA, loadFull(c, fullPiece(c.piece(UnitsTest.SAT_A, 8), bad)).getSW(), "a point off the curve: refused");
        // SET_CARD's test with its first ask lost: still true
        UnitsTest.Card d = new UnitsTest.Card();
        SchnorrHW ds = ChipEnginesTest.signerOf(d);
        FullPointLoadTest.agreesThrough(ds, new ThrowsOnce(KeyAgreement.getInstance(KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY, false)));
        d.ready(UnitsTest.SAT, true);
        assertTrue(FullPointLoadTest.curveByAgreement(d), "the set-up's test asked G once more and held");
    }
}
