package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The owner claimed slowly (D187), onto an empty card, and only in the card's first set-up (D196): a card set up with no owner
 * is never claimed (6A91). A reader that has the PIN and turns its field off and on between commands holds the card in no
 * state a claim takes. A holder with no phone who wants a phone as owner empties the card, resets it by the PIN, sets it up
 * again with the phone, which claims it there, and loads again.
 */
class ClaimWhenEmptyTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static long balance(UnitsTest.Card c) { return readUint32(c.balance(0), 0); }
    static int verify(UnitsTest.Card c, byte[] pin) { return c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, pin)).getSW(); }

    @Test
    @DisplayName("A claim on a card set up with no owner, pieces on it, is refused (6A91) at its first asking, with nothing counted, in a time in the field that paid nothing and in one begun after a field cycle; the day's limit then holds the reader that has the PIN; in the first set-up a claim with money on the card is 6A8D")
    void aClaimWantsAnEmptyCard() throws Exception {
        UnitsTest.Card f = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        f.put(-1, UnitsTest.SAT_A, 100);
        assertEquals(SW_CARD_IN_USE, f.sim.transmitCommand(setOwnerOpenCommand(OTHER_OWNER)).getSW(), "the first set-up, money on the card");
        UnitsTest.Card c = SimpleCardTest.setUpWith(u32(100));
        int[] place = new int[10];
        for (int i = 0; i < 10; i++) place[i] = c.put(-1, UnitsTest.SAT_A, 100);
        c.tap();
        assertEquals(64, c.pay(place[0]).getData().length, "the day's 100");
        c.tap();
        assertEquals(SW_OWNER_PROOF, c.sim.transmitCommand(setOwnerOpenCommand(OTHER_OWNER)).getSW(), "a claim with 900 on the card");
        assertEquals(0, c.field("nonceLive")[1], "nothing counted");
        assertEquals(SW_OWNER_PROOF, c.sw(setOwnerOpenCommand(OTHER_OWNER)), "held for: the same");
        c.power();
        assertEquals(SW_OK, verify(c, TEST_PIN));
        assertEquals(SW_OWNER_PROOF, c.sw(setOwnerOpenCommand(OTHER_OWNER)), "after a field cycle: the same");
        assertEquals(0, c.field("ownerSet")[0], "no owner");
        assertEquals(SW_OVER_LIMIT, c.pay(place[1]).getSW(), "and the day's limit still holds the PIN");
        assertEquals(900, balance(c));
    }

    @Test
    @DisplayName("A reader handed the PIN for one payment, its field turned off and on, the PIN given again: the claim is 6A91, the owner's forms answer 6A90, and the rest of the card is not paid past the day")
    void aFieldCycleClaimsNothing() throws Exception {
        UnitsTest.Card c = SimpleCardTest.setUpWith(concat(u32(100), u32(100)));
        int p1 = c.put(-1, A.id8(), 60), p2 = c.put(-1, A.id8(), 60), p3 = c.put(-1, A.id8(), 60), p4 = c.put(-1, A.id8(), 60);
        c.tap();
        assertEquals(64, c.pay(p1).getData().length);
        assertNotEquals(SW_OK, c.pay(p2).getSW(), "the day holds");
        c.power();
        assertEquals(SW_OK, verify(c, TEST_PIN));
        assertEquals(SW_OWNER_PROOF, held(c.sim::transmitCommand, setOwnerOpenCommand(OTHER_OWNER)).getSW(), "the claim");
        c.power();
        byte[] v = concat(u32(1_000_000), u32(1_000_000));
        assertEquals(SW_NO_OWNER, c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16)).getSW(), "no owner, no nonce");
        assertEquals(SW_NO_OWNER, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_LIMIT_OWNER, 0, 0, ownerData(ownerProof(L_LIMIT, OTHER_OWNER, new byte[16], v), v))).getSW());
        assertEquals(SW_NO_OWNER, c.sim.transmitCommand(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0, ownerData(ownerProof(L_PIN, OTHER_OWNER, new byte[16], NEW_PIN), NEW_PIN))).getSW());
        c.power();
        assertEquals(SW_OK, verify(c, TEST_PIN));
        assertEquals(SW_OVER_LIMIT, c.pay(p2, p3, p4).getSW(), "180 past a day of 100");
        assertEquals(180, balance(c));
    }

    @Test
    @DisplayName("The same with a till's raw commands, the card never leaving its reader: a payment of 1,000, the field off and on, the PIN again, the claim: 6A91, and the other 9,000 stay")
    void aTillThatTookOnePaymentClaimsNothing() {
        CardSimulator sim = new CardSimulator();
        sim.installApplet(AIDUtil.create(AID_HEX), CashuApplet.class);
        Runnable cycle = () -> { sim.reset(); assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, hexToBytes(AID_STR))).getSW()); };
        cycle.run();
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
        assertEquals(SW_OK, sim.transmitCommand(setTimeCommand(T0)).getSW());
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_SET_LIMIT, 0, 0, u32(2_000))).getSW());
        for (int i = 0; i < 10; i++) {
            byte[] p = buildProof(KEYSET, 1000, 100 + i);
            assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_LOAD_PROOF, 0, 2, p, 0, p.length, 1)).getSW());
        }
        cycle.run();
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        assertEquals(SW_OK, sim.transmitCommand(CashuAppletTest.spendBegin(new byte[] { 0 })).getSW());
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(1000), mintKey()))).getSW());
        assertEquals(64, signThrough(sim::transmitCommand).getData().length);
        cycle.run();
        assertEquals(SW_OK, sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
        ResponseAPDU r = held(sim::transmitCommand, setOwnerOpenCommand(new Key()));
        assertEquals(SW_OWNER_PROOF, r.getSW(), "the claim, with 9,000 on the card");
        assertEquals(9000, readUint32(sim.transmitCommand(new CommandAPDU(CLA, INS_GET_BALANCE, 0, 0, 4)).getData(), 0));
    }

    @Test
    @DisplayName("A holder with no phone gives the card a phone as owner: the money moved to a phone, the card reset by its PIN in a held tap, set up again with the phone, which claims it in that first set-up, and loaded again under the owner")
    void theMoneyGoesToAPhoneThenTheClaim() throws Exception {
        UnitsTest.Card c = HolderTest.noOwner();
        int a = c.put(-1, A.id8(), 64), b = c.put(-1, A.id8(), 32);
        c.tap();
        assertEquals(64, c.pay(a, b).getData().length, "every piece to the holder's phone");
        c.tap();
        assertEquals(SW_OWNER_PROOF, c.sim.transmitCommand(setOwnerOpenCommand(OWNER)).getSW(), "no claim on a card set up");
        HolderTest.hold(c);
        assertEquals(SW_OK, SimpleCardTest.resetByPin(c)[1], "the empty card reset by its PIN");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        c.pin();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        assertEquals(SW_OK, c.sw(setOwnerOpenCommand(OWNER)), "claimed in the new first set-up");
        c.tap();
        c.grant();
        int back = c.put(-1, A.id8(), 64);
        assertEquals(64, balance(c), "loaded again");
        c.tap();
        assertEquals(64, c.pay(back).getData().length, "and pays");
    }
}
