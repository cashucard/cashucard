package me.flashapp.cashu;

import javacard.framework.AID;
import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Shareable;
import javacard.framework.Util;

/**
 * The card as an NFC Forum Type 4 Tag (mapping version 2.0), read only, carrying one web address.
 *
 * A phone with its screen on reads NFC tags by itself and offers to open the address a tag holds, so that a phone with the
 * app opens the app and a phone without it opens the page. Since D216 the address is never the same twice for a card that
 * is set up, so that a reader cannot follow a card by its tag, while the owner's phone can still tell its own card:
 *
 *     https://getfoxy.io/card#new                     a card with no owner or no holder's record (new, or reset)
 *     https://getfoxy.io/card#<R><M>                  a card with an owner and a holder's record
 *
 * R is 16 bytes of the chip's secure random, drawn afresh at each selection of the tag, and M the first 8 bytes of
 * HMAC-SHA256(K, R), K = SHA-256("CashuCard/tag-address" || c), c the card's secret of D202, which the owner's phone kept
 * when it gave it to the card or read it; both in lowercase hex, 32 and 16 characters. The card's applet makes them (`TagSwitch.tagCode`):
 * this applet holds no key. It is a well-known URI record, prefix code 04 ("https://") and then the rest as text (NDEF
 * below).
 *
 * The applet is instantiated under the NFC Forum's own name, D2 76 00 00 85 01 01, given as the instance AID at install
 * (its class AID in the package is F0 43 41 53 48 55 43 41 52 44 54), since phones select the tag application by that
 * name. It answers exactly this and nothing else:
 *
 *     SELECT by name                  9000, no data (the runtime's); the address of this selection made
 *     SELECT file  00 A4 00 0C 02 E1 03 or E1 04   9000; any other file 6A82; other P1 or P2 6B00; Lc not 2 6700
 *     READ BINARY  00 B0 <offset> <Le>             the bytes of the file chosen from that offset, as many as asked
 *                                                  and the file holds; an offset at or past the end 6B00; no file chosen 6986
 *     UPDATE BINARY (D6), and the other instructions that write   6982
 *     any other instruction           6D00 (and a class other than 00: 6E00)
 *
 * It keeps no secret and no state of its own but this selection's, in one byte of transient memory that goes with the
 * selection: the file chosen, and whether the address carries a code. The code itself is kept by the card's applet, in its
 * own working memory (`tagCodeCopy`), so the tag asks the chip for no more transient memory than it did: the card's
 * deselect RAM is a measured ceiling. Every READ BINARY of one selection reads the one address, whatever its offset; the
 * next selection makes another. Nothing is written that lasts. Whether the tag
 * is on is the card's owner's to say (SET_TAG in `CashuApplet`): at each selection this applet asks the card's applet
 * through a shareable interface (`TagSwitch`), looked up then and never kept, and when the tag is off `select` answers
 * false, so the card refuses the tag's name and a phone sees no tag. If the card's applet is not there the tag is on and
 * says `#new`.
 *
 * No static field of this package may refer to an object that an applet instance made: the chip refuses to delete an
 * instance that is referred to so, and the instances are deleted one by one (the tag, the card's applet, the opener)
 * before the package. The statics here are constants made when the package is loaded.
 */
public final class Tag extends Applet {
    /** The card's applet (`CashuApplet`): F0 43 41 53 48 55 43 41 52 44 ("CASHUCARD"), the package's name, and 01. Must match applet/build.xml (TagLookupTest). */
    private static final byte[] CARD_AID = {
        (byte) 0xF0, 'C', 'A', 'S', 'H', 'U', 'C', 'A', 'R', 'D', (byte) 0x01 };

    /** The capability container (file E103), 15 bytes. */
    private static final byte[] CC = {
        0x00, 0x0F,             // CCLEN: this file is 15 bytes
        0x20,                   // mapping version 2.0
        0x00, 0x3B,             // MLe: the most a READ BINARY may be answered with, 59
        0x00, 0x34,             // MLc: the most an UPDATE BINARY may carry, 52 (nothing is written here)
        0x04, 0x06,             // the NDEF file control TLV: tag 04, six bytes
        (byte) 0xE1, 0x04,      //   the file is E104
        0x00, 0x47,             //   at most 71 bytes (the address with a code)
        0x00,                   //   read access: free
        (byte) 0xFF             //   write access: never
    };

    /** The NDEF file (E104) of a card with no owner or no record, 26 bytes: its message's length, then the message. */
    private static final byte[] NDEF_NEW = {
        0x00, 0x18,             // NLEN: the message is 24 bytes
        (byte) 0xD1,            // one record: first and last, short, well-known type
        0x01, 0x14,             //   type length 1, payload 20 bytes
        0x55,                   //   type "U": a URI
        0x04,                   //   prefix code 4: "https://"
        'g', 'e', 't', 'f', 'o', 'x', 'y', '.', 'i', 'o', '/', 'c', 'a', 'r', 'd', '#', 'n', 'e', 'w'
    };

