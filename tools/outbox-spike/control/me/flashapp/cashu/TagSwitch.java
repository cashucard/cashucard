package me.flashapp.cashu;

import javacard.framework.Shareable;

/**
 * What the card's applet tells the tag applet (`Tag`) when the tag applet is selected: whether the card is to
 * answer as an NFC tag. The owner switches that off and on with SET_TAG; the bit is public (GET_INFO with P1 = 2 says it to
 * anyone, and so does a tag that answers), so the card's applet hands this interface to any caller.
 *
 * It is asked for at each selection and never kept (see `Tag.select`). It is not public: the two applets are of one
 * package and so of one context, and nothing of another package is to be handed it (a public interface that extends
 * Shareable is also exported by the converter, which adds a component to the load file for nothing).
 */
interface TagSwitch extends Shareable {
    /** True until the card's owner has switched the tag off; true again after RESET_CARD. */
    boolean tagIsOn();
}
