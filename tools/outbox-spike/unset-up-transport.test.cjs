/* Synthetic factory-key replies only; never reads a device or owner capture. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { fixture } = require("./unset-up-test-support.cjs");
const { cleanupUnsetUp } = require("./unset-up-recovery.cjs");
const { openUnsetBridge } = require("./unset-up-transport.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const { hash } = require("./unset-up-admission.cjs");
const profile = require("./unset-up-profile.json");
const python = fs.realpathSync(
  execFileSync("python3", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  }).trim(),
);
async function setup(t, mode = "ok") {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "unset-wire-")),
  );
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const site = path.join(dir, "site-packages"),
    pkg = path.join(site, "smartcard");
  fs.mkdirSync(pkg, { recursive: true });
  const f = fixture();
  assert.equal((await cleanupUnsetUp(f.args)).status, "complete");
  const write = (name, raw) => fs.writeFileSync(path.join(pkg, name), raw);
  write(
    "__init__.py",
    "from pathlib import Path\nPath(__file__).with_name('loaded').write_text('synthetic')\n",
  );
  write("scard.py", "SCARD_LEAVE_CARD=0\nSCARD_SHARE_EXCLUSIVE=1\n");
  write("responses.json", JSON.stringify(f.exchanges.map((e) => e.reply)));
  write(
    "System.py",
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
      "  if MODE=='connect': raise RuntimeError('private native text')",
      " def transmit(self,a):",
      "  events.append(a[:4])",
      "  if MODE=='lost-delete' and a[1]==0xe4: raise RuntimeError('private native text')",
      "  r=responses.pop(0)",
      "  return r[:-2],r[-2],r[-1]",
      " def disconnect(self):",
      "  events.append('closed')",
      "  (HERE/'observed.json').write_text(json.dumps(events))",
      "  if MODE=='close': raise RuntimeError('private native text')",
      "class Reader:",
      ` def __str__(self): return ${JSON.stringify(profile.reader)}`,
      " def createConnection(self): return Connection()",
      "def readers(): return [Reader()]",
      "",
    ].join("\n"),
  );
  const journal = path.join(dir, "recover.json"),
    campaignSha256 = "a".repeat(64);
  const marker = { path: journal + ".consumed" };
  marker.sha256 = createPrivate(marker.path, {
    format: "unset-up-recovery-consumed-v1",
    planId: profile.planId,
    campaignSha256,
    journal,
  });
  const files = {};
  for (const file of [
    python,
    ...[
      "unset_up_bridge.py",
      "unset_up_policy.py",
      "unset-up-profile.json",
    ].map((n) => path.join(__dirname, n)),
    ...fs.readdirSync(pkg).map((n) => path.join(pkg, n)),
  ])
    files[file] = hash(fs.readFileSync(file));
  const value = {
    format: "unset-up-recovery-request-v1",
    planId: profile.planId,
    approved: true,
    chip: profile.chip,
    key: profile.key,
    reader: profile.reader,
    campaignSha256,
    profileSha256: files[path.join(__dirname, "unset-up-profile.json")],
    files,
    marker,
    journal,
    python,
    sitePackages: site,
  };
  const request = path.join(dir, "request.json"),
    sha256 = createPrivate(request, value);
  return {
    f,
    pkg,
    value,
    options: { python, sitePackages: site, request, sha256 },
    rewrite(v) {
      fs.unlinkSync(request);
      this.options.sha256 = createPrivate(request, v);
    },
  };
}
test("isolated process validates request before importing any PC/SC package", async (t) => {
  for (const change of [
    (v) => ({ ...v, approved: false }),
    (v) => ({ ...v, chip: "wrong" }),
    (v) => ({ ...v, files: {} }),
    (v) => ({ ...v, profileSha256: "0".repeat(64) }),
  ]) {
    const f = await setup(t);
    f.rewrite(change(f.value));
    await assert.rejects(openUnsetBridge(f.options));
    assert.equal(fs.existsSync(path.join(f.pkg, "loaded")), false);
  }
});
test("isolated independent policy and host agree on one complete unset-up cleanup", async (t) => {
  const f = await setup(t),
    bridge = await openUnsetBridge(f.options);
  const result = await cleanupUnsetUp({
    ...f.f.args,
    tx: bridge.tx,
    close: bridge.close,
    requirePolicyCompletion: true,
  });
  assert.equal(result.status, "complete", JSON.stringify(result));
  assert.equal(result.independentPolicyComplete, true);
  assert.equal(result.readerClosed, true);
  const events = JSON.parse(
    fs.readFileSync(path.join(f.pkg, "observed.json"), "utf8"),
  );
  assert.equal(events.length, 26);
  assert.equal(events[0], "exclusive");
  assert.equal(events.at(-1), "closed");
});
test("isolated bridge refuses an out-of-order command and reports uncertain transport/closure without retry", async (t) => {
  const wrong = await setup(t),
    bridge = await openUnsetBridge(wrong.options);
  await assert.rejects(bridge.tx([0xb0, 0x7a, 0, 0, 0]));
  await assert.rejects(bridge.close());
  const events = JSON.parse(
    fs.readFileSync(path.join(wrong.pkg, "observed.json"), "utf8"),
  );
  assert.deepEqual(events, ["exclusive", "closed"]);
  for (const mode of ["lost-delete", "close"]) {
    const f = await setup(t, mode),
      wire = await openUnsetBridge(f.options);
    const r = await cleanupUnsetUp({
      ...f.f.args,
      tx: wire.tx,
      close: wire.close,
      requirePolicyCompletion: true,
    });
    assert.equal(r.status, "stopped");
    assert.equal(r.blankBaselineVerified, false);
    assert.equal(r.closeFailure, "reader-close-uncertain");
    assert.ok(!JSON.stringify(r).includes("private native text"));
    const e = JSON.parse(
      fs.readFileSync(path.join(f.pkg, "observed.json"), "utf8"),
    );
    assert.equal(
      e.filter((a) => Array.isArray(a) && a[1] === 0xe4).length,
      mode === "lost-delete" ? 1 : 3,
    );
  }
});
