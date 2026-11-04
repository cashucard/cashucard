/* One installed/uninitialized private image only. Transport and persistence are
 * injected; importing this module performs no reader or device operations. */
const { randomBytes } = require("node:crypto");
const { diagnostics, verifyRegistry, deletion } = require("./run-compact.cjs");
const { registryFrames } = require("./run-probe.cjs");
const profile = require("./unset-up-profile.json");
const b = (s) => [...Buffer.from(s, "hex")],
  hex = (data) => Buffer.from(data).toString("hex");
const equal = (a, c) => Buffer.from(a).equals(Buffer.from(c));
class CleanupFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new CleanupFailure(code);
};
const expected = Object.fromEntries(
  profile.registry.map((p) => [p.kind, registryFrames(p.data)]),
);
const baseline = expected["load-files"].filter(
  (frame) => !frame.includes(profile.package.toLowerCase()),
);
function verifyUnsetRegistry(sdk, pages, blank = false) {
  if (!Array.isArray(pages) || !pages.length) fail("registry-incomplete");
  const registry = { pages, entries: [] };
  for (const kind of ["applications", "load-files"]) {
    const rows = pages.filter((p) => p.kind === kind);
    if (!rows.length || rows.length > 4) fail("registry-incomplete");
    let data = "";
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      if (
        typeof p.data !== "string" ||
        !/^(?:[0-9a-f]{2})*$/.test(p.data) ||
        p.data.length > 510
      )
        fail("registry-framing");
      if (i === rows.length - 1) {
        if (p.sw !== "9000" && !(i === 0 && p.sw === "6a88" && p.data === ""))
          fail("registry-status");
      } else if (p.sw !== "6310" || !p.data.length) fail("registry-status");
      data += p.data;
    }
    let frames, entries;
    try {
      frames = registryFrames(data);
      entries = sdk.parseRegistryEntries(b(data));
    } catch {
      fail("registry-framing");
    }
    const want = blank
      ? kind === "applications"
        ? []
        : baseline
      : expected[kind];
    if (
      frames.length !== want.length ||
      new Set(frames).size !== frames.length ||
      frames.some((f) => !want.includes(f))
    )
      fail("registry-mismatch");
    registry.entries.push(...entries.map((e) => ({ ...e, kind })));
  }
  try {
    verifyRegistry(registry, blank ? [] : profile.deletionAids, baseline);
  } catch {
    fail("registry-mismatch");
  }
  return true;
}
async function cleanupUnsetUp({
  sdk,
  tx: nativeTx,
  save,
  close,
  now = () => performance.now(),
  random = randomBytes,
  expectedKey = profile.key,
  began = now(),
  requirePolicyCompletion = false,
}) {
  const state = {
    plan: profile.planId,
    profile: profile.format,
    chip: profile.chip,
    key: expectedKey,
    status: "running",
    stage: "admission",
    commands: 0,
    blankBaselineVerified: false,
    registrySnapshots: [],
    deleted: [],
    exchanges: [],
  };
  let permits = [];
  const check = () => {
    if (!Number.isFinite(now()) || now() - began > 120000)
      fail("elapsed-bound");
  };
  const persist = async () => {
    try {
      await save(JSON.parse(JSON.stringify(state)));
    } catch {
      fail("journal-unavailable");
    }
  };
  const tx = async (apdu) => {
    check();
    const permit = permits.shift();
    if (
      !permit ||
      !permit(apdu) ||
      apdu.length > 261 ||
      apdu.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("command-refused");
    if (state.commands >= 64) fail("command-bound");
    const receipt = {
      command: ++state.commands,
      stage: state.stage,
      header: hex(apdu.slice(0, 4)),
      sw: null,
    };
    state.exchanges.push(receipt);
    await persist();
    check();
    let timer, reply;
    try {
      reply = await Promise.race([
        nativeTx(apdu),
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
      !Array.isArray(reply) ||
      reply.length < 2 ||
      reply.length > 258 ||
      reply.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("invalid-reply");
    receipt.sw = hex(reply.slice(-2));
    // Authentication response bodies include challenge/cryptogram material.
    if (![0x50, 0x82].includes(apdu[1])) receipt.data = hex(reply.slice(0, -2));
    await persist();
    check();
    return reply;
  };
  const exact = (command) => (a) => equal(a, command);
  const secure = (plain) => (a) =>
    a.length === plain.length + 8 &&
    a[0] === 0x84 &&
    equal(a.slice(1, 4), plain.slice(1, 4)) &&
    a[4] === plain[4] + 8 &&
    equal(a.slice(5, -9), plain.slice(5, -1)) &&
    a.at(-1) === 0;
  const step = async (name, admit, operation) => {
    check();
    state.stage = name;
    permits = admit;
    await persist();
    check();
    try {
      const result = await operation();
      if (permits.length) fail("missing-command");
      return result;
    } finally {
      permits = [];
    }
  };
  const expect = (reply, codes = [0x9000]) => {
    if (!codes.includes(reply.sw))
      fail("card-status-" + reply.sw.toString(16).padStart(4, "0"));
    return reply;
  };
  const raw = (name, apdu) =>
    step(name, [exact(apdu)], async () => expect(await sdk.transmit(tx, apdu)));
  const identity = (name) =>
    step(
      name,
      [exact(sdk.selectAid(sdk.ISD_AID)), exact([0x80, 0xca, 0x9f, 0x7f, 0])],
      () => sdk.readChipIdentity(tx, profile.chip),
    );
  const auth = (name) =>
    step(
      name,
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
        const handshake = await sdk.initializeUpdate(tx, random, 1);
        if (handshake.reply.kvn !== 1) fail("factory-version-mismatch");
        const keys = sdk.sessionIfMatches(sdk.FACTORY_KEYS, handshake);
        if (!keys) fail("factory-keys-not-proved");
        return sdk.externalAuthenticate(tx, keys, handshake);
      },
    );
  const registry = async (name, session, blank = false) => {
    const snapshot = { name, pages: [], verified: false };
    state.registrySnapshots.push(snapshot);
    await persist();
    for (const kind of ["applications", "load-files"]) {
      let complete = false;
      for (let i = 0; i < 4; i++) {
        const plain = sdk.registryCommand(kind, i > 0);
        const reply = await step(
          name + "-" + kind + "-" + i,
          [secure(plain)],
          async () =>
            expect(await session.send(tx, plain), [0x9000, 0x6310, 0x6a88]),
        );
        snapshot.pages.push({
          kind,
          data: hex(reply.data),
          sw: reply.sw.toString(16).padStart(4, "0"),
        });
        await persist();
        if (reply.sw === 0x6310) {
          if (!reply.data.length) fail("registry-status");
          continue;
        }
        if (reply.sw === 0x6a88 && (i !== 0 || reply.data.length))
          fail("registry-status");
        complete = true;
        break;
      }
      if (!complete) fail("registry-incomplete");
    }
    verifyUnsetRegistry(sdk, snapshot.pages, blank);
    snapshot.verified = true;
    await persist();
  };
  let firstFailure;
  try {
    if (
      typeof expectedKey !== "string" ||
      !/^(02|03)[0-9a-f]{64}$/.test(expectedKey)
    )
      fail("invalid-key");
    await identity("match-chip");
    const initial = await auth("initial-factory-authentication");
    await registry("before-recovery", initial);
    const selected = await raw(
      "select-private",
      sdk.selectAid(b(profile.package + "01")),
    );
    if (!equal(selected.data, Buffer.from("CPROT\x02")))
      fail("private-version-mismatch");
    const diagnostic = await raw("read-diagnostics", [0xb0, 0x7d, 0, 0, 0]);
    let checked;
    try {
      checked = diagnostics(diagnostic.data, 0);
    } catch {
      fail("diagnostic-mismatch");
    }
    if (Math.min(checked.maxCommit, checked.unusedCommit) < 128)
      fail("commit-floor");
    state.diagnostics = hex(diagnostic.data);
    await persist();
    const key = await raw("read-public-key", [0xb0, 0x7a, 0, 0, 0]);
    if (hex(key.data) !== expectedKey) fail("key-mismatch");
    state.cardKey = hex(key.data);
    await persist();
    await identity("cleanup-match-chip");
    const cleanup = await auth("cleanup-factory-authentication");
    await registry("before-delete", cleanup);
    for (const aid of profile.deletionAids) {
      const plain = deletion(aid);
      const reply = await step("delete-" + aid, [secure(plain)], async () =>
        expect(await cleanup.send(tx, plain)),
      );
      if (reply.data.length !== 0 && !equal(reply.data, [0]))
        fail("delete-reply-mismatch");
      state.deleted.push(aid);
      await persist();
    }
    await registry("verify-blank", cleanup, true);
    await identity("final-match-chip");
    state.registryBlankVerified = true;
    await persist();
  } catch (error) {
    firstFailure = error;
    state.status = "stopped";
    const cause = error instanceof sdk.TransportError ? error.cause : error;
    state.failure =
      cause instanceof CleanupFailure
        ? cause.code
        : error instanceof sdk.ChipIdentityMismatch
          ? "wrong-chip"
          : error instanceof sdk.WrongKeys
            ? "factory-keys-not-proved"
            : error instanceof sdk.CardError
              ? "card-status-" + error.sw.toString(16).padStart(4, "0")
              : "operation-uncertain";
  } finally {
    state.stage = state.status === "stopped" ? state.stage : "close-reader";
    try {
      const proof = await close();
      state.readerClosed = true;
      state.independentPolicyComplete = proof?.policyComplete === true;
    } catch {
      state.readerClosed = false;
      state.closeFailure = "reader-close-uncertain";
      if (!firstFailure) {
        state.status = "stopped";
        state.failure = "reader-close-uncertain";
      }
    }
    if (
      state.registryBlankVerified &&
      state.readerClosed &&
      requirePolicyCompletion &&
      !state.independentPolicyComplete
    ) {
      state.status = "stopped";
      state.failure = "independent-policy-incomplete";
    }
    if (
      state.registryBlankVerified &&
      state.readerClosed &&
      state.status !== "stopped"
    ) {
      state.blankBaselineVerified = true;
      state.status = "complete";
      state.stage = "blank-verified";
    }
    try {
      await persist();
    } catch {
      state.status = "stopped";
      state.failure = "journal-unavailable";
      state.blankBaselineVerified = false;
      state.journalUnavailable = true;
    }
  }
  return state;
}
module.exports = { cleanupUnsetUp, verifyUnsetRegistry, CleanupFailure };
