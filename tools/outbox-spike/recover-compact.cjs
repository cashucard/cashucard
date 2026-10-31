/* Closed private-fixture recovery. Injected transport; importing opens no device. */
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { ProbeFailure, failureEvidence } = require("./run-probe.cjs");
const { diagnostics, deletion } = require("./run-compact.cjs");
const { verifyRegistry, PRIVATE } = require("./pixel-control.js");
const { fixtureView } = require("./compact-export.cjs");
const { workload, verifyPacket, MAX, cmd } = require("./compact-workload.cjs");
const PINS = require("./pixel-optimized.json");
const bytes = (s) => [...Buffer.from(s, "hex")];
const hex = (b) => Buffer.from(b).toString("hex");
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const fail = (code) => {
  throw new ProbeFailure(code);
};

function verifyIndependent(python, key, packet, verified) {
  const result = JSON.parse(
    execFileSync(python, [path.join(__dirname, "verify-recovery.py")], {
      input: JSON.stringify({
        key: hex(key),
        paymentMessage: verified.paymentMessage,
        descriptorMessage: verified.descriptorMessage,
        payment: hex(packet.subarray(-128, -64)),
        descriptor: hex(packet.subarray(-64)),
      }),
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  return result.payment === true && result.descriptor === true;
}

async function recoverToBlank({
  sdk,
  tx: nativeTx,
  save,
  now,
  expectedKey,
  independentVerify,
  random = randomBytes,
}) {
  const w = workload(MAX);
  const state = {
    plan: "compact-optimized-sign-recovery-v1",
    chip: PINS.chip,
    cap: PINS.cap,
    status: "running",
    stage: "validate-recovery",
    commands: 0,
    timingsMs: {},
    registrySnapshots: [],
    exportPages: [],
  };
  const began = now();
  let permits = [];
  const check = () => {
    if (now() - began > 120000) fail("drill-bound-exceeded");
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
    const admit = permits.shift();
    if (
      !admit ||
      !admit(apdu) ||
      apdu.length > 261 ||
      apdu.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    )
      fail("recovery-command-refused");
    if (state.commands >= 160) fail("drill-bound-exceeded");
    state.commands++;
    state.header = hex(apdu.slice(0, 4));
    state.reply = null;
    await persist();
    check();
    const at = now();
    let reply;
    try {
      reply = await nativeTx(apdu);
    } catch (error) {
      state.failedExchange = {
        command: state.commands,
        stage: state.stage,
        elapsedMs: now() - at,
        ...failureEvidence(error, sdk),
      };
      throw error;
    }
    if (
      !Array.isArray(reply) ||
      reply.length < 2 ||
      reply.length > 258 ||
      reply.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      state.invalidReplyBytes = Array.isArray(reply) ? reply.length : null;
      fail("recovery-invalid-reply");
    }
    state.reply = hex(reply.slice(-2));
    await persist();
    check();
    return reply;
  };
  const exact = (a) => (b) => equal(a, b);
  const secure = (plain) => (a) =>
    a.length === plain.length + 8 &&
    a[0] === 0x84 &&
    equal(a.slice(1, 4), plain.slice(1, 4)) &&
    a[4] === plain[4] + 8 &&
    equal(a.slice(5, -9), plain.slice(5, -1)) &&
    a.at(-1) === 0;
  const step = async (name, admit, body) => {
    check();
    state.stage = name;
    permits = admit;
    await persist();
    const at = now();
    try {
      const value = await body();
      if (permits.length) fail("recovery-missing-command");
      state.timingsMs[name] = now() - at;
      await persist();
      return value;
    } finally {
      permits = [];
    }
  };
  const expect = (r, codes = [0x9000]) => {
    if (!codes.includes(r.sw))
      fail("card-status-" + r.sw.toString(16).padStart(4, "0"));
    return r;
  };
  const raw = async (name, apdu, codes) =>
    step(name, [exact(apdu)], async () =>
      expect(await sdk.transmit(tx, apdu), codes),
    );
  const data = async (name, apdu, expected) => {
    const r = await raw(name, apdu);
    if (expected && !equal(r.data, expected))
      fail("recovery-response-mismatch");
    return Buffer.from(r.data);
  };
  const identity = (name) =>
    step(
      name,
      [exact(sdk.selectAid(sdk.ISD_AID)), exact([0x80, 0xca, 0x9f, 0x7f, 0])],
      () => sdk.readChipIdentity(tx, PINS.chip),
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
        const hs = await sdk.initializeUpdate(tx, random, 1);
        if (hs.reply.kvn !== 1) fail("factory-version-mismatch");
        const keys = sdk.sessionIfMatches(sdk.FACTORY_KEYS, hs);
        if (!keys) fail("factory-keys-not-proved");
        return sdk.externalAuthenticate(tx, keys, hs);
      },
    );
  const registry = async (name, session, allowed) => {
    const pages = [];
    state.registrySnapshots.push({ name, pages });
    await persist();
    for (const kind of ["applications", "load-files"]) {
      let done = false;
      for (let i = 0; i < 4; i++) {
        const plain = sdk.registryCommand(kind, i > 0);
        const r = await step(
          name + "-" + kind + "-" + i,
          [secure(plain)],
          async () =>
            expect(await session.send(tx, plain), [0x9000, 0x6310, 0x6a88]),
        );
        pages.push({
          kind,
          data: hex(r.data),
          sw: r.sw.toString(16).padStart(4, "0"),
        });
        await persist();
        if (r.sw === 0x6a88) {
          if (i !== 0 || r.data.length) fail("recovery-registry-status");
          done = true;
          break;
        }
        if (r.sw === 0x6310 && !r.data.length) fail("recovery-registry-status");
        if (r.sw === 0x9000) {
          done = true;
          break;
        }
      }
      if (!done) fail("recovery-registry-incomplete");
    }
    try {
      verifyRegistry(
        sdk,
        pages.map((p) => ({ kind: p.kind, data: bytes(p.data) })),
        allowed,
      );
    } catch {
      fail("recovery-registry-mismatch");
    }
    state.registrySnapshots.at(-1).verified = true;
    await persist();
  };
  try {
    if (typeof independentVerify !== "function")
      fail("independent-verifier-required");
    if (
      typeof expectedKey !== "string" ||
      !/^(02|03)[0-9a-f]{64}$/.test(expectedKey)
    )
      fail("recovery-key-invalid");
    try {
      fixtureView(
        { ...w.vector.context, cardKey: Buffer.from(expectedKey, "hex") },
        w.vector.keysets,
        w.vector.proofs,
      );
    } catch {
      fail("recovery-key-invalid");
    }
    await identity("match-chip");
    const initial = await auth("initial-factory-authentication");
    await registry("before-recovery", initial, PRIVATE);
    // SELECT runs the private applet's recovery: unpublished staging may be
    // released; a committed record's remaining burn bookkeeping may finish.
    await data(
      "select-and-recover",
      sdk.selectAid(bytes(PINS.package + "01")),
      Buffer.from("CPROT\x02"),
    );
    const diagnostic = await data("read-diagnostics", cmd(0x7d));
    state.diagnostics = hex(diagnostic);
    diagnostics(diagnostic, 2);
    await persist();
    const key = await data("read-public-key", cmd(0x7a));
    state.cardKey = hex(key);
    await persist();
    if (hex(key) !== expectedKey) fail("recovery-key-mismatch");
    const status = await data("status-recovered", cmd(0x76));
    state.recoveredStatus = [...status];
    await persist();
    const scopeReply = await raw(
      "read-existing-scope",
      cmd(0x7c, Buffer.from([0])),
      [0x9000, 0x6985],
    );
    if (
      equal(status, [64, 90, 128, 0, 0, 0]) &&
      scopeReply.sw === 0x6985 &&
      scopeReply.data.length === 0
    ) {
      state.recoveryBranch = "unpublished-staging-released";
      await persist();
    } else {
      if (
        !equal(status, w.consumedStatus) ||
        scopeReply.sw !== 0x9000 ||
        scopeReply.data.length !== 45
      )
        fail("recovery-state-mismatch");
      const scope = Buffer.from(scopeReply.data);
      state.scope = hex(scope);
      await persist();
      if (
        scope[0] !== 0 ||
        scope.readBigUInt64BE(1) !== 1n ||
        scope.readUInt32BE(9) !== 1
      )
        fail("recovery-scope-mismatch");
      state.recoveryBranch = "committed-packet-recovered";
      await persist();
      const pages = [];
      for (let i = 0; i < w.pages.length; i++) {
        const page = await data("export-existing-" + i, w.pages[i]);
        state.exportPages.push({
          offset: i * 255,
          receivedBytes: page.length,
          data: hex(page.subarray(0, 256)),
        });
        await persist();
        if (page.length !== Math.min(255, w.packetBytes - i * 255))
          fail("recovery-page-length");
        pages.push(page);
      }
      const packet = Buffer.concat(pages);
      state.packet = hex(packet);
      await persist();
      let verified;
      try {
        verified = verifyPacket(key, scope, packet, MAX);
      } catch {
        fail("recovery-packet-invalid");
      }
      state.nodeVerified = verified;
      await persist();
      let independent = false;
      try {
        independent = await independentVerify(key, packet, verified);
      } catch {
        fail("independent-verifier-failed");
      }
      if (independent !== true) fail("independent-verification-failed");
      state.independentlyVerified = true;
      await persist();
      check();
      await data("retire-verified-scope", cmd(0x77, scope), [1]);
      await data("status-retired", cmd(0x76), [64, 90, 0, 0, 128, 0]);
      state.retirementConfirmed = true;
      await persist();
    }
    await identity("cleanup-match-chip");
    const cleanup = await auth("cleanup-factory-authentication");
    await registry("before-delete", cleanup, PRIVATE);
    for (const aid of PRIVATE) {
      const plain = deletion(aid);
      await step("delete-" + aid, [secure(plain)], async () =>
        expect(await cleanup.send(tx, plain)),
      );
    }
    await registry("verify-blank", cleanup, []);
    state.blankBaselineVerified = true;
    state.status = "complete";
    state.stage = "blank-verified";
    await persist();
  } catch (error) {
    state.status = "stopped";
    state.failure =
      error instanceof ProbeFailure
        ? error.code
        : failureEvidence(error, sdk).code;
    if (
      error instanceof sdk.TransportError &&
      error.cause instanceof ProbeFailure &&
      [
        "journal-unavailable",
        "recovery-command-refused",
        "recovery-invalid-reply",
      ].includes(error.cause.code)
    )
      state.failure = error.cause.code;
    if (error instanceof sdk.WrongKeys)
      state.failure = "factory-keys-not-proved";
    if (error instanceof sdk.ChipIdentityMismatch) state.failure = "wrong-chip";
    try {
      await persist();
    } catch {
      state.journalUnavailable = true;
    }
  }
  return state;
}
module.exports = { recoverToBlank, verifyIndependent };
