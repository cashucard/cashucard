const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { openBridge } = require("./run-probe.cjs");

test("closed recovery startup rejects an invalid reader before PC/SC import and preserves its original failure", async () => {
  for (const key of [undefined, "02" + "11".repeat(32)])
    await assert.rejects(
      openBridge(
        "python3",
        "not a reader",
        false,
        false,
        "compact-recovery",
        undefined,
        key,
      ),
      (e) => e.code === "probe-bridge-stopped",
    );
});
test("recovery mode overrides are refused before spawning a bridge", async () => {
  for (const [registry, cleanup, workload] of [
    [true, false, undefined],
    [false, true, undefined],
    [false, false, "128-input-128-output-v1"],
  ])
    await assert.rejects(
      openBridge(
        "/missing/python",
        "ACS ACR122U PICC Interface",
        registry,
        cleanup,
        "compact-recovery",
        workload,
      ),
      /closed recovery profile/,
    );
});
test("independent recovery bridge policy gates pass without importing PC/SC", () => {
  execFileSync(
    "python3",
    [path.join(__dirname, "test_compact_recovery_bridge.py")],
    { stdio: "pipe" },
  );
});
test("recovery public-key arguments are rejected before spawn when malformed or used by another profile", async () => {
  for (const [profile, key] of [
    ["resource", "02" + "11".repeat(32)],
    ["compact-recovery", "04" + "11".repeat(32)],
    ["compact-recovery", "02"],
    ["compact-recovery", {}],
  ])
    await assert.rejects(
      openBridge(
        "/missing/python",
        "ACS ACR122U PICC Interface",
        false,
        false,
        profile,
        undefined,
        key,
      ),
      /compressed public key/,
    );
});
