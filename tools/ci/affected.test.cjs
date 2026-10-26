const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, renameSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { classify, changedFiles, JOBS } = require("./affected.cjs");

test("documentation and website changes do not run unrelated integration jobs", () => {
  assert.deepEqual(
    classify([
      "docs/ARCHITECTURE.md",
      "CONTRIBUTING.md",
      "tools/cardkit/README.md",
      "apps/provisioner/README.md",
      "ops/README.md",
    ]).selected,
    [],
  );
  assert.deepEqual(
    classify(["website/src/site.ts", "website/dist/index.html"]).selected,
    ["website"],
  );
  assert.ok(classify(["website/dist/guide.md"]).selected.includes("cap"));
});

test("UI changes run the app suite; package/native changes also build Android", () => {
  assert.deepEqual(
    classify(["apps/provisioner/src/screens/SettingsScreen.tsx"]).selected,
    ["provisioner"],
  );
  const selected = classify(["apps/provisioner/metro.config.js"]).selected;
  assert.ok(selected.includes("provisioner") && selected.includes("android"));
});

test("protocol, firmware, cardkit and recovery contracts retain the whole matrix", () => {
  for (const path of [
    "spec/APDU.md",
    "applet/src/main/java/CashuApplet.java",
    "tools/cardkit/index.ts",
    "ops/src/router.ts",
    "ops/src/reset-NEW.ts",
    "apps/provisioner/src/ownedResetWorkflow.ts",
    "apps/provisioner/src/NEW-recovery.ts",
    ".github/workflows/ci.yml",
    "tools/ci/affected.cjs",
  ]) {
    assert.deepEqual(classify([path]).selected, JOBS, path);
  }
});

test("backup and simulator changes follow their actual dependencies", () => {
  assert.deepEqual(classify(["tools/backup-copy/copy.py"]).selected, [
    "backup-copy",
    "backup-roundtrip",
  ]);
  assert.deepEqual(classify(["tools/cardsim/client.cjs"]).selected, [
    "cardsim",
    "e2e-tools",
  ]);
});

test("standalone packaging and its acceptance tests require the built container", () => {
  for (const path of [
    "ops/Dockerfile",
    "ops/Dockerfile.dockerignore",
    "ops/compose.yaml",
    "ops/docker/smoke.cjs",
    "ops/test/standalone.test.ts",
  ])
    assert.deepEqual(classify([path]).selected, ["ops", "ops-container"]);
  assert.deepEqual(classify(["ops/docker/README.md"]).selected, []);
});

test("unknown or unusual source paths fail closed to full verification", () => {
  for (const path of [
    "new-service/auth.ts",
    "ops/new-format.bin",
    "../ops/auth.ts",
    "docs/../../ops/auth.ts",
  ]) {
    assert.deepEqual(classify([path]).selected, JOBS, path);
  }
  assert.deepEqual(
    classify(["docs/ordinary name\nwith a newline.md"]).selected,
    [],
  );
});

test("rename detection retains the old critical path and handles missing history", () => {
  const dir = mkdtempSync(join(tmpdir(), "cashu-ci-diff-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.invalid");
    writeFileSync(join(dir, "recovery.ts"), "export {};\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    renameSync(join(dir, "recovery.ts"), join(dir, "notes.md"));
    git("add", "-A");
    git("commit", "-qm", "rename");
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(changedFiles(dir, base, head).sort(), [
      "notes.md",
      "recovery.ts",
    ]);
    assert.equal(changedFiles(dir, "0".repeat(40), head), null);
    assert.equal(changedFiles(dir, "a".repeat(40), head), null);
    assert.equal(changedFiles(dir, "--output=untrusted", head), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("push diffs compare trees directly, so a force push cannot hide a critical deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "cashu-ci-push-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.invalid");
    writeFileSync(join(dir, "base.md"), "base");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "recovery.ts"), "critical");
    git("add", ".");
    git("commit", "-qm", "critical");
    const before = git("rev-parse", "HEAD");
    git("checkout", "-qb", "diverged", base);
    writeFileSync(join(dir, "notes.md"), "notes");
    git("add", ".");
    git("commit", "-qm", "diverged");
    const after = git("rev-parse", "HEAD");
    assert.ok(changedFiles(dir, before, after, "push").includes("recovery.ts"));
    assert.deepEqual(changedFiles(dir, before, after, "pull_request"), [
      "notes.md",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("recovery contract tests select full integration even without a source change", () => {
  for (const path of [
    "apps/provisioner/__tests__/workspace-storage.test.ts",
    "apps/provisioner/__tests__/ownedResetWorkflow.test.ts",
    "ops/test/recovery.test.ts",
  ]) {
    assert.deepEqual(classify([path]).selected, JOBS);
  }
});

test("screens initiating durable card/reset/recovery work retain full integration", () => {
  for (const screen of [
    "ResetCardScreen",
    "ProvisioningScreen",
    "CardsHomeScreen",
    "CardStatusScreen",
  ]) {
    assert.deepEqual(
      classify([`apps/provisioner/src/screens/${screen}.tsx`]).selected,
      JOBS,
      screen,
    );
  }
});
