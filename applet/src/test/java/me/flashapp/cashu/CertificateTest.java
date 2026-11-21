package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_AUTH;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_PUBKEY;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.MINT;
import static me.flashapp.cashu.CashuAppletTest.REFUND;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SECP_GX;
import static me.flashapp.cashu.CashuAppletTest.SECP_GY;
import static me.flashapp.cashu.CashuAppletTest.SECP_N;
import static me.flashapp.cashu.CashuAppletTest.SW_CARD_IN_USE;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_INCORRECT_P1P2;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_OWNER_PROOF;
import static me.flashapp.cashu.CashuAppletTest.SW_PIECE_ON_CARD;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_EMPTY;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_OUT_OF_RANGE;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.ecMulTest;
import static me.flashapp.cashu.CashuAppletTest.extractPubkeyX;
import static me.flashapp.cashu.CashuAppletTest.keyOf;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.record;
import static me.flashapp.cashu.CashuAppletTest.schnorrVerify;
import static me.flashapp.cashu.CashuAppletTest.sha256;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static me.flashapp.cashu.CashuAppletTest.unsigned32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The certificate (3.0, D192): CERT_WRITE writes a container in pieces on a card that has never had a PIN and seals it once it
 * names the card's own key, CERT_READ gives it to anyone, and RESET_CARD keeps a certified card's key, certificate and paid
 * list. The card reads neither the statement nor the signature; these tests make both as a reader would read them, so that the
 * containers are whole, and record the vectors for NUT-CCP's certificate profile.
 */
class CertificateTest {

    static final byte INS_CERT_READ = CashuApplet.INS_CERT_READ, INS_CERT_WRITE = CashuApplet.INS_CERT_WRITE;
    static final byte[] HEAD = concat("CCP-CERT".getBytes(StandardCharsets.US_ASCII), new byte[] { 1 });
    static final byte[] NOTHING = new byte[0];

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    // =========================================================================
    // The container, as an issuer makes it
    // =========================================================================

    static byte[] u16(int v) { return new byte[] { (byte) (v >> 8), (byte) v }; }
    static byte[] part(byte[] b) { return concat(u16(b.length), b); }

    static byte[] leaf(byte[] key) {
        return sha256(concat(new byte[] { 0 }, "CashuCard/cert-leaf/1".getBytes(StandardCharsets.US_ASCII), key));
    }
    static byte[] node(byte[] l, byte[] r) { return sha256(concat(new byte[] { 1 }, l, r)); }
    static final byte[] EMPTY = sha256(concat(new byte[] { 2 }, "CashuCard/cert-empty/1".getBytes(StandardCharsets.US_ASCII)));

    /** Every level of the tree over `leaves` (a power of two of them), the leaves first and the top last. */
    static List<byte[][]> tree(byte[][] leaves) {
        List<byte[][]> lv = new ArrayList<>();
        lv.add(leaves);
        while (lv.get(lv.size() - 1).length > 1) {
            byte[][] below = lv.get(lv.size() - 1), up = new byte[below.length / 2][];
            for (int i = 0; i < up.length; i++) up[i] = node(below[2 * i], below[2 * i + 1]);
            lv.add(up);
        }
        return lv;
    }
    static byte[] top(List<byte[][]> lv) { return lv.get(lv.size() - 1)[0]; }
    /** The path of leaf `index`, from its sibling up. */
    static byte[][] path(List<byte[][]> lv, int index) {
        byte[][] p = new byte[lv.size() - 1][];
        for (int h = 0; h < p.length; h++) p[h] = lv.get(h)[(index >> h) ^ 1];
        return p;
    }

    static byte[] form01(byte[] key, byte[] statement, byte[] sig, byte[] chain) {
        return concat(HEAD, new byte[] { 1 }, key, part(statement), part(sig), part(chain));
    }
    static byte[] form02(int index, byte[][] path, byte[] top, byte[] statement, byte[] sig, byte[] chain) {
        return concat(HEAD, new byte[] { 2 }, u16(index), new byte[] { (byte) path.length }, concat(path), top,
            part(statement), part(sig), part(chain));
    }

    // BIP-340, as the profile's `bip340` scheme signs a statement: over SHA-256(T || T || line), T = SHA-256("CashuCard/cert/1")

    static byte[] tagged(String tag, byte[]... parts) {
        byte[] t = sha256(tag.getBytes(StandardCharsets.US_ASCII));
        return sha256(concat(t, t, concat(parts)));
    }
    /** A BIP-340 signature by `sk` over the 32 bytes `msg`, with the auxiliary bytes `aux` (BIP-340's default signing). */
    static byte[] bip340(BigInteger sk, byte[] msg, byte[] aux) {
        BigInteger n = SECP_N;
        BigInteger[] p = ecMulTest(sk, SECP_GX, SECP_GY);
        BigInteger d = p[1].testBit(0) ? n.subtract(sk) : sk;
        byte[] t = unsigned32(d), a = tagged("BIP0340/aux", aux);
        for (int i = 0; i < 32; i++) t[i] ^= a[i];
        BigInteger k0 = new BigInteger(1, tagged("BIP0340/nonce", t, unsigned32(p[0]), msg)).mod(n);
        BigInteger[] r = ecMulTest(k0, SECP_GX, SECP_GY);
        BigInteger k = r[1].testBit(0) ? n.subtract(k0) : k0;
        BigInteger e = new BigInteger(1, tagged("BIP0340/challenge", unsigned32(r[0]), unsigned32(p[0]), msg)).mod(n);
        return concat(unsigned32(r[0]), unsigned32(k.add(e.multiply(d)).mod(n)));
    }
    static byte[] statementSig(BigInteger issuer, String line) {
        return bip340(issuer, tagged("CashuCard/cert/1", line.getBytes(StandardCharsets.US_ASCII)), new byte[32]);
    }

