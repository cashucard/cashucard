// A deployment administrator may release one failed Cashu install after an
// independently signed Fedimint factory reset. The old stop and escrow stay intact.
import {createHash} from 'node:crypto';
import type {OpsDb} from './db';
import {
  ProvisioningError,
  type BindReceipt,
  type DispositionReceipt,
} from './provisioning';
import {assertResetWritable} from './reset-intents';
import {
  assertResetCompletion,
  type ResetCompletionReceipt,
} from './reset-results';
import {assertIndependentBackup} from './recovery-evidence';
import {
  verifyFedimintResetProof,
  canonicalFedimintResetPayload,
  type FedimintResetTrust,
  type FedimintResetPayload,
  type FedimintResetProof,
} from './fedimint-reset-proof';

export type FedimintReissuePolicy = FedimintResetTrust;
export interface FedimintReissueAttempt {
  attempt_id: string;
  chip_id: string | null;
  state: string;
  revision: number;
  created: number;
  bind_receipt: string | null;
  disposition_json: string | null;
  disposition_receipt: string | null;
  fence_released?: number;
}
export interface FedimintReissueReceipt {
  attempt_id: string;
  chip_id: string;
  revision: number;
  actor_id: number;
  source_origin: string;
  short_id: string;
  completed_at_ms: number;
  public_key: string;
  proof_sha256: string;
  approved_at: number;
}
export interface FedimintReissueRow {
  attempt_id: string;
  actor_id: number;
  source_origin: string;
  chip_id: string;
  short_id: string;
  completed_at_ms: number;
  public_key: string;
  proof_json: string;
  receipt_json: string;
  approved_at: number;
}
type Checked = {payload: FedimintResetPayload; serialized: string};
const seconds = (ms: number) => Math.floor(ms / 1000);
const epoch = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function conflict(code: string): never {
  throw new ProvisioningError(409, code);
}
function checkedEvidence(
  input: unknown,
  policy: FedimintReissuePolicy,
): Checked {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).join(',') !== 'proof'
    )
      throw new Error();
    const {proof} = input as {proof: FedimintResetProof};
    const payload = verifyFedimintResetProof(proof, policy);
    const serialized = JSON.stringify({
      proof: {
        payload: JSON.parse(canonicalFedimintResetPayload(payload)),
        signature_hex: proof.signature_hex,
      },
    });
    return {payload, serialized};
  } catch {
    throw new ProvisioningError(400, 'bad-fedimint-reset-proof');
  }
}
function parse<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function checkTarget(
  attempt: FedimintReissueAttempt | undefined,
  p: FedimintResetPayload,
) {
  if (
    !attempt ||
    attempt.attempt_id !== p.attempt_id ||
    attempt.chip_id !== p.chip_id ||
    attempt.state !== 'quarantined' ||
    attempt.revision !== 2 ||
    p.revision !== attempt.revision
  )
    conflict('reissue-target-changed');
  const bind = parse<BindReceipt>(attempt.bind_receipt),
    stop = parse<DispositionReceipt>(attempt.disposition_receipt);
  const written = parse<{kind?: string; reason?: string}>(
    attempt.disposition_json,
  );
  if (
    !bind ||
    bind.attempt_id !== p.attempt_id ||
    bind.chip_id !== p.chip_id ||
    bind.revision !== 1 ||
    !epoch(attempt.created) ||
    !epoch(bind.bound_at) ||
    bind.bound_at < attempt.created ||
    bind.bound_at !== p.target_bound_at ||
    !stop ||
    stop.attempt_id !== p.attempt_id ||
    stop.revision !== attempt.revision ||
    stop.kind !== 'quarantined' ||
    stop.reason !== 'authentication-failed' ||
    written?.kind !== stop.kind ||
    written?.reason !== stop.reason ||
    !epoch(stop.acknowledged_at) ||
    stop.acknowledged_at < bind.bound_at
  )
    conflict('reissue-target-changed');
  // A late Save Stop acknowledges the already-bound failed install. The independent
  // observation must follow both acknowledgements; overlapping cross-clock seconds
  // cannot establish whether the stop preceded or followed the source reset.
  const before = stop.acknowledged_at < seconds(p.verified_at_ms);
  const after = stop.acknowledged_at > seconds(p.completed_at_ms);
  if (
    (!before && !after) ||
    bind.bound_at >= seconds(p.verified_at_ms) ||
    seconds(p.observed_at_ms) <= stop.acknowledged_at ||
    p.observed_at_ms <= p.completed_at_ms
  )
    conflict('reissue-evidence-order');
}

