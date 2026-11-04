/* Local-file admission only. No reader imports, enumeration or hardware I/O. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const { readPrivateJSON } = require("./phase-journal.cjs");
const profile = require("./unset-up-profile.json");
const ROOT = path.resolve(__dirname, "../..");
const PLAN = "docs/reports/HARDWARE_PLAN_2026-11-04.recover-unset-up-3.md";
const APPROVAL =
  "docs/reports/HARDWARE_APPROVAL_2026-11-04.recover-unset-up-3.json";
const AUDIT =
  "docs/reports/HARDWARE_PLAN_2026-11-04.recover-unset-up-3.audit.json";
const JOURNAL = path.join(
  os.homedir(),
  ".cashucard/recover-unset-up-2026-11-04/attempt-4/recover.json",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (file) => hash(fs.readFileSync(file));
const assert = (ok, message) => {
  if (!ok) throw Error(message);
};
function sourceInfo() {
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    clean:
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        { cwd: ROOT, encoding: "utf8" },
      ).trim() === "",
  };
}
function runtimeInfo(python) {
  assert(
    typeof python === "string" && path.isAbsolute(python),
    "absolute Python required",
  );
  fs.accessSync(python, fs.constants.X_OK);
  const prefix = path.dirname(path.dirname(python)),
    lib = path.join(prefix, "lib");
  const sites = fs
    .readdirSync(lib)
    .filter((n) => /^python\d+\.\d+$/.test(n))
    .map((n) => path.join(lib, n, "site-packages"))
    .filter((p) => fs.existsSync(path.join(p, "smartcard")));
  assert(sites.length === 1, "one reviewed pyscard package required");
  const sitePackages = fs.realpathSync(sites[0]);
  const files = {};
  const pin = (file) => {
    const p = fs.realpathSync(file);
    assert(fs.lstatSync(p).isFile(), "runtime file required");
    files[p] = fileHash(p);
  };
  const walk = (directory) => {
    for (const e of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "__pycache__") continue;
      const p = path.join(directory, e.name);
      assert(!e.isSymbolicLink(), "runtime symlink refused");
      if (e.isDirectory()) walk(p);
      else {
        assert(e.isFile(), "runtime file required");
        pin(p);
      }
    }
  };
  for (const name of [
    "tools/outbox-spike/recover-unset-up.cjs",
    "tools/outbox-spike/unset-up-recovery.cjs",
    "tools/outbox-spike/unset-up-admission.cjs",
    "tools/outbox-spike/unset-up-transport.cjs",
    "tools/outbox-spike/unset_up_bridge.py",
    "tools/outbox-spike/unset_up_policy.py",
    "tools/outbox-spike/unset-up-profile.json",
    "tools/outbox-spike/phase-journal.cjs",
    "tools/outbox-spike/run-compact.cjs",
    "tools/outbox-spike/run-probe.cjs",
    "tools/outbox-spike/compact_bridge.py",
    "tools/outbox-spike/compact_recovery_bridge.py",
    "tools/outbox-spike/probe_bridge.py",
    "tools/outbox-spike/compact-export.cjs",
    "tools/outbox-spike/compact-workload.cjs",
    "tools/outbox-spike/pixel-control.js",
    "tools/outbox-spike/pixel-capacity.js",
    "tools/outbox-spike/pixel-install.json",
    "tools/outbox-spike/pixel-optimized.json",
    "tools/outbox-spike/pixel-streamed.json",
    "tools/outbox-spike/fixtures/assisted-settlement-v1.json",
    "tools/outbox-spike/fixtures/compact-capacity-v1.json",
    "tools/cardsim/cashu-crypto.cjs",
    "tools/cardkit/package.json",
    "tools/cardkit/yarn.lock",
    AUDIT,
    PLAN,
    APPROVAL,
  ])
    pin(path.join(ROOT, name));
  pin(process.execPath);
  pin(python);
  pin(path.join(prefix, "pyvenv.cfg"));
  walk(path.join(ROOT, "tools/cardkit/dist"));
  for (const name of ["curves", "hashes"])
    walk(path.join(ROOT, "tools/cardkit/node_modules/@noble", name));
  walk(path.join(sitePackages, "smartcard"));
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    python,
    sitePackages,
    files: sorted,
    sha256: hash(
      JSON.stringify({
        files: sorted,
        platform: process.platform,
        os: os.release(),
        arch: process.arch,
        node: process.versions.node,
      }),
    ),
  };
}
function approvalInfo() {
  const file = path.join(ROOT, APPROVAL),
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(
    value.format === "unset-up-execution-approval-v1" &&
      value.planId === profile.planId &&
      typeof value.approved === "boolean",
    "tracked approval invalid",
  );
  return { value, sha256: fileHash(file) };
}
function template(python, deps = {}) {
  const runtime = (deps.runtimeInfo || runtimeInfo)(python),
    source = (deps.sourceInfo || sourceInfo)(),
    approval = (deps.approvalInfo || approvalInfo)();
  return {
    format: "unset-up-recovery-campaign-v1",
    planId: profile.planId,
    approved: approval.value.approved,
    sourceCommit: source.commit,
    python,
    runtimeSha256: runtime.sha256,
    profileSha256: fileHash(path.join(__dirname, "unset-up-profile.json")),
    approvalSha256: approval.sha256,
    planSha256: fileHash(path.join(ROOT, PLAN)),
    journal: deps.journalPath || JOURNAL,
  };
}
function revalidate(options, deps = {}) {
  const record = readPrivateJSON(options.campaign);
  assert(record.sha256 === options.sha256, "campaign changed");
  const p = record.value;
  const keys = [
    "format",
    "planId",
    "approved",
    "sourceCommit",
    "python",
    "runtimeSha256",
    "profileSha256",
    "approvalSha256",
    "planSha256",
    "journal",
  ];
  assert(
    Object.keys(p).sort().join(",") === keys.sort().join(","),
    "campaign fields",
  );
  assert(
    p.format === "unset-up-recovery-campaign-v1" &&
      p.planId === profile.planId &&
      typeof p.approved === "boolean",
    "campaign profile",
  );
  assert(
    p.journal === (deps.journalPath || JOURNAL),
    "named one-shot journal required",
  );
  const source = (deps.sourceInfo || sourceInfo)();
  assert(
    source.clean && source.commit === p.sourceCommit,
    "reviewed clean source required",
  );
  const expected = template(p.python, deps);
  assert(
    isDeepStrictEqual(p, expected),
    "campaign source, runtime or approval changed",
  );
  const approval = (deps.approvalInfo || approvalInfo)();
  if (options.execute) {
    assert(
      p.approved === true && approval.value.approved === true,
      "named execution approval required",
    );
    assert(
      approval.value.planSha256 === p.planSha256,
      "approval must bind final plan",
    );
  }
  const auditFile = path.join(ROOT, AUDIT);
  assert(
    fileHash(auditFile) === profile.auditSha256,
    "historical audit changed",
  );
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  for (const [relative, sha256] of Object.entries(audit.sourceHashes))
    assert(
      fileHash(path.join(ROOT, relative)) === sha256,
      "protected source changed",
    );
  for (const evidence of audit.journals)
    assert(
      fileHash(evidence.path) === evidence.sha256,
      "historical journal changed",
    );
  const runtime = (deps.runtimeInfo || runtimeInfo)(p.python);
  assert(
    runtime.sha256 === p.runtimeSha256,
    "runtime changed during admission",
  );
  return { p, runtime, campaignSha256: record.sha256 };
}
function admission(options, deps = {}) {
  const admitted = revalidate(options, deps),
    file = admitted.p.journal;
  assert(
    !fs.existsSync(file) &&
      !fs.existsSync(file + ".consumed") &&
      !fs.existsSync(file + ".lock") &&
      !fs.existsSync(file + ".request.json"),
    "plan already consumed or journal exists",
  );
  return admitted;
}
module.exports = {
  ROOT,
  JOURNAL,
  PLAN,
  APPROVAL,
  AUDIT,
  hash,
  fileHash,
  sourceInfo,
  runtimeInfo,
  approvalInfo,
  template,
  admission,
  revalidate,
};
