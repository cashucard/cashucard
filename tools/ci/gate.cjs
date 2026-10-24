const { JOBS } = require("./affected.cjs");

function checkResults(needs) {
  if (needs.changes?.result !== "success" || needs.policy?.result !== "success")
    throw Error("Change detection and policy checks must succeed.");
  if (
    Object.keys(needs).some(
      (job) => !["changes", "policy", ...JOBS].includes(job),
    )
  )
    throw Error("Unknown gate dependency.");
  const selected = JSON.parse(needs.changes.outputs.selected);
  if (
    !Array.isArray(selected) ||
    selected.some((job) => !JOBS.includes(job)) ||
    new Set(selected).size !== selected.length
  )
    throw Error("Invalid selected-job manifest.");
  for (const job of JOBS) {
    const expected = selected.includes(job) ? "success" : "skipped";
    if (needs[job]?.result !== expected)
      throw Error(
        `${job}: expected ${expected}; received ${needs[job]?.result || "missing"}.`,
      );
  }
  return true;
}
module.exports = { checkResults };
if (require.main === module) {
  checkResults(JSON.parse(process.env.CI_RESULTS));
  console.log("All selected checks passed.");
}
