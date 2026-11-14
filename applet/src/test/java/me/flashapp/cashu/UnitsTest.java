package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.AID_HEX;
import static me.flashapp.cashu.CashuAppletTest.AID_STR;
import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_ALLOW_LOAD;
import static me.flashapp.cashu.CashuAppletTest.INS_CLEAR_SPENT;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_BALANCE;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_CHANGE;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_INFO;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_LOG;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_NONCE;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_PROOF;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_PROOF_COUNT;
import static me.flashapp.cashu.CashuAppletTest.INS_LOAD_PROOF;
import static me.flashapp.cashu.CashuAppletTest.INS_RESET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_LIMIT;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_LIMIT_OWNER;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_BEGIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_CHANGE;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_OUTPUTS;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_SIGN;
import static me.flashapp.cashu.CashuAppletTest.INS_VERIFY_PIN;
import static me.flashapp.cashu.CashuAppletTest.L_CARD;
import static me.flashapp.cashu.CashuAppletTest.L_LIMIT;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.L_RESET;
import static me.flashapp.cashu.CashuAppletTest.MINT;
import static me.flashapp.cashu.CashuAppletTest.OWNER;
import static me.flashapp.cashu.CashuAppletTest.REFUND;
import static me.flashapp.cashu.CashuAppletTest.RESET_CONFIRM;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_INCORRECT_P1P2;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.KeysetKeysTest.SW_KEYS_NOT_SHOWN;
import static me.flashapp.cashu.CashuAppletTest.SW_GRANT;
import static me.flashapp.cashu.CashuAppletTest.SW_OVER_LIMIT;
import static me.flashapp.cashu.CashuAppletTest.SW_PIN_NEEDED;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.T0;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.WAITS_MOST;
import static me.flashapp.cashu.CashuAppletTest.buildProof;
import static me.flashapp.cashu.CashuAppletTest.changeCommand;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.dleqProof;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.loadChangeCommand;
import static me.flashapp.cashu.CashuAppletTest.mintAnswer;
import static me.flashapp.cashu.CashuAppletTest.mintKey;
import static me.flashapp.cashu.CashuAppletTest.output;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.ownerProof;
import static me.flashapp.cashu.CashuAppletTest.readUint32;
import static me.flashapp.cashu.CashuAppletTest.record;
import static me.flashapp.cashu.CashuAppletTest.setOwnerOpenCommand;
import static me.flashapp.cashu.CashuAppletTest.setTimeCommand;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static me.flashapp.cashu.CashuAppletTest.waitsRule;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

/**
 * Two units on one card (3.0, D184): the keyset table the first SET_CARD reserves, the labelled load and the table's rules at
 * every load, one unit a payment, every limit in the card's unit with a payment in the other unit turned at the rate, the one
 * SET_LIMIT layout of seventeen bytes, and what GET_INFO P1 = 3, GET_CARD P1 = 2, GET_BALANCE P1 = 1 and GET_LOG P1 = 2 and 3
 * say. A card of one unit answers as it did, but for the version.
 */
class UnitsTest {

    /** Keysets the tests' mint is said to issue: three of sat and three of usd. */
    static final String SAT_A = "00aa000000000001", SAT_B = "00aa000000000002", SAT_C = "00aa000000000003";
    static final String USD_A = "00bb000000000001", USD_B = "00bb000000000002", USD_C = "00bb000000000003";
    static final int SAT = 0, USD = 1;
    static final int SW_NO_RATE = 0x6A99, SW_TWO_UNITS = 0x6A9A, SW_OTHER_UNIT = 0x6A9B, SW_NO_TABLE_ROOM = 0x6A9C, SW_NOT_THIS_TAP = 0x6A9D;
    static final int SW_WRONG_P1P2 = 0x6B00;
    static final int TABLE_LEN = 267, ENTRY = 41;
    /** The record's rate, and the table's last unit, other unit's count and receipts' units, where the applet keeps them (pinned below). */
    static final int RATE_AT = 159, LAST_AT = 246, OTHER_AT = 247, UNITS_AT = 251;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    // =========================================================================
    // A card, and what a test does to it
    // =========================================================================

    static final class Card {
        final CashuAppletTest.ExposedRuntime runtime = new CashuAppletTest.ExposedRuntime();
        final CardSimulator sim = new CardSimulator(runtime);
        final AID aid = AIDUtil.create(AID_HEX);
        private int seed = 1;

        Card() {
            sim.installApplet(aid, CashuApplet.class);
            select();
        }

