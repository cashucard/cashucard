/* Closed phase bridge transport. Opening requires a prewritten pinned request. */
const fs = require("node:fs"),
  path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { parseBridgeMessage, ProbeFailure } = require("./run-probe.cjs");
const { readPrivateJSON } = require("./phase-journal.cjs");
const READER = "ACS ACR122U PICC Interface";
async function openPhaseBridge({ python, sitePackages, request, sha256 }) {
  if (
    ![python, sitePackages, request].every(
      (p) => typeof p === "string" && path.isAbsolute(p),
    ) ||
    !/^[0-9a-f]{64}$/.test(sha256)
  )
    throw Error("absolute pinned phase runtime required");
  if (readPrivateJSON(request).sha256 !== sha256)
    throw Error("request changed");
  const cache = fs.mkdtempSync(path.join(path.dirname(request), "pycache-"));
  fs.chmodSync(cache, 0o700);
  const child = spawn(
    python,
    [
      "-I",
      "-S",
      "-B",
      "-X",
      "pycache_prefix=" + cache,
      "-u",
      path.join(__dirname, "phase_bridge.py"),
      "--reader",
      READER,
      "--request",
      request,
      "--sha256",
      sha256,
      "--site-packages",
      sitePackages,
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const lines = createInterface({ input: child.stdout }),
    iterator = lines[Symbol.asyncIterator]();
  let closed = false,
    busy = false;
  child.on("error", () => lines.close());
  child.stdin.on("error", () => lines.close());
  const next = async () => {
    let timer;
    try {
      const r = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(new ProbeFailure("reader-response-timeout"));
          }, 30000);
        }),
      ]);
      if (r.done || r.value.length > 4096)
        throw new ProbeFailure("reader-pipe-closed");
      return parseBridgeMessage(r.value);
    } finally {
      clearTimeout(timer);
    }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    child.stdin.end('{"close":true}\n');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    lines.close();
    try {
      fs.rmdirSync(cache);
    } catch {
      throw new ProbeFailure("reader-close-failed");
    }
    if (child.exitCode !== 0) throw new ProbeFailure("reader-close-failed");
  };
  try {
    if ((await next()).ready !== true)
      throw new ProbeFailure("reader-not-ready");
  } catch (error) {
    try {
      await close();
    } catch {
      /* Preserve the startup failure. */
      error.bridgePid = child.pid;
    }
    throw error;
  }
  return {
    pid: child.pid,
    close,
    tx: async (apdu) => {
      if (closed || busy) throw new ProbeFailure("reader-not-ready");
      busy = true;
      try {
        child.stdin.write(JSON.stringify({ apdu }) + "\n");
        const r = await next();
        if (
          !Array.isArray(r.reply) ||
          r.reply.length < 2 ||
          r.reply.length > 257 ||
          r.reply.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
        )
          throw new ProbeFailure("reader-protocol-error");
        return r.reply;
      } finally {
        busy = false;
      }
    },
  };
}
module.exports = { openPhaseBridge };
