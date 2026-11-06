/* One already-admitted private request, one child, no reconnect or reset. */
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
const { CleanupFailure } = require("./unset-up-recovery.cjs");
async function openInspectionBridge({
  python,
  sitePackages,
  request,
  sha256,
  now = () => performance.now(),
  began = now(),
  planId = "inspect-07297620-v1",
}) {
  if (planId !== "inspect-07297620-v1")
    throw new CleanupFailure("unknown-inspection-plan");
  const checkBudget = () => {
    const elapsed = now() - began;
    if (!Number.isFinite(elapsed) || elapsed >= 120000)
      throw new CleanupFailure("elapsed-bound");
  };
  checkBudget();
  const child = spawn(
    python,
    [
      "-I",
      "-S",
      "-B",
      "-u",
      path.join(__dirname, "inspect_07297620.py"),
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
    busy = false,
    failed = false;
  child.on("error", () => {
    failed = true;
    lines.close();
  });
  child.stdin.on("error", () => {
    failed = true;
    lines.close();
  });
  const next = async (bound = 30000) => {
    let timer;
    try {
      const limit = Math.max(1, Math.min(bound, 120000 - (now() - began)));
      const r = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            failed = true;
            child.kill();
            reject(new CleanupFailure("reader-response-timeout"));
          }, limit);
        }),
      ]);
      if (r.done || r.value.length > 4096)
        throw new CleanupFailure("reader-pipe-closed");
      let v;
      try {
        v = JSON.parse(r.value);
      } catch {
        throw new CleanupFailure("reader-protocol-error");
      }
      if (v.error)
        throw new CleanupFailure(
          [
            "reader-unavailable",
            "reader-enumeration-failed",
            "reader-connect-failed",
            "reader-transmit-failed",
            "reader-close-failed",
            "bridge-command-refused",
            "drill-bound-exceeded",
          ].includes(v.error)
            ? v.error
            : "reader-protocol-error",
        );
      return v;
    } finally {
      clearTimeout(timer);
    }
  };
  const exit = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  const close = async () => {
    if (closed) throw new CleanupFailure("reader-close-uncertain");
    closed = true;
    let confirmed = false,
      policyComplete = false;
    try {
      if (
        !busy &&
        !failed &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.stdin.write('{"close":true}\n');
        const receipt = await next(1000);
        confirmed = receipt.closed === true;
        policyComplete = receipt.complete === true;
      }
    } catch {
      failed = true;
    }
    child.stdin.end();
    if (!confirmed) child.kill();
    await exit();
    lines.close();
    if (!confirmed || child.exitCode !== 0)
      throw new CleanupFailure("reader-close-uncertain");
    return { policyComplete };
  };
  try {
    if ((await next()).ready !== true)
      throw new CleanupFailure("reader-not-ready");
  } catch (error) {
    try {
      await close();
    } catch {
      error.closeUncertain = true;
    }
    error.bridgePid = child.pid;
    throw error;
  }
  return {
    pid: child.pid,
    close,
    tx: async (apdu) => {
      if (closed || busy || failed)
        throw new CleanupFailure("reader-not-ready");
      checkBudget();
      busy = true;
      try {
        child.stdin.write(JSON.stringify({ apdu }) + "\n");
        const v = await next();
        if (
          !Array.isArray(v.reply) ||
          v.reply.length < 2 ||
          v.reply.length > 258 ||
          v.reply.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
        )
          throw new CleanupFailure("reader-protocol-error");
        return v.reply;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
module.exports = { openInspectionBridge };
