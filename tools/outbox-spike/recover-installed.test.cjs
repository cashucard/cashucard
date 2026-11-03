const test = require("node:test"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { recoverToBlank } = require("./recover-compact.cjs");
const { fixture, sdk, b } = require("./pixel-test-support.cjs");

const here = __dirname;
const python = path.join(here, "..", "cardctl", ".venv", "bin", "python");
const PACKAGE = require("./pixel-install.json").package;
const KEY = Buffer.from(
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "hex",
);

/** The read-key policy is a closed program: its refusals are the guarantee. */
function policy() {
  return execFileSync(
    python,
    [
      "-c",
      `import sys,json
sys.path.insert(0, sys.argv[1])
import recovery_key_bridge as r
p = r.Policy()
out = []
def step(name, frame):
    try:
        p.before(list(bytes.fromhex(frame))); out.append([name, 'admitted'])
    except ValueError as e:
        out.append([name, str(e)])
# Out of order first: this card answers CPLC only from the ISD applet, so the
# frames that matter are refused before the select and admitted after it.
step('cplc-before-isd', r.CPLC.hex())
step('isd', r.SELECT_ISD.hex())
p.after(r.SELECT_ISD, bytes.fromhex('6f108408a000000151000000a5049f6501ff'), 0x90, 0)
step('cplc', r.CPLC.hex())
step('select', r.SELECT.hex())
p.after(r.SELECT, b'CPROT\\x02', 0x90, 0)
step('key', r.KEY.hex())
for name, frame in [('delete', '84e400000d4f0bf04341534855434d50544d00'),
                    ('status', 'b076000000'), ('diagnostics', 'b07d000000'),
                    ('auth', '8050010000080000000000000000')]:
    step(name, frame)
step('key-again', r.KEY.hex())
step('past-budget', r.CPLC.hex())
print(json.dumps(out))`,
      here,
    ],
    { encoding: "utf8" },
  );
}

test("the read-key policy admits one ordered pass and nothing else", () => {
  const steps = JSON.parse(policy());
  const by = Object.fromEntries(steps);
  // Each of these is a frame the pass really sends, refused at the point
  // where it would be wrong: the CPLC before the applet it needs is selected,
  // and any frame after the pass's bounded budget is spent.
  assert.equal(by["cplc-before-isd"], "security domain not selected");
  assert.equal(by.isd, "admitted");
  assert.equal(by.cplc, "admitted");
  assert.equal(by.select, "admitted");
  assert.equal(by.key, "admitted");
  assert.equal(by["key-again"], "admitted");
  for (const frame of ["delete", "status", "diagnostics", "auth"])
    assert.equal(by[frame], "read-only command refused", frame);
  // The budget is spent by the real pass, so a card that keeps answering
  // cannot keep the reader open past its one pass.
  assert.equal(by["past-budget"], "read stopped");
});

test("the launcher's pinned frames are the ones the read policy admits", () => {
  const launcher = require("./recover-installed.cjs");
  const { KEY_READ } = launcher;
  // Both programs spell the three frames independently; a drift between them
  // would be caught only at the reader, so it is caught here instead.
  const approved = execFileSync(
    python,
    [
      "-c",
      `import sys,json
sys.path.insert(0, sys.argv[1])
import recovery_key_bridge as r
print(json.dumps({'chip': r.CPLC.hex(), 'select': r.SELECT.hex(), 'key': r.KEY.hex(),
                  'flow_select': r.common.select(r.b.PRIVATE[0]).hex()}))`,
      here,
    ],
    { encoding: "utf8" },
  );
  const policy = JSON.parse(approved);
  const hex = (bytes) => Buffer.from(bytes).toString("hex");
  assert.equal(hex(KEY_READ.chip), policy.chip);
  assert.equal(hex(KEY_READ.select), policy.select);
  assert.equal(hex(KEY_READ.key), policy.key);
});

test("the installed flow deletes exactly the two instance AIDs and verifies blank", async () => {
  const f = fixture({
    mode: "phase-install",
    pins: require("./pixel-install.json"),
  });
  const installed = [PACKAGE + "4D", PACKAGE + "01"];
  f.card.packages.set(PACKAGE, {
    aid: PACKAGE,
    modules: installed,
    size: 27343,
    instancesMade: 2,
  });
  for (const aid of installed)
    f.card.instances.set(aid, {
      aid,
      module: aid,
      pkg: PACKAGE,
      state: { unspent: 0, spent: 0, pin: 0, record: 0, owner: 0 },
    });
  const original = f.args.tx;
  const r = await recoverToBlank({
    sdk,
    installed: true,
    expectedKey: KEY.toString("hex"),
    now: () => 0,
    random: (n) => Array.from({ length: n }, (_, i) => i),
    independentVerify: () => true,
    save: async () => {},
    tx: async (apdu) => {
      const reply = await original(apdu);
      // The reply this card actually gives: the install stopped before SETUP,
      // so the applet has no pool, no DLEQ and ready state 0.
      if (apdu[0] === 0xb0 && apdu[1] === 0x7d)
        return [...b("7fff0a0e0a0014001400000000000005"), 0x90, 0];
      if (apdu[0] === 0xb0 && apdu[1] === 0x7a) return [...KEY, 0x90, 0];
      // The installed card's applet has no signable record: its status, scope
      // and export answers are the flow's other branch, exercised elsewhere.
      // This test is about which frames can be deleted, not about recovering.
      if (apdu[0] === 0xb0 && apdu[1] === 0x76)
        return [64, 90, 128, 0, 0, 0, 0x90, 0];
      if (apdu[0] === 0xb0 && apdu[1] === 0x7c) return [0x69, 0x85];
      return reply;
    },
  });
  assert.equal(r.status, "complete", JSON.stringify(r.failure));
  assert.equal(r.blankBaselineVerified, true);
  // Each deletion is a secure frame wrapping `4F <len> <aid>` with an 8-byte
  // MAC and Le: `84 E4 00 00 Lc 4F len aid …`.
  const deleted = f.sent
    .filter((a) => a[1] === 0xe4)
    .map((a) => Buffer.from(a.slice(7, 7 + a[6])).toString("hex"));
  assert.deepEqual(
    deleted,
    installed.map((aid) => aid.toLowerCase()),
  );
  assert.ok(
    f.sent.filter((a) => a[1] === 0xe4).every((a) => a[0] === 0x84),
    "the bridge admits deletions only as secure frames",
  );
  assert.ok(r.registrySnapshots.at(-1).verified, "the blank listing verified");
});

test("the chip id the launcher pins is the one the SDK parses", () => {
  const live = Buffer.from(
    // Captured from this card through the bridge on 2026-11-03: the 45-byte
    // 9F7F TLV alone, status bytes stripped by the transceiver.
    "9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000",
    "hex",
  );
  const launcher = require("./recover-installed.cjs");
  // The launcher derives the id through the SDK, so a card whose CPLC is
  // shaped like this one is this chip and no other. Slicing the bytes by hand
  // produced a different id, and recovery matches on this id.
  assert.equal(
    require("./pixel-test-support.cjs").sdk.parseCplc(live).id,
    launcher.chip,
  );
});

test("the flow's stamped plan is the one the launcher accounts for", async () => {
  const launcher = require("./recover-installed.cjs");
  const f = fixture({
    mode: "phase-install",
    pins: require("./pixel-install.json"),
  });
  const r = await recoverToBlank({ ...f.args, installed: true });
  // The launcher pins a plan id; the flow stamps its own. A drift between the
  // two would make every journal look like another plan's work.
  assert.equal(r.plan, launcher.flowPlan);
  // The launcher runs this flow with a fixed profile, so the plan it accounts
  // for is the one a real run stamps, not a second guess at the name.
  assert.equal(r.plan, "compact-optimized-sign-recovery-v1");
});
