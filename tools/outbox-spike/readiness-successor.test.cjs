const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  { createHash } = require("node:crypto");
const { fixture } = require("./readiness-test-support.cjs");
const { qualifyBlank } = require("./readiness-07297620.cjs");
test("post-reset readiness carries its own plan identity through every receipt", async () => {
  const f = fixture(),
    r = await qualifyBlank({ ...f.args, planId: "readiness-07297620-v2" });
  assert.equal(r.status, "ready");
  assert.equal(r.plan, "readiness-07297620-v2");
  assert.ok(f.saved.every((s) => s.plan === "readiness-07297620-v2"));
  assert.equal(r.commands, 9);
});
test("unknown successor does not admit commands or inherit authority", async () => {
  const f = fixture();
  await assert.rejects(
    qualifyBlank({ ...f.args, planId: "readiness-07297620-v3" }),
  );
  assert.equal(f.sent.length, 0);
});
test("successor preserves the original profile, consumed journal and distinct fixed paths", () => {
  const old = require("./readiness-07297620.cjs"),
    next = require("./readiness-07297620-v2.cjs");
  assert.notEqual(old.JOURNAL, next.JOURNAL);
  assert.equal(
    require("./readiness-07297620.json").planId,
    "readiness-07297620-v1",
  );
  const p =
    "/Users/dread/.cashucard/readiness-07297620-2026-11-04/pass-1/readiness.json";
  // Local retained evidence is optional in CI; if present it must remain immutable.
  if (fs.existsSync(p))
    assert.equal(
      createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
      "9cbef5cac558c2ce871bfdcc38d76ea33f5b3f6b8af5fb6f002f414b5285b4b1",
    );
});
