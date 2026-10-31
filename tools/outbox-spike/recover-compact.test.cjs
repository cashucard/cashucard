const test = require("node:test"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { recoverToBlank, verifyIndependent } = require("./recover-compact.cjs");
const {
  fixture,
  sdk,
  b,
  sha,
  kitRequire,
} = require("./pixel-test-support.cjs");
const { workload, MAX } = require("./compact-workload.cjs");
const codec = require("./compact-export.cjs");
const { PRIVATE } = require("./pixel-control.js");
const { schnorr } = kitRequire("@noble/curves/secp256k1");
const w = workload(MAX),
  secret = Uint8Array.from([...Array(31).fill(0), 3]);
const key = Buffer.from(
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "hex",
);
const rec = {
  installation: w.vector.context.installation,
  index: 0,
  id: 1n,
  generation: 1,
  inputs: w.vector.proofs.map((p) => ({
    slot: p.slot,
    generation: p.generation,
  })),
};
const view = codec.fixtureView(
  { ...w.vector.context, cardKey: key },
  w.vector.keysets,
  w.vector.proofs,
);
const signed = codec.signCompact(rec, w.vector.outputs, view, (m) =>
  Buffer.from(schnorr.sign(m, secret, new Uint8Array(32))),
);
const exported = codec.exportCompact({ ...rec, packet: signed }, view);
const packet = Buffer.concat([...exported.pages()]);
const scope = Buffer.concat([
  Buffer.from([0]),
  Buffer.from("000000000000000100000001", "hex"),
  Buffer.from(exported.packetId, "hex"),
]);
function fake(options = {}) {
  const f = fixture({
    wrongChip: options.wrongChip,
    wrongKeys: options.wrongKeys,
  });
  f.card.packages.set(PRIVATE[2], {
    aid: PRIVATE[2],
    modules: PRIVATE.slice(0, 2),
    size: 27343,
    instancesMade: 2,
  });
  for (const aid of PRIVATE.slice(0, 2))
    f.card.instances.set(aid, {
      aid,
      module: aid,
      pkg: PRIVATE[2],
      state: { unspent: 0, spent: 0, pin: 0, record: 0, owner: 0 },
    });
  const original = f.args.tx;
  let retired = false,
    stage = "",
    clock = 0;
  const replies = [],
    records = [];
  const args = {
    sdk,
    expectedKey: key.toString("hex"),
    now: () => clock,
    random: (n) => Array.from({ length: n }, (_, i) => i),
    independentVerify: (k, p, v) => verifyIndependent("python3", k, p, v),
    save: async (p) => {
      stage = p.stage;
      records.push(p);
      if (options.failVerifiedSave && p.independentlyVerified)
        throw Error("PRIVATE journal error");
      if (options.expire && p.nodeVerified) clock = 120001;
    },
    tx: async (apdu) => {
      let reply = await original(apdu);
      if (options.wrongVersion && apdu[1] === 0x50) {
        reply = [...reply];
        reply[10] = 2;
      }
      if (
        options.swapCleanup &&
        stage === "cleanup-match-chip" &&
        apdu[1] === 0xca
      ) {
        reply = [...reply];
        reply[15] ^= 1;
      }
      const ok = (data) => [...data, 0x90, 0];
      if (apdu[0] === 0xb0) {
        if (apdu[1] === 0x7d) reply = ok(b("7fff0a0e0a0014001400400030000205"));
        else if (apdu[1] === 0x7a)
          reply = ok(
            options.wrongKey
              ? b(
                  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
                )
              : key,
          );
        else if (apdu[1] === 0x76)
          reply = ok(
            options.badStatus
              ? [64, 90, 0, 0, 128, 0]
              : retired
                ? [64, 90, 0, 0, 128, 0]
                : options.unpublished
                  ? [64, 90, 128, 0, 0, 0]
                  : [63, 45, 0, 128, 0, 0],
          );
        else if (apdu[1] === 0x7c)
          reply = options.unpublished
            ? [0x69, 0x85]
            : ok(
                options.badScope
                  ? [...scope.slice(0, -1), scope.at(-1) ^ 1]
                  : scope,
              );
        else if (apdu[1] === 0x75) {
          const off = (apdu[6] << 8) | apdu[7],
            size = apdu[8];
          if (options.losePage && off === 255 * 5)
            throw Error("PRIVATE native error");
          const page = [...packet.subarray(off, off + size)];
          if (options.tamperPage && off === 255) page[0] ^= 1;
          if (options.shortPage && off === 255) page.pop();
          reply = ok(page);
        } else if (apdu[1] === 0x77) {
          retired = true;
          if (options.loseRetire) throw Error("PRIVATE lost retirement");
          reply = ok([1]);
        }
      }
      if (options.overlongReply && apdu[1] === 0x7d)
        reply = ok(Array(300).fill(0));
      if (
        options.unknownRegistry &&
        stage.startsWith("before-recovery-load-files")
      )
        reply = [
          ...reply.slice(0, -2),
          ...b("e30e4f05a0000000999f700101ce020100"),
          0x90,
          0,
        ];
      replies.push({ apdu, reply });
      return reply;
    },
  };
  if (options.independentFalse) args.independentVerify = () => false;
  return { args, card: f.card, sent: f.sent, replies, records };
}
const destructive = (f) => f.sent.filter((a) => a[1] === 0x77 || a[1] === 0xe4);
test("committed recovery verifies 91 pages and both independent signatures before retirement and blank cleanup", async () => {
  const f = fake(),
    r = await recoverToBlank(f.args);
  assert.equal(r.status, "complete", JSON.stringify(r));
  assert.equal(r.independentlyVerified, true);
  assert.equal(r.blankBaselineVerified, true);
  assert.equal(r.exportPages.length, 91);
  assert.equal(r.registrySnapshots.length, 3);
  assert.ok(r.registrySnapshots.every((x) => x.verified));
  assert.equal(f.sent.filter((a) => a[1] === 0x77).length, 1);
  assert.equal(f.sent.filter((a) => a[1] === 0xe4).length, 3);
  assert.equal(f.sent.filter((a) => a[1] === 0x82).length, 2);
  assert.ok(
    !f.sent.some((a) =>
      [0x74, 0x71, 0x72, 0x73, 0x78, 0x7e, 0xe6, 0xe8, 0xd8].includes(a[1]),
    ),
  );
  assert.ok(r.commands <= 160);
  assert.equal(f.card.instances.size, 0);
  assert.equal(f.card.packages.size, 0);
  // Validate every real SCP02/fake-card exchange against the independent Python policy.
  const text = execFileSync(
    "python3",
    [
      "-c",
      "import sys,json;sys.path.insert(0,sys.argv[1]);from compact_recovery_bridge import Policy;p=Policy(expected_key=bytes.fromhex(sys.argv[2]));xs=json.load(sys.stdin);[(p.after(p.before(x['apdu']),x['reply'][:-2],*x['reply'][-2:])) for x in xs];print(len(xs))",
      __dirname,
      key.toString("hex"),
    ],
    { input: JSON.stringify(f.replies), encoding: "utf8" },
  );
  assert.equal(Number(text.trim()), f.replies.length);
});
test("unpublished staging may be discarded only with all 128 unspent slots and absent scope", async () => {
  const f = fake({ unpublished: true }),
    r = await recoverToBlank(f.args);
  assert.equal(r.status, "complete", JSON.stringify(r));
  assert.equal(r.recoveryBranch, "unpublished-staging-released");
  assert.equal(r.blankBaselineVerified, true);
  assert.ok(!f.sent.some((a) => [0x75, 0x77, 0x74].includes(a[1])));
});
for (const [option, reason] of [
  ["wrongChip", "wrong-chip"],
  ["wrongKeys", "factory-keys-not-proved"],
  ["wrongVersion", "factory-version-mismatch"],
  ["unknownRegistry", "recovery-registry-mismatch"],
  ["wrongKey", "recovery-key-mismatch"],
  ["badStatus", "recovery-state-mismatch"],
  ["badScope", "recovery-packet-invalid"],
  ["overlongReply", "recovery-invalid-reply"],
  ["losePage", "operation-failed"],
  ["shortPage", "recovery-page-length"],
  ["tamperPage", "recovery-packet-invalid"],
  ["independentFalse", "independent-verification-failed"],
  ["failVerifiedSave", "journal-unavailable"],
  ["expire", "drill-bound-exceeded"],
])
  test(option + " stops without retirement or deletion", async () => {
    const f = fake({ [option]: true }),
      r = await recoverToBlank(f.args);
    assert.equal(r.status, "stopped", JSON.stringify(r));
    assert.equal(r.failure, reason);
    assert.equal(destructive(f).length, 0);
    assert.ok(!JSON.stringify(r).includes("PRIVATE "));
    if (option === "losePage") assert.equal(r.exportPages.length, 5);
    if (option === "wrongKeys" || option === "wrongVersion")
      assert.equal(f.sent.filter((a) => a[1] === 0x82).length, 0);
    if (option === "unknownRegistry")
      assert.ok(
        !f.sent.some(
          (a) =>
            a[0] === 0 &&
            a[1] === 0xa4 &&
            Buffer.from(a.slice(5, 5 + a[4]))
              .toString("hex")
              .toUpperCase() === PRIVATE[0],
        ),
      );
  });
test("a different chip at cleanup blocks the second authentication and every deletion", async () => {
  const f = fake({ unpublished: true, swapCleanup: true }),
    r = await recoverToBlank(f.args);
  assert.equal(r.failure, "wrong-chip");
  assert.equal(f.sent.filter((a) => a[1] === 0x82).length, 1);
  assert.equal(destructive(f).length, 0);
});
test("a lost retirement reply preserves verified packet without another command or deletion", async () => {
  const f = fake({ loseRetire: true }),
    r = await recoverToBlank(f.args);
  assert.equal(r.status, "stopped");
  assert.equal(r.independentlyVerified, true);
  assert.equal(r.packet, packet.toString("hex"));
  assert.equal(f.sent.at(-1)[1], 0x77);
  assert.equal(f.sent.filter((a) => a[1] === 0xe4).length, 0);
});
test("missing verifier, invalid key and refused durable intent send no APDU", async () => {
  for (const mode of ["verifier", "key", "journal"]) {
    const f = fake();
    if (mode === "verifier") delete f.args.independentVerify;
    else if (mode === "key") f.args.expectedKey = "00";
    else
      f.args.save = () => {
        throw Error("PRIVATE storage");
      };
    const r = await recoverToBlank(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(f.sent.length, 0);
  }
});
test("independent Python verification rejects either damaged signature", () => {
  const verified = {
    paymentMessage: exported.paymentMessage,
    descriptorMessage: exported.descriptorMessage,
  };
  assert.equal(verifyIndependent("python3", key, packet, verified), true);
  for (const at of [packet.length - 128, packet.length - 1]) {
    const bad = Buffer.from(packet);
    bad[at] ^= 1;
    assert.equal(verifyIndependent("python3", key, bad, verified), false);
  }
});
test("the streamed image recovers the same two exact states with its own image evidence", async () => {
  for (const unpublished of [false, true]) {
    const f = fake({ unpublished });
    f.args.profile = "streamed";
    const r = await recoverToBlank(f.args);
    assert.equal(r.status, "complete", JSON.stringify(r));
    assert.equal(r.plan, "compact-streamed-sign-recovery-v1");
    assert.equal(r.cap, require("./pixel-streamed.json").cap);
    assert.equal(r.blankBaselineVerified, true);
    assert.equal(f.sent.filter((a) => a[1] === 0x74).length, 0);
    assert.equal(
      f.sent.filter((a) => a[1] === 0x77).length,
      unpublished ? 0 : 1,
    );
  }
});
test("an unknown recovery image profile stops before any APDU", async () => {
  const f = fake();
  f.args.profile = "arbitrary";
  const r = await recoverToBlank(f.args);
  assert.equal(r.failure, "recovery-profile-invalid");
  assert.equal(f.sent.length, 0);
});
