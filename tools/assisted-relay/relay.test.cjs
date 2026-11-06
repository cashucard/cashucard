const test = require("node:test");
const assert = require("node:assert/strict");
const cc = require("../cardsim/cashu-crypto.cjs");
const vector = require("../outbox-spike/fixtures/assisted-settlement-v1.json");
const { decodePacket, capturePacket, reconcilePayment } = require("./relay.js");
const crypto = {
  hash: (b) => [...cc.sha256(Buffer.from(b))],
  verify: (sig, msg, key) =>
    cc.schnorrVerify(Buffer.from(key), Buffer.from(msg), Buffer.from(sig)),
  point: (b) => {
    try {
      return !!cc.point(Buffer.from(b));
    } catch {
      return false;
    }
  },
  proofY: (secret) =>
    cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(secret)))),
  dleq: (o, sig, key) =>
    cc.verifyBlindDleq(o.B_, sig.C_, sig.dleq.e, sig.dleq.s, key),
};
const policy = {
  mint: vector.context.mint,
  cardKey: vector.context.cardKey,
  installation: vector.context.installation,
};
const raw = () => [...Buffer.from(vector.expected.packet, "hex")];
const scope = () => [
  vector.identity.index,
  ...Buffer.from(
    BigInt(vector.identity.id).toString(16).padStart(16, "0") +
      vector.identity.generation.toString(16).padStart(8, "0") +
      vector.expected.packetId,
    "hex",
  ),
];
const journal = () => ({
  format: "private-assisted-relay-v1",
  state: "captured",
  packet: vector.expected.packet,
  scope: Buffer.from(scope()).toString("hex"),
});

test("the engine executes in a mobile-like runtime without Node globals", () => {
  const fs = require("node:fs"),
    vm = require("node:vm");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("./relay.js"), "utf8"), {
    module,
    URL,
    Uint8Array,
  });
  assert.equal(
    module.exports.decodePacket(raw(), policy, crypto).packetId,
    vector.expected.packetId,
  );
});

test("portable decoder agrees with the independent candidate vector", () => {
  const p = decodePacket(raw(), policy, crypto);
  assert.equal(p.packetId, vector.expected.packetId);
  assert.equal(p.paymentMessage, vector.expected.paymentMessage);
  assert.equal(p.paymentId, vector.identity.id);
  assert.equal(p.inputs.length, 2);
  assert.equal(p.outputs.length, 2);
  assert.equal(
    p.inputs[0].secret,
    cc.cardSecret(vector.proofs[0].nonce, vector.context.cardKey),
  );
  assert.equal(p.witness, vector.paymentSignature);
});

test("tampering, truncation, trailing bytes and foreign context are rejected", () => {
  for (const at of [0, 8, 44, 93, 190, raw().length - 1]) {
    const changed = raw();
    changed[at] ^= 1;
    assert.throws(() => decodePacket(changed, policy, crypto));
  }
  for (const b of [
    raw().slice(0, -1),
    [...raw(), 0],
    [-1],
    [256],
    Array(32769).fill(0),
  ])
    assert.throws(() => decodePacket(b, policy, crypto));
  for (const changed of [
    { ...policy, mint: "https://other.test" },
    { ...policy, installation: "00".repeat(32) },
    { ...policy, cardKey: "03" + policy.cardKey.slice(2) },
  ])
    assert.throws(() => decodePacket(raw(), changed, crypto));
});

test("capture saves every received page before continuing and needs a stable scope", async () => {
  const saves = [],
    reads = [];
  const result = await capturePacket({
    policy,
    crypto,
    readScope: async () => scope(),
    readPage: async (offset, count) => {
      reads.push(offset);
      assert.equal(saves.at(-1).pending.offset, offset);
      return raw().slice(offset, offset + count);
    },
    save: async (value) => saves.push(structuredClone(value)),
  });
  assert.equal(result.state, "captured");
  assert.equal(result.packet, vector.expected.packet);
  assert.deepEqual(reads, [0, 255, 510]);
  for (let i = 0; i < reads.length; i++)
    assert.ok(saves.some((s) => s.pages.length === i + 1 && !s.pending));
  let n = 0;
  await assert.rejects(
    capturePacket({
      policy,
      crypto,
      readScope: async () => {
        const s = scope();
        if (n++) s[9] ^= 1;
        return s;
      },
      readPage: async (o, c) => raw().slice(o, o + c),
      save: async () => {},
    }),
    /scope/,
  );
});

test("capture storage refusal stops before the next page and retains partial evidence", async () => {
  let reads = 0,
    retained;
  await assert.rejects(
    capturePacket({
      policy,
      crypto,
      readScope: async () => scope(),
      readPage: async (o, c) => {
        reads++;
        return raw().slice(o, o + c);
      },
      save: async (s) => {
        if (s.pages.length === 1) {
          retained = structuredClone(s);
          throw Error("disk");
        }
      },
    }),
    /disk/,
  );
  assert.equal(reads, 1);
  assert.equal(retained.pages[0].data, vector.expected.packet.slice(0, 510));
});

test("partial capture resumes at the next saved page and refuses a changed scope", async () => {
  const prior = {
    format: "private-assisted-relay-v1",
    state: "capturing",
    scope: Buffer.from(scope()).toString("hex"),
    pages: [{ offset: 0, data: vector.expected.packet.slice(0, 510) }],
  };
  const offsets = [];
  const args = {
    journal: prior,
    policy,
    crypto,
    readScope: async () => scope(),
    readPage: async (o, c) => {
      offsets.push(o);
      return raw().slice(o, o + c);
    },
    save: async () => {},
  };
  const r = await capturePacket(args);
  assert.deepEqual(offsets, [255, 510]);
  assert.equal(r.packet, vector.expected.packet);
  offsets.length = 0;
  await assert.rejects(
    capturePacket({
      ...args,
      readScope: async () => {
        const s = scope();
        s[0] ^= 1;
        return s;
      },
    }),
    /scope/,
  );
  assert.deepEqual(offsets, []);
});

