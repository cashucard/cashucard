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
 * app opens the app and a phone without it opens the page. The address is the card maker's, given to the tag when it is
 * installed (below); nothing in this package names one. Since D222 the address is never the same twice for a card that
 * is set up, so that a reader cannot follow a card by its tag, while the owner's phone can still tell its own card:
 *
 *     <address>#new                     a card with no owner or no holder's record (new, or reset)
 *     <address>#<R><M>                  a card with an owner and a holder's record
 *
 * R is 16 bytes of the chip's secure random, drawn afresh at each selection of the tag, and M the first 8 bytes of
 * HMAC-SHA256(K, R), K = SHA-256("CashuCard/tag-address" || c), c the card's secret of D202, which the owner's phone kept
 * when it gave it to the card or read it; both in lowercase hex, 32 and 16 characters. The card's applet makes them (`TagSwitch.tagCode`):
 * this applet holds no key. It is a well-known URI record, prefix code 04 ("https://") and then the rest as text (NDEF
 * below).
 *
 * The address comes in the install command's parameters (GlobalPlatform's C9, which the runtime hands to `install` as the
 * applet's data): the whole address in ASCII, 9 to 127 bytes, beginning with the eight bytes "https://", the byte after
 * them a letter or a digit, and every byte a printable ASCII character that may stand in a URI outside a fragment (21 to
 * 7E, but not " # < > \ ^ ` { | }). An install with no address, or with one that breaks a rule, is refused (6A80 from
 * `install`, which the chip passes on to INSTALL or reports as its own error) and no tag is made: there is no address to
 * fall back on, since any default would be somebody's site. A card maker that wants no tag leaves the tag out of the install.
 * The address is kept in persistent memory, written once at install and never again.
 *
 * The applet is instantiated under the NFC Forum's own name, D2 76 00 00 85 01 01, given as the instance AID at install
 * (its class AID in the package is F0 43 41 53 48 55 43 41 52 44 54), since phones select the tag application by that
 * name. It answers exactly this and nothing else:
 *
 *     SELECT by name                  9000, no data (the runtime's); the address of this selection made
 *     SELECT file  00 A4 00 0C 02 E1 03 or E1 04   9000; any other file 6A82; other P1 or P2 6B00; Lc not 2 6700
 *     READ BINARY  00 B0 <offset> <Le>             the bytes of the file chosen from that offset, as many as asked
 *                                                  and the file holds (and the APDU buffer, less the 24 bytes of a
 *                                                  code at its end); an offset at or past the end 6B00; no file chosen 6986
 *     UPDATE BINARY (D6), and the other instructions that write   6982
 *     any other instruction           6D00 (and a class other than 00: 6E00)
 *
 * It keeps no secret and no state of its own but its address and this selection's, in one byte of transient memory that goes with the
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
 * before the package. The statics here are constants made when the package is loaded; the address is an instance's.
 */
public final class Tag extends Applet {
    /** The card's applet (`CashuApplet`): F0 43 41 53 48 55 43 41 52 44 ("CASHUCARD"), the package's name, and 01. Must match applet/build.xml (TagLookupTest). */
    private static final byte[] CARD_AID = {
        (byte) 0xF0, 'C', 'A', 'S', 'H', 'U', 'C', 'A', 'R', 'D', (byte) 0x01 };

    /** The capability container (file E103), 15 bytes; bytes 11 and 12, the NDEF file's largest size, are the address's (readBinary). */
    private static final byte[] CC = {
        0x00, 0x0F,             // CCLEN: this file is 15 bytes
        0x20,                   // mapping version 2.0
        0x00, 0x3B,             // MLe: the most a READ BINARY may be answered with, 59
        0x00, 0x34,             // MLc: the most an UPDATE BINARY may carry, 52 (nothing is written here)
        0x04, 0x06,             // the NDEF file control TLV: tag 04, six bytes
        (byte) 0xE1, 0x04,      //   the file is E104
        0x00, 0x00,             //   at most HEAD + the address + 1 + 48 bytes (the address with a code): readBinary
        0x00,                   //   read access: free
        (byte) 0xFF             //   write access: never
    };
    /** The NDEF file's head: NLEN (2), the record's header D1, type length 01, the payload's length, type "U" and prefix code 04. */
    private static final short HEAD = (short) 7;
    /** "https://", which prefix code 04 stands for and every address begins with. */
    private static final byte[] HTTPS = { 'h', 't', 't', 'p', 's', ':', '/', '/' };
    /** The fragment of a card with no owner or no record. */
    private static final byte[] NEW = { 'n', 'e', 'w' };
    /** The bytes that may not be in an address (a fragment is the card's, and these may not stand in a URI). */
    private static final byte[] BARRED = { '"', '#', '<', '>', '\\', '^', '`', '{', '|', '}' };
    /** The address, whole, with https://: at most 127 bytes, so that every length in the install command and the record is one byte. */
    private static final short ADDRESS_MAX = (short) 127;
    private static final short CODE_LEN = (short) 24, CODE_HEX = (short) 48;

    /** chosen[0]: the file chosen (FILE_*), and CODED where this selection's address carries a code. */
    private static final byte FILE_NONE = 0, FILE_CC = 1, FILE_NDEF = 2, FILE_MASK = 0x0F, CODED = 0x10;
    /** Where in the APDU buffer the card's applet works the code out (96 bytes, cleared after): clear of the SELECT's. */
    private static final short WORK_AT = (short) 32;

    /** The file chosen and whether the address carries a code, in one byte of transient memory: gone with the selection. */
    private final byte[] chosen;
    /** The address after "https://", as the install gave it: written once, in the constructor. */
    private final byte[] address;

    /**
     * bArray from bOffset: the instance AID's length and the AID, the control information's length and it, then the applet's
     * data, the install parameters' length and the address (the class comment has its rules).
     */
    public static void install(byte[] bArray, short bOffset, byte bLength) {
        // every length is held to the bytes the runtime gave (bLength), so a short or inconsistent install is 6A80 too
        short last = (short)(bOffset + (bLength & 0xFF));
        short at = (short)(bOffset + 1 + (bArray[bOffset] & 0xFF));
        if (at >= last) ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        at = (short)(at + 1 + (bArray[at] & 0xFF));
        if (at >= last) ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        short n = (short)(bArray[at] & 0xFF);
        at++;
        if (n < (short)(HTTPS.length + 1) || n > ADDRESS_MAX || (short)(at + n) > last
                || Util.arrayCompare(bArray, at, HTTPS, (short) 0, (short) HTTPS.length) != 0) {
            ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        }
        short rest = (short)(at + HTTPS.length), end = (short)(at + n);
        byte first = bArray[rest];
        if (!((first >= '0' && first <= '9') || (first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z'))) {
            ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        }
        for (short i = rest; i < end; i++) {
            byte b = bArray[i];
            if (b < (byte) 0x21 || b > (byte) 0x7E) ISOException.throwIt(ISO7816.SW_WRONG_DATA);
            for (short j = 0; j < (short) BARRED.length; j++) {
                if (b == BARRED[j]) ISOException.throwIt(ISO7816.SW_WRONG_DATA);
            }
        }
        // under the instance AID the install command gives (the NFC Forum's), and not the class's own
        new Tag(bArray, rest, (short)(end - rest)).register(bArray, (short)(bOffset + 1), bArray[bOffset]);
    }

    private Tag(byte[] from, short at, short length) {
        chosen = JCSystem.makeTransientByteArray((short) 1, JCSystem.CLEAR_ON_DESELECT);
        address = new byte[length];
        Util.arrayCopy(from, at, address, (short) 0, length);
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

    /** The NDEF file's size: its head, the address, '#', and "new" or the code in hex. */
    private short ndefSize(boolean coded) {
        return (short)(HEAD + address.length + 1 + (coded ? CODE_HEX : (short) NEW.length));
    }

    /** READ BINARY: P1 and P2 are the offset into the file chosen. */
    private void readBinary(APDU apdu, byte[] buf) {
        byte file = (byte)(chosen[0] & FILE_MASK);
        boolean coded = (chosen[0] & CODED) != 0;
        short size;
        if (file == FILE_CC) size = (short) CC.length;
        else if (file == FILE_NDEF) size = ndefSize(coded);
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
        // the code, where there is one, is put at the buffer's end and the answer written from 0, so the answer stops short of it
        short codeAt = (short)(buf.length - CODE_LEN);
        if (length > codeAt) length = codeAt;
        if (file == FILE_NDEF && coded) {
            // the code the card's applet made at this selection
            TagSwitch c = card();
            if (c == null) ISOException.throwIt(ISO7816.SW_CONDITIONS_NOT_SATISFIED);
            c.tagCodeCopy(buf, codeAt);
        }
        short n = (short) address.length, tail = (short)(HEAD + n + 1);
        for (short i = 0; i < length; i++) {
            short at = (short)(offset + i);
            byte out;
            if (file == FILE_CC) {
                out = at == (short) 12 ? (byte) ndefSize(true) : CC[at];   // byte 11 stays 00: the file is under 256 bytes
            } else if (at == (short) 0) {
                out = 0;
            } else if (at == (short) 1) {
                out = (byte)(size - 2);             // NLEN
            } else if (at == (short) 2) {
                out = (byte) 0xD1;                  // one record: first and last, short, well-known type
            } else if (at == (short) 3) {
                out = 0x01;                         // type length 1
            } else if (at == (short) 4) {
                out = (byte)(size - HEAD + 1);      // the payload: prefix code, the address, '#', the fragment
            } else if (at == (short) 5) {
                out = 0x55;                         // type "U": a URI
            } else if (at == (short) 6) {
                out = 0x04;                         // prefix code 4: "https://"
            } else if (at < (short)(tail - 1)) {
                out = address[(short)(at - HEAD)];
            } else if (at == (short)(tail - 1)) {
                out = '#';
            } else if (!coded) {
                out = NEW[(short)(at - tail)];
            } else {
                short h = (short)(at - tail);
                byte b = buf[(short)(codeAt + (short)(h >> 1))];
                short v = (short)((h & 1) == 0 ? (b >> 4) & 0x0F : b & 0x0F);
                out = (byte)(v < (short) 10 ? (short)(v + 0x30) : (short)(v + 0x57));   // '0' to '9', 'a' to 'f'
            }
            buf[i] = out;
        }
        if (file == FILE_NDEF && coded) Util.arrayFillNonAtomic(buf, codeAt, CODE_LEN, (byte) 0);
        apdu.setOutgoingLength(length);
        apdu.sendBytes((short) 0, length);
    }
}
