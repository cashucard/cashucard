#!/usr/bin/env node
/* Default preview. One exact approved campaign is needed before device access. */
const fs = require("node:fs"),
  path = require("node:path");
const { parseArgs } = require("node:util");
const profile = require("./unset-up-profile.json");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const {
  admission,
  revalidate,
  template,
  sourceInfo,
} = require("./unset-up-admission.cjs");
const { cleanupUnsetUp } = require("./unset-up-recovery.cjs");
const { openUnsetBridge } = require("./unset-up-transport.cjs");
function createPrivate(file, value) {
  const parent = fs.lstatSync(path.dirname(file));
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 0o077) !== 0
  )
    throw Error("private owned directory required");
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const dir = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
  return readPrivateJSON(file).sha256;
}
async function runRecovery(options, deps = {}) {
  const admitted = (deps.admission || admission)(options);
  if (!options.execute)
    return {
      plan: profile.planId,
      approved: admitted.p.approved,
      mode: "preview",
      cardAccessed: false,
      sourceCommit: admitted.p.sourceCommit,
      runtimeSha256: admitted.runtime.sha256,
      journal: admitted.p.journal,
    };
  if (admitted.p.approved !== true)
    throw Error("named execution approval required");
  // Admission owns the exact fixed path. No alternate journal/retry switch.
  const file = admitted.p.journal;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const marker = {
    format: "unset-up-recovery-consumed-v1",
    planId: profile.planId,
    campaignSha256: admitted.campaignSha256,
    journal: file,
  };
  const markerHash = createPrivate(file + ".consumed", marker);
  const began = performance.now();
  let bridge, startupError;
  return withPhaseJournal(
    file,
    { plan: profile.planId, status: "admitted", blankBaselineVerified: false },
    async ({ save, retainLease }) => {
      const request = {
        format: "unset-up-recovery-request-v1",
        planId: profile.planId,
        approved: true,
        chip: profile.chip,
        key: profile.key,
        reader: profile.reader,
        campaignSha256: admitted.campaignSha256,
        profileSha256: admitted.p.profileSha256,
        files: admitted.runtime.files,
        marker: { path: file + ".consumed", sha256: markerHash },
        journal: file,
        python: admitted.runtime.python,
        sitePackages: admitted.runtime.sitePackages,
      };
      const requestFile = file + ".request.json";
      const requestHash = createPrivate(requestFile, request);
      const recheck = () => {
        const again = (deps.revalidate || revalidate)(options);
        if (
          again.campaignSha256 !== admitted.campaignSha256 ||
          again.runtime.sha256 !== admitted.runtime.sha256
        )
          throw Error("admission changed");
      };
      // The initial admission happens before consumption. The same static source,
      // evidence and runtime fence is checked again just before the lazy open.
      let checked = false;
      const result = await cleanupUnsetUp({
        sdk: deps.sdk || require("../cardkit"),
        began,
        save,
        expectedKey: profile.key,
        requirePolicyCompletion: true,
        tx: async (apdu) => {
          if (!bridge) {
            if (!checked) {
              recheck();
              checked = true;
            }
            try {
              bridge = await (deps.openBridge || openUnsetBridge)({
                python: admitted.runtime.python,
                sitePackages: admitted.runtime.sitePackages,
                request: requestFile,
                sha256: requestHash,
                began,
              });
            } catch (error) {
              startupError = error;
              throw error;
            }
          }
          return bridge.tx(apdu);
        },
        close: async () => {
          if (bridge) return bridge.close();
          if (startupError?.closeUncertain)
            throw Error("reader-close-uncertain");
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
async function main() {
  const { values: v } = parseArgs({
    options: {
      describe: { type: "boolean", default: false },
      python: { type: "string" },
      campaign: { type: "string" },
      sha256: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  if (v.describe) {
    if (v.execute || v.campaign || v.sha256 || !v.python)
      throw Error("describe requires only the Python path");
    console.log(
      JSON.stringify(
        {
          manifest: template(v.python),
          sourceClean: sourceInfo().clean,
          cardAccessed: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!v.campaign || !v.sha256 || v.python)
    throw Error("campaign path and SHA-256 required");
  const result = await runRecovery(v);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "stopped") process.exitCode = 1;
}
module.exports = { runRecovery, createPrivate };
if (require.main === module)
  main().catch(() => {
    console.error(
      JSON.stringify({
        status: "stopped",
        failure: "unset-up-admission-or-startup-refused",
      }),
    );
    process.exitCode = 1;
  });
