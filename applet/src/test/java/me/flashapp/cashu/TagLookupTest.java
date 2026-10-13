package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javax.smartcardio.CommandAPDU;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The NDEF tag finds the card's applet by a copy of its AID kept in Tag.java (`CARD_AID`), for
 * JCSystem.getAppletShareableInterfaceObject. That copy is the one a change of AID most easily misses, and missing it
 * fails silently: a tag that cannot find the card's applet takes the tag to be on, so the owner's switch does nothing
 * and no test of the card's own commands notices. These tests hold the copy to the new AID (D19): installed under the
 * AIDs applet/build.xml names, the tag follows the card's switch; installed beside a card under Foxy's old AID, it
 * cannot find it and stays on, which is how a missed copy would look.
 */
class TagLookupTest {

    static final String TAG_HEX = TagTest.TAG_HEX;
    static final byte[] TAG_INSTALL = TagTest.TAG_INSTALL;

    private CardSimulator sim;

    private CardSimulator cardAndTag(String cardAid) {
        CardSimulator s = new CardSimulator(new CashuAppletTest.ExposedRuntime());
        s.installApplet(AIDUtil.create(AidVersionTest.PACKAGE + "4D"), Opener.class);
        s.installApplet(AIDUtil.create(cardAid), CashuApplet.class);
        s.installApplet(AIDUtil.create(TAG_HEX), Tag.class, TAG_INSTALL, (short) 0, (byte) TAG_INSTALL.length);
        assertEquals(CashuAppletTest.SW_OK, s.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(cardAid), 256)).getSW());
        return s;
    }

    private int selectTag() {
        return sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(TAG_HEX), 256)).getSW();
    }

    private void selectCard(String aid) {
        assertEquals(CashuAppletTest.SW_OK, sim.transmitCommand(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, CashuAppletTest.hexToBytes(aid), 256)).getSW());
    }

    /** The owner's phone switching the tag off or on: a nonce, a proof over "CashuCard/tag" and the byte. */
    private int switchTag(boolean off) {
        byte[] nonce = sim.transmitCommand(new CommandAPDU(CashuAppletTest.CLA, CashuAppletTest.INS_GET_NONCE, 0, 0, 16)).getData();
        byte[] value = { (byte) (off ? 1 : 0) };
        byte[] proof = CashuAppletTest.ownerProof(CashuAppletTest.L_TAG, CashuAppletTest.OWNER, nonce, value);
        return sim.transmitCommand(CashuAppletTest.setTagCommand(proof, off ? 1 : 0)).getSW();
    }

    @Test
    @DisplayName("Tag.java's copy of the card's AID is F0 CASHUCARD 01, the AID the build installs the card's applet under")
    void theTagsCopyIsTheNewAid() throws Exception {
        java.lang.reflect.Field f = Tag.class.getDeclaredField("CARD_AID");
        f.setAccessible(true);
        assertArrayEquals(CashuAppletTest.hexToBytes(AidVersionTest.APPLET), (byte[]) f.get(null));
    }

    @Test
    @DisplayName("installed under the new AIDs, the tag follows the card: off when the owner switches it off, on again when switched on")
    void theTagFollowsTheCardByTheNewAid() {
        sim = cardAndTag(AidVersionTest.APPLET);
        CashuAppletTest.readyOn(sim, 0);
        assertEquals(CashuAppletTest.SW_OK, selectTag(), "a new card's tag is on");
        selectCard(AidVersionTest.APPLET);
        assertEquals(CashuAppletTest.SW_OK, switchTag(true));
        assertEquals(0x6999, selectTag(), "switched off, the tag refuses its name: it found the card's applet and asked it");
        selectCard(AidVersionTest.APPLET);
        assertEquals(CashuAppletTest.SW_OK, switchTag(false));
        assertEquals(CashuAppletTest.SW_OK, selectTag(), "and on again");
    }

    @Test
    @DisplayName("beside a card under Foxy's old AID, the tag finds no card and stays on whatever the switch says: what a missed copy looks like")
    void aCardUnderTheOldAidIsNotFound() {
        sim = cardAndTag(AidVersionTest.OLD_FOXY_APPLET);
        CashuAppletTest.readyOn(sim, 0);
        selectCard(AidVersionTest.OLD_FOXY_APPLET);
        assertEquals(CashuAppletTest.SW_OK, switchTag(true), "the card takes the switch");
        assertEquals(CashuAppletTest.SW_OK, selectTag(), "but the tag looks the card up by the new AID, finds nothing, and is on");
    }
}
