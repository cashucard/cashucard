package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * D20 (fix 4a): the clock walk.
 *
 * In 1.20 a terminal that holds the PIN can bring a block header a day later than the card's clock, and every such
 * header begins a new day and a new daily limit. Real headers come once a day for free (the network makes them), so a
 * till kept the card's PIN and a phone's worth of headers takes a limit a day for as long as it holds the card, and a
 * no-PIN reader takes the no-PIN allowance a day. 2.0 bounds both: the window rolls at most `rollBudget` times between
 * the owner's REFRESHes (default 7), the allowance begins again only once per arming (a PIN or an owner's proof), and a
 * card whose owner was set with a header never runs at now = 0.
 *
 * Every header here is a real mainnet header (spec/vectors/headers.json), held to the floor built into the applet:
 * nothing a test mines is accepted, which is the point.
 */
class ClockWalkTest {

    static final byte CLA = CashuAppletTest.CLA;
    static final int SW_OK = CashuAppletTest.SW_OK;
    static final byte INS_REFRESH = 0x53;

    /** The mainnet headers, oldest first, and their times. */
    static final List<byte[]> H = new ArrayList<>();
    static final List<Long> T = new ArrayList<>();

    @BeforeAll
    static void readTheHeaders() throws Exception {
        if (!H.isEmpty()) return;
        String json = new String(Files.readAllBytes(headersJson()), StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\"time\": (\\d+), \"bits\": \"([0-9a-f]{8})\", \"header\": \"([0-9a-f]{160})\"").matcher(json);
        while (m.find()) {
            byte[] h = CashuAppletTest.hexToBytes(m.group(3));
            assertEquals(Long.parseLong(m.group(1)), CashuAppletTest.readUint32(CashuAppletTest.reversed(Arrays.copyOfRange(h, 68, 72)), 0), "the time is the header's");
            H.add(h);
            T.add(Long.parseLong(m.group(1)));
        }
        assertEquals(12, H.size(), "twelve headers in spec/vectors/headers.json");
        for (int i = 1; i < T.size(); i++) assertTrue(T.get(i) - T.get(i - 1) >= CashuAppletTest.DAY, "header " + i + " is more than a day after the one before");
    }

    static Path headersJson() throws java.io.IOException {
        Path p = SchnorrHWMathTest.mainSourceDir().toAbsolutePath().normalize();
        for (int i = 0; i < 7; i++) p = p.getParent();   // <repo>/applet/src/main/java/me/flashapp/cashu -> <repo>
        return p.resolve("spec").resolve("vectors").resolve("headers.json");
    }

    private CardSimulator sim;

    @BeforeEach
    void install() {
        CashuAppletTest.useTheRealFloor();
        sim = new CardSimulator(new CashuAppletTest.ExposedRuntime());
        sim.installApplet(AIDUtil.create(CashuAppletTest.AID_HEX), CashuApplet.class);
        assertEquals(SW_OK, select());
    }

    @AfterEach
    void putTheFloorBack() {
        CashuAppletTest.useFloor(CashuAppletTest.BUILT_FLOOR);
    }

    // ---- what a terminal and a phone send ----------------------------------------------------------------------------

