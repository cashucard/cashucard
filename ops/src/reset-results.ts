/** Operator/device completion evidence. Applet history and escrow are retained. */
import type {OpsDb} from './db';
import {
  ProvisioningError,
  assertChipId,
  assertInstallationId,
  type ProvisioningScope,
} from './provisioning';
import {assertResetWritable, getResetIntent} from './reset-intents';

export interface ResetCompletionRecord {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  removed_installation_id: string;
  gp_key_version: number;
  manager_keys: 'factory';
  cashu_package: 'absent';
  verified_at: number;
}
export interface ResetCompletionReceipt {
  reset_id: string;
  chip_id: string;
  removed_installation_id: string;
  operator_id: number;
  device_id: string;
  completed_at: number;
  manager_keys: 'factory';
  cashu_package: 'absent';
}
export interface ResetResultRow {
  reset_id: string;
  body_json: string;
  receipt_json: string;
  completed_at: number;
}
const FIELDS = [
  'reset_id',
  'source_attempt_id',
  'chip_id',
  'removed_installation_id',
  'gp_key_version',
  'manager_keys',
  'cashu_package',
  'verified_at',
] as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function assertResetCompletion(
  value: unknown,
): asserts value is ResetCompletionRecord {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...FIELDS].sort().join(',')
  )
    throw new ProvisioningError(400, 'bad-field');
  const r = value as ResetCompletionRecord;
  assertChipId(r.chip_id);
  assertInstallationId(r.removed_installation_id);
  if (
    typeof r.reset_id !== 'string' ||
    !UUID.test(r.reset_id) ||
    typeof r.source_attempt_id !== 'string' ||
    !UUID.test(r.source_attempt_id) ||
    !Number.isInteger(r.gp_key_version) ||
    r.gp_key_version < 0 ||
    r.gp_key_version > 255 ||
    r.manager_keys !== 'factory' ||
    r.cashu_package !== 'absent' ||
    !Number.isSafeInteger(r.verified_at) ||
    r.verified_at < 0
  )
    throw new ProvisioningError(400, 'bad-field');
}
export function canonicalResetCompletion(r: ResetCompletionRecord): string {
  return JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, r[k]])));
}
export function completeReset(
  db: OpsDb,
  scope: ProvisioningScope,
  id: string,
  value: unknown,
): ResetCompletionReceipt {
  assertResetCompletion(value);
  const record = value,
    serialized = canonicalResetCompletion(record);
  return db.db.transaction(() => {
    const intent = getResetIntent(db, scope, id);
    assertResetWritable(db);
    const r = intent.request;
    if (
      record.reset_id !== id ||
      record.source_attempt_id !== r.source_attempt_id ||
      record.chip_id !== r.chip_id ||
      record.removed_installation_id !== r.installation_id
    )
      throw new ProvisioningError(409, 'reset-completion-mismatch');
    const existing = db.db
      .prepare('SELECT * FROM reset_results WHERE reset_id = ?')
      .get(id) as ResetResultRow | undefined;
    if (existing) {
      if (existing.body_json !== serialized)
        throw new ProvisioningError(409, 'reset-completion-changed');
      return JSON.parse(existing.receipt_json) as ResetCompletionReceipt;
    }
    const receipt: ResetCompletionReceipt = {
      reset_id: id,
      chip_id: r.chip_id,
      removed_installation_id: r.installation_id,
      operator_id: scope.operator_id,
      device_id: scope.device_id,
      completed_at: db.now(),
      manager_keys: 'factory',
      cashu_package: 'absent',
    };
    db.db
      .prepare('INSERT INTO reset_results VALUES (?,?,?,?)')
      .run(id, serialized, JSON.stringify(receipt), receipt.completed_at);
    return receipt;
  });
}
