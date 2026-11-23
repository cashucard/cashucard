package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What a reader holding the card learns with no PIN and no grant (D197, D198, SECURITY-MODEL #21): the honest limit of the
 * card's privacy against someone holding it. A till needs a payment's t before SIGN to check its pieces' proofs, and r to
 * check them, so SPEND_ALL_BEGIN and GET_DLEQ answer anyone; with the mint's records, those tie the card to its spends of the
 * dates on it, to the swaps that made its pieces, and (SPEND_ALL_AGAIN P1 = 1) to its no-PIN payments. These tests pin what
 * the text says.
 */
class StrangerHoldingTheCardTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final long D1 = 1_900_000_000L, D2 = 1_900_086_401L;

    static byte[] pubKey(UnitsTest.Card c) { return c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }

    /** P + t*G from P (33) and t (32), with the test's own arithmetic: what anyone works out from BEGIN's answer. */
    static byte[] plusT(byte[] p33, byte[] t) {
        BigInteger[] p = decompressed(p33);
        BigInteger[] tg = ecMulTest(new BigInteger(1, t), SECP_GX, SECP_GY);
        return compressed(ecAddTest(p[0], p[1], tg[0], tg[1]));
    }

    @Test
    @DisplayName("a reader with no PIN and no grant learns the keys of every date with a piece on the card from SPEND_ALL_BEGIN (t and R + u*G, before any PIN is asked): with the mint's list it ties that date's spends to the card; the payment begun is given up and nothing changes")
    void beginGivesTheKeysOfEveryDateOnTheCard() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = DateKeys.of(c.applet());
        // the week's top-up: two pieces of the week's date D1 (D197: top-ups share one date for 7 days), and an undated one
        int a = PerPaymentKeyTest.load(c, 8, 31, D1);
        int b = PerPaymentKeyTest.load(c, 8, 32, D1);
        int z = PerPaymentKeyTest.load(c, 8, 33, 0);
        // the holder pays at a till under the PIN: the mint sees the secret's key P + t*G for D1
        byte[][] swap = LinkingTest.payPlace(c, k, a, c.slot(a), output(8, blinded(131)));
        assertNotNull(swap);
        byte[] mintSaw = k.key(D1);
        byte[] balanceBefore = c.balance(0);

        // later, a stranger: a pocket tap, no PIN, no grant
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, PerPaymentKeyTest.groupKeys(c, D1).getSW(), "GROUP_KEYS is gated");
        byte[] p = pubKey(c);
        // the places and their dates are open (GET_PROOF of an unspent place); BEGIN of one of them, never signed
        ResponseAPDU begun = PerPaymentKeyTest.begin(c, b);
        assertEquals(SW_OK, begun.getSW(), "BEGIN with no PIN");
        byte[] t = Arrays.copyOfRange(begun.getData(), 4, 36);
        byte[] linked = plusT(p, t);
        ResponseAPDU begun0 = PerPaymentKeyTest.begin(c, z);
        byte[] t0 = Arrays.copyOfRange(begun0.getData(), 4, 36);
        assertArrayEquals(k.key(0), plusT(p, t0), "and the date 0's key, which every undated spend names");
        assertArrayEquals(mintSaw, linked, "the stranger has the D1 key the mint saw");
        // nothing changed: the payment begun is given up by the next command
        c.tap();
        assertArrayEquals(balanceBefore, c.balance(0), "the balance as it was");
        assertEquals(64, c.pay(b).getData().length, "and the holder still pays the place");
    }

    @Test
    @DisplayName("SPEND_ALL_AGAIN P1 = 1 with no PIN answers the card's no-PIN payments among the last sixteen, and 6A88 for any other hash: with the mint's list, a reader holding the card picks those payments out")
    void againByHashPicksOutTheNoPinPayments() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.tap();
        c.grant();
        assertEquals(SW_OK, c.limits(0, 0, 1000, 7, 0));
        DateKeys k = DateKeys.of(c.applet());
        List<byte[]> mint = new ArrayList<>();
        List<String> ours = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            c.tap();
            int place = PerPaymentKeyTest.load(c, 8, 40 + i, D2);
            byte[] slot = c.slot(place);
            c.power();
            byte[][] paid = LinkingTest.payPlace(c, k, place, slot, output(8, blinded(140 + i)));
            mint.add(paid[0]);
            ours.add(toHex(paid[0]));
        }
        Random r = new Random(5);
        for (int i = 0; i < 13; i++) { byte[] h = new byte[32]; r.nextBytes(h); mint.add(h); }
        java.util.Collections.shuffle(mint, new Random(9));
        c.power();
        int found = 0, right = 0;
        for (byte[] h : mint) {
            if (LinkingTest.againByHash(c, h).getSW() == SW_OK) {
                found++;
                if (ours.contains(toHex(h))) right++;
            }
        }
        assertEquals(3, right);
        assertEquals(3, found);
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 sealed to the PIN key takes only a point of the curve (6A80, the sixteen bytes used up); a wrong length (6700) and the gate (6982) leave them live")
    void theSealTakesOnlyAPointOfTheCurve() throws Exception {
        UnitsTest.Card n = new UnitsTest.Card();
        byte[] pinKey = LinkingTest.ownPinKey(n);
        assertEquals(SW_OK, n.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        // before the PIN is given in the first set-up: 6982
        n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_SECURITY_NOT_SATIS, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, agreed(EPH[0], pinKey)[0], 256)), "SET_PIN alone");
        n.pin();
        byte[] good = agreed(EPH[0], pinKey)[0];
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(good, 1, 33)), y = new BigInteger(1, Arrays.copyOfRange(good, 33, 65));
        // an x with x^3 + 7 not a square (a point of the twist), any y
        BigInteger tx = BigInteger.ONE;
        while (tx.pow(3).add(BigInteger.valueOf(7)).mod(SECP_P).modPow(SECP_P.subtract(BigInteger.ONE).shiftRight(1), SECP_P).equals(BigInteger.ONE)) tx = tx.add(BigInteger.ONE);
        List<byte[]> bad = new ArrayList<>();
        List<String> why = new ArrayList<>();
        bad.add(concat(new byte[] { 4 }, unsigned32(tx), unsigned32(BigInteger.ONE))); why.add("twist x " + tx);
        bad.add(concat(new byte[] { 4 }, unsigned32(x), unsigned32(y.add(BigInteger.ONE).mod(SECP_P)))); why.add("good x, wrong y");
        bad.add(concat(new byte[] { 4 }, unsigned32(x.add(SECP_P).mod(BigInteger.ONE.shiftLeft(256))), unsigned32(y))); why.add("x + p (wraps)");
        bad.add(concat(new byte[] { 4 }, unsigned32(SECP_P), unsigned32(y))); why.add("x = p");
        bad.add(concat(new byte[] { 4 }, unsigned32(x), unsigned32(y.add(SECP_P).mod(BigInteger.ONE.shiftLeft(256))))); why.add("y + p");
        bad.add(new byte[65]); why.add("zeros");
        byte[] infinity = new byte[65]; infinity[0] = 4; bad.add(infinity); why.add("04 then zeros");
        byte[] hybrid = good.clone(); hybrid[0] = (byte) (y.testBit(0) ? 7 : 6); bad.add(hybrid); why.add("hybrid 06/07");
        byte[] comp = new byte[65]; System.arraycopy(compressed(new BigInteger[] { x, y }), 0, comp, 0, 33); bad.add(comp); why.add("compressed, padded");
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < bad.size(); i++) {
            assertEquals(SW_OK, n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getSW());
            int sw = n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, bad.get(i), 256));
            int after = n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, good, 256));
            out.append(why.get(i)).append(String.format(" %04X then a good E %04X; ", sw, after));
            assertEquals(SW_WRONG_DATA, sw, why.get(i));
            assertEquals(SW_CONDITIONS_NOT_SATIS, after, "the sixteen bytes used up by " + why.get(i));
        }
        // the wrong length leaves the sixteen bytes live (6700 before 6985): harmless, nothing is answered
        n.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_WRONG_LENGTH, n.sw(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, Arrays.copyOf(good, 64), 256)));
        byte[] e2 = agreed(EPH[5], pinKey)[0];
        ResponseAPDU still = n.send(new CommandAPDU(CLA, INS_GET_CARD, 3, 0, e2, 256));
        // and a good one opens to c
        byte[] c = Arrays.copyOf(PerPaymentKeyTest.field(n, "chain"), 32);
        assertArrayEquals(c, (byte[]) LinkingTest.readC(n, pinKey, 2)[0]);
    }

    @Test
    @DisplayName("GET_DLEQ gives any reader r of a piece on the card, and C + r*K is the blind signature the mint issued: a reader holding the card, with the mint's records, ties the swap that made the piece to the card")
    void dleqTiesThePieceToTheSwapThatMadeIt() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        KeysetKeysTest.Keyset A = KeysetKeysTest.A;
        int p1 = c.put(-1, A.id8(), 1024);
        KeysetKeysTest.taught(c, A);
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, p1, 512, A.keyFor(512), null);
        // the mint's answer in the payment's swap, for the card's change output B_ (row 17..50): C_ is in the mint's records
        byte[] answer = mintAnswer(A.privFor(512), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
        byte[] issued = Arrays.copyOf(answer, 65);
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 512));
        ResponseAPDU l = c.send(loadChangeCommand(row[0], answer));
        assertEquals(SW_OK, l.getSW());
        int place = l.getData()[0] & 0xFF;
        // later, a stranger: no PIN, no grant, and GET_CHANGE no longer lists the opening
        c.power();
        byte[] slot = c.slot(place);
        byte[] cc = Arrays.copyOfRange(slot, 45, 78);
        byte[] d = c.send(new CommandAPDU(CLA, INS_GET_DLEQ, place, 0xFF, 256)).getData();
        assertEquals(1, d[0]);
        BigInteger r = new BigInteger(1, Arrays.copyOfRange(d, 65, 97));
        BigInteger[] k = decompressed(A.keyFor(512));
        BigInteger[] rk = ecMulTest(r, k[0], k[1]);
        BigInteger[] C = decompressed(cc);
        byte[] cBlind = point65(ecAddTest(C[0], C[1], rk[0], rk[1]));
        assertArrayEquals(issued, cBlind);
    }
    @Test
    @DisplayName("SPEND_ALL_AGAIN P1 = 0 on a card that has a PIN, never given in this tap, is 6982 before anything else, whether or not the card has ever signed")
    void againWithNoPinOnACardThatNeverSigned() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)));
        c.pin();
        assertEquals(SW_SLOT_EMPTY, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)), "with the PIN: 6A88, never signed");
    }
}
