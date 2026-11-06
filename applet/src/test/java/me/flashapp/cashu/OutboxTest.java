package me.flashapp.cashu;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * ENG-819 (D175): the card's record of its last SIG_ALL payment, the assisted-settlement packet, and GET_OUTBOX (0x1B), which
 * serves it. Every packet read here is held to one built by this test from what it gave the card (the pieces, the outputs,
 * the change the card answered, the signature), in relay.js's wire order, and its two signatures are checked by this test's
 * own BIP-340 verifier. On 2.1 every command here answers 6D00.
 */
class OutboxTest {

    static final byte INS_GET_OUTBOX = (byte) 0x1B;
    static final byte INS_SPEND_ALL_CHANGE = (byte) 0x26;
    static final String TAG = "CashuCard/assisted-settlement/v1";
    /** The longest mint a record holds (CARD_MINT_MAX): https, and 77 characters in all. */
    static final String LONG_MINT = "https://" + "m".repeat(77 - "https://".length() - ".test".length()) + ".test";

    private ExposedRuntime runtime;
    private CardSimulator sim;
    /** What this test gave the card, by place: the 81 bytes LOAD_PROOF took. */
    private final java.util.Map<Integer, byte[]> pieces = new java.util.HashMap<>();
    private int seed = 1;

    @BeforeEach
    void setup() {
        fresh(MINT);
    }

    private void fresh(String mint) {
        runtime = new ExposedRuntime();
        sim = new CardSimulator(runtime);
        sim.installApplet(AIDUtil.create(AID_HEX), CashuApplet.class);
        reselect();
        readyOn(sim, 0, true, mint);
        pieces.clear();
    }

    // ---- the card --------------------------------------------------------

