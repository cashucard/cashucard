const assert = require("node:assert/strict");
const sdk = require("../cardkit");
const profile = require("./pixel-07297620-create.json");
const cplc = [...Buffer.from(profile.cplc, "hex")];
const memory = [
  ...Buffer.from("ff21108102000182040001d484830400000ea6", "hex"),
];
const expected = [
  [...sdk.selectAid(sdk.ISD_AID)],
  [0x80, 0xca, 0x9f, 0x7f, 0],
  [0x80, 0xca, 0xff, 0x21, 0],
  [...sdk.selectAid(sdk.ISD_AID)],
  [0x80, 0xca, 0x9f, 0x7f, 0],
];
function fixture(o = {}) {
  const sent = [],
    saved = [],
    exchanges = [];
  let closed = 0;
  return {
    sent,
    saved,
    exchanges,
    get closed() {
      return closed;
    },
    args: {
      sdk,
      now: () => 0,
      save: async (v) => {
        saved.push(structuredClone(v));
        if (o.save) throw Error("disk");
      },
      close: async () => {
        closed++;
        if (o.close) throw Error("native private");
        return { policyComplete: true };
      },
      verifyEvidence: async () => !o.evidence,
      tx: async (a) => {
        sent.push([...a]);
        const n = sent.length - 1;
        assert.deepEqual(a, expected[n]);
        if (o.lost && n === 2) throw Error("native private");
        const data =
          n === 1 || n === 4
            ? o.wrong
              ? Array(45).fill(0)
              : cplc
            : n === 2
              ? o.badMemory
                ? memory.slice(1)
                : memory
              : [0x6f, 0];
        const r = [
          ...data,
          ...(o.status && n === 2 ? [0x6a, 0x88] : [0x90, 0]),
        ];
        exchanges.push({ apdu: [...a], reply: r });
        return r;
      },
    },
  };
}
module.exports = { fixture, expected };
