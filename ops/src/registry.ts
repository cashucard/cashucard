/**
 * The registries: cards (idempotent upsert per the PROVISIONER-APP S4 retry
 * contract) and cap releases (version + sha256 pin).
 *
 * The card row's retry contract (ops/test/registry.test.ts): an identical
 * body re-posted returns 200 with the stored row; a different body for an
 * existing short_id is a 409. Two concurrent operators upsert to one row —
 * the INSERT OR IGNORE + read-back below does that under SQLite's single
 * writer without an application-level lock.
 */
import {OpsDb} from './db';

export interface CardRow {
  readonly short_id: string;
  readonly batch_id: number;
  readonly key_id: number;
  readonly ordinal: number;
  readonly installed_at: number;
  readonly installer: string;
  readonly load_sha256: string;
}

export interface CardInput {
  readonly short_id: string;
  readonly batch_id: number;
  readonly key_id: number;
  readonly ordinal: number;
  readonly installed_at: number;
  readonly installer: string;
  readonly load_sha256: string;
}

export type UpsertResult =
  | {kind: 'created'; row: CardRow}
  | {kind: 'stored'; row: CardRow} // identical re-post
  | {kind: 'conflict'};

export function recordCard(db: OpsDb, input: CardInput): UpsertResult {
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      throw new RegistryError(`${field} is required`);
    }
  }
  if (!/^[0-9a-f]{1,16}$/.test(input.short_id)) {
    throw new RegistryError('short_id is hex, 1..16 chars');
  }
  if (typeof input.installer !== 'string' || input.installer === '') {
    throw new RegistryError('installer is a non-empty string');
  }
  const existing = db.db
    .prepare('SELECT * FROM cards WHERE short_id = ?')
    .get(input.short_id) as CardRow | undefined;
  if (existing) {
    return sameRow(existing, input)
      ? {kind: 'stored', row: existing}
      : {kind: 'conflict'};
  }
  // The batch must exist before we INSERT: with foreign keys ON a stray
  // batch_id reaches the INSERT's FK constraint, which the router rethrows
  // as a bare 500 — a client-side typo must not read as an internal error
  // (and, in the provisioner's outbox, a 5xx retries forever). Checked after
  // the existing-row branch so a changed batch on a stored short_id stays a
  // 409 conflict, the retry contract's answer, not a 400.
  const batch = db.db
    .prepare('SELECT id FROM key_batches WHERE id = ?')
    .get(input.batch_id) as {id: number} | undefined;
  if (!batch) {
    throw new RegistryError(`no such batch ${input.batch_id}`);
  }
  const info = db.db
    .prepare(
      `INSERT OR IGNORE INTO cards
       (short_id, batch_id, key_id, ordinal, installed_at, installer, load_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.short_id,
      input.batch_id,
      input.key_id,
      input.ordinal,
      input.installed_at,
      input.installer,
      input.load_sha256,
    );
  if (info.changes === 0) {
    // Another writer won the race between our read and our insert: re-read
    // and apply the same identical/changed rule.
    const raced = db.db
      .prepare('SELECT * FROM cards WHERE short_id = ?')
      .get(input.short_id) as CardRow;
    return sameRow(raced, input)
      ? {kind: 'stored', row: raced}
      : {kind: 'conflict'};
  }
  return {kind: 'created', row: input};
}

/** Identity for the retry contract: every field equal; installer compares case-sensitively, sha256 hex case-insensitively. */
function sameRow(a: CardRow, b: CardInput): boolean {
  return (
    a.batch_id === b.batch_id &&
    a.key_id === b.key_id &&
    a.ordinal === b.ordinal &&
    a.installed_at === b.installed_at &&
    a.installer === b.installer &&
    a.load_sha256.toLowerCase() === b.load_sha256.toLowerCase()
  );
}

export function listCards(db: OpsDb, batchId: number): CardRow[] {
  return db.db
    .prepare('SELECT * FROM cards WHERE batch_id = ? ORDER BY installed_at')
    .all(batchId) as CardRow[];
}

/** The stored row for a short id, or undefined; the 409 body's `stored`. */
export function getCard(db: OpsDb, shortId: string): CardRow | undefined {
  return db.db
    .prepare('SELECT * FROM cards WHERE short_id = ?')
    .get(shortId) as CardRow | undefined;
}

export class RegistryError extends Error {}

export interface CapReleaseRow {
  readonly version: string;
  readonly sha256: string;
  readonly created: number;
}

export function addCapRelease(
  db: OpsDb,
  version: string,
  sha256: string,
): CapReleaseRow {
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    throw new RegistryError('version is [0-9A-Za-z._-]+');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) {
    throw new RegistryError('sha256 is 64 hex chars');
  }
  const created = db.now();
  try {
    db.db
      .prepare(
        'INSERT INTO cap_releases (version, sha256, created) VALUES (?, ?, ?)',
      )
      .run(version, sha256.toLowerCase(), created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      throw new RegistryError('this version or sha256 is already pinned');
    }
    throw e;
  }
  return {version, sha256: sha256.toLowerCase(), created};
}

export function listCapReleases(db: OpsDb): CapReleaseRow[] {
  return db.db
    .prepare('SELECT * FROM cap_releases ORDER BY created')
    .all() as CapReleaseRow[];
}
