const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { METHOD, patchSource, patch } = require("./patch-pixel-nfc.cjs");

test("the exact generated Java classifier returns fixed tokens without exception text", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cashucard-native-category-"),
  );
  try {
    // A TagLostException-shaped IOException tests precedence. The actual Android
    // import and generated dependency patch are also compiled in the lab APK.
    const java = `public class NativeCategoryTest {
      static class TagLostException extends java.io.IOException {}
      ${METHOD}
      public static void main(String[] args) {
        Exception[] errors = {new TagLostException(), new java.io.IOException("PRIVATE"),
          new SecurityException("PRIVATE"), new IllegalStateException("PRIVATE"),
          new Exception("PRIVATE"), new RuntimeException("PRIVATE")};
        String[] expected = {"tag-lost", "io", "security", "state", "other", "other"};
        for (int i=0; i<errors.length; i++) {
          if (!cashuLabFailure(errors[i]).equals("cashucard-lab:" + expected[i]))
            throw new AssertionError("Wrong bounded category at " + i);
        }
        System.out.println("6 native categories passed");
      }
    }`;
    const file = path.join(dir, "NativeCategoryTest.java");
    fs.writeFileSync(file, java);
    execFileSync("javac", ["--release", "17", "-d", dir, file], {
      stdio: "pipe",
    });
    assert.equal(
      execFileSync("java", ["-cp", dir, "NativeCategoryTest"], {
        encoding: "utf8",
      }).trim(),
      "6 native categories passed",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown dependency source or a normal CCP identity is rejected before mutation", () => {
  assert.throws(
    () => patchSource("unexpected native source"),
    /Unrecognized NFC dependency/,
  );
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cashucard-patch-identity-"),
  );
  try {
    fs.writeFileSync(
      path.join(dir, "pixel-asset.json"),
      JSON.stringify({ build: { appId: "com.islandbitcoin.provisioner" } }),
    );
    assert.throws(() => patch(dir), /Generated private lab required/);
    assert.deepEqual(fs.readdirSync(dir), ["pixel-asset.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
