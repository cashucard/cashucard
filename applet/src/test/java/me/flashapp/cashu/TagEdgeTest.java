package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.utils.AIDUtil;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javacard.framework.AID;
import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.JCSystem;
import javacard.security.CryptoException;
import javacard.security.MessageDigest;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The edges of the tag's changing address (D216): what a reader can ask the tag for at the ends of the file, what the card's
 * applet's work for the tag touches, who the card's applet hands its interface to, and that the tag key K is never left
 * behind in its caller's array, whatever the caller passes and whatever fails. Simulator only.
 */
class TagEdgeTest {

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    private static ResponseAPDU readAt(TagAddressTest.Card k, int p1, int p2, int le) {
        return k.send(new CommandAPDU(0x00, 0xB0, p1, p2, le));
    }

    // ---- the file's edges --------------------------------------------------------------------------------------------

    @Test
    @DisplayName("READ BINARY at the edges of a set-up card's 71-byte file: every offset and length inside it is the one address of the selection, an offset at or past the end and an offset with its top bit set are refused (6B00), a READ with no file chosen 6986")
    void readBinaryBounds() {
        TagAddressTest.Card k = TagAddressTest.setUp();
        assertEquals(SW_OK, k.selectTag());
        assertEquals(0x6986, readAt(k, 0, 0, 16).getSW(), "no file chosen");
        k.selectFile(0xE104);
        byte[] whole = k.read(0, 256);
        assertEquals(71, whole.length);
        int[] lengths = { 1, 2, 3, 16, 58, 59, 60, 70, 71, 72, 255, 256 };
        for (int at = 0; at < 71; at++) {
            for (int le : lengths) {
                byte[] part = k.read(at, le);
                assertArrayEquals(Arrays.copyOfRange(whole, at, Math.min(71, at + le)), part, "offset " + at + ", Le " + le);
            }
        }
        for (int at : new int[] { 71, 72, 100, 0xFF, 0x100, 0x7FFF }) {
            assertEquals(0x6B00, readAt(k, at >> 8, at & 0xFF, 1).getSW(), "offset " + at);
        }
        for (int p1 : new int[] { 0x80, 0xFF }) assertEquals(0x6B00, readAt(k, p1, 0, 1).getSW(), "P1 " + p1);
        // and the selection's address is still the same one after the refusals
        assertArrayEquals(whole, k.read(0, 256));
        k.selectCard();
    }

    @Test
    @DisplayName("The capability container is the same 15 bytes on a new card and a set-up card; the NDEF file is 26 or 71 bytes and nothing else")
    void theContainerSaysNothingOfTheState() {
        List<byte[]> containers = new ArrayList<>();
        List<Integer> sizes = new ArrayList<>();
        TagAddressTest.Card fresh = new TagAddressTest.Card();
        containers.add(cc(fresh));
        sizes.add(fresh.readFile().length);
        fresh.selectCard();
        TagAddressTest.Card k = TagAddressTest.setUp();
        containers.add(cc(k));
        sizes.add(k.readFile().length);
        k.selectCard();
        for (byte[] c : containers) assertArrayEquals(containers.get(0), c);
        assertEquals("000f20003b00340406e104004700ff", CashuAppletTest.toHex(containers.get(0)).toLowerCase());
        assertEquals(List.of(26, 71), sizes);
    }

    private static byte[] cc(TagAddressTest.Card k) {
        assertEquals(SW_OK, k.selectTag());
        k.selectFile(0xE103);
        byte[] c = k.read(0, 256);
        k.selectCard();
        return c;
    }

    // ---- what the card's applet's work for the tag touches -------------------------------------------------------------

