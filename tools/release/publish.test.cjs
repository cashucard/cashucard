const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { publish } = require("./publish.cjs");
test("an ops release attaches its immutable image descriptor", () => {
  const root = mkdtempSync(join(tmpdir(), "cashu-ops-publish-"));
  try {
    for (const name of ["SHA256SUMS", "release.json", "ops-container.json"])
      writeFileSync(join(root, name), "fixture");
    const calls = [];
    publish(
      { tag: "ops-v0.1.0", archive: join(root, "ops.tar.gz"), root },
      (args) => {
        calls.push(args);
        if (args[1] === "view") throw Error("HTTP 404");
        return "";
      },
    );
    assert.ok(
      calls
        .find((args) => args[1] === "create")
        .includes(join(root, "ops-container.json")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("an interrupted draft cannot produce a successful published release on retry", () => {
  const calls = [],
    root = mkdtempSync(join(tmpdir(), "cashu-publish-"));
  try {
    const view = (args) => {
      calls.push(args);
      return JSON.stringify({ isDraft: true, tagName: "ops-v0.1.0" });
    };
    assert.throws(
      () =>
        publish(
          { tag: "ops-v0.1.0", archive: join(root, "ops.tar.gz"), root },
          view,
        ),
      /draft/i,
    );
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a completed published release is retained without any upload or edit", () => {
  const calls = [];
  const state = publish(
    { tag: "ops-v0.1.0", archive: "unused", root: "unused" },
    (args) => {
      calls.push(args);
      return JSON.stringify({ isDraft: false, tagName: "ops-v0.1.0" });
    },
  );
  assert.equal(state, "published");
  assert.equal(calls.length, 1);
});
test("a fresh release uploads every asset before publishing; failed publication is not swallowed", () => {
  const root = mkdtempSync(join(tmpdir(), "cashu-publish-"));
  try {
    for (const file of [
      "SHA256SUMS",
      "release.json",
      "cashu-javacard-2.1.0.cap",
    ])
      writeFileSync(join(root, file), "fixture");
    const calls = [];
    const run = (args) => {
      calls.push(args);
      if (args[1] === "view") {
        throw new Error("HTTP 404: Not Found");
      }
      return "";
    };
    assert.equal(
      publish(
        {
          tag: "firmware-v2.1.0",
          archive: join(root, "firmware.tar.gz"),
          root,
        },
        run,
      ),
      "published",
    );
    const create = calls.find((args) => args[1] === "create");
    assert.ok(create.includes("--draft"));
    assert.ok(create.includes(join(root, "cashu-javacard-2.1.0.cap")));
    assert.equal(calls.at(-1)[1], "edit");
    assert.throws(
      () =>
        publish(
          {
            tag: "firmware-v2.1.0",
            archive: join(root, "firmware.tar.gz"),
            root,
          },
          (args) => {
            if (args[1] === "edit") throw new Error("network unavailable");
            return run(args);
          },
        ),
      /network unavailable/,
    );
    assert.throws(
      () =>
        publish({ tag: "firmware-v2.1.0", archive: "unused", root }, () => {
          throw new Error("HTTP 503");
        }),
      /503/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
