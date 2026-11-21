package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.ISOException;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The tag's address comes from whoever installs the card, in the tag's install parameters, and from nowhere else: the
 * package names no address. Every vector of spec/vectors/tag-address.json is run here: a valid address gives the files
 * the vector lists, and on a set-up card the coded address in full; an invalid one is refused at install (6A80) and leaves
 * no tag. The same file holds the host tools' check of an address to the card's (tools/cardkit, tools/maker). Simulator only.
 */
class TagInstallTest {

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    static Path vectors() {
        try {
            return ClockWalkTest.headersJson().resolveSibling("tag-address.json");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The section of the vectors file from `name`'s key to the next section's (or the end). */
    private static String section(String json, String name, String next) {
        int from = json.indexOf("\"" + name + "\"");
        int to = next == null ? json.length() : json.indexOf("\"" + next + "\"", from);
        assertTrue(from > 0 && to > from, name + " is in the vectors");
        return json.substring(from, to);
    }

    private static List<String> values(String section, String key) {
        List<String> out = new ArrayList<>();
        Matcher m = Pattern.compile("\"" + key + "\":\\s*\"([0-9a-f]*)\"").matcher(section);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    private static List<Integer> numbers(String section, String key) {
        List<Integer> out = new ArrayList<>();
        Matcher m = Pattern.compile("\"" + key + "\":\\s*([0-9]+)").matcher(section);
        while (m.find()) out.add(Integer.parseInt(m.group(1)));
        return out;
    }

    private static String json() throws Exception {
        return new String(Files.readAllBytes(vectors()), StandardCharsets.UTF_8);
    }

    private static byte[] read(TagAddressTest.Card k, int fid) {
        assertEquals(SW_OK, k.selectTag());
        k.selectFile(fid);
        byte[] whole = k.read(0, 256);
        k.selectCard();
        return whole;
    }

    @Test
    @DisplayName("Every valid address of spec/vectors/tag-address.json installs, and the tag's two files are the vector's bytes; a set-up card says the address, #, and 48 hex of a code that checks, read whole or in reads of MLe")
    void validAddresses() throws Exception {
        String valid = section(json(), "valid", "invalid");
        List<String> hex = values(valid, "hex"), cc = values(valid, "cc"), ndef = values(valid, "ndefNew");
        List<Integer> coded = numbers(valid, "ndefCodedSize");
        assertTrue(hex.size() >= 5, "the vectors are read");
        assertEquals(hex.size(), cc.size());
        assertEquals(hex.size(), ndef.size());
        assertEquals(hex.size(), coded.size());
        for (int i = 0; i < hex.size(); i++) {
            String address = new String(hexToBytes(hex.get(i)), StandardCharsets.US_ASCII);
            byte[] install = TagTest.tagInstall(address);
            TagAddressTest.Card fresh = new TagAddressTest.Card(install);
            assertEquals(cc.get(i), toHex(read(fresh, 0xE103)).toLowerCase(), address + ": the capability container");
            assertEquals(ndef.get(i), toHex(read(fresh, 0xE104)).toLowerCase(), address + ": the NDEF file of a new card");
            assertEquals(address + "#new", fresh.address(), address + ": as a phone reads it");

            TagAddressTest.Card k = TagAddressTest.setUp(install);
            byte[] whole = read(k, 0xE104);
            assertEquals((int) coded.get(i), whole.length, address + ": the NDEF file of a set-up card, in one read");
            assertEquals(whole.length, k.readFile().length, "and in reads of MLe");
            k.selectCard();
            String said = TagTest.decodeUriRecord(Arrays.copyOfRange(whole, 2, whole.length));
            assertTrue(said.startsWith(address + "#") && said.substring(address.length() + 1).matches("[0-9a-f]{48}"), said);
            byte[] r = hexToBytes(said.substring(address.length() + 1, address.length() + 33));
            assertEquals(said.substring(address.length() + 33), toHex(TagAddressTest.mac(k.c(), r)).toLowerCase(), address + ": the code checks");
        }
    }

    @Test
    @DisplayName("Every invalid address of spec/vectors/tag-address.json, and an install with no parameters at all, is refused at install with 6A80, and no tag answers")
    void invalidAddresses() throws Exception {
        List<String> hex = values(section(json(), "invalid", null), "hex");
        assertTrue(hex.size() >= 20, "the vectors are read");
        List<byte[]> installs = new ArrayList<>();
        for (String h : hex) installs.add(concat(hexToBytes("07" + TagTest.TAG_HEX + "00"), new byte[] { (byte) (h.length() / 2) }, hexToBytes(h)));
        // lengths that run past the bytes given: each refused 6A80 by the tag itself, never an exception of the runtime's
        for (byte[] bad : shortInstalls()) installs.add(bad);
        for (byte[] install : installs) {
            CardSimulator sim = new CardSimulator(new CashuAppletTest.ExposedRuntime());
            sim.installApplet(AIDUtil.create(TagTest.OPENER_HEX), Opener.class);
            sim.installApplet(AIDUtil.create(TagTest.CARD_HEX), CashuApplet.class);
            Throwable t = assertThrows(Throwable.class,
                () -> sim.installApplet(AIDUtil.create(TagTest.TAG_HEX), Tag.class, install, (short) 0, (byte) install.length), toHex(install));
            // jCardSim reports any failed install as its own SystemException: the tag's install, called by itself, says why
            ISOException iso = assertThrows(ISOException.class, () -> Tag.install(install, (short) 0, (byte) install.length), toHex(install));
            assertEquals((short) 0x6A80, iso.getReason(), toHex(install) + ": refused by the tag's check of the address");
            // no tag: jCardSim answers 6999 where it holds the failed install's name, a chip 6A82; never 9000
            int sw = sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TagTest.TAG_HEX), 256)).getSW();
            assertTrue(sw == 0x6A82 || sw == 0x6999, toHex(install) + ": no tag, " + Integer.toHexString(sw));
            assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TagTest.CARD_HEX), 256)).getSW(), "the card's applet is untouched");
        }
    }

    /** Installs whose lengths run past the bytes given: no La; La 20 and nothing after; La 40 and 11 bytes; control-info length 1 and nothing after. */
    static List<byte[]> shortInstalls() {
        String aid = "07" + TagTest.TAG_HEX;
        List<byte[]> out = new ArrayList<>();
        out.add(hexToBytes(aid + "00"));
        out.add(hexToBytes(aid + "00" + "14"));
        out.add(concat(hexToBytes(aid + "00" + "28"), "https://exa".getBytes(StandardCharsets.US_ASCII)));
        out.add(hexToBytes(aid + "01"));
        return out;
    }

    @Test
    @DisplayName("An install whose lengths run past the bytes given (no La, La 20 with nothing after, La 40 with 11 bytes, control information of 1 byte with nothing after) is refused 6A80 by the tag, never by an out-of-bounds read, even when the array holds more bytes past the install")
    void shortInstalls6A80() {
        for (byte[] bad : shortInstalls()) {
            ISOException iso = assertThrows(ISOException.class, () -> Tag.install(bad, (short) 0, (byte) bad.length), toHex(bad));
            assertEquals((short) 0x6A80, iso.getReason(), toHex(bad));
        }
        // La 40 with 11 bytes given, and the array going on with the 29 that would make a valid address: a tag that read past
        // the bytes it was given would take them; it refuses
        byte[] given = shortInstalls().get(2);
        byte[] more = concat(given, "mple.com/aaaaaaaaaaaaaaaaaaaa".getBytes(StandardCharsets.US_ASCII));
        assertEquals(given.length + 29, more.length);
        ISOException iso = assertThrows(ISOException.class, () -> Tag.install(more, (short) 0, (byte) given.length));
        assertEquals((short) 0x6A80, iso.getReason(), "the bytes past bLength are not the install's");
    }

    @Test
    @DisplayName("The package names no address: the tag's source holds no host, and the built class files no https address")
    void thePackageNamesNoAddress() throws Exception {
        String code = new String(Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("Tag.java")), StandardCharsets.UTF_8);
        String body = code.substring(code.indexOf("public final class Tag"));
        assertFalse(body.matches("(?s).*'[a-z]', '[a-z]', '[a-z]', '\\.'.*"), "no host spelt out in bytes");
        assertFalse(body.contains(".io") || body.contains(".com") || body.contains(".org"), "nor in text");
        for (String name : new String[] { "Tag", "CashuApplet", "Opener", "SchnorrHW" }) {
            byte[] cls = Files.readAllBytes(Path.of(Tag.class.getResource(name + ".class").toURI()));
            String text = new String(cls, StandardCharsets.ISO_8859_1);
            assertFalse(text.contains("example.com") || text.contains(".io/"), name + ".class carries no address");
        }
    }
}
