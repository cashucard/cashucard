const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const sdk = require("../cardkit");
const kitRequire = require("node:module").createRequire(
  require.resolve("../cardkit/package.json"),
);
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const { PINS, BASELINE, PRIVATE, runCreation } = require("./pixel-control.js");
const b = (hex) => [...Buffer.from(hex, "hex")];
const hex = (bytes) => Buffer.from(bytes).toString("hex").toUpperCase();
const sha = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

// Synthetic parseable CAP envelope, not the pinned hardware image. Positive workflow
// cases stub only its digest; the real SHA implementation is used by the rejection case.
function syntheticLoad() {
  const component = (tag, data) => [
    tag,
    data.length >> 8,
    data.length & 255,
    ...data,
  ];
  const aid = b(PINS.package);
  const header = component(1, [...Array(9).fill(0), aid.length, ...aid]);
  const applets = component(3, [
    2,
    ...["4D", "01"].flatMap((s) => {
      const a = b(PINS.package + s);
      return [a.length, ...a, 0, 0];
    }),
  ]);
  const filler = component(
    2,
    Array(PINS.bytes - 4 - header.length - applets.length - 3).fill(0),
  );
  const body = [...header, ...applets, ...filler];
  return [0xc4, 0x82, body.length >> 8, body.length & 255, ...body];
}
function fixture(options = {}) {
  const card = new FakeCard(options.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {});
  const records = [],
    sent = [];
  let clock = 0,
    aborted = false,
    changedChip = false;
  const tx = async (apdu) => {
    sent.push(apdu);
    let reply = await card.transceive(apdu);
    if (
      apdu[1] === 0xca &&
      apdu[2] === 0x9f &&
      (options.wrongChip || (changedChip && options.wrongCleanupChip))
    ) {
      reply = [...reply];
      reply[15] ^= 1;
    }
    if (apdu[1] === 0x50 && options.wrongVersion) {
      reply = [...reply];
      reply[10] = 2;
    }
    if (apdu[1] === 0xf2) {
      const baseline = BASELINE.flatMap(b);
      const data = reply.slice(0, -2);
      const extra = options.unknownRegistry
        ? b("e30e4f05a0000000999f700101ce020100")
        : [];
      if (apdu[2] === 0x20) reply = [...baseline, ...data, ...extra, 0x90, 0];
      if (
        options.unknownCleanup &&
        card.instanceAids().length === 2 &&
        apdu[2] === 0x40
      ) {
        reply = [...data, ...b("e30e4f05a0000000999f700101ce020100"), 0x90, 0];
      }
    }
    if (
      apdu[1] === 0xa4 &&
      hex(apdu.slice(5, 5 + apdu[4])) === PRIVATE[0] &&
      card.instances.has(PRIVATE[0])
    ) {
      reply = [...Buffer.from("CPROT\x02"), 0x90, 0];
    }
    if (apdu[0] === 0xb0 && apdu[1] === 0x7d) {
      const words = [
        32767,
        2574,
        2560,
        5120,
        options.badDiagnostic ? 6000 : 5120,
        0,
        0,
      ];
      reply = [...words.flatMap((w) => [w >> 8, w & 255]), 0, 5, 0x90, 0];
    }
    if (apdu[0] === 0xb0 && apdu[1] === 0x7a) {
      reply = [
        ...b(
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        ),
        0x90,
        0,
      ];
      changedChip = true;
    }
    if (options.loseOpener && card.instanceAids().length === 1) {
      throw Error("PRIVATE RAW NATIVE ERROR");
    }
    if (options.cancelOpener && card.instanceAids().length === 1)
      aborted = true;
    return reply;
  };
  const args = {
    sdk,
    load: syntheticLoad(),
    hash: () => PINS.load,
    tx,
    random: (n) => Array.from({ length: n }, (_, i) => i),
    now: () => clock,
    cancelled: () => aborted,
    validateKey: () => !options.badKey,
    save: async (record) => {
      records.push(record);
      if (options.expire && record.stage === "install-for-load") clock = 120001;
      if (options.journalFails && record.stage === "load-1-of-110")
        throw Error("storage failed");
    },
  };
  return { card, records, sent, args };
}
test("creation control uses real SCP02, creates both instances and verifies exact blank cleanup", async () => {
  const f = fixture();
  const result = await runCreation(f.args);
  assert.equal(result.status, "complete", JSON.stringify(result));
  assert.equal(result.creationVerified, true);
  assert.equal(result.blankBaselineVerified, true);
  assert.equal(f.card.packages.size, 0);
  assert.deepEqual(f.card.instanceAids(), []);
  assert.equal(f.sent.filter((a) => a[1] === 0xe8).length, 110);
  assert.deepEqual(
    f.sent.filter((a) => a[1] === 0xe4).map((a) => hex(a.slice(7, 7 + a[6]))),
    PRIVATE,
  );
  assert.ok(f.sent.every((a) => a.length <= 261));
  assert.equal(f.sent.filter((a) => a[1] === 0x50).length, 2);
  assert.ok(!f.sent.some((a) => [0xd8, 0x7e, 0x70, 0x74, 0x77].includes(a[1])));
  assert.equal(f.card.failedAuths, 0);
});
test("actual SHA rejects an unpinned image before touching a transport", async () => {
  const f = fixture();
  f.args.hash = sha;
  const r = await runCreation(f.args);
  assert.equal(r.failure, "image-mismatch");
  assert.equal(f.sent.length, 0);
});
test("wrong chip stops after the identity read, before any authentication", async () => {
  const f = fixture({ wrongChip: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "wrong-chip");
  assert.equal(f.sent.length, 2);
});
for (const flag of ["wrongKeys", "wrongVersion"])
  test(flag + " never sends external authentication", async () => {
    const f = fixture({ [flag]: true });
    const r = await runCreation(f.args);
    assert.equal(
      r.failure,
      flag === "wrongKeys"
        ? "factory-keys-not-proved"
        : "factory-version-mismatch",
    );
    assert.equal(f.sent.filter((a) => a[1] === 0x50).length, 1);
    assert.equal(f.sent.filter((a) => a[1] === 0x82).length, 0);
  });
test("unknown baseline objects block every LOAD/INSTALL/DELETE", async () => {
  const f = fixture({ unknownRegistry: true });
  const r = await runCreation(f.args);
  assert.equal(r.status, "stopped");
  assert.ok(!f.sent.some((a) => [0xe6, 0xe8, 0xe4].includes(a[1])));
});
test("lost creation reply stops without another command, cleanup, retry or raw exception text", async () => {
  const f = fixture({ loseOpener: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "transport-uncertain");
  assert.equal(f.card.instanceAids().length, 1);
  assert.equal(f.sent.at(-1)[1], 0xe6);
  assert.ok(!JSON.stringify(r).includes("PRIVATE RAW"));
});
test("bad memory diagnostics block the cleanup path", async () => {
  const f = fixture({ badDiagnostic: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "diagnostics-mismatch");
  assert.ok(!f.sent.some((a) => a[1] === 0xe4));
});
for (const flag of ["unknownCleanup", "wrongCleanupChip", "badKey"])
  test(flag + " cannot authorize deletion", async () => {
    const f = fixture({ [flag]: true });
    const r = await runCreation(f.args);
    assert.equal(r.status, "stopped");
    assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    assert.equal(f.card.instanceAids().length, 2);
  });
test("a failed journal write blocks the next transmission", async () => {
  const f = fixture({ journalFails: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "journal-unavailable");
  assert.ok(!f.sent.some((a) => a[1] === 0xe8));
});
test("elapsed bound is rechecked after saving intent and before the wire", async () => {
  const f = fixture({ expire: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "elapsed-bound");
  assert.ok(!f.sent.some((a) => [0xe6, 0xe8, 0xe4].includes(a[1])));
});
test("cancellation after creation preserves the result without another APDU", async () => {
  const f = fixture({ cancelOpener: true });
  const r = await runCreation(f.args);
  assert.equal(r.failure, "cancelled");
  assert.equal(f.sent.at(-1)[1], 0xe6);
  assert.equal(f.card.instanceAids().length, 1);
});
test("an SDK call outside its admitted sequence is refused before the native transport", async () => {
  const f = fixture();
  f.args.sdk = { ...sdk, readChipIdentity: (tx) => tx([0x80, 0xd8, 0, 0, 0]) };
  const r = await runCreation(f.args);
  assert.equal(r.failure, "command-not-admitted");
  assert.equal(f.sent.length, 0);
});
