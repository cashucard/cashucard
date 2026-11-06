const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const REFCHECK = join(__dirname, "..", "refcheck.py");

// Builds a CAP whose load file is `size` bytes by refcheck's measure, the
// opener listed first, and runs refcheck on it.
function refcheck(size) {
  const dir = mkdtempSync(join(tmpdir(), "refcheck-"));
  try {
    const cap = join(dir, "t.cap");
    const make = `
import sys, zipfile, importlib.util
spec = importlib.util.spec_from_file_location("refcheck", sys.argv[1])
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
size, cap = int(sys.argv[2]), sys.argv[3]
applet = bytes([3, 0, 0, 1, len(r.OPENER)]) + r.OPENER + b"\\0\\0"
body = size - 4
assert body >= 0x100
header = b"\\0" * (body - len(applet))
with zipfile.ZipFile(cap, "w") as z:
    z.writestr("p/javacard/Applet.cap", applet)
    z.writestr("p/javacard/Header.cap", header)
assert r.load_file_size(r.components(cap)) == size
`;
    const built = spawnSync("python3", ["-I", "-c", make, REFCHECK, String(size), cap], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const run = spawnSync("python3", ["-I", REFCHECK, cap], { encoding: "utf8" });
    return { status: run.status, out: run.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2026-11-06 (D176): the 2.2 first build's card applet went 6F00 at INSTALL at
// 21,540 bytes. The cause was not isolated from the size window, so that size,
// and any within NEAR of it, is refused, never passed as one that installs.
test("21,540 bytes, measured 6F00 at INSTALL, is refused", () => {
  for (const size of [21540, 21534, 21546]) {
    const r = refcheck(size);
    assert.equal(r.status, 1, `${size}: ${r.out}`);
    assert.match(r.out, /REFUSED: a file of 21540 bytes failed/);
  }
});

test("a size known to install passes, and an untried one is named untried", () => {
  for (const size of [20068, 21631]) {
    const known = refcheck(size);
    assert.equal(known.status, 0, known.out);
    assert.match(known.out, /a size known to install/);
  }
  // an untried size between the two installs is named untried, and 21,540, which is
  // not a size that installs, must not be offered as the nearest one.
  const untried = refcheck(21600);
  assert.equal(untried.status, 0, untried.out);
  assert.match(untried.out, /a size not yet tried on the chip/);
  assert.match(untried.out, /the nearest known to install is 21631 bytes/);
});
