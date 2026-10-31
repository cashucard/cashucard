/* Closed synthetic workload and verifier for the offline Pixel lab. No Node APIs. */
const CAPACITY_PLAN = "pixel-capacity-control-v1";
const FIXTURE_SHA256 =
  "15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e";
class CapacityFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new CapacityFailure(code);
};
const hex = (data) =>
  Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (value) => {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/.test(value))
    fail("capacity-encoding");
  return value.match(/../g).map((x) => parseInt(x, 16));
};
const ascii = (value) => {
  const out = Array.from(value, (x) => x.charCodeAt(0));
  if (out.some((x) => x > 127)) fail("capacity-encoding");
  return out;
};
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const n32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const n64 = (n) => {
  let value = BigInt(n);
  const out = Array(8).fill(0);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(value & 255n);
    value >>= 8n;
  }
  if (value !== 0n) fail("capacity-identity");
  return out;
};
const cmd = (ins, data = []) => [
  0xb0,
  ins,
  0,
  0,
  data.length,
  ...data,
  ...(data.length ? [0] : []),
];
const EMPTY = Object.freeze([64, 90, 0, 0, 128, 0]);
const CONSUMED = Object.freeze([63, 45, 0, 128, 0, 0]);
function capacityProfile(raw, hash) {
  if (!raw || raw.length !== 58507 || hash(raw) !== FIXTURE_SHA256)
    fail("capacity-fixture-mismatch");
  if (Array.from(raw).some((x) => x > 127)) fail("capacity-encoding");
  const v = JSON.parse(Array.from(raw, (x) => String.fromCharCode(x)).join(""));
  const mint = ascii(v.context.mint),
    installation = bytes(v.context.installation);
  const outputs = v.outputs.flatMap((o) => [
    ...n32(o.amount),
    o.keysetRef,
    ...bytes(o.B_),
  ]);
  const outputPages = [],
    stagedCounts = [],
    pages = [];
  for (let i = 0; i < 128; i += 6) {
    outputPages.push(cmd(0x73, outputs.slice(i * 38, (i + 6) * 38)));
    stagedCounts.push(Math.min(i + 6, 128));
  }
  for (let at = 0; at < 23163; at += 255)
    pages.push(cmd(0x75, [0, at >> 8, at & 255, Math.min(255, 23163 - at)]));
  return {
    vector: v,
    packetBytes: 23163,
    outputPages,
    stagedCounts,
    pages,
    setup: cmd(0x7e, [
      ...n64(BigInt(v.identity.id) - 1n),
      ...installation,
      mint.length,
      ...mint,
    ]),
    keysets: v.keysets.map((k, i) => cmd(0x78, [i, k.length / 2, ...bytes(k)])),
    loads: v.proofs.map((p) =>
      cmd(0x71, [
        p.slot,
        ...n32(p.generation),
        p.keysetRef,
        ...n32(p.amount),
        ...bytes(p.nonce + p.C),
      ]),
    ),
    begin: cmd(0x72, [128, 128, ...v.proofs.map((p) => p.slot)]),
    scopePrefix: [0, ...n64(v.identity.id), ...n32(1)],
  };
}
function verifyCapacityPacket({
  profile,
  key,
  scope,
  packet,
  hash,
  verifySignature,
}) {
  const v = profile.vector;
  if (
    key.length !== 33 ||
    ![2, 3].includes(key[0]) ||
    scope.length !== 45 ||
    !equal(scope.slice(0, 13), profile.scopePrefix) ||
    packet.length !== 23163
  )
    fail("capacity-scope-mismatch");
  const payment = packet.slice(-128, -64),
    descriptor = packet.slice(-64);
  const mint = ascii(v.context.mint);
  const body = [
    ...ascii("CCP-AS\x01"),
    ...key,
    ...bytes(v.context.installation),
    ...n64(v.identity.id),
    0,
    ...n32(1),
    1,
    mint.length >> 8,
    mint.length & 255,
    ...mint,
    0,
    128,
    ...v.proofs.flatMap((p) => {
      const k = bytes(v.keysets[p.keysetRef]);
      return [
        p.slot,
        ...n32(p.generation),
        ...n32(p.amount),
        k.length,
        ...k,
        ...bytes(p.nonce + p.C),
      ];
    }),
    128,
    ...v.outputs.flatMap((o) => {
      const k = bytes(v.keysets[o.keysetRef]);
      return [...n32(o.amount), k.length, ...k, ...bytes(o.B_)];
    }),
    ...payment,
  ];
  if (!equal([...body, ...descriptor], packet))
    fail("capacity-packet-mismatch");
  const packetId = hash(body);
  if (packetId !== hex(scope.slice(13))) fail("capacity-scope-mismatch");
  const transcript =
    v.proofs
      .map(
        (p) =>
          JSON.stringify([
            "P2PK",
            { nonce: p.nonce, data: hex(key), tags: [["sigflag", "SIG_ALL"]] },
          ]) + p.C,
      )
      .join("") + v.outputs.map((o) => String(o.amount) + o.B_).join("");
  const paymentMessage = hash(ascii(transcript));
  const tag = bytes(hash(ascii("CashuCard/assisted-settlement/v1")));
  const descriptorMessage = hash([...tag, ...tag, ...body]);
  let valid = false;
  try {
    valid =
      verifySignature(payment, bytes(paymentMessage), key.slice(1)) === true &&
      verifySignature(descriptor, bytes(descriptorMessage), key.slice(1)) ===
        true;
  } catch {
    /* Preserve the packet when cryptographic verification refuses. */
  }
  if (!valid) fail("capacity-signature-mismatch");
  return {
    packetId,
    packetBytes: packet.length,
    paymentMessage,
    descriptorMessage,
  };
}
function diagnostics(data, ready) {
  const word = (at) => data[at] * 256 + data[at + 1];
  if (
    data.length !== 16 ||
    data[15] !== 5 ||
    data[14] !== ready ||
    word(10) !== 16384 ||
    word(12) !== 12288 ||
    [0, 2, 4, 6, 8].some((at) => word(at) > 32767) ||
    word(8) > word(6) ||
    Math.min(word(6), word(8)) < 128
  )
    fail("capacity-diagnostics-mismatch");
}
async function executeCapacity({
  profile,
  key,
  command,
  state,
  persist,
  hash,
  verifySignature,
}) {
  const commandData = async (name, frame, expected) => {
    const r = await command(name, frame);
    if (expected && !equal(r.data, expected))
      fail("capacity-response-mismatch");
    return r.data;
  };
  await commandData("setup-capacity", profile.setup, [1]);
  const after = await commandData("capacity-diagnostics", cmd(0x7d));
  state.capacityDiagnostics = hex(after.slice(0, 256));
  state.capacityDiagnosticBytes = after.length;
  await persist();
  diagnostics(after, 2);
  await commandData("capacity-empty", cmd(0x76), EMPTY);
  for (let i = 0; i < profile.keysets.length; i++)
    await commandData("capacity-keyset-" + i, profile.keysets[i], [i + 1]);
  for (let i = 0; i < profile.loads.length; i++)
    await commandData("capacity-proof-" + i, profile.loads[i], [
      profile.vector.proofs[i].slot,
    ]);
  await commandData("capacity-begin", profile.begin, [0]);
  for (let i = 0; i < profile.outputPages.length; i++)
    await commandData("capacity-outputs-" + i, profile.outputPages[i], [
      profile.stagedCounts[i],
    ]);
  const scope = await commandData("capacity-sign", cmd(0x74));
  state.scope = hex(scope.slice(0, 256));
  state.scopeBytes = scope.length;
  await persist();
  if (scope.length !== 45 || !equal(scope.slice(0, 13), profile.scopePrefix))
    fail("capacity-scope-mismatch");
  await commandData("capacity-consumed", cmd(0x76), CONSUMED);
  await commandData(
    "capacity-reselect",
    [0, 0xa4, 4, 0, 11, ...bytes("f04341534855434d505401"), 0],
    [67, 80, 82, 79, 84, 2],
  );
  await commandData("capacity-retained-scope", cmd(0x7c, [0]), scope);
  const packet = [];
  state.exportPages = [];
  for (let i = 0; i < profile.pages.length; i++) {
    const page = await commandData("capacity-export-" + i, profile.pages[i]);
    const expected = i === 90 ? 213 : 255;
    state.exportPages.push({
      offset: i * 255,
      data: hex(page.slice(0, 256)),
      receivedBytes: page.length,
      expectedBytes: expected,
    });
    await persist();
    if (page.length !== expected) fail("capacity-page-length");
    packet.push(...page);
  }
  state.verified = verifyCapacityPacket({
    profile,
    key,
    scope,
    packet,
    hash,
    verifySignature,
  });
  state.packet = hex(packet);
  await persist();
  await commandData("capacity-retire", cmd(0x77, scope), [1]);
  await commandData("capacity-retired", cmd(0x76), EMPTY);
  state.capacityVerified = true;
  await persist();
}
module.exports = {
  CAPACITY_PLAN,
  FIXTURE_SHA256,
  CapacityFailure,
  capacityProfile,
  verifyCapacityPacket,
  executeCapacity,
};
