const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { androidFiles, prepare } = require("./prepare-pixel-07297620.cjs");
const pins = require("./pixel-07297620-create.json");
test("dedicated Android app has a fresh identity, offline permissions and debug-only signer", () => {
  const app = path.resolve(__dirname, "../../apps/provisioner");
  const r = androidFiles({
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
  assert.ok(r.gradle.includes('applicationId "' + pins.appId + '"'));
  assert.ok(r.gradle.includes("versionCode 1"));
  assert.ok(r.gradle.includes('withBuildType("release")) { it.enable = false'));
  assert.ok(!r.gradle.includes("CASHU_ANDROID_UPLOAD"));
  assert.ok(
    r.manifest.includes('android.permission.INTERNET" tools:node="remove"'),
  );
  assert.ok(
    r.manifest.includes(
      'android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"',
    ),
  );
  assert.ok(
    r.application.includes("getUseDeveloperSupport(): Boolean = false"),
  );
});
test("generator rejects existing or checkout output before generating anything", () => {
  assert.throws(
    () =>
      prepare({
        output: path.resolve(__dirname, "../.."),
        artifact: "/missing",
      }),
    /New absolute/,
  );
  assert.throws(
    () => prepare({ output: "relative", artifact: "/missing" }),
    /New absolute/,
  );
});
test("phone UI consumes its own journal before NFC and contains no reset or second-run action", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "Pixel072CreationApp.jsx"),
    "utf8",
  );
  assert.ok(ui.includes("PINS.journalKey"));
  assert.ok(ui.indexOf("await save(current)") < ui.indexOf("await withCard("));
  assert.ok(ui.includes("record === null"));
  assert.ok(!ui.includes("AsyncStorage.remove"));
  assert.ok(!ui.includes("AsyncStorage.clear"));
  assert.ok(!ui.includes("fetch("));
  assert.ok(ui.includes("Hold card 07297620"));
});
