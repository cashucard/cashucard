/** Human-reviewed foreign reset evidence, never an automatic foreign-service trust grant. */
import {createHash} from 'node:crypto';
import type {OpsDb} from './db';
import {ProvisioningError, assertChipId} from './provisioning';
import {assertResetWritable} from './reset-intents';
import {assertIndependentBackup} from './recovery-evidence';
import {hasPendingReset} from './reset-state';
import {
  assertResetCompletion,
  canonicalResetCompletion,
  type ResetCompletionRecord,
  type ResetCompletionReceipt,
} from './reset-results';

export interface ReconciliationRequest {
  revision: number;
  chip_id: string;
  source_origin: string;
  completion: ResetCompletionRecord;
  receipt: ResetCompletionReceipt;
  observed_absent_at: number;
  evidence_ref: string;
  reviewed: true;
}
export interface ReconciliationReceipt {
  attempt_id: string;
  chip_id: string;
  actor_id: number;
  source_origin: string;
  reset_id: string;
  request_sha256: string;
  reconciled_at: number;
}
export interface ReconciliationRow {
  attempt_id: string;
  actor_id: number;
  source_origin: string;
  reset_id: string;
  request_json: string;
  receipt_json: string;
  reconciled_at: number;
}
const uuid = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    x,
  );
const integer = (x: unknown): x is number =>
  Number.isSafeInteger(x) && Number(x) >= 0;
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== expected.sort().join(',')
  )
    throw new ProvisioningError(400, 'bad-reconciliation');
  return value as Record<string, unknown>;
}
export function assertReconciliationRequest(
  value: unknown,
): asserts value is ReconciliationRequest {
  const r = fields(value, [
    'revision',
    'chip_id',
    'source_origin',
    'completion',
    'receipt',
    'observed_absent_at',
    'evidence_ref',
    'reviewed',
  ]);
  assertChipId(r.chip_id);
  assertResetCompletion(r.completion);
  const completion = r.completion;
  const receipt = fields(r.receipt, [
    'reset_id',
    'chip_id',
    'removed_installation_id',
    'operator_id',
    'device_id',
    'completed_at',
    'manager_keys',
    'cashu_package',
  ]);
  let validOrigin = false;
  if (typeof r.source_origin === 'string') {
    try {
      const u = new URL(r.source_origin);
      validOrigin =
        u.origin === r.source_origin &&
        !u.username &&
        !u.password &&
        (u.protocol === 'https:' ||
          (u.protocol === 'http:' && u.hostname === '127.0.0.1'));
    } catch {
      /* Bounded validation error below; never return the input. */
    }
  }
  if (
    !integer(r.revision) ||
    !integer(r.observed_absent_at) ||
    !validOrigin ||
    typeof r.evidence_ref !== 'string' ||
    !/^[\x20-\x7e]{1,256}$/.test(r.evidence_ref) ||
    r.reviewed !== true ||
    completion.gp_key_version === 0 ||
    receipt.reset_id !== completion.reset_id ||
    receipt.chip_id !== r.chip_id ||
    completion.chip_id !== r.chip_id ||
    receipt.removed_installation_id !== completion.removed_installation_id ||
    receipt.manager_keys !== 'factory' ||
    receipt.cashu_package !== 'absent' ||
    !integer(receipt.operator_id) ||
    receipt.operator_id === 0 ||
    !uuid(receipt.device_id) ||
    !integer(receipt.completed_at) ||
    receipt.completed_at < completion.verified_at ||
    r.observed_absent_at < receipt.completed_at
  )
    throw new ProvisioningError(400, 'bad-reconciliation');
}
export function canonicalReconciliation(r: ReconciliationRequest): string {
  return JSON.stringify({
    revision: r.revision,
    chip_id: r.chip_id,
    source_origin: r.source_origin,
    completion: JSON.parse(canonicalResetCompletion(r.completion)),
    receipt: {
      reset_id: r.receipt.reset_id,
      chip_id: r.receipt.chip_id,
      removed_installation_id: r.receipt.removed_installation_id,
      operator_id: r.receipt.operator_id,
      device_id: r.receipt.device_id,
      completed_at: r.receipt.completed_at,
      manager_keys: r.receipt.manager_keys,
      cashu_package: r.receipt.cashu_package,
    },
    observed_absent_at: r.observed_absent_at,
    evidence_ref: r.evidence_ref,
    reviewed: r.reviewed,
  });
}
export const reconciliationHash = (serialized: string) =>
  createHash('sha256').update(serialized).digest('hex');

