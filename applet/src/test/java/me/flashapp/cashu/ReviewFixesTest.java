package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * D235: the fixes from the outside review of 3.1 at be8794e. A reset torn after its last commit has run no self-test; a card
 * that has had a PIN is held for every asking of its next claim, even after the field is cut; a LOAD_CHANGE that throws
 * leaves nothing in the hash the next command uses; a SELECT zeroes what the tap gave.
 */
class ReviewFixesTest {

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterEach
    void noTear() { TearHook.tearAfterCommit = null; TearHook.target = 0; }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static boolean flag(Object applet, String name) throws Exception {
        java.lang.reflect.Field f = applet.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f.getBoolean(applet);
    }

    @Test
    @DisplayName("D235 (1): a RESET_CARD torn right after the transaction that makes it a new card has run no self-test: the next SET_CARD runs them")
    void aResetTornRightAfterItsCommitHasRunNoSelfTest() throws Exception {
        TearSweepTest.Card t = new TearSweepTest.Card();
        assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the first PIN");
        assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))), "the record");
        assertEquals(SW_OK, t.sw(setTimeCommand(T0)));
        assertTrue(flag(t.applet, "selfTested"), "the first SET_CARD ran the self-tests");
        t.powerCycle();
        assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_OK, t.sw(new CommandAPDU(CLA, INS_GET_LOG, 0, 0, 256)), "the history, held for");
        TearHook.tearAfterCommit = "processResetCard";
        try {
            t.send(SimpleCardTest.RESET_BY_PIN);
        } catch (Throwable torn) {
            // the card left the field: whatever the simulator makes of it
        }
        assertNotNull(TearHook.tornAt, "the reset was torn");
        assertTrue(TearHook.tornAt.startsWith("after the commit @processResetCard"), TearHook.tornAt);
        t.powerCycle();
        assertEquals(0, t.f("pinState")[0], "the commit made it a new card: no PIN");
        assertFalse(flag(t.applet, "selfTested"), "and a new card has run no self-test");
    }

    @Test
    @DisplayName("D235 (2): a card reset by its PIN and taken out of the field (or the field cut by the reader) is still a card that had a PIN: its next claim is held for every asking")
    void aResetCardIsHeldForEveryAskingAfterTheFieldIsCut() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(concat(u32(1000), u32(500), u32(0)));
        c.tap();
        HolderTest.hold(c);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1], "reset by its PIN, held for");
        assertEquals(0, c.field("pinState")[0], "no PIN now");
        c.power();
        assertEquals(SW_OK, ClaimAfterSetUpTest.setPin(c, NEW_PIN), "a first PIN again, in a new time in the field");
        assertEquals(SW_OK, ClaimAfterSetUpTest.setCard(c), "and a record");
        assertTrue((c.field("tapOpen")[2] & 0x80) != 0, "the card has had a PIN (TAP_HADPIN, from hadPin)");
        ClaimAfterSetUpTest.heldClaim(c, "a card that had a PIN before its reset");
    }

    static byte[] to32(BigInteger v) {
        byte[] b = v.toByteArray(), out = new byte[32];
        if (b.length <= 32) System.arraycopy(b, 0, out, 32 - b.length, b.length);
        else System.arraycopy(b, b.length - 32, out, 0, 32);
        return out;
    }

    /** 04 || x || y of a compressed point. */
    static byte[] whole(byte[] comp) {
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(comp, 1, 33));
        BigInteger y = liftX(x)[1];
        if (y.testBit(0) != ((comp[0] & 1) == 1)) y = SECP_P.subtract(y);
        return concat(new byte[] { 0x04 }, to32(x), to32(y));
    }

    @Test
    @DisplayName("D235 (3): a LOAD_CHANGE that throws half way (C_ = B_, e = s = 1: a point at infinity) leaves nothing in the hash: a keyset taught and a key shown after it in the same selection are right")
    void aLoadChangeThatThrowsLeavesNoBytesInTheNextHash() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        c.ready(UnitsTest.SAT, false);
        Keyset ks1 = new Keyset(0, powers(4), 1, ""), ks2 = new Keyset(0, powers(4), 2, "");
        assertEquals(SW_OK, teach(c, ks1).getSW(), "the first keyset taught");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, LOAD_DATE_KEYS, buildProof(ks1.id8(), 10, 1, 0))));
        byte[] row = payWithChange(c, 0, 1, ks1.keyFor(1), ks1.id8());
        int opening = row[0] & 0xFF;
        byte[] poison = concat(whole(Arrays.copyOfRange(row, 17, 50)), whole(Arrays.copyOfRange(row, 50, 83)), u32(0), u32(0), u32(0),
            u32(0), u32(0), u32(0), u32(0), u32(1), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(1));
        c.tap();
        assertEquals(SW_OK, show(c, opening, ks1, 1), "the key shown, before");
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(opening, poison)), "the proof refused");
        assertEquals(SW_OK, show(c, opening, ks1, 1), "and shown again right after it, in the same selection");
        assertEquals(SW_WRONG_DATA, c.sw(loadChangeCommand(opening, poison)));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)));
        ResponseAPDU taught = teach(c, ks2);
        assertEquals(SW_OK, taught.getSW(), "a second keyset taught after it");
        c.tap();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, LOAD_DATE_KEYS, buildProof(ks2.id8(), 10, 2, 0))));
        byte[] row2 = payWithChange(c, 1, 1, ks2.keyFor(1), ks2.id8());
        c.tap();
        assertEquals(SW_OK, show(c, row2[0] & 0xFF, ks2, 1), "its top is the keys' own: its change's key is shown");
    }

    @Test
    @DisplayName("D235 (4): select() zeroes the PIN given, the owner's grant and nonce, the held count, a payment or teaching begun, and the owner's s, for a runtime that would keep them across a SELECT")
    void aSelectZeroesWhatTheTapGave() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        c.ready(UnitsTest.SAT, false);
        byte[] pin = c.field("pinVerifiedFlag"), grant = c.field("loadGrant"), nonce = c.field("nonceLive"), owner = c.field("ownerNonce"),
            state = c.field("allState"), out = c.field("allOut");
        assertEquals(1, pin[0], "the PIN given in this tap");
        grant[0] = 1;
        nonce[0] = 1;
        nonce[1] = 2;
        Arrays.fill(owner, (byte) 7);
        Arrays.fill(state, (byte) 1);
        Arrays.fill(out, (byte) 9);
        // the applet's own select(), as a runtime calls it without clearing its transient memory first
        java.lang.reflect.Method select = CashuApplet.class.getDeclaredMethod("select");
        select.setAccessible(true);
        assertTrue((Boolean) select.invoke(c.applet()));
        assertEquals(0, pin[0], "the PIN");
        assertEquals(0, grant[0], "the grant");
        assertTrue(Arrays.equals(new byte[2], nonce), "the nonce's use and the held count");
        assertTrue(Arrays.equals(new byte[owner.length], owner), "the owner's nonce");
        assertTrue(Arrays.equals(new byte[state.length], state), "a payment or teaching begun");
        assertTrue(Arrays.equals(new byte[out.length], out), "the owner's s or a payment's output kept");
    }
}
