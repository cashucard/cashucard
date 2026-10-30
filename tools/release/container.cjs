/** Immutable, versioned OCI publication alongside an ops component release. */
const { execFileSync } = require("node:child_process");
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { parseTag } = require("./component.cjs");

function identity(owner, tag) {
  const release = parseTag(tag);
  if (
    release.component !== "ops" ||
    !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner || "")
  )
    throw Error("An ops release and GitHub owner are required");
  return {
    image: `ghcr.io/${owner.toLowerCase()}/ops-service`,
    version: release.version,
  };
}
function assertUnused(pages, version) {
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw Error("Invalid registry response");
  for (const item of pages.flat()) {
    const tags = item?.metadata?.container?.tags;
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string"))
      throw Error("Invalid registry version");
    if (tags.includes(version))
      throw Error("Published image versions cannot be replaced");
  }
}
function assertPlatforms(index) {
  const actual = index?.manifests
    ?.filter((m) => m.platform?.os === "linux")
    .map((m) => m.platform.architecture)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(["amd64", "arm64"]))
    throw Error("Both Linux architectures are required");
}
function versions(owner, run = execFileSync) {
  const endpoint = `orgs/${owner}/packages/container/ops-service`;
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  let metadata;
  try {
    metadata = JSON.parse(run("gh", ["api", endpoint], options));
  } catch (error) {
    if (/HTTP 404/.test(String(error.stderr || ""))) return [];
    throw Error("Unable to verify registry package availability");
  }
  if (
    metadata?.name !== "ops-service" ||
    metadata?.package_type !== "container"
  )
    throw Error("Unexpected registry package");
  try {
    return JSON.parse(
      run("gh", ["api", "--paginate", "--slurp", `${endpoint}/versions`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    throw Error("Unable to verify registry version availability");
  }
}
module.exports = { identity, assertUnused, assertPlatforms, versions };
if (require.main === module) {
  const spec = identity(process.env.RELEASE_OWNER, process.env.RELEASE_TAG);
  if (process.argv[2] === "record") {
    assertPlatforms(JSON.parse(readFileSync(process.argv[3], "utf8")));
    if (
      !/^sha256:[a-f0-9]{64}$/.test(process.env.IMAGE_DIGEST || "") ||
      !/^[a-f0-9]{40}$/.test(process.env.RELEASE_COMMIT || "")
    )
      throw Error("Invalid OCI provenance");
    writeFileSync(
      process.argv[4],
      JSON.stringify(
        {
          ...spec,
          digest: process.env.IMAGE_DIGEST,
          commit: process.env.RELEASE_COMMIT,
          tag: process.env.RELEASE_TAG,
          platforms: ["linux/amd64", "linux/arm64"],
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    assertUnused(versions(process.env.RELEASE_OWNER), spec.version);
    if (!process.env.GITHUB_OUTPUT) throw Error("GITHUB_OUTPUT is required");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `image=${spec.image}\nversion=${spec.version}\n`,
    );
  }
}
