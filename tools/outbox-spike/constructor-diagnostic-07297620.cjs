#!/usr/bin/env node
/* One fixed diagnostic install, retaining all prior objects. No payment or cleanup. */
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { randomBytes } = require("node:crypto");
const { isDeepStrictEqual, parseArgs } = require("node:util");
const { execFileSync } = require("node:child_process");
const profile = require("./constructor-trace-07297620.json");
const trace = require("./constructor-trace.cjs");
const { registryFrames } = require("./run-probe.cjs");
const { CleanupFailure } = require("./unset-up-recovery.cjs");
const { readPrivateJSON, withPhaseJournal } = require("./phase-journal.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const oldAdmission = require("./unset-up-admission.cjs");
const ROOT = path.resolve(__dirname, "../..");
const PLAN =
  "docs/reports/HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.md";
const AUDIT =
  "docs/reports/HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.audit.json";
const JOURNAL = path.join(
  os.homedir(),
  ".cashucard/constructor-trace-07297620-2026-11-05/pass-1/diagnostic.json",
);
const hex = (a) => Buffer.from(a).toString("hex"),
  bytes = (s) => [...Buffer.from(s, "hex")],
  same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const fail = (code) => {
  throw new CleanupFailure(code);
};
function verifyKind(sdk, pages, kind, installed) {
  const rows = pages.filter((p) => p.kind === kind);
  if (rows.length < 1 || rows.length > 4) fail("registry-incomplete");
  let raw = "";
  for (const [i, p] of rows.entries()) {
    if (
      typeof p.data !== "string" ||
      !/^(?:[0-9a-f]{2})*$/.test(p.data) ||
      p.data.length > 510
    )
      fail("registry-framing");
    if (i < rows.length - 1) {
      if (p.sw !== "6310" || !p.data) fail("registry-status");
    } else if (p.sw !== "9000" && !(i === 0 && p.sw === "6a88" && !p.data))
      fail("registry-status");
    raw += p.data;
  }
  let got;
  try {
    got = registryFrames(raw);
    sdk.parseRegistryEntries(bytes(raw));
  } catch {
    fail("registry-framing");
  }
  const initial = profile.initialPages.find((p) => p.kind === kind).data;
  const added = installed
    ? profile.addedPages.find((p) => p.kind === kind).data
    : "";
  const want = registryFrames(initial + added);
  if (
    got.length !== want.length ||
    new Set(got).size !== got.length ||
    got.some((f) => !want.includes(f))
  )
    fail("registry-mismatch");
  return true;
}
function verifyRegistry(sdk, pages, installed) {
  if (
    !Array.isArray(pages) ||
    pages.some((p) => !["applications", "load-files"].includes(p.kind))
  )
    fail("registry-incomplete");
  verifyKind(sdk, pages, "applications", installed);
  verifyKind(sdk, pages, "load-files", installed);
  return true;
}
async function runDiagnostic({
  load,
  stages,
  hash = trace.sha,
  sdk,
  tx: nativeTx,
  save,
  close,
  verifyEvidence,
  random = randomBytes,
  now = () => performance.now(),
  began = now(),
}) {
  const state = {
    plan: profile.planId,
    chip: profile.chip,
    status: "running",
    stage: "admission",
    commands: 0,
    registries: [],
    exchanges: [],
    constructorResult: null,
    artifact: {
      manifest: profile.manifestSha256,
      cap: profile.cap,
      load: profile.load,
    },
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
    if (state.commands >= 128) fail("command-bound");
    const e = {
      command: ++state.commands,
      stage: state.stage,
      header: hex(a.slice(0, 4)),
      sw: null,
    };
    if (![0x50, 0x82].includes(a[1])) {
      const plain =
        a[0] === 0x84
          ? [0x80, ...a.slice(1, 4), a[4] - 8, ...a.slice(5, -9), 0]
          : a;
      e.intentSha256 = trace.sha(Buffer.from(plain));
    }
    state.exchanges.push(e);
    await persist();
    check();
    let timer, r;
    const at = now();
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
    } catch (error) {
      const elapsed = now() - at;
      if (Number.isFinite(elapsed) && elapsed >= 0) e.elapsedMs = elapsed;
      const known =
        error instanceof CleanupFailure
          ? error
          : new CleanupFailure("transport-uncertain");
      e.transportFailure = known.code;
      if (
        typeof known.pcscCode === "string" &&
        /^[0-9a-f]{8}$/.test(known.pcscCode)
      )
        e.pcscCode = known.pcscCode;
      await persist();
      throw known;
    } finally {
      clearTimeout(timer);
    }
    e.elapsedMs = Math.max(0, now() - at);
    if (
      !Array.isArray(r) ||
      r.length < 2 ||
      r.length > 258 ||
      r.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("invalid-reply");
    e.sw = hex(r.slice(-2));
    if (![0x50, 0x82].includes(a[1])) e.data = hex(r.slice(0, -2));
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
        const v = await sdk.readChipIdentity(tx, profile.chip);
        if (state.exchanges.at(-1).data !== profile.cplc) fail("cplc-changed");
        return v;
      },
    );
  const readRegistry = async (name, channel, installed) => {
    const snapshot = { name, pages: [], verified: false };
    state.registries.push(snapshot);
    for (const kind of ["applications", "load-files"]) {
      let complete = false;
      for (let page = 0; page < 4; page++) {
        const plain = sdk.registryCommand(kind, page > 0),
          wrapped = channel.wrap(plain);
        const r = await step(
          name + "-" + kind + "-" + page,
          [exact(wrapped)],
          async () =>
            expect(await sdk.transmit(tx, wrapped), [0x9000, 0x6310, 0x6a88]),
        );
        snapshot.pages.push({
          kind,
          data: hex(r.data),
          sw: r.sw.toString(16).padStart(4, "0"),
        });
        await persist();
        if (r.sw === 0x6310) {
          if (!r.data.length) fail("registry-status");
          continue;
        }
        if (r.sw === 0x6a88 && (page !== 0 || r.data.length))
          fail("registry-status");
        complete = true;
        break;
      }
      if (!complete) fail("registry-incomplete");
      verifyKind(sdk, snapshot.pages, kind, installed);
    }
    verifyRegistry(sdk, snapshot.pages, installed);
    snapshot.verified = true;
    await persist();
  };
  const ack = (r) => {
    if (r.data.length && hex(r.data) !== "00")
      fail("management-reply-mismatch");
    return r;
  };
  const raw = (name, a) =>
    step(name, [exact(a)], async () => expect(await sdk.transmit(tx, a)));
  const write = (name, channel, a) => {
    const wrapped = channel.wrap(a);
    return step(name, [exact(wrapped)], async () =>
      ack(expect(await sdk.transmit(tx, wrapped))),
    );
  };
  try {
    if (
      !Array.isArray(load) ||
      load.length !== profile.bytes ||
      hash(load) !== profile.load
    )
      fail("trace-image-mismatch");
    trace.validateStages(stages, profile.terminalStage);
    const blocks = sdk.splitLoad(load);
    if (blocks.length !== profile.blocks) fail("trace-block-count");
    await identity("match-chip");
    const channel = await step(
      "factory-authentication",
      [
        exact(sdk.selectAid(sdk.ISD_AID)),
        (a) =>
          a.length === 14 &&
          same(a.slice(0, 5), [0x80, 0x50, 1, 0, 8]) &&
          a.at(-1) === 0,
        (a) =>
          a.length === 22 &&
          same(a.slice(0, 5), [0x84, 0x82, 1, 0, 16]) &&
          a.at(-1) === 0,
      ],
      async () => {
        expect(await sdk.transmit(tx, sdk.selectAid(sdk.ISD_AID)));
        const h = await sdk.initializeUpdate(tx, random, 1);
        if (h.reply.kvn !== 1) fail("factory-version-mismatch");
        const keys = sdk.sessionIfMatches(sdk.FACTORY_KEYS, h);
        if (!keys) fail("factory-keys-not-proved");
        return sdk.externalAuthenticate(tx, keys, h);
      },
    );
    state.factoryVersionVerified = 1;
    await persist();
    await readRegistry("initial", channel, false);
    state.initialRegistryVerified = true;
    await persist();
    await write(
      "install-for-load",
      channel,
      sdk.installForLoad(bytes(profile.package)),
    );
    for (const [i, block] of blocks.entries())
      await write("load-" + (i + 1), channel, block);
    for (const [name, suffix] of [
      ["create-opener", "4D"],
      ["create-main", "01"],
    ]) {
      const aid = bytes(profile.package + suffix);
      await write(
        name,
        channel,
        sdk.installAndSelectable(bytes(profile.package), aid, aid),
      );
    }
    await readRegistry("installed", channel, true);
    state.installedRegistryVerified = true;
    await persist();
    const selected = await raw(
      "select-diagnostic",
      sdk.selectAid(bytes(profile.package + "01")),
    );
    if (hex(selected.data) !== trace.SELECT) fail("trace-selection-mismatch");
    const d = await raw("read-diagnostic", [0xb0, 0x7d, 0, 0, 0]);
    try {
      state.constructorResult = trace.decode(
        d.data,
        stages,
        profile.terminalStage,
      );
    } catch {
      fail("trace-diagnostic-invalid");
    }
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
    if (
      cause instanceof CleanupFailure &&
      typeof cause.pcscCode === "string" &&
      /^[0-9a-f]{8}$/.test(cause.pcscCode)
    )
      state.pcscCode = cause.pcscCode;
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
      state.installedRegistryVerified &&
      state.constructorResult &&
      state.finalIdentityVerified
    ) {
      state.status = "diagnostic-recorded";
      state.stage = "diagnostic-verified";
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
  const prior = require("./memory-07297620.cjs").runtimeInfo(python),
    files = { ...prior.files };
  for (const name of [
    "constructor-diagnostic-07297620.cjs",
    "constructor-trace-07297620.json",
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
      path.join(__dirname, "constructor-trace-07297620.json"),
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
                await require("./constructor-diagnostic-transport.cjs").openConstructorBridge(
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
                path.join(__dirname, "constructor_diagnostic_07297620.py"),
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
