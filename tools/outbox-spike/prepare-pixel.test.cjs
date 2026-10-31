const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  androidFiles,
  APP_ID,
  CAPACITY_APP_ID,
  prepare,
} = require("./prepare-pixel.cjs");
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
  assert.ok(
    files.manifest.includes(
      'android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"',
    ),
  );
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
    () =>
      prepare({
        mode: "arbitrary",
        output: "/missing-lab-project",
        artifact: "/missing",
      }),
    /Unknown fixed lab mode/,
  );
  assert.throws(
    () => prepare({ output: root, artifact: "/missing" }),
    /New absolute/,
  );
  assert.throws(
    () => prepare({ output: "relative", artifact: "/missing" }),
    /New absolute/,
  );
});
test("capacity mode uses a distinct application identity and keeps creation data separate", () => {
  const app = path.join(root, "apps/provisioner");
  const original = {
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
  };
  const result = androidFiles(original, "capacity");
  assert.ok(result.gradle.includes('applicationId "' + CAPACITY_APP_ID + '"'));
  assert.notEqual(APP_ID, CAPACITY_APP_ID);
  const diagnostics = androidFiles(original, "capacity-diagnostics");
  assert.ok(
    diagnostics.gradle.includes('applicationId "' + CAPACITY_APP_ID + '"'),
  );
  assert.ok(diagnostics.gradle.includes("versionCode 2"));
  const optimized = androidFiles(original, "capacity-optimized");
  assert.ok(
    optimized.gradle.includes('applicationId "' + CAPACITY_APP_ID + '"'),
  );
  assert.ok(optimized.gradle.includes("versionCode 3"));
  const streamed = androidFiles(original, "capacity-streamed");
  assert.ok(
    streamed.gradle.includes('applicationId "' + CAPACITY_APP_ID + '"'),
  );
  assert.ok(streamed.gradle.includes("versionCode 4"));
  assert.ok(streamed.gradle.includes('versionName "0.0.4-lab"'));
  assert.throws(
    () => androidFiles(original, "custom"),
    /Unknown fixed lab mode/,
  );
});
