import javax.smartcardio.Card;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.TerminalFactory;

/** Resets the card in the reader: for a reader that has given up on a card and will not speak to it again otherwise. */
public final class CardReset {
    public static void main(String[] a) throws Exception {
        TerminalFactory f = TerminalFactory.getInstance("PC/SC", null, new jnasmartcardio.Smartcardio());
        for (CardTerminal t : f.terminals().list()) {
            if (!t.isCardPresent()) continue;
            Card c = t.connect("*");
            c.disconnect(true);
            System.out.println("reset");
            return;
        }
        System.out.println("no card");
    }
}
