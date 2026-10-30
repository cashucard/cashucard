package com.sun.javacard.offcardverifier;

import java.util.Arrays;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Host-only inspection through the pinned 3.0.5 verifier; never loaded on a card. */
public final class CashuProbeShape {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("one CAP required");
        byte[] classes = null;
        byte[] imports = null;
        try (ZipFile zip = new ZipFile(args[0])) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.getName().endsWith("/Class.cap")) classes = zip.getInputStream(entry).readAllBytes();
                if (entry.getName().endsWith("/Import.cap")) imports = zip.getInputStream(entry).readAllBytes();
            }
        }
        if (classes == null || imports == null) throw new IllegalArgumentException("components missing");
        byte[] framework = new byte[] {(byte)0xA0, 0, 0, 0, 0x62, 1, 1};
        int frameworkIndex = -1;
        int at = 4;
        for (int index = 0; index < (imports[3] & 255); index++) {
            int length = imports[at + 2] & 255;
            if (Arrays.equals(framework, Arrays.copyOfRange(imports, at + 3, at + 3 + length))) frameworkIndex = index;
            at += 3 + length;
        }
        if (frameworkIndex < 0 || at != imports.length) throw new IllegalArgumentException("framework import missing");
        byte[] data = Arrays.copyOfRange(classes, 3, classes.length);
        ClassComponent component = new ClassComponent(data);
        int appletSuperclass = ((0x80 | frameworkIndex) << 8) | 3;
        ClassInfo found = null;
        for (int offset = 0; offset + 12 < data.length; offset++) {
            if ((data[offset] & 0x80) != 0 ||
                    (((data[offset + 1] & 255) << 8) | (data[offset + 2] & 255)) != appletSuperclass ||
                    (data[offset + 3] & 255) < 40) continue;
            ClassInfo candidate = component.infoOfs(offset);
            if (candidate.referenceCount() < 40 || candidate.referenceCount() > candidate.declaredInstanceSize()) continue;
            if (found != null) throw new IllegalArgumentException("ambiguous applet class");
            found = candidate;
        }
        if (found == null) throw new IllegalArgumentException("applet class missing");
        System.out.printf("{\"declaredInstanceSize\":%d,\"firstReferenceToken\":%d,\"referenceCount\":%d}%n",
                found.declaredInstanceSize(), found.firstReferenceIndex(), found.referenceCount());
    }
}
