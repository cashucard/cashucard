package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_CHANGE;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_INFO;
import static me.flashapp.cashu.CashuAppletTest.INS_LOCK_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_SIGN;
import static me.flashapp.cashu.CashuAppletTest.L_LOCK;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.MINT_K;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_INCORRECT_P1P2;
import static me.flashapp.cashu.CashuAppletTest.SW_NO_PIN;
import static me.flashapp.cashu.CashuAppletTest.SW_NO_SPACE;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_EMPTY;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_OUT_OF_RANGE;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.changeCommand;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.keyOf;
import static me.flashapp.cashu.CashuAppletTest.loadChangeCommand;
import static me.flashapp.cashu.CashuAppletTest.mintAnswer;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.sha256;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
 * Keyset keys (2.3, D190): KEYSET_KEYS (38) teaches the card a keyset's keys, held to the keyset's ID as NUT-02 makes it
 * (version 00 and 01), and keeps the top of a hash tree of them; P1 = 3 shows that an opening's key is one of them by its
 * path; LOAD_CHANGE writes nothing under a key not shown (6A9F); and a holder binds an opening a reader bound to a key that
 * is not the mint's to the mint's key. The tree is worked out here on its own, with the JDK's SHA-256, and not by any code
 * of the card's.
 */
class KeysetKeysTest {

    static final int INS_KEYSET_KEYS = 0x38;
    static final int SW_KEYS_NOT_SHOWN = 0x6A9F;
    static final int SAT = UnitsTest.SAT;
    /** A key a till made up, and its private key: not the mint's. */
    static final BigInteger TILL = new BigInteger("7a11", 16);

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    // =========================================================================
    // The keysets of the CI's mints: Nutshell 0.20.3 with MINT_PRIVATE_KEY=TEST_PRIVATE_KEY (.github/workflows/ci.yml).
    // A fresh mint makes a version 01 keyset (input_fee_ppk 100); the one first made by 0.19.2 and served by 0.20.3 is the
    // version 00 keyset of the same 64 keys. Recorded from GET /v1/keys and /v1/keysets of both, 2026-11-12.
    // =========================================================================

    static final String CI_V01_ID = "01884a74bb2fc5ee6e5f958f89f9e4e6cf79241fbc9fd1012d6811b054a78beffe";
    static final String CI_V01_TAIL = "|unit:sat|input_fee_ppk:100";
    static final String CI_V00_ID = "009a1f293253e41e";
    /** The keys for 2^0 to 2^63, in order. */
    static final String[] CI_KEYS = {
        "02194603ffa36356f4a56b7df9371fc3192472351453ec7398b8da8117e7c3e104", "03b0f36d6d47ce14df8a7be9137712c42bcdd960b19dd02f1d4a9703b1f31d7513",
        "0366be6e026e42852498efb82014ca91e89da2e7a5bd3761bdad699fa2aec9fe09", "0253de5237f189606f29d8a690ea719f74d65f617bb1cb6fbea34f2bc4f930016d",
        "0217ff15bc0e183ae1745911bd84c761945a446fa27284eeb4a18220abc3a39eae", "03c65d28721a9fe81e91e596fe1ab667e5ca0f8a9872d5376e34fd4f29501910a9",
        "02cedd62d7518736ff0c172fdfc3079845affc13eed9427cb81988e6f184ca5530", "03c03e0922d1efec034c06074553f87453322cb36a6d789e61cfd8786961d7b5bc",
        "0296d2894191b73993621848544053d47df0b43e7a34b8bfd12f2deb5258cebe57", "03405f14f5c507eedba8658ab6b79179a31722c4226680ba03c6508fef2d0cad46",
        "031c6cc53a5a19fdf6bcd311871209a1645afb9ff52ae00128e46d75073b42a376", "03a5e61e7aa6b0d6c314d577ec44d58a5f7e4149f762b05cdba519949b957adae6",
        "027e0d8bab3525843d3b7d6193ae88d211d505e097bf8810b1fa6a205f912efccf", "022c0f3a5274acc129ad567f64542e01e538818689bdc21f4bbaf88be729295771",
        "03ef1e94c645e56fa09f9cc9bc07469077c209552a0ce4dbdb4bf44981a7b9fa85", "0208b013c5a52987dd0323aef4cf0d48c941a4a9d2d76bb974cc59e4b41d26d47b",
        "02f881a2534ca06d0da485b4be5050883022235ea89e6ea81f43115ed6cdefb190", "03154dab4b35831536dd85d9bdf892c9839bf6958617619b31f4ca5748bf0dbf2a",
        "02edaaee84d297212ad0819ec923c40e958c208bd96d2abf76e4004455cfd4e365", "030a08fc4c9f4ca0125c73b62d036845e43f7bcffe38cb5f09cfe35a8e59e135e6",
        "030288d91b21db418027f2902b39fd1712c5afd22b9a734f6021dc6829363dc7e9", "0231a3cd012a916db6ee899dfcc0f31da6dacc4c3497b74dd937e0b85a72081913",
        "03467db9a45f138bcb7a762d64cd6029cbdf4ed740b1851831ce380efe3bef913c", "0234104b610749c0276105c84da30c2ff82d831768a7edc2c4131b02ebc3eb3ae2",
        "02599c06e1f52f16eb7593886c56a43bc53a5451a728cdf246c188720d1d138173", "035d7ecd096a6a703e052de84133fac77c1c33c8b37e72ccc3d8a9d770a163da5d",
        "028c06896499c7b16719ae249f7e826cdabfb77cbc9ccc80c668830b1071f9f5f6", "02c8ac5f30cf34e011bac12414d6fce384f5cf2cbd0aa6b21340f68c119c835241",
        "0258094c7f26006eaaf00fc1fcb9950e591c578d2900108fa46e6b4961285fe914", "03be658104ed6f3c3109e4ca33ce5e3d63e6f537a70d47084e83097f0906e50b32",
        "03de09651ec6ca86e505c8e800fdd3fcea5c80246702189f2457678273e8cea462", "020f2ed905d971c57893c5ca8af869de33987f11e14d8eedc475f33cc9b6387b9f",
        "03d9b0de71d3618d746c5366839da7a2f84b6c75d59849f54a19b076eb1b9c54ef", "036097d00a195fdd2899d1687c414b39f21bd7c112bddb9239c4f0d9af4ff27ab7",
        "03d8ffa01c9e4e4802b0899a2694612dafd6390b24f19a8bd19fc2abae5679f9cf", "031b8a21a0acd754137b2c6d780693b1ef4528da02a8a29d4bae04c20df69084f5",
        "026c81e4498ec4693f4030c40bb8d48db38a436d6a3aa0ea1263f92f3a40f9239a", "03a95f4b5736d6fba5678ae67716f874be26ae2c10044d84204f6e51e41aef97dd",
        "025792fc31361ca5202a1d1313512eee9ce83c86356fa5f7b9642d5416c53f2571", "03555f71d7e951e6b9c3113afe1f228855331db24b9805fc274b1b5e5d9e8d0f7c",
        "029b1b433c98ed693d07f53157093386c7a63d54d752a4da00fc252b84afdb89e7", "03b03bd1f346ebc1c84b315f0cd7c9ae7bb577617a447b085d5f896419f6214651",
        "0248a3f5162755d65a79b2fa35e51aa50d51b00040c127b12badaf97d3de12ef04", "02bf233b579a6b402886b706ff2fef5deed2bf53b3bd370844091f4b1cdaf688dc",
        "03c1eb5422c58b8e3522355c3cc470ccb6b0add8e4b0d5aadd0412dadbaddb0096", "026c9450a3afae0103766d7767193ac5a49669cbc85bdbefab04b9fa182e42d911",
        "034688f63ed273e524f08a155ac00c54c5f85d941e45394695e7c345cc00bcfaa4", "0331df7f9c1876cf57db9f0a29b5c50c6c2cff20fef5d8b4c17158332bb10e72fd",
        "0230dd1dba84778a2302b0c50db29e9c4846bbad96a7c847d92ce084bffb45305e", "02fd0386d1998cd76e45fc17d07ffe82015ad918f5d8e516406956e78fe38e3511",
        "03d3fbf9c2dc0ca0fa5bfc5ccad526a1305331b4a14637cc2ebe64d324a3fedc9e", "03d2e21a411422f04acf9fd7ce307f410d6642714232103f52e61edef99172188f",
        "022163656cb4a2369d3a7b1fab1599fef924150c3030ffed3fbc40fec6f984613a", "03d25547594eeaa261ed48ebd6794389706c6c47cccd167c44a322721f0d07b509",
        "027ed195fe4f4565d4cbcc8755de0aa6ccd5878efa13da9607191ac854c806390f", "0231d6bfb9f2414c5992e96615904beaa5af844d2214e9e14d24202059639ee0df",
        "03860470440f4f5a2488ee64bacd4e4a9eb0d50d2a1d6215167acb247025b566bb", "031055a11ecc825257788f065c247da1a84493c1438aa95c6f2a1dffc886eccd1a",
        "03bb3f9f774a1f2651a2cbe9f21954c637aec565807a61f5551d9109a7d1d17b6f", "032701bb051cfa46676da504c6967b5b7d3a70eb6499a9feaa71ffe629b0edac9a",
        "0342f67cf3e82cde49ced155b7117f8d583ae8766bce4fd7aa170179ee43a0608e", "0366c51883c60f37f3a74d05e725791efd98773eb143a98aa8808915b0ffe23c6d",
        "020d25d8c67e59395983569cf5a7b86f13cccf95a7b4d374bc40ffac04c6437b86", "023c84c0895cc0e827b348ea0a62951ca489a5e436f3ea7545f3c1d5f1bea1c866",
    };

