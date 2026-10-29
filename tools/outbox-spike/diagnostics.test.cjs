const test = require("node:test");
const assert = require("node:assert/strict");
const sdk = require("../cardkit");
const { ProbeFailure, failureEvidence } = require("./run-probe.cjs");

test("SDK transport wrappers preserve only validated bridge diagnostics", () => {
  const cause = new ProbeFailure("reader-transmit-failed");
  cause.pcscCode = "80100016";
  assert.deepEqual(
    failureEvidence(new sdk.TransportError("private native text", cause), sdk),
    {
      code: "reader-transmit-failed",
      pcscCode: "80100016",
    },
  );
  for (const invalid of ["80100016 private", "8010001G", 123]) {
    cause.pcscCode = invalid;
    assert.deepEqual(
      failureEvidence(new sdk.TransportError("private text", cause), sdk),
      { code: "reader-transmit-failed" },
    );
  }
});

test("unknown causes and nested or spoofed wrappers expose no native text or card status", () => {
  const reply = new ProbeFailure("card-status-6f00");
  reply.emptyReply = true;
  for (const error of [
    new Error("private native text"),
    {
      name: "TransportError",
      cause: new ProbeFailure("reader-transmit-failed"),
    },
    new sdk.TransportError("private", {
      code: "reader-transmit-failed",
      pcscCode: "80100016",
    }),
    new sdk.TransportError("private", reply),
    new sdk.TransportError(
      "private",
      new sdk.TransportError(
        "private",
        new ProbeFailure("reader-transmit-failed"),
      ),
    ),
  ])
    assert.deepEqual(failureEvidence(error, sdk), { code: "operation-failed" });
  assert.deepEqual(
    failureEvidence(new sdk.TransportError("private", reply), {}),
    { code: "operation-failed" },
  );
  assert.deepEqual(failureEvidence(reply, sdk), { code: "card-status-6f00" });
  assert.deepEqual(failureEvidence({ sw: 0x6982 }, sdk), {
    code: "card-status-6982",
  });
});
