#!/usr/bin/env node
/* Post-reset successor: same card, commands, keys, baseline and bounds. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { isDeepStrictEqual, parseArgs } = require("node:util");
const { execFileSync } = require("node:child_process");
const profile = require("./readiness-07297620-v2.json");
const { qualifyBlank, verifyBlank } = require("./readiness-07297620.cjs");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const oldAdmission = require("./unset-up-admission.cjs");
const ROOT = path.resolve(__dirname, "../..");
const PLAN = "docs/reports/HARDWARE_PLAN_2026-11-05.readiness-07297620-2.md";
const AUDIT =
  "docs/reports/HARDWARE_PLAN_2026-11-05.readiness-07297620-2.audit.json";
const JOURNAL = path.join(
  os.homedir(),
  ".cashucard/readiness-07297620-2026-11-05/pass-2/readiness.json",
);
function runtimeInfo(python) {
  const prior = oldAdmission.runtimeInfo(python),
    files = { ...prior.files };
  for (const name of [
    "readiness-07297620.cjs",
    "readiness-07297620-v2.cjs",
    "readiness-07297620.json",
    "readiness-07297620-v2.json",
    "readiness-transport.cjs",
    "readiness_07297620.py",
    "readiness_07297620_v2.py",
  ]) {
    const file = path.join(__dirname, name);
    files[file] = oldAdmission.fileHash(file);
  }
  for (const relative of [PLAN, AUDIT]) {
    const file = path.join(ROOT, relative);
    files[file] = oldAdmission.fileHash(file);
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
    format: "card-readiness-campaign-v1",
    planId: profile.planId,
    approved: profile.approved === true,
    sourceCommit: oldAdmission.sourceInfo().commit,
    python,
    runtimeSha256: runtime.sha256,
    profileSha256: oldAdmission.fileHash(
      path.join(__dirname, "readiness-07297620-v2.json"),
    ),
    planSha256: oldAdmission.fileHash(path.join(ROOT, PLAN)),
    journal: JOURNAL,
  };
}
function admit(o, fresh = true) {
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
    format: "card-readiness-consumed-v1",
    planId: profile.planId,
    campaignSha256: a.campaignSha256,
    journal: JOURNAL,
  };
  const markerHash = createPrivate(JOURNAL + ".consumed", marker),
    began = performance.now();
  let bridge, startupError;
  return withPhaseJournal(
    JOURNAL,
    { plan: profile.planId, status: "admitted", blankBaselineVerified: false },
    async ({ save, retainLease }) => {
      const request = {
        format: "card-readiness-request-v1",
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
      const result = await qualifyBlank({
        planId: profile.planId,
        sdk: require("../cardkit"),
        save,
        began,
        tx: async (apdu) => {
          if (!bridge) {
            admit(o, false);
            try {
              bridge =
                await require("./readiness-transport.cjs").openReadinessBridge({
                  python: a.runtime.python,
                  sitePackages: a.runtime.sitePackages,
                  planId: profile.planId,
                  request: file,
                  sha256,
                  began,
                });
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
                path.join(__dirname, "readiness_07297620_v2.py"),
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
  qualifyBlank,
  verifyBlank,
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
        failure: "readiness-admission-or-startup-refused",
      }),
    );
    process.exitCode = 1;
  });
