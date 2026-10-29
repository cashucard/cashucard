/* Factory-key-only, bounded resource drill. Preview opens no reader. */
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { parseArgs } = require("node:util");
const PACKAGE = "F0434153485550524F4245";
const PROBE = [PACKAGE + "01", PACKAGE + "4D", PACKAGE];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
class ProbeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Exact public load-file TLVs from the approved 09336320 inspection. They also
// occur in the owner's pre-existing gp-install-opener.txt GET STATUS capture.
const PLATFORM_FILES = [
  "e31b4f07a00000015153509f700101ce02ffffcc08a000000151000000",
  "e31b4f07a00000006202049f700101ce020100cc08a000000151000000",
  "e31b4f07a00000006202029f700101ce020103cc08a000000151000000",
];
function registryFrames(hex) {
  const data = Buffer.from(hex, "hex"),
    frames = [];
  let at = 0;
  while (at < data.length) {
    const start = at;
    if (data[at++] !== 0xe3) throw new ProbeFailure("platform-registry");
    let size = data[at++];
    if (size === 0x81) {
      size = data[at++];
      if (size < 128) throw new ProbeFailure("platform-registry");
    } else if (size === 0x82) {
      const high = data[at++],
        low = data[at++];
      if (!high || low === undefined)
        throw new ProbeFailure("platform-registry");
      size = high * 256 + low;
    } else if (size >= 0x80) throw new ProbeFailure("platform-registry");
    if (size === undefined || at + size > data.length)
      throw new ProbeFailure("platform-registry");
    at += size;
    frames.push(data.subarray(start, at).toString("hex"));
  }
  return frames;
}
function verifyPlatformRegistry(registry, allowed) {
  const seen = new Set();
  for (const kind of ["applications", "load-files"]) {
    const frames = registryFrames(
      registry.pages
        .filter((page) => page.kind === kind)
        .map((page) => page.data)
        .join(""),
    );
    const entries = registry.entries.filter((entry) => entry.kind === kind);
    if (frames.length !== entries.length)
      throw new ProbeFailure("platform-registry");
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i],
        aid = entries[i].aid.toUpperCase();
      if (kind === "load-files" && PLATFORM_FILES.includes(frame)) {
        if (seen.has(frame)) throw new ProbeFailure("platform-registry");
        seen.add(frame);
      } else if (
        !PROBE.includes(aid) ||
        !allowed.includes(aid) ||
        kind !== (aid === PACKAGE ? "load-files" : "applications")
      ) {
        throw new ProbeFailure("platform-registry");
      }
    }
  }
  if (seen.size !== PLATFORM_FILES.length)
    throw new ProbeFailure("platform-registry");
}