/** Caller must authorize a deployment administrator. This function never opens a reader. */
export function reconcileReset(
  db: OpsDb,
  actor: number,
  attemptId: string,
  input: unknown,
): ReconciliationReceipt {
  if (!uuid(attemptId)) throw new ProvisioningError(400, 'bad-reconciliation');
  assertReconciliationRequest(input);
  const r = input,
    serialized = canonicalReconciliation(r);
  return db.db.transaction(() => {
    assertResetWritable(db);
    const existing = db.db
      .prepare('SELECT * FROM reset_reconciliations WHERE attempt_id=?')
      .get(attemptId) as ReconciliationRow | undefined;
    if (existing) {
      if (existing.request_json !== serialized)
        throw new ProvisioningError(409, 'reconciliation-changed');
      return JSON.parse(existing.receipt_json) as ReconciliationReceipt;
    }
    assertIndependentBackup(db);
    const row = db.db
      .prepare(
        'SELECT revision,state,chip_id,fence_released,disposition_receipt FROM provisioning_attempts WHERE attempt_id=?',
      )
      .get(attemptId) as
      | {
          revision: number;
          state: string;
          chip_id: string | null;
          fence_released: number;
          disposition_receipt: string | null;
        }
      | undefined;
    if (
      !row ||
      !['quarantined', 'abandoned'].includes(row.state) ||
      row.fence_released ||
      row.chip_id !== r.chip_id ||
      row.revision !== r.revision ||
      !row.disposition_receipt
    )
      throw new ProvisioningError(409, 'reconciliation-target-changed');
    const now = db.now();
    if (
      r.observed_absent_at > now ||
      now - r.observed_absent_at > 900 ||
      JSON.parse(row.disposition_receipt).acknowledged_at >
        r.completion.verified_at ||
      hasPendingReset(db, 'chip', r.chip_id)
    )
      throw new ProvisioningError(409, 'reconciliation-evidence-stale');
    // No later target-service installation/binding may be covered by old reset evidence.
    const bound = db.db
      .prepare(
        'SELECT bind_receipt FROM provisioning_attempts WHERE chip_id=? AND bind_receipt IS NOT NULL',
      )
      .all(r.chip_id) as {bind_receipt: string}[];
    const records = db.db
      .prepare(
        'SELECT r.recorded_at FROM provisioning_records r JOIN provisioning_attempts a ON a.attempt_id=r.attempt_id WHERE a.chip_id=?',
      )
      .all(r.chip_id) as {recorded_at: number}[];
    if (
      bound.some(
        a => JSON.parse(a.bind_receipt).bound_at > r.completion.verified_at,
      ) ||
      records.some(a => a.recorded_at > r.completion.verified_at) ||
      db.db
        .prepare(
          'SELECT 1 FROM reset_reconciliations WHERE source_origin=? AND reset_id=?',
        )
        .get(r.source_origin, r.completion.reset_id)
    )
      throw new ProvisioningError(409, 'reconciliation-evidence-stale');
    const receipt: ReconciliationReceipt = {
      attempt_id: attemptId,
      chip_id: r.chip_id,
      actor_id: actor,
      source_origin: r.source_origin,
      reset_id: r.completion.reset_id,
      request_sha256: reconciliationHash(serialized),
      reconciled_at: now,
    };
    db.db
      .prepare('INSERT INTO reset_reconciliations VALUES (?,?,?,?,?,?,?)')
      .run(
        attemptId,
        actor,
        r.source_origin,
        r.completion.reset_id,
        serialized,
        JSON.stringify(receipt),
        now,
      );
    db.db
      .prepare(
        'UPDATE provisioning_attempts SET fence_released=1 WHERE attempt_id=?',
      )
      .run(attemptId);
    return receipt;
  });
}
