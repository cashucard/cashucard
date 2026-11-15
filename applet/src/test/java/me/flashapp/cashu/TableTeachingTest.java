package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.FullPointLoadTest.curveByAgreement;
import static me.flashapp.cashu.KeysetKeysTest.*;
import static org.junit.jupiter.api.Assertions.*;

import java.math.BigInteger;
import java.util.Arrays;
import javacard.security.CryptoException;
import javacard.security.KeyAgreement;
import javacard.security.PrivateKey;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The review's findings on the chip's key agreement and the keyset table, made permanent. D213: the set-up's test of the
 * agreement asks seven points (G taken; six off the curve refused), and a chip that takes any one of the six is not leaned on.
 * D214: a keyset taught and not yet loaded is not forgotten by the reclaim; an entry is made at the end of a teaching, when its
 * keys hold, so that a teaching cut or refused leaves none.
 */
class TableTeachingTest {
    @BeforeEach void floor() { useTheTestFloor(); }
    @AfterAll static void builtFloor() { useFloor(BUILT_FLOOR); }

    static final BigInteger P = ChipEnginesTest.P, GX = ChipEnginesTest.GX, GY = ChipEnginesTest.GY;

    static byte[] pt(BigInteger x, BigInteger y) { return FullPointLoadTest.full(x, y); }

    /** The six points the set-up's test must see refused, as a chip that skipped its curve check for one of them would take it. */
    static byte[][] sixBad() {
        BigInteger five = BigInteger.valueOf(5);
        // y with y^2 = -(5^3 + 7) mod p: the twist's equation (p is 3 mod 4)
        BigInteger twistY = P.subtract(five.pow(3).add(BigInteger.valueOf(7))).modPow(P.add(BigInteger.ONE).shiftRight(2), P);
        return new byte[][] {
            pt(GX, GY.add(BigInteger.ONE)),                                  // G with y + 1
            pt(five, GY),                                                    // an x with no root
            pt(five, twistY),                                                // a twist point
            pt(GX, GY.xor(BigInteger.ONE.shiftLeft(255))),                   // a valid x with a wrong y
            pt(GX, P.subtract(BigInteger.ONE)),                              // y near p
            pt(BigInteger.ZERO, BigInteger.ZERO),                            // 04 with zeros
        };
    }

    /** A key agreement that takes one point (as a chip with a hole in its check would) and otherwise is the simulator's. */
    static final class TakesOne extends KeyAgreement {
        final KeyAgreement real;
        final byte[] taken;
        TakesOne(KeyAgreement real, byte[] taken) { this.real = real; this.taken = taken; }
        @Override public void init(PrivateKey k) { real.init(k); }
        @Override public byte getAlgorithm() { return real.getAlgorithm(); }
        @Override public short generateSecret(byte[] p, short off, short len, byte[] out, short outOff) {
            if (taken != null && len == taken.length && Arrays.equals(Arrays.copyOfRange(p, off, off + len), taken)) {
                Arrays.fill(out, outOff, outOff + 65, (byte) 3);
                out[outOff] = 4;
                return 65;
            }
            return real.generateSecret(p, off, len, out, outOff);
        }
    }

    @Test
    @DisplayName("D213: the set-up's test of the agreement asks six points off the curve (G with y + 1, an x with no root, a twist point, a valid x with a wrong y, y near p, 04 with zeros) and G: a chip that takes any one of the six is not leaned on (curveByAgreement false, the 04 form refused 6B00), whichever it is; the simulator, which refuses all six, holds")
    void theSelfTestAsksMorePoints() throws Exception {
        byte[][] bad = sixBad();
        for (int i = 0; i < bad.length; i++) {
            UnitsTest.Card c = new UnitsTest.Card();
            SchnorrHW s = (SchnorrHW) FullPointLoadTest.schnorr(c);
            KeyAgreement real = (KeyAgreement) FullPointLoadTest.ecdhField().get(s);
            FullPointLoadTest.ecdhField().set(s, new TakesOne(real, bad[i]));
            c.ready(UnitsTest.SAT, false);
            assertFalse(curveByAgreement(c), "a chip that takes point " + i + " is not leaned on");
        }
        UnitsTest.Card ok = new UnitsTest.Card();
        ok.ready(UnitsTest.SAT, false);
        assertTrue(curveByAgreement(ok), "the simulator refuses every one");
    }

