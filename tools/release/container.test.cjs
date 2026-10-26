const assert = require("node:assert/strict");
const test = require("node:test");
const {
  identity,
  assertUnused,
  assertPlatforms,
  versions,
} = require("./container.cjs");

test("only an exact ops component version can name an image", () => {
  assert.deepEqual(identity("CashuCard", "ops-v0.1.0"), {
    image: "ghcr.io/cashucard/ops-service",
    version: "0.1.0",
  });
  for (const tag of [
    "ops-v01.1.0",
    "provisioner-v1.0.0-build.12",
    "ops-v0.1.0\n",
  ])
    assert.throws(() => identity("cashucard", tag));
  assert.throws(() => identity("bad/owner", "ops-v0.1.0"));
});
test("an existing image version and ambiguous registry failures stop publication", () => {
  const pages = [[{ metadata: { container: { tags: ["0.1.0"] } } }]];
  assert.throws(() => assertUnused(pages, "0.1.0"));
  assert.doesNotThrow(() => assertUnused(pages, "0.2.0"));
  assert.throws(() => assertUnused([[{}]], "0.1.0"));
  assert.deepEqual(
    versions("cashucard", () => {
      throw { stderr: "HTTP 404" };
    }),
    [],
  );
  assert.throws(
    () =>
      versions("cashucard", (_command, args) => {
        if (args.includes("--paginate")) throw { stderr: "HTTP 404" };
        return JSON.stringify({
          name: "ops-service",
          package_type: "container",
        });
      }),
    "A later pagination error must not imply an empty registry",
  );
  for (const stderr of ["HTTP 403", "HTTP 500", "connection timed out"])
    assert.throws(() =>
      versions("cashucard", () => {
        throw { stderr };
      }),
    );
});
test("the published index must contain exactly AMD64 and ARM64 Linux payloads", () => {
  const manifest = (architecture) => ({
    platform: { os: "linux", architecture },
  });
  assert.doesNotThrow(() =>
    assertPlatforms({
      manifests: [
        manifest("arm64"),
        manifest("amd64"),
        { platform: { os: "unknown", architecture: "unknown" } },
      ],
    }),
  );
  for (const manifests of [
    [manifest("amd64")],
    [manifest("amd64"), manifest("amd64")],
    [],
  ])
    assert.throws(() => assertPlatforms({ manifests }));
});
