/* Fixed public synthetic bench workload; no network, key or PIN input. */
const SMALL = "two-input-two-output-v1";
const MAX = "128-input-128-output-v1";
const VECTORS = Object.freeze({
  [SMALL]: require("./fixtures/assisted-settlement-v1.json"),
  [MAX]: require("./fixtures/compact-capacity-v1.json"),
});
function vectorFor(name) {
  if (typeof name !== "string" || !Object.hasOwn(VECTORS, name))
    throw Error("unknown fixed workload");
  return structuredClone(VECTORS[name]);
}
function packetLength(v) {
  return (
    7 +
    33 +
    32 +
    13 +
    3 +
    Buffer.byteLength(v.context.mint) +
    2 +
    v.proofs.reduce((n, p) => n + 75 + v.keysets[p.keysetRef].length / 2, 0) +
    1 +
    v.outputs.reduce((n, o) => n + 38 + v.keysets[o.keysetRef].length / 2, 0) +
    128
  );
}
const { fixtureView, exportCompact } = require("./compact-export.cjs");
const PACKAGE = "F04341534855434D5054";
const cmd = (ins, data = Buffer.alloc(0)) => [
  ...Buffer.concat([
    Buffer.from([0xb0, ins, 0, 0]),
    data.length
      ? Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0])])
      : Buffer.from([0]),
  ]),
];
const n32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const outputBytes = (vector) =>
  Buffer.concat(
    vector.outputs.map((o) =>
      Buffer.concat([
        n32(o.amount),
        Buffer.from([o.keysetRef]),
        Buffer.from(o.B_, "hex"),
      ]),
    ),
  );
function workload(name = SMALL) {
  const vector = vectorFor(name),
    packetBytes = packetLength(vector);
  const outputPages = [],
    stagedCounts = [],
    pages = [];
  const bytes = outputBytes(vector);
  for (let at = 0; at < vector.outputs.length; at += 6) {
    outputPages.push(cmd(0x73, bytes.subarray(at * 38, (at + 6) * 38)));
    stagedCounts.push(Math.min(at + 6, vector.outputs.length));
  }
  for (let at = 0; at < packetBytes; at += 255)
    pages.push(
      cmd(
        0x75,
        Buffer.from([0, at >> 8, at & 255, Math.min(255, packetBytes - at)]),
      ),
    );
  const frameBytes =
    131 + vector.proofs.length * 5 + vector.outputs.length * 38;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(vector.identity.id) - 1n);
  return {
    name,
    vector,
    packetBytes,
    outputPages,
    stagedCounts,
    consumedStatus: [
      63,
      90 - Math.ceil(frameBytes / 128),
      0,
      vector.proofs.length,
      128 - vector.proofs.length,
      0,
    ],
    setup: cmd(
      0x7e,
      Buffer.concat([
        counter,
        Buffer.from(vector.context.installation, "hex"),
        Buffer.from([Buffer.byteLength(vector.context.mint)]),
        Buffer.from(vector.context.mint),
      ]),
    ),
    keysets: vector.keysets.map((id, i) =>
      cmd(
        0x78,
        Buffer.concat([
          Buffer.from([i, id.length / 2]),
          Buffer.from(id, "hex"),
        ]),
      ),
    ),
    loads: vector.proofs.map((p) =>
      cmd(
        0x71,
        Buffer.concat([
          Buffer.from([p.slot]),
          n32(p.generation),
          Buffer.from([p.keysetRef]),
          n32(p.amount),
          Buffer.from(p.nonce + p.C, "hex"),
        ]),
      ),
    ),
    begin: cmd(
      0x72,
      Buffer.from([
        vector.proofs.length,
        vector.outputs.length,
        ...vector.proofs.map((p) => p.slot),
      ]),
    ),
    outputs: outputPages[0],
    pages,
  };
}
function verifyPacket(key, scope, packet, name = SMALL) {
  const vector = vectorFor(name);
  if (
    key.length !== 33 ||
    scope.length !== 45 ||
    packet.length !== packetLength(vector) ||
    scope[0] !== 0 ||
    scope.readBigUInt64BE(1) !== BigInt(vector.identity.id) ||
    scope.readUInt32BE(9) !== 1
  )
    throw Error("fixture scope mismatch");
  const record = {
    installation: vector.context.installation,
    index: 0,
    id: scope.readBigUInt64BE(1),
    generation: 1,
    inputs: vector.proofs.map((p) => ({
      slot: p.slot,
      generation: p.generation,
    })),
    packet: Buffer.concat([
      Buffer.from([1, vector.outputs.length]),
      outputBytes(vector),
      packet.subarray(-128),
    ]),
  };
  const e = exportCompact(
    record,
    fixtureView(
      { ...vector.context, cardKey: key },
      vector.keysets,
      vector.proofs,
    ),
  );
  if (
    e.packetId !== scope.subarray(13).toString("hex") ||
    !Buffer.concat([...e.pages()]).equals(packet)
  )
    throw Error("fixture packet mismatch");
  return {
    packetId: e.packetId,
    packetBytes: e.byteLength,
    paymentMessage: e.paymentMessage,
    descriptorMessage: e.descriptorMessage,
  };
}
module.exports = { PACKAGE, cmd, workload, verifyPacket, SMALL, MAX };
