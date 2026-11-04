/* Local-only integration driver. JavaCard runs in jCardSim, POS runs in fresh
 * Jest processes and phone relay runs separately with no merchant folder. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline");
const cc = require("../cardsim/cashu-crypto.cjs");
const { localHTTP } = require("./local-http.cjs");
const { crypto } = require("./node-adapter.cjs");
const { capturePacket, decodePacket } = require("./relay.js");
const { withPhaseJournal } = require("../outbox-spike/phase-journal.cjs");
const ROOT = path.resolve(__dirname, "../..");
const KEY =
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const LOGICAL_MINT = "https://cashucard-relay.invalid";
const INSTALLATION = "31".repeat(32);
const digestFile = (file) =>
  require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
const save = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cmd = (ins, data = []) => [
  0xb0,
  ins,
  0,
  0,
  data.length,
  ...data,
  ...(data.length ? [0] : []),
];
const hex = (b) => Buffer.from(b).toString("hex");
const n32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const b = (s) => [...Buffer.from(s, "hex")];

function simulator(artifact) {
  const child = spawn(
    "java",
    [
      "-cp",
      path.join(artifact, "sim-classes") +
        path.delimiter +
        path.join(ROOT, "tools/cardsim/target/cardsim.jar"),
      "CompactHarness",
      "--session",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines = createInterface({ input: child.stdout }),
    iterator = lines[Symbol.asyncIterator]();
  let stopped = false,
    commands = 0;
  child.on("error", () => lines.close());
  child.stderr.on("data", () => {});
  const next = async () => {
    let timer;
    try {
      return await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(Error("simulator deadline"));
          }, 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    get commands() {
      return commands;
    },
    async tx(apdu) {
      if (stopped) throw Error("simulator stopped");
      commands++;
      child.stdin.write(JSON.stringify({ steps: [hex(apdu)] }) + "\n");
      for (;;) {
        const line = await next();
        if (line.done) throw Error("simulator closed");
        if (!line.value.startsWith("COMPACT_RESULT:")) continue;
        const [result] = JSON.parse(line.value.slice(15));
        if (!result.hex.endsWith("9000"))
          throw Error("simulator status " + result.hex.slice(-4));
        return b(result.hex.slice(0, -4));
      }
    },
    async close() {
      stopped = true;
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      lines.close();
    },
  };
}

function pos(
  posRoot,
  directory,
  stage,
  { crash = false, expectedSignal } = {},
) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(posRoot, "node_modules/jest/bin/jest.js"),
      "--selectProjects",
      "ios",
      "--runInBand",
      "--watchman=false",
      "__tests__/integration/cardRelayDemo.test.ts",
    ],
    {
      cwd: posRoot,
      env: {
        ...process.env,
        MINT_URL: "",
        CARDSIM_URL: "",
        LOCAL_RELAY_DIR: directory,
        LOCAL_RELAY_STAGE: stage,
        LOCAL_RELAY_CRASH_AFTER_INVENTORY: crash ? "1" : "0",
      },
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  fs.writeFileSync(
    path.join(directory, stage + (crash ? "-crash" : "") + ".log"),
    r.stdout + r.stderr,
    { mode: 0o600 },
  );
  if (expectedSignal) {
    assert.equal(r.signal, expectedSignal);
    return;
  }
  if (r.status !== 0)
    throw Error(
      "POS " +
        stage +
        " failed; inspect " +
        path.join(directory, stage + ".log"),
    );
}

async function prepare({ directory, origin, posRoot, artifact }) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const till = path.join(directory, "till"),
    phone = path.join(directory, "phone");
  fs.mkdirSync(till, { mode: 0o700 });
  fs.mkdirSync(phone, { mode: 0o700 });
  const http = localHTTP(origin);
  const catalogue = await http("/v1/keysets");
  const k = catalogue.keysets.find((k) => k.active && k.unit === "sat");
  assert.ok(k);
  assert.ok([16, 66].includes(k.id.length));
  const keys = (await http("/v1/keys/" + k.id)).keysets[0].keys;
  const quote = await http("/v1/mint/quote/bolt11", {
    amount: 12,
    unit: "sat",
  });
  let paid = false;
  for (let i = 0; i < 100; i++) {
    const q = await http("/v1/mint/quote/bolt11/" + quote.quote);
    if (q.state === "PAID") {
      paid = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(paid, "FakeWallet quote not paid");
  const funding = [8, 4].map((amount, slot) => {
    const nonce = require("node:crypto").randomBytes(32).toString("hex"),
      secret = cc.cardSecret(nonce, KEY),
      blind = cc.blind(secret);
    return {
      slot,
      generation: 1,
      amount,
      id: k.id,
      nonce,
      secret,
      B_: cc.hexOf(blind.B_),
      r: cc.hexOf(cc.bytes32(blind.r)),
    };
  });
  const issued = await http("/v1/mint/bolt11", {
    quote: quote.quote,
    outputs: funding.map((p) => ({ id: p.id, amount: p.amount, B_: p.B_ })),
  });
  const inputs = funding.map((p, i) => {
    assert.ok(
      cc.verifyBlindDleq(
        p.B_,
        issued.signatures[i].C_,
        issued.signatures[i].dleq.e,
        issued.signatures[i].dleq.s,
        keys[String(p.amount)],
      ),
    );
    return {
      slot: p.slot,
      generation: p.generation,
      amount: p.amount,
      id: p.id,
      nonce: p.nonce,
      secret: p.secret,
      C: cc.hexOf(
        cc.unblind(issued.signatures[i].C_, p.r, keys[String(p.amount)]),
      ),
    };
  });
  const merchantAmount =
    12 - Math.ceil((inputs.length * (k.input_fee_ppk ?? 0)) / 1000);
  save(path.join(till, "funding.json"), {
    mintOrigin: origin,
    pubkey: KEY,
    keysetId: k.id,
    merchantAmount,
    inputs,
  });
  pos(posRoot, till, "prepare");
  const prepared = read(path.join(till, "prepared-public.json"));
  assert.ok(prepared.outputs.length > 0);
  const sim = simulator(artifact);
  let capture;
  try {
    await sim.tx(b("00a404000bF04341534855434D505401"));
    await sim.tx(
      cmd(0x7e, [
        ...Array(8).fill(0),
        ...b(INSTALLATION),
        LOGICAL_MINT.length,
        ...Buffer.from(LOGICAL_MINT),
      ]),
    );
    await sim.tx(cmd(0x78, [0, k.id.length / 2, ...b(k.id)]));
    for (const p of inputs)
      await sim.tx(
        cmd(0x71, [
          p.slot,
          ...n32(p.generation),
          0,
          ...n32(p.amount),
          ...b(p.nonce + p.C),
        ]),
      );
    await sim.tx(
      cmd(0x72, [
        inputs.length,
        prepared.outputs.length,
        ...inputs.map((p) => p.slot),
      ]),
    );
    await sim.tx(
      cmd(
        0x73,
        prepared.outputs.flatMap((o) => [...n32(o.amount), 0, ...b(o.B_)]),
      ),
    );
    const signedScope = await sim.tx(cmd(0x74));
    assert.equal(signedScope.length, 45);
    // All merchant preparation is already on disk and the POS process exited.
    const policy = {
      mint: LOGICAL_MINT,
      cardKey: KEY,
      installation: INSTALLATION,
    };
    save(path.join(phone, "policy.json"), policy);
    await withPhaseJournal(
      path.join(phone, "relay.json"),
      { format: "private-assisted-relay-v1", state: "capturing" },
      async ({ save }) => {
        capture = await capturePacket({
          policy,
          crypto,
          save,
          readScope: () => sim.tx(cmd(0x7c, [signedScope[0]])),
          readPage: (offset, count) =>
            sim.tx(
              cmd(0x75, [signedScope[0], offset >> 8, offset & 255, count]),
            ),
        });
      },
    );
    const decoded = decodePacket(b(capture.packet), policy, crypto);
    assert.deepEqual(decoded.outputs, prepared.outputs);
    save(path.join(till, "signed-public.json"), {
      witness: decoded.witness,
      packetId: decoded.packetId,
    });
    pos(posRoot, till, "signed");
    save(path.join(directory, "prepared.json"), {
      format: "private-relay-demo-v1",
      origin,
      logicalMint: LOGICAL_MINT,
      merchantAmount,
      keysetBytes: k.id.length / 2,
      feePpk: k.input_fee_ppk ?? 0,
      packetId: decoded.packetId,
      packetBytes: capture.packet.length / 2,
      simulatorCommands: sim.commands,
      sourceHashes: Object.fromEntries(
        [
          "tools/assisted-relay/relay.js",
          "tools/assisted-relay/local-http.cjs",
          "tools/assisted-relay/node-adapter.cjs",
          "tools/assisted-relay/relay-worker.cjs",
          "tools/assisted-relay/demo.cjs",
          "tools/outbox-spike/phase-journal.cjs",
          "tools/cardsim/cashu-crypto.cjs",
          "tools/cardsim/target/cardsim.jar",
        ].map((file) => [file, digestFile(path.join(ROOT, file))]),
      ),
      posHashes: Object.fromEntries(
        [
          "__tests__/integration/cardRelayDemo.test.ts",
          "src/services/cashuMint.ts",
          "src/services/cashuSettlement.ts",
          "src/services/cashuTillStore.ts",
        ].map((file) => [file, digestFile(path.join(posRoot, file))]),
      ),
      simulatorHashes: {
        manifest: digestFile(path.join(artifact, "manifest.json")),
        harness: digestFile(
          path.join(artifact, "sim-classes/CompactHarness.class"),
        ),
      },
      cardSource: require("node:child_process")
        .execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        })
        .trim(),
      posSource: require("node:child_process")
        .execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: posRoot,
          encoding: "utf8",
        })
        .trim(),
    });
  } finally {
    await sim.close();
  }
}

async function main() {
  const [action, directory, origin, posRoot, artifact] = process.argv.slice(2);
  if (
    !["prepare", "relay", "recover", "race"].includes(action) ||
    ![directory, posRoot].every((v) => v && path.isAbsolute(v))
  )
    throw Error("demo arguments");
  // Validate the endpoint before creating files or spawning other processes.
  localHTTP(origin);
  if (action === "prepare") {
    if (!artifact || !path.isAbsolute(artifact))
      throw Error("artifact required");
    await prepare({ directory, origin, posRoot, artifact });
  } else if (action === "relay") {
    const r = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "relay-worker.cjs"),
        path.join(directory, "phone"),
        origin,
        "settle",
      ],
      { encoding: "utf8", timeout: 90000 },
    );
    fs.writeFileSync(
      path.join(directory, "phone", "worker.log"),
      r.stdout + r.stderr,
      { mode: 0o600 },
    );
    if (r.status !== 0) throw Error("phone relay failed; inspect worker.log");
    assert.equal(
      read(path.join(directory, "phone", "settle-result.json")).swapCalls,
      1,
    );
  } else if (action === "race") {
    const till = path.join(directory, "till"),
      phone = path.join(directory, "phone");
    const posChild = spawn(
      process.execPath,
      [
        path.join(posRoot, "node_modules/jest/bin/jest.js"),
        "--selectProjects",
        "ios",
        "--runInBand",
        "--watchman=false",
        "__tests__/integration/cardRelayDemo.test.ts",
      ],
      {
        cwd: posRoot,
        env: {
          ...process.env,
          MINT_URL: "",
          CARDSIM_URL: "",
          LOCAL_RELAY_DIR: till,
          LOCAL_RELAY_STAGE: "race",
          LOCAL_RELAY_CRASH_AFTER_INVENTORY: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const phoneChild = spawn(
      process.execPath,
      [path.join(__dirname, "relay-worker.cjs"), phone, origin, "race"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const children = [
      [posChild, till],
      [phoneChild, phone],
    ];
    const completions = children.map(
      ([child, folder]) =>
        new Promise((resolve, reject) => {
          let output = "";
          child.stdout.on("data", (v) => (output += v));
          child.stderr.on("data", (v) => (output += v));
          child.on("error", reject);
          child.once("exit", (code, signal) => {
            fs.writeFileSync(path.join(folder, "race-worker.log"), output, {
              mode: 0o600,
            });
            resolve({ code, signal });
          });
        }),
    );
    try {
      const started = Date.now();
      while (
        ![till, phone].every((folder) =>
          fs.existsSync(path.join(folder, "race-ready.json")),
        )
      ) {
        if (
          children.some(([child]) => child.exitCode !== null) ||
          Date.now() - started > 30000
        )
          throw Error("race participants did not reach swap barrier");
        await new Promise((r) => setTimeout(r, 10));
      }
      for (const folder of [till, phone])
        save(path.join(folder, "race-go.json"), {});
      for (const result of await Promise.all(completions))
        assert.equal(result.code, 0);
      assert.equal(read(path.join(phone, "race-result.json")).swapCalls, 1);
      save(path.join(directory, "race-verified.json"), {
        bothReachedSwapBarrier: true,
        phoneSwapAttempts: 1,
      });
    } finally {
      for (const [child] of children) if (child.exitCode === null) child.kill();
    }
  } else {
    const till = path.join(directory, "till"),
      phone = path.join(directory, "phone");
    const before = read(path.join(directory, "prepared.json"));
    assert.equal(before.origin, origin);
    if (
      read(path.join(till, "merchant-secure.json"))["@cashu_settled_proofs"] ===
      undefined
    )
      pos(posRoot, till, "recover", { crash: true, expectedSignal: "SIGKILL" });
    pos(posRoot, till, "recover");
    pos(posRoot, till, "replay");
    assert.deepEqual(
      read(path.join(till, "recover-result.json")),
      read(path.join(till, "replay-result.json")),
    );
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "relay-worker.cjs"), phone, origin, "replay"],
      { encoding: "utf8", timeout: 90000 },
    );
    if (r.status !== 0) throw Error("phone replay failed: " + r.stderr);
    assert.equal(read(path.join(phone, "replay-result.json")).swapCalls, 0);
    const secure = read(path.join(till, "merchant-secure.json"));
    const queue = JSON.parse(secure["@cashu_settlement_queue"]);
    const publicJournal = fs.readFileSync(
      path.join(phone, "relay.json"),
      "utf8",
    );
    const entries = Array.isArray(queue) ? queue : queue.entries;
    for (const e of entries)
      for (const o of e.merchantBlinding) {
        assert.ok(!publicJournal.includes(o.secret));
        assert.ok(!publicJournal.includes(o.r));
      }
    save(path.join(directory, "verified.json"), {
      ...before,
      status: "verified",
      lostSwapResponseRecovered: true,
      merchantCrashRecovered: fs.existsSync(
        path.join(till, "recover-crash.log"),
      ),
      merchantReplayCreditsOnce: true,
      concurrentRecoveryCreditsOnce: true,
      phoneReplaySwapCalls: 0,
      merchantOpeningsAbsentFromRelay: true,
    });
  }
  process.stdout.write(action + " complete: " + directory + "\n");
}
if (require.main === module)
  main().catch((e) => {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  });
