package me.flashapp.cashu;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.Applet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.smartcardio.CommandAPDU;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The blinding of a change output (1.12), called straight on the applet two
 * hundred times: every path of it is random (whether the first x is on the
 * curve, whether the root is odd, how long the chip's RSA answer is), so a
 * fault in one of them shows up only in so many runs. Each point made is
 * checked against the opening the card kept, by this test's own hash to the
 * curve and point arithmetic, and the exception is read whole where there is
 * one, which a card's 6F00 would not give.
 */
class ChangeBlindingTest {
    @Test
    @DisplayName("blindChange, two hundred times: a compressed point every time, and the one the opening's nonce and blinding factor give")
    void twoHundredChangeOutputs() throws Exception {
        CashuAppletTest.ExposedRuntime fresh = new CashuAppletTest.ExposedRuntime();
        CardSimulator sim = new CardSimulator(fresh);
        sim.installApplet(AIDUtil.create(CashuAppletTest.AID_HEX), CashuApplet.class);
        sim.selectApplet(AIDUtil.create(CashuAppletTest.AID_HEX));
        CashuAppletTest.readyOn(sim, 0);
        assertEquals(0x9000, sim.transmitCommand(new CommandAPDU(0xB0, 0x30, 0, 0, CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 100, 1), 1)).getSW());
        byte[] cardKey = sim.transmitCommand(new CommandAPDU(0xB0, 0x10, 0, 0, 256)).getData();
        Applet applet = fresh.appletAt(AIDUtil.create(CashuAppletTest.AID_HEX));
        Method blind = CashuApplet.class.getDeclaredMethod("blindChange", short.class, short.class, byte[].class);
        blind.setAccessible(true);
        java.lang.reflect.Field openings = CashuApplet.class.getDeclaredField("changeOpen");
        openings.setAccessible(true);
        byte[] changeOpen = (byte[]) openings.get(applet);
        long date = CashuAppletTest.readUint32(CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 100, 1), 77);
        for (int i = 0; i < 200; i++) {
            int open = (i % 8) * 80;
            byte[] buf = new byte[261];
            try {
                blind.invoke(applet, (short) 0, (short) open, buf);
            } catch (InvocationTargetException e) {
                Throwable t = e.getCause();
                StringBuilder sb = new StringBuilder("round " + i + ": " + t);
                for (StackTraceElement el : t.getStackTrace()) if (el.getClassName().startsWith("me.flashapp")) sb.append("\n    at ").append(el);
                fail(sb.toString());
            }
            assertTrue(buf[0] == 0x02 || buf[0] == 0x03, "round " + i + ": a compressed point");
            byte[] made = Arrays.copyOfRange(buf, 0, 33);
            byte[] nonce = Arrays.copyOfRange(changeOpen, open + 16, open + 48), r = Arrays.copyOfRange(changeOpen, open + 48, open + 80);
            byte[] secret = CashuAppletTest.secretText(nonce, cardKey, date, CashuAppletTest.REFUND).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            assertArrayEquals(made, CashuAppletTest.blindedFor(secret, r), "round " + i + ": the opening opens the point");
        }
    }
}
