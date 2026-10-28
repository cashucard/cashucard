/* Host-only codec experiment for the open assisted-settlement proposal.
 * This module neither assigns production APDUs nor implements a card/owner
 * authorization boundary. fixtureView represents preverified, pinned load state. */
const { createHash } = require("node:crypto");
const cc = require("../cardsim/cashu-crypto.cjs");
const TAG = cc.sha256(Buffer.from("CashuCard/assisted-settlement/v1"));
const REGISTRY = 8,
  EXTRA = 33 + 32 + 2 + 255 + 1 + 1 + REGISTRY * 34 + 128;
const uint = (n, max, label) => {
  if (!Number.isInteger(n) || n < 0 || n > max) throw Error(label);
  return n;
};
const bytes = (v, n, label) => {
  const b =
    typeof v === "string" && /^(?:[0-9a-fA-F]{2})*$/.test(v)
      ? Buffer.from(v, "hex")
      : Buffer.isBuffer(v)
        ? Buffer.from(v)
        : null;
  if (!b || b.length !== n) throw Error(label);
  return b;
};
const point = (v, label) => {
  const b = bytes(v, 33, label);
  if (![2, 3].includes(b[0]) || !cc.point(b)) throw Error(label);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const copyProof = (p) => ({
  ...p,
  nonce: Buffer.from(p.nonce),
  C: Buffer.from(p.C),
});
function fixtureView(context, keysets, proofs) {
  if (
    !context ||
    context.unit !== 0 ||
    context.refund != null ||
    (context.profile !== undefined && context.profile !== 1)
  )
    throw Error("profile");
  const mint = Buffer.from(context.mint ?? "", "utf8");
  let url;
  try {
    url = new URL(context.mint);
  } catch {
    throw Error("mint");
  }
  if (
    !mint.length ||
    mint.length > 255 ||
    context.mint.trim() !== context.mint ||
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#\\]/.test(context.mint) ||
    /[\x00-\x20\x7f]/.test(context.mint)
  )
    throw Error("mint");
  const config = {
    cardKey: point(context.cardKey, "card key"),
    installation: bytes(context.installation, 32, "installation"),
    mint,
  };
  if (!Array.isArray(keysets) || !keysets.length || keysets.length > REGISTRY)
    throw Error("keysets");
  const registry = keysets.map((k) => {
    if (typeof k !== "string" || ![16, 66].includes(k.length))
      throw Error("keyset");
    return bytes(k, k.length / 2, "keyset");
  });
  if (
    new Set(registry.map((k) => k.subarray(0, 8).toString("hex"))).size !==
    registry.length
  )
    throw Error("ambiguous keysets");
  const slots = new Map(),
    nonces = new Set();
  if (!Array.isArray(proofs) || proofs.length > 128) throw Error("proofs");
  for (const p of proofs) {
    const slot = uint(p.slot, 127, "slot"),
      generation = uint(p.generation, 0xffffffff, "generation"),
      amount = uint(p.amount, 0xffffffff, "amount"),
      ref = uint(p.keysetRef, registry.length - 1, "keyset reference");
    if (
      !generation ||
      !amount ||
      p.date !== 0 ||
      p.refund != null ||
      p.secret !== undefined ||
      (p.format !== undefined && p.format !== 4) ||
      slots.has(slot)
    )
      throw Error("proof profile");
    const nonce = bytes(p.nonce, 32, "nonce"),
      C = point(p.C, "C");
    if (
      nonces.has(nonce.toString("hex")) ||
      !bytes(p.keysetPrefix, 8, "proof prefix").equals(
        registry[ref].subarray(0, 8),
      )
    )
      throw Error("proof mapping");
    nonces.add(nonce.toString("hex"));
    slots.set(slot, { slot, generation, amount, keysetRef: ref, nonce, C });
  }
  return Object.freeze({
    config: () => ({
      ...config,
      cardKey: Buffer.from(config.cardKey),
      installation: Buffer.from(config.installation),
      mint: Buffer.from(config.mint),
    }),
    keyset: (ref) => {
      uint(ref, registry.length - 1, "keyset reference");
      return Buffer.from(registry[ref]);
    },
    proof: (slot) => {
      const p = slots.get(slot);
      if (!p) throw Error("inputs");
      return copyProof(p);
    },
  });
}
function identityOf(record, config) {
  if (!record || record.installation !== config.installation.toString("hex"))
    throw Error("identity");
  let id = record.id;
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id)) throw Error("identity");
    id = BigInt(id);
  }
  if (typeof id !== "bigint" || id < 1n || id > 0xffffffffffffffffn)
    throw Error("identity");
  const index = uint(record.index, 255, "identity"),
    generation = uint(record.generation, 0xffffffff, "identity");
  if (!generation) throw Error("identity");
  return { id, index, generation };
}
function resolve(record, outputs, view) {
  const config = view.config(),
    identity = identityOf(record, config);
  if (
    !Array.isArray(record.inputs) ||
    !record.inputs.length ||
    record.inputs.length > 128 ||
    new Set(record.inputs.map((i) => i.slot)).size !== record.inputs.length
  )
    throw Error("inputs");
  const inputs = record.inputs.map((ref) => {
    uint(ref.slot, 127, "inputs");
    const p = view.proof(ref.slot);
    if (p.generation !== ref.generation) throw Error("generation");
    return { ...p, keyset: view.keyset(p.keysetRef) };
  });
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > 255)
    throw Error("outputs");
  const resolved = outputs.map((o) => ({
    amount: uint(o.amount, 0xffffffff, "amount"),
    keysetRef: o.keysetRef,
    keyset: view.keyset(o.keysetRef),
    B_: point(o.B_, "B_"),
  }));
  if (
    resolved.some((o) => !o.amount) ||
    new Set(resolved.map((o) => o.B_.toString("hex"))).size !== resolved.length
  )
    throw Error("outputs");
  const total = (list) => {
    const n = list.reduce((n, p) => n + BigInt(p.amount), 0n);
    if (n > 0xffffffffn) throw Error("amount overflow");
    return n;
  };
  if (total(resolved) > total(inputs)) throw Error("amount total");
  return { config, identity, inputs, outputs: resolved };
}
function* bodyParts(s, payment) {
  yield Buffer.from("CCP-AS\x01", "binary");
  yield s.config.cardKey;
  yield s.config.installation;
  const identity = Buffer.alloc(13);
  identity.writeBigUInt64BE(s.identity.id);
  identity[8] = s.identity.index;
  identity.writeUInt32BE(s.identity.generation, 9);
  yield identity;
  const mintHeader = Buffer.alloc(3);
  mintHeader[0] = 1;
  mintHeader.writeUInt16BE(s.config.mint.length, 1);
  yield mintHeader;
  yield s.config.mint;
  yield Buffer.from([0, s.inputs.length]);
  for (const p of s.inputs) {
    yield Buffer.from([p.slot]);
    yield u32(p.generation);
    yield u32(p.amount);
    yield Buffer.from([p.keyset.length]);
    yield p.keyset;
    yield p.nonce;
    yield p.C;
  }
  yield Buffer.from([s.outputs.length]);
  for (const o of s.outputs) {
    yield u32(o.amount);
    yield Buffer.from([o.keyset.length]);
    yield o.keyset;
    yield o.B_;
  }
  yield payment;
}
function paymentMessage(s) {
  const hash = createHash("sha256");
  for (const p of s.inputs) {
    hash.update(
      cc.cardSecret(p.nonce.toString("hex"), s.config.cardKey.toString("hex")),
      "utf8",
    );
    hash.update(p.C.toString("hex"), "utf8");
  }
  for (const o of s.outputs) {
    hash.update(String(o.amount), "utf8");
    hash.update(o.B_.toString("hex"), "utf8");
  }
  return hash.digest();
}
function messages(s, payment) {
  const plain = createHash("sha256"),
    tagged = createHash("sha256").update(TAG).update(TAG);
  let bodyLength = 0;
  for (const part of bodyParts(s, payment)) {
    plain.update(part);
    tagged.update(part);
    bodyLength += part.length;
  }
  return {
    packetId: plain.digest(),
    descriptor: tagged.digest(),
    bodyLength,
    payment: paymentMessage(s),
  };
}
const compactBytes = (count) => {
  uint(count, 255, "outputs");
  if (!count) throw Error("outputs");
  return 130 + 38 * count;
};
function pack(outputs, payment, descriptor) {
  const data = Buffer.alloc(compactBytes(outputs.length));
  data[0] = 1;
  data[1] = outputs.length;
  let at = 2;
  for (const o of outputs) {
    data.writeUInt32BE(o.amount, at);
    data[at + 4] = o.keysetRef;
    o.B_.copy(data, at + 5);
    at += 38;
  }
  payment.copy(data, at);
  descriptor.copy(data, at + 64);
  return data;
}
function unpack(data) {
  if (
    !Buffer.isBuffer(data) ||
    data.length < 168 ||
    data[0] !== 1 ||
    !data[1] ||
    data.length !== compactBytes(data[1])
  )
    throw Error("compact");
  const outputs = [];
  let at = 2;
  for (let i = 0; i < data[1]; i++, at += 38)
    outputs.push({
      amount: data.readUInt32BE(at),
      keysetRef: data[at + 4],
      B_: Buffer.from(data.subarray(at + 5, at + 38)),
    });
  return {
    outputs,
    payment: Buffer.from(data.subarray(at, at + 64)),
    descriptor: Buffer.from(data.subarray(at + 64)),
  };
}
function verified(s, payment, descriptor) {
  const m = messages(s, payment);
  if (
    !cc.schnorrVerify(s.config.cardKey, m.payment, payment) ||
    !cc.schnorrVerify(s.config.cardKey, m.descriptor, descriptor)
  )
    throw Error("signature");
  return m;
}
function signCompact(plan, outputs, view, signer) {
  const s = resolve(plan, outputs, view);
  // The store preflights space and fixes identity before invoking this callback.
  const paymentHash = paymentMessage(s);
  const payment = bytes(signer(paymentHash, "payment"), 64, "signature");
  if (!cc.schnorrVerify(s.config.cardKey, paymentHash, payment))
    throw Error("signature");
  const descriptor = bytes(
    signer(messages(s, payment).descriptor, "descriptor"),
    64,
    "signature",
  );
  verified(s, payment, descriptor);
  return pack(s.outputs, payment, descriptor);
}
function* packetParts(s, payment, descriptor) {
  yield* bodyParts(s, payment);
  yield descriptor;
}
function exportCompact(record, view, { pageBytes = 255 } = {}) {
  uint(pageBytes, 255, "page");
  if (!pageBytes) throw Error("page");
  const { outputs, payment, descriptor } = unpack(record.packet),
    s = resolve(record, outputs, view),
    m = verified(s, payment, descriptor);
  return Object.freeze({
    packetId: m.packetId.toString("hex"),
    paymentMessage: m.payment.toString("hex"),
    descriptorMessage: m.descriptor.toString("hex"),
    byteLength: m.bodyLength + 64,
    *pages() {
      let page = Buffer.alloc(pageBytes),
        used = 0;
      for (const part of packetParts(s, payment, descriptor)) {
        for (let at = 0; at < part.length;) {
          const n = Math.min(pageBytes - used, part.length - at);
          part.copy(page, used, at, at + n);
          used += n;
          at += n;
          if (used === pageBytes) {
            yield page;
            page = Buffer.alloc(pageBytes);
            used = 0;
          }
        }
      }
      if (used) yield page.subarray(0, used);
    },
  });
}
function budget(records = 64, totalBytes = 16384) {
  uint(records, 128, "records");
  if (!records) throw Error("records");
  uint(totalBytes, 32767, "bytes");
  // Reserve immutable context, full-ID registry, slot mappings and the extra
  // bytes needed by future uint64 global/record IDs. Store's counters remain
  // uint32 in this host model and deliberately refuse before wrapping.
  const reservedBytes = EXTRA + 4 + records * 4,
    storeBytes = totalBytes - reservedBytes;
  if (storeBytes < 676 + records * 48 + 130) throw Error("bytes");
  return { totalBytes, reservedBytes, storeBytes };
}
module.exports = {
  fixtureView,
  exportCompact,
  signCompact,
  compactBytes,
  budget,
};
