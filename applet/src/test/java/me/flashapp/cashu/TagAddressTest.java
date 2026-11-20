package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_NONCE;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.L_TAG;
import static me.flashapp.cashu.CashuAppletTest.OWNER;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.ownerProof;
import static me.flashapp.cashu.CashuAppletTest.readyOn;
import static me.flashapp.cashu.CashuAppletTest.setTagCommand;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.Applet;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Function;

/**
 * The tag's address that changes at every read (D216). A card with no owner or no holder's record says
 * `https://getfoxy.io/card#new`; a set-up card says `https://getfoxy.io/card#` and 48 lowercase hex characters, R (16 bytes of
 * the chip's random, new at each selection) and M = HMAC-SHA256(K, R)[0..8), K = SHA-256("CashuCard/tag-address" || c). The
 * owner's phone, which has c, knows its card by M; anyone else sees a new address at every read. Simulator only.
 */
class TagAddressTest {

    static final String TAG_HEX = TagTest.TAG_HEX;
    static final String FIXED = "https://getfoxy.io/card";
    static final String NEW = "https://getfoxy.io/card#new";
    static final String PREFIX = "https://getfoxy.io/card#";

    // ---- the phone's side, as the wallet works it -------------------------------------------------------------------

    /** K = SHA-256("CashuCard/tag-address" || c). */
    static byte[] tagKey(byte[] c) throws Exception {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        d.update("CashuCard/tag-address".getBytes(StandardCharsets.US_ASCII));
        d.update(c);
        return d.digest();
    }

