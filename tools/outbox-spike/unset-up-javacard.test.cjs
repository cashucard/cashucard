/* Optional real JavaCard logic with synthetic CPLC/GlobalPlatform. No hardware. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const { cleanupUnsetUp } = require("./unset-up-recovery.cjs");
const { fixture } = require("./unset-up-test-support.cjs");
test(
  "actual unset-up JavaCard replies complete cleanup without initialized status commands",
  { skip: !process.env.UNSET_SIM_ARTIFACT },
  async () => {
    const artifact = path.resolve(process.env.UNSET_SIM_ARTIFACT);
    const root = path.resolve(__dirname, "../..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(artifact, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.kind, "compact-javacard-prototype");
    const frames = [
      "00a404000bf04341534855434d50540100",
      "b07d000000",
      "b07a000000",
      "b076000000",
      "b07c0000010000",
    ];
    const run = spawnSync(
      "java",
      [
        "-cp",
        path.join(artifact, "sim-classes") +
          path.delimiter +
          path.join(root, "tools/cardsim/target/cardsim.jar"),
        "CompactHarness",
      ],
      {
        input: JSON.stringify({ steps: frames }) + "\n",
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const replies = JSON.parse(
      run.stdout
        .split("\n")
        .find((s) => s.startsWith("COMPACT_RESULT:"))
        .slice(15),
    ).map((r) => [...Buffer.from(r.hex, "hex")]);
    assert.deepEqual(
      replies.map((r) => Buffer.from(r.slice(-2)).toString("hex")),
      ["9000", "9000", "9000", "6985", "6985"],
    );
    const expectedKey = Buffer.from(replies[2].slice(0, -2)).toString("hex");
    const f = fixture(),
      exchanges = [];
    let privateIndex = 0;
    const result = await cleanupUnsetUp({
      ...f.args,
      expectedKey,
      tx: async (a) => {
        const fallback = await f.args.tx(a);
        const hex = Buffer.from(a).toString("hex");
        const index = frames.indexOf(hex);
        if (a[0] === 0xb0 || index === 0) {
          assert.equal(index, privateIndex++);
          exchanges.push({ apdu: a, reply: replies[index] });
          return replies[index];
        }
        exchanges.push({ apdu: a, reply: fallback });
        return fallback;
      },
    });
    assert.equal(result.status, "complete", JSON.stringify(result));
    assert.equal(privateIndex, 3);
    assert.deepEqual(
      result.deleted,
      require("./unset-up-profile.json").deletionAids,
    );
    const policy = JSON.parse(
      execFileSync(
        "python3",
        [
          "-B",
          "-c",
          "import sys,json;sys.path.insert(0,sys.argv[1]);from unset_up_policy import UnsetUpPolicy;p=UnsetUpPolicy(bytes.fromhex(sys.argv[2]));v=json.load(sys.stdin);[(p.before(e['apdu']),p.after(bytes(e['apdu']),e['reply'][:-2],*e['reply'][-2:])) for e in v];print(json.dumps({'complete':p.complete}))",
          __dirname,
          expectedKey,
        ],
        { input: JSON.stringify(exchanges), encoding: "utf8" },
      ),
    );
    assert.equal(policy.complete, true);
  },
);
