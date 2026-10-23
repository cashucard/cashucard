/** Durable operator/device provisioning reservations and immutable receipts (D31). */
import type {OpsDb} from './db';
import {createBatch} from './batches';
import {assertIndependentBackup} from './recovery-evidence';
import type {IssuedKeysRow} from './issue';

export class ProvisioningError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}
function bad(message: string): never {
  throw new ProvisioningError(400, 'bad-field', message);
}
const conflict = (code: string, message: string): never => {
  throw new ProvisioningError(409, code, message);
};
const missing = (): never => {
  throw new ProvisioningError(404, 'not-found');
};

export interface ProvisioningScope {
  operator_id: number;
  device_id: string;
  key_env: 'factory' | 'issued';
}
export interface ProvisioningConfig {
  count: number;
  mint_url: string;
  pin_policy: 'batch' | 'perCard';
  daily_usd: number;
  no_pin_usd: number;
  load_sha256: string;
  key_env: 'factory' | 'issued';
  configuration_revision: 1;
}
export interface ProvisioningBatch {
  batch_id: number;
  batch_request_id: string;
  operator_id: number;
  device_id: string;
  config: ProvisioningConfig;
  next_ordinal: number;
  created: number;
}
export interface BatchClosureReceipt {
  batch_id: number;
  reason: 'operator-ended';
  next_ordinal: number;
  closed_at: number;
}
export interface BindReceipt {
  attempt_id: string;
  chip_id: string;
  revision: number;
  bound_at: number;
}
export interface CompletionRecord {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  chip_id: string;
  installation_id: string;
  display_id: string;
  load_sha256: string;
  gp_key_version: number;
  operator_id: number;
  device_id: string;
  key_env: 'factory' | 'issued';
  configuration_revision: 1;
  verified_stage: 'rotated';
  verified_at: number;
}
export interface CompletionReceipt {
  attempt_id: string;
  installation_id: string;
  revision: number;
  recorded_at: number;
  verified_stage: 'rotated';
  ready_for_holder: false;
}
export interface DispositionReceipt {
  attempt_id: string;
  kind: 'quarantined' | 'abandoned';
  reason: string;
  revision: number;
  acknowledged_at: number;
}
export interface Attempt {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  operator_id: number;
  device_id: string;
  revision: number;
  state: 'active' | 'recorded' | 'quarantined' | 'abandoned';
  chip_id: string | null;
  created: number;
  bind_receipt: BindReceipt | null;
  completion_receipt: CompletionReceipt | null;
  disposition_receipt: DispositionReceipt | null;
}
interface BatchRow {
  batch_id: number;
  request_id: string;
  operator_id: number;
  device_id: string;
  config_json: string;
  key_env: 'factory' | 'issued';
  next_ordinal: number;
  created: number;
}
interface AttemptRow extends Omit<
  Attempt,
  'bind_receipt' | 'completion_receipt' | 'disposition_receipt'
