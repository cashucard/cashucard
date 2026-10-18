package me.flashapp.hello;

import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.Util;

/**
 * The provisioner's smoke test (ENG-738): a package of one applet that does
 * nothing but say HELLO, so a phone can prove the transport (the secure
 * channel, a LOAD of several blocks, an INSTALL, a DELETE) before it sends the
 * card's real 20 KB file.
 *
 * Package F0 "CASHHELLO" (F04341534848454C4C4F), applet ...01. INS 01 answers
 * the five bytes HELLO; every other command 6D00. It is small, so it installs
 * as its package's first instance on the J3R180 (docs/FOXY-CARD-HARDWARE.md),
 * and it is deleted again at the end of every smoke run. It holds nothing.
 */
public final class Hello extends Applet {
    private static final byte INS_HELLO = (byte) 0x01;
    private static final byte[] HELLO = {(byte) 'H', (byte) 'E', (byte) 'L', (byte) 'L', (byte) 'O'};

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        // under the instance AID the install command gives
        new Hello().register(bArray, (short) (bOffset + 1), bArray[bOffset]);
    }

    private Hello() {
    }

    public void process(APDU apdu) {
        if (selectingApplet()) {
            return;
        }
        byte[] buffer = apdu.getBuffer();
        if (buffer[ISO7816.OFFSET_INS] != INS_HELLO) {
            ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
        }
        short length = Util.arrayCopyNonAtomic(HELLO, (short) 0, buffer, (short) 0, (short) HELLO.length);
        apdu.setOutgoingAndSend((short) 0, length);
    }
}
