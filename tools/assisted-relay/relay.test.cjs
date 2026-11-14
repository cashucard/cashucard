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

// Optional settings, each a no-op by default: `catalogue` is what /v1/keysets
// returns, `ids` maps a packet's keyset id to the full id the mint knows it by
// (swap, restore and the signatures use it), `states` gives each input's state.
function mint({
  catalogue = vector.keysets.map((id) => ({
    id,
    unit: "sat",
    active: true,
    input_fee_ppk: 0,
  })),
  ids = {},
  states,
} = {}) {
  const p = decodePacket(raw(), policy, crypto),
    calls = [];
  const full = (id) => ids[id] ?? id;
  const sent = p.outputs.map((o) => ({ ...o, id: full(o.id) }));
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
      id: full(o.id),
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
        return { keysets: structuredClone(catalogue) };
      if (route.startsWith("/v1/keys/"))
        return { keysets: [{ id: route.slice(9), keys: { 4: K, 8: K } }] };
      if (route === "/v1/checkstate")
        return {
          states: body.Ys.map((Y, i) => ({
            Y,
            state:
              states?.[i] ??
              (m.pending ? "PENDING" : m.spent ? "SPENT" : "UNSPENT"),
          })).reverse(),
        };
      if (route === "/v1/restore") {
        assert.deepEqual(body.outputs, sent);
        if (!m.spent) return { outputs: [], signatures: [] };
        const r = {
          outputs: structuredClone(sent).reverse(),
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
        assert.deepEqual(body.outputs, sent);
        assert.deepEqual(
          body.inputs.map((i) => i.id),
          p.inputs.map((i) => full(i.id)),
        );
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

const swaps = (m) => m.calls.filter((c) => c.route === "/v1/swap").length;
const quiet = (m, j = journal(), save = async () => {}) => ({
  journal: j,
  policy,
  crypto,
  request: m.request,
  save,
});

test("signatures beside inputs still PENDING wait as pending, then confirm without a swap", async () => {
  const m = mint();
  m.spent = true;
  m.pending = true;
  let disk = journal();
  const r = await reconcilePayment(
    quiet(m, disk, async (s) => {
      disk = structuredClone(s);
    }),
  );
  assert.equal(r.state, "pending");
  assert.equal(r.evidence, undefined);
  assert.equal(disk.state, "pending");
  assert.equal(swaps(m), 0);
  m.pending = false;
  const done = await reconcilePayment(quiet(m, disk));
  assert.equal(done.state, "outputs-confirmed");
  assert.equal(done.evidence.signatures.length, 2);
  assert.equal(swaps(m), 0);
});

test("signatures beside an UNSPENT input stay settlement-unresolved", async () => {
  const m = mint({ states: ["PENDING", "UNSPENT"] });
  m.spent = true;
  await assert.rejects(reconcilePayment(quiet(m)), /settlement-unresolved/);
  assert.equal(swaps(m), 0);
});

const SHORT = "0077010203040506";
const V2 = SHORT + "a1".repeat(25);
const v2Catalogue = (extra = [], over = {}) => [
  ...vector.keysets.map((id) => ({
    id: id === SHORT ? V2 : id,
    unit: "sat",
    active: true,
    input_fee_ppk: 0,
    ...(id === SHORT ? over : {}),
  })),
  ...extra,
];

test("an 8-byte packet keyset resolves to the mint's full v2 id for swap and restore", async () => {
  const m = mint({ catalogue: v2Catalogue(), ids: { [SHORT]: V2 } });
  let disk = journal();
  const saves = [];
  const r = await reconcilePayment(
    quiet(m, disk, async (s) => {
      saves.push(structuredClone(s));
      disk = structuredClone(s);
    }),
  );
  assert.equal(r.state, "outputs-confirmed");
  assert.equal(swaps(m), 1);
  // The map is saved with the submitted intent, before the swap.
  const submittedSave = saves.find((s) => s.state === "submitted");
  assert.deepEqual(submittedSave.keysetIds, { [SHORT]: V2 });
  assert.deepEqual(r.keysetIds, { [SHORT]: V2 });
  assert.deepEqual(r.evidence.keysetIds, { [SHORT]: V2 });
  // Evidence keeps the packet's outputs, so the packet id still links them.
  assert.deepEqual(r.evidence.outputs, m.p.outputs);
  const short = m.p.outputs.findIndex((o) => o.id === SHORT);
  assert.equal(r.evidence.signatures[short].id, V2);
  for (const c of m.calls.filter((c) => c.route.startsWith("/v1/keys/")))
    assert.notEqual(c.route, "/v1/keys/" + SHORT);
  // A replay reuses the saved map and never submits again.
  const again = await reconcilePayment(quiet(m, disk));
  assert.equal(again.state, "outputs-confirmed");
  assert.equal(swaps(m), 1);
});

test("a v2 journal saved as pending keeps its keyset map and resumes on full ids", async () => {
  const m = mint({ catalogue: v2Catalogue(), ids: { [SHORT]: V2 } });
  m.pending = true;
  m.spent = false;
  let disk = journal();
  const r = await reconcilePayment(
    quiet(m, disk, async (s) => {
      disk = structuredClone(s);
    }),
  );
  assert.equal(r.state, "pending");
  assert.equal(disk.state, "pending");
  assert.deepEqual(disk.keysetIds, { [SHORT]: V2 });
  assert.equal(swaps(m), 0);
  // The resumed journal must reuse the saved map: the mock's swap asserts full
  // ids on inputs and outputs, so an identity map would fail input-keyset.
  m.pending = false;
  const done = await reconcilePayment(
    quiet(m, disk, async (s) => {
      disk = structuredClone(s);
    }),
  );
  assert.equal(done.state, "outputs-confirmed");
  assert.equal(swaps(m), 1);
  assert.deepEqual(done.keysetIds, { [SHORT]: V2 });
});

test("an 8-byte mint keeps identity ids and evidence carries no keyset map", async () => {
  const m = mint();
  const r = await reconcilePayment(quiet(m));
  assert.equal(r.state, "outputs-confirmed");
  assert.equal(r.keysetIds, undefined);
  assert.equal(r.evidence.keysetIds, undefined);
  assert.deepEqual(
    r.evidence.signatures.map((s) => s.id),
    m.p.outputs.map((o) => o.id),
  );
});

test("an ambiguous, inactive or non-sat resolved keyset fails closed without a swap", async () => {
  const cases = [
    [
      v2Catalogue([
        {
          id: SHORT + "b2".repeat(25),
          unit: "sat",
          active: true,
          input_fee_ppk: 0,
        },
      ]),
      /keyset-ambiguous/,
    ],
    [v2Catalogue([], { active: false }), /inactive-output-keyset/],
    [v2Catalogue([], { unit: "usd" }), /input-keyset/],
  ];
  for (const [catalogue, code] of cases) {
    const m = mint({ catalogue, ids: { [SHORT]: V2 } });
    await assert.rejects(reconcilePayment(quiet(m)), code);
    assert.equal(swaps(m), 0);
  }
});

test("a submitted journal reuses its keyset map; a tampered map is refused", async () => {
  const twin = {
    id: SHORT + "b2".repeat(25),
    unit: "sat",
    active: true,
    input_fee_ppk: 0,
  };
  const m = mint({ catalogue: v2Catalogue([twin]), ids: { [SHORT]: V2 } });
  m.spent = true;
  const j = { ...journal(), state: "submitted", keysetIds: { [SHORT]: V2 } };
  const r = await reconcilePayment(quiet(m, j));
  assert.equal(r.state, "outputs-confirmed");
  assert.equal(swaps(m), 0);
  for (const keysetIds of [
    { [SHORT]: "ff".repeat(33) },
    { [SHORT]: SHORT },
    { ["0177010203040506"]: "0177010203040506" + "a1".repeat(25) },
    { [SHORT]: SHORT + "c3".repeat(25) },
    {},
    [V2],
  ]) {
    const t = mint({ catalogue: v2Catalogue([twin]), ids: { [SHORT]: V2 } });
    t.spent = true;
    await assert.rejects(
      reconcilePayment(quiet(t, { ...j, keysetIds })),
      /journal/,
    );
    assert.equal(swaps(t), 0);
  }
});

test("a 510-byte packet is captured after pages 0 and 255 and never read at its end", async () => {
  const fixed = Array(32).fill(7);
  const stub = {
    hash: () => fixed,
    verify: () => true,
    point: () => true,
  };
  const key = "02" + "11".repeat(32);
  const mintUrl = "https://mint.test/" + "a".repeat(144);
  const u32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const body = [
    ...Buffer.from("CCP-AS\x01", "latin1"),
    ...Buffer.from(key, "hex"),
    ...Array(32).fill(0x31),
    ...[0, 0, 0, 0, 0, 0, 0, 1],
    0,
    ...u32(1),
    1,
    ...[0, mintUrl.length],
    ...Buffer.from(mintUrl),
    0,
    1,
    ...[0, ...u32(1), ...u32(8), 8, ...Array(8).fill(9)],
    ...Array(32).fill(5),
    ...[2, ...Array(32).fill(3)],
    1,
    ...[...u32(8), 8, ...Array(8).fill(9), 2, ...Array(32).fill(4)],
    ...Array(64).fill(1),
  ];
  const packet = [...body, ...Array(64).fill(2)];
  assert.equal(mintUrl.length, 162);
  assert.equal(packet.length, 510);
  const stubPolicy = {
    mint: mintUrl,
    cardKey: key,
    installation: "31".repeat(32),
  };
  const readScope = async () => [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    ...u32(1),
    ...fixed,
  ];
  const reads = [];
  const r = await capturePacket({
    policy: stubPolicy,
    crypto: stub,
    readScope,
    readPage: async (offset, count) => {
      reads.push(offset);
      if (offset >= packet.length) throw { sw: 0x6a83 };
      return packet.slice(offset, offset + count);
    },
    save: async () => {},
  });
  assert.deepEqual(reads, [0, 255]);
  assert.equal(r.state, "captured");
  assert.equal(r.packet, Buffer.from(packet).toString("hex"));
});

// 2.3: the packet's unit is 00 sat or 01 usd, and the relay settles a usd payment
// against the mint's usd keysets alone. (The body changed, so the descriptor is
// not checked here: `trusting` verifies every signature.)
const trusting = { ...crypto, verify: () => true };
function withUnit(unit) {
  const b = raw();
  const mintLength = (b[86] << 8) | b[87];
  b[88 + mintLength] = unit;
  return b;
}

test("a usd packet (unit 01) decodes as usd, and any other unit byte is refused", () => {
  assert.equal(decodePacket(withUnit(0), policy, trusting).unit, "sat");
  assert.equal(decodePacket(withUnit(1), policy, trusting).unit, "usd");
  assert.throws(() => decodePacket(withUnit(2), policy, trusting), /unit/);
});

test("a usd payment is settled against usd keysets, and refused against sat ones", async () => {
  const usd = vector.keysets.map((id) => ({
    id,
    unit: "usd",
    active: true,
    input_fee_ppk: 0,
  }));
  const j = () => ({
    ...journal(),
    packet: Buffer.from(withUnit(1)).toString("hex"),
    scope: decodePacket(withUnit(1), policy, trusting).scope,
  });
  const ok = mint({ catalogue: usd });
  const r = await reconcilePayment({
    journal: j(),
    policy,
    crypto: trusting,
    request: ok.request,
    save: async () => {},
  });
  assert.equal(r.state, "outputs-confirmed");
  const sat = mint();
  await assert.rejects(
    reconcilePayment({
      journal: j(),
      policy,
      crypto: trusting,
      request: sat.request,
      save: async () => {},
    }),
    /input-keyset/,
  );
});

// 2.3: the packet names the card's key for the date 0, P + t*G, never the card
// key P that GET_PUBKEY answers. The policy names it as `date0Key`; an older
// policy's `cardKey` is read as the same key where no `date0Key` is given.
test("the policy's date0Key is the key the packet must name", () => {
  const key = vector.context.cardKey;
  const { cardKey, ...rest } = policy;
  assert.equal(
    decodePacket(raw(), { ...rest, date0Key: key }, crypto).cardKey,
    key,
  );
  assert.throws(
    () =>
      decodePacket(raw(), { ...rest, date0Key: "03" + key.slice(2) }, crypto),
    /context/,
  );
  assert.throws(
    () =>
      decodePacket(raw(), { ...policy, date0Key: "03" + key.slice(2) }, crypto),
    /context/,
    "date0Key is read before an older cardKey",
  );
  assert.throws(
    () => decodePacket(raw(), rest, crypto),
    /context/,
    "no key, no packet",
  );
});
