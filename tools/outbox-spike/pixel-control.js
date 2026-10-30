/* Portable private creation-only control. Dependencies are injected; no I/O imports. */
const PINS = Object.freeze({
  plan: "pixel-creation-control-v1",
  chip: "cplc-v1:4790d3213041093363205547",
  package: "F04341534855434D5054",
  manifest: "b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25",
  cap: "41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941",
  load: "cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64",
  bytes: 26934,
  source: "c23c492eafba998fad14f5ef5a82d6686b67d98d",
});
const BASELINE = Object.freeze([
  "e31b4f07a00000015153509f700101ce02ffffcc08a000000151000000",
  "e31b4f07a00000006202049f700101ce020100cc08a000000151000000",
  "e31b4f07a00000006202029f700101ce020103cc08a000000151000000",
]);
class LabStop extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const stop = (code) => {
  throw new LabStop(code);
};
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = (bytes) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (value) => value.match(/../g).map((v) => parseInt(v, 16));
const PRIVATE = [PINS.package + "01", PINS.package + "4D", PINS.package];

function resumeJournal(value) {
  if (value === null) return null;
  try {
    const record = JSON.parse(value);
    if (
      record?.plan === PINS.plan &&
      typeof record.stage === "string" &&
      ["armed", "running", "stopped", "complete"].includes(record.status)
    )
      return record;
  } catch {
    /* Retain a consumed state for malformed saved data. */
  }
  return {
    plan: PINS.plan,
    stage: "saved-journal-unreadable",
    status: "stopped",
    failure: "saved-journal-unreadable",
  };
}

function registryFrames(data) {
  const frames = [];
  let at = 0;
  while (at < data.length) {
    const start = at;
    if (data[at++] !== 0xe3) stop("registry-framing");
    let size = data[at++];
    if (size === 0x81) {
      size = data[at++];
      if (size < 128) stop("registry-framing");
    } else if (size === 0x82) {
      const high = data[at++],
        low = data[at++];
      if (!high || low === undefined) stop("registry-framing");
      size = high * 256 + low;
    } else if (size >= 0x80) stop("registry-framing");
    if (size === undefined || at + size > data.length) stop("registry-framing");
    at += size;
    frames.push(hex(data.slice(start, at)));
  }
  return frames;
}

function verifyRegistry(sdk, pages, allowed) {
  const seen = new Set(),
    objects = new Set();
  for (const kind of ["applications", "load-files"]) {
    const data = pages.filter((p) => p.kind === kind).flatMap((p) => p.data);
    const entries = sdk.parseRegistryEntries(data);
    const frames = registryFrames(data);
    if (frames.length !== entries.length) stop("registry-framing");
    entries.forEach((entry, i) => {
      const aid = entry.aid.toUpperCase();
      if (kind === "load-files" && BASELINE.includes(frames[i])) {
        if (seen.has(frames[i])) stop("registry-duplicate");
        seen.add(frames[i]);
      } else {
        if (
          !allowed.includes(aid) ||
          objects.has(aid) ||
          kind !== (aid === PINS.package ? "load-files" : "applications") ||
          entry.domain !== "A000000151000000" ||
          entry.lifeCycle !== (aid === PINS.package ? 1 : 7) ||
          entry.loadFile !== (aid === PINS.package ? null : PINS.package) ||
          (aid !== PINS.package && !entry.privileges) ||
          (entry.privileges && entry.privileges.some((v) => v !== 0))
        ) {
          stop("registry-objects");
        }
        objects.add(aid);
      }
    });
  }
  if (seen.size !== BASELINE.length) stop("registry-baseline");
  if (objects.size !== allowed.length || allowed.some((a) => !objects.has(a))) {
    stop("registry-private-set");
  }
}

function failureCode(error, sdk) {
  if (error instanceof LabStop) return error.code;
  if (error instanceof sdk.TransportError) {
    return error.cause instanceof LabStop
      ? error.cause.code
      : "transport-uncertain";
  }
  if (error instanceof sdk.WrongKeys) return "factory-keys-not-proved";
  if (error instanceof sdk.ChipIdentityMismatch) return "wrong-chip";
  return "operation-stopped";
}

