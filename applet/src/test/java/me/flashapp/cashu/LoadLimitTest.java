package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertEquals;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A load above the day's limit is refused (D196): the day holds a payment's pieces whole, so such a piece could never be paid,
 * and on a card with no owner nothing could ever lift the limit. LOAD_PROOF answers 6A8F with nothing written, its amount in the
 * card's unit (a piece of the other unit turned at the rate, rounded up). A piece above the limit on one payment goes on: it is
 * paid with the wait.
 */
class LoadLimitTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static long balance(UnitsTest.Card c) { return readUint32(c.balance(0), 0); }

    @Test
    @DisplayName("A card with no owner, a day of 1,000: a piece of 2,048 or 1,024 is 6A8F with nothing written, 1,000 and less go on, and every piece on the card can be paid")
    void aPieceAboveTheDayIsNoLoad() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(u32(1000));
        java.util.Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 2048)).getSW(), "2,048");
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 1024)).getSW(), "1,024");
        c.assertUnchanged(before, "nothing written");
        ResponseAPDU batch = c.load(c.piece(A.id8(), 16), c.piece(A.id8(), 1001));
        assertEquals(SW_OK, batch.getSW());
        assertEquals(1, batch.getData().length, "a batch stops at the piece over the day: the one before it went on");
        int p = c.put(-1, A.id8(), 1000);
        int q = c.put(-1, A.id8(), 512);
        assertEquals(1016 + 512, balance(c));
        c.tap();
        assertEquals(64, c.pay(p).getData().length, "the day's 1,000");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_400 + 60)));
        c.tap();
        assertEquals(64, c.pay(q).getData().length, "and the 512 the next day");
    }

    @Test
    @DisplayName("A piece of the other unit is held to the day in the card's unit, turned at the rate and rounded up: on a sat card with a day of 100,000 and 100,000 sats to the dollar, 100 cents go on and 101 do not")
    void theOtherUnitIsTurnedAtTheRate() throws Exception {
        UnitsTest.Card c = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_OK, SimpleCardTest.byPin(c, concat(u32(100_000), u32(0), u32(0), new byte[] { 7 }, u32(100_000))));
        c.tap();
        HolderTest.hold(c);
        assertEquals(SW_OVER_LIMIT, c.loadAs(UnitsTest.USD, c.piece(UnitsTest.USD_A, 101)).getSW(), "101 cents are 101,000 sats");
        assertEquals(SW_OK, c.loadAs(UnitsTest.USD, c.piece(UnitsTest.USD_A, 100)).getSW(), "100 cents are 100,000");
    }

    @Test
    @DisplayName("A piece above the limit on one payment goes on, and is paid with the wait")
    void aPieceAboveThePaymentLimitGoesOn() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(concat(u32(0), u32(100)));
        int p = c.put(-1, A.id8(), 500);
        c.tap();
        ResponseAPDU r = c.pay(p);
        assertEquals(64, r.getData().length);
        assertEquals(true, c.waits > 0, "waited for");
    }

    @Test
    @DisplayName("An owned card: a load above the owner's day is 6A8F; the owner lifts the limit, the piece goes on, and the owner may set the limit again under it")
    void anOwnedCard() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 0));
        assertEquals(SW_OVER_LIMIT, c.load(c.piece(A.id8(), 1001)).getSW());
        assertEquals(SW_OK, c.limits(0, 0, 0, 7, 0));
        assertEquals(SW_OK, c.load(c.piece(A.id8(), 1001)).getSW());
        assertEquals(SW_OK, c.limits(1000, 0, 0, 7, 0), "the owner's to choose");
    }
}