function artifact(filename, expected) {
  const rawManifest = fs.readFileSync(filename);
  if (!/^[0-9a-f]{64}$/.test(expected) || hash(rawManifest) !== expected) {
    throw new Error("artifact hash mismatch");
  }
  const manifest = JSON.parse(rawManifest.toString("utf8"));
  const format = manifest.probeFormat ?? 1;
  const layout = manifest.poolLayout ?? "single";
  const profileOK =
    (format === 1 &&
      manifest.poolBytes === 16384 &&
      manifest.probeProfile === undefined &&
      manifest.poolLayout === undefined) ||
    (format === 2 &&
      layout === "single" &&
      ((manifest.poolBytes === 0 &&
        manifest.probeProfile === "constructor-control") ||
        ([256, 4096, 16384].includes(manifest.poolBytes) &&
          manifest.probeProfile === "pool-allocation"))) ||
    (format === 2 &&
      layout === "4x4096" &&
      manifest.poolBytes === 16384 &&
      manifest.probeProfile === "segmented-pool-allocation");
  const storage = manifest.stateStorage ?? "added-fields";
  const storageOK =
    storage === "added-fields" ||
    (storage === "existing-fields" &&
      manifest.classShape?.declaredInstanceSize === 50 &&
      manifest.classShape?.firstReferenceToken === 0 &&
      manifest.classShape?.referenceCount === 50);
  const postInstall =
    storageOK &&
    format === 3 &&
    layout === "single" &&
    manifest.poolBytes === 0 &&
    manifest.probeProfile === "post-install-reservation" &&
    ["none", "padding-a", "padding-b"].includes(
      manifest.imagePadding ?? "none",
    ) &&
    JSON.stringify(manifest.supportedPoolBytes) === "[256,4096,16384]";
  if (
    manifest.kind !== "resource-probe-only" ||
    manifest.packageAid !== PACKAGE ||
    !(profileOK || postInstall)
  ) {
    throw new Error("unsupported probe profile");
  }
  const directory = path.dirname(filename);
  const cap = fs.readFileSync(path.join(directory, "resource-probe.cap"));
  const load = fs.readFileSync(path.join(directory, "load-file.bin"));
  if (
    hash(cap) !== manifest.capSha256 ||
    hash(load) !== manifest.loadFileSha256 ||
    load.length !== manifest.loadFileSize ||
    load.length === 0 ||
    load.length > 63232
  ) {
    throw new Error("probe load bytes mismatch");
  }
  return { manifest, load };
}
function probeDelete(hex) {
  if (!PROBE.includes(hex)) {
    throw new Error("private probe AID required");
  }
  const aid = Array.from(Buffer.from(hex, "hex"));
  return [0x80, 0xe4, 0, 0, aid.length + 2, 0x4f, aid.length, ...aid, 0];
}
function measurements(data, format = 1, poolBytes = 16384) {
  const bytes = Buffer.from(data);
  if (format === 2 || format === 3) {
    if (
      bytes.length !== 16 ||
      bytes[13] !== format ||
      (format === 2 ? bytes[15] !== 0 : bytes[15] > 1) ||
      bytes.readUInt16BE(10) !== poolBytes ||
      bytes[12] > 1 ||
      (!poolBytes && bytes[12] !== 0)
    ) {
      throw new Error("probe response mismatch");
    }
    const counters = [0, 2, 4].map((offset) => bytes.readUInt16BE(offset));
    const saturated = counters.reduce(
      (mask, value, index) => mask | (value === 32767 ? 1 << index : 0),
      0,
    );
    if (
      counters.some((value) => value > 32767) ||
      bytes[14] !== saturated ||
      bytes.readUInt16BE(6) > 32767 ||
      bytes.readUInt16BE(8) > bytes.readUInt16BE(6)
    )
      throw new Error("invalid availability counter");
    return {
      probeFormat: format,
      ...(format === 3 ? { reservationAttempted: bytes[15] === 1 } : {}),
      reportedAvailability: {
        persistent: counters[0],
        transientReset: counters[1],
        transientDeselect: counters[2],
      },
      availabilityReporting: "upper-bound counters capped at 32767",
      saturatedMask: saturated,
      maxCommit: bytes.readUInt16BE(6),
      unusedCommit: bytes.readUInt16BE(8),
      poolBytes,
      publicationByte: bytes[12],
    };
  }
  if (
    format !== 1 ||
    bytes.length !== 24 ||
    bytes[23] !== 1 ||
    bytes.readUInt16BE(20) !== 16384
  ) {
    throw new Error("probe response mismatch");
  }
  return {
    persistentBefore: bytes.readUInt32BE(0),
    persistentAfter: bytes.readUInt32BE(4),
    transientReset: bytes.readUInt32BE(8),
    transientDeselect: bytes.readUInt32BE(12),
    maxCommit: bytes.readUInt16BE(16),
    unusedCommit: bytes.readUInt16BE(18),
    poolBytes: bytes.readUInt16BE(20),
    publicationByte: bytes[22],
  };
}
function platformMemory(data) {
  const bytes = Buffer.from(data);
  if (
    bytes.length !== 19 ||
    bytes.subarray(0, 5).toString("hex") !== "ff21108102" ||
    bytes[7] !== 0x82 ||
    bytes[8] !== 4 ||
    bytes[13] !== 0x83 ||
    bytes[14] !== 4
  )
    throw new ProbeFailure("platform-memory-format");
  return {
    source: "isd-ff21",
    tag81: bytes.readUInt16BE(5),
    persistentBytes: bytes.readUInt32BE(9),
    volatileBytes: bytes.readUInt32BE(15),
  };
}
function journalFile(filename, value) {
  const temporary = filename + "." + randomUUID();
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filename);
  const dir = fs.openSync(path.dirname(filename), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
const BRIDGE_FAILURES = new Set([
  "probe-bridge-stopped",
  "reader-enumeration-failed",
  "reader-unavailable",
  "reader-connect-failed",
  "reader-transmit-failed",
  "reader-close-failed",
  "bridge-input-invalid",
  "bridge-command-refused",
]);
const TRANSPORT_FAILURES = new Set([
  ...BRIDGE_FAILURES,
  "reader-response-timeout",
  "reader-pipe-closed",
  "reader-not-ready",
  "reader-protocol-error",
]);
function failureEvidence(error, sdk) {
  // Unwrap only the public SDK's direct, typed transport cause. Native text and
  // arbitrary cause chains are deliberately excluded from retained evidence.
  if (
    typeof sdk?.TransportError === "function" &&
    error instanceof sdk.TransportError
  ) {
    const cause = error.cause;
    if (!(cause instanceof ProbeFailure) || !TRANSPORT_FAILURES.has(cause.code))
      return { code: "operation-failed" };
    error = cause;
  }
  if (error instanceof ProbeFailure)
    return {
      code: error.code,
      ...(typeof error.pcscCode === "string" &&
      /^[0-9a-f]{8}$/.test(error.pcscCode)
        ? { pcscCode: error.pcscCode }
        : {}),
    };
  return {
    code:
      Number.isInteger(error?.sw) && error.sw >= 0 && error.sw <= 0xffff
        ? "card-status-" + error.sw.toString(16).padStart(4, "0")
        : "operation-failed",
  };
}
function parseBridgeMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new ProbeFailure("reader-protocol-error");
  }
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw new ProbeFailure("reader-protocol-error");
  if (message.error !== undefined) {
    if (
      !BRIDGE_FAILURES.has(message.error) ||
      (message.pcscCode !== undefined &&
        (typeof message.pcscCode !== "string" ||
          !/^[0-9a-f]{8}$/.test(message.pcscCode)))
    ) {
      throw new ProbeFailure("reader-protocol-error");
    }
    const error = new ProbeFailure(message.error);
    if (message.pcscCode !== undefined) error.pcscCode = message.pcscCode;
    throw error;
  }
  return message;
}

