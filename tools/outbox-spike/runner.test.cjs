const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  runProbe,
  artifact,
  probeDelete,
  measurements,
} = require("./run-probe.cjs");
const hash = (b) => createHash("sha256").update(b).digest("hex");
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "resource-runner-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cap = Buffer.from("synthetic CAP; no hardware fixture");
  const load = Buffer.from([0xc4, 1, 0]);
  const manifest = {
    kind: "resource-probe-only",
    packageAid: "F0434153485550524F4245",
    poolBytes: 16384,
    capSha256: hash(cap),
    loadFileSha256: hash(load),
    loadFileSize: load.length,
  };
  const raw = JSON.stringify(manifest);
  fs.writeFileSync(path.join(directory, "manifest.json"), raw);
  fs.writeFileSync(path.join(directory, "resource-probe.cap"), cap);
  fs.writeFileSync(path.join(directory, "load-file.bin"), load);
  return {
    manifest: path.join(directory, "manifest.json"),
    manifestHash: hash(raw),
    chip: "cplc-v1:4790d3213041093363205547",
    reader: "ACS ACR122U PICC Interface",
    journal: path.join(directory, "journal.json"),
    execute: true,
    factoryResetConfirmed: true,
  };
}
function simulated({
  wrongChip = false,
  present = false,
  authFailure = false,
  transportFailure = false,
  registrySw = 0x9000,
  registryData = [],
  registryEntries = [],
  registryParseFailure = false,
} = {}) {
  const calls = {
    opens: 0,
    closes: 0,
    authentications: 0,
    mutations: 0,
    loads: 0,
    dummy: 0,
    registry: 0,
  };
  let marker = 0,
    installed = false;
  const tx = async (apdu) => {
    if (transportFailure) {
      throw new Error("lost reader");
    }
    const ins = apdu[1];
    if (ins === 0xa4) {
      const aid = Buffer.from(apdu.slice(5, 5 + apdu[4])).toString("hex");
      if (installed && aid === "f0434153485550524f424501") {
        return [...Buffer.from("50524f4245014000", "hex"), 0x90, 0];
      }
      return present ? [0x90, 0] : [0x6a, 0x82];
    }
    if (ins === 0xf2) {
      calls.registry++;
      return [...registryData, registrySw >> 8, registrySw & 0xff];
    }
    if (ins === 0x7d) {
      const data = Buffer.alloc(24);
      data.writeUInt16BE(16384, 20);
      data[22] = marker;
      data[23] = 1;
      return [...data, 0x90, 0];
    }
    if (ins === 0x7e) {
      calls.dummy++;
      marker = 1;
      return [1, 0x90, 0];
    }
    if (ins === 0xe6) {
      calls.mutations++;
      installed = true;
    }
    if (ins === 0xe8) {
      calls.loads++;
    }
    if (ins === 0xe8 || ins === 0xe4) {
      calls.mutations++;
    }
    return [0x90, 0];
  };
  const sdk = {
    fromHex: (value) => [...Buffer.from(value, "hex")],
    toHex: (value) => Buffer.from(value).toString("hex"),
    ISD_AID: [0xa0, 0, 0, 1, 0x51, 0, 0, 0],
    CARD_AID: [1],
    TAG_AID: [2],
    OPENER_AID: [3],
    CASHU_PACKAGE_AID: [4],
    FACTORY_KEYS: {},
    readChipIdentity: async () => {
      if (wrongChip) {
        throw new Error("chip mismatch");
      }
    },
    selectAid: (aid) => [0, 0xa4, 4, 0, aid.length, ...aid, 0],
    transmit: async (transport, command) => {
      const raw = await transport(command);
      return { data: raw.slice(0, -2), sw: (raw.at(-2) << 8) | raw.at(-1) };
    },
    openSession: async () => {
      calls.authentications++;
      if (authFailure) {
        throw new Error("wrong cryptogram");
      }
      return { send: (transport, command) => sdk.transmit(transport, command) };
    },
    registryCommand: () => [0x80, 0xf2, 0x20, 2, 2, 0x4f, 0, 0],
    parseRegistryEntries: () => {
      if (registryParseFailure)
        throw new Error("untrusted error with secret text");
      return registryEntries;
    },
    installForLoad: () => [0x80, 0xe6, 2],
    splitLoad: () => [[0x80, 0xe8, 0x80, 0]],
    installAndSelectable: () => [0x80, 0xe6, 0x0c],
  };
  return {
    calls,
    sdk,
    openBridge: async () => {
      calls.opens++;
      return {
        tx,
        close: async () => {
          calls.closes++;
        },
      };
    },
  };
}

test("preview and invalid consent/hash/load bytes never open a reader", async (t) => {
  const options = fixture(t),
    fake = simulated();
  const preview = await runProbe({ ...options, execute: false }, fake);
  assert.equal(preview.cardAccessed, false);
  await assert.rejects(
    runProbe({ ...options, factoryResetConfirmed: false }, fake),
  );
  await assert.rejects(
    runProbe({ ...options, manifestHash: "0".repeat(64) }, fake),
  );
  fs.writeFileSync(
    path.join(path.dirname(options.manifest), "load-file.bin"),
    "altered",
  );
  assert.throws(() => artifact(options.manifest, options.manifestHash));
  assert.equal(fake.calls.opens, 0);
});

