package me.flashapp.cashu;
/** Host-only named-boundary interruption. This class is never part of a CAP. */
public final class CompactCut {
    public static String target;
    public static boolean fired;
    public static void check(String label) {
        if(label.equals(target)) {
            target=null;
            fired=true;
            throw new IllegalStateException("simulated boundary cut");
        }
    }
}
