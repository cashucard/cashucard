package me.flashapp.hello;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import java.io.FileNotFoundException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import javacard.framework.Applet;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The provisioner's hello applet (ENG-738), in jCardSim. Its source is not part of the card's package: it lives in
 * tools/cardkit/hello, so the applet's build does not carry it, and is compiled here, at run time, against the same
 * JavaCard API the applet's tests use. The phone's smoke test installs it, sends INS 01 and expects HELLO.
 */
class HelloTest {

    static final String HELLO_HEX = "F04341534848454C4C4F01";
    /** What the install command carries: the instance AID's length and the AID, no privileges, no parameters. */
    static final byte[] INSTALL = hex("0B" + HELLO_HEX + "0000");

    private static Class<? extends Applet> hello;

    @BeforeAll
    static void compile() throws Exception {
        Path source = helloSource();
        Path out = Files.createTempDirectory("hello-classes");
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        assertNotNull(javac, "a JDK, not a JRE: javac compiles the hello applet");
        String api = Paths.get(Applet.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
        int rc = javac.run(null, null, null, "-d", out.toString(), "-cp", api, source.toString());
        assertEquals(0, rc, "Hello.java compiles against the JavaCard API");
        URLClassLoader loader = new URLClassLoader(new URL[] {out.toUri().toURL()}, HelloTest.class.getClassLoader());
        hello = loader.loadClass("me.flashapp.hello.Hello").asSubclass(Applet.class);
    }

    static Path helloSource() throws FileNotFoundException {
        String[] candidates = {
            "../tools/cardkit/hello/me/flashapp/hello/Hello.java",
            "tools/cardkit/hello/me/flashapp/hello/Hello.java",
        };
        for (String c : candidates) {
            Path p = Paths.get(c);
            if (Files.isRegularFile(p)) {
                return p;
            }
        }
        throw new FileNotFoundException("Hello.java not found relative to " + Paths.get("").toAbsolutePath());
    }

    static byte[] hex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }

    private CardSimulator installed() {
        CardSimulator sim = new CardSimulator();
        sim.installApplet(AIDUtil.create(HELLO_HEX), hello, INSTALL, (short) 0, (byte) INSTALL.length);
        ResponseAPDU r = sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hex(HELLO_HEX), 256));
        assertEquals(0x9000, r.getSW(), "SELECT of the hello applet's AID");
        return sim;
    }

    @Test
    @DisplayName("INS 01 answers the five bytes HELLO, as the provisioner's smoke test expects (80 01 00 00 05)")
    void insOneSaysHello() {
        ResponseAPDU r = installed().transmitCommand(new CommandAPDU(0x80, 0x01, 0x00, 0x00, 5));
        assertEquals(0x9000, r.getSW());
        assertArrayEquals("HELLO".getBytes(StandardCharsets.US_ASCII), r.getData());
    }

    @Test
    @DisplayName("Every other INS is 6D00, and the SELECT itself carries no data")
    void everythingElseIsRefused() {
        CardSimulator sim = installed();
        for (int ins : new int[] {0x00, 0x02, 0x10, 0xA4 + 1, 0xFF}) {
            assertEquals(0x6D00, sim.transmitCommand(new CommandAPDU(0x80, ins, 0x00, 0x00)).getSW(), "INS " + ins);
        }
        ResponseAPDU r = sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hex(HELLO_HEX), 256));
        assertEquals(0x9000, r.getSW());
        assertEquals(0, r.getData().length);
    }
}
