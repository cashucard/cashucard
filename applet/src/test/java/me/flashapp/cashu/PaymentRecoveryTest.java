package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_ALLOW_LOAD;

import static me.flashapp.cashu.CashuAppletTest.INS_GET_PUBKEY;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_AGAIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_CHANGE;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_OUTPUTS;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_SIGN;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.REFUND;
import static me.flashapp.cashu.CashuAppletTest.SW_CONDITIONS_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_OVER_LIMIT;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_SLOT_EMPTY;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.allMessage;
import static me.flashapp.cashu.CashuAppletTest.changeCommand;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.extractPubkeyX;
import static me.flashapp.cashu.CashuAppletTest.hexToBytes;
import static me.flashapp.cashu.CashuAppletTest.keyOf;
import static me.flashapp.cashu.CashuAppletTest.mintKey;
import static me.flashapp.cashu.CashuAppletTest.output;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.readUint32;
import static me.flashapp.cashu.CashuAppletTest.schnorrVerify;
import static me.flashapp.cashu.CashuAppletTest.sha256;
import static me.flashapp.cashu.CashuAppletTest.toHex;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static me.flashapp.cashu.KeysetKeysTest.B;
import static me.flashapp.cashu.KeysetKeysTest.SW_KEYS_NOT_SHOWN;
import static me.flashapp.cashu.KeysetKeysTest.depth;
import static me.flashapp.cashu.KeysetKeysTest.lastRow;
import static me.flashapp.cashu.KeysetKeysTest.loadChange;
import static me.flashapp.cashu.KeysetKeysTest.path;
import static me.flashapp.cashu.KeysetKeysTest.show;
import static me.flashapp.cashu.KeysetKeysTest.taught;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A payment and its change come back (2.3): the signature of each kept receipt is asked for again by its message; a swap whose
 * outputs and change come to more than its pieces is refused before anything is signed; the change is made only in a keyset
 * named, held and taught, and the holder's mend moves an opening to another taught keyset of its unit; the till's outputs carry
 * the keyset it names in the payment's record; and the day's limit counts the change until it is back on the card.
 */
class PaymentRecoveryTest {

    static final int SW_OTHER_UNIT = 0x6A9B, SW_NO_SPACE = 0x6A84, SW_NO_RATE = 0x6A99;
    static final byte INS_GET_OUTBOX = (byte) 0x1B;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    /** An output of a till's: the amount and a B_ of its own. */
    static byte[] out(long amount, int seed) {
        byte[] b = new byte[33];
        b[0] = 0x02;
        for (int i = 1; i < 33; i++) b[i] = (byte) (seed + i);
        return output(amount, b);
    }

