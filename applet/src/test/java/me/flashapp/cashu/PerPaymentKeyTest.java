package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_ALLOW_LOAD;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_INFO;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_PUBKEY;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_OUTPUTS;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_SIGN;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.MINT;
import static me.flashapp.cashu.CashuAppletTest.REFUND;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.blinded;
import static me.flashapp.cashu.CashuAppletTest.buildProof;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.extractPubkeyX;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.output;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.record;
import static me.flashapp.cashu.CashuAppletTest.schnorrVerify;
import static me.flashapp.cashu.CashuAppletTest.sha256;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import javacard.security.CryptoException;
import javacard.security.Key;
import javacard.security.KeyAgreement;
import javacard.security.MessageDigest;
import javacard.security.PrivateKey;
import javacardx.crypto.Cipher;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Keys per load (D197). The card keeps a secret c; for a date D, t = SHA-256("CashuCard/key" || c || D) mod n and the card's
 * key for the date is P + t*G; u = SHA-256("CashuCard/refund-key" || c || D) mod n and the refund key for it R + u*G. Every
 * secret of a piece of date D names those two keys, a payment is signed with d + t, SPEND_ALL_BEGIN answers t and R + u*G,
 * GROUP_KEYS answers a date's three, GET_CARD P1 = 3 gives c to the holder's say, SET_CARD keeps the refund key whole, a reset
 * draws a new c, and the payment's record names the key for the date 0. The keys are worked out here by DateKeys, from the
 * rule and not from the card's code.
 */
class PerPaymentKeyTest {

    static final byte INS_GROUP_KEYS = (byte) 0x1D;
    static final long D1 = 1_900_000_000L, D2 = 1_900_000_001L;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static DateKeys keys(UnitsTest.Card c) { return DateKeys.of(c.applet()); }
    static ResponseAPDU groupKeys(UnitsTest.Card c, long date) { return c.send(new CommandAPDU(CLA, INS_GROUP_KEYS, 0, 0, u32(date), 256)); }
    static ResponseAPDU begin(UnitsTest.Card c, int place) { return c.beginAs(0, place); }
    static int load(UnitsTest.Card c, long amount, int seed, long date) {
        ResponseAPDU r = c.load(buildProof(UnitsTest.SAT_A, amount, seed, date));
        assertEquals(SW_OK, r.getSW(), "the load");
        return r.getData()[0] & 0xFF;
    }

