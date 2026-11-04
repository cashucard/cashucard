const test = require("node:test"),
  assert = require("node:assert/strict");
const { localHTTP } = require("./local-http.cjs");
test("local transport refuses external origins and foreign routes before fetch", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  for (const origin of [
    "https://forge.flashapp.me",
    "http://example.com",
    "http://localhost.evil",
    "http://user@localhost",
    "http://127.0.0.1/path",
  ])
    assert.throws(() => localHTTP(origin, { fetch }));
  const request = localHTTP("http://127.0.0.1:4338", { fetch });
  for (const route of [
    "https://example.com/v1/swap",
    "//example.com/v1/swap",
    "/v1/swap?next=other",
    "/admin",
    "/v1/keys/../../other",
  ])
    await assert.rejects(request(route));
  assert.equal(calls, 0);
});
test("local requests are bounded and cannot forward a redirect or credentials", async () => {
  let init;
  const request = localHTTP("http://127.0.0.1:4338", {
    fetch: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:4338/v1/restore");
      init = options;
      return Response.json({ outputs: [], signatures: [] });
    },
  });
  assert.deepEqual(await request("/v1/restore", { outputs: [] }), {
    outputs: [],
    signatures: [],
  });
  assert.equal(init.redirect, "error");
  assert.equal(init.signal.aborted, false);
  assert.deepEqual(init.headers, { "content-type": "application/json" });
  for (const response of [
    new Response("", { status: 302 }),
    new Response("x".repeat(1048577)),
    new Response("invalid-json"),
  ])
    await assert.rejects(
      localHTTP("http://127.0.0.1:4338", { fetch: async () => response })(
        "/v1/keysets",
      ),
    );
});
