const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { identity, parseTag } = require("./component.cjs");
test("independent component tags reject ambiguous, legacy and shell-like inputs", () => {
  for (const [tag, component] of [
    ["firmware-v2.1.0", "firmware"],
    ["cardkit-v0.2.0", "cardkit"],
    ["ops-v0.1.0", "ops"],
    ["provisioner-v1.0.0-build.8", "provisioner"],
  ]) {
    assert.equal(parseTag(tag).component, component);
  }
  for (const tag of [
    "v2.1.0",
    "provisioner-v1.0.0-beta.1",
    "ops-v01.0.0",
    "provisioner-v1.0.0-buildx8",
    "ops-v1.0.0;echo x",
    "--help",
    "ops-v1.0.0\n",
  ])
    assert.throws(() => parseTag(tag));
});
test("release identity uses each component manifest and rejects version/build mismatches", () => {
  const root = mkdtempSync(join(tmpdir(), "cashu-release-"));
  const put = (file, content) => {
    const target = join(root, file);
    mkdirSync(require("node:path").dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  try {
    put("ops/package.json", JSON.stringify({ version: "0.1.0" }));
    assert.equal(identity(root, "ops-v0.1.0").version, "0.1.0");
    assert.throws(() => identity(root, "ops-v0.2.0"));
    put(
      "apps/provisioner/package.json",
      JSON.stringify({ version: "1.0.0", provisionerBuild: 8 }),
    );
    put(
      "apps/provisioner/android/app/build.gradle",
      'versionName "1.0.0"\nversionCode 8',
    );
    put(
      "apps/provisioner/ios/CashuProvisioner/Info.plist",
      "<key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>8</string>",
    );
    assert.equal(identity(root, "provisioner-v1.0.0-build.8").build, 8);
    assert.throws(() => identity(root, "provisioner-v1.0.0-build.9"));
    put(
      "apps/provisioner/ios/CashuProvisioner/Info.plist",
      "<key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>",
    );
    put(
      "apps/provisioner/ios/CashuProvisioner.xcodeproj/project.pbxproj",
      "CURRENT_PROJECT_VERSION = 8;\nCURRENT_PROJECT_VERSION = 8;",
    );
    assert.equal(identity(root, "provisioner-v1.0.0-build.8").build, 8);
    put(
      "apps/provisioner/ios/CashuProvisioner.xcodeproj/project.pbxproj",
      "CURRENT_PROJECT_VERSION = 8;\nCURRENT_PROJECT_VERSION = 9;",
    );
    assert.throws(() => identity(root, "provisioner-v1.0.0-build.8"));
    put(
      "apps/provisioner/ios/CashuProvisioner.xcodeproj/project.pbxproj",
      "CURRENT_PROJECT_VERSION = 8;\nCURRENT_PROJECT_VERSION = 8;",
    );

    put(
      "apps/provisioner/android/app/build.gradle",
      'versionName "1.0.0"\nversionCode 9',
    );
    assert.throws(() => identity(root, "provisioner-v1.0.0-build.8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IPA identity checks reject a wrong build, missing NFC entitlement and a development profile", () => {
  execFileSync("python3", [
    "-c",
    `
import copy, importlib.util
s=importlib.util.spec_from_file_location('ios', ${JSON.stringify(require("node:path").resolve(__dirname, "check-ios.py"))})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
e={'application-identifier':'H7UAM79QQP.com.islandbitcoin.provisioner','com.apple.developer.nfc.readersession.formats':['TAG']}
p={'TeamIdentifier':['H7UAM79QQP'],'Entitlements':copy.deepcopy(e)}
i={'CFBundleIdentifier':'com.islandbitcoin.provisioner','CFBundleShortVersionString':'1.0.0','CFBundleVersion':'8','com.apple.developer.nfc.readersession.iso7816.select-identifiers':['F043415348554341524401']}
m.check_identity(i,e,p,'1.0.0',8)
for target,field,value in [(i,'CFBundleVersion','9'),(e,'com.apple.developer.nfc.readersession.formats',[]),(p,'ProvisionedDevices',['test-device'])]:
 previous=copy.deepcopy(target);target[field]=value
 try:m.check_identity(i,e,p,'1.0.0',8)
 except (AssertionError,KeyError):pass
 else:raise AssertionError('invalid IPA accepted')
 target.clear();target.update(previous)
`,
  ]);
});

test("a release must be the exact tag on main, not another checkout or an unmerged branch", () => {
  const { verifyGit, resolveGit } = require("./component.cjs");
  const root = mkdtempSync(join(tmpdir(), "cashu-release-git-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Release fixture");
    git("config", "user.email", "release@example.invalid");
    // The fixture's tags are lightweight, whatever the developer's signing config says.
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    writeFileSync(join(root, "file"), "base");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    git("tag", "ops-v0.1.0");
    assert.equal(verifyGit(root, "ops-v0.1.0"), base);
    writeFileSync(join(root, "file"), "unmerged");
    git("add", ".");
    git("commit", "-qm", "unmerged");
    git("tag", "ops-v0.2.0");
    assert.equal(resolveGit(root, "ops-v0.1.0"), base);
    assert.throws(() => resolveGit(root, "ops-v0.2.0"));
    assert.throws(() => verifyGit(root, "ops-v0.1.0"));
    assert.throws(() => verifyGit(root, "ops-v0.2.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("firmware identity compares the active CAP property rather than old comments", () => {
  const root = mkdtempSync(join(tmpdir(), "cashu-firmware-identity-"));
  try {
    mkdirSync(join(root, "applet"));
    writeFileSync(
      join(root, "applet/pom.xml"),
      "<project><artifactId>cashu-javacard</artifactId><version>2.1.0</version></project>",
    );
    const build = (version) =>
      `<!-- historical cashu-javacard-2.1.0.cap -->\n<project><property name="cap.file" value="\${target.dir}/cashu-javacard-${version}.cap"/></project>`;
    writeFileSync(join(root, "applet/build.xml"), build("2.2.0"));
    assert.throws(() => identity(root, "firmware-v2.1.0"));
    writeFileSync(join(root, "applet/build.xml"), build("2.1.0"));
    assert.equal(identity(root, "firmware-v2.1.0").version, "2.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
