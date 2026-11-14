package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * A payment's kept signature from the moment it commits (D196): the commit keeps what left the card and the message's hash
 * beside the last signature, and the receipt and the signature kept beside it are written from them with the note's clearing,
 * here or by the next command. So SPEND_ALL_AGAIN P1 = 1 finds a payment's signature after a pull at any write, and after
 * another payment.
 */
class KeptSignatureTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final CommandAPDU AGAIN0 = new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64);

    static ResponseAPDU againByHash(TearSweepTest.Card c, byte[] h) {
        return c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, h, 64));
    }

    static byte[] till(long amount, int seed) {
        byte[] b = new byte[33];
        b[0] = 0x02;
        for (int i = 1; i < 33; i++) b[i] = (byte) (seed + i);
        return output(amount, b);
    }

    static byte[] hashOf(TearSweepTest.Card c, int place, byte[]... outs) {
        byte[] slot = c.send(new CommandAPDU(CLA, INS_GET_PROOF, place, 0, 256)).getData();
        return DateKeys.of(c.applet).hash(new byte[][] { slot }, outs);
    }

    static ResponseAPDU payPlace(TearSweepTest.Card c, int place, byte[] out) {
        ResponseAPDU b = c.send(CashuAppletTest.spendBegin(new byte[] { (byte) place }));
        if (b.getSW() != SW_OK) return b;
        ResponseAPDU o = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out));
        if (o.getSW() != SW_OK) return o;
        return signThrough(c::send);
    }

    @Test
    void aPullAtAnyWriteKeepsTheSignatureByItsHash() throws Exception {
        byte[] out = till(1000, 7);
        TearSweepTest.Card c0 = new TearSweepTest.Card();
        TearSweepTest.readyWithTwo(c0, 0);
        TearHook.count = 0;
        TearHook.target = 0;
        assertEquals(64, payPlace(c0, 0, out).getData().length);
        int total = TearHook.count;

        List<String> lost = new ArrayList<>();
        int signed = 0;
        for (int k = 1; k <= total; k++) {
            TearSweepTest.Card t = new TearSweepTest.Card();
            TearSweepTest.readyWithTwo(t, 0);
            byte[] h = hashOf(t, 0, out);
            TearHook.count = 0;
            TearHook.target = k;
            try {
                payPlace(t, 0, out);
            } catch (Throwable x) {
                // torn
            }
            String at = TearHook.tornAt;
            TearHook.target = 0;
            t.powerCycle();
            assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
            ResponseAPDU p0 = t.send(AGAIN0);
            if (p0.getSW() != SW_OK) continue;
            signed++;
            long receipts = readUint32(t.f("cardReceipts"), 0);
            if (receipts != 1) lost.add(String.format("k=%d torn at %s: %d receipts for one payment", k, at, receipts));
            ResponseAPDU p1 = againByHash(t, h);
            if (p1.getSW() != SW_OK || !java.util.Arrays.equals(p1.getData(), p0.getData())) {
                lost.add(String.format("k=%d torn at %s: P1=1 %04X", k, at, p1.getSW()));
                continue;
            }
            // the holder pays at another till before the first asks again: the first's signature is still found by its hash
            assertEquals(64, payPlace(t, 1, till(500, 9)).getData().length, "payment 2, k=" + k);
            t.powerCycle();
            assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
            ResponseAPDU later = againByHash(t, h);
            if (later.getSW() != SW_OK || !java.util.Arrays.equals(later.getData(), p0.getData())) {
                lost.add(String.format("k=%d torn at %s: after payment 2, P1=1 %04X", k, at, later.getSW()));
            }
        }
        assertTrue(signed > 0, "some tears leave the payment signed");
        assertEquals(new ArrayList<String>(), lost, "every payment signed has one receipt, and its signature by its hash, after a pull and after another payment");
    }

    @Test
    void theReceiptOfAPulledPaymentIsWrittenByTheNextCommand() throws Exception {
        TearSweepTest.Card c = new TearSweepTest.Card();
        TearSweepTest.readyWithTwo(c, 0);
        byte[] out = till(1000, 7);
        byte[] h = hashOf(c, 0, out);
        // the pull: right after the payment's commit
        TearHook.count = 0;
        TearHook.trace = new ArrayList<>();
        assertEquals(64, payPlace(c, 0, out).getData().length);
        int commitAt = -1;
        for (String e : TearHook.trace) {
            if (commitAt < 0 && e.contains(" commit @processSpendAllSign")) commitAt = Integer.parseInt(e.substring(0, e.indexOf(' ')));
        }
        TearHook.trace = null;
        assertTrue(commitAt > 0, "the payment's commit is among the writes");
        TearSweepTest.Card t = new TearSweepTest.Card();
        TearSweepTest.readyWithTwo(t, 0);
        TearHook.count = 0;
        TearHook.target = commitAt;
        try { payPlace(t, 0, out); } catch (Throwable x) { }
        TearHook.target = 0;
        assertEquals(1, t.f("burnPending")[0], "torn after the commit: the note set");
        assertEquals(0, readUint32(t.f("cardReceipts"), 0), "and no receipt yet");
        t.powerCycle();
        assertEquals(0, t.f("burnPending")[0], "the SELECT finished it");
        assertEquals(1, readUint32(t.f("cardReceipts"), 0), "with its receipt");
        byte[] r = t.f("cardReceipts");
        assertArrayEquals(h, java.util.Arrays.copyOfRange(r, 4 + 12, 4 + 44), "whose hash is the payment's message's");
        assertEquals(1000, readUint32(r, 4 + 8), "and what left the card");
    }
}
