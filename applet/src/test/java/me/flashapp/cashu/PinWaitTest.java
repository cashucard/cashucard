package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The PIN on a card with no owner never blocks (D195): each wrong try makes the next VERIFY_PIN wait twice as long as the one
 * before, 1, 2, 4, 8, 16 askings (each a signature's work answered 6A98, about 0.7 s on a chip), then 16 a stretch, each
 * stretch written down as it ends; the count and what is owed are persistent, counted before the PIN is compared, and a
 * right PIN after its wait sets them to nothing. A card with an owner keeps three tries and the owner's unblock.
 */
class PinWaitTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static ResponseAPDU verify(UnitsTest.Card c, byte[] pin) { return c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, pin)); }

    /** The askings answered 6A98 (with nothing) before the card answers otherwise, and that answer, as { askings, sw }. */
    static int[] asked(UnitsTest.Card c, byte[] pin) {
        int n = 0;
        ResponseAPDU r;
        while ((r = verify(c, pin)).getSW() == SW_KEEP_HOLDING) {
            assertEquals(0, r.getData().length, "keep holding, and nothing else");
            assertTrue(++n <= 100, "a wait goes down with the askings (none here is longer than 33)");
        }
        return new int[] { n, r.getSW() };
    }

    static int[] marks(UnitsTest.Card c) throws Exception {
        byte[] m = c.field("pinMarks");
        return new int[] { m[0], ((m[1] & 0xFF) << 8) | (m[2] & 0xFF) };
    }

    static int tries(UnitsTest.Card c) { return c.info(0)[9]; }

    @Test
    @DisplayName("A stranger's three wrong tries strand nothing: a card with no owner and money on it answers 63C1, then waits; the holder's right PIN after the wait opens it, and the money is paid")
    void aStrangerStrandsNothing() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        int a = c.put(-1, A.id8(), 64), b = c.put(-1, A.id8(), 32);
        c.power();
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_KEEP_HOLDING, verify(c, WRONG_PIN).getSW(), "the second try waits");
        assertEquals(0x63C2, verify(c, WRONG_PIN).getSW(), "and is counted after its wait");
        assertEquals(SW_KEEP_HOLDING, verify(c, WRONG_PIN).getSW(), "the third waits two askings");
        c.power();
        assertEquals(1, c.info(0)[7], "the PIN is not blocked");
        int[] r = asked(c, TEST_PIN);
        assertEquals(2, r[0], "two askings of wait, the one before the power not kept");
        assertEquals(SW_OK, r[1], "the holder's right PIN");
        assertEquals(64, c.pay(a, b).getData().length, "and the money moves");
    }

    @Test
    @DisplayName("Each wrong try in a row doubles the next try's wait: 1, 2, 4, 8 and 16 askings, then two stretches of 16 for the sixth (the asking that ends a stretch answers 6A98 with no work); 63CX says the wrong tries in a row; GET_INFO says set, never blocked; the chip's counter never runs out")
    void theWaitDoubles() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        c.power();
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW(), "the first wrong try waits for nothing");
        assertArrayEquals(new int[] { 1, 1 }, marks(c));
        int[] askings = { 1, 2, 4, 8, 16, 33 };
        for (int k = 0; k < askings.length; k++) {
            int[] r = asked(c, WRONG_PIN);
            assertEquals(askings[k], r[0], "the wait before wrong try " + (k + 2));
            assertEquals(0x63C0 | (k + 2), r[1]);
            assertArrayEquals(new int[] { k + 2, 1 << (k + 1) }, marks(c), "after wrong try " + (k + 2));
            assertEquals(1, c.info(0)[7], "set, not blocked");
            assertTrue(tries(c) >= 2, "the chip's counter refilled before each check");
        }
    }

    @Test
    @DisplayName("The wrong count and the wait outlast the power: a card taken away mid-stretch loses that stretch's askings, never a stretch done; any other command or a SELECT between askings begins the stretch again; and the right PIN after the wait sets both to nothing, the next wrong try waiting 1 again")
    void theWaitOutlastsThePower() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        c.power();
        byte[] m = c.field("pinMarks");
        m[0] = 6; m[1] = 0; m[2] = 32;   // after the sixth wrong try in a row: 32 askings owed
        for (int k = 0; k < 10; k++) assertEquals(SW_KEEP_HOLDING, verify(c, TEST_PIN).getSW());
        c.power();
        assertArrayEquals(new int[] { 6, 32 }, marks(c), "ten askings of a stretch, then the power: nothing written");
        for (int k = 0; k < 17; k++) assertEquals(SW_KEEP_HOLDING, verify(c, TEST_PIN).getSW(), "asking " + (k + 1));
        assertArrayEquals(new int[] { 6, 16 }, marks(c), "a stretch ended: written");
        c.power();
        assertArrayEquals(new int[] { 6, 16 }, marks(c), "and kept through the power");
        for (int k = 0; k < 5; k++) assertEquals(SW_KEEP_HOLDING, verify(c, TEST_PIN).getSW());
        c.info(0);
        int[] r = asked(c, TEST_PIN);
        assertEquals(16, r[0], "GET_INFO between askings: the stretch from its first");
        assertEquals(SW_OK, r[1]);
        assertArrayEquals(new int[] { 0, 0 }, marks(c), "the right PIN: nothing");
        assertEquals(3, tries(c));
        c.power();
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_KEEP_HOLDING, verify(c, TEST_PIN).getSW());
        c.select();
        int[] again = asked(c, TEST_PIN);
        assertEquals(1, again[0], "a SELECT between askings: from the first");
        assertEquals(SW_OK, again[1]);
    }

    @Test
    @DisplayName("The wait is at most 16,384 askings a try (about three hours), from the fifteenth wrong try in a row on; 63CF for fifteen or more")
    void theWaitHasACeiling() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        c.power();
        byte[] m = c.field("pinMarks");
        m[0] = 14; m[1] = 0; m[2] = 0;
        assertEquals(0x63CF, verify(c, WRONG_PIN).getSW());
        assertArrayEquals(new int[] { 15, 0x4000 }, marks(c));
        m[1] = 0; m[2] = 0;
        assertEquals(0x63CF, verify(c, WRONG_PIN).getSW(), "fifteen stays fifteen");
        assertArrayEquals(new int[] { 15, 0x4000 }, marks(c), "and the wait its ceiling");
        m[0] = 13; m[1] = 0; m[2] = 0;
        assertEquals(0x63CE, verify(c, WRONG_PIN).getSW());
        assertArrayEquals(new int[] { 14, 0x2000 }, marks(c));
    }

    @Test
    @DisplayName("The try is counted before the PIN is compared: a card taken away in the check has the count and the next wait written, and a right PIN torn before its marks are set to nothing counts as one wrong try more (TearSweepTest tears every write)")
    void theTryIsCountedFirst() throws Exception {
        String src = new String(java.nio.file.Files.readAllBytes(SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8);
        String body = src.substring(src.indexOf("private void processVerifyPin("), src.indexOf("private void failPinCheck("));
        assertTrue(body.indexOf("countTry();") < body.indexOf("pin.check(buf"), "countTry before the clear check");
        int sealedCheck = body.indexOf("pin.check(seal");
        assertTrue(body.lastIndexOf("countTry();", sealedCheck) > 0 && body.lastIndexOf("countTry();", sealedCheck) < sealedCheck, "and before the sealed one's");
        assertTrue(body.indexOf("waitOwed(buf);") < body.indexOf("setIncomingAndReceive"), "the wait before anything is read");
    }

    @Test
    @DisplayName("A forgotten PIN on an empty card with no owner: after three wrong tries in a row SET_PIN replaces it with no PIN asked, and the history goes; the numbers stay and only tighten (no first set-up); with two, the card keeps its PIN (6982); with money on it, 6A8D")
    void aForgottenPinIsReplacedOnAnEmptyCard() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(0), u32(50)))));
        int p = c.put(-1, A.id8(), 64);
        c.tap();
        assertEquals(SW_CARD_IN_USE, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "money on the card: the PIN is kept, set up or not");
        c.power();
        assertEquals(0x63C1, asked(c, WRONG_PIN)[1]);
        assertEquals(0x63C2, asked(c, WRONG_PIN)[1]);
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "two wrong tries: the card keeps its PIN");
        assertEquals(0x63C3, asked(c, WRONG_PIN)[1]);
        assertEquals(SW_CARD_IN_USE, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "three, and money on the card: 6A8D");
        assertEquals(SW_OK, asked(c, TEST_PIN)[1], "the holder, after the wait");
        assertEquals(64, c.pay(p).getData().length, "moves the money");
        c.power();
        for (int k = 1; k <= 3; k++) assertEquals(0x63C0 | k, asked(c, WRONG_PIN)[1]);
        assertTrue(readUint32(c.field("cardLog"), 0) > 0, "a history");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)), "three wrong tries on an empty card: replaced, no PIN asked");
        assertArrayEquals(new byte[CashuApplet.LOG_LEN], c.field("cardLog"), "the history goes with the PIN");
        assertArrayEquals(new int[] { 0, 0 }, marks(c));
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_FIRST], "and no first set-up: the numbers are the holder's");
        assertEquals(SW_OK, verify(c, NEW_PIN).getSW());
        assertEquals(50, readUint32(c.record(), CashuApplet.CARD_NOPIN_LIMIT_OFFSET), "the numbers stay");
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, concat(u32(1000), u32(0), u32(51)))), "and only tighten");
    }

    @Test
    @DisplayName("A sealed VERIFY_PIN waits as the clear one does, and its nonce outlasts the wait: the same envelope asked through the wait opens and is checked")
    void aSealedPinWaitsToo() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        c.power();
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_KEEP_HOLDING, verify(c, TEST_PIN).getSW(), "the wait is owed");
        c.power();
        ResponseAPDU k = c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256));
        assertEquals(SW_OK, k.getSW());
        byte[] nonce = Arrays.copyOfRange(k.getData(), 0, 16), key = Arrays.copyOfRange(k.getData(), 16, 49);
        byte[] env = envelope(EPH[0], key, nonce, INS_VERIFY_PIN & 0xFF, pinBlock(TEST_PIN));
        CommandAPDU sealed = new CommandAPDU(CLA, INS_VERIFY_PIN, 1, 0, env);
        assertEquals(SW_KEEP_HOLDING, c.sim.transmitCommand(sealed).getSW(), "the wait");
        assertEquals(SW_OK, c.sim.transmitCommand(sealed).getSW(), "the same envelope after it");
        assertArrayEquals(new int[] { 0, 0 }, marks(c));
    }

    @Test
    @DisplayName("A card with an owner keeps three tries: 63C2, 63C1, 6983 with no wait, and the owner's CHANGE_PIN unblocks it; its PIN marks stay nothing")
    void anOwnedCardKeepsThreeTries() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.power();
        assertEquals(0x63C2, verify(c, WRONG_PIN).getSW());
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_PIN_BLOCKED, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_PIN_BLOCKED, verify(c, TEST_PIN).getSW());
        assertArrayEquals(new int[] { 0, 0 }, marks(c));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0, ownerData(c.proofFor(L_PIN, TEST_PIN), TEST_PIN))));
        assertEquals(SW_OK, verify(c, TEST_PIN).getSW());
    }

    @Test
    @DisplayName("A card that is claimed or reset keeps a safe count: the claim wants the PIN given, so nothing is owed then and the owned card has its three tries; a reset card has no PIN, and its next holder's SET_PIN begins with nothing owed")
    void aClaimOrAResetKeepsASafeCount() throws Exception {
        // a claim is made in the first set-up (D196): the selection of the card's first SET_PIN
        UnitsTest.Card c = HolderTest.claimable();
        assertEquals(0x63C1, verify(c, WRONG_PIN).getSW());
        assertEquals(SW_SECURITY_NOT_SATIS, c.sim.transmitCommand(setOwnerOpenCommand(OWNER)).getSW(), "no claim with the PIN not given");
        assertEquals(SW_OK, asked(c, TEST_PIN)[1]);
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)), "claimed");
        assertArrayEquals(new int[] { 0, 0 }, marks(c));
        assertEquals(3, tries(c));
        c.power();
        assertEquals(0x63C2, verify(c, WRONG_PIN).getSW(), "the owner's rule now");
        assertEquals(SW_OK, verify(c, TEST_PIN).getSW());
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(c.proofFor(L_RESET, new byte[0]), new byte[0]))));
        c.field("pinMarks")[0] = 3;   // whatever a reset found
        c.field("pinMarks")[2] = 4;
        assertEquals(SW_PIN_NOT_SET, verify(c, TEST_PIN).getSW(), "no PIN");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, NEW_PIN)));
        assertArrayEquals(new int[] { 0, 0 }, marks(c), "the next holder's PIN owes nothing");
        assertEquals(SW_OK, verify(c, NEW_PIN).getSW());
    }
}