    /** M = HMAC-SHA256(K, R)'s first eight bytes. */
    static byte[] mac(byte[] c, byte[] r) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(tagKey(c), "HmacSHA256"));
        return Arrays.copyOf(m.doFinal(r), 8);
    }

    /** Whether an address is this c's card's: a fragment of 48 lowercase hex whose last 16 are the MAC of the first 32. */
    static boolean isMine(String address, byte[] c) throws Exception {
        if (!address.startsWith(PREFIX)) return false;
        String f = address.substring(PREFIX.length());
        if (!f.matches("[0-9a-f]{48}")) return false;
        return MessageDigest.isEqual(hexToBytes(f.substring(32)), mac(c, hexToBytes(f.substring(0, 32))));
    }

    // ---- a card as the chip has it -----------------------------------------------------------------------------------

    /** A card with the opener, the card's applet and the tag, and a way to read the tag as a phone does. */
    static final class Card {
        final CashuAppletTest.ExposedRuntime runtime = new CashuAppletTest.ExposedRuntime();
        final CardSimulator sim = new CardSimulator(runtime);

        Card() {
            sim.installApplet(AIDUtil.create(TagTest.OPENER_HEX), Opener.class);
            sim.installApplet(AIDUtil.create(TagTest.CARD_HEX), CashuApplet.class);
            sim.installApplet(AIDUtil.create(TAG_HEX), Tag.class, TagTest.TAG_INSTALL, (short) 0, (byte) TagTest.TAG_INSTALL.length);
            selectCard();
        }

        ResponseAPDU send(CommandAPDU c) { return CashuAppletTest.held(sim::transmitCommand, c); }
        ResponseAPDU selectCard() { return send(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TagTest.CARD_HEX), 256)); }
        int selectTag() { return send(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TAG_HEX), 256)).getSW(); }
        void selectFile(int fid) { assertEquals(SW_OK, send(new CommandAPDU(0x00, 0xA4, 0x00, 0x0C, new byte[] { (byte) (fid >> 8), (byte) fid })).getSW()); }
        byte[] read(int offset, int le) {
            ResponseAPDU r = send(new CommandAPDU(0x00, 0xB0, offset >> 8, offset & 0xFF, le));
            assertEquals(SW_OK, r.getSW(), "READ BINARY at " + offset);
            return r.getData();
        }

        /** The NDEF file as a phone reads it: select the name, E104, NLEN, then the message in reads of at most MLe (59) bytes. */
        byte[] readFile() {
            assertEquals(SW_OK, selectTag(), "the tag is selected");
            selectFile(0xE104);
            byte[] nlen = read(0, 2);
            int total = 2 + (((nlen[0] & 0xFF) << 8) | (nlen[1] & 0xFF));
            byte[] file = Arrays.copyOf(nlen, total);
            for (int at = 2; at < total; at += 59) {
                byte[] part = read(at, Math.min(59, total - at));
                System.arraycopy(part, 0, file, at, part.length);
            }
            return file;
        }

        /** The address a phone opens, after its sequence; the card's applet selected again after it. */
        String address() {
            byte[] file = readFile();
            selectCard();
            assertEquals(file.length - 2, ((file[0] & 0xFF) << 8) | (file[1] & 0xFF), "NLEN is the message's length");
            return TagTest.decodeUriRecord(Arrays.copyOfRange(file, 2, file.length));
        }

        CashuApplet applet() { return (CashuApplet) runtime.appletAt(AIDUtil.create(TagTest.CARD_HEX)); }
        /** The card's c (D202), as the owner's phone has it. */
        byte[] c() { return Arrays.copyOf(field("chain"), 32); }
        byte[] field(String name) {
            try {
                java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
                f.setAccessible(true);
                return (byte[]) f.get(applet());
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
        byte[] nonce() {
            ResponseAPDU r = send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
            assertEquals(SW_OK, r.getSW());
            return r.getData();
        }
        int switchTag(boolean off) {
            byte[] value = { (byte) (off ? 1 : 0) };
            return send(setTagCommand(ownerProof(L_TAG, OWNER, nonce(), value), off ? 1 : 0)).getSW();
        }
    }

    static Card setUp() {
        Card k = new Card();
        readyOn(k.sim, 0);
        return k;
    }

    // ---- the tests ---------------------------------------------------------------------------------------------------

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @Test
    @DisplayName("The phone's check reproduces the specification's vectors (spec/APDU.md, The NFC tag application)")
    void theVectors() throws Exception {
        byte[] c = hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        assertEquals("d535d7590e7a1459ef2501f958b06e2683ca196848454ba969ac10462db7c9d0", toHex(tagKey(c)));
        assertEquals("4fe881e85d9bc23e", toHex(mac(c, new byte[16])));
        assertEquals("63564fb9e14298a1", toHex(mac(c, hexToBytes("0123456789abcdeffedcba9876543210"))));
        byte[] c3 = hexToBytes("509bc5c1b9803489c07206216ea710d04a28f3a296d23a6332ff8c505c17fb4e");
        byte[] ff = new byte[16];
        Arrays.fill(ff, (byte) 0xFF);
        assertEquals("bcb614027c0522f5", toHex(mac(c3, ff)));
        assertTrue(isMine(PREFIX + "00000000000000000000000000000000" + "4fe881e85d9bc23e", c));
        assertFalse(isMine(PREFIX + "00000000000000000000000000000000" + "4fe881e85d9bc23f", c), "one bit of M changed");
        assertFalse(isMine(PREFIX + "00000000000000000000000000000001" + "4fe881e85d9bc23e", c), "one bit of R changed");
    }

    @Test
    @DisplayName("A set-up card no longer says the fixed address: it says #, 32 hex of R and 16 of M, 71 bytes in its NDEF file")
    void theFixedAddressIsGone() {
        Card k = setUp();
        String a = k.address();
        assertNotEquals(FIXED, a, "not the address every card said");
        assertTrue(a.matches(TagTest.CODED), a);
        assertEquals(71, k.readFile().length, "the NDEF file with a code");
        k.selectCard();
    }

    @Test
    @DisplayName("Two reads of one card differ: twenty selections, twenty addresses, no R twice")
    void twoReadsDiffer() {
        Card k = setUp();
        Set<String> seen = new HashSet<>(), rs = new HashSet<>();
        for (int i = 0; i < 20; i++) {
            String a = k.address();
            assertTrue(seen.add(a), "address " + i + " seen before: " + a);
            assertTrue(rs.add(a.substring(PREFIX.length(), PREFIX.length() + 32)), "R " + i + " seen before");
        }
        // and across a power cycle
        k.sim.reset();
        k.selectCard();
        assertTrue(seen.add(k.address()), "after a power cycle, another");
    }

    @Test
    @DisplayName("The MAC checks with the card's own c, as the owner's phone works it, and fails with another card's c")
    void theMacIsTheOwners() throws Exception {
        Card mine = setUp(), theirs = setUp();
        // jCardSim draws the same c on every card it makes; a phone gives each of its cards its own (D202): theirs is given another here
        byte[] given = MessageDigest.getInstance("SHA-256").digest("another owner's c".getBytes(StandardCharsets.US_ASCII));
        System.arraycopy(given, 0, theirs.field("chain"), 0, 32);
        byte[] myC = mine.c(), theirC = theirs.c();
        assertFalse(Arrays.equals(myC, theirC), "two cards, two c");
        for (int i = 0; i < 5; i++) {
            String a = mine.address(), b = theirs.address();
            assertTrue(isMine(a, myC), "my card's address is mine: " + a);
            assertFalse(isMine(a, theirC), "and not theirs");
            assertTrue(isMine(b, theirC), "their card's is theirs");
            assertFalse(isMine(b, myC), "and not mine");
        }
    }

    @Test
    @DisplayName("One selection, one address: the file read whole, in pieces of any size, from any offset, or E104 chosen again, is the same bytes; the next selection is another")
    void oneSelectionOneAddress() {
        Card k = setUp();
        assertEquals(SW_OK, k.selectTag());
        k.selectFile(0xE104);
        byte[] whole = k.read(0, 256);
        assertEquals(71, whole.length);
        for (int size = 1; size <= 59; size += 7) {
            byte[] again = new byte[71];
            for (int at = 0; at < 71; at += size) {
                byte[] part = k.read(at, Math.min(size, 71 - at));
                System.arraycopy(part, 0, again, at, part.length);
            }
            assertArrayEquals(whole, again, "read in pieces of " + size);
        }
        k.selectFile(0xE103);
        k.read(0, 15);
        k.selectFile(0xE104);
        assertArrayEquals(whole, k.read(0, 256), "E104 chosen again in the same selection");
        assertEquals(SW_OK, k.selectTag());
        k.selectFile(0xE104);
        assertFalse(Arrays.equals(whole, k.read(0, 256)), "a new selection, a new address");
    }

    @Test
    @DisplayName("#new before set-up (a new card, a PIN and no record, a record and no owner) and after a reset; a code once set up")
    void newBeforeSetUpAndAfterReset() {
        Card k = new Card();
        assertEquals(NEW, k.address(), "a new card");
        assertEquals(26, k.readFile().length, "26 bytes");
        k.selectCard();
        // a holder's record and no owner: UnitsTest's card, with the tag installed beside it
        UnitsTest.Card noOwner = new UnitsTest.Card();
        noOwner.sim.installApplet(AIDUtil.create(TAG_HEX), Tag.class, TagTest.TAG_INSTALL, (short) 0, (byte) TagTest.TAG_INSTALL.length);
        noOwner.ready(UnitsTest.SAT, false);
        assertEquals(NEW, addressOf(noOwner::send), "a record and no owner");
        // set up, then reset by the owner: #new again, and a new c, not the last owner's
        Card s = setUp();
        byte[] before = s.c();
        assertTrue(s.address().matches(TagTest.CODED));
        assertEquals(SW_OK, s.send(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM,
            ownerData(ownerProof(L_RESET, OWNER, s.nonce(), new byte[0]), new byte[0]))).getSW(), "RESET_CARD by the owner");
        assertEquals(NEW, s.address(), "after the reset");
        assertFalse(Arrays.equals(before, s.c()), "and the card's c is not the one the old key came from");
    }

    @Test
    @DisplayName("A hand-over: the new owner's c makes the code at once, and the last owner's no longer checks; nothing of the old key is kept")
    void aHandOverChangesTheKey() throws Exception {
        UnitsTest.Card u = UnitsTest.owned(UnitsTest.SAT);
        u.sim.installApplet(AIDUtil.create(TAG_HEX), Tag.class, TagTest.TAG_INSTALL, (short) 0, (byte) TagTest.TAG_INSTALL.length);
        u.select();
        byte[] old = Arrays.copyOf(u.field("chain"), 32);
        String a = addressOf(u::send);
        assertTrue(isMine(a, old), "before, the owner's");
        u.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(u), "the hand-over");
        u.power();
        byte[] now = Arrays.copyOf(u.field("chain"), 32);
        assertFalse(Arrays.equals(old, now), "a new c");
        for (int i = 0; i < 3; i++) {
            String b = addressOf(u::send);
            assertTrue(isMine(b, now), "the new owner's c checks");
            assertFalse(isMine(b, old), "the last owner's does not");
        }
        // the tag holds no key: its one instance field is its transient array (TagTest), and the card's applet holds no K either
        for (java.lang.reflect.Field f : CashuApplet.class.getDeclaredFields()) {
            assertFalse(f.getName().toLowerCase().contains("tagkey"), "no field keeps a tag key: " + f.getName());
        }
    }

    @Test
    @DisplayName("A read writes nothing that lasts: no persistent write at all under the tear harness, through the whole of a phone's sequence, on a set-up card")
    void aReadWritesNothing() throws Exception {
        TearSweepTest.Card card = new TearSweepTest.Card();
        @SuppressWarnings("unchecked")
        Class<? extends Applet> tag = (Class<? extends Applet>) TearSweepTest.cls().getClassLoader().loadClass("me.flashapp.cashu.Tag");
        card.sim.installApplet(AIDUtil.create(TAG_HEX), tag, TagTest.TAG_INSTALL, (short) 0, (byte) TagTest.TAG_INSTALL.length);
        readyOn(card.sim, 0);
        card.sim.reset();
        Function<CommandAPDU, ResponseAPDU> tx = c -> CashuAppletTest.held(card.sim::transmitCommand, c);
        // the harness sees a write when there is one: the owner's switch flipped is one
        card.select();
        TearHook.refresh();
        TearHook.count = 0;
        byte[] n = tx.apply(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx.apply(setTagCommand(ownerProof(L_TAG, OWNER, n, new byte[] { 1 }), 1)).getSW());
        assertTrue(TearHook.count > 0, "the harness counts SET_TAG's write");
        card.select();
        n = tx.apply(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx.apply(setTagCommand(ownerProof(L_TAG, OWNER, n, new byte[] { 0 }), 0)).getSW());
        byte[] chain = Arrays.copyOf(card.f("chain"), card.f("chain").length);
        // now a phone reads the tag, three times
        TearHook.count = 0;
        TearHook.target = 0;
        TearHook.trace = new java.util.ArrayList<>();
        String[] said = new String[3];
        for (int i = 0; i < 3; i++) said[i] = addressOf(tx);
        java.util.List<String> trace = TearHook.trace;
        TearHook.trace = null;
        assertEquals(0, TearHook.count, "no persistent write: " + trace);
        for (String a : said) assertTrue(isMine(a, Arrays.copyOf(chain, 32)), "and each read is the card's code: " + a);
        assertArrayEquals(chain, card.f("chain"), "c as it was");
    }

    @Test
    @DisplayName("The owner's switch still works: off, no tag (6999); on, a code again; a card whose applet is gone says #new")
    void theSwitchStillWorks() throws Exception {
        Card k = setUp();
        assertEquals(SW_OK, k.switchTag(true));
        assertEquals(0x6999, k.selectTag(), "off: the name refused");
        k.selectCard();
        assertEquals(SW_OK, k.switchTag(false));
        String a = k.address();
        assertTrue(isMine(a, k.c()), "on: the code again");
        k.sim.deleteApplet(AIDUtil.create(TagTest.CARD_HEX));
        assertEquals(SW_OK, k.selectTag());
        k.selectFile(0xE104);
        assertEquals(NEW, TagTest.decodeUriRecord(Arrays.copyOfRange(k.read(0, 256), 2, 26)), "the card's applet gone: #new, no key anywhere");
    }

    @Test
    @DisplayName("The work the card's applet does for the tag is cleared: the room in the APDU buffer holds nothing of K or the inner hash after it, the code sits in the card's applet's working memory only while the tag is selected, and the tag's own transient memory is the one byte it was")
    void theRoomIsCleared() throws Exception {
        Card k = setUp();
        assertEquals(SW_OK, k.selectTag());
        // the code straight from the card's applet, with a room of our own, to see what is left in it
        // (by reflection, so that this suite compiles against a card program without the code and fails there)
        java.lang.reflect.Method code = CashuApplet.class.getMethod("tagCode", byte[].class, short.class);
        java.lang.reflect.Method copy = CashuApplet.class.getMethod("tagCodeCopy", byte[].class, short.class);
        byte[] room = new byte[96 + 32];
        Arrays.fill(room, (byte) 0x5A);
        assertTrue((Boolean) code.invoke(k.applet(), room, (short) 16));
        for (int i = 16; i < 16 + 96; i++) assertEquals(0, room[i], "the room is cleared at " + i);
        for (int i = 0; i < 16; i++) assertEquals(0x5A, room[i], "and nothing before it is touched");
        for (int i = 112; i < room.length; i++) assertEquals(0x5A, room[i], "nor after it");
        byte[] out = new byte[24];
        copy.invoke(k.applet(), out, (short) 0);
        assertTrue(isMine(PREFIX + toHex(out), k.c()), "and the code checks");
        assertArrayEquals(out, Arrays.copyOfRange(k.field("scratch"), 164, 188), "kept in the card's applet's working memory");
        k.selectCard();
        assertArrayEquals(new byte[24], Arrays.copyOfRange(k.field("scratch"), 164, 188), "and gone when the card's applet is selected");
    }

    /** The address a tag answers through `tx` (the tag selected, E104, NLEN, the message), and the card's applet selected after. */
    static String addressOf(Function<CommandAPDU, ResponseAPDU> tx) {
        assertEquals(SW_OK, tx.apply(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TAG_HEX), 256)).getSW());
        assertEquals(SW_OK, tx.apply(new CommandAPDU(0x00, 0xA4, 0x00, 0x0C, new byte[] { (byte) 0xE1, 0x04 })).getSW());
        byte[] file = tx.apply(new CommandAPDU(0x00, 0xB0, 0x00, 0x00, 256)).getData();
        tx.apply(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(TagTest.CARD_HEX), 256));
        assertEquals(file.length - 2, ((file[0] & 0xFF) << 8) | (file[1] & 0xFF));
        return TagTest.decodeUriRecord(Arrays.copyOfRange(file, 2, file.length));
    }
}
