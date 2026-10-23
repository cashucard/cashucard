// cashucard.org on Cloudflare Workers: dist/ is served as static assets, with dist/_headers applied.
// Only /film/* runs this script first (wrangler.jsonc). The asset server answers a Range request with the whole
// file (200), and Safari and iOS play video only from 206 responses. With Workers Caching on, Cloudflare strips
// Range, stores the full 200 this returns and serves 206 slices from its cache; the slice below covers requests
// that reach the script with Range intact. Responses from this script skip dist/_headers, so it sets its own.
// The pattern follows daylightfob.com's Worker.
const FILM_HEADERS = { "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" };

export default {
  async fetch(req, env) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const url = new URL(req.url);
    const res = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
    if (res.status !== 200 || !res.body) return res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(FILM_HEADERS)) headers.set(k, v);
    if (!url.pathname.endsWith(".mp4")) {
      if (req.method === "HEAD") { res.body.cancel(); return new Response(null, { status: 200, headers }); }
      return new Response(res.body, { status: 200, headers });
    }
    headers.set("Accept-Ranges", "bytes");
    const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("Range") || "").trim());
    if (!m || (m[1] === "" && m[2] === "")) {
      if (req.method === "HEAD") { res.body.cancel(); return new Response(null, { status: 200, headers }); }
      return new Response(res.body, { status: 200, headers });
    }
    const buf = new Uint8Array(await res.arrayBuffer()), size = buf.byteLength;
    let start, end;
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (!size || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(req.method === "HEAD" ? null : buf.subarray(start, end + 1), { status: 206, headers });
  },
};