function assertHistory(db: OpsDb, p: FedimintResetPayload): void {
  // A matching receipt must actually have closed each older Cashu installation.
  // Once the target bound, no install, reset, other binding or prior release of
  // this chip can be folded into its foreign reset, even in the same second.
  // The legacy card registry identifies an installation by its batch and ordinal,
  // without a chip identity or a matching reset receipt of its own.
  if (
    db.db
      .prepare(
        `SELECT 1 FROM cards c JOIN provisioning_attempts a
    ON a.batch_id=c.batch_id AND a.ordinal=c.ordinal WHERE a.chip_id=? LIMIT 1`,
      )
      .get(p.chip_id)
  )
    conflict('reissue-chip-history');
  const recorded = db.db
    .prepare(
      `SELECT r.attempt_id,r.installation_id,r.recorded_at,i.reset_id,i.created,i.operator_id,i.device_id,
      s.body_json,s.receipt_json,s.completed_at FROM provisioning_records r
      JOIN provisioning_attempts a ON a.attempt_id=r.attempt_id
      LEFT JOIN reset_intents i ON i.source_attempt_id=a.attempt_id AND i.installation_id=r.installation_id AND i.chip_id=a.chip_id
      LEFT JOIN reset_results s ON s.reset_id=i.reset_id WHERE a.chip_id=?`,
    )
    .all(p.chip_id) as {
    attempt_id: string;
    installation_id: string;
    recorded_at: number;
    reset_id: string | null;
    created: number | null;
    operator_id: number | null;
    device_id: string | null;
    body_json: string | null;
    receipt_json: string | null;
    completed_at: number | null;
  }[];
  for (const r of recorded) {
    const completion = parse<unknown>(r.body_json),
      receipt = parse<ResetCompletionReceipt>(r.receipt_json);
    if (
      r.attempt_id === p.attempt_id ||
      r.reset_id === null ||
      !epoch(r.created) ||
      !epoch(r.recorded_at) ||
      r.created < r.recorded_at ||
      !epoch(r.completed_at) ||
      r.completed_at < r.created ||
      r.completed_at >= p.target_bound_at ||
      !receipt
    )
      conflict('reissue-chip-history');
    try {
      assertResetCompletion(completion);
    } catch {
      conflict('reissue-chip-history');
    }
    if (
      completion.chip_id !== p.chip_id ||
      completion.reset_id !== r.reset_id ||
      completion.source_attempt_id !== r.attempt_id ||
      completion.removed_installation_id !== r.installation_id ||
      completion.verified_at > r.completed_at ||
      receipt.reset_id !== r.reset_id ||
      receipt.chip_id !== p.chip_id ||
      receipt.removed_installation_id !== r.installation_id ||
      receipt.manager_keys !== 'factory' ||
      receipt.cashu_package !== 'absent' ||
      receipt.operator_id !== r.operator_id ||
      receipt.device_id !== r.device_id ||
      receipt.completed_at !== r.completed_at
    )
      conflict('reissue-chip-history');
  }
  const reset = db.db
    .prepare(
      `SELECT 1 FROM reset_intents i LEFT JOIN reset_results s ON s.reset_id=i.reset_id
    WHERE i.chip_id=? AND (s.completed_at IS NULL OR i.created>=? OR s.completed_at>=?) LIMIT 1`,
    )
    .get(p.chip_id, p.target_bound_at, p.target_bound_at);
  if (reset) conflict('reissue-chip-history');
  const others = db.db
    .prepare(
      `SELECT a.attempt_id,a.bind_receipt,a.state,a.fence_released,r.reconciled_at,f.approved_at
      FROM provisioning_attempts a LEFT JOIN reset_reconciliations r ON r.attempt_id=a.attempt_id
      LEFT JOIN fedimint_reissues f ON f.attempt_id=a.attempt_id WHERE a.chip_id=? AND a.attempt_id<>?`,
    )
    .all(p.chip_id, p.attempt_id) as {
    attempt_id: string;
    bind_receipt: string | null;
    state: string;
    fence_released: number;
    reconciled_at: number | null;
    approved_at: number | null;
  }[];
  for (const a of others) {
    const bind = parse<BindReceipt>(a.bind_receipt);
    if (
      !bind ||
      bind.attempt_id !== a.attempt_id ||
      bind.chip_id !== p.chip_id ||
      !epoch(bind.bound_at) ||
      bind.bound_at >= p.target_bound_at
    )
      conflict('reissue-chip-history');
    if (a.state === 'recorded') {
      if (
        !db.db
          .prepare('SELECT 1 FROM provisioning_records WHERE attempt_id=?')
          .get(a.attempt_id)
      )
        conflict('reissue-chip-history');
    } else {
      const released = a.reconciled_at ?? a.approved_at;
      if (
        !['quarantined', 'abandoned'].includes(a.state) ||
        a.fence_released !== 1 ||
        !epoch(released) ||
        released >= p.target_bound_at
      )
        conflict('reissue-chip-history');
    }
  }
}
function receiptFor(
  p: FedimintResetPayload,
  serialized: string,
  publicKey: string,
  actor: number,
  now: number,
): FedimintReissueReceipt {
  return {
    attempt_id: p.attempt_id,
    chip_id: p.chip_id,
    revision: p.revision,
    actor_id: actor,
    source_origin: p.source_origin,
    short_id: p.short_id,
    completed_at_ms: p.completed_at_ms,
    public_key: publicKey,
    proof_sha256: createHash('sha256').update(serialized).digest('hex'),
    approved_at: now,
  };
}
function fresh(p: FedimintResetPayload, now: number): boolean {
  return (
    epoch(now) &&
    p.observed_at_ms <= now * 1000 &&
    now * 1000 - p.observed_at_ms <= 900_000
  );
}

