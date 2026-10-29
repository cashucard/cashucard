const test = require("node:test");
const assert = require("node:assert/strict");
const { workload } = require("./compact-workload.cjs");
const MAX = "128-input-128-output-v1";
test("fixed maximum workload loads all slots, chunks outputs and exports every byte", () => {
  const w = workload(MAX);
  assert.equal(w.loads.length, 128);
  assert.equal(w.outputPages.length, 22);
  assert.equal(w.packetBytes, 23163);
  assert.equal(w.pages.length, 91);
  assert.equal(w.stagedCounts.at(-1), 128);
  assert.deepEqual(w.consumedStatus, [63, 45, 0, 128, 0, 0]);
  for (const a of [
    w.setup,
    ...w.keysets,
    ...w.loads,
    w.begin,
    ...w.outputPages,
    ...w.pages,
  ]) {
    assert.ok(a.length <= 261);
    assert.equal(a.length, a[4] + 6);
  }
});
test("unknown workloads fail instead of silently choosing the small fixture", () => {
  assert.throws(() => workload("arbitrary"));
  assert.throws(() => workload({}));
});
