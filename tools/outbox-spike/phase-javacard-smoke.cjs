/* Offline controller against a persistent jCardSim process. No hardware access. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createHash } = require("node:crypto");
const { spawn, fork, execFileSync } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");
const {
  createJournal,
  executePhase,
  reconcilePhase,
  preparePhase,
} = require("./phase-recovery.cjs");
const { withPhaseJournal } = require("./phase-journal.cjs");
const { kitRequire } = require("./pixel-test-support.cjs");
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const fixture = require("./fixtures/compact-capacity-v1.json");
const artifact = path.resolve(process.argv[2]);
const root = path.resolve(__dirname, "../..");
function simulator() {
  const child = spawn(
    "java",
    [
      "-cp",
      path.join(artifact, "sim-classes") +
        path.delimiter +
        path.join(root, "tools/cardsim/target/cardsim.jar"),
      "CompactHarness",
      "--session",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let pending,
    errors = "",
    lose;
  child.stderr.on("data", (s) => {
    errors = (errors + s).slice(-8192);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!line.startsWith("COMPACT_RESULT:")) return;
    if (!pending) throw Error("unexpected simulator response");
    const next = pending;
    pending = null;
    try {
      next.resolve(JSON.parse(line.slice(15))[0].hex);
    } catch (e) {
      next.reject(e);
    }
  });
  const failed = (e) => {
    if (pending) {
      pending.reject(e);
      pending = null;
    }
  };
  child.on("error", failed);
  child.on("close", () => failed(Error("simulator stopped: " + errors)));
  const identity = new FakeCard(),
    sent = [],
    trace = [];
  const tx = async (a) => {
    sent.push([...a]);
    // Only the identity-domain replies are synthetic; every private applet
    // command, mutation and recovery read executes in the persistent JVM.
    if (a[1] === 0xca || (a[1] === 0xa4 && a[5] === 0xa0)) {
      const response = await identity.transceive(a);
      trace.push({
        frame: Buffer.from(a).toString("hex"),
        reply: Buffer.from(response).toString("hex"),
      });
      return response;
    }
    if (pending) throw Error("concurrent simulator command");
    const promise = new Promise((resolve, reject) => {
      pending = { resolve, reject };
    });
    const step =
      a[1] === 0xa4 ? { reset: true } : Buffer.from(a).toString("hex");
    child.stdin.write(JSON.stringify({ steps: [step] }) + "\n");
    const raw = await promise;
    trace.push({ frame: Buffer.from(a).toString("hex"), reply: raw });
    if (lose === a[1]) {
      lose = null;
      throw Error("simulated missing native reply");
    }
    return [...Buffer.from(raw, "hex")];
  };
  return {
    tx,
    sent,
    trace,
    lose: (ins) => {
      lose = ins;
    },
    close: async () => {
      const closed = once(child, "close");
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
        lines.close();
      }
    },
  };
}
test("disk-backed phases recover a killed signing host and a lost retirement reply in the JavaCard engine", async () => {
  const sim = simulator();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cashucard-phase-engine-"),
  );
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "phase.json");
  const runtimeSha256 = createHash("sha256")
    .update(fs.readFileSync(path.join(artifact, "manifest.json")))
    .update(
      fs.readFileSync(path.join(artifact, "sim-classes/CompactHarness.class")),
    )
    .update(fs.readFileSync(path.join(__dirname, "phase-host-worker.cjs")))
    .digest("hex");
  const binding = {
    runId: "77".repeat(16),
    key: fixture.context.cardKey,
    runtimeSha256,
  };
  let initial = createJournal(binding);
  let policyChecks = 0;
  let corruptRetirementRejected = false;
  const checkWire = (program, start, complete) => {
    if (program.retirements.length && !corruptRetirementRejected) {
      const bad = JSON.parse(JSON.stringify(program));
      const packet = Buffer.from(bad.retirements[0].packet, "hex");
      packet[packet.length - 1] ^= 1;
      bad.retirements[0].packet = packet.toString("hex");
      assert.throws(() =>
        execFileSync(
          "python3",
          ["-I", "-S", "-B", path.join(__dirname, "phase_wire.py")],
          {
            input: JSON.stringify({ program: bad, trace: [], complete: false }),
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      );
      corruptRetirementRejected = true;
    }
    const result = JSON.parse(
      execFileSync(
        "python3",
        ["-I", "-S", "-B", path.join(__dirname, "phase_wire.py")],
        {
          input: JSON.stringify({
            program,
            trace: sim.trace.slice(start),
            complete,
          }),
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
    );
    assert.equal(result.ok, true);
    policyChecks++;
  };
  const run = (recover = false) =>
    withPhaseJournal(file, initial, async ({ journal, save }) => {
      initial = null;
      let program;
      try {
        program = preparePhase({ journal, binding, recover });
      } catch {
        /* The controller must refuse without transmitting. */
      }
      const start = sim.trace.length;
      const result = await (recover ? reconcilePhase : executePhase)({
        binding,
        journal,
        save,
        tx: sim.tx,
        now: () => 0,
      });
      if (program) checkWire(program, start, result.outcome !== "stopped");
      else assert.equal(sim.trace.length, start);
      return result;
    });
  const freshHost = ({ recover = false, killAfterSign = false } = {}) =>
    new Promise((resolve, reject) => {
      const program = preparePhase({
        journal: JSON.parse(fs.readFileSync(file)),
        binding,
        recover,
      });
      const start = sim.trace.length;
      const child = fork(path.join(__dirname, "phase-host-worker.cjs"), [], {
        silent: true,
      });
      child.stdout.resume();
      child.stderr.resume();
      let result,
        killed = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("test host deadline"));
      }, 30000);
      child.on("message", async (message) => {
        if (message.result) {
          result = message.result;
          return;
        }
        if (!message.apdu) return;
        try {
          const reply = await sim.tx(message.apdu);
          if (killAfterSign && message.apdu[1] === 0x74) {
            assert.equal(reply.length, 47);
            assert.deepEqual(reply.slice(-2), [0x90, 0]);
            killed = true;
            child.kill("SIGKILL");
          } else if (child.connected) child.send({ reply });
        } catch {
          if (child.connected) child.send({ transportFailed: true });
        }
      });
      child.on("error", reject);
      child.on("close", () => {
        clearTimeout(timer);
        try {
          checkWire(program, start, !killed && result?.outcome !== "stopped");
          resolve({ result, killed, pid: child.pid });
        } catch (error) {
          reject(error);
        }
      });
      child.send({ file, binding, recover });
    });
  try {
    for (let phase = 0; phase < 8; phase++) {
      if (phase === 1 || phase === 5) {
        if (phase === 1) {
          const interrupted = await freshHost({ killAfterSign: true });
          assert.equal(interrupted.killed, true);
          assert.equal(
            JSON.parse(fs.readFileSync(file)).intent.frame,
            "b074000000",
          );
          assert.equal(
            JSON.parse(fs.readFileSync(file + ".lock")).pid,
            interrupted.pid,
          );
          await assert.rejects(run(), /EEXIST/);
          // Only this isolated test clears the exact exited worker's lease.
          fs.unlinkSync(file + ".lock");
        } else {
          sim.lose(0x77);
          const interrupted = await run();
          assert.equal(interrupted.failure, "transport-uncertain");
        }
        const before = sim.sent.length;
        assert.equal((await run()).failure, "recovery-required");
        assert.equal(sim.sent.length, before);
        const recovered =
          phase === 1
            ? (await freshHost({ recover: true })).result
            : await run(true);
        assert.equal(
          recovered.outcome,
          phase === 1 ? "sign-reconciled" : "retirement-reconciled",
          recovered.failure,
        );
        assert.ok(recovered.commands <= 160);
        assert.ok(
          sim.sent
            .slice(before)
            .every((a) => ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(a[1])),
        );
      }
      const result = await run();
      assert.equal(
        result.outcome,
        phase === 7 ? "complete" : "phase-complete",
        result.failure,
      );
      assert.ok(result.commands <= 160);
    }
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(saved.phases[7].at(-1).reply, "405a01007f009000");
    assert.equal(saved.phases.flat().filter((r) => r.recovery).length, 2);
    assert.equal(sim.sent.filter((a) => a[1] === 0x74).length, 46);
    assert.equal(sim.sent.filter((a) => a[1] === 0x77).length, 47);
    assert.equal(saved.intent, null);
    assert.equal(saved.recoveryTarget, null);
    assert.equal(policyChecks, 12);
    assert.equal(corruptRetirementRejected, true);
  } finally {
    await sim.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
