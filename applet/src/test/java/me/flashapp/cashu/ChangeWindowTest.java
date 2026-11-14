package me.flashapp.cashu;

import static me.flashapp.cashu.CashuAppletTest.*;
import static me.flashapp.cashu.KeysetKeysTest.A;
import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Change written back (LOAD_CHANGE) gives the day back only where the day's window that counted it is the one that runs (D196):
 * a bit an opening, set by the payment that made it on a card with a day's limit, cleared for all when a new day begins or the
 * day's limit changes. Change from an earlier day, or made before any limit, gives nothing back.
 */
class ChangeWindowTest {

    @BeforeEach
    void theTestFloor() { useTheTestFloor(); }

    @AfterAll
    static void theBuiltFloor() { useFloor(BUILT_FLOOR); }

    @Test
    @DisplayName("A day of 1,024: yesterday's change of 512, written back today after the whole day was paid, gives nothing back, and 512 more is 6A8F")
    void changeFromAnEarlierDayGivesNothingBack() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        assertEquals(SW_OK, c.limits(1024, 0, 0, 7, 0), "a day of 1,024");
        int p1 = c.put(-1, A.id8(), 1024), p2 = c.put(-1, A.id8(), 1024), p3 = c.put(-1, A.id8(), 512);
        KeysetKeysTest.taught(c, A);
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, p1, 512, A.keyFor(512), null);
        assertEquals(1, c.field("pinMarks")[CashuApplet.PM_COUNTED] & 0xFF, "the opening counted by today's window");
        assertEquals(SW_OK, c.sw(setTimeCommand(T0 + 86_400 + 60)));
        c.tap();
        assertEquals(64, c.pay(p2).getData().length, "1,024 today: the whole day");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_COUNTED] & 0xFF, "a new day: no change owed is this window's");
        assertEquals(SW_OVER_LIMIT, c.pay(p3).getSW(), "the day is spent");
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 512));
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(512)).getSW(), "yesterday's change written back");
        assertEquals(1024, c.spentToday(), "and the day still counts its 1,024");
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(p3).getSW(), "512 more is past the day");
    }

    @Test
    @DisplayName("Change made before the owner set a day's limit gives nothing back to the day the limit began")
    void changeMadeBeforeTheLimitGivesNothingBack() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        int p1 = c.put(-1, A.id8(), 1024), p2 = c.put(-1, A.id8(), 1024), p3 = c.put(-1, A.id8(), 512);
        KeysetKeysTest.taught(c, A);
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, p1, 512, A.keyFor(512), null);
        c.tap();
        c.grant();
        assertEquals(SW_OK, c.limits(1024, 0, 0, 7, 0));
        c.tap();
        assertEquals(64, c.pay(p2).getData().length);
        assertEquals(SW_OVER_LIMIT, c.pay(p3).getSW());
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 512));
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(512)).getSW());
        assertEquals(1024, c.spentToday(), "nothing given back");
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(p3).getSW());
    }

    @Test
    @DisplayName("A day's limit changed by the owner begins a day with no change of its own: the change counted before it gives nothing back to the new day")
    void changeBeforeANewLimitGivesNothingBack() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        assertEquals(SW_OK, c.limits(1024, 0, 0, 7, 0), "a day of 1,024");
        int p1 = c.put(-1, A.id8(), 1024), p2 = c.put(-1, A.id8(), 1024), p3 = c.put(-1, A.id8(), 1024), p4 = c.put(-1, A.id8(), 512);
        KeysetKeysTest.taught(c, A);
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, p1, 512, A.keyFor(512), null);
        assertEquals(1, c.field("pinMarks")[CashuApplet.PM_COUNTED] & 0xFF, "counted by the day of 1,024");
        c.tap();
        c.grant();
        assertEquals(SW_OK, c.limits(2048, 0, 0, 7, 0), "a new day's limit: a new window with nothing counted");
        assertEquals(0, c.field("pinMarks")[CashuApplet.PM_COUNTED] & 0xFF, "and no change owed is its");
        c.tap();
        assertEquals(64, c.pay(p2, p3).getData().length, "the new day's 2,048");
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 512));
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(512)).getSW());
        assertEquals(2048, c.spentToday(), "nothing given back");
        c.tap();
        assertEquals(SW_OVER_LIMIT, c.pay(p4).getSW());
    }

    @Test
    @DisplayName("Change counted today is given back today: a day of 1,024, 1,024 paid with 512 of change, the change written back, and 512 more goes")
    void changeOfTodayIsGivenBack() throws Exception {
        UnitsTest.Card c = KeysetKeysTest.card();
        assertEquals(SW_OK, c.limits(1024, 0, 0, 7, 0));
        int p1 = c.put(-1, A.id8(), 1024), p3 = c.put(-1, A.id8(), 512);
        KeysetKeysTest.taught(c, A);
        c.tap();
        byte[] row = KeysetKeysTest.payWithChange(c, p1, 512, A.keyFor(512), null);
        assertEquals(1024, c.spentToday(), "the piece whole");
        c.power();
        assertEquals(SW_OK, KeysetKeysTest.show(c, row[0], A, 512));
        assertEquals(SW_OK, KeysetKeysTest.loadChange(c, row, A.privFor(512)).getSW());
        assertEquals(512, c.spentToday(), "the change back");
        c.tap();
        assertEquals(64, c.pay(p3).getData().length, "and 512 more goes");
    }
}
