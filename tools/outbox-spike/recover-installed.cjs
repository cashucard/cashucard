#!/usr/bin/env node
/**
 * Operator launcher for returning the stopped card 09336320 to factory blank.
 *
 * Plan: docs/reports/HARDWARE_PLAN_2026-11-02.recover-installed.md
 * (`recover-installed-v1`). Two reader passes, both pinned here:
 *
 *   --read-key   match the chip, SELECT the package, read INS 7A. Nothing else.
 *   --recover    the cleanup to blank, with --expected-key from the pass above.
 *
 * Neither pass decides for itself what the card may be asked: the frames go
 * through `compact_recovery_bridge.py`, the independent policy, which admits
 * only the recovery command set and refuses everything else. The host flow
 * (`recover-compact.cjs`) then checks the same frames again against the plan
 * it is running, so a keyboard slip in either place stops the run.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { parseArgs } = require("node:util");
const { createInterface } = require("node:readline");
let loaded = null;
/** The SDK, from the absolute copy named on the command line. Never guessed. */
function cardkit(module) {
  if (!module || !path.isAbsolute(module))
    throw new Error("the absolute cardkit module path is required");
  return (loaded ??= require(module));
}

const here = __dirname;
const READER = "ACS ACR122U PICC Interface";
const CHIP = "cplc-v1:4790d3213041093363205547";
const PLAN = "recover-installed-v1";
/** The run name `recoverToBlank` stamps into the state it saves. */
const FLOW_PLAN = "compact-optimized-sign-recovery-v1";
const KEY_RESPONSE = /^(02|03)[0-9a-f]{64}$/;
// The three frames pass A may send, spelled out here as well as in
// recovery_key_bridge.py: the launcher and the policy must agree, and a
// mismatch in either direction is a stop.
const KEY_READ = {
  // This card answers CPLC only from the ISD applet, so the pass opens there.
  domain: [
    0x00, 0xa4, 0x04, 0x00, 0x08, 0xa0, 0x00, 0x00, 0x01, 0x51, 0x00, 0x00,
    0x00, 0x00,
  ],
  chip: [0x80, 0xca, 0x9f, 0x7f, 0x00],
  select: [
    0x00, 0xa4, 0x04, 0x00, 0x0b, 0xf0, 0x43, 0x41, 0x53, 0x48, 0x55, 0x43,
    0x4d, 0x50, 0x54, 0x01, 0x00,
  ],
  key: [0xb0, 0x7a, 0x00, 0x00, 0x00],
};

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/** A journal is a fresh private file in a private directory; it is never reused. */
function privateJournal(target) {
  if (!path.isAbsolute(target)) throw new Error("journal-path-not-absolute");
  const directory = fs.lstatSync(path.dirname(target));
  if (
    !directory.isDirectory() ||
    (directory.mode & 0o077) !== 0 ||
    directory.uid !== process.getuid()
  )
    throw new Error("journal-directory-not-private");
  if (fs.existsSync(target)) throw new Error("journal-exists");
  const fd = fs.openSync(target, "wx", 0o600);
  fs.closeSync(fd);
}

/**
 * Bridges the policy process. The request is the frame only: the policy assigns
 * no meaning to a stage name, so none is sent.
 */
