const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  compactArtifact,
  runCompact,
  fingerprint,
} = require("./run-compact.cjs");
const { workload, verifyPacket } = require("./compact-workload.cjs");
const original = require("./fixtures/assisted-settlement-v1.json");
const hash = (b) => createHash("sha256").update(b).digest("hex");
test("private setup avoids the runtime-owned MANAGE CHANNEL instruction", () => {
  assert.equal(workload().setup[1], 0x7e);
  assert.notEqual(workload().setup[1], 0x70);
  const dispatch = fs.readFileSync(
    path.join(__dirname, "java/CompactDispatch.txt"),
    "utf8",
  );
  assert.ok(dispatch.includes("if (ins == (byte) 0x7E)"));
  assert.ok(!dispatch.includes("if (ins == (byte) 0x70)"));
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compact-runner-"));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const cap = Buffer.from("private synthetic test CAP"),
    load = Buffer.from([0xc4, 1, 0]);
  const source = "a".repeat(40);
  const manifest = {
    kind: "compact-javacard-prototype",
    probeFormat: 5,
    sourceCommit: source,
    packageAid: "F04341534855434D5054",
    poolBytes: 16384,
    deferredDleqBytes: 12288,
    classShape: {
      declaredInstanceSize: 50,
      firstReferenceToken: 0,
      referenceCount: 50,
    },
    generatedSources: {},
    capSha256: hash(cap),
    loadFileSha256: hash(load),
    loadFileSize: load.length,
  };
  const names = [
    "CashuApplet.java",
    "CompactState.java",
    "Opener.java",
    "SchnorrHW.java",
    "Tag.java",
    "TagSwitch.java",
  ];
  fs.mkdirSync(path.join(dir, "src/me/flashapp/cashu"), { recursive: true });
  for (const name of names) {
    const data = Buffer.from("synthetic " + name);
    fs.writeFileSync(path.join(dir, "src/me/flashapp/cashu", name), data);
    manifest.generatedSources[name] = hash(data);
  }
  fs.writeFileSync(path.join(dir, "resource-probe.cap"), cap);
  fs.writeFileSync(path.join(dir, "load-file.bin"), load);
  const file = path.join(dir, "manifest.json");
  fs.writeFileSync(file, JSON.stringify(manifest));
  return {
    manifest: file,
    manifestHash: hash(fs.readFileSync(file)),
    sourceCommit: source,
    runnerHash: fingerprint(),
    chip: "cplc-v1:4790d3213041093363205547",
    reader: "ACS ACR122U PICC Interface",
    journal: path.join(dir, "journal.json"),
    execute: true,
    python: "/synthetic/python",
    factoryResetConfirmed: true,
  };
}
function fake({
  wrongChip = false,
  authFailure = false,
  signFailure = false,
  installRefusal = false,
  setupRefusal = false,
  setupUncertain = false,
  unknownRegistry = false,
  lowCommit = false,
  corruptPacket = false,
} = {}) {
  const calls = { opens: 0, closes: 0, auth: 0, deletes: [], stages: [] };
  const sdk = require("../cardkit");
  let state = "blank",
    after = false;
  const privateAids = [
    "F04341534855434D505401",
    "F04341534855434D50544D",
    "F04341534855434D5054",
  ];
  const platform = [
    "e31b4f07a00000015153509f700101ce02ffffcc08a000000151000000",
    "e31b4f07a00000006202049f700101ce020100cc08a000000151000000",
    "e31b4f07a00000006202029f700101ce020103cc08a000000151000000",
  ];
  const registry = () =>
    Buffer.concat([
      ...platform.map((x) => Buffer.from(x, "hex")),
      ...(state === "blank"
        ? []
        : [Buffer.from("e30c4f0aF04341534855434D5054", "hex")]),
      ...(unknownRegistry ? [Buffer.from("e3054f03010203", "hex")] : []),
    ]);
  const scope = Buffer.alloc(45);
  scope.writeBigUInt64BE(BigInt(original.identity.id), 1);
  scope.writeUInt32BE(1, 9);
  // Use a real independent signer for synthetic transport responses.
  const cc = require("../cardsim/cashu-crypto.cjs"),
    codec = require("./compact-export.cjs");
  const plan = {
    installation: original.context.installation,
    index: 0,
    id: BigInt(original.identity.id),
    generation: 1,
    inputs: original.proofs.map((p) => ({
      slot: p.slot,
      generation: p.generation,
    })),
  };
  const packet = codec.signCompact(
    plan,
    original.outputs,
    codec.fixtureView(original.context, original.keysets, original.proofs),
    (m) =>
      Buffer.from(
        execFileSync(
          "python3",
          [
            "-c",
            "import sys;sys.path.insert(0,sys.argv[1]);from test_bip340 import reference_sign;print(reference_sign(3,bytes.fromhex(sys.argv[2]),bytes(32))[1].hex())",
            path.resolve(__dirname, "../cardctl"),
            m.toString("hex"),
          ],
          { encoding: "utf8" },
        ).trim(),
        "hex",
      ),
  );
  const exp = codec.exportCompact(
    { ...plan, packet },
    codec.fixtureView(original.context, original.keysets, original.proofs),
  );
  Buffer.from(exp.packetId, "hex").copy(scope, 13);
  const canonical = Buffer.concat([...exp.pages()]);
  const reply = (data = [], sw = 0x9000) => ({ data: [...data], sw });
  const secure = async (tx, apdu) => {
    if (apdu[1] === 0xf2) return reply(apdu[2] === 0x20 ? registry() : []);
    if (apdu[1] === 0xe6) {
      state = "installed";
      if (
        installRefusal &&
        apdu[2] === 0x0c &&
        Buffer.from(apdu).includes(Buffer.from(privateAids[0], "hex"))
      )
        return reply([], 0x6f00);
    }
    if (apdu[1] === 0xe4) {
      calls.deletes.push(
        Buffer.from(apdu.slice(7, -1)).toString("hex").toUpperCase(),
      );
      if (calls.deletes.length === 3) state = "blank";
    }
    return reply();
  };
  const deps = {
    sdk: {
      ...sdk,
      readChipIdentity: async () => {
        if (wrongChip) throw Error("private chip text");
      },
      openSession: async () => {
        calls.auth++;
        if (authFailure) throw Error("private auth text");
        return { send: secure };
      },
      parseRegistryEntries: (data) => {
        const entries = [];
        let at = 0;
        while (at < data.length) {
          const n = data[at + 1],
            body = data.slice(at + 2, at + 2 + n);
          entries.push({
            aid: Buffer.from(body.slice(2, 2 + body[1]))
              .toString("hex")
              .toUpperCase(),
          });
          at += 2 + n;
        }
        return entries;
      },
      transmit: async (tx, apdu) => {
        if (apdu[1] === 0xa4)
          return apdu[5] === 0xf0 &&
            Buffer.from(apdu.slice(5, -1)).toString("hex").toUpperCase() ===
              privateAids[0] &&
            state !== "blank"
            ? reply(Buffer.from("CPROT\x02"))
            : reply([], 0x6a82);
        if (apdu[1] === 0x7d) {
          const b = Buffer.alloc(16);
          b.writeUInt16BE(30000);
          b.writeUInt16BE(lowCommit ? 20 : 512, 6);
          b.writeUInt16BE(lowCommit ? 20 : 512, 8);
          if (after) {
            b.writeUInt16BE(16384, 10);
            b.writeUInt16BE(12288, 12);
            b[14] = 2;
          }
          b[15] = 5;
          return reply(b);
        }
        if (apdu[1] === 0x7a)
          return reply(Buffer.from(original.context.cardKey, "hex"));
        if (apdu[1] === 0x7e) {
          if (setupUncertain) throw Error("private setup timeout");
          if (setupRefusal) return reply([], 0x6a84);
          after = true;
          return reply([1]);
        }
        if (apdu[1] === 0x78) return reply([apdu[5] + 1]);
        if (apdu[1] === 0x71) return reply([apdu[5]]);
        if (apdu[1] === 0x72) return reply([0]);
        if (apdu[1] === 0x73) return reply([2]);
        if (apdu[1] === 0x74) {
          if (signFailure) throw Error("private timeout text");
          state = "signed";
          return reply(scope);
        }
        if (apdu[1] === 0x7c) return reply(scope);
        if (apdu[1] === 0x75) {
          const off = apdu[6] * 256 + apdu[7],
            b = Buffer.from(canonical.subarray(off, off + apdu[8]));
          if (corruptPacket && off === 0) b[50] ^= 1;
          return reply(b);
        }
        if (apdu[1] === 0x77) {
          state = "retired";
          return reply([1]);
        }
        if (apdu[1] === 0x76)
          return reply(
            state === "signed"
              ? [63, 88, 0, 2, 126, 0]
              : [64, 90, 0, 0, 128, 0],
          );
        throw Error("unexpected synthetic APDU");
      },
    },
    openBridge: async () => {
      calls.opens++;
      return {
        tx: async () => {
          throw Error("raw transmission unexpected");
        },
        close: async () => {
          calls.closes++;
        },
      };
    },
    onStage: (name) => calls.stages.push(name),
  };
  return { calls, deps };
}
test("preview and pins refuse changed artifacts before opening a reader", async (t) => {
  const o = fixture(t),
    f = fake();
  const p = await runCompact({ ...o, execute: false }, f.deps);
  assert.equal(p.cardAccessed, false);
  assert.equal(f.calls.opens, 0);
  await assert.rejects(
    runCompact({ ...o, runnerHash: "0".repeat(64) }, f.deps),
  );
  fs.appendFileSync(path.join(path.dirname(o.manifest), "load-file.bin"), "x");
  assert.throws(() => compactArtifact(o));
  assert.equal(f.calls.opens, 0);
});
test("one bounded synthetic payment verifies both signatures before retirement and exact cleanup", async (t) => {
  const o = fixture(t),
    f = fake();
  const r = await runCompact(o, f.deps);
  assert.equal(r.status, "complete");
  assert.equal(r.packetBytes, 559);
  assert.equal(f.calls.auth, 2);
  assert.equal(f.calls.closes, 1);
  assert.equal(f.calls.deletes.length, 3);
  assert.ok(
    f.calls.stages.indexOf("verify-packet") <
      f.calls.stages.indexOf("retire-fixture"),
  );
  assert.equal(fs.statSync(o.journal).mode & 0o777, 0o600);
  await assert.rejects(runCompact(o, f.deps));
  assert.equal(f.calls.opens, 1);
  const cleanupOptions = fixture(t),
    cleanupFake = fake();
  const cleaned = await runCompact(
    { ...cleanupOptions, execute: false, cleanupOnly: true },
    cleanupFake.deps,
  );
  assert.equal(cleaned.status, "cleaned");
  assert.equal(cleanupFake.calls.auth, 1);
  assert.ok(!cleanupFake.calls.stages.includes("setup-fixture"));
});
test("identity, registry and authentication failures stop without mutation retries or leaked text", async (t) => {
  for (const mode of [
    { wrongChip: true },
    { authFailure: true },
    { unknownRegistry: true },
  ]) {
    const o = fixture(t),
      f = fake(mode);
    await assert.rejects(runCompact(o, f.deps), /compact stopped/);
    assert.equal(f.calls.auth, mode.wrongChip ? 0 : 1);
    assert.equal(f.calls.deletes.length, 0);
    assert.equal(f.calls.closes, 1);
    assert.doesNotMatch(
      fs.readFileSync(o.journal, "utf8"),
      /private (auth|chip)/,
    );
  }
});
test("uncertain signing preserves its journal and never retires, retries or cleans up", async (t) => {
  const o = fixture(t),
    f = fake({ signFailure: true });
  await assert.rejects(runCompact(o, f.deps));
  assert.equal(f.calls.auth, 1);
  assert.equal(f.calls.deletes.length, 0);
  assert.equal(
    f.calls.stages.filter((x) => x === "sign-and-publish").length,
    1,
  );
  assert.ok(!f.calls.stages.includes("retire-fixture"));
  assert.equal(
    JSON.parse(fs.readFileSync(o.journal)).stage,
    "sign-and-publish",
  );
});
test("insufficient commit capacity and corrupted exports stop before their next mutation", async (t) => {
  for (const mode of [{ lowCommit: true }, { corruptPacket: true }]) {
    const o = fixture(t),
      f = fake(mode);
    await assert.rejects(runCompact(o, f.deps));
    assert.ok(!f.calls.stages.includes("retire-fixture"));
    assert.equal(f.calls.deletes.length, 0);
    if (mode.lowCommit) assert.ok(!f.calls.stages.includes("setup-fixture"));
  }
});
test("the raw command ceiling stops a faulty host loop before authentication", async (t) => {
  const o = fixture(t),
    f = fake();
  let sent = 0;
  f.deps.openBridge = async () => ({
    tx: async () => {
      sent++;
      return [0x90, 0];
    },
    close: async () => {},
  });
  f.deps.sdk.readChipIdentity = async (tx) => {
    for (let i = 0; i < 513; i++) await tx([0x80, 0xca, 0x9f, 0x7f, 0]);
  };
  await assert.rejects(
    runCompact(o, f.deps),
    (e) => e.code === "drill-bound-exceeded",
  );
  assert.equal(sent, 512);
  assert.equal(f.calls.auth, 0);
});
test("declared creation refusal cleans only through the explicit approved branch", async (t) => {
  for (const enabled of [false, true]) {
    const o = fixture(t),
      f = fake({ installRefusal: true });
    if (enabled) {
      const r = await runCompact(
        { ...o, cleanupOnDeclaredRefusal: true },
        f.deps,
      );
      assert.equal(r.status, "declared-refusal-cleaned");
      assert.equal(f.calls.deletes.length, 3);
    } else {
      await assert.rejects(runCompact(o, f.deps));
      assert.equal(f.calls.deletes.length, 0);
    }
    assert.ok(!f.calls.stages.includes("setup-fixture"));
  }
});
test("only declared setup refusals admit cleanup; an uncertain setup delivery stays retained", async (t) => {
  for (const uncertain of [false, true]) {
    const o = fixture(t),
      f = fake(uncertain ? { setupUncertain: true } : { setupRefusal: true });
    if (uncertain) {
      await assert.rejects(
        runCompact({ ...o, cleanupOnDeclaredRefusal: true }, f.deps),
      );
      assert.equal(f.calls.deletes.length, 0);
    } else {
      const r = await runCompact(
        { ...o, cleanupOnDeclaredRefusal: true },
        f.deps,
      );
      assert.equal(r.status, "declared-refusal-cleaned");
      assert.equal(f.calls.deletes.length, 3);
    }
    assert.ok(!f.calls.stages.includes("sign-and-publish"));
  }
});
test("packet verification rejects altered scope and transport policy permits only the fixed fixture", () => {
  assert.throws(() =>
    verifyPacket(Buffer.alloc(33), Buffer.alloc(45), Buffer.alloc(559)),
  );
  assert.equal(workload().loads.length, 2);
  execFileSync("python3", [path.join(__dirname, "test_compact_bridge.py")], {
    stdio: "pipe",
  });
});