    /** Every byte array the card's applet holds, by field name, as it is now. */
    private static List<Object[]> snapshot(CashuApplet a) throws Exception {
        List<Object[]> out = new ArrayList<>();
        for (Field f : CashuApplet.class.getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(f.getModifiers()) || f.getType() != byte[].class) continue;
            f.setAccessible(true);
            byte[] v = (byte[]) f.get(a);
            out.add(new Object[] { f.getName(), v == null ? null : v.clone(), v });
        }
        return out;
    }

    @Test
    @DisplayName("The card's applet's work for the tag touches none of its own memory but scratch 164 to 187: every other byte of every array it holds is as it was, so a tag read between a payment's BEGIN and SIGN on a chip, where memory is not cleared between applets of one package, leaves the payment as it was")
    void theTagsWorkTouchesOnlyItsBytes() throws Exception {
        TagAddressTest.Card k = TagAddressTest.setUp();
        CashuApplet a = k.applet();
        // stand-ins for a payment in hand: every transient array filled with a pattern a payment could leave
        for (String name : new String[] { "scratch", "allSlots", "allState", "allSum", "allChange", "allNet", "allOut", "ownerNonce", "nonceLive", "loadGrant", "pinVerifiedFlag" }) {
            byte[] v = k.field(name);
            for (int i = 0; i < v.length; i++) v[i] = (byte) (0x40 + i);
        }
        List<Object[]> before = snapshot(a);
        byte[] room = new byte[133];
        assertTrue(tagCode(a, room, 32));
        List<Object[]> after = snapshot(a);
        assertEquals(before.size(), after.size());
        for (int i = 0; i < before.size(); i++) {
            String name = (String) before.get(i)[0];
            byte[] was = (byte[]) before.get(i)[1], now = (byte[]) after.get(i)[1];
            if (was == null) { assertNull(now, name); continue; }
            for (int j = 0; j < was.length; j++) {
                // the scratch, under its own name or another (`seal` is the same array)
                if (before.get(i)[2] == k.field("scratch") && j >= 164 && j < 188) continue;
                assertEquals(was[j], now[j], name + "[" + j + "] changed by the tag's work");
            }
        }
        assertArrayEquals(new byte[133], room, "the room is cleared after");
    }

    // ---- K is never left behind ----------------------------------------------------------------------------------------

    private static boolean tagCode(CashuApplet a, byte[] room, int at) throws Exception {
        Method code = CashuApplet.class.getMethod("tagCode", byte[].class, short.class);
        try {
            return (Boolean) code.invoke(a, room, (short) at);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof Exception) throw (Exception) e.getCause();
            throw e;
        }
    }

    @Test
    @DisplayName("tagCode checks its room before it works anything out: a room that starts before the array, or runs past its end, or no array at all, answers false and writes nothing (no K in the caller's array, the code's 24 bytes as they were); a room that just fits works")
    void aBadRoomIsRefusedBeforeK() throws Exception {
        TagAddressTest.Card k = TagAddressTest.setUp();
        CashuApplet a = k.applet();
        byte[] key = TagAddressTest.tagKey(k.c());
        byte[] scratch = k.field("scratch");
        int[][] rooms = { { 128, -64 }, { 128, -1 }, { 128, 33 }, { 95, 0 }, { 0, 0 }, { 128, Short.MAX_VALUE } };
        for (int[] r : rooms) {
            int size = r[0], at = r[1];
            byte[] room = new byte[size];
            byte[] code = Arrays.copyOfRange(scratch, 164, 188);
            assertFalse(tagCode(a, room, at), "a room of " + size + " at " + at + " is refused");
            assertArrayEquals(new byte[size], room, "nothing written to a room of " + size + " at " + at);
            assertArrayEquals(code, Arrays.copyOfRange(scratch, 164, 188), "and the code is as it was");
            assertFalse(contains(room, key));
        }
        assertFalse(tagCode(a, null, 32), "no array");
        byte[] fits = new byte[128];
        assertTrue(tagCode(a, fits, 32), "a room of 96 at the end of the array works");
        assertArrayEquals(new byte[128], fits);
    }

    @Test
    @DisplayName("tagCode clears its room on every way out: a failure in the middle of the HMAC (here its second hash) leaves no K, no pad and no half-made code behind")
    void aFailureMidwayLeavesNoKey() throws Exception {
        TagAddressTest.Card k = TagAddressTest.setUp();
        CashuApplet a = k.applet();
        Field shaField = CashuApplet.class.getDeclaredField("sha");
        shaField.setAccessible(true);
        MessageDigest real = (MessageDigest) shaField.get(a);
        shaField.set(a, new FailingDigest(real, 2));
        try {
            byte[] room = new byte[133];
            assertThrows(CryptoException.class, () -> tagCode(a, room, 32));
            assertArrayEquals(new byte[133], room, "the room is cleared after the failure");
            assertArrayEquals(new byte[24], Arrays.copyOfRange(k.field("scratch"), 164, 188), "and no half-made code is kept");
        } finally {
            shaField.set(a, real);
        }
        // and with the real digest the tag works again
        assertTrue(TagAddressTest.isMine(k.address(), k.c()));
    }

    private static boolean contains(byte[] hay, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            for (int j = 0; j < needle.length; j++) if (hay[i + j] != needle[j]) continue outer;
            return true;
        }
        return false;
    }

    /** A SHA-256 that fails at its n-th doFinal, and otherwise is the real one. */
    static final class FailingDigest extends MessageDigest {
        private final MessageDigest real;
        private int left;
        FailingDigest(MessageDigest real, int n) { this.real = real; this.left = n; }
        public byte getAlgorithm() { return real.getAlgorithm(); }
        public byte getLength() { return real.getLength(); }
        public void update(byte[] in, short off, short len) { real.update(in, off, len); }
        public void reset() { real.reset(); }
        public short doFinal(byte[] in, short off, short len, byte[] out, short outOff) {
            if (--left == 0) CryptoException.throwIt(CryptoException.ILLEGAL_USE);
            return real.doFinal(in, off, len, out, outOff);
        }
    }

    // ---- who gets the interface --------------------------------------------------------------------------------------

    /** Another applet on the card, under a name of its own: INS 01 answers 01 if the card's applet hands it the interface, 00 if not. */
    public static final class Stranger extends Applet {
        public static void install(byte[] b, short off, byte len) { new Stranger().register(); }
        public void process(APDU apdu) {
            if (selectingApplet()) return;
            byte[] buf = apdu.getBuffer();
            AID card = JCSystem.lookupAID(hexToBytes(TagTest.CARD_HEX), (short) 0, (byte) 11);
            buf[0] = (byte) (card != null && JCSystem.getAppletShareableInterfaceObject(card, buf[ISO7816.OFFSET_P1]) != null ? 1 : 0);
            apdu.setOutgoingAndSend((short) 0, (short) 1);
        }
    }

    static final String STRANGER_HEX = "A000000001020304";

    @Test
    @DisplayName("Another applet on the card asks the card's applet for its interface and gets nothing, while the tag, beside it, still gets it (its switch and its code work)")
    void anotherAppletIsRefused() throws Exception {
        TagAddressTest.Card k = TagAddressTest.setUp();
        k.sim.installApplet(AIDUtil.create(STRANGER_HEX), Stranger.class);
        assertEquals(SW_OK, k.send(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(STRANGER_HEX), 256)).getSW());
        for (int p : new int[] { 0, 1 }) {
            ResponseAPDU r = k.send(new CommandAPDU(0x00, 0x01, p, 0x00, 1));
            assertEquals(SW_OK, r.getSW());
            assertArrayEquals(new byte[] { 0 }, r.getData(), "the stranger gets no interface (parameter " + p + ")");
        }
        k.selectCard();
        assertTrue(TagAddressTest.isMine(k.address(), k.c()), "the tag still gets its code");
        assertEquals(SW_OK, k.switchTag(true));
        assertEquals(0x6999, k.selectTag(), "and the switch: off, the tag refuses its name");
    }

    @Test
    @DisplayName("The card's applet answers the tag's two names (its NFC Forum instance AID and its class AID) for the parameter 0, and nothing else: no other name, not the card's own, not the opener's, not a near miss, no name at all, no other parameter")
    void onlyTheTagsNames() {
        TagAddressTest.Card k = new TagAddressTest.Card();
        CashuApplet a = k.applet();
        assertNotNull(a.getShareableInterfaceObject(AIDUtil.create(TagTest.TAG_HEX), (byte) 0));
        assertNotNull(a.getShareableInterfaceObject(AIDUtil.create(AidVersionTest.PACKAGE + "54"), (byte) 0));
        assertNull(a.getShareableInterfaceObject(AIDUtil.create(TagTest.TAG_HEX), (byte) 1));
        for (String other : new String[] { TagTest.CARD_HEX, TagTest.OPENER_HEX, STRANGER_HEX, "D2760000850100", "D276000085010101", "D2760000850102", AidVersionTest.PACKAGE + "55" }) {
            assertNull(a.getShareableInterfaceObject(AIDUtil.create(other), (byte) 0), other);
        }
        assertNull(a.getShareableInterfaceObject(null, (byte) 0));
    }
}
