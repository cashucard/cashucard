#!/usr/bin/env node
/* New fixed invocation after a zero-command host stop. No old journal reuse. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { isDeepStrictEqual, parseArgs } = require("node:util");
const { execFileSync } = require("node:child_process");
const profile = require("./constructor-trace-07297620-v2.json");
const original = require("./constructor-trace-07297620.json");
for (const [k, v] of Object.entries(original))
  if (
    !["planId", "approved", "auditSha256"].includes(k) &&
    !isDeepStrictEqual(v, profile[k])
  )
    throw Error("successor changed device or image");
const {
  runDiagnostic,
  verifyRegistry,
} = require("./constructor-diagnostic-07297620.cjs");
const trace = require("./constructor-trace.cjs");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const { CleanupFailure } = require("./unset-up-recovery.cjs");
const oldAdmission = require("./unset-up-admission.cjs");
const ROOT = path.resolve(__dirname, "../..");
const PLAN =
  "docs/reports/HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.md";
const AUDIT =
  "docs/reports/HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.audit.json";
const JOURNAL = path.join(
  os.homedir(),
  ".cashucard/constructor-trace-07297620-2026-11-05/pass-2/diagnostic.json",
);
function runtimeInfo(python) {
  const prior = require("./memory-07297620.cjs").runtimeInfo(python),
    files = { ...prior.files };
  for (const name of [
    "constructor-diagnostic-07297620.cjs",
    "constructor-trace-07297620.json",
    "constructor-trace-07297620-v2.json",
    "constructor-diagnostic-07297620-v2.cjs",
    "constructor-diagnostic-v2-transport.cjs",
    "constructor_diagnostic_07297620_v2.py",
    "constructor-trace.cjs",
    "constructor-diagnostic-transport.cjs",
    "constructor_diagnostic_07297620.py",
  ]) {
    const file = path.join(__dirname, name);
    files[file] = oldAdmission.fileHash(file);
  }
  for (const relative of [PLAN, AUDIT]) {
    const file = path.join(ROOT, relative);
    files[file] = oldAdmission.fileHash(file);
  }
  const verified = trace.artifact({
    manifest: path.join(profile.artifactDir, "manifest.json"),
    manifestHash: profile.manifestSha256,
  });
  if (
    verified.manifest.capSha256 !== profile.cap ||
    verified.manifest.loadFileSha256 !== profile.load ||
    verified.load.length !== profile.bytes ||
    verified.manifest.stageCount !== profile.stageCount ||
    verified.manifest.terminalStage !== profile.terminalStage
  )
    throw Error("trace-artifact-binding");
  for (const n of [
    "manifest.json",
    "constructor-trace.cap",
    "load-file.bin",
    "stages.json",
    ...Object.keys(verified.manifest.generatedSources).map(
      (n) => "src/me/flashapp/cashu/" + n,
    ),
  ]) {
    const f = path.join(profile.artifactDir, n);
    files[f] = oldAdmission.fileHash(f);
  }
  return {
    ...prior,
    files,
    sha256: oldAdmission.hash(
      JSON.stringify({
        prior: prior.sha256,
        files: Object.fromEntries(
          Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
        ),
      }),
    ),
  };
}
function template(python) {
  const runtime = runtimeInfo(python);
  return {
    format: "card-constructor-diagnostic-campaign-v1",
    planId: profile.planId,
    approved: profile.approved === true,
    sourceCommit: oldAdmission.sourceInfo().commit,
    python,
    runtimeSha256: runtime.sha256,
    profileSha256: oldAdmission.fileHash(
      path.join(__dirname, "constructor-trace-07297620-v2.json"),
    ),
    planSha256: oldAdmission.fileHash(path.join(ROOT, PLAN)),
    journal: JOURNAL,
  };
}
function admit(o, fresh = true) {
  if (o.execute && profile.approved !== true)
    throw Error("execution approval required");
  const record = readPrivateJSON(o.campaign),
    p = record.value;
  if (record.sha256 !== o.sha256 || !isDeepStrictEqual(p, template(p.python)))
    throw Error("campaign changed");
  if (!oldAdmission.sourceInfo().clean) throw Error("clean source required");
  if (o.execute && p.approved !== true)
    throw Error("execution approval required");
  if (oldAdmission.fileHash(path.join(ROOT, AUDIT)) !== profile.auditSha256)
    throw Error("audit changed");
  for (const auditFile of [AUDIT, oldAdmission.AUDIT]) {
    const a = JSON.parse(fs.readFileSync(path.join(ROOT, auditFile)));
    for (const [relative, digest] of Object.entries(a.sourceHashes || {}))
      if (oldAdmission.fileHash(path.join(ROOT, relative)) !== digest)
        throw Error("protected source changed");
    for (const e of a.evidence || a.journals)
      if (oldAdmission.fileHash(e.path) !== e.sha256)
        throw Error("historical evidence changed");
  }
  if (
    fresh &&
    ["", ".consumed", ".lock", ".request.json"].some((s) =>
      fs.existsSync(p.journal + s),
    )
  )
    throw Error("campaign consumed");
  return { p, runtime: runtimeInfo(p.python), campaignSha256: record.sha256 };
}
async function run(o) {
  const a = admit(o);
  if (!o.execute)
    return {
      mode: "preview",
      approved: a.p.approved,
      cardAccessed: false,
      ...a.p,
    };
  fs.mkdirSync(path.dirname(JOURNAL), { recursive: true, mode: 0o700 });
  const marker = {
    format: "card-constructor-diagnostic-consumed-v1",
    planId: profile.planId,
    campaignSha256: a.campaignSha256,
    journal: JOURNAL,
  };
  const markerHash = createPrivate(JOURNAL + ".consumed", marker),
    began = performance.now();
  let bridge, startupError;
  return withPhaseJournal(
    JOURNAL,
    { plan: profile.planId, status: "admitted", constructorResult: null },
    async ({ save, retainLease }) => {
      const request = {
        format: "card-constructor-diagnostic-request-v1",
        planId: profile.planId,
        approved: true,
        profileSha256: a.p.profileSha256,
        python: a.runtime.python,
        sitePackages: a.runtime.sitePackages,
        files: a.runtime.files,
        marker: { path: JOURNAL + ".consumed", sha256: markerHash },
        journal: JOURNAL,
        campaignSha256: a.campaignSha256,
      };
      const file = JOURNAL + ".request.json",
        sha256 = createPrivate(file, request);
      const image = trace.artifact({
        manifest: path.join(profile.artifactDir, "manifest.json"),
        manifestHash: profile.manifestSha256,
      });
      const result = await runDiagnostic({
        planId: profile.planId,
        load: [...image.load],
        stages: image.stages,
        sdk: require("../cardkit"),
        save,
        began,
        tx: async (apdu) => {
          if (!bridge) {
            admit(o, false);
            if (performance.now() - began >= 120000)
              throw new CleanupFailure("elapsed-bound");
            try {
              bridge =
                await require("./constructor-diagnostic-v2-transport.cjs").openConstructorBridge(
                  {
                    python: a.runtime.python,
                    sitePackages: a.runtime.sitePackages,
                    planId: profile.planId,
                    request: file,
                    sha256,
                    began,
                  },
                );
            } catch (e) {
              startupError = e;
              throw e;
            }
          }
          return bridge.tx(apdu);
        },
        close: async () => {
          if (bridge) return bridge.close();
          if (startupError?.closeUncertain) throw Error("close uncertain");
        },
        verifyEvidence: async () => {
          const r = readPrivateJSON(JOURNAL);
          const p = JSON.parse(
            execFileSync(
              a.runtime.python,
              [
                "-I",
                "-S",
                "-B",
                path.join(__dirname, "constructor_diagnostic_07297620_v2.py"),
                "--verify-journal",
                JOURNAL,
                "--sha256",
                r.sha256,
              ],
              {
                encoding: "utf8",
                timeout: Math.max(
                  1,
                  Math.min(5000, 120000 - (performance.now() - began)),
                ),
                stdio: ["ignore", "pipe", "ignore"],
              },
            ),
          );
          return p.savedEvidenceVerified === true;
        },
      });
      if (result.closeFailure) {
        const pid = bridge?.pid || startupError?.bridgePid;
        retainLease(pid ? { bridgePid: pid } : {});
      }
      return result;
    },
  );
}
module.exports = {
  runDiagnostic,
  verifyRegistry,
  template,
  runtimeInfo,
  admit,
  run,
  JOURNAL,
};
if (require.main === module)
  (async () => {
    const { values: v } = parseArgs({
      options: {
        describe: { type: "boolean" },
        python: { type: "string" },
        campaign: { type: "string" },
        sha256: { type: "string" },
        execute: { type: "boolean" },
      },
    });
    if (v.describe) {
      if (!v.python || v.execute || v.campaign || v.sha256)
        throw Error("describe arguments");
      console.log(JSON.stringify(template(v.python), null, 2));
      return;
    }
    if (!v.campaign || !v.sha256 || v.python) throw Error("campaign arguments");
    const r = await run(v);
    console.log(JSON.stringify(r, null, 2));
    if (r.status === "stopped") process.exitCode = 1;
  })().catch(() => {
    console.error(
      JSON.stringify({
        status: "stopped",
        failure: "constructor-diagnostic-admission-or-startup-refused",
      }),
    );
    process.exitCode = 1;
  });
