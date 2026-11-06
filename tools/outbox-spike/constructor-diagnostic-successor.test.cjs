const test = require("node:test"),
  assert = require("node:assert/strict");
const { fixture } = require("./constructor-diagnostic-test-support.cjs");
const { runDiagnostic } = require("./constructor-diagnostic-07297620.cjs");
const { labPath, labSkip } = require("./lab-present.cjs");
test("fresh constructor invocation has its own plan label and unchanged exact program", async () => {
  const f = fixture(),
    r = await runDiagnostic({
      ...f.args,
      planId: "constructor-trace-07297620-v2",
    });
  assert.equal(r.status, "diagnostic-recorded");
  assert.equal(r.plan, "constructor-trace-07297620-v2");
  assert.equal(r.commands, 100);
  assert.ok(f.saved.every((s) => s.plan === "constructor-trace-07297620-v2"));
});
test("unknown constructor successor refuses before transmitting", async () => {
  const f = fixture();
  await assert.rejects(
    runDiagnostic({ ...f.args, planId: "constructor-trace-07297620-v3" }),
  );
  assert.equal(f.sent.length, 0);
});
test("successor preserves the card, image, old consumption and separate paths", () => {
  const { isDeepStrictEqual } = require("node:util");
  const old = require("./constructor-trace-07297620.json"),
    next = require("./constructor-trace-07297620-v2.json");
  for (const [k, v] of Object.entries(old))
    if (!["planId", "approved", "auditSha256"].includes(k))
      assert.ok(isDeepStrictEqual(v, next[k]), k);
  assert.notEqual(
    require("./constructor-diagnostic-07297620.cjs").JOURNAL,
    require("./constructor-diagnostic-07297620-v2.cjs").JOURNAL,
  );
});
const DIAGNOSTIC = labPath(
  "constructor-trace-07297620-2026-11-05",
  "pass-1",
  "diagnostic.json",
);
test(
  "the retained first-pass diagnostic is unchanged",
  { skip: labSkip(DIAGNOSTIC) },
  () => {
    const { sha } = require("./constructor-trace.cjs");
    assert.equal(
      sha(require("node:fs").readFileSync(DIAGNOSTIC)),
      "e397f252c9c23499cf2aed0289fcacc655269d9be57a59010def0af3fac151ca",
    );
  },
);
