const { createHash } = require("node:crypto");
const sdk = require("../cardkit");
const kitRequire = require("node:module").createRequire(
  require.resolve("../cardkit/package.json"),
);
const { FakeCard } = kitRequire("@cashu-card/cardkit/testing");
const {
  PINS,
  INSTALL_PINS,
  BASELINE,
  PRIVATE,
  runCreation,
  resumeJournal,
  runPhaseInstall,
} = require("./pixel-control.js");
// The install profile loads through opener then main and creates no Tag.
const INSTALLED = [INSTALL_PINS.package + "4D", INSTALL_PINS.package + "01"];
const b = (hex) => [...Buffer.from(hex, "hex")];
// One entry of a registry listing: AID, life cycle, no privileges, the package
// that loaded it and the ISD that registered it, under the card's E3 TLV.
const registryRecord = (aid, lifeCycle, owner, isd) => {
  const body = [
    0x4f,
    aid.length / 2,
    ...b(aid),
    0x9f,
    0x70,
    0x01,
    lifeCycle,
    0xc5,
    0x03,
    0,
    0,
    0,
    0xc4,
    0x0a,
    ...b(owner),
    0xcc,
    0x08,
    ...isd,
  ];
  return [0xe3, body.length, ...body];
};
// The load-file entry the installed image registers, as the card lists it.
const LOAD_FILE = registryRecord(
  INSTALL_PINS.package + "4D",
  7,
  INSTALL_PINS.package,
  sdk.ISD_AID,
);
// P2 counts the last command written: a listing inside the channel carries a
// command number where the plain one carries a fixed byte.
const MODE = (apdu) => (apdu[0] === 0x84 ? apdu[2] : apdu[4]);
// Records the fixture synthesizes are uppercase, as the card prints them.
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
  // The fake card cannot open a secret channel, so the commands the protected
  // applet answers only inside one are served here as recovery reads them.
  const isolated = options.protected;
  const pins = options.pins || PINS;
  const card = new FakeCard(options.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {});
  const records = [],
    sent = [];
  let clock = 0,
    aborted = false,
    changedChip = false,
    selected = "";
  // The applet's answer to a listing inside the channel: its package's own
  // record at life cycle 1, then every instance in the order the module printed
  // them, with the package AID resolving to that record rather than an instance.
  const plainListing = ({ isd = sdk.ISD_AID, extra = [] } = {}) => {
    const pkg = extra.at(-1);
    return [
      ...(pkg ? registryRecord(pkg, 1, pkg, isd) : []),
      ...card
        .instanceAids()
        .flatMap((aid) => (aid === pkg ? extra.slice(0, -1) : [aid]))
        .flatMap((aid) => registryRecord(aid, 7, pkg, isd)),
      0x90,
      0,
    ];
  };
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
      // P1 20 lists load files and P1 40 instances; the fake answers with what
      // that registry holds at this point in the install.
      if (apdu[2] === 0x20) {
        // Before the load the card lists the platform's three load files and no
        // instances; once the image's package exists it lists it as the fourth.
        // A run that lists inside the channel stages the same records there, so
        // this listing carries its package record while the package exists, and
        // drops it with the package. Only here: the fake card cannot open that
        // channel, so this is the one listing a blanked card can give.
        if (isolated?.instances && MODE(apdu) > 0) {
          const pkg = isolated.instances.extra.at(-1);
          return [
            ...(card.packages.has(pkg)
              ? registryRecord(pkg, 1, pkg, sdk.ISD_AID)
              : []),
            ...BASELINE.flatMap(b),
            0x90,
            0,
          ];
        }
        const entries = BASELINE.flatMap(b);
        if (options.mode === "phase-install" && card.instances.size === 2)
          entries.push(...b(LOAD_FILE));
        if (options.unknownRegistry) entries.push(...entries.slice(0, 0x1d));
        reply = [...entries, 0x90, 0];
      }
      if (apdu[2] === 0x40 && isolated?.instances && MODE(apdu) > 0) {
        // A listing inside the channel answers what the applet holds. Without
        // that channel a recovered card gives this listing, so it stands in for
        // both reads, and drops to the platform's files once the package is gone.
        reply = card.instanceAids().length
          ? plainListing(isolated.instances)
          : [...BASELINE.flatMap(b), 0x90, 0];
      }
      // Recovery lists instances once authenticated; that listing appends any
      // foreign record, including inside a protected instance.
      if (
        options.unknownCleanup &&
        card.instanceAids().length === 2 &&
        apdu[2] === 0x40
      ) {
        reply = [
          ...reply.slice(0, -2),
          ...b("e3104f05a0000000999f700101ce020100"),
          0x90,
          0,
        ];
      }
    }
    if (apdu[1] === 0xa4) {
      const aid = hex(apdu.slice(5, 5 + apdu[4]));
      const privateInstance =
        aid === PRIVATE[0] ||
        (options.mode === "phase-install" && aid === INSTALLED[1]);
      if (privateInstance) selected = aid;
      // The applet answers a select with its version. The install profile
      // selects it only through the full AID, so a partial name keeps the
      // card's own answer there.
      if (
        privateInstance &&
        card.instances.has(aid) &&
        (options.mode !== "phase-install" || apdu[4] > 0)
      )
        reply = [...Buffer.from("CPROT\x02"), 0x90, 0];
    }
    // The applet answers diagnostics only while its instance is selected, so a
    // read before creation keeps the card's 6D00.
    if (apdu[0] === 0xb0 && apdu[1] === 0x7d && selected === INSTALLED[1]) {
      const words = [32767, 2574, 2560, 5120, 5120];
      // Saturated counters, the commit floor, then pool and DLEQ reservations at
      // zero, setup state zero and format five.
      reply = [
        ...words.flatMap((w) => [w >> 8, w & 255]),
        ...(options.badDiagnostic ? [0, 2, 0, 0] : [0, 0, 0, 0]),
        0,
        5,
        0x90,
        0,
      ];
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
      if (
        options.journalFails &&
        record.stage ===
          "load-1-of-" + (options.mode === "phase-install" ? 114 : 110)
      )
        throw Error("storage failed");
    },
  };
  return { card, records, sent, args };
}

module.exports = {
  fixture,
  sha,
  hex,
  b,
  sdk,
  kitRequire,
  INSTALLED,
  runPhaseInstall,
  INSTALL_PINS,
  resumeJournal,
};
