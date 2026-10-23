/**
 * Versioned age-encrypted service recovery snapshot. Includes escrow keys and
 * the metadata needed to find them by card ID without the derivation master.
 * No PINs, password hashes, sessions or master leave the database. This is a
 * fleet recovery artifact, not a signed partner custody export.
 */
import * as age from 'age-encryption';

import type {SqlHandle} from './sql';
import type {CardRow, CapReleaseRow} from './registry';
import {
  assertResetRequest,
  canonicalResetRequest,
  type ResetIntentRow,
  type ResetIntentReceipt,
} from './reset-intents';
import {
  assertChipId,
  assertInstallationId,
  assertCompletionRecord,
} from './provisioning';

export interface EscrowRow {
  readonly batch_id: number;
  readonly ordinal: number;
  readonly enc: string; // hex
  readonly mac: string;
  readonly dek: string;
  readonly escrowed_at: number;
}

/** Recovery metadata only: passwords, sessions, PINs and the master are excluded. */
export interface OperatorAudit {
  id: number;
  actor_id: number;
  target_id: number;
  action: string;
  created: number;
}
export interface RecoveryOperator {
  disabled?: number;
  id: number;
  name: string;
  key_env: 'factory' | 'issued';
  created: number;
}
export interface RecoveryBatch {
  id: number;
  ordinal_salt: string;
  count: number;
  mint_url: string;
  pin_policy: 'batch' | 'perCard';
  daily_usd: number;
  no_pin_usd: number;
  load_sha256: string;
  operator_id: number;
  created: number;
}
export interface EscrowExportBase {
  readonly exported_at: number;
  readonly operators: readonly RecoveryOperator[];
  readonly batches: readonly RecoveryBatch[];
  readonly keys: readonly EscrowRow[];
  readonly cards: readonly CardRow[];
  readonly cap_releases: readonly CapReleaseRow[];
}

export interface RecoveryProvisioningBatch {
  batch_id: number;
  request_id: string;
  operator_id: number;
  device_id: string;
  config_json: string;
  key_env: 'factory' | 'issued';
  next_ordinal: number;
  created: number;
}
export interface RecoveryProvisioningAttempt {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  operator_id: number;
  device_id: string;
  revision: number;
  state: 'active' | 'recorded' | 'quarantined' | 'abandoned';
  chip_id: string | null;
  created: number;
  bind_receipt: string | null;
  disposition_json: string | null;
  disposition_receipt: string | null;
}
export interface RecoveryProvisioningRecord {
  attempt_id: string;
  installation_id: string;
  display_id: string;
  body_json: string;
  receipt_json: string;
  recorded_at: number;
}
export interface RecoveryBatchClosure {
  batch_id: number;
  reason: 'operator-ended';
  next_ordinal: number;
  closed_at: number;
}
export type EscrowExport = EscrowExportBase &
  (
    | {readonly version: 1}
    | {
        readonly version: 2 | 3 | 4 | 5;
        readonly operator_audit?: readonly OperatorAudit[];
        readonly provisioning_batches: readonly RecoveryProvisioningBatch[];
        readonly provisioning_attempts: readonly RecoveryProvisioningAttempt[];
        readonly provisioning_records: readonly RecoveryProvisioningRecord[];
        readonly provisioning_batch_closures?: readonly RecoveryBatchClosure[];
        readonly reset_intents?: readonly ResetIntentRow[];
      }
  );

export interface ExportResult {
  /** Snapshot time in Unix seconds, captured before encryption. */
  readonly exported_at: number;
  /** The armored age file, R2-ready. */
  readonly armored: string;
  /** Plaintext byte count, for backup metrics; never the payload itself. */
  readonly bytes: number;
}

