import java.util.Arrays;
import javacard.framework.ISOException;
import javacard.framework.Util;
import me.flashapp.cashu.CompactState;
import me.flashapp.cashu.CompactCut;
/** Host-only logical reference, fragmented-page and ordered-byte cut checks. */
public final class CompactAccessChecks {
    private static final short INDEX=5, LENGTH=5635;
    private static int cases;
    private static int page(int logical) { return (logical*17+11)%90; }
    private static byte[] pool() {
        byte[] p=new byte[CompactState.SIZE];
        int head=CompactState.HEAD+INDEX*CompactState.HS;
        p[head]=1;
        Util.setShort(p,(short)(head+13),LENGTH);
        p[head+15]=(byte)page(0);
        int count=(LENGTH+127)/128;
        for(int i=0;i<count;i++) {
            p[CompactState.OWNER+page(i)]=(byte)(INDEX+1);
            p[CompactState.NEXT+page(i)]=(byte)(i+1<count?page(i+1):255);
            for(int k=0;k<128;k++)p[CompactState.DATA+page(i)*128+k]=(byte)(i*31+k);
        }
        CompactCut.pool=p;
        CompactCut.cutWrite=0;
        CompactCut.writes=0;
        CompactCut.pageHops=0;
        CompactCut.fired=false;
        return p;
    }
    private static int physical(int logical) {
        return CompactState.DATA+page(logical/128)*128+logical%128;
    }
    private static void check(boolean yes) {
        if(!yes)throw new AssertionError("access case "+cases);
    }
    private static void refused(byte[] p,int offset,int from,int len) {
        byte[] before=p.clone();
        try {
            CompactState.write(p,INDEX,(short)offset,new byte[300],(short)from,(short)len);
            throw new AssertionError("invalid span admitted");
        } catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
        check(Arrays.equals(p,before));
        cases++;
    }
    private static void cursorRefused(byte[] p,int offset,int physical,int to,int len) {
        byte[] before=p.clone(),out=new byte[300];Arrays.fill(out,(byte)99);
        try {
            CompactState.readCursor(p,INDEX,(short)offset,(short)physical,out,(short)to,(short)len);
            throw new AssertionError("invalid cursor span admitted");
        } catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
        check(Arrays.equals(p,before));
        for(byte b:out)check(b==99);
        cases++;
    }
    public static void main(String[] args) {
        byte[] input=new byte[700];
        for(int i=0;i<input.length;i++)input[i]=(byte)(i*7+3);
        for(int offset:new int[]{0,1,126,127,128,255,3379,5407,5634}) {
            for(int len:new int[]{0,1,2,33,64,128,228}) {
                if(offset+len>LENGTH)continue;
                byte[] p=pool(),expected=p.clone();
                for(int i=0;i<len;i++)expected[physical(offset+i)]=input[7+i];
                CompactState.write(p,INDEX,(short)offset,input,(short)7,(short)len);
                check(Arrays.equals(p,expected));
                check(CompactCut.writes==len);
                check(CompactCut.pageHops<=45+3);
                byte[] out=new byte[300];Arrays.fill(out,(byte)99);
                CompactState.read(p,INDEX,(short)offset,out,(short)9,(short)len);
                for(int i=0;i<out.length;i++)check(out[i]==(i>=9 && i<9+len?input[i-9+7]:(byte)99));
                cases++;
            }
        }
        // Every possible interruption after an ordered persistent byte store.
        for(int cut=1;cut<=228;cut++) {
            byte[] p=pool(),expected=p.clone();
            for(int i=0;i<cut;i++)expected[physical(3379+i)]=input[7+i];
            CompactCut.cutWrite=cut;
            try {
                CompactState.write(p,INDEX,(short)3379,input,(short)7,(short)228);
                throw new AssertionError("write cut missed");
            } catch(IllegalStateException ex) { check(CompactCut.fired); }
            check(CompactCut.writes==cut && Arrays.equals(p,expected));
            cases++;
        }
        // Logical/physical cursors agree through fragmented pages and repeated
        // small advances. Reads leave the pool and bytes outside the span intact.
        for(int offset:new int[]{0,1,126,127,128,255,3379,5407,5634}) {
            for(int distance:new int[]{0,1,5,33,38,128,255,511}) {
                if(offset+distance>=LENGTH)continue;
                byte[] p=pool(),before=p.clone();
                short cursor=CompactState.cursor(p,INDEX,(short)offset);
                cursor=CompactState.forward(p,INDEX,cursor,(short)distance);
                check(cursor==physical(offset+distance));
                short len=(short)Math.min(228,LENGTH-offset-distance);
                byte[] out=new byte[300];Arrays.fill(out,(byte)99);
                CompactState.readCursor(p,INDEX,(short)(offset+distance),cursor,out,(short)7,len);
                for(int i=0;i<out.length;i++)check(out[i]==(i>=7 && i<7+len?p[physical(offset+distance+i-7)]:(byte)99));
                check(Arrays.equals(p,before));cases++;
            }
        }
        cursorRefused(pool(),-1,physical(0),0,1);
        cursorRefused(pool(),LENGTH,physical(LENGTH),0,1);
        cursorRefused(pool(),LENGTH-1,physical(LENGTH-1),0,2);
        cursorRefused(pool(),0,physical(0),-1,1);
        cursorRefused(pool(),0,physical(0),299,2);
        cursorRefused(pool(),0,physical(0),0,-1);
        cursorRefused(pool(),0,CompactState.DATA-1,0,1);
        cursorRefused(pool(),0,CompactState.DATA+90*128,0,1);
        cursorRefused(pool(),0,physical(1),0,1);
        for(boolean wrongOwner:new boolean[]{false,true}) {
            byte[] p=pool(),before=p.clone(),out=new byte[300];Arrays.fill(out,(byte)99);
            short cursor=CompactState.cursor(p,INDEX,(short)3379);
            if(wrongOwner)p[CompactState.OWNER+page(27)]=0;
            else p[CompactState.NEXT+page(26)]=(byte)255;
            before=p.clone();
            try {
                CompactState.readCursor(p,INDEX,(short)3379,cursor,out,(short)7,(short)228);
                throw new AssertionError("bad cursor chain admitted");
            } catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
            check(Arrays.equals(p,before));
            for(int i=0;i<300;i++)check(out[i]==(i>=7 && i<84?p[physical(3379+i-7)]:(byte)99));
            cases++;
        }
        for(short distance:new short[]{-1,11520,32767}) {
            byte[] p=pool();
            try { CompactState.forward(p,INDEX,(short)physical(0),distance);throw new AssertionError("invalid advance admitted"); }
            catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
            cases++;
        }
        byte[] foreign=pool();foreign[CompactState.OWNER+page(0)]=0;
        cursorRefused(foreign,0,physical(0),0,1);
        for(int physical:new int[]{CompactState.DATA-1,CompactState.DATA+90*128,physical(0)}) {
            byte[] p=pool();if(physical==physical(0))p[CompactState.OWNER+page(0)]=0;
            try { CompactState.forward(p,INDEX,(short)physical,(short)0);throw new AssertionError("invalid cursor position admitted"); }
            catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
            cases++;
        }
        for(int kind=0;kind<3;kind++) {
            byte[] p=pool(),proofs=new byte[256],before=p.clone(),work=kind==0?new byte[127]:kind==1?p:proofs;
            try { CompactState.hash(p,proofs,INDEX,null,work,false);throw new AssertionError("unsafe hash scratch admitted"); }
            catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
            check(Arrays.equals(p,before));cases++;
        }
        refused(pool(),-1,0,1);refused(pool(),LENGTH,0,1);
        refused(pool(),LENGTH-1,0,2);refused(pool(),0,-1,1);
        refused(pool(),0,299,2);refused(pool(),0,0,-1);
        for(boolean wrongOwner:new boolean[]{false,true}) {
            byte[] p=pool();
            if(wrongOwner)p[CompactState.OWNER+page(27)]=0;
            else p[CompactState.NEXT+page(26)]=(byte)255;
            byte[] expected=p.clone();
            for(int i=0;i<77;i++)expected[physical(3379+i)]=input[7+i];
            try {
                CompactState.write(p,INDEX,(short)3379,input,(short)7,(short)228);
                throw new AssertionError("bad page chain admitted");
            } catch(ISOException ex) { check(ex.getReason()==(short)0x6A80); }
            check(Arrays.equals(p,expected));cases++;
        }
        System.out.println("Access checks passed: "+cases+"; includes 228 byte-store cuts");
    }
}