    private ResponseAPDU tx(CommandAPDU c) { return sim.transmitCommand(c); }
    private void reselect() { assertEquals(SW_OK, tx(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR))).getSW()); }
    private void verifyPin() { assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW()); }
    private byte[] cardKey() { return tx(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }

    private byte[] field(String name) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return (byte[]) f.get(runtime.appletAt(AIDUtil.create(AID_HEX)));
    }

    /** Pieces of these amounts put on (dated `date`, 0 for none): their places. */
    private int[] loadDated(long date, long... amounts) {
        int[] places = new int[amounts.length];
        for (int i = 0; i < amounts.length; i++) {
            byte[] p = buildProof(KEYSET, amounts[i], seed, date);
            seed += 3;
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 0, p, 1));
            assertEquals(SW_OK, r.getSW(), "load " + i);
            places[i] = r.getData()[0] & 0xFF;
            pieces.put(places[i], p);
        }
        return places;
    }
    private int[] load(long... amounts) { return loadDated(0, amounts); }

    /** A payment as a till makes one: the places, its outputs, the card's change of these amounts, and the signature. */
    static final class Payment {
        int[] places;
        byte[][] outputs;     // the till's, then the change, as the message has them
        byte[] signature;
        int sw;
    }

    private Payment pay(int[] places, byte[][] outputs, long... change) {
        Payment p = new Payment();
        p.places = places;
        byte[] list = new byte[places.length];
        for (int i = 0; i < places.length; i++) list[i] = (byte) places[i];
        ResponseAPDU begun = tx(new CommandAPDU(CLA, INS_SPEND_ALL_BEGIN, 0, 0, list, 4));
        assertEquals(SW_OK, begun.getSW(), "begin");
        List<byte[]> all = new ArrayList<>(Arrays.asList(outputs));
        for (int at = 0; at < outputs.length; at += 6) {
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(Arrays.copyOfRange(outputs, at, Math.min(outputs.length, at + 6)))));
            assertEquals(SW_OK, r.getSW(), "outputs");
        }
        for (long c : change) {
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_SPEND_ALL_CHANGE, 0, 0, u32(c), 33));
            assertEquals(SW_OK, r.getSW(), "change");
            all.add(output(c, r.getData()));
        }
        p.outputs = all.toArray(new byte[0][]);
        for (int waits = 0; waits < 2000; waits++) {
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64));
            p.sw = r.getSW();
            if (r.getSW() != SW_OK) return p;
            if (r.getData().length == 64) {
                p.signature = r.getData();
                return p;
            }
        }
        fail("the card is still waiting");
        return p;
    }

    private static byte[][] tillOutputs(long... amounts) {
        byte[][] o = new byte[amounts.length][];
        for (int i = 0; i < amounts.length; i++) o[i] = output(amounts[i], blinded(40 + i));
        return o;
    }

    private ResponseAPDU scope() { return tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 0, 0, 256)); }
    private ResponseAPDU page(int offset, int count) {
        return tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, new byte[] { (byte) (offset >> 8), (byte) offset, (byte) count }, 256));
    }

    /** The packet, as a relay reads it: pages of 255 from 0 until one comes back short, or the next is past the end. */
    private byte[] packet(List<Integer> sizes) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int offset = 0; ; offset += 255) {
            ResponseAPDU r = page(offset, 255);
            if (r.getSW() == SW_SLOT_OUT_OF_RANGE && offset > 0) break;
            assertEquals(SW_OK, r.getSW(), "page at " + offset);
            if (sizes != null) sizes.add(r.getData().length);
            out.write(r.getData(), 0, r.getData().length);
            if (r.getData().length < 255) break;
        }
        return out.toByteArray();
    }
    private byte[] packet() { return packet(null); }

    // ---- the packet, built by this test ----------------------------------

    /** The body the card should have written for `p`: header, inputs, outputs, witness (relay.js readPacket's order). */
    private byte[] expectedBody(Payment p, String mint, long paymentId, long generation) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write("CCP-AS".getBytes(StandardCharsets.US_ASCII));
        b.write(1);
        b.write(cardKey());
        b.write(field("outInstall"));
        b.write(new byte[4]);
        b.write(u32(paymentId));
        b.write(0);
        b.write(u32(generation));
        b.write(1);
        byte[] m = mint.getBytes(StandardCharsets.US_ASCII);
        b.write(m.length >> 8);
        b.write(m.length);
        b.write(m);
        b.write(0);
        b.write(p.places.length);
        byte[] firstKeyset = Arrays.copyOfRange(pieces.get(p.places[0]), 0, 8);
        for (int place : p.places) {
            byte[] d = pieces.get(place);
            b.write(place);
            b.write(u32(generation));
            b.write(d, 8, 4);
            b.write(8);
            b.write(d, 0, 8);
            b.write(d, 12, 32);
            b.write(d, 44, 33);
        }
        b.write(p.outputs.length);
        for (byte[] o : p.outputs) {
            b.write(o, 0, 4);
            b.write(8);
            b.write(firstKeyset);
            b.write(o, 4, 33);
        }
        b.write(p.signature);
        return b.toByteArray();
    }

    static byte[] tagged(byte[] body) {
        byte[] tag = sha256(TAG.getBytes(StandardCharsets.US_ASCII));
        return sha256(concat(tag, tag, body));
    }

    /** The packet holds `body` and a descriptor by the card's key over it; the scope says the same. Answers the descriptor. */
    private byte[] assertRecord(byte[] body, byte[] packet) throws Exception {
        assertEquals(body.length + 64, packet.length, "body and descriptor");
        assertArrayEquals(body, Arrays.copyOfRange(packet, 0, body.length), "the body, byte for byte");
        byte[] descriptor = Arrays.copyOfRange(packet, body.length, packet.length);
        assertTrue(schnorrVerify(extractPubkeyX(cardKey()), tagged(body), descriptor), "the descriptor is the card key's over SHA-256(tag || tag || body)");
        ResponseAPDU s = scope();
        assertEquals(SW_OK, s.getSW());
        assertArrayEquals(concat(new byte[] { body[80] }, Arrays.copyOfRange(body, 72, 80), Arrays.copyOfRange(body, 81, 85), sha256(body)), s.getData(),
            "the scope: index, payment id, generation and SHA-256 of the body");
        return descriptor;
    }

    private byte[][] slotData(Payment p) {
        byte[][] d = new byte[p.places.length][];
        for (int i = 0; i < d.length; i++) d[i] = concat(new byte[] { 1 }, pieces.get(p.places[i]));
        return d;
    }

    /** A paid 2-in/2-out payment (one till output, one change), and the body it should leave. */
    private Payment twoByTwo() {
        int[] places = load(8, 4);
        Payment p = pay(places, tillOutputs(9), 3);
        assertEquals(SW_OK, p.sw);
        assertNotNull(p.signature);
        return p;
    }

    // ---- the tests -------------------------------------------------------

    @Test
    @DisplayName("a record only after a payment that was signed: none on a new card (6A88); a paid one leaves it; a later payment refused for the PIN (6A94), or dropped after its outputs by the read itself, leaves it byte for byte")
    void recordOnlyAfterSuccessfulSign() throws Exception {
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "a new card has no record");
        assertEquals(SW_SLOT_EMPTY, page(0, 255).getSW());
        Payment p = twoByTwo();
        assertTrue(schnorrVerify(extractPubkeyX(cardKey()), sha256(allMessage(cardKey(), REFUND, slotData(p), p.outputs).getBytes(StandardCharsets.UTF_8)), p.signature),
            "(the witness this test holds is the payment's)");
        byte[] first = packet();
        assertRecord(expectedBody(p, MINT, 1, 1), first);
        byte[] firstScope = scope().getData();

        // refused: the PIN is set and not given in this tap, and there is no allowance
        int[] more = load(5, 6);
        reselect();
        Payment refused = pay(more, tillOutputs(10));
        assertEquals(SW_PIN_NEEDED, refused.sw, "refused for the PIN");
        assertArrayEquals(first, packet(), "the record is the paid one's");
        assertArrayEquals(firstScope, scope().getData());

        // dropped: begun, its outputs given, and then the read, which is not a step of a payment
        verifyPin();
        byte[] list = { (byte) more[0], (byte) more[1] };
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_SPEND_ALL_BEGIN, 0, 0, list, 4)).getSW());
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(tillOutputs(11)))).getSW());
        assertArrayEquals(first, packet(), "staged outputs are not the record");
        assertEquals(SW_CONDITIONS_NOT_SATIS, tx(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)).getSW(), "and the read dropped the payment");
        assertArrayEquals(first, packet(), "still the paid one's");
    }

    @Test
    @DisplayName("the next payment's record replaces the last, and its payment id is one more")
    void newPaymentReplaces() throws Exception {
        Payment a = twoByTwo();
        byte[] one = packet();
        assertRecord(expectedBody(a, MINT, 1, 1), one);
        int[] places = load(16, 2, 1);
        Payment b = pay(places, tillOutputs(12, 5), 2);
        assertEquals(SW_OK, b.sw);
        byte[] two = packet();
        assertFalse(Arrays.equals(one, two));
        assertRecord(expectedBody(b, MINT, 2, 1), two);
        assertEquals(2, readUint32(scope().getData(), 5), "the payment id, the receipt count");
    }

    @Test
    @DisplayName("the record is self-contained: CLEAR_SPENT and new pieces in the same places leave it byte for byte")
    void selfContainedAfterClearSpent() throws Exception {
        Payment p = twoByTwo();
        byte[] before = packet();
        byte[] scopeBefore = scope().getData();
        reselect();
        verifyPin();
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_CLEAR_SPENT, 0, 0, 1)).getSW());
        int[] again = load(30, 31);
        assertArrayEquals(p.places, again, "the new pieces are in the places the payment emptied");
        assertArrayEquals(before, packet());
        assertArrayEquals(scopeBefore, scope().getData());
    }

    @Test
    @DisplayName("GET_OUTBOX is public: a card with a PIN, the PIN not given, answers the scope and every page")
    void readableWithoutPin() throws Exception {
        Payment p = twoByTwo();
        reselect();
        assertEquals(1, tx(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256)).getData()[7], "a PIN is set");
        assertEquals(SW_OK, scope().getSW());
        assertRecord(expectedBody(p, MINT, 1, 1), packet());
    }

    @Test
    @DisplayName("paging: 2 inputs and 2 outputs with the test mint come to 509 bytes in pages of 255 and 254; 32 inputs, 16 outputs (8 of them change) and a 77-byte mint to 3,688 (OUTBOX_MAX) in 15 pages; 6A83, 6700 and 6A86 for an offset past it, a page's data not three bytes or a count of 0, and another P1 or P2")
    void pagingCovers509AndMax() throws Exception {
        Payment p = twoByTwo();
        List<Integer> sizes = new ArrayList<>();
        byte[] small = packet(sizes);
        assertEquals(89 + MINT.length() + 1 + 2 * 83 + 1 + 2 * 46 + 128, small.length);
        assertEquals(509, small.length);
        assertEquals(Arrays.asList(255, 254), sizes);
        assertRecord(expectedBody(p, MINT, 1, 1), small);
        // pages of any size, and from any offset, are the same bytes
        ByteArrayOutputStream odd = new ByteArrayOutputStream();
        for (int at = 0; at < small.length; at += 7) odd.write(page(at, 7).getData(), 0, Math.min(7, small.length - at));
        assertArrayEquals(small, odd.toByteArray());
        assertArrayEquals(Arrays.copyOfRange(small, 500, 509), page(500, 255).getData(), "a count past the end gives what is left");

        // the errors
        assertEquals(SW_SLOT_OUT_OF_RANGE, page(509, 1).getSW(), "the offset at the end");
        assertEquals(SW_SLOT_OUT_OF_RANGE, page(0xFFFF, 1).getSW(), "an offset far past it");
        assertEquals(SW_WRONG_LENGTH, page(0, 0).getSW(), "a count of 0");
        assertEquals(SW_WRONG_LENGTH, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, new byte[] { 0, 0 }, 256)).getSW(), "two bytes of data");
        assertEquals(SW_WRONG_LENGTH, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, new byte[] { 0, 0, 1, 0 }, 256)).getSW(), "four");
        assertEquals(SW_WRONG_LENGTH, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, 256)).getSW(), "none");
        assertEquals(0x6A86, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 2, 0, 256)).getSW(), "P1 2");
        assertEquals(0x6A86, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 0, 1, 256)).getSW(), "P2 1");
        assertEquals(0x6A86, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0xFF, new byte[] { 0, 0, 1 }, 256)).getSW(), "P2 FF");

        // the most: a 77-byte mint, 32 inputs, 8 outputs of the till's and 8 of change
        fresh(LONG_MINT);
        assertEquals(77, LONG_MINT.length());
        long[] amounts = new long[32];
        Arrays.fill(amounts, 2);
        int[] places = load(amounts);
        Payment big = pay(places, tillOutputs(1, 2, 3, 4, 5, 6, 7, 8), 1, 1, 1, 1, 1, 1, 1, 1);
        assertEquals(SW_OK, big.sw);
        assertEquals(16, big.outputs.length);
        sizes.clear();
        byte[] most = packet(sizes);
        assertEquals(CashuApplet.OUTBOX_MAX, most.length);
        assertEquals(3688, most.length);
        assertEquals(15, sizes.size());
        for (int i = 0; i < 14; i++) assertEquals(255, (int) sizes.get(i));
        assertEquals(3688 - 14 * 255, (int) sizes.get(14));
        assertRecord(expectedBody(big, LONG_MINT, 1, 1), most);
        assertEquals(SW_SLOT_OUT_OF_RANGE, page(3688, 1).getSW());
        assertArrayEquals(Arrays.copyOfRange(most, 3687, 3688), page(3687, 1).getData(), "the descriptor's last byte");
    }

    @Test
    @DisplayName("the descriptor is the card key's BIP-340 signature over SHA-256(tag || tag || body), made at the first read and kept: a second read is the same 64 bytes; the witness is SPEND_ALL_AGAIN's")
    void descriptorVerifiesAndIsCached() throws Exception {
        Payment p = twoByTwo();
        assertEquals(0, field("outbox")[1], "not signed until it is read");
        byte[] body = expectedBody(p, MINT, 1, 1);
        byte[] d1 = assertRecord(body, packet());
        assertEquals(1, field("outbox")[1], "signed once read");
        long commits = runtime.commits;
        byte[] d2 = assertRecord(body, packet());
        assertArrayEquals(d1, d2, "kept, not signed again");
        assertEquals(commits, runtime.commits, "and a read that finds it signed writes nothing");
        ResponseAPDU again = tx(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64));
        assertEquals(SW_OK, again.getSW());
        assertArrayEquals(again.getData(), Arrays.copyOfRange(body, body.length - 64, body.length), "the witness is the signature the card gave");
    }

    @Test
    @DisplayName("over capacity the payment is paid and leaves no record, and none of the one before: 33 inputs, or 17 outputs")
    void overCapacityPaysNoRecord() throws Exception {
        twoByTwo();
        assertEquals(SW_OK, scope().getSW());
        long[] amounts = new long[33];
        Arrays.fill(amounts, 1);
        Payment many = pay(load(amounts), tillOutputs(30));
        assertEquals(SW_OK, many.sw, "33 pieces are paid");
        assertNotNull(many.signature);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "and leave no record");
        assertEquals(SW_SLOT_EMPTY, page(0, 255).getSW());

        twoByTwo();
        assertEquals(SW_OK, scope().getSW());
        long[] seventeen = new long[17];
        Arrays.fill(seventeen, 1);
        Payment wide = pay(load(20), tillOutputs(seventeen));
        assertEquals(SW_OK, wide.sw, "17 outputs are paid");
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "and leave no record");

        long[] sixteen = new long[16];
        Arrays.fill(sixteen, 1);
        Payment full = pay(load(20), tillOutputs(sixteen));
        assertEquals(SW_OK, full.sw);
        assertRecord(expectedBody(full, MINT, 5, 1), packet());
    }

    @Test
    @DisplayName("no record, the payment made as ever: dated pieces, an http:// mint, a receipt count stopped at FFFFFFFF, a generation stopped there, no outputs, and an output of nothing")
    void noRecordCases() throws Exception {
        // dated
        Payment dated = pay(loadDated(T0 + 30 * DAY, 8, 4), tillOutputs(12));
        assertEquals(SW_OK, dated.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "dated pieces: the relay rebuilds an undated secret");
        // no outputs: nothing to settle
        twoByTwo();
        Payment none = pay(load(3), new byte[0][]);
        assertEquals(SW_OK, none.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "no outputs");
        // an output of nothing
        twoByTwo();
        Payment zero = pay(load(3), tillOutputs(0, 3));
        assertEquals(SW_OK, zero.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "an output of nothing");
        // the receipt count stopped
        twoByTwo();
        Arrays.fill(field("cardReceipts"), 0, 4, (byte) 0xFF);
        Payment stopped = pay(load(3), tillOutputs(3));
        assertEquals(SW_OK, stopped.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "the payment id would not be new");
        // the generation stopped
        Arrays.fill(field("cardReceipts"), 0, 4, (byte) 0);
        twoByTwo();
        Arrays.fill(field("outGen"), (byte) 0xFF);
        Payment last = pay(load(3), tillOutputs(3));
        assertEquals(SW_OK, last.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "nor would the generation");
        // http
        fresh("http://mint.example.com/Bitcoin");
        Payment plain = pay(load(8, 4), tillOutputs(12));
        assertEquals(SW_OK, plain.sw);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "a mint that is not https");
    }

    @Test
    @DisplayName("RESET_CARD lets the record go and steps the generation; the installation stays; the next record is of generation 2, the new key, and payment id 1 again")
    void resetClearsAndStepsGeneration() throws Exception {
        twoByTwo();
        byte[] install = field("outInstall").clone();
        byte[] keyBefore = cardKey();
        assertEquals(SW_OK, scope().getSW());
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0]))).getSW());
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "no record after a reset");
        assertArrayEquals(new byte[] { 0, 0, 0, 2 }, field("outGen"));
        assertArrayEquals(install, field("outInstall"), "the installation is the card's");
        readyOn(sim, 0, true, MINT);
        pieces.clear();
        Payment p = twoByTwo();
        assertFalse(Arrays.equals(keyBefore, cardKey()), "a new key");
        byte[] body = expectedBody(p, MINT, 1, 2);
        assertRecord(body, packet());
        assertEquals(2, readUint32(scope().getData(), 9), "generation 2");
        assertEquals(1, readUint32(scope().getData(), 5), "payment id 1 again: unique with the generation");
        assertEquals(2, readUint32(body, 89 + MINT.length() + 2), "each input's generation is the card's: the first input's, after the count and its place");
    }

    @Test
    @DisplayName("a torn write never mixes two records: status 0 is no record (6A88); in the source the status goes to 0 before the body is written and to 1 after it, with the length; a descriptor not marked signed is signed again at the next read")
    void tornWriteNeverMixes() throws Exception {
        Payment p = twoByTwo();
        byte[] body = expectedBody(p, MINT, 1, 1);
        assertRecord(body, packet());
        field("outbox")[0] = 0;
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "status 0: no record");
        assertEquals(SW_SLOT_EMPTY, page(0, 255).getSW());
        field("outbox")[0] = 1;

        // the descriptor torn: outbox[1] still 0, its bytes rubbish
        byte[] outbox = field("outbox");
        outbox[1] = 0;
        Arrays.fill(outbox, 4 + body.length, 4 + body.length + 64, (byte) 0x5A);
        assertRecord(body, packet());
        assertEquals(1, field("outbox")[1]);

        String code = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8);
        int from = code.indexOf("private void writeOutbox(");
        String w = code.substring(from, code.indexOf("private static boolean isAllOnes(", from));
        int clearBegin = w.indexOf("JCSystem.beginTransaction();");
        int cleared = w.indexOf("outbox[0] = (byte) 0;");
        int clearCommit = w.indexOf("JCSystem.commitTransaction();");
        int firstBody = w.indexOf("arrayCopyNonAtomic(OUT_MAGIC");
        int witness = w.indexOf("arrayCopyNonAtomic(lastSig, (short) 1, outbox, at, (short) 64)");
        int markBegin = w.indexOf("JCSystem.beginTransaction();", witness);
        int length = w.indexOf("Util.setShort(outbox, (short) 2, (short)(at - 4));");
        int whole = w.indexOf("outbox[0] = (byte) 1;");
        int markCommit = w.indexOf("JCSystem.commitTransaction();", whole);
        assertTrue(clearBegin >= 0 && clearBegin < cleared && cleared < clearCommit && clearCommit < firstBody && firstBody < witness
                && witness < markBegin && markBegin < length && length < whole && whole < markCommit,
            "status 0 in a transaction, then the body, then the length and status 1 in a transaction");
        assertEquals(1, w.split("outbox\\[0\\] = \\(byte\\) 1;", -1).length - 1, "status 1 is written once");
        assertFalse(w.substring(clearCommit, markBegin).contains("beginTransaction"), "the body is written outside any transaction");
        String sign = code.substring(code.indexOf("private void processSpendAllSign("), code.indexOf("private void finishBurn("));
        int receipt = sign.indexOf("addUint32Stop(cardReceipts, (short) 0, ONE, (short) 0);");
        int record = sign.indexOf("writeOutbox(buf, n);");
        int answer = sign.lastIndexOf("apdu.setOutgoingAndSend((short) 0, sigLen);");
        assertTrue(receipt > 0 && receipt < record && record < answer, "the record after the receipt, before the answer");
        assertTrue(sign.substring(record, answer).contains("Util.arrayCopyNonAtomic(lastSig, (short) 1, buf, (short) 0, (short) 64);"), "and the signature put back for the answer");
        String dispatch = code.substring(code.indexOf("public void process("), code.indexOf("private void processGetInfo("));
        assertFalse(dispatch.contains("!= INS_GET_OUTBOX"), "not a step of a payment: a read drops one begun");
    }

    @Test
    @DisplayName("the layout: OUTBOX_MAX is 3,688 and the four arrays are 4,321 bytes, all persistent and made at install")
    void layoutConstants() throws Exception {
        assertEquals(3688, CashuApplet.OUTBOX_MAX);
        assertEquals(166 + 1 + 32 * 83 + 1 + 16 * 46 + 64 + 64, CashuApplet.OUTBOX_MAX);
        assertEquals(32, CashuApplet.OUT_IN_MOST);
        assertEquals(16, CashuApplet.OUT_OUT_MOST);
        assertEquals(3692, field("outbox").length);
        assertEquals(593, field("outStage").length);
        assertEquals(32, field("outInstall").length);
        assertEquals(4, field("outGen").length);
        assertEquals(4321, field("outbox").length + field("outStage").length + field("outInstall").length + field("outGen").length);
        assertArrayEquals(new byte[] { 0, 0, 0, 1 }, field("outGen"), "generation 1 at install");
        assertFalse(Arrays.equals(new byte[32], field("outInstall")), "the installation drawn at install");
        assertEquals(0x1B, CashuApplet.INS_GET_OUTBOX);
        assertEquals(45, CashuApplet.OUT_SCOPE_LEN);
    }
}
