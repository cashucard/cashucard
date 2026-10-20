/**
 * Versioned age-encrypted service recovery snapshot. Includes escrow keys and
 * the metadata needed to find them by card ID without the derivation master.
 * No PINs, password hashes, sessions or master leave the database. This is a
 * fleet recovery artifact, not a signed partner custody export.
 */
import * as age from 'age-encryption';

import type {SqlHandle} from './sql';
import type {CardRow, CapReleaseRow} from './registry';

export interface EscrowRow {
  readonly batch_id: number;
  readonly ordinal: number;
  readonly enc: string; // hex
  readonly mac: string;
  readonly dek: string;
  readonly escrowed_at: number;
}

/** Recovery metadata only: passwords, sessions, PINs and the master are excluded. */
export interface RecoveryOperator {
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
export interface EscrowExport {
  readonly version: 1;
  readonly exported_at: number;
  readonly operators: readonly RecoveryOperator[];
  readonly batches: readonly RecoveryBatch[];
  readonly keys: readonly EscrowRow[];
  readonly cards: readonly CardRow[];
  readonly cap_releases: readonly CapReleaseRow[];
}

export interface ExportResult {
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
        version: 1 as const,
        exported_at: now,
        operators: db
          .prepare(
            'SELECT id, name, key_env, created FROM operators ORDER BY id',
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
        keys: readEscrow(db),
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
  return {armored, bytes: bytes.length};
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
  const fail = (): never => {
    throw new Error('invalid recovery export');
  };
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
  shape(value, {
    version: x => x === 1,
    exported_at: integer,
    operators: rows({
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
  });
  const out = value as EscrowExport;
  const unique = <T>(items: readonly T[], key: (x: T) => unknown) => {
    const set = new Set(items.map(key));
    if (set.size !== items.length) fail();
    return set;
  };
  const operators = unique(out.operators, x => x.id);
  unique(out.operators, x => x.name);
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
}

/** Empty-service recovery only. Operators are disabled until controlled credential reset. */
export function restoreEscrowExport(db: SqlHandle, payload: unknown): void {
  validateEscrowExport(payload);
  db.transaction(() => {
    for (const table of [
      'operators',
      'sessions',
      'key_batches',
      'issued_keys',
      'cards',
      'cap_releases',
      'anchor_tip',
    ]) {
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
        throw new Error('recovery requires an empty service');
    }
    for (const r of payload.operators)
      db.prepare(
        'INSERT INTO operators (id, name, password_hash, key_env, created) VALUES (?, ?, ?, ?, ?)',
      ).run(r.id, r.name, '!recovery-disabled', r.key_env, r.created);
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
    for (const r of payload.cap_releases)
      db.prepare('INSERT INTO cap_releases VALUES (?, ?, ?)').run(
        r.version,
        r.sha256,
        r.created,
      );
  });
}
