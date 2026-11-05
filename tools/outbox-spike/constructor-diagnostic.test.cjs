const test = require("node:test"),
  assert = require("node:assert/strict");
const sdk = require("../cardkit"),
  { createRequire } = require("node:module");
const kit = createRequire(require.resolve("../cardkit/package.json")),
  { FakeCard } = kit("@cashu-card/cardkit/testing");
const p = require("./constructor-trace-07297620.json");
const {
  runDiagnostic,
  verifyRegistry,
  admit,
} = require("./constructor-diagnostic-07297620.cjs");
const { sha } = require("./constructor-trace.cjs");
const { fixture } = require("./constructor-diagnostic-test-support.cjs");

for (const fault of [false, true])
  test(`diagnostic records ${fault ? "caught fault" : "complete constructor"} without payment operations`, async () => {
    const f = fixture({ fault }),
      r = await runDiagnostic(f.args);
    assert.equal(r.status, "diagnostic-recorded");
    assert.equal(
      r.constructorResult.outcome,
      fault ? "caught-constructor-fault" : "constructor-complete",
    );
    assert.equal(r.commands, p.blocks + 16);
    assert.equal(f.closed, 1);
    assert.equal(f.sent.filter((a) => a[1] === 0xe8).length, p.blocks);
    assert.ok(f.sent.every((a) => ![0xe4, 0xd8].includes(a[1])));
    assert.ok(f.sent.filter((a) => a[0] === 0xb0).every((a) => a[1] === 0x7d));
    assert.equal(f.sent.filter((a) => a[1] === 0x50).length, 1);
  });
for (const o of [
  { wrongChip: true },
  { wrongKeys: true },
  { changedBaseline: true },
  { mute: true },
  { badDiagnostic: true },
  { close: true },
  { policyIncomplete: true },
  { evidence: true },
  { storage: "match-chip" },
])
  test(`diagnostic stops conservatively ${JSON.stringify(o)}`, async () => {
    const f = fixture(o),
      r = await runDiagnostic(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(f.closed, 1);
    assert.ok(!JSON.stringify(r).includes("native private"));
    if (o.wrongChip) assert.equal(r.commands, 2);
    if (o.wrongKeys) assert.equal(r.commands, 4);
    if (o.changedBaseline)
      assert.equal(f.sent.filter((a) => [0xe6, 0xe8].includes(a[1])).length, 0);
    if (o.mute) {
      const last = r.exchanges.at(-1);
      assert.equal(last.sw, null);
      assert.equal(typeof last.elapsedMs, "number");
      assert.equal(last.transportFailure, "transport-uncertain");
      assert.equal(r.stage, "create-main");
      assert.equal(f.sent.filter((a) => a[0] === 0xb0).length, 0);
    }
  });
test("default approval refuses before campaign access and crossed old baseline fails", () => {
  const old = p.approved;
  p.approved = false;
  try {
    assert.throws(
      () => admit({ execute: true, campaign: "/never-read" }),
      /execution approval required/,
    );
  } finally {
    p.approved = old;
  }
  const pages = structuredClone(p.initialPages);
  assert.equal(verifyRegistry(sdk, pages, false), true);
  pages[0].data += p.addedPages[0].data;
  assert.throws(() => verifyRegistry(sdk, pages, false));
});
test("saved intent digests bind every public command without retaining authentication or MACs", async () => {
  const f = fixture(),
    r = await runDiagnostic(f.args);
  assert.equal(r.status, "diagnostic-recorded");
  for (const [i, a] of f.sent.entries()) {
    const e = r.exchanges[i];
    if ([0x50, 0x82].includes(a[1])) {
      assert.ok(!("intentSha256" in e));
      assert.ok(!("data" in e));
      continue;
    }
    const plain =
      a[0] === 0x84
        ? [0x80, ...a.slice(1, 4), a[4] - 8, ...a.slice(5, -9), 0]
        : a;
    assert.equal(e.intentSha256, sha(Buffer.from(plain)));
  }
});