function mint() {
  const p = decodePacket(raw(), policy, crypto),
    calls = [];
  const scalar = 0x1234567890abcdefn,
    K = cc.hexOf(cc.compressed(cc.mul(scalar)));
  const signatures = p.outputs.map((o) => {
    const C_ = cc.hexOf(cc.compressed(cc.mul(scalar, cc.point(o.B_))));
    const nonce = 0x42n;
    const e = cc.int(
      cc.hashE(
        cc.mul(nonce),
        cc.mul(nonce, cc.point(o.B_)),
        cc.point(K),
        cc.point(C_),
      ),
    );
    return {
      id: o.id,
      amount: o.amount,
      C_,
      dleq: {
        e: cc.hexOf(cc.bytes32(e)),
        s: cc.hexOf(cc.bytes32((nonce + e * scalar) % cc.N)),
      },
    };
  });
  const m = {
    spent: false,
    lose: false,
    pending: false,
    partial: false,
    invalid: false,
    calls,
    p,
    async request(route, body) {
      calls.push({ route, body: structuredClone(body) });
      if (route === "/v1/keysets")
        return {
          keysets: vector.keysets.map((id) => ({
            id,
            unit: "sat",
            active: true,
            input_fee_ppk: 0,
          })),
        };
      if (route.startsWith("/v1/keys/"))
        return { keysets: [{ id: route.slice(9), keys: { 4: K, 8: K } }] };
      if (route === "/v1/checkstate")
        return {
          states: body.Ys.map((Y) => ({
            Y,
            state: m.pending ? "PENDING" : m.spent ? "SPENT" : "UNSPENT",
          })).reverse(),
        };
      if (route === "/v1/restore") {
        if (!m.spent) return { outputs: [], signatures: [] };
        const r = {
          outputs: structuredClone(p.outputs).reverse(),
          signatures: structuredClone(signatures).reverse(),
        };
        if (m.partial) {
          r.outputs.pop();
          r.signatures.pop();
        }
        if (m.invalid) delete r.signatures[0].dleq;
        return r;
      }
      if (route === "/v1/swap") {
        assert.deepEqual(body.outputs, p.outputs);
        m.spent = true;
        if (m.lose) throw Error("reply lost");
        return { signatures };
      }
      throw Error("unexpected route");
    },
  };
  return m;
}

test("lost swap response recovers exact outputs and replay never submits again", async () => {
  const m = mint();
  m.lose = true;
  let disk = journal();
  const args = {
    journal: disk,
    policy,
    crypto,
    request: m.request,
    save: async (s) => {
      disk = structuredClone(s);
    },
  };
  const r = await reconcilePayment(args);
  assert.equal(r.state, "outputs-confirmed");
  assert.equal(r.evidence.signatures.length, 2);
  await reconcilePayment({ ...args, journal: disk });
  assert.equal(m.calls.filter((c) => c.route === "/v1/swap").length, 1);
});

test("failed pre-submit save prevents spending; failed final save resumes from submitted intent", async () => {
  const m = mint();
  await assert.rejects(
    reconcilePayment({
      journal: journal(),
      policy,
      crypto,
      request: m.request,
      save: async () => {
        throw Error("disk");
      },
    }),
    /disk/,
  );
  assert.equal(m.calls.filter((c) => c.route === "/v1/swap").length, 0);
  let disk = journal();
  await assert.rejects(
    reconcilePayment({
      journal: disk,
      policy,
      crypto,
      request: m.request,
      save: async (s) => {
        if (s.state === "outputs-confirmed") throw Error("disk");
        disk = structuredClone(s);
      },
    }),
    /disk/,
  );
  assert.equal(disk.state, "submitted");
  const r = await reconcilePayment({
    journal: disk,
    policy,
    crypto,
    request: m.request,
    save: async () => {},
  });
  assert.equal(r.state, "outputs-confirmed");
  assert.equal(m.calls.filter((c) => c.route === "/v1/swap").length, 1);
});

test("pending, incomplete and invalid evidence never confirms or triggers another swap", async () => {
  const pending = mint();
  pending.pending = true;
  const r = await reconcilePayment({
    journal: journal(),
    policy,
    crypto,
    request: pending.request,
    save: async () => {},
  });
  assert.equal(r.state, "pending");
  assert.equal(pending.calls.filter((c) => c.route === "/v1/swap").length, 0);
  for (const flag of ["partial", "invalid"]) {
    const m = mint();
    m.spent = true;
    m[flag] = true;
    await assert.rejects(
      reconcilePayment({
        journal: journal(),
        policy,
        crypto,
        request: m.request,
        save: async () => {},
      }),
    );
    assert.equal(m.calls.filter((c) => c.route === "/v1/swap").length, 0);
  }
});

test("cached confirmed claims are reverified and foreign scope fails before HTTP", async () => {
  const m = mint(),
    j = journal();
  j.state = "outputs-confirmed";
  m.spent = true;
  m.invalid = true;
  await assert.rejects(
    reconcilePayment({
      journal: j,
      policy,
      crypto,
      request: m.request,
      save: async () => {},
    }),
  );
  const foreign = journal();
  foreign.scope = "00".repeat(45);
  m.calls.length = 0;
  await assert.rejects(
    reconcilePayment({
      journal: foreign,
      policy,
      crypto,
      request: m.request,
      save: async () => {},
    }),
  );
  assert.equal(m.calls.length, 0);
});