    @Test
    @DisplayName("D213: a chip that refuses G itself fails the self-test too (the old check kept)")
    void aChipThatRefusesGFails() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        SchnorrHW s = (SchnorrHW) FullPointLoadTest.schnorr(c);
        KeyAgreement real = (KeyAgreement) FullPointLoadTest.ecdhField().get(s);
        FullPointLoadTest.ecdhField().set(s, new FullPointLoadTest.Agreement(real, false));
        assertFalse(s.checksCurve());
    }

    // ---------------- D214 ----------------

    @Test
    @DisplayName("D214: a card with the PIN alone (entries unmarked, two at most) taught two keysets before any piece keeps both: a third teaching is refused 6A9C at its first command, with nothing forgotten, in place of erasing the first one's keys and answering 9000")
    void aThirdTeachingEvictsNothing() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, false);
        taught(c, V1);
        taught(c, A);
        ResponseAPDU r = begin(c, B.id8(), B.tail);
        assertEquals(CashuApplet.SW_NO_TABLE_ROOM, r.getSW(), "told, not silent");
        assertTrue(keysKnown(c, V1.id8()));
        assertTrue(keysKnown(c, A.id8()));
        assertEquals(2, c.inUse());
        // the first piece loaded under each keeps its keys too
        assertEquals(SW_OK, c.load(c.piece(V1.id8(), 5)).getSW());
        assertTrue(keysKnown(c, V1.id8()));
        assertTrue(keysKnown(c, A.id8()));
    }

    @Test
    @DisplayName("D214: with the grant (entries marked) six keysets are taught and kept before any piece; a seventh is refused 6A9C, and nothing is forgotten")
    void sixTaughtSevenRefused() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        Keyset[] ks = new Keyset[7];
        for (int i = 0; i < 7; i++) ks[i] = new Keyset(0, powers(8), 100 + i, "");
        for (int i = 0; i < 6; i++) taught(c, ks[i]);
        assertEquals(6, c.inUse());
        assertEquals(CashuApplet.SW_NO_TABLE_ROOM, begin(c, ks[6].id8(), ks[6].tail).getSW());
        for (int i = 0; i < 6; i++) assertTrue(keysKnown(c, ks[i].id8()), "keyset " + i);
    }

    @Test
    @DisplayName("D214: a keyset that has had pieces and has none now is let go by the reclaim as before (CLEAR_SPENT), its keys with it: the sparing is for a keyset waiting for its first piece, so the table does not fill for good")
    void aPaidKeysetIsStillReclaimed() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        taught(c, A);
        int place = c.put(-1, A.id8(), 64);
        assertEquals(64, c.pay(place).getData().length);
        assertEquals(SW_OK, c.clearSpent());
        assertTrue(c.entryOf(A.id8()) < 0, "its piece paid and cleared: no entry");
        assertEquals(0, c.inUse());
    }

    @Test
    @DisplayName("D214: a teaching's entry is made at its end, with its keys, in one write: after the first command it names nothing and a keyset in no entry has none; a teaching cut by another command, or by a power cycle, or given false keys, leaves no entry at all, and a load of that keyset goes into a fresh one as the card's own unit")
    void aCutOrRefusedTeachingLeavesNoEntry() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        assertEquals(SW_OK, begin(c, V1.id8(), V1.tail).getSW());
        assertEquals(0, c.inUse(), "no entry before the keys hold");
        assertEquals(SW_OK, keys(c, wires(V1)[0]));
        assertEquals(0, c.inUse());
        c.balance(0);                       // another command cuts it
        assertEquals(0, c.inUse());
        assertTrue(c.entryOf(V1.id8()) < 0);
        // false keys, refused at the end
        c.tap();
        c.grant();
        assertEquals(SW_WRONG_DATA, teach(c, V1.id8(), V1.tail, wires(A)).getSW());
        assertEquals(0, c.inUse(), "a refused teaching leaves none");
        assertEquals(SW_OK, c.load(c.piece(V1.id8(), 5)).getSW());
        assertEquals(1, c.inUse());
        // a power cycle between begin and end
        UnitsTest.Card d = KeysetKeysTest.card();
        assertEquals(SW_OK, begin(d, A.id8(), A.tail).getSW());
        d.power();
        d.pin();
        assertEquals(0, d.inUse());
    }

    @Test
    @DisplayName("D214: the planted entry (a PIN-holder's begin of a real sat keyset's ID with a usd tail, after a usd payment) plants nothing now: a legitimate load of the keyset answers 9000, with no CLEAR_SPENT between")
    void noPlantedEntry() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.grant();
        int u = c.put(UnitsTest.USD, UnitsTest.USD_A, 100);
        c.tap();
        assertEquals(64, c.pay(u).getData().length);
        c.tap();
        ResponseAPDU r = begin(c, "01bb000000000002", "|unit:usd");
        assertEquals(SW_OK, r.getSW());
        c.balance(0);
        assertEquals(SW_OK, c.load(c.piece("01bb000000000002", 5)).getSW());
    }

    @Test
    @DisplayName("D214: a taught keyset's entry is what it was (marked as the tap marks it, the unit its tail names, keys known) once its keys hold, and its first piece loaded sets the loaded bit")
    void theEntryAtTheEnd() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        taught(c, V1);
        int state = c.rawStateOf(V1.id8());
        assertEquals(0xC2, state & 0xC7, "used, marked, keys known, sat, not loaded");
        assertEquals(SW_OK, c.load(c.piece(V1.id8(), 5)).getSW());
        assertEquals(0xC6, c.rawStateOf(V1.id8()) & 0xC7, "and loaded");
    }
}
