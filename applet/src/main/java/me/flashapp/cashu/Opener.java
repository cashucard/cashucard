package me.flashapp.cashu;

import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;

/**
 * The applet that is instantiated first.
 *
 * The chip this card is built on (NXP J3R180) fails the INSTALL that both
 * instantiates a package for the first time and runs a heavy constructor:
 * `CashuApplet`'s, which makes the card's key and sets the signer up, gets no
 * answer or `6F00` from the chip when it is the package's first, and installs
 * in about a second when it is not (docs/FOXY-CARD-HARDWARE.md). So this
 * applet, which does nothing, is instantiated first, and the card's own is
 * created from the package after it. It answers its SELECT and refuses
 * everything else. It holds nothing and is never spoken to again.
 */
public final class Opener extends Applet {
    public static void install(byte[] bArray, short bOffset, byte bLength) {
        new Opener().register();
    }

    private Opener() {
    }

    public void process(APDU apdu) {
        if (selectingApplet()) return;
        ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
    }
}