    /** The NDEF file of a set-up card, 71 bytes: these 23, then the code in hex (48). */
    private static final byte[] NDEF_CODE = {
        0x00, 0x45,             // NLEN: the message is 69 bytes
        (byte) 0xD1,            // one record: first and last, short, well-known type
        0x01, 0x41,             //   type length 1, payload 65 bytes
        0x55,                   //   type "U": a URI
        0x04,                   //   prefix code 4: "https://"
        'g', 'e', 't', 'f', 'o', 'x', 'y', '.', 'i', 'o', '/', 'c', 'a', 'r', 'd', '#'
    };
    private static final short CODE_LEN = (short) 24, NDEF_CODE_LEN = (short) (23 + 2 * 24);

    /** chosen[0]: the file chosen (FILE_*), and CODED where this selection's address carries a code. */
    private static final byte FILE_NONE = 0, FILE_CC = 1, FILE_NDEF = 2, FILE_MASK = 0x0F, CODED = 0x10;
    /** Where in the APDU buffer the card's applet works the code out (96 bytes, cleared after): clear of the SELECT's. */
    private static final short WORK_AT = (short) 32;
    /** Where in the APDU buffer a READ BINARY puts the code before it writes the answer from 0 (at most 71 bytes): clear of it. */
    private static final short CODE_AT = (short) 100;

    /** The file chosen and whether the address carries a code, in one byte of transient memory: gone with the selection. */
    private final byte[] chosen;

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        // under the instance AID the install command gives (the NFC Forum's), and not the class's own
        new Tag().register(bArray, (short)(bOffset + 1), bArray[bOffset]);
    }

    private Tag() {
        chosen = JCSystem.makeTransientByteArray((short) 1, JCSystem.CLEAR_ON_DESELECT);
    }

    /** The card's applet's interface, looked up by its name and asked for now; null where the card's applet is not there. Never kept. */
    private static TagSwitch card() {
        AID card = JCSystem.lookupAID(CARD_AID, (short) 0, (byte) CARD_AID.length);
        if (card == null) return null;
        Shareable s = JCSystem.getAppletShareableInterfaceObject(card, (byte) 0);
        return s == null ? null : (TagSwitch) s;
    }

    /** Asked at each selection: is the card's tag on? Off, the selection is refused. */
    public boolean select() {
        TagSwitch c = card();
        if (c != null && !c.tagIsOn()) return false;
        chosen[0] = FILE_NONE;
        return true;
    }

    public void process(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        if (selectingApplet()) {
            // this selection's address: a code where the card's applet gives one (a set-up card), `#new` otherwise
            TagSwitch c = card();
            if (c != null && c.tagCode(buf, WORK_AT)) chosen[0] = CODED;
            return;
        }
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
            chosen[0] = (byte)((chosen[0] & CODED) | FILE_CC);
        } else if (buf[ISO7816.OFFSET_CDATA] == (byte) 0xE1 && buf[(short)(ISO7816.OFFSET_CDATA + 1)] == (byte) 0x04) {
            chosen[0] = (byte)((chosen[0] & CODED) | FILE_NDEF);
        } else {
            ISOException.throwIt(ISO7816.SW_FILE_NOT_FOUND);
        }
    }

    /** READ BINARY: P1 and P2 are the offset into the file chosen. */
    private void readBinary(APDU apdu, byte[] buf) {
        byte file = (byte)(chosen[0] & FILE_MASK);
        boolean coded = (chosen[0] & CODED) != 0;
        short size;
        if (file == FILE_CC) size = (short) CC.length;
        else if (file == FILE_NDEF) size = coded ? NDEF_CODE_LEN : (short) NDEF_NEW.length;
        else {
            ISOException.throwIt(ISO7816.SW_COMMAND_NOT_ALLOWED);
            return;
        }
        if (buf[ISO7816.OFFSET_P1] < (byte) 0) ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        short offset = (short)(((buf[ISO7816.OFFSET_P1] & 0xFF) << 8) | (buf[ISO7816.OFFSET_P2] & 0xFF));
        if (offset >= size) ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        short length = apdu.setOutgoing();
        short left = (short)(size - offset);
        if (length > left) length = left;
        if (file == FILE_CC) {
            Util.arrayCopyNonAtomic(CC, offset, buf, (short) 0, length);
        } else if (!coded) {
            Util.arrayCopyNonAtomic(NDEF_NEW, offset, buf, (short) 0, length);
        } else {
            // the code the card's applet made at this selection, then the file from the offset: its head, then the code in hex
            TagSwitch c = card();
            if (c == null) ISOException.throwIt(ISO7816.SW_CONDITIONS_NOT_SATISFIED);
            c.tagCodeCopy(buf, CODE_AT);
            for (short i = 0; i < length; i++) {
                short at = (short)(offset + i);
                if (at < (short) NDEF_CODE.length) {
                    buf[i] = NDEF_CODE[at];
                } else {
                    short h = (short)(at - NDEF_CODE.length);
                    byte b = buf[(short)(CODE_AT + (short)(h >> 1))];
                    short n = (short)((h & 1) == 0 ? (b >> 4) & 0x0F : b & 0x0F);
                    buf[i] = (byte)(n < (short) 10 ? (short)(n + 0x30) : (short)(n + 0x57));   // '0' to '9', 'a' to 'f'
                }
            }
            Util.arrayFillNonAtomic(buf, CODE_AT, CODE_LEN, (byte) 0);
        }
        apdu.setOutgoingLength(length);
        apdu.sendBytes((short) 0, length);
    }
}