test("wrong chip or an installed production applet stops before authentication", async (t) => {
  for (const kind of ["wrongChip", "present"]) {
    const options = fixture(t),
      fake = simulated({ [kind]: true });
    await assert.rejects(runProbe(options, fake));
    assert.equal(fake.calls.authentications, 0);
    assert.equal(fake.calls.mutations, 0);
    assert.equal(fake.calls.closes, 1);
  }
});

test("failed authentication and lost transport stop without a retry or cleanup write", async (t) => {
  for (const kind of ["authFailure", "transportFailure"]) {
    const options = fixture(t),
      fake = simulated({ [kind]: true });
    await assert.rejects(runProbe(options, fake));
    assert.equal(fake.calls.opens, 1);
    assert.equal(fake.calls.authentications, kind === "authFailure" ? 1 : 0);
    assert.equal(fake.calls.mutations, 0);
    assert.equal(fake.calls.closes, 1);
    assert.equal(
      JSON.parse(fs.readFileSync(options.journal)).status,
      "stopped",
    );
  }
});

test("successful drill commits once, cleans only the private package, and refuses journal reuse", async (t) => {
  const options = fixture(t),
    fake = simulated();
  const result = await runProbe(options, fake);
  assert.equal(result.status, "complete");
  assert.equal(fake.calls.authentications, 2);
  assert.equal(fake.calls.dummy, 1);
  assert.equal(fake.calls.closes, 1);
  const stored = JSON.parse(fs.readFileSync(options.journal));
  assert.equal(stored.stage, "factory-blank-ready-for-ccp");
  assert.equal(fs.statSync(options.journal).mode & 0o077, 0);
  await assert.rejects(runProbe(options, fake));
  assert.equal(fake.calls.opens, 1);
  for (const aid of [
    "A000000151000000",
    "F0434153485543415244",
    "D2760000850101",
  ]) {
    assert.throws(() => probeDelete(aid));
  }
  assert.throws(() => measurements(Buffer.alloc(24)));
});

test("a refused next-stage journal write prevents the next LOAD and leaves the run stopped", async (t) => {
  const options = fixture(t),
    fake = simulated();
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (
      target === options.journal &&
      JSON.parse(fs.readFileSync(source)).stage === "load-block-0"
    ) {
      throw new Error("journal unavailable");
    }
    return rename(source, target);
  };
  try {
    await assert.rejects(runProbe(options, fake), /load-block-0/);
    assert.equal(fake.calls.loads, 0);
    assert.equal(fake.calls.authentications, 1);
    assert.equal(fake.calls.closes, 1);
  } finally {
    fs.renameSync = rename;
  }
});

test("registry-only inspection records public evidence and cannot install or delete", async (t) => {
  const options = fixture(t),
    fake = simulated({
      registryData: [0xe3, 0],
      registryEntries: [{ aid: "A0000001515350" }],
    });
  const result = await runProbe(
    { ...options, execute: false, inspectRegistry: true },
    fake,
  );
  assert.equal(result.status, "inspected");
  assert.equal(fake.calls.authentications, 1);
  assert.equal(fake.calls.registry, 2);
  assert.equal(fake.calls.mutations, 0);
  assert.equal(fake.calls.dummy, 0);
  assert.equal(fake.calls.closes, 1);
  const stored = JSON.parse(fs.readFileSync(options.journal));
  assert.equal(stored.stage, "registry-inspection-complete");
  assert.equal(stored.registry.pages[0].sw, "9000");
  assert.equal(stored.registry.pages[0].data, "e300");
  assert.equal(stored.registry.entries[0].aid, "A0000001515350");
  await assert.rejects(runProbe({ ...options, inspectRegistry: true }, fake));
});

test("registry status, parse and unexpected-object failures preserve bounded evidence without secrets", async (t) => {
  const cases = [
    [{ registrySw: 0x6a86 }, "registry-status", "6a86"],
    [
      { registryData: [0xde, 0xad], registryParseFailure: true },
      "registry-format",
      "9000",
    ],
    [
      { registryEntries: [{ aid: "A0000001515350" }] },
      "registry-objects",
      "9000",
    ],
  ];
  for (const [settings, code, sw] of cases) {
    const options = fixture(t),
      fake = simulated(settings);
    await assert.rejects(runProbe(options, fake));
    const raw = fs.readFileSync(options.journal, "utf8"),
      stored = JSON.parse(raw);
    assert.equal(stored.failure.code, code);
    assert.equal(stored.registry.pages[0].sw, sw);
    assert.equal(raw.includes("secret text"), false);
    assert.equal(fake.calls.authentications, 1);
    assert.equal(fake.calls.mutations, 0);
    assert.equal(fake.calls.closes, 1);
  }
});
