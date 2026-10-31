import com.google.gson.*;
import com.licel.jcardsim.base.SimulatorRuntime;
import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;
import javacard.framework.Applet;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import me.flashapp.cashu.CashuApplet;
import me.flashapp.cashu.CompactCut;
import java.io.*;
import java.lang.reflect.Field;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
/** Host simulator only. Fixed published test key and cut controls never enter a CAP. */
public final class CompactHarness {
    private static final String AID_HEX="F04341534855434D505401";
    private static final String TEST_W="04f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9388f7b0f632de8140fe337e62a37f3566500a99934c2231b6cb9fd7584b8e672";
    private static final class Runtime extends SimulatorRuntime {
        Applet applet(AID aid) {
            return getApplet(aid);
        }
    }
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
    private static Object field(Applet applet,String name)throws Exception {
        Field f=CashuApplet.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(applet);
    }
    public static void main(String[] args)throws Exception {
        Gson gson=new Gson();
        BufferedReader input=new BufferedReader(new InputStreamReader(System.in));
        String line;
        while((line=input.readLine())!=null) {
            JsonObject req=JsonParser.parseString(line).getAsJsonObject();
            Runtime runtime=new Runtime();
            CardSimulator sim=new CardSimulator(runtime);
            AID aid=AIDUtil.create(AID_HEX);
            CompactCut.target=null;
            sim.installApplet(aid,CashuApplet.class);
            Applet applet=runtime.applet(aid);
            byte[] d=new byte[32];
            d[31]=3;
            ((ECPrivateKey)field(applet,"cardPrivKey")).setS(d,(short)0,(short)32);
            byte[] w=hex(TEST_W);
            ((ECPublicKey)field(applet,"cardPubKey")).setW(w,(short)0,(short)65);
            JsonArray results=new JsonArray();
            java.util.List<byte[]> scopes=new java.util.ArrayList<>();
            java.util.Map<String,byte[]> namedScopes=new java.util.HashMap<>();
            for(JsonElement item:req.getAsJsonArray("steps")) {
                JsonObject step=item.isJsonPrimitive()?new JsonObject():item.getAsJsonObject();
                if(item.isJsonPrimitive())step.addProperty("apdu",item.getAsString());
                CompactCut.fired=false;
                CompactCut.pageHops=0;
                CompactCut.writes=0;
                CompactCut.digestCalls=0;
                CompactCut.digestBytes=0;
                CompactCut.digestSmallCalls=0;
                CompactCut.pool=(byte[])field(applet,"cardReceipts");
                CompactCut.cutWrite=step.has("cutWrite")?step.get("cutWrite").getAsInt():0;
                CompactCut.target=step.has("cut")?step.get("cut").getAsString():null;
                if(step.has("corruptProof")) {
                    byte[] proofs=(byte[])field(applet,"proofStorage"); proofs[step.get("corruptProof").getAsInt()]^=1;
                }
                if(step.has("corruptPool")) {
                    byte[] pool=(byte[])field(applet,"cardReceipts"); pool[step.get("corruptPool").getAsInt()]^=1;
                }
                if(step.has("reset"))sim.reset();
                String command;
                if(step.has("reset"))command="00a404000b"+AID_HEX;
                else if(step.has("retire") || step.has("retireAs")) {
                    byte[] scope=(step.has("retireAs")?namedScopes.get(step.get("retireAs").getAsString()):scopes.get(step.get("retire").getAsInt())).clone();
                    if(step.has("flip"))scope[step.get("flip").getAsInt()]^=1;
                    command="b07700002d"+hex(scope)+"00";
                }
                else command=step.get("apdu").getAsString();
                ResponseAPDU reply=null;
                try {
                    reply=sim.transmitCommand(new CommandAPDU(hex(command)));
                }
                catch(Throwable e) {
                    if(!CompactCut.fired)throw e;
                }
                JsonObject result=new JsonObject();
                result.addProperty("cut",CompactCut.fired);
                result.addProperty("pageHops",CompactCut.pageHops);
                result.addProperty("writes",CompactCut.writes);
                result.addProperty("canonicalDigestCalls",CompactCut.digestCalls);
                result.addProperty("canonicalDigestBytes",CompactCut.digestBytes);
                result.addProperty("canonicalDigestSmallCalls",CompactCut.digestSmallCalls);
                result.addProperty("hex",reply==null?"6f00":hex(reply.getBytes()));
                if(reply!=null && reply.getSW()==0x9000 && reply.getData().length==45 && (command.substring(2,4).equals("74") || command.substring(2,4).equals("7c")))scopes.add(reply.getData());
                if(step.has("scopeAs")) {
                    if(reply==null || reply.getSW()!=0x9000 || reply.getData().length!=45)throw new IllegalStateException("named scope missing");
                    String label=step.get("scopeAs").getAsString();
                    if(namedScopes.putIfAbsent(label,reply.getData())!=null)throw new IllegalStateException("named scope already captured");
                }
                results.add(result);
                CompactCut.target=null;
                CompactCut.cutWrite=0;
            }
            System.out.println("COMPACT_RESULT:"+gson.toJson(results));
        }
    }
}
