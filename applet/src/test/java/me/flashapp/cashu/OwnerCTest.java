package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
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
 * The card's secret c from the owner's words (D202). The owner's phone works out s = HMAC-SHA256(the 64-byte BIP-39 seed,
 * "CashuCard/c" || 00 || P), P the card's key, and gives it to the card sealed to the card's PIN key Q, which GET_NONCE P1 = 1
 * answers under the card key's signature (SET_OWNER P1 = 1: E, s XOR block 1, block 0's first sixteen bytes; block i =
 * SHA-256("CashuCard/c" || i || x(e*Q) || E [|| the sealed bytes])); the claim or
 * the hand-over that follows carries SHA-256("CashuCard/c" || s)'s first sixteen bytes at the end of its value, under the
 * proof on a hand-over; and the card takes c = SHA-256("CashuCard/c" || s || n), n the owners' c it has taken, this one
 * with them (four bytes, from 1). A phone restored from the words works the same c out; a card with no owner, and a reset,
 * draw their own.
 */
class OwnerCTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final byte[] L = "CashuCard/c".getBytes(StandardCharsets.US_ASCII);
    /** Where the card keeps how many owners' c it has taken: chain[64, +4), after c and the refund key's y. */
    static final int C_COUNT = 64;
    /** BIP-39's test words (its vectors' first, with no passphrase), and a second set for another owner. */
    static final String WORDS = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    static final String OTHER_WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    /** The sender's one-message scalars for the envelope. */
    static final BigInteger E1 = new BigInteger("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", 16);
    static final BigInteger E2 = new BigInteger("0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0", 16);

    // ---- the owner's side, as a phone works it out ----

    /** The 64-byte BIP-39 seed of the words, with no passphrase: PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic". */
    static byte[] seed(String words) throws Exception {
        javax.crypto.SecretKeyFactory f = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512");
        return f.generateSecret(new javax.crypto.spec.PBEKeySpec(words.toCharArray(), "mnemonic".getBytes(StandardCharsets.UTF_8), 2048, 512)).getEncoded();
    }
    static byte[] hmac(byte[] key, byte[] msg) throws Exception {
        javax.crypto.Mac m = javax.crypto.Mac.getInstance("HmacSHA256");
        m.init(new javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"));
        return m.doFinal(msg);
    }
    /** s = HMAC-SHA256(seed, "CashuCard/c" || 00 || P (33)). */
    static byte[] s(byte[] seed, byte[] p33) throws Exception { return hmac(seed, concat(L, new byte[] { 0 }, p33)); }
    static byte[] s(String words, byte[] p33) throws Exception { return s(seed(words), p33); }
    /** The check SET_OWNER's value ends with: SHA-256("CashuCard/c" || s)'s first sixteen bytes. */
    static byte[] check(byte[] s) { return Arrays.copyOf(sha256(concat(L, s)), 16); }
    /** c = SHA-256("CashuCard/c" || s || n (4, big-endian)). */
    static byte[] c(byte[] s, long n) { return sha256(concat(L, s, u32(n))); }
    static byte[] block(int i, byte[] x, byte[] e, byte[] more) { return sha256(concat(L, new byte[] { (byte) i }, x, e, more)); }
    /** E (65) || s XOR block 1 || block 0's first sixteen, to the card's PIN key Q (33), with the sender's scalar e. */
    static byte[] envelope(byte[] s, byte[] q33, BigInteger e) {
        BigInteger[] eg = ecMulTest(e, SECP_GX, SECP_GY);
        BigInteger[] p = decompressed(q33);
        BigInteger[] shared = ecMulTest(e, p[0], p[1]);
        byte[] ee = concat(new byte[] { 4 }, unsigned32(eg[0]), unsigned32(eg[1])), x = unsigned32(shared[0]);
        byte[] b1 = block(1, x, ee, new byte[0]), ct = new byte[32];
        for (int i = 0; i < 32; i++) ct[i] = (byte) (s[i] ^ b1[i]);
        return concat(ee, ct, Arrays.copyOf(block(0, x, ee, ct), 16));
    }

    // ---- the card ----

    static byte[] cardKey(UnitsTest.Card c) { return c.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData(); }
    /** The card's PIN key, from GET_NONCE P1 = 1, its signature by the card key checked as a phone checks it. */
    static byte[] pinKey(UnitsTest.Card c) { return pinKeyOf(c.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), cardKey(c)); }
    static byte[] pinKeyOf(byte[] answer, byte[] p33) {
        assertEquals(113, answer.length, "GET_NONCE P1 = 1: the nonce, the PIN key, the card key's signature");
        byte[] q = Arrays.copyOfRange(answer, 16, 49);
        try {
            assertTrue(schnorrVerify(Arrays.copyOfRange(p33, 1, 33), sha256(concat("CashuCard/pinkey".getBytes(StandardCharsets.US_ASCII), q)), Arrays.copyOfRange(answer, 49, 113)),
                "the PIN key is the card's: its key signs it");
        } catch (java.security.NoSuchAlgorithmException x) {
            throw new IllegalStateException(x);
        }
        return q;
    }
    static CommandAPDU stage(byte[] env) { return new CommandAPDU(CLA, INS_SET_OWNER, 1, 0, env); }
    /** The card's PIN key made the tests' own scalar (jCardSim draws the card key's pair again for it), and the card's kept signature over the last one let go, so that GET_NONCE P1 = 1 signs the new one. */
    static byte[] ownPinKey(UnitsTest.Card c) throws Exception {
        byte[] q = LinkingTest.ownPinKey(c);
        c.field("pinKeySig")[0] = 0;
        return q;
    }
    static byte[] cOf(UnitsTest.Card c) throws Exception { return Arrays.copyOf(c.field("chain"), 32); }
    static long count(UnitsTest.Card c) throws Exception { return readUint32(c.field("chain"), C_COUNT); }
    static byte[] allOut(UnitsTest.Card c) throws Exception { return c.field("allOut"); }

    /** A card in its first set-up (the PIN set and given, the holder's record with the refund key R = G, a clock), claimed by `owner` with the owner's c of `words`. */
    static UnitsTest.Card claimed(Key owner, String words) throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s = s(words, cardKey(card));
        assertEquals(SW_OK, card.sw(stage(envelope(s, pinKey(card), E1))), "the owner's c, sealed");
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(owner.pub, check(s)))), "the claim, held, with its check");
        card.tap();
        return card;
    }

    /** The owner hands the card to `next`, which gives its own c (the words `words`): the last owner's proof over the key and the check. */
    static int handOver(UnitsTest.Card card, Key last, Key next, String words) throws Exception {
        byte[] s = s(words, cardKey(card));
        // one GET_NONCE P1 = 1: the PIN key for the envelope, and the sixteen bytes the last owner's proof is over
        byte[] answer = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
        byte[] n = Arrays.copyOf(answer, 16);
        int st = card.sw(stage(envelope(s, pinKeyOf(answer, cardKey(card)), E2)));
        if (st != SW_OK) return st;
        byte[] v = concat(next.pub, check(s));
        return card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, last, n, v), v)));
    }

    /** c as the owner's grant reads it, sealed to the refund key R = G and opened with r = 1. */
    static byte[] readC(UnitsTest.Card card, Key owner) {
        ResponseAPDU n = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
        byte[] proof = ownerProof(L_LOAD, owner, n.getData(), new byte[0]);
        assertEquals(SW_GRANT, card.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(proof, new byte[0]))), "the grant");
        Object[] r = LinkingTest.readC(card, anotherPinKey(), 0);
        assertEquals(SW_OK, r[1], "c, sealed to the refund key");
        return (byte[]) r[0];
    }

    // =====================================================================================================================

    @Test
    @DisplayName("A claim with the owner's c: the card's c is SHA-256(\"CashuCard/c\" || s || 00000001), s worked out from the owner's words and P; the count is 1; the owner's grant reads the same c, sealed to its refund key; and the date keys the card answers are that c's")
    void aClaimTakesTheOwnersC() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] drawn = cOf(card), p = cardKey(card);
        assertEquals(0, count(card), "a card that has taken no owner's c");
        byte[] s = s(WORDS, p);
        assertEquals(SW_OK, card.sw(stage(envelope(s, pinKey(card), E1))), "the owner's c, sealed to the PIN key");
        assertArrayEquals(drawn, cOf(card), "kept for the claim, not taken yet");
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)))), "the claim, with the check");
        assertArrayEquals(c(s, 1), cOf(card), "c = SHA-256(\"CashuCard/c\" || s || 1)");
        assertFalse(Arrays.equals(drawn, cOf(card)), "not the c the card drew");
        assertEquals(1, count(card), "the first owner's c the card has taken");
        assertArrayEquals(new byte[32], Arrays.copyOf(allOut(card), 32), "s is not left in RAM");
        card.tap();
        assertArrayEquals(c(s, 1), readC(card, OWNER), "the owner's grant reads it, sealed to its refund key");
        // the date keys, t and R + u*G, are the ones that c gives
        card.tap();
        long d = 1_900_000_000L;
        ResponseAPDU g = card.send(new CommandAPDU(CLA, CashuApplet.INS_GROUP_KEYS, 0, 0, u32(d), 0x62));
        assertEquals(SW_OK, g.getSW());
        BigInteger n = SECP_N;
        BigInteger t = new BigInteger(1, sha256(concat("CashuCard/key".getBytes(StandardCharsets.US_ASCII), c(s, 1), u32(d)))).mod(n);
        assertArrayEquals(unsigned32(t), Arrays.copyOf(g.getData(), 32), "t of the date, from the owner's c");
        BigInteger u = new BigInteger(1, sha256(concat("CashuCard/refund-key".getBytes(StandardCharsets.US_ASCII), c(s, 1), u32(d)))).mod(n);
        // the refund key of the date is spent with r + u, r = 1 (R = G): (1 + u)*G is what the card answers
        assertArrayEquals(compressed(ecMulTest(BigInteger.ONE.add(u).mod(n), SECP_GX, SECP_GY)), Arrays.copyOfRange(g.getData(), 65, 98), "R + u*G = (r + u)*G");
    }

    @Test
    @DisplayName("A phone restored from the words works out the card's c with no card, given the card's key P (which the words do not give): the seed from the twelve words, s from the seed and P, and c for n = 1, 2, ... until it is the card's; the take-back key of a dated piece, r + u, is then the one the card's refund key for that date needs")
    void aRestoredPhoneWorksOutTheSameC() throws Exception {
        UnitsTest.Card card = claimed(OWNER, WORDS);
        byte[] p = cardKey(card), held = cOf(card);
        // the restored phone: nothing but the words and the card's key
        byte[] seed = seed(WORDS);
        assertEquals("5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
            toHex(seed), "BIP-39's seed of its test words, no passphrase");
        byte[] s = s(seed, p);
        long found = 0;
        for (long n = 1; n <= 16 && found == 0; n++) if (Arrays.equals(c(s, n), held)) found = n;
        assertEquals(1, found, "the first owner's c of this card");
        // another set of words never makes it
        byte[] other = s(OTHER_WORDS, p);
        for (long n = 1; n <= 16; n++) assertFalse(Arrays.equals(c(other, n), held), "other words, n = " + n);
        // the take-back key for a date: (r + u)*G is the card's R + u*G for it
        long d = 1_900_000_000L;
        card.pin();
        ResponseAPDU g = card.send(new CommandAPDU(CLA, CashuApplet.INS_GROUP_KEYS, 0, 0, u32(d), 0x62));
        BigInteger u = new BigInteger(1, sha256(concat("CashuCard/refund-key".getBytes(StandardCharsets.US_ASCII), c(s, found), u32(d)))).mod(SECP_N);
        assertArrayEquals(compressed(ecMulTest(BigInteger.ONE.add(u).mod(SECP_N), SECP_GX, SECP_GY)), Arrays.copyOfRange(g.getData(), 65, 98),
            "the restored phone's take-back key for the date is the card's refund key for it");
    }

    @Test
    @DisplayName("A hand-over with the next owner's c: c = SHA-256(\"CashuCard/c\" || s' || 2), s' from the next owner's words; the last owner's c is gone; the next owner's grant reads it (sealed to the PIN key until it names its refund key); the hand-over clears what it clears")
    void aHandOverTakesTheNextOwnersC() throws Exception {
        UnitsTest.Card card = claimed(OWNER, WORDS);
        byte[] first = cOf(card), p = cardKey(card);
        byte[] pinKey = ownPinKey(card);
        card.tap();
        assertEquals(SW_OK, handOver(card, OWNER, OTHER_OWNER, OTHER_WORDS), "the hand-over, with the next owner's c");
        byte[] s2 = s(OTHER_WORDS, p);
        assertArrayEquals(c(s2, 2), cOf(card), "the next owner's c, the card's second owner's c");
        assertFalse(Arrays.equals(first, cOf(card)), "the last owner's c gone");
        assertEquals(2, count(card));
        assertEquals(CashuApplet.PIN_OWED, card.field("pinMarks")[CashuApplet.PM_FORGET], "the last owner's taken down, the next PIN owed, as at any hand-over");
        assertArrayEquals(new byte[33], Arrays.copyOfRange(card.record(), CashuApplet.CARD_REFUND_OFFSET, CashuApplet.CARD_REFUND_OFFSET + 33), "the last owner's refund key gone");
        // the next owner's grant reads c, sealed to the PIN key (no refund key yet)
        card.power();
        ResponseAPDU n = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 0, 0, 16));
        byte[] proof = ownerProof(L_LOAD, OTHER_OWNER, n.getData(), new byte[0]);
        assertEquals(SW_GRANT, card.sw(new CommandAPDU(CLA, INS_ALLOW_LOAD, 0, 0, ownerData(proof, new byte[0]))));
        Object[] r = LinkingTest.readC(card, pinKey, 1);
        assertEquals(SW_OK, r[1]);
        assertArrayEquals(c(s2, 2), (byte[]) r[0], "the next owner reads its own c");
    }

    @Test
    @DisplayName("The same owner never gets an old c: handed to itself, then reset and claimed again with the same words, the card takes a new c each time, the count moving on (and through the reset, which draws its own c and keeps the count)")
    void theSameOwnerNeverGetsAnOldC() throws Exception {
        UnitsTest.Card card = claimed(OWNER, WORDS);
        java.util.Set<String> seen = new java.util.HashSet<>();
        seen.add(toHex(cOf(card)));
        card.tap();
        assertEquals(SW_OK, handOver(card, OWNER, OWNER, WORDS), "handed to itself, the same words");
        assertTrue(seen.add(toHex(cOf(card))), "a new c");
        assertArrayEquals(c(s(WORDS, cardKey(card)), 2), cOf(card));
        // the owner's reset: a c of the card's own, and the count kept
        card.power();
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(card.proofFor(L_RESET, new byte[0]), new byte[0]))), "the reset");
        assertTrue(seen.add(toHex(cOf(card))), "the reset draws a c");
        assertEquals(2, count(card), "the count is kept through the reset");
        // set up and claimed again, by the same words
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        card.pin();
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        byte[] s = s(WORDS, cardKey(card));
        assertEquals(SW_OK, card.sw(stage(envelope(s, pinKey(card), E1))));
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)))));
        assertTrue(seen.add(toHex(cOf(card))), "a new c again");
        assertArrayEquals(c(s, 3), cOf(card), "the third owner's c the card has taken");
    }

    @Test
    @DisplayName("Replayed, an old claim never sets an old c: its envelope and its check sent again after a reset and a new set-up give the next count's c (or, to a card with a new key, do not open), never the one it gave before")
    void aReplayedClaimNeverSetsAnOldC() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s = s(WORDS, cardKey(card));
        CommandAPDU st = stage(envelope(s, pinKey(card), E1)), claim = new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)));
        assertEquals(SW_OK, card.sw(st));
        assertEquals(SW_OK, card.sw(claim));
        byte[] old = cOf(card);
        card.power();
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(card.proofFor(L_RESET, new byte[0]), new byte[0]))));
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        card.pin();
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        int a = card.sw(st);
        if (a == SW_OK) {
            assertEquals(SW_OK, card.sw(claim), "the same claim, again");
            assertArrayEquals(c(s, 2), cOf(card), "the next count's c");
        } else {
            assertEquals(SW_WRONG_DATA, a, "an envelope to the card's last key does not open");
        }
        assertFalse(Arrays.equals(old, cOf(card)), "never the old c");
    }

    @Test
    @DisplayName("The owner's c is kept for the next SET_OWNER only: a command between (a read, a header, a nonce) lets it go, and the SET_OWNER with the check then answers 6985 with nothing written; a second envelope replaces the first, whose check is then 6A80")
    void theStageIsForTheNextSetOwnerOnly() throws Exception {
        // (a SELECT lets it go too, with the PIN and the first set-up: the claim is then refused for them, before it looks for s)
        CommandAPDU[] between = { new CommandAPDU(CLA, INS_GET_INFO, 0, 0, 256), setTimeCommand(T0 + 60), new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256),
            new CommandAPDU(CLA, INS_GET_CARD, 0, 0, 256) };
        for (CommandAPDU b : between) {
            UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
            byte[] drawn = cOf(card), s = s(WORDS, cardKey(card));
            assertEquals(SW_OK, card.sw(stage(envelope(s, pinKey(card), E1))));
            card.sim.transmitCommand(b);
            assertArrayEquals(new byte[32], Arrays.copyOf(allOut(card), 32), "s let go, and not left in RAM: INS " + b.getINS());
            assertEquals(SW_CONDITIONS_NOT_SATIS, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)))), "INS " + Integer.toHexString(b.getINS()) + " between");
            assertEquals(0, card.field("ownerSet")[0], "no owner");
            assertArrayEquals(drawn, cOf(card), "c as it was");
            assertEquals(0, count(card));
        }
        // a second envelope replaces the first
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s1 = s(WORDS, cardKey(card)), s2 = s(OTHER_WORDS, cardKey(card));
        assertEquals(SW_OK, card.sw(stage(envelope(s1, pinKey(card), E1))));
        assertEquals(SW_OK, card.sw(stage(envelope(s2, pinKey(card), E2))));
        assertEquals(SW_WRONG_DATA, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s1)))), "the first's check");
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s2)))), "the second's");
        assertArrayEquals(c(s2, 1), cOf(card));
    }

    @Test
    @DisplayName("An envelope that does not open (its tag, its sealed bytes, E off the curve or not uncompressed, another length) is refused 6A80 or 6700 and keeps nothing: the claim with a check then answers 6985; the seal's room is zeros after it")
    void anEnvelopeThatDoesNotOpenKeepsNothing() throws Exception {
        String[] ways = { "tag", "tagfirst", "body", "last", "x", "y", "02", "point", "big" };
        for (String how : ways) {
            UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
            byte[] s = s(WORDS, cardKey(card));
            byte[] env = spoiled(envelope(s, pinKey(card), E1), how);
            assertEquals(SW_WRONG_DATA, card.sw(stage(env)), how);
            assertArrayEquals(new byte[32], Arrays.copyOf(allOut(card), 32), how + ": nothing kept");
            assertArrayEquals(new byte[99], Arrays.copyOf(card.field("scratch"), 99), how + ": the seal's room zeros");
            assertEquals(SW_CONDITIONS_NOT_SATIS, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)))), how + ": nothing to take");
        }
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] env = envelope(s(WORDS, cardKey(card)), pinKey(card), E1);
        assertEquals(SW_WRONG_LENGTH, card.sw(stage(Arrays.copyOf(env, 112))), "112 bytes");
        assertEquals(SW_WRONG_LENGTH, card.sw(stage(Arrays.copyOf(env, 114))), "114 bytes");
        // an envelope made to another key than the card's does not open
        byte[] elsewhere = envelope(s(WORDS, cardKey(card)), anotherPinKey(), E1);
        assertEquals(SW_WRONG_DATA, card.sw(stage(elsewhere)), "to another key");
        // nor one made to the card's own key P: the card key agrees with no one (jCardSim draws the same pair for both keys,
        // so the PIN key is made the tests' own here first)
        ownPinKey(card);
        assertFalse(Arrays.equals(cardKey(card), pinKey(card)), "two keys");
        assertEquals(SW_WRONG_DATA, card.sw(stage(envelope(s(WORDS, cardKey(card)), cardKey(card), E1))), "to the card key");
        assertEquals(SW_OK, card.sw(stage(envelope(s(WORDS, cardKey(card)), pinKey(card), E1))), "to the PIN key");
        // and P1 other than 0 or 1
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 2, 0, OWNER.pub)), "P1 02");
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0x80, 0, OWNER.pub)), "P1 80");
    }

    @Test
    @DisplayName("SET_OWNER with a P2 other than 00, in either form: 6B00 with nothing kept or written; the envelope, the claim and the hand-over go through with 00 after")
    void aP2OtherThanZeroIsRefused() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s = s(WORDS, cardKey(card)), q = pinKey(card), before = cOf(card);
        byte[] env = envelope(s, q, E1);
        for (int p2 : new int[] { 1, 0x55, 0xFF }) {
            assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 1, p2, env)), "the envelope, P2 " + p2);
            assertArrayEquals(new byte[32], Arrays.copyOf(allOut(card), 32), "nothing kept");
        }
        assertEquals(SW_OK, card.sw(stage(env)));
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0x55, concat(OWNER.pub, check(s)))), "the claim, P2 55");
        assertArrayEquals(before, cOf(card), "c as it was");
        assertEquals(0, count(card));
        UnitsTest.Card owned = claimed(OWNER, WORDS);
        byte[] s2 = s(OTHER_WORDS, cardKey(owned));
        byte[] answer = owned.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
        byte[] n = Arrays.copyOf(answer, 16);
        assertEquals(SW_OK, owned.sw(stage(envelope(s2, pinKeyOf(answer, cardKey(owned)), E2))));
        byte[] v = concat(OTHER_OWNER.pub, check(s2));
        assertEquals(0x6B00, owned.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 1, ownerData(ownerProof(L_OWNER, OWNER, n, v), v))), "the hand-over, P2 01");
        assertEquals(1, count(owned), "the last owner's c stays");
        assertEquals(SW_OK, handOver(owned, OWNER, OTHER_OWNER, OTHER_WORDS), "with 00");
        assertEquals(2, count(owned));
    }

    @Test
    @DisplayName("A hand-over's last owner can put in a c of its own choosing: the next owner's words then give it for no n, which is the next owner's check (it reads c and finds no n before it locks dated money)")
    void theNextOwnerChecksTheLastOwnersEnvelope() throws Exception {
        UnitsTest.Card card = claimed(OWNER, WORDS);
        byte[] p = cardKey(card);
        byte[] chosen = sha256("the last owner's own s".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        byte[] answer = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
        byte[] n = Arrays.copyOf(answer, 16);
        assertEquals(SW_OK, card.sw(stage(envelope(chosen, pinKeyOf(answer, p), E2))));
        byte[] v = concat(OTHER_OWNER.pub, check(chosen));
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, n, v), v))));
        assertArrayEquals(c(chosen, 2), cOf(card), "the card took the last owner's choice");
        byte[] mine = s(OTHER_WORDS, p);
        for (int k = 1; k <= 64; k++) assertFalse(Arrays.equals(c(mine, k), cOf(card)), "the next owner's words give it for no n: n = " + k);
    }

    @Test
    @DisplayName("A check that is not the kept s's is refused 6A80, as other data of a claim's own is: it neither counts nor ends the askings, and the s kept stays; an envelope sent again begins the askings again; on a hand-over the check is under the last owner's proof: one appended after a proof over the key alone is 6A91")
    void theCheckBindsTheEnvelope() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s = s(WORDS, cardKey(card)), other = s(OTHER_WORDS, cardKey(card)), q = pinKey(card);
        assertEquals(SW_OK, card.sw(stage(envelope(s, q, E1))));
        CommandAPDU good = new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(s)));
        assertEquals(SW_KEEP_HOLDING, card.sim.transmitCommand(good).getSW(), "the first asking");
        assertEquals(SW_WRONG_DATA, card.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(other)))).getSW(), "another s's check");
        for (int i = 2; i < CLAIM_ASKINGS; i++) assertEquals(SW_KEEP_HOLDING, card.sim.transmitCommand(good).getSW(), "asking " + i + ": the count kept");
        // an envelope sent again (the same s) begins the askings again: six more
        assertEquals(SW_OK, card.sim.transmitCommand(stage(envelope(s, q, E2))).getSW(), "the envelope again");
        for (int i = 1; i < CLAIM_ASKINGS; i++) assertEquals(SW_KEEP_HOLDING, card.sim.transmitCommand(good).getSW(), "asking " + i + " after the envelope: from the first");
        assertEquals(SW_OK, card.sim.transmitCommand(good).getSW(), "the sixth good asking");
        assertArrayEquals(c(s, 1), cOf(card));
        // a hand-over whose check is not under the proof
        card.tap();
        byte[] s2 = s(OTHER_WORDS, cardKey(card));
        byte[] answer = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
        byte[] n = Arrays.copyOf(answer, 16);
        assertEquals(SW_OK, card.sw(stage(envelope(s2, pinKeyOf(answer, cardKey(card)), E2))));
        byte[] proof = ownerProof(L_OWNER, OWNER, n, OTHER_OWNER.pub);
        byte[] before = cOf(card);
        assertEquals(SW_OWNER_PROOF, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(ownerData(proof, OTHER_OWNER.pub), check(s2)))), "the check after a proof over the key alone");
        assertArrayEquals(before, cOf(card), "nothing taken");
        assertEquals(1, count(card));
    }

    @Test
    @DisplayName("Without the check, a claim keeps the card's own c and a hand-over draws one, as before, and the count does not move; with a check and an anchor, the clock is anchored as without one")
    void withoutTheCheckTheCardDrawsItsOwn() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] drawn = cOf(card);
        assertEquals(SW_OK, card.sw(setOwnerOpenCommand(OWNER)), "a claim with no c of the owner's");
        assertArrayEquals(drawn, cOf(card), "the card's own c");
        assertEquals(0, count(card));
        card.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(card), "a hand-over with none");
        assertFalse(Arrays.equals(drawn, cOf(card)), "drawn");
        assertEquals(0, count(card));
        // a claim with an anchor and the check
        UnitsTest.Card a = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        byte[] s = s(WORDS, cardKey(a));
        byte[] header = mine(T0 + 1200, 0x207FFFFFL, 0);
        assertEquals(SW_OK, a.sw(stage(envelope(s, pinKey(a), E1))));
        assertEquals(SW_OK, a.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, header, check(s)))), "key, anchor, check");
        assertEquals(T0 + 1200, readUint32(a.record(), CashuApplet.CARD_NOW_OFFSET), "anchored");
        assertArrayEquals(c(s, 1), cOf(a));
        // and lengths between are refused
        UnitsTest.Card b = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        assertEquals(SW_OK, b.sw(stage(envelope(s(WORDS, cardKey(b)), pinKey(b), E1))));
        for (int extra : new int[] { 15, 17, 80 + 15, 80 + 17 }) {
            assertEquals(SW_WRONG_LENGTH, b.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, new byte[extra]))), "65 + " + extra);
        }
    }

    // ---- torn ----

    static byte[] claimS;

    @Test
    @DisplayName("A claim with the owner's c, torn at every write: no owner, the card's own c and a count of 0, or the owner, its c and a count of 1; never a mix")
    void aClaimWithTheOwnersCIsWholeOrNotAtAll() throws Exception {
        TearSweepTest.sweep("SET_OWNER claim with the owner's c", c -> {
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, TEST_PIN)).getSW());
                assertEquals(SW_OK, c.sim.transmitCommand(setCardOpenCommand(record(MINT, REFUND))).getSW());
                byte[] p = c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
                byte[] q = pinKeyOf(c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), p);
                claimS = s(WORDS, p);
                assertEquals(SW_OK, c.sim.transmitCommand(stage(envelope(claimS, q, E1))).getSW());
                TearHook.refresh();
            },
            c -> c.send(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, check(claimS)))),
            c -> {
                byte os = c.f("ownerSet")[0];
                long n = readUint32(c.f("chain"), C_COUNT);
                boolean ours = Arrays.equals(c(claimS, 1), Arrays.copyOf(c.f("chain"), 32));
                if (os == 0 && (n != 0 || ours)) c.wrong("no owner, and the owner's c or its count: " + n);
                if (os == 1 && (n != 1 || !ours)) c.wrong("the owner, and not its c or count: " + n + " " + ours);
            });
    }

    static byte[] handS, handNonce;

    @Test
    @DisplayName("A hand-over with the next owner's c, torn at every write: the last owner whole with its c and a count of 1, or the next owner with its c and a count of 2 and the last owner's gone; never a mix")
    void aHandOverWithTheNextOwnersCIsWholeOrNotAtAll() throws Exception {
        TearSweepTest.sweep("SET_OWNER hand-over with the next owner's c", c -> {
                SetUpAndResetTest.paidOut(c);
                // the card's first owner's c was the card's own; one taken before, so that the count says which
                System.arraycopy(u32(1), 0, c.f("chain"), C_COUNT, 4);
                byte[] p = c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
                handS = s(OTHER_WORDS, p);
                // the nonce for the proof, then the next owner's c sealed: SET_OWNER is the next command, the one torn
                byte[] answer = c.sim.transmitCommand(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData();
                handNonce = Arrays.copyOf(answer, 16);
                assertEquals(SW_OK, c.sim.transmitCommand(stage(envelope(handS, pinKeyOf(answer, p), E2))).getSW());
                TearHook.refresh();
            },
            c -> {
                byte[] v = concat(OTHER_OWNER.pub, check(handS));
                c.raw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, ownerData(ownerProof(L_OWNER, OWNER, handNonce, v), v)));
            },
            c -> {
                SetUpAndResetTest.handOverWhole(c);
                long n = readUint32(c.f("chain"), C_COUNT);
                boolean ours = Arrays.equals(c(handS, 2), Arrays.copyOf(c.f("chain"), 32));
                boolean last = Arrays.equals(SetUpAndResetTest.CHAIN_BEFORE, Arrays.copyOf(c.f("chain"), 32));
                if (!(last && n == 1) && !(ours && n == 2)) c.wrong("c and its count mixed: count " + n + ", the next owner's " + ours + ", the last's " + last);
            });
    }

    // ---- the vector ----

    /**
     * The derivation and the envelope, byte for byte, with BIP-39's test words: the seed, the card's key P (jCardSim's), its PIN
     * key Q and the card key's signature over it (GET_NONCE P1 = 1), s, the sender's e and E, x(e*Q), the envelope, the check, the claim's value after the owner key, the count and c, and a date's keys, the
     * card's own GROUP_KEYS answer for it. Written to target/owner-c-vector.json; spec/vectors/owner-c.json is that run, kept.
     */
    @Test
    @DisplayName("The owner's c vector: BIP-39's test words, s, the envelope to the card's PIN key, the check, c for the count 1 and the card's own date keys under it; written to target/owner-c-vector.json; spec/vectors/owner-c.json is that run, kept")
    void theOwnersCVector() throws Exception {
        UnitsTest.Card card = SimpleCardTest.inFirstSetUp(UnitsTest.SAT);
        // a PIN key that is not the card key (jCardSim draws one pair for both): the tests' own scalar
        ownPinKey(card);
        byte[] p = cardKey(card), answer = card.send(new CommandAPDU(CLA, INS_GET_NONCE, 1, 0, 256)).getData(), q = pinKeyOf(answer, p);
        assertFalse(Arrays.equals(p, q), "the PIN key is not the card key");
        byte[] seed = seed(WORDS), s = s(seed, p), env = envelope(s, q, E1), chk = check(s);
        BigInteger[] eg = ecMulTest(E1, SECP_GX, SECP_GY);
        BigInteger[] pp = decompressed(q);
        byte[] x = unsigned32(ecMulTest(E1, pp[0], pp[1])[0]);
        assertEquals(SW_OK, card.sw(stage(env)));
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_SET_OWNER, 0, 0, concat(OWNER.pub, chk))));
        assertArrayEquals(c(s, 1), cOf(card));
        card.tap();
        long d = 1_900_000_000L;
        ResponseAPDU g = card.send(new CommandAPDU(CLA, CashuApplet.INS_GROUP_KEYS, 0, 0, u32(d), 0x62));
        assertEquals(SW_OK, g.getSW());
        StringBuilder out = new StringBuilder("{\n \"label\": \"CashuCard/c\",\n \"words\": \"").append(WORDS)
            .append("\",\n \"seed\": \"").append(toHex(seed))
            .append("\",\n \"cardKey\": \"").append(toHex(p))
            .append("\",\n \"pinKey\": \"").append(toHex(q))
            .append("\",\n \"pinKeySig\": \"").append(toHex(Arrays.copyOfRange(answer, 49, 113)))
            .append("\",\n \"s\": \"").append(toHex(s))
            .append("\",\n \"e\": \"").append(toHex(unsigned32(E1)))
            .append("\",\n \"E\": \"").append(toHex(concat(new byte[] { 4 }, unsigned32(eg[0]), unsigned32(eg[1]))))
            .append("\",\n \"x\": \"").append(toHex(x))
            .append("\",\n \"envelope\": \"").append(toHex(env))
            .append("\",\n \"stage\": \"").append(toHex(stage(env).getBytes()))
            .append("\",\n \"check\": \"").append(toHex(chk))
            .append("\",\n \"n\": 1,\n \"c\": \"").append(toHex(c(s, 1)))
            .append("\",\n \"refundKey\": \"").append(toHex(REFUND))
            .append("\",\n \"date\": ").append(d)
            .append(",\n \"groupKeys\": \"").append(toHex(g.getData())).append("\"\n}\n");
        java.nio.file.Path applet = SchnorrHWMathTest.mainSourceDir().toAbsolutePath().normalize();
        while (applet != null && !applet.endsWith("applet")) applet = applet.getParent();
        org.junit.jupiter.api.Assertions.assertNotNull(applet, "the applet folder");
        java.nio.file.Files.createDirectories(applet.resolve("target"));
        java.nio.file.Files.write(applet.resolve("target").resolve("owner-c-vector.json"), out.toString().getBytes(StandardCharsets.UTF_8));
        java.nio.file.Path kept = applet.getParent().resolve("spec").resolve("vectors").resolve("owner-c.json");
        org.junit.jupiter.api.Assertions.assertTrue(java.nio.file.Files.exists(kept), "spec/vectors/owner-c.json is kept");
        // the card's signature over its PIN key is fresh at each run: the kept one is checked under the kept P, every other field is the same
        String k = new String(java.nio.file.Files.readAllBytes(kept), StandardCharsets.UTF_8);
        for (String f : new String[] { "label", "words", "seed", "cardKey", "pinKey", "s", "e", "E", "x", "envelope", "stage", "check", "c", "refundKey", "groupKeys" }) {
            assertEquals(InboxTest.field(out.toString(), f), InboxTest.field(k, f), "spec/vectors/owner-c.json is one run of this test, kept: " + f);
        }
        assertTrue(k.contains("\"n\": 1,") && k.contains("\"date\": " + d + ","), "n and the date");
        byte[] keptQ = hexToBytes(InboxTest.field(k, "pinKey"));
        assertTrue(schnorrVerify(Arrays.copyOfRange(hexToBytes(InboxTest.field(k, "cardKey")), 1, 33), sha256(concat("CashuCard/pinkey".getBytes(StandardCharsets.US_ASCII), keptQ)),
            hexToBytes(InboxTest.field(k, "pinKeySig"))), "the kept PIN key is signed by the kept card key");
    }
}
