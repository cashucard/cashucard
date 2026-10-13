import javax.smartcardio.Card;
import javax.smartcardio.CardChannel;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.TerminalFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;

/**
 * Software 1.20 on the chip: the store of the mint's proofs, which the first SET_CARD reserves and the constructor does not.
 *
 * The chip refuses to install an applet whose constructor asks for 12,288 bytes more than 1.19's, and no simulator has that
 * limit, so the one thing the suite cannot show is that the card gives the bytes when SET_CARD asks for them after the install.
 * This is a short run that shows it, on the card itself, by what a phone would see:
 *
 *   select; GET_INFO in its three forms (30, 42 and 43 bytes) and the version 01 14;
 *   GET_DLEQ before any SET_CARD (00, no exception);
 *   set up as a phone does, the owner last: SET_CARD, the command that reserves the store (its time is printed), then SET_OWNER;
 *   one piece loaded WITH a proof (LOAD_PROOF, P1 = 1), read back (01 and the 96 bytes);
 *   another loaded plain, read back (00); two places in one GET_DLEQ; the refusals (a proof of zeros, a wrong length);
 *   both paid in one payment (the chip signs), then GET_DLEQ for the spent places (00) and CLEAR_SPENT;
 *   a plain piece into the freed place reads 00, and not the proof the place held before;
 *   RESET_CARD by the owner's proof (the store zeroed on the chip), and the card is blank again.
 *
 * It makes up an owner key of its own and uses it once; nothing is kept. It ends with the card blank and holding nothing, but it
 * refuses to begin on a card that is not blank (an owner, a record or any piece), so it cannot disturb a card in use. A run that
 * stops part way leaves test pieces on the card: install the software again (~/.foxycard/install-1.20.sh refuses a card that
 * holds money; the wipe in ~/.foxycard/chip-test.sh does not).
 *
 *   sh tools/chip/proofstore.sh                 the card in the reader, by PC/SC
 *   sh tools/chip/proofstore.sh 127.0.0.1:47470 a card behind a bridge or the simulator's server (tools/chip/run.sh, tools/cardsim/run.sh)
 *
 * Needs GlobalPlatformPro's jar (gp.jar) for its PC/SC binding, found through GP_JAR or next to this file. Exits 0 if every
 * check held and 1 if one did not, 2 if the card is not blank or cannot be reached. It sends nothing a phone does not send.
 */
public final class ProofStoreCheck {
    private static final String AID = "F043415348554341524401";
    private static final byte[] KEYSET = hex("0059534ce0bfa19a");
    private static final byte[] NONE = { 0 };

    /** One command and its answer, status word last. */
    interface Link {
        byte[] send(byte[] command) throws Exception;
        void close() throws Exception;
    }

    private static Link link;
    private static int checks = 0, failed = 0;

    public static void main(String[] args) throws Exception {
        try {
            link = args.length > 0 ? bridge(args[0]) : reader();
        } catch (Exception e) {
            System.out.println("cannot reach the card: " + e.getMessage());
            System.exit(2);
        }
        int code = 0;
        try {
            code = run();
        } finally {
            link.close();
        }
        System.exit(code);
    }

