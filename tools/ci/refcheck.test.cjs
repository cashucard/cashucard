const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const REFCHECK = join(__dirname, "..", "refcheck.py");

// Builds a CAP whose load file is `size` bytes by refcheck's measure, the
// opener listed first, and runs refcheck on it. With `entry`, refcheck runs
// from a copy whose PROVEN also has the built file's load-file sha256, with
// the note entry(sha) gives it.
function refcheck(size, entry) {
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
import hashlib
print(hashlib.sha256(r.load_file(r.components(cap))).hexdigest())
`;
    const built = spawnSync("python3", ["-I", "-c", make, REFCHECK, String(size), cap], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const sha = built.stdout.trim();
    let script = REFCHECK;
    if (entry) {
      script = join(dir, "refcheck.py");
      const source = readFileSync(REFCHECK, "utf8");
      const tail = "\n\nif __name__ == '__main__':";
      assert.ok(source.includes(tail), "refcheck's main guard");
      writeFileSync(script, source.replace(tail, `\nPROVEN[${JSON.stringify(sha)}] = ${JSON.stringify(entry(sha))}${tail}`));
    }
    const run = spawnSync("python3", ["-I", script, cap], { encoding: "utf8" });
    return { status: run.status, out: run.stdout, sha };
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
    // the lines are an estimate: sizeTheFile's lines are five to seven bytes each
    assert.match(r.out, /about \d+ lines of five to seven bytes/);
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
  assert.match(untried.out, /not yet tried on a chip/);
  assert.match(untried.out, /the nearest size known to install is 21631 bytes/);
  assert.doesNotMatch(untried.out, /~\//, "no path in a home folder");
});

// 2.3 (the source now numbered 3.0, D205): a build of 32,777 bytes failed to install, and builds of 33,647 and
// 35,213 installed. A build inside 32,700 to 32,850 is refused, at both ends.
test("2.3 sizes: 32,700 to 32,850 refused, 33,647 and 35,213 known to install", () => {
  for (const size of [32700, 32777, 32850]) {
    const r = refcheck(size);
    assert.equal(r.status, 1, `${size}: ${r.out}`);
    assert.match(r.out, /REFUSED: a load file of \d+ bytes is inside 32700 to 32850/);
  }
  for (const size of [32699, 32851]) {
    const r = refcheck(size);
    assert.equal(r.status, 0, `${size}: ${r.out}`);
    assert.match(r.out, /not yet tried on a chip/);
  }
  for (const size of [33647, 35213]) {
    const r = refcheck(size);
    assert.equal(r.status, 0, `${size}: ${r.out}`);
    assert.match(r.out, /a size known to install/);
  }
});

// A size in SIZES says what a chip did with some source padded to it, not that
// this file has run: refcheck names the load file's sha256 and says it has run
// only in a simulator until that hash is in PROVEN, and, of a size no card has
// installed, that no card has installed a file of its size either.
test("a size known to install is not a file that has run: the sha256 decides", () => {
  for (const size of [35213, 21631, 35466]) {
    const r = refcheck(size);
    assert.match(r.out, /load file sha256: [0-9a-f]{64}; this exact file has run only in a simulator so far, and no card has installed it\.\n/, `${size}: ${r.out}`);
    assert.doesNotMatch(r.out, /this exact file has run on a chip/);
  }
  for (const size of [21600, 32777]) {
    const r = refcheck(size);
    assert.match(r.out, /load file sha256: [0-9a-f]{64}; this exact file has run only in a simulator so far, and no card has installed it or a file of its size\.\n/, `${size}: ${r.out}`);
  }
});

// 35,509 bytes is the size of a test-only build of the chip run (2.3 with one
// command added that says the signer's temporary key's kind; never shipped): a
// size known to install, marked as the test build's, and no file of it proven.
test("35,509 bytes, the chip run's test-only build, is a size known to install and its entry says it is a test build", () => {
  const r = refcheck(35509);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /a size known to install/);
  assert.match(r.out, /this exact file has run only in a simulator so far, and no card has installed it\.\n/);
  assert.match(readFileSync(REFCHECK, "utf8"), /^ {4}35509: True, +# .*test-only build.*never shipped/m);
});

// A hash goes on PROVEN only once the chip run has had real signatures and real
// change verified on the chip, which the framing check's fixed asks cannot
// stand in for: an entry that does not say so stops refcheck for every file.
test("PROVEN takes a hash only with real signatures and real change verified on the chip", () => {
  for (const note of ["2.3, 35,466 bytes, 2026-11-14, a J3R180: installed, selftest 12/12",
                      "2.3, 35,466 bytes: real signatures verified on the chip",
                      "2.3, 35,466 bytes: real change verified on the chip",
                      "2.3, 35,466 bytes: Real signatures and real change verified on the chip"]) {
    const r = refcheck(35466, () => note);
    assert.equal(r.status, 1, `${note}: ${r.out}`);
    assert.match(r.out, new RegExp(`^REFUSED: PROVEN lists ${r.sha} without "real signatures and real change verified on the chip"`), note);
    assert.doesNotMatch(r.out, /this exact file has run on a chip/, note);
  }
  const ok = refcheck(35466, () => "2.3, 35,466 bytes, 2026-11-14, a J3R180: real signatures and real change verified on the chip");
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, new RegExp(`load file sha256: ${ok.sha}; this exact file has run on a chip\\.\n`));
  // the tracked refcheck, with no such entry, refuses nothing for it
  const plain = refcheck(35466);
  assert.equal(plain.status, 0, plain.out);
  assert.doesNotMatch(plain.out, /REFUSED/);
});

// Only the two entries made before the rule are excepted from it, and both are
// in PROVEN as they were.
test("PROVEN's exceptions are the 2.1 and 2.2 entries alone", () => {
  const r = spawnSync("python3", ["-I", "-c", `
import sys, importlib.util, json
spec = importlib.util.spec_from_file_location("refcheck", sys.argv[1])
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
import hashlib
parts = {"Header": bytes(300)}
sha = hashlib.sha256(r.load_file(parts)).hexdigest()
r.PROVEN[sha] = "a J3R180: installed, selftest 12/12"
bare = (r.proven(parts), r.said(parts))
r.PROVEN[sha] = "a J3R180: " + r.PROVEN_NEEDS
full = (r.proven(parts), r.said(parts))
del r.PROVEN[sha]
print(json.dumps({"earlier": sorted(r.EARLIER), "in": all(h in r.PROVEN for h in r.EARLIER), "needs": r.PROVEN_NEEDS,
                  "bare": r.unverified(), "bareEntry": bare, "fullEntry": full}))
`, REFCHECK], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.earlier, [
    "28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3",
    "fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee",
  ]);
  assert.equal(got.in, true);
  assert.equal(got.needs, "real signatures and real change verified on the chip");
  assert.deepEqual(got.bare, []);
  // an entry without the words is not a file that has run, wherever proven() is asked
  assert.deepEqual(got.bareEntry, [false, "this exact file has run only in a simulator so far, and no card has installed it or a file of its size"]);
  assert.deepEqual(got.fullEntry, [true, "this exact file has run on a chip"]);
});

// The 2.3 build of 35,466 bytes (the source before D200) installed on a J3R180 on 2026-11-13, and its chip run had
// real signatures and real change verified on the chip: its size is one that installs, and its hash stays on PROVEN.
test("35,466 bytes, the 2.3 build before D200, is known to install, and its hash stays on PROVEN", () => {
  const r = refcheck(35466);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /a size known to install/);
  assert.match(readFileSync(REFCHECK, "utf8"), /'48b8597cfd23ace73c6451a962541bfa09534a312f225ebcf382a8769fe01c96': '2\.3, 35,466 bytes/);
});

// The tracked CAP is the 2.3 file of 2026-11-14 (D200 to D204) with the version moved to 3.0 (D205): the same size,
// 36,953 bytes, and a new load file. No card has installed it, so its hash is not on PROVEN and refcheck says it has
// run only in a simulator, at a size known to install (from the 2.3 file's run). The 2.3 file's hash stays on PROVEN
// as that file's, with real signatures and real change verified on the chip.
test("the tracked 3.0 CAP's load file has run only in a simulator, at a size known to install", () => {
  const cap = join(__dirname, "..", "..", "applet", "target", "cashu-javacard-3.0.0.cap");
  const r = spawnSync("python3", ["-I", REFCHECK, cap], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /load file: 36953 bytes/);
  assert.match(r.stdout, /load file sha256: a7778e7b8f23e12086a3dceeac7dd9db6d407daa119b6e1caedeed28d139ce78; this exact file has run only in a simulator so far, and no card has installed it\.\n/);
  assert.doesNotMatch(r.stdout, /this exact file has run on a chip/);
  assert.match(r.stdout, /a size known to install/);
  const source = readFileSync(REFCHECK, "utf8");
  assert.doesNotMatch(source, /a7778e7b8f23e12086a3dceeac7dd9db6d407daa119b6e1caedeed28d139ce78/, "the tracked file's hash is not on PROVEN");
  assert.match(source, /'f216644a316e4c9de0f8bed2a4f32e90b48fa18624ed95a8f8950503f9464440': '2\.3 with D200 to D204, 36,953 bytes, 2026-11-14, J3R180 '\n +'09312320 at testnut\.cashu\.space: real signatures and real change verified on the chip'/);
});
