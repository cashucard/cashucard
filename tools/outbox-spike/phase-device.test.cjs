const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  phaseRuntime,
  previewDevicePhase,
  runDevicePhase,
} = require("./phase-device.cjs");
const { createJournal, preparePhase } = require("./phase-recovery.cjs");
const { openPhaseBridge } = require("./phase-transport.cjs");
const { sdk, kitRequire } = require("./pixel-test-support.cjs");
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const pins = require("./pixel-streamed.json"),
  vector = require("./fixtures/compact-capacity-v1.json");
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cashucard-device-"));
  fs.chmodSync(root, 0o700);
  const write = (file, value) => {
    const raw =
      typeof value === "string" ? value : JSON.stringify(value) + "\n";
    fs.writeFileSync(file, raw, { mode: 0o600 });
    return sha(raw);
  };
  const prefix = path.join(root, "runtime"),
    python = path.join(prefix, "bin/python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.mkdirSync(path.join(prefix, "lib/python3.13/site-packages/smartcard"), {
    recursive: true,
  });
  write(python, "test interpreter; never executed");
  fs.chmodSync(python, 0o700);
  write(path.join(prefix, "pyvenv.cfg"), "home = public-test-runtime\n");
  write(
    path.join(prefix, "lib/python3.13/site-packages/smartcard/__init__.py"),
    "# public test package\n",
  );
  const binding = {
    runId: "44".repeat(16),
    key: vector.context.cardKey,
    runtimeSha256: phaseRuntime(python).sha256,
  };
  const sourceCommit = "55".repeat(20),
    apk = path.join(root, "lab.apk"),
    phoneFile = path.join(root, "phone.json"),
    receiptFile = path.join(root, "receipt.json");
  const phone = {
    plan: "pixel-phase-install-v1",
    status: "installed-for-phases",
    stage: "installed-for-phases",
    chip: pins.chip,
    cardKey: binding.key,
    factoryVersionVerified: 1,
    initialBaselineVerified: true,
    installedRegistryVerified: true,
    diagnostics: "7fff0a0e0a0014001400000000000005",
    build: {
      mode: "phase-install",
      source: sourceCommit,
      manifest: pins.manifest,
      cap: pins.cap,
      load: pins.load,
      blocks: pins.blocks,
    },
    artifact: { source: pins.source, cap: pins.cap, load: pins.load },
  };
  const receipt = {
    format: "compact-phase-install-v1",
    sourceCommit,
    apk: { path: apk, sha256: write(apk, "test APK") },
    journal: { path: phoneFile, sha256: write(phoneFile, phone) },
  };
  const journal = path.join(root, "phase.json"),
    campaign = path.join(root, "campaign.json");
  write(journal, createJournal(binding));
  const plan = {
    format: "compact-phase-campaign-v1",
    approved: true,
    reader: "ACS ACR122U PICC Interface",
    chip: pins.chip,
    python,
    sourceCommit,
    binding,
    journal,
    artifact: path.join(root, "image"),
    installation: { path: receiptFile, sha256: write(receiptFile, receipt) },
  };
  let opens = 0,
    closeFails = false,
    startFails = false;
  const dependencies = {
    sourceInfo: () => ({ commit: sourceCommit, clean: true }),
    inspectArtifact: (options) => {
      assert.equal(options.manifestHash, pins.manifest);
      assert.equal(options.sourceCommit, pins.source);
      return {
        manifest: { capSha256: pins.cap, loadFileSha256: pins.load },
        load: Buffer.alloc(pins.bytes),
      };
    },
    openBridge: async ({ request, sha256 }) => {
      opens++;
      assert.ok(fs.existsSync(journal + ".lock"));
      assert.equal(sha(fs.readFileSync(request)), sha256);
      if (startFails) throw Error("startup failure");
      const program = JSON.parse(fs.readFileSync(request));
      let at = 0;
      const identity = new FakeCard();
      return {
        pid: 999999,
        tx: async (apdu) => {
          const row = program.commands[at++];
          assert.equal(Buffer.from(apdu).toString("hex"), row.frame);
          const c = row.check;
          if (apdu[1] === 0xca || (apdu[1] === 0xa4 && apdu[5] === 0xa0))
            return identity.transceive(apdu);
          const data =
            c.kind === "diagnostics" ? phone.diagnostics : c.data || "";
          return [...Buffer.from(data, "hex"), c.sw >> 8, c.sw & 255];
        },
        close: async () => {
          if (closeFails) throw Error("close failure");
        },
      };
    },
  };
  const options = () => ({
    campaign,
    sha256: write(campaign, plan),
    mode: "execute",
  });
  return {
    root,
    plan,
    phone,
    receipt,
    phoneFile,
    receiptFile,
    python,
    write,
    options,
    dependencies,
    opens: () => opens,
    failClose: () => {
      closeFails = true;
    },
    failStart: () => {
      startFails = true;
    },
  };
}
test("offline Python wire policy rejects namespace, order and response violations", () => {
  execFileSync(
    "python3",
    ["-I", "-S", "-B", path.join(__dirname, "test_phase_wire.py")],
    { stdio: "pipe" },
  );
});

