const test = require("node:test"),
  assert = require("node:assert/strict");
const sdk = require("../cardkit");
const profile = require("./unset-up-profile.json");
const {
  cleanupUnsetUp,
  verifyUnsetRegistry,
} = require("./unset-up-recovery.cjs");
const { fixture } = require("./unset-up-test-support.cjs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
test("unset-up cleanup verifies both registry kinds, deletes main/opener/package once and confirms close", async () => {
  const f = fixture(),
    r = await cleanupUnsetUp(f.args);
  assert.equal(r.status, "complete");
  assert.equal(r.blankBaselineVerified, true);
  assert.deepEqual(r.deleted, profile.deletionAids);
  assert.equal(f.card.packages.size, 0);
  assert.equal(f.card.instances.size, 0);
  assert.equal(f.auths, 2);
  assert.equal(f.closes, 1);
  assert.equal(r.commands, 24);
  assert.equal(r.registrySnapshots.length, 3);
  assert.ok(
    r.registrySnapshots.every(
      (s) =>
        s.verified &&
        s.pages.some((p) => p.kind === "applications") &&
        s.pages.some((p) => p.kind === "load-files"),
    ),
  );
  assert.ok(
    !f.sent.some(
      (a) => a[0] === 0xb0 && [0x76, 0x7c, 0x74, 0x77, 0x7e].includes(a[1]),
    ),
  );
  assert.ok(
    f.snapshots
      .filter((s) => s.stage.startsWith("delete-"))
      .every((s) => s.registrySnapshots[1].verified),
  );
  assert.ok(!JSON.stringify(r).includes("private native text"));
  for (const e of r.exchanges.filter((e) =>
    ["8050", "8482"].some((p) => e.header.startsWith(p)),
  ))
    assert.equal(e.data, undefined);
  const checked = JSON.parse(
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        "import sys,json;sys.path.insert(0,sys.argv[1]);from unset_up_policy import UnsetUpPolicy;p=UnsetUpPolicy();v=json.load(sys.stdin);[(p.before(e['apdu']),p.after(bytes(e['apdu']),e['reply'][:-2],*e['reply'][-2:])) for e in v];print(json.dumps({'complete':p.complete,'commands':p.total}))",
        __dirname,
      ],
      { input: JSON.stringify(f.exchanges), encoding: "utf8" },
    ),
  );
  assert.deepEqual(checked, { complete: true, commands: r.commands });
});