    private ResponseAPDU send(CommandAPDU c) { return sim.transmitCommand(c); }
    private int sw(CommandAPDU c) { return send(c).getSW(); }
    private int select() { return sw(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(CashuAppletTest.AID_STR))); }
    /** A new tap: out of the field and back, selected, nothing verified. */
    private void newTap() { sim.reset(); assertEquals(SW_OK, select()); }
    private int verify() { return sw(new CommandAPDU(CLA, CashuAppletTest.INS_VERIFY_PIN, 0, 0, CashuAppletTest.TEST_PIN)); }
    private byte[] nonce() {
        ResponseAPDU r = send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16));
        assertEquals(SW_OK, r.getSW());
        return r.getData();
    }
    private int setHeader(byte[] h) { return sw(CashuAppletTest.setHeaderCommand(h)); }
    private byte[] info() { return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_INFO, 0, 0, 256)).getData(); }
    private long now() { return CashuAppletTest.readUint32(info(), 17); }
    private byte[] card() { return send(new CommandAPDU(CLA, CashuAppletTest.INS_GET_CARD, 0, 0, 256)).getData(); }
    /** GET_CARD's bytes 76, 77, 78 (2.0): rolls since the owner's REFRESH, the budget (0: 7), armed. */
    private int rolls() { return card()[76] & 0xFF; }
    private int budget() { return card()[77] & 0xFF; }
    private int armed() { return card()[78] & 0xFF; }

    /** SET_LIMIT, the owner's form, thirteen bytes: the day's limit, the limit on one payment, the no-PIN allowance, the rollover budget. */
    private int setLimits(long day, long allowance, int budget) {
        byte[] value = CashuAppletTest.concat(CashuAppletTest.u32(day), CashuAppletTest.u32(0), CashuAppletTest.u32(allowance), new byte[] { (byte) budget });
        return sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_LIMIT_OWNER, 0, 0,
            CashuAppletTest.ownerData(CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), value), value)));
    }

    /** REFRESH by `key`, its proof made over `signed` and the command carrying `sent`. */
    private int refresh(CashuAppletTest.Key key, byte[] signed, byte[] sent) {
        byte[] proof = CashuAppletTest.ownerProof("CashuCard/refresh", key, nonce(), signed);
        return sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0, CashuAppletTest.ownerData(proof, sent), 4));
    }
    private int refresh(byte[] header) { return refresh(CashuAppletTest.OWNER, header, header); }

    private int allowLoad() {
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LOAD, CashuAppletTest.OWNER, nonce(), new byte[0]);
        return sw(new CommandAPDU(CLA, CashuAppletTest.INS_ALLOW_LOAD, 0, 0, CashuAppletTest.ownerData(proof, new byte[0])));
    }

    /** A payment of the piece in `slot` and no outputs, waited out if the card makes it wait. The status that ended it. */
    private int pay(int slot) {
        ResponseAPDU r = send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_BEGIN, 0, 0, new byte[] { (byte) slot }, 4));
        if (r.getSW() != SW_OK) return r.getSW();
        for (int i = 0; i <= CashuAppletTest.WAITS_MOST; i++) {
            r = send(new CommandAPDU(CLA, CashuAppletTest.INS_SPEND_ALL_SIGN, 0, 0, 64));
            if (!(r.getSW() == SW_OK && r.getData().length == 2)) return r.getSW();
        }
        fail("a payment that never stops waiting");
        return -1;
    }

    /**
     * A card set up as flash-mobile sets one up in 2.0: a PIN, the record, then the owner with the tip header it has seen (the
     * anchor), then the limits with a rollover budget. `pieces` pieces of `amount`, loaded under the PIN. The PIN is left
     * verified.
     */
    private void setUp(int anchorAt, long day, long allowance, int budget, int pieces, long amount) {
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_PIN, 0, 0, CashuAppletTest.TEST_PIN)));
        assertEquals(SW_OK, verify());
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_CARD, 0, 0, CashuAppletTest.record(CashuAppletTest.MINT, CashuAppletTest.REFUND))));
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.concat(CashuAppletTest.OWNER.pub, H.get(anchorAt)))), "SET_OWNER with the anchor");
        assertEquals(T.get(anchorAt).longValue(), now(), "the clock at the anchor");
        assertEquals(SW_OK, setLimits(day, allowance, budget));
        for (int i = 0; i < pieces; i++) {
            assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.buildProof(CashuAppletTest.KEYSET, amount, 100 + i), 1)), "piece " + i);
        }
    }

    /** What a terminal that holds the PIN does at a header: it brings the header, types the PIN and pays with pieces until the card refuses. The pieces it got. */
    private int pinScriptAt(byte[] header, int[] next) {
        newTap();
        assertEquals(SW_OK, setHeader(header));
        int got = 0;
        while (next[0] < 12) {
            newTap();
            assertEquals(SW_OK, verify());
            int r = pay(next[0]);
            if (r != SW_OK) {
                assertEquals(CashuAppletTest.SW_OVER_LIMIT, r, "refused for the day's limit, and nothing else");
                break;
            }
            next[0]++;
            got++;
        }
        return got;
    }

    // ---- the rollover budget -------------------------------------------------------------------------------------------

    @Test
    @DisplayName("R = 2: a terminal with the PIN that walks the card along ten real headers, a day apart, gets three days' limits (the one it found and two rolls), not eleven")
    void aPinScriptGetsTheBudgetAndNoMore() {
        setUp(0, 100, 0, 2, 12, 100);
        assertEquals(2, budget());
        int[] next = { 0 };
        int got = pinScriptAt(H.get(0), next);
        assertEquals(1, got, "the day the card was found: one limit");
        for (int i = 1; i <= 10; i++) got += pinScriptAt(H.get(i), next);
        assertEquals(3, got, "the found day and two rolls: 300 sats of 1,200, where 1.20 gave 1,100");
        assertEquals(2, rolls(), "the budget spent");
        assertEquals(T.get(10).longValue(), now(), "the clock did move: only the window stood still");
    }

    @Test
    @DisplayName("the default budget is seven: an owner's budget of 2 set back by a twelve-byte SET_LIMIT (absent means 7) rolls seven times along the walk and no more")
    void theDefaultBudgetIsSeven() {
        setUp(0, 100, 0, 2, 12, 100);
        assertEquals(2, budget());
        // a twelve-byte SET_LIMIT (a 1.x wallet's) sets the budget back to its default: 0 on the card, which it reads as 7
        byte[] twelve = CashuAppletTest.concat(CashuAppletTest.u32(100), CashuAppletTest.u32(0), CashuAppletTest.u32(0));
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_LIMIT_OWNER, 0, 0,
            CashuAppletTest.ownerData(CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), twelve), twelve))));
        assertEquals(0, budget(), "a form without the byte sets the budget back to the default (architect's decision 2: absent means 7)");
        int[] next = { 0 };
        int got = 0;
        for (int i = 0; i <= 10; i++) got += pinScriptAt(H.get(i), next);
        assertEquals(8, got, "the found day and seven rolls, not the owner's earlier two");
        assertEquals(7, rolls());
    }

    @Test
    @DisplayName("absent means 7: the 4-, 8- and 12-byte owner's SET_LIMIT each set a budget of 5 back to the default; the 13-byte form sets what it carries")
    void aFormWithoutTheByteSetsTheBudgetBackToSeven() {
        setUp(0, 100, 0, 5, 0, 0);
        byte[][] forms = {
            CashuAppletTest.u32(100),
            CashuAppletTest.concat(CashuAppletTest.u32(100), CashuAppletTest.u32(0)),
            CashuAppletTest.concat(CashuAppletTest.u32(100), CashuAppletTest.u32(0), CashuAppletTest.u32(0)),
        };
        for (byte[] value : forms) {
            assertEquals(SW_OK, setLimits(100, 0, 5));
            assertEquals(5, budget());
            assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_LIMIT_OWNER, 0, 0,
                CashuAppletTest.ownerData(CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), value), value))), value.length + " bytes");
            assertEquals(0, budget(), value.length + " bytes: the budget is the default again (0 on the card, read as 7)");
        }
        assertEquals(SW_OK, setLimits(100, 0, 12));
        assertEquals(12, budget(), "thirteen bytes: the budget given");
    }

    @Test
    @DisplayName("a card set up with no budget byte reads budget 0, which is seven")
    void aCardWithNoBudgetByteHasSeven() {
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_PIN, 0, 0, CashuAppletTest.TEST_PIN)));
        assertEquals(SW_OK, verify());
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_CARD, 0, 0, CashuAppletTest.record(CashuAppletTest.MINT, CashuAppletTest.REFUND))));
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.concat(CashuAppletTest.OWNER.pub, H.get(0)))));
        byte[] four = CashuAppletTest.u32(100);
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_LIMIT_OWNER, 0, 0,
            CashuAppletTest.ownerData(CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), four), four))));
        assertEquals(0, budget(), "never given: 0, which the card reads as 7");
        for (int i = 0; i < 12; i++) {
            assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 100, 100 + i), 1)));
        }
        int[] next = { 0 };
        int got = 0;
        for (int i = 0; i <= 10; i++) got += pinScriptAt(H.get(i), next);
        assertEquals(8, got, "seven rolls");
    }

    @Test
    @DisplayName("the budget byte is 1 to 30: 0 and 31 are 6A80 and change nothing; 1 and 30 are taken")
    void theBudgetIsOneToThirty() {
        setUp(0, 100, 0, 5, 0, 0);
        assertEquals(CashuAppletTest.SW_WRONG_DATA, setLimits(100, 0, 0), "0");
        assertEquals(CashuAppletTest.SW_WRONG_DATA, setLimits(100, 0, 31), "31");
        assertEquals(5, budget(), "unchanged");
        assertEquals(SW_OK, setLimits(100, 0, 1));
        assertEquals(1, budget());
        assertEquals(SW_OK, setLimits(100, 0, 30));
        assertEquals(30, budget());
        // the PIN form (an open card's) has no budget: 4 or 8 bytes, as in 1.20
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_LIMIT, 0, 0, CashuAppletTest.u32(5))), "an owned card refuses the PIN form");
    }

    // ---- REFRESH --------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("REFRESH with the tip fills the budget again: the walk that stood still rolls once more, and the header moves the clock")
    void refreshResetsTheBudget() {
        setUp(0, 100, 0, 2, 12, 100);
        int[] next = { 0 };
        int got = 0;
        for (int i = 0; i <= 9; i++) got += pinScriptAt(H.get(i), next);
        assertEquals(3, got);
        assertEquals(2, rolls());
        newTap();
        assertEquals(SW_OK, refresh(H.get(10)), "the owner's phone, online, with the tip");
        assertEquals(0, rolls(), "the budget is full");
        assertEquals(T.get(10).longValue(), now(), "and the clock is the tip's");
        newTap();
        assertEquals(SW_OK, verify());
        assertEquals(SW_OK, pay(next[0]++), "the window rolls again");
        assertEquals(1, rolls());
    }

    @Test
    @DisplayName("REFRESH with an older header than the clock still fills the budget, and leaves the clock where it was; it answers the clock")
    void refreshWithAnOldHeader() {
        setUp(5, 100, 0, 2, 0, 0);
        int[] next = { 0 };
        // spend the budget: three days at headers 5, 6, 7 (no pieces: the window turns at a payment only, so load some)
        newTap();
        assertEquals(SW_OK, verify());
        for (int i = 0; i < 4; i++) assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 100, 200 + i), 1)));
        int got = 0;
        for (int i = 5; i <= 8; i++) got += pinScriptAt(H.get(i), next);
        assertEquals(3, got);
        newTap();
        ResponseAPDU r = send(new CommandAPDU(CLA, INS_REFRESH, 0, 0,
            CashuAppletTest.ownerData(CashuAppletTest.ownerProof("CashuCard/refresh", CashuAppletTest.OWNER, nonce(), H.get(2)), H.get(2)), 4));
        assertEquals(SW_OK, r.getSW());
        assertEquals(T.get(8).longValue(), CashuAppletTest.readUint32(r.getData(), 0), "the answer is the clock, which an older header does not move");
        assertEquals(0, rolls());
    }

    @Test
    @DisplayName("a bad REFRESH changes nothing: another key's proof, a proof over another header, a header without the work (genesis, under the floor), a header with its work broken, a wrong length, and no nonce")
    void aBadRefreshChangesNothing() {
        setUp(0, 100, 0, 2, 12, 100);
        int[] next = { 0 };
        for (int i = 0; i <= 3; i++) pinScriptAt(H.get(i), next);
        assertEquals(2, rolls());
        newTap();
        byte[] before = card();
        long clock = now();
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, refresh(CashuAppletTest.OTHER_OWNER, H.get(10), H.get(10)), "another key");
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, refresh(CashuAppletTest.OWNER, H.get(9), H.get(10)), "a proof over another header");
        byte[] genesis = CashuAppletTest.hexToBytes(CashuAppletTest.GENESIS);
        assertEquals(CashuAppletTest.SW_LITTLE_WORK, refresh(genesis), "genesis: far under the floor");
        byte[] broken = H.get(10).clone();
        broken[79] ^= 1;   // the nonce changed: the hash is no longer under the target
        assertEquals(CashuAppletTest.SW_LITTLE_WORK, refresh(broken), "a header whose work is broken");
        byte[] shortH = Arrays.copyOf(H.get(10), 79);
        assertEquals(CashuAppletTest.SW_WRONG_LENGTH, refresh(shortH), "79 bytes");
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0,
            CashuAppletTest.ownerData(CashuAppletTest.ownerProof("CashuCard/refresh", CashuAppletTest.OWNER, new byte[16], H.get(10)), H.get(10)), 4)),
            "no nonce given in this tap");
        assertArrayEquals(before, card(), "the record, the clock's proof, the rolls and the budget are as they were");
        assertEquals(clock, now());
        assertEquals(2, rolls());
        newTap();
        assertEquals(SW_OK, verify());
        assertEquals(CashuAppletTest.SW_OVER_LIMIT, pay(next[0]), "and the window still stands");
    }

    @Test
    @DisplayName("REFRESH needs an owner: 6A90 on an open card; its proof is under its own label, so a proof made for SET_HEADER's sake under another label is 6A91")
    void refreshNeedsTheOwner() {
        assertEquals(CashuAppletTest.SW_NO_OWNER, sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0, CashuAppletTest.ownerData(new byte[8], H.get(0)), 4)));
        setUp(0, 100, 0, 2, 0, 0);
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_LIMIT, CashuAppletTest.OWNER, nonce(), H.get(1));
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, sw(new CommandAPDU(CLA, INS_REFRESH, 0, 0, CashuAppletTest.ownerData(proof, H.get(1)), 4)));
        assertEquals(T.get(0).longValue(), now());
    }

    // ---- the armed allowance --------------------------------------------------------------------------------------------

    @Test
    @DisplayName("a no-PIN reader gets one allowance per re-arm: the allowance begins again at a roll only after a PIN or an owner's proof, and the arming is spent by the roll")
    void aNoPinReaderGetsOneAllowancePerArming() {
        setUp(0, 0, 100, 30, 12, 100);
        assertEquals(1, armed(), "armed by the PIN typed at set-up and the owner's proof");
        int slot = 0;
        newTap();
        assertEquals(SW_OK, pay(slot++), "no PIN, within the allowance: the first window begins");
        newTap();
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(slot), "the allowance spent");
        // day 1: the window rolls, armed: the allowance begins again, and the arming is spent
        newTap();
        assertEquals(SW_OK, setHeader(H.get(1)));
        assertEquals(SW_OK, pay(slot++), "a new day, armed: a new allowance");
        assertEquals(0, armed(), "the roll spent the arming");
        // days 2 and 3: the window rolls, not armed: what was counted stays counted
        for (int d = 2; d <= 3; d++) {
            newTap();
            assertEquals(SW_OK, setHeader(H.get(d)));
            assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(slot), "day " + d + ": not armed, no new allowance");
        }
        // the holder types the PIN once (nothing paid): armed
        newTap();
        assertEquals(SW_OK, verify());
        assertEquals(1, armed(), "a PIN arms it");
        newTap();
        assertEquals(SW_OK, setHeader(H.get(4)));
        assertEquals(SW_OK, pay(slot++), "day 4: armed by the PIN, a new allowance");
        newTap();
        assertEquals(SW_OK, setHeader(H.get(5)));
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(slot), "day 5: spent again");
        // the owner's phone (any owner's proof) arms it as well
        newTap();
        assertEquals(SW_OK, allowLoad());
        assertEquals(1, armed(), "an owner's proof arms it");
        newTap();
        assertEquals(SW_OK, setHeader(H.get(6)));
        assertEquals(SW_OK, pay(slot++), "day 6: armed by the owner");
    }

    @Test
    @DisplayName("a wrong PIN and a wrong owner's proof arm nothing")
    void failuresArmNothing() {
        setUp(0, 0, 100, 30, 4, 100);
        newTap();
        assertEquals(SW_OK, pay(0));
        newTap();
        assertEquals(SW_OK, setHeader(H.get(1)));
        assertEquals(SW_OK, pay(1), "the arming from set-up, spent");
        assertEquals(0, armed());
        newTap();
        assertEquals(0x63C2, sw(new CommandAPDU(CLA, CashuAppletTest.INS_VERIFY_PIN, 0, 0, CashuAppletTest.WRONG_PIN)));
        assertEquals(CashuAppletTest.SW_OWNER_PROOF, refresh(CashuAppletTest.OTHER_OWNER, H.get(2), H.get(2)));
        assertEquals(0, armed(), "neither armed it");
        newTap();
        assertEquals(SW_OK, setHeader(H.get(2)));
        assertEquals(CashuAppletTest.SW_PIN_NEEDED, pay(2));
    }

    // ---- the anchor ---------------------------------------------------------------------------------------------------------

    @Test
    @DisplayName("an anchored owner: the clock is the header's from SET_OWNER on, never 0; older headers move nothing; a header without the work refuses the owner too")
    void theAnchor() {
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_PIN, 0, 0, CashuAppletTest.TEST_PIN)));
        assertEquals(SW_OK, verify());
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_CARD, 0, 0, CashuAppletTest.record(CashuAppletTest.MINT, CashuAppletTest.REFUND))));
        assertEquals(0, now(), "a card that has seen no header");
        byte[] genesis = CashuAppletTest.hexToBytes(CashuAppletTest.GENESIS);
        assertEquals(CashuAppletTest.SW_LITTLE_WORK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.concat(CashuAppletTest.OWNER.pub, genesis))),
            "an anchor without the work");
        assertEquals(0, info()[16], "and no owner: nothing was written");
        assertEquals(0, now());
        assertEquals(CashuAppletTest.SW_WRONG_LENGTH, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0,
            CashuAppletTest.concat(CashuAppletTest.OWNER.pub, Arrays.copyOf(H.get(5), 79)))), "a key and 79 bytes");
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.concat(CashuAppletTest.OWNER.pub, H.get(5)))));
        assertEquals(1, info()[16], "owned");
        assertEquals(T.get(5).longValue(), now(), "the clock is the anchor's");
        assertNotEquals(0, now(), "an owned card set up so never runs at now = 0");
        assertEquals(CashuAppletTest.blockHash(H.get(5)), CashuAppletTest.toHex(Arrays.copyOfRange(card(), 44, 76)), "and the anchor is the last header taken");
        for (int i = 0; i < 5; i++) {
            assertEquals(SW_OK, setHeader(H.get(i)), "header " + i + ", older: answered, as SET_HEADER answers an old header");
            assertEquals(T.get(5).longValue(), now(), "and the clock does not go back");
        }
        assertEquals(CashuAppletTest.SW_LITTLE_WORK, setHeader(genesis));
        assertEquals(SW_OK, setHeader(H.get(6)));
        assertEquals(T.get(6).longValue(), now(), "a later one moves it, as ever");
    }

    @Test
    @DisplayName("a new owner set with an anchor, by the old owner's proof, takes the header too; without one, SET_OWNER is 1.20's and the clock is left as it was")
    void anAnchorOnAChangeOfOwner() {
        setUp(3, 0, 0, 7, 0, 0);
        byte[] value = CashuAppletTest.concat(CashuAppletTest.OTHER_OWNER.pub, H.get(6));
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_OWNER, CashuAppletTest.OWNER, nonce(), value);
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.ownerData(proof, value))));
        assertEquals(T.get(6).longValue(), now());
        byte[] plain = CashuAppletTest.OWNER.pub;
        byte[] back = CashuAppletTest.ownerProof(CashuAppletTest.L_OWNER, CashuAppletTest.OTHER_OWNER, nonce(), plain);
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.ownerData(back, plain))), "65 bytes: no anchor");
        assertEquals(T.get(6).longValue(), now(), "the clock as it was");
    }

    @Test
    @DisplayName("an unanchored owner is 1.20's: the clock stays 0 until a header comes, and the card spends its first day on trust")
    void withoutAnAnchorTheCardIsAsBefore() {
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_PIN, 0, 0, CashuAppletTest.TEST_PIN)));
        assertEquals(SW_OK, verify());
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_CARD, 0, 0, CashuAppletTest.record(CashuAppletTest.MINT, CashuAppletTest.REFUND))));
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_SET_OWNER, 0, 0, CashuAppletTest.OWNER.pub)));
        assertEquals(0, now());
        assertEquals(SW_OK, setLimits(100, 0, 7));
        assertEquals(SW_OK, sw(new CommandAPDU(CLA, CashuAppletTest.INS_LOAD_PROOF, 0, 0, CashuAppletTest.buildProof(CashuAppletTest.KEYSET, 100, 1), 1)));
        assertEquals(SW_OK, pay(0), "a first day on trust, as 1.20 had it");
    }
}
