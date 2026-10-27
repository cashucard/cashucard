const test = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("resource probe preserves install demand and isolates its build and commands", () => {
  execFileSync("python3", [path.join(__dirname, "test_probe.py")], {
    stdio: "pipe",
  });
});

test("resource bridge permits private probe operations and refuses key/production mutation", () => {
  execFileSync("python3", [path.join(__dirname, "test_bridge.py")], {
    stdio: "pipe",
  });
});
