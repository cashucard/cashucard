package me.flashapp.cashu;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Math-level tests for SchnorrHW's hand-rolled 256-bit modular arithmetic.
 *
 * These deliberately bypass the card/APDU layer and check the primitives
 * directly against java.math.BigInteger, so that a failing BIP-340 signature
 * can be attributed to either the modular arithmetic or the higher-level
 * signing logic rather than guessed at.
 */
class SchnorrHWMathTest {

    /** secp256k1 group order n. */
    private static final BigInteger N = new BigInteger(
        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16);

    private static byte[] to32(BigInteger v) {
        byte[] out = new byte[32];
        byte[] raw = v.toByteArray();
        int len = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - len, out, 32 - len, len);
        return out;
    }

    private static BigInteger from32(byte[] b) {
        return new BigInteger(1, b);
    }

    /** Deterministic seed so failures are reproducible. */
    private static Random rng() {
        return new Random(0xCA54D00DL);
    }

    /**
     * Scratch buffer for mulModN. On-card this is a CLEAR_ON_DESELECT transient
     * array allocated once in the SchnorrHW constructor; here a plain array is
     * fine. Deliberately sized from the constant so a future growth of the
     * arithmetic scratch shows up here rather than as an out-of-bounds read.
     */
    private static byte[] work() {
        return new byte[SchnorrHW.WORK_LEN];
    }

    @Test
    @DisplayName("addModN matches BigInteger (a + b) mod n")
    void addModNMatchesBigInteger() {
        Random r = rng();
        for (int i = 0; i < 200; i++) {
            BigInteger a = new BigInteger(256, r).mod(N);
            BigInteger b = new BigInteger(256, r).mod(N);
            byte[] out = new byte[32];
            SchnorrHW.addModN(to32(a), (short) 0, to32(b), (short) 0, out, (short) 0);
            assertEquals(a.add(b).mod(N), from32(out),
                "addModN mismatch at iteration " + i + " (a=" + a.toString(16)
                    + ", b=" + b.toString(16) + ")");
        }
    }

    @Test
    @DisplayName("mulModN matches BigInteger (a * b) mod n")
    void mulModNMatchesBigInteger() {
        Random r = rng();
        for (int i = 0; i < 200; i++) {
            BigInteger a = new BigInteger(256, r).mod(N);
            BigInteger b = new BigInteger(256, r).mod(N);
            byte[] out = new byte[32];
            SchnorrHW.mulModN(to32(a), (short) 0, to32(b), (short) 0, out, (short) 0,
                work(), (short) 0);
            assertEquals(a.multiply(b).mod(N), from32(out),
                "mulModN mismatch at iteration " + i + " (a=" + a.toString(16)
                    + ", b=" + b.toString(16) + ")");
        }
    }

    @Test
    @DisplayName("mulModN handles edge values (0, 1, n-1)")
    void mulModNEdgeCases() {
        BigInteger[] vals = { BigInteger.ZERO, BigInteger.ONE, N.subtract(BigInteger.ONE),
                              BigInteger.TWO, N.shiftRight(1) };
        for (BigInteger a : vals) {
            for (BigInteger b : vals) {
                byte[] out = new byte[32];
                SchnorrHW.mulModN(to32(a), (short) 0, to32(b), (short) 0, out, (short) 0,
                    work(), (short) 0);
                assertEquals(a.multiply(b).mod(N), from32(out),
                    "mulModN edge mismatch a=" + a.toString(16) + " b=" + b.toString(16));
            }
        }
    }

    /**
     * The odd-y normalisation d = n - d is picked at random by the card's key
     * generation (P.y parity), so the applet-level tests only exercise it about
     * half the time on any given run. This pins the primitive deterministically.
     */
    @Test
    @DisplayName("subtractFromN matches BigInteger n - a")
    void subtractFromNMatchesBigInteger() {
        Random r = rng();
        for (int i = 0; i < 200; i++) {
            BigInteger a = new BigInteger(256, r).mod(N);
            byte[] out = new byte[32];
            SchnorrHW.subtractFromN(to32(a), (short) 0, out, (short) 0);
            assertEquals(N.subtract(a), from32(out),
                "subtractFromN mismatch at iteration " + i + " (a=" + a.toString(16) + ")");
        }
    }

    @Test
    @DisplayName("subtractFromN handles edge values (0, 1, n-1)")
    void subtractFromNEdgeCases() {
        BigInteger[] vals = { BigInteger.ZERO, BigInteger.ONE, BigInteger.TWO,
                              N.subtract(BigInteger.ONE), N.shiftRight(1) };
        for (BigInteger a : vals) {
            byte[] out = new byte[32];
            SchnorrHW.subtractFromN(to32(a), (short) 0, out, (short) 0);
            assertEquals(N.subtract(a), from32(out),
                "subtractFromN edge mismatch a=" + a.toString(16));
        }
    }

    /**
     * Reusing one scratch buffer across calls must not leak state between them:
     * on-card the buffer is a single long-lived transient array, so a helper that
     * reads a stale byte instead of writing it first would only misbehave on the
     * second and later signatures.
     */
    @Test
    @DisplayName("mulModN is correct when the work buffer is reused and pre-dirtied")
    void mulModNReusesWorkBufferSafely() {
        Random r = rng();
        byte[] shared = work();
        java.util.Arrays.fill(shared, (byte) 0xA5);
        for (int i = 0; i < 100; i++) {
            BigInteger a = new BigInteger(256, r).mod(N);
            BigInteger b = new BigInteger(256, r).mod(N);
            byte[] out = new byte[32];
            SchnorrHW.mulModN(to32(a), (short) 0, to32(b), (short) 0, out, (short) 0,
                shared, (short) 0);
            assertEquals(a.multiply(b).mod(N), from32(out),
                "mulModN mismatch on reused work buffer at iteration " + i);
        }
    }

    /**
     * The methods that are allowed to allocate, per source file: everything that
     * runs exactly once at install time. Anything else in these files is
     * reachable from an APDU handler.
     *
     * Entry format: { file name, install-time declaration, ... }. The
     * declarations are matched literally against the comment-stripped source, so
     * they must be unique in it — {@code "private CashuApplet()"} rather than
     * {@code "CashuApplet()"}, which would also hit the {@code new CashuApplet()}
     * inside install().
     *
     * Every .java file under src/main/java/me/flashapp/cashu must appear here;
     * a new one with no entry fails the test rather than slipping through
     * unchecked.
     *
     * "Runs exactly once at install time" is itself enforced, not taken on
     * trust: {@link #assertNoAllocationOutside} requires every unqualified call
     * to a listed method to sit inside another listed method's body. A helper
     * like {@code initCardKeypair()} is only install-time for as long as nobody
     * wires it to an APDU handler, and a whole-body allocation waiver granted on
     * the strength of a comment is exactly how the leak this test guards against
     * would come back.
     */
    private static final String[][] INSTALL_TIME_METHODS = {
        { "SchnorrHW.java",
          "SchnorrHW(", "void init()" },
        { "CashuApplet.java",
          "public static void install(", "private CashuApplet()",
          "private void initCardKeypair()", "private void initPinKey()" },
        // the applet instantiated first, so that the chip takes the card's own (FOXY-CARD-HARDWARE.md): it allocates nothing at all
        { "Opener.java",
          "public static void install(", "private Opener()" },
        // the NFC tag: it allocates one transient byte, in its constructor, and nothing else (and its interface nothing at all)
        { "Tag.java",
          "public static void install(", "private Tag()" },
        { "TagSwitch.java" },
    };

    /**
     * JavaCard Classic allocates `new` in persistent EEPROM/Flash and never
     * collects it, so a single `new byte[]` on an APDU path leaks the card's
     * persistent memory a few dozen bytes per tap until every write command
     * throws. jCardSim runs on the JVM heap with a real GC and therefore cannot
     * surface this — only a source-level check can. It is CONTRIBUTING.md
     * principle 5, and this test is its enforcement.
     *
     * Both applet sources are scanned, not just the signer: {@code CashuApplet}
     * is every bit as much on the APDU path, and a stray {@code byte[] tmp = new
     * byte[64]} inside processLoadProof would leak exactly the same way.
     */
    @Test
    @DisplayName("no applet source allocates outside its install-time methods")
    void noAllocationOutsideInstallTime() throws Exception {
        java.nio.file.Path dir = mainSourceDir();
        java.util.List<java.nio.file.Path> sources;
        try (java.util.stream.Stream<java.nio.file.Path> s = java.nio.file.Files.list(dir)) {
            sources = s.filter(p -> p.getFileName().toString().endsWith(".java"))
                       .sorted()
                       .collect(java.util.stream.Collectors.toList());
        }
        org.junit.jupiter.api.Assertions.assertFalse(sources.isEmpty(),
            "no applet sources found under " + dir.toAbsolutePath());

        java.util.Set<String> scanned = new java.util.HashSet<>();
        for (java.nio.file.Path p : sources) {
            String name = p.getFileName().toString();
            String[] installTime = installTimeMethods(name);
            assertNoAllocationOutside(name,
                new String(java.nio.file.Files.readAllBytes(p),
                    java.nio.charset.StandardCharsets.UTF_8),
                installTime);
            scanned.add(name);
        }

        for (String[] entry : INSTALL_TIME_METHODS) {
            org.junit.jupiter.api.Assertions.assertTrue(scanned.contains(entry[0]),
                "INSTALL_TIME_METHODS names " + entry[0] + ", which no longer exists under "
                + dir.toAbsolutePath() + " — the allow-list is stale");
        }
    }

    /**
     * The guard above is only worth anything if it can say no, so it is pointed
     * at sources written to fail it.
     *
     * The waived-helper leak is the one this exists for: {@code initThing()}
     * allocates and is allow-listed, which is fine while only the constructor
     * calls it. The moment an APDU handler calls it too, every tap allocates a
     * new array in EEPROM — and the allocation itself never moved, so the plain
     * allocation scan stays green. Only the call-site check catches it.
     */
    @Test
    @DisplayName("the allow-list rejects an install-time helper called from the APDU path")
    void allowListRejectsInstallTimeHelperCalledFromApduPath() {
        String[] allowList = {
            "public static void install(", "private Fake()", "private void initThing()"
        };

        String clean =
            "class Fake {\n"
            + "    private byte[] buf;\n"
            + "    public static void install(byte[] a, short b, byte c) { new Fake(); }\n"
            + "    private Fake() { initThing(); }\n"
            + "    private void initThing() { buf = new byte[64]; }\n"
            + "    private void processApdu() { buf[0] = 1; }\n"
            + "}\n";
        assertNoAllocationOutside("Fake.java", clean, allowList);

        String leaky = clean.replace(
            "private void processApdu() { buf[0] = 1; }",
            "private void processApdu() { initThing(); }");
        org.opentest4j.AssertionFailedError failed =
            org.junit.jupiter.api.Assertions.assertThrows(
                org.opentest4j.AssertionFailedError.class,
                () -> assertNoAllocationOutside("Fake.java", leaky, allowList),
                "an allow-listed allocating helper reached from the APDU path must fail");
        org.junit.jupiter.api.Assertions.assertTrue(failed.getMessage().contains("initThing"),
            "the failure must name the helper that gained an APDU-path caller, got: "
                + failed.getMessage());
    }

    /**
     * A call on another object that merely shares a name with an allow-listed
     * method is not a call to it — {@code ecdh.init(tmpPriv)} in SchnorrHW is
     * exactly that, and flagging it would make the guard unusable.
     */
    @Test
    @DisplayName("the call-site check ignores calls qualified by a receiver")
    void allowListIgnoresQualifiedSameNameCalls() {
        String src =
            "class Fake {\n"
            + "    private byte[] buf;\n"
            + "    private Other other;\n"
            + "    public static void install(byte[] a, short b, byte c) { new Fake(); }\n"
            + "    private Fake() { initThing(); }\n"
            + "    private void initThing() { buf = new byte[64]; }\n"
            + "    private void processApdu() { other.initThing(); }\n"
            + "}\n";
        assertNoAllocationOutside("Fake.java", src, new String[] {
            "public static void install(", "private Fake()", "private void initThing()"
        });
    }

    /** The install-time declarations registered for a source file. */
    private static String[] installTimeMethods(String fileName) {
        for (String[] entry : INSTALL_TIME_METHODS) {
            if (entry[0].equals(fileName)) {
                return java.util.Arrays.copyOfRange(entry, 1, entry.length);
            }
        }
        throw new org.opentest4j.AssertionFailedError(
            fileName + " is on the APDU path but has no entry in INSTALL_TIME_METHODS. "
            + "Add one listing the methods that run once at install time (constructor, "
            + "install(), anything called only from them) so the rest of the file is "
            + "checked for persistent-memory allocation.");
    }

    /**
     * Fails if the source allocates anywhere inside a method body other than the
     * given install-time declarations.
     */
    private static void assertNoAllocationOutside(String fileName, String rawSrc,
                                                  String[] installTimeDeclarations) {
        String src = stripCommentsAndCharLiterals(rawSrc);

        int[][] allowedRanges = new int[installTimeDeclarations.length][];
        for (int i = 0; i < installTimeDeclarations.length; i++) {
            allowedRanges[i] = bodyRange(src, installTimeDeclarations[i]);
        }

        assertOnlyCalledAtInstallTime(fileName, src, installTimeDeclarations, allowedRanges);

        // `new byte[..]` plus the array-initializer form `byte[] x = { .. }`,
        // which allocates just the same but contains no `new` keyword.
        java.util.regex.Pattern allocation = java.util.regex.Pattern.compile(
            "\\bnew\\b"
            + "|\\b(?:byte|short|int|boolean|Object)\\s*\\[\\s*\\]\\s*\\w+\\s*=\\s*\\{");

        int[] depth = braceDepths(src);

        java.util.regex.Matcher m = allocation.matcher(src);
        while (m.find()) {
            int at = m.start();
            // Depth 1 is the class body: field initialisers run once when the
            // applet is installed, which is exactly what we want. Depth >= 2 is
            // inside a method, and only the install-time methods may allocate.
            boolean allowed = depth[at] < 2;
            for (int[] range : allowedRanges) {
                allowed |= at > range[0] && at < range[1];
            }
            if (!allowed) {
                int from = Math.max(0, at - 90);
                int to = Math.min(src.length(), at + 90);
                org.junit.jupiter.api.Assertions.fail(
                    "allocation outside the install-time methods of " + fileName
                    + " leaks persistent EEPROM on every call — allocate once at install "
                    + "time as a CLEAR_ON_DESELECT transient array and thread it through "
                    + "as (work, workOff). Found near:\n..."
                    + src.substring(from, to).replaceAll("\\s+", " ") + "...");
            }
        }
    }

    /**
     * Fails if a method whose whole body is waived as install-time is reachable
     * from anywhere that is not itself waived.
     *
     * The waiver on {@code initCardKeypair()} is only sound while the "called
     * once, from the constructor" claim in its comment holds. Add a
     * {@code 0x4x REGENERATE_KEY} handler that calls it and the leak is back —
     * a fresh {@code KeyPair} in EEPROM per APDU — with the allocation guard
     * still green, because the allocation never moved. So the claim is checked
     * rather than read: every unqualified call to a listed name must sit inside
     * a listed body.
     *
     * Unqualified on purpose. {@code ecdh.init(tmpPriv)} is a call on another
     * object that happens to share a name with {@code SchnorrHW.init()}, and a
     * receiver before the dot is the one signal available without a type
     * checker. The flip side is the known limit of this check: a cross-file
     * {@code schnorrHW.init()} from an APDU handler is invisible to it. Both
     * cross-file entry points here are install-time by construction — the JCRE
     * calls {@code install()}, which calls the constructor — and the guard
     * covers the case that actually rots, which is a local helper quietly
     * gaining a second caller.
     */
    private static void assertOnlyCalledAtInstallTime(String fileName, String src,
                                                      String[] installTimeDeclarations,
                                                      int[][] allowedRanges) {
        for (int i = 0; i < installTimeDeclarations.length; i++) {
            String declaration = installTimeDeclarations[i];
            String name = declaredName(declaration);
            int declAt = src.indexOf(declaration);
            int declEnd = declAt + declaration.length();

            java.util.regex.Matcher calls = java.util.regex.Pattern
                .compile("(?<![.\\w$])" + java.util.regex.Pattern.quote(name) + "\\s*\\(")
                .matcher(src);
            while (calls.find()) {
                int at = calls.start();
                if (at >= declAt && at < declEnd) {
                    continue;   // the declaration itself
                }
                boolean allowed = false;
                for (int[] range : allowedRanges) {
                    allowed |= at > range[0] && at < range[1];
                }
                if (!allowed) {
                    int from = Math.max(0, at - 90);
                    int to = Math.min(src.length(), at + 90);
                    org.junit.jupiter.api.Assertions.fail(
                        name + "() is on the INSTALL_TIME_METHODS allow-list of " + fileName
                        + ", so its entire body is waived from the no-allocation rule — but "
                        + "it is called from outside every install-time method, i.e. from the "
                        + "APDU path. Either drop the waiver and stop allocating in it, or "
                        + "remove the call. Found near:\n..."
                        + src.substring(from, to).replaceAll("\\s+", " ") + "...");
                }
            }
        }
    }

    /** The method (or constructor) name in a declaration like "private void foo(". */
    private static String declaredName(String declaration) {
        int paren = declaration.indexOf('(');
        if (paren < 0) {
            throw new IllegalStateException(
                "INSTALL_TIME_METHODS entries must name a method: " + declaration);
        }
        int end = paren;
        while (end > 0 && Character.isWhitespace(declaration.charAt(end - 1))) end--;
        int start = end;
        while (start > 0 && Character.isJavaIdentifierPart(declaration.charAt(start - 1))) start--;
        if (start == end) {
            throw new IllegalStateException(
                "no method name found in INSTALL_TIME_METHODS entry: " + declaration);
        }
        return declaration.substring(start, end);
    }

    /** Applet main-source directory, resolved from either module or repo root. */
    static java.nio.file.Path mainSourceDir() throws java.io.IOException {
        String[] candidates = {
            "src/main/java/me/flashapp/cashu",
            "applet/src/main/java/me/flashapp/cashu",
        };
        for (String c : candidates) {
            java.nio.file.Path p = java.nio.file.Paths.get(c);
            if (java.nio.file.Files.isDirectory(p)) {
                return p;
            }
        }
        throw new java.io.FileNotFoundException(
            "applet sources not found relative to "
            + java.nio.file.Paths.get("").toAbsolutePath());
    }

    /** Drop comments and char literals so `new` and braces are only ever real code. */
    static String stripCommentsAndCharLiterals(String s) {
        StringBuilder out = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            if (s.startsWith("/*", i)) {
                int e = s.indexOf("*/", i + 2);
                i = (e < 0) ? s.length() : e + 2;
            } else if (s.startsWith("//", i)) {
                int e = s.indexOf('\n', i);
                i = (e < 0) ? s.length() : e;
            } else if (s.charAt(i) == '\'') {
                int j = i + 1;
                while (j < s.length() && s.charAt(j) != '\'') {
                    j += (s.charAt(j) == '\\') ? 2 : 1;
                }
                out.append("' '");
                i = j + 1;
            } else {
                out.append(s.charAt(i));
                i++;
            }
        }
        return out.toString();
    }

    /** Brace nesting depth at every character index. Class body = 1, method body = 2. */
    static int[] braceDepths(String src) {
        int[] depth = new int[src.length()];
        int d = 0;
        for (int i = 0; i < src.length(); i++) {
            char c = src.charAt(i);
            if (c == '{') d++;
            depth[i] = d;
            if (c == '}') d--;
        }
        return depth;
    }

    /** [openBraceIndex, closeBraceIndex] of the body following the given declaration. */
    private static int[] bodyRange(String src, String declaration) {
        int decl = src.indexOf(declaration);
        if (decl < 0) throw new IllegalStateException("not found in source: " + declaration);
        int open = src.indexOf('{', decl);
        if (open < 0) throw new IllegalStateException("no body for: " + declaration);
        int depth = 0;
        for (int i = open; i < src.length(); i++) {
            char c = src.charAt(i);
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return new int[] { open, i };
        }
        throw new IllegalStateException("unbalanced braces after: " + declaration);
    }

    /**
     * The PIN key (1.9) is made once, at install, and the allow-list waives its body from the no-allocation rule (it builds a KeyPair and
     * a KeyAgreement). That is sound only while nothing on the APDU path can call it: a second call would put a new key pair in EEPROM
     * for every asking. The general call-site check above lets any install-time body call any listed method; this one is exact. Each of the
     * two key makers is called once, from the constructor, and the constructor is made once, by install().
     */
    @Test
    @DisplayName("initPinKey() and initCardKeypair() are each called once, from the constructor and nowhere else, and the constructor only by install()")
    void keyMakersAreCalledOnlyFromTheConstructor() throws Exception {
        String src = stripCommentsAndCharLiterals(new String(
            java.nio.file.Files.readAllBytes(mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8));
        int[] constructor = bodyRange(src, "private CashuApplet()");
        int[] install = bodyRange(src, "public static void install(");
        for (String maker : new String[] { "initCardKeypair", "initPinKey" }) {
            int declaration = src.indexOf("private void " + maker + "(");
            org.junit.jupiter.api.Assertions.assertTrue(declaration > 0, maker + " is declared");
            java.util.regex.Matcher calls = java.util.regex.Pattern.compile("(?<![.\\w$])" + maker + "\\s*\\(").matcher(src);
            int made = 0;
            while (calls.find()) {
                if (calls.start() == declaration + "private void ".length()) continue;
                made++;
                org.junit.jupiter.api.Assertions.assertTrue(calls.start() > constructor[0] && calls.start() < constructor[1],
                    maker + "() is called from outside the constructor, near: ..." + src.substring(Math.max(0, calls.start() - 80), Math.min(src.length(), calls.start() + 40)).replaceAll("\\s+", " "));
            }
            org.junit.jupiter.api.Assertions.assertEquals(1, made, maker + "() is called once");
        }
        java.util.regex.Matcher built = java.util.regex.Pattern.compile("\\bnew\\s+CashuApplet\\s*\\(").matcher(src);
        int constructed = 0;
        while (built.find()) {
            constructed++;
            org.junit.jupiter.api.Assertions.assertTrue(built.start() > install[0] && built.start() < install[1], "the constructor is run only from install()");
        }
        org.junit.jupiter.api.Assertions.assertEquals(1, constructed, "and once");
    }

    // ── The memory the applet asks of the chip at install ─────────────────

    /**
     * The figures of the build that is known to install on the chip (1.7): the transient memory the two
     * constructors ask for, by kind, and how many arrays that is. jCardSim has no limit on any of it, and a chip
     * has: 1.9 asked for 1,030 bytes of CLEAR_ON_DESELECT (in 15 arrays) where 1.7 asked for 931 (in 14), and
     * the chip answered INSTALL with 6F00 (which the opener applet turned out to be the cure for, not the
     * memory). 1.12 asks for 941 in 16: the change and the net of a payment, four bytes each. A larger figure
     * has to be measured on a card first.
     */
    static final int RAM_ON_DESELECT_MOST = 941, RAM_ON_RESET_MOST = 8, RAM_ARRAYS_MOST = 16;

    /** Every `static final short|byte|int NAME = expr;` of the applet's two sources. */
    private static java.util.Map<String, String> constantExpressions(String... sources) {
        java.util.Map<String, String> m = new java.util.HashMap<>();
        java.util.regex.Matcher c = java.util.regex.Pattern.compile("static\\s+final\\s+(?:short|byte|int)\\s+(\\w+)\\s*=\\s*([^;]+);").matcher(String.join("\n", sources));
        while (c.find()) m.put(c.group(1), c.group(2).trim());
        return m;
    }

    /** An integer expression of numbers, constants, + - * and parentheses, casts ignored. */
    private static int evaluated(String expr, java.util.Map<String, String> constants) {
        String e = expr.replaceAll("\\(\\s*(?:short|byte|int)\\s*\\)", "").replaceAll("\\s+", "");
        int[] at = { 0 };
        int v = sum(e, at, constants);
        if (at[0] != e.length()) throw new IllegalStateException("not an integer expression: " + expr);
        return v;
    }
    private static int sum(String e, int[] at, java.util.Map<String, String> k) {
        int v = product(e, at, k);
        while (at[0] < e.length() && (e.charAt(at[0]) == '+' || e.charAt(at[0]) == '-')) {
            char op = e.charAt(at[0]++);
            int w = product(e, at, k);
            v = op == '+' ? v + w : v - w;
        }
        return v;
    }
    private static int product(String e, int[] at, java.util.Map<String, String> k) {
        int v = factor(e, at, k);
        while (at[0] < e.length() && e.charAt(at[0]) == '*') { at[0]++; v *= factor(e, at, k); }
        return v;
    }
    private static int factor(String e, int[] at, java.util.Map<String, String> k) {
        if (e.charAt(at[0]) == '(') {
            at[0]++;
            int v = sum(e, at, k);
            at[0]++;
            return v;
        }
        int from = at[0];
        while (at[0] < e.length() && (Character.isLetterOrDigit(e.charAt(at[0])) || e.charAt(at[0]) == '_')) at[0]++;
        String token = e.substring(from, at[0]);
        if (Character.isDigit(token.charAt(0))) return Integer.decode(token);
        if (!k.containsKey(token)) throw new IllegalStateException("a constant with no definition: " + token);
        return evaluated(k.get(token), k);
    }

    /** { bytes CLEAR_ON_DESELECT, bytes CLEAR_ON_RESET, arrays } asked for by every JCSystem.makeTransientByteArray in the two sources. */
    static int[] transientMemoryAskedFor() throws Exception {
        String applet = stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8));
        String signer = stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(mainSourceDir().resolve("SchnorrHW.java")), java.nio.charset.StandardCharsets.UTF_8));
        java.util.Map<String, String> constants = constantExpressions(applet, signer);
        int onDeselect = 0, onReset = 0, arrays = 0;
        for (String source : new String[] { applet, signer }) {
            org.junit.jupiter.api.Assertions.assertEquals(
                java.util.regex.Pattern.compile("makeTransient").matcher(source).results().count(),
                java.util.regex.Pattern.compile("JCSystem\\.makeTransientByteArray\\(").matcher(source).results().count(),
                "the only transient memory made is byte arrays through JCSystem: a boolean, short or object array is not counted here");
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("JCSystem\\.makeTransientByteArray\\(\\s*([^,]+?)\\s*,\\s*JCSystem\\.(CLEAR_ON_DESELECT|CLEAR_ON_RESET)\\s*\\)").matcher(source);
            while (m.find()) {
                int size = evaluated(m.group(1), constants);
                if (m.group(2).equals("CLEAR_ON_DESELECT")) onDeselect += size; else onReset += size;
                arrays++;
            }
            org.junit.jupiter.api.Assertions.assertEquals(
                java.util.regex.Pattern.compile("JCSystem\\.makeTransientByteArray\\(").matcher(source).results().count(),
                java.util.regex.Pattern.compile("JCSystem\\.makeTransientByteArray\\(\\s*[^,]+?\\s*,\\s*JCSystem\\.(?:CLEAR_ON_DESELECT|CLEAR_ON_RESET)\\s*\\)").matcher(source).results().count(),
                "every makeTransientByteArray names its size and one of the two kinds the parse knows");
        }
        return new int[] { onDeselect, onReset, arrays };
    }

    @Test
    @DisplayName("RAM budget: the two constructors ask for no more than 941 bytes of CLEAR_ON_DESELECT, 8 of CLEAR_ON_RESET, in no more than 16 arrays: the figures of 1.12, which are 1.7's and a payment's change and net (1.15 asks for 6 on reset: the time the terminal told, 4, and the tap's two flags)")
    void transientMemoryIsWithinTheBuildThatInstallsOnTheChip() throws Exception {
        int[] asked = transientMemoryAskedFor();
        String why = " These are the figures of 1.12 (941 bytes that are cleared on deselect, 8 on reset, in 16 arrays: 1.7's 931 in 14, and the change and the net of a payment). "
            + "1.9 asked for 1,030 in 15 and the chip refused to install it (6F00); jCardSim has no limit and says nothing. A larger figure has to be measured on a card first.";
        org.junit.jupiter.api.Assertions.assertTrue(asked[0] <= RAM_ON_DESELECT_MOST, "CLEAR_ON_DESELECT is " + asked[0] + " bytes, over " + RAM_ON_DESELECT_MOST + "." + why);
        org.junit.jupiter.api.Assertions.assertTrue(asked[1] <= RAM_ON_RESET_MOST, "CLEAR_ON_RESET is " + asked[1] + " bytes, over " + RAM_ON_RESET_MOST + "." + why);
        org.junit.jupiter.api.Assertions.assertTrue(asked[2] <= RAM_ARRAYS_MOST, "transient arrays are " + asked[2] + ", over " + RAM_ARRAYS_MOST + "." + why);
        // a parse that found nothing would prove nothing
        org.junit.jupiter.api.Assertions.assertEquals(16, asked[2], "the parse found the 14 of CashuApplet and the 2 of SchnorrHW");
        org.junit.jupiter.api.Assertions.assertEquals(941, asked[0], "and they add up: CashuApplet 397 and SchnorrHW 544");
        org.junit.jupiter.api.Assertions.assertEquals(6, asked[1], "1.15: the time the terminal told (4) and the tap's two flags (2); 1.14 kept six bytes for a clock told twice, and eight with the flags");
    }

    @Test
    @DisplayName("The parse of the RAM budget can say no: a source with a hundred bytes more, or another array, is over it")
    void theRamBudgetCanSayNo() throws Exception {
        java.util.Map<String, String> k = constantExpressions("static final short X_LEN = (short) 196; static final short ALL = MAX; static final short MAX = (short) 128;");
        org.junit.jupiter.api.Assertions.assertEquals(196, evaluated("X_LEN", k));
        org.junit.jupiter.api.Assertions.assertEquals(128, evaluated("(short) ALL", k));
        org.junit.jupiter.api.Assertions.assertEquals(10496, evaluated("(short)(MAX * 82)", k));
        org.junit.jupiter.api.Assertions.assertEquals(129, evaluated("(short)(MAX + 1)", k));
        int[] asked = transientMemoryAskedFor();
        org.junit.jupiter.api.Assertions.assertTrue(asked[0] + 100 > RAM_ON_DESELECT_MOST, "a hundred bytes more is over");
        org.junit.jupiter.api.Assertions.assertTrue(asked[2] + 1 > RAM_ARRAYS_MOST, "and so is one array more");
    }

    /**
     * What the two constructors create that a chip counts: crypto engines, key pairs and keys, a PIN object, a random source. Another of
     * any of them is memory the chip has not been shown to give (the failed 1.9 build had a second key agreement). Counted by call site;
     * a site that runs twice says so.
     */
    @Test
    @DisplayName("Crypto objects: CashuApplet makes 1 OwnerPIN, 1 Signature, 2 MessageDigests, 1 RandomData, 2 KeyPairs and 2 key sites (newP256Key, run once since 1.15 for the owner's key alone, and the RSA keys of the change); SchnorrHW makes 1 MessageDigest, 2 KeyAgreements, 1 RandomData and 1 key; no KeyAgreement, Cipher or Checksum is made anywhere else")
    void cryptoObjectsAreThoseOfTheBuildThatInstalls() throws Exception {
        String applet = stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(mainSourceDir().resolve("CashuApplet.java")), java.nio.charset.StandardCharsets.UTF_8));
        String signer = stripCommentsAndCharLiterals(new String(java.nio.file.Files.readAllBytes(mainSourceDir().resolve("SchnorrHW.java")), java.nio.charset.StandardCharsets.UTF_8));
        String[] kinds = { "new\\s+OwnerPIN\\(", "Signature\\.getInstance\\(", "MessageDigest\\.getInstance\\(", "RandomData\\.getInstance\\(", "new\\s+KeyPair\\(",
            "KeyBuilder\\.buildKey\\(", "KeyAgreement\\.getInstance\\(", "Cipher\\.getInstance\\(", "Checksum\\.getInstance\\(", "KeyAgreement\\b" };
        // 1.12: the RSA keys of the change (one buildKey site, run three times) and their Cipher; SchnorrHW's second KeyAgreement is the chip's point addition
        int[] inApplet = { 1, 1, 2, 1, 2, 2, 0, 1, 0, 0 };
        // SchnorrHW names KeyAgreement in its fields' types and in the getInstance calls, and in its agree-less comments only
        int[] inSigner = { 0, 0, 1, 1, 0, 1, 2, 0, 0, -1 };
        for (int i = 0; i < kinds.length; i++) {
            long a = java.util.regex.Pattern.compile(kinds[i]).matcher(applet).results().count();
            org.junit.jupiter.api.Assertions.assertEquals(inApplet[i], a, "CashuApplet.java: " + kinds[i] + " is called " + a + " times where the build that installs called it " + inApplet[i] + ". A chip counts these; measure a larger figure on a card first.");
            if (inSigner[i] >= 0) {
                long h = java.util.regex.Pattern.compile(kinds[i]).matcher(signer).results().count();
                org.junit.jupiter.api.Assertions.assertEquals(inSigner[i], h, "SchnorrHW.java: " + kinds[i] + " is called " + h + " times where the build that installs called it " + inSigner[i] + ". A chip counts these; measure a larger figure on a card first.");
            }
        }
        // and the EC key objects that exist: the card's pair, the PIN key's pair, the signer's temporary key, and the owner's key (the time signer's key went in 1.15: the clock is block headers)
        org.junit.jupiter.api.Assertions.assertEquals(1, java.util.regex.Pattern.compile("\\bnewP256Key\\(\\)").matcher(applet).results().count() - 1, "newP256Key is run for the owner key, and for no more: the time key is gone");
    }

    @Test
    @DisplayName("mul256x256 (raw 512-bit product) matches BigInteger a*b")
    void mul256x256MatchesBigInteger() throws Exception {
        java.lang.reflect.Method m = SchnorrHW.class.getDeclaredMethod(
            "mul256x256", byte[].class, short.class, byte[].class, short.class,
            byte[].class, short.class);
        m.setAccessible(true);
        Random r = rng();
        for (int i = 0; i < 200; i++) {
            BigInteger a = new BigInteger(256, r).mod(N);
            BigInteger b = new BigInteger(256, r).mod(N);
            byte[] prod = new byte[64];
            m.invoke(null, to32(a), (short) 0, to32(b), (short) 0, prod, (short) 0);
            assertEquals(a.multiply(b), new BigInteger(1, prod),
                "mul256x256 mismatch at iteration " + i);
        }
    }
}
