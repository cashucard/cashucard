"use strict"
/** Read-only settlement evidence. No PIN, manager keys, writes or retry path. */
const { createHash } = require("node:crypto")
const { execFile } = require("node:child_process")
const path = require("node:path")
const { parseArgs } = require("node:util")
const {
  point,
  compressed,
  hashToCurve,
  cardSecret,
} = require("../cardsim/cashu-crypto.cjs")

class AuditError extends Error {
  constructor(code) {
    super("spent settlement audit stopped")
    this.code = code
  }
}
const fail = (code) => {
  throw new AuditError(code)
}
const uint = (n) => Number.isSafeInteger(n) && n >= 0
const hex = (s, n) =>
  typeof s === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(s)
function origin(value) {
  try {
    const u = new URL(value)
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      fail("invalid-mint-origin")
    return u.origin
  } catch {
    return fail("invalid-mint-origin")
  }
}
function validateOptions(o) {
  if (
    !/^cplc-v1:[0-9a-f]{24}$/.test(o.chipId) ||
    !hex(o.installationId, 66) ||
    !point(o.installationId) ||
    !uint(o.spentCount) ||
    o.spentCount < 1 ||
    o.spentCount > 128
  )
    fail("invalid-expected-state")
  origin(o.mintOrigin)
}
function validateEvidence(p, o) {
  validateOptions(o)
  if (
    !p ||
    p.chip_id !== o.chipId ||
    p.installation_id !== o.installationId ||
    p.version !== "2.1" ||
    p.unspent !== 0 ||
    p.spent !== o.spentCount ||
    p.has_owner !== true ||
    p.pin_state !== "set" ||
    p.record_set !== true ||
    p.locked !== false ||
    origin(p.mint) !== origin(o.mintOrigin) ||
    !Array.isArray(p.pieces) ||
    p.pieces.length !== o.spentCount
  )
    fail("card-state-mismatch")
  const slots = new Set(),
    Ys = new Set()
  const pieces = p.pieces
    .map((piece) => {
      if (
        !piece ||
        !uint(piece.slot) ||
        piece.slot > 127 ||
        slots.has(piece.slot) ||
        piece.status !== 2 ||
        !uint(piece.amount) ||
        piece.amount < 1 ||
        piece.amount > 0x80000000 ||
        !Number.isInteger(Math.log2(piece.amount)) ||
        !hex(piece.keyset_id, 16) ||
        !hex(piece.nonce, 64) ||
        !hex(piece.C, 66) ||
        !point(piece.C) ||
        !uint(piece.date) ||
        piece.date > 0xffffffff ||
        (piece.date > 0 && (!hex(p.refund_key, 66) || !point(p.refund_key)))
      )
        fail("invalid-proof-data")
      slots.add(piece.slot)
      const secret = cardSecret(
        piece.nonce,
        p.installation_id,
        piece.date,
        p.refund_key,
      )
      const Y = compressed(hashToCurve(Buffer.from(secret, "utf8"))).toString(
        "hex",
      )
      if (Ys.has(Y)) fail("duplicate-proof-secret")
      Ys.add(Y)
      return { ...piece, Y }
    })
    .sort((a, b) => a.slot - b.slot)
  return pieces
}
async function jsonResponse(url, init, fetch) {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    })
    if (!response.ok || response.redirected) fail("mint-response-invalid")
    const reader = response.body?.getReader()
    if (!reader) fail("mint-response-invalid")
    let size = 0
    const chunks = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 65536) {
          await reader.cancel()
          fail("mint-response-invalid")
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    if (error instanceof AuditError) throw error
    return fail("mint-unavailable")
  }
}
/** Private proof material is processed in memory, never returned by this function. */
async function verifySpentSettlement(
  payload,
  options,
  fetch = globalThis.fetch,
  now = () => Math.floor(Date.now() / 1000),
) {
  const pieces = validateEvidence(payload, options)
  const binding = {
    chip_id: payload.chip_id,
    installation_id: payload.installation_id,
  }
  const mintOrigin = origin(options.mintOrigin)
  const metadata = await jsonResponse(
    mintOrigin + "/v1/keysets",
    { method: "GET" },
    fetch,
  )
  if (!Array.isArray(metadata?.keysets)) fail("mint-keysets-invalid")
  for (const piece of pieces) {
    const matches = metadata.keysets.filter(
      (k) =>
        k &&
        typeof k.id === "string" &&
        /^(?:[0-9a-f]{16}|[0-9a-f]{66})$/.test(k.id) &&
        k.id.startsWith(piece.keyset_id),
    )
    if (matches.length !== 1 || matches[0].unit !== "sat")
      fail("mint-keyset-unresolved")
  }
  const Ys = pieces.map((p) => p.Y)
  const result = await jsonResponse(
    mintOrigin + "/v1/checkstate",
    { method: "POST", body: JSON.stringify({ Ys }) },
    fetch,
  )
  if (!Array.isArray(result?.states) || result.states.length !== Ys.length)
    fail("mint-states-invalid")
  const seen = new Set()
  for (const state of result.states) {
    if (!state || !Ys.includes(state.Y) || seen.has(state.Y))
      fail("mint-states-invalid")
    seen.add(state.Y)
    if (state.state !== "SPENT") fail("not-all-settled")
  }
  const digestInput = {
    ...binding,
    mint_origin: mintOrigin,
    pieces: pieces.map((p) => ({
      slot: p.slot,
      keyset_id: p.keyset_id,
      amount: p.amount,
      nonce: p.nonce,
      C: p.C,
      date: p.date,
      Y: p.Y,
    })),
  }
  const denominations = {}
  for (const p of pieces)
    denominations[p.amount] = (denominations[p.amount] ?? 0) + 1
  return {
    verified: true,
    mode: "read-only-audit",
    ...binding,
    mint_origin: mintOrigin,
    unspent_count: 0,
    spent_count: pieces.length,
    spent_face_value: pieces.reduce((sum, p) => sum + p.amount, 0),
    denominations,
    audit_sha256: createHash("sha256")
      .update(JSON.stringify(digestInput))
      .digest("hex"),
    verified_at: now(),
    authentication_attempted: false,
    writes_performed: false,
  }
}
function readPrivateEvidence(o) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      o.python,
      [
        path.join(__dirname, "spent_audit_reader.py"),
        "--reader",
        o.reader,
        "--expect-chip",
        o.chipId,
        "--expect-installation",
        o.installationId,
        "--expected-spent",
        String(o.spentCount),
      ],
      { encoding: "utf8", maxBuffer: 65536, timeout: 30000 },
      (error, stdout) => {
        // Never print child stderr, proof material or an arbitrary native error.
        if (error) return reject(new AuditError("reader-stopped"))
        try {
          resolve(JSON.parse(stdout))
        } catch {
          return reject(new AuditError("reader-response-invalid"))
        }
      },
    )
    if (child.stdin) {
      child.stdin.on("error", () => {}) // execFile's callback owns startup errors
      child.stdin.end("cashu-spent-audit-v1\n")
    }
  })
}
async function main() {
  const { values } = parseArgs({
    options: {
      chip: { type: "string" },
      installation: { type: "string" },
      "spent-count": { type: "string" },
      mint: { type: "string" },
      reader: { type: "string" },
      python: { type: "string" },
      inspect: { type: "boolean", default: false },
    },
  })
  const options = {
    chipId: values.chip,
    installationId: values.installation,
    spentCount: Number(values["spent-count"]),
    mintOrigin: values.mint,
    reader: values.reader,
    python: values.python ?? path.join(__dirname, ".venv/bin/python"),
  }
  validateOptions(options)
  if (typeof options.reader !== "string" || !options.reader.length)
    fail("reader-name-required")
  if (!values.inspect) {
    console.log(
      JSON.stringify({
        mode: "preview",
        chip_id: options.chipId,
        installation_id: options.installationId,
        expected_spent: options.spentCount,
        mint_origin: origin(options.mintOrigin),
        card_accessed: false,
        network_accessed: false,
        writes_performed: false,
      }),
    )
    return
  }
  const evidence = await readPrivateEvidence(options)
  console.log(
    JSON.stringify(await verifySpentSettlement(evidence, options), null, 2),
  )
}
module.exports = { verifySpentSettlement, AuditError }
if (require.main === module)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        reason: error instanceof AuditError ? error.code : "audit-stopped",
      }),
    )
    process.exitCode = 1
  })
