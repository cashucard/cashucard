/* Durable private-lab writes and stage-level presentation. No platform imports. */
function createLabJournal({ write, present }) {
  let lastStage;
  return async (value) => {
    await write(JSON.stringify(value));
    // Every barrier reaches storage. Progress renders once per running stage;
    // all armed/terminal updates include the latest session/export metadata.
    if (value.status !== "running" || value.stage !== lastStage) present(value);
    lastStage = value.stage;
  };
}
module.exports = { createLabJournal };
