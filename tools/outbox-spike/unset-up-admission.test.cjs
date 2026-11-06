const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  template,
  admission,
  revalidate,
  hash,
  PLAN,
  ROOT,
  AUDIT,
} = require("./unset-up-admission.cjs");
const { runRecovery, createPrivate } = require("./recover-unset-up.cjs");
const { fixture } = require("./unset-up-test-support.cjs");
const { labSkip } = require("./lab-present.cjs");
// Admission rehashes the retained journals the audit pins; without them it
// refuses for that reason, not the one a test is about.
const lab = {
  skip: labSkip(
    JSON.parse(fs.readFileSync(path.join(ROOT, AUDIT), "utf8")).journals.map(
      (j) => j.path,
    ),
  ),
};
const { execFileSync } = require("node:child_process");
const python = execFileSync(
  "python3",
  ["-c", "import sys;print(sys.executable)"],
  { encoding: "utf8" },
).trim();
function campaign(t, approved = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unset-admission-"));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const journal = path.join(dir, "recover.json"),
    file = path.join(dir, "campaign.json");
  let clean = true,
    changed = false;
  const deps = {
    journalPath: journal,
    sourceInfo: () => ({ commit: "a".repeat(40), clean }),
    runtimeInfo: (python) => ({
      python,
      sitePackages: dir,
      files: {},
      sha256: changed ? "changed" : "b".repeat(64),
    }),
    approvalInfo: () => ({
      value: {
        approved,
        planSha256: hash(fs.readFileSync(path.join(ROOT, PLAN))),
      },
      sha256: "c".repeat(64),
    }),
  };
  const value = template(python, deps);
  createPrivate(file, Object.fromEntries(Object.entries(value).reverse()));
  const options = {
    campaign: file,
    sha256: hash(fs.readFileSync(file)),
    execute: true,
  };
  return {
    deps,
    options,
    journal,
    dirty: () => (clean = false),
    change: () => (changed = true),
  };
}
test(
  "admission accepts semantic fields independent of JSON key order and rechecks static pins after consumption",
  lab,
  (t) => {
    const c = campaign(t);
    assert.equal(admission(c.options, c.deps).p.journal, c.journal);
    createPrivate(c.journal + ".consumed", {});
    assert.throws(() => admission(c.options, c.deps), /consumed/);
    assert.doesNotThrow(() => revalidate(c.options, c.deps));
    c.change();
    assert.throws(() => revalidate(c.options, c.deps), /changed/);
  },
);
test("unapproved, changed campaign and dirty source refuse before device startup", async (t) => {
  for (const mode of ["unapproved", "changed", "dirty"]) {
    const c = campaign(t, mode !== "unapproved");
    if (mode === "changed") c.options.sha256 = "0".repeat(64);
    if (mode === "dirty") c.dirty();
    let opens = 0;
    await assert.rejects(
      runRecovery(c.options, {
        admission: (o) => admission(o, c.deps),
        openBridge: () => {
          opens++;
        },
      }),
    );
    assert.equal(opens, 0);
    assert.equal(fs.existsSync(c.journal + ".consumed"), false);
  }
});
test(
  "launcher revalidates after durable consumption and before lazy reader open",
  lab,
  async (t) => {
    const c = campaign(t);
    let checks = 0,
      opens = 0;
    const result = await runRecovery(c.options, {
      admission: (o) => admission(o, c.deps),
      revalidate: () => {
        checks++;
        throw Error("changed");
      },
      openBridge: () => {
        opens++;
      },
    });
    assert.equal(checks, 1);
    assert.equal(opens, 0);
    assert.equal(result.status, "stopped");
    assert.equal(result.commands, 1);
    assert.equal(result.blankBaselineVerified, false);
    assert.equal(fs.existsSync(c.journal + ".consumed"), true);
    await assert.rejects(
      runRecovery(c.options, { admission: (o) => admission(o, c.deps) }),
      /consumed/,
    );
  },
);
test(
  "full launcher uses durable one-shot journal and retains lease on uncertain startup or close",
  lab,
  async (t) => {
    for (const mode of ["success", "startup", "close", "incomplete-policy"]) {
      const c = campaign(t),
        f = fixture();
      let opens = 0;
      const result = await runRecovery(c.options, {
        admission: (o) => admission(o, c.deps),
        revalidate: (o) => revalidate(o, c.deps),
        sdk: f.args.sdk,
        openBridge: async () => {
          opens++;
          if (mode === "startup") {
            const e = Error("startup");
            e.closeUncertain = true;
            e.bridgePid = 12345;
            throw e;
          }
          return {
            pid: 12345,
            tx: f.args.tx,
            close: async () => {
              await f.args.close();
              if (mode === "close") throw Error("close");
              return { policyComplete: mode !== "incomplete-policy" };
            },
          };
        },
      });
      assert.equal(opens, 1);
      assert.equal(result.status, mode === "success" ? "complete" : "stopped");
      assert.equal(result.blankBaselineVerified, mode === "success");
      assert.equal(
        fs.existsSync(c.journal + ".lock"),
        ["startup", "close"].includes(mode),
      );
      assert.equal(fs.existsSync(c.journal + ".consumed"), true);
      const raw = fs.readFileSync(c.journal, "utf8");
      assert.equal(JSON.parse(raw).status, result.status);
      assert.ok(!raw.includes("cryptogram"));
    }
  },
);
