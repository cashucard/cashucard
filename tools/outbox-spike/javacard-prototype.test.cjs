const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
test("private JavaCard generation keeps the original constructor/fields and excludes simulator hooks", () => {
  execFileSync("python3", [path.join(__dirname, "test_compact.py")], {
    stdio: "pipe",
  });
});
test("the compact hardware image is rejected by the existing resource runner", () => {
  const { artifact } = require("./run-probe.cjs");
  const os = require("node:os"),
    crypto = require("node:crypto");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "compact-kind-"));
  try {
    const p = path.join(directory, "manifest.json");
    const bytes = Buffer.from(
      JSON.stringify({
        kind: "compact-javacard-prototype",
        probeFormat: 5,
        poolBytes: 16384,
      }),
    );
    fs.writeFileSync(p, bytes);
    assert.throws(() =>
      artifact(p, crypto.createHash("sha256").update(bytes).digest("hex")),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
