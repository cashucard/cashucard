/**
 * The one SQLite DB (D29) and its forward-only migrations, as ordered SQL
 * strings. One writer: on the Node side, the service process; on Workers, the
 * Durable Object (single-threaded by the runtime). The storage backend is the
 * DB seam (sql.ts): better-sqlite3 in dev (`sqlite-file.ts`), the DO's
 * ctx.storage.sql deployed (`sql-do.ts`) — the tests run against either.
 *
 * Escrow and issuance are the same write by construction: createBatch derives
 * every key set and inserts batch + key rows in one transaction (a forced
 * failure between them leaves no row — ops/test/db.test.ts proves it, not
 * just states it).
 */
import {randomBytes} from 'node:crypto';

import type {TipStore} from './anchor';
import type {SqlHandle} from './sql';

/** The migrations, in order, forward-only. Never edit one; append the next. */
export const MIGRATIONS: readonly string[] = [
  // 1. the v1 schema
  `
  CREATE TABLE operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    key_env TEXT NOT NULL CHECK (key_env IN ('factory', 'issued')),
    created INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    principal_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('operator', 'holder')),
    env TEXT NOT NULL CHECK (env IN ('factory', 'issued')),
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created INTEGER NOT NULL
  );
  CREATE TABLE key_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ordinal_salt BLOB NOT NULL UNIQUE,
    count INTEGER NOT NULL CHECK (count > 0),
    mint_url TEXT NOT NULL,
    pin_policy TEXT NOT NULL CHECK (pin_policy IN ('batch', 'perCard')),
    pin_batch TEXT,
    daily_usd REAL NOT NULL,
    no_pin_usd REAL NOT NULL,
    load_sha256 TEXT NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    created INTEGER NOT NULL
  );
  CREATE TABLE issued_keys (
    batch_id INTEGER NOT NULL REFERENCES key_batches(id),
    ordinal INTEGER NOT NULL,
    enc BLOB NOT NULL CHECK (length(enc) = 16),
    mac BLOB NOT NULL CHECK (length(mac) = 16),
    dek BLOB NOT NULL CHECK (length(dek) = 16),
    escrowed_at INTEGER NOT NULL,
    PRIMARY KEY (batch_id, ordinal)
  );
  CREATE TABLE cards (
    short_id TEXT PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES key_batches(id),
    key_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    installed_at INTEGER NOT NULL,
    installer TEXT NOT NULL,
    load_sha256 TEXT NOT NULL
  );
  CREATE TABLE cap_releases (
    version TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL
  );
  CREATE TABLE anchor_tip (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    header BLOB NOT NULL CHECK (length(header) = 80),
    fetched_at INTEGER NOT NULL
  );
  `,
  // 2. the anchor tip's height: the last-good row the feed seeds from at boot
  // needs the block height alongside the header, or the seeded feed cannot
  // answer the tip's {header, height, fetched_at} shape.
  `
  ALTER TABLE anchor_tip ADD COLUMN height INTEGER;
  `,
  // 3. Persist the pre-hash login work budget across object eviction/restart.
  `
  CREATE TABLE login_attempt_budget (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0)
  );
  `,
];

export interface DbOptions {
  /**
   * The DB seam. On Node: `openSqliteFile(path)` — ':memory:' for tests.
   * On Workers: `openSqlStorage(ctx.storage.sql)` inside the DO.
   */
  readonly sql: SqlHandle;
  /** Deterministic randomness for tests; node's randomBytes in production. */
  readonly randomBytes?: (n: number) => Buffer;
  /** Wall clock, seconds; injectable for tests. */
  readonly now?: () => number;
  /** The master source (the KMS seam); the env secret in production. */
  readonly master?: {getMaster(): Buffer};
}

export class OpsDb {
  readonly db: SqlHandle;
  readonly randomBytes: (n: number) => Buffer;
  readonly now: () => number;
  readonly master?: {getMaster(): Buffer};

  constructor(options: DbOptions) {
    this.db = options.sql;
    this.randomBytes =
      options.randomBytes ?? (n => Buffer.from(randomBytes(n)));
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.master = options.master;
    this.migrate();
  }

  /** Applies every migration this process has not yet applied, in order. */
  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)',
    );
    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      {version: number} | undefined;
    let current = row ? row.version : 0;
    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      // The seam's transaction runs fn atomically and immediately; the
      // version bump is inside it, so a failed exec rolls both back.
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
      });
      current = v + 1;
    }
  }

  close(): void {
    // Node owns its native handle; Durable Object storage belongs to the runtime.
    this.db.close?.();
  }

  /**
   * The anchor feed's last-good store, over the `anchor_tip` table (one row,
   * id = 1). Write-on-fetch, read-at-boot: a restart keeps the header the
   * 503 fallback answers with instead of silently forgetting it.
   */
  tipStore(): TipStore {
    const read = this.db.prepare(
      'SELECT header, height, fetched_at FROM anchor_tip WHERE id = 1',
    );
    const write = this.db.prepare(
      `INSERT INTO anchor_tip (id, header, height, fetched_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET header = excluded.header, height = excluded.height, fetched_at = excluded.fetched_at`,
    );
    return {
      read: () => {
        const r = read.get() as
          | {header: Buffer; height: number | null; fetched_at: number}
          | undefined;
        if (!r || !Buffer.isBuffer(r.header)) {
          return undefined;
        }
        // A row written before migration 2 has height NULL — and no height
        // means the seeded feed cannot answer the {header, height,
        // fetched_at} shape, so it seeds NOTHING (the next good fetch
        // repopulates the row). The Buffer check covers a legacy row whose
        // header column ever stopped being a BLOB.
        if (r.height === null || !Number.isInteger(r.height) || r.height <= 0) {
          return undefined;
        }
        return {
          header: r.header,
          height: r.height,
          fetchedAt: r.fetched_at,
        };
      },
      write: tip => {
        write.run(tip.header, tip.height, tip.fetchedAt);
      },
    };
  }
}
