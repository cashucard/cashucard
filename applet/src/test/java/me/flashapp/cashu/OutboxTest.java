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

    /** A new card, set up with the record naming `mint`; or, for a null `mint`, just installed and not set up. */
    private void fresh(String mint) {
        runtime = new ExposedRuntime();
        sim = new CardSimulator(runtime);
        sim.installApplet(AIDUtil.create(AID_HEX), CashuApplet.class);
        reselect();
        if (mint != null) readyOn(sim, 0, true, mint);
        pieces.clear();
    }

    // ---- the card --------------------------------------------------------

    private ResponseAPDU tx(CommandAPDU c) { return sim.transmitCommand(c); }
    private void reselect() { assertEquals(SW_OK, tx(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR))).getSW()); }
    private void verifyPin() { assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW()); }
    private byte[] cardKey() { return tx(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }
    /** The card's keys now (D197): a packet's payment is of the date 0, and names the card's key for it. */
    private DateKeys keys() { return DateKeys.of(runtime.appletAt(com.licel.jcardsim.utils.AIDUtil.create(AID_HEX))); }

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
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, p, 1));
            assertEquals(SW_OK, r.getSW(), "load " + i);
            places[i] = r.getData()[0] & 0xFF;
            pieces.put(places[i], p);
        }
        return places;
    }
    private int[] load(long... amounts) { return loadDated(0, amounts); }
    /** A piece of `keyset` on the card, so that the table holds it (a change is made only in a keyset the card holds and was taught). */
    private void holdAPieceOf(byte[] keyset) {
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, buildProof(toHex(keyset), 1, 77), 1)).getSW(), "a piece of " + toHex(keyset));
    }

    /** A payment as a till makes one: the places, its outputs, the card's change of these amounts, and the signature. */
    static final class Payment {
        int[] places;
        byte[][] outputs;     // the till's, then the change, as the message has them
        byte[][] keysets;     // each output's keyset where it is not the first piece's (the change's in SPEND_ALL_CHANGE's 45-byte form), or null
        byte[] signature;
        int sw;
    }

    private Payment pay(int[] places, byte[][] outputs, long... change) {
        return pay(places, outputs, change, new byte[change.length][]);
    }

    /** The same, each change output signed in the keyset `keysets` names for it (the 45-byte form), or the first piece's where null. */
    private Payment pay(int[] places, byte[][] outputs, long[] change, byte[][] keysets) {
        Payment p = new Payment();
        p.places = places;
        byte[] list = new byte[places.length];
        for (int i = 0; i < places.length; i++) list[i] = (byte) places[i];
        ResponseAPDU begun = tx(CashuAppletTest.spendBegin(list));
        assertEquals(SW_OK, begun.getSW(), "begin");
        List<byte[]> all = new ArrayList<>(Arrays.asList(outputs));
        for (int at = 0; at < outputs.length; at += 6) {
            ResponseAPDU r = tx(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(Arrays.copyOfRange(outputs, at, Math.min(outputs.length, at + 6)))));
            assertEquals(SW_OK, r.getSW(), "outputs");
        }
        List<byte[]> named = new ArrayList<>(Arrays.asList(new byte[outputs.length][]));
        for (int i = 0; i < change.length; i++) {
            long c = change[i];
            CommandAPDU ask = keysets[i] == null ? changeCommand(c, mintKey()) : changeCommand(c, mintKey(), keysets[i]);
            ResponseAPDU r = tx(ask);
            assertEquals(SW_OK, r.getSW(), "change");
            all.add(output(c, r.getData()));
            named.add(keysets[i]);
        }
        p.outputs = all.toArray(new byte[0][]);
        p.keysets = named.toArray(new byte[0][]);
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

    /** Every opening of change owed given up by the owner (RESET_CARD's let-go form): a reset wants nothing owed (D183). */
    private void letGoAll() {
        for (byte[] d = tx(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData(); d[0] != 0; d = tx(new CommandAPDU(CLA, INS_GET_CHANGE, 0, 0, 256)).getData()) {
            byte[] k = { d[1] };
            byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
            assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_RESET_CARD, 1, k[0], ownerData(ownerProof(L_RESET, OWNER, n, k), k))).getSW(), "opening " + k[0] + " given up");
        }
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
        b.write(keys().key(0));
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
        for (int i = 0; i < p.outputs.length; i++) {
            byte[] o = p.outputs[i];
            b.write(o, 0, 4);
            b.write(8);
            b.write(p.keysets[i] == null ? firstKeyset : p.keysets[i]);
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
        assertTrue(schnorrVerify(extractPubkeyX(keys().key(0)), tagged(body), descriptor), "the descriptor is the signature of the card's key for the date 0 (the key the packet names) over SHA-256(tag || tag || body)");
        assertFalse(schnorrVerify(extractPubkeyX(cardKey()), tagged(body), descriptor), "and not the card key's: the packet does not name it");
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
    @DisplayName("2.3 (D183): a till's output is under the first piece's keyset in the record even where its B_ is an owed opening's of an earlier payment: only the payment's own change is looked up among the openings")
    void aTillsOutputIsNeverTakenForChange() throws Exception {
        int[] first = load(8, 16);
        byte[] moved = hexToBytes("00aabbccddeeff01");
        holdAPieceOf(moved);
        Payment earlier = pay(first, tillOutputs(9), new long[] { 15 }, new byte[][] { moved });
        assertEquals(SW_OK, earlier.sw);
        byte[] owedB = Arrays.copyOfRange(earlier.outputs[1], 4, 37);
        // the next payment's till names an output whose B_ is that opening's, which is still owed
        Payment p = pay(load(5), new byte[][] { output(5, owedB) });
        assertEquals(SW_OK, p.sw);
        byte[] packet = packet();
        assertRecord(expectedBody(p, MINT, 2, 1), packet);
    }

    @Test
    @DisplayName("2.3 (D183): the card's own change carries its opening's keyset in the record: the one SPEND_ALL_CHANGE's 45-byte form named, or the first piece's; the till's outputs carry the first piece's")
    void theChangeCarriesItsOwnKeyset() throws Exception {
        int[] places = load(8, 16);
        byte[] moved = hexToBytes("00aabbccddeeff01");
        holdAPieceOf(moved);
        Payment p = pay(places, tillOutputs(9, 1), new long[] { 4, 6, 4 }, new byte[][] { moved, null, moved });
        assertEquals(SW_OK, p.sw);
        assertTrue(keys().signed(p.signature, slotData(p), p.outputs),
            "the keyset is in no message: the witness is the one the 37-byte form gives");
        byte[] packet = packet();
        assertRecord(expectedBody(p, MINT, 1, 1), packet);
        // and the expected body is not the one with every output under the first piece's keyset
        Payment allFirst = new Payment();
        allFirst.places = p.places; allFirst.outputs = p.outputs; allFirst.signature = p.signature; allFirst.keysets = new byte[p.outputs.length][];
        assertFalse(Arrays.equals(expectedBody(allFirst, MINT, 1, 1), Arrays.copyOf(packet, packet.length - 64)));
    }

    @Test
    @DisplayName("a record only after a payment that was signed: none on a new card (6A88 to the PIN's scope; the PIN alone on a card with an owner is not told the packet, 6982); a paid one leaves it; a later payment refused for the PIN (6A94), or dropped after its outputs by the read itself, leaves it byte for byte")
    void recordOnlyAfterSuccessfulSign() throws Exception {
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "a new card has no record");
        assertEquals(SW_SECURITY_NOT_SATIS, page(0, 255).getSW(), "the packet is the holder's say: the owner's grant");
        Payment p = twoByTwo();
        assertTrue(keys().signed(p.signature, slotData(p), p.outputs),
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
        assertEquals(SW_OK, tx(CashuAppletTest.spendBegin(list)).getSW());
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

    /** The owner's grant in this tap (ALLOW_LOAD with the owner's proof): the holder's say on a card with an owner. */
    private void grant() {
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_GRANT, tx(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0]))).getSW());
    }

    @Test
    @DisplayName("who reads the record: the tap that paid reads both forms, a re-SELECT in it included; in a new tap a stranger gets 6982 to both, the PIN reads the scope and not the packet (6982) on a card with an owner, and the owner's grant reads both")
    void thePayingTapAndTheHolderRead() throws Exception {
        Payment p = twoByTwo();
        reselect();
        assertEquals(1, tx(new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256)).getData()[7], "a PIN is set");
        assertEquals(SW_OK, scope().getSW(), "a re-SELECT keeps the tap that paid");
        assertRecord(expectedBody(p, MINT, 1, 1), packet());
        sim.reset();
        reselect();
        assertEquals(SW_SECURITY_NOT_SATIS, scope().getSW(), "a stranger: no scope");
        assertEquals(SW_SECURITY_NOT_SATIS, page(0, 255).getSW(), "a stranger: no page");
        verifyPin();
        assertEquals(SW_OK, scope().getSW(), "the PIN: the scope");
        assertEquals(SW_SECURITY_NOT_SATIS, page(0, 255).getSW(), "the PIN on a card with an owner: no page");
        sim.reset();
        reselect();
        grant();
        assertEquals(SW_OK, scope().getSW(), "the owner's grant: the scope");
        assertRecord(expectedBody(p, MINT, 1, 1), packet());
    }

    @Test
    @DisplayName("a stranger cannot tell whether a record is kept: with none, GET_OUTBOX answers it 6982 to both forms, as with one; a reader with the PIN gets 6A88")
    void aStrangerCannotTellARecordIsKept() throws Exception {
        sim.reset();
        reselect();
        assertEquals(SW_SECURITY_NOT_SATIS, scope().getSW(), "no record, a stranger: 6982");
        assertEquals(SW_SECURITY_NOT_SATIS, page(0, 255).getSW(), "no record, a stranger's page: 6982");
        verifyPin();
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "no record, the PIN: 6A88");
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
        letGoAll();
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0]))).getSW());
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "no record after a reset");
        assertArrayEquals(new byte[] { 0, 0, 0, 2 }, field("outGen"));
        assertArrayEquals(install, field("outInstall"), "the installation is the card's");
        CashuAppletTest.newTimeInTheField(sim);
        readyOn(sim, 0, true, MINT);
        pieces.clear();
        Payment p = twoByTwo();
        assertFalse(Arrays.equals(keyBefore, cardKey()), "a new key");
        byte[] body = expectedBody(p, MINT, 1, 2);
        assertRecord(body, packet());
        assertEquals(2, readUint32(scope().getData(), 9), "generation 2");
        assertEquals(1, readUint32(scope().getData(), 5), "payment id 1 again: unique with the generation");
        assertEquals(2, readUint32(body, 89 + MINT.length() + 2), "each input's generation is the card's: the first input's, after the count and its place");

        // in the source the generation is stepped before the receipt count goes back to 0: a reset torn between them leaves
        // a larger generation, never payment id 1 again under the old one
        String code = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8);
        int from = code.indexOf("private void processResetCard(");
        assertTrue(from >= 0, "RESET_CARD's handler");
        String reset = code.substring(from, code.indexOf("\n    }\n", from));
        assertTrue(reset.indexOf("forget();") > 0, "RESET_CARD takes the history down by `forget`, as a forgotten PIN's is");
        // `forget` steps the generation first, and only then zeroes the receipts
        int from2 = code.indexOf("private void forget(");
        String forget = code.substring(from2, code.indexOf("\n    }\n", from2));
        int stepped = forget.indexOf("Util.arrayCopy(scratch, X_NUM, outGen, (short) 0, (short) 4);");
        int zeroed = forget.indexOf("Util.arrayFillNonAtomic(cardReceipts, (short) 0, RECEIPTS_LEN, (byte) 0);");
        assertTrue(stepped > 0 && zeroed > 0 && stepped < zeroed, "the generation is written before the receipts are zeroed");
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
        String sign = code.substring(code.indexOf("private void processSpendAllSign("), code.indexOf("private boolean finishBurn("));
        // the receipt is finishBurn's (D196), which SIGN calls before the record
        int receipt = sign.indexOf("if (!finishBurn()) n = 0;");
        int record = sign.indexOf("writeOutbox(buf, n);");
        int answer = sign.lastIndexOf("apdu.setOutgoingAndSend((short) 0, sigLen);");
        assertTrue(code.substring(code.indexOf("private boolean finishBurn("), code.indexOf("private void processSpendAllAgain(")).contains("addUint32Stop(cardReceipts, (short) 0, ONE, (short) 0);"), "finishBurn writes the receipt");
        assertTrue(receipt > 0 && receipt < record && record < answer, "the record after the receipt, before the answer");
        assertTrue(sign.substring(record, answer).contains("Util.arrayCopyNonAtomic(lastSig, (short) 1, buf, (short) 0, (short) 64);"), "and the signature put back for the answer");
        String dispatch = code.substring(code.indexOf("public void process("), code.indexOf("private void processGetInfo("));
        assertFalse(dispatch.contains("!= INS_GET_OUTBOX"), "not a step of a payment: a read drops one begun");
    }

    private void setOutbox(byte[] a) throws Exception { setField("outbox", a); }
    private void setOutStage(byte[] a) throws Exception { setField("outStage", a); }
    private void setField(String name, byte[] a) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(runtime.appletAt(AIDUtil.create(AID_HEX)), a);
    }

    /** The count of payments ever, as GET_LOG P1 = 1 answers it to the owner's grant (given here, in this tap). */
    private long receiptCount() {
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_GRANT, tx(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(ownerProof(L_LOAD, OWNER, n, new byte[0]), new byte[0]))).getSW(), "the owner's grant");
        ResponseAPDU r = tx(new CommandAPDU(CLA, INS_GET_LOG, 1, 0, 256));
        assertEquals(SW_OK, r.getSW(), "the receipts");
        return readUint32(r.getData(), 0);
    }

    /** A payment whose record write throws (`what`): answered, burned and receipted as ever, and no transaction left open. */
    private void paidDespiteAFault(String what, long receiptsBefore) throws Exception {
        Payment p = twoByTwo();
        assertEquals(64, p.signature.length, what + ": SIGN answers the signature");
        assertTrue(keys().signed(p.signature, slotData(p), p.outputs),
            what + ": the signature is over the payment's message");
        ResponseAPDU again = tx(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64));
        assertEquals(SW_OK, again.getSW(), what + ": SPEND_ALL_AGAIN");
        assertArrayEquals(p.signature, again.getData(), what + ": the same signature again");
        byte[] status = tx(new CommandAPDU(CLA, INS_GET_SLOT_STATUS, 0, 0, 256)).getData();
        for (int place : p.places) assertEquals(CashuApplet.STATUS_SPENT, status[place], what + ": place " + place + " spent");
        assertEquals(receiptsBefore + 1, receiptCount(), what + ": the receipt count stepped");
        assertEquals(0, runtime.getTransactionDepth(), what + ": no transaction left open");
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), what + ": and no record");
    }

    @Test
    @DisplayName("a fault in the record never fails the payment: a record write that throws outside a transaction, or inside one, leaves SIGN's answer, the burn and the receipt as they are, no transaction open, and the next payment recording again")
    void recordFaultNeverFailsPayment() throws Exception {
        byte[] real = field("outbox");
        long count = receiptCount();
        // outside: the first commit is made, then the body's first copy at outbox[4] is out of bounds
        setOutbox(new byte[4]);
        paidDespiteAFault("outside a transaction", count);
        // inside: outbox[1] is out of bounds within the first transaction, which the catch aborts
        setOutbox(new byte[1]);
        paidDespiteAFault("inside a transaction", count + 1);
        // a real record again: the next payment records, with its own payment id
        setOutbox(real);
        Payment p = twoByTwo();
        assertRecord(expectedBody(p, MINT, count + 3, 1), packet());
    }

    @Test
    @DisplayName("the record's room is reserved by the first SET_CARD that goes through (D176): none after install, where GET_OUTBOX answers 6982 to both forms (no reader is told before a PIN); 3,692 and 601 bytes after it (593 staged outputs and the till's keyset, 8); the same arrays after every SET_CARD that follows")
    void theRecordIsReservedAtTheFirstSetCard() throws Exception {
        fresh(null);
        assertNull(field("outbox"), "not made at install");
        assertNull(field("outStage"), "not made at install");
        assertEquals(SW_SECURITY_NOT_SATIS, scope().getSW(), "a card not set up tells no reader: 6982");
        assertEquals(SW_SECURITY_NOT_SATIS, page(0, 255).getSW(), "and the same to a page");
        assertEquals(SW_INCORRECT_P1P2, tx(new CommandAPDU(CLA, INS_GET_OUTBOX, 2, 0, 256)).getSW(), "a P1 that is not 00 or 01 is still refused first");
        assertArrayEquals(new byte[] { 0, 0, 0, 1 }, field("outGen"), "the generation is made at install");
        readyOn(sim, 0, true, MINT);
        byte[] outbox = field("outbox");
        byte[] outStage = field("outStage");
        assertNotNull(outbox, "the first SET_CARD reserves the record");
        assertEquals(3692, outbox.length);
        assertEquals(601, outStage.length);
        assertEquals(SW_SLOT_EMPTY, scope().getSW(), "and it holds none yet");
        byte[] rec = record(MINT, REFUND);
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(ownerProof(L_CARD, OWNER, n, rec), rec))).getSW(), "a second SET_CARD, the owner's");
        assertSame(outbox, field("outbox"), "does not make another");
        assertSame(outStage, field("outStage"));
        Payment p = twoByTwo();
        assertRecord(expectedBody(p, MINT, receiptCount(), 1), packet());
    }

    @Test
    @DisplayName("a card whose SET_CARD could not reserve the record (D176) works as one that keeps none: a SIG_ALL payment is signed, burned and receipted with no exception and no transaction open, GET_OUTBOX answers 6A88 to both forms, and RESET_CARD and SET_CARD still go through")
    void aCardWithNoRoomForTheRecordPaysAndKeepsNone() throws Exception {
        // the record refused (and so its staging, which is only asked for after it)
        setOutbox(null);
        setOutStage(null);
        long count = receiptCount();
        paidDespiteAFault("no room for a record", count);
        assertEquals(SW_SLOT_EMPTY, page(0, 255).getSW(), "no page either");
        assertNull(field("outbox"));
        assertNull(field("outStage"));

        // RESET_CARD lets nothing go but steps the generation as ever
        letGoAll();
        byte[] n = tx(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getData();
        assertEquals(SW_OK, tx(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(ownerProof(L_RESET, OWNER, n, new byte[0]), new byte[0]))).getSW(), "RESET_CARD");
        assertArrayEquals(new byte[] { 0, 0, 0, 2 }, field("outGen"), "the generation stepped");
        assertEquals(SW_SLOT_EMPTY, scope().getSW());
        // and the next SET_CARD asks again (here the simulator gives the room, so the card records again)
        CashuAppletTest.newTimeInTheField(sim);
        readyOn(sim, 0, true, MINT);
        pieces.clear();
        assertNotNull(field("outbox"), "SET_CARD asks for the room again");
        Payment p = twoByTwo();
        assertRecord(expectedBody(p, MINT, 1, 2), packet());
    }

    @Test
    @DisplayName("a card that reserved the record but not its staging (D176) keeps no record either: the payment is paid, GET_OUTBOX answers 6A88, and the record's room is left as it was")
    void aCardWithNoRoomForTheStagingPaysAndKeepsNone() throws Exception {
        setOutStage(null);
        byte[] outbox = field("outbox");
        paidDespiteAFault("no room for the staging", receiptCount());
        assertSame(outbox, field("outbox"));
        assertTrue(allZeroBytes(outbox), "nothing written to the record");
    }

    private static boolean allZeroBytes(byte[] a) {
        for (byte b : a) if (b != 0) return false;
        return true;
    }

    @Test
    @DisplayName("the layout: OUTBOX_MAX is 3,688 and the four arrays are 4,329 bytes, all persistent: the installation and the generation (36) made at install, the record and its staging (3,692 + 601: the outputs and the till's keyset) at the first SET_CARD (D176)")
    void layoutConstants() throws Exception {
        // a card just installed: the installation and the generation, and no record or staging yet
        fresh(null);
        assertNull(field("outbox"), "the record's room is not made at install: the J3R180 refused the constructor that made it (D176)");
        assertNull(field("outStage"), "nor its staging");
        assertEquals(32, field("outInstall").length);
        assertEquals(4, field("outGen").length);
        assertEquals(36, field("outInstall").length + field("outGen").length);
        readyOn(sim, 0, true, MINT);
        assertEquals(3688, CashuApplet.OUTBOX_MAX);
        assertEquals(166 + 1 + 32 * 83 + 1 + 16 * 46 + 64 + 64, CashuApplet.OUTBOX_MAX);
        assertEquals(32, CashuApplet.OUT_IN_MOST);
        assertEquals(16, CashuApplet.OUT_OUT_MOST);
        assertEquals(3692, field("outbox").length);
        assertEquals(601, field("outStage").length);
        assertEquals(593, CashuApplet.OUT_STAGE_KEYSET, "the till's keyset after the sixteen outputs");
        assertEquals(32, field("outInstall").length);
        assertEquals(4, field("outGen").length);
        assertEquals(4329, field("outbox").length + field("outStage").length + field("outInstall").length + field("outGen").length);
        assertArrayEquals(new byte[] { 0, 0, 0, 1 }, field("outGen"), "generation 1 at install");
        assertFalse(Arrays.equals(new byte[32], field("outInstall")), "the installation drawn at install");
        assertEquals(0x1B, CashuApplet.INS_GET_OUTBOX);
        assertEquals(45, CashuApplet.OUT_SCOPE_LEN);
    }
}
