const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  INSTALL_PINS,
  INSTALLED,
  resumeJournal,
  runPhaseInstall,
  fixture,
  sha,
  hex,
  sdk,
} = require("./pixel-test-support.cjs");
const streamed = require("./pixel-streamed.json");
const { PRIVATE } = require("./pixel-control.js");

// Installation-only profile: load the qualified image, create opener then main,
// stop after uninitialized format-5 diagnostics. No fixture SETUP, proof, SIGN,
// RETIRE or DELETE command may be sent.
const phases = (sent) => sent.map((apdu) => apdu[1]);

test("install pins match the qualified streamed image", () => {
  for (const k of ["chip", "package", "manifest", "cap", "load", "bytes"])
    assert.equal(INSTALL_PINS[k], streamed[k], k);
  assert.notEqual(INSTALL_PINS.plan, streamed.plan);
});

test("install profile creates opener then main and stops installed without setup, signing or cleanup", async () => {
  const f = fixture({ mode: "phase-install", pins: INSTALL_PINS });
  const r = await runPhaseInstall(f.args);
  assert.equal(r.failure, undefined);
  assert.equal(r.status, "installed-for-phases");
  assert.equal(r.stage, "installed-for-phases");
  assert.equal(r.factoryVersionVerified, 1);
  assert.equal(r.initialBaselineVerified, true);
  assert.equal(r.installedRegistryVerified, true);
  assert.equal(r.blankBaselineVerified, false);
  assert.match(r.cardKey, /^02[0-9a-f]{64}$/);
  assert.equal(r.diagnostics, "7fff0a0e0a0014001400000000000005");
  assert.deepEqual(f.card.instanceAids(), INSTALLED);
  const ins = phases(f.sent);
  // Only the platform handshake, LOAD, the two creations and public reads.
  assert.equal(ins.filter((v) => v === 0xe6).length, 3);
  assert.equal(ins.filter((v) => v === 0xe8).length, INSTALL_PINS.blocks);
  assert.equal(ins.filter((v) => v === 0x50).length, 1);
  assert.equal(ins.filter((v) => v === 0x82).length, 1);
  assert.equal(
    ins.filter((v) => v === 0x74 || v === 0x7e || v === 0x72 || v === 0x77)
      .length,
    0,
  );
  assert.equal(ins.filter((v) => v === 0xe4).length, 0);
  // Two creation commands, opener first, and the reads end the run.
  assert.equal(ins.filter((v) => v === 0xe6).length - 1, 2);
  assert.deepEqual(
    f.sent.slice(-2).map((a) => a.slice(0, 2)),
    [
      [0xb0, 0x7d],
      [0xb0, 0x7a],
    ],
  );
  const stages = f.records.filter((rec) => rec.status !== "running");
  assert.equal(stages.at(-1).stage, "installed-for-phases");
});

test("install profile stops before any setup, signing or deletion command", async () => {
  const f = fixture({ mode: "phase-install", pins: INSTALL_PINS });
  const r = await runPhaseInstall(f.args);
  assert.ok(r.commands <= 160);
  const ins = phases(f.sent);
  assert.ok(!ins.some((v) => [0x7e, 0x72, 0x74, 0x77, 0xe4].includes(v)));
  assert.equal(r.creationVerified, undefined);
});

test("wrong chip, keys or version stop the install profile before loading", async () => {
  for (const [flag, code] of [
    ["wrongChip", "wrong-chip"],
    ["wrongKeys", "factory-keys-not-proved"],
    ["wrongVersion", "factory-version-mismatch"],
  ]) {
    const f = fixture({
      mode: "phase-install",
      pins: INSTALL_PINS,
      [flag]: true,
    });
    const r = await runPhaseInstall(f.args);
    assert.equal(r.failure, code, flag);
    assert.equal(f.sent.filter((a) => a[1] === 0xe8).length, 0, flag);
    assert.equal(f.card.instanceAids().length, 0, flag);
  }
});

test("an unqualified initial baseline blocks LOAD and INSTALL", async () => {
  const f = fixture({
    mode: "phase-install",
    pins: INSTALL_PINS,
    unknownRegistry: true,
  });
  const r = await runPhaseInstall(f.args);
  assert.equal(r.failure, "registry-framing");
  assert.notEqual(r.initialBaselineVerified, true);
  assert.ok(!f.sent.some((a) => [0xe6, 0xe8, 0xe4].includes(a[1])));
});

