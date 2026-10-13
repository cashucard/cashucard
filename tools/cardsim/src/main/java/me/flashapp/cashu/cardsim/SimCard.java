package me.flashapp.cashu.cardsim;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import me.flashapp.cashu.CashuApplet;
import me.flashapp.cashu.Opener;
import me.flashapp.cashu.Tag;

import java.util.Arrays;

/**
 * One simulated protocol 2.0 card: the package's three applets installed into a jCardSim {@link CardSimulator} as a
 * chip has them (the opener, the card's applet, and the NFC tag under the NFC Forum's own name), driven with raw APDU
 * bytes so that the bytes the app sends are the bytes the applet sees.
 *
 * <p><b>Thread confinement.</b> jCardSim keeps the active runtime in a {@code ThreadLocal}
 * ({@code SimulatorSystem.currentRuntime}), set when the simulator is constructed. Every call on this object — the
 * constructor included — must come from the same thread. {@link CardSim} guarantees that by building it lazily inside
 * its single-thread executor.
 *
 * <p><b>SELECT starts a session.</b> The applet's PIN-verified flag, the owner's nonce and the owner's load grant are
 * {@code CLEAR_ON_DESELECT} transients, so a re-SELECT drops them, as a new NFC tap does. A fake transport sends SELECT
 * on every tap; there is no separate "tap" operation here.
 *
 * <p><b>The key is deterministic.</b> jCardSim's key generator draws from an unseeded generator, so every install —
 * every {@link #reset()} — yields the same keypair. A proof minted to this key in one run is spent at the mint after any
 * run that redeemed it. Loaders mint per run, after reading {@code pubkey} from {@link #state()}.
 */
final class SimCard {

    /** The package AID, "CASHUCARD" after F0 (D19); SELECT matches it as a prefix of the applet's. */
    static final String PACKAGE_HEX = "F0434153485543415244";
    static final String AID_HEX = PACKAGE_HEX + "01";
    static final String OPENER_HEX = PACKAGE_HEX + "4D";
    static final String TAG_HEX = "D2760000850101";
    static final byte[] SELECT = Hex.parse("00A404000A" + PACKAGE_HEX);
    /** The tag's install parameters: its instance AID's length and the AID, then no privileges and no parameters. */
    private static final byte[] TAG_INSTALL = Hex.parse("07" + TAG_HEX + "0000");

    static final int SW_OK = 0x9000;

    private static final byte[] GET_INFO = Hex.parse("B001020000");
    private static final byte[] GET_CARD = Hex.parse("B016000000");
    private static final byte[] GET_PUBKEY = Hex.parse("B010000021");
    private static final byte[] GET_BALANCE = Hex.parse("B011000004");
    private static final byte[] GET_SLOT_STATUS = Hex.parse("B014000080");
    private static final byte[] GET_NONCE = Hex.parse("B044000010");
    private static final byte[] WRONG_PIN_DEFAULT = { '0', '0', '0', '0' };
    private static final byte[] WRONG_PIN_ALT = { '9', '9', '9', '9' };

    /*
     * The applet's RandomData (the owner's nonces, AUTH's bytes, the change outputs' nonce and blinding factor, BIP-340's
     * aux randomness) is jCardSim's, which draws from a fixed seed unless told otherwise: every reset would make the same
     * change outputs, and a mint that signed them once answers "outputs already signed" to every later run. A chip's are
     * random, so the bridge's are too. The card's KEY is drawn by the key pair's own generator, which this does not
     * touch: it stays deterministic (see the class comment).
     */
    static {
        System.setProperty("com.licel.jcardsim.randomdata.secure", "1");
    }

    private CardSimulator sim;
    private long generation;
    private FixtureException fixtureError;
    /** The owner key a fixture set, so later fixtures can sign the owner's proofs; null when the card has none or a key the bridge does not hold. */
    private OwnerKey owner;

    SimCard() {
        install();
        generation = 0;
    }

    private void install() {
        sim = new CardSimulator();
        sim.installApplet(AIDUtil.create(OPENER_HEX), Opener.class);
        sim.installApplet(AIDUtil.create(AID_HEX), CashuApplet.class);
        sim.installApplet(AIDUtil.create(TAG_HEX), Tag.class, TAG_INSTALL, (short) 0, (byte) TAG_INSTALL.length);
        byte[] resp = sim.transmitCommand(SELECT);
        if (sw(resp) != SW_OK || resp.length != 4 || resp[0] != 2) {
            throw new IllegalStateException("SELECT after install answered " + Hex.format(resp) + ", not a 2.x applet");
        }
        fixtureError = null;
        owner = null;
    }

