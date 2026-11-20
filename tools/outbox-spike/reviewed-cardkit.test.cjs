const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

// The runners that drive a card (run-compact.cjs, run-probe.cjs) were reviewed
// against cardkit 0.2.0 and require it (D181): a cardkit of another version
// stops them before they touch a card, until they are reviewed against it.
// cardkit is 0.3.0 since protocol 3.0, so the runners refuse it for now.
test("the outbox-spike runners require the reviewed cardkit 0.2.0 and refuse any other", () => {
  const compact = readFileSync(join(__dirname, "run-compact.cjs"), "utf8");
  const probe = readFileSync(join(__dirname, "run-probe.cjs"), "utf8");
  assert.match(compact, /require\("\.\.\/cardkit\/package\.json"\)\.version !== "0\.2\.0"\)\n\s+throw Error\("reviewed cardkit required"\)/);
  assert.doesNotMatch(compact, /dependencies\.sdk\s*&&/, "no injected SDK skips the check");
  assert.match(probe, /require\("\.\.\/cardkit\/package\.json"\)\.version !== "0\.2\.0"\n\s+\) \{\n\s+throw new Error\("resource probe requires reviewed cardkit 0\.2\.0"\)/);
  for (const source of [compact, probe]) assert.doesNotMatch(source, /cardkit[^\n]*0\.3\.0/);
  assert.match(readFileSync(join(__dirname, "README.md"), "utf8"), /Build cardkit 0\.2\.0's public package before execution/);
  const cardkit = JSON.parse(readFileSync(join(__dirname, "..", "cardkit", "package.json"), "utf8")).version;
  assert.equal(cardkit, "0.3.0", "cardkit has moved on, so the runners refuse it until their review");
  assert.match(readFileSync(join(__dirname, "..", "cardkit", "README.md"), "utf8"), /runners require the reviewed 0\.2\.0 and refuse 0\.3\.0/);
});
