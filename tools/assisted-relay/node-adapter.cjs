/* Host test cryptography adapter; relay.js itself uses only arrays and strings. */
const cc = require("../cardsim/cashu-crypto.cjs");
const crypto = {
  hash: (b) => [...cc.sha256(Buffer.from(b))],
  verify: (s, m, k) =>
    cc.schnorrVerify(Buffer.from(k), Buffer.from(m), Buffer.from(s)),
  point: (b) => {
    try {
      return !!cc.point(Buffer.from(b));
    } catch {
      return false;
    }
  },
  proofY: (s) => cc.hexOf(cc.compressed(cc.hashToCurve(Buffer.from(s)))),
  dleq: (o, s, k) => cc.verifyBlindDleq(o.B_, s.C_, s.dleq.e, s.dleq.s, k),
};
module.exports = { crypto };
