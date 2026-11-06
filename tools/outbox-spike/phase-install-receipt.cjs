/* Validate the private installation receipt that admits a card to phase zero.
   Reads local files only: no NFC, no transport, no device. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { diagnostics } = require("./run-compact.cjs");
const PINS = require("./pixel-install.json");
const FORMAT = "compact-phase-install-v1";
const STATUS = "installed-for-phases";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const hex64 = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

// A receipt names two files by absolute path and hash. Each must be a regular
// file the operator owns, in a private directory, reachable by exactly one link
// and signed by no other. Anything else is rejected before it is read.
function pinnedFile(file, expected, limit) {
  assert.ok(path.isAbsolute(file), "absolute-installation-path-required");
  if (!hex64(expected)) throw Error("installation-hash-required");
  const parent = fs.lstatSync(path.dirname(file));
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 0o077) !== 0
  )
    throw Error("private-installation-directory-required");
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.uid !== process.getuid() ||
    before.nlink !== 1 ||
    (before.mode & 0o077) !== 0
  )
    throw Error("private-installation-file-required");
  if (before.size > limit) throw Error("installation-file-size-bound");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const after = fs.fstatSync(fd);
    if (after.ino !== before.ino || after.dev !== before.dev)
      throw Error("installation-file-changed");
    const raw = fs.readFileSync(fd);
    if (sha(raw) !== expected) throw Error("installation-file-hash-mismatch");
    return raw;
  } finally {
    fs.closeSync(fd);
  }
}

// The capture must be well-formed JSON: a compressed public key, the 32-byte
// diagnostic reply, and numeric timings, nothing interpreted from strings.
function journalShape(record) {
  return (
    /^(02|03)[0-9a-f]{64}$/.test(record?.cardKey ?? "") &&
    /^[0-9a-f]{32}$/.test(record?.diagnostics ?? "") &&
    Object.values(record?.timingsMs ?? {}).every(
      (ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0,
    )
  );
}

// The evidence must be this profile's own successful run of the reviewed
// installer: the install plan, its terminal status, both baselines, the factory
// version, the image pins, and a card left uninitialized. The phone app does not
// journal the CPLC, so the receipt returns no chip and the admission compares it.
function verifyInstallEvidence(record, receipt, pins) {
  assert.equal(record.plan, pins.plan, "install-plan-required");
  assert.equal(record.status, STATUS, "install-status-required");
  assert.equal(record.stage, STATUS, "install-stage-required");
  assert.equal(record.failure, undefined, "failed-install-not-admitted");
  assert.equal(record.factoryVersionVerified, 1, "factory-version-required");
  assert.equal(
    record.initialBaselineVerified,
    true,
    "initial-baseline-required",
  );
  assert.equal(
    record.installedRegistryVerified,
    true,
    "installed-registry-required",
  );
  // A cleanup or capacity run proves the opposite state; only this flag may.
  assert.ok(!record.blankBaselineVerified, "cleanup-not-admitted");
  assert.equal(
    record.build?.mode,
    "phase-install",
    "install-build-mode-required",
  );
  assert.equal(
    record.build.source,
    receipt.sourceCommit,
    "install-source-mismatch",
  );
  for (const key of ["manifest", "cap", "load"])
    assert.equal(record.build[key], pins[key], "install-pin-mismatch");
  assert.equal(record.build.blocks, pins.blocks, "install-block-count");
  assert.deepEqual(
    record.artifact,
    { source: pins.source, cap: pins.cap, load: pins.load },
    "install-artifact-mismatch",
  );
  if (!journalShape(record)) throw Error("install-evidence-shape");
  // Format 5 at nothing set up. The persistent cursor is at its 32767 sentinel
  // because no record was ever retired, so only the free-commit floor counts.
  return diagnostics(Buffer.from(record.diagnostics, "hex"), 0);
}

// `receipt` is the parsed installation receipt; `sourceCommit` is the clean
// local commit whose installer produced the APK. Both files are read here.
function verifyInstallationReceipt(receipt, sourceCommit) {
  assert.ok(receipt && typeof receipt === "object", "receipt-required");
  assert.equal(receipt.format, FORMAT, "receipt-format-required");
  assert.match(receipt.sourceCommit ?? "", /^[0-9a-f]{40}$/);
  assert.equal(receipt.sourceCommit, sourceCommit, "receipt-source-mismatch");
  for (const key of ["apk", "journal"])
    assert.ok(
      receipt[key] && typeof receipt[key] === "object",
      "receipt-" + key + "-required",
    );
  // Both files are pinned, never parsed beyond the capture's single record.
  pinnedFile(receipt.apk.path, receipt.apk.sha256, 200 * 1024 * 1024);
  const raw = pinnedFile(
    receipt.journal.path,
    receipt.journal.sha256,
    1024 * 1024,
  );
  let record;
  try {
    record = JSON.parse(raw.toString("utf8"));
  } catch {
    throw Error("install-evidence-json");
  }
  const diag = verifyInstallEvidence(record, receipt, PINS);
  return {
    plan: record.plan,
    status: record.status,
    chip: null,
    cardKey: record.cardKey,
    sourceCommit: receipt.sourceCommit,
    apkSha256: receipt.apk.sha256,
    journalSha256: receipt.journal.sha256,
    diagnostics: {
      maxCommit: diag.maxCommit,
      unusedCommit: diag.unusedCommit,
      setupState: diag.setupState,
    },
    mode: record.build.mode,
  };
}

module.exports = {
  FORMAT,
  pinnedFile,
  verifyInstallEvidence,
  verifyInstallationReceipt,
};