    /** The published test keys the vectors use: the issuer's and the cards'. Test keys only: each is a hash of its own name. */
    static BigInteger testKey(String name) { return new BigInteger(1, sha256(name.getBytes(StandardCharsets.US_ASCII))).mod(SECP_N); }
    static final BigInteger ISSUER = testKey("CashuCard/cert test issuer");
    static BigInteger cardScalar(int i) { return testKey("CashuCard/cert test card " + i); }
    static final String BUILD = toHex(sha256("CashuCard/cert test build".getBytes(StandardCharsets.US_ASCII)));
    static final String DATE = "2026-11-12";

    // =========================================================================
    // A card, and what the issuer sends it
    // =========================================================================

    static UnitsTest.Card fresh() { return new UnitsTest.Card(); }

    /** The card's signing key given a scalar of the test's (jCardSim draws the same key every time). */
    static void plant(UnitsTest.Card c, BigInteger d) throws Exception {
        java.lang.reflect.Field fp = CashuApplet.class.getDeclaredField("cardPrivKey"), fw = CashuApplet.class.getDeclaredField("cardPubKey");
        fp.setAccessible(true);
        fw.setAccessible(true);
        ((javacard.security.ECPrivateKey) fp.get(c.applet())).setS(unsigned32(d), (short) 0, (short) 32);
        BigInteger[] w = ecMulTest(d, SECP_GX, SECP_GY);
        ((javacard.security.ECPublicKey) fw.get(c.applet())).setW(concat(new byte[] { 4 }, unsigned32(w[0]), unsigned32(w[1])), (short) 0, (short) 65);
    }
    static byte[] cardKey(UnitsTest.Card c) { return c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }

