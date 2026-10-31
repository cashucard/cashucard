/* Private fixed-recipe controller. Transport and durable storage are injected. */
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { qualification, verifyRecord } = require("./many-records.cjs");
const { diagnostics, fingerprint } = require("./run-compact.cjs");
const sdk = require("../cardkit");
const pins = require("./pixel-streamed.json");
const fixture = require("./fixtures/compact-capacity-v1.json");
const q = qualification();
const SELECT = "00a404000bf04341534855434d50540100";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const clone = (v) => JSON.parse(JSON.stringify(v));
const hex = (v) => Buffer.from(v).toString("hex");
const bytes = (v) => {
  if (typeof v !== "string" || !/^(?:[0-9a-f]{2})+$/.test(v) || v.length > 522)
    throw Error("invalid-frame");
  return Buffer.from(v, "hex");
};
const reply = (v) => {
  const b = bytes(v);
  if (b.length < 2 || b.length > 257) throw Error("invalid-reply");
  return { sw: b.readUInt16BE(b.length - 2), data: b.subarray(0, -2) };
};
const cmd = (ins, data = Buffer.alloc(0)) =>
  Buffer.concat([
    Buffer.from([0xb0, ins, 0, 0]),
    ...(data.length ? [Buffer.from([data.length]), data] : []),
    Buffer.from([0]),
  ]).toString("hex");
