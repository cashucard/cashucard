const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const sdk = require("../cardkit");
const image = require("./pixel-07297620-create.json");
const { registryFrames } = require("./run-probe.cjs");
const {
  inspect,
  verifyPresence,
  admit,
  JOURNAL,
} = require("./inspect-07297620.cjs");
const { createPrivate } = require("./recover-unset-up.cjs");
const privateFrames = Object.fromEntries(
  image.installedPrivatePages.map((p) => [p.kind, registryFrames(p.data)]),
);
const { fixture } = require("./inspect-test-support.cjs");

for (const main of [false, true])
  test(`inspect reports main ${main ? "present" : "absent"} without selecting it`, async () => {
    const f = fixture({ main }),
      r = await inspect(f.args);
    assert.equal(r.status, "inspected");
    assert.equal(r.mainPresent, main);
    assert.equal(r.commands, 9);
    assert.equal(f.closes, 1);
    assert.equal(r.readerClosed, true);
    assert.equal(r.savedEvidenceVerified, true);
    assert.ok(
      f.sent.every((a) => [0xa4, 0xca, 0x50, 0x82, 0xf2].includes(a[1])),
    );
    assert.ok(
      f.sent
        .filter((a) => a[1] === 0xa4)
        .every((a) =>
          Buffer.from(a).equals(Buffer.from(sdk.selectAid(sdk.ISD_AID))),
        ),
    );
    assert.ok(
      !JSON.stringify(
        r.exchanges.filter((e) =>
          ["8050", "8482"].some((h) => e.header.startsWith(h)),
        ),
      ).includes("data"),
    );
  });
test("complete split registry still verifies both exact sets", async () => {
  const f = fixture({ main: true, split: true }),
    r = await inspect(f.args);
  assert.equal(r.status, "inspected");
  assert.equal(r.commands, 11);
});
for (const o of [
  { wrongChip: true },
  { wrongKeys: true },
  { missingBaseline: true },
  { missingOpener: true },
  { extra: true },
  { lost: true },
  { close: true },
  { policyIncomplete: true },
  { savedRefused: true },
  { storage: "match-chip" },
])
  test(`inspection stops conservatively ${JSON.stringify(o)}`, async () => {
    const f = fixture(o),
      r = await inspect(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(f.closes, 1);
    assert.ok(!JSON.stringify(r).includes("native private"));
    if (o.wrongChip) assert.equal(r.commands, 2);
    if (o.wrongKeys) assert.equal(r.commands, 4);
    if (o.storage) assert.equal(r.commands, 0);
  });
test("registry verifier rejects duplicate frames, changed fields and incomplete continuation", () => {
  const pages = [
    { kind: "applications", sw: "9000", data: privateFrames.applications[0] },
    {
      kind: "load-files",
      sw: "9000",
      data: image.baselinePages[1].data + privateFrames["load-files"][0],
    },
  ];
  assert.equal(verifyPresence(sdk, pages), false);
  for (const mutate of [
    (p) => (p[0].data += p[0].data),
    (p) => (p[0].data = p[0].data.replace("9f700107", "9f700101")),
    (p) => (p[1].sw = "6310"),
    (p) => p.push({ kind: "other", sw: "9000", data: "" }),
  ]) {
    const copy = structuredClone(pages);
    mutate(copy);
    assert.throws(() => verifyPresence(sdk, copy));
  }
});
test("execution approval is false and default preview cannot consume a journal", () => {
  const p = require("./inspect-07297620.json");
  const prior = p.approved;
  p.approved = false;
  assert.notEqual(JOURNAL, require("./readiness-07297620-v2.cjs").JOURNAL);
  // This must reject before checking source cleanliness or touching any device.
  try {
    assert.throws(
      () =>
        admit({
          execute: true,
          campaign: "/nonexistent",
          sha256: "0".repeat(64),
        }),
      /execution approval required/,
    );
  } finally {
    p.approved = prior;
  }
});
test("isolated saved evidence decoder replays receipts and rejects forged membership/order", async (t) => {
  const f = fixture({ main: true });
  assert.equal((await inspect(f.args)).status, "inspected");
  const value = f.saved.findLast((s) => s.stage === "verify-saved-evidence");
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspect-evidence-")),
  );
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [i, mutate] of [
    (v) => {},
    (v) => (v.mainPresent = false),
    (v) => (v.exchanges[0].header = "84e40000"),
    (v) => (v.pages[1].data = ""),
    (v) => (v.exchanges[5].data = ""),
  ].entries()) {
    const copy = structuredClone(value);
    mutate(copy);
    const file = path.join(root, `${i}.json`),
      sha = createPrivate(file, copy);
    const run = () =>
      JSON.parse(
        execFileSync(
          "python3",
          [
            "-I",
            "-S",
            "-B",
            path.join(__dirname, "inspect_07297620.py"),
            "--verify-journal",
            file,
            "--sha256",
            sha,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
    if (i === 0)
      assert.deepEqual(run(), {
        savedEvidenceVerified: true,
        mainPresent: true,
      });
    else assert.throws(run);
  }
});

test("exactly four pages per registry reaches the 15-command ceiling; no fifth page is sent", async () => {
  const f = fixture({ main: true, pages: 4 }),
    r = await inspect(f.args);
  assert.equal(r.status, "inspected");
  assert.equal(r.commands, 15);
  const bad = fixture({ pages: 4, endless: true }),
    stopped = await inspect(bad.args);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.failure, "registry-incomplete");
  assert.equal(bad.sent.filter((a) => a[1] === 0xf2).length, 4);
});
test("elapsed gate and missing/oversized replies stop without a subsequent transmit", async () => {
  for (const mode of ["elapsed", "short", "oversize"]) {
    const f = fixture();
    let clock = 0;
    const native = f.args.tx;
    f.args.now = () => clock;
    f.args.tx = async (a) => {
      const r = await native(a);
      if (mode === "elapsed") clock = 120000;
      return mode === "short"
        ? []
        : mode === "oversize"
          ? Array(259).fill(0)
          : r;
    };
    const r = await inspect(f.args);
    assert.equal(r.status, "stopped");
    assert.equal(f.sent.length, 1);
    assert.equal(f.closes, 1);
  }
});

test("expired inspection budget refuses before native child startup", async () => {
  const { openInspectionBridge } = require("./inspect-transport.cjs");
  await assert.rejects(
    openInspectionBridge({
      python: "/nonexistent-inspection-python",
      now: () => 120000,
      began: 0,
    }),
    { code: "elapsed-bound" },
  );
});
