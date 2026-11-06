const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  { createHash } = require("node:crypto");
const sdk = require("../cardkit");
const kit = require("node:module").createRequire(
  require.resolve("../cardkit/package.json"),
);
const { FakeCard } = kit("@cashu-card/cardkit/testing");
const pins = require("./pixel-07297620-create.json");
const { labPath, labSkip } = require("./lab-present.cjs");
const RETAINED_LOAD = labPath(
  "qualification-phases-2026-10-31",
  "image",
  "load-file.bin",
);
const {
  runCreation,
  verifyRegistry,
  resumeJournal,
} = require("./pixel-07297620-create.js");
const b = (s) => [...Buffer.from(s, "hex")],
  hash = (a) => createHash("sha256").update(Buffer.from(a)).digest("hex");
function syntheticLoad() {
  const component = (tag, data) => [
      tag,
      data.length >> 8,
      data.length & 255,
      ...data,
    ],
    aid = b(pins.package);
  const header = component(1, [...Array(9).fill(0), aid.length, ...aid]);
  const applets = component(3, [
    2,
    ...["4D", "01"].flatMap((s) => {
      const a = b(pins.package + s);
      return [a.length, ...a, 0, 0];
    }),
  ]);
  const filler = component(
    2,
    Array(pins.bytes - 4 - header.length - applets.length - 3).fill(0),
  );
  const body = [...header, ...applets, ...filler];
  return [0xc4, 0x82, body.length >> 8, body.length & 255, ...body];
}
function fixture(o = {}) {
  const card = new FakeCard(o.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {}),
    sent = [],
    saved = [];
  let clock = 0,
    cancelled = false,
    selected = false;
  const tx = async (a) => {
    sent.push([...a]);
    let r = await card.transceive(a);
    if (a[1] === 0xca && !o.wrongChip) r = [...b(pins.cplc), 0x90, 0];
    if (
      a[1] === 0xf2 &&
      [0x9000, 0x6a88].includes((r.at(-2) << 8) | r.at(-1))
    ) {
      let data =
        a[2] === 0x40
          ? card.instances.size === 2
            ? pins.installedPrivatePages[0].data
            : ""
          : pins.baselinePages[1].data +
            (card.packages.has(pins.package)
              ? pins.installedPrivatePages[1].data
              : "");
      if (o.unknown && a[2] === 0x20) data += "e30a4f0501020304059f700101";
      if (o.retainedInstance && card.instances.size === 2 && a[2] === 0x40)
        data += "e30a4f0501020304059f700101";
      r = data ? [...b(data), 0x90, 0] : [0x6a, 0x88];
    }
    if (
      a[1] === 0xa4 &&
      Buffer.from(a.slice(5, -1)).toString("hex").toUpperCase() ===
        pins.package + "01" &&
      card.instances.has(pins.package + "01")
    ) {
      selected = true;
      r = [...Buffer.from("CPROT\x02"), 0x90, 0];
    }
    if (a[0] === 0xb0 && a[1] === 0x7d && selected)
      r = [
        ...b(
          o.badDiagnostic
            ? "7fff0a0e0a0014001400000000000105"
            : "7fff0a0e0a0014001400000000000005",
        ),
        0x90,
        0,
      ];
    if (a[0] === 0xb0 && a[1] === 0x7a)
      r = [
        ...b(
          o.badKey
            ? "02" + "00".repeat(32)
            : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        ),
        0x90,
        0,
      ];
    if (o.loseOpener && card.instances.size === 1)
      throw Error("private native");
    return r;
  };
  const args = {
    sdk,
    load: syntheticLoad(),
    hash: () => pins.load,
    random: (n) => Array.from({ length: n }, (_, i) => i),
    tx,
    save: async (s) => {
      saved.push(structuredClone(s));
      if (o.storage && s.stage === o.storage) throw Error("storage");
      if (o.expire && s.stage === "install-for-load") clock = 120001;
    },
    now: () => clock,
    cancelled: () => cancelled,
    validateKey: (key) => key[0] === 2 && key.some((v, i) => i > 0 && v !== 0),
    limits: {
      platform: "android",
      androidTimeoutMs: 15000,
      maxTransceive: 261,
    },
  };
  return { card, sent, saved, args, cancel: () => (cancelled = true) };
}
module.exports = { fixture, syntheticLoad };
test("dedicated creation profile installs opener/main, verifies four baseline files and leaves a new unset-up key", async () => {
  const f = fixture(),
    r = await runCreation(f.args);
  assert.equal(r.status, "installed-unset-up", JSON.stringify(r));
  assert.equal(r.commands, 131);
  assert.equal(r.creationVerified, true);
  assert.equal(r.installedRegistryVerified, true);
  assert.equal(r.finalIdentityVerified, true);
  assert.equal(r.blankBaselineVerified, false);
  assert.equal(r.factoryVersionVerified, 1);
  assert.deepEqual(f.card.instanceAids(), [
    pins.package + "4D",
    pins.package + "01",
  ]);
  assert.equal(f.sent.filter((a) => a[1] === 0x50).length, 1);
  assert.equal(f.sent.filter((a) => a[1] === 0xe8).length, 114);
  assert.equal(f.sent.filter((a) => a[1] === 0xe6).length, 3);
  assert.ok(
    !f.sent.some((a) => [0xe4, 0xd8, 0x7e, 0x71, 0x74, 0x77].includes(a[1])),
  );
  assert.ok(
    r.exchanges
      .filter((e) => ["8050", "8482"].includes(e.header.slice(0, 4)))
      .every((e) => e.data === undefined),
  );
});
test("wrong chip/keys/baseline, image or native limits stop before loading", async () => {
  for (const o of [
    { wrongChip: true },
    { wrongKeys: true },
    { unknown: true },
  ]) {
    const f = fixture(o),
      r = await runCreation(f.args);
    assert.equal(r.status, "stopped");
    assert.ok(!f.sent.some((a) => a[1] === 0xe8));
    if (o.wrongKeys) assert.ok(!f.sent.some((a) => a[1] === 0x82));
  }
  for (const override of [
    { hash: () => "0".repeat(64) },
    {
      limits: {
        platform: "android",
        androidTimeoutMs: 618,
        maxTransceive: 261,
      },
    },
  ]) {
    const f = fixture(),
      r = await runCreation({ ...f.args, ...override });
    assert.equal(r.status, "stopped");
    assert.equal(f.sent.length, 0);
  }
});
test("unknown installed objects, diagnostics, key and unconfirmed creation never trigger cleanup/retry", async () => {
  for (const o of [
    { retainedInstance: true },
    { badDiagnostic: true },
    { badKey: true },
    { loseOpener: true },
    { storage: "load-1-of-114" },
    { expire: true },
  ]) {
    const f = fixture(o),
      r = await runCreation(f.args);
    assert.equal(r.status, "stopped", JSON.stringify(o));
    assert.equal(r.creationVerified, undefined);
    assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    assert.ok(f.sent.filter((a) => a[1] === 0xe8).length <= 114);
    assert.equal(f.sent.filter((a) => a[1] === 0x50).length, 1);
  }
});
test("consumed/unreadable UI journal never becomes a fresh start and registry requires both complete kinds", () => {
  assert.equal(resumeJournal(null), null);
  assert.equal(resumeJournal("{").status, "stopped");
  assert.equal(
    resumeJournal(
      JSON.stringify({
        plan: pins.plan,
        status: "installed-unset-up",
        stage: "installed-unset-up",
      }),
    ).status,
    "installed-unset-up",
  );
  assert.equal(
    resumeJournal(JSON.stringify({ plan: "other", status: "running" })).status,
    "stopped",
  );
  assert.throws(() =>
    verifyRegistry(
      sdk,
      [{ kind: "applications", data: "", sw: "6a88" }],
      false,
    ),
  );
});
test(
  "the exact pinned candidate runs through real fake-card SCP02 when the retained image is present",
  {
    skip: labSkip(RETAINED_LOAD),
  },
  async () => {
    const f = fixture(),
      load = [...fs.readFileSync(RETAINED_LOAD)];
    assert.equal(hash(load), pins.load);
    const r = await runCreation({ ...f.args, load, hash });
    assert.equal(r.status, "installed-unset-up", JSON.stringify(r));
  },
);
test("lost replies at authentication, load boundaries, creation and final verification stop at that command", async () => {
  for (const offset of [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
    131,
  ]) {
    const f = fixture();
    let calls = 0;
    const r = await runCreation({
      ...f.args,
      tx: async (a) => {
        const reply = await f.args.tx(a);
        if (++calls === offset) throw Error("unconfirmed native reply");
        return reply;
      },
    });
    assert.equal(r.status, "stopped", String(offset));
    assert.equal(calls, offset);
    assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    assert.equal(r.creationVerified, undefined);
  }
});
