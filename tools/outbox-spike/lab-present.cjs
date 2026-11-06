// Tests that read retained lab evidence (under ~/.cashucard) or run the
// cardctl virtualenv only run where those exist: on the lab Mac they run in
// full, elsewhere (CI, another checkout) they skip with a visible reason
// instead of failing on a missing file.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");

const LAB = path.join(os.homedir(), ".cashucard");
const CARDCTL_PYTHON = path.join(
  __dirname,
  "..",
  "cardctl",
  ".venv",
  "bin",
  "python",
);

/** A path under ~/.cashucard. */
const labPath = (...parts) => path.join(LAB, ...parts);

/** false when every file exists, else the skip message for node:test. */
function labSkip(...files) {
  const missing = files.flat().filter((f) => !fs.existsSync(f));
  return missing.length === 0
    ? false
    : `skipped: lab evidence under ~/.cashucard not present (${missing.join(", ")})`;
}

/** false when the cardctl virtualenv's python exists, else the skip message. */
function venvSkip() {
  return fs.existsSync(CARDCTL_PYTHON)
    ? false
    : "skipped: tools/cardctl/.venv not present";
}

module.exports = { LAB, CARDCTL_PYTHON, labPath, labSkip, venvSkip };
