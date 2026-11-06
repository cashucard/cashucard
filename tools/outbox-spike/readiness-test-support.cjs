const { createRequire } = require("node:module");
const sdk = require("../cardkit"),
  kit = createRequire(require.resolve("../cardkit/package.json"));
const { FakeCard } = kit("@cashu-card/cardkit/testing");
const audit = require("../../docs/reports/PLAN_2026-11-04.adopt-07297620.audit.json");
function fixture(options = {}) {
  const card = new FakeCard(options.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {}),
    sent = [],
    exchanges = [],
    saved = [];
  let closes = 0,
    clock = 0;
  const tx = async (a) => {
    sent.push([...a]);
    let r = await card.transceive(a);
    if (a[1] === 0xca && !options.wrongChip)
      r = [...Buffer.from(audit.cplc, "hex"), 0x90, 0];
    if (
      a[1] === 0xf2 &&
      [0x9000, 0x6a88].includes((r.at(-2) << 8) | r.at(-1))
    ) {
      let data =
        a[2] === 0x40 ? "" : audit.lastKnownBlank.registry.pages[1].data;
      if (options.missing && a[2] === 0x20)
        data = data.slice(0, data.lastIndexOf("e31b"));
      if (options.extra && a[2] === 0x40) data = "e30a4f0501020304059f700101";
      r = data ? [...Buffer.from(data, "hex"), 0x90, 0] : [0x6a, 0x88];
    }
    exchanges.push({ apdu: [...a], reply: [...r] });
    return r;
  };
  return {
    sent,
    exchanges,
    saved,
    args: {
      sdk,
      tx,
      random: (n) => Array.from({ length: n }, (_, i) => i),
      now: () => clock,
      save: async (s) => {
        saved.push(structuredClone(s));
        if (options.storage && s.stage === options.storage) throw Error("disk");
      },
      close: async () => {
        closes++;
        if (options.close) throw Error("native");
        return { policyComplete: true };
      },
      verifyEvidence: async () => true,
    },
    get closes() {
      return closes;
    },
    advance: (n) => (clock += n),
  };
}
module.exports = { fixture };
