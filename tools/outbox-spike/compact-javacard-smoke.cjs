/* Offline converter/simulator conformance. No reader, phone or network access. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const cc = require("../cardsim/cashu-crypto.cjs");
const { fixtureView, exportCompact } = require("./compact-export.cjs");
const original = require("./fixtures/assisted-settlement-v1.json");
const artifact = path.resolve(process.argv[2]);
const root = path.resolve(__dirname, "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(artifact, "manifest.json")),
);
assert.equal(manifest.kind, "compact-javacard-prototype");
assert.equal(manifest.probeFormat, 5);
const cmd = (ins, data = Buffer.alloc(0)) =>
  Buffer.concat([
    Buffer.from([0xb0, ins, 0, 0]),
    data.length
      ? Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0])])
      : Buffer.from([0]),
  ]).toString("hex");
const n32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const load = (p) =>
  cmd(
    0x71,
    Buffer.concat([
      Buffer.from([p.slot]),
      n32(p.generation),
      Buffer.from([p.keysetRef]),
      n32(p.amount),
      Buffer.from(p.nonce + p.C, "hex"),
    ]),
  );
function setup(v) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(v.identity.id) - 1n);
  const steps = [
    "00a404000bF04341534855434D505401",
    cmd(
      0x7e,
      Buffer.concat([
        counter,
        Buffer.from(v.context.installation, "hex"),
        Buffer.from([Buffer.byteLength(v.context.mint)]),
        Buffer.from(v.context.mint),
      ]),
    ),
  ];
  v.keysets.forEach((id, i) =>
    steps.push(
      cmd(
        0x78,
        Buffer.concat([
          Buffer.from([i, id.length / 2]),
          Buffer.from(id, "hex"),
        ]),
      ),
    ),
  );
  v.proofs.forEach((p) => steps.push(load(p)));
  return steps;
}
const begin = (v) =>
  cmd(
    0x72,
    Buffer.from([
      v.proofs.length,
      v.outputs.length,
      ...v.proofs.map((p) => p.slot),
    ]),
  );
function outputs(v) {
  const steps = [];
  for (let at = 0; at < v.outputs.length; at += 6)
    steps.push(
      cmd(
        0x73,
        Buffer.concat(
          v.outputs
            .slice(at, at + 6)
            .map((o) =>
              Buffer.concat([
                n32(o.amount),
                Buffer.from([o.keysetRef]),
                Buffer.from(o.B_, "hex"),
              ]),
            ),
        ),
      ),
    );
  return steps;
}
function run(steps) {
  const r = spawnSync(
    "java",
    [
      "-cp",
      path.join(artifact, "sim-classes") +
        path.delimiter +
        path.join(root, "tools/cardsim/target/cardsim.jar"),
      "CompactHarness",
    ],
    {
      input: JSON.stringify({ steps }) + "\n",
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120000,
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const line = r.stdout
    .split("\n")
    .find((l) => l.startsWith("COMPACT_RESULT:"));
  assert.ok(line, r.stdout);
  return JSON.parse(line.slice(15));
}
const response = (r) => ({
  sw: parseInt(r.hex.slice(-4), 16),
  data: Buffer.from(r.hex.slice(0, -4), "hex"),
  cut: r.cut,
});
const ok = (r) => {
  assert.equal(response(r).sw, 0x9000);
  return response(r).data;
};
const page = (index, offset, count) =>
  cmd(0x75, Buffer.from([index, offset >> 8, offset & 255, count]));
function readSteps(length) {
  const steps = [];
  for (let at = 0; at < length; at += 255)
    steps.push(page(0, at, Math.min(255, length - at)));
  return steps;
}
function verify(v, scope, packet) {
  const identity = {
    installation: v.context.installation,
    index: scope[0],
    id: scope.readBigUInt64BE(1),
    generation: scope.readUInt32BE(9),
  };
  const compact = Buffer.concat([
    Buffer.from(v.expected.compact, "hex").subarray(0, -128),
    packet.subarray(-128),
  ]);
  const record = {
    ...identity,
    inputs: v.proofs.map((p) => ({ slot: p.slot, generation: p.generation })),
    packet: compact,
  };
  const e = exportCompact(record, fixtureView(v.context, v.keysets, v.proofs), {
    pageBytes: 37,
  });
  assert.ok(
    Buffer.concat([...e.pages()]).equals(packet),
    "Java bytes match independently verified Node canonical export",
  );
  assert.equal(e.packetId, scope.subarray(13).toString("hex"));
  return e;
}
test("converted private image preserves the control instance shape and signs both candidate commitments", () => {
  const manifestBytes = fs.readFileSync(path.join(artifact, "manifest.json"));
  assert.throws(() =>
    require("./run-probe.cjs").artifact(
      path.join(artifact, "manifest.json"),
      require("node:crypto")
        .createHash("sha256")
        .update(manifestBytes)
        .digest("hex"),
    ),
  );
  assert.deepEqual(manifest.classShape, {
    declaredInstanceSize: 50,
    firstReferenceToken: 0,
    referenceCount: 50,
  });
  const v = clone(original),
    steps = setup(v);
  steps.push(begin(v), ...outputs(v));
  const signAt = steps.length;
  steps.push(cmd(0x74));
  const pageAt = steps.length;
  steps.push(...readSteps(559), cmd(0x7d), cmd(0x76));
  const r = run(steps);
  r.forEach(ok);
  assert.ok(ok(r[0]).equals(Buffer.from("CPROT\x02")));
  const scope = ok(r[signAt]),
    packet = Buffer.concat(r.slice(pageAt, pageAt + 3).map(ok));
  assert.equal(verify(v, scope, packet).byteLength, 559);
  assert.equal(scope.readBigUInt64BE(1), BigInt(v.identity.id));
  const mem = ok(r.at(-2));
  assert.equal(mem.readUInt16BE(10), 16384);
  assert.equal(mem.readUInt16BE(12), 12288);
  assert.equal(mem[14], 2);
  assert.equal(mem[15], 5);
  assert.deepEqual([...ok(r.at(-1)).subarray(2, 5)], [0, 2, 126]);
});
test("large input/output counts stream across short APDUs without new transient buffers", () => {
  const v = clone(original);
  v.identity.id = "1";
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
  v.expected.compact = Buffer.concat([
    Buffer.from([1, 128]),
    ...v.outputs.map((o) =>
      Buffer.concat([
        n32(o.amount),
        Buffer.from([o.keysetRef]),
        Buffer.from(o.B_, "hex"),
      ]),
    ),
    Buffer.alloc(128),
  ]).toString("hex");
  const steps = setup(v);
  steps.push(begin(v), ...outputs(v));
  const signAt = steps.length;
  steps.push(cmd(0x74));
  const pageAt = steps.length;
  steps.push(...readSteps(23163), cmd(0x76));
  const r = run(steps);
  r.forEach(ok);
  const packet = Buffer.concat(r.slice(pageAt, -1).map(ok));
  assert.equal(packet.length, 23163);
  verify(v, ok(r[signAt]), packet);
  assert.deepEqual([...ok(r.at(-1)).subarray(2, 5)], [0, 128, 0]);
});
test("staged signatures stay hidden and committed burn intent resumes after simulated cuts", () => {
  for (const cut of [
    "begin-fixed",
    "frame-staged",
    "payment-staged",
    "descriptor-staged",
    "published",
    "burn-slot",
    "burn-complete",
  ]) {
    const v = clone(original),
      steps = setup(v);
    if (cut === "begin-fixed" || cut === "frame-staged")
      steps.push({ apdu: begin(v), cut });
    else steps.push(begin(v), ...outputs(v), { apdu: cmd(0x74), cut });
    const cutAt = steps.length - 1;
    steps.push({ reset: true }, cmd(0x76), cmd(0x7c, Buffer.from([0])));
    const r = run(steps);
    r.slice(0, cutAt).forEach(ok);
    assert.ok(r[cutAt].cut, cut);
    ok(r[cutAt + 1]);
    const committed = ["published", "burn-slot", "burn-complete"].includes(cut);
    const status = ok(r[cutAt + 2]);
    assert.deepEqual(
      [...status.subarray(2, 5)],
      committed ? [0, 2, 126] : [2, 0, 126],
      cut,
    );
    assert.equal(response(r.at(-1)).sw, committed ? 0x9000 : 0x6985, cut);
  }
});
test("retirement resumes through proof clearing and partial page release; stale scopes cannot clear new work", () => {
  for (const cut of ["clear-slot", "releasing", "page-release"]) {
    const v = clone(original),
      steps = setup(v);
    steps.push(begin(v), ...outputs(v), cmd(0x74));
    const at = steps.length;
    steps.push({ retire: 0, cut }, { reset: true }, cmd(0x76), { retire: 0 });
    const r = run(steps);
    r.slice(0, at).forEach(ok);
    assert.ok(r[at].cut, cut);
    ok(r[at + 1]);
    assert.deepEqual([...ok(r[at + 2])], [64, 90, 0, 0, 128, 0]);
    assert.equal(response(r.at(-1)).sw, 0x6985);
  }
  const v = clone(original),
    steps = setup(v);
  steps.push(
    begin(v),
    ...outputs(v),
    cmd(0x74),
    { retire: 0, flip: 44 },
    cmd(0x76),
    { retire: 0 },
    load({ ...v.proofs[0], generation: 10, nonce: "33".repeat(32) }),
  );
  steps.push({ retire: 0 }, cmd(0x76));
  const r = run(steps);
  assert.equal(response(r.at(-6)).sw, 0x6985);
  assert.equal(response(r.at(-2)).sw, 0x6985);
  assert.deepEqual([...ok(r.at(-1)).subarray(2, 5)], [1, 0, 127]);
});
test("incomplete staging, bad registry mappings and production commands cannot sign", () => {
  const v = clone(original),
    steps = setup(v);
  steps.push(
    cmd(
      0x78,
      Buffer.concat([
        Buffer.from([2, 33]),
        Buffer.from(v.keysets[0].slice(0, -2) + "24", "hex"),
      ]),
    ),
    begin(v),
    cmd(0x74),
    { reset: true },
    cmd(0x76),
  );
  for (const ins of [
    0x20, 0x24, 0x26, 0x30, 0x31, 0x32, 0x40, 0x41, 0x43, 0x51,
  ])
    steps.push(cmd(ins));
  const r = run(steps),
    at = setup(v).length;
  assert.equal(response(r[at]).sw, 0x6a80);
  ok(r[at + 1]);
  assert.equal(response(r[at + 2]).sw, 0x6985);
  ok(r[at + 3]);
  assert.equal(ok(r[at + 4])[2], 2);
  r.slice(at + 5).forEach((x) => assert.equal(response(x).sw, 0x6d00));
});
test("the byte-backed pool refuses before signing when full and can reuse retired pages", () => {
  const v = clone(original);
  v.identity.id = "1";
  v.keysets = [v.keysets[0]];
  v.proofs = [];
  v.outputs = [
    { amount: 1, keysetRef: 0, B_: cc.compressed(cc.mul(11n)).toString("hex") },
  ];
  for (let i = 0; i < 46; i++)
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
  const steps = setup(v);
  for (let i = 0; i < 45; i++)
    steps.push(cmd(0x72, Buffer.from([1, 1, i])), ...outputs(v), cmd(0x74));
  const fullAt = steps.length;
  steps.push(
    cmd(0x72, Buffer.from([1, 1, 45])),
    cmd(0x76),
    { retire: 0 },
    cmd(0x72, Buffer.from([1, 1, 45])),
    ...outputs(v),
    cmd(0x74),
    { retire: 0 },
    cmd(0x76),
  );
  const r = run(steps);
  r.slice(0, fullAt).forEach(ok);
  assert.equal(response(r[fullAt]).sw, 0x6a84);
  assert.deepEqual([...ok(r[fullAt + 1]).subarray(1, 4)], [0, 1, 45]);
  r.slice(fullAt + 2, -2).forEach(ok);
  assert.equal(response(r.at(-2)).sw, 0x6985);
  assert.equal(ok(r.at(-1))[3], 45);
});
test("a load cut before its status commit is ignored and exhausted payment IDs cannot wrap", () => {
  const v = clone(original),
    steps = setup({ ...v, proofs: [] });
  steps.push(
    { apdu: load(v.proofs[0]), cut: "load-data" },
    { reset: true },
    cmd(0x76),
  );
  const r = run(steps);
  assert.ok(r.at(-3).cut);
  ok(r.at(-2));
  assert.deepEqual([...ok(r.at(-1)).subarray(2, 5)], [0, 0, 128]);
  v.identity.id = (1n << 64n).toString();
  const all = setup(v);
  all.push(begin(v), cmd(0x76));
  const exhausted = run(all);
  exhausted.slice(0, -2).forEach(ok);
  assert.equal(response(exhausted.at(-2)).sw, 0x6985);
  assert.equal(ok(exhausted.at(-1))[2], 2);
});
test("a fresh session revalidates packet integrity instead of trusting the export cache", () => {
  const v = clone(original),
    steps = setup(v);
  steps.push(begin(v), ...outputs(v), cmd(0x74), page(0, 0, 64));
  const at = steps.length;
  steps.push(
    { reset: true, corruptProof: v.proofs[0].slot * 82 + 13 },
    cmd(0x7c, Buffer.from([0])),
    page(0, 0, 64),
    cmd(0x76),
  );
  const r = run(steps);
  r.slice(0, at).forEach(ok);
  ok(r[at]);
  assert.equal(response(r[at + 1]).sw, 0x6985);
  assert.equal(response(r[at + 2]).sw, 0x6985);
  assert.deepEqual([...ok(r.at(-1)).subarray(2, 5)], [0, 2, 126]);
});
