/* Fixed public synthetic bench workload; no network, key or PIN input. */
const vector = require("./fixtures/assisted-settlement-v1.json");
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
const outputBytes = () =>
  Buffer.concat(
    vector.outputs.map((o) =>
      Buffer.concat([
        n32(o.amount),
        Buffer.from([o.keysetRef]),
        Buffer.from(o.B_, "hex"),
      ]),
    ),
  );
function workload() {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(vector.identity.id) - 1n);
  return {
    setup: cmd(
      0x70,
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
    begin: cmd(0x72, Buffer.from([2, 2, ...vector.proofs.map((p) => p.slot)])),
    outputs: cmd(0x73, outputBytes()),
    pages: [
      cmd(0x75, Buffer.from([0, 0, 0, 255])),
      cmd(0x75, Buffer.from([0, 0, 255, 255])),
      cmd(0x75, Buffer.from([0, 1, 254, 49])),
    ],
  };
}
function verifyPacket(key, scope, packet) {
  if (
    key.length !== 33 ||
    scope.length !== 45 ||
    packet.length !== 559 ||
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
      Buffer.from([1, 2]),
      outputBytes(),
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
module.exports = { PACKAGE, cmd, workload, verifyPacket };
