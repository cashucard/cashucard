/* All PC/SC imports in this test resolve to a temporary synthetic package. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { fixture } = require("./memory-test-support.cjs");
const { snapshot } = require("./memory-07297620.cjs");
const { openMemoryBridge } = require("./memory-transport.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const { hash } = require("./unset-up-admission.cjs");
const profile = require("./memory-07297620.json");
const python = fs.realpathSync(
  execFileSync("python3", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  }).trim(),
);
async function setup(t, mode = "ok", approved = true) {
  const planId = "memory-07297620-v1";
  const selectedProfile = profile,
    profileFile = "memory-07297620.json";
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "memory-wire-")),
  );
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const site = path.join(root, "site-packages"),
    pkg = path.join(site, "smartcard");
  fs.mkdirSync(pkg, { recursive: true });
  const f = fixture();
  assert.equal((await snapshot(f.args)).status, "measured");
  fs.writeFileSync(
    path.join(pkg, "__init__.py"),
    "from pathlib import Path\nPath(__file__).with_name('loaded').write_text('synthetic')\n",
  );
  fs.writeFileSync(
    path.join(pkg, "scard.py"),
    "SCARD_LEAVE_CARD=0\nSCARD_SHARE_EXCLUSIVE=1\n",
  );
  fs.writeFileSync(
    path.join(pkg, "responses.json"),
    JSON.stringify(f.exchanges.map((e) => e.reply)),
  );
  fs.writeFileSync(
    path.join(pkg, "System.py"),
    [
      "import json",
      "from pathlib import Path",
      "HERE=Path(__file__).parent",
      `MODE=${JSON.stringify(mode)}`,
      "responses=json.loads((HERE/'responses.json').read_text())",
      "events=[]",
      "class Connection:",
      " def connect(self,mode,disposition):",
      "  assert mode==1 and disposition==0",
      "  events.append('exclusive')",
      " def transmit(self,a):",
      "  events.append(a[:4])",
      "  if MODE=='transmit':raise RuntimeError('native private')",
      "  r=responses.pop(0)",
      "  return r[:-2],r[-2],r[-1]",
      " def disconnect(self):",
      "  events.append('closed')",
      "  (HERE/'observed.json').write_text(json.dumps(events))",
      "  if MODE=='close':raise RuntimeError('native private')",
      "class Reader:",
      ` def __str__(self):return ${JSON.stringify(profile.reader)}`,
      " def createConnection(self):return Connection()",
      "def readers():return [Reader()]",
      "",
    ].join("\n"),
  );
  const fakeHome = path.join(root, "synthetic-home"),
    journal = path.join(
      fakeHome,
      ".cashucard/memory-07297620-2026-11-05/pass-1/memory.json",
    );
  fs.mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
  const campaignSha256 = "a".repeat(64),
    marker = { path: journal + ".consumed" };
  marker.sha256 = createPrivate(marker.path, {
    format: "card-memory-consumed-v1",
    planId: selectedProfile.planId,
    campaignSha256,
    journal,
  });
  const files = {};
  for (const file of [
    python,
    ...[
      "memory_07297620.py",
      "unset_up_bridge.py",
      "unset_up_policy.py",
      "compact_recovery_bridge.py",
      "probe_bridge.py",
      profileFile,
    ].map((n) => path.join(__dirname, n)),
    ...fs.readdirSync(pkg).map((n) => path.join(pkg, n)),
  ])
    files[file] = hash(fs.readFileSync(file));
  const value = {
    format: "card-memory-request-v1",
    planId: selectedProfile.planId,
    approved,
    profileSha256: files[path.join(__dirname, profileFile)],
    python,
    sitePackages: site,
    files,
    marker,
    journal,
    campaignSha256,
  };
  const request = path.join(root, "request.json"),
    sha256 = createPrivate(request, value);
  // Synthetic child only: patch home and approval in memory; the real profile stays unchanged.
  const wrapper = path.join(root, "synthetic-python");
  fs.writeFileSync(
    wrapper,
    [
      `#!${python}`,
      "import os,sys",
      "from pathlib import Path",
      "from unittest.mock import patch",
      "if sys.argv[1]!='--inner':",
      " os.execv(sys.executable,[sys.executable,'-I','-S','-B','-u',__file__,'--inner',*sys.argv[1:]])",
      "sys.argv=sys.argv[6:]",
      `with patch.object(Path,'home',return_value=Path(${JSON.stringify(fakeHome)})):`,
      ` sys.path.insert(0,${JSON.stringify(__dirname)})`,
      " import memory_07297620 as m",
      " m.PROFILE=dict(m.PROFILE,approved=True)",
      " m.main()",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return {
    root,
    pkg,
    f,
    value,
    options: { python: wrapper, sitePackages: site, request, sha256, planId },
    rewrite(v) {
      fs.unlinkSync(request);
      this.options.sha256 = createPrivate(request, v);
    },
  };
}
test("isolated memory process completes one exact sequence and confirms closure", async (t) => {
  const f = await setup(t),
    bridge = await openMemoryBridge(f.options);
  const r = await snapshot({
    ...f.f.args,
    tx: bridge.tx,
    close: bridge.close,
  });
  assert.equal(r.status, "measured", JSON.stringify(r));
  assert.equal(r.readerClosed, true);
  const events = JSON.parse(
    fs.readFileSync(path.join(f.pkg, "observed.json"), "utf8"),
  );
  assert.equal(events.length, 7);
  assert.equal(events[0], "exclusive");
  assert.equal(events.at(-1), "closed");
});
test("invalid request refuses before fake PC/SC import; lost replies and close uncertainty cannot qualify", async (t) => {
  const invalid = await setup(t);
  invalid.rewrite({ ...invalid.value, approved: false });
  await assert.rejects(openMemoryBridge(invalid.options));
  assert.equal(fs.existsSync(path.join(invalid.pkg, "loaded")), false);
  for (const mode of ["transmit", "close"]) {
    const f = await setup(t, mode),
      bridge = await openMemoryBridge(f.options),
      r = await snapshot({
        ...f.f.args,
        tx: bridge.tx,
        close: bridge.close,
      });
    assert.equal(r.status, "stopped");
    assert.equal(r.closeFailure, "reader-close-uncertain");
    assert.ok(!JSON.stringify(r).includes("native private"));
  }
});
test("independent decoder refuses a counter claim inconsistent with raw FF21 receipt", async (t) => {
  const f = await setup(t);
  const v = f.f.saved.findLast((s) => s.stage === "verify-saved-evidence");
  assert.ok(v);
  for (const changed of [false, true]) {
    const copy = structuredClone(v);
    if (changed) copy.memory.persistentBytes++;
    const file = path.join(f.root, changed ? "invalid.json" : "saved.json"),
      sha256 = createPrivate(file, copy);
    const check = () =>
      JSON.parse(
        execFileSync(
          python,
          [
            "-I",
            "-S",
            "-B",
            path.join(__dirname, "memory_07297620.py"),
            "--verify-journal",
            file,
            "--sha256",
            sha256,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
    if (changed) assert.throws(check);
    else
      assert.deepEqual(check(), {
        savedEvidenceVerified: true,
      });
  }
});
