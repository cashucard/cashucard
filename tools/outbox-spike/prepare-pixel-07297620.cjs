/* Host-only generator for a new offline card-specific Android lab. */
const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const base = require("./prepare-pixel.cjs");
const { compactArtifact } = require("./run-compact.cjs");
const pins = require("./pixel-07297620-create.json");
const ROOT = path.resolve(__dirname, "../.."),
  sha = (a) => createHash("sha256").update(a).digest("hex");
function androidFiles(original) {
  const r = base.androidFiles(original, "creation");
  r.gradle = r.gradle
    .replace(
      'applicationId "' + base.APP_ID + '"',
      'applicationId "' + pins.appId + '"',
    )
    .replace("versionCode 2", "versionCode 1")
    .replace('versionName "0.0.2-lab"', 'versionName "0.0.1-card072-lab"');
  if (!r.gradle.includes('applicationId "' + pins.appId + '"'))
    throw Error("application identity");
  return r;
}
function prepare({ artifact, output }) {
  if (!path.isAbsolute(output) || fs.existsSync(output))
    throw Error("New absolute output directory required");
  if (output.startsWith(ROOT + path.sep))
    throw Error("Output must be outside checkout");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim()
  )
    throw Error("Commit source before generating");
  const { manifest, load } = compactArtifact({
    manifest: path.join(artifact, "manifest.json"),
    manifestHash: pins.manifest,
    sourceCommit: pins.source,
  });
  if (
    manifest.capSha256 !== pins.cap ||
    manifest.loadFileSha256 !== pins.load ||
    load.length !== pins.bytes ||
    sha(load) !== pins.load
  )
    throw Error("image pins");
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
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
      [
        "apps/provisioner/ios/",
        "apps/provisioner/src/",
        "apps/provisioner/__tests__/",
        "apps/provisioner/fastlane/",
      ].some((p) => name.startsWith(p))
    )
      continue;
    const dest = path.join(output, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), dest);
    fs.chmodSync(dest, fs.statSync(path.join(ROOT, name)).mode & 0o777);
  }
  const app = path.join(output, "apps/provisioner"),
    read = (name) => fs.readFileSync(path.join(app, name), "utf8"),
    write = (name, raw) => {
      const p = path.join(app, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, raw);
    };
  const kotlin =
    "android/app/src/main/java/com/islandbitcoin/provisioner/MainApplication.kt";
  const files = androidFiles({
    manifest: read("android/app/src/main/AndroidManifest.xml"),
    application: read(kotlin),
  });
  write("android/app/build.gradle", files.gradle);
  write("android/app/src/main/AndroidManifest.xml", files.manifest);
  write(
    "android/app/src/debug/AndroidManifest.xml",
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>\n',
  );
  write(kotlin, files.application);
  write(
    "android/app/src/main/res/values/strings.xml",
    '<resources><string name="app_name">Card 07297620 Creation</string></resources>\n',
  );
  write(
    "App.jsx",
    fs.readFileSync(path.join(__dirname, "Pixel072CreationApp.jsx")),
  );
  fs.unlinkSync(path.join(app, "App.tsx"));
  for (const name of [
    "pixel-07297620-create.js",
    "pixel-07297620-create.json",
    "lab-journal.js",
    "patch-pixel-nfc.cjs",
  ])
    write(name, fs.readFileSync(path.join(__dirname, name)));
  write(
    "src/session.ts",
    fs.readFileSync(path.join(ROOT, "apps/provisioner/src/session.ts")),
  );
  write(
    "src/cardkit.ts",
    "export type {Transceiver} from '@cashu-card/cardkit';\n",
  );
  write(
    "patch-card072.cjs",
    `const fs=require('node:fs'),path=require('node:path');const p=require('./patch-pixel-nfc.cjs');const a=require('./card072-asset.json');if(a.build.appId!==${JSON.stringify(pins.appId)})throw Error('wrong generated app');const file=path.join(__dirname,p.TARGET);const s=fs.readFileSync(file,'utf8'),n=p.patchSource(s);if(n!==s)fs.writeFileSync(file,n);\n`,
  );
  const pkg = JSON.parse(read("package.json"));
  if (pkg.scripts.postinstall !== "patch-package")
    throw Error("postinstall hook");
  pkg.scripts.postinstall += " && node patch-card072.cjs";
  write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const parts = {};
  for (const name of [
    "pixel-07297620-create.js",
    "pixel-07297620-create.json",
    "Pixel072CreationApp.jsx",
    "lab-journal.js",
    "patch-pixel-nfc.cjs",
  ])
    parts[name] = sha(fs.readFileSync(path.join(__dirname, name)));
  parts["src/session.ts"] = sha(
    fs.readFileSync(path.join(ROOT, "apps/provisioner/src/session.ts")),
  );
  const build = {
    plan: pins.plan,
    appId: pins.appId,
    versionCode: 1,
    mode: "card072-creation",
    source,
    template: sha(fs.readFileSync(__filename)),
    files: parts,
    manifest: pins.manifest,
    cap: pins.cap,
    load: pins.load,
    bytes: pins.bytes,
    blocks: pins.blocks,
    journalKey: pins.journalKey,
  };
  write(
    "card072-asset.json",
    JSON.stringify({ build, loadHex: load.toString("hex") }) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "lab-build.json"),
    JSON.stringify(build, null, 2) + "\n",
  );
  return build;
}
module.exports = { androidFiles, prepare };
if (require.main === module) {
  const { values } = require("node:util").parseArgs({
    options: { artifact: { type: "string" }, output: { type: "string" } },
  });
  console.log(JSON.stringify(prepare(values), null, 2));
}