/** Reads every escrow row through the seam — the one place keys leave the DB. */
export function readEscrow(db: SqlHandle): EscrowRow[] {
  const rows = db
    .prepare(
      `SELECT batch_id, ordinal, enc, mac, dek, escrowed_at
       FROM issued_keys ORDER BY batch_id, ordinal`,
    )
    .all() as {
    batch_id: number;
    ordinal: number;
    enc: Buffer;
    mac: Buffer;
    dek: Buffer;
    escrowed_at: number;
  }[];
  return rows.map(r => ({
    batch_id: r.batch_id,
    ordinal: r.ordinal,
    enc: Buffer.from(r.enc).toString('hex'),
    mac: Buffer.from(r.mac).toString('hex'),
    dek: Buffer.from(r.dek).toString('hex'),
    escrowed_at: r.escrowed_at,
  }));
}

/**
 * Builds and encrypts the export. Deterministic input, random age key wrap:
 * two exports on one day differ in ciphertext but carry the same rows.
 */
export async function exportEscrowSql(
  db: SqlHandle,
  recipient: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ExportResult> {
  // Read one consistent snapshot even on the Node backend.
  const snapshot = db.transaction(
    () =>
      ({
        version: 5 as const,
        operator_audit: db
          .prepare('SELECT * FROM operator_audit ORDER BY id')
          .all() as OperatorAudit[],
        exported_at: now,
        operators: db
          .prepare(
            'SELECT id, name, key_env, created, disabled FROM operators ORDER BY id',
          )
          .all() as RecoveryOperator[],
        batches: (
          db
            .prepare(
              'SELECT id, ordinal_salt, count, mint_url, pin_policy, daily_usd, no_pin_usd, load_sha256, operator_id, created FROM key_batches ORDER BY id',
            )
            .all() as (Omit<RecoveryBatch, 'ordinal_salt'> & {
            ordinal_salt: Buffer;
          })[]
        ).map(row => ({
          ...row,
          ordinal_salt: Buffer.from(row.ordinal_salt).toString('hex'),
        })),
        provisioning_batches: db
          .prepare('SELECT * FROM provisioning_batches ORDER BY batch_id')
          .all() as RecoveryProvisioningBatch[],
        provisioning_attempts: db
          .prepare('SELECT * FROM provisioning_attempts ORDER BY attempt_id')
          .all() as RecoveryProvisioningAttempt[],
        provisioning_records: db
          .prepare('SELECT * FROM provisioning_records ORDER BY attempt_id')
          .all() as RecoveryProvisioningRecord[],
        provisioning_batch_closures: db
          .prepare(
            'SELECT * FROM provisioning_batch_closures ORDER BY batch_id',
          )
          .all() as RecoveryBatchClosure[],
        keys: readEscrow(db),
        reset_intents: db
          .prepare('SELECT * FROM reset_intents ORDER BY reset_id')
          .all() as ResetIntentRow[],
        cards: db
          .prepare('SELECT * FROM cards ORDER BY short_id')
          .all() as CardRow[],
        cap_releases: db
          .prepare('SELECT * FROM cap_releases ORDER BY version')
          .all() as CapReleaseRow[],
      }) satisfies EscrowExport,
  );
  validateEscrowExport(snapshot);
  const payload = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(payload);
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(bytes);
  const armored = age.armor.encode(ciphertext);
  return {armored, bytes: bytes.length, exported_at: snapshot.exported_at};
}

/** Decrypts an export with its age identity — the runbook's recovery read. */
export async function decryptEscrowExport(
  armored: string,
  identity: string,
): Promise<EscrowExport> {
  const ciphertext = age.armor.decode(armored);
  const decrypter = new age.Decrypter();
  decrypter.addIdentity(identity);
  const out = await decrypter.decrypt(ciphertext, 'text');
  const parsed: unknown = JSON.parse(out as string);
  validateEscrowExport(parsed);
  return parsed;
}

/** Validate before writing: an encrypted file can still be stale or malformed. */
export function validateEscrowExport(
  value: unknown,
): asserts value is EscrowExport {
  function fail(): never {
    throw new Error('invalid recovery export');
  }
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
    return v as Record<string, unknown>;
  };
  const shape = (
    v: unknown,
    fields: Record<string, (x: unknown) => boolean>,
  ) => {
    const row = object(v);
    if (Object.keys(row).length !== Object.keys(fields).length) fail();
    for (const [key, check] of Object.entries(fields))
      if (!check(row[key])) fail();
  };
  const integer = (x: unknown): x is number =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
  const positive = (x: unknown) => integer(x) && x > 0;
  const text = (x: unknown) => typeof x === 'string' && x.length > 0;
  const money = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const hex = (n: number) => (x: unknown) =>
    typeof x === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(x);
  const rows =
    (fields: Record<string, (x: unknown) => boolean>) => (x: unknown) => {
      if (!Array.isArray(x)) return false;
      x.forEach(row => shape(row, fields));
      return true;
    };
  const version = object(value).version;
  shape(value, {
    version: x => x === 1 || x === 2 || x === 3 || x === 4 || x === 5,
    ...(version === 3 || version === 4 || version === 5
      ? {
          operator_audit: rows({
            id: positive,
            actor_id: positive,
            target_id: positive,
            action: x =>
              ['create', 'disable', 'enable', 'reset-password'].includes(
                x as string,
              ),
            created: integer,
          }),
        }
      : {}),
    exported_at: integer,
    operators: rows({
      ...(version === 3 || version === 4 || version === 5
        ? {disabled: (x: unknown) => x === 0 || x === 1}
        : {}),
      id: positive,
      name: text,
      key_env: x => x === 'factory' || x === 'issued',
      created: integer,
    }),
    batches: rows({
      id: positive,
      ordinal_salt: hex(32),
      count: x => positive(x) && (x as number) <= 100000,
      mint_url: text,
      pin_policy: x => x === 'batch' || x === 'perCard',
      daily_usd: money,
      no_pin_usd: money,
      load_sha256: text,
      operator_id: positive,
      created: integer,
    }),
    keys: rows({
      batch_id: positive,
      ordinal: integer,
      enc: hex(32),
      mac: hex(32),
      dek: hex(32),
      escrowed_at: integer,
    }),
    cards: rows({
      short_id: x => typeof x === 'string' && /^[0-9a-f]{1,16}$/.test(x),
      batch_id: positive,
      key_id: integer,
      ordinal: integer,
      installed_at: integer,
      installer: text,
      load_sha256: text,
    }),
    cap_releases: rows({version: text, sha256: hex(64), created: integer}),
    ...(version === 2 || version === 3 || version === 4 || version === 5
      ? {
          provisioning_batches: rows({
            batch_id: positive,
            request_id: text,
            operator_id: positive,
            device_id: text,
            config_json: text,
            key_env: x => x === 'factory' || x === 'issued',
            next_ordinal: integer,
            created: integer,
          }),
          provisioning_attempts: rows({
            attempt_id: text,
            batch_id: positive,
            ordinal: integer,
            operator_id: positive,
            device_id: text,
            revision: integer,
            state: x =>
              ['active', 'recorded', 'quarantined', 'abandoned'].includes(
                x as string,
              ),
            chip_id: x => x === null || text(x),
            created: integer,
            bind_receipt: x => x === null || text(x),
            disposition_json: x => x === null || text(x),
            disposition_receipt: x => x === null || text(x),
          }),
          provisioning_records: rows({
            attempt_id: text,
            installation_id: text,
            display_id: x => typeof x === 'string' && /^[0-9a-f]{4}$/.test(x),
            body_json: text,
            receipt_json: text,
            recorded_at: integer,
          }),
        }
      : {}),
    ...(version === 4 || version === 5
      ? {
          provisioning_batch_closures: rows({
            batch_id: positive,
            reason: x => x === 'operator-ended',
            next_ordinal: integer,
            closed_at: integer,
          }),
        }
      : {}),
    ...(version === 5
      ? {
          reset_intents: rows({
            reset_id: text,
            chip_id: text,
            installation_id: text,
            source_attempt_id: text,
            operator_id: positive,
            device_id: text,
            request_json: text,
            receipt_json: text,
            created: integer,
          }),
        }
      : {}),
  });
  const out = value as EscrowExport;
  const unique = <T>(items: readonly T[], key: (x: T) => unknown) => {
    const set = new Set(items.map(key));
    if (set.size !== items.length) fail();
    return set;
  };
  const operators = unique(out.operators, x => x.id);
  unique(out.operators, x => x.name);
  if (out.version === 3 || out.version === 4 || out.version === 5) {
    unique(out.operator_audit!, x => x.id);
    for (const e of out.operator_audit!)
      if (!operators.has(e.actor_id) || !operators.has(e.target_id)) fail();
  }
  unique(out.batches, x => x.id);
  unique(out.batches, x => x.ordinal_salt);
  unique(out.cards, x => x.short_id);
  unique(out.cap_releases, x => x.version);
  unique(out.cap_releases, x => x.sha256);
  const batches = new Map(out.batches.map(x => [x.id, x]));
  const keys = unique(out.keys, x => `${x.batch_id}:${x.ordinal}`);
  const counts = new Map<number, number>();
  for (const batch of out.batches)
    if (!operators.has(batch.operator_id)) fail();
  for (const key of out.keys) {
    const batch = batches.get(key.batch_id);
    if (!batch || key.ordinal >= batch.count) fail();
    counts.set(key.batch_id, (counts.get(key.batch_id) ?? 0) + 1);
  }
  for (const batch of out.batches)
    if (counts.get(batch.id) !== batch.count) fail();
  for (const card of out.cards)
    if (!keys.has(`${card.batch_id}:${card.ordinal}`)) fail();
  if (out.version === 1) return; // Legacy suffix records confer no reservations.
  const uuid = (x: unknown) =>
    typeof x === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      x,
    );
  const json = (value: string): Record<string, unknown> => {
    try {
      return object(JSON.parse(value));
    } catch {
      return fail();
    }
  };
  unique(out.provisioning_batches, x => x.batch_id);
  unique(out.provisioning_batches, x => x.request_id);
  const provisioningBatches = new Map(
    out.provisioning_batches.map(x => [x.batch_id, x]),
  );
  for (const row of out.provisioning_batches) {
    const batch = batches.get(row.batch_id);
    const config = json(row.config_json);
    shape(config, {
      count: positive,
      mint_url: text,
      pin_policy: x => x === 'batch' || x === 'perCard',
      daily_usd: money,
      no_pin_usd: money,
      load_sha256: hex(64),
      key_env: x => x === 'factory' || x === 'issued',
      configuration_revision: x => x === 1,
    });
    if (
      !batch ||
      !operators.has(row.operator_id) ||
      row.operator_id !== batch.operator_id ||
      !uuid(row.request_id) ||
      !uuid(row.device_id) ||
      row.next_ordinal > batch.count
    )
      fail();
    for (const field of [
      'count',
      'mint_url',
      'pin_policy',
      'daily_usd',
      'no_pin_usd',
      'load_sha256',
    ] as const)
      if (config[field] !== batch[field]) fail();
    if (config.key_env !== row.key_env) fail();
  }
  unique(out.provisioning_attempts, x => x.attempt_id);
  unique(out.provisioning_attempts, x => `${x.batch_id}:${x.ordinal}`);
  unique(
    out.provisioning_attempts.filter(x => x.state === 'active'),
    x => x.device_id,
  );
  unique(
    out.provisioning_attempts.filter(
      x => x.chip_id !== null && x.state !== 'recorded',
    ),
    x => x.chip_id,
  );
  const attempts = new Map(
    out.provisioning_attempts.map(x => [x.attempt_id, x]),
  );
  const reservedCounts = new Map<number, number>();
  for (const row of out.provisioning_attempts) {
    const batch = provisioningBatches.get(row.batch_id);
    if (
      !batch ||
      !uuid(row.attempt_id) ||
      row.operator_id !== batch.operator_id ||
      row.device_id !== batch.device_id ||
      row.ordinal >= batch.next_ordinal ||
      !keys.has(`${row.batch_id}:${row.ordinal}`)
    )
      fail();
    reservedCounts.set(
      row.batch_id,
      (reservedCounts.get(row.batch_id) ?? 0) + 1,
    );
    if (row.chip_id !== null) {
      try {
        assertChipId(row.chip_id);
      } catch {
        fail();
      }
      if (row.bind_receipt === null) fail();
      const receipt = json(row.bind_receipt!);
      shape(receipt, {
        attempt_id: uuid,
        chip_id: text,
        revision: positive,
        bound_at: integer,
      });
      if (
        receipt.attempt_id !== row.attempt_id ||
        receipt.chip_id !== row.chip_id ||
        (receipt.revision as number) > row.revision
      )
        fail();
    } else if (row.bind_receipt !== null) fail();
    if (row.state === 'quarantined' || row.state === 'abandoned') {
      if (row.disposition_json === null || row.disposition_receipt === null)
        fail();
      const disposition = json(row.disposition_json!);
      shape(disposition, {kind: x => x === row.state, reason: text});
      const receipt = json(row.disposition_receipt!);
      shape(receipt, {
        attempt_id: uuid,
        kind: x => x === row.state,
        reason: text,
        revision: positive,
        acknowledged_at: integer,
      });
      if (
        receipt.attempt_id !== row.attempt_id ||
        receipt.reason !== disposition.reason ||
        receipt.revision !== row.revision
      )
        fail();
    } else if (
      row.disposition_json !== null ||
      row.disposition_receipt !== null
    )
      fail();
    if (row.state === 'recorded' && row.chip_id === null) fail();
  }
  for (const row of out.provisioning_batches)
    if ((reservedCounts.get(row.batch_id) ?? 0) !== row.next_ordinal) fail();
  const recordedAttempts = unique(out.provisioning_records, x => x.attempt_id);
  unique(out.provisioning_records, x => x.installation_id);
  for (const row of out.provisioning_records) {
    const attempt = attempts.get(row.attempt_id);
    const batch = attempt && provisioningBatches.get(attempt.batch_id);
    const body = json(row.body_json);
    try {
      assertInstallationId(row.installation_id);
      assertCompletionRecord(body);
    } catch {
      fail();
    }
    if (
      !attempt ||
      !batch ||
      attempt.state !== 'recorded' ||
      row.display_id !== row.installation_id.slice(-4)
    )
      fail();
    for (const field of [
      'attempt_id',
      'batch_id',
      'ordinal',
      'operator_id',
      'device_id',
      'chip_id',
    ] as const)
      if (body[field] !== attempt[field]) fail();
    if (
      body.installation_id !== row.installation_id ||
      body.display_id !== row.display_id ||
      body.key_env !== batch.key_env ||
      body.load_sha256 !== batches.get(batch.batch_id)!.load_sha256
    )
      fail();
    // Wall-clock timestamps can move backward; revisions and identity establish
    // ordering. Preserve observed times rather than rejecting a valid snapshot.
    const receipt = json(row.receipt_json);
    shape(receipt, {
      attempt_id: uuid,
      installation_id: text,
      revision: positive,
      recorded_at: integer,
      verified_stage: x => x === 'rotated',
      ready_for_holder: x => x === false,
    });
    if (
      receipt.attempt_id !== row.attempt_id ||
      receipt.installation_id !== row.installation_id ||
      receipt.revision !== attempt.revision ||
      receipt.recorded_at !== row.recorded_at ||
      receipt.verified_stage !== body.verified_stage
    )
      fail();
  }
  for (const row of out.provisioning_attempts)
    if ((row.state === 'recorded') !== recordedAttempts.has(row.attempt_id))
      fail();
  if (out.version === 4 || out.version === 5) {
    unique(out.provisioning_batch_closures!, x => x.batch_id);
    for (const closure of out.provisioning_batch_closures!) {
      const batch = provisioningBatches.get(closure.batch_id);
      if (
        !batch ||
        closure.next_ordinal !== batch.next_ordinal ||
        out.provisioning_attempts.some(
          a => a.batch_id === closure.batch_id && a.state === 'active',
        )
      )
        fail();
    }
  }
  if (out.version === 5) {
    unique(out.reset_intents!, x => x.reset_id);
    unique(out.reset_intents!, x => x.chip_id);
    unique(out.reset_intents!, x => x.installation_id);
    unique(out.reset_intents!, x => x.source_attempt_id);
    unique(out.reset_intents!, x => x.device_id);
    for (const row of out.reset_intents!) {
      const source = out.provisioning_attempts.find(
        a => a.attempt_id === row.source_attempt_id,
      );
      const record = out.provisioning_records.find(
        r => r.attempt_id === row.source_attempt_id,
      );
      const request = json(row.request_json);
      try {
        assertResetRequest(request);
      } catch {
        fail();
      }
      const receipt = json(row.receipt_json) as unknown as ResetIntentReceipt;
      shape(receipt, {
        reset_id: text,
        source_attempt_id: text,
        chip_id: text,
        installation_id: text,
        operator_id: positive,
        device_id: text,
        authorized_at: integer,
      });
      if (
        !source ||
        source.state !== 'recorded' ||
        source.chip_id !== row.chip_id ||
        !record ||
        record.installation_id !== row.installation_id ||
        source.operator_id !== row.operator_id ||
        out.provisioning_attempts.some(
          a =>
            (a.chip_id === row.chip_id &&
              ['active', 'quarantined', 'abandoned'].includes(a.state)) ||
            (a.device_id === row.device_id && a.state === 'active'),
        ) ||
        !operators.has(row.operator_id) ||
        !uuid(row.device_id) ||
        row.request_json !== canonicalResetRequest(request) ||
        request.reset_id !== row.reset_id ||
        request.source_attempt_id !== row.source_attempt_id ||
        request.chip_id !== row.chip_id ||
        request.installation_id !== row.installation_id ||
        receipt.reset_id !== row.reset_id ||
        receipt.source_attempt_id !== row.source_attempt_id ||
        receipt.chip_id !== row.chip_id ||
        receipt.installation_id !== row.installation_id ||
        receipt.operator_id !== row.operator_id ||
        receipt.device_id !== row.device_id ||
        receipt.authorized_at !== row.created
      )
        fail();
    }
  }
}

