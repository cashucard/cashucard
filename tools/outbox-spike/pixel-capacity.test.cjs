const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  fixture,
  sha,
  b,
  sdk,
  kitRequire,
} = require("./pixel-test-support.cjs");
const {
  PINS,
  runCapacity,
  resumeJournal,
  runCapacityDiagnostics,
  CAPACITY_DIAGNOSTIC_PLAN,
} = require("./pixel-control.js");
const {
  capacityProfile,
  verifyCapacityPacket,
  CAPACITY_PLAN,
} = require("./pixel-capacity.js");
const { workload, MAX, cmd, verifyPacket } = require("./compact-workload.cjs");
const {
  fixtureView,
  signCompact,
  exportCompact,
} = require("./compact-export.cjs");
const { schnorr } = kitRequire("@noble/curves/secp256k1");
const raw = [
  ...fs.readFileSync(path.join(__dirname, "fixtures/compact-capacity-v1.json")),
];
const profile = capacityProfile(raw, sha),
  reference = workload(MAX);
const key = b(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
);
const secret = Uint8Array.from([...Array(31).fill(0), 1]);
const verifySignature = (signature, message, publicKey) =>
  schnorr.verify(
    Uint8Array.from(signature),
    Uint8Array.from(message),
    Uint8Array.from(publicKey),
  );
