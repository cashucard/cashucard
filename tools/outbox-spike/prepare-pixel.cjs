/* Generate an isolated, offline, debug-only Android project. Never opens a device. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { compactArtifact } = require("./run-compact.cjs");
const { PINS } = require("./pixel-control.js");
const { FIXTURE_SHA256 } = require("./pixel-capacity.js");
const ROOT = path.resolve(__dirname, "../..");
const APP_ID = "org.cashucard.compactlab";
const CAPACITY_APP_ID = "org.cashucard.capacitylab";
const modeId = (mode) => {
  if (mode === "creation") return APP_ID;
  if (mode === "capacity") return CAPACITY_APP_ID;
  throw Error("Unknown fixed lab mode");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function androidFiles(original, mode = "creation") {
  const appId = modeId(mode);
  const manifest = original.manifest
    .replace(
      "<manifest ",
      '<manifest xmlns:tools="http://schemas.android.com/tools" ',
    )
    .replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />\n    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />',
    );
  if (!manifest.includes('tools:node="remove"'))
    throw Error("Network permission removal missing");
  const application = original.application.replace(
    "getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG",
    "getUseDeveloperSupport(): Boolean = false",
  );
  if (application === original.application)
    throw Error("Developer support switch missing");
  const gradle = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"
react { autolinkLibrariesWithApp() }
android {
    namespace "com.islandbitcoin.provisioner"
    ndkVersion rootProject.ext.ndkVersion
    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "${appId}"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "0.0.1-lab"
    }
    signingConfigs { debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    } }
    buildTypes { debug { signingConfig signingConfigs.debug } }
}
// No release artifact or production signer exists in this generated project.
androidComponents { beforeVariants(selector().withBuildType("release")) { it.enable = false } }
dependencies {
    implementation("com.facebook.react:react-android")
    implementation("com.facebook.react:hermes-android")
}
`;
  return { manifest, application, gradle };
}
function prepare({ artifact, output, mode = "creation" }) {
  const appId = modeId(mode);
  if (!path.isAbsolute(output) || fs.existsSync(output))
    throw Error("New absolute output directory required");
  if (output === ROOT || output.startsWith(ROOT + path.sep))
    throw Error("Output must be outside the checkout");
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (status.trim())
    throw Error("Commit/review the source before generating a lab build");
  const { manifest, load } = compactArtifact({
    manifest: path.join(artifact, "manifest.json"),
    manifestHash: PINS.manifest,
    sourceCommit: PINS.source,
  });
  if (
    manifest.capSha256 !== PINS.cap ||
    manifest.loadFileSha256 !== PINS.load ||
    load.length !== PINS.bytes ||
    hash(load) !== PINS.load
  )
    throw Error("Fixed image pin mismatch");
  const fixture =
    mode === "capacity"
      ? fs.readFileSync(
          path.join(__dirname, "fixtures/compact-capacity-v1.json"),
        )
      : undefined;
  if (fixture && hash(fixture) !== FIXTURE_SHA256)
    throw Error("Fixed capacity fixture pin mismatch");
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  // Copy only committed files: no signing inputs, local state, credentials or build outputs.
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "apps/provisioner", "tools/cardkit"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  fs.mkdirSync(output, { mode: 0o700 });
  for (const name of tracked) {
    if (
      name.startsWith("apps/provisioner/ios/") ||
      name.startsWith("apps/provisioner/src/") ||
      name.startsWith("apps/provisioner/__tests__/") ||
      name.startsWith("apps/provisioner/fastlane/")
    )
      continue;
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), destination);
    fs.chmodSync(destination, fs.statSync(path.join(ROOT, name)).mode & 0o777);
  }
  const app = path.join(output, "apps/provisioner");
  const read = (name) => fs.readFileSync(path.join(app, name), "utf8");
  const kotlin =
    "android/app/src/main/java/com/islandbitcoin/provisioner/MainApplication.kt";
  const files = androidFiles(
    {
      manifest: read("android/app/src/main/AndroidManifest.xml"),
      application: read(kotlin),
    },
    mode,
  );
  const write = (name, data) => {
    const p = path.join(app, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };
  write("android/app/build.gradle", files.gradle);
  write("android/app/src/main/AndroidManifest.xml", files.manifest);
  write(
    "android/app/src/debug/AndroidManifest.xml",
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>\n',
  );
  write(kotlin, files.application);
  write(
    "android/app/src/main/res/values/strings.xml",
    '<resources><string name="app_name">Cashu Card Lab</string></resources>\n',
  );
  write(
    "App.jsx",
    fs.readFileSync(path.join(__dirname, "PixelControlApp.jsx")),
  );
  fs.rmSync(path.join(app, "App.tsx"));
  write(
    "pixel-control.js",
    fs.readFileSync(path.join(__dirname, "pixel-control.js")),
  );
  write(
    "pixel-capacity.js",
    fs.readFileSync(path.join(__dirname, "pixel-capacity.js")),
  );
  write(
    "src/session.ts",
    fs.readFileSync(path.join(ROOT, "apps/provisioner/src/session.ts")),
  );
  write(
    "src/cardkit.ts",
    "export type {Transceiver} from '@cashu-card/cardkit';\n",
  );
  const build = {
    source,
    appId,
    mode,
    template: hash(fs.readFileSync(__filename)),
    core: hash(fs.readFileSync(path.join(__dirname, "pixel-control.js"))),
    capacityCore: hash(
      fs.readFileSync(path.join(__dirname, "pixel-capacity.js")),
    ),
    fixture: fixture ? FIXTURE_SHA256 : undefined,
    ui: hash(fs.readFileSync(path.join(__dirname, "PixelControlApp.jsx"))),
    session: hash(
      fs.readFileSync(path.join(ROOT, "apps/provisioner/src/session.ts")),
    ),
    manifest: PINS.manifest,
    cap: PINS.cap,
    load: PINS.load,
  };
  write(
    "pixel-asset.json",
    JSON.stringify({
      build,
      mode,
      loadHex: load.toString("hex"),
      fixtureHex: fixture?.toString("hex"),
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "lab-build.json"),
    JSON.stringify(build, null, 2) + "\n",
  );
  return build;
}
module.exports = { androidFiles, prepare, APP_ID, CAPACITY_APP_ID };
if (require.main === module) {
  const { parseArgs } = require("node:util");
  const { values } = parseArgs({
    options: {
      artifact: { type: "string" },
      output: { type: "string" },
      mode: { type: "string", default: "creation" },
    },
  });
  process.stdout.write(JSON.stringify(prepare(values), null, 2) + "\n");
}
