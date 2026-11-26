package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.ChipEnginesTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.TreeSet;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D247, D248: the chip's RSA engines given their keys once a selection (A3 of the 3.2 speed review, in the red team's two forms:
 * A3a once a command, D247; A3b once a selection, D248, on top): the signature's squaring, and the field's four powers over p
 * padded, each on an engine of its own key object. The simulator refuses p for a modulus, so the padded keys here are
 * ChipEnginesTest's FakeKeys and the engines its Engines, which count what they are given, copy a key at init and lose it at a
 * selection, as a chip's may (D248). The counts are the simulator's; the time (about 6 ms an init on a J3R180) is not shown:
 * simulator only for speed.
 */
class EnginesOnceTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static int[] inits(Engine[] e) { int[] n = new int[e.length]; for (int i = 0; i < e.length; i++) n[i] = e[i].inits; return n; }
    static int[] powers(Engine[] e) { int[] n = new int[e.length]; for (int i = 0; i < e.length; i++) n[i] = e[i].powers; return n; }
    static Object call(Object o, String name) throws Exception {
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod(name);
        m.setAccessible(true);
        return m.invoke(o);
    }
    /** Three pieces of 8 in the 33-byte form, in one LOAD_PROOF. */
    static int loadThree(UnitsTest.Card c) {
        return c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, concat(c.piece(UnitsTest.SAT_A, 8), c.piece(UnitsTest.SAT_A, 8), c.piece(UnitsTest.SAT_A, 8)), 256));
    }
    static final CommandAPDU AUTH = new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 256);

    @Test
    @DisplayName("D248 (the red team's A3-e): on the card whose every Cipher is a test's engine, SET_CARD's known answers all hold through them: fieldP, fieldOwn, fieldSquare and chipMul are true")
    void theEngineCardTakesEveryFastPath() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"), "the padded keys");
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldOwn"), "their engines of their own");
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldSquare"), "the square");
        assertTrue(flag(signerOf(c), SchnorrHW.class, "chipMul"), "and the signature's squaring");
        assertEquals(0, e.stale(), "and no engine was asked a power with nothing given it");
    }

    @Test
    @DisplayName("D248: in one selection three LOAD_PROOFs of three pieces in the 33-byte form (a cube and Euler's test each) give the cube's and Euler's engines their keys once in all, every power on them and none on `rsa`; a new selection (each engine having lost what it was given) once again, and never a power asked of an engine that holds nothing")
    void theFieldsEnginesAreGivenTheirKeysOnceASelection() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        for (int selection = 0; selection < 2; selection++) {
            c.tap();
            int[] i0 = inits(e.own), p0 = powers(e.own);
            int rsaPowers = e.field.powers;
            for (int k = 0; k < 3; k++) assertEquals(SW_OK, loadThree(c), "three pieces, " + selection + "." + k);
            int[] i1 = inits(e.own), p1 = powers(e.own);
            assertEquals(1, i1[0] - i0[0], "the cube's engine given its key once in the selection, " + selection);
            assertEquals(1, i1[2] - i0[2], "and Euler's, " + selection);
            assertEquals(9, p1[0] - p0[0], "nine cubes on it");
            assertEquals(9, p1[2] - p0[2], "nine of Euler's tests");
            assertEquals(rsaPowers, e.field.powers, "no padded key's power on `rsa`");
        }
        assertEquals(0, e.stale(), "select() put the flags down: no engine was asked a power with nothing given it");
        assertEquals(144, readUint32(c.balance(0), 0), "the eighteen pieces of 8 went on");
    }

    @Test
    @DisplayName("D248 (the red team's A3-d): an engine that loses what it was given in the middle of a selection (no SELECT to say so) throws at its next power; it is given its key again and asked once more, the command answers as it would have, and the next power needs no init")
    void anEngineThatLostItsKeyIsGivenItAgainAndAskedOnceMore() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        c.tap();
        assertEquals(SW_OK, loadThree(c));
        int i0 = e.own[0].inits, s0 = e.own[0].stale;
        e.own[0].forget();
        e.own[2].forget();
        assertEquals(SW_OK, loadThree(c), "the load goes on");
        assertEquals(s0 + 1, e.own[0].stale, "the cube's engine threw once");
        assertEquals(i0 + 1, e.own[0].inits, "and was given its key again");
        assertEquals(SW_OK, loadThree(c));
        assertEquals(i0 + 1, e.own[0].inits, "and no init after");
        // the signature's squaring the same way
        int j0 = e.sign.inits;
        assertEquals(SW_OK, c.sw(AUTH));
        e.sign.forget();
        assertEquals(SW_OK, c.sw(AUTH));
        assertEquals(1, e.sign.stale, "the squaring's engine threw once");
        assertEquals(j0 + 2, e.sign.inits, "its first use in the selection, and again after it lost the key");
    }

    @Test
    @DisplayName("D248 (the red team's A3-1, A3-d): a sealed VERIFY_PIN whose engines lost what they were given (the cube's and the square's, which hold the reader's point to the curve) still opens with the right PIN, and costs no try")
    void aSealedPinWithLostEnginesCostsNoTry() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        c.tap();
        assertEquals(SW_OK, loadThree(c));
        e.own[0].forget();
        e.own[3].forget();
        byte[] w = new byte[65];
        ((javacard.security.ECPublicKey) get(c.applet(), CashuApplet.class, "pinPubKey")).getW(w, (short) 0);
        byte[] pinKey33 = compressed(new BigInteger[] { new BigInteger(1, Arrays.copyOfRange(w, 1, 33)), new BigInteger(1, Arrays.copyOfRange(w, 33, 65)) });
        javacard.framework.OwnerPIN pin = (javacard.framework.OwnerPIN) get(c.applet(), CashuApplet.class, "pin");
        int tries = pin.getTriesRemaining();
        byte[] nonce = Arrays.copyOf(c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), 16);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, envelope(EPH[3], pinKey33, nonce, INS_VERIFY_PIN, pinBlock(TEST_PIN)))), "the right PIN opens");
        assertEquals(tries, pin.getTriesRemaining(), "and no try is gone");
        assertTrue(e.own[0].stale + e.own[3].stale >= 1, "an engine did throw");
    }

    @Test
    @DisplayName("D247 (the red team's A3-c): the padded keys written again (SET_CARD's self-tests at the first SET_CARD of a set-up life: fieldPInit, fieldEngines, squareInit, run here after a command has given the cube's and Euler's engines their keys) give each engine its key again before its next power")
    void anEngineIsGivenItsKeyAgainAfterItsKeyIsWritten() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldOwn"));
        assertEquals(SW_OK, loadThree(c));
        int[] before = inits(e.own);
        // the keys written again, as the self-tests write them after a reset (which leaves fieldP false)
        Object applet = c.applet();
        set(applet, CashuApplet.class, "fieldP", false);
        assertTrue((Boolean) call(applet, "fieldPInit"));
        set(applet, CashuApplet.class, "fieldP", true);
        call(applet, "fieldEngines");
        assertTrue(flag(applet, CashuApplet.class, "fieldOwn"), "the engines answered again");
        assertTrue((Boolean) call(applet, "squareInit"));
        int[] after = inits(e.own);
        // each at least once (the cube's twice: squareInit writes the square's keys, which puts every flag down, before its own cube)
        for (int i = 0; i < 4; i++) assertTrue(after[i] > before[i], OWN[i] + " given its key again once its key was written again");
        // and written while the engines are leaned on (fieldP still true): each write puts every flag down itself
        assertTrue((Boolean) call(applet, "fieldPInit"));
        assertTrue((Boolean) call(applet, "squareInit"));
        int[] last = inits(e.own);
        for (int i = 0; i < 4; i++) assertTrue(last[i] > after[i], OWN[i] + " given its key again by the next power after its key was written");
        assertEquals(0, e.stale(), "never a power with nothing given");
    }

    @Test
    @DisplayName("D247 (the red team's A3-a): each engine of the field's own is only ever given its own padded key object: in powRaw each is chosen for one key alone, and nothing else names them but their making and their test; `rsa`, which keeps the p*p keys and every other power, is given its key before every power")
    void eachEngineServesOneKeyObject() throws Exception {
        String src = WipesTest.source("CashuApplet.java");
        int[] p = SchnorrHWMathTest.bodyRange(src, "private void powRaw(");
        String powRaw = src.substring(p[0], p[1]).replaceAll("\\s+", " ");
        String[][] pairs = { { "rsaCubeP", "rsaCubeE", "0" }, { "rsaRootP", "rsaRootE", "1" }, { "rsaEulerP", "rsaEulerE", "2" }, { "rsaSquareP", "rsaSquareE", "3" } };
        for (String[] k : pairs) {
            assertTrue(powRaw.contains("key == " + k[0] + ") { c = " + k[1] + "; i = " + k[2] + "; }"), k[1] + " is chosen for " + k[0] + " alone");
            assertEquals(new TreeSet<>(Arrays.asList("(class body)", "powRaw", "fieldEngines")), ProofStoreTest.methodsNaming(src, k[1]), k[1] + " is named in its making and powRaw only");
        }
        assertTrue(powRaw.contains("Cipher c = rsa; short i = -1;"), "`rsa` the engine of every other key");
        assertTrue(powRaw.contains("if (i < 0 || engineReady[i] != (byte) 1) c.init(key, Cipher.MODE_DECRYPT);"), "`rsa` (i < 0) given its key before every power");
        assertFalse(powRaw.contains("rsaCube)") || powRaw.contains("rsaRoot)") || powRaw.contains("rsaEuler)") || powRaw.contains("rsaSquare)"), "no p*p key is given an engine of a padded one");
    }

    @Test
    @DisplayName("D247, D248: a signer with the flags gives its squaring engine sqKey once a selection: chipMulInit's known answers once, then each signature with no init (the flags put down only at a selection, as select() does); chipMulInit run again (the key written again) gives it again; one that throws is given its key again and asked once more, so the chip's signature stands; a signer with no flags gives the key before every squaring, as 3.2 at c816133 did")
    void theSignaturesSquaringIsGivenItsKeyOnceASelection() throws Exception {
        SignHardeningTest.Rec eng = new SignHardeningTest.Rec();
        SchnorrHW s = signerWith(eng);
        byte[] ready = new byte[6];
        set(s, SchnorrHW.class, "ready", ready);
        assertTrue(s.chipMulInit());
        assertEquals(1, eng.inits, "chipMulInit's known answers: one init");
        s.chipMul = true;
        BigInteger d = new BigInteger("11223344556677889900AABBCCDDEEFF11223344556677889900AABBCCDDEEFF", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32], sig = new byte[64];
        int powers = eng.powers;
        for (int k = 0; k < 3; k++) {
            msg[0] = (byte) k;
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        }
        assertEquals(12, eng.powers - powers, "four squarings a signature");
        assertEquals(1, eng.inits, "and no init for them in the selection");
        Arrays.fill(ready, (byte) 0);                       // a new selection
        assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertEquals(2, eng.inits, "one at the new selection's first");
        assertTrue(s.chipMulInit(), "the key written again");
        assertEquals(3, eng.inits, "given again");
        // a squaring that throws (the engine lost what it was given, with no selection to say so): given its key again and asked
        // once more, in place
        SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        SchnorrHWSignTest.setHidden(s, "ecdh", ecdh);
        eng.ins.clear();
        eng.call = 0;
        eng.forget();
        int i0 = eng.inits;
        assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        assertEquals(1, eng.stale, "it threw once");
        assertEquals(i0 + 1, eng.inits, "given its key again once");
        assertEquals(5, eng.ins.size(), "the four squarings and the one asked again");
        assertEquals(2, ecdh.given.size(), "and the chip's signature stood: R and [e]Q once, no signature by the bytecode");
        // no flags: every squaring gives the key
        SignHardeningTest.Rec old = new SignHardeningTest.Rec();
        SchnorrHW t = signerWith(old);
        assertTrue(t.chipMulInit());
        t.chipMul = true;
        int j0 = old.inits, q0 = old.powers;
        assertEquals(64, t.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertEquals(old.powers - q0, old.inits - j0, "with no flags, a key before every squaring");
    }

    @Test
    @DisplayName("D248: on a card, three AUTHs in one selection give the signature's squaring its key once; a new selection once again")
    void authsInOneSelectionGiveTheKeyOnce() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(signerOf(c), SchnorrHW.class, "chipMul"));
        for (int selection = 0; selection < 2; selection++) {
            c.power();
            int i0 = e.sign.inits, p0 = e.sign.powers;
            for (int k = 0; k < 3; k++) assertEquals(SW_OK, c.sw(AUTH));
            assertEquals(1, e.sign.inits - i0, "one init in the selection, " + selection);
            assertEquals(12, e.sign.powers - p0, "for twelve squarings");
        }
        assertEquals(0, e.stale(), "never a power with nothing given");
    }

    @Test
    @DisplayName("D247: where an engine of its own fails its known answer at SET_CARD, fieldOwn is false and every power is on `rsa`, given its key each time, as before")
    void aFailedEngineIsNotLeanedOn() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = unsetCard(e);
        e.own[1].lie = true;
        c.ready(UnitsTest.SAT, true);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"));
        assertFalse(flag(c.applet(), CashuApplet.class, "fieldOwn"), "the root's engine lied: none is leaned on");
        int p0 = e.field.powers, i0 = e.field.inits, o = e.own[0].powers;
        assertEquals(SW_OK, c.load(c.piece(UnitsTest.SAT_A, 8)).getSW());
        assertEquals(2, e.field.powers - p0, "the cube and Euler's test on `rsa`");
        assertEquals(2, e.field.inits - i0, "each given its key");
        assertEquals(o, e.own[0].powers, "nothing on the engines of their own");
    }
}
