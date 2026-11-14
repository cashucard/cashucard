package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.CLA;
import static me.flashapp.cashu.CashuAppletTest.INS_ALLOW_LOAD;
import static me.flashapp.cashu.CashuAppletTest.INS_CHANGE_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_GET_NONCE;
import static me.flashapp.cashu.CashuAppletTest.INS_LOCK_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_CARD;
import static me.flashapp.cashu.CashuAppletTest.INS_SET_PIN;
import static me.flashapp.cashu.CashuAppletTest.INS_SPEND_ALL_OUTPUTS;
import static me.flashapp.cashu.CashuAppletTest.INS_VERIFY_PIN;
import static me.flashapp.cashu.CashuAppletTest.L_LOAD;
import static me.flashapp.cashu.CashuAppletTest.L_LOCK;
import static me.flashapp.cashu.CashuAppletTest.L_PIN;
import static me.flashapp.cashu.CashuAppletTest.NEW_PIN;
import static me.flashapp.cashu.CashuAppletTest.NO_REFUND;
import static me.flashapp.cashu.CashuAppletTest.OTHER_OWNER;
import static me.flashapp.cashu.CashuAppletTest.SW_OK;
import static me.flashapp.cashu.CashuAppletTest.SW_OWNER_PROOF;
import static me.flashapp.cashu.CashuAppletTest.SW_PIN_BLOCKED;
import static me.flashapp.cashu.CashuAppletTest.SW_SECURITY_NOT_SATIS;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_DATA;
import static me.flashapp.cashu.CashuAppletTest.SW_WRONG_LENGTH;
import static me.flashapp.cashu.CashuAppletTest.TEST_PIN;
import static me.flashapp.cashu.CashuAppletTest.WRONG_PIN;
import static me.flashapp.cashu.CashuAppletTest.concat;
import static me.flashapp.cashu.CashuAppletTest.envelope;
import static me.flashapp.cashu.CashuAppletTest.held;
import static me.flashapp.cashu.CashuAppletTest.ownerData;
import static me.flashapp.cashu.CashuAppletTest.pinBlock;
import static me.flashapp.cashu.CashuAppletTest.record;
import static me.flashapp.cashu.CashuAppletTest.setOwnerOpenCommand;
import static me.flashapp.cashu.CashuAppletTest.sha256;
import static me.flashapp.cashu.CashuAppletTest.spoiled;
import static me.flashapp.cashu.CashuAppletTest.u32;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
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
 * What a 2.3 card says to software that knows only 2.2 and to a reader it cannot trust: ALLOW_LOAD's warning, a payment in the
 * other unit only to a reader that reads units, a C that is a point, sealed PIN commands that say nothing of whether they
 * opened, a certificate sealed only as its writer hashed it, no claim on a card on its way to its holder, a locked card whose
 * PIN is blocked given a new one by its owner, and a PIN whose tries are all gone counted as blocked everywhere.
 */
class ReaderChecksTest {

    static final int SW_GRANT = 0x6200, SW_OTHER_UNIT = 0x6A9B, SW_NO_CARD_RECORD = 0x6A8C, SW_NOT_ALLOWED = 0x6986;