/** Verify retained signed provenance under the archived public verifier key, matching
 * the immutable Cashu binding and acknowledged stop. Restore verifies DB relations too. */
export function assertFedimintReissueAudit(
  row: FedimintReissueRow,
  attempt: FedimintReissueAttempt,
): void {
  const request = parse<{proof?: {payload?: {target_origin?: string}}}>(
    row.proof_json,
  );
  const {payload: p, serialized} = checkedEvidence(request, {
    source_origin: row.source_origin,
    target_origin: request?.proof?.payload?.target_origin ?? '',
    public_key_hex: row.public_key,
  });
  checkTarget(attempt, p);
  const receipt = receiptFor(
    p,
    serialized,
    row.public_key,
    row.actor_id,
    row.approved_at,
  );
  if (
    attempt.fence_released !== 1 ||
    !Number.isSafeInteger(row.actor_id) ||
    row.actor_id < 1 ||
    !fresh(p, row.approved_at) ||
    serialized !== row.proof_json ||
    row.attempt_id !== p.attempt_id ||
    row.chip_id !== p.chip_id ||
    row.short_id !== p.short_id ||
    row.completed_at_ms !== p.completed_at_ms ||
    row.receipt_json !== JSON.stringify(receipt)
  )
    conflict('reissue-audit-invalid');
}

