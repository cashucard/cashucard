const sdk = require("../cardkit");
const { createRequire } = require("node:module");
const kit = createRequire(require.resolve("../cardkit/package.json"));
const { FakeCard } = kit("@cashu-card/cardkit/testing");
const image = require("./pixel-07297620-create.json");
const { registryFrames } = require("./run-probe.cjs");
const privateFrames = Object.fromEntries(
  image.installedPrivatePages.map((p) => [p.kind, registryFrames(p.data)]),
);
function fixture(o = {}) {
  const card = new FakeCard(o.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {}),
    sent = [],
    saved = [],
    exchanges = [];
  let closes = 0,
    clock = 0;
  const apps = [
    privateFrames.applications[0],
    ...(o.main ? [privateFrames.applications[1]] : []),
  ];
  let loads = image.baselinePages[1].data + privateFrames["load-files"][0];
  if (o.missingBaseline)
    loads = loads.replace(registryFrames(image.baselinePages[1].data)[1], "");
  if (o.extra) apps.push("e30a4f0501020304059f700101");
  if (o.missingOpener) apps.shift();
  let counts = { applications: 0, "load-files": 0 };
  return {
    sent,
    saved,
    exchanges,
    get closes() {
      return closes;
    },
    args: {
      sdk,
      random: (n) => Array.from({ length: n }, (_, i) => i),
      now: () => clock,
      tx: async (a) => {
        sent.push([...a]);
        if (o.lost && a[1] === 0xf2) throw Error("native private");
        let r = await card.transceive(a);
        if (a[1] === 0xca && !o.wrongChip)
          r = [...Buffer.from(image.cplc, "hex"), 0x90, 0];
        if (a[1] === 0xf2) {
          const kind = a[2] === 0x40 ? "applications" : "load-files";
          let data = kind === "applications" ? apps.join("") : loads;
          const page = counts[kind]++;
          const pages = o.pages || (o.split ? 2 : 1);
          const width = Math.ceil(data.length / (2 * pages)) * 2;
          const chunk = data.slice(page * width, (page + 1) * width);
          r = [
            ...Buffer.from(chunk, "hex"),
            ...(page < pages - 1 || o.endless ? [0x63, 0x10] : [0x90, 0]),
          ];
        }
        exchanges.push({ apdu: [...a], reply: [...r] });
        return r;
      },
      save: async (s) => {
        saved.push(structuredClone(s));
        if (o.storage && s.stage === o.storage) throw Error("disk");
      },
      close: async () => {
        closes++;
        if (o.close) throw Error("native private");
        return { policyComplete: !o.policyIncomplete };
      },
      verifyEvidence: async () => !o.savedRefused,
    },
  };
}
module.exports = { fixture };
