package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * INBOX (0x1E, D199): where money waits for the card in the week of its own clock, to anyone, with no PIN:
 * SHA-256("CashuCard/inbox" || c || W) and W, the four bytes of floor(time / 604800). No week is asked for: the card answers
 * the week of its clock, which a holder moves forward with real headers, one week at a time from the card's last header up
 * to now (never back). Nothing else about c, no history; nothing written.
 */
class InboxTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    static final int INS_INBOX = 0x1E;
    static final long WEEK = 604_800L;

    static CommandAPDU inbox() { return new CommandAPDU(CLA, INS_INBOX, 0, 0, 256); }

    /** The owner's own derivation, from c and the card's time: SHA-256("CashuCard/inbox" || c || W) || W. */
    static byte[] derived(byte[] c, long time) {
        byte[] w = u32(time / WEEK);
        return concat(sha256(concat("CashuCard/inbox".getBytes(StandardCharsets.US_ASCII), c, w)), w);
    }

    static byte[] c(UnitsTest.Card card) throws Exception { return Arrays.copyOf(card.field("chain"), 32); }

    static long now(UnitsTest.Card card) throws Exception { return readUint32(card.record(), CashuApplet.CARD_NOW_OFFSET); }

    @Test
    @DisplayName("INBOX answers the owner's own derivation from c for the week of the card's clock, 36 bytes, to a reader with no PIN in its tap, on an owned card and on a card with no owner")
    void itIsTheOwnersDerivationWithNoPin() throws Exception {
        for (boolean owner : new boolean[] { true, false }) {
            UnitsTest.Card card = new UnitsTest.Card().ready(UnitsTest.SAT, owner);
            card.power();                                        // a new tap: nothing given in it
            ResponseAPDU r = card.send(inbox());
            assertEquals(SW_OK, r.getSW(), "no PIN, owner " + owner);
            assertEquals(36, r.getData().length, "the inbox (32) and its week (4), and nothing else");
            assertArrayEquals(derived(c(card), T0), r.getData(), "the owner's derivation from c, for T0's week");
            assertEquals(T0 / WEEK, readUint32(r.getData(), 32), "W = floor(time / 604800)");
        }
    }

    @Test
    @DisplayName("The week is the clock's, floor(time / 604800), at each side of a week's edge and near the top of four bytes; a new week gives a new inbox, and the week before is no longer answered; the terminal's own time (TELL_TIME) moves nothing")
    void aNewWeekAndTheOldOneGone() throws Exception {
        UnitsTest.Card card = UnitsTest.owned(UnitsTest.SAT);
        byte[] c = c(card);
        byte[] first = card.send(inbox()).getData();
        long edge = (T0 / WEEK + 1) * WEEK;
        assertEquals(SW_OK, card.sw(tellTimeCommand(edge + 3 * WEEK)));
        assertArrayEquals(first, card.send(inbox()).getData(), "the terminal's time is a note: the week is the card's own clock's");
        java.util.Map<Long, String> byWeek = new java.util.HashMap<>();
        byWeek.put(T0 / WEEK, toHex(first));
        for (long t : new long[] { edge - 1, edge, edge + WEEK - 1, edge + WEEK, 3_000_000_000L, 0xFFFF_FF00L }) {
            assertEquals(SW_OK, card.sw(setTimeCommand(t)), "a header at " + t);
            assertEquals(t, now(card), "the clock at " + t);
            byte[] got = card.send(inbox()).getData();
            assertArrayEquals(derived(c, t), got, "the inbox for " + t + "'s week, " + t / WEEK);
            String was = byWeek.putIfAbsent(t / WEEK, toHex(got));
            if (was != null) assertEquals(was, toHex(got), t + ": the same week, the same inbox");
            for (java.util.Map.Entry<Long, String> e : byWeek.entrySet()) {
                if (e.getKey() != t / WEEK) assertFalse(e.getValue().equals(toHex(got)), t + ": the inbox of week " + e.getKey() + " is not answered");
            }
        }
        assertEquals(5, byWeek.size(), "T0's week (edge - 1 is in it), the edge's (edge + WEEK - 1 too), the next, and two more");
        // a command's data or another P1 or P2 never names a week: the clock's is the only one
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_INBOX, 1, 0, 256)), "P1 01");
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_INBOX, 0, 1, 256)), "P2 01");
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_INBOX, 0x80, 0x80, 256)), "P1 80 P2 80");
        ResponseAPDU withData = card.send(new CommandAPDU(CLA, INS_INBOX, 0, 0, u32(T0 / WEEK), 256));
        assertArrayEquals(derived(c, 0xFFFF_FF00L), withData.getData(), "data that names an earlier week: the clock's week all the same");
    }

    @Test
    @DisplayName("INBOX writes nothing: no persistent write at all under the tear harness (so no tear can leave anything), the card's arrays the same after it, and the history and counts untouched")
    void itWritesNothing() throws Exception {
        TearSweepTest.Card card = new TearSweepTest.Card();
        readyOn(card.sim, 0);
        card.sim.reset();
        card.select();
        TearHook.refresh();
        TearHook.count = 0;
        TearHook.target = 0;
        TearHook.trace = new java.util.ArrayList<>();
        ResponseAPDU r = card.send(inbox());
        java.util.List<String> trace = TearHook.trace;
        TearHook.trace = null;
        assertEquals(SW_OK, r.getSW());
        assertEquals(0, TearHook.count, "no persistent write: " + trace);
        UnitsTest.Card u = UnitsTest.owned(UnitsTest.SAT);
        u.power();
        java.util.Map<String, byte[]> before = u.snapshot();
        byte[] pin = u.field("pinMarks").clone(), chain = u.field("chain").clone();
        for (int i = 0; i < 5; i++) assertEquals(SW_OK, u.sw(inbox()));
        u.assertUnchanged(before, "after five INBOX");
        assertArrayEquals(pin, u.field("pinMarks"), "the PIN's marks");
        assertArrayEquals(chain, u.field("chain"), "c");
    }

    @Test
    @DisplayName("A hand-over (an owner replaced) and a reset draw a new c, and the inbox changes with it, for the same week; the last owner's inbox is no longer answered")
    void aHandOverOrAResetChangesIt() throws Exception {
        UnitsTest.Card card = UnitsTest.owned(UnitsTest.SAT);
        byte[] before = card.send(inbox()).getData();
        card.tap();
        assertEquals(SW_OK, LinkingTest.replaceOwner(card), "the hand-over");
        card.power();
        ResponseAPDU after = card.send(inbox());
        assertEquals(SW_OK, after.getSW());
        assertFalse(Arrays.equals(before, after.getData()), "a new c, a new inbox");
        assertArrayEquals(derived(c(card), T0), after.getData(), "the next owner's");
        assertEquals(readUint32(before, 32), readUint32(after.getData(), 32), "the same week");

        UnitsTest.Card reset = UnitsTest.owned(UnitsTest.SAT);
        byte[] old = reset.send(inbox()).getData();
        reset.tap();
        assertEquals(SW_OK, reset.sw(new CommandAPDU(CLA, INS_RESET_CARD, 0, RESET_CONFIRM, ownerData(reset.proofFor(L_RESET, new byte[0]), new byte[0]))), "the reset");
        reset.power();
        assertEquals(SW_NO_CARD_RECORD, reset.sw(inbox()), "a reset card has no holder's record: no inbox");
        // the next holder sets it up; the clock kept its time through the reset
        assertEquals(SW_OK, reset.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        reset.pin();
        assertEquals(SW_OK, reset.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        reset.power();
        assertEquals(T0, now(reset), "the clock's time stays");
        byte[] next = reset.send(inbox()).getData();
        assertFalse(Arrays.equals(old, next), "the next holder's c, a new inbox");
        assertArrayEquals(derived(c(reset), T0), next);
    }

    @Test
    @DisplayName("A locked card answers no inbox: 6986, the word of every command a lock stops, with nothing written, with no new header, after a newer header (which a locked card still takes) and once its PIN is blocked; a P1 or P2 other than 00 is 6B00 first. A lock is the owner's word that the card is out of the holder's hands, and what waits for it goes onto no locked card, since a locked card takes no load")
    void aLockedCardAnswersNoInbox() throws Exception {
        UnitsTest.Card card = UnitsTest.owned(UnitsTest.SAT);
        card.power();
        assertEquals(SW_OK, card.sw(inbox()), "unlocked, the inbox");
        card.tap();
        assertEquals(SW_OK, card.sw(new CommandAPDU(CLA, INS_LOCK_CARD, 0, 0xDE, ownerData(card.proofFor(L_LOCK, new byte[0]), new byte[0]))), "the owner's lock");
        card.power();
        java.util.Map<String, byte[]> before = card.snapshot();
        assertEquals(SW_NOT_ALLOWED, card.sw(inbox()), "locked, with no new header");
        card.assertUnchanged(before, "a refused INBOX on a locked card");
        assertEquals(0x6B00, card.sw(new CommandAPDU(CLA, INS_INBOX, 0, 1, 256)), "P2 01, first");
        assertEquals(SW_OK, card.sw(setTimeCommand(T0 + WEEK)), "a locked card still takes a header");
        assertEquals(T0 + WEEK, now(card));
        assertEquals(SW_NOT_ALLOWED, card.sw(inbox()), "locked, the next week's header taken");
        for (int i = 0; i < 3; i++) card.sw(new CommandAPDU(CLA, INS_VERIFY_PIN, 0, 0, new byte[] { 0x39, 0x39, 0x39, 0x39 }));
        assertEquals(2, card.field("pinState")[0], "the PIN blocked");
        card.power();
        assertEquals(SW_OK, card.sw(setTimeCommand(T0 + 2 * WEEK)));
        assertEquals(SW_NOT_ALLOWED, card.sw(inbox()), "locked, its PIN blocked, a later header taken");
    }

    @Test
    @DisplayName("INBOX is refused, with nothing written, on a card with no holder's record (6A8C: out of its packet, with a PIN only, or with a factory record), and on one whose clock has taken no header (6985); P1 or P2 other than 00 is 6B00, first")
    void noRecordOrNoClockIsRefused() throws Exception {
        UnitsTest.Card fresh = new UnitsTest.Card();
        assertEquals(SW_NO_CARD_RECORD, fresh.sw(inbox()), "a card out of its packet");
        assertEquals(0x6B00, fresh.sw(new CommandAPDU(CLA, INS_INBOX, 0, 1, 256)), "P2 first");
        assertEquals(SW_OK, fresh.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        assertEquals(SW_NO_CARD_RECORD, fresh.sw(inbox()), "a PIN and no record");
        UnitsTest.Card factory = new UnitsTest.Card();
        assertEquals(SW_OK, factory.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, record("-", REFUND))), "an issuer's factory record");
        assertEquals(SW_OK, factory.sw(setTimeCommand(T0)));
        assertEquals(SW_NO_CARD_RECORD, factory.sw(inbox()), "a factory record, even with a clock");

        UnitsTest.Card noClock = new UnitsTest.Card();
        assertEquals(SW_OK, noClock.sw(new CommandAPDU(CLA, INS_SET_PIN, 0, 0, TEST_PIN)));
        noClock.pin();
        assertEquals(SW_OK, noClock.sw(new CommandAPDU(CLA, INS_SET_CARD, 0, 0, UnitsTest.recordIn(UnitsTest.SAT))));
        noClock.power();
        java.util.Map<String, byte[]> before = noClock.snapshot();
        assertEquals(SW_CONDITIONS_NOT_SATIS, noClock.sw(inbox()), "a record and no clock");
        noClock.assertUnchanged(before, "a refused INBOX");
        assertEquals(SW_OK, noClock.sw(setTimeCommand(T0)));
        assertArrayEquals(derived(c(noClock), T0), noClock.send(inbox()).getData(), "and with a header, the week of its time");
    }

    /**
     * The inbox vector, for whoever files under the name: NUT-CCP's test c and two weeks of the card's clock (T0's and the
     * next, from its first second), with the bytes hashed (the label, c, then W as four bytes, big-endian), the name and the
     * card's whole answer to `b01e000024`. Written to target/inbox-vectors.json; spec/vectors/inbox.json is one run of it,
     * kept, and must equal it, so the kept file is the card's own answer.
     */
    @Test
    @DisplayName("The inbox vector: NUT-CCP's test c and two weeks, the card's own answers (W as four bytes, big-endian, in the hash), written to target/inbox-vectors.json; spec/vectors/inbox.json is that run, kept")
    void theInboxVector() throws Exception {
        UnitsTest.Card card = UnitsTest.owned(UnitsTest.SAT);
        byte[] c = hexToBytes(V_CHAIN);
        System.arraycopy(c, 0, card.field("chain"), 0, 32);
        card.power();
        CommandAPDU command = new CommandAPDU(CLA, INS_INBOX, 0, 0, 0x24);
        assertEquals("b01e000024", toHex(command.getBytes()));
        byte[] label = "CashuCard/inbox".getBytes(StandardCharsets.US_ASCII);
        long[] times = { T0, (T0 / WEEK + 1) * WEEK };
        StringBuilder out = new StringBuilder("{\n \"label\": \"CashuCard/inbox\",\n \"c\": \"").append(V_CHAIN)
            .append("\",\n \"command\": \"").append(toHex(command.getBytes())).append("\",\n \"weeks\": [\n");
        for (int i = 0; i < times.length; i++) {
            if (i > 0) assertEquals(SW_OK, card.sw(setTimeCommand(times[i])), "a header at " + times[i]);
            assertEquals(times[i], now(card));
            ResponseAPDU r = card.send(command);
            assertEquals(SW_OK, r.getSW());
            byte[] w = u32(times[i] / WEEK);
            byte[] hashed = concat(label, c, w);
            assertArrayEquals(concat(sha256(hashed), w), r.getData(), "the card's answer is SHA-256(label || c || W) || W");
            out.append("  {\"time\": ").append(times[i]).append(", \"week\": ").append(times[i] / WEEK)
               .append(", \"W\": \"").append(toHex(w))
               .append("\",\n   \"hashed\": \"").append(toHex(hashed))
               .append("\",\n   \"name\": \"").append(toHex(sha256(hashed)))
               .append("\",\n   \"response\": \"").append(toHex(r.getData())).append("9000\"}")
               .append(i + 1 < times.length ? ",\n" : "\n");
        }
        out.append(" ]\n}\n");
        java.nio.file.Path applet = SchnorrHWMathTest.mainSourceDir().toAbsolutePath().normalize();
        while (applet != null && !applet.endsWith("applet")) applet = applet.getParent();
        org.junit.jupiter.api.Assertions.assertNotNull(applet, "the applet folder");
        java.nio.file.Files.createDirectories(applet.resolve("target"));
        java.nio.file.Files.write(applet.resolve("target").resolve("inbox-vectors.json"), out.toString().getBytes(StandardCharsets.UTF_8));
        java.nio.file.Path kept = applet.getParent().resolve("spec").resolve("vectors").resolve("inbox.json");
        org.junit.jupiter.api.Assertions.assertTrue(java.nio.file.Files.exists(kept), "spec/vectors/inbox.json is kept");
        assertEquals(out.toString(), new String(java.nio.file.Files.readAllBytes(kept), StandardCharsets.UTF_8),
            "spec/vectors/inbox.json is one run of this test, kept");
    }

    /**
     * The pickup proof, byte for byte (D199): m = SHA-256("CashuCard/pickup" || n1 || ... || nk || rand16)[0..15], the
     * nonces (32 bytes each) in the order they were loaded and 16 random bytes of the till's; the card's AUTH answer to m
     * (its 16 bytes, then a BIP-340 signature under the card key P over SHA-256(T || T || m || its 16 || P), T =
     * SHA-256("CashuCard/auth")); and the proof the till leaves, k (1) || the nonces || rand16 || the answer. Two nonces,
     * the card's own answer. The signature and the card's 16 bytes are fresh at every run, so the kept file
     * (spec/vectors/pickup.json, one run, kept) is held to the rule: its m worked out again and its signature checked under
     * its P. Its card is a stranger's to the card: AUTH wants no PIN, so the proof shows the card was there, not a load.
     */
    @Test
    @DisplayName("The pickup proof's vector: m is the first 16 bytes of SHA-256 of the label, the nonces in the order loaded and the till's 16 random bytes; the card's AUTH answer to m, with no PIN, verifies under P; written to target/pickup-vector.json; spec/vectors/pickup.json is one run, kept, and checked")
    void thePickupVector() throws Exception {
        UnitsTest.Card card = UnitsTest.owned(UnitsTest.SAT);
        card.power();
        byte[] p = card.send(new CommandAPDU(CLA, INS_GET_PUBKEY, 0, 0, 256)).getData();
        assertEquals(33, p.length, "the card key, compressed");
        byte[] n1 = sha256("CashuCard/pickup vector nonce 1".getBytes(StandardCharsets.US_ASCII));
        byte[] n2 = sha256("CashuCard/pickup vector nonce 2".getBytes(StandardCharsets.US_ASCII));
        byte[] rand16 = new byte[16];
        for (int i = 0; i < 16; i++) rand16[i] = (byte) (0xA0 + i);
        byte[] label = "CashuCard/pickup".getBytes(StandardCharsets.US_ASCII);
        byte[] m = Arrays.copyOf(sha256(concat(label, n1, n2, rand16)), 16);
        CommandAPDU auth = new CommandAPDU(CLA, INS_AUTH, 0, 0, m, 0x50);
        ResponseAPDU r = card.send(auth);
        assertEquals(SW_OK, r.getSW(), "AUTH, no PIN");
        byte[] answer = r.getData();
        assertEquals(80, answer.length);
        byte[] proof = concat(new byte[] { 2 }, n1, n2, rand16, answer);
        assertPickupProof(p, proof);
        StringBuilder out = new StringBuilder("{\n \"label\": \"CashuCard/pickup\",\n \"cardKey\": \"").append(toHex(p))
            .append("\",\n \"nonces\": [\"").append(toHex(n1)).append("\", \"").append(toHex(n2))
            .append("\"],\n \"rand16\": \"").append(toHex(rand16))
            .append("\",\n \"hashed\": \"").append(toHex(concat(label, n1, n2, rand16)))
            .append("\",\n \"m\": \"").append(toHex(m))
            .append("\",\n \"auth\": \"").append(toHex(auth.getBytes()))
            .append("\",\n \"answer\": \"").append(toHex(answer))
            .append("\",\n \"proof\": \"").append(toHex(proof)).append("\"\n}\n");
        java.nio.file.Path applet = SchnorrHWMathTest.mainSourceDir().toAbsolutePath().normalize();
        while (applet != null && !applet.endsWith("applet")) applet = applet.getParent();
        org.junit.jupiter.api.Assertions.assertNotNull(applet, "the applet folder");
        java.nio.file.Files.createDirectories(applet.resolve("target"));
        java.nio.file.Files.write(applet.resolve("target").resolve("pickup-vector.json"), out.toString().getBytes(StandardCharsets.UTF_8));
        java.nio.file.Path kept = applet.getParent().resolve("spec").resolve("vectors").resolve("pickup.json");
        org.junit.jupiter.api.Assertions.assertTrue(java.nio.file.Files.exists(kept), "spec/vectors/pickup.json is kept");
        String k = new String(java.nio.file.Files.readAllBytes(kept), StandardCharsets.UTF_8);
        byte[] keptKey = hexToBytes(field(k, "cardKey")), keptProof = hexToBytes(field(k, "proof"));
        assertPickupProof(keptKey, keptProof);
        for (String f : new String[] { "rand16", "hashed", "m", "auth" }) assertEquals(field(out.toString(), f), field(k, f), "the kept vector's " + f);
        assertEquals(toHex(concat(new byte[] { 2 }, n1, n2, rand16)), toHex(Arrays.copyOf(keptProof, 1 + 64 + 16)), "and its nonces and rand16 in its proof");
    }

    /** A pickup proof, checked as the owner checks it: m worked out from the nonces and rand16, the AUTH answer's signature under P over m. */
    static void assertPickupProof(byte[] p, byte[] proof) throws Exception {
        int k = proof[0] & 0xFF;
        assertEquals(1 + 32 * k + 16 + 80, proof.length, "k, the nonces, rand16, the answer");
        byte[] hashed = concat("CashuCard/pickup".getBytes(StandardCharsets.US_ASCII), Arrays.copyOfRange(proof, 1, 1 + 32 * k + 16));
        byte[] m = Arrays.copyOf(sha256(hashed), 16);
        byte[] answer = Arrays.copyOfRange(proof, 1 + 32 * k + 16, proof.length);
        byte[] t = sha256("CashuCard/auth".getBytes(StandardCharsets.US_ASCII));
        byte[] msg = sha256(concat(t, t, m, Arrays.copyOf(answer, 16), p));
        org.junit.jupiter.api.Assertions.assertTrue(schnorrVerify(extractPubkeyX(p), msg, Arrays.copyOfRange(answer, 16, 80)), "AUTH's signature over m, under P");
    }

    /** A string field of a flat JSON object, as these vectors write them. */
    static String field(String json, String name) {
        int at = json.indexOf("\"" + name + "\": \"");
        org.junit.jupiter.api.Assertions.assertTrue(at >= 0, name);
        int from = at + name.length() + 5;
        return json.substring(from, json.indexOf('"', from));
    }
}
