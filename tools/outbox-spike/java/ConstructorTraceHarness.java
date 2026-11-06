import com.google.gson.*;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.base.SimulatorRuntime;
import com.licel.jcardsim.utils.AIDUtil;
import me.flashapp.cashu.CashuApplet;
import me.flashapp.cashu.Opener;
import me.flashapp.cashu.ConstructorFault;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;

/** Host only. Fault class and this harness never enter the converted CAP. */
public final class ConstructorTraceHarness {
    private static byte[] hex(String s) {
        byte[] b=new byte[s.length()/2];
        for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);
        return b;
    }
    private static String hex(byte[] b) {
        StringBuilder s=new StringBuilder();
        for(byte v:b)s.append(String.format("%02x",v&255));
        return s.toString();
    }
    public static void main(String[] args) throws Exception {
        int stageCount=Integer.parseInt(args[0]);
        JsonArray results=new JsonArray();
        for(int failureStage=0;failureStage<=stageCount;failureStage++) {
            int maxKind=failureStage==1?7:1;
            for(int kind=1;kind<=maxKind;kind++) {
                CardSimulator sim=new CardSimulator(new SimulatorRuntime());
                sim.installApplet(AIDUtil.create("F04341534855435452434D"),Opener.class);
                ConstructorFault.target=(short)failureStage;
                ConstructorFault.kind=(byte)kind;
                sim.installApplet(AIDUtil.create("F043415348554354524301"),CashuApplet.class);
                if(!sim.selectApplet(AIDUtil.create("F043415348554354524301")))throw new AssertionError("main select");
                ResponseAPDU reply=sim.transmitCommand(new CommandAPDU(hex("b07d000000")));
                JsonObject r=new JsonObject();r.addProperty("failureStage",failureStage);r.addProperty("kind",kind);r.addProperty("hex",hex(reply.getBytes()));
                if(failureStage==0 || failureStage==1) {
                    for(String a:new String[]{"b07a000000","b07e000000","b074000000","b077000000","b07d010000","007d000000","b07d00000100"}) {
                        ResponseAPDU denied=sim.transmitCommand(new CommandAPDU(hex(a)));
                        if(denied.getSW()==0x9000)throw new AssertionError("forbidden command");
                    }
                    sim.reset();
                    if(!sim.selectApplet(AIDUtil.create("F043415348554354524301")))throw new AssertionError("reselect");
                    String after=hex(sim.transmitCommand(new CommandAPDU(hex("b07d000000"))).getBytes());
                    if(!after.equals(hex(reply.getBytes())))throw new AssertionError("evidence changed on reset/reselect");
                    r.addProperty("retained",true);
                }
                results.add(r);
            }
        }
        System.out.println("CONSTRUCTOR_RESULT:"+new Gson().toJson(results));
    }
}
