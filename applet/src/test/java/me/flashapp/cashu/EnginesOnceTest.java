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
 * D247: the chip's RSA engines given their keys once a command (A3 of the 3.2 speed review, in the red team's safe form A3a):
 * the signature's squaring, and the field's four powers over p padded, each on an engine of its own key object. The simulator
 * refuses p for a modulus, so the padded keys here are ChipEnginesTest's FakeKeys and the engines its Engines, which count what
 * they are given; the counts are the simulator's, and the time (about 6 ms an init on a J3R180) is not shown: simulator only
 * for speed.
 */
class EnginesOnceTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final String[] OWN = { "rsaCubeE", "rsaRootE", "rsaEulerE", "rsaSquareE" };

    /** A card not yet set up whose chip has the padded keys (FakeKeys, the square's too) and an engine of each padded key's own. */
    static Engine[] ownEngines(UnitsTest.Card c) throws Exception {
        set(c.applet(), CashuApplet.class, "rsaSquareP", new FakeKey());
        Engine[] own = new Engine[4];
        for (int i = 0; i < 4; i++) {
            own[i] = new Engine(null);
            set(c.applet(), CashuApplet.class, OWN[i], own[i]);
        }
        return own;
    }
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

    @Test
    @DisplayName("D247: where the padded keys hold, SET_CARD makes the field's engines and holds each to a known answer through itself (fieldOwn); a LOAD_PROOF of three pieces in the 33-byte form (a cube and Euler's test each) gives the cube's and Euler's engines their keys once each, every power on them and none on `rsa`; the next command gives each its key once again (once a command, never more)")
    void theFieldsEnginesAreGivenTheirKeysOnceACommand() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = unsetCard(e);
        Engine[] own = ownEngines(c);
        c.ready(UnitsTest.SAT, true);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"), "the padded keys held");
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldOwn"), "and the engines of their own answered");
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldSquare"), "the square's known answers through its own engine");
        for (int command = 0; command < 3; command++) {
            int[] i0 = inits(own), p0 = powers(own);
            int rsaPowers = e.field.powers;
            assertEquals(SW_OK, loadThree(c), "three pieces, " + command);
            int[] i1 = inits(own), p1 = powers(own);
            assertEquals(1, i1[0] - i0[0], "the cube's engine given its key once in the command, " + command);
            assertEquals(1, i1[2] - i0[2], "and Euler's, " + command);
            assertEquals(3, p1[0] - p0[0], "three cubes on it");
            assertEquals(3, p1[2] - p0[2], "three of Euler's tests");
            assertEquals(rsaPowers, e.field.powers, "no padded key's power on `rsa`");
        }
        assertEquals(72, readUint32(c.balance(0), 0), "the nine pieces of 8 went on");
    }

    @Test
    @DisplayName("D247 (the red team's A3-c): the padded keys written again (SET_CARD's self-tests at the first SET_CARD of a set-up life: fieldPInit, fieldEngines, squareInit, run here after a command has given the cube's and Euler's engines their keys) give each engine its key again before its next power")
    void anEngineIsGivenItsKeyAgainAfterItsKeyIsWritten() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = unsetCard(e);
        Engine[] own = ownEngines(c);
        c.ready(UnitsTest.SAT, true);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldOwn"));
        assertEquals(SW_OK, loadThree(c));
        int[] before = inits(own);
        // the keys written again, as the self-tests write them after a reset (which leaves fieldP false)
        Object applet = c.applet();
        set(applet, CashuApplet.class, "fieldP", false);
        assertTrue((Boolean) call(applet, "fieldPInit"));
        set(applet, CashuApplet.class, "fieldP", true);
        call(applet, "fieldEngines");
        assertTrue(flag(applet, CashuApplet.class, "fieldOwn"), "the engines answered again");
        assertTrue((Boolean) call(applet, "squareInit"));
        int[] after = inits(own);
        // each at least once (the cube's twice: squareInit writes the square's keys, which puts every flag down, before its own cube)
        for (int i = 0; i < 4; i++) assertTrue(after[i] > before[i], OWN[i] + " given its key again once its key was written again");
        // and written while the engines are leaned on (fieldP still true): each write puts every flag down itself
        assertTrue((Boolean) call(applet, "fieldPInit"));
        assertTrue((Boolean) call(applet, "squareInit"));
        int[] last = inits(own);
        for (int i = 0; i < 4; i++) assertTrue(last[i] > after[i], OWN[i] + " given its key again by the next power after its key was written");
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
    @DisplayName("D247: a signer with the flags gives its squaring engine sqKey once a command: chipMulInit's known answers once, then each signature once for its four squarings (the flags put down between commands, as `process` does); chipMulInit run again (the key written again) gives it again; one that throws is given its key again at the next squaring; a signer with no flags gives the key before every squaring, as 3.2 at c816133 did")
    void theSignaturesSquaringIsGivenItsKeyOnceACommand() throws Exception {
        SignHardeningTest.Rec eng = new SignHardeningTest.Rec();
        SchnorrHW s = signerWith(eng);
        byte[] ready = new byte[5];
        set(s, SchnorrHW.class, "ready", ready);
        assertTrue(s.chipMulInit());
        assertEquals(1, eng.inits, "chipMulInit's known answers: one init");
        s.chipMul = true;
        BigInteger d = new BigInteger("11223344556677889900AABBCCDDEEFF11223344556677889900AABBCCDDEEFF", 16);
        BigInteger[] pt = ecMulTest(d, SECP_GX, SECP_GY);
        byte[] msg = new byte[32], sig = new byte[64];
        int powers = eng.powers;
        for (int k = 0; k < 3; k++) {
            Arrays.fill(ready, (byte) 0);       // a new command
            msg[0] = (byte) k;
            assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
            assertTrue(schnorrVerify(be(pt[0]), msg, sig));
        }
        assertEquals(12, eng.powers - powers, "four squarings a signature");
        assertEquals(4, eng.inits, "one init a signature, where there were four");
        assertTrue(s.chipMulInit(), "the key written again, in the same command");
        assertEquals(5, eng.inits, "given again");
        // one squaring that throws: the next is given the key again, in the same command
        eng.ins.clear();
        eng.call = 0;
        eng.throwAt = 1;
        assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(be(pt[0]), msg, sig), "the bytecode signs it");
        eng.throwAt = -1;
        int i0 = eng.inits;
        assertEquals(64, s.sign(SignHardeningTest.ecPriv(be(d)), SignHardeningTest.ecPub(point65(pt)), msg, (short) 0, sig, (short) 0));
        assertEquals(i0 + 1, eng.inits, "the engine that threw is given its key again at the next squaring");
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
    @DisplayName("D247: on a card, each AUTH gives the signature's squaring its key once, for its four squarings: three AUTHs, three inits")
    void eachAuthGivesTheKeyOnce() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = setUpCard(e);
        assertTrue(flag(signerOf(c), SchnorrHW.class, "chipMul"));
        int i0 = e.sign.inits, p0 = e.sign.powers;
        for (int k = 0; k < 3; k++) assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 256)));
        assertEquals(3, e.sign.inits - i0, "one init a command");
        assertEquals(12, e.sign.powers - p0, "for twelve squarings");
    }

    @Test
    @DisplayName("D247: where an engine of its own fails its known answer at SET_CARD, fieldOwn is false and every power is on `rsa`, given its key each time, as before")
    void aFailedEngineIsNotLeanedOn() throws Exception {
        Engines e = new Engines();
        UnitsTest.Card c = unsetCard(e);
        Engine[] own = ownEngines(c);
        own[1].lie = true;
        c.ready(UnitsTest.SAT, true);
        assertTrue(flag(c.applet(), CashuApplet.class, "fieldP"));
        assertFalse(flag(c.applet(), CashuApplet.class, "fieldOwn"), "the root's engine lied: none is leaned on");
        int p0 = e.field.powers, i0 = e.field.inits, o = own[0].powers;
        assertEquals(SW_OK, c.load(c.piece(UnitsTest.SAT_A, 8)).getSW());
        assertEquals(2, e.field.powers - p0, "the cube and Euler's test on `rsa`");
        assertEquals(2, e.field.inits - i0, "each given its key");
        assertEquals(o, own[0].powers, "nothing on the engines of their own");
    }
}
