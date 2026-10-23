/** Immutable service authorization. Card work still requires fresh inspection and a phone journal. */
import type {OpsDb} from './db';
import {
  ProvisioningError,
  assertChipId,
  assertInstallationId,
  type ProvisioningScope,
} from './provisioning';
import {findResetSource} from './reset-source';
import {assertIndependentBackup} from './recovery-evidence';
import {hasPendingReset} from './reset-state';
import type {ResetCompletionReceipt} from './reset-results';
import type {IssuedKeysRow} from './issue';

export interface ResetRequest {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  installation_id: string;
  consent: {erase_owner_and_proofs: true; value_handled: true};
  inspection: {
    unspent: 0;
    spent: 0;
    tag_present: true;
    has_owner: boolean;
    pin_present: boolean;
    record_present: boolean;
  };
}
export interface ResetIntentReceipt {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  installation_id: string;
  operator_id: number;
  device_id: string;
  authorized_at: number;
}
export interface ResetIntentRow {
  reset_id: string;
  chip_id: string;
  installation_id: string;
  source_attempt_id: string;
  operator_id: number;
  device_id: string;
  request_json: string;
  receipt_json: string;
  created: number;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== expected.sort().join(',')
  )
    throw new ProvisioningError(400, 'bad-field', 'invalid reset fields');
  return value as Record<string, unknown>;
}
export function assertResetRequest(
  value: unknown,
): asserts value is ResetRequest {
  const r = fields(value, [
    'reset_id',
    'source_attempt_id',
    'chip_id',
    'installation_id',
    'consent',
    'inspection',
  ]);
  assertChipId(r.chip_id);
  assertInstallationId(r.installation_id);
  const c = fields(r.consent, ['erase_owner_and_proofs', 'value_handled']);
  const i = fields(r.inspection, [
    'unspent',
    'spent',
    'tag_present',
    'has_owner',
    'pin_present',
    'record_present',
  ]);
  if (
    typeof r.reset_id !== 'string' ||
    typeof r.source_attempt_id !== 'string' ||
    !UUID.test(r.reset_id) ||
    !UUID.test(r.source_attempt_id) ||
    c.erase_owner_and_proofs !== true ||
    c.value_handled !== true ||
    i.unspent !== 0 ||
    i.spent !== 0 ||
    i.tag_present !== true ||
    [i.has_owner, i.pin_present, i.record_present].some(
      v => typeof v !== 'boolean',
    )
  )
    throw new ProvisioningError(
      400,
      'bad-field',
      'reset requires exact identity, zero proof slots and consent',
    );
}
export function canonicalResetRequest(r: ResetRequest): string {
  return JSON.stringify({
    reset_id: r.reset_id,
    source_attempt_id: r.source_attempt_id,
    chip_id: r.chip_id,
    installation_id: r.installation_id,
    consent: {
      erase_owner_and_proofs: r.consent.erase_owner_and_proofs,
      value_handled: r.consent.value_handled,
    },
    inspection: {
      unspent: r.inspection.unspent,
      spent: r.inspection.spent,
      tag_present: r.inspection.tag_present,
      has_owner: r.inspection.has_owner,
      pin_present: r.inspection.pin_present,
      record_present: r.inspection.record_present,
    },
  });
}
function actor(db: OpsDb, scope: ProvisioningScope): void {
  const op = db.db
    .prepare('SELECT key_env,disabled FROM operators WHERE id = ?')
    .get(scope.operator_id) as {key_env: string; disabled: number} | undefined;
  if (
    !UUID.test(scope.device_id) ||
    !op ||
    op.disabled !== 0 ||
    op.key_env !== scope.key_env
  )
    throw new ProvisioningError(404, 'not-found');
}
export function getResetIntent(
  db: OpsDb,
  scope: ProvisioningScope,
  id: string,
) {
  actor(db, scope);
  if (!UUID.test(id)) throw new ProvisioningError(400, 'bad-field');
  const row = db.db
    .prepare('SELECT * FROM reset_intents WHERE reset_id = ?')
    .get(id) as ResetIntentRow | undefined;
  if (
    !row ||
    row.operator_id !== scope.operator_id ||
    row.device_id !== scope.device_id
  )
    throw new ProvisioningError(404, 'not-found');
  const completion = db.db
    .prepare('SELECT receipt_json FROM reset_results WHERE reset_id = ?')
    .get(id) as {receipt_json: string} | undefined;
  return {
    request: JSON.parse(row.request_json) as ResetRequest,
    receipt: JSON.parse(row.receipt_json) as ResetIntentReceipt,
    completion_receipt: completion
      ? (JSON.parse(completion.receipt_json) as ResetCompletionReceipt)
      : null,
  };
}
export function assertResetWritable(db: OpsDb): void {
  const control = db.db
    .prepare('SELECT recovery_required FROM provisioning_control WHERE id = 1')
    .get() as {recovery_required: number};
  if (control.recovery_required !== 0)
    throw new ProvisioningError(409, 'recovery-required');
}
/** Keys remain scoped to the immutable intent and are never a lookup response. */
export function issueResetKeys(
  db: OpsDb,
  scope: ProvisioningScope,
  id: string,
) {
  return db.db.transaction(() => {
    const intent = getResetIntent(db, scope, id);
    assertResetWritable(db);
    assertIndependentBackup(db);
    if (intent.completion_receipt)
      throw new ProvisioningError(409, 'reset-completed');
    const row = db.db
      .prepare(
        `SELECT k.* FROM issued_keys k JOIN provisioning_attempts a
      ON a.batch_id = k.batch_id AND a.ordinal = k.ordinal WHERE a.attempt_id = ?`,
      )
      .get(intent.request.source_attempt_id) as IssuedKeysRow | undefined;
    if (!row) throw new ProvisioningError(409, 'escrow-missing');
    return {
      reset_id: id,
      chip_id: intent.request.chip_id,
      installation_id: intent.request.installation_id,
      enc: Buffer.from(row.enc),
      mac: Buffer.from(row.mac),
      dek: Buffer.from(row.dek),
    };
  });
}
export function authorizeResetIntent(
  db: OpsDb,
  scope: ProvisioningScope,
  value: unknown,
): ResetIntentReceipt {
  assertResetRequest(value);
  const request = value;
  const serialized = canonicalResetRequest(request);
  return db.db.transaction(() => {
    actor(db, scope);
    assertResetWritable(db);
    const existing = db.db
      .prepare('SELECT * FROM reset_intents WHERE reset_id = ?')
      .get(request.reset_id) as ResetIntentRow | undefined;
    if (existing) {
      if (
        existing.operator_id !== scope.operator_id ||
        existing.device_id !== scope.device_id ||
        existing.request_json !== serialized
      )
        throw new ProvisioningError(409, 'reset-intent-changed');
      return JSON.parse(existing.receipt_json) as ResetIntentReceipt;
    }
    assertIndependentBackup(db);
    const source = findResetSource(
      db,
      request.chip_id,
      request.installation_id,
    );
    const owner = db.db
      .prepare(
        'SELECT a.operator_id,b.key_env FROM provisioning_attempts a JOIN provisioning_batches b ON b.batch_id = a.batch_id WHERE a.attempt_id = ?',
      )
      .get(request.source_attempt_id) as
      {operator_id: number; key_env: string} | undefined;
    if (
      source.status !== 'found' ||
      source.source.attemptId !== request.source_attempt_id ||
      !owner ||
      owner.operator_id !== scope.operator_id ||
      owner.key_env !== scope.key_env
    )
      throw new ProvisioningError(409, 'reset-source-unavailable');
    if (
      db.db
        .prepare(
          "SELECT 1 FROM provisioning_attempts WHERE device_id = ? AND state = 'active'",
        )
        .get(scope.device_id)
    )
      throw new ProvisioningError(409, 'device-busy');
    if (hasPendingReset(db, 'chip', request.chip_id))
      throw new ProvisioningError(409, 'reset-unresolved');
    if (hasPendingReset(db, 'device', scope.device_id))
      throw new ProvisioningError(409, 'device-busy');
    const receipt: ResetIntentReceipt = {
      reset_id: request.reset_id,
      source_attempt_id: request.source_attempt_id,
      chip_id: request.chip_id,
      installation_id: request.installation_id,
      operator_id: scope.operator_id,
      device_id: scope.device_id,
      authorized_at: db.now(),
    };
    db.db
      .prepare('INSERT INTO reset_intents VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        request.reset_id,
        request.chip_id,
        request.installation_id,
        request.source_attempt_id,
        scope.operator_id,
        scope.device_id,
        serialized,
        JSON.stringify(receipt),
        receipt.authorized_at,
      );
    return receipt;
  });
}