    /** A brand-new card: fresh simulator, install, SELECT. */
    void reset() {
        install();
        generation++;
    }

    long generation() {
        return generation;
    }

    /** Send raw command bytes to the card and return data‖SW. Nothing here retries: a replayed LOAD_PROOF burns a slot. */
    byte[] transmit(byte[] command) {
        if (command == null || command.length < 4) {
            throw new IllegalArgumentException("an APDU is at least CLA INS P1 P2 (4 bytes)");
        }
        return sim.transmitCommand(command);
    }

    private byte[] raw(byte[] command) {
        return sim.transmitCommand(command);
    }

    /** The card as it is, for checking a fixture before it is applied. Reads only. */
    Fixture.Context context() {
        byte[] info = data(raw(GET_INFO), "GET_INFO");
        byte[] record = data(raw(GET_CARD), "GET_CARD");
        boolean refund = false;
        for (int i = 7; i < 40; i++) if (record[i] != 0) { refund = true; break; }
        boolean owned = info[16] == 1;
        return new Fixture.Context(info[7] != 0, info[11] == 1, refund, owned, owned && owner != null);
    }

    /**
     * Apply a fixture, additively, to the current card. The order is the one the applet's gates dictate:
     * <ol>
     *   <li>SET_PIN on a card with no PIN, then VERIFY_PIN (on a card that has one, the fixture's pin is the PIN to
     *       verify); the session stays verified for the steps below;</li>
     *   <li>SET_CARD with the mint and refund key (the owner's proof where the card already has an owner);</li>
     *   <li>SET_OWNER with the key and the anchor (the old owner's proof where there is one);</li>
     *   <li>SET_HEADER for each header;</li>
     *   <li>ALLOW_LOAD (the owner's grant) and LOAD_PROOF for each piece, with P1 = 1 where it has the mint's proof;</li>
     *   <li>for each spent slot, a payment of that one piece and no outputs: SPEND_ALL_BEGIN, then SPEND_ALL_SIGN for as
     *       long as it answers "not yet". Spent on the card only: the mint still holds the piece live;</li>
     *   <li>SET_LIMIT, thirteen bytes, under the owner's proof;</li>
     *   <li>three wrong VERIFY_PINs when blockedPin, expecting 63C2, 63C1, 6983;</li>
     *   <li>SELECT, so the app's first command finds a fresh session.</li>
     * </ol>
     * The generation moves on success and on failure. A refused step leaves the card as the steps before it left it,
     * with {@code fixtureError} set until the next fixture or reset.
     */
    void applyFixture(Fixture f) throws FixtureException {
        generation++;
        fixtureError = null;
        try {
            if (f.pin != null) {
                // the PIN is set on a card that has none, and on a card that has one it is the PIN to verify
                if (data(raw(GET_INFO), "GET_INFO")[7] == 0) expect("SET_PIN", apdu(0x41, 0, 0, f.pin, -1), SW_OK);
                expect("VERIFY_PIN", apdu(0x40, 0, 0, f.pin, -1), SW_OK);
            }
            if (f.mint != null) {
                byte[] record = new byte[1 + 33 + 65 + 1 + f.mint.length];
                if (f.refundKey != null) System.arraycopy(f.refundKey, 0, record, 1, 33);
                record[99] = (byte) f.mint.length;
                System.arraycopy(f.mint, 0, record, 100, f.mint.length);
                if (owner != null) {
                    expect("SET_CARD", apdu(0x32, 0, 0, owner.data("CashuCard/set-card", nonce(), record), -1), SW_OK);
                } else {
                    expect("SET_CARD", apdu(0x32, 0, 0, record, -1), SW_OK);
                }
            }
            if (f.owner != null) {
                byte[] value = f.anchor == null ? f.owner.pub : concat(f.owner.pub, f.anchor);
                if (owner != null) {
                    expect("SET_OWNER", apdu(0x43, 0, 0, owner.data("CashuCard/set-owner", nonce(), value), -1), SW_OK);
                } else {
                    expect("SET_OWNER", apdu(0x43, 0, 0, value, -1), SW_OK);
                }
                owner = f.owner;
            }
            for (byte[] header : f.headers) {
                expect("SET_HEADER", apdu(0x36, 0, 0, header, 0x04), SW_OK);
            }
            int[] slotOf = new int[f.proofs.size()];
            if (!f.proofs.isEmpty()) {
                expect("ALLOW_LOAD", apdu(0x45, 0, 0, owner.data("CashuCard/load", nonce(), new byte[0]), -1), SW_OK);
                for (int i = 0; i < f.proofs.size(); i++) {
                    Fixture.Proof p = f.proofs.get(i);
                    byte[] resp = expect("LOAD_PROOF", apdu(0x30, p.dleq != null ? 1 : 0, 0, p.payload(), p.dleq != null ? 0x02 : 0x01), SW_OK);
                    slotOf[i] = resp[0] & 0xFF;
                }
            }
            for (int idx : f.spentSlots) {
                expect("SPEND_ALL_BEGIN", apdu(0x22, 0, 0, new byte[] { (byte) slotOf[idx] }, 0x04), SW_OK);
                byte[] signed;
                int waits = 0;
                do {
                    signed = expect("SPEND_ALL_SIGN", apdu(0x24, 0, 0, null, 0x40), SW_OK);
                } while (signed.length == 4 && ++waits < 2000);
            }
            if (f.limits != null) {
                expect("SET_LIMIT", apdu(0x34, 0, 0, owner.data("CashuCard/set-limit", nonce(), f.limits.value()), -1), SW_OK);
            }
            if (f.blockedPin) {
                byte[] wrong = Arrays.equals(f.pin, WRONG_PIN_DEFAULT) ? WRONG_PIN_ALT : WRONG_PIN_DEFAULT;
                expect("VERIFY_PIN", apdu(0x40, 0, 0, wrong, -1), 0x63C2);
                expect("VERIFY_PIN", apdu(0x40, 0, 0, wrong, -1), 0x63C1);
                expect("VERIFY_PIN", apdu(0x40, 0, 0, wrong, -1), 0x6983);
            }
            expect("SELECT", SELECT, SW_OK);
        } catch (FixtureException e) {
            fixtureError = e;
            throw e;
        }
    }

