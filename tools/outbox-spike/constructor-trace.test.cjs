const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const { decode, validateStages, sha } = require("./constructor-trace.cjs");
const stages = Array.from({ length: 64 }, (_, i) => {
  const statement = i === 47 ? "schnorrHW.init();" : `operation${i + 1}();`;
  return {
    id: i + 1,
    file: i < 48 ? "CashuApplet.java" : "SchnorrHW.java",
    statement,
    statementSha256: sha(statement),
  };
});
test("diagnostic decoder separates constructor completion from an installed fault report", () => {
  assert.equal(
    decode([1, 4, 48, 0, 0, 0], stages, 48).outcome,
    "constructor-complete",
  );
  assert.deepEqual(decode([1, 3, 49, 1, 0, 3], stages, 48), {
    outcome: "caught-constructor-fault",
    stage: 49,
    file: "SchnorrHW.java",
    operation: "operation49();",
    kind: "crypto",
    reason: 3,
  });
  assert.deepEqual(decode([1, 0, 0, 0, 0, 0], stages, 48, { opener: true }), {
    outcome: "fresh",
    stage: 0,
  });
  for (const data of [
    [1, 4, 49, 0, 0, 0],
    [1, 3, 0, 1, 0, 3],
    [1, 3, 65, 1, 0, 3],
    [1, 3, 49, 8, 0, 0],
    [1, 3, 49, 7, 0, 1],
    [1, 1, 49, 0, 0, 0],
    [1, 2, 49, 0, 0, 0],
    [2, 4, 48, 0, 0, 0],
    [],
  ])
    assert.throws(() => decode(data, stages, 48));
  assert.throws(() => decode([1, 3, 1, 1, 0, 3], stages, 48, { opener: true }));
  const altered = structuredClone(stages);
  altered[0].statement = "changed();";
  assert.throws(() => validateStages(altered, 48));
});
test(
  "every generated stage and bounded fault kind survives read-only diagnostic reselect in jCardSim",
  { skip: !process.env.CONSTRUCTOR_SIM_ARTIFACT },
  () => {
    const dir = path.resolve(process.env.CONSTRUCTOR_SIM_ARTIFACT),
      m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"))),
      program = JSON.parse(fs.readFileSync(path.join(dir, "stages.json")));
    assert.equal(m.kind, "constructor-trace-diagnostic-v1");
    const r = spawnSync(
      "java",
      [
        "-cp",
        path.join(dir, "sim-classes") +
          path.delimiter +
          path.resolve(__dirname, "../cardsim/target/cardsim.jar"),
        "ConstructorTraceHarness",
        String(m.stageCount),
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(r.status, 0, r.stderr);
    const rows = JSON.parse(
      r.stdout
        .split("\n")
        .find((s) => s.startsWith("CONSTRUCTOR_RESULT:"))
        .slice("CONSTRUCTOR_RESULT:".length),
    );
    assert.equal(rows.length, m.stageCount + 7);
    for (const row of rows) {
      const raw = [...Buffer.from(row.hex, "hex")];
      assert.deepEqual(raw.slice(-2), [0x90, 0]);
      const decoded = decode(raw.slice(0, -2), program, m.terminalStage);
      if (row.failureStage === 0)
        assert.equal(decoded.outcome, "constructor-complete");
      else {
        assert.equal(decoded.outcome, "caught-constructor-fault");
        assert.equal(decoded.stage, row.failureStage);
        assert.equal(
          decoded.kind,
          [
            "",
            "crypto",
            "system",
            "transaction",
            "iso",
            "pin",
            "card-runtime",
            "runtime",
          ][row.kind],
        );
      }
      if (row.failureStage < 2) assert.equal(row.retained, true);
    }
    // The fault hook is present only in the copied simulator source, never converted sources.
    const original = fs.readFileSync(
      path.join(dir, "src/me/flashapp/cashu/ConstructorTrace.java"),
      "utf8",
    );
    assert.ok(!original.includes("ConstructorFault"));
    assert.equal(sha(original), m.generatedSources["ConstructorTrace.java"]);
  },
);
test("artifact admission refuses dirty source and changed CAP/stage/source bytes", (t) => {
  const os = require("node:os"),
    { artifact } = require("./constructor-trace.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const src = path.join(root, "src/me/flashapp/cashu");
  fs.mkdirSync(src, { recursive: true });
  const names = [
    "CashuApplet.java",
    "ConstructorTrace.java",
    "Opener.java",
    "SchnorrHW.java",
    "Tag.java",
    "TagSwitch.java",
  ];
  const generatedSources = Object.fromEntries(
    names.map((n) => {
      fs.writeFileSync(path.join(src, n), n);
      return [n, sha(n)];
    }),
  );
  const stageRaw = JSON.stringify(stages);
  fs.writeFileSync(path.join(root, "stages.json"), stageRaw);
  fs.writeFileSync(path.join(root, "constructor-trace.cap"), "cap");
  fs.writeFileSync(path.join(root, "load-file.bin"), "load");
  const m = {
    kind: "constructor-trace-diagnostic-v1",
    format: 1,
    sourceCommit: "1".repeat(40),
    sourceDirty: false,
    packageAid: "F0434153485543545243",
    classShape: {
      declaredInstanceSize: 50,
      firstReferenceToken: 0,
      referenceCount: 50,
    },
    stageCount: 64,
    terminalStage: 48,
    stagesSha256: sha(stageRaw),
    generatedSources,
    capSha256: sha("cap"),
    loadFileSha256: sha("load"),
    loadFileSize: 4,
  };
  const manifest = path.join(root, "manifest.json");
  const write = (v) => {
    fs.writeFileSync(manifest, JSON.stringify(v));
    return { manifest, manifestHash: sha(fs.readFileSync(manifest)) };
  };
  assert.equal(artifact(write(m)).load.length, 4);
  assert.throws(
    () => artifact(write({ ...m, sourceDirty: true })),
    /profile-invalid/,
  );
  const options = write(m);
  for (const name of [
    "stages.json",
    "constructor-trace.cap",
    "src/me/flashapp/cashu/CashuApplet.java",
  ]) {
    const p = path.join(root, name),
      raw = fs.readFileSync(p);
    fs.appendFileSync(p, "changed");
    assert.throws(() => artifact(options));
    fs.writeFileSync(p, raw);
  }
});
