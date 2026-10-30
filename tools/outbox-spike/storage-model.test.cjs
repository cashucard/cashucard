const test = require("node:test");
const assert = require("node:assert/strict");
const { Store } = require("./storage-model.cjs");
const installation = Buffer.alloc(32, 0x31);
const packet = Buffer.alloc(320, 0xa5); // Synthetic opaque packet, not protocol bytes.
const fresh = (options = {}) => new Store({ installation, ...options });
const reopen = (s, options = {}) =>
  new Store({ image: Buffer.from(s.image), ...options });
function publicationFixture() {
  const s = fresh();
  s.load(0);
  s.load(1);
  return s;
}
function cuts(s, operation, check) {
  let writes = 0;
  const reference = reopen(s, { onWrite: () => writes++ });
  operation(reference);
  assert.ok(writes > 0);
  for (let cut = 1; cut <= writes; cut++) {
    let at = 0;
    const torn = reopen(s, {
      onWrite: () => {
        if (++at === cut) throw Error("cut");
      },
    });
    assert.throws(() => operation(torn), /cut/);
    const resumed = reopen(torn);
    resumed.recover();
    check(resumed, cut);
  }
}
test("every publication cut leaves either unspent inputs or one complete exportable packet", () => {
  cuts(
    publicationFixture(),
    (s) => s.publish([0, 1], packet),
    (s) => {
      const exported = s.export();
      if (!exported.length) assert.equal(s.unspent(), 2);
      else {
        assert.equal(exported.length, 1);
        assert.equal(s.unspent(), 0);
        assert.deepEqual(exported[0].packet, packet);
        assert.deepEqual(
          exported[0].inputs.map((i) => i.slot),
          [0, 1],
        );
      }
    },
  );
});
test("every retirement cut resumes without clearing an unrelated proof or losing capacity", () => {
  const s = publicationFixture();
  s.load(2);
  const ack = s.publish([0, 1], packet);
  cuts(
    s,
    (r) => r.retire(ack),
    (r) => {
      assert.equal(r.export().length, 0);
      assert.equal(r.unspent(), 1);
      assert.equal(r.freeSlots(), 127);
      r.load(0);
      r.load(1);
      assert.equal(r.unspent(), 3);
    },
  );
});
test("repeated cuts during abandoned staging recovery eventually free every claimed page", () => {
  const s = publicationFixture();
  let writes = 0;
  s.onWrite = () => {
    if (++writes === 20) throw Error("cut");
  };
  assert.throws(() => s.publish([0], packet), /cut/);
  let r = reopen(s);
  for (let n = 0; n < 20; n++) {
    r.onWrite = () => {
      throw Error("cut");
    };
    try {
      r.recover();
      break;
    } catch (e) {
      assert.match(e.message, /cut/);
    }
    r = reopen(r);
  }
  r.onWrite = null;
  r.recover();
  assert.equal(r.freePages(), r.layout.pages);
  assert.equal(r.unspent(), 2);
  assert.equal(r.export().length, 0);
});
test("outbox record capacity refuses before consumption and retirement permits bounded reuse", () => {
  const s = fresh();
  for (let i = 0; i < 33; i++) s.load(i);
  const acks = [];
  for (let i = 0; i < 32; i++) acks.push(s.publish([i], packet));
  const before = Buffer.from(s.image);
  assert.throws(() => s.publish([32], packet), /record capacity/);
  assert.deepEqual(s.image, before);
  assert.equal(s.unspent(), 1);
  s.retire(acks[17]);
  const next = s.publish([32], packet);
  assert.equal(next.index, acks[17].index);
  assert.ok(next.generation > acks[17].generation);
  assert.throws(() => s.retire(acks[17]), /stale acknowledgement/);
  assert.equal(s.export().length, 32);
});
test("byte capacity is independent of record count, including the 128-input workload", () => {
  const s = fresh();
  for (let i = 0; i < 128; i++) s.load(i);
  assert.ok(s.layout.totalBytes === 16384 && s.layout.payloadBytes < 16384);
  const before = Buffer.from(s.image);
  assert.throws(
    () =>
      s.publish(
        Array.from({ length: 128 }, (_, i) => i),
        Buffer.alloc(14000),
      ),
    /byte capacity/,
  );
  assert.deepEqual(s.image, before);
  assert.equal(s.unspent(), 128);
  const ack = s.publish(
    Array.from({ length: 128 }, (_, i) => i),
    Buffer.alloc(13000, 7),
  );
  assert.equal(s.export()[0].packet.length, 13000);
  assert.equal(s.unspent(), 0);
  s.retire(ack);
  assert.equal(s.freeSlots(), 128);
  assert.equal(s.freePages(), s.layout.pages);
});
test("wrong installation, digest, payment or generation acknowledgements cannot retire records", () => {
  const s = publicationFixture(),
    ack = s.publish([0], packet);
  for (const bad of [
    { installation: "00".repeat(32) },
    { digest: "00".repeat(32) },
    { id: ack.id + 1 },
    { generation: ack.generation + 1 },
    { index: -1 },
  ]) {
    const before = Buffer.from(s.image);
    assert.throws(() => s.retire({ ...ack, ...bad }), /stale acknowledgement/);
    assert.deepEqual(s.image, before);
  }
  const other = fresh({ installation: Buffer.alloc(32, 8) });
  other.load(0);
  other.publish([0], packet);
  assert.throws(() => other.retire(ack), /stale acknowledgement/);
  s.retire(ack);
  s.load(0);
  assert.throws(() => s.retire(ack), /stale acknowledgement/);
  assert.equal(s.unspent(), 2);
});
test("duplicate/unavailable inputs and corrupt committed bytes fail closed", () => {
  const s = publicationFixture();
  assert.throws(() => s.publish([0, 0], packet), /inputs/);
  assert.throws(() => s.publish([127], packet), /inputs/);
  const ack = s.publish([0], packet);
  assert.throws(() => s.publish([0], packet), /inputs/);
  s.image[s.layout.data + s.image[s.record(ack.index) + 11] * 128 + 10] ^= 1;
  assert.throws(() => s.export(), /integrity/);
  assert.throws(() => s.load(2), /integrity/);
});
test("cuts repeated inside clearing recovery preserve unrelated and newly loaded slots", () => {
  const s = publicationFixture();
  s.load(2);
  const ack = s.publish([0, 1], packet);
  s.onWrite = () => {
    throw Error("cut");
  };
  assert.throws(() => s.retire(ack), /cut/);
  let r = reopen(s);
  for (let n = 0; n < 20; n++) {
    r.onWrite = () => {
      throw Error("cut");
    };
    try {
      r.recover();
      break;
    } catch (e) {
      assert.match(e.message, /cut/);
    }
    r = reopen(r);
  }
  r.onWrite = null;
  r.recover();
  r.load(0);
  assert.equal(r.freeSlots(), 126);
  assert.equal(r.unspent(), 2);
  assert.equal(r.export().length, 0);
  assert.equal(r.freePages(), r.layout.pages);
});
test("counter exhaustion and changed slot generation refuse without consuming or clearing", () => {
  const s = publicationFixture();
  s.image.writeUInt32BE(0xffffffff, 0);
  const before = Buffer.from(s.image);
  assert.throws(() => s.publish([0], packet), /counter exhausted/);
  assert.deepEqual(s.image, before);
  const r = publicationFixture(),
    ack = r.publish([0], packet);
  // Model fault injection into a pinned slot generation, not a public command.
  r.image.writeUInt32BE(2, 164);
  const changed = Buffer.from(r.image);
  assert.throws(() => r.retire(ack), /integrity/);
  assert.deepEqual(r.image, changed);
  const empty = fresh();
  empty.image.writeUInt32BE(0xffffffff, 164);
  assert.throws(() => empty.load(0), /generation exhausted/);
  assert.equal(empty.freeSlots(), 128);
});
test("full draft packets expose a byte-budget problem before any proof is consumed", () => {
  // Candidate draft arithmetic only: 24 URL bytes, 33-byte full keyset IDs,
  // 89 fixed body bytes plus counts/inputs/outputs and two 64-byte signatures.
  const candidateBytes = (inputs) => 89 + 24 + 1 + inputs * 108 + 1 + 71 + 128;
  assert.equal(candidateBytes(1), 422);
  assert.equal(candidateBytes(128), 14138);
  const s = fresh();
  for (let i = 0; i < 32; i++) s.load(i);
  for (let i = 0; i < 27; i++)
    s.publish([i], Buffer.alloc(candidateBytes(1), i));
  assert.equal(s.export().length, 27);
  assert.equal(s.freePages(), 1);
  const before = Buffer.from(s.image);
  assert.throws(
    () => s.publish([27], Buffer.alloc(candidateBytes(1))),
    /byte capacity/,
  );
  assert.deepEqual(s.image, before);
  assert.equal(s.unspent(), 5);
  const large = fresh();
  for (let i = 0; i < 128; i++) large.load(i);
  assert.throws(
    () =>
      large.publish(
        Array.from({ length: 128 }, (_, i) => i),
        Buffer.alloc(candidateBytes(128)),
      ),
    /byte capacity/,
  );
  assert.equal(large.unspent(), 128);
  assert.equal(large.export().length, 0);
});
test("assumed atomic mutations stay within thirteen changed bytes; staging metadata may tear", () => {
  const s = publicationFixture();
  let before = Buffer.from(s.image),
    transactions = 0;
  s.onWrite = (label) => {
    if (label === "transaction") {
      const changed = s.image.reduce((n, b, i) => n + (b !== before[i]), 0);
      assert.ok(changed <= 13, "large atomic mutation: " + changed);
      transactions++;
    }
    before = Buffer.from(s.image);
  };
  const ack = s.publish([0, 1], packet);
  s.retire(ack);
  s.load(0);
  assert.ok(transactions > 0);
});
