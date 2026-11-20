package me.flashapp.cashu;

import javacard.framework.Shareable;

/**
 * What the card's applet tells the tag applet (`Tag`) when the tag applet is selected: whether the card is to
 * answer as an NFC tag, and the code its address carries (D216). The owner switches the tag off and on with SET_TAG; the bit
 * is public (GET_INFO with P1 = 2 says it to anyone, and so does a tag that answers), and the code is what any phone reading
 * the tag is given, a fresh one each time; even so, the card's applet hands this interface only to the tag (the caller's
 * AID must be the tag's, `CashuApplet.getShareableInterfaceObject`), so that no other applet can ask for the code's work.
 *
 * It is asked for at each selection and never kept (see `Tag.select`). It is not public: the two applets are of one
 * package and so of one context, and nothing of another package is to be handed it (a public interface that extends
 * Shareable is also exported by the converter, which adds a component to the load file for nothing).
 */
interface TagSwitch extends Shareable {
    /** True until the card's owner has switched the tag off; true again after RESET_CARD. */
    boolean tagIsOn();

    /**
     * The code the tag's address carries for this selection (D216): on a card with an owner and a holder's record, R (16
     * bytes, fresh from the chip's secure random) and M (8 bytes, HMAC-SHA256 under a key worked out from the card's c), kept
     * by the card's applet in its own working memory, and true; on any other card nothing, and false (the address ends
     * `#new`). w[at .. at + 96) is working room: a room that does not lie inside w answers false before any work, and the room
     * is cleared on every way out. Nothing that lasts is written.
     */
    boolean tagCode(byte[] w, short at);

    /** The code `tagCode` made in this selection, R then M, 24 bytes, copied to to[off]. */
    void tagCodeCopy(byte[] to, short off);
}
