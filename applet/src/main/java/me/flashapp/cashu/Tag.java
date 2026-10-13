package me.flashapp.cashu;

import javacard.framework.AID;
import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Shareable;

/**
 * The card as an NFC Forum Type 4 Tag (mapping version 2.0), read only, carrying one web address.
 *
 * A phone with its screen on reads NFC tags by itself and offers to open the address a tag holds. Every
 * card carries the same one, so that a phone with the app opens the app and a phone without it opens the
 * page:
 *
 *     https://getfoxy.io/card
 *
 * There is nothing per card in it and never will be: an address that named the card would be an
 * identifier anyone could read with no PIN. It is a well-known URI record, prefix code 04 ("https://")
 * and then the rest as text (NDEF below); the address is stated here once and nothing is derived from it
 * at run time.
 *
 * The applet is instantiated under the NFC Forum's own name, D2 76 00 00 85 01 01, given as the instance
 * AID at install (its class AID in the package is F0 46 4F 58 59 43 41 52 44 54), since phones select the
 * tag application by that name. It answers exactly this and nothing else:
 *
 *     SELECT by name                  9000, no data (the runtime's)
 *     SELECT file  00 A4 00 0C 02 E1 03 or E1 04   9000; any other file 6A82; other P1 or P2 6B00; Lc not 2 6700
 *     READ BINARY  00 B0 <offset> <Le>             the bytes of the file chosen from that offset, as many as asked
 *                                                  and the file holds; an offset at or past the end 6B00; no file chosen 6986
 *     UPDATE BINARY (D6), and the other instructions that write   6982
 *     any other instruction           6D00 (and a class other than 00: 6E00)
 *
 * It keeps no secret and no state of its own but the file chosen, one byte of transient memory that goes
 * with the selection. Whether the tag is on is the card's owner's to say (SET_TAG in `CashuApplet`): at
 * each selection this applet asks the card's applet through a shareable interface (`TagSwitch`), looked up
 * then and never kept, and when the tag is off `select` answers false, so the card refuses the tag's name
 * and a phone sees no tag. If the card's applet is not there the tag is on.
 *
 * No static field of this package may refer to an object that an applet instance made: the chip refuses
 * to delete an instance that is referred to so, and the instances are deleted one by one (the tag, the
 * card's applet, the opener) before the package. The statics here are constants made when the package is
 * loaded.
 */
public final class Tag extends Applet {
    /** The card's applet (`CashuApplet`): F0 46 4F 58 59 43 41 52 44, the package's name, and 01. */
    private static final byte[] CARD_AID = {
        (byte) 0xF0, 'F', 'O', 'X', 'Y', 'C', 'A', 'R', 'D', (byte) 0x01 };

    /** The capability container (file E103), 15 bytes. */
    private static final byte[] CC = {
        0x00, 0x0F,             // CCLEN: this file is 15 bytes
        0x20,                   // mapping version 2.0
        0x00, 0x3B,             // MLe: the most a READ BINARY may be answered with, 59
        0x00, 0x34,             // MLc: the most an UPDATE BINARY may carry, 52 (nothing is written here)
        0x04, 0x06,             // the NDEF file control TLV: tag 04, six bytes
        (byte) 0xE1, 0x04,      //   the file is E104
        0x00, 0x16,             //   at most 22 bytes
        0x00,                   //   read access: free
        (byte) 0xFF             //   write access: never
    };

    /** The NDEF file (E104), 22 bytes: its message's length, then the message. */
    private static final byte[] NDEF = {
        0x00, 0x14,             // NLEN: the message is 20 bytes
        (byte) 0xD1,            // one record: first and last, short, well-known type
        0x01, 0x10,             //   type length 1, payload 16 bytes
        0x55,                   //   type "U": a URI
        0x04,                   //   prefix code 4: "https://"
        'g', 'e', 't', 'f', 'o', 'x', 'y', '.', 'i', 'o', '/', 'c', 'a', 'r', 'd'
    };

    private static final byte FILE_NONE = 0, FILE_CC = 1, FILE_NDEF = 2;