        ResponseAPDU send(CommandAPDU c) { return CashuAppletTest.held(sim::transmitCommand, c); }
        int sw(CommandAPDU c) { return send(c).getSW(); }
        void select() { assertEquals(SW_OK, sw(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR)))); }
        /** Taken out of the field and put back: a new tap, nothing given in it. */
        void power() { sim.reset(); select(); }
        void pin() { assertEquals(SW_OK, sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN))); }
        /** A new tap with the PIN given. */
        void tap() { power(); pin(); }

        /** Set up as a phone sets a card up, in `unit`: a PIN, the record, the owner (where `owner`), a clock; then a new tap with the PIN. */
        Card ready(int unit, boolean owner) {
            assertEquals(SW_OK, sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
            pin();
            assertEquals(SW_OK, sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, recordIn(unit))));
            if (owner) assertEquals(SW_OK, sw(setOwnerOpenCommand(OWNER)));
            assertEquals(SW_OK, sw(setTimeCommand(T0)));
            tap();
            return this;
        }

        /** The owner's proof over `value` under `label`, after a nonce asked for in this tap. */
        byte[] proofFor(String label, byte[] value) {
            ResponseAPDU n = send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
            assertEquals(SW_OK, n.getSW());
            return ownerProof(label, OWNER, n.getData(), value);
        }
        /** The owner's grant in this tap (ALLOW_LOAD): the holder's say on a card with an owner. */
        void grant() { assertEquals(SW_GRANT, sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(proofFor(L_LOAD, new byte[0]), new byte[0])))); }
        /** SET_LIMIT by the owner, seventeen bytes: the three figures in the card's unit, the budget and the rate. */
        int limits(long day, long tap, long allowance, int budget, long rate) {
            return ownerLimit(concat(u32(day), u32(tap), u32(allowance), new byte[] { (byte) budget }, u32(rate)));
        }
        int ownerLimit(byte[] v) {
            return sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(proofFor(L_LIMIT, v), v)));
        }

        /** A piece of `keyset` worth `amount`, with a nonce of its own. */
        byte[] piece(String keyset, long amount) {
            byte[] p = buildProof(keyset, amount, seed & 0xFF);
            System.arraycopy(u32(seed++), 0, p, 12, 4);
            return p;
        }
        ResponseAPDU load(byte[]... pieces) { return send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, concat(pieces), 256)); }
        ResponseAPDU loadAs(int unit, byte[]... pieces) { return send(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 3, concat(new byte[] { (byte) unit }, concat(pieces)), 256)); }
        ResponseAPDU loadAsWithProof(int unit, byte[] piece, byte[] proof) { return send(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, 3, concat(new byte[] { (byte) unit }, piece, proof), 256)); }
        /** A piece put on and its place: loaded under whatever the tap has, labelled `unit` (or plain, -1). */
        int put(int unit, String keyset, long amount) {
            ResponseAPDU r = unit < 0 ? load(piece(keyset, amount)) : loadAs(unit, piece(keyset, amount));
            assertEquals(SW_OK, r.getSW(), "the load of " + keyset);
            return r.getData()[0] & 0xFF;
        }

        /** SPEND_ALL_BEGIN as a reader that reads units sends it (P1 = 03): a payment in the other unit than the card's is taken. */
        ResponseAPDU begin(int... places) { return beginAs(CashuAppletTest.BEGIN_UNITS, places); }
        /** SPEND_ALL_BEGIN with P1 bit 1 and `units`: 0 is a reader that reads no unit, which pays no piece of the other unit (6A9B). */
        ResponseAPDU beginAs(int units, int... places) { return send(CashuAppletTest.spendBegin(units, list(places))); }
        /** SPEND_ALL_BEGIN with this P1 as it is: without bit 1 (02), a reader that builds the secrets with the card key alone. */
        ResponseAPDU beginRaw(int p1, int... places) { return send(new CommandAPDU(CLA, INS_SPEND_ALL_BEGIN, p1, 0, list(places), 0x45)); }
        static byte[] list(int... places) {
            byte[] list = new byte[places.length];
            for (int i = 0; i < places.length; i++) list[i] = (byte) places[i];
            return list;
        }
        /** How many "not yet" the last sign() was given. */
        int waits;
        ResponseAPDU sign() {
            waits = 0;
            for (int i = 0; i <= WAITS_MOST; i++) {
                ResponseAPDU r = send(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64));
                if (!(r.getSW() == SW_OK && r.getData().length == 2)) return r;
                waits++;
            }
            fail("a payment still waiting past the most");
            return null;
        }
        ResponseAPDU pay(int... places) {
            ResponseAPDU begun = begin(places);
            if (begun.getSW() != SW_OK) return begun;
            return sign();
        }

        byte[] info(int p1) { return send(new CommandAPDU(CLA, INS_GET_INFO, p1, 0, 256)).getData(); }
        byte[] getCard(int p1) { return send(new CommandAPDU(CLA, INS_GET_CARD, p1, 0, 256)).getData(); }
        byte[] balance(int p1) { return send(new CommandAPDU(CLA, INS_GET_BALANCE, p1, 0, 256)).getData(); }
        ResponseAPDU log(int p1) { return send(new CommandAPDU(CLA, INS_GET_LOG, p1, 0, 256)); }
        int count() { return send(new CommandAPDU(CLA, INS_GET_PROOF_COUNT, 0, 0, 1)).getData()[0] & 0xFF; }
        int clearSpent() { return sw(new CommandAPDU(CLA, INS_CLEAR_SPENT, 0, 0, 1)); }
        byte[] slot(int place) { return send(new CommandAPDU(CLA, INS_GET_PROOF, place, 0, 256)).getData(); }

        Object applet() { return runtime.appletAt(aid); }
        byte[] field(String name) throws Exception {
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
            f.setAccessible(true);
            return (byte[]) f.get(applet());
        }
        void setField(String name, byte[] value) throws Exception {
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
            f.setAccessible(true);
            f.set(applet(), value);
        }
        byte[] book() throws Exception { return field("book"); }
        byte[] record() throws Exception { return field("cardRecord"); }
        /** The state byte of the entry whose keyset is `keyset`, or -1 where none in use has it. */
        int stateOf(String keyset) throws Exception {
            int e = entryOf(keyset);
            return e < 0 ? -1 : book()[e * ENTRY + 8] & 0xFF;
        }
        /** Which entry holds `keyset`, or -1. */
        int entryOf(String keyset) throws Exception {
            byte[] b = book(), k = hexToBytes(keyset);
            for (int e = 0; e < 6; e++) {
                if ((b[e * ENTRY + 8] & 0x40) != 0 && Arrays.equals(Arrays.copyOfRange(b, e * ENTRY, e * ENTRY + 8), k)) return e;
            }
            return -1;
        }
        int inUse() throws Exception {
            int n = 0;
            byte[] b = book();
            for (int e = 0; e < 6; e++) if ((b[e * ENTRY + 8] & 0x40) != 0) n++;
            return n;
        }
        long rate() throws Exception { return readUint32(record(), RATE_AT); }
        /** What the day has signed for, as the card keeps it (GET_INFO says it to a reader told: HistoryPrivacyTest). */
        long spentToday() {
            try {
                return readUint32(record(), CashuApplet.CARD_SPENT_OFFSET);
            } catch (Exception x) {
                throw new AssertionError(x);
            }
        }
        /** Every array of the card that lasts, copied. */
        Map<String, byte[]> snapshot() throws Exception {
            Map<String, byte[]> m = new HashMap<>();
            for (String n : new String[] { "proofStorage", "slotHex", "dleq", "book", "cardRecord", "cardLog", "cardReceipts", "openState", "changeOpen", "openKeys" }) {
                byte[] a = field(n);
                m.put(n, a == null ? null : a.clone());
            }
            return m;
        }
        void assertUnchanged(Map<String, byte[]> before, String what) throws Exception {
            for (Map.Entry<String, byte[]> e : before.entrySet()) assertArrayEquals(e.getValue(), field(e.getKey()), what + ": " + e.getKey());
        }
    }

    /** SET_CARD's data in `unit`: the record a phone writes, its first byte the unit. */
    static byte[] recordIn(int unit) {
        byte[] r = record(MINT, REFUND);
        r[0] = (byte) unit;
        return r;
    }
    static Card owned(int unit) { return new Card().ready(unit, true); }

    /** ceil(x * m / d), as the card works it out, and past four bytes FF FF FF FF. */
    static long turned(long x, long m, long d) {
        BigInteger[] qr = BigInteger.valueOf(x).multiply(BigInteger.valueOf(m)).divideAndRemainder(BigInteger.valueOf(d));
        BigInteger c = qr[1].signum() == 0 ? qr[0] : qr[0].add(BigInteger.ONE);
        return c.bitLength() > 32 ? 0xFFFFFFFFL : c.longValue();
    }

    /** The applet's own turning (`turn`), run on its own scratch, with the card's unit and a rate written into its record. */
    static long cardTurns(Card c, int cardUnit, long x, long rate) throws Exception {
        byte[] rec = c.record(), scratch = c.field("scratch");
        rec[CashuApplet.CARD_UNIT_OFFSET] = (byte) cardUnit;
        System.arraycopy(u32(rate), 0, rec, RATE_AT, 4);
        System.arraycopy(u32(x), 0, scratch, 0, 4);
        java.lang.reflect.Method m = CashuApplet.class.getDeclaredMethod("turn", short.class);
        m.setAccessible(true);
        m.invoke(c.applet(), (short) 0);
        return readUint32(scratch, 0);
    }

    // =========================================================================
    // The table
    // =========================================================================

    @Test
    @DisplayName("The table is not made at install and is made by the first SET_CARD: null after install, after a PIN, after a SET_CARD refused and after one of a unit the card does not know (6A80); 267 zero bytes after the first that goes through; the same array after every later one")
    void theTableIsMadeByTheFirstSetCard() throws Exception {
        Card c = new Card();
        assertNull(c.book(), "the chip will not have it in the constructor: it is not made at install");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertNull(c.book(), "a PIN makes nothing");
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, new byte[10])), "a SET_CARD refused");
        assertNull(c.book(), "makes nothing");
        for (int unit : new int[] { 2, 0x80, 0xFF }) {
            assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, recordIn(unit))), "a unit the card does not know: " + unit);
            assertNull(c.book());
            assertEquals(0, c.record()[CashuApplet.CARD_SET_OFFSET], "and no record");
        }
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, recordIn(SAT))));
        byte[] book = c.book();
        assertNotNull(book, "the first SET_CARD that goes through makes it");
        assertEquals(TABLE_LEN, book.length, "six entries of 41 (the keyset, the state, the top), the last unit (1), the other unit's count (4), the receipts' units (16)");
        assertArrayEquals(new byte[TABLE_LEN], book, "all zeros: every entry free");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, recordIn(USD))));
        assertSame(book, c.book(), "a second SET_CARD makes no other");
        assertEquals(USD, c.record()[CashuApplet.CARD_UNIT_OFFSET], "and a usd record is taken");
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)));
        c.tap();
        byte[] rec = recordIn(SAT);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(c.proofFor(L_CARD, rec), rec))));
        assertSame(book, c.book(), "nor the owner's");
    }

    @Test
    @DisplayName("A card refused its table is a card of one unit: plain loads go on as its unit, a load labelled the other unit is 6A9C even with the holder's say, byte 8 is 4, P1 = 3 byte 43 and GET_CARD P1 = 2 are 00, and a rate is still taken and read back")
    void aCardRefusedItsTableIsACardOfOneUnit() throws Exception {
        Card c = owned(SAT);
        // jCardSim cannot be made to refuse an allocation: the table is left null, as the catch around it leaves it on a chip that refuses the room
        c.setField("book", null);
        assertEquals(SW_OK, c.load(c.piece(SAT_A, 10)).getSW(), "a plain load: the card's unit");
        assertEquals(SW_OK, c.loadAs(SAT, c.piece(SAT_B, 20)).getSW(), "a load labelled the card's unit is a plain one");
        assertEquals(SW_OK, c.load(c.piece(SAT_C, 5)).getSW(), "and a third keyset: no table, no count of entries");
        c.grant();
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_NO_TABLE_ROOM, c.loadAs(USD, c.piece(USD_A, 5)).getSW(), "the other unit has no table to go in, even with the holder's say");
        c.assertUnchanged(before, "and nothing is written");
        assertEquals(4, c.info(0)[8], "a card of one unit");
        byte[] three = c.info(3);
        assertEquals(51, three.length);
        assertEquals(0, three[43], "no table");
        assertEquals(0, three[48]);
        assertEquals(0, three[49]);
        assertEquals(0, three[50]);
        assertArrayEquals(new byte[] { 0 }, c.getCard(2), "and no entries");
        assertEquals(4, c.getCard(0)[0]);
        assertArrayEquals(new byte[] { 1, 0, 3, 0, 0, 0, 35 }, c.balance(1), "one unit, sat: three pieces, 35");
        assertEquals(SW_OK, c.limits(0, 100, 0, 7, 1000), "a rate is still taken: it lives in the record");
        c.grant();
        assertEquals(1000, readUint32(c.info(3), 44), "and read back");
        c.tap();
        assertEquals(64, c.pay(0).getData().length, "and a payment in the card's unit goes as it did");
        assertNull(c.book(), "none of that made it");
    }

    @Test
    @DisplayName("A usd card refused its table is a usd card in every way: its pieces are cents in GET_BALANCE P1 = 0 and 1, and a payment of them is of the card's unit, held to a daily limit set with no rate and counted as it is, never 6A99")
    void aUsdCardRefusedItsTableIsAUsdCard() throws Exception {
        Card d = owned(USD);
        d.setField("book", null);
        int p = d.put(-1, USD_A, 120);
        d.put(-1, USD_A, 30);
        assertArrayEquals(u32(150), d.balance(0), "its own unit's sum");
        assertArrayEquals(new byte[] { 1, 1, 2, 0, 0, 0, (byte) 150 }, d.balance(1), "one unit, usd: two pieces, 150 cents");
        assertEquals(SW_OK, d.limits(1000, 0, 0, 7, 0), "a daily limit of 1,000 cents and no rate");
        d.tap();
        assertEquals(64, d.pay(p).getData().length, "a payment in the card's own unit needs no rate");
        assertEquals(120, d.spentToday(), "and is counted as it is");
    }

    @Test
    @DisplayName("A plain load enters its keyset as the card's unit: 40 on a sat card and 41 on a usd card under the PIN alone; C0 and C1 with the owner's grant too; a second piece of the keyset writes nothing in the table; the keyset's eight bytes as the piece holds them")
    void aPlainLoadEntersItsKeysetAsTheCardsUnit() throws Exception {
        Card s = owned(SAT);
        s.put(-1, SAT_A, 10);
        assertEquals(0x40, s.stateOf(SAT_A), "sat, entered with no say");
        byte[] book = s.book().clone();
        s.put(-1, SAT_A, 20);
        assertArrayEquals(book, s.book(), "a second piece of it writes nothing in the table");
        s.grant();
        s.put(-1, SAT_B, 5);
        assertEquals(0xC0, s.stateOf(SAT_B), "with the grant: marked");
        Card d = owned(USD);
        d.put(-1, USD_A, 10);
        assertEquals(0x41, d.stateOf(USD_A), "usd, on a usd card");
        d.grant();
        d.put(-1, USD_B, 10);
        assertEquals(0xC1, d.stateOf(USD_B));
        assertArrayEquals(hexToBytes(USD_A), Arrays.copyOfRange(d.book(), 0, 8), "the keyset's eight bytes, as the piece holds them");
        assertArrayEquals(new byte[32], Arrays.copyOfRange(d.book(), 9, 41), "and no top: its keys are not known (bit 1 clear)");
    }

    @Test
    @DisplayName("The other unit needs the holder's say: a new keyset labelled the other unit is 6A9D under the PIN alone, with or without the mint's proof, nothing written; under the PIN and the owner's grant it is entered, marked")
    void theOtherUnitNeedsTheHoldersSay() throws Exception {
        Card c = owned(SAT);
        c.put(-1, SAT_A, 10);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_NOT_THIS_TAP, c.loadAs(USD, c.piece(USD_A, 5)).getSW(), "the PIN alone: not this tap's to start");
        assertEquals(SW_NOT_THIS_TAP, c.loadAsWithProof(USD, c.piece(USD_A, 5), dleqProof(3)).getSW(), "with the mint's proof as well");
        c.assertUnchanged(before, "nothing written");
        assertEquals(1, c.count());
        c.grant();
        c.put(USD, USD_A, 5);
        assertEquals(0xC1, c.stateOf(USD_A), "the PIN and the owner's grant: entered, marked");
        Card d = owned(USD);
        d.put(-1, USD_A, 10);
        before = d.snapshot();
        assertEquals(SW_NOT_THIS_TAP, d.loadAs(SAT, d.piece(SAT_A, 5)).getSW(), "and on a usd card, sat is the other unit");
        d.assertUnchanged(before, "nothing written");
    }

    @Test
    @DisplayName("A till may enter a new keyset of the last payment's unit: after a usd payment on a sat card, the PIN alone enters a new usd keyset, unmarked; after a sat payment it is 6A9D again; after SET_CARD the last unit is forgotten")
    void aTillMayEnterTheLastPaymentsUnit() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int usd = c.put(USD, USD_A, 50);
        int sat = c.put(-1, SAT_A, 70);
        c.tap();
        assertEquals(64, c.pay(usd).getData().length, "a usd payment");
        assertEquals((byte) 0xA0, c.book()[LAST_AT], "the last payment's unit: the other");
        c.tap();
        c.put(USD, USD_B, 10);
        assertEquals(0x41, c.stateOf(USD_B), "the PIN alone enters a keyset of the last payment's unit, unmarked");
        assertEquals(64, c.pay(sat).getData().length, "a sat payment");
        assertEquals((byte) 0x80, c.book()[LAST_AT], "the last payment's unit: the card's");
        c.tap();
        assertEquals(SW_NOT_THIS_TAP, c.loadAs(USD, c.piece(USD_C, 5)).getSW(), "a new usd keyset wants the say again");
        // SET_CARD on an empty card forgets the last unit
        Card e = owned(SAT);
        e.grant();
        int p = e.put(USD, USD_A, 20);
        e.tap();
        assertEquals(64, e.pay(p).getData().length);
        assertEquals(SW_OK, e.clearSpent());
        byte[] rec = recordIn(SAT);
        assertEquals(SW_OK, e.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(e.proofFor(L_CARD, rec), rec))));
        assertEquals(0, e.book()[LAST_AT], "forgotten with the record");
        e.tap();
        assertEquals(SW_NOT_THIS_TAP, e.loadAs(USD, e.piece(USD_B, 5)).getSW());
    }

    @Test
    @DisplayName("A keyset is never entered as both units: a piece of a keyset entered as sat, labelled usd, is 6A9B, plain or labelled, with the mint's proof or without, the holder's say or not; nothing written; and the other way round")
    void aKeysetIsNeverBothUnits() throws Exception {
        Card c = owned(SAT);
        c.put(-1, SAT_A, 10);
        c.grant();
        c.put(USD, USD_A, 10);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_OTHER_UNIT, c.loadAs(USD, c.piece(SAT_A, 5)).getSW(), "a sat keyset labelled usd");
        assertEquals(SW_OTHER_UNIT, c.loadAsWithProof(USD, c.piece(SAT_A, 5), dleqProof(4)).getSW(), "with the proof");
        assertEquals(SW_OTHER_UNIT, c.load(c.piece(USD_A, 5)).getSW(), "a usd keyset loaded plain, which is sat on this card");
        assertEquals(SW_OTHER_UNIT, c.loadAs(SAT, c.piece(USD_A, 5)).getSW(), "or labelled sat");
        c.assertUnchanged(before, "nothing written");
        assertEquals(2, c.count());
    }

    @Test
    @DisplayName("A bad label is refused before anything is written: unit 02 is 6A80; P2 = 4, 80 and FF are 6B00; 82, 163, 244 and (P1 = 1) 178 bytes are taken with P2 = 1, every other labelled length 6700; a full card says 6A84 before the P2")
    void aBadLabelIsRefusedBeforeAnythingIsWritten() throws Exception {
        Card c = owned(SAT);
        c.put(-1, SAT_A, 10);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_WRONG_DATA, c.loadAs(2, c.piece(SAT_A, 5)).getSW(), "unit 02");
        assertEquals(SW_WRONG_DATA, c.loadAs(0xFF, c.piece(SAT_A, 5)).getSW(), "unit FF");
        for (int p2 : new int[] { 4, 0x80, 0xFF }) {
            assertEquals(SW_WRONG_P1P2, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, p2, concat(new byte[] { 0 }, c.piece(SAT_A, 5)), 256)), "P2 = " + p2);
        }
        for (int len : new int[] { 81, 83, 162, 164, 243, 245 }) {
            assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 3, new byte[len], 256)), "labelled, " + len + " bytes");
        }
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 1, 3, new byte[177], 256)), "P1 = 1 labelled, 177 bytes");
        c.assertUnchanged(before, "nothing written");
        assertEquals(SW_OK, c.loadAs(SAT, c.piece(SAT_A, 1), c.piece(SAT_A, 2), c.piece(SAT_A, 3)).getSW(), "244 bytes: three labelled pieces");
        assertEquals(SW_OK, c.loadAsWithProof(SAT, c.piece(SAT_A, 4), dleqProof(5)).getSW(), "178 bytes with the proof");
    }

    @Test
    @DisplayName("A labelled load reads its pieces one byte on: three labelled pieces each hold their own 81 bytes; P1 = 1 and P2 = 1 keep the proof sent after the piece; the log's put on is the pieces' sum")
    void aLabelledLoadReadsOneByteOn() throws Exception {
        Card c = owned(SAT);
        byte[] a = c.piece(SAT_A, 11), b = c.piece(SAT_A, 22), d = c.piece(SAT_A, 33);
        ResponseAPDU r = c.loadAs(SAT, a, b, d);
        assertEquals(SW_OK, r.getSW());
        assertArrayEquals(new byte[] { 0, 1, 2 }, r.getData());
        assertArrayEquals(concat(new byte[] { 1 }, a), c.slot(0));
        assertArrayEquals(concat(new byte[] { 1 }, b), c.slot(1));
        assertArrayEquals(concat(new byte[] { 1 }, d), c.slot(2));
        byte[] proof = dleqProof(9), e = c.piece(SAT_A, 44);
        ResponseAPDU p = c.loadAsWithProof(SAT, e, proof);
        assertEquals(SW_OK, p.getSW());
        assertArrayEquals(new byte[] { 3, 1 }, p.getData(), "its place, and its proof kept");
        assertArrayEquals(concat(new byte[] { 1 }, e), c.slot(3));
        assertArrayEquals(proof, Arrays.copyOfRange(c.field("dleq"), 3 * 96, 4 * 96), "the proof after the piece, as sent");
        byte[] log = c.log(0).getData();
        assertEquals(4, log[16 + 11], "four pieces put on in the tap");
        assertEquals(110, readUint32(log, 16 + 12), "and their sum");
    }

    @Test
    @DisplayName("The table holds six and reclaims the dead first: a seventh keyset with every entry live is 6A9C, nothing written; with one dead it goes in, in the dead one's place")
    void theTableHoldsSixAndReclaimsTheDeadFirst() throws Exception {
        Card c = owned(SAT);
        c.grant();
        String[] six = { SAT_A, SAT_B, SAT_C, USD_A, USD_B, USD_C };
        int[] places = new int[6];
        for (int i = 0; i < 6; i++) places[i] = c.put(i < 3 ? SAT : USD, six[i], 10 + i);
        assertEquals(6, c.inUse());
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_NO_TABLE_ROOM, c.loadAs(SAT, c.piece("00aa000000000009", 5)).getSW(), "a seventh with every entry live");
        c.assertUnchanged(before, "nothing written: the reclaim found nothing dead");
        int deadEntry = c.entryOf(SAT_B);
        c.tap();
        assertEquals(64, c.pay(places[1]).getData().length, "SAT_B's only piece paid: its entry is dead, still in use until a reclaim");
        assertEquals(6, c.inUse());
        c.grant();
        c.put(SAT, "00aa000000000009", 5);
        assertEquals(deadEntry, c.entryOf("00aa000000000009"), "it goes in the dead one's place");
        assertEquals(-1, c.entryOf(SAT_B), "and the dead one is gone");
        assertEquals(6, c.inUse());
    }

    @Test
    @DisplayName("No more than two live entries without the mark: a third unmarked is 6A9C; marked ones still go in; with an unmarked one dead, a new unmarked keyset goes in after the reclaim; a load of a keyset already entered runs no reclaim")
    void noMoreThanTwoUnmarked() throws Exception {
        Card c = owned(SAT);
        int a = c.put(-1, SAT_A, 10);
        c.put(-1, SAT_B, 10);
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_NO_TABLE_ROOM, c.load(c.piece(SAT_C, 10)).getSW(), "a third unmarked");
        c.assertUnchanged(before, "nothing written");
        c.grant();
        c.put(-1, SAT_C, 10);
        assertEquals(0xC0, c.stateOf(SAT_C), "marked, it goes in");
        assertEquals(3, c.inUse());
        c.tap();
        assertEquals(64, c.pay(a).getData().length, "SAT_A's piece paid: an unmarked entry is dead");
        // a load of a keyset already entered: no reclaim, and the dead entry stays
        c.put(-1, SAT_B, 3);
        assertEquals(0x40, c.stateOf(SAT_A), "a load of a keyset entered runs no reclaim");
        c.put(-1, "00aa000000000009", 5);
        assertEquals(-1, c.entryOf(SAT_A), "a new unmarked one goes in after the reclaim frees the dead one");
        assertEquals(0x40, c.stateOf("00aa000000000009"));
    }

    @Test
    @DisplayName("CLEAR_SPENT frees what no piece and no opening names: after a payment of every piece of a keyset its entry is free; one named by an owed opening is not, until the change is back and spent")
    void clearSpentFreesWhatNothingNames() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u = c.put(USD, USD_A, 50);
        int s = c.put(-1, SAT_A, 70);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(-1, c.entryOf(USD_A), "every usd piece paid: its entry is free");
        assertEquals(0xC0, c.stateOf(SAT_A), "a live one stays");
        assertEquals(4, c.info(0)[8], "one unit again");
        // an opening of change keeps its keyset's entry
        assertEquals(SW_OK, c.begin(s).getSW());
        assertEquals(SW_OK, c.send(changeCommand(30, mintKey(), hexToBytes(SAT_A))).getSW());
        assertEquals(64, c.sign().getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(0xC2, c.stateOf(SAT_A), "the owed change's keyset (taught: a change is made only in a taught keyset) is named by its opening: kept");
        byte[] rows = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData();
        CashuAppletTest.shownByHand(c.field("openKeys"), rows[1]);   // KEYSET_KEYS P1 = 3's mark, by hand (CashuAppletTest.loadChange)
        ResponseAPDU back = c.send(loadChangeCommand(rows[1], mintAnswer(Arrays.copyOfRange(rows, 18, 51))));
        assertEquals(SW_OK, back.getSW(), "the change comes back");
        assertEquals(0xC2, c.stateOf(SAT_A), "its piece names it now");
    }

    @Test
    @DisplayName("A torn entry is freed and never serves: an entry whose keyset was written and whose state byte was not is free; one whose state byte was written and whose piece's status byte was not is let go by the next reclaim; the format reads 4 again after it")
    void aTornEntryIsFreed() throws Exception {
        Card c = owned(SAT);
        c.put(-1, SAT_A, 10);
        byte[] book = c.book();
        // torn before the state byte: the keyset is in entry 1, its state 00
        System.arraycopy(hexToBytes(USD_A), 0, book, ENTRY, 8);
        assertEquals(-1, c.entryOf(USD_A), "an entry with no state byte is free");
        assertEquals(4, c.info(0)[8]);
        c.grant();
        c.put(USD, USD_B, 5);
        assertEquals(1, c.entryOf(USD_B), "and the next new keyset takes it whole");
        // torn after the state byte and before the place's: a live entry nothing names
        book[2 * ENTRY + 8] = 0x41;
        System.arraycopy(hexToBytes(USD_C), 0, book, 2 * ENTRY, 8);
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(-1, c.entryOf(USD_C), "the reclaim lets it go");
        assertEquals(0xC1, c.stateOf(USD_B), "and nothing live");
        assertEquals(0x40, c.stateOf(SAT_A));
    }

    @Test
    @DisplayName("SET_CARD lets the table go: an opening drafted for a payment never signed keeps its keyset's entry through a reclaim, and SET_CARD lets it go first, then every entry; the last unit 00; the receipts' units and the other unit's count stay; the rate and every limit stay")
    void setCardLetsTheTableGo() throws Exception {
        Card c = owned(SAT);
        assertEquals(SW_OK, c.limits(0, 0, 0, 7, 1000));
        c.grant();
        int u = c.put(USD, USD_A, 50);
        int s = c.put(-1, SAT_A, 10);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        c.tap();
        assertEquals(64, c.pay(s).getData().length);
        // a draft that names SAT_A, as a payment begun and never signed leaves one (set by hand: no command leaves one on an empty card)
        byte[] open = c.field("changeOpen"), state = c.field("openState");
        System.arraycopy(hexToBytes(SAT_A), 0, open, CashuApplet.OPEN_KEYSET, 8);
        state[0] = CashuApplet.OPEN_DRAFT;
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(-1, c.entryOf(USD_A), "nothing names USD_A");
        assertEquals(0xC0, c.stateOf(SAT_A), "the draft names SAT_A: kept");
        byte[] book = c.book().clone();
        assertEquals(50, readUint32(book, OTHER_AT));
        assertEquals((byte) 0xA0, book[UNITS_AT]);
        assertEquals((byte) 0x80, book[UNITS_AT + 1]);
        assertEquals((byte) 0x80, book[LAST_AT]);
        byte[] rec = recordIn(USD);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(c.proofFor(L_CARD, rec), rec))));
        assertEquals(CashuApplet.OPEN_EMPTY, c.field("openState")[0], "the draft let go");
        assertEquals(0, c.inUse(), "and then every entry");
        assertEquals(0, c.book()[LAST_AT], "and the last unit forgotten");
        assertArrayEquals(Arrays.copyOfRange(book, OTHER_AT, TABLE_LEN), Arrays.copyOfRange(c.book(), OTHER_AT, TABLE_LEN), "the other unit's count and the receipts' units stay");
        assertEquals(1000, c.rate(), "the rate stays");
    }

    @Test
    @DisplayName("RESET_CARD zeros the table and the rate: the table all zeros, the same array; the rate zeros with the record")
    void resetCardZerosTheTableAndTheRate() throws Exception {
        Card c = owned(SAT);
        assertEquals(SW_OK, c.limits(0, 0, 0, 7, 1234));
        c.grant();
        int u = c.put(USD, USD_A, 50);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        byte[] book = c.book();
        assertTrue(readUint32(book, OTHER_AT) > 0);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertSame(book, c.book(), "the same array");
        assertArrayEquals(new byte[TABLE_LEN], c.book(), "all zeros");
        assertEquals(0, c.rate(), "and the rate");
    }

    // =========================================================================
    // Payments
    // =========================================================================

    @Test
    @DisplayName("One unit a payment (6A9A): both units in one BEGIN, first or second; two keysets of one unit pay together; a place whose entry is gone is 6A9A, first or not, and is never paid as the card's unit")
    void oneUnitAPayment() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int s1 = c.put(-1, SAT_A, 10), s2 = c.put(-1, SAT_B, 20), u = c.put(USD, USD_A, 30);
        c.tap();
        assertEquals(SW_TWO_UNITS, c.begin(s1, u).getSW(), "sat then usd");
        assertEquals(SW_TWO_UNITS, c.begin(u, s1).getSW(), "usd then sat");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "no payment begun");
        ResponseAPDU two = c.begin(s1, s2);
        assertEquals(SW_OK, two.getSW(), "two keysets of one unit");
        assertEquals(30, readUint32(two.getData(), 0));
        assertEquals(64, c.sign().getData().length, "signed once");
        // an entry gone (zeroed by hand): its place is of no unit
        int s3 = c.put(-1, SAT_A, 40);
        c.book()[c.entryOf(SAT_A) * ENTRY + 8] = 0;
        assertEquals(SW_TWO_UNITS, c.begin(s3).getSW(), "first");
        assertEquals(SW_TWO_UNITS, c.begin(u, s3).getSW(), "or after another");
    }

    @Test
    @DisplayName("The turning agrees with BigInteger everywhere: sats into cents on a usd card, ceil(S x 100 / R), and cents into sats on a sat card, ceil(C x R / 100); thousands of random figures and every edge, saturated at four bytes; never under")
    void theTurningAgreesWithBigInteger() throws Exception {
        Card c = owned(SAT);
        long[] edges = { 0, 1, 2, 99, 100, 101, 999, 1000, 1001, 0xFFFFL, 0x10000L, 0xFFFFFFL, 0x7FFFFFFFL, 0x80000000L, 0xFFFFFFFEL, 0xFFFFFFFFL };
        for (long x : edges) {
            for (long r : edges) {
                if (r == 0) continue;
                assertEquals(turned(x, 100, r), cardTurns(c, USD, x, r), "sats " + x + " at " + r + " into cents");
                assertEquals(turned(x, r, 100), cardTurns(c, SAT, x, r), "cents " + x + " at " + r + " into sats");
            }
        }
        Random rnd = new Random(184);
        for (int i = 0; i < 4000; i++) {
            long x = rnd.nextInt() & 0xFFFFFFFFL, r = (rnd.nextInt() & 0xFFFFFFFFL) | 1L;
            if (i % 3 == 0) x &= 0xFFFFF;
            if (i % 2 == 0) r &= 0x3FFFF;
            if (r == 0) r = 1;
            assertEquals(turned(x, 100, r), cardTurns(c, USD, x, r), "sats " + x + " at " + r);
            assertEquals(turned(x, r, 100), cardTurns(c, SAT, x, r), "cents " + x + " at " + r);
        }
        assertEquals(1, cardTurns(c, USD, 1, 1000), "1 sat at 1,000 is a cent");
        assertEquals(101, cardTurns(c, USD, 1001, 1000), "1,001 sats are 101 cents");
        assertEquals(10, cardTurns(c, SAT, 1, 1000), "a cent at 1,000 sats to the dollar is 10 sats");
        assertEquals(11, cardTurns(c, SAT, 1, 1001), "and at 1,001, 11: rounded up");
        assertEquals(0xFFFFFFFFL, cardTurns(c, SAT, 0xFFFFFFFFL, 101), "past four bytes: over every limit");
    }

    @Test
    @DisplayName("A payment in the other unit with a limit set and no rate (a state SET_LIMIT refuses to leave) is 6A99 at the first SIGN, before the PIN's gate: nothing signed, burned, counted or logged, the payment given up; with no limit set it signs; a payment in the card's unit never asks for a rate")
    void anotherUnitWithALimitAndNoRateIs6A99() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u = c.put(USD, USD_A, 30);
        int s = c.put(-1, SAT_A, 30);
        assertEquals(SW_NO_RATE, c.limits(1000, 0, 0, 7, 0), "a daily limit with no rate is refused while usd is held");
        /* the state itself, which no command leaves any more: a day's limit and the rate gone (written here), kept as the
         * payment's own guard */
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 1000));
        java.util.Arrays.fill(c.record(), RATE_AT, RATE_AT + 4, (byte) 0);
        c.power();                     // no PIN: the 6A99 comes before the PIN would be asked
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_OK, c.begin(u).getSW());
        assertEquals(SW_NO_RATE, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)));
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment given up");
        c.assertUnchanged(before, "nothing written");
        c.pin();
        assertEquals(SW_OK, c.begin(u).getSW());
        assertEquals(SW_NO_RATE, c.sign().getSW(), "with the PIN the same");
        assertEquals(64, c.pay(s).getData().length, "a sat payment never asks for a rate");
        assertEquals(SW_OK, c.limits(0, 0, 0, 7, 0), "no limit at all");
        c.tap();
        assertEquals(64, c.pay(u).getData().length, "and a usd payment signs");
    }

    @Test
    @DisplayName("The day counts the other unit at the rate, rounded up: on a sat card at 1,000 sats to the dollar a usd payment of 33 cents is 330 sats of the day, sat and usd payments add up in one spent-today, 6A8F past the limit with nothing counted, written in an entry of the payment's unit")
    void theDayCountsTheOtherUnitAtTheRate() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u1 = c.put(USD, USD_A, 33), u2 = c.put(USD, USD_A, 60), s1 = c.put(-1, SAT_A, 100);
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 1000));
        c.tap();
        assertEquals(64, c.pay(u1).getData().length);
        assertEquals(330, c.spentToday(), "33 cents at 1,000 sats to the dollar");
        c.tap();
        assertEquals(64, c.pay(s1).getData().length);
        assertEquals(430, c.spentToday(), "and 100 sats");
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(u2).getSW(), "60 cents are 600 sats: 1,030 is past 1,000");
        assertEquals(430, c.spentToday(), "nothing counted");
        byte[] log = c.log(0).getData();
        assertEquals(1, log[16 + 9], "the refusal");
        assertEquals(0x20, log[16 + 10] & 0x20, "in an entry of the other unit");
    }

    @Test
    @DisplayName("The other unit is rounded up, never down: at 999 sats to the dollar a cent is 10 sats, so a day of 9 sats refuses it and a day of 10 takes it; 100 cents are 999 sats, within a day of 999")
    void theOtherUnitIsRoundedUp() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u = c.put(USD, USD_A, 1), w = c.put(USD, USD_A, 100);
        assertEquals(SW_OK, c.limits(9, 0, 0, 7, 999), "a day of 9 sats, 999 sats to the dollar");
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(u).getSW(), "a cent is 9.99 sats: 10, over 9");
        assertEquals(SW_OK, c.limits(10, 0, 0, 7, 999));
        c.tap();
        assertEquals(64, c.pay(u).getData().length, "within 10");
        assertEquals(10, c.spentToday());
        assertEquals(SW_OK, c.limits(999, 0, 0, 7, 999), "a new day's number: a new window");
        c.tap();
        assertEquals(64, c.pay(w).getData().length, "100 cents are 999 sats exactly");
        assertEquals(999, c.spentToday());
    }

    @Test
    @DisplayName("The wait is worked out in the card's unit: on a sat card with a limit on one payment of 1,000 sats at 1,000 sats to the dollar, a usd payment of 100 cents waits nothing, one of 200 cents waits ten")
    void theWaitIsWorkedOutInTheCardsUnit() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u1 = c.put(USD, USD_A, 100), u2 = c.put(USD, USD_A, 200);
        assertEquals(SW_OK, c.limits(0, 1000, 0, 7, 1000));
        c.tap();
        assertEquals(64, c.pay(u1).getData().length);
        assertEquals(waitsRule(1000, 1000, 0), c.waits, "100 cents are 1,000 sats: within the limit");
        c.tap();
        assertEquals(64, c.pay(u2).getData().length);
        assertEquals(waitsRule(1000, 2000, 0), c.waits, "200 cents are 2,000 sats: one limit's worth over");
        assertTrue(c.waits > 0);
        // a usd card: the limit in cents, a sat payment turned
        Card d = owned(USD);
        d.grant();
        int s = d.put(SAT, SAT_A, 3000);
        assertEquals(SW_OK, d.limits(0, 100, 0, 7, 1000));
        d.tap();
        assertEquals(64, d.pay(s).getData().length);
        assertEquals(waitsRule(100, 300, 0), d.waits, "3,000 sats at 1,000 to the dollar are 300 cents");
        assertTrue(d.waits > 0);
    }

    @Test
    @DisplayName("The no-PIN allowance counts the other unit at the rate: on a sat card with an allowance of 500 sats at 1,000 sats to the dollar, a usd payment of 40 cents goes with no PIN, and one of 20 more is past it (6A9E, D186)")
    void theAllowanceCountsTheOtherUnitAtTheRate() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u1 = c.put(USD, USD_A, 40), u2 = c.put(USD, USD_A, 20);
        assertEquals(SW_OK, c.limits(0, 0, 500, 7, 1000));
        c.power();
        assertEquals(64, c.pay(u1).getData().length, "400 sats with no PIN");
        c.power();
        assertEquals(CashuAppletTest.SW_ENTER_PIN, c.pay(u2).getSW(), "200 more is past 500");
    }

    @Test
    @DisplayName("A sat payment on a usd card is turned into cents: a daily limit of 100 cents at 1,000 sats to the dollar takes 1,000 sats, and 1,001 sats are 101 cents, over it")
    void aUsdCardTurnsSats() throws Exception {
        Card d = owned(USD);
        d.grant();
        int s1 = d.put(SAT, SAT_A, 1000), s2 = d.put(SAT, SAT_A, 1);
        int c1 = d.put(-1, USD_A, 1);
        assertEquals(SW_OK, d.limits(100, 0, 0, 7, 1000));
        d.tap();
        assertEquals(64, d.pay(s1).getData().length);
        assertEquals(100, d.spentToday(), "1,000 sats are 100 cents");
        assertEquals(SW_OVER_LIMIT, d.pay(s2).getSW(), "one sat more is a cent more, rounded up");
        assertEquals(SW_OVER_LIMIT, d.pay(c1).getSW(), "and a cent of the card's own");
    }

    // =========================================================================
    // SET_LIMIT, one layout
    // =========================================================================

    @Test
    @DisplayName("SET_LIMIT has one layout of 4, 8, 12, 13 or 17 bytes in both forms: the rate at 13 to 16; the proof binds it; a rate alone changed begins no window and keeps every count; the budget is checked in the seventeen as in the thirteen; 2.2's lengths leave the rate as it is; every other length 6700")
    void setLimitHasOneLayout() throws Exception {
        Card c = owned(SAT);
        c.put(-1, SAT_A, 100);
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 1000));
        assertEquals(1000, c.rate());
        c.tap();
        assertEquals(64, c.pay(0).getData().length);
        long window = readUint32(c.info(0), 21), spent = c.spentToday();
        assertEquals(100, spent);
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 2000), "the rate alone changed");
        assertEquals(2000, c.rate());
        assertEquals(window, readUint32(c.info(0), 21), "no window begun");
        assertEquals(spent, c.spentToday(), "and the count kept");
        // the proof binds the rate
        byte[] v = concat(u32(1000), u32(0), u32(0), new byte[] { 7 }, u32(3000));
        byte[] proof = c.proofFor(L_LIMIT, concat(u32(1000), u32(0), u32(0), new byte[] { 7 }, u32(4000)));
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(proof, v))), "a proof for one rate is none for another");
        assertEquals(2000, c.rate());
        // the budget, in the seventeen
        for (int b : new int[] { 0, 31, 0xFF }) assertEquals(SW_WRONG_DATA, c.limits(1000, 0, 0, b, 5000), "budget " + b);
        assertEquals(2000, c.rate(), "nothing written");
        // 2.2's lengths leave the rate
        assertEquals(SW_OK, c.ownerLimit(u32(500)));
        assertEquals(SW_OK, c.ownerLimit(concat(u32(500), u32(10))));
        assertEquals(SW_OK, c.ownerLimit(concat(u32(500), u32(10), u32(0))));
        assertEquals(SW_OK, c.ownerLimit(concat(u32(500), u32(10), u32(0), new byte[] { 9 })));
        assertEquals(2000, c.rate(), "the rate as it was");
        assertEquals(9, c.record()[CashuApplet.CARD_BUDGET_OFFSET]);
        for (int len : new int[] { 0, 1, 3, 5, 9, 14, 16, 19, 21 }) assertEquals(SW_WRONG_LENGTH, c.ownerLimit(new byte[len]), len + " bytes");
        // the PIN form, on a card with no owner: the same layout
        Card p = SimpleCardTest.inFirstSetUp(SAT);
        assertEquals(SW_OK, p.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(700), u32(70), u32(0), new byte[] { 5 }, u32(1500)))), "seventeen bytes by the PIN, in the card's first set-up");
        assertEquals(700, readUint32(p.record(), CashuApplet.CARD_LIMIT_OFFSET));
        assertEquals(70, readUint32(p.record(), CashuApplet.CARD_TAP_LIMIT_OFFSET));
        assertEquals(5, p.record()[CashuApplet.CARD_BUDGET_OFFSET]);
        assertEquals(1500, p.rate());
        assertEquals(SW_OK, p.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(800), u32(70), u32(0), new byte[] { 6 }))), "and thirteen");
        assertEquals(1500, p.rate());
        assertEquals(6, p.record()[CashuApplet.CARD_BUDGET_OFFSET]);
        assertEquals(SW_WRONG_DATA, p.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(800), u32(70), u32(0), new byte[] { 31 }, u32(1)))), "the budget checked");
        for (int len : new int[] { 3, 5, 14, 16, 19 }) assertEquals(SW_WRONG_LENGTH, p.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, new byte[len])), len + " bytes by the PIN");
        assertEquals(1500, p.rate());
    }

    @Test
    @DisplayName("The rate is the holder's to read: GET_INFO P1 = 3 bytes 44 to 47 with the owner's grant, zeros otherwise; GET_CARD P1 = 0's bytes 79 to 82 are zeros with a rate set, and the bytes beside them as they are")
    void theRateIsTheHoldersToRead() throws Exception {
        Card c = owned(SAT);
        assertEquals(SW_OK, c.limits(0, 0, 0, 9, 0x01020304L));
        c.tap();
        assertArrayEquals(new byte[4], Arrays.copyOfRange(c.info(3), 44, 48), "to the PIN: zeros");
        c.grant();
        assertArrayEquals(u32(0x01020304L), Arrays.copyOfRange(c.info(3), 44, 48), "to the grant: the rate");
        byte[] card = c.getCard(0);
        assertArrayEquals(new byte[4], Arrays.copyOfRange(card, 79, 83), "GET_CARD never says it");
        assertEquals(9, card[77], "the budget beside it as it is");
        assertArrayEquals(Arrays.copyOfRange(c.record(), 163, 185), Arrays.copyOfRange(card, 83, 105), "and the bytes after it");
    }

    // =========================================================================
    // What the card says
    // =========================================================================

    @Test
    @DisplayName("GET_INFO P1 = 3 says the table: the 43 of P1 = 2, then 01 (a table), the rate, the entries in use, those without the mark and the last payment's unit; P1 = 0, 1 and 2 as they were but byte 8")
    void getInfoThreeSaysTheTable() throws Exception {
        Card c = owned(SAT);
        byte[] fresh = c.info(3);
        assertEquals(51, fresh.length);
        assertArrayEquals(c.info(2), Arrays.copyOf(fresh, 43));
        assertArrayEquals(new byte[] { 1, 0, 0, 0, 0, 0, 0, 0 }, Arrays.copyOfRange(fresh, 43, 51), "a table, nothing in it");
        c.put(-1, SAT_A, 10);
        c.grant();
        int u = c.put(USD, USD_A, 10);
        c.put(-1, SAT_B, 10);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        byte[] three = c.info(3);
        assertEquals(3, three[48], "three entries");
        assertEquals(1, three[49], "one of them without the mark");
        assertEquals((byte) 0xA0, three[50], "the last payment: the other unit");
        assertEquals(5, three[8], "and the format, 5");
        assertArrayEquals(c.info(0), Arrays.copyOf(three, 30));
    }

    @Test
    @DisplayName("The format is 4 for one unit and 5 for both: 4 on a new card and after loads of the card's unit; 5 at the first entry of the other unit; 5 on a usd card that holds sat; 4 again after the reclaim; GET_CARD byte 0 the same")
    void theFormatIsFourOrFive() throws Exception {
        Card c = owned(SAT);
        assertEquals(4, c.info(0)[8]);
        c.put(-1, SAT_A, 10);
        assertEquals(4, c.info(0)[8]);
        assertEquals(4, c.getCard(0)[0]);
        c.grant();
        int u = c.put(USD, USD_A, 10);
        assertEquals(5, c.info(0)[8]);
        assertEquals(5, c.info(1)[8]);
        assertEquals(5, c.getCard(0)[0]);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        assertEquals(5, c.info(0)[8], "dead, the entry is still in use");
        assertEquals(SW_OK, c.clearSpent());
        assertEquals(4, c.info(0)[8], "freed: one unit again");
        assertEquals(4, c.getCard(0)[0]);
        Card d = owned(USD);
        d.grant();
        d.put(SAT, SAT_A, 5);
        assertEquals(5, d.info(0)[8], "a usd card holding sat");
    }

    @Test
    @DisplayName("GET_BALANCE: P1 = 0 is the card's unit only, and P1 = 1 each unit, sat first: count, then the code, the pieces and the sum of each; a place of no entry is in no sum; on one unit P1 = 0 is what it was")
    void getBalanceSaysEachUnit() throws Exception {
        Card c = owned(SAT);
        assertArrayEquals(new byte[] { 0 }, c.balance(1), "nothing: no unit");
        c.put(-1, SAT_A, 10);
        c.put(-1, SAT_A, 20);
        assertArrayEquals(u32(30), c.balance(0));
        assertArrayEquals(new byte[] { 1, 0, 2, 0, 0, 0, 30 }, c.balance(1));
        c.grant();
        c.put(USD, USD_A, 7);
        assertArrayEquals(u32(30), c.balance(0), "the card's unit only");
        assertArrayEquals(new byte[] { 2, 0, 2, 0, 0, 0, 30, 1, 1, 0, 0, 0, 7 }, c.balance(1));
        Card d = owned(USD);
        d.grant();
        d.put(-1, USD_A, 100);
        d.put(SAT, SAT_A, 900);
        assertArrayEquals(u32(100), d.balance(0), "a usd card's own: cents");
        assertArrayEquals(new byte[] { 2, 0, 1, 0, 0, 3, (byte) 0x84, 1, 1, 0, 0, 0, 100 }, d.balance(1));
        // a place whose entry is gone is in no sum
        d.book()[d.entryOf(SAT_A) * ENTRY + 8] = 0;
        assertArrayEquals(new byte[] { 1, 1, 1, 0, 0, 0, 100 }, d.balance(1));
    }

    @Test
    @DisplayName("GET_CARD P1 = 2 is the table: the count and every entry in use (keyset and state), in the table's order; 00 alone with none; P1 = 1 answers as P1 = 0")
    void getCardTwoIsTheTable() throws Exception {
        Card c = owned(SAT);
        assertArrayEquals(new byte[] { 0 }, c.getCard(2));
        c.put(-1, SAT_A, 10);
        c.grant();
        c.put(USD, USD_A, 10);
        byte[] t = c.getCard(2);
        assertArrayEquals(concat(new byte[] { 2 }, hexToBytes(SAT_A), new byte[] { 0x40 }, hexToBytes(USD_A), new byte[] { (byte) 0xC1 }), t);
        c.grant();
        String[] more = { SAT_B, SAT_C, USD_B, USD_C };
        for (String k : more) c.put(k.startsWith("00aa") ? SAT : USD, k, 1);
        assertEquals(1 + 6 * 9, c.getCard(2).length, "55 bytes at the most");
        assertArrayEquals(c.getCard(0), c.getCard(1));
    }

    @Test
    @DisplayName("The log says each entry's unit: bit 5 for the other; a tap of both units makes two entries; P1 = 2 has the other unit's count after the four; P1 = 3 has each receipt's unit; a refusal over a limit is in an entry of its payment's unit; a card of one unit has bit 5 at 0; 6A86 for P1 = 4")
    void theLogSaysEachEntrysUnit() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int s = c.put(-1, SAT_A, 40);
        ResponseAPDU two = c.loadAs(USD, c.piece(USD_A, 25), c.piece(USD_A, 500));
        assertEquals(SW_OK, two.getSW());
        int u = two.getData()[0], u2 = two.getData()[1];
        byte[] loads = c.log(0).getData();
        assertEquals(16 + 2 * 20, loads.length, "one tap of both units: two entries");
        assertEquals(525, readUint32(loads, 16 + 12), "newest: 525 cents put on");
        assertEquals(0x20, loads[16 + 10] & 0x20, "in an entry of the other unit");
        assertEquals(40, readUint32(loads, 36 + 12), "then 40 sat");
        assertEquals(0, loads[36 + 10] & 0x20);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        assertEquals(64, c.pay(s).getData().length);
        byte[] log = c.log(0).getData();
        assertEquals(16 + 4 * 20, log.length);
        assertEquals(40, readUint32(log, 16 + 4), "newest: 40 sat signed for");
        assertEquals(0, log[16 + 10] & 0x20, "of the card's unit");
        assertEquals(25, readUint32(log, 36 + 4), "then 25 cents");
        assertEquals(0x20, log[36 + 10] & 0x20, "of the other");
        assertEquals(40, readUint32(log, 4), "the card's unit's count, ever");
        assertEquals(4, readUint32(log, 0), "four entries counted as taps");
        byte[] withOther = c.log(2).getData();
        assertEquals(20 + 4 * 20, withOther.length);
        assertArrayEquals(Arrays.copyOf(log, 16), Arrays.copyOf(withOther, 16));
        assertEquals(25, readUint32(withOther, 16), "P1 = 2: the other unit's count after the four");
        assertArrayEquals(Arrays.copyOfRange(log, 16, log.length), Arrays.copyOfRange(withOther, 20, withOther.length));
        c.grant();
        byte[] receipts = c.log(3).getData();
        assertEquals(4 + 2 * 78, receipts.length);
        assertEquals((byte) 0x80, receipts[4 + 77], "the newest receipt: the card's unit");
        assertEquals((byte) 0xA0, receipts[4 + 78 + 77], "the one before: the other");
        byte[] plain = c.log(1).getData();
        assertArrayEquals(Arrays.copyOfRange(plain, 0, 4 + 77), Arrays.copyOfRange(receipts, 0, 4 + 77));
        assertArrayEquals(Arrays.copyOfRange(plain, 4 + 77, 4 + 154), Arrays.copyOfRange(receipts, 4 + 78, 4 + 155));
        // a refusal over a limit, in an entry of its payment's unit
        assertEquals(SW_OK, c.limits(100, 0, 0, 7, 1000));
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(u2).getSW());
        byte[] after = c.log(0).getData();
        assertEquals(1, after[16 + 9], "refused once");
        assertEquals(0x20, after[16 + 10] & 0x20, "in an entry of the other unit");
        // a card of one unit
        Card d = owned(SAT);
        int p = d.put(-1, SAT_A, 10);
        assertEquals(64, d.pay(p).getData().length);
        assertEquals(0, d.log(0).getData()[16 + 10] & 0x20);
        assertEquals(SW_INCORRECT_P1P2, d.log(4).getSW());
    }

    @Test
    @DisplayName("The other unit onto a card with a limit set and no rate is 6A99 at the load, nothing written: such pieces could never be paid; the card's own unit still goes on, and with a rate the other does")
    void theOtherUnitWithALimitAndNoRateIs6A99AtTheLoad() throws Exception {
        Card c = owned(SAT);
        assertEquals(SW_OK, c.limits(0, 100, 0, 7, 0));
        c.tap();
        c.grant();
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_NO_RATE, c.loadAs(USD, c.piece(USD_A, 5)).getSW());
        c.assertUnchanged(before, "nothing written");
        c.put(-1, SAT_A, 5);
        assertEquals(SW_OK, c.limits(0, 100, 0, 7, 1000));
        c.tap();
        c.grant();
        c.put(USD, USD_A, 5);
    }

    @Test
    @DisplayName("The change names a keyset in the table whose keys were taught: one of the other unit is 6A9B and one in no entry 6A9F, each giving the payment up with nothing written, and nothing entered; LOAD_CHANGE's piece is logged in its opening's unit")
    void theChangeNamesItsKeysetInTheTable() throws Exception {
        Card c = owned(SAT);
        int s = c.put(-1, SAT_A, 50);
        c.grant();
        int u = c.put(USD, USD_A, 100);
        c.put(USD, USD_B, 1);
        c.tap();
        // the change in another usd keyset the card holds, its keys taught (this runtime marks them)
        assertEquals(SW_OK, c.begin(u).getSW());
        assertEquals(SW_OK, c.send(changeCommand(40, mintKey(), hexToBytes(USD_B))).getSW());
        assertEquals(0xC3, c.stateOf(USD_B), "in use, marked, taught, usd: as it was");
        assertEquals(64, c.sign().getData().length);
        // the other unit's keyset named for a sat payment
        Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_OK, c.begin(s).getSW());
        assertEquals(SW_OTHER_UNIT, c.send(changeCommand(10, mintKey(), hexToBytes(USD_A))).getSW());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment given up");
        c.assertUnchanged(before, "nothing written");
        // a keyset in no entry: no change in it, and it is not entered
        assertEquals(SW_OK, c.begin(s).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.send(changeCommand(10, mintKey(), hexToBytes(SAT_B))).getSW());
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)));
        c.assertUnchanged(before, "nothing written");
        assertEquals(-1, c.entryOf(SAT_B), "nothing entered");
        // the change comes back, logged as cents
        c.power();
        byte[] rows = c.send(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData();
        assertEquals(1, rows[0]);
        assertArrayEquals(hexToBytes(USD_B), Arrays.copyOfRange(rows, 6, 14), "the opening's keyset is the one named");
        CashuAppletTest.shownByHand(c.field("openKeys"), rows[1]);   // KEYSET_KEYS P1 = 3's mark, by hand (CashuAppletTest.loadChange)
        ResponseAPDU back = c.send(loadChangeCommand(rows[1], mintAnswer(Arrays.copyOfRange(rows, 18, 51))));
        assertEquals(SW_OK, back.getSW());
        c.pin();
        byte[] log = c.log(0).getData();
        assertEquals(40, readUint32(log, 16 + 12), "40 put on");
        assertEquals(0x20, log[16 + 10] & 0x20, "in an entry of the other unit");
        assertArrayEquals(new byte[] { 2, 0, 1, 0, 0, 0, 50, 1, 2, 0, 0, 0, 41 }, c.balance(1), "the sat piece, and the change of 40 with the usd piece of 1");
    }

    @Test
    @DisplayName("The settlement record says the payment's unit: 01 for a usd payment on a sat card, 00 for a sat one")
    void theRecordSaysThePaymentsUnit() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int u = c.put(USD, USD_A, 100), s = c.put(-1, SAT_A, 100);
        c.tap();
        int at = 4 + 7 + 33 + 32 + 8 + 1 + 4 + 1 + 2 + MINT.length();
        for (int[] p : new int[][] { { u, 1 }, { s, 0 } }) {
            assertEquals(SW_OK, c.begin(p[0]).getSW());
            assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, output(100, CashuAppletTest.blinded(p[0] + 3)))));
            assertEquals(64, c.sign().getData().length);
            byte[] box = c.field("outbox");
            assertEquals(1, box[0], "a record");
            assertEquals(p[1], box[at], "its unit");
        }
    }

    @Test
    @DisplayName("Only these methods name the table: SET_CARD, RESET_CARD, the load and its one step, SPEND_ALL_CHANGE, SPEND_ALL_SIGN, the readers of GET_INFO, GET_CARD and GET_LOG, KEYSET_KEYS (its top kept in a transaction, and read to show a key, D190) and the table's own helpers, and the forget of the history (its tail: the last unit, the other unit's count, the receipts' units); and it is written outside a transaction only by `enter`, the reclaim, the forget and RESET_CARD's wipe")
    void onlyTheseMethodsNameTheTable() throws Exception {
        String code = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8));
        java.util.TreeSet<String> names = ProofStoreTest.methodsNaming(code, "book");
        assertEquals(new java.util.TreeSet<>(Arrays.asList("(class body)", "processGetInfo", "processGetCard", "processSpendAllChange", "processSpendAllSign",
            "processLoadProof", "loadOne", "processSetCard", "processResetCard", "processGetLog", "processGetReceipts",
            "processKeysetKeys", "showKey", "entryOf", "placeUnit", "cardFormat", "freeEntry", "enter", "reclaim", "finishBurn", "forget")), names);
        assertNull(outside(code).get("processKeysetKeys"), "KEYSET_KEYS writes the table in its transaction alone");
        java.util.Map<String, Integer> outside = SlotWriteOrderTest.writesOutsideTransactions(code);
        assertEquals(2, (int) outside.get("enter"));
        assertEquals(1, (int) outside.get("reclaim"));
        String f = SchnorrHWMathTest.stripCommentsAndCharLiterals(code.substring(code.indexOf("private void forget()"), code.indexOf("private void forget()") + 900));
        assertTrue(f.contains("if (book != null) Util.arrayFillNonAtomic(book, BOOK_LAST, (short)(BOOK_LEN - BOOK_LAST), (byte) 0);"), "the forget takes the table's tail alone, from BOOK_LAST");
    }

    private static java.util.Map<String, Integer> outside(String code) { return SlotWriteOrderTest.writesOutsideTransactions(code); }

    @Test
    @DisplayName("The tests' offsets are the applet's: the rate at record offset 159, after the arming (GET_CARD 79); the table's entries of 41 and its tail at 246, 247 and 251, 267 bytes")
    void theOffsetsAreTheApplets() throws Exception {
        String[][] pins = { { "CARD_RATE_OFFSET", "159" }, { "BOOK_LAST", "246" }, { "BOOK_OTHER", "247" }, { "BOOK_UNITS", "251" },
                            { "BOOK_LEN", "267" }, { "ENTRY_LEN", "41" }, { "ENTRY_STATE", "8" }, { "ENTRY_TOP", "9" }, { "BOOK_ENTRIES", "6" } };
        for (String[] p : pins) {
            java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(p[0]);
            f.setAccessible(true);
            assertEquals(Integer.parseInt(p[1]), f.getShort(null), p[0]);
        }
        assertEquals(CashuApplet.CARD_ARMED_OFFSET + 1, RATE_AT, "the rate after the arming");
        assertEquals(79, RATE_AT - CashuApplet.CARD_BITS_OFFSET + 40, "GET_CARD's 79");
    }

    // =========================================================================
    // What a PIN payment takes back, and a limit that would leave the other unit's pieces with no way off
    // =========================================================================

    @Test
    @DisplayName("a payment with the PIN neither arms nor takes back an arming (D186, amended): the owner's arming from an earlier tap stays for the next tap with no PIN, and the PIN typed in a tap, whether it then pays or not, arms nothing")
    void aPinPaymentKeepsAnEarlierTapsArming() {
        Card c = owned(SAT);
        // no day, no payment limit, an allowance of 100, budget 7, no rate, no 24-hour window
        assertEquals(SW_OK, c.ownerLimit(concat(u32(0), u32(0), u32(100), new byte[] { 7 }, u32(0), new byte[] { 1 })));
        int[] p = new int[4];
        for (int i = 0; i < 4; i++) p[i] = c.put(-1, SAT_A, 60);
        c.power();
        assertEquals(64, c.pay(p[0]).getData().length, "no PIN: 60 of the allowance, the arming spent");
        assertEquals(0, c.getCard(0)[78], "not armed");
        c.tap();
        assertEquals(0, c.getCard(0)[78], "the holder's PIN in a tap that pays nothing arms nothing");
        c.grant();
        assertEquals(1, c.getCard(0)[78], "the owner's proof does");
        c.tap();
        assertEquals(64, c.pay(p[1]).getData().length, "a payment with the PIN, in a later tap");
        assertEquals(1, c.getCard(0)[78], "the earlier tap's arming kept");
        c.power();
        assertEquals(64, c.pay(p[2]).getData().length, "the next tap with no PIN pays from the renewed allowance");
        // the PIN typed in a tap that then pays: nothing armed before the payment or after it
        c.tap();
        assertEquals(0, c.getCard(0)[78], "the PIN arms nothing in this tap");
        assertEquals(64, c.pay(p[3]).getData().length);
        assertEquals(0, c.getCard(0)[78], "and nothing after the payment");
    }

    @Test
    @DisplayName("a limit with no rate is refused (6A99), nothing written, on a card that holds pieces of the other unit: those pieces could not be paid even with the PIN; with a rate, or no limit at all, it goes through")
    void aLimitWithNoRateIsRefusedWhileTheOtherUnitIsHeld() throws Exception {
        Card c = owned(SAT);
        c.grant();
        int usd = c.put(USD, USD_A, 500);
        c.put(-1, SAT_A, 1000);
        byte[] before = c.record().clone();
        assertEquals(SW_NO_RATE, c.ownerLimit(u32(5000)), "a 4-byte day's limit, as a 2.2 wallet sends it: refused");
        assertEquals(SW_NO_RATE, c.limits(5000, 0, 0, 7, 0), "the 17-byte form with a rate of 0: refused");
        assertArrayEquals(before, c.record(), "nothing written");
        assertEquals(SW_OK, c.ownerLimit(u32(0)), "no limit at all: nothing to turn");
        assertEquals(SW_OK, c.limits(10_000, 0, 0, 7, 1_000), "with a rate: 1,000 sats to the dollar");
        c.tap();
        assertEquals(64, c.pay(usd).getData().length, "the usd piece pays with the PIN");
    }
}
