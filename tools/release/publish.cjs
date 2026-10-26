/** Publish new complete release assets; never overwrite an existing release. */
const { execFileSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { parseTag } = require("./component.cjs");
const gh = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
function publish({ tag, archive, root }, run = gh) {
  parseTag(tag);
  let release;
  try {
    release = JSON.parse(
      run(["release", "view", tag, "--json", "isDraft,tagName"]),
    );
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`;
    if (!/HTTP 404|release not found/i.test(message)) throw error;
  }
  if (release !== undefined) {
    if (release.tagName !== tag || typeof release.isDraft !== "boolean")
      throw Error("Unexpected existing release identity");
    if (release.isDraft)
      throw Error(
        `Incomplete draft ${tag} exists. Inspect its uploaded assets and publish it explicitly after verification, or remove the abandoned draft before retrying. Artifacts were not changed.`,
      );
    return "published";
  }
  const assets = [
    archive,
    join(root, "SHA256SUMS"),
    join(root, "release.json"),
    ...readdirSync(root)
      .filter(
        (name) => /\.(cap|tgz)$/.test(name) || name === "ops-container.json",
      )
      .map((name) => join(root, name)),
  ];
  run([
    "release",
    "create",
    tag,
    "--verify-tag",
    "--draft",
    "--generate-notes",
    "--latest=false",
    ...assets,
  ]);
  run(["release", "edit", tag, "--draft=false", "--latest=false"]);
  return "published";
}
module.exports = { publish };
if (require.main === module) {
  console.log(
    publish({
      tag: process.env.RELEASE_TAG,
      archive: process.argv[2],
      root: process.argv[3],
    }),
  );
}
