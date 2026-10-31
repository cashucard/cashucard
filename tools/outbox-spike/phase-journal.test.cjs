const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { withPhaseJournal } = require("./phase-journal.cjs");
test("a private file journal survives restart and excludes concurrent writers", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cashucard-phase-"));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, "journal.json");
  let oldSave;
  try {
    await withPhaseJournal(
      file,
      { intent: null },
      async ({ journal, save }) => {
        oldSave = save;
        assert.equal(journal.intent, null);
        await save({ intent: { frame: "b074000000" } });
        await assert.rejects(
          withPhaseJournal(file, null, async () =>
            assert.fail("second writer"),
          ),
          /EEXIST/,
        );
      },
    );
    await assert.rejects(oldSave({ intent: null }), /lease-closed/);
    await withPhaseJournal(file, null, async ({ journal }) =>
      assert.equal(journal.intent.frame, "b074000000"),
    );
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(root), ["journal.json"]);
    // A lock left by an interrupted process is retained for reviewed recovery.
    fs.writeFileSync(file + ".lock", "", { mode: 0o600 });
    await assert.rejects(
      withPhaseJournal(file, null, async () =>
        assert.fail("stale lock bypass"),
      ),
      /EEXIST/,
    );
    assert.ok(fs.existsSync(file + ".lock"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("unsafe storage and malformed evidence fail before the execution callback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cashucard-phase-"));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, "journal.json"),
    other = path.join(root, "other");
  try {
    fs.writeFileSync(other, "{}", { mode: 0o600 });
    fs.symlinkSync(other, file);
    await assert.rejects(
      withPhaseJournal(file, null, async () => assert.fail("symlink")),
      /private-journal/,
    );
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(root, "missing"), file);
    await assert.rejects(
      withPhaseJournal(file, {}, async () => assert.fail("dangling symlink")),
      /private-journal/,
    );
    fs.unlinkSync(file);
    fs.linkSync(other, file);
    await assert.rejects(
      withPhaseJournal(file, null, async () => assert.fail("hardlink")),
      /private-journal/,
    );
    fs.unlinkSync(file);
    fs.writeFileSync(file, "{", { mode: 0o600 });
    await assert.rejects(
      withPhaseJournal(file, null, async () => assert.fail("bad JSON")),
      SyntaxError,
    );
    fs.chmodSync(root, 0o755);
    await assert.rejects(
      withPhaseJournal(file, {}, async () => assert.fail("public storage")),
      /private-directory/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