const busy = new WeakSet();
// Only exact already-verified public bytes are cached. Restarting loses this
// bounded optimization and re-verifies the journal from its retained packets.
const verifiedPackets = new Map();
const sourceFiles = [
  __filename,
  require.resolve("./many-records.cjs"),
  require.resolve("./compact-export.cjs"),
  require.resolve("./phase-journal.cjs"),
  require.resolve("./fixtures/compact-capacity-v1.json"),
];
function binding({ runId, key, runtimeSha256 }) {
  assert.match(runId, /^[0-9a-f]{32}$/);
  assert.match(key, /^(02|03)[0-9a-f]{64}$/);
  assert.match(runtimeSha256, /^[0-9a-f]{64}$/);
  return {
    runId,
    key,
    runtimeSha256,
    chip: pins.chip,
    image: {
      source: pins.source,
      manifest: pins.manifest,
      cap: pins.cap,
      load: pins.load,
    },
    recipe: q.name,
    recipeSha256: hash(JSON.stringify(q.steps)),
    sourceSha256: hash(
      JSON.stringify([
        ...sourceFiles.map((f) => hash(fs.readFileSync(f))),
        fingerprint(),
      ]),
    ),
    installation: fixture.context.installation,
  };
}
function createJournal(options) {
  return {
    format: 1,
    binding: binding(options),
    phases: [],
    reads: [],
    intent: null,
    recoveryTarget: null,
    failure: null,
  };
}
function model() {
  return {
    setup: false,
    slots: Array(128).fill(0),
    active: 0,
    records: new Map(),
    verified: new Map(),
    scopes: new Map(),
  };
}
function status(m) {
  const unspent = m.slots.filter((v) => v === 1).length;
  const spent = m.slots.filter((v) => v === 2).length;
  return Buffer.from([
    64 - m.records.size,
    90 - 2 * m.records.size,
    unspent,
    spent,
    128 - unspent - spent,
    0,
  ]);
}
function frame(step, m) {
  if (typeof step === "string") return step;
  if (step.reset) return SELECT;
  if (step.retireAs) {
    const saved = m.verified.get(step.retireAs);
    if (!saved) throw Error("unverified-retirement");
    return cmd(0x77, Buffer.from(saved.scope, "hex"));
  }
  return step.apdu;
}
function captureAt(p, at) {
  return p.captures.find((c) => c.scopeAt === at);
}
function checkScope(r, scope) {
  assert.equal(scope.length, 45);
  assert.equal(scope[0], r.index);
  assert.equal(scope.readBigUInt64BE(1), r.id);
  assert.equal(scope.readUInt32BE(9), r.generation);
}
function verifySaved(r, b, scope, packet, m) {
  const cacheKey = hash(
    JSON.stringify([b.sourceSha256, b.key, r.token, hex(scope), hex(packet)]),
  );
  let verified = verifiedPackets.get(cacheKey);
  if (!verified) {
    verified = Object.freeze(
      verifyRecord(r, Buffer.from(b.key, "hex"), scope, packet),
    );
    if (verifiedPackets.size >= 256)
      verifiedPackets.delete(verifiedPackets.keys().next().value);
    verifiedPackets.set(cacheKey, verified);
  }
  const saved = { scope: hex(scope), packet: hex(packet), ...verified };
  const old = m.verified.get(r.token);
  if (old) assert.deepEqual(saved, old);
  m.verified.set(r.token, saved);
  return verified;
}
function retire(m, r) {
  assert.equal(m.records.get(r.index)?.token, r.token);
  for (const p of r.vector.proofs) {
    assert.equal(m.slots[p.slot], 2);
    m.slots[p.slot] = 0;
  }
  m.records.delete(r.index);
}
function apply(m, b, p, rows, at) {
  const row = rows[at],
    step = p.steps[at],
    a = bytes(frame(step, m));
  const actual = reply(row.reply),
    expected = p.checks[at];
  assert.equal(expected.at, at);
  assert.equal(actual.sw, expected.sw);
  if (expected.data) {
    const data =
      a[1] === 0x7a ? Buffer.from(b.key, "hex") : Buffer.from(expected.data);
    assert.ok(actual.data.equals(data));
  }
  const c = captureAt(p, at);
  if (c) checkScope(c.record, actual.data);
  if (row.recovery) {
    // A recovered receipt is explicitly labelled; its response was read later.
    assert.ok(a[1] === 0x74 || a[1] === 0x77);
    assert.equal(row.recovery.command, hex(a));
    if (a[1] === 0x74) {
      assert.equal(row.recovery.scopeReply, row.reply);
      verifySaved(
        c.record,
        b,
        actual.data,
        Buffer.from(row.recovery.packet, "hex"),
        m,
      );
    } else {
      assert.equal(row.recovery.scopeReply, "6985");
      const target = m.records.get(a[5]);
      assert.ok(target);
      const remaining = [...m.records.values()].filter(
        (r) => r.token !== target.token,
      );
      assert.equal(row.recovery.others.length, remaining.length);
      for (let i = 0; i < remaining.length; i++) {
        const r = remaining[i],
          found = row.recovery.others[i];
        assert.equal(found.token, r.token);
        const saved = m.verified.get(r.token);
        assert.equal(found.scope, saved?.scope);
        assert.equal(found.packet, saved?.packet);
        verifySaved(
          r,
          b,
          Buffer.from(found.scope, "hex"),
          Buffer.from(found.packet, "hex"),
          m,
        );
      }
    }
  }
  if (actual.sw === 0x9000) {
    if (a[1] === 0xa4) m.active = 0;
    if (a[1] === 0x7e) m.setup = true;
    if (a[1] === 0x71) m.slots[a[5]] = 1;
    if (a[1] === 0x72) {
      const next = p.captures.find((v) => v.scopeAt === at + 2);
      assert.ok(next);
      m.active = next.record.index + 1;
    }
    if (a[1] === 0x74) {
      for (const proof of c.record.vector.proofs) {
        assert.equal(m.slots[proof.slot], 1);
        m.slots[proof.slot] = 2;
      }
      m.records.set(c.record.index, c.record);
      m.scopes.set(c.record.token, actual.data);
      m.active = 0;
    }
    if (a[1] === 0x77) retire(m, m.records.get(a[5]));
  }
  if (row.recovery)
    assert.equal(row.recovery.statusReply, hex(status(m)) + "9000");
  const end = p.captures.find((v) => v.pageAt + v.pages - 1 === at);
  if (end) {
    const scope = reply(rows[end.scopeAt].reply).data;
    const packet = Buffer.concat(
      rows
        .slice(end.pageAt, end.pageAt + end.pages)
        .map((r) => reply(r.reply).data),
    );
    const verified = verifySaved(end.record, b, scope, packet, m);
    if (row.verified) assert.deepEqual(row.verified, verified);
    row.verified = verified;
  }
}
function replay(j, b) {
  assert.equal(j.format, 1);
  assert.deepEqual(j.binding, b);
  assert.ok(Array.isArray(j.phases) && j.phases.length <= q.phases.length);
  assert.ok(Array.isArray(j.reads) && j.reads.length <= 400);
  assert.ok(JSON.stringify(j).length <= 1024 * 1024);
  const readFrames = new Set([
    hex(sdk.selectAid(sdk.ISD_AID)),
    "80ca9f7f00",
    SELECT,
    cmd(0x7a),
    cmd(0x7d),
    cmd(0x76),
    ...q.records.flatMap((r) => [scopeRead(r.index), ...pageReads(r)]),
  ]);
  for (const read of j.reads) {
    assert.ok(readFrames.has(read.frame));
    reply(read.reply);
  }
  const m = model();
  let phase = 0,
    step = 0;
  for (const [i, rows] of j.phases.entries()) {
    const p = q.phases[i];
    assert.ok(Array.isArray(rows) && rows.length <= p.steps.length);
    if (i < j.phases.length - 1) assert.equal(rows.length, p.steps.length);
    for (let at = 0; at < rows.length; at++) apply(m, b, p, rows, at);
    phase = i;
    step = rows.length;
    if (step === p.steps.length) {
      phase++;
      step = 0;
    }
  }
  for (const pending of [j.intent, j.recoveryTarget]) {
    if (!pending) continue;
    if (pending.kind === "step") {
      assert.equal(pending.phase, phase);
      assert.equal(pending.step, step);
      assert.equal(pending.frame, frame(q.phases[phase].steps[step], m));
    } else {
      assert.equal(pending.kind, "read");
      assert.ok(readFrames.has(pending.frame));
    }
  }
  return { m, phase, step };
}
function scopeRead(index) {
  return cmd(0x7c, Buffer.from([index]));
}
function pageReads(r) {
  return Array.from({ length: Math.ceil(r.packetBytes / 255) }, (_, i) =>
    cmd(
      0x75,
      Buffer.from([
        r.index,
        (i * 255) >> 8,
        (i * 255) & 255,
        Math.min(255, r.packetBytes - i * 255),
      ]),
    ),
  );
}
async function invoke(options, recover) {
  const { tx, save, now = () => performance.now() } = options;
  if (busy.has(tx)) throw Error("controller-busy");
  busy.add(tx);
  let j, state;
  let began;
  let commands = 0;
  const stop = (code) => {
    throw Object.assign(Error(code), { category: code });
  };
  const check = () => {
    const elapsed = now() - began;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120000)
      stop("elapsed-bound");
    if (commands >= 160) stop("command-bound");
  };
  const persist = async () => {
    try {
      await save(clone(j));
    } catch {
      stop("journal-unavailable");
    }
  };
  const transmit = async (a, intent, receive) => {
    check();
    j.intent = intent;
    await persist();
    check();
    commands++;
    let result, timer;
    const started = now();
    const nativeDuration = () => {
      const elapsed = now() - started;
      return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
    };
    try {
      result = await Promise.race([
        tx([...bytes(a)]),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error()), 30000);
        }),
      ]);
    } catch {
      j.intent.failedNativeMs = nativeDuration();
      stop("transport-uncertain");
    } finally {
      clearTimeout(timer);
    }
    const nativeMs = nativeDuration();
    if (
      !Array.isArray(result) ||
      result.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      result.length < 2 ||
      result.length > 257
    ) {
      j.intent.failedNativeMs = nativeMs;
      stop("transport-uncertain");
    }
    const raw = hex(result);
    receive(raw, nativeMs);
    j.intent = null;
    await persist();
    // Preserve a received response even when the elapsed gate expires here.
    if (now() - began > 120000) stop("elapsed-bound");
    if (nativeMs !== null && nativeMs > 30000) stop("response-bound");
    return reply(raw);
  };
  const read = (a) => {
    if (j.reads.length >= 400) stop("read-evidence-bound");
    return transmit(a, { kind: "read", frame: a }, (raw, nativeMs) => {
      j.reads.push({ frame: a, reply: raw, nativeMs });
    });
  };
  const okRead = async (a) => {
    const r = await read(a);
    if (r.sw !== 0x9000) stop("read-status");
    return r.data;
  };
  const fence = async () => {
    await okRead(hex(sdk.selectAid(sdk.ISD_AID)));
    const cplc = await okRead("80ca9f7f00");
    if (sdk.parseCplc(cplc).id !== j.binding.chip) stop("chip-mismatch");
    if (!(await okRead(SELECT)).equals(Buffer.from("CPROT\x02")))
      stop("image-mismatch");
    if (hex(await okRead(cmd(0x7a))) !== j.binding.key) stop("key-mismatch");
    const diag = diagnostics(await okRead(cmd(0x7d)), state.m.setup ? 2 : 0);
    if (Math.min(diag.maxCommit, diag.unusedCommit) < 128) stop("commit-floor");
  };
  const collect = async (r, scope) => {
    const chunks = [];
    for (const a of pageReads(r)) chunks.push(await okRead(a));
    const body = Buffer.concat(chunks);
    verifyRecord(r, Buffer.from(j.binding.key, "hex"), scope, body);
    return body;
  };
  try {
    j = clone(options.journal);
    const b = binding(options.binding);
    state = replay(j, b);
    // File/source/packet admission precedes the bounded transport session.
    began = now();
    if (state.phase >= q.phases.length)
      return { journal: j, outcome: "complete", commands };
    if (!recover && (j.intent || j.recoveryTarget)) stop("recovery-required");
    if (!recover && state.m.active) stop("staging-requires-review");
    if (recover && !j.intent && !j.recoveryTarget) stop("no-uncertain-command");
    const p = q.phases[state.phase];
    if (!j.phases[state.phase]) j.phases.push([]);
    if (recover) {
      j.recoveryTarget ??= j.intent;
      j.intent = null;
    }
    j.failure = null;
    await persist();
    await fence();
    if (recover) {
      const target = j.recoveryTarget;
      if (target.kind === "read") {
        if (state.m.setup && !(await okRead(cmd(0x76))).equals(status(state.m)))
          stop("state-mismatch");
        j.recoveryTarget = null;
        await persist();
        return { journal: j, outcome: "read-reconciled", commands };
      }
      const a = bytes(target.frame),
        row = { reply: "", recovery: { command: target.frame } };
      if (![0x74, 0x77].includes(a[1])) stop("mutation-requires-review");
      const r =
        a[1] === 0x74
          ? captureAt(p, state.step).record
          : state.m.records.get(a[5]);
      const scope = await read(scopeRead(r.index));
      row.recovery.scopeReply =
        hex(scope.data) + scope.sw.toString(16).padStart(4, "0");
      if (a[1] === 0x74) {
        if (scope.sw !== 0x9000) stop("unpublished-requires-review");
        checkScope(r, scope.data);
        row.reply = row.recovery.scopeReply;
        row.recovery.packet = hex(await collect(r, scope.data));
      } else {
        if (scope.sw !== 0x6985 || scope.data.length)
          stop("retirement-requires-review");
        row.reply = "019000";
        row.recovery.others = [];
        for (const other of state.m.records.values()) {
          if (other.token === r.token) continue;
          const observed = await okRead(scopeRead(other.index));
          const packet = await collect(other, observed);
          row.recovery.others.push({
            token: other.token,
            scope: hex(observed),
            packet: hex(packet),
          });
        }
      }
      row.recovery.statusReply = hex(await okRead(cmd(0x76))) + "9000";
      const rows = j.phases[state.phase];
      rows.push(row);
      apply(state.m, j.binding, p, rows, state.step);
      j.recoveryTarget = null;
      await persist();
      return {
        journal: j,
        outcome: a[1] === 0x74 ? "sign-reconciled" : "retirement-reconciled",
        commands,
      };
    }
    if (state.m.setup && !(await okRead(cmd(0x76))).equals(status(state.m)))
      stop("state-mismatch");
    const rows = j.phases[state.phase];
    for (let at = state.step; at < p.steps.length; at++) {
      const a = frame(p.steps[at], state.m);
      await transmit(
        a,
        { kind: "step", phase: state.phase, step: at, frame: a },
        (raw, nativeMs) => rows.push({ reply: raw, nativeMs }),
      );
      apply(state.m, j.binding, p, rows, at);
      // Verification is durable before a subsequent command, including RETIRE.
      if (rows[at].verified) await persist();
    }
    return {
      journal: j,
      outcome:
        state.phase === q.phases.length - 1 ? "complete" : "phase-complete",
      commands,
    };
  } catch (error) {
    const category = error.category || "evidence-mismatch";
    if (!j || !state)
      return {
        journal: options.journal,
        outcome: "stopped",
        failure: category,
        commands,
      };
    j.failure = category;
    try {
      await persist();
    } catch {
      /* Preserve the last successfully saved intent. */
    }
    return { journal: j, outcome: "stopped", failure: category, commands };
  } finally {
    busy.delete(tx);
  }
}
const executePhase = (options) => invoke(options, false);
const reconcilePhase = (options) => invoke(options, true);
module.exports = { createJournal, executePhase, reconcilePhase };
