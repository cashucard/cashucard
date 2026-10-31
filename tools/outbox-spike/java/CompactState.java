package me.flashapp.cashu;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;
import javacard.security.MessageDigest;
/** Private fixture engine. Persistent state is byte-backed; no command allocates. */
public final class CompactState {
    public static final short SIZE=16384, KEY=8, NONCE=41, MLEN=73, MINT=75, UNIT=330,
    KEYS=331, REG=332, MAP=604, GENS=732, HEAD=1244, HS=52,
    OWNER=4572, NEXT=4662, DATA=4752, PAGES=90, TAG=16336, DOMAIN=16368, PROFILE=16375;
    private static final byte FREE=0, STAGING=1, COMMITTED=2, CLEARING=3, RELEASING=4;
    private CompactState() {
    }
    private static void require(boolean yes) {
        if(!yes) ISOException.throwIt((short)0x6985);
    }
    private static void data(boolean yes) {
        if(!yes) ISOException.throwIt((short)0x6A80);
    }
    private static short u(byte b) {
        return (short)(b & 255);
    }
    private static short h(short index) {
        data(index>=0 && index<64);
        return (short)(HEAD+index*HS);
    }
    private static void put(byte[] a,short at,byte value) {
        a[at]=value;
    }
    private static void copy(byte[] a,short at,byte[] b,short to,short length) {
        for(short i=0;i<length;i++)put(b,(short)(to+i),a[(short)(at+i)]);
    }
    private static void zero(byte[] p,short at,short length) {
        for(short i=0;i<length;i++)put(p,(short)(at+i),(byte)0);
    }
    private static void commit() {
        JCSystem.commitTransaction();
    }
    private static boolean equal(byte[] a,short at,byte[] b,short bt,short length) {
        for(short i=0;i<length;i++)if(a[(short)(at+i)]!=b[(short)(bt+i)])return false;
        return true;
    }
    private static boolean empty(byte[] p,short at,short length) {
        for(short i=0;i<length;i++)if(p[(short)(at+i)]!=0)return false;
        return true;
    }
    private static boolean maximum(byte[] p,short at,short length) {
        for(short i=0;i<length;i++)if(p[(short)(at+i)]!=(byte)255)return false;
        return true;
    }
    private static void inc(byte[] p,short at,short length) {
        require(!maximum(p,at,length));
        for(short i=(short)(length-1);i>=0;i--) {
            put(p,(short)(at+i),(byte)(p[(short)(at+i)]+1));
            if(p[(short)(at+i)]!=0)return;
        }
    }
    private static short registry(byte[] p,short ref) {
        data(ref>=0 && ref<u(p[KEYS]));
        short at=(short)(REG+34*ref);
        data(p[at]==8 || p[at]==33);
        return at;
    }
    public static void validateSetup(byte[] b,short at,short len) {
        data(len>=42 && len==(short)(41+u(b[(short)(at+40)])));
        short n=u(b[(short)(at+40)]);
        data(n>=8 && n<=214);
        short x=(short)(at+41);
        data(b[x]=='h' && b[(short)(x+1)]=='t' && b[(short)(x+2)]=='t' && b[(short)(x+3)]=='p' && b[(short)(x+4)]=='s' && b[(short)(x+5)]==':' && b[(short)(x+6)]=='/' && b[(short)(x+7)]=='/');
        for(short i=0;i<n;i++) {
            short c=u(b[(short)(x+i)]);
            data(c>32 && c<127 && c!='?' && c!='#' && c!='@' && c!='\\');
        }
    }
    public static void configure(byte[] p,byte[] b,short at) {
        copy(b,at,p,(short)0,(short)8);
        copy(b,(short)(at+8),p,NONCE,(short)32);
        short n=u(b[(short)(at+40)]);
        put(p,MLEN,(byte)0);
        put(p,(short)(MLEN+1),(byte)n);
        copy(b,(short)(at+41),p,MINT,n);
        put(p,UNIT,(byte)0);
        put(p,PROFILE,(byte)1);
        // DOMAIN and TAG are filled by the generated setup, without class-initializer arrays.
    }
    public static void keyset(byte[] p,byte[] b,short at,short len) {
        short count=u(p[KEYS]);
        data(count<8 && len>=2 && u(b[at])==count);
        short size=u(b[(short)(at+1)]);
        data((size==8 || size==33) && len==(short)(size+2));
        for(short i=0;i<count;i++)data(!equal(p,(short)(REG+i*34+1),b,(short)(at+2),(short)8));
        short to=(short)(REG+count*34);
        copy(b,(short)(at+2),p,(short)(to+1),size);
        put(p,to,(byte)size);
        // SIM-CUT registry-entry
        put(p,KEYS,(byte)(count+1));
    }
    public static short stageLoad(byte[] p,byte[] proofs,byte[] dleq,byte[] b,short at,short len,byte[] work) {
        data(len==75);
        short slot=u(b[at]);
        data(slot<128);
        short base=(short)(slot*82),gen=(short)(GENS+slot*4),reg=registry(p,u(b[(short)(at+5)]));
        require(proofs[base]==0);
        data(!empty(b,(short)(at+1),(short)4) && !empty(b,(short)(at+6),(short)4));
        if(!empty(p,gen,(short)4)) {
            copy(p,gen,work,(short)0,(short)4);
            inc(work,(short)0,(short)4);
            data(equal(work,(short)0,b,(short)(at+1),(short)4));
        }
        data(b[(short)(at+42)]==2 || b[(short)(at+42)]==3);
        for(short i=0;i<128;i++)if(proofs[(short)(i*82)]!=0)data(!equal(proofs,(short)(i*82+13),b,(short)(at+10),(short)32));
        copy(p,(short)(reg+1),proofs,(short)(base+1),(short)8);
        copy(b,(short)(at+6),proofs,(short)(base+9),(short)69);
        zero(proofs,(short)(base+78),(short)4);
        zero(dleq,(short)(slot*96),(short)96);
        put(p,(short)(MAP+slot),b[(short)(at+5)]);
        // SIM-CUT load-data
        return slot;
    }
    public static void commitLoad(byte[] p,byte[] proofs,short slot,byte[] b,short genAt) {
        JCSystem.beginTransaction();
        try {
            copy(b,genAt,p,(short)(GENS+slot*4),(short)4);
            put(proofs,(short)(slot*82),(byte)1);
            commit();
        }
        catch(javacard.framework.TransactionException e) {
            if(JCSystem.getTransactionDepth()!=0)JCSystem.abortTransaction();
            throw e;
        }
    }
    private static short address(byte[] p,short index,short offset) {
        short at=h(index),len=Util.getShort(p,(short)(at+13));
        data(offset>=0 && offset<len);
        short page=u(p[(short)(at+15)]),steps=(short)(offset/128);
        data(steps<PAGES);
        for(short i=0;i<steps;i++) {
            data(page<PAGES && u(p[(short)(OWNER+page)])==(short)(index+1));
            page=u(p[(short)(NEXT+page)]);
        }
        data(page<PAGES && u(p[(short)(OWNER+page)])==(short)(index+1));
        return (short)(DATA+page*128+offset%128);
    }
    public static byte get(byte[] p,short index,short offset) {
        return p[address(p,index,offset)];
    }
    private static void position(byte[] p,short index,short physical) {
        h(index);
        data(physical>=DATA && physical<(short)(DATA+PAGES*128));
        short relative=(short)(physical-DATA),page=(short)(relative/128);
        data(u(p[(short)(OWNER+page)])==(short)(index+1));
    }
    public static short cursor(byte[] p,short index,short offset) {
        return address(p,index,offset);
    }
    public static short forward(byte[] p,short index,short physical,short distance) {
        position(p,index,physical);
        data(distance>=0 && distance<(short)(PAGES*128));
        while(distance>0) {
            short relative=(short)(physical-DATA),available=(short)(128-relative%128);
            if(distance<available)return (short)(physical+distance);
            short page=(short)(relative/128);
            page=u(p[(short)(NEXT+page)]);
            data(page<PAGES && u(p[(short)(OWNER+page)])==(short)(index+1));
            physical=(short)(DATA+page*128);
            distance-=available;
        }
        return physical;
    }
    // A cursor is derived from address/forward within this command only. The
    // logical offset bounds the span; ownership is checked on every page.
    public static void readCursor(byte[] p,short index,short offset,short physical,byte[] b,short to,short len) {
        if(len==0)return;
        short limit=Util.getShort(p,(short)(h(index)+13));
        data(offset>=0 && len>0 && offset<=limit && len<=(short)(limit-offset));
        data(to>=0 && to<=b.length && len<=(short)(b.length-to));
        position(p,index,physical);
        short relative=(short)(physical-DATA);
        data((short)(relative%128)==(short)(offset%128));
        while(len>0) {
            relative=(short)(physical-DATA);
            short n=(short)(128-relative%128);
            if(n>len)n=len;
            copy(p,physical,b,to,n);
            to+=n;
            len-=n;
            if(len>0)physical=forward(p,index,physical,n);
        }
    }
    private static void transfer(byte[] p,short index,short offset,byte[] b,short from,short len,boolean writing) {
        if(len==0)return;
        short limit=Util.getShort(p,(short)(h(index)+13));
        data(offset>=0 && len>0 && offset<=limit && len<=(short)(limit-offset));
        data(from>=0 && from<=b.length && len<=(short)(b.length-from));
        short physical=address(p,index,offset);
        while(len>0) {
            short relative=(short)(physical-DATA),n=(short)(128-relative%128);
            if(n>len)n=len;
            // Keep the original ordered byte stores and publication boundary.
            if(writing)copy(b,from,p,physical,n);
            else copy(p,physical,b,from,n);
            from+=n;
            len-=n;
            if(len>0)physical=forward(p,index,physical,n);
        }
    }
    public static void read(byte[] p,short index,short offset,byte[] b,short to,short len) {
        transfer(p,index,offset,b,to,len,false);
    }
    public static void write(byte[] p,short index,short offset,byte[] b,short from,short len) {
        transfer(p,index,offset,b,from,len,true);
    }
    private static void frameByte(byte[] p,short index,short offset,byte value) {
        put(p,address(p,index,offset),value);
    }
    public static short outputStart(byte[] p,short index) {
        return (short)(3+5*u(get(p,index,(short)0)));
    }
    public static short signatureStart(byte[] p,short index) {
        return (short)(Util.getShort(p,(short)(h(index)+13))-128);
    }
    private static void add(byte[] a,short at,byte[] work,short to) {
        short carry=0;
        for(short j=3;j>=0;j--) {
            short n=(short)(u(work[(short)(to+j)])+u(a[(short)(at+j)])+carry);
            work[(short)(to+j)]=(byte)n;
            carry=(short)(n>>8);
        }
        data(carry==0);
    }
    private static boolean lessEqual(byte[] a,short at,byte[] b,short bt) {
        for(short j=0;j<4;j++) {
            short x=u(a[(short)(at+j)]),y=u(b[(short)(bt+j)]);
            if(x!=y)return x<y;
        }
        return true;
    }
    private static short frameLength(short inputs,short outputs) {
        short length=(short)(inputs*5);
        length+=(short)(outputs*38);
        return (short)(length+131);
    }
    public static short begin(byte[] p,byte[] proofs,byte[] b,short at,short len,byte[] work) {
        data(len>=3);
        short count=u(b[at]),outputs=u(b[(short)(at+1)]);
        data(count>0 && count<=128 && outputs>0 && len==(short)(count+2));
        zero(work,(short)0,(short)4);
        for(short i=0;i<count;i++) {
            short slot=u(b[(short)(at+2+i)]);
            data(slot<128);
            require(proofs[(short)(slot*82)]==1 && !empty(p,(short)(GENS+slot*4),(short)4));
            registry(p,u(p[(short)(MAP+slot)]));
            for(short j=0;j<i;j++)data(b[(short)(at+2+j)]!=(byte)slot);
            add(proofs,(short)(slot*82+9),work,(short)0);
        }
        short index=-1;
        for(short i=0;i<64;i++)if(p[h(i)]==FREE && !maximum(p,(short)(h(i)+9),(short)4)) {
            index=i;
            break;
        }
        short length=frameLength(count,outputs),needed=(short)((short)(length+127)/128),free=0;
        for(short i=0;i<PAGES;i++)if(p[(short)(OWNER+i)]==0)free++;
        if(index<0 || free<needed)ISOException.throwIt((short)0x6A84);
        require(!maximum(p,(short)0,(short)8));
        short head=h(index);
        JCSystem.beginTransaction();
        try {
            inc(p,(short)0,(short)8);
            copy(p,(short)0,p,(short)(head+1),(short)8);
            inc(p,(short)(head+9),(short)4);
            put(p,head,STAGING);
            commit();
        }
        catch(javacard.framework.TransactionException e) {
            if(JCSystem.getTransactionDepth()!=0)JCSystem.abortTransaction();
            throw e;
        }
        // SIM-CUT begin-fixed
        put(p,(short)(head+13),(byte)(length>>8));
        put(p,(short)(head+14),(byte)length);
        put(p,(short)(head+16),(byte)needed);
        put(p,(short)(head+49),(byte)index);
        put(p,(short)(head+50),(byte)0);
        short previous=-1;
        for(short i=0;i<PAGES && needed>0;i++)if(p[(short)(OWNER+i)]==0) {
            put(p,(short)(OWNER+i),(byte)(index+1));
            put(p,(short)(NEXT+i),(byte)255);
            if(previous<0)put(p,(short)(head+15),(byte)i);
            else put(p,(short)(NEXT+previous),(byte)i);
            previous=i;
            needed--;
        }
        frameByte(p,index,(short)0,(byte)count);
        for(short i=0;i<count;i++) {
            short slot=u(b[(short)(at+2+i)]),off=(short)(1+5*i);
            frameByte(p,index,off,(byte)slot);
            write(p,index,(short)(off+1),p,(short)(GENS+slot*4),(short)4);
        }
        frameByte(p,index,(short)(1+5*count),(byte)1);
        frameByte(p,index,(short)(2+5*count),(byte)outputs);
        // SIM-CUT frame-staged
        return index;
    }
    public static short append(byte[] p,short index,short done,byte[] b,short at,short len,byte[] work) {
        require(p[h(index)]==STAGING);
        data(len>0 && len%38==0);
        short more=(short)(len/38),start=outputStart(p,index),total=u(get(p,index,(short)(start-1)));
        data((short)(done+more)<=total);
        for(short i=0;i<more;i++) {
            short from=(short)(at+38*i);
            registry(p,u(b[(short)(from+4)]));
            data(!empty(b,from,(short)4) && (b[(short)(from+5)]==2 || b[(short)(from+5)]==3));
            for(short j=0;j<i;j++)data(!equal(b,(short)(at+38*j+5),b,(short)(from+5),(short)33));
        }
        // Fetch each prior point once into the existing scratch buffer, then
        // compare every incoming point. Every check still precedes frame writes.
        short previous=address(p,index,(short)(start+5));
        for(short j=0;j<done;j++) {
            readCursor(p,index,(short)(start+38*j+5),previous,work,(short)0,(short)33);
            for(short i=0;i<more;i++)data(!equal(work,(short)0,b,(short)(at+38*i+5),(short)33));
            if((short)(j+1)<done)previous=forward(p,index,previous,(short)38);
        }
        write(p,index,(short)(start+done*38),b,at,len);
        return (short)(done+more);
    }
    private static void structure(byte[] p,short index) {
        short head=h(index),length=Util.getShort(p,(short)(head+13)),pages=u(p[(short)(head+16)]),page=u(p[(short)(head+15)]);
        data(length>0 && pages==(short)((short)(length+127)/128) && pages<=PAGES && u(p[(short)(head+49)])==index);
        for(short i=0;i<pages;i++) {
            data(page<PAGES && u(p[(short)(OWNER+page)])==(short)(index+1));
            page=u(p[(short)(NEXT+page)]);
        }
        data(page==255);
        short n=u(get(p,index,(short)0));
        data(n>0 && n<=128);
        short out=outputStart(p,index),m=u(get(p,index,(short)(out-1)));
        data(m>0 && get(p,index,(short)(out-2))==1 && length==frameLength(n,m));
    }
    public static void inputs(byte[] p,byte[] proofs,short index,byte state,byte[] work) {
        structure(p,index);
        zero(work,(short)0,(short)4);
        // 128-slot duplicate detection in 16 bytes of existing transient scratch.
        zero(work,(short)16,(short)16);
        short count=u(get(p,index,(short)0)),inputRef=address(p,index,(short)1);
        for(short i=0;i<count;i++) {
            short ref=(short)(1+5*i);
            readCursor(p,index,ref,inputRef,work,(short)32,(short)5);
            short slot=u(work[32]);
            data(slot<128);
            require(equal(work,(short)33,p,(short)(GENS+slot*4),(short)4));
            byte status=proofs[(short)(slot*82)];
            require(state==CLEARING?(status==0 || status==2):(status==1 || (state==COMMITTED && status==2)));
            short seen=(short)(16+slot/8);
            byte bit=(byte)(1 << (slot%8));
            data((work[seen]&bit)==0);
            put(work,seen,(byte)(work[seen]|bit));
            short reg=registry(p,u(p[(short)(MAP+slot)]));
            data(equal(proofs,(short)(slot*82+1),p,(short)(reg+1),(short)8) && empty(proofs,(short)(slot*82+78),(short)4));
            add(proofs,(short)(slot*82+9),work,(short)0);
            if((short)(i+1)<count)inputRef=forward(p,index,inputRef,(short)5);
        }
    }
    public static void outputs(byte[] p,short index,short done,byte[] work) {
        short start=outputStart(p,index),count=u(get(p,index,(short)(start-1)));
        require(done==count);
        zero(work,(short)4,(short)4);
        short outputRef=address(p,index,start);
        for(short i=0;i<count;i++) {
            short off=(short)(start+38*i);
            registry(p,u(p[forward(p,index,outputRef,(short)4)]));
            readCursor(p,index,off,outputRef,work,(short)8,(short)4);
            data(!empty(work,(short)8,(short)4));
            add(work,(short)8,work,(short)4);
            if((short)(i+1)<count)outputRef=forward(p,index,outputRef,(short)38);
        }
        data(lessEqual(work,(short)4,work,(short)0));
    }
    private static short emit(MessageDigest md,byte[] source,short at,short len,byte[] out,short wanted,short limit,short pos) {
        if(md!=null) {
            // Hashing owns the existing scratch for this call. Buffer canonical
            // bytes in 128-byte blocks instead of making a native call for
            // each small field. Export keeps its separate clipped-copy path.
            while(len>0) {
                short used=(short)(pos%128),n=(short)(128-used);
                if(n>len)n=len;
                Util.arrayCopyNonAtomic(source,at,out,used,n);
                pos+=n;
                at+=n;
                len-=n;
                if((short)(pos%128)==0)md.update(out,(short)0,(short)128);
            }
            return pos;
        }
        else {
            short lo=pos>wanted?pos:wanted,hi=(short)(pos+len),end=(short)(wanted+limit);
            if(hi>end)hi=end;
            if(hi>lo)Util.arrayCopyNonAtomic(source,(short)(at+lo-pos),out,(short)(lo-wanted),(short)(hi-lo));
        }
        return (short)(pos+len);
    }
    private static short field(byte[] p,short index,short at,short len,MessageDigest md,byte[] out,short wanted,short limit,short pos) {
        if(md==null) {
            short next=(short)(pos+len),lo=pos>wanted?pos:wanted,hi=next,end=(short)(wanted+limit);
            if(hi>end)hi=end;
            if(hi>lo)read(p,index,(short)(at+lo-pos),out,(short)(lo-wanted),(short)(hi-lo));
            return next;
        }
        return fieldCursor(p,index,at,address(p,index,at),len,md,out,wanted,limit,pos);
    }
    private static short fieldCursor(byte[] p,short index,short at,short physical,short len,MessageDigest md,byte[] out,short wanted,short limit,short pos) {
        if(md==null) {
            short next=(short)(pos+len),lo=pos>wanted?pos:wanted,hi=next,end=(short)(wanted+limit);
            if(hi>end)hi=end;
            if(hi>lo)readCursor(p,index,(short)(at+lo-pos),forward(p,index,physical,(short)(lo-pos)),out,(short)(lo-wanted),(short)(hi-lo));
            return next;
        }
        position(p,index,physical);
        while(len>0) {
            short relative=(short)(physical-DATA),n=(short)(128-relative%128);
            if(n>len)n=len;
            pos=emit(md,p,physical,n,out,wanted,limit,pos);
            len-=n;
            if(len>0)physical=forward(p,index,physical,n);
        }
        return pos;
    }
    public static short render(byte[] p,byte[] proofs,short index,MessageDigest md,byte[] out,short wanted,short limit,boolean descriptor) {
        structure(p,index);
        short pos=0,head=h(index),mint=Util.getShort(p,MLEN);
        pos=emit(md,p,DOMAIN,(short)7,out,wanted,limit,pos);
        pos=emit(md,p,KEY,(short)33,out,wanted,limit,pos);
        pos=emit(md,p,NONCE,(short)32,out,wanted,limit,pos);
        pos=emit(md,p,(short)(head+1),(short)8,out,wanted,limit,pos);
        pos=emit(md,p,(short)(head+49),(short)1,out,wanted,limit,pos);
        pos=emit(md,p,(short)(head+9),(short)4,out,wanted,limit,pos);
        pos=emit(md,p,PROFILE,(short)1,out,wanted,limit,pos);
        pos=emit(md,p,MLEN,(short)2,out,wanted,limit,pos);
        pos=emit(md,p,MINT,mint,out,wanted,limit,pos);
        pos=emit(md,p,UNIT,(short)1,out,wanted,limit,pos);
        pos=field(p,index,(short)0,(short)1,md,out,wanted,limit,pos);
        short count=u(get(p,index,(short)0)),inputRef=address(p,index,(short)1);
        for(short i=0;i<count;i++) {
            short ref=(short)(1+5*i),slot=u(p[inputRef]),base=(short)(slot*82),reg=registry(p,u(p[(short)(MAP+slot)]));
            pos=fieldCursor(p,index,ref,inputRef,(short)5,md,out,wanted,limit,pos);
            pos=emit(md,proofs,(short)(base+9),(short)4,out,wanted,limit,pos);
            pos=emit(md,p,reg,(short)(1+u(p[reg])),out,wanted,limit,pos);
            pos=emit(md,proofs,(short)(base+13),(short)65,out,wanted,limit,pos);
            if((short)(i+1)<count)inputRef=forward(p,index,inputRef,(short)5);
        }
        short start=outputStart(p,index),outputs=u(get(p,index,(short)(start-1)));
        pos=field(p,index,(short)(start-1),(short)1,md,out,wanted,limit,pos);
        short outputRef=address(p,index,start);
        for(short i=0;i<outputs;i++) {
            short off=(short)(start+38*i),reg=registry(p,u(p[forward(p,index,outputRef,(short)4)]));
            pos=fieldCursor(p,index,off,outputRef,(short)4,md,out,wanted,limit,pos);
            pos=emit(md,p,reg,(short)(1+u(p[reg])),out,wanted,limit,pos);
            pos=fieldCursor(p,index,(short)(off+5),forward(p,index,outputRef,(short)5),(short)33,md,out,wanted,limit,pos);
            if((short)(i+1)<outputs)outputRef=forward(p,index,outputRef,(short)38);
        }
        pos=field(p,index,signatureStart(p,index),(short)(descriptor?128:64),md,out,wanted,limit,pos);
        return pos;
    }
    public static void hash(byte[] p,byte[] proofs,short index,MessageDigest md,byte[] work,boolean tagged) {
        data(work.length>=128 && work!=p && work!=proofs);
        md.reset();
        if(tagged) {
            md.update(p,TAG,(short)32);
            md.update(p,TAG,(short)32);
        }
        short length=render(p,proofs,index,md,work,(short)0,(short)0,false),remaining=(short)(length%128);
        if(remaining>0)md.update(work,(short)0,remaining);
        md.doFinal(work,(short)0,(short)0,work,(short)0);
    }
    public static void rememberHash(byte[] p,short index,byte[] work) {
        copy(work,(short)0,p,(short)(h(index)+17),(short)32);
    }
    public static void publish(byte[] p,short index) {
        require(p[h(index)]==STAGING);
        put(p,h(index),COMMITTED);
        /* SIM-CUT published */
    }
    private static void release(byte[] p,short index) {
        for(short i=0;i<PAGES;i++)if(u(p[(short)(OWNER+i)])==(short)(index+1)) {
            put(p,(short)(OWNER+i),(byte)0);
            /* SIM-CUT page-release */
        }
        put(p,h(index),FREE);
    }
    public static void recover(byte[] p,byte[] proofs,MessageDigest md,byte[] work,short active) {
        for(short index=0;index<64;index++) {
            byte state=p[h(index)];
            if(state==FREE)continue;
            if(state==STAGING) {
                if(active!=(short)(index+1))release(p,index);
                continue;
            }
            if(state==RELEASING) {
                release(p,index);
                continue;
            }
            require(state==COMMITTED || state==CLEARING);
            if(state==COMMITTED && p[(short)(h(index)+50)]==1)continue;
            inputs(p,proofs,index,state,work);
            hash(p,proofs,index,md,work,false);
            require(equal(work,(short)0,p,(short)(h(index)+17),(short)32));
            short count=u(get(p,index,(short)0));
            for(short i=0;i<count;i++) {
                short slot=u(get(p,index,(short)(1+5*i))),at=(short)(slot*82);
                byte target=(byte)(state==COMMITTED?2:0);
                if(proofs[at]!=target) {
                    put(proofs,at,target);
                    if(state==COMMITTED) {
                        /* SIM-CUT burn-slot */
                    }
                    else {
                        /* SIM-CUT clear-slot */
                    }
                }
            }
            if(state==COMMITTED) {
                put(p,(short)(h(index)+50),(byte)1);
                // SIM-CUT burn-complete
            }
            if(state==CLEARING) {
                put(p,h(index),RELEASING);
                /* SIM-CUT releasing */ release(p,index);
            }
        }
    }
    public static void verifyCommitted(byte[] p,byte[] proofs,short index,MessageDigest md,byte[] work) {
        require(p[h(index)]==COMMITTED && p[(short)(h(index)+50)]==1);
        inputs(p,proofs,index,COMMITTED,work);
        hash(p,proofs,index,md,work,false);
        require(equal(work,(short)0,p,(short)(h(index)+17),(short)32));
    }
    public static short scope(byte[] p,short index,byte[] out) {
        short head=h(index);
        require(p[head]==COMMITTED);
        out[0]=(byte)index;
        Util.arrayCopyNonAtomic(p,(short)(head+1),out,(short)1,(short)12);
        Util.arrayCopyNonAtomic(p,(short)(head+17),out,(short)13,(short)32);
        return 45;
    }
    public static short retire(byte[] p,byte[] b,short at,short len) {
        data(len==45);
        short index=u(b[at]),head=h(index);
        require(p[head]==COMMITTED);
        require(equal(p,(short)(head+1),b,(short)(at+1),(short)12) && equal(p,(short)(head+17),b,(short)(at+13),(short)32));
        put(p,head,CLEARING);
        return index;
    }
    public static short export(byte[] p,byte[] proofs,short index,short off,short count,byte[] out) {
        require(p[h(index)]==COMMITTED);
        data(count>0 && count<=255 && off>=0);
        short total=render(p,proofs,index,null,out,off,count,true);
        data(off<total);
        short remain=(short)(total-off);
        return remain<count?remain:count;
    }
    public static short status(byte[] p,byte[] proofs,byte[] out,short active) {
        short free=0,pages=0,unspent=0,spent=0;
        for(short i=0;i<64;i++)if(p[h(i)]==FREE)free++;
        for(short i=0;i<PAGES;i++)if(p[(short)(OWNER+i)]==0)pages++;
        for(short i=0;i<128;i++) {
            if(proofs[(short)(i*82)]==1)unspent++;
            if(proofs[(short)(i*82)]==2)spent++;
        }
        out[0]=(byte)free;
        out[1]=(byte)pages;
        out[2]=(byte)unspent;
        out[3]=(byte)spent;
        out[4]=(byte)(128-unspent-spent);
        out[5]=(byte)active;
        return 6;
    }
}
