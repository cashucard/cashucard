package me.flashapp.cashu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * D24: the floor of work built into the applet (FLOOR_BITS) is a quarter of the work of the network's blocks at the
 * newest header in spec/vectors/headers.json: four times that header's target, in compact form. The procedure, for a
 * release: add the tip's header to the vectors, and this test says what FLOOR_BITS must be.
 */
class FloorBitsTest {

    /** The target the compact form names. */
    static BigInteger target(long bits) {
        return CashuAppletTest.targetOf(bits);
    }

    /** The compact form of a target, as Bitcoin writes it: a mantissa of three bytes without its top bit, and the size. */
    static long compact(BigInteger t) {
        int size = (t.bitLength() + 7) / 8;
        long mantissa = size <= 3 ? t.shiftLeft(8 * (3 - size)).longValue() : t.shiftRight(8 * (size - 3)).longValue();
        if ((mantissa & 0x00800000L) != 0) { mantissa >>= 8; size++; }
        return ((long) size << 24) | mantissa;
    }

    @Test
    @DisplayName("FLOOR_BITS is four times the target of the newest mainnet header in spec/vectors/headers.json: a quarter of its work")
    void theFloorIsAQuarterOfTheNewestHeadersWork() throws Exception {
        String json = new String(Files.readAllBytes(ClockWalkTest.headersJson()), StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\"height\": (\\d+), \"hash\": \"[0-9a-f]{64}\", \"time\": \\d+, \"bits\": \"([0-9a-f]{8})\"").matcher(json);
        long newestHeight = -1, newestBits = 0;
        while (m.find()) {
            long h = Long.parseLong(m.group(1));
            if (h > newestHeight) { newestHeight = h; newestBits = Long.parseLong(m.group(2), 16); }
        }
        assertTrue(newestHeight > 0, "headers in the vectors");
        long floor = compact(target(newestBits).shiftLeft(2));
        long built = CashuAppletTest.readUint32(CashuAppletTest.reversed(CashuAppletTest.BUILT_FLOOR), 0);
        assertEquals(Long.toHexString(floor), Long.toHexString(built),
            "FLOOR_BITS (little-endian in the applet) against four times the target of height " + newestHeight);
        assertEquals(0x17087BC0L, built, "D24 records the value");
    }

    @Test
    @DisplayName("the compact form is Bitcoin's: genesis's 1d00ffff, the network's 17021ef0, and a mantissa whose top bit would be set moves up a byte")
    void theCompactFormIsBitcoins() {
        assertEquals(0x1d00ffffL, compact(target(0x1d00ffffL)));
        assertEquals(0x17021ef0L, compact(target(0x17021ef0L)));
        assertEquals(0x17087bc0L, compact(target(0x17021ef0L).shiftLeft(2)));
        assertEquals(0x04008000L, compact(BigInteger.valueOf(0x800000L)));
    }
}
