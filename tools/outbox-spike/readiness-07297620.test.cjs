const test = require("node:test"),
  assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const sdk = require("../cardkit"),
  kit = createRequire(require.resolve("../cardkit/package.json"));
const { FakeCard } = kit("@cashu-card/cardkit/testing");
const audit = require("../../docs/reports/PLAN_2026-11-04.adopt-07297620.audit.json");
const { qualifyBlank, verifyBlank } = require("./readiness-07297620.cjs");
const { fixture } = require("./readiness-test-support.cjs");

test("07297620 readiness uses exactly one proved channel, four baseline files and nine read/auth commands", async () => {
  const f = fixture(),
    r = await qualifyBlank(f.args);
  assert.equal(r.status, "ready", JSON.stringify(r));
  assert.equal(r.blankBaselineVerified, true);
  assert.equal(r.commands, 9);
  assert.equal(f.closes, 1);
  assert.deepEqual(
    f.sent.map((a) => a[1]),
    [0xa4, 0xca, 0xa4, 0x50, 0x82, 0xf2, 0xf2, 0xa4, 0xca],
  );
  assert.equal(r.pages.length, 2);
  assert.equal(r.independentPolicyComplete, true);
  assert.equal(r.savedEvidenceVerified, true);
  assert.ok(
    r.exchanges
      .filter((e) => [0x50, 0x82].includes(parseInt(e.header.slice(2, 4), 16)))
      .every((e) => e.data === undefined),
  );
  const check = JSON.parse(
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        "import sys,json;sys.path.insert(0,sys.argv[1]);from readiness_07297620 import Policy;p=Policy();v=json.load(sys.stdin);[(p.before(e['apdu']),p.after(bytes(e['apdu']),e['reply'][:-2],*e['reply'][-2:])) for e in v];print(json.dumps({'complete':p.complete}))",
        __dirname,
      ],
      { input: JSON.stringify(f.exchanges), encoding: "utf8" },
    ),
  );
  assert.equal(check.complete, true);
});
test("wrong card, keys, applications and incomplete baseline stop without retry or write", async () => {
  for (const o of [
    { wrongChip: true },
    { wrongKeys: true },
    { extra: true },
    { missing: true },
  ]) {
    const f = fixture(o),
      r = await qualifyBlank(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(r.blankBaselineVerified, false);
    assert.equal(f.closes, 1);
    assert.ok(!f.sent.some((a) => [0xe4, 0xe6, 0xe8, 0xd8].includes(a[1])));
    if (o.wrongKeys) assert.ok(!f.sent.some((a) => a[1] === 0x82));
    if (o.wrongChip) assert.equal(f.sent.length, 2);
  }
});
test("every lost reply, refused status, storage failure, independent disagreement and uncertain close stop", async () => {
  for (let offset = 1; offset <= 9; offset++)
    for (const mode of ["lost", "status"]) {
      const f = fixture();
      let calls = 0;
      const r = await qualifyBlank({
        ...f.args,
        tx: async (a) => {
          const r = await f.args.tx(a);
          if (++calls === offset) {
            if (mode === "lost") throw Error("native");
            return [0x6f, 0];
          }
          return r;
        },
      });
      assert.equal(r.status, "stopped");
      assert.equal(r.blankBaselineVerified, false);
      assert.equal(calls, offset);
      assert.equal(f.closes, 1);
    }
  for (const overrides of [
    {
      close: async () => {
        throw Error("close");
      },
    },
    { close: async () => ({ policyComplete: false }) },
    {
      verifyEvidence: async () => {
        throw Error("changed");
      },
    },
  ]) {
    const f = fixture(),
      r = await qualifyBlank({ ...f.args, ...overrides });
    assert.equal(r.status, "stopped");
    assert.equal(r.blankBaselineVerified, false);
  }
  const f = fixture({ storage: "factory-authentication" }),
    r = await qualifyBlank(f.args);
  assert.equal(r.failure, "journal-unavailable");
  assert.equal(f.sent.length, 2);
  const timed = fixture();
  const t = await qualifyBlank({
    ...timed.args,
    save: async () => {
      timed.advance(120001);
    },
  });
  assert.equal(t.failure, "elapsed-bound");
  assert.equal(timed.sent.length, 0);
});
test("applications-only evidence and the other card baseline cannot qualify readiness", () => {
  assert.throws(() =>
    verifyBlank(sdk, [{ kind: "applications", data: "", sw: "6a88" }]),
  );
  const wrong = require("./unset-up-profile.json").registry.map((p) => ({
    ...p,
  }));
  assert.throws(() => verifyBlank(sdk, wrong));
  assert.doesNotThrow(() =>
    verifyBlank(sdk, audit.lastKnownBlank.registry.pages),
  );
});
