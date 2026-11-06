const assert = require("node:assert/strict");
const sdk = require("../cardkit"),
  { createRequire } = require("node:module");
const kit = createRequire(require.resolve("../cardkit/package.json")),
  { FakeCard } = kit("@cashu-card/cardkit/testing");
const p = require("./constructor-trace-07297620.json");
const { sha } = require("./constructor-trace.cjs");
const stages = Array.from({ length: 64 }, (_, i) => {
  const statement = i === 47 ? "schnorrHW.init();" : `operation${i + 1}();`;
  return {
    id: i + 1,
    file: i < 48 ? "CashuApplet.java" : "SchnorrHW.java",
    statement,
    statementSha256: sha(statement),
  };
});
const bytes = (s) => [...Buffer.from(s, "hex")];
function load() {
  const component = (tag, data) => [
    tag,
    data.length >> 8,
    data.length & 255,
    ...data,
  ];
  const pkg = bytes(p.package);
  const h = component(1, [...Array(9).fill(0), pkg.length, ...pkg]);
  const a = component(3, [
    2,
    ...["4D", "01"].flatMap((s) => {
      const x = bytes(p.package + s);
      return [x.length, ...x, 0, 0];
    }),
  ]);
  const fill = component(
      2,
      Array(p.bytes - 4 - h.length - a.length - 3).fill(0),
    ),
    body = [...h, ...a, ...fill];
  return [0xc4, 0x82, body.length >> 8, body.length & 255, ...body];
}
function fixture(o = {}) {
  const card = new FakeCard(o.wrongKeys ? { keys: sdk.SPIKE_KEYS } : {}),
    sent = [],
    saved = [],
    exchanges = [];
  let selected = false,
    closed = 0,
    clock = 0;
  return {
    card,
    sent,
    saved,
    exchanges,
    get closed() {
      return closed;
    },
    args: {
      sdk,
      load: o.image ? [...o.image.load] : load(),
      stages: o.image ? o.image.stages : stages,
      hash: o.image ? undefined : () => p.load,
      random: (n) => Array.from({ length: n }, (_, i) => i),
      now: () => clock,
      save: async (s) => {
        saved.push(structuredClone(s));
        if (o.storage && s.stage === o.storage) throw Error("disk");
      },
      close: async () => {
        closed++;
        if (o.close) throw Error("native private");
        return { policyComplete: !o.policyIncomplete };
      },
      verifyEvidence: async () => !o.evidence,
      tx: async (a) => {
        sent.push([...a]);
        let r = await card.transceive(a);
        if (a[1] === 0xca && !o.wrongChip) r = [...bytes(p.cplc), 0x90, 0];
        if (a[1] === 0xf2) {
          const kind = a[2] === 0x40 ? "applications" : "load-files";
          let data = p.initialPages.find((x) => x.kind === kind).data;
          if (card.instances.has(p.package + "01"))
            data += p.addedPages.find((x) => x.kind === kind).data;
          if (o.changedBaseline && kind === "load-files")
            data = data.replace("e3214f0d", "e3214f0c");
          r = [...bytes(data), 0x90, 0];
        }
        if (o.mute && a[1] === 0xe6 && card.instances.has(p.package + "01"))
          throw Error("native private");
        if (
          a[1] === 0xa4 &&
          Buffer.from(a.slice(5, -1)).toString("hex").toUpperCase() ===
            p.package + "01" &&
          card.instances.has(p.package + "01")
        ) {
          selected = true;
          r = [...bytes("43545241434501"), 0x90, 0];
        }
        if (a[0] === 0xb0 && selected) {
          r = [
            ...bytes(
              o.badDiagnostic
                ? "010130000000"
                : o.fault
                  ? "010331010003"
                  : "010430000000",
            ),
            0x90,
            0,
          ];
        }
        exchanges.push({ apdu: [...a], reply: [...r] });
        return r;
      },
    },
  };
}
module.exports = { fixture };