> {
  bind_receipt: string | null;
  disposition_json: string | null;
  disposition_receipt: string | null;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const uint = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const hex64 = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return bad('expected an object');
  return v as Record<string, unknown>;
}
function fields(v: unknown, names: readonly string[]): Record<string, unknown> {
  const obj = object(v);
  if (
    Object.keys(obj).length !== names.length ||
    names.some(name => !Object.hasOwn(obj, name))
  )
    bad('unexpected or missing fields');
  return obj;
}
function scopeCheck(db: OpsDb, scope: ProvisioningScope): void {
  if (
    !uint(scope.operator_id) ||
    scope.operator_id === 0 ||
    !uuid(scope.device_id) ||
    !['factory', 'issued'].includes(scope.key_env)
  )
    bad('invalid operator/device scope');
  const row = db.db
    .prepare('SELECT key_env FROM operators WHERE id = ?')
    .get(scope.operator_id) as {key_env: string} | undefined;
  if (!row || row.key_env !== scope.key_env) missing();
}
function writable(db: OpsDb): void {
  const control = db.db
    .prepare('SELECT recovery_required FROM provisioning_control WHERE id = 1')
    .get() as {recovery_required: number} | undefined;
  if (!control || control.recovery_required !== 0)
    throw new ProvisioningError(409, 'recovery-required');
}
function batchRow(db: OpsDb, scope: ProvisioningScope, id: number): BatchRow {
  const row = db.db
    .prepare('SELECT * FROM provisioning_batches WHERE batch_id = ?')
    .get(id) as BatchRow | undefined;
  if (
    !row ||
    row.operator_id !== scope.operator_id ||
    row.device_id !== scope.device_id ||
    row.key_env !== scope.key_env
  )
    return missing();
  return row;
}
function attemptRow(
  db: OpsDb,
  scope: ProvisioningScope,
  id: string,
): AttemptRow {
  scopeCheck(db, scope);
  if (!uuid(id)) bad('attempt_id must be a canonical UUID');
  const row = db.db
    .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id = ?')
    .get(id) as AttemptRow | undefined;
  if (
    !row ||
    row.operator_id !== scope.operator_id ||
    row.device_id !== scope.device_id
  )
    return missing();
  batchRow(db, scope, row.batch_id);
  return row;
}
function presentBatch(row: BatchRow): ProvisioningBatch {
  return {
    batch_id: row.batch_id,
    batch_request_id: row.request_id,
    operator_id: row.operator_id,
    device_id: row.device_id,
    config: JSON.parse(row.config_json) as ProvisioningConfig,
    next_ordinal: row.next_ordinal,
    created: row.created,
  };
}
function presentAttempt(db: OpsDb, row: AttemptRow): Attempt {
  const record = db.db
    .prepare(
      'SELECT receipt_json FROM provisioning_records WHERE attempt_id = ?',
    )
    .get(row.attempt_id) as {receipt_json: string} | undefined;
  return {
    attempt_id: row.attempt_id,
    batch_id: row.batch_id,
    ordinal: row.ordinal,
    operator_id: row.operator_id,
    device_id: row.device_id,
    revision: row.revision,
    state: row.state,
    chip_id: row.chip_id,
    created: row.created,
    bind_receipt: row.bind_receipt
      ? (JSON.parse(row.bind_receipt) as BindReceipt)
      : null,
    completion_receipt: record
      ? (JSON.parse(record.receipt_json) as CompletionReceipt)
      : null,
    disposition_receipt: row.disposition_receipt
      ? (JSON.parse(row.disposition_receipt) as DispositionReceipt)
      : null,
  };
}
export function assertChipId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^cplc-v1:[0-9a-f]{24}$/.test(value))
    bad('invalid CPLC identity');
  const serial = value.slice(8 + 12, 8 + 20);
  if (serial === '00000000' || serial === 'ffffffff') bad('unset CPLC serial');
}
const FIELD = (1n << 256n) - (1n << 32n) - 977n;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % FIELD;
    base = (base * base) % FIELD;
    exponent >>= 1n;
  }
  return result;
}
/** Check the compressed secp256k1 encoding, field range and curve equation. */
export function assertInstallationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^0[23][0-9a-f]{64}$/.test(value))
    bad('invalid installation key encoding');
  const x = BigInt(`0x${value.slice(2)}`);
  if (x >= FIELD) bad('installation key x is outside the field');
  const rhs = (((x * x) % FIELD) * x + 7n) % FIELD;
  if (power(rhs, (FIELD - 1n) / 2n) !== 1n)
    bad('installation key is not a curve point');
}
const RECORD_FIELDS = [
  'attempt_id',
  'batch_id',
  'ordinal',
  'chip_id',
  'installation_id',
  'display_id',
  'load_sha256',
  'gp_key_version',
  'operator_id',
  'device_id',
  'key_env',
  'configuration_revision',
  'verified_stage',
  'verified_at',
] as const;
export function assertCompletionRecord(
  value: unknown,
): asserts value is CompletionRecord {
  const r = fields(value, RECORD_FIELDS);
  assertChipId(r.chip_id);
  assertInstallationId(r.installation_id);
  if (
    !uuid(r.attempt_id) ||
    !uuid(r.device_id) ||
    !uint(r.batch_id) ||
    r.batch_id === 0 ||
    !uint(r.ordinal) ||
    !uint(r.operator_id) ||
    r.operator_id === 0 ||
    !uint(r.gp_key_version) ||
    r.gp_key_version > 255 ||
    !uint(r.verified_at) ||
    !hex64(r.load_sha256) ||
    r.display_id !== r.installation_id.slice(-4) ||
    (r.key_env !== 'factory' && r.key_env !== 'issued') ||
    r.configuration_revision !== 1 ||
    r.verified_stage !== 'rotated'
  )
    bad('invalid completion record');
}
function canonicalRecord(record: CompletionRecord): string {
  return JSON.stringify(
    Object.fromEntries(RECORD_FIELDS.map(name => [name, record[name]])),
  );
}

