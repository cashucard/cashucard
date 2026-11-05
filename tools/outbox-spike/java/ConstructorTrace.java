package me.flashapp.cashu;

import javacard.framework.*;
import javacard.security.CryptoException;

/** Private constructor-only evidence. No secret data or allocations. */
final class ConstructorTrace {
    private static byte outcome;
    private static byte stage;
    private static byte kind;
    private static short reason;

    static void reset() { outcome=0; stage=0; kind=0; reason=0; }
    static void before(byte value) { stage=value; outcome=1; }
    static void after(byte value) { stage=value; outcome=2; }
    static void complete() { outcome=4; }
    static void record(CardRuntimeException error) {
        kind = error instanceof CryptoException ? (byte)1
            : error instanceof SystemException ? (byte)2
            : error instanceof TransactionException ? (byte)3
            : error instanceof ISOException ? (byte)4
            : error instanceof PINException ? (byte)5 : (byte)6;
        reason=error.getReason();
        outcome=3;
    }
    static void runtimeFailure() { kind=7; reason=0; outcome=3; }
    static void reply(APDU apdu) {
        byte[] b=apdu.getBuffer();
        b[0]=1; b[1]=outcome; b[2]=stage; b[3]=kind;
        Util.setShort(b,(short)4,reason);
        apdu.setOutgoingAndSend((short)0,(short)6);
    }
}
