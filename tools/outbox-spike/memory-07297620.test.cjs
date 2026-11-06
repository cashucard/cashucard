const test = require("node:test"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const sdk = require("../cardkit");
const profile = require("./pixel-07297620-create.json");
const { snapshot, admit, JOURNAL } = require("./memory-07297620.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const { fixture, expected } = require("./memory-test-support.cjs");
test("snapshot is exactly five read-only commands with independently decoded public counters", async () => {
  const f = fixture(),
    r = await snapshot(f.args);
  assert.equal(r.status, "measured");
  assert.equal(r.commands, 5);
  assert.equal(r.memory.persistentBytes, 119940);
  assert.equal(r.memory.volatileBytes, 3750);
  assert.equal(r.readerClosed, true);
  assert.equal(f.closed, 1);
  assert.deepEqual(f.sent, expected);
});
for (const option of [
  "save",
  "wrong",
  "badMemory",
  "lost",
  "status",
  "close",
  "evidence",
])
  test(`snapshot stops and closes without retry: ${option}`, async () => {
    const f = fixture({ [option]: true }),
      r = await snapshot(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(f.closed, 1);
    assert.ok(!JSON.stringify(r).includes("native private"));
    assert.ok(f.sent.length <= 5);
    if (option === "save") assert.equal(f.sent.length, 0);
  });
test("unapproved snapshot rejects before reading any campaign", () => {
  const p = require("./memory-07297620.json"),
    prior = p.approved;
  p.approved = false;
  try {
    assert.throws(
      () => admit({ execute: true, campaign: "/nonexistent" }),
      /execution approval required/,
    );
  } finally {
    p.approved = prior;
  }
  assert.notEqual(JOURNAL, require("./inspect-07297620.cjs").JOURNAL);
});
test("independent saved-evidence replay rejects altered counters and forbidden command headers", async (t) => {
  const f = fixture();
  await snapshot(f.args);
  const v = f.saved.findLast((s) => s.stage === "verify-saved-evidence");
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "memory-saved-")),
  );
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [i, change] of [
    (v) => {},
    (v) => v.memory.persistentBytes++,
    (v) => (v.exchanges[2].header = "80e40000"),
    (v) => (v.exchanges[4].data = "00"),
  ].entries()) {
    const copy = structuredClone(v);
    change(copy);
    const file = path.join(dir, `${i}.json`),
      sha = createPrivate(file, copy);
    const run = () =>
      JSON.parse(
        execFileSync(
          "python3",
          [
            "-I",
            "-S",
            "-B",
            path.join(__dirname, "memory_07297620.py"),
            "--verify-journal",
            file,
            "--sha256",
            sha,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
    if (i) assert.throws(run);
    else assert.equal(run().savedEvidenceVerified, true);
  }
});
test("malformed public memory response has a bounded format failure", async () => {
  const f = fixture({ badMemory: true }),
    r = await snapshot(f.args);
  assert.equal(r.failure, "platform-memory-format");
  assert.equal(r.commands, 3);
});