    /** The owner's grant, whatever word answers it. */
    static void grant(UnitsTest.Card c) {
        c.send(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(c.proofFor(L_LOAD, new byte[0]), new byte[0])));
    }

    /** A card with an owner and a PIN, the PIN given, the grant given. */
    static UnitsTest.Card card() {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        grant(c);
        return c;
    }

    /** BEGIN, the till's outputs, SIGN: the signature, or what refused it. */
    static ResponseAPDU payTo(UnitsTest.Card c, int place, byte[]... outs) {
        assertEquals(SW_OK, c.begin(place).getSW());
        if (outs.length > 0) assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(outs))));
        return c.sign();
    }

    /** SHA-256 of a payment's SIG_ALL message, as the till that made it works it out. */
    static byte[] messageOf(UnitsTest.Card c, byte[] slot, byte[]... outs) {
        return DateKeys.of(c.applet()).hash(new byte[][] { slot }, outs);
    }

    static ResponseAPDU again(UnitsTest.Card c, byte[] hash) {
        return c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, hash, 64));
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // The signature of an earlier payment, asked for again by its message (SPEND_ALL_AGAIN P1 = 1)
    // ---------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("SPEND_ALL_AGAIN P1 = 1: the signature of any payment whose receipt the card keeps is given again for its message's SHA-256, not only the last; P1 = 0 is the last as before")
    void anEarlierPaymentsSignatureIsGivenAgain() throws Exception {
        UnitsTest.Card c = card();
        int a = c.put(-1, UnitsTest.SAT_A, 1000);
        int b = c.put(-1, UnitsTest.SAT_A, 50);
        byte[] slotA = c.slot(a), slotB = c.slot(b);
        byte[] toA = out(1000, 1), toB = out(50, 2);
        ResponseAPDU sig1 = payTo(c, a, toA);
        assertEquals(64, sig1.getData().length, "payment 1 signed; its answer lost on the air");
        c.tap();
        ResponseAPDU sig2 = payTo(c, b, toB);
        assertEquals(64, sig2.getData().length, "payment 2, at another till");
        c.tap();
        assertArrayEquals(sig2.getData(), c.send(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 0, 0, 64)).getData(), "P1 = 0: the last, as before");
        ResponseAPDU first = again(c, messageOf(c, slotA, toA));
        assertEquals(SW_OK, first.getSW());
        assertArrayEquals(sig1.getData(), first.getData(), "P1 = 1: payment 1's signature, by its message");
        assertTrue(DateKeys.of(c.applet()).verifies(0, messageOf(c, slotA, toA), first.getData()),
            "and it is good for that swap");
        assertArrayEquals(sig2.getData(), again(c, messageOf(c, slotB, toB)).getData(), "and payment 2's by its own");
        assertEquals(SW_SLOT_EMPTY, again(c, new byte[32]).getSW(), "a message no receipt has: 6A88");
        assertEquals(SW_SLOT_EMPTY, again(c, sha256("no payment".getBytes(StandardCharsets.US_ASCII))).getSW());
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_AGAIN, 1, 0, new byte[31], 64)), "31 bytes: 6700");
        // a payment signed under the PIN is given again under the PIN
        c.power();
        assertEquals(SW_SLOT_EMPTY, again(c, messageOf(c, slotA, toA)).getSW(), "no PIN in this tap: 6A88, as for any message no receipt has (D198: no oracle)");
    }

    @Test
    @DisplayName("SPEND_ALL_AGAIN P1 = 1 keeps one signature beside each of the sixteen receipts: the seventeenth payment back is gone with its receipt, and a reset lets them all go")
    void theSignaturesGoWithTheirReceipts() throws Exception {
        UnitsTest.Card c = card();
        int[] places = new int[17];
        byte[][] slots = new byte[17][];
        for (int i = 0; i < 17; i++) {
            places[i] = c.put(-1, UnitsTest.SAT_A, 10 + i);
            slots[i] = c.slot(places[i]);
        }
        byte[][] sigs = new byte[17][];
        for (int i = 0; i < 17; i++) {
            c.tap();
            sigs[i] = payTo(c, places[i], out(10 + i, i)).getData();
            assertEquals(64, sigs[i].length);
        }
        c.tap();
        assertEquals(SW_SLOT_EMPTY, again(c, messageOf(c, slots[0], out(10, 0))).getSW(), "the first payment's receipt is gone: its signature too");
        for (int i = 1; i < 17; i++) assertArrayEquals(sigs[i], again(c, messageOf(c, slots[i], out(10 + i, i))).getData(), "payment " + i);
        byte[] kept = c.field("paid");
        int sigsAt = 8195;
        boolean any = false;
        for (int i = sigsAt; i < kept.length; i++) any |= kept[i] != 0;
        assertTrue(any, "kept after the paid list");
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // Outputs and change past the pieces
    // ---------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("A swap no mint takes is not signed: outputs that come to more than the pieces are refused at SPEND_ALL_OUTPUTS (6A80), and outputs and change together at SPEND_ALL_CHANGE (6A80); the payment is given up and nothing is burned")
    void outputsPastThePiecesAreRefused() throws Exception {
        UnitsTest.Card c = card();
        int a = c.put(-1, UnitsTest.SAT_A, 100);
        byte[] pieceA = Arrays.copyOfRange(c.slot(a), 1, 82);
        assertEquals(SW_OK, c.begin(a).getSW());
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out(1000, 7))), "outputs of 1,000 for a piece of 100");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment given up");
        // the outputs within it, and then change that takes them past it
        assertEquals(SW_OK, c.begin(a).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(out(60, 1), out(30, 2)))), "90 of 100");
        assertEquals(SW_WRONG_DATA, c.sw(changeCommand(11, mintKey(), hexToBytes(UnitsTest.SAT_A))), "and change of 11: 101");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)));
        assertEquals(1, c.slot(a)[0], "nothing burned");
        // exactly the pieces is a swap
        assertEquals(SW_OK, c.begin(a).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(out(60, 1), out(30, 2)))));
        assertEquals(SW_OK, c.sw(changeCommand(10, mintKey(), hexToBytes(UnitsTest.SAT_A))), "change of 10: 100");
        assertEquals(64, c.sign().getData().length);
        // an output sent among the waits is held to the same sum
        int b = c.put(-1, UnitsTest.SAT_A, 100);
        assertEquals(SW_OK, c.ownerLimit(concat(u32(0), u32(1))), "a limit on one payment of 1: a payment waits");
        c.tap();
        assertEquals(SW_OK, c.begin(b).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out(90, 3))));
        ResponseAPDU first = c.send(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64));
        assertEquals(2, first.getData().length, "a wait");
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out(11, 4))), "90 and 11 among the waits: 101");
        // and the piece of the refused swap is still the card's to load again: it was never signed for
        assertEquals(1, c.slot(b)[0]);
        assertEquals(81, pieceA.length);
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // The change's keyset: named, held, taught
    // ---------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("SPEND_ALL_CHANGE names its keyset (45 bytes; 37 is 6700) and it is one the card holds and has been taught (6A9F otherwise, the table untouched): a stranger with no PIN writes nothing in the table")
    void theChangeKeysetIsNamedHeldAndTaught() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, UnitsTest.SAT_A, 64);
        c.runtime.teachForChange = false;
        c.power();   // a stranger: no PIN, no grant
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_WRONG_LENGTH, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_CHANGE, 0, 0, concat(u32(8), mintKey()), 33)), "the 37-byte form: 6700");
        byte[] table = c.book().clone();
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(8, mintKey(), hexToBytes(UnitsTest.USD_A))), "a keyset in no entry: 6A9F");
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(changeCommand(8, mintKey(), hexToBytes(UnitsTest.SAT_A))), "the piece's own keyset, its keys not taught: 6A9F");
        assertArrayEquals(table, c.book(), "nothing written in the table");
        assertEquals(-1, c.entryOf(UnitsTest.USD_A));
    }

    @Test
    @DisplayName("A card that holds no keyset table makes no change for itself (SPEND_ALL_CHANGE 6A84), and the table is reserved before the openings' keys")
    void noTableNoChange() throws Exception {
        UnitsTest.Card c = card();
        c.setField("book", null);
        int place = c.put(-1, A.id8(), 64);
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_NO_SPACE, c.sw(changeCommand(8, A.keyFor(8), hexToBytes(A.id8()))), "6A84: no change");
        assertEquals(SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_SIGN, 0, 0, 64)), "the payment given up");
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8));
        int table = src.indexOf("book = new byte[BOOK_LEN];"), keys = src.indexOf("openKeys = new byte[(short)(CHANGE_MOST * OPEN_KEYS_ROW)];");
        assertTrue(table > 0 && keys > 0 && table < keys, "the table first");
    }

    @Test
    @DisplayName("The holder's mend (KEYSET_KEYS P1 = 3 with another key and a keyset) moves an opening to the keyset the mint signed its change in, one of its unit and taught: then the mint's answer is written; 6A9B for a keyset of the other unit")
    void theMendMovesAnOpeningToAnotherKeyset() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, A.id8(), 64);
        c.put(-1, B.id8(), 1);
        taught(c, A);
        taught(c, B);
        c.tap();
        grant(c);
        byte[] row = KeysetKeysTest.payWithChange(c, place, 8, A.keyFor(8), A.id8());
        int k = row[0];
        // the change is posted under B (the mint moved on), so the mint signs B_ with B's key for 8
        c.power();
        assertEquals(SW_OK, show(c, k, A, 8), "A's key shown");
        assertEquals(SW_WRONG_DATA, loadChange(c, row, B.privFor(8)).getSW(), "B's answer is not under A's key");
        // the mend: the PIN, the owner's grant, a tap that paid nothing, B's key, its path in B's tree, and B
        c.tap();
        grant(c);
        int i = B.indexOf(8);
        int mend = c.sw(new CommandAPDU(CLA, KeysetKeysTest.INS_KEYSET_KEYS, 3, 0,
            concat(new byte[] { (byte) k, (byte) i, (byte) depth(B) }, path(B, i), B.keyFor(8), hexToBytes(B.id8()))));
        assertEquals(SW_OK, mend, "moved to B");
        assertEquals(B.id8(), toHex(Arrays.copyOfRange(lastRow(c), 5, 13)), "the opening is in B now");
        c.power();
        ResponseAPDU back = loadChange(c, row, B.privFor(8));
        assertEquals(SW_OK, back.getSW(), "the mint's answer under B's key is written");
        assertEquals(B.id8(), toHex(Arrays.copyOfRange(c.slot(back.getData()[0]), 1, 9)), "a piece of B");
    }

    @Test
    @DisplayName("The mend moves an opening only to a keyset of its own unit (6A9B) whose keys the card was taught (6A9F)")
    void theMendStaysInItsUnit() throws Exception {
        UnitsTest.Card c = card();
        c.runtime.teachForChange = false;   // A and B taught below, THREE never
        int place = c.put(-1, A.id8(), 64);
        c.put(UnitsTest.USD, B.id8(), 1);
        c.put(-1, KeysetKeysTest.THREE.id8(), 1);
        taught(c, A);
        taught(c, B);
        c.tap();
        grant(c);
        byte[] row = KeysetKeysTest.payWithChange(c, place, 8, A.keyFor(8), A.id8());
        c.tap();
        grant(c);
        int i = B.indexOf(8);
        assertEquals(SW_OTHER_UNIT, c.sw(new CommandAPDU(CLA, KeysetKeysTest.INS_KEYSET_KEYS, 3, 0,
            concat(new byte[] { row[0], (byte) i, (byte) depth(B) }, path(B, i), B.keyFor(8), hexToBytes(B.id8())))), "B is a usd keyset");
        int t = KeysetKeysTest.THREE.indexOf(4);
        assertEquals(SW_KEYS_NOT_SHOWN, c.sw(new CommandAPDU(CLA, KeysetKeysTest.INS_KEYSET_KEYS, 3, 0,
            concat(new byte[] { row[0], (byte) t, (byte) depth(KeysetKeysTest.THREE) }, path(KeysetKeysTest.THREE, t), KeysetKeysTest.THREE.keyFor(4),
                   hexToBytes(KeysetKeysTest.THREE.id8())))), "THREE was never taught");
        assertEquals(A.id8(), toHex(Arrays.copyOfRange(lastRow(c), 5, 13)), "still in A");
    }

    @Test
    @DisplayName("SPEND_ALL_OUTPUTS P1 = 1 names the keyset the till's outputs are in (8 bytes, then the outputs): the payment's record carries it for each till output; with P1 = 0 they carry the first piece's, as in 2.2")
    void theTillsKeysetIsInTheRecord() throws Exception {
        UnitsTest.Card c = card();
        int place = c.put(-1, UnitsTest.SAT_A, 64);
        byte[] ks = hexToBytes("00cc000000000009");
        byte[] o = out(60, 5);
        c.tap();
        assertEquals(SW_OK, c.begin(place).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 1, 0, concat(ks, o))), "the keyset, then the output");
        assertEquals(64, c.sign().getData().length);
        byte[] packet = outbox(c);
        assertTrue(indexOf(packet, concat(u32(60), new byte[] { 8 }, ks, Arrays.copyOfRange(o, 4, 37))) > 0, "the till's output under the keyset it named");
        int other = c.put(-1, UnitsTest.SAT_A, 32);
        assertEquals(SW_OK, c.begin(other).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, out(30, 6))));
        assertEquals(64, c.sign().getData().length);
        assertTrue(indexOf(outbox(c), concat(u32(30), new byte[] { 8 }, hexToBytes(UnitsTest.SAT_A), Arrays.copyOfRange(out(30, 6), 4, 37))) > 0,
            "P1 = 0: the first piece's keyset, and not the last payment's naming");
    }

    static byte[] outbox(UnitsTest.Card c) {
        byte[] all = new byte[0];
        for (int off = 0; ; off += 255) {
            ResponseAPDU r = c.send(new CommandAPDU(CLA, INS_GET_OUTBOX, 1, 0, new byte[] { (byte) (off >> 8), (byte) off, (byte) 0xFF }, 256));
            if (r.getSW() != SW_OK) break;
            all = concat(all, r.getData());
            if (r.getData().length < 255) break;
        }
        return all;
    }

    static int indexOf(byte[] hay, byte[] needle) {
        for (int i = 0; i + needle.length <= hay.length; i++) if (Arrays.equals(Arrays.copyOfRange(hay, i, i + needle.length), needle)) return i;
        return -1;
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // Teaching
    // ---------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("A version 00 keyset's ID hashes its keys alone, so the card holds its n-th key's amount to 2^n: the mint's keys named for twice their amounts are refused (6A80)")
    void aVersion00KeysetHoldsItsAmounts() throws Exception {
        UnitsTest.Card c = card();
        c.put(-1, A.id8(), 64);
        byte[][] shifted = new byte[A.keys.length][];
        for (int i = 0; i < shifted.length; i++) shifted[i] = concat(KeysetKeysTest.u64(A.amounts[i] * 2), A.keys[i]);
        c.tap();
        assertEquals(SW_WRONG_DATA, KeysetKeysTest.teach(c, A.id8(), "", shifted).getSW(), "the key for 1 named for 2");
        byte[][] skipped = new byte[A.keys.length - 1][];
        for (int i = 0; i < skipped.length; i++) skipped[i] = A.wire(i + 1);
        assertEquals(SW_WRONG_DATA, KeysetKeysTest.teach(c, A.id8(), "", skipped).getSW(), "the keys from 2 on: the first is 1");
        taught(c, A);
    }

    @Test
    @DisplayName("A version 01 keyset's ID names its unit first in its tail (|unit:sat or |unit:usd, then the end or |), and it is the entry's (6A80 otherwise)")
    void aVersion01KeysetsUnitIsItsEntrys() throws Exception {
        UnitsTest.Card c = card();
        KeysetKeysTest.Keyset usd = new KeysetKeysTest.Keyset(1, KeysetKeysTest.powers(8), 77, "|unit:usd");
        c.put(-1, usd.id8(), 100);
        c.tap();
        assertEquals(SW_WRONG_DATA, KeysetKeysTest.teach(c, usd).getSW(), "a usd keyset in a sat entry");
        assertEquals(0, c.stateOf(usd.id8()) & 0x02, "not taught");
        KeysetKeysTest.Keyset sats = new KeysetKeysTest.Keyset(1, KeysetKeysTest.powers(8), 78, "|unit:satoshi");
        c.put(-1, sats.id8(), 100);
        c.tap();
        assertEquals(SW_WRONG_DATA, KeysetKeysTest.teach(c, sats).getSW(), "|unit:satoshi is not |unit:sat");
        KeysetKeysTest.Keyset good = new KeysetKeysTest.Keyset(1, KeysetKeysTest.powers(8), 79, "|unit:sat|input_fee_ppk:100");
        c.put(-1, good.id8(), 100);
        c.tap();
        taught(c, good);
    }

    @Test
    @DisplayName("The owner's grant alone teaches nothing (6982): a keyset is taught under the PIN given in the tap, as a load is")
    void theGrantAloneTeachesNothing() throws Exception {
        UnitsTest.Card c = card();
        c.put(-1, A.id8(), 64);
        c.power();
        grant(c);
        assertEquals(SW_SECURITY_NOT_SATIS, KeysetKeysTest.begin(c, A.id8(), "").getSW(), "the grant alone");
        c.pin();
        taught(c, A);
    }

    // ---------------------------------------------------------------------------------------------------------------------
    // The day counts the change until it is back
    // ---------------------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("The day's limit counts a payment's pieces whole, its change with them: a reader with the PIN cannot take a large piece past the day by asking for nearly all of it as change; LOAD_CHANGE gives the change back to the day")
    void theChangeCountsAgainstTheDayUntilItIsBack() throws Exception {
        UnitsTest.Card c = card();
        int big = c.put(-1, A.id8(), 10_000);
        int small = c.put(-1, A.id8(), 64);
        // the owner's day of 100 set after the loads: a piece over the day is no load (D196)
        assertEquals(SW_OK, c.limits(100, 0, 0, 7, 0), "a day of 100");
        taught(c, A);
        c.tap();
        assertEquals(SW_OK, c.begin(big).getSW());
        assertEquals(SW_OK, c.sw(changeCommand(9_999, keyOf(BigInteger.valueOf(0x1234567)), hexToBytes(A.id8()))), "change of 9,999 under a key of the reader's");
        assertEquals(SW_OVER_LIMIT, c.sign().getSW(), "10,000 against a day of 100: refused");
        assertEquals(0, c.spentToday());
        assertEquals(1, c.slot(big)[0], "nothing burned");
        // within the day, the change counted with it, and given back when it is on the card
        byte[] row = KeysetKeysTest.payWithChange(c, small, 32, A.keyFor(32), A.id8());
        assertEquals(64, c.spentToday(), "the piece whole: 64");
        c.power();
        assertEquals(SW_OK, show(c, row[0], A, 32));
        assertEquals(SW_OK, loadChange(c, row, A.privFor(32)).getSW());
        assertEquals(32, c.spentToday(), "the 32 of change back: the day counts what left the card");
    }

    @Test
    @DisplayName("A day's limit sent again with the same number, in any form, begins no new day: what was spent stays counted")
    void theSameLimitKeepsTheDay() throws Exception {
        UnitsTest.Card c = card();
        assertEquals(SW_OK, c.ownerLimit(u32(1000)));
        int p = c.put(-1, UnitsTest.SAT_A, 300);
        c.tap();
        assertEquals(64, c.pay(p).getData().length);
        assertEquals(300, c.spentToday());
        assertEquals(SW_OK, c.ownerLimit(u32(1000)), "the same number, four bytes");
        assertEquals(300, c.spentToday(), "the day goes on");
        assertEquals(SW_OK, c.ownerLimit(u32(1001)), "a new number");
        assertEquals(0, c.spentToday(), "a new day");
    }

    @Test
    @DisplayName("SET_CARD to another unit turns the limits and the day's counts into it at the rate, each rounded up; with a limit set and no rate it is 6A99 and nothing changes")
    void aNewUnitTurnsTheLimits() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        // 100,000 sats a day, 10,000 a payment, 5,000 with no PIN; 100,000 sats to the dollar
        assertEquals(SW_OK, c.ownerLimit(concat(u32(100_000), u32(10_000), u32(5_000), new byte[] { 7 }, u32(100_000))));
        byte[] usdRecord = UnitsTest.recordIn(UnitsTest.USD);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(c.proofFor(CashuAppletTest.L_CARD, usdRecord), usdRecord))));
        byte[] rec = c.record();
        assertEquals(100, readUint32(rec, 2), "a day of 100,000 sats is 100 cents");
        assertEquals(10, readUint32(rec, 197), "a payment of 10,000 sats is 10 cents");
        assertEquals(5, readUint32(rec, 201), "and 5,000 with no PIN, 5 cents");
        // no rate, a limit set: the unit stays
        UnitsTest.Card d = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        assertEquals(SW_OK, d.ownerLimit(u32(1000)));
        assertEquals(SW_NO_RATE, d.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, ownerData(d.proofFor(CashuAppletTest.L_CARD, usdRecord), usdRecord))), "6A99");
        assertEquals(1000, readUint32(d.record(), 2));
        assertEquals(0, d.record()[1], "still sat");
    }
}
