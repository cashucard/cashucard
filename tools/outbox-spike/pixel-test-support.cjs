const { createHash } = require("node:crypto");
const sdk = require("../cardkit");
const kitRequire = require("node:module").createRequire(
  require.resolve("../cardkit/package.json"),
);
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const {
  PINS,
  BASELINE,
  PRIVATE,
  runCreation,
  resumeJournal,
} = require("./pixel-control.js");
const b = (hex) => [...Buffer.from(hex, "hex")];
const hex = (bytes) => Buffer.from(bytes).toString("hex").toUpperCase();
const sha = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

// Synthetic parseable CAP envelope, not the pinned hardware image. Positive workflow
// cases stub only its digest; the real SHA implementation is used by the rejection case.
function syntheticLoad(pins = PINS) {
  const component = (tag, data) => [
    tag,
    data.length >> 8,
    data.length & 255,
    ...data,
  ];
  const aid = b(pins.package);
  const header = component(1, [...Array(9).fill(0), aid.length, ...aid]);
  const applets = component(3, [
    2,
    ...["4D", "01"].flatMap((s) => {
      const a = b(pins.package + s);
      return [a.length, ...a, 0, 0];
    }),
  ]);
  const filler = component(
    2,
    Array(pins.bytes - 4 - header.length - applets.length - 3).fill(0),
  );
  const body = [...header, ...applets, ...filler];
  return [0xc4, 0x82, body.length >> 8, body.length & 255, ...body];
}
function fixture(options = {}) {
  const pins = options.pins || PINS;
  const card = new FakeCard(options.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {});
  const records = [],
    sent = [];
  let clock = 0,
    aborted = false,
    changedChip = false;
  const tx = async (apdu) => {
    sent.push(apdu);
    let reply = await card.transceive(apdu);
    if (
      apdu[1] === 0xca &&
      apdu[2] === 0x9f &&
      (options.wrongChip || (changedChip && options.wrongCleanupChip))
    ) {
      reply = [...reply];
      reply[15] ^= 1;
    }
    if (apdu[1] === 0x50 && options.wrongVersion) {
      reply = [...reply];
      reply[10] = 2;
    }
    if (apdu[1] === 0xf2) {
      const baseline = BASELINE.flatMap(b);
      const data = reply.slice(0, -2);
      const extra = options.unknownRegistry
        ? b("e30e4f05a0000000999f700101ce020100")
        : [];
      if (apdu[2] === 0x20) reply = [...baseline, ...data, ...extra, 0x90, 0];
      if (
        options.unknownCleanup &&
        card.instanceAids().length === 2 &&
        apdu[2] === 0x40
      ) {
        reply = [...data, ...b("e30e4f05a0000000999f700101ce020100"), 0x90, 0];
      }
    }
    if (
      apdu[1] === 0xa4 &&
      hex(apdu.slice(5, 5 + apdu[4])) === PRIVATE[0] &&
      card.instances.has(PRIVATE[0])
    ) {
      reply = [...Buffer.from("CPROT\x02"), 0x90, 0];
    }
    if (apdu[0] === 0xb0 && apdu[1] === 0x7d) {
      const words = [
        32767,
        2574,
        2560,
        5120,
        options.badDiagnostic ? 6000 : 5120,
        0,
        0,
      ];
      reply = [...words.flatMap((w) => [w >> 8, w & 255]), 0, 5, 0x90, 0];
    }
    if (apdu[0] === 0xb0 && apdu[1] === 0x7a) {
      reply = [
        ...b(
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        ),
        0x90,
        0,
      ];
      changedChip = true;
    }
    if (options.loseOpener && card.instanceAids().length === 1) {
      throw Error("PRIVATE RAW NATIVE ERROR");
    }
    if (options.cancelOpener && card.instanceAids().length === 1)
      aborted = true;
    return reply;
  };
  const args = {
    sdk,
    limits: {
      platform: "android",
      androidTimeoutMs: 15000,
      maxTransceive: 261,
    },
    load: syntheticLoad(pins),
    hash: () => pins.load,
    tx,
    random: (n) => Array.from({ length: n }, (_, i) => i),
    now: () => clock,
    cancelled: () => aborted,
    validateKey: () => !options.badKey,
    save: async (record) => {
      records.push(record);
      if (options.expire && record.stage === "install-for-load") clock = 120001;
      if (options.journalFails && record.stage === "load-1-of-110")
        throw Error("storage failed");
    },
  };
  return { card, records, sent, args };
}

module.exports = { fixture, sha, hex, b, sdk, kitRequire };