    // =========================================================================
    // A keyset, as NUT-02 makes its ID, and the card's tree of its keys
    // =========================================================================

    static final class Keyset {
        final long[] amounts;
        final byte[][] keys;
        final BigInteger[] priv;   // null for the CI's keysets, whose private keys these tests do not have
        final int version;
        final String tail;
        final String id;           // the whole ID in hex: 16 characters for version 00, 66 for 01

        /** The tests' own mint's keyset of `amounts`, a private key each, and its ID. */
        Keyset(int version, long[] amounts, long salt, String tail) {
            this.version = version;
            this.amounts = amounts;
            this.tail = tail;
            priv = new BigInteger[amounts.length];
            keys = new byte[amounts.length][];
            for (int i = 0; i < amounts.length; i++) {
                priv[i] = MINT_K.add(BigInteger.valueOf(salt * 1000 + i + 1));
                keys[i] = keyOf(priv[i]);
            }
            id = idOf(version, amounts, keys, tail);
        }
        /** A keyset whose keys are given (the CI's). */
        Keyset(int version, String tail, String[] hexKeys) {
            this.version = version;
            this.tail = tail;
            amounts = new long[hexKeys.length];
            keys = new byte[hexKeys.length][];
            for (int i = 0; i < hexKeys.length; i++) {
                amounts[i] = 1L << i;
                keys[i] = hexToBytes(hexKeys[i]);
            }
            priv = null;
            id = idOf(version, amounts, keys, tail);
        }
        /** The eight bytes a piece holds. */
        String id8() { return id.substring(0, 16); }
        int indexOf(long amount) {
            for (int i = 0; i < amounts.length; i++) if (amounts[i] == amount) return i;
            throw new IllegalArgumentException("no key for " + amount);
        }
        byte[] keyFor(long amount) { return keys[indexOf(amount)].clone(); }
        BigInteger privFor(long amount) { return priv[indexOf(amount)]; }
        /** KEYSET_KEYS P1 = 1's form of key i: the amount (8) and K (33). */
        byte[] wire(int i) { return concat(u64(amounts[i]), keys[i]); }
        byte[][] leaves() {
            byte[][] l = new byte[keys.length][];
            for (int i = 0; i < keys.length; i++) l[i] = leaf(amounts[i], keys[i]);
            return l;
        }
    }

    /** Amounts 2^0 to 2^(n - 1). */
    static long[] powers(int n) {
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = 1L << i;
        return a;
    }

    /** NUT-02's ID: version 00, 00 || SHA-256(the keys end to end)[0..7); version 01, 01 || SHA-256("a:k,a:k,..." || tail). */
    static String idOf(int version, long[] amounts, byte[][] keys, String tail) {
        if (version == 0) return "00" + toHex(sha256(concat(keys))).substring(0, 14);
        StringBuilder t = new StringBuilder();
        for (int i = 0; i < keys.length; i++) {
            if (i > 0) t.append(',');
            t.append(Long.toUnsignedString(amounts[i])).append(':').append(toHex(keys[i]));
        }
        return "01" + toHex(sha256(t.append(tail).toString().getBytes(StandardCharsets.UTF_8)));
    }

