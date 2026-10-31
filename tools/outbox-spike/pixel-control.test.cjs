const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PINS,
  PRIVATE,
  runCreation,
  resumeJournal,
  stoppedSession,
} = require("./pixel-control.js");
const { fixture, sha, hex, sdk } = require("./pixel-test-support.cjs");

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
test("missing/clamped timeout or inadequate frame size stops before every APDU", async () => {
  for (const limits of [
    undefined,
    { platform: "android", androidTimeoutMs: 618, maxTransceive: 261 },
    { platform: "android", androidTimeoutMs: 15000, maxTransceive: 247 },
  ]) {
    const f = fixture();
    f.args.limits = limits;
    const r = await runCreation(f.args);
    assert.equal(r.failure, "nfc-limits-unconfirmed");
    assert.equal(f.sent.length, 0);
  }
});
test("relaunch restores consumed states and malformed saved data cannot rearm", () => {
  assert.equal(resumeJournal(null), null);
  for (const status of ["armed", "running", "stopped", "complete"]) {
    const record = { plan: PINS.plan, stage: "saved", status };
    assert.deepEqual(resumeJournal(JSON.stringify(record)), record);
  }
  for (const data of ["null", "{}", "{", "[]", '""']) {
    assert.equal(resumeJournal(data).status, "stopped");
  }
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

test("a failed native call retains its bounded category and elapsed envelope without retry", async () => {
  for (const [message, category] of [
    ["cashucard-lab:tag-lost", "android-tag-lost"],
    ["cashucard-lab:io", "android-io"],
    ["cashucard-lab:security", "android-security"],
    ["cashucard-lab:state", "android-illegal-state"],
    ["cashucard-lab:other", "android-other"],
    ["no tech request available", "android-no-tech-request"],
    ["transceive fail", "android-transceive-failed"],
    ["Card session cancelled", "session-cancelled"],
    ["PRIVATE KEY OR APDU", "unclassified"],
    ["cashucard-lab:tag-lost PRIVATE", "unclassified"],
  ]) {
    const f = fixture();
    let clock = 0,
      calls = 0;
    f.args.now = () => clock;
    f.args.save = async (record) => {
      clock += 29;
      f.records.push(record);
    };
    f.args.tx = async () => {
      calls++;
      clock += 1234;
      throw new Error(message);
    };
    const result = await runCreation(f.args);
    assert.equal(result.failure, "transport-uncertain");
    assert.deepEqual(result.failedExchange, {
      command: 1,
      stage: "match-chip",
      category,
      elapsedMs: 1234,
    });
    assert.deepEqual(f.records.at(-1).failedExchange, result.failedExchange);
    assert.equal(calls, 1);
    assert.equal(result.reply, null);
    assert.ok(!JSON.stringify(result).includes(message), message);
  }
});

test("short native reply retains failure timing; an intent-save failure never reports a native call", async () => {
  const f = fixture();
  let clock = 0;
  f.args.now = () => clock;
  f.args.tx = async () => {
    clock += 73;
    return [0x90];
  };
  const r = await runCreation(f.args);
  assert.equal(r.failedExchange.category, "short-reply");
  assert.equal(r.failedExchange.elapsedMs, 73);
  assert.equal(r.commands, 1);
  const denied = fixture();
  denied.args.save = async () => {
    throw Error("PRIVATE STORAGE ERROR");
  };
  const stopped = await runCreation(denied.args);
  assert.equal(stopped.failure, "journal-unavailable");
  assert.equal(stopped.failedExchange, undefined);
  assert.equal(denied.sent.length, 0);
});

test("session finalization preserves an earlier stopped result and consumed journal", () => {
  const original = {
    plan: PINS.plan,
    status: "stopped",
    stage: "capacity-proof-85",
    failure: "transport-uncertain",
    commands: 222,
    failedExchange: { category: "android-io", elapsedMs: 450, command: 222 },
  };
  const result = stoppedSession(original);
  assert.equal(result.failure, "transport-uncertain");
  assert.deepEqual(result.failedExchange, original.failedExchange);
  assert.equal(result.sessionTeardownRequested, true);
  assert.deepEqual(resumeJournal(JSON.stringify(result)), result);
  assert.equal(
    stoppedSession({ status: "armed" }).failure,
    "nfc-or-journal-stopped",
  );
});

test("native and persistence envelopes are separate and persisted save counters are explicitly lagged", async () => {
  const f = fixture();
  let clock = 0;
  const tx = f.args.tx,
    save = f.args.save;
  f.args.now = () => clock;
  f.args.tx = async (a) => {
    const r = await tx(a);
    clock += 7;
    return r;
  };
  f.args.save = async (v) => {
    await save(v);
    clock += 3;
  };
  const r = await runCreation(f.args);
  assert.equal(r.status, "complete");
  assert.equal(r.telemetry.nativeCalls, f.sent.length);
  assert.equal(r.telemetry.nativeMs, f.sent.length * 7);
  assert.equal(r.telemetry.persistCalls, f.records.length);
  assert.equal(r.telemetry.persistMs, f.records.length * 3);
  assert.equal(
    f.records.at(-1).telemetry.persistCalls,
    r.telemetry.persistCalls - 1,
  );
  assert.equal(r.telemetry.accounting, "completed-saves-before-this-snapshot");
  assert.ok(f.records.every((v) => !v.lastExchange?.receivedSignScope));
  assert.ok(!JSON.stringify(r).includes("PRIVATE RAW"));
});
