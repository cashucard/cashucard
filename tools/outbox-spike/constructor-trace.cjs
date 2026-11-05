/* Offline artifact validation and six-byte diagnostic decoder. No transport. */
const fs = require("node:fs"),
  path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const PACKAGE = "F0434153485543545243";
const SELECT = "43545241434501";
const NAMES = [
  "CashuApplet.java",
  "ConstructorTrace.java",
  "Opener.java",
  "SchnorrHW.java",
  "Tag.java",
  "TagSwitch.java",
].sort();
function validateStages(stages, terminalStage) {
  if (
    !Array.isArray(stages) ||
    stages.length < 50 ||
    stages.length >= 128 ||
    !stages.every(
      (s, i) =>
        s.id === i + 1 &&
        ["CashuApplet.java", "SchnorrHW.java"].includes(s.file) &&
        typeof s.statement === "string" &&
        s.statementSha256 === sha(s.statement),
    )
  )
    throw Error("trace-stage-program-invalid");
  if (
    !stages.some(
      (s) =>
        s.id === terminalStage &&
        s.file === "CashuApplet.java" &&
        s.statement === "schnorrHW.init();",
    )
  )
    throw Error("trace-terminal-stage-invalid");
  return stages;
}
function artifact({ manifest, manifestHash }) {
  const raw = fs.readFileSync(manifest);
  if (sha(raw) !== manifestHash) throw Error("trace-manifest-changed");
  const m = JSON.parse(raw),
    dir = path.dirname(manifest);
  if (
    m.kind !== "constructor-trace-diagnostic-v1" ||
    m.format !== 1 ||
    m.sourceDirty !== false ||
    !/^[0-9a-f]{40}$/.test(m.sourceCommit) ||
    m.packageAid !== PACKAGE ||
    !isDeepStrictEqual(m.classShape, {
      declaredInstanceSize: 50,
      firstReferenceToken: 0,
      referenceCount: 50,
    }) ||
    !isDeepStrictEqual(Object.keys(m.generatedSources || {}).sort(), NAMES)
  )
    throw Error("trace-artifact-profile-invalid");
  const stagesRaw = fs.readFileSync(path.join(dir, "stages.json"));
  if (sha(stagesRaw) !== m.stagesSha256) throw Error("trace-stages-changed");
  const stages = validateStages(JSON.parse(stagesRaw), m.terminalStage);
  if (stages.length !== m.stageCount) throw Error("trace-stage-count-invalid");
  for (const n of NAMES)
    if (
      sha(fs.readFileSync(path.join(dir, "src/me/flashapp/cashu", n))) !==
      m.generatedSources[n]
    )
      throw Error("trace-source-changed");
  const cap = fs.readFileSync(path.join(dir, "constructor-trace.cap")),
    load = fs.readFileSync(path.join(dir, "load-file.bin"));
  if (
    sha(cap) !== m.capSha256 ||
    sha(load) !== m.loadFileSha256 ||
    load.length !== m.loadFileSize ||
    load.length < 1 ||
    load.length > 32000
  )
    throw Error("trace-load-changed");
  return { manifest: m, stages, load };
}
function decode(data, stages, terminalStage, { opener = false } = {}) {
  validateStages(stages, terminalStage);
  if (
    !Array.isArray(data) ||
    data.length !== 6 ||
    data.some((x) => !Number.isInteger(x) || x < 0 || x > 255) ||
    data[0] !== 1
  )
    throw Error("trace-reply-format");
  const [, outcome, stage, kind, hi, lo] = data,
    reason = (hi << 8) | lo;
  if (opener) {
    if (outcome || stage || kind || reason)
      throw Error("trace-opener-not-fresh");
    return { outcome: "fresh", stage: 0 };
  }
  const operation = stages.find((s) => s.id === stage);
  if (!operation) throw Error("trace-stage-invalid");
  if (outcome === 4 && stage === terminalStage && kind === 0 && reason === 0)
    return {
      outcome: "constructor-complete",
      stage,
      operation: operation.statement,
    };
  if (outcome !== 3 || kind < 1 || kind > 7 || (kind === 7 && reason !== 0))
    throw Error("trace-outcome-invalid");
  return {
    outcome: "caught-constructor-fault",
    stage,
    file: operation.file,
    operation: operation.statement,
    kind: [
      "",
      "crypto",
      "system",
      "transaction",
      "iso",
      "pin",
      "card-runtime",
      "runtime",
    ][kind],
    reason,
  };
}
module.exports = { PACKAGE, SELECT, artifact, decode, validateStages, sha };
