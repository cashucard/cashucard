package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D249: the y of the payment's date key kept from SPEND_ALL_BEGIN for SIGN's check (A4 of the 3.2 speed review), with the red
 * team's conditions A4-a to A4-d. jCardSim only: the counts are its, the time (about 35 ms a payment by JCAlgTest's figures)
 * is not shown.
 */
class KeptYTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final long D1 = PerPaymentKeyTest.D1;

    /** A card set up with the PIN in this tap: with the tests' refund key, or with none. */
    static UnitsTest.Card card(boolean refund) {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, refund ? REFUND : NO_REFUND))));
        assertEquals(SW_OK, c.sw(setTimeCommand(T0)));
        c.tap();
        return c;
    }
    /** P + t*G for `date`, whole. */
    static BigInteger[] dateKey(UnitsTest.Card c, long date) {
        DateKeys k = DateKeys.of(c.applet());
        return DateKeys.add(DateKeys.point(k.card), DateKeys.mul(k.t(date), DateKeys.G));
    }

    @Test
    @DisplayName("D249 (the red team's A4-a): SPEND_ALL_BEGIN keeps the y of P + t*G, taken before the refund step writes R + u*G over it: a dated payment on a card with a refund key, and an undated one (the date 0) on a card with one and on one with none; each SIGN verifies under P + t*G, and its check makes one point addition (the check's own), not two")
    void theKeptYIsTheDateKeysAndEveryPaymentSigns() throws Exception {
        Object[][] cases = { { true, D1 }, { true, 0L }, { false, 0L } };
        for (Object[] k : cases) {
            boolean refund = (Boolean) k[0];
            long date = (Long) k[1];
            String what = (refund ? "with" : "with no") + " refund key, date " + date;
            UnitsTest.Card c = card(refund);
            int place = PerPaymentKeyTest.load(c, 8, 21, date);
            byte[] slot = c.slot(place);
            assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW(), what);
            BigInteger[] q = dateKey(c, date);
            assertArrayEquals(unsigned32(q[1]), c.field("groupY"), "the kept y is P + t*G's, " + what);
            Object signer = ChipEnginesTest.signerOf(c);
            PerPaymentKeyTest.CountingAgreement gm = (PerPaymentKeyTest.CountingAgreement) PerPaymentKeyTest.wrap(signer, SchnorrHW.class, "gm", o -> new PerPaymentKeyTest.CountingAgreement((javacard.security.KeyAgreement) o));
            int g0 = gm.made;
            byte[] sig = c.sign().getData();
            assertEquals(64, sig.length, what);
            assertEquals(c.waits + 1, gm.made - g0, "one point addition a signature, the check's: Q is BEGIN's, " + what);
            String msg = DateKeys.of(c.applet()).message(new byte[][] { slot }, new byte[0][]);
            assertTrue(schnorrVerify(unsigned32(q[0]), sha256(msg.getBytes(StandardCharsets.UTF_8)), sig), "signed under P + t*G, " + what);
        }
    }

    @Test
    @DisplayName("D249 (the red team's A4-a, A4-b): GROUP_KEYS writes nothing of the kept y, and a selection clears it with the payment in hand")
    void onlyBeginWritesItAndASelectionClearsIt() throws Exception {
        UnitsTest.Card c = card(true);
        int place = PerPaymentKeyTest.load(c, 8, 22, D1);
        assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW());
        byte[] kept = c.field("groupY").clone();
        assertFalse(Arrays.equals(new byte[32], kept));
        assertEquals(SW_OK, PerPaymentKeyTest.groupKeys(c, D1 + 5).getSW());
        assertArrayEquals(kept, c.field("groupY"), "GROUP_KEYS of another date leaves it as BEGIN wrote it");
        c.power();
        assertArrayEquals(new byte[32], c.field("groupY"), "a selection clears it");
    }

    @Test
    @DisplayName("D249 (the red team's C-A3b-1, its M20): the applet's select() itself clears the kept y, with the payment in hand (jCardSim clears that RAM at every selection, so that no test through a SELECT reaches this clear; a chip may keep it across a SELECT of the tag and back, JCRE 3.0.5, 5.1.1)")
    void selectItselfClearsTheKeptY() throws Exception {
        UnitsTest.Card c = card(true);
        int place = PerPaymentKeyTest.load(c, 8, 24, D1);
        assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW());
        assertFalse(Arrays.equals(new byte[32], c.field("groupY")), "BEGIN kept the y");
        assertTrue(((javacard.framework.Applet) c.applet()).select());
        assertArrayEquals(new byte[32], c.field("groupY"), "cleared by select() itself");
    }

    static final CommandAPDU AGAIN = new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 256);

    /** BEGIN, then the kept y changed by `how`, then SIGN: answered 6F00, nothing burned, SPEND_ALL_AGAIN as never asked. */
    static void corrupted(UnitsTest.Card c, int place, String how, String what) throws Exception {
        ResponseAPDU again0 = c.send(AGAIN);
        byte[] before = c.slot(place), balance = c.balance(0);
        assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW());
        byte[] y = c.field("groupY");
        if (how.equals("bit")) {
            y[12] ^= 0x10;
        } else {
            byte[] neg = unsigned32(SECP_P.subtract(new BigInteger(1, y)));
            System.arraycopy(neg, 0, y, 0, 32);
        }
        ResponseAPDU r = c.sign();
        assertEquals(CashuApplet.SW_CRYPTO_ERROR & 0xFFFF, r.getSW(), how + ": SIGN refused, " + what);
        assertArrayEquals(before, c.slot(place), how + ": the piece as it was (unspent), " + what);
        assertArrayEquals(balance, c.balance(0), how + ": the balance as it was");
        assertEquals(0, c.field("burnPending")[0], how + ": nothing to burn");
        ResponseAPDU again = c.send(AGAIN);
        assertEquals(again0.getSW(), again.getSW(), how + ": SPEND_ALL_AGAIN as never asked, " + what);
        assertArrayEquals(again0.getData(), again.getData(), how + ": and its bytes");
    }

    @Test
    @DisplayName("D249 (the red team's A4-c, A4-d): a kept y changed between BEGIN and SIGN, by one bit or to p - y, makes the SIGN 6F00 on the bytecode's path and on the chip's: nothing burned, the piece unspent, SPEND_ALL_AGAIN answering as if the SIGN was never asked; the same card then pays the piece")
    void aCorruptKeptYOnlyFailsTheCheck() throws Exception {
        for (boolean chip : new boolean[] { false, true }) {
            ChipEnginesTest.Engines e = new ChipEnginesTest.Engines();
            UnitsTest.Card c = chip ? ChipEnginesTest.setUpCard(e) : card(true);
            if (chip) {
                assertTrue(ChipEnginesTest.flag(ChipEnginesTest.signerOf(c), SchnorrHW.class, "chipMul"));
                c.tap();
            }
            String what = chip ? "the chip's path" : "the bytecode's path";
            int place = PerPaymentKeyTest.load(c, 8, 23, D1);
            corrupted(c, place, "bit", what);
            corrupted(c, place, "negated", what);
            assertEquals(SW_OK, PerPaymentKeyTest.begin(c, place).getSW());
            assertEquals(64, c.sign().getData().length, "and with the y as BEGIN kept it, the piece pays, " + what);
        }
    }
}