/** Empty-service recovery only. Operators are disabled until controlled credential reset. */
export function restoreEscrowExport(db: SqlHandle, payload: unknown): void {
  validateEscrowExport(payload);
  db.transaction(() => {
    const control = db
      .prepare(
        'SELECT recovery_required FROM provisioning_control WHERE id = 1',
      )
      .get() as {recovery_required: number} | undefined;
    if (!control || control.recovery_required !== 0)
      throw new Error('recovery requires an empty service');
    for (const table of [
      'operator_audit',
      'operators',
      'sessions',
      'key_batches',
      'issued_keys',
      'cards',
      'cap_releases',
      'anchor_tip',
      'provisioning_batches',
      'provisioning_attempts',
      'provisioning_records',
      'provisioning_batch_closures',
      'reset_intents',
    ]) {
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
        throw new Error('recovery requires an empty service');
    }
    for (const r of payload.operators)
      db.prepare(
        'INSERT INTO operators (id, name, password_hash, key_env, created, disabled) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        r.id,
        r.name,
        '!recovery-disabled',
        r.key_env,
        r.created,
        r.disabled ?? 0,
      );
    if (payload.version === 3 || payload.version === 4 || payload.version === 5)
      for (const e of payload.operator_audit!)
        db.prepare(
          'INSERT INTO operator_audit (id,actor_id,target_id,action,created) VALUES (?,?,?,?,?)',
        ).run(e.id, e.actor_id, e.target_id, e.action, e.created);
    for (const r of payload.batches)
      db.prepare(
        'INSERT INTO key_batches (id, ordinal_salt, count, mint_url, pin_policy, pin_batch, daily_usd, no_pin_usd, load_sha256, operator_id, created) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
      ).run(
        r.id,
        Buffer.from(r.ordinal_salt, 'hex'),
        r.count,
        r.mint_url,
        r.pin_policy,
        r.daily_usd,
        r.no_pin_usd,
        r.load_sha256,
        r.operator_id,
        r.created,
      );
    for (const r of payload.keys)
      db.prepare('INSERT INTO issued_keys VALUES (?, ?, ?, ?, ?, ?)').run(
        r.batch_id,
        r.ordinal,
        Buffer.from(r.enc, 'hex'),
        Buffer.from(r.mac, 'hex'),
        Buffer.from(r.dek, 'hex'),
        r.escrowed_at,
      );
    for (const r of payload.cards)
      db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        r.short_id,
        r.batch_id,
        r.key_id,
        r.ordinal,
        r.installed_at,
        r.installer,
        r.load_sha256,
      );
    if (
      payload.version === 2 ||
      payload.version === 3 ||
      payload.version === 4 ||
      payload.version === 5
    ) {
      for (const r of payload.provisioning_batches)
        db.prepare(
          'INSERT INTO provisioning_batches (batch_id, request_id, operator_id, device_id, config_json, key_env, next_ordinal, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          r.batch_id,
          r.request_id,
          r.operator_id,
          r.device_id,
          r.config_json,
          r.key_env,
          r.next_ordinal,
          r.created,
        );
      for (const r of payload.provisioning_attempts)
        db.prepare(
          'INSERT INTO provisioning_attempts (attempt_id, batch_id, ordinal, operator_id, device_id, revision, state, chip_id, created, bind_receipt, disposition_json, disposition_receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          r.attempt_id,
          r.batch_id,
          r.ordinal,
          r.operator_id,
          r.device_id,
          r.revision,
          r.state,
          r.chip_id,
          r.created,
          r.bind_receipt,
          r.disposition_json,
          r.disposition_receipt,
        );
      for (const r of payload.provisioning_records)
        db.prepare(
          'INSERT INTO provisioning_records (attempt_id, installation_id, display_id, body_json, receipt_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          r.attempt_id,
          r.installation_id,
          r.display_id,
          r.body_json,
          r.receipt_json,
          r.recorded_at,
        );
      if (payload.version === 4 || payload.version === 5)
        for (const r of payload.provisioning_batch_closures!)
          db.prepare(
            'INSERT INTO provisioning_batch_closures (batch_id, reason, next_ordinal, closed_at) VALUES (?, ?, ?, ?)',
          ).run(r.batch_id, r.reason, r.next_ordinal, r.closed_at);
    }
    if (payload.version === 5)
      for (const r of payload.reset_intents!)
        db.prepare('INSERT INTO reset_intents VALUES (?,?,?,?,?,?,?,?,?)').run(
          r.reset_id,
          r.chip_id,
          r.installation_id,
          r.source_attempt_id,
          r.operator_id,
          r.device_id,
          r.request_json,
          r.receipt_json,
          r.created,
        );
    for (const r of payload.cap_releases)
      db.prepare('INSERT INTO cap_releases VALUES (?, ?, ?)').run(
        r.version,
        r.sha256,
        r.created,
      );
    // A backup may predate phone-side intents. Never recreate or issue against
    // that uncertainty until the operator reconciles outstanding reservations.
    db.prepare(
      'UPDATE provisioning_control SET recovery_required = 1 WHERE id = 1',
    ).run();
  });
}