    static byte[] u64(long v) {
        byte[] b = new byte[8];
        for (int i = 0; i < 8; i++) b[i] = (byte) (v >>> (56 - 8 * i));
        return b;
    }
    static byte[] leaf(long amount, byte[] key) { return sha256(concat(new byte[] { 0 }, u64(amount), key)); }
    static byte[] node(byte[] l, byte[] r) { return sha256(concat(new byte[] { 1 }, l, r)); }
    static final byte[] PAD = sha256(new byte[] { 2 });

    /** The tree's levels, leaves first, padded to the next power of two with PAD. */
    static List<byte[][]> levels(byte[][] leaves) {
        int size = 1;
        while (size < leaves.length) size *= 2;
        byte[][] level = new byte[size][];
        for (int i = 0; i < size; i++) level[i] = i < leaves.length ? leaves[i] : PAD;
        List<byte[][]> out = new ArrayList<>();
        out.add(level);
        while (level.length > 1) {
            byte[][] up = new byte[level.length / 2][];
            for (int i = 0; i < up.length; i++) up[i] = node(level[2 * i], level[2 * i + 1]);
            out.add(level = up);
        }
        return out;
    }
    static byte[] top(Keyset ks) { List<byte[][]> l = levels(ks.leaves()); return l.get(l.size() - 1)[0]; }
    static int depth(Keyset ks) { return levels(ks.leaves()).size() - 1; }
    /** The path of leaf `index`: its sibling, then each node's sibling up to the top. */
    static byte[] path(Keyset ks, int index) {
        List<byte[][]> l = levels(ks.leaves());
        byte[] p = new byte[0];
        for (int h = 0; h + 1 < l.size(); h++) p = concat(p, l.get(h)[(index >> h) ^ 1]);
        return p;
    }

    // =========================================================================
    // What a phone sends
    // =========================================================================

