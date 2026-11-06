#!/usr/bin/env node
// Turns one hardware observation into the offline work: parse the result line
// the lab app renders, name the code path that produced it, run the suite, and
// print the exact next action. It reads and runs; it never edits, commits or
// transmits. The editing rules are docs/HARDWARE-LOOP.md.
//
//   node tools/outbox-spike/hardware-observe.cjs "Stopped · installed-load-files-0" "135 commands" "registry-baseline"
//   node tools/outbox-spike/hardware-observe.cjs --file result.txt
//   node tools/outbox-spike/hardware-observe.cjs --file result.txt --no-suite
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SPIKE = path.join(ROOT, "tools/outbox-spike");
const CONTROL = path.join(SPIKE, "pixel-control.js");

// Where each classified failure is decided, and what a fixer should read first.
// A code missing here is reported as unmapped rather than guessed at.
const PATHS = {
  "registry-baseline":
    "verifyRegistry: a listed entry is neither an allowed private AID nor a BASELINE prefix",
  "registry-duplicate":
    "verifyRegistry: the platform load file appeared twice in one kind",
  "registry-objects":
    "entryAllowed: an allowed AID was listed with the wrong life cycle, load file or privileges",
  "registry-private-set":
    "verifyRegistry: the installed listing does not name exactly the allowed AIDs",
  "registry-framing":
    "registryFrames: the listing TLV framing disagrees with its parse",
  "registry-status":
    "registryPages: the card answered a registry page outside 9000/6310/6A88",
  "registry-incomplete": "registryPages: 16 pages without a terminating status",
  "diagnostics-uninitialized":
    "installForPhases: format-5 diagnostics did not read as uninitialized",
  "diagnostics-mismatch": "capacity profile: diagnostics counters out of range",
  "private-version":
    "installForPhases: the private instance's version is not 'C PROT 2'",
  "invalid-public-key":
    "installForPhases: the card's public key failed validation",
  "image-mismatch": "preflight: the loaded image digest differs from the pin",
  "factory-version-mismatch":
    "authenticate: the platform version is not the pinned one",
  "factory-keys-not-proved":
    "authenticate: the factory keys did not open the ISD",
  "absence-response":
    "installForPhases: a pre-install absence select answered with data",
  "load-block-count":
    "installForPhases: splitLoad disagrees with the pinned block count",
  "transport-uncertain":
    "raw/secure: the native call did not settle; no retry is allowed",
  "elapsed-bound": "raw: the run passed the elapsed gate",
  "command-bound": "raw: the command count passed its bound",
  "card-status": "raw: an unexpected status word",
  "unknown-plan": "runControl: the plan id is not one this build knows",
  "nfc-limits-unconfirmed":
    "preflight: the platform did not confirm NFC transceive limits",
  cancelled: "runControl: the operator or the app cancelled",
};

function parse(lines) {
  const text = lines.join("\n");
  const status = text.match(/^\s*(installed-for-phases|stopped)\b/im)?.[1];
  const commands = text.match(/(\d+)\s+commands/i)?.[1];
  const known = Object.keys(PATHS);
  const tokens = text.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g) ?? [];
  const failure = tokens.find((t) => known.includes(t));
  const stage = tokens.find(
    (t) =>
      t.includes("-") &&
      t !== failure &&
      t !== status &&
      !t.startsWith("phase-"),
  );
  return {
    status: status?.toLowerCase(),
    stage,
    commands: commands ? Number(commands) : undefined,
    failure,
    unmapped: tokens.filter(
      (t) => t.includes("-") && t !== stage && t !== failure,
    ),
  };
}

function locate(failure) {
  if (!failure) return null;
  const source = fs.readFileSync(CONTROL, "utf8").split("\n");
  const needle = `stop("${failure}")`;
  const hits = source
    .map((line, i) => (line.includes(needle) ? i + 1 : 0))
    .filter(Boolean);
  return { lines: hits, hint: PATHS[failure] };
}

function optionFor(failure, stage) {
  if (!stage || !failure) return undefined;
  const segment = stage.replace(/-\d+$/, "").split("-").slice(-2).join("-");
  if (failure.startsWith("registry-")) return `a wrong ${segment} listing`;
  if (failure.startsWith("diagnostics-"))
    return `a card whose diagnostics fail: ${segment}`;
  return undefined;
}

function main(argv) {
  const fileAt = argv.indexOf("--file");
  const suite = !argv.includes("--no-suite");
  let lines = argv.filter(
    (a, i) => a !== "--file" && i !== fileAt + 1 && a !== "--no-suite",
  );
  if (fileAt !== -1)
    lines = fs
      .readFileSync(argv[fileAt + 1], "utf8")
      .split("\n")
      .concat(lines);

  const seen = parse(lines);
  const out = [];
  out.push(`status  ${seen.status ?? "unread"}`);
  out.push(`stage   ${seen.stage ?? "unread"}`);
  out.push(`code    ${seen.failure ?? "unmapped"}`);
  if (seen.commands !== undefined) out.push(`commands ${seen.commands}`);
  if (seen.unmapped.length && !seen.failure)
    out.push(`unmapped tokens: ${seen.unmapped.join(", ")}`);

  const at = locate(seen.failure);
  if (at) {
    out.push(
      `decided at ${path.relative(ROOT, CONTROL)}:${at.lines.join(",")}`,
    );
    out.push(`reads     ${at.hint}`);
  }
  if (seen.status === "installed-for-phases") {
    out.push(
      "next      receipt run: export the journal, write the receipt, commit both",
    );
  } else if (seen.failure) {
    const opt = optionFor(seen.failure, seen.stage);
    out.push(
      `next      reproduce in pixel-test-support.cjs and assert status/failure/stage` +
        (opt ? ` (${opt})` : ""),
    );
  }
  console.log(out.join("\n"));

  if (!suite) return 0;
  const env = { ...process.env };
  delete env.MINT_URL;
  delete env.CARDSIM_URL;
  env.PATH = `/opt/homebrew/opt/node@22/bin:${env.PATH}`;
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      ...fs
        .readdirSync(SPIKE)
        .filter((f) => f.endsWith(".test.cjs"))
        .map((f) => path.join(SPIKE, f)),
    ],
    { cwd: ROOT, env, encoding: "utf8" },
  );
  const tail = (run.stdout ?? "")
    .split("\n")
    .filter((l) => /^ℹ (tests|pass|fail)/.test(l));
  console.log(`\nsuite\n${tail.join("\n")}`);
  if (run.status !== 0) {
    const failing = (run.stdout ?? "")
      .split("\n")
      .filter((l) => l.startsWith("✖"))
      .slice(0, 10);
    if (failing.length) console.log(failing.join("\n"));
  }
  return run.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
