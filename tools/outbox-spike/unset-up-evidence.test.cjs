const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fixture } = require("./unset-up-test-support.cjs");
const { cleanupUnsetUp } = require("./unset-up-recovery.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const profile = require("./unset-up-profile.json");
test("independent decoder checks the persisted complete registry, not only in-memory success", async (t) => {
  const f = fixture();
  const r = await cleanupUnsetUp(f.args);
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "unset-evidence-")),
  );
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const fault of [
    "none",
    "retained-package",
    "missing-kind",
    "wrong-state",
    "wrong-key",
  ]) {
    const value = structuredClone(
      f.snapshots.findLast((s) => s.registryBlankVerified && !s.readerClosed),
    );
    assert.ok(value);
    if (fault === "retained-package")
      value.registrySnapshots[2].pages[1].data = profile.registry[1].data;
    if (fault === "missing-kind") value.registrySnapshots[2].pages.pop();
    if (fault === "wrong-state")
      value.diagnostics = "7fff0a0e0a0014001400000000000105";
    if (fault === "wrong-key") value.cardKey = "02" + "11".repeat(32);
    const file = path.join(dir, fault + ".json"),
      sha256 = createPrivate(file, value);
    const run = () =>
      JSON.parse(
        execFileSync(
          "python3",
          [
            "-I",
            "-S",
            "-B",
            path.join(__dirname, "unset_up_verify.py"),
            "--journal",
            file,
            "--sha256",
            sha256,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
    if (fault === "none")
      assert.deepEqual(run(), { savedEvidenceVerified: true });
    else assert.throws(run);
  }
});