    @BeforeEach
    void theTestFloor() { CashuAppletTest.useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR); }

    static int verify(UnitsTest.Card c, byte[] pin) { return c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, pin)).getSW(); }

    @Test
    @DisplayName("ALLOW_LOAD gives the owner's grant and answers 6200, not 9000: software that takes 9000 for an open load, and swaps first, stops; LOAD_PROOF wants the PIN all the same")
    void allowLoadIsAWarning() {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        c.power();
        int sw = c.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(c.proofFor(L_LOAD, new byte[0]), new byte[0])));
        assertEquals(SW_GRANT, sw, "6200: given, and no load opened by it");
        assertEquals(SW_SECURITY_NOT_SATIS, c.load(c.piece(UnitsTest.SAT_A, 64)).getSW(), "the load wants the PIN");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, CashuAppletTest.INS_GET_LOG, 1, 0, 256)), "and the grant is there: the receipts are read");
    }

    @Test
    @DisplayName("A payment in the other unit than the card's is begun only for a reader that says it reads units (SPEND_ALL_BEGIN P1 bit 0, beside bit 1: 03): with 02 it is 6A9B, nothing begun; the card's own unit with either; without bit 1, 01 and 00 are 6A86 for either unit, before the unit is looked at")
    void theOtherUnitOnlyToAReaderThatReadsUnits() {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        PaymentRecoveryTest.grant(c);
        int usd = c.put(UnitsTest.USD, UnitsTest.USD_A, 1024);
        int sat = c.put(-1, UnitsTest.SAT_A, 64);
        c.tap();
        assertEquals(SW_OTHER_UNIT, c.beginRaw(0x02, usd).getSW(), "cents to a reader that reads no unit");
        assertEquals(CashuAppletTest.SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(1), new byte[33]))), "nothing begun");
        assertEquals(SW_OK, c.beginRaw(0x03, usd).getSW(), "03: begun");
        assertEquals(SW_OK, c.beginRaw(0x02, sat).getSW(), "sats with 02");
        assertEquals(SW_OK, c.beginRaw(0x03, sat).getSW(), "and with 03");
        for (int p1 : new int[] { 0x00, 0x01 }) {
            assertEquals(CashuAppletTest.SW_INCORRECT_P1P2, c.beginRaw(p1, usd).getSW(), "cents with " + p1);
            assertEquals(CashuAppletTest.SW_INCORRECT_P1P2, c.beginRaw(p1, sat).getSW(), "sats with " + p1);
        }
        assertEquals(CashuAppletTest.SW_CONDITIONS_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SPEND_ALL_OUTPUTS, 0, 0, concat(u32(1), new byte[33]))), "nothing begun");
    }

    /** 02 || x with x^3 + 7 not a square mod p: no point. */
    static byte[] offCurve() {
        BigInteger p = CashuAppletTest.SECP_P, e = p.subtract(BigInteger.ONE).shiftRight(1);
        for (BigInteger x = BigInteger.valueOf(5); ; x = x.add(BigInteger.ONE)) {
            if (!x.pow(3).add(BigInteger.valueOf(7)).mod(p).modPow(e, p).equals(BigInteger.ONE)) return concat(new byte[] { 2 }, CashuAppletTest.unsigned32(x));
        }
    }

    @Test
    @DisplayName("LOAD_PROOF refuses a C that is not a point of the curve (6A80): an x whose x^3 + 7 is no square, and an x of p or more; nothing is written; in a batch, the pieces before it go on and it stops there")
    void aCThatIsNoPointIsRefused() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        byte[] p1 = c.piece(UnitsTest.SAT_A, 64);
        System.arraycopy(offCurve(), 0, p1, 44, 33);
        java.util.Map<String, byte[]> before = c.snapshot();
        assertEquals(SW_WRONG_DATA, c.load(p1).getSW(), "x^3 + 7 no square");
        byte[] p2 = c.piece(UnitsTest.SAT_A, 64);
        Arrays.fill(p2, 45, 77, (byte) 0xFF);
        p2[44] = 3;
        assertEquals(SW_WRONG_DATA, c.load(p2).getSW(), "x past p");
        c.assertUnchanged(before, "nothing written");
        byte[] good = c.piece(UnitsTest.SAT_A, 8);
        ResponseAPDU batch = c.load(good, p1);
        assertEquals(SW_OK, batch.getSW());
        assertEquals(1, batch.getData().length, "the good piece went on, and the batch stopped at the one that is no point");
    }

    /** GET_NONCE P1 = 1 on this card: the nonce (16) and the PIN key (33). */
    static byte[][] pinKey(UnitsTest.Card c) {
        byte[] d = c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
        return new byte[][] { Arrays.copyOfRange(d, 0, 16), Arrays.copyOfRange(d, 16, 49) };
    }

    @Test
    @DisplayName("Sealed CHANGE_PIN answers 6A91 whether its envelope opened to a proof that is not the owner's or did not open at all; sealed SET_PIN 6700 whether it opened to the wrong length or did not open; neither costs a PIN try")
    void aSealedCommandSaysNothingOfWhetherItOpened() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        // opened: a proof of nothing, then the PIN block
        byte[][] k = pinKey(c);
        byte[] junk = concat(new byte[] { 1, 0 }, pinBlock(NEW_PIN));
        int opened = c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 1, 0, envelope(BigInteger.valueOf(11), k[1], k[0], INS_CHANGE_PIN, junk)));
        k = pinKey(c);
        int shut = c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 1, 0, spoiled(envelope(BigInteger.valueOf(11), k[1], k[0], INS_CHANGE_PIN, junk), "tag")));
        assertEquals(SW_OWNER_PROOF, opened, "opened, a proof not the owner's");
        assertEquals(opened, shut, "not opened: the same word");
        assertEquals(3, c.info(0)[9], "no try spent");
        // SET_PIN on a card with no PIN
        UnitsTest.Card fresh = new UnitsTest.Card();
        k = pinKey(fresh);
        byte[] shortBlock = new byte[10];
        int openedSet = fresh.sw(new CommandAPDU(CLA, INS_SET_PIN, 1, 0, envelope(BigInteger.valueOf(12), k[1], k[0], INS_SET_PIN, shortBlock)));
        k = pinKey(fresh);
        int shutSet = fresh.sw(new CommandAPDU(CLA, INS_SET_PIN, 1, 0, spoiled(envelope(BigInteger.valueOf(12), k[1], k[0], INS_SET_PIN, pinBlock(TEST_PIN)), "tag")));
        assertEquals(SW_WRONG_LENGTH, openedSet, "opened to ten bytes");
        assertEquals(openedSet, shutSet, "not opened: the same word");
        assertEquals(0, fresh.info(0)[7], "no PIN set");
    }

    @Test
    @DisplayName("Unseal checks the reader's point is on the curve itself (requireFullPoint) before the key agreement, and does not leave that to the chip (read from the source: the simulator's agreement refuses such a point anyway)")
    void theReadersPointIsChecked() throws Exception {
        String src = SchnorrHWMathTest.stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(
            SchnorrHWMathTest.mainSourceDir().resolve("CashuApplet.java")), StandardCharsets.UTF_8));
        int from = src.indexOf("private short unseal("), to = src.indexOf("private static void moveDown(");
        String unseal = src.substring(from, to);
        int check = unseal.indexOf("requireFullPoint(buf, e);"), agree = unseal.indexOf("schnorrHW.agree(");
        assertTrue(check > 0 && check < agree, "the point checked, then agreed with");
        // and a point off the curve is an envelope that does not open
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        byte[][] k = pinKey(c);
        byte[] env = envelope(BigInteger.valueOf(11), k[1], k[0], INS_CHANGE_PIN, concat(new byte[] { 1, 0 }, pinBlock(NEW_PIN)));
        env[64] ^= 1;   // y one bit off: (x, y') is no point
        assertEquals(SW_OWNER_PROOF, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 1, 0, env)));
    }

    @Test
    @DisplayName("CERT_WRITE's seal (P1 = 1) is the length and the container's SHA-256 (34 bytes): a container changed by another reader after its writer's last write is refused (6A80) and nothing is sealed; the writer's own seals")
    void theSealTakesTheContainersHash() throws Exception {
        UnitsTest.Card c = new UnitsTest.Card();
        byte[] key = CertificateTest.cardKey(c);
        byte[] good = CertificateTest.form01(key, "issuer statement".getBytes(StandardCharsets.US_ASCII), new byte[64], CertificateTest.NOTHING);
        CertificateTest.writeAll(c, good);
        assertEquals(SW_OK, c.sw(CertificateTest.writeCommand(45, "EVIL statement!!".getBytes(StandardCharsets.US_ASCII))), "another reader's write");
        byte[] seal = concat(new byte[] { (byte) (good.length >> 8), (byte) good.length }, sha256(good));
        assertEquals(SW_WRONG_DATA, c.sw(new CommandAPDU(CLA, CertificateTest.INS_CERT_WRITE, 1, 0, seal)), "not the container the writer hashed");
        assertEquals(0, CertificateTest.state(c)[0], "not sealed");
        CertificateTest.writeAll(c, good);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, CertificateTest.INS_CERT_WRITE, 1, 0, seal)), "the writer's own container seals");
        assertArrayEquals(good, CertificateTest.readAll(c));
    }

    @Test
    @DisplayName("No owner is claimed on a card that holds only the issuer's factory record (6A8C); a PIN a stranger set on a card on its way to its holder is kept (D196): the holder's SET_PIN wants it, and the holder's way back is the forgotten-PIN path and a reset by the PIN")
    void noClaimOnAFactoryRecord() {
        UnitsTest.Card c = new UnitsTest.Card();
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", NO_REFUND, "FX1"))), "the factory record");
        byte[] thief = { '8', '8', '8', '8' };
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, thief)));
        assertEquals(SW_OK, verify(c, thief));
        assertEquals(SW_NO_CARD_RECORD, held(c.sim::transmitCommand, setOwnerOpenCommand(OTHER_OWNER)).getSW(), "no claim");
        assertEquals(0, c.info(0)[16], "no owner");
        c.power();
        assertEquals(SW_SECURITY_NOT_SATIS, c.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "the holder's SET_PIN");
    }

    @Test
    @DisplayName("A locked card whose PIN a stranger blocked takes its owner's new PIN (CHANGE_PIN): the money on it is paid again under the PIN, and the card stays locked")
    void aLockedCardsBlockedPinIsReplacedByItsOwner() {
        UnitsTest.Card c = new UnitsTest.Card().ready(UnitsTest.SAT, true);
        int place = c.put(-1, UnitsTest.SAT_A, 64);
        int rest = c.put(-1, UnitsTest.SAT_A, 30);
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(c.proofFor(L_LOCK, new byte[0]), new byte[0]))));
        c.tap();
        assertEquals(64, c.pay(place).getData().length, "a locked card pays under its PIN");
        c.power();
        verify(c, WRONG_PIN);
        verify(c, WRONG_PIN);
        assertEquals(SW_PIN_BLOCKED, verify(c, WRONG_PIN), "a stranger blocks it");
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, INS_CHANGE_PIN, 0, 0, ownerData(c.proofFor(L_PIN, NEW_PIN), NEW_PIN))), "the owner's new PIN");
        assertEquals(SW_OK, verify(c, NEW_PIN));
        assertEquals(30, CashuAppletTest.readUint32(c.balance(0), 0));
        assertEquals(64, c.pay(rest).getData().length, "the 30 paid");
        assertEquals(1, c.info(0)[10], "still locked");
    }

    @Test
    @DisplayName("A PIN whose tries are all gone is blocked everywhere, whatever its state byte says (a last wrong try torn before the byte was written): GET_INFO says blocked; an owned card's owner gives a new PIN, and an empty card with no owner (whose counter is set to 0 by hand: it never blocks, D195) takes SET_PIN, at once")
    void aPinWithNoTriesIsBlocked() throws Exception {
        UnitsTest.Card c = UnitsTest.owned(UnitsTest.SAT);
        c.power();
        verify(c, WRONG_PIN);
        verify(c, WRONG_PIN);
        c.power();
        assertEquals(1, c.info(0)[7], "one try left: set, not blocked");
        assertEquals(SW_OK, verify(c, TEST_PIN), "and the right PIN opens it");
        verify(c, WRONG_PIN);
        verify(c, WRONG_PIN);
        assertEquals(SW_PIN_BLOCKED, verify(c, WRONG_PIN));
        c.field("pinState")[0] = 1;   // the state a tear between the counter and the byte leaves
        c.power();
        assertEquals(2, c.info(0)[7], "blocked");
        assertEquals(SW_PIN_BLOCKED, verify(c, TEST_PIN));
        assertEquals(SW_OK, c.sw(new CommandAPDU(CLA, CashuAppletTest.INS_CHANGE_PIN, 0, 0, CashuAppletTest.ownerData(c.proofFor(CashuAppletTest.L_PIN, TEST_PIN), TEST_PIN))), "the owner's new PIN");
        assertEquals(SW_OK, verify(c, TEST_PIN));
        UnitsTest.Card d = HolderTest.noOwner();
        d.power();
        javacard.framework.OwnerPIN pin = (javacard.framework.OwnerPIN) pinOf(d);
        for (int i = 0; i < 3; i++) pin.check(WRONG_PIN, (short) 0, (byte) 4);
        d.power();
        assertEquals(2, d.info(0)[7], "blocked");
        assertEquals(SW_OK, d.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)), "a blocked PIN on an empty card with no owner is replaced");
        assertEquals(SW_OK, verify(d, TEST_PIN));
    }

    static Object pinOf(UnitsTest.Card c) throws Exception {
        java.lang.reflect.Field f = CashuApplet.class.getDeclaredField("pin");
        f.setAccessible(true);
        return f.get(c.applet());
    }

}
