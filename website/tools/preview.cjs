// Local preview of dist/ that behaves like the intended host: byte-range (206) responses, which Safari needs
// to play the film, and the rules in dist/_headers, so the content security policy is exercised locally.
// Usage: node tools/preview.cjs [port]   (default 9117, bound to 127.0.0.1)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "dist");
const port = Number(process.argv[2] || process.env.PORT || 9117);
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf",
  ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".md": "text/markdown; charset=utf-8",
};

// _headers: a line without indentation is a path pattern (one * splat), indented lines are headers for it
function readRules() {
  const rules = [];
  let current = null;
  for (const line of fs.readFileSync(path.join(root, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: [] }; rules.push(current); continue; }
    const at = line.indexOf(":");
    if (current && at > 0) current.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  return rules;
}
const matches = (pattern, p) => new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(p);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || path.basename(file) === "_headers" || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  for (const rule of readRules()) if (matches(rule.pattern, url.pathname)) for (const [k, v] of rule.headers) res.setHeader(k, v);
  const size = fs.statSync(file).size;
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "Content-Range": "bytes */" + size });
      res.end();
      return;
    }
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log("Preview at http://127.0.0.1:" + port));