    private static int run() throws Exception {
        byte[] selected = send(0x00, 0xA4, 0x04, 0x00, hex(AID), 0);
        if (sw(selected) != 0x9000 || selected.length != 4 || selected[0] != 1) {
            System.out.println("the card's applet does not answer SELECT: " + toHex(selected));
            return 2;
        }
        say("SELECT answers the version 01 " + String.format("%02X", selected[1]) + " (1.20 is 01 14)", (selected[1] & 0xFF) >= 0x14);
        byte[] info = data(send(0xB0, 0x01, 0, 0, null, 0), 0x9000);
        if (info == null || info.length != 30 || info[16] != 0 || info[11] != 0 || info[3] != 0 || info[4] != 0) {
            System.out.println("the card is not blank (an owner, a record or a piece is on it): nothing was done. Make it blank first.");
            return 2;
        }
        System.out.println("the card is blank, on software 1." + (info[1] & 0xFF) + ". Checking the store of the mint's proofs.");

        // GET_INFO in its three forms, and what it says of the version
        byte[] i1 = data(send(0xB0, 0x01, 1, 0, null, 0), 0x9000), i2 = data(send(0xB0, 0x01, 2, 0, null, 0), 0x9000);
        say("GET_INFO is 30 bytes, 42 with P1 = 1, 43 with P1 = 2", info.length == 30 && i1 != null && i1.length == 42 && i2 != null && i2.length == 43);
        say("P1 = 2 begins with the 42 of P1 = 1, and its version is 01 14", i1 != null && i2 != null && Arrays.equals(i1, Arrays.copyOf(i2, 42)) && info[0] == 1 && info[1] == 0x14);

        // before any SET_CARD: no store, and no exception
        say("GET_DLEQ before any SET_CARD answers 00", Arrays.equals(data(send(0xB0, 0x1A, 0, 0xFF, null, 0), 0x9000), NONE));
        say("GET_DLEQ for a place there is not (128) is 6A83", sw(send(0xB0, 0x1A, 128, 0xFF, null, 0)) == 0x6A83);

        // set up as a phone sets a card up, the owner last (a key made here): the record first, which is the command that reserves the store
        long began = System.nanoTime();
        int setCard = sw(send(0xB0, 0x32, 0, 0, record(), -1));
        System.out.println("      SET_CARD took " + (System.nanoTime() - began) / 1000000 + " ms (the first, which reserves 12,288 bytes after the install)");
        say("SET_CARD goes through, with or without the room for proofs", setCard == 0x9000);
        KeyPair owner = ownerKey();
        say("SET_OWNER", sw(send(0xB0, 0x43, 0, 0, uncompressed(owner), -1)) == 0x9000);

        // one piece with a proof, read back
        byte[] p0 = piece(2, 1), proof0 = proof(1);
        byte[] loaded = send(0xB0, 0x30, 1, 0, cat(p0, proof0), 0);
        say("LOAD_PROOF with P1 = 1 answers the place and 01: the proof is kept (a 00 would be a card that was refused the room)",
            sw(loaded) == 0x9000 && Arrays.equals(data(loaded, 0x9000), new byte[] { 0, 1 }));
        say("GET_DLEQ gives 01 and the same 96 bytes back", Arrays.equals(data(send(0xB0, 0x1A, 0, 0xFF, null, 0), 0x9000), cat(new byte[] { 1 }, proof0)));

        // one piece with none, read back; two places in one command; the refusals
        say("a plain piece goes into the next place", Arrays.equals(data(send(0xB0, 0x30, 0, 0, piece(3, 2), 0), 0x9000), new byte[] { 1 }));
        say("GET_DLEQ for it reads 00", Arrays.equals(data(send(0xB0, 0x1A, 1, 0xFF, null, 0), 0x9000), NONE));
        say("two places in one GET_DLEQ: the proof, then 00", Arrays.equals(data(send(0xB0, 0x1A, 0, 1, null, 0), 0x9000), cat(new byte[] { 1 }, proof0, NONE)));
        say("a proof of 96 zero bytes is 6A80", sw(send(0xB0, 0x30, 1, 0, cat(piece(4, 3), new byte[96]), 0)) == 0x6A80);
        say("P1 = 1 with the 81 bytes of a plain piece is 6700", sw(send(0xB0, 0x30, 1, 0, piece(4, 4), 0)) == 0x6700);
        say("nothing was written by either refusal: the count is two", Arrays.equals(data(send(0xB0, 0x12, 0, 0, null, 1), 0x9000), new byte[] { 2 }));

        // paid: the chip signs, the proofs of spent places are not given, CLEAR_SPENT frees them
        byte[] signature = pay(new int[] { 0, 1 });
        say("both pieces are paid in one payment: a 64-byte signature", signature != null && signature.length == 64);
        say("GET_DLEQ for the two spent places: 00 each", Arrays.equals(data(send(0xB0, 0x1A, 0, 1, null, 0), 0x9000), new byte[] { 0, 0 }));
        say("CLEAR_SPENT frees both", Arrays.equals(data(send(0xB0, 0x31, 0, 0, null, 1), 0x9000), new byte[] { 2 }));

        // a place used again serves only its own proof
        say("a plain piece goes into the place that was freed", Arrays.equals(data(send(0xB0, 0x30, 0, 0, piece(5, 5), 0), 0x9000), new byte[] { 0 }));
        say("GET_DLEQ for it reads 00 and not the proof the place held", Arrays.equals(data(send(0xB0, 0x1A, 0, 0xFF, null, 0), 0x9000), NONE));
        say("a piece with a new proof goes into the next place and is given back", Arrays.equals(data(send(0xB0, 0x30, 1, 0, cat(piece(6, 6), proof(7)), 0), 0x9000), new byte[] { 1, 1 })
            && Arrays.equals(data(send(0xB0, 0x1A, 1, 0xFF, null, 0), 0x9000), cat(new byte[] { 1 }, proof(7))));

        // empty the card, with the owner's grant so that a second payment in this tap is not slowed, and reset it by the owner's proof
        say("the owner's grant for this tap", sw(send(0xB0, 0x45, 0, 0, ownerData(owner, "CashuCard/load", new byte[0]), -1)) == 0x9000);
        byte[] again = pay(new int[] { 0, 1 });
        say("the two pieces left are paid", again != null && again.length == 64);
        say("CLEAR_SPENT frees them", Arrays.equals(data(send(0xB0, 0x31, 0, 0, null, 1), 0x9000), new byte[] { 2 }));
        began = System.nanoTime();
        int reset = sw(send(0xB0, 0x51, 0, 0xAD, ownerData(owner, "CashuCard/reset", new byte[0]), -1));
        System.out.println("      RESET_CARD took " + (System.nanoTime() - began) / 1000000 + " ms (it zeros the 12,288 bytes of the store)");
        say("RESET_CARD by the owner's proof", reset == 0x9000);
        byte[] blank = data(send(0xB0, 0x01, 0, 0, null, 0), 0x9000);
        say("the card is blank again: no owner, no record, nothing on it, the same software",
            blank != null && blank.length == 30 && blank[16] == 0 && blank[11] == 0 && blank[3] == 0 && blank[4] == 0 && blank[1] == 0x14);
        say("and GET_DLEQ reads 00", Arrays.equals(data(send(0xB0, 0x1A, 0, 0xFF, null, 0), 0x9000), NONE));

        System.out.println(checks + " checks, " + failed + " failed.");
        return failed == 0 ? 0 : 1;
    }

