package me.flashapp.cashu;
import javacard.security.MessageDigest;
/** Host-only named-boundary interruption. This class is never part of a CAP. */
public final class CompactCut {
    public static String target;
    public static boolean fired;
    public static int pageHops, writes, cutWrite, digestCalls, digestBytes, digestSmallCalls;
    public static byte[] pool;
    public static void digestUpdate(MessageDigest md,byte[] b,short at,short len) {
        digestCalls++;
        digestBytes+=len;
        if(len<32)digestSmallCalls++;
        md.update(b,at,len);
    }
    public static short next(byte value) {
        pageHops++;
        return (short)(value & 255);
    }
    public static void write(byte[] array) {
        if(array!=pool)return;
        writes++;
        if(cutWrite>0 && writes==cutWrite) {
            cutWrite=0;
            fired=true;
            throw new IllegalStateException("simulated byte-write cut");
        }
    }
    public static void check(String label) {
        if(label.equals(target)) {
            target=null;
            fired=true;
            throw new IllegalStateException("simulated boundary cut");
        }
    }
}
