/* All PC/SC imports in this test resolve to a temporary synthetic package. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { fixture } = require("./constructor-diagnostic-test-support.cjs");
const { runDiagnostic } = require("./constructor-diagnostic-07297620-v2.cjs");
const {
  openConstructorBridge,
} = require("./constructor-diagnostic-v2-transport.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const { hash } = require("./unset-up-admission.cjs");
const profile = require("./constructor-trace-07297620-v2.json");
const python = fs.realpathSync(
  execFileSync("python3", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  }).trim(),
);
async function setup(t, mode = "ok", approved = true) {
  const planId = "constructor-trace-07297620-v2";
  const selectedProfile = profile,
    profileFile = "constructor-trace-07297620-v2.json";
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "constructor-v2-wire-")),
  );
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const site = path.join(root, "site-packages"),
    pkg = path.join(site, "smartcard");
  fs.mkdirSync(pkg, { recursive: true });
  const image = require("./constructor-trace.cjs").artifact({
    manifest: path.join(profile.artifactDir, "manifest.json"),
    manifestHash: profile.manifestSha256,
  });
  const f = fixture({ image, fault: mode === "fault" });
  f.args.planId = profile.planId;
  assert.equal((await runDiagnostic(f.args)).status, "diagnostic-recorded");
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
      "  if MODE=='pcsc':",
      "   error=RuntimeError('native private');error.hresult=0x80100016;raise error",
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
      ".cashucard/constructor-trace-07297620-2026-11-05/pass-2/diagnostic.json",
    );
  fs.mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
  const campaignSha256 = "a".repeat(64),
    marker = { path: journal + ".consumed" };
  marker.sha256 = createPrivate(marker.path, {
    format: "card-constructor-diagnostic-consumed-v1",
    planId: selectedProfile.planId,
    campaignSha256,
    journal,
  });
  const files = {};
  for (const file of [
    python,
    ...[
      "constructor_diagnostic_07297620.py",
      "constructor_diagnostic_07297620_v2.py",
      "unset_up_bridge.py",
      "unset_up_policy.py",
      "compact_recovery_bridge.py",
      "probe_bridge.py",
      profileFile,
    ].map((n) => path.join(__dirname, n)),
    ...fs.readdirSync(pkg).map((n) => path.join(pkg, n)),
    ...[
      "manifest.json",
      "constructor-trace.cap",
      "load-file.bin",
      "stages.json",
    ].map((n) => path.join(profile.artifactDir, n)),
  ])
    files[file] = hash(fs.readFileSync(file));
  const value = {
    format: "card-constructor-diagnostic-request-v1",
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
      " import constructor_diagnostic_07297620_v2 as successor",
      " successor.activate()",
      " m=successor.b",
      " m.PROFILE=dict(m.PROFILE,approved=True)",
      " try:m.main()",
      " except Exception as error:m.common.emit(m.common.failure_message(error));sys.exit(1)",
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
test(
  "isolated constructor diagnostic process completes one exact sequence and confirms closure",
  { skip: !fs.existsSync(path.join(profile.artifactDir, "manifest.json")) },
  async (t) => {
    const f = await setup(t),
      bridge = await openConstructorBridge(f.options);
    const r = await runDiagnostic({
      ...f.f.args,
      tx: bridge.tx,
      close: bridge.close,
    });
    assert.equal(r.status, "diagnostic-recorded", JSON.stringify(r));
    assert.equal(r.readerClosed, true);
    const events = JSON.parse(
      fs.readFileSync(path.join(f.pkg, "observed.json"), "utf8"),
    );
    assert.equal(events.length, profile.blocks + 18);
    assert.equal(events[0], "exclusive");
    assert.equal(events.at(-1), "closed");
  },
);
test(
  "invalid request refuses before fake PC/SC import; lost replies and close uncertainty cannot qualify",
  { skip: !fs.existsSync(path.join(profile.artifactDir, "manifest.json")) },
  async (t) => {
    const invalid = await setup(t);
    invalid.rewrite({ ...invalid.value, approved: false });
    await assert.rejects(openConstructorBridge(invalid.options));
    assert.equal(fs.existsSync(path.join(invalid.pkg, "loaded")), false);
    for (const mode of ["transmit", "close"]) {
      const f = await setup(t, mode),
        bridge = await openConstructorBridge(f.options),
        r = await runDiagnostic({
          ...f.f.args,
          tx: bridge.tx,
          close: bridge.close,
        });
      assert.equal(r.status, "stopped");
      assert.equal(r.closeFailure, "reader-close-uncertain");
      assert.ok(!JSON.stringify(r).includes("native private"));
    }
  },
);
test(
  "independent decoder replays the exact load/registries and refuses a forged constructor result",
  { skip: !fs.existsSync(path.join(profile.artifactDir, "manifest.json")) },
  async (t) => {
    const f = await setup(t);
    const v = f.f.saved.findLast((s) => s.stage === "verify-saved-evidence");
    assert.ok(v);
    for (const changed of [0, 1, 2]) {
      const copy = structuredClone(v);
      if (changed === 1)
        copy.constructorResult = {
          outcome: "constructor-complete",
          stage: 1,
          operation: "forged",
        };
      if (changed === 2) copy.exchanges[8].intentSha256 = "0".repeat(64);
      const file = path.join(f.root, `saved-${changed}.json`),
        sha256 = createPrivate(file, copy);
      const check = () =>
        JSON.parse(
          execFileSync(
            python,
            [
              "-I",
              "-S",
              "-B",
              path.join(__dirname, "constructor_diagnostic_07297620_v2.py"),
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
  },
);

test(
  "native diagnostic accepts a caught constructor fault as evidence, without calling it complete",
  { skip: !fs.existsSync(path.join(profile.artifactDir, "manifest.json")) },
  async (t) => {
    const f = await setup(t, "fault"),
      bridge = await openConstructorBridge(f.options);
    const r = await runDiagnostic({
      ...f.f.args,
      tx: bridge.tx,
      close: bridge.close,
    });
    assert.equal(r.status, "diagnostic-recorded");
    assert.equal(r.constructorResult.outcome, "caught-constructor-fault");
    assert.equal(r.constructorResult.kind, "crypto");
    assert.equal(r.constructorResult.stage, 49);
    const saved = f.f.saved.findLast(
      (s) => s.stage === "verify-saved-evidence",
    );
    const file = path.join(f.root, "fault-saved.json"),
      sha256 = createPrivate(file, saved);
    const result = JSON.parse(
      execFileSync(
        python,
        [
          "-I",
          "-S",
          "-B",
          path.join(__dirname, "constructor_diagnostic_07297620_v2.py"),
          "--verify-journal",
          file,
          "--sha256",
          sha256,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    assert.equal(result.savedEvidenceVerified, true);
  },
);
test(
  "bounded PC/SC failure retains the code and failed-call duration without a status word",
  { skip: !fs.existsSync(path.join(profile.artifactDir, "manifest.json")) },
  async (t) => {
    const f = await setup(t, "pcsc"),
      bridge = await openConstructorBridge(f.options);
    const r = await runDiagnostic({
      ...f.f.args,
      tx: bridge.tx,
      close: bridge.close,
    });
    assert.equal(r.status, "stopped");
    assert.equal(r.failure, "reader-transmit-failed");
    assert.equal(r.pcscCode, "80100016");
    const e = r.exchanges.at(-1);
    assert.equal(e.sw, null);
    assert.equal(e.pcscCode, "80100016");
    assert.equal(e.transportFailure, "reader-transmit-failed");
    assert.ok(Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0);
    assert.ok(!JSON.stringify(r).includes("native private"));
  },
);