    // ---- what a phone sends -----------------------------------------------------------------------------------------------

    /** A payment of those places and no outputs: BEGIN, then SIGN for as long as the card says "not yet" (9000 and two bytes). The signature, or null. */
    private static byte[] pay(int[] places) throws Exception {
        byte[] list = new byte[places.length];
        for (int i = 0; i < places.length; i++) list[i] = (byte) places[i];
        if (sw(send(0xB0, 0x22, 0, 0, list, 4)) != 0x9000) return null;
        for (int i = 0; i < 1100; i++) {
            byte[] r = send(0xB0, 0x24, 0, 0, null, 64);
            if (sw(r) != 0x9000) return null;
            if (r.length != 4) return Arrays.copyOf(r, r.length - 2);        // a wait is 00 01 and the status word; a signature is 64 bytes
        }
        return null;
    }

    /** The owner's proof for a command: its length, a signature (ECDSA, P-256, SHA-256, DER) over label, the nonce just given and the value, then the value. */
    private static byte[] ownerData(KeyPair owner, String label, byte[] value) throws Exception {
        byte[] nonce = data(send(0xB0, 0x44, 0, 0, null, 16), 0x9000);
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initSign(owner.getPrivate());
        s.update(label.getBytes(StandardCharsets.US_ASCII));
        s.update(nonce);
        s.update(value);
        byte[] der = s.sign();
        return cat(new byte[] { (byte) der.length }, der, value);
    }