    static CommandAPDU writeCommand(int offset, byte[] bytes) { return new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0, concat(u16(offset), bytes)); }
    /** The seal of a container of `length` bytes and nothing to check it by (32 zeros): for the refusals made before the hash is looked at. */
    static CommandAPDU sealCommand(int length) { return new CommandAPDU(CLA, INS_CERT_WRITE, 1, 0, concat(u16(length), new byte[32])); }
    /** The seal as its writer sends it: the length, then SHA-256 of the container's first `length` bytes (zeros past its end, as the store holds). */
    static CommandAPDU sealCommand(byte[] container, int length) {
        return new CommandAPDU(CLA, INS_CERT_WRITE, 1, 0, concat(u16(length), sha256(Arrays.copyOf(container, length))));
    }
    static CommandAPDU readCommand(int p1) { return new CommandAPDU(CLA, INS_CERT_READ, p1, 0, 256); }

    /** The container's writes, 240 bytes each. */
    static List<CommandAPDU> writes(byte[] container) {
        List<CommandAPDU> w = new ArrayList<>();
        for (int at = 0; at < container.length; at += 240) w.add(writeCommand(at, Arrays.copyOfRange(container, at, Math.min(container.length, at + 240))));
        return w;
    }
    static void writeAll(UnitsTest.Card c, byte[] container) {
        for (CommandAPDU w : writes(container)) assertEquals(SW_OK, c.sw(w), "a write");
    }
    static int writeAndSeal(UnitsTest.Card c, byte[] container) {
        writeAll(c, container);
        return c.sw(sealCommand(container, container.length));
    }
    static byte[] state(UnitsTest.Card c) {
        ResponseAPDU r = c.send(readCommand(0xFF));
        assertEquals(SW_OK, r.getSW());
        return r.getData();
    }
    /** The certificate as a reader reads it: P1 = FF, then the pages. */
    static byte[] readAll(UnitsTest.Card c) {
        byte[] s = state(c);
        assertEquals(1, s[0], "sealed");
        int len = ((s[2] & 0xFF) << 8) | (s[3] & 0xFF);
        byte[] out = new byte[0];
        for (int p = 0; p * 256 < len; p++) {
            ResponseAPDU r = c.send(readCommand(p));
            assertEquals(SW_OK, r.getSW());
            assertEquals(Math.min(256, len - p * 256), r.getData().length, "page " + p);
            out = concat(out, r.getData());
        }
        return out;
    }
    static void assertNotSealed(UnitsTest.Card c, String what) {
        assertArrayEquals(new byte[4], state(c), what + ": nothing sealed");
        assertEquals(SW_SLOT_EMPTY, c.sw(readCommand(0)), what + ": and no page served");
    }

    /** A form 01 container for the card key `key`, with a statement signed by the test issuer. */
    static byte[] signedForm01(byte[] key) {
        String line = "cashu-card-cert/1 issuer=test-issuer form=card key=" + toHex(key) + " applet=0300 build=" + BUILD + " date=" + DATE + " scheme=bip340";
        return form01(key, line.getBytes(StandardCharsets.US_ASCII), statementSig(ISSUER, line), NOTHING);
    }

    /** The tree of four test cards, its leaves ordered by their own hash: { leaves, keys } in that order. */
    static byte[][][] fourCards() {
        byte[][] keys = new byte[4][];
        for (int i = 0; i < 4; i++) keys[i] = keyOf(cardScalar(i));
        Integer[] order = { 0, 1, 2, 3 };
        Arrays.sort(order, (x, y) -> Arrays.compareUnsigned(leaf(keys[x]), leaf(keys[y])));
        byte[][] leaves = new byte[4][], sorted = new byte[4][];
        for (int i = 0; i < 4; i++) { sorted[i] = keys[order[i]]; leaves[i] = leaf(sorted[i]); }
        return new byte[][][] { leaves, sorted };
    }
    static String batchLine(byte[] top, int count) {
        return "cashu-card-cert/1 issuer=test-issuer form=batch top=" + toHex(top) + " count=" + count + " applet=0300 build=" + BUILD + " date=" + DATE + " scheme=bip340";
    }

    /** A card with the key of `scalar` that has never had a PIN. */
    static UnitsTest.Card cardOf(BigInteger scalar) throws Exception {
        UnitsTest.Card c = fresh();
        plant(c, scalar);
        return c;
    }

    // =========================================================================
    // Writing, sealing, reading
    // =========================================================================

    @Test
    @DisplayName("BIP-340 as the tests sign a statement: the specification's first vector, to the byte")
    void theTestSignerIsBip340() {
        byte[] sig = bip340(BigInteger.valueOf(3), new byte[32], new byte[32]);
        assertEquals("e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0", toHex(sig));
    }

    @Test
    @DisplayName("A form 01 container written in pieces is served by nobody until the seal; sealed, CERT_READ gives P1 = FF 01 01 and its length and the pages to anyone with no PIN, and nothing is written again")
    void writeSealAndRead() throws Exception {
        UnitsTest.Card c = cardOf(cardScalar(0));
        byte[] key = cardKey(c);
        assertArrayEquals(keyOf(cardScalar(0)), key, "the planted key is the card's");
        byte[] container = concat(signedForm01(key));
        assertTrue(container.length > 256, "more than a page");
        assertNull(c.field("cert"), "no store before the first write");
        assertNotSealed(c, "a new card");
        writeAll(c, container);
        assertNotNull(c.field("cert"), "the first write reserves it");
        assertEquals(CashuApplet.CERT_LEN, c.field("cert").length, "1,024 bytes and the seal's three");
        assertNotSealed(c, "written and not sealed");
        byte[] store = c.field("cert");
        assertEquals(SW_OK, c.sw(writeCommand(0, new byte[] { 'X' })), "a write over a write");
        assertSame(store, c.field("cert"), "the same store: reserved once");
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(container, container.length)), "the last write stands: not a container");
        assertNotSealed(c, "refused");
        assertEquals(SW_OK, c.sw(writeCommand(0, new byte[] { 'C' })));
        assertEquals(SW_OK, c.sw(sealCommand(container, container.length)));
        byte[] s = state(c);
        assertArrayEquals(concat(new byte[] { 1, 1 }, u16(container.length)), s, "sealed, version 01, its length");
        assertArrayEquals(container, readAll(c), "the pages are the container");
        // to a reader in a new tap with nothing given
        c.power();
        assertArrayEquals(container, readAll(c), "to anyone");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(readCommand(2)), "a page at its end");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(readCommand(3)), "and past it");
        assertEquals(SW_INCORRECT_P1P2, c.sw(readCommand(4)), "P1 04");
        assertEquals(SW_INCORRECT_P1P2, c.sw(readCommand(0x80)), "P1 80");
        assertEquals(SW_INCORRECT_P1P2, c.sw(readCommand(0xFE)), "P1 FE");
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_CERT_READ, 0xFF, 1, 256)), "P2 01");
        // sealed: never written again, either form
        byte[] kept = c.field("cert").clone();
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(writeCommand(0, new byte[] { 'X' })), "a write");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(sealCommand(container, container.length)), "a seal");
        assertArrayEquals(kept, c.field("cert"), "nothing written");
    }

    @Test
    @DisplayName("A container of exactly 1,024 bytes seals and reads in four pages, the last of 256; a write that ends at 1,024 is taken and one byte past it is 6A83")
    void theLargestContainer() throws Exception {
        UnitsTest.Card c = cardOf(cardScalar(1));
        byte[] key = keyOf(cardScalar(1));
        byte[] small = form01(key, NOTHING, NOTHING, NOTHING);
        byte[] container = form01(key, NOTHING, NOTHING, new byte[1024 - small.length]);
        assertEquals(1024, container.length);
        writeAll(c, container);
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(writeCommand(1024 - 239, new byte[240])), "one byte past the end");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(writeCommand(1024, new byte[1])), "at the end");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(writeCommand(0x8000, new byte[1])), "an offset with its top bit");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(writeCommand(0x7FFF, new byte[240])), "an offset where offset and count overflow");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(sealCommand(1025)), "a length past it");
        assertEquals(SW_SLOT_OUT_OF_RANGE, c.sw(sealCommand(0xFFFF)), "or with its top bit");
        assertEquals(SW_OK, c.sw(writeCommand(1024 - 240, Arrays.copyOfRange(container, 1024 - 240, 1024))), "ending at 1,024");
        assertEquals(SW_OK, c.sw(sealCommand(container, 1024)));
        assertEquals(256, c.send(readCommand(3)).getData().length, "the last page is whole");
        assertArrayEquals(container, readAll(c));
    }

    @Test
    @DisplayName("CERT_WRITE's lengths and parameters: 6A86 for P1 02 or a P2, 6700 for a write of no byte or of 241, and a seal of anything but two bytes")
    void theLengthsAndParameters() throws Exception {
        UnitsTest.Card c = fresh();
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 2, 0, u16(10))));
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 1, concat(u16(0), new byte[1]))));
        assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 1, 1, u16(10))));
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0, u16(0))), "an offset and nothing");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0, new byte[1])), "one byte");
        assertEquals(SW_WRONG_LENGTH, c.sw(writeCommand(0, new byte[241])), "241 bytes");
        assertEquals(SW_OK, c.sw(writeCommand(0, new byte[240])), "240");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 1, 0, new byte[3])), "a seal of three bytes");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 1, 0, new byte[1])), "or one");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 1, 0)), "or none");
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(new byte[0], 0)), "a length of 0 is no container");
        assertNotSealed(c, "after all of it");
    }

    // =========================================================================
    // Form 02: a leaf folded to a top
    // =========================================================================

    @Test
    @DisplayName("Form 02 in a tree of four: each card seals the container of its own leaf, at each of the four indexes, and none seals another card's")
    void aTreeOfFour() throws Exception {
        byte[][][] four = fourCards();
        List<byte[][]> lv = tree(four[0]);
        byte[] top = top(lv);
        String line = batchLine(top, 4);
        byte[] sig = statementSig(ISSUER, line);
        for (int i = 0; i < 4; i++) {
            byte[] container = form02(i, path(lv, i), top, line.getBytes(StandardCharsets.US_ASCII), sig, NOTHING);
            int other = (i + 1) % 4;
            UnitsTest.Card wrong = fresh();
            plant(wrong, scalarOf(four[1][other]));
            assertEquals(SW_WRONG_DATA, writeAndSeal(wrong, container), "card " + other + " does not seal card " + i + "'s");
            assertNotSealed(wrong, "card " + other);
            UnitsTest.Card c = fresh();
            plant(c, scalarOf(four[1][i]));
            assertEquals(SW_OK, writeAndSeal(c, container), "card " + i + " seals its own");
            assertArrayEquals(container, readAll(c));
        }
    }
    static BigInteger scalarOf(byte[] key) {
        for (int i = 0; i < 4; i++) if (Arrays.equals(keyOf(cardScalar(i)), key)) return cardScalar(i);
        throw new AssertionError("not a test card");
    }

    @Test
    @DisplayName("Form 02 refused (6A80) for a path one bit off at any node and any bit, a top one bit off, an index one bit off, an index with a bit past its path, and a depth past sixteen; nothing is sealed, and the container put right then seals")
    void aPathOneBitOff() throws Exception {
        byte[][][] four = fourCards();
        List<byte[][]> lv = tree(four[0]);
        byte[] top = top(lv);
        int me = 2;
        byte[][] path = path(lv, me);
        UnitsTest.Card c = fresh();
        plant(c, scalarOf(four[1][me]));
        byte[] good = form02(me, path, top, NOTHING, NOTHING, NOTHING);
        for (int h = 0; h < path.length; h++) {
            for (int bit : new int[] { 0, 7, 255 }) {
                byte[][] off = path.clone();
                off[h] = path[h].clone();
                off[h][bit / 8] ^= (byte) (0x80 >> (bit % 8));
                assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me, off, top, NOTHING, NOTHING, NOTHING)), "node " + h + " bit " + bit);
            }
        }
        byte[] offTop = top.clone();
        offTop[31] ^= 1;
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me, path, offTop, NOTHING, NOTHING, NOTHING)), "the top");
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me ^ 1, path, top, NOTHING, NOTHING, NOTHING)), "the index's low bit");
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me ^ 2, path, top, NOTHING, NOTHING, NOTHING)), "its second bit");
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me | 4, path, top, NOTHING, NOTHING, NOTHING)), "a bit past the path");
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form02(me | 0x8000, path, top, NOTHING, NOTHING, NOTHING)), "the index's top bit");
        assertNotSealed(c, "every one refused");
        assertEquals(SW_OK, writeAndSeal(c, good), "the container put right");
    }

    @Test
    @DisplayName("A path of the greatest depth, sixteen, seals; seventeen, and a depth with its top bit, are refused (6A80); a path of no node, the leaf its own top, seals")
    void aPathOfTheGreatestDepth() throws Exception {
        byte[] key = keyOf(cardScalar(3));
        int index = 0x9C3A;
        byte[][] leaves = new byte[1 << 16][];
        for (int i = 0; i < leaves.length; i++) leaves[i] = sha256(concat("CashuCard/cert test leaf".getBytes(StandardCharsets.US_ASCII), u16(i), u16(i >> 16)));
        leaves[index] = leaf(key);
        List<byte[][]> lv = tree(leaves);
        byte[][] path = path(lv, index);
        assertEquals(16, path.length);
        byte[] container = form02(index, path, top(lv), NOTHING, NOTHING, NOTHING);
        UnitsTest.Card c = cardOf(cardScalar(3));
        assertEquals(SW_OK, writeAndSeal(c, container), "depth sixteen");
        assertArrayEquals(container, readAll(c));
        // seventeen: one more node, and the top above it
        byte[][] seventeen = Arrays.copyOf(path, 17);
        seventeen[16] = EMPTY;
        UnitsTest.Card d = cardOf(cardScalar(3));
        assertEquals(SW_WRONG_DATA, writeAndSeal(d, form02(index, seventeen, node(top(lv), EMPTY), NOTHING, NOTHING, NOTHING)), "depth seventeen");
        byte[] neg = container.clone();
        neg[12] = (byte) 0x90;
        assertEquals(SW_WRONG_DATA, writeAndSeal(d, neg), "a depth with its top bit");
        assertNotSealed(d, "neither");
        assertEquals(SW_OK, writeAndSeal(d, form02(0, new byte[0][], leaf(key), NOTHING, NOTHING, NOTHING)), "depth 0");
        assertEquals(SW_WRONG_DATA, writeAndSeal(cardOf(cardScalar(3)), form02(1, new byte[0][], leaf(key), NOTHING, NOTHING, NOTHING)), "depth 0 and an index of 1");
        // a container that holds as one of no node, but for its depth byte with its top bit
        for (int b : new int[] { 0x80, 0xFF }) {
            byte[] none = form02(0, new byte[0][], leaf(key), NOTHING, NOTHING, NOTHING);
            none[12] = (byte) b;
            assertEquals(SW_WRONG_DATA, writeAndSeal(cardOf(cardScalar(3)), none), String.format("a depth byte of %02X is no depth", b));
        }
    }

    @Test
    @DisplayName("A container of the greatest depth with a signed statement and a chain fits in 1,024 bytes and seals")
    void theGreatestDepthWithAStatementFits() throws Exception {
        byte[] key = keyOf(cardScalar(3));
        byte[][] leaves = new byte[1 << 16][];
        Arrays.fill(leaves, EMPTY);
        leaves[0xFFFF] = leaf(key);
        List<byte[][]> lv = tree(leaves);
        String line = "cashu-card-cert/1 issuer=" + "abcdefghijklmnopqrstuvwxyz012345" + " form=batch top=" + toHex(top(lv)) + " count=65535 applet=0300 build=" + BUILD + " date=" + DATE + " scheme=bip137";
        byte[] bare = form02(0xFFFF, path(lv, 0xFFFF), top(lv), line.getBytes(StandardCharsets.US_ASCII), new byte[65], NOTHING);
        assertEquals(890, bare.length, "the longest statement, a signature of 65 bytes and no chain");
        byte[] full = form02(0xFFFF, path(lv, 0xFFFF), top(lv), line.getBytes(StandardCharsets.US_ASCII), new byte[65], new byte[1024 - bare.length]);
        assertEquals(1024, full.length, "with 134 bytes of chain");
        assertEquals(SW_OK, writeAndSeal(cardOf(cardScalar(3)), full));
    }

    // =========================================================================
    // Well formed
    // =========================================================================

    @Test
    @DisplayName("A container with no statement, no signature and no chain seals, in either form: the card reads none of them")
    void aContainerWithNoStatement() throws Exception {
        byte[] key = keyOf(cardScalar(0));
        assertEquals(SW_OK, writeAndSeal(cardOf(cardScalar(0)), form01(key, NOTHING, NOTHING, NOTHING)), "form 01");
        byte[][][] four = fourCards();
        List<byte[][]> lv = tree(four[0]);
        UnitsTest.Card c = fresh();
        plant(c, scalarOf(four[1][1]));
        assertEquals(SW_OK, writeAndSeal(c, form02(1, path(lv, 1), top(lv), NOTHING, NOTHING, NOTHING)), "form 02");
        // and bytes the card does not read, in any of the three
        byte[] odd = { (byte) 0xFF, 0, (byte) 0x80 };
        assertEquals(SW_OK, writeAndSeal(cardOf(cardScalar(0)), form01(key, odd, odd, odd)), "any bytes in the three");
    }

    @Test
    @DisplayName("Seal refused (6A80) for another key, a short or a long container, another head, version or form, and parts that do not end at the length; nothing is sealed")
    void containersRefused() throws Exception {
        byte[] key = keyOf(cardScalar(0));
        byte[] good = signedForm01(key);
        UnitsTest.Card c = cardOf(cardScalar(0));
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, signedForm01(keyOf(cardScalar(1)))), "another key");
        byte[] otherParity = good.clone();
        otherParity[10] ^= 1;
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, otherParity), "the key's x with the other parity");
        writeAll(c, good);
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(good, good.length - 1)), "a length one short");
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(good, good.length + 1)), "one long");
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(good, 9)), "the head alone");
        assertEquals(SW_WRONG_DATA, c.sw(sealCommand(good, 43)), "the head and the key, no parts");
        for (int at : new int[] { 0, 7, 8, 9 }) {
            byte[] bad = good.clone();
            bad[at] ^= 1;
            assertEquals(SW_WRONG_DATA, writeAndSeal(c, bad), "byte " + at + " of the head or the form");
        }
        byte[] form3 = good.clone();
        form3[9] = 3;
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form3), "form 03");
        byte[] form0 = good.clone();
        form0[9] = 0;
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, form0), "form 00");
        // the parts: the statement's length one long, one short, with its top bit
        byte[] bare = form01(key, new byte[5], NOTHING, NOTHING);
        for (int len : new int[] { 6, 4, 0x8005 }) {
            byte[] bad = bare.clone();
            bad[43] = (byte) (len >> 8);
            bad[44] = (byte) len;
            assertEquals(SW_WRONG_DATA, writeAndSeal(c, bad), "a statement's length of " + len);
        }
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, concat(form01(key, NOTHING, NOTHING, NOTHING), new byte[1])), "a byte after the chain");
        assertEquals(SW_WRONG_DATA, writeAndSeal(c, Arrays.copyOf(form01(key, NOTHING, NOTHING, NOTHING), 47)), "no chain's length");
        assertNotSealed(c, "every one refused");
        assertEquals(SW_OK, writeAndSeal(c, good), "and then the card's own");
    }

    // =========================================================================
    // Who may write
    // =========================================================================

    @Test
    @DisplayName("A card that has had a PIN takes no certificate (6985), for good: the first SET_PIN marks it in its own transaction, and a reset leaves the mark")
    void aCardThatHasHadAPin() throws Exception {
        UnitsTest.Card c = fresh();
        assertEquals(0, c.field("hadPin")[0], "a new card");
        assertEquals(SW_OK, c.sw(writeCommand(0, new byte[] { 'C' })), "takes a write");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(1, c.field("hadPin")[0], "marked");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(writeCommand(0, new byte[] { 'C' })), "a write");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(sealCommand(10)), "a seal");
        // set up, owned, then reset: an empty card with no PIN, and the mark still there
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(SW_OK, c.sw(CashuAppletTest.setOwnerOpenCommand(CashuAppletTest.OWNER)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(0, c.field("pinState")[0], "no PIN now");
        assertEquals(1, c.field("hadPin")[0], "and the mark");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(writeCommand(0, new byte[] { 'C' })), "still refused after the reset");
        assertNotSealed(c, "and none was ever served");
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(
            java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8));
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("hadPin\\s*\\[[^\\]]*\\]\\s*=(?!=)").matcher(src);
        int writes = 0;
        while (m.find()) {
            writes++;
            int[] setPin = SchnorrHWMathTest.bodyRange(src, "private void processSetPin(");
            assertTrue(m.start() > setPin[0] && m.start() < setPin[1], "written in SET_PIN alone");
            String before = src.substring(setPin[0], m.start());
            assertTrue(before.lastIndexOf("JCSystem.beginTransaction()") > before.lastIndexOf("JCSystem.commitTransaction()"), "inside its transaction");
        }
        assertEquals(1, writes, "and once");
    }

    @Test
    @DisplayName("The order of CERT_WRITE's refusals: 6A86, then 6985 (sealed, or a PIN had), then 6A91 on an owned card, then 6A8D with anything unspent, then the length (the mark taken off by hand: a card has an owner or a piece only after a PIN)")
    void theOrderOfTheRefusals() throws Exception {
        UnitsTest.Card owned = UnitsTest.owned(UnitsTest.SAT);
        owned.put(-1, UnitsTest.SAT_A, 64);
        assertEquals(SW_INCORRECT_P1P2, owned.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 2, 0)), "6A86 first");
        assertEquals(SW_CONDITIONS_NOT_SATIS, owned.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0)), "then 6985");
        owned.field("hadPin")[0] = 0;
        assertEquals(SW_OWNER_PROOF, owned.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0)), "then 6A91");
        UnitsTest.Card holder = HolderTest.noOwner();
        holder.put(-1, UnitsTest.SAT_A, 64);
        holder.field("hadPin")[0] = 0;
        assertEquals(SW_CARD_IN_USE, holder.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0)), "then 6A8D");
        assertNull(holder.field("cert"), "and nothing reserved");
        UnitsTest.Card sealed = cardOf(cardScalar(0));
        assertEquals(SW_OK, writeAndSeal(sealed, form01(keyOf(cardScalar(0)), NOTHING, NOTHING, NOTHING)));
        assertEquals(SW_CONDITIONS_NOT_SATIS, sealed.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0)), "6985 sealed, before the length");
        UnitsTest.Card empty = fresh();
        assertEquals(SW_WRONG_LENGTH, empty.sw(new CommandAPDU(CLA, INS_CERT_WRITE, 0, 0, u16(2000))), "6700 before 6A83");
        assertEquals(SW_SLOT_OUT_OF_RANGE, empty.sw(writeCommand(2000, new byte[1])), "6A83 before the store");
        assertNull(empty.field("cert"), "nothing reserved for a write refused");
    }

    // =========================================================================
    // RESET_CARD
    // =========================================================================

    /** The card's own message for AUTH: SHA-256(T || T || reader || card's nonce || key), T = SHA-256("CashuCard/auth"). */
    static boolean authIsBy(UnitsTest.Card c, byte[] key) throws Exception {
        byte[] reader = new byte[16];
        Arrays.fill(reader, (byte) 0x5A);
        ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_AUTH, 0, 0, reader, 256));
        assertEquals(SW_OK, r.getSW());
        byte[] t = sha256("CashuCard/auth".getBytes(StandardCharsets.US_ASCII));
        byte[] msg = sha256(concat(t, t, reader, Arrays.copyOfRange(r.getData(), 0, 16), key));
        return schnorrVerify(extractPubkeyX(key), msg, Arrays.copyOfRange(r.getData(), 16, 80));
    }

    /** Set up and owned, a piece loaded and paid away; returns the piece. */
    static byte[] usedAndEmpty(UnitsTest.Card c) throws Exception {
        c.ready(UnitsTest.SAT, true);
        byte[] p = c.piece(UnitsTest.SAT_A, 64);
        ResponseAPDU r = c.load(p);
        assertEquals(SW_OK, r.getSW());
        c.tap();
        assertEquals(64, c.pay(r.getData()[0]).getData().length, "paid away");
        return p;
    }
    static void reset(UnitsTest.Card c) {
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
    }
    /** After a reset: a new holder's PIN and record, no owner. */
    static void setUpAgain(UnitsTest.Card c) {
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
    }
    static byte[] pinKeyW(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("pinPubKey");
        f.setAccessible(true);
        byte[] w = new byte[65];
        short n = ((javacard.security.ECPublicKey) f.get(c.applet())).getW(w, (short) 0);
        return Arrays.copyOf(w, n);
    }

    @Test
    @DisplayName("RESET_CARD of a certified card keeps GET_PUBKEY, CERT_READ and the paid list: AUTH is signed by the key the certificate names, a piece paid before the reset is refused after it (6A94); the PIN key is new, everything else goes")
    void aCertifiedCardKeepsItsKey() throws Exception {
        UnitsTest.Card c = cardOf(cardScalar(0));
        byte[] key = keyOf(cardScalar(0));
        byte[] container = signedForm01(key);
        assertEquals(SW_OK, writeAndSeal(c, container));
        byte[] p = usedAndEmpty(c);
        byte[] paid = c.field("paid").clone();
        plantPinKey(c);
        byte[] pinKey = pinKeyW(c);
        byte[] chainBefore = Arrays.copyOf(c.field("chain"), 32);
        reset(c);
        assertArrayEquals(key, cardKey(c), "GET_PUBKEY is the key it was");
        // keys per load (D197): a new c, so the next holder's keys are not the last's; a reader checks the certified P, then P + t*G
        assertFalse(Arrays.equals(chainBefore, Arrays.copyOf(c.field("chain"), 32)), "a new c, though the key stays");
        assertArrayEquals(container, readAll(c), "CERT_READ the certificate it was");
        assertArrayEquals(Arrays.copyOf(paid, CashuApplet.PAID_SIGS), Arrays.copyOf(c.field("paid"), CashuApplet.PAID_SIGS), "the paid list as it was, its next row and its round");
        assertArrayEquals(new byte[CashuApplet.RECEIPTS * CashuApplet.SIG_KEPT], Arrays.copyOfRange(c.field("paid"), CashuApplet.PAID_SIGS, CashuApplet.PAID_LEN),
            "the signatures kept beside the receipts go with the receipts");
        assertTrue(authIsBy(c, key), "AUTH under the certified key");
        assertEquals(0, c.field("pinKeySig")[0], "the signature over the old PIN key let go");
        assertEquals(0, c.field("ownerSet")[0], "no owner");
        assertEquals(0, c.field("pinState")[0], "no PIN");
        setUpAgain(c);
        DateKeys k = DateKeys.of(c.applet());
        ResponseAPDU g = c.send(new CommandAPDU(CLA, (byte) 0x1D, 0, 0, CashuAppletTest.u32(1_900_000_000L), 256));
        assertArrayEquals(DateKeys.comp(DateKeys.add(DateKeys.point(key), DateKeys.mul(new BigInteger(1, Arrays.copyOf(g.getData(), 32)), DateKeys.G))),
            Arrays.copyOfRange(g.getData(), 32, 65), "the key for a date is the certified key plus t*G, with the t the card answers (GROUP_KEYS, to the PIN)");
        assertArrayEquals(k.key(1_900_000_000L), Arrays.copyOfRange(g.getData(), 32, 65));
        assertEquals(SW_PIECE_ON_CARD, c.load(p).getSW(), "a piece the card signed for before the reset is not loaded after it");
        assertFalse(Arrays.equals(pinKey, pinKeyW(c)), "a new PIN key");
    }
    /** The PIN key given a scalar of the test's, so that a key drawn again is told from it (jCardSim draws the same one every time). */
    static void plantPinKey(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field fp = CashuApplet.class.getDeclaredField("pinPrivKey"), fw = CashuApplet.class.getDeclaredField("pinPubKey");
        fp.setAccessible(true);
        fw.setAccessible(true);
        BigInteger d = testKey("CashuCard/cert test PIN key");
        ((javacard.security.ECPrivateKey) fp.get(c.applet())).setS(unsigned32(d), (short) 0, (short) 32);
        BigInteger[] w = ecMulTest(d, SECP_GX, SECP_GY);
        ((javacard.security.ECPublicKey) fw.get(c.applet())).setW(concat(new byte[] { 4 }, unsigned32(w[0]), unsigned32(w[1])), (short) 0, (short) 65);
    }

    @Test
    @DisplayName("RESET_CARD of a card with no certificate sealed (none, or one written and never sealed) makes a new key and empties the paid list: the piece paid before it loads after it")
    void anUncertifiedCardTakesANewKey() throws Exception {
        for (boolean written : new boolean[] { false, true }) {
            UnitsTest.Card c = cardOf(cardScalar(0));
            byte[] key = keyOf(cardScalar(0));
            if (written) writeAll(c, signedForm01(key));
            byte[] p = usedAndEmpty(c);
            reset(c);
            assertFalse(Arrays.equals(key, cardKey(c)), (written ? "written, never sealed" : "none") + ": a new key");
            assertFalse(authIsBy(c, key), "and AUTH is not by the old one");
            assertArrayEquals(new byte[4], state(c), "no certificate");
            byte[] list = c.field("paid");
            assertEquals(0, list[CashuApplet.PAID_NEXT] | list[CashuApplet.PAID_NEXT + 1] | list[CashuApplet.PAID_ROUND], "the list emptied");
            setUpAgain(c);
            assertEquals(SW_OK, c.load(p).getSW(), "the piece paid under the old key loads");
        }
    }

    // =========================================================================
    // Vectors for NUT-CCP's certificate profile
    // =========================================================================

    static String hex(byte[] b) { return toHex(b); }
    static String apdus(List<CommandAPDU> cs) {
        StringBuilder s = new StringBuilder("[");
        for (int i = 0; i < cs.size(); i++) s.append(i == 0 ? "" : ", ").append('"').append(hex(cs.get(i).getBytes())).append('"');
        return s.append(']').toString();
    }

    @Test
    @DisplayName("The profile's vectors: a form 01 container and a form 02 container in a tree of four, each with a statement signed under bip340 by the published test issuer key, sealed by a card holding the key; the seals refused for another key, a path one bit off and a short container. Written to target/cert-vectors.json")
    void theVectors() throws Exception {
        StringBuilder j = new StringBuilder("{\n");
        byte[] issuerKey = extractPubkeyX(keyOf(ISSUER));
        j.append("  \"issuer_private_key\": \"").append(hex(unsigned32(ISSUER))).append("\",\n");
        j.append("  \"issuer_public_key\": \"").append(hex(issuerKey)).append("\",\n");
        j.append("  \"statement_tag\": \"CashuCard/cert/1\",\n  \"signature_aux\": \"").append(hex(new byte[32])).append("\",\n");

        // form 01
        byte[] key0 = keyOf(cardScalar(0));
        byte[] c01 = signedForm01(key0);
        String line01 = new String(Arrays.copyOfRange(c01, 45, 45 + (((c01[43] & 0xFF) << 8) | (c01[44] & 0xFF))), StandardCharsets.US_ASCII);
        byte[] sig01 = statementSig(ISSUER, line01);
        assertTrue(schnorrVerify(issuerKey, tagged("CashuCard/cert/1", line01.getBytes(StandardCharsets.US_ASCII)), sig01), "the statement's signature holds");
        UnitsTest.Card c = cardOf(cardScalar(0));
        assertEquals(SW_OK, writeAndSeal(c, c01));
        String read01 = hex(state(c));
        assertArrayEquals(c01, readAll(c));
        j.append("  \"form_01\": {\n    \"card_private_key\": \"").append(hex(unsigned32(cardScalar(0)))).append("\",\n");
        j.append("    \"card_key\": \"").append(hex(key0)).append("\",\n    \"statement\": \"").append(line01).append("\",\n");
        j.append("    \"signature\": \"").append(hex(sig01)).append("\",\n    \"container\": \"").append(hex(c01)).append("\",\n");
        j.append("    \"cert_write\": ").append(apdus(writes(c01))).append(",\n");
        j.append("    \"cert_seal\": \"").append(hex(sealCommand(c01, c01.length).getBytes())).append("\",\n");
        j.append("    \"cert_read_ff\": \"").append(read01).append("\"\n  },\n");

        // form 02, a tree of four
        byte[][][] four = fourCards();
        List<byte[][]> lv = tree(four[0]);
        byte[] top = top(lv);
        String line02 = batchLine(top, 4);
        byte[] sig02 = statementSig(ISSUER, line02);
        assertTrue(schnorrVerify(issuerKey, tagged("CashuCard/cert/1", line02.getBytes(StandardCharsets.US_ASCII)), sig02));
        j.append("  \"form_02\": {\n    \"leaf_tag\": \"CashuCard/cert-leaf/1\",\n    \"statement\": \"").append(line02).append("\",\n");
        j.append("    \"signature\": \"").append(hex(sig02)).append("\",\n    \"top\": \"").append(hex(top)).append("\",\n    \"cards\": [\n");
        for (int i = 0; i < 4; i++) {
            byte[] cont = form02(i, path(lv, i), top, line02.getBytes(StandardCharsets.US_ASCII), sig02, NOTHING);
            UnitsTest.Card d = fresh();
            plant(d, scalarOf(four[1][i]));
            assertEquals(SW_OK, writeAndSeal(d, cont), "card " + i);
            StringBuilder ps = new StringBuilder("[");
            for (byte[] n : path(lv, i)) ps.append(ps.length() == 1 ? "" : ", ").append('"').append(hex(n)).append('"');
            j.append("      { \"index\": ").append(i).append(", \"card_private_key\": \"").append(hex(unsigned32(scalarOf(four[1][i]))))
                .append("\", \"card_key\": \"").append(hex(four[1][i])).append("\", \"leaf\": \"").append(hex(four[0][i]))
                .append("\", \"path\": ").append(ps).append("], \"container\": \"").append(hex(cont)).append("\" }").append(i < 3 ? ",\n" : "\n");
        }
        j.append("    ]\n  },\n");

        // the seals a card refuses
        UnitsTest.Card r = cardOf(cardScalar(0));
        byte[] another = signedForm01(keyOf(cardScalar(1)));
        assertEquals(SW_WRONG_DATA, writeAndSeal(r, another));
        UnitsTest.Card r2 = fresh();
        plant(r2, scalarOf(four[1][0]));
        byte[][] off = path(lv, 0);
        off[1] = off[1].clone();
        off[1][31] ^= 1;
        byte[] offPath = form02(0, off, top, line02.getBytes(StandardCharsets.US_ASCII), sig02, NOTHING);
        assertEquals(SW_WRONG_DATA, writeAndSeal(r2, offPath));
        UnitsTest.Card r3 = cardOf(cardScalar(0));
        writeAll(r3, c01);
        assertEquals(SW_WRONG_DATA, r3.sw(sealCommand(c01, c01.length - 1)));
        j.append("  \"refused\": [\n");
        j.append("    { \"what\": \"form 01 naming another key, sealed by the form 01 card\", \"container\": \"").append(hex(another)).append("\", \"cert_seal\": \"").append(hex(sealCommand(another, another.length).getBytes())).append("\", \"sw\": \"6a80\" },\n");
        j.append("    { \"what\": \"form 02 of index 0 with the last bit of its second node turned, sealed by card 0 of the tree\", \"container\": \"").append(hex(offPath)).append("\", \"cert_seal\": \"").append(hex(sealCommand(offPath, offPath.length).getBytes())).append("\", \"sw\": \"6a80\" },\n");
        j.append("    { \"what\": \"the form 01 container sealed one byte short\", \"container\": \"").append(hex(c01)).append("\", \"cert_seal\": \"").append(hex(sealCommand(c01, c01.length - 1).getBytes())).append("\", \"sw\": \"6a80\" }\n");
        j.append("  ]\n}\n");

        java.nio.file.Path target = SchnorrHWMathTest.mainSourceDir().toAbsolutePath().normalize();
        while (target != null && !target.endsWith("applet")) target = target.getParent();
        assertNotNull(target);
        java.nio.file.Files.createDirectories(target.resolve("target"));
        java.nio.file.Files.write(target.resolve("target").resolve("cert-vectors.json"), j.toString().getBytes(StandardCharsets.UTF_8));
    }

    // =========================================================================
    // The source
    // =========================================================================

    @Test
    @DisplayName("The seal is one transaction of the length and its byte, after every check; the store is reserved only in CERT_WRITE, after the checks of length; RESET_CARD makes a new card key only where none is sealed")
    void theCertificateInTheSource() throws Exception {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(
            java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8));
        int[] w = SchnorrHWMathTest.bodyRange(src, "private void processCertWrite(");
        String body = src.substring(w[0], w[1]);
        int range = body.indexOf("ISOException.throwIt(SW_SLOT_OUT_OF_RANGE);");
        int reserve = body.indexOf("cert = new byte[CERT_LEN];");
        int lastCheck = body.indexOf("if (p != at) ISOException.throwIt(ISO7816.SW_WRONG_DATA);");
        int begin = body.indexOf("JCSystem.beginTransaction();");
        int length = body.indexOf("Util.setShort(cert, CERT_LENGTH, at);");
        int seal = body.indexOf("cert[CERT_SEALED] = (byte) 1;");
        int commit = body.indexOf("JCSystem.commitTransaction();");
        assertTrue(range > 0 && range < reserve && reserve < lastCheck && lastCheck < begin && begin < length && length < seal && seal < commit,
            "the checks of length, the store, the checks of the container, then the length and the seal in one transaction");
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?<![\\w.])cert\\s*=(?!=)|\\bcert\\s*\\[[^\\]]*\\]\\s*=(?!=)|,\\s*cert\\s*,|Util\\.setShort\\s*\\(\\s*cert\\b").matcher(src);
        int named = 0;
        while (m.find()) {
            named++;
            assertTrue(m.start() > w[0] && m.start() < w[1], "the store is written in CERT_WRITE alone, near ..." + src.substring(Math.max(0, m.start() - 40), m.start() + 20));
        }
        assertEquals(5, named, "the allocation, its null, a page, the length and the seal, and nothing else");
        int[] reset = SchnorrHWMathTest.bodyRange(src, "private void processResetCard(");
        String r = src.substring(reset[0], reset[1]);
        assertTrue(r.contains("boolean certified = certSealed();") && r.contains("if (!certified) cardKeyPair.genKeyPair();")
            && r.indexOf("pinKeyPair.genKeyPair();") > r.indexOf("if (!certified) cardKeyPair.genKeyPair();"), "a new PIN key always, a new card key only where none is sealed");
    }
}
