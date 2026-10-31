const test = require("node:test"),
  assert = require("node:assert/strict");
const { createLabJournal } = require("./lab-journal.js");
test("every durable barrier is written while repeated running-stage renders are coalesced", async () => {
  const writes = [],
    shown = [];
  const save = createLabJournal({
    write: async (raw) => writes.push(JSON.parse(raw)),
    present: (v) => shown.push(v),
  });
  for (const [stage, command] of [
    ["load", 1],
    ["load", 1],
    ["load", 1],
    ["next", 2],
  ])
    await save({ status: "running", stage, command });
  assert.equal(writes.length, 4);
  assert.deepEqual(
    shown.map((v) => v.stage),
    ["load", "next"],
  );
  await save({ status: "stopped", stage: "next", failure: "elapsed-bound" });
  await save({ status: "stopped", stage: "next", stamps: { done: 10 } });
  assert.equal(writes.length, 6);
  assert.deepEqual(shown.at(-1).stamps, { done: 10 });
});
test("failed storage does not present or consume the next stage", async () => {
  let fail = true;
  const shown = [];
  const save = createLabJournal({
    write: async () => {
      if (fail) throw Error("fake unavailable storage");
    },
    present: (v) => shown.push(v),
  });
  await assert.rejects(save({ status: "running", stage: "sign" }));
  assert.equal(shown.length, 0);
  fail = false;
  await save({ status: "running", stage: "sign" });
  assert.equal(shown.length, 1);
});