function admission(
  db: OpsDb,
  attemptId: string,
  input: unknown,
  policy: FedimintReissuePolicy,
) {
  assertResetWritable(db);
  const {payload: p, serialized} = checkedEvidence(input, policy);
  if (p.attempt_id !== attemptId) conflict('reissue-target-changed');
  const a = db.db
    .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id=?')
    .get(attemptId) as FedimintReissueAttempt | undefined;
  checkTarget(a, p);
  const existing = db.db
    .prepare('SELECT * FROM fedimint_reissues WHERE attempt_id=?')
    .get(attemptId) as FedimintReissueRow | undefined;
  if (existing) {
    if (
      existing.proof_json !== serialized ||
      existing.public_key !== policy.public_key_hex
    )
      conflict('reissue-proof-changed');
    assertFedimintReissueAudit(existing, a!);
    return {p, serialized, existing, approvedAt: existing.approved_at};
  }
  assertIndependentBackup(db);
  if (a!.fence_released !== 0) conflict('reissue-target-changed');
  const approvedAt = db.now();
  if (
    seconds(p.observed_at_ms) === approvedAt &&
    p.observed_at_ms > approvedAt * 1000
  )
    conflict('reissue-evidence-next-second');
  if (!fresh(p, approvedAt)) conflict('reissue-evidence-stale');
  assertHistory(db, p);
  if (
    db.db
      .prepare(
        'SELECT 1 FROM fedimint_reissues WHERE source_origin=? AND short_id=?',
      )
      .get(p.source_origin, p.short_id)
  )
    conflict('reissue-source-used');
  return {p, serialized, existing: undefined, approvedAt};
}
/** Only call from the authenticated deployment-administrator route. Preview takes no write. */
export function previewFedimintReissue(
  db: OpsDb,
  attemptId: string,
  input: unknown,
  policy: FedimintReissuePolicy,
) {
  return db.db.transaction(() => {
    const {p} = admission(db, attemptId, input, policy);
    return {
      attempt_id: p.attempt_id,
      revision: p.revision,
      chip_id: p.chip_id,
      target_origin: p.target_origin,
      source_origin: p.source_origin,
      short_id: p.short_id,
      verified_at: seconds(p.verified_at_ms),
      completed_at: seconds(p.completed_at_ms),
      observed_at: seconds(p.observed_at_ms),
    };
  });
}
/** The route authenticates and authorizes the deployment administrator before invoking this command. */
export function approveFedimintReissue(
  db: OpsDb,
  actor: number,
  attemptId: string,
  input: unknown,
  policy: FedimintReissuePolicy,
): FedimintReissueReceipt {
  return db.db.transaction(() => {
    if (
      !Number.isSafeInteger(actor) ||
      !db.db
        .prepare('SELECT 1 FROM operators WHERE id=? AND disabled=0')
        .get(actor)
    )
      throw new ProvisioningError(403, 'admin-required');
    const {p, serialized, existing, approvedAt} = admission(
      db,
      attemptId,
      input,
      policy,
    );
    if (existing)
      return JSON.parse(existing.receipt_json) as FedimintReissueReceipt;
    const receipt = receiptFor(
      p,
      serialized,
      policy.public_key_hex,
      actor,
      approvedAt,
    );
    db.db
      .prepare(
        `INSERT INTO fedimint_reissues (attempt_id,actor_id,source_origin,chip_id,short_id,completed_at_ms,public_key,proof_json,receipt_json,approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        attemptId,
        actor,
        p.source_origin,
        p.chip_id,
        p.short_id,
        p.completed_at_ms,
        policy.public_key_hex,
        serialized,
        JSON.stringify(receipt),
        receipt.approved_at,
      );
    const updated = db.db
      .prepare(
        "UPDATE provisioning_attempts SET fence_released=1 WHERE attempt_id=? AND revision=? AND state='quarantined' AND fence_released=0",
      )
      .run(attemptId, p.revision);
    if (updated.changes !== 1) conflict('reissue-target-changed');
    return receipt;
  });
}