    static ResponseAPDU begin(UnitsTest.Card c, String id8, String tail) {
        return c.send(new CommandAPDU(CLA, INS_KEYSET_KEYS, 0, 0, concat(hexToBytes(id8), tail.getBytes(StandardCharsets.UTF_8))));
    }
    static int keys(UnitsTest.Card c, byte[]... wires) { return c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 1, 0, concat(wires))); }
    static ResponseAPDU finish(UnitsTest.Card c) { return c.send(new CommandAPDU(CLA, INS_KEYSET_KEYS, 2, 0, 256)); }

    /** The whole teaching, six keys a command, as a phone sends it: the first refusal, or the end's answer. */
    static ResponseAPDU teach(UnitsTest.Card c, String id8, String tail, byte[][] wires) {
        ResponseAPDU r = begin(c, id8, tail);
        if (r.getSW() != SW_OK) return r;
        for (int at = 0; at < wires.length; at += 6) {
            int w = keys(c, Arrays.copyOfRange(wires, at, Math.min(wires.length, at + 6)));
            if (w != SW_OK) return new ResponseAPDU(new byte[] { (byte) (w >> 8), (byte) w });
        }
        return finish(c);
    }
    static byte[][] wires(Keyset ks) {
        byte[][] w = new byte[ks.keys.length][];
        for (int i = 0; i < w.length; i++) w[i] = ks.wire(i);
        return w;
    }
    static ResponseAPDU teach(UnitsTest.Card c, Keyset ks) { return teach(c, ks.id8(), ks.tail, wires(ks)); }
    static void taught(UnitsTest.Card c, Keyset ks) {
        ResponseAPDU r = teach(c, ks);
        assertEquals(SW_OK, r.getSW(), "the keys of " + ks.id8() + " taught");
        assertEquals(ks.id, toHex(r.getData()), "and the ID worked out answered");
    }

    /** KEYSET_KEYS P1 = 3: opening, index, depth, path, and another key where one is given. */
    static int show(UnitsTest.Card c, int opening, int index, int depth, byte[] path, byte[] other) {
        byte[] d = concat(new byte[] { (byte) opening, (byte) index, (byte) depth }, path, other == null ? new byte[0] : other);
        return c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 3, 0, d));
    }
    /** The opening's key shown as a phone shows it: the leaf of its amount in its keyset, and the path. */
    static int show(UnitsTest.Card c, int opening, Keyset ks, long amount) {
        int i = ks.indexOf(amount);
        return show(c, opening, i, depth(ks), path(ks, i), null);
    }
    /** The same, binding the opening to the keyset's key for `amount`. */
    static int rebind(UnitsTest.Card c, int opening, Keyset ks, long amount) {
        int i = ks.indexOf(amount);
        return show(c, opening, i, depth(ks), path(ks, i), ks.keyFor(amount));
    }

    /** A payment of the piece at `place` with change of `amount` bound to `key`, in `keyset` (null: the piece's own): the opening's GET_CHANGE row. */
    static byte[] payWithChange(UnitsTest.Card c, int place, long amount, byte[] key, String keyset) {
        byte[] named = keyset == null ? Arrays.copyOfRange(c.slot(place), 1, 9) : hexToBytes(keyset);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, c.send(changeCommand(amount, key, named)).getSW(), "the change");
        assertEquals(64, c.sign().getData().length, "signed");
        return lastRow(c);
    }
    /** The last opening GET_CHANGE lists on its first page. */
    static byte[] lastRow(UnitsTest.Card c) {
        byte[] d = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData();
        int n = d[0] & 0xFF;
        assertTrue(n > 0, "an opening owed");
        return Arrays.copyOfRange(d, 1 + 83 * (n - 1), 1 + 83 * n);
    }
    /** The mint's answer for the opening `row` names, signed with `k`. */
    static ResponseAPDU loadChange(UnitsTest.Card c, byte[] row, BigInteger k) {
        return c.send(loadChangeCommand(row[0], mintAnswer(k, Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77))));
    }
    static boolean shown(UnitsTest.Card c, int opening) throws Exception {
        return c.field("openKeys")[opening * CashuApplet.OPEN_KEYS_ROW + CashuApplet.OPEN_KEYS_SHOWN] == 1;
    }
    static byte[] topKept(UnitsTest.Card c, String id8) throws Exception {
        int e = c.entryOf(id8);
        return Arrays.copyOfRange(c.book(), e * UnitsTest.ENTRY + 9, e * UnitsTest.ENTRY + 41);
    }
    static boolean keysKnown(UnitsTest.Card c, String id8) throws Exception { return (c.stateOf(id8) & 0x02) != 0; }
    static void lock(UnitsTest.Card c) {
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(c.proofFor(L_LOCK, new byte[0]), new byte[0]))));
    }

    static final Keyset A = new Keyset(0, powers(32), 1, "");
    static final Keyset B = new Keyset(0, powers(32), 2, "");
    static final Keyset V1 = new Keyset(1, powers(64), 3, "|unit:sat|input_fee_ppk:100");
    /** Amounts that are not powers of two, seven keys (a tree of eight, one leaf padded), version 01. */
    static final Keyset ODD = new Keyset(1, new long[] { 1, 2, 5, 10, 20, 50, 100 }, 4, "|unit:sat");
    static final Keyset THREE = new Keyset(0, powers(3), 5, "");
    static final Keyset ONE = new Keyset(0, powers(1), 6, "");
    static final Keyset CI_V01 = new Keyset(1, CI_V01_TAIL, CI_KEYS);
    static final Keyset CI_V00 = new Keyset(0, "", CI_KEYS);

    /** A card set up with an owner, the owner's grant in this tap (the holder's say: as many keysets as the table holds) and the PIN. */
    static UnitsTest.Card card() {
        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, true);
        c.grant();
        return c;
    }

    // =========================================================================
    // Teaching: the keys held to the ID
    // =========================================================================

    @Test
    @DisplayName("The CI's mints' keysets are taught as NUT-02 makes their IDs: the version 01 keyset with its fee in the tail answers its 33-byte ID, the version 00 keyset of the same 64 keys its 8-byte ID; each entry keeps the top of the tree of its keys and says the keys are known (state bit 1, GET_CARD P1 = 2)")
    void theCiMintsKeysetsAreTaught() throws Exception {
        assertEquals(CI_V01_ID, CI_V01.id, "the test's NUT-02 makes the version 01 ID the mint serves");
        assertEquals(CI_V00_ID, CI_V00.id, "and the version 00 one");
        UnitsTest.Card c = card();
        c.put(-1, CI_V01.id8(), 1);
        c.put(-1, CI_V00.id8(), 2);
        assertFalse(keysKnown(c, CI_V01.id8()));
        ResponseAPDU r = teach(c, CI_V01);
        assertEquals(SW_OK, r.getSW());
        assertEquals(CI_V01_ID, toHex(r.getData()), "the whole ID, 33 bytes");
        r = teach(c, CI_V00);
        assertEquals(SW_OK, r.getSW());
        assertEquals(CI_V00_ID, toHex(r.getData()), "eight bytes");
        assertTrue(keysKnown(c, CI_V01.id8()) && keysKnown(c, CI_V00.id8()), "both keysets' keys known");
        assertArrayEquals(top(CI_V01), topKept(c, CI_V01.id8()), "the top of the tree of the 64 keys");
        assertArrayEquals(top(CI_V00), topKept(c, CI_V00.id8()), "the same keys, the same top");
        byte[] table = c.getCard(2);
        assertEquals(2, table[0]);
        for (int i = 0; i < 2; i++) assertEquals(0x02, table[1 + 9 * i + 8] & 0x02, "GET_CARD P1 = 2 says the keys are known");
        // the 64 keys under the other version's ID are not its keys
        assertEquals(SW_WRONG_DATA, teach(c, CI_V01.id8(), "", wires(CI_V00)).getSW(), "the version 01 ID with no tail");
        assertEquals(SW_WRONG_DATA, teach(c, CI_V01.id8(), "|unit:sat", wires(CI_V01)).getSW(), "the version 01 ID without its fee");
        assertTrue(keysKnown(c, CI_V01.id8()), "a teaching refused takes nothing away");
    }

    @Test
    @DisplayName("Keys that do not hash to the keyset's ID are never kept: one key off, the tail off, a key left out (6A80 at the end); keys out of order, an amount twice or of 0, a 65th key (6A80 at the key, the teaching given up: 6985 at the end); a keyset of version 00 with a tail, another length (6700); an ID version not 00 or 01 (6A80); a keyset in no entry (6A88); another P1 (6A86); nothing kept")
    void keysThatDoNotHashToTheIdAreNeverKept() throws Exception {
        UnitsTest.Card c = card();
        c.put(-1, A.id8(), 64);
        c.put(-1, V1.id8(), 64);
        byte[][] w = wires(A);
        byte[][] off = w.clone();
        off[5] = concat(u64(32), keyOf(TILL));
        assertEquals(SW_WRONG_DATA, teach(c, A.id8(), "", off).getSW(), "one key that is not the mint's");
        assertEquals(SW_WRONG_DATA, teach(c, A.id8(), "", Arrays.copyOf(w, 31)).getSW(), "the last key left out");
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), "|unit:sat|input_fee_ppk:10", wires(V1)).getSW(), "a tail that is not the mint's");
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), V1.tail + " ", wires(V1)).getSW(), "a byte more in the tail");
        byte[][] swapped = w.clone();
        swapped[3] = w[4];
        swapped[4] = w[3];
        assertEquals(SW_WRONG_DATA, teach(c, A.id8(), "", swapped).getSW(), "keys out of order");
        assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW(), "the teaching was given up at the key");
        byte[][] twice = w.clone();
        twice[4] = concat(u64(8), A.keys[4]);
        assertEquals(SW_WRONG_DATA, teach(c, A.id8(), "", twice).getSW(), "an amount twice");
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_OK, keys(c, w[0], w[1], w[2], w[3]));
        assertEquals(SW_WRONG_DATA, keys(c, twice[4]), "refused at the key: 8 after 8");
        assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW());
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_WRONG_DATA, keys(c, concat(u64(0), A.keys[0])), "an amount of 0");
        byte[][] more = concat2(wires(V1), new byte[][] { concat(u64(Long.MIN_VALUE + 1), A.keys[0]) });
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), V1.tail, more).getSW(), "a 65th key, its amount above 2^63");
        assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW());
        assertEquals(SW_WRONG_LENGTH, begin(c, A.id8(), "|unit:sat").getSW(), "a tail after an ID of version 00");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 0, 0, hexToBytes(A.id8()).clone(), 0, 7)), "seven bytes");
        assertEquals(SW_WRONG_LENGTH, begin(c, V1.id8(), new String(new char[65]).replace('\0', 'x')).getSW(), "a tail of 65 bytes");
        assertEquals(SW_OK, begin(c, V1.id8(), "|unit:sat|" + new String(new char[54]).replace('\0', 'x')).getSW(), "64 is the most");
        assertEquals(SW_SLOT_EMPTY, begin(c, B.id8(), "").getSW(), "a keyset in no entry");
        c.put(-1, "02aa000000000001", 1);
        assertEquals(SW_WRONG_DATA, begin(c, "02aa000000000001", "").getSW(), "an ID version the card cannot hash");
        // lengths of the keys and the end
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_WRONG_LENGTH, keys(c, Arrays.copyOf(w[0], 40)), "40 bytes");
        assertEquals(SW_CONDITIONS_NOT_SATIS, keys(c, w[0]), "given up");
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_WRONG_LENGTH, keys(c, Arrays.copyOfRange(w, 0, 7)), "seven keys in one command");
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 1, 0)), "no keys");
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_WRONG_DATA, finish(c).getSW(), "an end with no keys");
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_OK, keys(c, w[0]));
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 2, 0, new byte[1])), "an end with data");
        assertEquals(SW_CONDITIONS_NOT_SATIS, keys(c, w[1]), "and the teaching is over");
        for (int p1 : new int[] { 4, 0x80, 0xFF }) assertEquals(SW_INCORRECT_P1P2, c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, p1, 0, 256)), "P1 " + p1);
        assertFalse(keysKnown(c, A.id8()) || keysKnown(c, V1.id8()), "nothing kept");
        assertArrayEquals(new byte[32], topKept(c, A.id8()));
        taught(c, A);
        taught(c, V1);
    }

    @Test
    @DisplayName("The bounds of a teaching: 65 keys whose ID is theirs are refused at the 65th (6A80), and the 64 before it are kept for nothing; a keyset whose eighth byte alone is not the ID's is refused at the end (6A80); KEYSET_KEYS P1 = 1 sent in a payment gives the payment up as well (6985)")
    void theBoundsOfATeaching() throws Exception {
        long[] a = new long[65];
        for (int i = 0; i < 64; i++) a[i] = 1L << i;
        a[64] = Long.MIN_VALUE + 1;
        Keyset wide = new Keyset(0, a, 7, "");
        UnitsTest.Card c = card();
        c.put(-1, wide.id8(), 64);
        assertEquals(SW_OK, begin(c, wide.id8(), "").getSW());
        byte[][] w = wires(wide);
        for (int at = 0; at < 60; at += 6) assertEquals(SW_OK, keys(c, Arrays.copyOfRange(w, at, at + 6)));
        assertEquals(SW_OK, keys(c, Arrays.copyOfRange(w, 60, 64)), "64 keys");
        assertEquals(SW_WRONG_DATA, keys(c, w[64]), "the 65th, its ID its keys'");
        assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW());
        assertFalse(keysKnown(c, wide.id8()));
        // the eighth byte
        byte[] near = hexToBytes(A.id8());
        near[7] ^= 1;
        String nearId = toHex(near);
        c.put(-1, nearId, 64);
        assertEquals(SW_WRONG_DATA, teach(c, nearId, "", wires(A)).getSW(), "A's keys, under an ID one bit off in its last byte");
        assertFalse(keysKnown(c, nearId));
        // a payment begun is given up by any step of a teaching, one that is refused among them
        int place = c.put(-1, A.id8(), 64);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_CONDITIONS_NOT_SATIS, keys(c, A.wire(0)), "no teaching begun");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sign().getSW(), "and the payment was given up");
    }

    @Test
    @DisplayName("An opening's mark goes with it: once its piece is back and it is let go, the next change made in its place is not shown, and a key made up for it is not loaded (6A9F)")
    void anOpeningsMarkGoesWithIt() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 8));
        ResponseAPDU back = loadChange(c, row, A.privFor(8));
        assertEquals(SW_OK, back.getSW());
        c.tap();
        byte[] again = payWithChange(c, back.getData()[0], 4, keyOf(TILL), null);
        assertEquals(row[0], again[0], "the same opening, made again");
        assertFalse(shown(c, again[0]));
        c.power();
        assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, again, TILL).getSW(), "the till's answer is not written");
    }

    @Test
    @DisplayName("D23 (D190): binding to another key writes the key, the opening's keyset and the mark in one transaction, so that torn it is bound as it was or as it is now; teaching keeps the top and its bit in one transaction (read from the source: a simulator cannot pull a card away)")
    void theMarkIsWrittenLast() throws Exception {
        String code = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8)).replaceAll("\\s+", " ");
        int from = code.indexOf("private void showKey("), to = code.indexOf("private void pointText(");
        String show = code.substring(from, to);
        int begun = show.indexOf("JCSystem.beginTransaction();");
        int key = show.indexOf("Util.arrayCopy(buf, given, openKeys, (short)(row + OPEN_KEYS_K), (short) 33);");
        int keyset = show.indexOf("Util.arrayCopy(book, (short)(e * ENTRY_LEN), changeOpen, kAt, (short) 8);");
        int on = show.indexOf("openKeys[(short)(row + OPEN_KEYS_SHOWN)] = (byte) 1;");
        int done = show.indexOf("JCSystem.commitTransaction();");
        assertTrue(begun > 0 && key > begun && keyset > key && on > keyset && done > on, "the key, the keyset and the mark, in one transaction");
        assertFalse(show.contains("NonAtomic(buf, given, openKeys") || show.contains("OPEN_KEYS_SHOWN)] = (byte) 0;"), "no half-written key, and no mark taken off by itself");
        String teach = code.substring(code.indexOf("private void processKeysetKeys("), code.indexOf("private void dropTeaching("));
        int begin = teach.indexOf("JCSystem.beginTransaction();");
        assertTrue(begin > 0 && begin < teach.indexOf("Util.arrayCopy(nodeArr(h), nodeOff(h), book,") && teach.indexOf("book[(short)(at + ENTRY_STATE)] |= ENTRY_KEYS;") < teach.indexOf("JCSystem.commitTransaction();"),
            "the top and its bit in one transaction");
    }

    static byte[][] concat2(byte[][] a, byte[][] b) {
        byte[][] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    @Test
    @DisplayName("Who teaches: the PIN given in this tap and nothing else, not the owner's grant alone; a reader without it cannot (6982, before 6985), a card with no PIN answers 6A97 to every P1; a locked card is taught; anything between the steps gives the teaching up (6985 at the next), a SELECT, a read, a payment's command and a show among them, and a new beginning starts again; KEYSET_KEYS gives a payment begun up")
    void whoTeaches() throws Exception {
        UnitsTest.Card blank = new UnitsTest.Card();
        for (int p1 = 0; p1 < 4; p1++) assertEquals(SW_NO_PIN, blank.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, p1, 0, new byte[8])), "no PIN, P1 " + p1);
        assertEquals(SW_NO_PIN, blank.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 9, 0, 256)), "before the P1 is looked at");

        UnitsTest.Card c = new UnitsTest.Card().ready(SAT, true);
        c.put(-1, A.id8(), 64);
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, begin(c, A.id8(), "").getSW(), "no PIN given, no grant");
        assertEquals(SW_SECURITY_NOT_SATIS, keys(c, A.wire(0)), "and at the keys");
        assertEquals(SW_SECURITY_NOT_SATIS, finish(c).getSW(), "and at the end");
        c.grant();
        assertEquals(SW_SECURITY_NOT_SATIS, begin(c, A.id8(), "").getSW(), "the owner's grant alone teaches nothing: a keyset taught is a key the card writes change under");
        c.power();
        c.pin();
        taught(c, A);

        // a card with no owner: the PIN (its keyset entered by hand: a card with no owner takes no load until its held tap, D189)
        UnitsTest.Card open = new UnitsTest.Card().ready(SAT, false);
        byte[] book = open.book();
        System.arraycopy(hexToBytes(B.id8()), 0, book, 0, 8);
        book[8] = 0x40;
        open.power();
        assertEquals(SW_SECURITY_NOT_SATIS, begin(open, B.id8(), "").getSW());
        open.pin();
        taught(open, B);

        // anything between the steps gives the teaching up
        CommandAPDU[] between = {
            new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256),
            new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64),
            new CommandAPDU(CLA, INS_KEYSET_KEYS, 3, 0, new byte[3]),
            new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(CashuAppletTest.AID_STR)) };
        for (CommandAPDU x : between) {
            assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
            assertEquals(SW_OK, keys(c, A.wire(0)));
            c.send(x);
            if (x.getINS() == 0xA4) c.pin();
            assertEquals(SW_CONDITIONS_NOT_SATIS, keys(c, A.wire(1)), String.format("given up by %02X", x.getINS()));
            assertEquals(SW_CONDITIONS_NOT_SATIS, finish(c).getSW());
        }
        // a new beginning starts again: the keys sent before it are not in the hash
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_OK, keys(c, A.wire(0), A.wire(1)));
        taught(c, A);
        // KEYSET_KEYS gives a payment begun up
        c.tap();
        int place = c.put(-1, A.id8(), 16);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, begin(c, A.id8(), "").getSW());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sign().getSW(), "the payment was given up");
        // a locked card is taught: it takes its own change
        c.tap();
        c.put(-1, B.id8(), 64);
        lock(c);
        taught(c, B);
    }

    // =========================================================================
    // Showing an opening's key, and LOAD_CHANGE
    // =========================================================================

    @Test
    @DisplayName("LOAD_CHANGE writes nothing under a key not shown (6A9F, after 6700 and before 6A80): any reader, with no PIN, shows the opening's key by its path in the taught keyset's tree, and the change goes on; for 32 keys (depth 5), 64 (depth 6), seven of amounts that are not powers of two (one leaf padded), three (a padded subtree on the path) and one (depth 0)")
    void aKeyShownIsLoaded() throws Exception {
        Object[][] cases = { { A, 8L }, { V1, 1L << 30 }, { ODD, 50L }, { THREE, 4L }, { ONE, 1L } };
        for (Object[] k : cases) {
            Keyset ks = (Keyset) k[0];
            long amount = (Long) k[1];
            UnitsTest.Card c = card();
            int place = c.put(-1, ks.id8(), 1L << 31);
            taught(c, ks);
            assertArrayEquals(top(ks), topKept(c, ks.id8()), ks.id8() + ": the card's top is the tree's");
            byte[] row = payWithChange(c, place, amount, ks.keyFor(amount), null);
            c.power();
            assertEquals(SW_WRONG_LENGTH, c.sw(loadChangeCommand(row[0], new byte[193])), "a bad length first");
            byte[] bad = mintAnswer(ks.privFor(amount), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
            bad[193] ^= 1;
            assertEquals(SW_KEYS_NOT_SHOWN, c.sw(loadChangeCommand(row[0], bad)), "then the key not shown, before the proof is looked at");
            assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, row, ks.privFor(amount)).getSW(), ks.id8() + ": the mint's answer, the key not shown");
            assertEquals(SW_OK, show(c, row[0], ks, amount), ks.id8() + ": shown, with no PIN");
            assertTrue(shown(c, row[0]));
            assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(row[0], bad)), "shown: the proof is looked at");
            ResponseAPDU r = loadChange(c, row, ks.privFor(amount));
            assertEquals(SW_OK, r.getSW(), ks.id8() + ": and the change goes on");
            assertEquals(amount, CashuAppletTest.readUint32(c.slot(r.getData()[0]), 9));
        }
    }

    @Test
    @DisplayName("A path that does not reach the top is refused (6A80) and marks nothing: a bit of a node off, an index bit off, another leaf's path, a path one height short, the key for another amount; and in order 6700 (under three bytes), 6A83, 6A88, 6700 (a depth over 6, a length that is not the depth's), 6A9F (a keyset not taught, or no longer known), then the path; 6A84 comes before 6A9F at LOAD_CHANGE")
    void aPathOffIsRefused() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        int other = c.put(-1, B.id8(), 64);
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        int k = row[0], i = A.indexOf(8), d = depth(A);
        byte[] p = path(A, i);
        c.power();
        byte[] offNode = p.clone();
        offNode[40] ^= 0x01;
        assertEquals(SW_WRONG_DATA, show(c, k, i, d, offNode, null), "a bit of the second node off");
        assertEquals(SW_WRONG_DATA, show(c, k, i ^ 0x04, d, p, null), "an index bit off");
        assertEquals(SW_WRONG_DATA, show(c, k, A.indexOf(16), d, path(A, A.indexOf(16)), null), "the path of 16's leaf");
        assertEquals(SW_WRONG_DATA, show(c, k, i, d - 1, Arrays.copyOf(p, 32 * (d - 1)), null), "a height short");
        assertFalse(shown(c, k), "nothing marked");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_KEYSET_KEYS, 3, 0, new byte[] { (byte) k, 0 })), "two bytes");
        assertEquals(SW_SLOT_OUT_OF_RANGE, show(c, 8, i, d, p, null), "opening 8");
        assertEquals(SW_SLOT_OUT_OF_RANGE, show(c, 8, i, 9, p, null), "before the length");
        assertEquals(SW_SLOT_EMPTY, show(c, (k + 1) % 8, i, d, p, null), "an opening owed nothing");
        assertEquals(SW_WRONG_LENGTH, show(c, k, i, 7, concat(p, new byte[64]), null), "a depth of 7");
        assertEquals(SW_WRONG_LENGTH, show(c, k, i, d, Arrays.copyOf(p, p.length - 1), null), "a byte short");
        assertEquals(SW_WRONG_LENGTH, show(c, k, i, d, concat(p, new byte[1]), null), "a byte over");
        assertEquals(SW_WRONG_LENGTH, show(c, k, i, d, p, new byte[34]), "a key of 34");
        // a key bound for another amount: the mint's key for 2, named for 8
        c.tap();
        c.grant();
        byte[] row2 = payWithChange(c, other, 8, B.keyFor(2), null);
        taught(c, B);
        c.power();
        assertEquals(SW_WRONG_DATA, show(c, row2[0], B.indexOf(2), depth(B), path(B, B.indexOf(2)), null), "the leaf is 8 and the key for 2: in no tree");
        assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, row2, B.privFor(2)).getSW(), "nothing written under it");
        // a keyset not taught: no change is made in it at all (SPEND_ALL_CHANGE 6A9F), so no opening of it is ever shown
        c.tap();
        int third = c.put(-1, THREE.id8(), 64);
        c.runtime.teachForChange = false;
        assertEquals(SW_OK, c.begin(third).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(4, THREE.keyFor(4), hexToBytes(THREE.id8()))), "keys not taught: no change in that keyset");
        c.runtime.teachForChange = true;
        c.power();
        // the right path, last
        assertEquals(SW_OK, show(c, k, i, d, p, null));
        // no place free comes before the key not shown
        UnitsTest.Card full = card();
        int at = full.put(-1, A.id8(), 64);
        byte[] r = payWithChange(full, at, 8, A.keyFor(8), null);
        for (int n = 1; n < CashuApplet.MAX_PROOFS; n++) full.put(-1, A.id8(), 1);
        full.power();
        assertEquals(SW_NO_SPACE, loadChange(full, r, A.privFor(8)).getSW());
    }

    @Test
    @DisplayName("A key a reader made up and bound at the payment is never loaded: it shows nowhere (6A80) and LOAD_CHANGE answers 6A9F to its own answer; the holder binds the opening to the mint's key with its path (P1 = 3 with another key): the PIN in this tap, the holder's say (the owner's grant) and a tap that paid nothing, each refused alone (6982, 6982, 6985), a key not the keyset's refused (6A80) and the opening left as it was; then the change goes on under the mint's key alone")
    void aKeyMadeUpIsRebound() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, keyOf(TILL), null);
        int k = row[0], i = A.indexOf(8);
        // in the paying tap, with the PIN and the grant: no
        assertEquals(SW_CONDITIONS_NOT_SATIS, rebind(c, k, A, 8), "a tap that paid");
        c.power();
        assertEquals(SW_WRONG_DATA, show(c, k, i, depth(A), path(A, i), null), "the till's key is in no tree");
        assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, row, TILL).getSW(), "its own answer is not written");
        assertEquals(SW_SECURITY_NOT_SATIS, rebind(c, k, A, 8), "no PIN");
        c.grant();
        assertEquals(SW_SECURITY_NOT_SATIS, rebind(c, k, A, 8), "the grant and no PIN");
        c.tap();
        assertEquals(SW_SECURITY_NOT_SATIS, rebind(c, k, A, 8), "the PIN and no grant");
        c.grant();
        assertEquals(SW_WRONG_DATA, show(c, k, i, depth(A), path(A, i), keyOf(TILL.add(BigInteger.ONE))), "another key not the keyset's");
        assertArrayEquals(keyOf(TILL), Arrays.copyOfRange(lastRow(c), 50, 83), "still bound to the till's key");
        assertFalse(shown(c, k));
        assertEquals(SW_OK, rebind(c, k, A, 8), "the PIN, the grant, a tap that paid nothing");
        assertArrayEquals(A.keyFor(8), Arrays.copyOfRange(lastRow(c), 50, 83), "bound to the mint's key for 8");
        assertTrue(shown(c, k));
        c.power();
        assertEquals(SW_WRONG_DATA, loadChange(c, row, TILL).getSW(), "the till's answer is not under the bound key");
        assertEquals(SW_OK, loadChange(c, row, A.privFor(8)).getSW(), "the mint's goes on, with no PIN");

    }

    @Test
    @DisplayName("After a mint moves to a new keyset the change is named in it (SPEND_ALL_CHANGE of 45 bytes) only once the card holds a piece of it and has been taught its keys: 6A9F until then, nothing entered; then shown, and the piece is in the new keyset")
    void theChangeInANewKeysetWaitsForItsKeys() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        c.runtime.teachForChange = false;
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(8, B.keyFor(8), hexToBytes(B.id8()))), "a keyset in no entry: no change in it");
        assertEquals(-1, c.entryOf(B.id8()), "and nothing entered for it");
        c.put(-1, B.id8(), 1);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(8, B.keyFor(8), hexToBytes(B.id8()))), "in an entry, its keys not taught: no change in it");
        taught(c, B);
        byte[] row = payWithChange(c, place, 8, B.keyFor(8), B.id8());
        assertEquals(B.id8(), toHex(Arrays.copyOfRange(row, 5, 13)), "the opening's keyset is the one named");
        c.power();
        assertEquals(SW_OK, show(c, row[0], B, 8));
        ResponseAPDU r = loadChange(c, row, B.privFor(8));
        assertEquals(SW_OK, r.getSW());
        assertEquals(B.id8(), toHex(Arrays.copyOfRange(c.slot(r.getData()[0]), 1, 9)));
    }

    @Test
    @DisplayName("The keys go with their entry: let go by the reclaim and entered again, a keyset's keys are not known (6A9F) until taught again; taught again, a top that was not the keys' is replaced; RESET_CARD wipes every top")
    void theKeysGoWithTheirEntry() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        taught(c, A);
        assertTrue(keysKnown(c, A.id8()));
        assertEquals(64, c.pay(place).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(-1, c.entryOf(A.id8()), "nothing names it: let go");
        place = c.put(-1, A.id8(), 64);
        assertFalse(keysKnown(c, A.id8()), "entered again, its keys not known");
        c.runtime.teachForChange = false;
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(8, A.keyFor(8), hexToBytes(A.id8()))), "and no change is made in it");
        c.runtime.teachForChange = true;
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, A.keyFor(8), null);
        c.power();
        c.tap();
        // a top that is not the keys' (set by hand) is replaced by teaching again
        int e = c.entryOf(A.id8());
        c.book()[e * UnitsTest.ENTRY + 9] ^= 1;
        assertEquals(SW_WRONG_DATA, show(c, row[0], A, 8));
        taught(c, A);
        assertArrayEquals(top(A), topKept(c, A.id8()));
        assertEquals(SW_OK, show(c, row[0], A, 8));
        ResponseAPDU back = loadChange(c, row, A.privFor(8));
        assertEquals(SW_OK, back.getSW());
        c.tap();
        assertEquals(64, c.pay(back.getData()[0]).getData().length, "nothing unspent left");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertArrayEquals(new byte[CashuApplet.BOOK_LEN], c.book(), "every top wiped with the table");
    }

    @Test
    @DisplayName("D23 (D190): a binding to another key torn after the mark is off leaves the opening bound to one key or the other, or a mix, and not shown: LOAD_CHANGE answers 6A9F to either key's answer, and the holder's binding sent again finishes it; a new change takes an opening's mark off before its key")
    void aTornBindingIsNeverLoaded() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        taught(c, A);
        byte[] row = payWithChange(c, place, 8, keyOf(TILL), null);
        int k = row[0];
        // torn after the mark is off and half the new key written (set by hand: a simulator cannot tear)
        byte[] keys = c.field("openKeys");
        int at = k * CashuApplet.OPEN_KEYS_ROW;
        keys[at + CashuApplet.OPEN_KEYS_SHOWN] = 0;
        System.arraycopy(A.keyFor(8), 0, keys, at + CashuApplet.OPEN_KEYS_K, 17);
        c.power();
        assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, row, TILL).getSW(), "the till's answer");
        assertEquals(SW_KEYS_NOT_SHOWN, loadChange(c, row, A.privFor(8)).getSW(), "the mint's answer");
        assertEquals(SW_WRONG_DATA, show(c, k, A, 8), "the mixed key shows nowhere");
        c.tap();
        c.grant();
        assertEquals(SW_OK, rebind(c, k, A, 8), "sent again");
        c.power();
        assertEquals(SW_OK, loadChange(c, row, A.privFor(8)).getSW());
    }

    @Test
    @DisplayName("KEYSET_KEYS asks for no memory of its own: the teaching's room is RAM a payment uses (allSlots, scratch, allOut), and the applet allocates nothing more after install for it")
    void theTeachingHasNoRoomOfItsOwn() throws Exception {
        String code = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8));
        int from = code.indexOf("private void processKeysetKeys("), to = code.indexOf("private void pointText(");
        assertTrue(from > 0 && to > from);
        String teaching = code.substring(from, to);
        assertFalse(teaching.contains("new byte") || teaching.contains("makeTransient") || teaching.contains("getInstance"), "nothing made");
        assertEquals(2, count(teaching, "beginTransaction"), "one transaction for the top and the state bit, and one for showKey's binding (the key, the keyset and the mark)");
        short tail = constant("T_TAIL"), high = constant("T_HIGH"), room = constant("X_LEN");
        assertTrue(66 <= tail && tail + CashuApplet.TAIL_MOST <= high && high + 64 <= room, "the hex, the tail and two nodes fit scratch, one after the other");
        assertEquals(128, CashuApplet.ALL_MOST, "and four nodes allSlots");
    }

    private static short constant(String name) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.getShort(null);
    }

    private static int count(String s, String what) {
        int n = 0;
        for (int at = s.indexOf(what); at >= 0; at = s.indexOf(what, at + 1)) n++;
        return n;
    }

    @Test
    @DisplayName("LOAD_CHANGE gives the chip no point that is not on the curve: the mint's C_ or K with y moved by two (the same x and parity) is refused 6A80 and neither key agreement is given a point; the mint's good answer then loads")
    void loadChangeGivesTheChipNoPointOffTheCurve() throws Exception {
        UnitsTest.Card c = card();
        int p = c.put(-1, A.id8(), 1024);
        taught(c, A);
        c.tap();
        byte[] row = payWithChange(c, p, 512, A.keyFor(512), null);
        assertEquals(SW_OK, show(c, row[0], A, 512));
        byte[] good = CashuAppletTest.mintAnswer(A.privFor(512), Arrays.copyOfRange(row, 17, 50), BigInteger.valueOf(77));
        java.lang.reflect.Field fs = CashuApplet.class.getDeclaredField("schnorrHW");
        fs.setAccessible(true);
        SchnorrHW signer = (SchnorrHW) fs.get(c.applet());
        SchnorrHWSignTest.WatchedAgreement ecdh = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY);
        SchnorrHWSignTest.WatchedAgreement gm = new SchnorrHWSignTest.WatchedAgreement(javacard.security.KeyAgreement.ALG_EC_PACE_GM);
        SchnorrHWSignTest.setHidden(signer, "ecdh", ecdh);
        SchnorrHWSignTest.setHidden(signer, "gm", gm);
        BigInteger fp = CashuAppletTest.SECP_P;
        for (int at : new int[] { 0, 65 }) {
            byte[] bad = good.clone();
            BigInteger y = new BigInteger(1, Arrays.copyOfRange(bad, at + 33, at + 65)).add(BigInteger.valueOf(2)).mod(fp);
            System.arraycopy(CashuAppletTest.unsigned32(y), 0, bad, at + 33, 32);
            assertEquals(SW_WRONG_DATA, c.sw(CashuAppletTest.loadChangeCommand(row[0], bad)), (at == 0 ? "C_" : "K") + " off the curve");
            byte[] off = Arrays.copyOfRange(bad, at, at + 65);
            assertFalse(java.util.stream.Stream.concat(ecdh.given.stream(), gm.given.stream()).anyMatch(g -> Arrays.equals(g, off)), (at == 0 ? "C_" : "K") + ": the point off the curve is not given to the chip");
            assertFalse(gm.generators.stream().anyMatch(g -> Arrays.equals(g, off)), (at == 0 ? "C_" : "K") + ": nor made the generic mapping's generator");
        }
        assertEquals(SW_OK, c.sw(CashuAppletTest.loadChangeCommand(row[0], good)), "the good answer loads");
    }
}
