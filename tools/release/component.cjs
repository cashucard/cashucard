/** Component release identity, with no credentials and no network calls. */
const { readFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const version = "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
function parseTag(tag) {
  if (typeof tag !== "string" || /[\r\n]/.test(tag))
    throw Error("Invalid component tag");
  const match = new RegExp(
    `^(firmware|cardkit|ops|provisioner)-v(${version})(?:-build[.]([1-9][0-9]*))?$`,
  ).exec(tag);
  if (!match || (match[1] === "provisioner") !== !!match[6])
    throw Error(
      "Use a component version tag; provisioner tags also require -build.N",
    );
  return {
    component: match[1],
    version: match[2],
    ...(match[6] ? { build: Number(match[6]) } : {}),
    tag,
  };
}
function identity(root, tag) {
  const result = parseTag(tag),
    read = (file) => readFileSync(join(root, file), "utf8");
  const equal = (actual, expected) => {
    if (actual !== expected)
      throw Error("Component tag does not match committed release identity");
  };
  if (result.component === "firmware") {
    equal(
      /<artifactId>cashu-javacard<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(
        read("applet/pom.xml"),
      )?.[1],
      result.version,
    );
    if (
      !read("applet/build.xml").includes(`cashu-javacard-${result.version}.cap`)
    )
      throw Error("Firmware CAP path/version mismatch");
  } else {
    const path = {
      cardkit: "tools/cardkit",
      ops: "ops",
      provisioner: "apps/provisioner",
    }[result.component];
    const manifest = JSON.parse(read(`${path}/package.json`));
    equal(manifest.version, result.version);
    if (result.component === "provisioner") {
      equal(manifest.provisionerBuild, result.build);
      const android = read(`${path}/android/app/build.gradle`),
        ios = read(`${path}/ios/CashuProvisioner/Info.plist`);
      equal(/versionName\s+"([^"]+)"/.exec(android)?.[1], result.version);
      equal(Number(/versionCode\s+(\d+)/.exec(android)?.[1]), result.build);
      equal(
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
          ios,
        )?.[1],
        result.version,
      );
      const iosBuild =
        /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
          ios,
        )?.[1];
      if (iosBuild === "$(CURRENT_PROJECT_VERSION)") {
        const versions = [
          ...read(
            `${path}/ios/CashuProvisioner.xcodeproj/project.pbxproj`,
          ).matchAll(/CURRENT_PROJECT_VERSION\s*=\s*([0-9]+);/g),
        ].map((m) => Number(m[1]));
        if (
          !versions.length ||
          versions.some((build) => build !== result.build)
        )
          throw Error("Native iOS build settings do not match tag");
      } else {
        equal(Number(iosBuild), result.build);
      }
    }
  }
  return result;
}
function gitAt(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function resolveGit(root, tag) {
  parseTag(tag);
  const commit = gitAt(root, "rev-parse", `refs/tags/${tag}^{commit}`);
  gitAt(root, "merge-base", "--is-ancestor", commit, "origin/main");
  return commit;
}
function verifyGit(root, tag) {
  const commit = resolveGit(root, tag);
  if (commit !== gitAt(root, "rev-parse", "HEAD"))
    throw Error("Checkout must be the exact tagged commit");
  return commit;
}
module.exports = { parseTag, identity, resolveGit, verifyGit };

if (require.main === module) {
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  if (process.env.RELEASE_RESOLVE_TAG === "true") {
    if (process.env.GITHUB_ACTIONS !== "true")
      throw Error("Automatic checkout is restricted to the release runner");
    // This code is loaded from main before checking out any requested tag.
    const commit = resolveGit(process.cwd(), tag);
    gitAt(process.cwd(), "checkout", "--detach", commit);
  }
  const result = identity(process.cwd(), tag);
  result.commit = verifyGit(process.cwd(), tag);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  console.log(JSON.stringify(result));
}
