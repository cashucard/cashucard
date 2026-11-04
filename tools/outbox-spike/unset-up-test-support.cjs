const { createRequire } = require("node:module");
const sdk = require("../cardkit");
const kit = createRequire(require.resolve("../cardkit/package.json"));
const { FakeCard } = kit("@cashu-card/cardkit/testing");
const profile = require("./unset-up-profile.json");
const b = (s) => [...Buffer.from(s, "hex")];

function fixture(options = {}) {
  const card = new FakeCard(options.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {}),
    sent = [],
    snapshots = [],
    exchanges = [];
  const pkg = profile.package,
    key = options.key ?? profile.key;
  card.packages.set(pkg, {
    aid: pkg,
    modules: profile.deletionAids.slice(0, 2),
    size: 28067,
    instancesMade: 2,
  });
  for (const aid of profile.deletionAids.slice(0, 2))
    card.instances.set(aid, {
      aid,
      module: aid,
      pkg,
      state: { unspent: 0, spent: 0, pin: 0, owner: 0, record: 0 },
    });
  let clock = 0,
    closes = 0,
    auths = 0;
  const tx = async (a) => {
    sent.push([...a]);
    let r = await card.transceive(a);
    if (a[1] === 0x50) auths++;
    if (a[1] === 0xca && options.wrongChip)
      r = [...r.slice(0, 15), r[15] ^ 1, ...r.slice(16)];
    if (
      a[1] === 0xf2 &&
      ((r.at(-2) === 0x90 && r.at(-1) === 0) ||
        (r.at(-2) === 0x6a && r.at(-1) === 0x88))
    ) {
      const frame = profile.registry.find(
        (p) => p.kind === (a[2] === 0x40 ? "applications" : "load-files"),
      ).data;
      let data =
        a[2] === 0x40
          ? card.instances.size
            ? frame
            : ""
          : frame.slice(0, frame.lastIndexOf("e31e")) +
            (card.packages.has(pkg)
              ? frame.slice(frame.lastIndexOf("e31e"))
              : "");
      if (options.extraLoad && a[2] === 0x20)
        data += "e30a4f0501020304059f700101";
      r = data.length ? [...b(data), 0x90, 0] : [0x6a, 0x88];
    }
    if (
      a[0] === 0 &&
      a[1] === 0xa4 &&
      a.includes(0xb) &&
      a.slice(5, -1).join(",") === b(pkg + "01").join(",")
    )
      r = [...Buffer.from("CPROT\x02"), 0x90, 0];
    if (a[0] === 0xb0 && a[1] === 0x7d)
      r = [
        ...b(options.diagnostics ?? "7fff0a0e0a0014001400000000000005"),
        0x90,
        0,
      ];
    if (a[0] === 0xb0 && a[1] === 0x7a) r = [...b(key), 0x90, 0];
    if (options.failDelete && a[1] === 0xe4) throw Error("private native text");
    exchanges.push({ apdu: [...a], reply: [...r] });
    return r;
  };
  const args = {
    sdk,
    tx,
    now: () => clock,
    close: async () => {
      closes++;
      if (options.closeFailure) throw Error("private native text");
    },
    random: (n) => Array.from({ length: n }, (_, i) => i),
    save: async (s) => {
      snapshots.push(structuredClone(s));
      if (options.failSaveAt === s.stage) throw Error("storage");
    },
  };
  return {
    card,
    sent,
    snapshots,
    exchanges,
    args,
    get closes() {
      return closes;
    },
    get auths() {
      return auths;
    },
    advance: (n) => (clock += n),
  };
}
module.exports = { fixture };
