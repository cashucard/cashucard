/* Private campaign admission. Preview performs local reads; execution needs approval. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const { verifyInstallationReceipt } = require("./phase-install-receipt.cjs");
const {
  preparePhase,
  executePhase,
  reconcilePhase,
} = require("./phase-recovery.cjs");
const { openPhaseBridge } = require("./phase-transport.cjs");
const { compactArtifact } = require("./run-compact.cjs");
const pins = require("./pixel-streamed.json");
// The install profile loads the same qualified image and creates the same
// package, so phase zero admits both plans by the pins they share.
const INSTALL_PLAN = require("./pixel-install.json").plan;
const READER = "ACS ACR122U PICC Interface";
const ROOT = path.resolve(__dirname, "../..");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const image = Object.fromEntries(
  ["source", "manifest", "cap", "load"].map((k) => [k, pins[k]]),
);
function phaseRuntime(python) {
  assert.ok(typeof python === "string" && path.isAbsolute(python));
  fs.accessSync(python, fs.constants.X_OK);
  const prefix = path.dirname(path.dirname(python));
  const lib = path.join(prefix, "lib");
  const sites = fs
    .readdirSync(lib)
    .filter((n) => /^python\d+\.\d+$/.test(n))
    .map((n) => path.join(lib, n, "site-packages"))
    .filter((p) => fs.existsSync(path.join(p, "smartcard")));
  assert.equal(sites.length, 1, "one reviewed pyscard installation required");
  const sitePackages = fs.realpathSync(sites[0]);
  const parts = [
    process.platform,
    os.release(),
    process.arch,
    process.versions.node,
    sha(fs.readFileSync(fs.realpathSync(process.execPath))),
    sha(fs.readFileSync(fs.realpathSync(python))),
    sha(fs.readFileSync(path.join(prefix, "pyvenv.cfg"))),
  ];
  for (const name of [
    "phase-device.cjs",
    "phase-transport.cjs",
    "phase_bridge.py",
    "phase_wire.py",
    "probe_bridge.py",
    "../cardctl/bip340.py",
  ])
    parts.push(name + ":" + sha(fs.readFileSync(path.join(__dirname, name))));
  const walk = (dir, relative = "smartcard") => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "__pycache__") continue;
      const p = path.join(dir, entry.name),
        name = relative + "/" + entry.name;
      if (entry.isDirectory()) walk(p, name);
      else {
        assert.ok(entry.isFile(), "runtime symlink refused");
        parts.push(name + ":" + sha(fs.readFileSync(p)));
      }
    }
  };
  walk(path.join(sitePackages, "smartcard"));
  return { python, sitePackages, sha256: sha(JSON.stringify(parts)) };
}
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
function admission(options, dependencies = {}, includeJournal = true) {
  const approved = readPrivateJSON(options.campaign);
  assert.equal(approved.sha256, options.sha256, "campaign changed");
  const p = approved.value;
  assert.deepEqual(
    Object.keys(p).sort(),
    [
      "approved",
      "artifact",
      "binding",
      "chip",
      "format",
      "installation",
      "journal",
      "python",
      "reader",
      "sourceCommit",
    ].sort(),
  );
  assert.equal(p.format, "compact-phase-campaign-v1");
  assert.equal(p.reader, READER);
  assert.equal(p.chip, pins.chip);
  assert.ok(typeof p.approved === "boolean");
  if (options.execute)
    assert.equal(p.approved, true, "named hardware approval required");
  assert.ok(["execute", "reconcile"].includes(options.mode || "execute"));
  assert.match(p.sourceCommit, /^[0-9a-f]{40}$/);
  const source = (dependencies.sourceInfo || sourceInfo)();
  assert.ok(
    source.clean && source.commit === p.sourceCommit,
    "reviewed clean source required",
  );
  const runtime = phaseRuntime(p.python);
  assert.equal(p.binding.runtimeSha256, runtime.sha256, "runtime changed");
  assert.ok(path.isAbsolute(p.artifact));
  const a = (dependencies.inspectArtifact || compactArtifact)({
    manifest: path.join(p.artifact, "manifest.json"),
    manifestHash: pins.manifest,
    sourceCommit: pins.source,
  });
  assert.equal(a.manifest.capSha256, pins.cap);
  assert.equal(a.manifest.loadFileSha256, pins.load);
  assert.equal(a.load.length, pins.bytes);
  const receipt = readPrivateJSON(p.installation.path);
  assert.equal(
    receipt.sha256,
    p.installation.sha256,
    "installation receipt changed",
  );
  const r = receipt.value;
  // The same contract the installer's own tests hold the receipt to: pinned
  // files, this source's installer, and an uninitialized format-5 card.
  const evidence = verifyInstallationReceipt(r, r.sourceCommit);
  assert.equal(evidence.plan, INSTALL_PLAN);
  // The phone journals no CPLC; the campaign names the card and the app only
  // admitted that one, so the campaign's chip is compared here.
  assert.equal(evidence.cardKey, p.binding.key);
  assert.equal(evidence.mode, "phase-install");
  assert.equal(evidence.sourceCommit, r.sourceCommit);
  assert.ok(
    Math.min(
      evidence.diagnostics.maxCommit,
      evidence.diagnostics.unusedCommit,
    ) >= 128,
  );
  if (!includeJournal) return { p, runtime, campaignSha256: approved.sha256 };
  const current = readPrivateJSON(p.journal);
  assert.equal(current.value.binding.chip, pins.chip);
  assert.deepEqual(current.value.binding.image, image);
  const program = preparePhase({
    journal: current.value,
    binding: p.binding,
    recover: options.mode === "reconcile",
  });
  return {
    p,
    program,
    runtime,
    journalSha256: current.sha256,
    campaignSha256: approved.sha256,
  };
}
function previewDevicePhase(options, dependencies = {}) {
  const a = admission({ ...options, execute: false }, dependencies);
  return {
    approved: a.p.approved,
    campaignSha256: a.campaignSha256,
    journalSha256: a.journalSha256,
    programSha256: sha(JSON.stringify(a.program) + "\n"),
    phase: a.program.phase,
    step: a.program.step,
    commands: a.program.commands.length,
    mode: a.program.mode,
    deviceOpened: false,
  };
}
async function runDevicePhase(options, dependencies = {}) {
  const a = admission({ ...options, execute: true }, dependencies);
  return withPhaseJournal(
    a.p.journal,
    null,
    async ({ journal, save, retainLease }) => {
      assert.equal(
        readPrivateJSON(a.p.journal).sha256,
        a.journalSha256,
        "journal changed before lease",
      );
      const program = preparePhase({
        journal,
        binding: a.p.binding,
        recover: options.mode === "reconcile",
      });
      assert.deepEqual(program, a.program);
      const request = path.join(
        path.dirname(a.p.journal),
        "phase-wire-" + randomUUID() + ".json",
      );
      const raw = JSON.stringify(program) + "\n",
        fd = fs.openSync(request, "wx", 0o600);
      try {
        fs.writeFileSync(fd, raw);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const directory = fs.openSync(path.dirname(request), "r");
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
      let bridge,
        opening = false,
        closeFailed = false,
        result;
      const tx = async (apdu) => {
        if (!bridge) {
          if (opening) throw Error("bridge startup already attempted");
          const fresh = admission(
            { ...options, execute: true },
            dependencies,
            false,
          );
          assert.equal(fresh.campaignSha256, a.campaignSha256);
          assert.deepEqual(fresh.runtime, a.runtime);
          opening = true;
          bridge = await (dependencies.openBridge || openPhaseBridge)({
            ...a.runtime,
            request,
            sha256: sha(raw),
          });
        }
        return bridge.tx(apdu);
      };
      try {
        result = await (
          options.mode === "reconcile" ? reconcilePhase : executePhase
        )({ journal, save, tx, binding: a.p.binding });
      } finally {
        if (bridge) {
          try {
            await bridge.close();
          } catch {
            closeFailed = true;
            retainLease({ bridgePid: bridge.pid });
          }
        } else if (opening) {
          closeFailed = true;
          retainLease({ bridgePid: result?.journal?.intent?.bridgePid });
        }
      }
      if (closeFailed) {
        result = {
          ...result,
          primaryFailure: result.failure,
          outcome: "stopped",
          failure: "reader-close-failed",
          leaseRetained: true,
        };
      }
      return {
        ...result,
        request,
        programSha256: sha(raw),
        deviceOpened: opening,
      };
    },
  );
}
module.exports = { phaseRuntime, previewDevicePhase, runDevicePhase };
if (require.main === module) {
  const { values } = require("node:util").parseArgs({
    options: {
      campaign: { type: "string" },
      sha256: { type: "string" },
      mode: { type: "string", default: "execute" },
      execute: { type: "boolean", default: false },
    },
  });
  Promise.resolve()
    .then(() =>
      values.execute ? runDevicePhase(values) : previewDevicePhase(values),
    )
    .then((r) => {
      const { journal, ...summary } = r;
      process.stdout.write(JSON.stringify(summary) + "\n");
    })
    .catch(() => {
      process.stderr.write(
        "Phase admission or execution failed; retain local evidence.\n",
      );
      process.exitCode = 1;
    });
}
