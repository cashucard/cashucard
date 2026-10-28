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
  verifyPlatformRegistry,
  parseBridgeMessage,
} = require("./run-probe.cjs");
const hash = (b) => createHash("sha256").update(b).digest("hex");
function fixture(t, { format = 1, poolBytes = 16384, layout = "single" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "resource-runner-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cap = Buffer.from("synthetic CAP; no hardware fixture");
  const load = Buffer.from([0xc4, 1, 0]);
  const manifest = {
    kind: "resource-probe-only",
    packageAid: "F0434153485550524F4245",
    poolBytes,
    ...(format === 3
      ? {
          probeFormat: 3,
          probeProfile: "post-install-reservation",
          poolLayout: "single",
          supportedPoolBytes: [256, 4096, 16384],
        }
      : {}),
    ...(format === 2
      ? {
          probeFormat: 2,
          probeProfile: poolBytes
            ? layout === "4x4096"
              ? "segmented-pool-allocation"
              : "pool-allocation"
            : "constructor-control",
          poolLayout: layout,
        }
      : {}),
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
  probePresent = false,
  installProbeSw = 0x9000,
  installProbeData = [],
  installProbeTransportFailure = false,
  probeFormat = 1,
  poolBytes = 16384,
  measurementSw = 0x9000,
  measurementData = [],
  commitCapacity = 512,
  loadSw = 0x9000,
  reservationReply = [0, 0, 0],
  reservationTransportFailure = false,
  reservationObservedBytes,
} = {}) {
  const calls = {
    opens: 0,
    closes: 0,
    authentications: 0,
    mutations: 0,
    loads: 0,
    dummy: 0,
    reservations: 0,
    registry: 0,
    deletes: 0,
    creates: 0,
  };
  let reserved = 0,
    attempted = 0;
  const activePool = () => (probeFormat === 3 ? reserved : poolBytes);
  let marker = 0,
    installed = probePresent;
  const tx = async (apdu) => {
    if (transportFailure) {
      throw new Error("lost reader");
    }
    const ins = apdu[1];
    if (ins === 0xa4) {
      const aid = Buffer.from(apdu.slice(5, 5 + apdu[4])).toString("hex");
      if (installed && aid === "f0434153485550524f424501") {
        return [
          ...Buffer.from("PROBE"),
          probeFormat,
          activePool() >> 8,
          activePool() & 0xff,
          0x90,
          0,
        ];
      }
      return present ? [0x90, 0] : [0x6a, 0x82];
    }
    if (ins === 0xf2) {
      calls.registry++;
      const data =
        typeof registryData === "function"
          ? registryData(apdu[2], calls)
          : registryData;
      return [...data, registrySw >> 8, registrySw & 0xff];
    }
    if (ins === 0x7d) {
      if (measurementSw !== 0x9000)
        return [...measurementData, measurementSw >> 8, measurementSw & 0xff];
      if (probeFormat === 2 || probeFormat === 3) {
        const data = Buffer.alloc(16);
        data.writeUInt16BE(1000, 0);
        data.writeUInt16BE(100, 2);
        data.writeUInt16BE(200, 4);
        data.writeUInt16BE(commitCapacity, 6);
        data.writeUInt16BE(commitCapacity, 8);
        data.writeUInt16BE(activePool(), 10);
        data[12] = marker;
        data[13] = probeFormat;
        data[15] = attempted;
        return [...data, 0x90, 0];
      }
      const data = Buffer.alloc(24);
      data.writeUInt16BE(16384, 20);
      data[22] = marker;
      data[23] = 1;
      return [...data, 0x90, 0];
    }
    if (ins === 0x7c) {
      calls.reservations++;
      attempted = 1;
      if (reservationTransportFailure)
        throw new Error("lost reservation reply");
      if (reservationReply[0] === 0) reserved = apdu[5] * 256 + apdu[6];
      if (reservationObservedBytes !== undefined)
        reserved = reservationObservedBytes;
      return [...reservationReply, 0x90, 0];
    }
    if (ins === 0x7e) {
      calls.dummy++;
      marker = 1;
      return [1, 0x90, 0];
    }
    if (ins === 0xe6) {
      calls.mutations++;
      installed = true;
      if (apdu[2] === 0x0c && ++calls.creates === 2) {
        if (installProbeTransportFailure) throw new Error("lost reader");
        if (installProbeSw !== 0x9000)
          return [
            ...installProbeData,
            installProbeSw >> 8,
            installProbeSw & 0xff,
          ];
      }
    }
    if (ins === 0xe8) {
      calls.loads++;
      if (loadSw !== 0x9000) return [loadSw >> 8, loadSw & 0xff];
    }
    if (ins === 0xe8 || ins === 0xe4) {
      calls.mutations++;
      if (ins === 0xe4) calls.deletes++;
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
    registryCommand: (kind) => [
      0x80,
      0xf2,
      kind === "applications" ? 0x40 : 0x20,
      2,
      2,
      0x4f,
      0,
      0,
    ],
    parseRegistryEntries: (data) => {
      if (registryParseFailure)
        throw new Error("untrusted error with secret text");
      return typeof registryEntries === "function"
        ? registryEntries(data)
        : registryEntries;
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
  await assert.rejects(runProbe({ ...options, inspectRegistry: true }, fake));
  await assert.rejects(
    runProbe(
      {
        ...options,
        platformBaseline: true,
        chip: "cplc-v1:4790d3213180072976207515",
      },
      fake,
    ),
  );
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

// Public load-file response from the separately approved 09336320 inspection.
const PLATFORM_HEX = [
  "e31b4f07a00000015153509f700101ce02ffffcc08a000000151000000",
  "e31b4f07a00000006202049f700101ce020100cc08a000000151000000",
  "e31b4f07a00000006202029f700101ce020103cc08a000000151000000",
];
const platformRegistry = (frames = PLATFORM_HEX) => ({
  pages: [
    { kind: "applications", page: 0, sw: "6a88", data: "" },
    { kind: "load-files", page: 0, sw: "9000", data: frames.join("") },
  ],
  entries: frames.map((frame) => ({
    kind: "load-files",
    aid: frame.slice(8, 22).toUpperCase(),
  })),
});

test("observed platform baseline is exact, required and never authorizes other objects", () => {
  assert.doesNotThrow(() => verifyPlatformRegistry(platformRegistry(), []));
  // Pagination and order are not package identity, but every full entry is pinned.
  const reordered = platformRegistry([...PLATFORM_HEX].reverse());
  const hex = reordered.pages[1].data;
  reordered.pages.splice(
    1,
    1,
    { kind: "load-files", page: 0, sw: "6310", data: hex.slice(0, 30) },
    { kind: "load-files", page: 1, sw: "9000", data: hex.slice(30) },
  );
  assert.doesNotThrow(() => verifyPlatformRegistry(reordered, []));
  for (const frames of [
    PLATFORM_HEX.slice(1),
    [...PLATFORM_HEX, PLATFORM_HEX[0]],
    [PLATFORM_HEX[0].replace("ce02ffff", "ce020000"), ...PLATFORM_HEX.slice(1)],
    [PLATFORM_HEX[0].slice(0, -2) + "01", ...PLATFORM_HEX.slice(1)],
    [...PLATFORM_HEX, "e3094f07a0000001519999"],
  ])
    assert.throws(() => verifyPlatformRegistry(platformRegistry(frames), []));
  const aid = Buffer.from("F0434153485550524F4245", "hex");
  const privateFrame = Buffer.from([
    0xe3,
    aid.length + 2,
    0x4f,
    aid.length,
    ...aid,
  ]).toString("hex");
  const installed = platformRegistry([...PLATFORM_HEX, privateFrame]);
  installed.entries[3].aid = "F0434153485550524F4245";
  assert.throws(() => verifyPlatformRegistry(installed, []));
  assert.doesNotThrow(() =>
    verifyPlatformRegistry(installed, ["F0434153485550524F4245"]),
  );
  installed.entries[3].kind = "applications";
  assert.throws(() =>
    verifyPlatformRegistry(installed, ["F0434153485550524F4245"]),
  );
});

test("explicit platform profile reaches the drill but stops before cleanup if baseline changes", async (t) => {
  for (const losePlatform of [false, true]) {
    const options = fixture(t);
    const fake = simulated({
      registryData: (p1, calls) =>
        p1 === 0x40 || (losePlatform && calls.dummy)
          ? []
          : [...Buffer.from(PLATFORM_HEX.join(""), "hex")],
      registryEntries: (data) =>
        data.length ? platformRegistry().entries : [],
    });
    if (losePlatform) {
      await assert.rejects(
        runProbe({ ...options, platformBaseline: true }, fake),
      );
      assert.equal(fake.calls.deletes, 0);
      assert.equal(
        JSON.parse(fs.readFileSync(options.journal)).failure.code,
        "platform-registry",
      );
    } else {
      const result = await runProbe(
        { ...options, platformBaseline: true },
        fake,
      );
      assert.equal(result.status, "complete");
      assert.equal(fake.calls.deletes, 3);
    }
    assert.equal(fake.calls.dummy, 1);
    assert.equal(fake.calls.closes, 1);
  }
});

test("explicit cleanup removes only the private probe without entering the install or measurement path", async (t) => {
  const options = fixture(t),
    fake = simulated({ probePresent: true });
  const result = await runProbe(
    { ...options, execute: false, cleanupOnly: true },
    fake,
  );
  assert.equal(result.status, "cleaned");
  assert.equal(fake.calls.authentications, 1);
  assert.equal(fake.calls.loads, 0);
  assert.equal(fake.calls.creates, 0);
  assert.equal(fake.calls.dummy, 0);
  assert.equal(fake.calls.deletes, 3);
  assert.equal(fake.calls.closes, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(options.journal)).stage,
    "factory-blank-ready-for-ccp",
  );
});

test("INSTALL rejection retains its public status word and stops without automatic cleanup", async (t) => {
  const options = fixture(t),
    fake = simulated({ installProbeSw: 0x6a84 });
  await assert.rejects(runProbe(options, fake));
  const stored = JSON.parse(fs.readFileSync(options.journal));
  assert.equal(stored.stage, "install-01");
  assert.equal(stored.failure.code, "card-status-6a84");
  assert.equal(fake.calls.deletes, 0);
  assert.equal(fake.calls.dummy, 0);
  assert.equal(fake.calls.closes, 1);
});

test("format-2 control proves installation and queries without a dummy publication", async (t) => {
  const options = fixture(t, { format: 2, poolBytes: 0 });
  const fake = simulated({ probeFormat: 2, poolBytes: 0 });
  const result = await runProbe(options, fake);
  assert.equal(result.status, "complete");
  assert.equal(result.before.poolBytes, 0);
  assert.equal(result.before.reportedAvailability.persistent, 1000);
  assert.equal(fake.calls.dummy, 0);
  assert.equal(fake.calls.deletes, 3);
});

test("format-2 pool publishes once only with available diagnostics and capacity", async (t) => {
  for (const scenario of ["normal", "unavailable", "small-commit"]) {
    const options = fixture(t, { format: 2 });
    const fake = simulated({
      probeFormat: 2,
      measurementSw: scenario === "unavailable" ? 0x6f00 : 0x9000,
      commitCapacity: scenario === "small-commit" ? 64 : 512,
    });
    const result = await runProbe(options, fake);
    assert.equal(result.status, "complete");
    assert.equal(fake.calls.dummy, scenario === "normal" ? 1 : 0);
    assert.equal(fake.calls.deletes, 3);
    if (scenario === "unavailable")
      assert.equal(result.before.status, "unavailable");
    if (scenario === "small-commit")
      assert.equal(result.dummySkipped, "reported-commit-capacity-below-128");
  }
});

test("format-2 saturation is explicit and impossible commit counters are rejected", () => {
  const data = Buffer.alloc(16);
  data.writeUInt16BE(32767, 0);
  data.writeUInt16BE(512, 6);
  data.writeUInt16BE(512, 8);
  data[13] = 2;
  data[14] = 1;
  const result = measurements(data, 2, 0);
  assert.equal(result.saturatedMask, 1);
  assert.equal(result.reportedAvailability.persistent, 32767);
  for (const mutate of [
    (b) => {
      b[14] = 0;
    },
    (b) => {
      b[13] = 1;
    },
    (b) => {
      b[15] = 1;
    },
    (b) => {
      b.writeUInt16BE(513, 8);
    },
    (b) => {
      b.writeUInt16BE(65535, 6);
    },
  ]) {
    const broken = Buffer.from(data);
    mutate(broken);
    assert.throws(() => measurements(broken, 2, 0));
  }
});

test("unexpected measurement refusals or refusal data stop without automatic cleanup", async (t) => {
  for (const config of [
    { measurementSw: 0x6982 },
    { measurementSw: 0x6f00, measurementData: [1] },
  ]) {
    const options = fixture(t, { format: 2 });
    const fake = simulated({ probeFormat: 2, ...config });
    await assert.rejects(runProbe(options, fake));
    assert.equal(fake.calls.deletes, 0);
    assert.equal(fake.calls.dummy, 0);
    assert.equal(fake.calls.closes, 1);
    assert.equal(
      JSON.parse(fs.readFileSync(options.journal)).stage,
      "read-measurements",
    );
  }
});

test("smaller and segmented allocation profiles retain the measured publication and cleanup path", async (t) => {
  for (const [poolBytes, layout] of [
    [256, "single"],
    [4096, "single"],
    [16384, "4x4096"],
  ]) {
    const options = fixture(t, { format: 2, poolBytes, layout });
    const fake = simulated({ probeFormat: 2, poolBytes });
    const result = await runProbe(options, fake);
    assert.equal(result.status, "complete");
    assert.equal(result.poolLayout, layout);
    assert.equal(fake.calls.dummy, 1);
    assert.equal(fake.calls.deletes, 3);
  }
});

test("explicit declared INSTALL refusals are captured, cleaned and stop the allocation sequence", async (t) => {
  for (const code of [0x6f00, 0x6a84]) {
    const options = fixture(t, { format: 2, poolBytes: 16384 });
    const fake = simulated({
      probeFormat: 2,
      poolBytes: 16384,
      installProbeSw: code,
    });
    const result = await runProbe(
      { ...options, cleanupOnInstallRefusal: true },
      fake,
    );
    assert.equal(result.status, "install-refused-cleaned");
    assert.equal(fake.calls.authentications, 2);
    assert.equal(fake.calls.deletes, 3);
    assert.equal(fake.calls.dummy, 0);
    const stored = JSON.parse(fs.readFileSync(options.journal));
    assert.equal(
      stored.installRefusal.code,
      "card-status-" + code.toString(16),
    );
    assert.equal(stored.stage, "factory-blank-ready-for-ccp");
  }
});

test("declared-refusal cleanup stops at an unexpected registry and retains the first refusal", async (t) => {
  const options = fixture(t, { format: 2, poolBytes: 16384 });
  const fake = simulated({
    probeFormat: 2,
    poolBytes: 16384,
    installProbeSw: 0x6f00,
  });
  fake.sdk.parseRegistryEntries = () =>
    fake.calls.creates >= 2 ? [{ aid: "A0000001519999" }] : [];
  await assert.rejects(
    runProbe({ ...options, cleanupOnInstallRefusal: true }, fake),
  );
  assert.equal(fake.calls.deletes, 0);
  const stored = JSON.parse(fs.readFileSync(options.journal));
  assert.equal(stored.installRefusal.code, "card-status-6f00");
  assert.equal(stored.failure.code, "registry-objects");
  assert.equal(stored.status, "stopped");
});

test("unlisted, nonempty and ambiguous creation failures cannot trigger declared-refusal cleanup", async (t) => {
  for (const config of [
    { installProbeSw: 0x6982 },
    { installProbeSw: 0x6f00, installProbeData: [1] },
    { installProbeTransportFailure: true },
  ]) {
    const options = fixture(t, { format: 2, poolBytes: 16384 });
    const fake = simulated({ probeFormat: 2, poolBytes: 16384, ...config });
    await assert.rejects(
      runProbe({ ...options, cleanupOnInstallRefusal: true }, fake),
    );
    assert.equal(fake.calls.authentications, 1);
    assert.equal(fake.calls.deletes, 0);
    assert.equal(fake.calls.closes, 1);
  }
});

test("a refused refusal-journal write prevents a cleanup channel and all deletes", async (t) => {
  const options = fixture(t, { format: 2, poolBytes: 16384 });
  const fake = simulated({
    probeFormat: 2,
    poolBytes: 16384,
    installProbeSw: 0x6f00,
  });
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (
      target === options.journal &&
      JSON.parse(fs.readFileSync(source)).installRefusal
    )
      throw new Error("journal unavailable");
    return rename(source, target);
  };
  try {
    await assert.rejects(
      runProbe({ ...options, cleanupOnInstallRefusal: true }, fake),
    );
    assert.equal(fake.calls.authentications, 1);
    assert.equal(fake.calls.deletes, 0);
  } finally {
    fs.renameSync = rename;
  }
});

test("declared cleanup rejects other modes/profiles and does not act on a LOAD refusal", async (t) => {
  for (const config of [{ format: 1 }, { format: 2, poolBytes: 0 }]) {
    const options = fixture(t, config),
      fake = simulated();
    await assert.rejects(
      runProbe({ ...options, cleanupOnInstallRefusal: true }, fake),
    );
    assert.equal(fake.calls.opens, 0);
  }
  const options = fixture(t, { format: 2, poolBytes: 256 }),
    fake = simulated({ probeFormat: 2, poolBytes: 256, loadSw: 0x6a84 });
  await assert.rejects(
    runProbe({ ...options, cleanupOnInstallRefusal: true }, fake),
  );
  assert.equal(fake.calls.deletes, 0);
  assert.equal(fake.calls.authentications, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(options.journal)).stage,
    "load-block-0",
  );
});

test("one identical post-install artifact measures baseline then a single requested reservation", async (t) => {
  for (const reserveBytes of [256, 4096, 16384]) {
    const options = {
      ...fixture(t, { format: 3, poolBytes: 0 }),
      reserveBytes,
    };
    const fake = simulated({ probeFormat: 3, poolBytes: 0 });
    const result = await runProbe(options, fake);
    assert.equal(result.status, "complete");
    assert.equal(result.before.poolBytes, 0);
    assert.equal(result.afterReservation.poolBytes, reserveBytes);
    assert.equal(result.after.publicationByte, 1);
    assert.equal(fake.calls.reservations, 1);
    assert.equal(fake.calls.dummy, 1);
    assert.equal(fake.calls.deletes, 3);
  }
});

test("explicit post-install refusal cleanup retains the reason and skips dummy publication", async (t) => {
  const options = {
    ...fixture(t, { format: 3, poolBytes: 0 }),
    reserveBytes: 256,
    cleanupOnAllocationRefusal: true,
  };
  const fake = simulated({
    probeFormat: 3,
    poolBytes: 0,
    reservationReply: [1, 0, 5],
  });
  const result = await runProbe(options, fake);
  assert.equal(result.status, "allocation-refused-cleaned");
  assert.deepEqual(result.allocationRefusal, {
    category: "system-exception",
    reason: 5,
  });
  assert.equal(fake.calls.reservations, 1);
  assert.equal(fake.calls.dummy, 0);
  assert.equal(fake.calls.deletes, 3);
  assert.equal(fake.calls.authentications, 2);
});

test("ambiguous or undeclared post-install reservation results stop without cleanup", async (t) => {
  for (const config of [
    { reservationReply: [1, 0, 5], approved: false },
    { reservationReply: [2, 0, 0], approved: true },
    { reservationReply: [1, 0, 0], approved: true },
    { reservationTransportFailure: true, approved: true },
  ]) {
    const options = {
      ...fixture(t, { format: 3, poolBytes: 0 }),
      reserveBytes: 256,
      cleanupOnAllocationRefusal: config.approved,
    };
    const fake = simulated({ probeFormat: 3, poolBytes: 0, ...config });
    await assert.rejects(runProbe(options, fake));
    assert.equal(fake.calls.reservations, 1);
    assert.equal(fake.calls.dummy, 0);
    assert.equal(fake.calls.deletes, 0);
    assert.equal(fake.calls.authentications, 1);
  }
});

test("post-install admission rejects unbounded sizes and misplaced cleanup flags before reader access", async (t) => {
  for (const reserveBytes of [undefined, 0, 8192]) {
    const options = {
      ...fixture(t, { format: 3, poolBytes: 0 }),
      reserveBytes,
    };
    const fake = simulated();
    await assert.rejects(runProbe(options, fake));
    assert.equal(fake.calls.opens, 0);
  }
  const options = {
    ...fixture(t, { format: 2, poolBytes: 256 }),
    cleanupOnAllocationRefusal: true,
  };
  const fake = simulated();
  await assert.rejects(runProbe(options, fake));
  assert.equal(fake.calls.opens, 0);
});

test("reservation refusal cleanup requires persisted evidence and matching zero-pool state", async (t) => {
  for (const failedJournal of [false, true]) {
    const options = {
      ...fixture(t, { format: 3, poolBytes: 0 }),
      reserveBytes: 256,
      cleanupOnAllocationRefusal: true,
    };
    const fake = simulated({
      probeFormat: 3,
      poolBytes: 0,
      reservationReply: [1, 0, 5],
      ...(!failedJournal ? { reservationObservedBytes: 256 } : {}),
    });
    const rename = fs.renameSync;
    if (failedJournal)
      fs.renameSync = (source, target) => {
        if (
          target === options.journal &&
          JSON.parse(fs.readFileSync(source)).allocationRefusal
        )
          throw new Error("journal unavailable");
        return rename(source, target);
      };
    try {
      await assert.rejects(runProbe(options, fake));
      assert.equal(fake.calls.deletes, 0);
      assert.equal(fake.calls.authentications, 1);
      assert.equal(fake.calls.dummy, 0);
    } finally {
      fs.renameSync = rename;
    }
  }
});

test("bridge diagnostics retain fixed errors and numeric PCSC codes without arbitrary payloads", () => {
  for (const pcscCode of ["80100016", undefined]) {
    const message = JSON.stringify({
      error: "reader-transmit-failed",
      pcscCode,
      detail: "private authentication text",
    });
    assert.throws(
      () => parseBridgeMessage(message),
      (e) =>
        e.code === "reader-transmit-failed" &&
        e.pcscCode === pcscCode &&
        !JSON.stringify(e).includes("private authentication text"),
    );
  }
  for (const message of [
    "invalid JSON",
    JSON.stringify({ error: "private authentication text" }),
    JSON.stringify({ error: "reader-transmit-failed", pcscCode: "secret" }),
    "null",
  ]) {
    assert.throws(
      () => parseBridgeMessage(message),
      (e) =>
        e.code === "reader-protocol-error" &&
        !JSON.stringify(e).includes("private authentication text"),
    );
  }
  assert.deepEqual(parseBridgeMessage('{"ready":true}'), { ready: true });
});

test("fixed reader diagnostics survive the protected journal and stopped result", async (t) => {
  const options = fixture(t);
  const fake = simulated();
  fake.sdk.readChipIdentity = async () =>
    parseBridgeMessage(
      '{"error":"reader-transmit-failed","pcscCode":"80100016","detail":"private text"}',
    );
  await assert.rejects(
    runProbe(options, fake),
    (e) =>
      e.probeFailure === "reader-transmit-failed" &&
      e.probePcscCode === "80100016",
  );
  const raw = fs.readFileSync(options.journal, "utf8");
  assert.deepEqual(JSON.parse(raw).failure, {
    code: "reader-transmit-failed",
    pcscCode: "80100016",
  });
  assert.equal(raw.includes("private text"), false);
  assert.equal(fake.calls.authentications, 0);
  assert.equal(fake.calls.deletes, 0);
  assert.equal(fake.calls.closes, 1);
});
