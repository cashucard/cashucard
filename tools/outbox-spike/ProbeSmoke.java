import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import me.flashapp.cashu.CashuApplet;

/** jCardSim dispatch/transaction smoke; the returned memory counts are not silicon evidence. */
public final class ProbeSmoke {
    public static void main(String[] args) {
        int poolBytes = args.length == 0 ? 16384 : Integer.parseInt(args[0]);
        require(poolBytes == 0 || poolBytes == 16384);
        CardSimulator sim = new CardSimulator();
        AID aid = AIDUtil.create("F0434153485550524F424501");
        sim.installApplet(aid, CashuApplet.class);
        ResponseAPDU selected = sim.transmitCommand(new CommandAPDU(0, 0xA4, 4, 0, aidBytes(aid)));
        require(selected.getSW() == 0x9000 && selected.getData().length == 8 && selected.getData()[0] == 0x50);
        require(selected.getData()[5] == 2 && u16(selected.getData(), 6) == poolBytes);
        ResponseAPDU before = sim.transmitCommand(new CommandAPDU(0xB0, 0x7D, 0, 0, 16));
        require(before.getSW() == 0x9000 && before.getData().length == 16 && before.getData()[12] == 0);
        require(before.getData()[13] == 2 && u16(before.getData(), 10) == poolBytes);
        ResponseAPDU committed = sim.transmitCommand(new CommandAPDU(0xB0, 0x7E, 0, 0, 1));
        if (poolBytes == 0) {
            require(committed.getSW() == 0x6D00);
        } else {
            require(committed.getSW() == 0x9000 && committed.getData()[0] == 1);
            ResponseAPDU after = sim.transmitCommand(new CommandAPDU(0xB0, 0x7D, 0, 0, 16));
            require(after.getSW() == 0x9000 && after.getData()[12] == 1);
        }
        for (int ins : new int[] {0x20, 0x24, 0x30, 0x31, 0x40, 0x41, 0x43, 0x51}) {
            require(sim.transmitCommand(new CommandAPDU(0xB0, ins, 0, 0, 1)).getSW() == 0x6D00);
        }
        System.out.println("Probe profile " + poolBytes + " dispatch and production-command refusal passed in jCardSim; no silicon evidence.");
    }
    private static int u16(byte[] bytes, int offset) {
        return ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255);
    }
    private static byte[] aidBytes(AID aid) {
        byte[] bytes = new byte[16];
        byte size = aid.getBytes(bytes, (short) 0);
        return java.util.Arrays.copyOf(bytes, size);
    }
    private static void require(boolean condition) {
        if (!condition) {throw new AssertionError("probe smoke failed");}
    }
}
