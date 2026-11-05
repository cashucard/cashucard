#!/usr/bin/env node
/* Fixed public ISD memory snapshot. No authentication or private applet command. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { isDeepStrictEqual, parseArgs } = require("node:util");
const { execFileSync } = require("node:child_process");
const profile = require("./memory-07297620.json");
const { platformMemory } = require("./run-probe.cjs");
const { CleanupFailure } = require("./unset-up-recovery.cjs");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const oldAdmission = require("./unset-up-admission.cjs");
const ROOT = path.resolve(__dirname, "../..");
const PLAN = "docs/reports/HARDWARE_PLAN_2026-11-05.memory-07297620.md";
const AUDIT =
  "docs/reports/HARDWARE_PLAN_2026-11-05.memory-07297620.audit.json";
const JOURNAL = path.join(
  os.homedir(),
  ".cashucard/memory-07297620-2026-11-05/pass-1/memory.json",
);
const hex = (a) => Buffer.from(a).toString("hex"),
  bytes = (s) => [...Buffer.from(s, "hex")],
  same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const fail = (code) => {
  throw new CleanupFailure(code);
};
async function snapshot({
  sdk,
  tx: nativeTx,
  save,
  close,
  verifyEvidence,
  now = () => performance.now(),
  began = now(),
}) {
  const state = {
    plan: profile.planId,
    chip: profile.chip,
    status: "running",
    stage: "admission",
    commands: 0,
    exchanges: [],
    memory: null,
  };
  let permits = [];
  const check = () => {
    if (!Number.isFinite(now()) || now() - began >= 120000)
      fail("elapsed-bound");
  };
  const persist = async () => {
    try {
      await save(structuredClone(state));
    } catch {
      fail("journal-unavailable");
    }
  };
  const tx = async (a) => {
    check();
    const permit = permits.shift();
    if (
      !permit ||
      !permit(a) ||
      a.length > 261 ||
      a.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("command-refused");
    if (state.commands >= 5) fail("command-bound");
    const e = {
      command: ++state.commands,
      stage: state.stage,
      header: hex(a.slice(0, 4)),
      sw: null,
    };
    state.exchanges.push(e);
    await persist();
    check();
    let timer, r;
    try {
      r = await Promise.race([
        nativeTx(a),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new CleanupFailure("reader-response-timeout")),
            Math.max(1, Math.min(30000, 120000 - (now() - began))),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (
      !Array.isArray(r) ||
      r.length < 2 ||
      r.length > 258 ||
      r.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("invalid-reply");
    e.sw = hex(r.slice(-2));
    e.data = hex(r.slice(0, -2));
    await persist();
    check();
    return r;
  };
  const exact = (a) => (b) => same(a, b);
  const step = async (name, allowed, fn) => {
    check();
    state.stage = name;
    permits = allowed;
    await persist();
    check();
    try {
      const r = await fn();
      if (permits.length) fail("missing-command");
      return r;
    } finally {
      permits = [];
    }
  };
  const expect = (r, codes = [0x9000]) => {
    if (!codes.includes(r.sw))
      fail("card-status-" + r.sw.toString(16).padStart(4, "0"));
    return r;
  };
  const identity = (name) =>
    step(
      name,
      [exact(sdk.selectAid(sdk.ISD_AID)), exact([0x80, 0xca, 0x9f, 0x7f, 0])],
      async () => {
        const result = await sdk.readChipIdentity(tx, profile.chip);
        if (state.exchanges.at(-1).data !== profile.cplc) fail("cplc-changed");
        return result;
      },
    );
  try {
    await identity("match-chip");
    const command = [0x80, 0xca, 0xff, 0x21, 0];
    const r = await step("platform-memory", [exact(command)], async () =>
      expect(await sdk.transmit(tx, command)),
    );
    try {
      state.memory = platformMemory(r.data);
    } catch {
      fail("platform-memory-format");
    }
    state.memoryVerified = true;
    await persist();
    await identity("final-match-chip");
    state.finalIdentityVerified = true;
    await persist();
    state.stage = "verify-saved-evidence";
    await persist();
    check();
    try {
      if ((await verifyEvidence()) !== true) fail("saved-evidence-refused");
    } catch {
      fail("saved-evidence-refused");
    }
    state.savedEvidenceVerified = true;
    await persist();
    check();
  } catch (error) {
    state.status = "stopped";
    const cause = error instanceof sdk.TransportError ? error.cause : error;
    state.failure =
      cause instanceof CleanupFailure
        ? cause.code
        : error instanceof sdk.ChipIdentityMismatch
          ? "wrong-chip"
          : error instanceof sdk.CardError
            ? "card-status-" + error.sw.toString(16).padStart(4, "0")
            : "operation-uncertain";
  } finally {
    try {
      const proof = await close();
      state.readerClosed = true;
      state.independentPolicyComplete = proof?.policyComplete === true;
    } catch {
      state.readerClosed = false;
      state.closeFailure = "reader-close-uncertain";
      state.status = "stopped";
      state.failure ??= "reader-close-uncertain";
    }
    if (
      state.status === "running" &&
      (!state.independentPolicyComplete || !state.savedEvidenceVerified)
    ) {
      state.status = "stopped";
      state.failure = "independent-policy-incomplete";
    }
    if (
      state.status === "running" &&
      state.readerClosed &&
      state.memoryVerified &&
      state.finalIdentityVerified
    ) {
      state.status = "measured";
      state.stage = "memory-verified";
    }
    try {
      await persist();
    } catch {
      state.status = "stopped";
      state.failure = "journal-unavailable";
    }
  }
  return state;
}
function runtimeInfo(python) {
  const prior = require("./inspect-07297620.cjs").runtimeInfo(python),
    files = { ...prior.files };
  for (const name of [
    "memory-07297620.cjs",
    "memory-07297620.json",
    "memory-transport.cjs",
    "memory_07297620.py",
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
    format: "card-memory-campaign-v1",
    planId: profile.planId,
    approved: profile.approved === true,
    sourceCommit: oldAdmission.sourceInfo().commit,
    python,
    runtimeSha256: runtime.sha256,
    profileSha256: oldAdmission.fileHash(
      path.join(__dirname, "memory-07297620.json"),
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
    format: "card-memory-consumed-v1",
    planId: profile.planId,
    campaignSha256: a.campaignSha256,
    journal: JOURNAL,
  };
  const markerHash = createPrivate(JOURNAL + ".consumed", marker),
    began = performance.now();
  let bridge, startupError;
  return withPhaseJournal(
    JOURNAL,
    { plan: profile.planId, status: "admitted", memory: null },
    async ({ save, retainLease }) => {
      const request = {
        format: "card-memory-request-v1",
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
      const result = await snapshot({
        sdk: require("../cardkit"),
        save,
        began,
        tx: async (apdu) => {
          if (!bridge) {
            admit(o, false);
            if (performance.now() - began >= 120000)
              throw new CleanupFailure("elapsed-bound");
            try {
              bridge = await require("./memory-transport.cjs").openMemoryBridge(
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
                path.join(__dirname, "memory_07297620.py"),
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
  snapshot,
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
        failure: "memory-admission-or-startup-refused",
      }),
    );
    process.exitCode = 1;
  });