    private byte[] nonce() throws FixtureException {
        byte[] resp = expect("GET_NONCE", GET_NONCE, SW_OK);
        return Arrays.copyOf(resp, 16);
    }

    private byte[] expect(String step, byte[] command, int expectedSw) throws FixtureException {
        byte[] resp = raw(command);
        int sw = sw(resp);
        if (sw != expectedSw) throw new FixtureException(step, sw);
        return resp;
    }

    /**
     * The card as the applet reports it, through reads that need no PIN and change nothing (GET_INFO P1 = 2, GET_CARD,
     * GET_PUBKEY, GET_BALANCE, GET_SLOT_STATUS, and GET_PROOF and GET_DLEQ for each slot that is not empty). Reading never
     * touches the session.
     */
    JsonObject state() {
        JsonObject s = new JsonObject();
        s.addProperty("generation", generation);
        s.addProperty("deterministicKey", true);

        byte[] info = data(raw(GET_INFO), "GET_INFO");
        byte[] record = data(raw(GET_CARD), "GET_CARD");
        byte[] pubkey = data(raw(GET_PUBKEY), "GET_PUBKEY");
        byte[] balance = data(raw(GET_BALANCE), "GET_BALANCE");
        byte[] status = data(raw(GET_SLOT_STATUS), "GET_SLOT_STATUS");

        s.addProperty("version", (info[0] & 0xFF) + "." + (info[1] & 0xFF));
        s.addProperty("pubkey", Hex.formatLower(pubkey));
        s.addProperty("balance", readUint32(balance, 0));
        s.addProperty("pinState", info[7] & 0xFF);
        s.addProperty("tries", info[9] & 0xFF);
        s.addProperty("locked", info[10] == 1);
        s.addProperty("hasOwner", info[16] == 1);
        if (info[16] == 1 && owner != null) s.addProperty("ownerKey", Hex.formatLower(owner.pub));
        s.addProperty("testOwner", owner == OwnerKey.TEST);
        s.addProperty("recordSet", info[11] == 1);
        int mintLen = record[105] & 0xFF;
        if (info[11] == 1) s.addProperty("mint", new String(record, 106, mintLen, java.nio.charset.StandardCharsets.US_ASCII));
        s.addProperty("now", readUint32(info, 17));
        s.addProperty("windowStart", readUint32(info, 21));
        s.addProperty("spentToday", readUint32(info, 25));
        s.addProperty("dailyLimit", readUint32(info, 12));
        s.addProperty("allowance", readUint32(info, 34));
        s.addProperty("nopinSpent", readUint32(info, 38));
        s.addProperty("rolls", record[76] & 0xFF);
        int budget = record[77] & 0xFF;
        s.addProperty("rollBudget", budget == 0 ? Fixture.ROLL_BUDGET_DEFAULT : budget);
        s.addProperty("allowanceArmed", record[78] == 1);
        s.addProperty("lastHeader", Hex.formatLower(record, 44, 32));

        // GET_INFO bytes 3-5 (CashuApplet.processGetInfo): the applet's own tally.
        JsonObject counts = new JsonObject();
        counts.addProperty("unspent", info[3] & 0xFF);
        counts.addProperty("spent", info[4] & 0xFF);
        counts.addProperty("empty", info[5] & 0xFF);
        s.add("counts", counts);

        JsonArray slots = new JsonArray();
        for (int i = 0; i < status.length; i++) {
            JsonObject slot = new JsonObject();
            slot.addProperty("slot", i);
            slot.addProperty("status", statusName(status[i]));
            if (status[i] != 0) {
                byte[] p = data(raw(apdu(0x13, i, 0, null, 0x52)), "GET_PROOF");
                slot.addProperty("keysetId", Hex.formatLower(p, 1, 8));
                slot.addProperty("amount", readUint32(p, 9));
                slot.addProperty("nonce", Hex.formatLower(p, 13, 32));
                slot.addProperty("C", Hex.formatLower(p, 45, 33));
                slot.addProperty("date", readUint32(p, 78));
                byte[] dleq = data(raw(apdu(0x1A, i, 0xFF, null, 0x00)), "GET_DLEQ");
                if (dleq.length == 97 && dleq[0] == 1) {
                    JsonObject d = new JsonObject();
                    d.addProperty("e", Hex.formatLower(dleq, 1, 32));
                    d.addProperty("s", Hex.formatLower(dleq, 33, 32));
                    d.addProperty("r", Hex.formatLower(dleq, 65, 32));
                    slot.add("dleq", d);
                }
            }
            slots.add(slot);
        }
        s.add("slots", slots);

        if (fixtureError != null) {
            JsonObject err = new JsonObject();
            err.addProperty("step", fixtureError.step);
            err.addProperty("sw", Hex.sw(fixtureError.sw));
            s.add("fixtureError", err);
        }
        return s;
    }