export function createProvisioningBatch(
  db: OpsDb,
  scope: ProvisioningScope,
  input: {
    batch_request_id: string;
    count: number;
    mint_url: string;
    pin_policy: 'batch' | 'perCard';
    daily_usd: number;
    no_pin_usd: number;
    load_sha256: string;
  },
): ProvisioningBatch {
  scopeCheck(db, scope);
  fields(input, [
    'batch_request_id',
    'count',
    'mint_url',
    'pin_policy',
    'daily_usd',
    'no_pin_usd',
    'load_sha256',
  ]);
  if (
    !uuid(input.batch_request_id) ||
    !uint(input.count) ||
    input.count < 1 ||
    input.count > 100000 ||
    !['batch', 'perCard'].includes(input.pin_policy) ||
    !Number.isFinite(input.daily_usd) ||
    input.daily_usd < 0 ||
    !Number.isFinite(input.no_pin_usd) ||
    input.no_pin_usd < 0 ||
    !hex64(input.load_sha256)
  )
    bad('invalid batch configuration');
  try {
    const url = new URL(input.mint_url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      bad('invalid mint URL');
  } catch {
    bad('invalid mint URL');
  }
  const config: ProvisioningConfig = {
    count: input.count,
    mint_url: input.mint_url,
    pin_policy: input.pin_policy,
    daily_usd: input.daily_usd,
    no_pin_usd: input.no_pin_usd,
    load_sha256: input.load_sha256,
    key_env: scope.key_env,
    configuration_revision: 1,
  };
  const serialized = JSON.stringify(config);
  return db.db.transaction(() => {
    writable(db);
    const existing = db.db
      .prepare('SELECT * FROM provisioning_batches WHERE request_id = ?')
      .get(input.batch_request_id) as BatchRow | undefined;
    if (existing) {
      if (existing.operator_id !== scope.operator_id) missing();
      if (
        existing.device_id !== scope.device_id ||
        existing.config_json !== serialized
      )
        conflict('batch-request-changed', 'batch request changed');
      return presentBatch(existing);
    }
    const batch = createBatch(db, {
      count: input.count,
      mintUrl: input.mint_url,
      pinPolicy: input.pin_policy,
      dailyUsd: input.daily_usd,
      noPinUsd: input.no_pin_usd,
      loadSha256: input.load_sha256,
      operatorId: scope.operator_id,
    });
    db.db
      .prepare(
        `INSERT INTO provisioning_batches (batch_id,request_id,operator_id,device_id,config_json,key_env,next_ordinal,created)
      VALUES (?,?,?,?,?,?,0,?)`,
      )
      .run(
        batch.id,
        input.batch_request_id,
        scope.operator_id,
        scope.device_id,
        serialized,
        scope.key_env,
        batch.created,
      );
    return presentBatch(batchRow(db, scope, batch.id));
  });
}
export function getAttempt(
  db: OpsDb,
  scope: ProvisioningScope,
  attemptId: string,
): Attempt {
  return presentAttempt(db, attemptRow(db, scope, attemptId));
}
/** End an unfinished batch without deleting escrow or attempt evidence. */
export function endProvisioningBatch(
  db: OpsDb,
  scope: ProvisioningScope,
  batchId: number,
  reason: 'operator-ended',
): BatchClosureReceipt {
  scopeCheck(db, scope);
  if (!uint(batchId) || batchId === 0 || reason !== 'operator-ended')
    bad('invalid batch closure');
  return db.db.transaction(() => {
    const batch = batchRow(db, scope, batchId);
    const old = db.db
      .prepare('SELECT * FROM provisioning_batch_closures WHERE batch_id = ?')
      .get(batchId) as BatchClosureReceipt | undefined;
    if (old) return old;
    writable(db);
    if (
      db.db
        .prepare(
          "SELECT 1 FROM provisioning_attempts WHERE batch_id = ? AND state = 'active'",
        )
        .get(batchId)
    )
      conflict('batch-active', 'resolve the active attempt first');
    const receipt: BatchClosureReceipt = {
      batch_id: batchId,
      reason,
      next_ordinal: batch.next_ordinal,
      closed_at: db.now(),
    };
    db.db
      .prepare(
        'INSERT INTO provisioning_batch_closures (batch_id,reason,next_ordinal,closed_at) VALUES (?,?,?,?)',
      )
      .run(batchId, reason, receipt.next_ordinal, receipt.closed_at);
    return receipt;
  });
}
export function reserveAttempt(
  db: OpsDb,
  scope: ProvisioningScope,
  input: {attempt_id: string; batch_id: number; ordinal: number},
): Attempt {
  scopeCheck(db, scope);
  fields(input, ['attempt_id', 'batch_id', 'ordinal']);
  if (
    !uuid(input.attempt_id) ||
    !uint(input.batch_id) ||
    input.batch_id === 0 ||
    !uint(input.ordinal)
  )
    bad('invalid reservation');
  return db.db.transaction(() => {
    writable(db);
    const existing = db.db
      .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id = ?')
      .get(input.attempt_id) as AttemptRow | undefined;
    if (existing) {
      const scoped = attemptRow(db, scope, input.attempt_id);
      if (
        scoped.batch_id !== input.batch_id ||
        scoped.ordinal !== input.ordinal
      )
        conflict('attempt-request-changed', 'attempt request changed');
      return presentAttempt(db, scoped);
    }
    assertIndependentBackup(db);
    const batch = batchRow(db, scope, input.batch_id);
    if (
      db.db
        .prepare('SELECT 1 FROM provisioning_batch_closures WHERE batch_id = ?')
        .get(input.batch_id)
    )
      conflict('batch-ended', 'batch is ended');
    const config = JSON.parse(batch.config_json) as ProvisioningConfig;
    if (input.ordinal !== batch.next_ordinal || input.ordinal >= config.count)
      conflict(
        'ordinal-not-next',
        'ordinal is not the next unreserved ordinal',
      );
    if (
      db.db
        .prepare(
          "SELECT 1 FROM provisioning_attempts WHERE device_id = ? AND state = 'active'",
        )
        .get(scope.device_id)
    )
      conflict('device-active', 'device has an active attempt');
    db.db
      .prepare(
        `INSERT INTO provisioning_attempts (attempt_id,batch_id,ordinal,operator_id,device_id,revision,state,created)
      VALUES (?,?,?,?,?,0,'active',?)`,
      )
      .run(
        input.attempt_id,
        input.batch_id,
        input.ordinal,
        scope.operator_id,
        scope.device_id,
        db.now(),
      );
    db.db
      .prepare(
        'UPDATE provisioning_batches SET next_ordinal = next_ordinal + 1 WHERE batch_id = ?',
      )
      .run(input.batch_id);
    return getAttempt(db, scope, input.attempt_id);
  });
}
function transition(row: AttemptRow, revision: unknown): void {
  if (!uint(revision)) bad('invalid revision');
  if (row.state !== 'active')
    conflict('attempt-terminal', 'attempt is terminal');
  if (row.revision !== revision)
    conflict('stale-revision', 'stale attempt revision');
}
export function bindAttempt(
  db: OpsDb,
  scope: ProvisioningScope,
  attemptId: string,
  input: {revision: number; chip_id: string},
): BindReceipt {
  fields(input, ['revision', 'chip_id']);
  assertChipId(input.chip_id);
  return db.db.transaction(() => {
    writable(db);
    const row = attemptRow(db, scope, attemptId);
    if (row.bind_receipt) {
      if (row.chip_id !== input.chip_id)
        conflict('chip-binding-changed', 'chip binding changed');
      return JSON.parse(row.bind_receipt) as BindReceipt;
    }
    transition(row, input.revision);
    if (
      db.db
        .prepare(
          "SELECT 1 FROM provisioning_attempts WHERE chip_id = ? AND state IN ('active','quarantined','abandoned')",
        )
        .get(input.chip_id)
    )
      conflict('chip-unresolved', 'chip has an unresolved attempt');
    const receipt: BindReceipt = {
      attempt_id: attemptId,
      chip_id: input.chip_id,
      revision: row.revision + 1,
      bound_at: db.now(),
    };
    db.db
      .prepare(
        'UPDATE provisioning_attempts SET chip_id = ?, revision = ?, bind_receipt = ? WHERE attempt_id = ?',
      )
      .run(input.chip_id, receipt.revision, JSON.stringify(receipt), attemptId);
    return receipt;
  });
}
export function recordAttempt(
  db: OpsDb,
  scope: ProvisioningScope,
  attemptId: string,
  input: {revision: number; record: CompletionRecord},
): CompletionReceipt {
  fields(input, ['revision', 'record']);
  assertCompletionRecord(input.record);
  return db.db.transaction(() => {
    writable(db);
    const row = attemptRow(db, scope, attemptId);
    const old = db.db
      .prepare(
        'SELECT body_json,receipt_json FROM provisioning_records WHERE attempt_id = ?',
      )
      .get(attemptId) as {body_json: string; receipt_json: string} | undefined;
    const serialized = canonicalRecord(input.record);
    if (old) {
      if (old.body_json !== serialized)
        conflict('completion-record-changed', 'completion record changed');
      return JSON.parse(old.receipt_json) as CompletionReceipt;
    }
    transition(row, input.revision);
    const config = JSON.parse(
      batchRow(db, scope, row.batch_id).config_json,
    ) as ProvisioningConfig;
    const r = input.record;
    if (
      !row.chip_id ||
      r.attempt_id !== attemptId ||
      r.batch_id !== row.batch_id ||
      r.ordinal !== row.ordinal ||
      r.chip_id !== row.chip_id ||
      r.operator_id !== scope.operator_id ||
      r.device_id !== scope.device_id ||
      r.key_env !== config.key_env ||
      r.configuration_revision !== config.configuration_revision ||
      r.load_sha256 !== config.load_sha256
    )
      conflict(
        'completion-identity-mismatch',
        'completion does not match reserved identity/configuration',
      );
    if (
      db.db
        .prepare('SELECT 1 FROM provisioning_records WHERE installation_id = ?')
        .get(r.installation_id)
    )
      conflict('installation-recorded', 'installation already recorded');
    const receipt: CompletionReceipt = {
      attempt_id: attemptId,
      installation_id: r.installation_id,
      revision: row.revision + 1,
      recorded_at: db.now(),
      verified_stage: r.verified_stage,
      ready_for_holder: false,
    };
    db.db
      .prepare(
        'INSERT INTO provisioning_records (attempt_id,installation_id,display_id,body_json,receipt_json,recorded_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        attemptId,
        r.installation_id,
        r.display_id,
        serialized,
        JSON.stringify(receipt),
        receipt.recorded_at,
      );
    db.db
      .prepare(
        "UPDATE provisioning_attempts SET state = 'recorded', revision = ? WHERE attempt_id = ?",
      )
      .run(receipt.revision, attemptId);
    return receipt;
  });
}
export function disposeAttempt(
  db: OpsDb,
  scope: ProvisioningScope,
  attemptId: string,
  input: {revision: number; kind: 'quarantined' | 'abandoned'; reason: string},
): DispositionReceipt {
  fields(input, ['revision', 'kind', 'reason']);
  if (
    !['quarantined', 'abandoned'].includes(input.kind) ||
    typeof input.reason !== 'string' ||
    input.reason.length < 1 ||
    input.reason.length > 256
  )
    bad('invalid disposition');
  const serialized = JSON.stringify({kind: input.kind, reason: input.reason});
  return db.db.transaction(() => {
    writable(db);
    const row = attemptRow(db, scope, attemptId);
    if (row.disposition_receipt) {
      if (row.disposition_json !== serialized)
        conflict('disposition-changed', 'disposition changed');
      return JSON.parse(row.disposition_receipt) as DispositionReceipt;
    }
    transition(row, input.revision);
    const receipt: DispositionReceipt = {
      attempt_id: attemptId,
      kind: input.kind,
      reason: input.reason,
      revision: row.revision + 1,
      acknowledged_at: db.now(),
    };
    db.db
      .prepare(
        'UPDATE provisioning_attempts SET state = ?, revision = ?, disposition_json = ?, disposition_receipt = ? WHERE attempt_id = ?',
      )
      .run(
        input.kind,
        receipt.revision,
        serialized,
        JSON.stringify(receipt),
        attemptId,
      );
    return receipt;
  });
}
/** A known reservation, never a numeric fallback, authorizes this fetch. */
export function issueAttemptKeys(
  db: OpsDb,
  scope: ProvisioningScope,
  attemptId: string,
): IssuedKeysRow & {attempt_id: string; chip_id: string | null} {
  return db.db.transaction(() => {
    writable(db);
    const row = attemptRow(db, scope, attemptId);
    if (row.state !== 'active')
      conflict('attempt-terminal', 'attempt is terminal');
    assertIndependentBackup(db);
    const keys = db.db
      .prepare('SELECT * FROM issued_keys WHERE batch_id = ? AND ordinal = ?')
      .get(row.batch_id, row.ordinal) as IssuedKeysRow | undefined;
    if (!keys) throw new ProvisioningError(409, 'escrow-missing');
    return {
      ...keys,
      attempt_id: attemptId,
      chip_id: row.chip_id,
      enc: Buffer.from(keys.enc),
      mac: Buffer.from(keys.mac),
      dek: Buffer.from(keys.dek),
    };
  });
}