const record = {
  installation: reference.vector.context.installation,
  id: 1n,
  index: 0,
  generation: 1,
  inputs: reference.vector.proofs.map((p) => ({
    slot: p.slot,
    generation: p.generation,
  })),
};
const view = fixtureView(
  { ...reference.vector.context, cardKey: Buffer.from(key) },
  reference.vector.keysets,
  reference.vector.proofs,
);
const packed = signCompact(record, reference.vector.outputs, view, (message) =>
  Buffer.from(schnorr.sign(message, secret, new Uint8Array(32))),
);
const exported = exportCompact({ ...record, packet: packed }, view);
const packet = [...Buffer.concat([...exported.pages()])];
const scope = [...profile.scopePrefix, ...b(exported.packetId)];
test("portable closed fixture matches every independent Node workload frame", () => {
  for (const k of [
    "setup",
    "keysets",
    "loads",
    "begin",
    "outputPages",
    "stagedCounts",
    "pages",
  ])
    assert.deepEqual(profile[k], reference[k], k);
  assert.equal(profile.packetBytes, 23163);
  assert.equal(profile.pages.length, 91);
  assert.throws(
    () => capacityProfile([...raw.slice(0, -1), 0], sha),
    /capacity-fixture-mismatch/,
  );
});
test("portable verifier matches independent host canonical materialization and both BIP340 signatures", () => {
  const actual = verifyCapacityPacket({
    profile,
    key,
    scope,
    packet,
    hash: sha,
    verifySignature,
  });
  const expected = verifyPacket(
    Buffer.from(key),
    Buffer.from(scope),
    Buffer.from(packet),
    MAX,
  );
  assert.deepEqual(actual, expected);
});
test("tampered canonical bytes, scope and either signature are refused even with a matching packet hash", () => {
  for (const at of [80, 200, packet.length - 100, packet.length - 1]) {
    const bad = [...packet];
    bad[at] ^= 1;
    const changedScope = [...profile.scopePrefix, ...b(sha(bad.slice(0, -64)))];
    assert.throws(
      () =>
        verifyCapacityPacket({
          profile,
          key,
          scope: changedScope,
          packet: bad,
          hash: sha,
          verifySignature,
        }),
      /capacity-(packet|signature)-mismatch/,
    );
  }
  const badScope = [...scope];
  badScope[8] ^= 1;
  assert.throws(
    () =>
      verifyCapacityPacket({
        profile,
        key,
        scope: badScope,
        packet,
        hash: sha,
        verifySignature,
      }),
    /capacity-scope-mismatch/,
  );
  assert.throws(
    () =>
      verifyCapacityPacket({
        profile,
        key,
        scope,
        packet: packet.slice(1),
        hash: sha,
        verifySignature,
      }),
    /capacity-scope-mismatch/,
  );
});
function capacityFake(options = {}) {
  const f = fixture();
  let stage = "",
    scopeSeen = false,
    setup = false;
  const originalSave = f.args.save,
    originalTx = f.args.tx;
  f.args.hash = (bytes) =>
    bytes.length === PINS.bytes ? PINS.load : sha(bytes);
  f.args.fixture = raw;
  f.args.verifySignature = options.rejectSignature
    ? () => false
    : verifySignature;
  f.args.save = async (state) => {
    stage = state.stage;
    if (options.failVerifiedJournal && state.verified)
      throw Error("synthetic journal failure");
    await originalSave(state);
  };
  const expect = (command, expected) =>
    assert.deepEqual(command, expected, stage);
  f.args.tx = async (command) => {
    const reply = await originalTx(command);
    const ok = (data) => [...data, 0x90, 0];
    if (stage === "setup-capacity") {
      expect(command, reference.setup);
      setup = true;
      return ok([1]);
    }
    if (stage === "capacity-diagnostics")
      return ok([0x7f, 0xff, 10, 14, 10, 0, 20, 0, 20, 0, 64, 0, 48, 0, 2, 5]);
    if (stage === "capacity-empty" || stage === "capacity-retired")
      return ok([64, 90, 0, 0, 128, 0]);
    if (stage.startsWith("capacity-keyset-")) {
      const i = Number(stage.split("-").at(-1));
      expect(command, reference.keysets[i]);
      return ok([i + 1]);
    }
    if (stage.startsWith("capacity-proof-")) {
      const i = Number(stage.split("-").at(-1));
      expect(command, reference.loads[i]);
      return ok([i]);
    }
    if (stage === "capacity-begin") {
      expect(command, reference.begin);
      return ok([0]);
    }
    if (stage.startsWith("capacity-outputs-")) {
      const i = Number(stage.split("-").at(-1));
      expect(command, reference.outputPages[i]);
      return ok([reference.stagedCounts[i]]);
    }
    if (stage === "capacity-sign") {
      expect(command, cmd(0x74));
      return ok(scope);
    }
    if (stage === "capacity-consumed") return ok([63, 45, 0, 128, 0, 0]);
    if (stage === "capacity-reselect") return ok([...Buffer.from("CPROT\x02")]);
    if (stage === "capacity-retained-scope") {
      expect(command, cmd(0x7c, Buffer.from([0])));
      scopeSeen = true;
      return ok(scope);
    }
    if (stage.startsWith("capacity-export-")) {
      assert.ok(scopeSeen && setup);
      const i = Number(stage.split("-").at(-1));
      expect(command, reference.pages[i]);
      if (options.loseLastPage && i === 90)
        throw Error("synthetic lost export");
      const data = packet.slice(i * 255, (i + 1) * 255);
      if (options.truncatePage && i === 1) data.pop();
      return ok(data);
    }
    if (stage === "capacity-retire") {
      assert.ok(!options.rejectSignature);
      expect(command, cmd(0x77, Buffer.from(scope)));
      return ok([1]);
    }
    return reply;
  };
  return f;
}
test("full Pixel workflow verifies 91 pages before retirement and exact blank cleanup", async () => {
  const f = capacityFake();
  const r = await runCapacity(f.args);
  assert.equal(r.status, "complete", JSON.stringify(r));
  assert.equal(r.capacityVerified, true);
  assert.equal(r.plan, CAPACITY_PLAN);
  assert.equal(r.exportPages.length, 91);
  assert.deepEqual(
    r.verified,
    verifyPacket(
      Buffer.from(key),
      Buffer.from(scope),
      Buffer.from(packet),
      MAX,
    ),
  );
  assert.equal(r.commands, 395);
  assert.equal(f.sent.filter((a) => a[1] === 0x74).length, 1);
  assert.equal(f.sent.filter((a) => a[1] === 0x77).length, 1);
  assert.equal(r.blankBaselineVerified, true);
  assert.equal(f.card.packages.size, 0);
});
test("failed persistence of verified packet blocks retirement and deletion", async () => {
  const f = capacityFake({ failVerifiedJournal: true });
  const result = await runCapacity(f.args);
  assert.equal(result.failure, "journal-unavailable");
  assert.equal(result.exportPages.length, 91);
  assert.ok(!f.sent.some((a) => a[1] === 0x77 || a[1] === 0xe4));
});
for (const [option, reason] of [
  ["rejectSignature", "capacity-signature-mismatch"],
  ["loseLastPage", "transport-uncertain"],
  ["truncatePage", "capacity-page-length"],
])
  test(
    option + " preserves packet evidence without retirement or deletion",
    async () => {
      const f = capacityFake({ [option]: true });
      const r = await runCapacity(f.args);
      assert.equal(r.status, "stopped");
      assert.equal(r.failure, reason);
      assert.ok(r.exportPages.length > 0);
      assert.ok(!f.sent.some((a) => a[1] === 0x77 || a[1] === 0xe4));
      if (option === "loseLastPage") assert.equal(r.exportPages.length, 90);
      if (option === "truncatePage") {
        assert.equal(r.exportPages.length, 2);
        assert.equal(r.exportPages[1].receivedBytes, 254);
        assert.equal(r.exportPages[1].data.length, 508);
      }
    },
  );