async function runCreation({
  sdk,
  load,
  hash,
  random,
  tx: nativeTx,
  save,
  now,
  cancelled = () => false,
  validateKey,
  limits,
}) {
  const state = {
    plan: PINS.plan,
    chip: PINS.chip,
    cap: PINS.cap,
    load: PINS.load,
    status: "running",
    stage: "validate-image",
    commands: 0,
    timingsMs: {},
    blankBaselineVerified: false,
  };
  const began = now();
  let permit = [],
    inStep = false;
  const check = () => {
    if (cancelled()) stop("cancelled");
    if (now() - began > 120000) stop("elapsed-bound");
  };
  const persist = async () => {
    try {
      await save(JSON.parse(JSON.stringify(state)));
    } catch {
      stop("journal-unavailable");
    }
  };
  const tx = async (apdu) => {
    check();
    const allowed = permit.shift();
    if (
      !inStep ||
      !allowed ||
      !allowed(apdu) ||
      apdu.length > 261 ||
      apdu.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    ) {
      stop("command-not-admitted");
    }
    if (state.commands >= 256) stop("command-bound");
    state.commands++;
    // Persist intent before each APDU. No challenge, MAC, PIN or key is recorded.
    state.header = hex(apdu.slice(0, 4));
    state.reply = null;
    await persist();
    check();
    const reply = await nativeTx(apdu);
    if (reply.length < 2) stop("transport-uncertain");
    state.reply = hex(reply.slice(-2));
    await persist();
    check();
    return reply;
  };
  const exact = (frame) => (apdu) => equal(apdu, frame);
  const step = async (name, permits, body) => {
    check();
    state.stage = name;
    permit = permits;
    await persist();
    const start = now();
    inStep = true;
    try {
      const value = await body();
      if (permit.length) stop("missing-command");
      state.timingsMs[name] = now() - start;
      await persist();
      return value;
    } finally {
      inStep = false;
      permit = [];
    }
  };
  const expect = (reply, codes = [0x9000]) => {
    if (!codes.includes(reply.sw))
      stop("card-status-" + reply.sw.toString(16).padStart(4, "0"));
    return reply;
  };
  const raw = (name, frame, codes) =>
    step(name, [exact(frame)], async () =>
      expect(await sdk.transmit(tx, frame), codes),
    );
  const identity = (name) =>
    step(
      name,
      [exact(sdk.selectAid(sdk.ISD_AID)), exact([0x80, 0xca, 0x9f, 0x7f, 0])],
      () => sdk.readChipIdentity(tx, PINS.chip),
    );
  const authenticate = async (name) => {
    const hs = await step(
      name + "-initialize",
      [
        (apdu) =>
          apdu.length === 14 &&
          equal(apdu.slice(0, 5), [0x80, 0x50, 1, 0, 8]) &&
          apdu[13] === 0,
      ],
      () => sdk.initializeUpdate(tx, random, 1),
    );
    if (hs.reply.kvn !== 1) stop("factory-version-mismatch");
    const keys = sdk.sessionIfMatches(sdk.FACTORY_KEYS, hs);
    if (!keys) stop("factory-keys-not-proved");
    return step(
      name + "-authenticate",
      [
        (apdu) =>
          apdu.length === 22 &&
          equal(apdu.slice(0, 5), [0x84, 0x82, 1, 0, 16]) &&
          apdu[21] === 0,
      ],
      () => sdk.externalAuthenticate(tx, keys, hs),
    );
  };
  const secure = (name, session, command, codes) =>
    raw(name, session.wrap(command), codes);
  const registry = async (name, session, allowed) => {
    const pages = [];
    for (const kind of ["applications", "load-files"]) {
      let complete = false,
        length = 0;
      for (let i = 0; i < 16; i++) {
        const r = await secure(
          name + "-" + kind + "-" + i,
          session,
          sdk.registryCommand(kind, i > 0),
          [0x9000, 0x6310, 0x6a88],
        );
        if (r.sw === 0x6a88) {
          if (i !== 0 || r.data.length) stop("registry-status");
          complete = true;
          break;
        }
        length += r.data.length;
        if (length > 65535 || (r.sw === 0x6310 && !r.data.length))
          stop("registry-status");
        pages.push({ kind, data: r.data });
        if (r.sw === 0x9000) {
          complete = true;
          break;
        }
      }
      if (!complete) stop("registry-incomplete");
    }
    verifyRegistry(sdk, pages, allowed);
    state.registry = pages.map((p) => ({ kind: p.kind, data: hex(p.data) }));
    await persist();
  };
  try {
    state.nfcLimits = {
      platform: limits?.platform === "android" ? "android" : "unconfirmed",
      androidTimeoutMs: Number.isFinite(limits?.androidTimeoutMs)
        ? limits.androidTimeoutMs
        : null,
      maxTransceive: Number.isFinite(limits?.maxTransceive)
        ? limits.maxTransceive
        : null,
    };
    if (
      limits?.platform !== "android" ||
      limits.androidTimeoutMs !== 15000 ||
      !Number.isInteger(limits.maxTransceive) ||
      limits.maxTransceive < 261
    ) {
      stop("nfc-limits-unconfirmed");
    }
    if (load.length !== PINS.bytes || hash(load) !== PINS.load)
      stop("image-mismatch");
    await identity("match-chip");
    const absent = [
      sdk.CARD_AID,
      sdk.TAG_AID,
      sdk.OPENER_AID,
      sdk.CASHU_PACKAGE_AID,
      ...[
        "F0434153485550524F4245",
        "F0434153485550524F42454D",
        "F0434153485550524F424501",
        ...PRIVATE,
      ].map(fromHex),
    ];
    for (let i = 0; i < absent.length; i++) {
      const reply = await raw(
        "require-absent-" + i,
        sdk.selectAid(absent[i]),
        [0x6a82],
      );
      if (reply.data.length) stop("absence-response");
    }
    const session = await authenticate("factory");
    await registry("blank", session, []);
    await secure(
      "install-for-load",
      session,
      sdk.installForLoad(fromHex(PINS.package)),
    );
    const blocks = sdk.splitLoad(load);
    if (blocks.length !== 110) stop("load-block-count");
    for (let i = 0; i < blocks.length; i++) {
      await secure("load-" + (i + 1) + "-of-110", session, blocks[i]);
    }
    for (const suffix of ["4D", "01"]) {
      const aid = fromHex(PINS.package + suffix);
      await secure(
        "create-" + suffix,
        session,
        sdk.installAndSelectable(fromHex(PINS.package), aid, aid),
      );
    }
    const selected = await raw(
      "select-private",
      sdk.selectAid(fromHex(PRIVATE[0])),
    );
    if (!equal(selected.data, [67, 80, 82, 79, 84, 2])) stop("private-version");
    const diagnostic = await raw("diagnostics", [0xb0, 0x7d, 0, 0, 0]);
    const d = diagnostic.data;
    const word = (at) => d[at] * 256 + d[at + 1];
    if (
      d.length !== 16 ||
      d[15] !== 5 ||
      d.slice(10, 15).some((v) => v !== 0) ||
      [0, 2, 4, 6, 8].some((at) => word(at) > 32767) ||
      word(8) > word(6)
    ) {
      stop("diagnostics-mismatch");
    }
    state.diagnostics = hex(d);
    const key = await raw("public-key", [0xb0, 0x7a, 0, 0, 0]);
    if (key.data.length !== 33 || !validateKey(key.data))
      stop("invalid-public-key");
    state.cardKey = hex(key.data);
    state.creationVerified = true;
    await persist();
    // Successful control only: a fresh chip match/channel and exact registry precede deletion.
    await identity("cleanup-match-chip");
    const cleanup = await authenticate("cleanup-factory");
    await registry("cleanup", cleanup, PRIVATE);
    for (const aid of PRIVATE) {
      const bytes = fromHex(aid);
      await secure(
        "delete-" + aid,
        cleanup,
        [0x80, 0xe4, 0, 0, bytes.length + 2, 0x4f, bytes.length, ...bytes, 0],
        [0x9000, 0x6a88],
      );
    }
    await registry("verify-blank", cleanup, []);
    state.blankBaselineVerified = true;
    state.status = "complete";
    state.stage = "blank-verified";
    await persist();
  } catch (error) {
    state.status = "stopped";
    state.failure = failureCode(error, sdk);
    // No cleanup/retry after any uncertainty; one best-effort stopped journal, no APDU.
    try {
      await persist();
    } catch {
      state.journalUnavailable = true;
    }
  }
  return state;
}
module.exports = {
  PINS,
  BASELINE,
  PRIVATE,
  runCreation,
  verifyRegistry,
  registryFrames,
  LabStop,
  resumeJournal,
};
