const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  FORMAT,
  verifyInstallationReceipt,
} = require("./phase-install-receipt.cjs");
const {
  INSTALL_PINS,
  fixture,
  runPhaseInstall,
} = require("./pixel-test-support.cjs");

const SOURCE = "0123456789abcdef0123456789abcdef01234567";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A private directory of this process, holding the two files a receipt names.
function privateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase-install-receipt-"));
  fs.chmodSync(dir, 0o700);
  t.after(() => {
    for (const name of fs.readdirSync(dir))
      fs.chmodSync(path.join(dir, name), 0o600);
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Real installation evidence: the install profile run against the fake card,
// plus the asset fields the app writes into its journal.
async function evidence() {
  const f = fixture({ mode: "phase-install", pins: INSTALL_PINS });
  const record = await runPhaseInstall(f.args);
  assert.equal(record.status, "installed-for-phases");
  return {
    ...record,
    artifact: {
      source: INSTALL_PINS.source,
      cap: INSTALL_PINS.cap,
      load: INSTALL_PINS.load,
    },
    build: {
      manifest: INSTALL_PINS.manifest,
      cap: INSTALL_PINS.cap,
      load: INSTALL_PINS.load,
      blocks: INSTALL_PINS.blocks,
      mode: "phase-install",
      source: SOURCE,
    },
  };
}

function place(dir, name, contents, mode = 0o600) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return { path: file, sha256: sha(contents) };
}

async function receiptFor(dir, record = null) {
  const journal = place(
    dir,
    "journal.json",
    JSON.stringify(record ?? (await evidence())),
  );
  const apk = place(dir, "install.apk", Buffer.from("not-a-real-apk"));
  return {
    format: FORMAT,
    sourceCommit: SOURCE,
    apk,
    journal,
  };
}

test("a completed install profile is admitted with its uninitialized diagnostics", async (t) => {
  const dir = privateDir(t);
  const admitted = verifyInstallationReceipt(await receiptFor(dir), SOURCE);
  assert.equal(admitted.plan, INSTALL_PINS.plan);
  assert.equal(admitted.status, "installed-for-phases");
  assert.equal(admitted.chip, null);
  assert.equal(admitted.mode, "phase-install");
  assert.equal(admitted.sourceCommit, SOURCE);
  assert.equal(admitted.diagnostics.setupState, 0);
  assert.ok(admitted.diagnostics.maxCommit >= 128);
  assert.ok(admitted.diagnostics.unusedCommit >= 128);
});

test("a relabelled creation or capacity journal is refused", async (t) => {
  const dir = privateDir(t);
  const record = await evidence();
  for (const [label, patch] of [
    ["capacity plan", { plan: "pixel-capacity-streamed-v1" }],
    ["capacity status", { status: "complete", stage: "blank-verified" }],
    ["cleaned card", { blankBaselineVerified: true }],
    ["failed run", { failure: "diagnostics-uninitialized" }],
    ["no initial baseline", { initialBaselineVerified: false }],
    ["no installed registry", { installedRegistryVerified: false }],
    ["unknown factory version", { factoryVersionVerified: 2 }],
    ["creation build", { build: { ...record.build, mode: "creation" } }],
    ["other source", { build: { ...record.build, source: "f".repeat(40) } }],
    ["other pins", { build: { ...record.build, load: "0".repeat(64) } }],
    [
      "other blocks",
      { build: { ...record.build, blocks: INSTALL_PINS.blocks - 1 } },
    ],
  ]) {
    const receipt = await receiptFor(dir, { ...record, ...patch });
    assert.throws(
      () => verifyInstallationReceipt(receipt, SOURCE),
      label === "capacity plan" || label === "capacity status"
        ? /install-(plan|status)-required/
        : /.+/,
      label,
    );
  }
});

test("evidence must be this source's own receipt of the reviewed installer", async (t) => {
  const dir = privateDir(t);
  const receipt = await receiptFor(dir);
  assert.throws(
    () => verifyInstallationReceipt(receipt, "f".repeat(40)),
    /receipt-source-mismatch/,
  );
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, format: "compact-phase-campaign-v1" },
        SOURCE,
      ),
    /receipt-format-required/,
  );
  // The journal hash names the bytes actually captured, not the path alone.
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, journal: { ...receipt.journal, sha256: "0".repeat(64) } },
        SOURCE,
      ),
    /installation-file-hash-mismatch/,
  );
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, apk: { ...receipt.apk, sha256: "0".repeat(64) } },
        SOURCE,
      ),
    /installation-file-hash-mismatch/,
  );
});