    /** The file chosen, in one byte of transient memory (FILE_*): gone with the selection. */
    private final byte[] chosen;

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        // under the instance AID the install command gives (the NFC Forum's), and not the class's own
        new Tag().register(bArray, (short)(bOffset + 1), bArray[bOffset]);
    }

    private Tag() {
        chosen = JCSystem.makeTransientByteArray((short) 1, JCSystem.CLEAR_ON_DESELECT);
    }

    /**
     * Asked at each selection: is the card's tag on? The card's applet is looked up by its name and its
     * shareable interface asked, and nothing of either is kept. Off, the selection is refused.
     */
    public boolean select() {
        AID card = JCSystem.lookupAID(CARD_AID, (short) 0, (byte) CARD_AID.length);
        if (card != null) {
            Shareable s = JCSystem.getAppletShareableInterfaceObject(card, (byte) 0);
            if (s != null && !((TagSwitch) s).tagIsOn()) return false;
        }
        chosen[0] = FILE_NONE;
        return true;
    }

    public void process(APDU apdu) {
        if (selectingApplet()) return;
        byte[] buf = apdu.getBuffer();
        if (buf[ISO7816.OFFSET_CLA] != (byte) 0x00) ISOException.throwIt(ISO7816.SW_CLA_NOT_SUPPORTED);
        switch (buf[ISO7816.OFFSET_INS]) {
            case (byte) 0xA4:
                chooseFile(apdu, buf);
                break;
            case (byte) 0xB0:
                readBinary(apdu, buf);
                break;
            // the instructions that write (ISO 7816-4): erase, write and update binary, put data, update and append record
            case (byte) 0x0E: case (byte) 0xD0: case (byte) 0xD6: case (byte) 0xD7: case (byte) 0xDA:
            case (byte) 0xDB: case (byte) 0xDC: case (byte) 0xDD: case (byte) 0xE2:
                ISOException.throwIt(ISO7816.SW_SECURITY_STATUS_NOT_SATISFIED);
                break;
            default:
                ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
        }
    }

    /** SELECT file: P1 = 00, P2 = 0C, and the two bytes of the file's identifier. */
    private void chooseFile(APDU apdu, byte[] buf) {
        if (buf[ISO7816.OFFSET_P1] != (byte) 0x00 || buf[ISO7816.OFFSET_P2] != (byte) 0x0C) {
            ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        }
        if (buf[ISO7816.OFFSET_LC] != (byte) 2 || apdu.setIncomingAndReceive() != (short) 2) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        if (buf[ISO7816.OFFSET_CDATA] == (byte) 0xE1 && buf[(short)(ISO7816.OFFSET_CDATA + 1)] == (byte) 0x03) {
            chosen[0] = FILE_CC;
        } else if (buf[ISO7816.OFFSET_CDATA] == (byte) 0xE1 && buf[(short)(ISO7816.OFFSET_CDATA + 1)] == (byte) 0x04) {
            chosen[0] = FILE_NDEF;
        } else {
            ISOException.throwIt(ISO7816.SW_FILE_NOT_FOUND);
        }
    }

    /** READ BINARY: P1 and P2 are the offset into the file chosen. */
    private void readBinary(APDU apdu, byte[] buf) {
        byte[] file;
        if (chosen[0] == FILE_CC) file = CC;
        else if (chosen[0] == FILE_NDEF) file = NDEF;
        else {
            ISOException.throwIt(ISO7816.SW_COMMAND_NOT_ALLOWED);
            return;
        }
        if (buf[ISO7816.OFFSET_P1] < (byte) 0) ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        short offset = (short)(((buf[ISO7816.OFFSET_P1] & 0xFF) << 8) | (buf[ISO7816.OFFSET_P2] & 0xFF));
        if (offset >= (short) file.length) ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        short length = apdu.setOutgoing();
        short left = (short)(file.length - offset);
        if (length > left) length = left;
        apdu.setOutgoingLength(length);
        apdu.sendBytesLong(file, offset, length);
    }
}
