package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.payWithChange;
import static me.flashapp.cashu.KeysetKeysTest.show;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.List;
import java.util.TreeSet;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.KeyAgreement;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import javax.smartcardio.CommandAPDU;

/**
 * D245: the key's wipes where every scalar is public (A1 of the 3.2 speed review). A wipe (`rest()`) gives both key agreements
 * the temporary key at G's x: each is counted here as the point addition's init with G's x, which nothing else gives it. The
 * simulator shows the counts, not the time (about 19 ms a wipe on a J3R180: setS and two inits): simulator only for speed.
 */
class WipesTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger N = SchnorrHWSignTest.N_;
    static final BigInteger GX = SECP_GX;

    static BigInteger s(byte[] b) { return new BigInteger(1, b); }
    static long gx(List<byte[]> scalars) { return scalars.stream().filter(k -> s(k).equals(GX)).count(); }

    /** A signer of its own whose two agreements record every key they are given. */
    static SchnorrHWSignTest.WatchedAgreement[] watched(SchnorrHW s) throws Exception {
        SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        SchnorrHWSignTest.WatchedAgreement gm = new SchnorrHWSignTest.WatchedAgreement(KeyAgreement.ALG_EC_PACE_GM);
        SchnorrHWSignTest.setHidden(s, "ecdh", ecdh);
        SchnorrHWSignTest.setHidden(s, "gm", gm);
        return new SchnorrHWSignTest.WatchedAgreement[] { ecdh, gm };
    }

    @Test
    @DisplayName("D245: a signature wipes the key once, in sign()'s finally: the key agreement is given k (R = kG), then e (the check's [e]Q), then G's x; the point addition s (the check's [s]G - T), then G's x; for keys of both parities, and the key and both agreements hold G's x after; 3.2 at c816133 wiped four times (the check's start, after [e]Q, after [s]G - T, the finally)")
    void aSignatureWipesOnce() throws Exception {
        for (Object[] k : SchnorrHWSignTest.KEYS) {
            SchnorrHW signer = new SchnorrHW();
            signer.init();
            SchnorrHWSignTest.WatchedAgreement[] w = watched(signer);
            ECPrivateKey priv = SchnorrHWSignTest.keyOf((String) k[0]);
            ECPublicKey pub = SchnorrHWSignTest.pubOf((String) k[1]);
            byte[] msg = new byte[32], sig = new byte[64];
            msg[5] = 9;
            assertEquals(64, signer.sign(priv, pub, msg, (short) 0, sig, (short) 0));
            byte[] w65 = hexToBytes((String) k[1]);
            assertTrue(schnorrVerify(Arrays.copyOfRange(w65, 1, 33), msg, sig), "the signature verifies");
            assertEquals(3, w[0].scalars.size(), "the key agreement: k, e and the wipe's G's x");
            assertEquals(2, w[1].scalars.size(), "the point addition: s and the wipe's G's x");
            assertEquals(1, gx(w[1].scalars), "one wipe a signature");
            assertEquals(1, gx(w[0].scalars), "and the key agreement's at that one");
            assertEquals(GX, s(w[0].scalars.get(2)), "the last thing the key agreement holds is G's x");
            assertEquals(GX, s(w[1].scalars.get(1)), "and the point addition");
            assertEquals(s(Arrays.copyOfRange(sig, 32, 64)), s(w[1].scalars.get(0)), "the point addition was given s, which is public once out");
            assertEquals(GX, SchnorrHWSignTest.heldBy(signer), "and the temporary key holds G's x");
        }
    }

    @Test
    @DisplayName("D245: a signature under a date's key (D197) wipes once too: the point addition is given t (Q = W + [t]G), s, then G's x; the signature verifies under P + t*G")
    void aDatedSignatureWipesOnce() throws Exception {
        SchnorrHW signer = new SchnorrHW();
        signer.init();
        SchnorrHWSignTest.WatchedAgreement[] w = watched(signer);
        BigInteger d = new BigInteger("3C1E8A0F6D2B4A99102F7E5A11C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5", 16);
        BigInteger t = new BigInteger("0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF", 16);
        BigInteger[] p = ecMulTest(d, SECP_GX, SECP_GY), q = ecMulTest(d.add(t).mod(N), SECP_GX, SECP_GY);
        byte[] g = concat(unsigned32(t), compressed(q));
        byte[] msg = new byte[32], sig = new byte[64];
        msg[0] = 1;
        assertEquals(64, signer.sign(SchnorrHWSignTest.keyOf(toHex(unsigned32(d))), SchnorrHWSignTest.pubOf(toHex(point65(p))), g, (short) 0, msg, (short) 0, sig, (short) 0));
        assertTrue(schnorrVerify(unsigned32(q[0]), msg, sig), "under P + t*G");
        assertEquals(3, w[1].scalars.size(), "the point addition: t, s and the wipe");
        assertEquals(t, s(w[1].scalars.get(0)), "t first");
        assertEquals(1, gx(w[1].scalars), "one wipe");
        assertEquals(3, w[0].scalars.size(), "the key agreement: k, e and the wipe");
    }

    @Test
    @DisplayName("D245: the framing's seventeen asks (every scalar public) wipe once, after the last: nine to the key agreement and eight to the point addition, then G's x to each; 3.2 at c816133 wiped after every ask (seventeen)")
    void theFramingWipesOnce() throws Exception {
        SchnorrHW signer = new SchnorrHW();
        signer.init();
        SchnorrHWSignTest.WatchedAgreement[] w = watched(signer);
        signer.checkFraming(new byte[65], (short) 0);
        assertEquals(1, gx(w[1].scalars), "one wipe, after the asks");
        assertEquals(9, w[0].scalars.size() - 1, "nine asks of the key agreement");
        assertEquals(8, w[1].scalars.size() - 1, "eight of the point addition");
        assertEquals(GX, s(w[1].scalars.get(w[1].scalars.size() - 1)), "the wipe is last");
        assertEquals(GX, SchnorrHWSignTest.heldBy(signer), "and the key holds G's x after");
    }

    @Test
    @DisplayName("D245: LOAD_CHANGE wipes after its one secret scalar alone: the point addition is given n - r (C = C_ - r*K), at once G's x, then the proof's s twice (s*G - e*K, s*B_ - e*C_), and nothing after holds n - r; 3.2 at c816133 wiped after each of the five steps")
    void loadChangeWipesAfterTheUnblindingAlone() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        taught(c, A);
        int place = c.put(-1, A.id8(), 64);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 8));
        SchnorrHW signer = ChipEnginesTest.signerOf(c);
        SchnorrHWSignTest.WatchedAgreement[] w = watched(signer);
        byte[] opens = c.field("changeOpen");
        int at = (row[0] & 0xFF) * CashuApplet.OPEN_LEN + CashuApplet.OPEN_R;
        BigInteger nr = N.subtract(s(Arrays.copyOfRange(opens, at, at + 32))).mod(N);
        byte[] answer = mintAnswer(A.privFor(8), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
        assertEquals(SW_OK, c.sw(loadChangeCommand(row[0], answer)), "the change goes on");
        List<byte[]> given = w[1].scalars;
        assertEquals(4, given.size(), "the point addition: n - r, the wipe, s and s");
        assertEquals(nr, s(given.get(0)), "the unblinding first, n - r");
        assertEquals(GX, s(given.get(1)), "and at once the wipe");
        BigInteger sp = s(Arrays.copyOfRange(answer, 130 + 32, 130 + 64));
        assertEquals(sp, s(given.get(2)), "then the proof's s, public");
        assertEquals(sp, s(given.get(3)), "twice");
        assertEquals(1, gx(given), "one wipe in all");
        assertFalse(nr.equals(SchnorrHWSignTest.heldBy(signer)), "the key does not hold n - r");
        assertFalse(nr.equals(w[1].lastS), "nor does the point addition");
    }

    static String source(String file) throws Exception {
        return SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve(file)), java.nio.charset.StandardCharsets.UTF_8));
    }
    static TreeSet<String> set(String... s) { return new TreeSet<>(Arrays.asList(s)); }

    @Test
    @DisplayName("D245 (the red team's A1-a, A1-b): mulPublic and addToPublic are called only from verify, unblind's four proof steps and checkFraming (and mul and addTo, which wipe after them); in unblind the unblinding's addTo (n - r) comes before them; sign() keeps the wipe between the chip's try and the bytecode's")
    void thePublicCallsHaveTheseCallersOnly() throws Exception {
        String hw = source("SchnorrHW.java"), applet = source("CashuApplet.java");
        assertEquals(set("(class body)", "mul", "verify", "checkFraming"), ProofStoreTest.methodsNaming(hw, "mulPublic"), "mulPublic's callers in the signer");
        assertEquals(set("(class body)", "addTo", "verify", "checkFraming"), ProofStoreTest.methodsNaming(hw, "addToPublic"), "addToPublic's");
        assertEquals(set("unblind"), ProofStoreTest.methodsNaming(applet, "mulPublic"), "and in the applet, unblind alone");
        assertEquals(set("unblind"), ProofStoreTest.methodsNaming(applet, "addToPublic"), "for both");
        int[] u = SchnorrHWMathTest.bodyRange(applet, "private boolean unblind(");
        String unblind = applet.substring(u[0], u[1]);
        assertEquals(2, unblind.split("schnorrHW\\.mulPublic\\(", -1).length - 1, "two of the proof's steps by mulPublic");
        assertEquals(2, unblind.split("schnorrHW\\.addToPublic\\(", -1).length - 1, "two by addToPublic");
        int unblinding = unblind.indexOf("schnorrHW.addTo(");
        assertTrue(unblinding >= 0 && unblinding < unblind.indexOf("schnorrHW.mulPublic(") && unblinding < unblind.indexOf("schnorrHW.addToPublic("), "the unblinding, with its wipe, first");
        int[] s = SchnorrHWMathTest.bodyRange(hw, "short sign(ECPrivateKey privKey, ECPublicKey pubKey, byte[] g, short gOff,");
        String sign = hw.substring(s[0], s[1]).replaceAll("\\s+", " ");
        assertTrue(sign.contains("Util.arrayFillNonAtomic(sc, (short)0, (short)256, (byte)0); Util.arrayFillNonAtomic(work, (short)0, WORK_LEN, (byte)0); rest(); } return signOnce("),
            "the wipe between the chip's try and the bytecode's");
    }

    @Test
    @DisplayName("D245 (the red team's A1-c): after an AUTH, a payment's SIGN, a LOAD_CHANGE refused 6A80 and one taken, and a signature the chip's path got wrong (made again by the bytecode), the key agreement and the point addition hold no nonce and no opening's r: G's x after a signature, the proof's public scalars after LOAD_CHANGE, never r or n - r (simulator only: the copy read is jCardSim's)")
    void theAgreementsKeepNoNonceAndNoR() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        SchnorrHW signer = ChipEnginesTest.signerOf(c);
        KeyAgreement ecdh = (KeyAgreement) SchnorrHWSignTest.hidden(signer, "ecdh"), gm = (KeyAgreement) SchnorrHWSignTest.hidden(signer, "gm");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 256)));
        assertEquals(GX, RamAfterUseTest.kept(ecdh), "after AUTH: G's x in the key agreement");
        assertEquals(GX, RamAfterUseTest.kept(gm), "and in the point addition");
        taught(c, A);
        int place = c.put(-1, A.id8(), 64);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        assertEquals(GX, RamAfterUseTest.kept(ecdh), "after a payment's SIGN: G's x");
        assertEquals(GX, RamAfterUseTest.kept(gm), "in both");
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 8));
        byte[] opens = c.field("changeOpen");
        int at = (row[0] & 0xFF) * CashuApplet.OPEN_LEN + CashuApplet.OPEN_R;
        BigInteger r = s(Arrays.copyOfRange(opens, at, at + 32)), nr = N.subtract(r).mod(N);
        byte[] answer = mintAnswer(A.privFor(8), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
        byte[] bad = answer.clone();
        bad[130 + 31] ^= 1;
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(row[0], bad)), "a proof that does not hold");
        for (KeyAgreement ka : new KeyAgreement[] { ecdh, gm }) {
            BigInteger k = RamAfterUseTest.kept(ka);
            assertFalse(r.equals(k) || nr.equals(k), "refused: no r in " + ka.getAlgorithm());
        }
        assertEquals(SW_OK, c.sw(loadChangeCommand(row[0], answer)), "the right one");
        for (KeyAgreement ka : new KeyAgreement[] { ecdh, gm }) {
            BigInteger k = RamAfterUseTest.kept(ka);
            assertFalse(r.equals(k) || nr.equals(k), "taken: no r in " + ka.getAlgorithm());
        }
        assertEquals(s(Arrays.copyOfRange(answer, 162, 194)), RamAfterUseTest.kept(gm), "the point addition holds the proof's s, which GET_DLEQ gives anyone");
        // a signature the chip's path gets wrong: refused by the check, made again by the bytecode, and nothing kept of either
        ChipEnginesTest.Engines e = new ChipEnginesTest.Engines();
        UnitsTest.Card d = ChipEnginesTest.setUpCard(e);
        SchnorrHW ds = ChipEnginesTest.signerOf(d);
        assertTrue(ChipEnginesTest.flag(ds, SchnorrHW.class, "chipMul"));
        e.sign.lie = true;
        int p0 = e.sign.powers;
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_AUTH, 0, 0, new byte[16], 256)));
        assertTrue(e.sign.powers > p0, "the chip's path was tried");
        assertEquals(GX, RamAfterUseTest.kept((KeyAgreement) SchnorrHWSignTest.hidden(ds, "ecdh")), "after the bytecode's signature: G's x");
        assertEquals(GX, RamAfterUseTest.kept((KeyAgreement) SchnorrHWSignTest.hidden(ds, "gm")), "in both");
    }
}
