/* Test-only host process. APDUs travel over IPC to the simulator parent. */
const { executePhase, reconcilePhase } = require("./phase-recovery.cjs");
const { withPhaseJournal } = require("./phase-journal.cjs");
let pending;
process.on("message", (message) => {
  if (!pending || !("reply" in message || message.transportFailed)) return;
  const next = pending;
  pending = null;
  if (message.transportFailed)
    next.reject(Error("simulated transport unavailable"));
  else next.resolve(message.reply);
});
process.once("message", async ({ file, binding, recover }) => {
  const tx = (apdu) =>
    new Promise((resolve, reject) => {
      if (pending) return reject(Error("concurrent test command"));
      pending = { resolve, reject };
      process.send({ apdu });
    });
  try {
    const result = await withPhaseJournal(
      file,
      null,
      async ({ journal, save }) =>
        (recover ? reconcilePhase : executePhase)({
          binding,
          journal,
          save,
          tx,
          now: () => 0,
        }),
    );
    process.send({
      result: {
        outcome: result.outcome,
        failure: result.failure,
        commands: result.commands,
      },
    });
  } catch {
    process.send({ result: { outcome: "worker-failed" } });
  } finally {
    process.disconnect();
  }
});
