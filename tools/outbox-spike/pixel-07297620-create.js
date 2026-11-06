/* Portable creation-only control. Platform, crypto, storage and NFC are injected. */
const PINS = Object.freeze(require("./pixel-07297620-create.json"));
class CreationStop extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const stop = (code) => {
  throw new CreationStop(code);
};
const hex = (a) =>
  Array.from(a, (v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => s.match(/../g)?.map((v) => parseInt(v, 16)) || [];
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function frames(text) {
  if (typeof text !== "string" || !/^(?:[0-9a-f]{2})*$/.test(text))
    stop("registry-framing");
  const a = fromHex(text),
    result = [];
  let at = 0;
  while (at < a.length) {
    const start = at;
    if (a[at++] !== 0xe3) stop("registry-framing");
    let n = a[at++];
    if (n === 0x81) {
      n = a[at++];
      if (n < 128) stop("registry-framing");
    } else if (n === 0x82) {
      const h = a[at++],
        l = a[at++];
      if (!h || l === undefined) stop("registry-framing");
      n = h * 256 + l;
    } else if (n >= 128) stop("registry-framing");
    if (!Number.isInteger(n) || at + n > a.length) stop("registry-framing");
    at += n;
    result.push(hex(a.slice(start, at)));
  }
  return result;
}
const BASELINE = Object.freeze(
  frames(PINS.baselinePages.find((p) => p.kind === "load-files").data),
);
const INSTALLED = Object.freeze(
  Object.fromEntries(
    PINS.installedPrivatePages.map((p) => [p.kind, frames(p.data)]),
  ),
);
function verifyRegistry(sdk, pages, installed) {
  if (
    !Array.isArray(pages) ||
    pages.some((p) => !["applications", "load-files"].includes(p.kind))
  )
    stop("registry-incomplete");
  for (const kind of ["applications", "load-files"]) {
    const rows = pages.filter((p) => p.kind === kind);
    if (rows.length < 1 || rows.length > 4) stop("registry-incomplete");
    let raw = "";
    for (const [i, p] of rows.entries()) {
      if (typeof p.data !== "string" || p.data.length > 510)
        stop("registry-framing");
      if (i < rows.length - 1) {
        if (p.sw !== "6310" || !p.data) stop("registry-status");
      } else if (p.sw !== "9000" && !(i === 0 && p.sw === "6a88" && !p.data))
        stop("registry-status");
      raw += p.data;
    }
    let got, parsed;
    try {
      got = frames(raw);
      parsed = sdk.parseRegistryEntries(fromHex(raw));
    } catch {
      stop("registry-framing");
    }
    const want =
      kind === "applications"
        ? installed
          ? INSTALLED[kind]
          : []
        : [...BASELINE, ...(installed ? INSTALLED[kind] : [])];
    if (
      got.length !== want.length ||
      got.length !== parsed.length ||
      new Set(got).size !== got.length ||
      got.some((f) => !want.includes(f))
    )
      stop("registry-mismatch");
  }
  return true;
}
function resumeJournal(raw) {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    if (
      v.plan === PINS.plan &&
      ["armed", "running", "stopped", "installed-unset-up"].includes(
        v.status,
      ) &&
      typeof v.stage === "string"
    )
      return v;
  } catch {}
  return {
    plan: PINS.plan,
    status: "stopped",
    stage: "saved-journal-unreadable",
    failure: "saved-journal-unreadable",
  };
}
function failure(error, sdk) {
  const cause = error instanceof sdk.TransportError ? error.cause : error;
  if (cause instanceof CreationStop) return cause.code;
  if (error instanceof sdk.ChipIdentityMismatch) return "wrong-chip";
  if (error instanceof sdk.WrongKeys) return "factory-keys-not-proved";
  if (error instanceof sdk.CardError)
    return "card-status-" + error.sw.toString(16).padStart(4, "0");
  return "operation-uncertain";
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
    artifact: {
      source: PINS.source,
      manifest: PINS.manifest,
      cap: PINS.cap,
      load: PINS.load,
    },
    status: "running",
    stage: "validate-image",
    commands: 0,
    registries: [],
    exchanges: [],
    timingsMs: {},
    blankBaselineVerified: false,
  };
  const began = now();
  let permits = [];
  const check = () => {
    if (cancelled()) stop("cancelled");
    if (!Number.isFinite(now()) || now() - began >= 120000)
      stop("elapsed-bound");
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
    const allowed = permits.shift();
    if (
      !allowed ||
      !allowed(apdu) ||
      apdu.length > 261 ||
      apdu.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      stop("command-not-admitted");
    if (state.commands >= 160) stop("command-bound");
    const e = {
      command: ++state.commands,
      stage: state.stage,
      header: hex(apdu.slice(0, 4)),
      sw: null,
    };
    state.exchanges.push(e);
    await persist();
    check();
    let timer, reply;
    const at = now();
    try {
      reply = await Promise.race([
        nativeTx(apdu),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new CreationStop("response-timeout")),
            Math.max(1, Math.min(30000, 120000 - (now() - began))),
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof CreationStop) throw error;
      stop("transport-uncertain");
    } finally {
      clearTimeout(timer);
    }
    if (
      !Array.isArray(reply) ||
      reply.length < 2 ||
      reply.length > 258 ||
      reply.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      stop("invalid-reply");
    e.sw = hex(reply.slice(-2));
    e.elapsedMs = Math.max(0, now() - at);
    if (![0x50, 0x82].includes(apdu[1])) e.data = hex(reply.slice(0, -2));
    await persist();
    check();
    return reply;
  };
  const exact = (a) => (b) => equal(a, b);
  const step = async (name, allowed, fn) => {
    check();
    state.stage = name;
    permits = allowed;
    await persist();
    check();
    const at = now();
    try {
      const r = await fn();
      if (permits.length) stop("missing-command");
      state.timingsMs[name] = now() - at;
      await persist();
      check();
      return r;
    } finally {
      permits = [];
    }
  };
  const expect = (r, codes = [0x9000]) => {
    if (!codes.includes(r.sw))
      stop("card-status-" + r.sw.toString(16).padStart(4, "0"));
    return r;
  };
  const raw = (name, a, codes) =>
    step(name, [exact(a)], async () =>
      expect(await sdk.transmit(tx, a), codes),
    );
  const secure = (name, session, plain, codes) =>
    raw(name, session.wrap(plain), codes);
  const ack = (r) => {
    if (r.data.length && !equal(r.data, [0])) stop("management-reply-mismatch");
    return r;
  };
  const identity = async (name) => {
    const r = await step(
      name,
      [exact(sdk.selectAid(sdk.ISD_AID)), exact([0x80, 0xca, 0x9f, 0x7f, 0])],
      () => sdk.readChipIdentity(tx, PINS.chip),
    );
    if (state.exchanges.at(-1).data !== PINS.cplc) stop("cplc-changed");
    return r;
  };
  const registry = async (name, session, installed) => {
    const snapshot = { name, pages: [], verified: false };
    state.registries.push(snapshot);
    await persist();
    for (const kind of ["applications", "load-files"]) {
      let complete = false;
      for (let page = 0; page < 4; page++) {
        const r = await secure(
          name + "-" + kind + "-" + page,
          session,
          sdk.registryCommand(kind, page > 0),
          [0x9000, 0x6310, 0x6a88],
        );
        snapshot.pages.push({
          kind,
          data: hex(r.data),
          sw: r.sw.toString(16).padStart(4, "0"),
        });
        await persist();
        if (r.sw === 0x6310) {
          if (!r.data.length) stop("registry-status");
          continue;
        }
        if (r.sw === 0x6a88 && (page !== 0 || r.data.length))
          stop("registry-status");
        complete = true;
        break;
      }
      if (!complete) stop("registry-incomplete");
    }
    verifyRegistry(sdk, snapshot.pages, installed);
    snapshot.verified = true;
    await persist();
  };
  try {
    if (
      limits?.platform !== "android" ||
      limits.androidTimeoutMs !== 15000 ||
      !Number.isInteger(limits.maxTransceive) ||
      limits.maxTransceive < 261
    )
      stop("nfc-limits-unconfirmed");
    if (load.length !== PINS.bytes || hash(load) !== PINS.load)
      stop("image-mismatch");
    const blocks = sdk.splitLoad(load);
    if (blocks.length !== PINS.blocks) stop("load-block-count");
    await identity("match-chip");
    const channel = await step(
      "factory-authentication",
      [
        exact(sdk.selectAid(sdk.ISD_AID)),
        (a) =>
          a.length === 14 &&
          equal(a.slice(0, 5), [0x80, 0x50, 1, 0, 8]) &&
          a.at(-1) === 0,
        (a) =>
          a.length === 22 &&
          equal(a.slice(0, 5), [0x84, 0x82, 1, 0, 16]) &&
          a.at(-1) === 0,
      ],
      async () => {
        expect(await sdk.transmit(tx, sdk.selectAid(sdk.ISD_AID)));
        const h = await sdk.initializeUpdate(tx, random, 1);
        if (h.reply.kvn !== 1) stop("factory-version-mismatch");
        const keys = sdk.sessionIfMatches(sdk.FACTORY_KEYS, h);
        if (!keys) stop("factory-keys-not-proved");
        return sdk.externalAuthenticate(tx, keys, h);
      },
    );
    state.factoryVersionVerified = 1;
    await persist();
    await registry("initial", channel, false);
    state.initialBaselineVerified = true;
    await persist();
    ack(
      await secure(
        "install-for-load",
        channel,
        sdk.installForLoad(fromHex(PINS.package)),
      ),
    );
    for (let i = 0; i < blocks.length; i++)
      ack(
        await secure(
          "load-" + (i + 1) + "-of-" + PINS.blocks,
          channel,
          blocks[i],
        ),
      );
    for (const suffix of ["4D", "01"]) {
      const aid = fromHex(PINS.package + suffix);
      ack(
        await secure(
          "create-" + suffix,
          channel,
          sdk.installAndSelectable(fromHex(PINS.package), aid, aid),
        ),
      );
    }
    await registry("installed", channel, true);
    state.installedRegistryVerified = true;
    await persist();
    const selected = await raw(
      "select-private",
      sdk.selectAid(fromHex(PINS.package + "01")),
    );
    if (!equal(selected.data, [67, 80, 82, 79, 84, 2])) stop("private-version");
    const d = (await raw("diagnostics", [0xb0, 0x7d, 0, 0, 0])).data,
      word = (at) => d[at] * 256 + d[at + 1];
    if (
      d.length !== 16 ||
      d[15] !== 5 ||
      d[14] !== 0 ||
      d.slice(10, 14).some((v) => v !== 0) ||
      [0, 2, 4, 6, 8].some((at) => word(at) > 32767) ||
      word(8) > word(6) ||
      Math.min(word(6), word(8)) < 128
    )
      stop("diagnostics-unset-up");
    state.diagnostics = hex(d);
    state.diagnosticsVerified = true;
    await persist();
    const key = (await raw("public-key", [0xb0, 0x7a, 0, 0, 0])).data;
    if (key.length !== 33 || !validateKey(key)) stop("invalid-public-key");
    state.cardKey = hex(key);
    await persist();
    await identity("final-match-chip");
    state.finalIdentityVerified = true;
    state.creationVerified = true;
    state.status = "installed-unset-up";
    state.stage = "installed-unset-up";
    await persist();
  } catch (error) {
    state.status = "stopped";
    state.failure = failure(error, sdk);
    state.creationVerified = undefined;
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
  runCreation,
  verifyRegistry,
  resumeJournal,
  CreationStop,
};