test("readable but wrong diagnostics do not admit a card", async (t) => {
  const dir = privateDir(t);
  const record = await evidence();
  const bad = { ...record, diagnostics: "7fff0a0e0a0014001400000000000004" };
  const receipt = await receiptFor(dir, bad);
  assert.throws(
    () => verifyInstallationReceipt(receipt, SOURCE),
    /diagnostic-mismatch/,
  );
  // Fewer bytes free than the pool reserves is not a consistent reply.
  const short = {
    ...record,
    diagnostics: "7fff0a0e0a0014001400180000000005",
  };
  const shortReceipt = await receiptFor(dir, short);
  assert.throws(
    () => verifyInstallationReceipt(shortReceipt, SOURCE),
    /diagnostic-mismatch/,
  );
  // Malformed evidence is refused before it is interpreted.
  for (const patch of [
    { diagnostics: "zz" },
    { cardKey: "02" },
    { timingsMs: { load: "fast" } },
  ]) {
    const shaped = { ...record, ...patch };
    assert.throws(
      () =>
        verifyInstallationReceipt(
          // Written by hand: the evidence function asserts on the run, not the copy.
          (() => {
            const journal = place(dir, "journal.json", JSON.stringify(shaped));
            return {
              ...{
                format: FORMAT,
                sourceCommit: SOURCE,
                apk: place(dir, "install.apk", Buffer.from("not-a-real-apk")),
              },
              journal,
            };
          })(),
          SOURCE,
        ),
      /install-evidence-shape/,
      Object.keys(patch)[0],
    );
  }
});

test("receipt files must be private, absolute, single-link and in a private directory", async (t) => {
  const dir = privateDir(t);
  const receipt = await receiptFor(dir);
  const open = privateDir(t);
  // Group/other search would let another account read the APK or the capture.
  fs.chmodSync(open, 0o711);
  const loose = path.join(open, "install.apk");
  fs.writeFileSync(loose, "x", { mode: 0o600 });
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, apk: { path: loose, sha256: sha("x") } },
        SOURCE,
      ),
    /private-installation-directory-required/,
  );
  assert.throws(
    () =>
      verifyInstallationReceipt(
        {
          ...receipt,
          apk: { path: "install.apk", sha256: receipt.apk.sha256 },
        },
        SOURCE,
      ),
    /absolute-installation-path-required/,
  );
  const shared = place(dir, "shared.apk", "y", 0o644);
  assert.throws(
    () => verifyInstallationReceipt({ ...receipt, apk: shared }, SOURCE),
    /private-installation-file-required/,
  );
  const linked = place(dir, "linked.apk", "z");
  fs.linkSync(linked.path, path.join(dir, "linked.apk.alias"));
  t.after(() => fs.rmSync(path.join(dir, "linked.apk.alias"), { force: true }));
  assert.throws(
    () => verifyInstallationReceipt({ ...receipt, apk: linked }, SOURCE),
    /private-installation-file-required/,
  );
  const symlink = path.join(dir, "symlink.apk");
  fs.symlinkSync(receipt.apk.path, symlink);
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, apk: { path: symlink, sha256: receipt.apk.sha256 } },
        SOURCE,
      ),
    /private-installation-file-required/,
  );
  assert.throws(
    () =>
      verifyInstallationReceipt(
        { ...receipt, apk: { path: receipt.apk.path, sha256: "nothex" } },
        SOURCE,
      ),
    /installation-hash-required/,
  );
});
