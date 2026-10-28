/* Host-only, byte-bounded recovery model. No APDU, crypto signing or card I/O.
 * atomic() models a JCRE transaction as all-or-nothing; cuts occur after it.
 * Actual JavaCard transaction/tear behavior remains a separate silicon gate. */
const { createHash } = require("node:crypto");
const FREE = 0,
  STAGING = 1,
  COMMITTED = 2,
  CLEARING = 3,
  RELEASING = 4;
const EMPTY = 0,
  UNSPENT = 1,
  SPENT = 2;
const PAGE = 128,
  META = 48,
  PROOFS = 128,
  PROOF_STATE = 36,
  PROOF_GEN = 164,
  RECORDS = 676;
const digest = (data) => createHash("sha256").update(data).digest();
class Store {
  constructor({
    image,
    installation,
    bytes = 16384,
    records = 32,
    onWrite = null,
  } = {}) {
    if (!Number.isInteger(records) || records < 1 || records > 128)
      throw Error("configuration");
    this.image = image ?? Buffer.alloc(bytes);
    const owners = RECORDS + records * META;
    const pages = Math.floor((this.image.length - owners) / (PAGE + 2));
    if (pages < 1 || pages > 254) throw Error("configuration");
    this.layout = {
      totalBytes: this.image.length,
      records,
      pages,
      owners,
      next: owners + pages,
      data: owners + pages * 2,
      payloadBytes: pages * PAGE,
    };
    this.onWrite = onWrite;
    if (!image) {
      if (!Buffer.isBuffer(installation) || installation.length !== 32)
        throw Error("installation required");
      installation.copy(this.image, 4);
    }
  }
  record(index) {
    return RECORDS + index * META;
  }
  checkpoint(label) {
    if (this.onWrite) this.onWrite(label);
  }
  write(at, value) {
    this.image[at] = value;
    this.checkpoint("byte");
  }
  atomic(operation) {
    operation();
    this.checkpoint("transaction");
  }
  installation() {
    return this.image.subarray(4, 36).toString("hex");
  }
  freePages() {
    let n = 0;
    for (let i = 0; i < this.layout.pages; i++)
      if (!this.image[this.layout.owners + i]) n++;
    return n;
  }
  release(index) {
    for (let i = 0; i < this.layout.pages; i++) {
      if (this.image[this.layout.owners + i] === index + 1)
        this.write(this.layout.owners + i, 0);
    }
    this.write(this.record(index), FREE); // Keep the generation for ABA refusal.
  }
  #read(index) {
    const at = this.record(index),
      size = this.image.readUInt16BE(at + 9),
      count = this.image[at + 12];
    if (!size || count !== Math.ceil(size / PAGE)) throw Error("integrity");
    let page = this.image[at + 11],
      offset = 0;
    const seen = new Set(),
      frame = Buffer.alloc(size);
    for (let i = 0; i < count; i++) {
      if (
        page >= this.layout.pages ||
        seen.has(page) ||
        this.image[this.layout.owners + page] !== index + 1
      )
        throw Error("integrity");
      seen.add(page);
      const length = Math.min(PAGE, size - offset);
      this.image.copy(
        frame,
        offset,
        this.layout.data + page * PAGE,
        this.layout.data + page * PAGE + length,
      );
      offset += length;
      page = this.image[this.layout.next + page];
    }
    if (
      page !== 255 ||
      !digest(frame).equals(this.image.subarray(at + 13, at + 45))
    )
      throw Error("integrity");
    const n = frame[0],
      prefix = 1 + n * 5,
      inputs = [],
      slots = new Set();
    if (!n || n > PROOFS || prefix >= frame.length) throw Error("integrity");
    for (let i = 0; i < n; i++) {
      const slot = frame[1 + i * 5],
        generation = frame.readUInt32BE(2 + i * 5);
      if (slot >= PROOFS || slots.has(slot) || !generation)
        throw Error("integrity");
      slots.add(slot);
      inputs.push({ slot, generation });
    }
    return { inputs, packet: frame.subarray(prefix) };
  }
  recover() {
    if (this.building) throw Error("reentrant builder");
    for (let i = 0; i < this.layout.records; i++) {
      const at = this.record(i),
        state = this.image[at];
      if (state === FREE) continue;
      if (state === STAGING || state === RELEASING) {
        this.release(i);
        continue;
      }
      if (state !== COMMITTED && state !== CLEARING) throw Error("integrity");
      const { inputs } = this.#read(i);
      // Check every reference before any destructive cleanup.
      for (const { slot, generation } of inputs) {
        const status = this.image[PROOF_STATE + slot];
        if (
          this.image.readUInt32BE(PROOF_GEN + slot * 4) !== generation ||
          (state === COMMITTED
            ? ![UNSPENT, SPENT].includes(status)
            : ![EMPTY, SPENT].includes(status))
        )
          throw Error("integrity");
      }
      for (const { slot } of inputs) {
        const target = state === COMMITTED ? SPENT : EMPTY;
        if (this.image[PROOF_STATE + slot] !== target)
          this.write(PROOF_STATE + slot, target);
      }
      if (state === CLEARING) {
        // Proof cleanup is complete before releasing any payload page. A cut in
        // page reclamation can resume without consulting partially freed data.
        this.write(at, RELEASING);
        this.release(i);
      }
    }
  }
  load(slot) {
    this.recover();
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= PROOFS ||
      this.image[PROOF_STATE + slot] !== EMPTY
    )
      throw Error("slot unavailable");
    const generation = this.image.readUInt32BE(PROOF_GEN + slot * 4);
    if (generation === 0xffffffff) throw Error("generation exhausted");
    this.atomic(() => {
      this.image.writeUInt32BE(generation + 1, PROOF_GEN + slot * 4);
      this.image[PROOF_STATE + slot] = UNSPENT;
    });
  }
  publish(slots, packet, { packetBytes } = {}) {
    this.recover();
    if (
      !Array.isArray(slots) ||
      !slots.length ||
      slots.length > PROOFS ||
      new Set(slots).size !== slots.length ||
      slots.some(
        (s) =>
          !Number.isInteger(s) ||
          s < 0 ||
          s >= PROOFS ||
          this.image[PROOF_STATE + s] !== UNSPENT,
      )
    )
      throw Error("inputs");
    slots = slots.slice();
    const builder = typeof packet === "function";
    const length = builder
      ? packetBytes
      : Buffer.isBuffer(packet)
        ? packet.length
        : 0;
    if (
      !Number.isInteger(length) ||
      length < 1 ||
      length + 1 + slots.length * 5 > 65535
    )
      throw Error("packet");
    let index = -1;
    for (let i = 0; i < this.layout.records; i++)
      if (
        this.image[this.record(i)] === FREE &&
        this.image.readUInt32BE(this.record(i) + 5) < 0xffffffff
      ) {
        index = i;
        break;
      }
    if (index < 0) throw Error("record capacity");
    const frameLength = 1 + slots.length * 5 + length;
    const needed = Math.ceil(frameLength / PAGE),
      pages = [];
    for (let p = 0; p < this.layout.pages && pages.length < needed; p++)
      if (!this.image[this.layout.owners + p]) pages.push(p);
    if (pages.length !== needed) throw Error("byte capacity");
    const id = this.image.readUInt32BE(0);
    if (id === 0xffffffff) throw Error("payment counter exhausted");
    const at = this.record(index),
      generation = this.image.readUInt32BE(at + 5) + 1;
    const inputs = slots.map((slot) =>
      Object.freeze({
        slot,
        generation: this.image.readUInt32BE(PROOF_GEN + slot * 4),
      }),
    );
    if (builder) {
      this.building = true;
      try {
        packet = packet(
          Object.freeze({
            installation: this.installation(),
            id: id + 1,
            index,
            generation,
            inputs: Object.freeze(inputs),
          }),
        );
      } finally {
        this.building = false;
      }
      if (!Buffer.isBuffer(packet) || packet.length !== length)
        throw Error("packet builder length");
    }
    const frame = Buffer.alloc(frameLength);
    frame[0] = inputs.length;
    inputs.forEach((ref, i) => {
      frame[1 + i * 5] = ref.slot;
      frame.writeUInt32BE(ref.generation, 2 + i * 5);
    });
    packet.copy(frame, 1 + inputs.length * 5);
    this.atomic(() => {
      this.image.writeUInt32BE(id + 1, 0);
      this.image[at] = STAGING;
      this.image.writeUInt32BE(id + 1, at + 1);
      this.image.writeUInt32BE(generation, at + 5);
    }); // Only counters and the hidden-staging identity need this boundary.
    this.write(at + 9, frame.length >> 8);
    this.write(at + 10, frame.length & 255);
    this.write(at + 11, pages[0]);
    this.write(at + 12, needed);
    const checksum = digest(frame);
    for (let i = 0; i < checksum.length; i++)
      this.write(at + 13 + i, checksum[i]);
    for (let i = 0; i < pages.length; i++) {
      this.write(this.layout.owners + pages[i], index + 1);
      this.write(
        this.layout.next + pages[i],
        i + 1 < pages.length ? pages[i + 1] : 255,
      );
    }
    for (let i = 0; i < frame.length; i++)
      this.write(
        this.layout.data + pages[Math.floor(i / PAGE)] * PAGE + (i % PAGE),
        frame[i],
      );
    this.#read(index); // Validate the exact complete bytes before visibility.
    this.write(at, COMMITTED); // Single visibility/burn-intent boundary.
    this.recover();
    return this.#ack(index);
  }
  #ack(index) {
    const at = this.record(index);
    return {
      installation: this.installation(),
      index,
      id: this.image.readUInt32BE(at + 1),
      generation: this.image.readUInt32BE(at + 5),
      digest: this.image.subarray(at + 13, at + 45).toString("hex"),
    };
  }
  export() {
    this.recover();
    const result = [];
    for (let i = 0; i < this.layout.records; i++)
      if (this.image[this.record(i)] === COMMITTED)
        result.push({ ...this.#ack(i), ...this.#read(i) });
    return result;
  }
  retire(ack) {
    this.recover();
    if (
      !ack ||
      !Number.isInteger(ack.index) ||
      ack.index < 0 ||
      ack.index >= this.layout.records ||
      this.image[this.record(ack.index)] !== COMMITTED
    )
      throw Error("stale acknowledgement");
    const expected = this.#ack(ack.index);
    if (
      ["installation", "index", "id", "generation", "digest"].some(
        (k) => ack[k] !== expected[k],
      )
    )
      throw Error("stale acknowledgement");
    this.write(this.record(ack.index), CLEARING);
    this.recover();
  }
  unspent() {
    this.recover();
    return this.image
      .subarray(PROOF_STATE, PROOF_STATE + PROOFS)
      .filter((s) => s === UNSPENT).length;
  }
  freeSlots() {
    this.recover();
    return this.image
      .subarray(PROOF_STATE, PROOF_STATE + PROOFS)
      .filter((s) => s === EMPTY).length;
  }
}
module.exports = { Store };
