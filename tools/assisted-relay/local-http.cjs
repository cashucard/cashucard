/* Development transport: maps the signed logical mint to one explicit local
 * FakeWallet origin. Never resolve or fetch a URL obtained from a packet. */
const { localOrigin } = require("../cardsim/assisted-settlement.cjs");
function localHTTP(origin, { fetch: injected = fetch } = {}) {
  const base = localOrigin(origin);
  return async (route, body) => {
    if (
      !/^\/v1\/(keysets|keys\/[0-9a-f]{16}(?:[0-9a-f]{50})?|restore|checkstate|swap|mint\/quote\/bolt11(?:\/[A-Za-z0-9_-]+)?|mint\/bolt11)$/.test(
        route,
      )
    )
      throw Error("local route refused");
    const response = await injected(base + route, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error("local mint request failed: " + response.status);
    if (!response.body) throw Error("local mint response missing");
    const reader = response.body.getReader();
    let total = 0;
    const parts = [];
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        total += r.value.length;
        if (total > 1048576) throw Error("local mint response limit");
        parts.push(r.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  };
}
module.exports = { localHTTP };