    @Test
    @DisplayName("A payment of a dated piece: BEGIN answers its worth, t and R + u*G (69 bytes); the signature verifies under P + t*G over secrets that name P + t*G and R + u*G, and under P not at all; neither P nor R is in any secret; GROUP_KEYS says the same keys; two dates, two keys")
    void aPaymentIsSignedUnderItsDatesKey() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = keys(c);
        byte[] cardKey = c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
        assertArrayEquals(cardKey, k.card);
        long[] dates = { D1, D2 };
        byte[][] tweaks = new byte[2][];
        for (int d = 0; d < 2; d++) {
            int place = load(c, 8, 11 + d, dates[d]);
            byte[] slot = c.slot(place);
            ResponseAPDU begun = begin(c, place);
            assertEquals(SW_OK, begun.getSW());
            assertEquals(69, begun.getData().length, "the worth (4), t (32), R + u*G (33)");
            assertEquals(8, CashuAppletTest.readUint32(begun.getData(), 0));
            byte[] t = Arrays.copyOfRange(begun.getData(), 4, 36), rg = Arrays.copyOfRange(begun.getData(), 36, 69);
            tweaks[d] = t;
            assertEquals(k.t(dates[d]), new BigInteger(1, t), "t = SHA-256(\"CashuCard/key\" || c || date) mod n");
            assertArrayEquals(k.refund(dates[d]), rg, "R + u*G, u = SHA-256(\"CashuCard/refund-key\" || c || date) mod n");
            byte[] pg = k.key(dates[d]);
            byte[] out = output(8, blinded(40 + d));
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out)));
            byte[] sig = c.sign().getData();
            assertEquals(64, sig.length);
            String msg = k.message(new byte[][] { slot }, new byte[][] { out });
            assertTrue(msg.contains(toHex(pg)) && msg.contains(toHex(rg)), "the secret names the date's two keys");
            assertFalse(msg.contains(toHex(cardKey)), "the card key is in no secret");
            assertFalse(msg.contains(toHex(REFUND)), "the refund key is in no secret");
            byte[] digest = sha256(msg.getBytes(StandardCharsets.UTF_8));
            assertTrue(schnorrVerify(extractPubkeyX(pg), digest, sig), "signed under P + t*G");
            assertFalse(schnorrVerify(extractPubkeyX(cardKey), digest, sig), "not under P");
            assertArrayEquals(concat(t, pg, rg), groupKeys(c, dates[d]).getData(), "GROUP_KEYS says the same");
        }
        assertFalse(Arrays.equals(tweaks[0], tweaks[1]), "two dates, two keys");
        assertFalse(Arrays.equals(k.key(D1), k.key(D2)));
    }

    @Test
    @DisplayName("An undated piece is of the date 0: its secret names P + t*G for the date 0 and no refund key (BEGIN answers zeros for it), and the payment is signed under that key")
    void anUndatedPieceIsOfTheDateZero() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = keys(c);
        int place = load(c, 16, 3, 0);
        byte[] slot = c.slot(place);
        ResponseAPDU begun = begin(c, place);
        assertArrayEquals(concat(u32(16), k.tBytes(0), new byte[33]), begun.getData());
        byte[] sig = c.sign().getData();
        String msg = k.message(new byte[][] { slot }, new byte[0][]);
        assertFalse(msg.contains("refund"), "no refund tag in an undated secret");
        assertTrue(k.verifies(0, sha256(msg.getBytes(StandardCharsets.UTF_8)), sig));
    }

    @Test
    @DisplayName("A card with no refund key (which takes no dated piece, 6A8E): BEGIN and GROUP_KEYS say 33 zeros for it, and an undated payment is signed under P + t*G for the date 0")
    void aCardWithNoRefundKey() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, new byte[33]))));
        c.tap();
        DateKeys k = keys(c);
        assertArrayEquals(new byte[33], k.refund(D1));
        assertEquals(CashuApplet.SW_NO_REFUND_KEY, c.load(buildProof(UnitsTest.SAT_A, 8, 4, D1)).getSW(), "no dated piece");
        int place = load(c, 8, 5, 0);
        byte[] slot = c.slot(place);
        ResponseAPDU begun = begin(c, place);
        assertArrayEquals(new byte[33], Arrays.copyOfRange(begun.getData(), 36, 69), "no refund key: zeros");
        byte[] sig = c.sign().getData();
        assertTrue(k.signed(sig, new byte[][] { slot }, new byte[0][]));
        assertArrayEquals(concat(k.tBytes(D1), k.key(D1), new byte[33]), groupKeys(c, D1).getData(), "GROUP_KEYS: zeros for the refund key");
    }

    @Test
    @DisplayName("GROUP_KEYS: to a reader with the PIN given in this tap or the grant (6982 to a stranger); 6700 for any length but 4; it writes nothing that lasts, and a payment in hand is given up by it")
    void groupKeysWritesNothing() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = keys(c);
        int place = load(c, 8, 7, D1);
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, groupKeys(c, D2).getSW(), "a stranger: nothing");
        c.pin();
        assertArrayEquals(concat(k.tBytes(D2), k.key(D2), k.refund(D2)), groupKeys(c, D2).getData(), "the PIN given: the keys of any date");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_GROUP_KEYS, 0, 0, new byte[3], 256)));
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_GROUP_KEYS, 0, 0, new byte[5], 256)));
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_GROUP_KEYS, 0, 0, 256)));
        assertEquals(SW_OK, begin(c, place).getSW(), "a payment begun");
        Map<String, byte[]> before = persistent(c);
        assertEquals(SW_OK, groupKeys(c, D2).getSW());
        for (Map.Entry<String, byte[]> e : before.entrySet()) assertArrayEquals(e.getValue(), field(c, e.getKey()), "GROUP_KEYS writes nothing that lasts: " + e.getKey());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "and the payment is given up");
        assertEquals(1, c.slot(place)[0], "nothing paid");
    }

    static Map<String, byte[]> persistent(UnitsTest.Card c) throws Exception {
        Map<String, byte[]> m = new HashMap<>();
        for (String n : SlotWriteOrderTest.PERSISTENT) {
            byte[] a = field(c, n);
            if (a != null) m.put(n, a.clone());
        }
        return m;
    }
    static byte[] field(UnitsTest.Card c, String n) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(n);
        f.setAccessible(true);
        Object v = f.get(c.applet());
        return v instanceof byte[] ? (byte[]) v : null;
    }

    @Test
    @DisplayName("GET_CARD P1 = 3 on a card with a refund key: c sealed to it, to the owner's grant, or on a card with no owner to the PIN at any tap; a stranger and the PIN alone on an owned card 6982")
    void cGoesToTheHolderOnly() throws Exception {
        UnitsTest.Card o = UnitsTest.owned(UnitsTest.SAT);
        byte[] ok = LinkingTest.ownPinKey(o);
        byte[] c = keys(o).c;
        o.power();
        assertEquals(SW_SECURITY_NOT_SATIS, LinkingTest.readC(o, ok, 0)[1], "a stranger");
        o.pin();
        assertEquals(SW_SECURITY_NOT_SATIS, LinkingTest.readC(o, ok, 0)[1], "the PIN alone, on an owned card");
        o.grant();
        assertArrayEquals(c, (byte[]) LinkingTest.readC(o, ok, 1)[0], "the owner's grant: c");
        UnitsTest.Card n = HolderTest.noOwner();
        byte[] nk = LinkingTest.ownPinKey(n);
        n.power();
        assertEquals(SW_SECURITY_NOT_SATIS, LinkingTest.readC(n, nk, 2)[1], "a stranger");
        n.pin();
        byte[] nc = keys(n).c;
        assertArrayEquals(nc, (byte[]) LinkingTest.readC(n, nk, 2)[0], "the PIN with no held tap, past the first set-up: c, sealed to the refund key");
        assertEquals(SW_OK, n.log(0).getSW(), "the history held for");
        assertArrayEquals(nc, (byte[]) LinkingTest.readC(n, nk, 2)[0], "and in a held tap");
    }

    @Test
    @DisplayName("c is drawn at install, differs from card to card's draw, and a reset draws a new one (its pieces' keys are not the last holder's); the keys of a date follow it")
    void aResetDrawsANewC() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys before = keys(c);
        assertFalse(Arrays.equals(new byte[32], before.c), "drawn at install");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        byte[] after = Arrays.copyOf(field(c, "chain"), 32);
        assertFalse(Arrays.equals(before.c, after), "a new c");
        assertFalse(Arrays.equals(new byte[32], after));
        // set up again: a date's keys are the new c's
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        DateKeys now = keys(c);
        assertArrayEquals(concat(now.tBytes(D1), now.key(D1), now.refund(D1)), groupKeys(c, D1).getData());
        assertFalse(Arrays.equals(before.key(D1), now.key(D1)), "the same date, another key");
        // the new c is written in the reset's last transaction, with who the card is
        String code = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8);
        int at = code.indexOf("private void processResetCard(");
        String reset = code.substring(at, code.indexOf("private void forget(", at));
        int tx = reset.lastIndexOf("JCSystem.beginTransaction();"), copy = reset.indexOf("Util.arrayCopy(scratch, X_MSG, chain, (short) 0, (short) 32);"), done = reset.lastIndexOf("JCSystem.commitTransaction();");
        assertTrue(tx > 0 && tx < copy && copy < done, "c is written atomically in the transaction that makes the card new");
    }

    @Test
    @DisplayName("SET_CARD keeps the refund key whole: its y, the root of x^3 + 7 of its parity, beside c; a refund key whose x is no point of the curve, or not under p, is 6A80 and nothing is written")
    void setCardKeepsTheRefundKeyWhole() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        BigInteger[] r = DateKeys.point(REFUND);
        assertArrayEquals(DateKeys.fixed(r[1]), Arrays.copyOfRange(field(c, "chain"), 32, 64), "the y of the refund key");
        // the other parity: 03 and the same x
        byte[] odd = REFUND.clone();
        odd[0] = 3;
        UnitsTest.Card d = new UnitsTest.Card();
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, odd))));
        assertArrayEquals(DateKeys.fixed(DateKeys.P.subtract(r[1])), Arrays.copyOfRange(field(d, "chain"), 32, 64), "the other root for 03");
        // x = 5: x^3 + 7 is no square mod p, so no point has it
        byte[] off = new byte[33];
        off[0] = 2;
        off[32] = 5;
        UnitsTest.Card e = new UnitsTest.Card();
        byte[] rec = field(e, "cardRecord").clone(), chain = field(e, "chain").clone();
        assertEquals(SW_WRONG_DATA, e.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, off))), "an x of no point");
        byte[] past = new byte[33];
        Arrays.fill(past, (byte) 0xFF);
        past[0] = 2;
        assertEquals(SW_WRONG_DATA, e.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, past))), "an x not under p");
        byte[] bad = REFUND.clone();
        bad[0] = 4;
        assertEquals(SW_WRONG_DATA, e.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, bad))), "neither 02 nor 03");
        assertArrayEquals(rec, field(e, "cardRecord"), "nothing written");
        assertArrayEquals(chain, field(e, "chain"));
    }

    @Test
    @DisplayName("The payment's record names the card's key for the date 0 and its descriptor verifies under that key, not under P, even when a payment of another date was begun before the record was first read")
    void theRecordNamesTheDateZerosKey() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = keys(c);
        int a = load(c, 16, 21, 0);
        int b = load(c, 8, 22, D1);
        c.tap();
        assertEquals(SW_OK, begin(c, a).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(16, blinded(5)))));
        assertEquals(64, c.sign().getData().length);
        // another date's payment begun (its keys written over the last payment's), then given up by the read
        assertEquals(SW_OK, begin(c, b).getSW());
        byte[] packet = new byte[0];
        for (int at = 0; ; at += 255) {
            ResponseAPDU p = c.send(new CommandAPDU(CLA, HistoryPrivacyTest.INS_GET_OUTBOX, 1, 0, new byte[] { (byte) (at >> 8), (byte) at, (byte) 0xFF }, 256));
            if (p.getSW() == CashuAppletTest.SW_SLOT_OUT_OF_RANGE) break;
            assertEquals(SW_OK, p.getSW());
            packet = concat(packet, p.getData());
            if (p.getData().length < 255) break;
        }
        int bodyLen = packet.length - 64;
        byte[] body = Arrays.copyOf(packet, bodyLen), descriptor = Arrays.copyOfRange(packet, bodyLen, packet.length);
        assertArrayEquals(k.key(0), Arrays.copyOfRange(body, 7, 40), "the key the packet names: P + t*G for the date 0");
        byte[] tag = sha256("CashuCard/assisted-settlement/v1".getBytes(StandardCharsets.US_ASCII));
        byte[] digest = sha256(concat(tag, tag, body));
        assertTrue(k.verifies(0, digest, descriptor), "the descriptor under that key");
        assertFalse(schnorrVerify(extractPubkeyX(k.card), digest, descriptor), "and not under P");
    }

    @Test
    @DisplayName("The card's own change is of the payment's date: its secret names P + t*G and R + u*G of that date, and the payment's one signature, by P + t*G, covers it")
    void theChangeIsOfThePaymentsDate() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        DateKeys k = keys(c);
        int place = load(c, 64, 41, D1);
        byte[] slot = c.slot(place);
        // the keyset taught, as KEYSET_KEYS would mark it: change is made only in a taught keyset
        byte[] book = field(c, "book");
        for (int e = 0; e < 6; e++) if ((book[e * 41 + 8] & 0x40) != 0) book[e * 41 + 8] |= 0x02;
        assertEquals(SW_OK, begin(c, place).getSW());
        byte[] out = output(40, blinded(43));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out)));
        ResponseAPDU made = c.send(CashuAppletTest.changeCommand(24, REFUND, hexToBytes(UnitsTest.SAT_A)));
        assertEquals(SW_OK, made.getSW());
        byte[] open = Arrays.copyOf(field(c, "changeOpen"), CashuApplet.OPEN_LEN);
        byte[] nonce = Arrays.copyOfRange(open, CashuApplet.OPEN_NONCE, CashuApplet.OPEN_NONCE + 32), r = Arrays.copyOfRange(open, CashuApplet.OPEN_R, CashuApplet.OPEN_R + 32);
        assertEquals(D1, CashuAppletTest.readUint32(open, CashuApplet.OPEN_DATE), "the opening's date is the payment's");
        String secret = k.secret(nonce, D1);
        assertTrue(secret.contains(toHex(k.key(D1))) && secret.contains(toHex(k.refund(D1))));
        assertArrayEquals(CashuAppletTest.blindedFor(secret.getBytes(StandardCharsets.UTF_8), r), made.getData(), "B_ is of the secret under the date's keys");
        byte[] sig = c.sign().getData();
        assertTrue(k.signed(sig, new byte[][] { slot }, new byte[][] { out, output(24, made.getData()) }), "one signature over the piece, the till's output and the change");
    }

    @Test
    @DisplayName("SPEND_ALL_BEGIN without P1 bit 1 (02, the reader builds the secrets with the keys per load): 00 as a reader of 2.2 sends it, 01, 80, FD are 6A86 whatever the places (none, out of range, two dates, 129), before anything that lasts is written: no payment begun, the draft of change kept, nothing burned; with bit 1 the same place is begun")
    void aReaderThatBuildsNoDateKeysIsRefusedFirst() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        int place = load(c, 64, 51, D1), other = load(c, 8, 52, D2);
        // a payment in hand with a draft of change, as theChangeIsOfThePaymentsDate makes one
        byte[] book = field(c, "book");
        for (int e = 0; e < 6; e++) if ((book[e * 41 + 8] & 0x40) != 0) book[e * 41 + 8] |= 0x02;
        assertEquals(SW_OK, begin(c, place).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(40, blinded(53)))));
        assertEquals(SW_OK, c.send(CashuAppletTest.changeCommand(24, REFUND, hexToBytes(UnitsTest.SAT_A))).getSW());
        assertEquals(CashuApplet.OPEN_DRAFT, field(c, "openState")[0], "a draft");
        Map<String, byte[]> before = persistent(c);
        for (int p1 : new int[] { 0x00, 0x01, 0x80, 0xFD }) {
            assertEquals(0x6A86, c.beginRaw(p1, place).getSW(), "P1 " + p1 + ": the place");
            assertEquals(0x6A86, c.beginRaw(p1).getSW(), "P1 " + p1 + ": none");
            assertEquals(0x6A86, c.beginRaw(p1, 200).getSW(), "P1 " + p1 + ": out of range");
            assertEquals(0x6A86, c.beginRaw(p1, place, other).getSW(), "P1 " + p1 + ": two dates");
            assertEquals(0x6A86, c.beginRaw(p1, new int[129]).getSW(), "P1 " + p1 + ": 129");
        }
        for (Map.Entry<String, byte[]> e : before.entrySet()) assertArrayEquals(e.getValue(), field(c, e.getKey()), "nothing that lasts is written: " + e.getKey());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "no payment in hand");
        assertEquals(1, c.slot(place)[0], "nothing burned");
        assertEquals(SW_OK, c.beginRaw(0x02, place).getSW(), "02: begun");
        assertEquals(CashuApplet.OPEN_EMPTY, field(c, "openState")[0], "and the draft let go by the payment begun");
        assertEquals(SW_OK, c.beginRaw(0xFF, place).getSW(), "FF: bit 1 among others, begun");
        c.power();
        assertEquals(0x6A86, c.beginRaw(0x00, place).getSW(), "in a tap with no PIN given, the same");
        assertEquals(SW_OK, c.beginRaw(0x02, place).getSW());
    }

    @Test
    @DisplayName("GET_INFO P1 = 4 says keys per load in byte 56, bit 1")
    void theProfileBit() {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        byte[] info = c.info(4);
        assertEquals(59, info.length);
        assertEquals(0x02, info[56] & 0x02);
    }

    // ---- what a payment costs the chip, counted in the simulator ------------------------------------------------------

    /** Every SHA-256 the wrapped digest finishes. */
    static final class CountingDigest extends MessageDigest {
        final MessageDigest in;
        int done;
        CountingDigest(MessageDigest in) { this.in = in; }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public byte getLength() { return in.getLength(); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) { done++; return in.doFinal(a, o, l, out, oo); }
        @Override public void update(byte[] a, short o, short l) { in.update(a, o, l); }
        @Override public void reset() { in.reset(); }
    }
    /** Every point the wrapped key agreement makes. */
    static final class CountingAgreement extends KeyAgreement {
        final KeyAgreement in;
        int made;
        CountingAgreement(KeyAgreement in) { this.in = in; }
        @Override public void init(PrivateKey k) throws CryptoException { in.init(k); }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public short generateSecret(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException { made++; return in.generateSecret(a, o, l, out, oo); }
    }
    /** Every power the wrapped RSA takes. */
    static final class CountingCipher extends Cipher {
        final Cipher in;
        int powers;
        CountingCipher(Cipher in) { this.in = in; }
        @Override public void init(Key k, byte m) throws CryptoException { in.init(k, m); }
        @Override public void init(Key k, byte m, byte[] b, short o, short l) throws CryptoException { in.init(k, m, b, o, l); }
        @Override public byte getAlgorithm() { return in.getAlgorithm(); }
        @Override public byte getPaddingAlgorithm() { return in.getPaddingAlgorithm(); }
        @Override public byte getCipherAlgorithm() { return in.getCipherAlgorithm(); }
        @Override public short doFinal(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException { powers++; return in.doFinal(a, o, l, out, oo); }
        @Override public short update(byte[] a, short o, short l, byte[] out, short oo) throws CryptoException { return in.update(a, o, l, out, oo); }
    }

    static Object wrap(Object owner, Class<?> cls, String name, java.util.function.Function<Object, Object> how) throws Exception {
        java.lang.reflect.Field f = cls.getDeclaredField(name);
        f.setAccessible(true);
        Object w = how.apply(f.get(owner));
        f.set(owner, w);
        return w;
    }

    @Test
    @DisplayName("What keys per load cost, counted: SPEND_ALL_BEGIN two SHA-256 and two point additions with a refund key (one and one without), SIGN nothing more of keys per load (the signature's check, step 8, is two point additions and one or two key agreements more), GROUP_KEYS the same as BEGIN, SET_CARD with a refund key three powers of the chip's RSA")
    void whatItCosts() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        Object applet = c.applet();
        java.lang.reflect.Field sf = CashuApplet.class.getDeclaredField("schnorrHW");
        sf.setAccessible(true);
        Object signer = sf.get(applet);
        CountingDigest sha = (CountingDigest) wrap(applet, CashuApplet.class, "sha", o -> new CountingDigest((MessageDigest) o));
        CountingDigest shaAll = (CountingDigest) wrap(applet, CashuApplet.class, "shaAll", o -> new CountingDigest((MessageDigest) o));
        CountingCipher rsa = (CountingCipher) wrap(applet, CashuApplet.class, "rsa", o -> new CountingCipher((Cipher) o));
        CountingAgreement gm = (CountingAgreement) wrap(signer, SchnorrHW.class, "gm", o -> new CountingAgreement((KeyAgreement) o));
        CountingAgreement ecdh = (CountingAgreement) wrap(signer, SchnorrHW.class, "ecdh", o -> new CountingAgreement((KeyAgreement) o));
        CountingDigest signSha = (CountingDigest) wrap(signer, SchnorrHW.class, "sha256", o -> new CountingDigest((MessageDigest) o));
        int place = load(c, 8, 31, D1);
        int[] at = { sha.done, shaAll.done, rsa.powers, gm.made, ecdh.made, signSha.done };
        assertEquals(SW_OK, begin(c, place).getSW());
        int[] begun = { sha.done - at[0], shaAll.done - at[1], rsa.powers - at[2], gm.made - at[3], ecdh.made - at[4], signSha.done - at[5] };
        assertArrayEquals(new int[] { 2, 0, 0, 2, 0, 0 }, begun, "BEGIN: two SHA-256 (t and u), two point additions (P + t*G, R + u*G), nothing else of the chip's");
        int[] s0 = { sha.done, shaAll.done, rsa.powers, gm.made, ecdh.made, signSha.done };
        assertEquals(64, c.sign().getData().length);
        int waits = c.waits;
        int[] signed = { sha.done - s0[0], shaAll.done - s0[1], rsa.powers - s0[2], gm.made - s0[3], ecdh.made - s0[4], signSha.done - s0[5] };
        assertEquals(0, signed[0], "SIGN: no SHA-256 of keys per load");
        // the signature's check (SchnorrHW.sign's step 8): Q = W + [t]G and [s]G - T, two point additions; [e]Q one key
        // agreement more, and [d]G another where the chip's getW gives 33 bytes. The waits' work has no check.
        java.lang.reflect.Field pk = CashuApplet.class.getDeclaredField("cardPubKey");
        pk.setAccessible(true);
        boolean w33 = ((javacard.security.ECPublicKey) pk.get(applet)).getW(new byte[65], (short) 0) == 33;
        assertEquals(2, signed[3], "and the two point additions of the signature's check");
        assertEquals(waits + 2 + (w33 ? 1 : 0), signed[4], "one k*G a signature (the waits' and the payment's), as before, and the check's [e]Q" + (w33 ? " and [d]G" : ""));
        int g0 = gm.made, h0 = sha.done;
        assertEquals(SW_OK, groupKeys(c, D2).getSW());
        assertEquals(2, gm.made - g0, "GROUP_KEYS: two point additions");
        assertEquals(2, sha.done - h0, "and two SHA-256");
        // SET_CARD with a refund key: the curve check (cube, Euler) and the root
        UnitsTest.Card d = new UnitsTest.Card();
        CountingCipher rsa2 = (CountingCipher) wrap(d.applet(), CashuApplet.class, "rsa", o -> new CountingCipher((Cipher) o));
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record(MINT, REFUND))));
        assertEquals(3, rsa2.powers, "SET_CARD: three powers of the chip's RSA, once");
        // on a chip (docs/FOXY-CARD-HARDWARE.md, contact reader): a point addition 85-100 ms, a SHA-256 of under 100 bytes 4 ms,
        // a power of the RSA 70-80 ms and about 50 ms of reduction
        System.out.println("keys per load, counted: BEGIN +" + begun[0] + " SHA-256 +" + begun[3] + " point additions (about "
            + (begun[3] * 85 + begun[0] * 4) + "-" + (begun[3] * 100 + begun[0] * 4) + " ms on a chip); SIGN +0; GROUP_KEYS 2 + 2; SET_CARD +3 RSA powers (about 360-390 ms, once)");
    }
}
