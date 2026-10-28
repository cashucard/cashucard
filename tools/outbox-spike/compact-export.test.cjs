const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const cc = require("../cardsim/cashu-crypto.cjs");
const { Store } = require("./storage-model.cjs");
const {
  fixtureView,
  exportCompact,
  signCompact,
  compactBytes,
  budget,
} = require("./compact-export.cjs");
const vector = require("./fixtures/assisted-settlement-v1.json");
const clone = (v) => JSON.parse(JSON.stringify(v));
const view = (v) => fixtureView(v.context, v.keysets, v.proofs);
const refs = (v) =>
  v.proofs.map((p) => ({ slot: p.slot, generation: p.generation }));
const record = (v) => ({
  ...v.identity,
  id: BigInt(v.identity.id),
  inputs: refs(v),
  packet: Buffer.from(v.expected.compact, "hex"),
});
const collect = (e) => Buffer.concat([...e.pages()]);
// Reuse the independently tested reference signer with the public BIP-340 test
// scalar 3. No wallet, holder or card-manager key is accepted by this helper.
function signer(message) {
  const directory = path.resolve(__dirname, "../cardctl");
  return Buffer.from(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys;sys.path.insert(0,sys.argv[1]);from test_bip340 import reference_sign;print(reference_sign(3,bytes.fromhex(sys.argv[2]),bytes(32))[1].hex())",
        directory,
        message.toString("hex"),
      ],
      { encoding: "utf8" },
    ).trim(),
    "hex",
  );
}
test("streamed export matches the independent signed Python vector at every page boundary", () => {
  for (const pageBytes of [1, 37, 64, 255]) {
    const e = exportCompact(record(vector), view(vector), { pageBytes });
    assert.equal(collect(e).toString("hex"), vector.expected.packet);
    assert.equal(e.packetId, vector.expected.packetId);
    assert.equal(e.paymentMessage, vector.expected.paymentMessage);
    assert.equal(e.descriptorMessage, vector.expected.descriptorMessage);
    assert.ok(
      [...e.pages()].every((p) => p.length > 0 && p.length <= pageBytes),
    );
  }
  assert.throws(
    () =>
      exportCompact(
        { ...record(vector), id: Number(vector.identity.id) },
        view(vector),
      ),
    /identity/,
  );
});
test("metadata outside SIG_ALL is bound by the descriptor and stale references fail closed", () => {
  for (const mutate of [
    (v) => (v.context.mint += "/"),
    (v) => (v.context.installation = "42".repeat(32)),
    (v) => (v.keysets[0] = v.keysets[0].slice(0, -2) + "24"),
    (v) => v.proofs[0].amount++,
    (v) => v.proofs[0].generation++,
  ]) {
    const v = clone(vector);
    mutate(v);
    assert.throws(
      () => exportCompact(record(vector), view(v)),
      /identity|generation|signature/,
    );
  }
  const wrong = record(vector);
  wrong.generation++;
  assert.throws(() => exportCompact(wrong, view(vector)), /signature/);
  const p = record(vector);
  p.packet[p.packet.length - 1] ^= 1;
  assert.throws(() => exportCompact(p, view(vector)), /signature/);
});
test("unsupported profiles and ambiguous keysets are refused instead of being rewritten", () => {
  for (const mutate of [
    (v) => (v.context.unit = 1),
    (v) => (v.context.mint = "https://user:password@mint.example.com"),
    (v) => (v.context.mint = "https://mint.example.com?query=1"),
    (v) => (v.context.mint = "https://mint.example.com?"),
    (v) => (v.context.mint = "https://mint.example.com#"),
    (v) => (v.proofs[0].secret = "an alternative secret"),
    (v) => (v.proofs[0].format = 3),
    (v) => (v.context.profile = 2),
    (v) => (v.proofs[0].date = 1),
    (v) => (v.proofs[0].keysetPrefix = "ff".repeat(8)),
    (v) => v.keysets.push(v.keysets[0].slice(0, -2) + "24"),
    (v) => (v.proofs[1].nonce = v.proofs[0].nonce),
  ]) {
    const v = clone(vector);
    mutate(v);
    assert.throws(() => view(v));
  }
  for (const role of ["change", "refund"]) {
    const outputs = vector.outputs.map((o) => ({ ...o, role }));
    assert.throws(
      () =>
        signCompact(record(vector), outputs, view(vector), () => {
          throw Error("signer reached");
        }),
      /outputs/,
    );
  }
  const r = record(vector);
  r.packet = Buffer.concat([r.packet, Buffer.from([0])]);
  assert.throws(() => exportCompact(r, view(vector)), /compact/);
  assert.throws(
    () =>
      exportCompact(
        { ...record(vector), inputs: [refs(vector)[0], refs(vector)[0]] },
        view(vector),
      ),
    /inputs/,
  );
  assert.throws(
    () => exportCompact(record(vector), view(vector), { pageBytes: 256 }),
    /page/,
  );
});
test("published compact records reconstruct exact packets across a storage restart", () => {
  const v = clone(vector);
  v.proofs = v.proofs.map((p) => ({ ...p, generation: 1 }));
  const state = view(v),
    s = new Store({
      installation: Buffer.from(v.context.installation, "hex"),
      bytes: budget(32).storeBytes,
    });
  for (const p of v.proofs) s.load(p.slot);
  const ack = s.publish(
    v.proofs.map((p) => p.slot),
    (plan) => signCompact(plan, v.outputs, state, signer),
    { packetBytes: compactBytes(v.outputs.length) },
  );
  const resumed = new Store({ image: Buffer.from(s.image) });
  const raw = resumed.export()[0],
    e = exportCompact(raw, state);
  assert.equal(collect(e).length, 559);
  assert.equal(
    e.packetId,
    exportCompact(raw, state, { pageBytes: 1 }).packetId,
  );
  resumed.retire(ack);
  assert.equal(resumed.export().length, 0);
  resumed.load(v.proofs[0].slot);
  assert.throws(
    () =>
      resumed.publish(
        [v.proofs[0].slot],
        (plan) => signCompact(plan, v.outputs, state, signer),
        { packetBytes: compactBytes(2) },
      ),
    /generation/,
  );
});
test("capacity and callback failures stop before a signing attempt or proof consumption", () => {
  const s = new Store({ installation: Buffer.alloc(32, 1), records: 1 });
  s.load(0);
  s.load(1);
  let calls = 0;
  assert.throws(() =>
    s.publish(
      [0],
      () => {
        calls++;
        return Buffer.alloc(1);
      },
      { packetBytes: 20000 },
    ),
  );
  assert.equal(calls, 0);
  const before = Buffer.from(s.image);
  assert.throws(
    () =>
      s.publish(
        [0],
        () => {
          throw Error("signing refused");
        },
        { packetBytes: 168 },
      ),
    /signing refused/,
  );
  assert.deepEqual(s.image, before);
  assert.throws(
    () => s.publish([0], () => s.load(2), { packetBytes: 168 }),
    /reentrant/,
  );
  assert.deepEqual(s.image, before);
  s.publish([0], () => Buffer.alloc(168), { packetBytes: 168 });
  assert.throws(
    () =>
      s.publish(
        [1],
        () => {
          calls++;
          return Buffer.alloc(168);
        },
        { packetBytes: 168 },
      ),
    /record capacity/,
  );
  assert.equal(calls, 0);
  assert.equal(s.unspent(), 1);
});
test("the compact budget covers registry/context/maps and admits more small payments", () => {
  const b = budget(64);
  assert.equal(b.totalBytes, 16384);
  assert.ok(b.reservedBytes >= 724 + 4 + 64 * 4);
  const s = new Store({
    installation: Buffer.alloc(32, 1),
    records: 64,
    bytes: b.storeBytes,
  });
  for (let i = 0; i < 128; i++) s.load(i);
  let count = 0;
  for (;;) {
    try {
      s.publish([count], Buffer.alloc(compactBytes(1)));
      count++;
    } catch (e) {
      assert.match(e.message, /byte capacity/);
      break;
    }
  }
  assert.equal(count, 44);
  assert.equal(s.unspent(), 128 - count);
});
test("128 inputs and 128 outputs fit the compact pool and stream a complete signed packet", () => {
  const v = clone(vector);
  v.keysets = [v.keysets[0]];
  v.proofs = [];
  v.outputs = [];
  let point = cc.mul(20n);
  for (let i = 0; i < 128; i++) {
    v.proofs.push({
      slot: i,
      generation: 1,
      amount: 1,
      keysetRef: 0,
      keysetPrefix: v.keysets[0].slice(0, 16),
      nonce: cc.bytes32(BigInt(i + 1)).toString("hex"),
      C: cc.compressed(cc.G).toString("hex"),
      date: 0,
    });
    v.outputs.push({
      amount: 1,
      keysetRef: 0,
      B_: cc.compressed(point).toString("hex"),
    });
    point = cc.add(point, cc.G);
  }
  const state = view(v),
    b = budget(64),
    s = new Store({
      installation: Buffer.from(v.context.installation, "hex"),
      records: 64,
      bytes: b.storeBytes,
    });
  for (let i = 0; i < 128; i++) s.load(i);
  v.identity = {
    installation: v.context.installation,
    id: "1",
    index: 0,
    generation: 1,
  };
  const expected = JSON.parse(
    execFileSync(
      "python3",
      [path.join(__dirname, "make-vector.py"), "--encode"],
      { input: JSON.stringify(v), encoding: "utf8" },
    ),
  );
  s.publish(
    v.proofs.map((p) => p.slot),
    (plan) =>
      signCompact(plan, v.outputs, state, (message, purpose) => {
        assert.equal(
          message.toString("hex"),
          purpose === "payment"
            ? expected.paymentMessage
            : expected.descriptorMessage,
        );
        const data = Buffer.from(expected.compact, "hex");
        return purpose === "payment"
          ? data.subarray(-128, -64)
          : data.subarray(-64);
      }),
    { packetBytes: compactBytes(128) },
  );
  const raw = s.export()[0];
  assert.equal(raw.packet.length, 4994);
  const e = exportCompact(raw, state, { pageBytes: 37 });
  assert.equal(collect(e).length, 23163);
  assert.ok(
    collect(e).equals(Buffer.from(expected.packet, "hex")),
    "large streamed bytes equal independent materialization",
  );
  assert.equal(e.packetId, expected.packetId);
  assert.equal(s.unspent(), 0);
  assert.equal(
    [...e.pages()].reduce((n, p) => n + p.length, 0),
    e.byteLength,
  );
});
test("output order, keyset metadata and signature domains cannot be substituted", () => {
  const v = view(vector),
    r = record(vector);
  // Output keyset is omitted by SIG_ALL but covered by the descriptor.
  const key = record(vector);
  key.packet[6] = 0;
  assert.throws(() => exportCompact(key, v), /signature/);
  const order = record(vector);
  const first = Buffer.from(order.packet.subarray(2, 40));
  order.packet.copy(order.packet, 2, 40, 78);
  first.copy(order.packet, 40);
  assert.throws(() => exportCompact(order, v), /signature/);
  const inputs = record(vector);
  inputs.inputs.reverse();
  assert.throws(() => exportCompact(inputs, v), /signature/);
  const domains = record(vector);
  domains.packet.copy(
    domains.packet,
    domains.packet.length - 64,
    domains.packet.length - 128,
    domains.packet.length - 64,
  );
  assert.throws(() => exportCompact(domains, v), /signature/);
  const duplicate = record(vector);
  duplicate.packet.copy(duplicate.packet, 45, 7, 40);
  assert.throws(() => exportCompact(duplicate, v), /outputs/);
  for (const [value, code] of [
    [0xffffffff, /overflow/],
    [13, /amount total/],
  ]) {
    const over = record(vector);
    over.packet.writeUInt32BE(value, 2);
    assert.throws(() => exportCompact(over, v), code);
  }
  const unknown = record(vector);
  unknown.packet[6] = 255;
  assert.throws(() => exportCompact(unknown, v), /keyset/);
  const malformed = record(vector);
  malformed.packet[7] = 4;
  assert.throws(() => exportCompact(malformed, v), /B_/);
  const snapshot = clone(vector),
    fixed = view(snapshot);
  snapshot.context.mint = "https://changed.example";
  snapshot.proofs[0].nonce = "ff".repeat(32);
  snapshot.keysets[0] = "00".repeat(8);
  fixed.config().installation.fill(0);
  fixed.keyset(0).fill(0);
  fixed.proof(7).nonce.fill(0);
  assert.equal(
    collect(exportCompact(r, fixed)).toString("hex"),
    vector.expected.packet,
  );
});
test("an invalid payment or descriptor signature cannot consume model proofs", () => {
  const v = clone(vector);
  v.proofs = v.proofs.map((p) => ({ ...p, generation: 1 }));
  for (const failAt of ["payment", "descriptor"]) {
    const s = new Store({
      installation: Buffer.from(v.context.installation, "hex"),
    });
    for (const p of v.proofs) s.load(p.slot);
    const before = Buffer.from(s.image);
    let calls = 0;
    assert.throws(
      () =>
        s.publish(
          v.proofs.map((p) => p.slot),
          (plan) =>
            signCompact(plan, v.outputs, view(v), (message, purpose) => {
              calls++;
              return purpose === failAt ? Buffer.alloc(64) : signer(message);
            }),
          { packetBytes: compactBytes(2) },
        ),
      /signature/,
    );
    assert.deepEqual(s.image, before);
    assert.equal(s.unspent(), 2);
    assert.equal(calls, failAt === "payment" ? 1 : 2);
  }
  for (const id of [0n, 1n << 64n])
    assert.throws(
      () =>
        signCompact(
          { ...record(vector), id },
          vector.outputs,
          view(vector),
          () => {
            throw Error("signer reached");
          },
        ),
      /identity/,
    );
});
test("the candidate fixture reproduces independently of the Node codec", () => {
  const result = execFileSync(
    "python3",
    [path.join(__dirname, "make-vector.py"), "--check"],
    { encoding: "utf8" },
  );
  assert.match(result, /Candidate vector verified/);
});