test("independent unset-up policy suite imports no PC/SC implementation", () => {
  execFileSync(
    "python3",
    ["-B", path.join(__dirname, "test_unset_up_policy.py")],
    { stdio: "pipe" },
  );
});
test("unknown key/chip, setup state one/two and changed registry stop before deletion", async () => {
  for (const options of [
    { wrongChip: true },
    { key: "02" + "11".repeat(32) },
    { diagnostics: "7fff0a0e0a0014001400000000000105" },
    { diagnostics: "7fff0a0e0a0014001400400030000205" },
    { extraLoad: true },
    { wrongKeys: true },
  ]) {
    const f = fixture(options),
      r = await cleanupUnsetUp(f.args);
    assert.equal(r.status, "stopped", JSON.stringify(options));
    assert.equal(r.blankBaselineVerified, false);
    assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    assert.equal(f.closes, 1);
    if (options.wrongKeys) assert.ok(!f.sent.some((a) => a[1] === 0x82));
  }
});
test("lost deletion reply and close failure cannot become blank or authorize retry", async () => {
  const f = fixture({ failDelete: true }),
    r = await cleanupUnsetUp(f.args);
  assert.equal(r.status, "stopped");
  assert.equal(r.blankBaselineVerified, false);
  assert.equal(f.sent.filter((a) => a[1] === 0xe4).length, 1);
  assert.equal(f.closes, 1);
  const closed = fixture({ closeFailure: true }),
    c = await cleanupUnsetUp(closed.args);
  assert.equal(c.failure, "reader-close-uncertain");
  assert.equal(c.blankBaselineVerified, false);
});
test("failed intent persistence and elapsed gate stop before another transmission", async () => {
  const f = fixture({ failSaveAt: "delete-" + profile.deletionAids[0] }),
    r = await cleanupUnsetUp(f.args);
  assert.equal(r.failure, "journal-unavailable");
  assert.ok(!f.sent.some((a) => a[1] === 0xe4));
  const timed = fixture();
  let writes = 0;
  const save = timed.args.save;
  const t = await cleanupUnsetUp({
    ...timed.args,
    save: async (s) => {
      await save(s);
      if (++writes === 3) timed.advance(120001);
    },
  });
  assert.equal(t.failure, "elapsed-bound");
  assert.ok(timed.sent.length < 3);
});
test("an empty application listing alone or a retained package never proves blank", () => {
  const pages = profile.registry.map((p) => ({ ...p }));
  assert.throws(() =>
    verifyUnsetRegistry(
      sdk,
      [{ kind: "applications", data: "", sw: "9000" }],
      true,
    ),
  );
  assert.throws(() =>
    verifyUnsetRegistry(
      sdk,
      [{ kind: "applications", data: "", sw: "6a88" }, pages[1]],
      true,
    ),
  );
  assert.doesNotThrow(() =>
    verifyUnsetRegistry(
      sdk,
      [
        { kind: "applications", data: "", sw: "6a88" },
        {
          kind: "load-files",
          data: pages[1].data.slice(0, pages[1].data.lastIndexOf("e31e")),
          sw: "9000",
        },
      ],
      true,
    ),
  );
});
test("every lost reply or card refusal stops at that command without retry", async () => {
  const success = fixture();
  const good = await cleanupUnsetUp(success.args);
  for (let position = 1; position <= good.commands; position++)
    for (const fault of ["lost", "status"]) {
      const f = fixture();
      let sent = 0;
      const r = await cleanupUnsetUp({
        ...f.args,
        tx: async (a) => {
          const reply = await f.args.tx(a);
          if (++sent === position) {
            if (fault === "lost") throw Error("native private");
            return [0x6f, 0];
          }
          return reply;
        },
      });
      assert.equal(r.status, "stopped", `${position}/${fault}`);
      assert.equal(r.blankBaselineVerified, false);
      assert.equal(sent, position);
      assert.equal(f.closes, 1);
    }
});
test("paged unordered registries are verified completely; a fifth page stops before deletion", async () => {
  for (const endless of [false, true]) {
    const f = fixture(),
      pending = new Map();
    const r = await cleanupUnsetUp({
      ...f.args,
      tx: async (a) => {
        const reply = await f.args.tx(a);
        if (a[1] !== 0xf2) return reply;
        const key = a[2];
        if (a[3] === 2) {
          const raw = reply.slice(0, -2);
          if (!raw.length) return reply;
          pending.set(key, raw.slice(13));
          return [...raw.slice(0, 13), 0x63, 0x10];
        }
        const rest = pending.get(key);
        assert.ok(rest);
        pending.delete(key);
        if (endless) {
          pending.set(key, rest);
          return [0xe3, 0x63, 0x10];
        }
        return [...rest, 0x90, 0];
      },
    });
    assert.equal(r.status, endless ? "stopped" : "complete");
    if (endless) assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    else assert.ok(r.commands > 24);
  }
});

test("a failed independent saved-evidence check prevents blank success and still closes", async () => {
  const f = fixture();
  const r = await cleanupUnsetUp({
    ...f.args,
    verifyEvidence: async () => {
      throw Error("changed evidence");
    },
  });
  assert.equal(r.status, "stopped");
  assert.equal(r.failure, "saved-evidence-refused");
  assert.equal(r.blankBaselineVerified, false);
  assert.equal(f.closes, 1);
  assert.equal(f.sent.length, 24);
});
