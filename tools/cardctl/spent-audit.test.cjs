"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const { verifySpentSettlement, AuditError } = require("./spent-audit.cjs")

const key = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const opts = {
  chipId: "cplc-v1:4790d3213041093363205547",
  installationId: key,
  spentCount: 2,
  mintOrigin: "https://mint.test",
}
const payload = () => ({
  chip_id: opts.chipId,
  installation_id: key,
  version: "2.1",
  unspent: 0,
  spent: 2,
  has_owner: true,
  pin_state: "set",
  record_set: true,
  locked: false,
  mint: "https://mint.test",
  refund_key: "00".repeat(33),
  pieces: [1, 2].map((amount, i) => ({
    slot: i + 2,
    status: 2,
    keyset_id: "ab".repeat(8),
    amount,
    nonce: String(i + 1).repeat(64),
    C: "03" + key.slice(2),
    date: 0,
  })),
})
function mint(rewrite = (states) => states) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith("/v1/keysets"))
      return Response.json({
        keysets: [{ id: "ab".repeat(8), unit: "sat", active: true }],
      })
    const Ys = JSON.parse(init.body).Ys
    return Response.json({
      states: rewrite(Ys.map((Y) => ({ Y, state: "SPENT" }))).reverse(),
    })
  }
  return { fetch, calls }
}
test("all exact Ys must be SPENT; output contains only counts, denominations and an evidence digest", async () => {
  const m = mint(),
    p = payload()
  const result = await verifySpentSettlement(
    p,
    opts,
    async (...args) => {
      p.chip_id = opts.chipId.replace("5547", "5548")
      return m.fetch(...args)
    },
    () => 1700000000,
  )
  assert.equal(result.verified, true)
  assert.equal(result.chip_id, opts.chipId)
  assert.equal(result.spent_count, 2)
  assert.equal(result.spent_face_value, 3)
  assert.deepEqual(result.denominations, { 1: 1, 2: 1 })
  assert.match(result.audit_sha256, /^[0-9a-f]{64}$/)
  assert.equal(m.calls.length, 2)
  assert.equal(m.calls[1].init.redirect, "error")
  for (const piece of p.pieces)
    assert.ok(!JSON.stringify(result).includes(piece.nonce))
  for (const Y of JSON.parse(m.calls[1].init.body).Ys)
    assert.ok(!JSON.stringify(result).includes(Y))
  assert.ok(!("pieces" in result))
})
test("pending, unknown, omitted and duplicated responses never authorize cleanup", async () => {
  for (const rewrite of [
    (s) => s.map((v, i) => (i ? { ...v, state: "PENDING" } : v)),
    (s) => s.slice(1),
    (s) => [s[0], s[0]],
    (s) => s.map((v) => ({ ...v, state: "UNSPENT" })),
  ]) {
    const m = mint(rewrite)
    await assert.rejects(
      verifySpentSettlement(payload(), opts, m.fetch),
      AuditError,
    )
  }
})
test("identity, origin, unspent value and malformed slot evidence stop before mint access", async () => {
  for (const change of [
    (p) => ({ ...p, chip_id: opts.chipId.replace("5547", "5548") }),
    (p) => ({ ...p, unspent: 1 }),
    (p) => ({ ...p, mint: "https://other.test" }),
    (p) => ({ ...p, pieces: [p.pieces[0], p.pieces[0]] }),
    (p) => ({ ...p, pieces: p.pieces.map((v) => ({ ...v, amount: 0 })) }),
    (p) => ({
      ...p,
      pieces: p.pieces.map((v) => ({ ...v, C: "00".repeat(33) })),
    }),
  ]) {
    const m = mint()
    await assert.rejects(
      verifySpentSettlement(change(payload()), opts, m.fetch),
      AuditError,
    )
    assert.equal(m.calls.length, 0)
  }
})
test("ambiguous keyset prefixes, redirects and oversized/unreadable mint responses fail closed", async () => {
  for (const fetch of [
    async () =>
      Response.json({
        keysets: [
          { id: "ab".repeat(8), unit: "sat" },
          { id: "ab".repeat(8) + "cd".repeat(25), unit: "sat" },
        ],
      }),
    async () => new Response("redirect", { status: 302 }),
    async () => new Response("x".repeat(70000)),
    async () =>
      Response.json({ keysets: [{ id: "cd".repeat(8), unit: "sat" }] }),
  ])
    await assert.rejects(
      verifySpentSettlement(payload(), opts, fetch),
      AuditError,
    )
})
test("default CLI is a preview and never starts Python or opens a reader", () => {
  const args = [
    path.join(__dirname, "spent-audit.cjs"),
    "--chip",
    opts.chipId,
    "--installation",
    key,
    "--spent-count",
    "2",
    "--mint",
    opts.mintOrigin,
    "--reader",
    "not-a-reader",
  ]
  const output = execFileSync(
    process.execPath,
    [...args, "--python", "not-an-executable"],
    { encoding: "utf8" },
  )
  assert.equal(JSON.parse(output).mode, "preview")
  assert.equal(JSON.parse(output).card_accessed, false)
  // Node cannot execute the Python child: no PC/SC import or hardware access.
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [...args, "--inspect", "--python", process.execPath],
        { encoding: "utf8", stdio: "pipe" },
      ),
    (error) =>
      JSON.parse(error.stderr).reason === "reader-stopped" &&
      error.stdout === "",
  )
})
