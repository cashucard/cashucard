const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { androidFiles, APP_ID, prepare } = require("./prepare-pixel.cjs");
const root = path.resolve(__dirname, "../..");
test("generated Android identity is separate, offline and has no enabled release variant", () => {
  const app = path.join(root, "apps/provisioner");
  const files = androidFiles({
    manifest: fs.readFileSync(
      path.join(app, "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    ),
    application: fs.readFileSync(
      path.join(
        app,
        "android/app/src/main/java/com/islandbitcoin/provisioner/MainApplication.kt",
      ),
      "utf8",
    ),
  });
  assert.ok(files.gradle.includes('applicationId "' + APP_ID + '"'));
  assert.ok(!files.gradle.includes("CASHU_ANDROID_UPLOAD"));
  assert.ok(
    files.gradle.includes('withBuildType("release")) { it.enable = false'),
  );
  assert.ok(
    files.manifest.includes('android.permission.INTERNET" tools:node="remove"'),
  );
  assert.ok(
    files.application.includes("getUseDeveloperSupport(): Boolean = false"),
  );
});
test("generator refuses an existing destination without touching its contents", () => {
  assert.throws(
    () => prepare({ output: root, artifact: "/missing" }),
    /New absolute/,
  );
  assert.throws(
    () => prepare({ output: "relative", artifact: "/missing" }),
    /New absolute/,
  );
});
