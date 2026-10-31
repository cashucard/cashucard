const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createJournal,
  executePhase,
  reconcilePhase,
} = require("./phase-recovery.cjs");
const { qualification } = require("./many-records.cjs");
const {
  fixtureView,
  signCompact,
  exportCompact,
} = require("./compact-export.cjs");
const { sdk, kitRequire } = require("./pixel-test-support.cjs");
const { schnorr } = kitRequire("@noble/curves/secp256k1");
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const clone = (v) => JSON.parse(JSON.stringify(v));
const full = require("./fixtures/compact-capacity-v1.json");
const q = qualification();
const binding = {
  runId: "11".repeat(16),
  key: full.context.cardKey,
  runtimeSha256: "22".repeat(32),
};
const secret = Uint8Array.from([...Array(31).fill(0), 3]);
const hex = (b) => Buffer.from(b).toString("hex");
function fixture() {
  const identity = new FakeCard(),
    slots = Array(128).fill(0),
    records = new Map();
  const sent = [],
    saved = [];
  let setup = false,
    active,
    signed = 0,
    lose = null,
    corrupt = false,
    wrongChip = false,
    wrongKey = false;
  const material = (r) => {
    const plan = {
      index: r.index,
      id: r.id,
      generation: r.generation,
      installation: full.context.installation,
      inputs: r.vector.proofs.map((p) => ({
        slot: p.slot,
        generation: p.generation,
      })),
    };
    const view = fixtureView(
      r.vector.context,
      r.vector.keysets,
      r.vector.proofs,
    );
    const packet = signCompact(plan, r.vector.outputs, view, (m) =>
      Buffer.from(schnorr.sign(m, secret, new Uint8Array(32))),
    );
    const exported = exportCompact({ ...plan, packet }, view);
    const scope = Buffer.alloc(45);
    scope[0] = r.index;
    scope.writeBigUInt64BE(r.id, 1);
    scope.writeUInt32BE(r.generation, 9);
    Buffer.from(exported.packetId, "hex").copy(scope, 13);
    return { r, scope, packet: Buffer.concat([...exported.pages()]) };
  };
  const status = () => [
    64 - records.size,
    90 - records.size * 2,
    slots.filter((n) => n === 1).length,
    slots.filter((n) => n === 2).length,
    slots.filter((n) => !n).length,
    0,
  ];
  const tx = async (value) => {
    const a = Buffer.from(value);
    sent.push(hex(a));
    const ok = (data = []) => [...data, 0x90, 0];
    let out;
    if (a[1] === 0xa4) {
      active = null;
      out = hex(a).includes("f04341534855434d505401")
        ? ok(Buffer.from("CPROT\x02"))
        : await identity.transceive(value);
    } else if (a[1] === 0xca) {
      out = await identity.transceive(value);
      if (wrongChip) out[15] ^= 1;
    } else if (a[1] === 0x7a)
      out = ok(
        Buffer.from(wrongKey ? "02" + "01".repeat(32) : binding.key, "hex"),
      );
    else if (a[1] === 0x7d)
      out = ok([
        ...Array(5)
          .fill(32767)
          .flatMap((n) => [n >> 8, n & 255]),
        ...(setup ? [64, 0, 48, 0, 2, 5] : [0, 0, 0, 0, 0, 5]),
      ]);
    else if (a[1] === 0x7e) {
      assert.equal(setup, false);
      setup = true;
      out = ok([1]);
    } else if (a[1] === 0x78) out = ok([1]);
    else if (a[1] === 0x71) {
      assert.equal(slots[a[5]], 0);
      slots[a[5]] = 1;
      out = ok([a[5]]);
    } else if (a[1] === 0x76) out = ok(status());
    else if (a[1] === 0x72) {
      if (records.size === 45) out = [0x6a, 0x84];
      else {
        active = signed === 45 ? q.replacement : q.records[signed];
        out = ok([active.index]);
      }
    } else if (a[1] === 0x73) {
      assert.ok(active);
      out = ok([1]);
    } else if (a[1] === 0x74) {
      assert.ok(active);
      const built = material(active);
      records.set(active.index, built);
      slots[active.index] = 2;
      active = null;
      signed++;
      out = ok(built.scope);
    } else if (a[1] === 0x7c)
      out = records.has(a[5]) ? ok(records.get(a[5]).scope) : [0x69, 0x85];
    else if (a[1] === 0x75) {
      const record = records.get(a[5]);
      assert.ok(record);
      const at = a.readUInt16BE(6),
        part = Buffer.from(record.packet.subarray(at, at + a[8]));
      if (corrupt) part[0] ^= 1;
      out = ok(part);
    } else if (a[1] === 0x77) {
      // The latest durable snapshot must already carry verification evidence.
      const key = hex(a.subarray(5, 50));
      const allRows = saved.at(-1).phases.flat();
      assert.ok(
        allRows.some((row) => row.verified?.packetId === key.slice(26)),
      );
      const current = records.get(a[5]);
      if (!current || !current.scope.equals(a.subarray(5, 50)))
        out = [0x69, 0x85];
      else {
        slots[a[5]] = 0;
        records.delete(a[5]);
        out = ok([1]);
      }
    } else throw Error("unexpected fixture command");
    if (lose === a[1]) {
      lose = null;
      throw Error("PRIVATE RAW NATIVE ERROR");
    }
    return out;
  };
  return {
    sent,
    saved,
    records,
    status,
    signed: () => signed,
    lose: (ins) => {
      lose = ins;
    },
    corrupt: (v) => {
      corrupt = v;
    },
    wrongChip: () => {
      wrongChip = true;
    },
    wrongKey: () => {
      wrongKey = true;
    },
    args: {
      binding,
      tx,
      save: async (j) => saved.push(clone(j)),
      now: () => 0,
    },
  };
}
async function execute(f, journal = createJournal(binding)) {
  return executePhase({ ...f.args, journal });
}
test("fresh controllers use the saved phase evidence and verify packets before scoped retirement", async () => {
  const f = fixture();
  let journal = createJournal(binding);
  for (let phase = 0; phase < 8; phase++) {
    const result = await execute(f, clone(journal));
    assert.equal(
      result.outcome,
      phase === 7 ? "complete" : "phase-complete",
      result.failure,
    );
    assert.ok(result.commands <= 160);
    journal = clone(f.saved.at(-1));
  }
  assert.equal(f.signed(), 46);
  assert.deepEqual(f.status(), q.finalStatus);
  const count = f.sent.length;
  assert.equal((await execute(f, journal)).outcome, "complete");
  assert.equal(f.sent.length, count);
  assert.ok(!JSON.stringify(journal).includes("PRIVATE RAW"));
});
test("lost SIGN and retirement replies reconcile read-only without signing or retiring again", async () => {
  const f = fixture();
  let journal = (await execute(f)).journal;
  f.lose(0x74);
  let result = await execute(f, journal);
  assert.equal(result.failure, "transport-uncertain");
  assert.equal(f.signed(), 1);
  let before = f.sent.length;
  result = await execute(f, clone(f.saved.at(-1)));
  assert.equal(result.failure, "recovery-required");
  assert.equal(f.sent.length, before);
  f.corrupt(true);
  result = await reconcilePhase({ ...f.args, journal: clone(f.saved.at(-1)) });
  assert.equal(result.outcome, "stopped");
  f.corrupt(false);
  before = f.sent.length;
  result = await reconcilePhase({ ...f.args, journal: clone(f.saved.at(-1)) });
  assert.equal(result.outcome, "sign-reconciled", result.failure);
  assert.ok(
    f.sent
      .slice(before)
      .every(
        (a) =>
          ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(
            Buffer.from(a, "hex")[1],
          ),
      ),
  );
  assert.equal(f.signed(), 1);
  journal = result.journal;
  for (let phase = 1; phase < 5; phase++) {
    result = await execute(f, clone(journal));
    assert.equal(result.outcome, "phase-complete", result.failure);
    journal = result.journal;
  }
  f.lose(0x77);
  result = await execute(f, journal);
  assert.equal(result.failure, "transport-uncertain");
  assert.equal(f.records.size, 44);
  before = f.sent.length;
  result = await reconcilePhase({ ...f.args, journal: clone(f.saved.at(-1)) });
  assert.equal(result.outcome, "retirement-reconciled", result.failure);
  assert.ok(
    f.sent
      .slice(before)
      .every(
        (a) =>
          ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(
            Buffer.from(a, "hex")[1],
          ),
      ),
  );
  journal = result.journal;
  for (let phase = 5; phase < 8; phase++) {
    result = await execute(f, clone(journal));
    assert.equal(
      result.outcome,
      phase === 7 ? "complete" : "phase-complete",
      result.failure,
    );
    journal = result.journal;
  }
  assert.equal(f.signed(), 46);
  assert.deepEqual(f.status(), q.finalStatus);
});
test("binding changes and invalid progress stop before transport; card substitution stops before mutation", async () => {
  for (const change of [
    (j) => {
      j.binding.image.cap = "00".repeat(32);
    },
    (j) => {
      j.binding.runtimeSha256 = "33".repeat(32);
    },
    (j) => {
      j.phases = [[{ reply: "019000" }]];
    },
  ]) {
    const f = fixture(),
      j = createJournal(binding);
    change(j);
    assert.equal((await execute(f, j)).outcome, "stopped");
    assert.equal(f.sent.length, 0);
  }
  for (const wrong of ["wrongChip", "wrongKey"]) {
    const f = fixture();
    f[wrong]();
    const result = await execute(f);
    assert.equal(
      result.failure,
      wrong === "wrongChip" ? "chip-mismatch" : "key-mismatch",
    );
    assert.ok(
      f.sent.every(
        (a) =>
          ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(
            Buffer.from(a, "hex")[1],
          ),
      ),
    );
  }
});
test("storage failure blocks SIGN; a saved successful reply crossing the elapsed gate is never re-signed", async () => {
  const f = fixture();
  const prepared = (await execute(f)).journal;
  const save = f.args.save;
  f.args.save = async (j) => {
    if (j.intent?.frame === "b074000000") throw Error("storage unavailable");
    await save(j);
  };
  assert.equal((await execute(f, prepared)).failure, "journal-unavailable");
  assert.equal(f.signed(), 0);
  const g = fixture();
  const ready = (await execute(g)).journal;
  let clock = 0;
  const tx = g.args.tx;
  g.args.now = () => clock;
  g.args.tx = async (a) => {
    const r = await tx(a);
    if (a[1] === 0x74) clock = 120001;
    return r;
  };
  assert.equal((await execute(g, ready)).failure, "elapsed-bound");
  assert.equal(g.signed(), 1);
  const received = g.saved.at(-1).phases[1].at(-1);
  assert.equal(received.nativeMs, 120001);
  assert.equal(received.reply.length, 94);
  g.args.tx = tx;
  clock = 0;
  assert.equal(
    (await execute(g, clone(g.saved.at(-1)))).outcome,
    "phase-complete",
  );
  assert.equal(g.signed(), 15);
  const h = fixture();
  let late = 0;
  const native = h.args.tx;
  h.args.now = () => late;
  h.args.tx = async (a) => {
    const r = await native(a);
    if (a[1] === 0x7a) late = 30001;
    return r;
  };
  assert.equal((await execute(h)).failure, "response-bound");
  assert.equal(h.saved.at(-1).reads.at(-1).nativeMs, 30001);
  assert.ok(
    h.sent.every(
      (a) =>
        ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(
          Buffer.from(a, "hex")[1],
        ),
    ),
  );
});

test("an unpublished uncertain SIGN stays stopped after read-only inspection", async () => {
  const f = fixture(),
    prepared = (await execute(f)).journal;
  const tx = f.args.tx;
  f.args.tx = async (a) => {
    if (a[1] === 0x74) throw Error("reply unavailable before execution");
    return tx(a);
  };
  assert.equal((await execute(f, prepared)).failure, "transport-uncertain");
  const before = f.sent.length;
  const recovered = await reconcilePhase({
    ...f.args,
    journal: clone(f.saved.at(-1)),
  });
  assert.equal(recovered.failure, "unpublished-requires-review");
  assert.equal(f.signed(), 0);
  assert.ok(
    f.sent
      .slice(before)
      .every(
        (a) =>
          ![0x71, 0x72, 0x73, 0x74, 0x77, 0x7e].includes(
            Buffer.from(a, "hex")[1],
          ),
      ),
  );
  const count = f.sent.length;
  assert.equal(
    (await execute(f, recovered.journal)).failure,
    "recovery-required",
  );
  assert.equal(f.sent.length, count);
});