async function openBridge(
  python,
  reader,
  registryOnly = false,
  cleanupOnly = false,
  profile = "resource",
  workload,
) {
  if (!["resource", "compact"].includes(profile))
    throw new Error("unknown bridge profile");
  const child = spawn(
    python,
    [
      "-u",
      path.join(
        __dirname,
        profile === "compact" ? "compact_bridge.py" : "probe_bridge.py",
      ),
      "--reader",
      reader,
      ...(profile === "compact" && workload ? ["--workload", workload] : []),
      ...(registryOnly ? ["--registry-only"] : []),
      ...(cleanupOnly ? ["--cleanup-only"] : []),
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  child.on("error", () => lines.close());
  child.stdin.on("error", () => lines.close());
  let busy = false,
    closed = false;
  async function next() {
    let timer;
    try {
      const result = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              child.kill();
              reject(new ProbeFailure("reader-response-timeout"));
            },
            profile === "compact" ? 30000 : 10000,
          );
        }),
      ]);
      if (result.done || result.value.length > 4096) {
        throw new ProbeFailure("reader-pipe-closed");
      }
      return parseBridgeMessage(result.value);
    } finally {
      clearTimeout(timer);
    }
  }
  async function close() {
    if (closed) {
      return;
    }
    closed = true;
    child.stdin.end('{"close":true}\n');
    await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    lines.close();
  }
  try {
    if ((await next()).ready !== true) {
      throw new ProbeFailure("reader-not-ready");
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    tx: async (apdu) => {
      if (closed || busy) {
        throw new ProbeFailure("reader-not-ready");
      }
      busy = true;
      try {
        child.stdin.write(JSON.stringify({ apdu }) + "\n");
        const { reply } = await next();
        if (
          !Array.isArray(reply) ||
          reply.length < 2 ||
          reply.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
        ) {
          throw new ProbeFailure("reader-protocol-error");
        }
        return reply;
      } finally {
        busy = false;
      }
    },
  };
}
async function runProbe(options, dependencies = {}) {
  if (
    !/^cplc-v1:[0-9a-f]{24}$/.test(options.chip) ||
    options.reader !== "ACS ACR122U PICC Interface"
  ) {
    throw new Error("explicit approved chip and reader required");
  }
  if (
    options.platformBaseline &&
    options.chip !== "cplc-v1:4790d3213041093363205547"
  ) {
    throw new Error("platform baseline is approved only for 09336320");
  }
  if (
    [options.execute, options.inspectRegistry, options.cleanupOnly].filter(
      Boolean,
    ).length > 1
  ) {
    throw new Error("choose one explicit reader mode");
  }
  const { manifest, load } = artifact(options.manifest, options.manifestHash);
  const summary = {
    chip: options.chip,
    reader: options.reader,
    capSha256: manifest.capSha256,
    manifestSha256: options.manifestHash,
    poolBytes:
      manifest.probeFormat === 3 ? options.reserveBytes : manifest.poolBytes,
    probeFormat: manifest.probeFormat ?? 1,
    probeProfile: manifest.probeProfile ?? "legacy-constructor-stats",
    poolLayout: manifest.poolLayout ?? "single",
    imagePadding: manifest.imagePadding ?? "none",
    stateStorage:
      manifest.stateStorage ??
      (manifest.probeFormat === 3 ? "added-fields" : "legacy"),
    readPlatformMemory: options.readPlatformMemory === true,
    cleanupOnInstallRefusal: options.cleanupOnInstallRefusal === true,
    cleanupOnAllocationRefusal: options.cleanupOnAllocationRefusal === true,
    platformBaseline: options.platformBaseline ? "j3r180-09336320-v1" : "empty",
  };
  if (
    options.readPlatformMemory &&
    (!options.execute || !options.platformBaseline)
  )
    throw new Error(
      "platform memory read requires an explicit named-baseline execution",
    );
  if (
    (summary.probeFormat === 3 &&
      ![256, 4096, 16384].includes(options.reserveBytes)) ||
    (summary.probeFormat !== 3 && options.reserveBytes !== undefined)
  ) {
    throw new Error(
      "format-3 requires an explicit bounded reserve-bytes value",
    );
  }
  if (
    options.cleanupOnAllocationRefusal &&
    (!options.execute || summary.probeFormat !== 3)
  ) {
    throw new Error(
      "allocation-refusal cleanup requires an explicit format-3 run",
    );
  }
  if (
    options.cleanupOnInstallRefusal &&
    (!options.execute ||
      ![2, 3].includes(summary.probeFormat) ||
      summary.poolBytes === 0)
  ) {
    throw new Error(
      "declared-refusal cleanup requires an explicit allocation run",
    );
  }
  if (!options.execute && !options.inspectRegistry && !options.cleanupOnly) {
    return { ...summary, mode: "preview", cardAccessed: false };
  }
  if (
    !options.factoryResetConfirmed ||
    !options.journal ||
    fs.existsSync(options.journal)
  ) {
    throw new Error(
      "confirmed factory reset and a new journal are required; no automatic retry",
    );
  }
  if (
    !dependencies.sdk &&
    require("../cardkit/package.json").version !== "0.2.0"
  ) {
    throw new Error("resource probe requires reviewed cardkit 0.2.0");
  }
  const sdk = dependencies.sdk ?? require("../cardkit"); // Public package entry only.
  if (!path.isAbsolute(options.journal)) {
    throw new Error("absolute private journal path required");
  }
  fs.mkdirSync(path.dirname(options.journal), { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(path.dirname(options.journal));
  if (
    !parent.isDirectory() ||
    (parent.mode & 0o077) !== 0 ||
    parent.uid !== process.getuid()
  ) {
    throw new Error("private operator-owned journal directory required");
  }
  const lock = fs.openSync(options.journal + ".lock", "wx", 0o600);
  const state = { ...summary, status: "prepared", stage: "before-reader" };
  const save = () => journalFile(options.journal, state);
  let bridge,
    journalStarted = false,
    refusalCleanup;
  async function step(name, operation) {
    state.stage = name;
    save();
    return operation();
  }
  const expect = (reply, codes = [0x9000]) => {
    if (!codes.includes(reply.sw)) {
      const error = new ProbeFailure(
        "card-status-" + reply.sw.toString(16).padStart(4, "0"),
      );
      error.emptyReply = reply.data.length === 0;
      throw error;
    }
    return reply;
  };
  const bytes = (hex) => sdk.fromHex(hex);
  try {
    if (fs.existsSync(options.journal)) {
      throw new Error("journal already exists");
    }
    const reserved = fs.openSync(options.journal, "wx", 0o600);
    fs.closeSync(reserved);
    journalStarted = true;
    save();
    bridge = await (dependencies.openBridge ?? openBridge)(
      options.python,
      options.reader,
      options.inspectRegistry === true,
      options.cleanupOnly === true,
    );
    const tx = bridge.tx;
    await step("match-chip", () => sdk.readChipIdentity(tx, options.chip));
    if (options.readPlatformMemory) {
      state.platformMemory = await step("read-platform-memory", async () => {
        const reply = await sdk.transmit(tx, [0x80, 0xca, 0xff, 0x21, 0]);
        if (
          [0x6a88, 0x6a86, 0x6d00].includes(reply.sw) &&
          reply.data.length === 0
        )
          return { status: "unavailable", sw: reply.sw.toString(16) };
        return platformMemory(expect(reply).data);
      });
      summary.platformMemory = state.platformMemory;
      save();
    }
    for (const aid of [
      sdk.CARD_AID,
      sdk.TAG_AID,
      sdk.OPENER_AID,
      sdk.CASHU_PACKAGE_AID,
      ...(options.cleanupOnly ? [] : PROBE.map(bytes)),
    ]) {
      await step("require-blank-card", async () =>
        expect(await sdk.transmit(tx, sdk.selectAid(aid)), [0x6a82]),
      );
    }
    let session = await step("factory-authentication", () =>
      sdk.openSession(tx, sdk.FACTORY_KEYS, randomBytes, { kvn: 1 }),
    );
    async function registry() {
      const entries = [];
      state.registry = { pages: [], entries: [] };
      save();
      for (const kind of ["applications", "load-files"]) {
        let data = [],
          complete = false;
        for (let page = 0; page < 16; page++) {
          const reply = await session.send(
            tx,
            sdk.registryCommand(kind, page > 0),
          );
          state.registry.pages.push({
            kind,
            page,
            sw: reply.sw.toString(16).padStart(4, "0"),
            data: Buffer.from(reply.data).toString("hex"),
          });
          save();
          if (reply.sw === 0x6a88 && page === 0 && reply.data.length === 0) {
            complete = true;
            break;
          }
          if (![0x9000, 0x6310].includes(reply.sw)) {
            throw new ProbeFailure("registry-status");
          }
          if (
            data.length + reply.data.length > 65535 ||
            (reply.sw === 0x6310 && !reply.data.length)
          ) {
            throw new ProbeFailure("registry-incomplete");
          }
          data.push(...reply.data);
          if (reply.sw === 0x9000) {
            let parsed;
            try {
              parsed = sdk.parseRegistryEntries(data);
            } catch {
              throw new ProbeFailure("registry-format");
            }
            entries.push(...parsed);
            state.registry.entries.push(
              ...parsed.map((entry) => ({ kind, ...entry })),
            );
            save();
            complete = true;
            break;
          }
        }
        if (!complete) {
          throw new ProbeFailure("registry-incomplete");
        }
      }
      return entries;
    }
    async function requireRegistry(allowed) {
      const entries = await registry();
      if (options.platformBaseline) {
        verifyPlatformRegistry(state.registry, allowed);
      } else if (
        entries.some((entry) => !allowed.includes(entry.aid.toUpperCase()))
      ) {
        throw new ProbeFailure("registry-objects");
      }
      return entries;
    }
    const domain = sdk.toHex(sdk.ISD_AID).toUpperCase();
    async function removePrivateProbe() {
      await step("cleanup-registry", () => requireRegistry([domain, ...PROBE]));
      for (const aid of PROBE) {
        await step("delete-" + aid, async () =>
          expect(await session.send(tx, probeDelete(aid)), [0x9000, 0x6a88]),
        );
      }
      await step("verify-cleanup", () => requireRegistry([domain]));
      state.stage = "factory-blank-ready-for-ccp";
    }
    refusalCleanup = async () => {
      await step("refusal-cleanup-match-chip", () =>
        sdk.readChipIdentity(tx, options.chip),
      );
      session = await step("refusal-cleanup-factory-authentication", () =>
        sdk.openSession(tx, sdk.FACTORY_KEYS, randomBytes, { kvn: 1 }),
      );
      await removePrivateProbe();
      state.status = state.allocationRefusal
        ? "allocation-refused-cleaned"
        : "install-refused-cleaned";
      save();
      return {
        ...summary,
        status: state.status,
        installRefusal: state.installRefusal,
        allocationRefusal: state.allocationRefusal,
        journal: options.journal,
      };
    };
    if (options.cleanupOnly) {
      await removePrivateProbe();
      state.status = "cleaned";
      save();
      return {
        ...summary,
        status: state.status,
        registry: state.registry,
        journal: options.journal,
      };
    }
    if (options.inspectRegistry) {
      await step("inspect-registry", registry);
      state.status = "inspected";
      state.stage = "registry-inspection-complete";
      save();
      return {
        ...summary,
        status: state.status,
        registry: state.registry,
        journal: options.journal,
      };
    }
    await step("require-empty-registry", () => requireRegistry([domain]));
    await step("install-for-load", async () =>
      expect(await session.send(tx, sdk.installForLoad(bytes(PACKAGE)))),
    );
    const blocks = sdk.splitLoad(load);
    for (let i = 0; i < blocks.length; i++) {
      await step("load-block-" + i, async () =>
        expect(await session.send(tx, blocks[i])),
      );
    }
    for (const suffix of ["4D", "01"]) {
      await step("install-" + suffix, async () =>
        expect(
          await session.send(
            tx,
            sdk.installAndSelectable(
              bytes(PACKAGE),
              bytes(PACKAGE + suffix),
              bytes(PACKAGE + suffix),
            ),
          ),
        ),
      );
    }
    await step("select-probe", async () => {
      const reply = expect(
        await sdk.transmit(tx, sdk.selectAid(bytes(PACKAGE + "01"))),
      );
      const expected = Buffer.from([
        ...Buffer.from("PROBE"),
        summary.probeFormat,
        manifest.poolBytes >> 8,
        manifest.poolBytes & 0xff,
      ]).toString("hex");
      state.selectedProbe =
        reply.data.length === 8 &&
        Buffer.from(reply.data.slice(0, 5)).toString("ascii") === "PROBE"
          ? {
              format: reply.data[5],
              poolBytes: reply.data[6] * 256 + reply.data[7],
            }
          : { status: "unrecognized" };
      save();
      if (Buffer.from(reply.data).toString("hex") !== expected) {
        throw new ProbeFailure("probe-selection-mismatch");
      }
    });
    async function readMeasurements(poolBytes = summary.poolBytes) {
      const length = summary.probeFormat >= 2 ? 16 : 24;
      const reply = await sdk.transmit(tx, [0xb0, 0x7d, 0, 0, length]);
      if (
        summary.probeFormat >= 2 &&
        [0x6f00, 0x6a81, 0x6d00].includes(reply.sw) &&
        reply.data.length === 0
      ) {
        return {
          status: "unavailable",
          sw: reply.sw.toString(16).padStart(4, "0"),
        };
      }
      return measurements(expect(reply).data, summary.probeFormat, poolBytes);
    }
    const before = await step("read-measurements", () =>
      readMeasurements(summary.probeFormat === 3 ? 0 : summary.poolBytes),
    );
    state.measurements = { before };
    save();
    if (before.status !== "unavailable" && before.publicationByte !== 0) {
      throw new Error("probe was already used");
    }
    if (summary.probeFormat === 3 && before.status !== "unavailable") {
      if (before.reservationAttempted)
        throw new Error("probe reservation already attempted");
      if (Math.min(before.maxCommit, before.unusedCommit) >= 128) {
        const reply = await step("reserve-pool", async () =>
          expect(
            await sdk.transmit(tx, [
              0xb0,
              0x7c,
              0,
              0,
              2,
              summary.poolBytes >> 8,
              summary.poolBytes & 255,
              3,
            ]),
          ),
        );
        if (reply.data.length !== 3 || ![0, 1].includes(reply.data[0]))
          throw new Error("reservation response mismatch");
        const reason = reply.data[1] * 256 + reply.data[2];
        if ((reply.data[0] === 0) !== (reason === 0))
          throw new Error("reservation reason mismatch");
        if (reply.data[0] === 1) {
          state.allocationRefusal = { category: "system-exception", reason };
          save();
          if (!options.cleanupOnAllocationRefusal)
            throw new Error("allocation refusal requires review");
          const refused = await step("confirm-allocation-refusal", () =>
            readMeasurements(0),
          );
          if (
            refused.status === "unavailable" ||
            !refused.reservationAttempted ||
            refused.publicationByte !== 0
          )
            throw new Error("allocation refusal state mismatch");
          state.measurements.refused = refused;
          save();
          return await refusalCleanup();
        }
        const reserved = await step("read-reservation", readMeasurements);
        if (
          reserved.status === "unavailable" ||
          !reserved.reservationAttempted ||
          reserved.publicationByte !== 0
        )
          throw new Error("reservation not confirmed");
        state.measurements.afterReservation = reserved;
        save();
      }
    }
    const publicationCapacity = state.measurements.afterReservation ?? before;
    if (summary.poolBytes === 0) {
      state.measurements.dummySkipped = "control-profile";
    } else if (before.status === "unavailable") {
      state.measurements.dummySkipped = "measurements-unavailable";
    } else if (
      summary.probeFormat >= 2 &&
      Math.min(
        publicationCapacity.maxCommit,
        publicationCapacity.unusedCommit,
      ) < 128
    ) {
      state.measurements.dummySkipped = "reported-commit-capacity-below-128";
    } else {
      await step("dummy-publication", async () => {
        const started = process.hrtime.bigint();
        const reply = expect(await sdk.transmit(tx, [0xb0, 0x7e, 0, 0, 1]));
        state.measurements.dummyCommandMs =
          Number(process.hrtime.bigint() - started) / 1e6;
        if (reply.data.length !== 1 || reply.data[0] !== 1)
          throw new Error("publication not confirmed");
        state.measurements.dummyPublicationConfirmed = true;
      });
      const after = await step("read-publication", readMeasurements);
      if (after.status !== "unavailable" && after.publicationByte !== 1)
        throw new Error("publication not retained");
      if (
        summary.probeFormat === 3 &&
        after.status !== "unavailable" &&
        !after.reservationAttempted
      )
        throw new Error("reservation state lost");
      state.measurements.after = after;
      state.measurements.publicationRetainedByRead =
        after.status !== "unavailable";
    }
    save();
    // SELECT of the probe ended the old secure channel. Match identity again,
    // then open exactly one new, known-factory-key session for cleanup.
    await step("cleanup-match-chip", () =>
      sdk.readChipIdentity(tx, options.chip),
    );
    session = await step("cleanup-factory-authentication", () =>
      sdk.openSession(tx, sdk.FACTORY_KEYS, randomBytes, { kvn: 1 }),
    );
    await removePrivateProbe();
    state.status = "complete";
    save();
    return {
      ...summary,
      ...state.measurements,
      status: state.status,
      journal: options.journal,
    };
  } catch (error) {
    const failureFor = (value) => failureEvidence(value, sdk);
    const declared =
      options.cleanupOnInstallRefusal &&
      state.stage === "install-01" &&
      error instanceof ProbeFailure &&
      error.emptyReply === true &&
      ["card-status-6f00", "card-status-6a84"].includes(error.code);
    state.status = "stopped";
    state.failure = failureFor(error);
    if (declared)
      state.installRefusal = { stage: state.stage, code: state.failure.code };
    let persisted = false;
    if (journalStarted) {
      try {
        save();
        persisted = true;
      } catch {}
    }
    if (declared && persisted && refusalCleanup) {
      try {
        return await refusalCleanup();
      } catch (cleanupError) {
        state.status = "stopped";
        state.failure = failureFor(cleanupError);
        try {
          save();
        } catch {}
      }
    }
    const stopped = new Error(
      "probe stopped at " +
        state.stage +
        "; retain its journal; no retry performed",
    );
    stopped.probeStage = state.stage;
    stopped.probeFailure = state.failure.code;
    stopped.probePcscCode = state.failure.pcscCode;
    throw stopped;
  } finally {
    try {
      if (bridge) {
        await bridge.close();
      }
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(options.journal + ".lock");
    }
  }
}

module.exports = {
  openBridge,
  journalFile,
  registryFrames,
  PLATFORM_FILES,
  ProbeFailure,
  failureEvidence,
  artifact,
  probeDelete,
  measurements,
  runProbe,
  verifyPlatformRegistry,
  parseBridgeMessage,
  platformMemory,
};
if (require.main === module) {
  Promise.resolve()
    .then(async () => {
      const { values } = parseArgs({
        options: {
          manifest: { type: "string" },
          "expect-manifest-sha256": { type: "string" },
          chip: { type: "string" },
          reader: { type: "string" },
          python: { type: "string" },
          journal: { type: "string" },
          execute: { type: "boolean", default: false },
          "inspect-registry": { type: "boolean", default: false },
          "cleanup-only": { type: "boolean", default: false },
          "cleanup-on-install-refusal": { type: "boolean", default: false },
          "cleanup-on-allocation-refusal": { type: "boolean", default: false },
          "reserve-bytes": { type: "string" },
          "read-platform-memory": { type: "boolean", default: false },
          "platform-baseline": { type: "boolean", default: false },
          "factory-reset-confirmed": { type: "boolean", default: false },
        },
      });
      const result = await runProbe({
        manifest: values.manifest,
        manifestHash: values["expect-manifest-sha256"],
        chip: values.chip,
        reader: values.reader,
        python: values.python,
        journal: values.journal,
        execute: values.execute,
        inspectRegistry: values["inspect-registry"],
        cleanupOnly: values["cleanup-only"],
        readPlatformMemory: values["read-platform-memory"],
        cleanupOnInstallRefusal: values["cleanup-on-install-refusal"],
        cleanupOnAllocationRefusal: values["cleanup-on-allocation-refusal"],
        reserveBytes:
          values["reserve-bytes"] === undefined
            ? undefined
            : Number(values["reserve-bytes"]),
        platformBaseline: values["platform-baseline"],
        factoryResetConfirmed: values["factory-reset-confirmed"],
      });
      console.log(JSON.stringify(result));
      if (
        ["install-refused-cleaned", "allocation-refused-cleaned"].includes(
          result.status,
        )
      )
        process.exitCode = 2;
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          status: "stopped",
          stage: error.probeStage ?? "before-reader",
          failure: error.probeFailure ?? "preflight-failed",
          ...(error.probePcscCode ? { pcscCode: error.probePcscCode } : {}),
          message:
            "Preserve the journal and review before another action; no retry.",
        }),
      );
      process.exitCode = 1;
    });
}