    static String statusName(byte b) {
        switch (b) {
            case 0: return "empty";
            case 1: return "unspent";
            case 2: return "spent";
            default: return "unknown(" + (b & 0xFF) + ")";
        }
    }

    private static byte[] data(byte[] resp, String what) {
        if (sw(resp) != SW_OK) {
            throw new IllegalStateException(what + " answered " + Hex.sw(sw(resp)));
        }
        return Arrays.copyOf(resp, resp.length - 2);
    }

    static int sw(byte[] resp) {
        if (resp == null || resp.length < 2) throw new IllegalStateException("response shorter than a status word");
        return ((resp[resp.length - 2] & 0xFF) << 8) | (resp[resp.length - 1] & 0xFF);
    }

    static long readUint32(byte[] b, int off) {
        return ((long) (b[off] & 0xFF) << 24) | ((long) (b[off + 1] & 0xFF) << 16)
             | ((long) (b[off + 2] & 0xFF) << 8) | (long) (b[off + 3] & 0xFF);
    }

    static byte[] concat(byte[] a, byte[] b) {
        byte[] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    /** CLA B0 ‖ INS ‖ P1 ‖ P2 [‖ Lc ‖ data] [‖ Le]; {@code le < 0} means no Le. */
    static byte[] apdu(int ins, int p1, int p2, byte[] data, int le) {
        int len = 4 + (data != null && data.length > 0 ? 1 + data.length : 0) + (le >= 0 ? 1 : 0);
        byte[] out = new byte[len];
        out[0] = (byte) 0xB0;
        out[1] = (byte) ins;
        out[2] = (byte) p1;
        out[3] = (byte) p2;
        int i = 4;
        if (data != null && data.length > 0) {
            out[i++] = (byte) data.length;
            System.arraycopy(data, 0, out, i, data.length);
            i += data.length;
        }
        if (le >= 0) out[i] = (byte) le;
        return out;
    }
}