test("preview admission errors do not print private configuration values", () => {
  const f = fixture();
  try {
    f.plan.format = "SENSITIVE_TEST_MARKER";
    const options = f.options();
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            path.join(__dirname, "phase-device.cjs"),
            "--campaign",
            options.campaign,
            "--sha256",
            options.sha256,
          ],
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        ),
      (error) => {
        assert.ok(error.stderr.includes("Phase admission or execution failed"));
        assert.ok(!error.stderr.includes("SENSITIVE_TEST_MARKER"));
        return true;
      },
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("preview opens nothing; an approved invocation opens lazily under the journal lease", async () => {
  const f = fixture();
  try {
    const options = f.options();
    const preview = previewDevicePhase(options, f.dependencies);
    assert.equal(preview.commands, 55);
    assert.equal(preview.deviceOpened, false);
    assert.equal(f.opens(), 0);
    const result = await runDevicePhase(options, f.dependencies);
    assert.equal(result.outcome, "phase-complete", result.failure);
    assert.equal(f.opens(), 1);
    assert.equal(result.programSha256, preview.programSha256);
    assert.ok(!fs.existsSync(f.plan.journal + ".lock"));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("changed approval, runtime, installation evidence or source is rejected before opening", async () => {
  for (const kind of [
    "approval",
    "campaign",
    "runtime",
    "phone",
    "artifact",
    "source",
    "journal",
  ]) {
    const f = fixture();
    try {
      if (kind === "approval") f.plan.approved = false;
      if (kind === "runtime") f.write(f.python, "changed runtime");
      if (kind === "phone") {
        f.phone.plan = "pixel-capacity-streamed-v1";
        f.receipt.journal.sha256 = f.write(f.phoneFile, f.phone);
        f.plan.installation.sha256 = f.write(f.receiptFile, f.receipt);
      }
      if (kind === "artifact")
        f.dependencies.inspectArtifact = () => {
          throw Error("image mismatch");
        };
      if (kind === "source")
        f.dependencies.sourceInfo = () => ({
          commit: f.plan.sourceCommit,
          clean: false,
        });
      if (kind === "journal") f.write(f.plan.journal, { format: 1 });
      const options = f.options();
      if (kind === "campaign") options.sha256 = "00".repeat(32);
      await assert.rejects(runDevicePhase(options, f.dependencies));
      assert.equal(f.opens(), 0, kind);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});
test("uncertain startup or close retains the lease and blocks another invocation", async () => {
  for (const kind of ["failStart", "failClose"]) {
    const f = fixture();
    try {
      f[kind]();
      const options = f.options();
      const result = await runDevicePhase(options, f.dependencies);
      assert.equal(result.failure, "reader-close-failed");
      assert.equal(result.leaseRetained, true);
      assert.ok(fs.existsSync(f.plan.journal + ".lock"));
      const retained = JSON.parse(fs.readFileSync(f.plan.journal + ".lock"));
      assert.equal(retained.reason, "reader-close-uncertain");
      if (kind === "failClose") assert.equal(retained.bridgePid, 999999);
      await assert.rejects(
        runDevicePhase(options, f.dependencies),
        /EEXIST|recovery-required/,
      );
      assert.equal(f.opens(), 1);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test("source changed after initial admission still blocks the lazy connection", async () => {
  const f = fixture();
  let checks = 0;
  try {
    f.dependencies.sourceInfo = () => ({
      commit: f.plan.sourceCommit,
      clean: ++checks === 1,
    });
    const result = await runDevicePhase(f.options(), f.dependencies);
    assert.equal(result.outcome, "stopped");
    assert.equal(result.deviceOpened, false);
    assert.equal(f.opens(), 0);
    assert.ok(!fs.existsSync(f.plan.journal + ".lock"));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("the isolated Python transport uses only the supplied fake PC/SC package and rejects invalid requests before import", async () => {
  const f = fixture();
  const python = execFileSync(
    "python3",
    ["-c", "import sys;print(sys.executable)"],
    { encoding: "utf8" },
  ).trim();
  const sitePackages = path.join(f.root, "fake/site-packages"),
    pkg = path.join(sitePackages, "smartcard");
  fs.mkdirSync(pkg, { recursive: true });
  try {
    f.write(
      path.join(pkg, "__init__.py"),
      "from pathlib import Path\nPath(__file__).with_name('loaded').write_text('yes')\n",
    );
    const invalid = path.join(f.root, "invalid.json"),
      digest = f.write(invalid, { format: "wrong" });
    await assert.rejects(
      openPhaseBridge({
        python,
        sitePackages: fs.realpathSync(sitePackages),
        request: invalid,
        sha256: digest,
      }),
    );
    assert.ok(!fs.existsSync(path.join(pkg, "loaded")));
    const journal = JSON.parse(fs.readFileSync(f.plan.journal));
    const program = preparePhase({ journal, binding: f.plan.binding });
    const identity = new FakeCard(),
      responses = [];
    for (const row of program.commands) {
      const a = [...Buffer.from(row.frame, "hex")];
      if (a[1] === 0xca || (a[1] === 0xa4 && a[5] === 0xa0))
        responses.push(await identity.transceive(a));
      else
        responses.push([
          ...Buffer.from(
            row.check.kind === "diagnostics"
              ? f.phone.diagnostics
              : row.check.data || "",
            "hex",
          ),
          0x90,
          0,
        ]);
    }
    f.write(path.join(pkg, "responses.json"), responses);
    f.write(
      path.join(pkg, "scard.py"),
      "SCARD_LEAVE_CARD=0\nSCARD_SHARE_EXCLUSIVE=1\n",
    );
    f.write(
      path.join(pkg, "System.py"),
      [
        "import json",
        "from pathlib import Path",
        "HERE=Path(__file__).parent",
        "responses=json.loads((HERE/'responses.json').read_text())",
        "events=[]",
        "class Connection:",
        " def connect(self,mode,disposition):",
        "  assert mode==1 and disposition==0",
        "  events.append('exclusive')",
        " def transmit(self,a):",
        "  events.append(a)",
        "  r=responses.pop(0)",
        "  return r[:-2],r[-2],r[-1]",
        " def disconnect(self):",
        "  events.append('closed')",
        "  (HERE/'observed.json').write_text(json.dumps(events))",
        "class Reader:",
        " def __str__(self): return 'ACS ACR122U PICC Interface'",
        " def createConnection(self): return Connection()",
        "def readers(): return [Reader()]",
        "",
      ].join("\n"),
    );
    const request = path.join(f.root, "wire.json"),
      sha256 = f.write(request, program);
    const bridge = await openPhaseBridge({
      python,
      sitePackages: fs.realpathSync(sitePackages),
      request,
      sha256,
    });
    try {
      for (const row of program.commands) {
        const r = await bridge.tx([...Buffer.from(row.frame, "hex")]);
        assert.deepEqual(r.slice(-2), [0x90, 0]);
      }
    } finally {
      await bridge.close();
    }
    const events = JSON.parse(fs.readFileSync(path.join(pkg, "observed.json")));
    assert.equal(events[0], "exclusive");
    assert.equal(events.at(-1), "closed");
    assert.equal(events.length, program.commands.length + 2);
    assert.ok(!fs.readdirSync(f.root).some((p) => p.startsWith("pycache-")));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
