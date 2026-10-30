/* Private factory-key bench drill. Preview performs filesystem reads only. */
const fs = require("node:fs"),
  path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { parseArgs } = require("node:util");
const {
  openBridge,
  journalFile,
  registryFrames,
  PLATFORM_FILES,
  ProbeFailure,
  failureEvidence,
} = require("./run-probe.cjs");
const {
  PACKAGE,
  SMALL,
  MAX,
  cmd,
  workload,
  verifyPacket,
} = require("./compact-workload.cjs");
const READER = "ACS ACR122U PICC Interface";
// Observed card-specific baselines, not a general permission for D321 cards.
const BASELINES = Object.freeze({
  "cplc-v1:4790d3213041093363205547": Object.freeze([...PLATFORM_FILES]),
  "cplc-v1:4790d3213180072976207515": Object.freeze([
    ...PLATFORM_FILES,
    "e3214f0da00000016443446f634c6974659f700101ce020100cc08a000000151000000",
  ]),
});
const AIDS = [PACKAGE + "01", PACKAGE + "4D", PACKAGE];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fail = (code) => {
  throw new ProbeFailure(code);
};
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const NAMES = [
  "CashuApplet.java",
  "CompactState.java",
  "Opener.java",
  "SchnorrHW.java",
  "Tag.java",
  "TagSwitch.java",
].sort();
function compactArtifact(options) {
  const raw = fs.readFileSync(options.manifest);
  if (
    !/^[a-f0-9]{64}$/.test(options.manifestHash) ||
    sha(raw) !== options.manifestHash
  )
    throw Error("manifest pin mismatch");
  const m = JSON.parse(raw),
    directory = path.dirname(options.manifest);
  if (
    m.kind !== "compact-javacard-prototype" ||
    m.probeFormat !== 5 ||
    m.packageAid !== PACKAGE ||
    m.poolBytes !== 16384 ||
    m.deferredDleqBytes !== 12288 ||
    !/^[a-f0-9]{40}$/.test(options.sourceCommit) ||
    m.sourceCommit !== options.sourceCommit ||
    m.classShape?.declaredInstanceSize !== 50 ||
    m.classShape?.firstReferenceToken !== 0 ||
    m.classShape?.referenceCount !== 50 ||
    JSON.stringify(Object.keys(m.generatedSources ?? {}).sort()) !==
      JSON.stringify(NAMES)
  )
    throw Error("unsupported private image");
  for (const name of NAMES)
    if (
      sha(
        fs.readFileSync(path.join(directory, "src/me/flashapp/cashu", name)),
      ) !== m.generatedSources[name]
    )
      throw Error("generated source mismatch");
  const cap = fs.readFileSync(path.join(directory, "resource-probe.cap")),
    load = fs.readFileSync(path.join(directory, "load-file.bin"));
  if (
    sha(cap) !== m.capSha256 ||
    sha(load) !== m.loadFileSha256 ||
    load.length !== m.loadFileSize ||
    load.length === 0 ||
    load.length > 63232
  )
    throw Error("artifact bytes mismatch");
  return { manifest: m, load };
}
function fingerprint() {
  const files = [
    "run-compact.cjs",
    "compact-workload.cjs",
    "compact_bridge.py",
    "run-probe.cjs",
    "probe_bridge.py",
    "compact-export.cjs",
    "fixtures/assisted-settlement-v1.json",
    "fixtures/compact-capacity-v1.json",
    "../cardsim/cashu-crypto.cjs",
    "../cardkit/package.json",
    "../cardkit/yarn.lock",
  ];
  function walk(directory) {
    for (const entry of fs
      .readdirSync(path.join(__dirname, directory), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = directory + "/" + entry.name;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.push(p);
      else throw Error("unexpected SDK entry");
    }
  }
  walk("../cardkit/dist");
  return sha(
    Buffer.from(
      files
        .map(
          (file) =>
            file + ":" + sha(fs.readFileSync(path.join(__dirname, file))),
        )
        .join("\n"),
    ),
  );
}
function diagnostics(data, ready) {
  const b = Buffer.from(data);
  if (
    b.length !== 16 ||
    b[15] !== 5 ||
    b[14] !== ready ||
    b.readUInt16BE(10) !== (ready === 2 ? 16384 : 0) ||
    b.readUInt16BE(12) !== (ready === 2 ? 12288 : 0) ||
    [0, 2, 4, 6, 8].some((at) => b.readUInt16BE(at) > 32767) ||
    b.readUInt16BE(8) > b.readUInt16BE(6)
  )
    fail("diagnostic-mismatch");
  return {
    persistent: b.readUInt16BE(0),
    transientReset: b.readUInt16BE(2),
    transientDeselect: b.readUInt16BE(4),
    maxCommit: b.readUInt16BE(6),
    unusedCommit: b.readUInt16BE(8),
    poolBytes: b.readUInt16BE(10),
    dleqBytes: b.readUInt16BE(12),
    setupState: ready,
    saturatedAvailability: [0, 2, 4].map((at) => b.readUInt16BE(at) === 32767),
  };
}
function verifyRegistry(registry, allowed, baseline = PLATFORM_FILES) {
  const seen = new Set(),
    objects = new Set();
  for (const kind of ["applications", "load-files"]) {
    const frames = registryFrames(
        registry.pages
          .filter((p) => p.kind === kind)
          .map((p) => p.data)
          .join(""),
      ),
      entries = registry.entries.filter((e) => e.kind === kind);
    if (frames.length !== entries.length) fail("registry-frames");
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i],
        aid = entries[i].aid.toUpperCase();
      if (kind === "load-files" && baseline.includes(frame)) {
        if (seen.has(frame)) fail("registry-duplicate");
        seen.add(frame);
      } else if (
        !allowed.includes(aid) ||
        !AIDS.includes(aid) ||
        kind !== (aid === PACKAGE ? "load-files" : "applications") ||
        objects.has(aid)
      )
        fail("registry-objects");
      else objects.add(aid);
    }
  }
  if (seen.size !== baseline.length) fail("registry-platform-baseline");
}
function deletion(aid) {
  if (!AIDS.includes(aid)) throw Error("private AID required");
  const b = Buffer.from(aid, "hex");
  return [0x80, 0xe4, 0, 0, b.length + 2, 0x4f, b.length, ...b, 0];
}
async function runCompact(options, dependencies = {}) {
  const w = workload(options.workload ?? SMALL);
  if (w.name === MAX && options.chip !== "cplc-v1:4790d3213041093363205547")
    throw Error("maximum workload requires the qualified 09336320 card");
  const baseline = Object.hasOwn(BASELINES, options.chip)
    ? BASELINES[options.chip]
    : undefined;
  if (
    !baseline ||
    options.reader !== READER ||
    (options.execute && options.cleanupOnly)
  )
    throw Error("named chip/reader and one mode required");
  const { manifest, load } = compactArtifact(options),
    runnerHash = fingerprint();
  const summary = {
    chip: options.chip,
    reader: READER,
    sourceCommit: manifest.sourceCommit,
    manifestSha256: options.manifestHash,
    capSha256: manifest.capSha256,
    runnerSha256: runnerHash,
    workload: w.name,
  };
  if (!options.execute && !options.cleanupOnly)
    return { ...summary, mode: "preview", cardAccessed: false };
  if (
    options.runnerHash !== runnerHash ||
    !options.factoryResetConfirmed ||
    !path.isAbsolute(options.python ?? "") ||
    !path.isAbsolute(options.journal ?? "") ||
    fs.existsSync(options.journal) ||
    (options.cleanupOnly && options.cleanupOnDeclaredRefusal)
  )
    throw Error(
      "pinned runner, absolute Python/new journal and factory reset confirmation required",
    );
  if (require("../cardkit/package.json").version !== "0.2.0")
    throw Error("reviewed cardkit required");
  const parent = fs.lstatSync(path.dirname(options.journal));
  if (
    !parent.isDirectory() ||
    (parent.mode & 0o077) !== 0 ||
    parent.uid !== process.getuid()
  )
    throw Error("private operator-owned journal directory required");
  const sdk = dependencies.sdk ?? require("../cardkit");
  const blocks = sdk.splitLoad(load);
  const lock = fs.openSync(options.journal + ".lock", "wx", 0o600);
  const state = {
    ...summary,
    status: "prepared",
    stage: "before-reader",
    timingsMs: {},
  };
  const save = () => journalFile(options.journal, state);
  let bridge,
    started = false,
    session,
    cleanup;
  const bytes = (hex) => [...Buffer.from(hex, "hex")];
  function expect(reply, codes = [0x9000]) {
    if (!codes.includes(reply.sw)) {
      const e = new ProbeFailure(
        "card-status-" + reply.sw.toString(16).padStart(4, "0"),
      );
      e.emptyReply = reply.data.length === 0;
      throw e;
    }
    return reply;
  }
  async function step(name, operation) {
    state.stage = name;
    save();
    dependencies.onStage?.(name);
    const at = process.hrtime.bigint();
    const value = await operation();
    state.timingsMs[name] = Number(process.hrtime.bigint() - at) / 1e6;
    save();
    return value;
  }
  async function command(name, apdu, expected) {
    return step(name, async () => {
      const r = expect(await sdk.transmit(bridge.tx, apdu));
      if (expected && !equal(r.data, expected)) fail("response-mismatch");
      return Buffer.from(r.data);
    });
  }
  async function registry(allowed) {
    const r = { pages: [], entries: [] };
    for (const kind of ["applications", "load-files"]) {
      let data = [],
        complete = false;
      for (let page = 0; page < 16; page++) {
        const reply = await session.send(
          bridge.tx,
          sdk.registryCommand(kind, page > 0),
        );
        r.pages.push({
          kind,
          page,
          sw: reply.sw.toString(16).padStart(4, "0"),
          data: Buffer.from(reply.data).toString("hex"),
        });
        state.registry = r;
        save();
        if (reply.sw === 0x6a88 && page === 0 && reply.data.length === 0) {
          complete = true;
          break;
        }
        if (
          ![0x9000, 0x6310].includes(reply.sw) ||
          data.length + reply.data.length > 65535 ||
          (reply.sw === 0x6310 && !reply.data.length)
        )
          fail("registry-status");
        data.push(...reply.data);
        if (reply.sw === 0x9000) {
          r.entries.push(
            ...sdk.parseRegistryEntries(data).map((e) => ({ kind, ...e })),
          );
          complete = true;
          break;
        }
      }
      if (!complete) fail("registry-incomplete");
    }
    verifyRegistry(r, allowed, baseline);
    state.registry = r;
    save();
    return r;
  }
  try {
    const fd = fs.openSync(options.journal, "wx", 0o600);
    fs.closeSync(fd);
    started = true;
    save();
    bridge = await (dependencies.openBridge ?? openBridge)(
      options.python,
      READER,
      false,
      !!options.cleanupOnly,
      "compact",
      w.name,
    );
    const tx = bridge.tx,
      began = process.hrtime.bigint();
    let transmissions = 0;
    bridge.tx = async (apdu) => {
      if (
        ++transmissions > 512 ||
        process.hrtime.bigint() - began > 120000000000n
      )
        fail("drill-bound-exceeded");
      return tx(apdu);
    };
    await step("match-chip", () =>
      sdk.readChipIdentity(bridge.tx, options.chip),
    );
    const forbidden = [
      sdk.CARD_AID,
      sdk.TAG_AID,
      sdk.OPENER_AID,
      sdk.CASHU_PACKAGE_AID,
      ...[
        "F0434153485550524F4245",
        "F0434153485550524F42454D",
        "F0434153485550524F424501",
      ].map(bytes),
      ...(options.cleanupOnly ? [] : AIDS.map(bytes)),
    ];
    for (let i = 0; i < forbidden.length; i++)
      await step("require-absent-" + i, async () =>
        expect(
          await sdk.transmit(bridge.tx, sdk.selectAid(forbidden[i])),
          [0x6a82],
        ),
      );
    session = await step("factory-authentication", () =>
      sdk.openSession(bridge.tx, sdk.FACTORY_KEYS, randomBytes, { kvn: 1 }),
    );
    cleanup = async () => {
      await step("cleanup-match-chip", () =>
        sdk.readChipIdentity(bridge.tx, options.chip),
      );
      session = await step("cleanup-factory-authentication", () =>
        sdk.openSession(bridge.tx, sdk.FACTORY_KEYS, randomBytes, { kvn: 1 }),
      );
      await step("cleanup-registry", () => registry(AIDS));
      for (const aid of AIDS)
        await step("delete-" + aid, async () =>
          expect(
            await session.send(bridge.tx, deletion(aid)),
            [0x9000, 0x6a88],
          ),
        );
      await step("verify-blank-registry", () => registry([]));
      state.blankBaselineVerified = true;
      save();
    };
    if (options.cleanupOnly) {
      // This channel is already fresh; cleanup requires exactly one authentication.
      await step("cleanup-registry", () => registry(AIDS));
      for (const aid of AIDS)
        await step("delete-" + aid, async () =>
          expect(
            await session.send(bridge.tx, deletion(aid)),
            [0x9000, 0x6a88],
          ),
        );
      await step("verify-blank-registry", () => registry([]));
      state.blankBaselineVerified = true;
      state.status = "cleaned";
      save();
      return { ...summary, status: state.status, journal: options.journal };
    }
    await step("require-blank-registry", () => registry([]));
    await step("install-for-load", async () =>
      expect(await session.send(bridge.tx, sdk.installForLoad(bytes(PACKAGE)))),
    );
    for (const [i, block] of blocks.entries())
      await step("load-block-" + i, async () =>
        expect(await session.send(bridge.tx, block)),
      );
    for (const suffix of ["4D", "01"])
      await step("install-" + suffix, async () =>
        expect(
          await session.send(
            bridge.tx,
            sdk.installAndSelectable(
              bytes(PACKAGE),
              bytes(PACKAGE + suffix),
              bytes(PACKAGE + suffix),
            ),
          ),
        ),
      );
    await command(
      "select-private",
      sdk.selectAid(bytes(PACKAGE + "01")),
      Buffer.from("CPROT\x02"),
    );
    const before = diagnostics(
      await command("diagnostics-before", cmd(0x7d)),
      0,
    );
    state.measurements = { before };
    save();
    // A measured 128-byte commit floor comfortably covers the 21-data-byte BEGIN,
    // but physical runtime bookkeeping/rollback still needs observation.
    if (Math.min(before.maxCommit, before.unusedCommit) < 128)
      fail("commit-capacity-below-floor");
    await command("setup-fixture", w.setup, [1]);
    const after = diagnostics(await command("diagnostics-after", cmd(0x7d)), 2);
    state.measurements.after = after;
    save();
    if (Math.min(after.maxCommit, after.unusedCommit) < 128)
      fail("commit-capacity-below-floor");
    const key = await command("read-private-public-key", cmd(0x7a));
    // Validate the public point before loading any fixture.
    const v = w.vector;
    require("./compact-export.cjs").fixtureView(
      { ...v.context, cardKey: key },
      v.keysets,
      v.proofs,
    );
    state.cardKey = key.toString("hex");
    save();
    await command("status-empty", cmd(0x76), [64, 90, 0, 0, 128, 0]);
    for (let i = 0; i < w.keysets.length; i++)
      await command("keyset-" + i, w.keysets[i], [i + 1]);
    for (let i = 0; i < w.loads.length; i++)
      await command("load-fixture-" + i, w.loads[i], [v.proofs[i].slot]);
    await command("begin-fixture", w.begin, [0]);
    for (let i = 0; i < w.outputPages.length; i++)
      await command(
        i === 0 ? "stage-outputs" : "stage-outputs-" + i,
        w.outputPages[i],
        [w.stagedCounts[i]],
      );
    const scope = await command("sign-and-publish", cmd(0x74));
    state.scope = scope.toString("hex");
    save();
    await command("status-consumed", cmd(0x76), w.consumedStatus);
    await command(
      "reselect-private",
      sdk.selectAid(bytes(PACKAGE + "01")),
      Buffer.from("CPROT\x02"),
    );
    await command("read-retained-scope", cmd(0x7c, Buffer.from([0])), scope);
    const pages = [];
    state.exportPages = [];
    save();
    for (let i = 0; i < w.pages.length; i++) {
      const page = await command("export-page-" + i, w.pages[i]);
      pages.push(page);
      state.exportPages.push({ offset: i * 255, data: page.toString("hex") });
      save();
    }
    const packet = Buffer.concat(pages);
    state.verified = await step("verify-packet", async () =>
      verifyPacket(key, scope, packet, w.name),
    );
    state.packet = packet.toString("hex");
    save();
    await command("retire-fixture", cmd(0x77, scope), [1]);
    await command("status-retired", cmd(0x76), [64, 90, 0, 0, 128, 0]);
    await cleanup();
    state.status = "complete";
    save();
    return {
      ...summary,
      ...state.verified,
      status: state.status,
      measurements: state.measurements,
      timingsMs: state.timingsMs,
      journal: options.journal,
    };
  } catch (error) {
    state.status = "stopped";
    state.failure = failureEvidence(error, sdk);
    const { code } = state.failure;
    let persisted = false;
    if (started)
      try {
        save();
        persisted = true;
      } catch {}
    const declared =
      options.cleanupOnDeclaredRefusal &&
      ["install-01", "setup-fixture"].includes(state.stage) &&
      error instanceof ProbeFailure &&
      error.emptyReply === true &&
      ["card-status-6f00", "card-status-6a84"].includes(code);
    if (declared && persisted && cleanup) {
      state.declaredRefusal = { stage: state.stage, code };
      save();
      try {
        await cleanup();
        state.status = "declared-refusal-cleaned";
        save();
        return {
          ...summary,
          status: state.status,
          refusal: state.declaredRefusal,
          journal: options.journal,
        };
      } catch (cleanupError) {
        state.cleanupFailure = failureEvidence(cleanupError, sdk);
        try {
          save();
        } catch {}
      }
    }
    const stopped = new Error(
      "compact stopped at " + state.stage + "; retain journal; no retry",
    );
    stopped.stage = state.stage;
    stopped.code = code;
    stopped.pcscCode = state.failure.pcscCode;
    throw stopped;
  } finally {
    try {
      if (bridge) {
        try {
          await bridge.close();
        } catch {
          const prior = state.status === "stopped";
          state.closeFailure = "reader-close-failed";
          state.status = "stopped";
          try {
            save();
          } catch {}
          if (!prior) {
            const error = new ProbeFailure("reader-close-failed");
            error.stage = state.stage;
            throw error;
          }
        }
      }
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(options.journal + ".lock");
    }
  }
}
module.exports = {
  compactArtifact,
  fingerprint,
  diagnostics,
  verifyRegistry,
  deletion,
  runCompact,
};
if (require.main === module)
  Promise.resolve()
    .then(async () => {
      const { values: v } = parseArgs({
        options: {
          manifest: { type: "string" },
          workload: { type: "string" },
          "expect-manifest-sha256": { type: "string" },
          "expect-source-commit": { type: "string" },
          "expect-runner-sha256": { type: "string" },
          chip: { type: "string" },
          reader: { type: "string" },
          python: { type: "string" },
          journal: { type: "string" },
          execute: { type: "boolean", default: false },
          "cleanup-only": { type: "boolean", default: false },
          "factory-reset-confirmed": { type: "boolean", default: false },
          "cleanup-on-declared-refusal": { type: "boolean", default: false },
        },
      });
      const r = await runCompact({
        manifest: v.manifest,
        workload: v.workload,
        manifestHash: v["expect-manifest-sha256"],
        sourceCommit: v["expect-source-commit"],
        runnerHash: v["expect-runner-sha256"],
        chip: v.chip,
        reader: v.reader,
        python: v.python,
        journal: v.journal,
        execute: v.execute,
        cleanupOnly: v["cleanup-only"],
        factoryResetConfirmed: v["factory-reset-confirmed"],
        cleanupOnDeclaredRefusal: v["cleanup-on-declared-refusal"],
      });
      console.log(JSON.stringify(r));
      if (r.status === "declared-refusal-cleaned") process.exitCode = 2;
    })
    .catch((e) => {
      console.error(
        JSON.stringify({
          status: "stopped",
          stage: e.stage ?? "before-reader",
          failure: e.code ?? "preflight-failed",
          ...(e.pcscCode ? { pcscCode: e.pcscCode } : {}),
          message: "Retain the journal for review before another action.",
        }),
      );
      process.exitCode = 1;
    });