test("capacity resume refuses a completed creation journal and preserves its own consumed journal", () => {
  assert.equal(
    resumeJournal(
      JSON.stringify({
        plan: PINS.plan,
        status: "complete",
        stage: "blank-verified",
      }),
      CAPACITY_PLAN,
    ).status,
    "stopped",
  );
  const saved = {
    plan: CAPACITY_PLAN,
    status: "stopped",
    stage: "capacity-export-90",
  };
  assert.deepEqual(resumeJournal(JSON.stringify(saved), CAPACITY_PLAN), saved);
});
test("invalid fixture or missing signature verifier stops before the first APDU", async () => {
  for (const reason of [
    "capacity-fixture-mismatch",
    "capacity-verifier-required",
  ]) {
    const f = capacityFake();
    if (reason === "capacity-fixture-mismatch") f.args.fixture = raw.slice(1);
    else f.args.verifySignature = undefined;
    const result = await runCapacity(f.args);
    assert.equal(result.failure, reason);
    assert.equal(f.sent.length, 0);
  }
});

test("diagnostic invocation keeps the same full-slot commands and uses a distinct consumed plan", async () => {
  const f = capacityFake();
  const result = await runCapacityDiagnostics(f.args);
  assert.equal(result.status, "complete");
  assert.equal(result.plan, CAPACITY_DIAGNOSTIC_PLAN);
  assert.equal(result.commands, 395);
  assert.equal(result.blankBaselineVerified, true);
  assert.equal(result.failedExchange, undefined);
  assert.deepEqual(
    resumeJournal(JSON.stringify(result), CAPACITY_DIAGNOSTIC_PLAN),
    result,
  );
  assert.equal(
    resumeJournal(JSON.stringify(result), CAPACITY_PLAN).failure,
    "saved-journal-unreadable",
  );
});

test("a late loading failure keeps the exact slot and native envelope, then stops before signing", async () => {
  const f = capacityFake();
  const send = f.args.tx,
    save = f.args.save;
  let stage,
    clock = 0;
  f.args.save = async (record) => {
    stage = record.stage;
    await save(record);
  };
  f.args.now = () => clock;
  f.args.tx = async (command) => {
    const reply = await send(command);
    if (stage === "capacity-proof-85") {
      clock += 471;
      throw Error("cashucard-lab:io");
    }
    return reply;
  };
  const r = await runCapacityDiagnostics(f.args);
  assert.equal(r.failure, "transport-uncertain");
  assert.deepEqual(r.failedExchange, {
    stage: "capacity-proof-85",
    command: 222,
    category: "android-io",
    elapsedMs: 471,
  });
  assert.equal(r.reply, null);
  assert.equal(f.sent.length, 222);
  assert.ok(!f.sent.some((a) => [0x70, 0x74, 0x77, 0xe4].includes(a[1])));
});