test("a mismatched installed registry or bad diagnostics stops after creation without cleanup", async () => {
  for (const [options, code] of [
    [{ badDiagnostic: true }, "diagnostics-uninitialized"],
    [{ badKey: true }, "invalid-public-key"],
  ]) {
    const f = fixture({
      mode: "phase-install",
      pins: INSTALL_PINS,
      ...options,
    });
    const r = await runPhaseInstall(f.args);
    assert.equal(r.failure, code, Object.keys(options)[0]);
    assert.equal(r.installedRegistryVerified, true);
    assert.ok(!f.sent.some((a) => a[1] === 0xe4));
    assert.deepEqual(f.card.instanceAids(), INSTALLED);
  }
});

test("a foreign load-file record stops at the installed listing after creation", async () => {
  const f = fixture({
    mode: "phase-install",
    pins: INSTALL_PINS,
    wrongLoadFile: true,
  });
  const r = await runPhaseInstall(f.args);
  assert.equal(r.status, "stopped");
  assert.equal(r.failure, "registry-baseline");
  assert.equal(r.installedRegistryVerified, undefined);
  assert.equal(r.initialBaselineVerified, true);
  assert.ok(!f.sent.some((a) => [0xe4, 0xb0].includes(a[1])));
  assert.deepEqual(f.card.instanceAids(), INSTALLED);
  // The stop is decided by the listing, so the journal keeps every page of it:
  // without those bytes a stopped run cannot be diagnosed afterwards.
  assert.ok(Array.isArray(r.registry), "the listing was journaled");
  const loadFiles = r.registry.filter((p) => p.kind === "load-files");
  const applications = r.registry.filter((p) => p.kind === "applications");
  assert.equal(applications.length, 1);
  assert.equal(loadFiles.length, 1);
  // Three platform frames, then the record the verifier rejected: the bytes a
  // reader-side attempt could not have recovered after the fact.
  assert.ok(loadFiles[0].data.startsWith("e31b4f07a0000001515350"));
  assert.ok(
    loadFiles[0].data.endsWith(
      "e31b4f07a00000009999999f700101ce020100cc08a000000151000000",
    ),
  );
});

test("a lost install reply stops without retry, cleanup or raw exception text", async () => {
  const f = fixture({
    mode: "phase-install",
    pins: INSTALL_PINS,
    loseOpener: true,
  });
  const r = await runPhaseInstall(f.args);
  assert.equal(r.failure, "transport-uncertain");
  assert.equal(f.card.instanceAids().length, 1);
  assert.equal(f.sent.at(-1)[1], 0xe6);
  assert.ok(!JSON.stringify(r).includes("PRIVATE RAW"));
  assert.equal(r.status, "stopped");
});

test("an unconfirmed image hash stops the install profile before the wire", async () => {
  const f = fixture({
    mode: "phase-install",
    pins: INSTALL_PINS,
    hash: undefined,
  });
  f.args.hash = sha;
  const r = await runPhaseInstall(f.args);
  assert.equal(r.failure, "image-mismatch");
  assert.equal(f.sent.length, 0);
});

test("the install plan resumes only an interrupted attempt", () => {
  const stopped = {
    plan: INSTALL_PINS.plan,
    stage: "load-40-of-114",
    status: "stopped",
  };
  assert.deepEqual(
    resumeJournal(JSON.stringify(stopped), INSTALL_PINS.plan),
    stopped,
  );
  // A finished install consumes its journal: it never resumes as a new attempt.
  const done = {
    plan: INSTALL_PINS.plan,
    stage: "installed-for-phases",
    status: "installed-for-phases",
  };
  assert.deepEqual(resumeJournal(JSON.stringify(done), INSTALL_PINS.plan), {
    plan: INSTALL_PINS.plan,
    stage: "saved-journal-unreadable",
    status: "stopped",
    failure: "saved-journal-unreadable",
  });
  // Another profile's journal is never adopted under another plan either.
  assert.equal(resumeJournal(JSON.stringify(stopped)).status, "stopped");
  // Another profile's plan is never adopted: the record is consumed as
  // unreadable rather than resumed under this plan.
  assert.deepEqual(
    resumeJournal(
      JSON.stringify({ ...stopped, plan: "pixel-creation-control-v1" }),
      INSTALL_PINS.plan,
    ),
    {
      plan: INSTALL_PINS.plan,
      stage: "saved-journal-unreadable",
      status: "stopped",
      failure: "saved-journal-unreadable",
    },
  );
});
