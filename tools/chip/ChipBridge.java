import javax.smartcardio.Card;
import javax.smartcardio.CardChannel;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.TerminalFactory;
import java.io.BufferedReader;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * The card in the reader, on a port of this machine: the same talk as the
 * simulated card's server (CardServer, in the card's repository), so that
 * whatever is run against the applet in the JavaCard simulator can be run
 * against the chip itself.
 *
 *   tap            power the card up again (a reset)        ok | none
 *   apdu HEX       one command                              HEX (answer, status last) | gone
 *   end            let go                                   ok
 *   ctl new        a real card cannot be made new from here ok (and nothing is done)
 *
 * With "look" as the second argument only commands that read are let
 * through (SELECT, GET_INFO, GET_PUBKEY, GET_BALANCE, GET_PROOF_COUNT).
 *
 * The log has each command's instruction, lengths, status and time, and
 * never its data: one of the commands carries the card's PIN.
 *
 *   sh tools/chip/run.sh [port] [look]
 *
 * Needs GlobalPlatformPro's jar (gp.jar) for its PC/SC binding, found through
 * GP_JAR or next to this file.
 */
public final class ChipBridge {
    private static Card card;
    private static CardChannel channel;
    private static CardTerminal terminal;
    private static PrintWriter log;
    private static boolean lookOnly;

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 47470;
        lookOnly = args.length > 1 && args[1].equals("look");
        log = new PrintWriter(new FileWriter(args.length > 2 ? args[2] : "chip-bridge.log", false), true);
        TerminalFactory factory = TerminalFactory.getInstance("PC/SC", null, new jnasmartcardio.Smartcardio());
        for (CardTerminal t : factory.terminals().list()) {
            if (t.isCardPresent()) { terminal = t; break; }
        }
        if (terminal == null) { System.out.println("no card in any reader"); System.exit(2); }
        try (ServerSocket listening = new ServerSocket(port, 8, InetAddress.getLoopbackAddress())) {
            System.out.println("the card in '" + terminal.getName() + "' is on 127.0.0.1:" + port + (lookOnly ? " (reading only)" : ""));
            while (true) {
                try (Socket phone = listening.accept()) {
                    serve(phone);
                } catch (Exception e) {
                    log.println("the other end went: " + e);
                }
            }
        }
    }

    private static void serve(Socket phone) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(phone.getInputStream(), StandardCharsets.US_ASCII));
        OutputStream out = phone.getOutputStream();
        String line;
        while ((line = in.readLine()) != null) {
            String answer = answer(line.trim());
            out.write((answer + "\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
        }
    }

    private static String answer(String line) {
        if (line.equals("tap")) {
            try {
                if (card != null) { try { card.disconnect(true); } catch (Exception e) { /* gone already */ } }
                card = terminal.connect("*");
                channel = card.getBasicChannel();
                log.println("tap");
                return "ok";
            } catch (Exception e) {
                log.println("tap failed: " + e);
                card = null;
                return "none";
            }
        }
        if (line.equals("end")) { log.println("end"); return "ok"; }
        if (line.startsWith("apdu ")) {
            byte[] command = bytes(line.substring(5).trim());
            if (command == null || command.length < 4) return "6700";
            if (card == null) return "gone";
            int cla = command[0] & 0xff, ins = command[1] & 0xff;
            if (lookOnly && !((cla == 0x00 && ins == 0xA4) || (cla == 0xB0 && (ins == 0x01 || ins == 0x10 || ins == 0x11 || ins == 0x12)))) return "6d00";
            try {
                ByteBuffer said = ByteBuffer.allocate(1024);
                long before = System.nanoTime();
                int n = channel.transmit(ByteBuffer.wrap(command), said);
                long ms = (System.nanoTime() - before) / 1000000;
                byte[] got = new byte[n];
                said.flip();
                said.get(got);
                log.println(String.format("  %02x %02x p1 %02x p2 %02x in %3d -> %02x%02x out %3d  %5d ms", cla, ins, command[2] & 0xff, command[3] & 0xff,
                        command.length > 5 ? command.length - 5 : 0, got[n - 2] & 0xff, got[n - 1] & 0xff, n - 2, ms));
                return hex(got);
            } catch (Exception e) {
                log.println(String.format("  %02x %02x FAILED: %s", cla, ins, e));
                card = null;
                return "gone";
            }
        }
        if (line.startsWith("ctl ")) { log.println(line); return "ok"; }
        return "what";
    }

    private static byte[] bytes(String hex) {
        if (hex.length() % 2 != 0 || !hex.matches("[0-9a-fA-F]*")) return null;
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    private static String hex(byte[] data) {
        StringBuilder out = new StringBuilder();
        for (byte b : data) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }
}
