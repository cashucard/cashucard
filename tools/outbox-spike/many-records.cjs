/* Fixed simulator qualification recipe. Importing opens no transport. */
const { createHash } = require("node:crypto");
const { fixtureView, exportCompact } = require("./compact-export.cjs");
const full = require("./fixtures/compact-capacity-v1.json");
const SELECT = "00a404000bf04341534855434d50540100";
const n32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const cmd = (ins, data = Buffer.alloc(0)) =>
  Buffer.concat([
    Buffer.from([0xb0, ins, 0, 0]),
    data.length
      ? Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0])])
      : Buffer.from([0]),
  ]).toString("hex");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const status = (n) => [64 - n, 90 - 2 * n, 46 - n, n, 82, 0];
function record(index, replacement = false) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 45 ||
    (replacement && index !== 0)
  )
    throw Error("fixed record required");
  const proof = {
    ...full.proofs[replacement ? 46 : index],
    slot: index,
    generation: replacement ? 2 : 1,
  };
  const vector = {
    context: { ...full.context },
    keysets: [...full.keysets],
    proofs: [proof],
    outputs: [{ ...full.outputs[replacement ? 45 : index] }],
  };
  const bytes =
    7 +
    33 +
    32 +
    13 +
    3 +
    Buffer.byteLength(vector.context.mint) +
    2 +
    108 +
    1 +
    71 +
    128;
  return {
    index,
    id: BigInt(replacement ? 46 : index + 1),
    generation: replacement ? 2 : 1,
    token: replacement ? "replacement-0" : "initial-" + index,
    vector,
    packetBytes: bytes,
  };
}
function load(p) {
  return cmd(
    0x71,
    Buffer.concat([
      Buffer.from([p.slot]),
      n32(p.generation),
      Buffer.from([p.keysetRef]),
      n32(p.amount),
      Buffer.from(p.nonce + p.C, "hex"),
    ]),
  );
}
function output(r) {
  const o = r.vector.outputs[0];
  return cmd(
    0x73,
    Buffer.concat([
      n32(o.amount),
      Buffer.from([o.keysetRef]),
      Buffer.from(o.B_, "hex"),
    ]),
  );
}
function pages(r) {
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
function verifyRecord(r, key, scope, packet) {
  scope = Buffer.from(scope);
  packet = Buffer.from(packet);
  key = Buffer.from(key);
  if (
    scope.length !== 45 ||
    scope[0] !== r.index ||
    scope.readBigUInt64BE(1) !== r.id ||
    scope.readUInt32BE(9) !== r.generation ||
    packet.length !== r.packetBytes
  )
    throw Error("record scope/size mismatch");
  const o = r.vector.outputs[0],
    compact = Buffer.concat([
      Buffer.from([1, 1]),
      n32(o.amount),
      Buffer.from([o.keysetRef]),
      Buffer.from(o.B_, "hex"),
      packet.subarray(-128),
    ]);
  const material = exportCompact(
    {
      installation: r.vector.context.installation,
      index: r.index,
      id: r.id,
      generation: r.generation,
      inputs: r.vector.proofs.map((p) => ({
        slot: p.slot,
        generation: p.generation,
      })),
      packet: compact,
    },
    fixtureView(
      { ...r.vector.context, cardKey: key },
      r.vector.keysets,
      r.vector.proofs,
    ),
  );
  if (
    !Buffer.concat([...material.pages()]).equals(packet) ||
    material.packetId !== scope.subarray(13).toString("hex")
  )
    throw Error("record canonical mismatch");
  return {
    packetId: material.packetId,
    packetSha256: sha(packet),
    packetBytes: packet.length,
    paymentMessage: material.paymentMessage,
    descriptorMessage: material.descriptorMessage,
  };
}
function qualification() {
  const phases = [],
    records = Array.from({ length: 45 }, (_, i) => record(i)),
    replacement = record(0, true),
    allSteps = [];
  const add = (name) => {
    const p = { name, steps: [], captures: [], checks: [] };
    phases.push(p);
    return p;
  };
  const expect = (p, apdu, sw = 0x9000, data) => {
    const at = p.steps.length;
    p.steps.push(apdu);
    p.checks.push({ at, sw, ...(data ? { data } : {}) });
    return at;
  };
  const fresh = (p, expected) => {
    expect(p, { reset: true }, 0x9000, [67, 80, 82, 79, 84, 2]);
    expect(p, cmd(0x7a), 0x9000, [...Buffer.from(full.context.cardKey, "hex")]);
    expect(p, cmd(0x76), 0x9000, expected);
  };
  const capture = (p, r) => {
    expect(p, cmd(0x72, Buffer.from([1, 1, r.index])));
    expect(p, output(r));
    const signAt = expect(p, { apdu: cmd(0x74), scopeAs: r.token });
    const pageAt = p.steps.length;
    for (const a of pages(r)) expect(p, a);
    p.captures.push({
      record: r,
      scopeAt: signAt,
      pageAt,
      pages: pages(r).length,
    });
  };
  const audit = (p, r) => {
    const scopeAt = expect(p, cmd(0x7c, Buffer.from([r.index]))),
      pageAt = p.steps.length;
    for (const a of pages(r)) expect(p, a);
    p.captures.push({ record: r, scopeAt, pageAt, pages: pages(r).length });
  };
  const mint = Buffer.from(full.context.mint),
    prep = add("prepare-fixture");
  expect(prep, SELECT, 0x9000, [67, 80, 82, 79, 84, 2]);
  expect(
    prep,
    cmd(
      0x7e,
      Buffer.concat([
        Buffer.alloc(8),
        Buffer.from(full.context.installation, "hex"),
        Buffer.from([mint.length]),
        mint,
      ]),
    ),
    0x9000,
    [1],
  );
  expect(
    prep,
    cmd(
      0x78,
      Buffer.concat([
        Buffer.from([0, 33]),
        Buffer.from(full.keysets[0], "hex"),
      ]),
    ),
    0x9000,
    [1],
  );
  for (const p of full.proofs.slice(0, 46))
    expect(prep, load(p), 0x9000, [p.slot]);
  expect(prep, cmd(0x76), 0x9000, status(0));
  for (let begin = 0; begin < 45; begin += 15) {
    const p = add("capture-" + begin);
    fresh(p, status(begin));
    for (const r of records.slice(begin, begin + 15)) capture(p, r);
    expect(p, cmd(0x76), 0x9000, status(begin + 15));
  }
  const fullPhase = add("refuse-and-verify-full");
  fresh(fullPhase, status(45));
  expect(fullPhase, cmd(0x72, Buffer.from([1, 1, 45])), 0x6a84);
  expect(fullPhase, cmd(0x76), 0x9000, status(45));
  for (const r of records) audit(fullPhase, r);
  const reuse = add("retire-reload-reuse");
  fresh(reuse, status(45));
  expect(reuse, { retireAs: "initial-0" }, 0x9000, [1]);
  expect(reuse, cmd(0x76), 0x9000, [20, 2, 1, 44, 83, 0]);
  expect(reuse, load(replacement.vector.proofs[0]), 0x9000, [0]);
  capture(reuse, replacement);
  expect(reuse, { retireAs: "initial-0" }, 0x6985);
  expect(reuse, cmd(0x76), 0x9000, status(45));
  const after = add("verify-after-reuse");
  fresh(after, status(45));
  for (const r of [replacement, ...records.slice(1)]) audit(after, r);
  const retire = add("retire-verified-records");
  fresh(retire, status(45));
  for (const r of [replacement, ...records.slice(1)])
    expect(retire, { retireAs: r.token }, 0x9000, [1]);
  expect(retire, cmd(0x76), 0x9000, [64, 90, 1, 0, 127, 0]);
  for (const p of phases) {
    p.start = allSteps.length;
    allSteps.push(...p.steps);
    if (p.steps.length > 160) throw Error("phase command budget");
  }
  return {
    name: "compact-many-records-v1",
    recordCount: 45,
    phases,
    steps: allSteps,
    records,
    replacement,
    finalStatus: [64, 90, 1, 0, 127, 0],
  };
}
module.exports = { qualification, verifyRecord };