    private static KeyPair ownerKey() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        return g.generateKeyPair();
    }

    private static byte[] uncompressed(KeyPair pair) {
        java.security.spec.ECPoint w = ((ECPublicKey) pair.getPublic()).getW();
        byte[] out = new byte[65];
        out[0] = 4;
        put32(w.getAffineX(), out, 1);
        put32(w.getAffineY(), out, 33);
        return out;
    }

    private static void put32(java.math.BigInteger n, byte[] to, int at) {
        byte[] b = n.toByteArray();
        int len = Math.min(b.length, 32);
        System.arraycopy(b, b.length - len, to, at + 32 - len, len);
    }

    /** SET_CARD's data: unit, a refund key (the curve's generator), the 65 bytes the card does not read, the mint's length and the mint. */
    private static byte[] record() {
        byte[] refund = hex("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
        byte[] mint = "https://mint.example.com/Bitcoin".getBytes(StandardCharsets.US_ASCII);
        return cat(new byte[] { 0 }, refund, new byte[65], new byte[] { (byte) mint.length }, mint);
    }

    /** A piece as LOAD_PROOF takes it: keyset (8), amount (4), nonce (32), C (33, a point's first byte and any other 32), date (4). */
    private static byte[] piece(long amount, int seed) {
        byte[] p = new byte[81];
        System.arraycopy(KEYSET, 0, p, 0, 8);
        p[8] = (byte) (amount >> 24); p[9] = (byte) (amount >> 16); p[10] = (byte) (amount >> 8); p[11] = (byte) amount;
        for (int i = 0; i < 32; i++) p[12 + i] = (byte) (0x40 + seed + i);
        p[44] = 0x02;
        for (int i = 0; i < 32; i++) p[45 + i] = (byte) (seed + 1);
        return p;
    }

    /** A proof: e, s and r, 96 bytes, none of them zeros, none the same as another seed's. */
    private static byte[] proof(int seed) {
        byte[] p = new byte[96];
        for (int i = 0; i < 96; i++) p[i] = (byte) (seed * 3 + i + 1);
        return p;
    }

    // ---- the talk ---------------------------------------------------------------------------------------------------------

    /** One command: CLA, INS, P1, P2, the data (null for none) and Le (-1 for none, 0 for 256). The answer, status word last. */
    private static byte[] send(int cla, int ins, int p1, int p2, byte[] data, int le) throws Exception {
        int lc = data == null ? 0 : data.length;
        byte[] c = new byte[4 + (lc > 0 ? 1 + lc : 0) + (le >= 0 ? 1 : 0)];
        c[0] = (byte) cla; c[1] = (byte) ins; c[2] = (byte) p1; c[3] = (byte) p2;
        int at = 4;
        if (lc > 0) { c[at++] = (byte) lc; System.arraycopy(data, 0, c, at, lc); at += lc; }
        if (le >= 0) c[at] = (byte) le;
        return link.send(c);
    }

    private static int sw(byte[] answer) {
        return answer.length < 2 ? -1 : ((answer[answer.length - 2] & 0xFF) << 8) | (answer[answer.length - 1] & 0xFF);
    }

    /** What an answer carries, if it was that status word; otherwise null. */
    private static byte[] data(byte[] answer, int wanted) {
        return sw(answer) == wanted ? Arrays.copyOf(answer, answer.length - 2) : null;
    }

    private static void say(String what, boolean held) {
        checks++;
        if (!held) failed++;
        System.out.println((held ? "  ok    " : "  FAIL  ") + what);
    }

    private static Link reader() throws Exception {
        TerminalFactory factory = TerminalFactory.getInstance("PC/SC", null, new jnasmartcardio.Smartcardio());
        for (CardTerminal t : factory.terminals().list()) {
            if (!t.isCardPresent()) continue;
            final Card card = t.connect("*");
            final CardChannel channel = card.getBasicChannel();
            return new Link() {
                public byte[] send(byte[] command) throws Exception { return channel.transmit(new CommandAPDU(command)).getBytes(); }
                public void close() throws Exception { card.disconnect(true); }       // a reset, as tools/chip/CardReset.java does: nothing of this run's tap is left
            };
        }
        throw new IllegalStateException("no card in any reader");
    }

    /** A card behind the lines of tools/chip/ChipBridge.java or the simulator's server (tap, apdu HEX, end). */
    private static Link bridge(String hostAndPort) throws Exception {
        int colon = hostAndPort.lastIndexOf(':');
        final Socket socket = new Socket(hostAndPort.substring(0, colon), Integer.parseInt(hostAndPort.substring(colon + 1)));
        final BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
        final OutputStream out = socket.getOutputStream();
        final String[] said = new String[1];
        said[0] = talk(in, out, "tap");
        if (!"ok".equals(said[0])) throw new IllegalStateException("the card does not answer a tap (" + said[0] + ")");
        return new Link() {
            public byte[] send(byte[] command) throws Exception {
                String a = talk(in, out, "apdu " + toHex(command));
                if (a.equals("gone") || a.equals("none") || a.equals("what")) throw new IllegalStateException("the card went (" + a + ")");
                return hex(a);
            }
            public void close() throws Exception { talk(in, out, "end"); socket.close(); }
        };
    }

    private static String talk(BufferedReader in, OutputStream out, String line) throws Exception {
        out.write((line + "\n").getBytes(StandardCharsets.US_ASCII));
        out.flush();
        String a = in.readLine();
        if (a == null) throw new IllegalStateException("the other end closed");
        return a.trim();
    }

    private static byte[] cat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int at = 0;
        for (byte[] p : parts) { System.arraycopy(p, 0, out, at, p.length); at += p.length; }
        return out;
    }

    private static byte[] hex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    private static String toHex(byte[] b) {
        StringBuilder out = new StringBuilder();
        for (byte x : b) out.append(String.format("%02X", x & 0xFF));
        return out.toString();
    }
}
