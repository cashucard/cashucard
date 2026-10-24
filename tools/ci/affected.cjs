const { execFileSync } = require("node:child_process");
const { appendFileSync, readFileSync } = require("node:fs");

const JOBS = [
  "test",
  "cardsim",
  "cardctl",
  "e2e-tools",
  "tools",
  "cap",
  "cardkit",
  "ops",
  "provisioner",
  "backup-copy",
  "backup-roundtrip",
  "website",
  "android",
];

/** Conservative allowlist: new source locations run everything until classified. */
function classify(files) {
  const selected = new Set();
  let full = files === null;
  for (const file of files || []) {
    if (
      typeof file !== "string" ||
      file.startsWith("/") ||
      file.split("/").includes("..")
    ) {
      full = true;
      continue;
    }
    if (/^(tools\/cardkit|apps\/provisioner|ops)\/README\.md$/.test(file))
      continue;
    if (
      /^(spec\/|applet\/|tools\/cardkit\/|tools\/ci\/|tools\/release\/|\.github\/)/.test(
        file,
      )
    ) {
      full = true;
      continue;
    }
    if (file === "docs/HARDWARE_DEPLOYMENT.md") {
      full = true;
      continue;
    }
    if (
      /^docs\//.test(file) ||
      /^(README\.md|AGENTS\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|\.gitignore|\.gitattributes)$/.test(
        file,
      )
    )
      continue;
    if (file.startsWith("website/")) {
      selected.add("website");
      if (/^website\/dist\/guide\.(html|md)$/.test(file)) selected.add("cap");
      continue;
    }
    if (file.startsWith("tools/backup-copy/")) {
      selected.add("backup-copy");
      selected.add("backup-roundtrip");
      continue;
    }
    if (file.startsWith("tools/cardsim/")) {
      selected.add("cardsim");
      selected.add("e2e-tools");
      continue;
    }
    if (file.startsWith("tools/cardctl/")) {
      selected.add("cardctl");
      continue;
    }
    if (/^tools\/mirror-spec/.test(file)) {
      selected.add("tools");
      continue;
    }
    if (/^tools\/[^/]+\.(cjs|mjs)$/.test(file)) {
      selected.add("e2e-tools");
      continue;
    }
    if (
      /^(apps\/provisioner\/__tests__|ops\/test)\/.*(recovery|journal|workspace|reset|provisioning|cardkit)/i.test(
        file,
      )
    ) {
      full = true;
      continue;
    }
    if (file.startsWith("ops/")) {
      if (
        /^ops\/src\/operator-admin-(client|page|icons)/.test(file) ||
        /^ops\/(test\/|README\.md$)/.test(file)
      )
        selected.add("ops");
      else full = true; // Auth, escrow, admission, schema and recovery are shared contracts.
      continue;
    }
    if (
      /^apps\/provisioner\/src\/screens\/(ResetCardScreen|ProvisioningScreen|CardsHomeScreen|CardStatusScreen)\.tsx$/.test(
        file,
      )
    ) {
      full = true;
      continue;
    }
    if (file.startsWith("apps/provisioner/")) {
      selected.add("provisioner");
      if (
        /^apps\/provisioner\/(src\/(screens|ui|components)\/|src\/(copy|theme)\.ts$|__tests__\/|README\.md$|assets\/)/.test(
          file,
        )
      )
        continue;
      if (
        /^apps\/provisioner\/(android\/|ios\/|scripts\/|fastlane\/|package\.json$|yarn\.lock$|metro\.config\.js$|jest|babel|tsconfig|\.eslintrc|Gemfile)/.test(
          file,
        )
      ) {
        selected.add("android");
        continue;
      }
      full = true; // New orchestration/persistence/API files must never silently skip integration.
      continue;
    }
    full = true;
  }
  return {
    full,
    selected: full ? [...JOBS] : JOBS.filter((job) => selected.has(job)),
  };
}

/** Both sides of renames/deletions matter. Missing history requests the full suite. */
function changedFiles(cwd, base, head, mode = "pull_request") {
  const sha = /^[a-f0-9]{40,64}$/i;
  if (!sha.test(base || "") || !sha.test(head || "") || /^0+$/.test(base))
    return null;
  try {
    return execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        `${base}${mode === "push" ? ".." : "..."}${head}`,
        "--",
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const forced =
    process.env.CI_FULL === "true" ||
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const files = forced
    ? null
    : changedFiles(
        process.cwd(),
        event.pull_request?.base?.sha || event.before,
        event.pull_request?.head?.sha || event.after,
        event.pull_request ? "pull_request" : "push",
      );
  const result = classify(files);
  const outputs = {
    selected: JSON.stringify(result.selected),
    full: String(result.full),
  };
  for (const job of JOBS)
    outputs[job.replaceAll("-", "_")] = String(result.selected.includes(job));
  if (!process.env.GITHUB_OUTPUT) throw Error("GITHUB_OUTPUT is required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  console.log(
    result.full
      ? "Full integration verification selected."
      : `Selected jobs: ${result.selected.join(", ") || "policy and CI gate only"}`,
  );
}
module.exports = { JOBS, classify, changedFiles };
if (require.main === module) run();