async function bridge({ python, script, expectedKey }) {
  const child = spawn(
    python,
    [
      "-u",
      path.join(here, script),
      "--reader",
      READER,
      ...(expectedKey ? ["--expected-key", expectedKey] : []),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  const next = async () => {
    const { value, done } = await iterator.next();
    if (done) throw new Error("bridge-closed:" + errors.trim().slice(0, 200));
    return JSON.parse(value);
  };
  let busy = false;
  const ready = await next();
  if (ready.ready !== true) throw new Error("bridge-not-ready");
  return {
    async tx(apdu) {
      if (busy) throw new Error("bridge-busy");
      busy = true;
      try {
        child.stdin.write(JSON.stringify({ apdu: [...apdu] }) + "\n");
        const { reply } = await next();
        if (!Array.isArray(reply) || reply.length < 2)
          throw new Error("bridge-protocol-error");
        return reply;
      } finally {
        busy = false;
      }
    },
    async close() {
      lines.close();
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

/** Pass A: the key the card reports now. Read-only, no authentication. */
async function readKey({ tx, journal, cardkit: module }) {
  const entry = { plan: PLAN, pass: "read-key", chip: CHIP, transcript: [] };
  const save = () =>
    fs.writeFileSync(journal, JSON.stringify(entry, null, 2) + "\n", {
      mode: 0o600,
    });
  const send = async (name, apdu, codes) => {
    entry.transcript.push({ name, frame: Buffer.from(apdu).toString("hex") });
    save();
    const reply = await tx(apdu);
    const sw = ((reply.at(-2) << 8) | reply.at(-1))
      .toString(16)
      .padStart(4, "0");
    entry.transcript.at(-1).sw = sw;
    entry.transcript.at(-1).data = Buffer.from(reply.slice(0, -2)).toString(
      "hex",
    );
    save();
    if (!codes.includes(sw)) throw new Error(name + "-status-" + sw);
    return reply;
  };
  try {
    const isd = await send("select-isd", KEY_READ.domain, ["9000"]);
    if (Buffer.from(isd.slice(0, -2))[0] !== 0x6f)
      throw new Error("isd-response-mismatch");
    const cplc = await send("cplc", KEY_READ.chip, ["9000"]);
    // The id is the SDK's, not a second opinion: a slice here and a parse
    // there could disagree, and it is the SDK's id the recovery flow matches.
    const identity = cardkit(module).parseCplc(
      Buffer.from(cplc.slice(0, -2)),
    ).id;
    if (identity !== CHIP) throw new Error("wrong-chip:" + identity);
    entry.chip = identity;
    const select = await send("select", KEY_READ.select, ["9000"]);
    const prot = Buffer.from(select.slice(0, -2)).toString("latin1");
    if (prot !== "CPROT\u0002") throw new Error("select-response-mismatch");
    const key = await send("read-public-key", KEY_READ.key, ["9000"]);
    entry.key = Buffer.from(key.slice(0, -2)).toString("hex");
    if (!KEY_RESPONSE.test(entry.key)) throw new Error("key-invalid");
    // A second read costs nothing and proves the card is not answering with
    // something that changes; a card that does change stops the plan.
    const again = await send("read-public-key-again", KEY_READ.key, ["9000"]);
    if (Buffer.from(again.slice(0, -2)).toString("hex") !== entry.key)
      throw new Error("key-unstable");
    entry.status = "complete";
    save();
    return entry;
  } catch (error) {
    entry.status = "stopped";
    entry.failure = String(error.message);
    save();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      python: { type: "string" },
      cardkit: { type: "string" },
      journal: { type: "string" },
      "expected-key": { type: "string" },
      "read-key": { type: "boolean", default: false },
      recover: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const passes = [values["read-key"], values.recover].filter(Boolean).length;
  if (passes !== 1)
    throw new Error("exactly one pass (--read-key or --recover) is required");
  if (!values.journal || !path.isAbsolute(values.journal))
    throw new Error("an absolute journal path is required");
  const pins = {
    plan: PLAN,
    chip: CHIP,
    reader: READER,
    source: {
      launcher: sha256(__filename),
      flow: sha256(path.join(here, "recover-compact.cjs")),
      policy: sha256(
        path.join(
          here,
          values["read-key"]
            ? "recovery_key_bridge.py"
            : "compact_recovery_bridge.py",
        ),
      ),
      bridge: sha256(path.join(here, "compact_bridge.py")),
    },
  };
  if (values["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          ...pins,
          pass: values.recover ? "recover" : "read-key",
          cardAccessed: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.python || !path.isAbsolute(values.python))
    throw new Error("an absolute Python path is required");
  if (values.recover && !KEY_RESPONSE.test(values["expected-key"] ?? ""))
    throw new Error("--expected-key from the read-key pass is required");
  if (values["read-key"] && values["expected-key"])
    throw new Error("the read-key pass takes no expected key");
  privateJournal(values.journal);
  const opened = await bridge({
    python: values.python,
    script: values["read-key"]
      ? "recovery_key_bridge.py"
      : "compact_recovery_bridge.py",
    expectedKey: values.recover ? values["expected-key"] : undefined,
  });
  try {
    if (values["read-key"]) {
      const entry = await readKey({
        tx: opened.tx,
        journal: values.journal,
        cardkit: values.cardkit,
      });
      console.log(JSON.stringify({ ...pins, ...entry }, null, 2));
      return;
    }
    const {
      recoverToBlank,
      verifyIndependent,
    } = require("./recover-compact.cjs");
    const sdk = cardkit(values.cardkit);
    const entry = await recoverToBlank({
      sdk,
      tx: opened.tx,
      save: (state) =>
        fs.writeFileSync(
          values.journal,
          JSON.stringify({ ...pins, ...state }, null, 2) + "\n",
          { mode: 0o600 },
        ),
      now: () => Date.now(),
      expectedKey: values["expected-key"],
      independentVerify: (key, packet, verified) =>
        verifyIndependent(values.python, key, packet, verified),
      installed: true,
    });
    // The flow names its own run. It must be this plan's, or the bytes this
    // launcher pins are not the bytes that produced the journal.
    if (entry.plan !== FLOW_PLAN)
      throw new Error("flow-plan-mismatch:" + entry.plan);
    console.log(JSON.stringify({ ...pins, ...entry }, null, 2));
    if (entry.status !== "complete") process.exitCode = 1;
  } finally {
    await opened.close();
  }
}

module.exports = {
  KEY_READ,
  KEY_RESPONSE,
  plan: PLAN,
  flowPlan: FLOW_PLAN,
  chip: CHIP,
  reader: READER,
};

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
