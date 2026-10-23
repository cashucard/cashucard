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
  // 4. Operator/device reservations and immutable installation history (D31).
  `
  CREATE TABLE provisioning_control (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    recovery_required INTEGER NOT NULL DEFAULT 0 CHECK (recovery_required IN (0, 1))
  );
  INSERT INTO provisioning_control (id, recovery_required) VALUES (1, 0);
  CREATE TABLE provisioning_batches (
    batch_id INTEGER PRIMARY KEY REFERENCES key_batches(id),
    request_id TEXT NOT NULL UNIQUE,
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    device_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    key_env TEXT NOT NULL CHECK (key_env IN ('factory', 'issued')),
    next_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_ordinal >= 0),
    created INTEGER NOT NULL
  );
  CREATE TABLE provisioning_attempts (
    attempt_id TEXT PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES provisioning_batches(batch_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    device_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    state TEXT NOT NULL CHECK (state IN ('active', 'recorded', 'quarantined', 'abandoned')),
    chip_id TEXT,
    created INTEGER NOT NULL,
    bind_receipt TEXT,
    disposition_json TEXT,
    disposition_receipt TEXT,
    UNIQUE (batch_id, ordinal)
  );
  CREATE UNIQUE INDEX provisioning_active_device ON provisioning_attempts(device_id) WHERE state = 'active';
  CREATE UNIQUE INDEX provisioning_blocked_chip ON provisioning_attempts(chip_id) WHERE chip_id IS NOT NULL AND state IN ('active', 'quarantined', 'abandoned');
  CREATE TABLE provisioning_records (
    attempt_id TEXT PRIMARY KEY REFERENCES provisioning_attempts(attempt_id),
    installation_id TEXT NOT NULL UNIQUE,
    display_id TEXT NOT NULL,
    body_json TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  `,
  // 5. Recovery companion credentials are independent of operator sessions.
  `
  CREATE TABLE recovery_connections (
    id TEXT PRIMARY KEY,
    issuer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    approved_by INTEGER NOT NULL REFERENCES operators(id),
    created INTEGER NOT NULL,
    revoked INTEGER
  );
  CREATE TABLE recovery_pairings (
    code_hash TEXT PRIMARY KEY,
    issuer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    approved_by INTEGER NOT NULL REFERENCES operators(id),
    expires INTEGER NOT NULL,
    connection_id TEXT REFERENCES recovery_connections(id)
  );
  `,
  // 6. Copy attestation is separately granted; old readers stay read-only.
  `
  ALTER TABLE recovery_connections ADD COLUMN can_attest INTEGER NOT NULL DEFAULT 0 CHECK (can_attest IN (0, 1));
  ALTER TABLE recovery_connections ADD COLUMN attestation_approved_by INTEGER REFERENCES operators(id);
  CREATE TABLE recovery_copy_receipts (
    connection_id TEXT PRIMARY KEY REFERENCES recovery_connections(id),
    issuer_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    exported_at INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    received_at INTEGER NOT NULL
  );
  `,
  // 7. Preserve operator identity/history while revoking access administratively.
  `ALTER TABLE operators ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));
   CREATE TABLE operator_audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     actor_id INTEGER NOT NULL REFERENCES operators(id),
     target_id INTEGER NOT NULL REFERENCES operators(id),
     action TEXT NOT NULL CHECK (action IN ('create','disable','enable','reset-password')),
     created INTEGER NOT NULL
   );`,
  // 8. Immutable batch closure fences unused, pre-escrowed ordinals.
  `CREATE TABLE provisioning_batch_closures (
     batch_id INTEGER PRIMARY KEY REFERENCES provisioning_batches(batch_id),
     reason TEXT NOT NULL CHECK (reason = 'operator-ended'),
     next_ordinal INTEGER NOT NULL CHECK (next_ordinal >= 0),
     closed_at INTEGER NOT NULL
   );`,
  // 9. Card-specific reset authorization remains fenced until a result is reconciled.
  `CREATE TABLE reset_intents (
     reset_id TEXT PRIMARY KEY,
     chip_id TEXT NOT NULL,
     installation_id TEXT NOT NULL UNIQUE,
     source_attempt_id TEXT NOT NULL UNIQUE REFERENCES provisioning_attempts(attempt_id),
     operator_id INTEGER NOT NULL REFERENCES operators(id),
     device_id TEXT NOT NULL,
     request_json TEXT NOT NULL,
     receipt_json TEXT NOT NULL,
     created INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX reset_intent_chip ON reset_intents(chip_id);
   CREATE UNIQUE INDEX reset_intent_device ON reset_intents(device_id);`,
  // 10. Preserve completed resets and release only their admission fences.
  `CREATE TABLE reset_results (
     reset_id TEXT PRIMARY KEY REFERENCES reset_intents(reset_id),
     body_json TEXT NOT NULL,
     receipt_json TEXT NOT NULL,
     completed_at INTEGER NOT NULL
   );
   DROP INDEX reset_intent_chip;
   DROP INDEX reset_intent_device;`,
];

export interface DbOptions {
  /** Opt-in: require a verified independent copy for this issuer before issuance. */
  readonly independentBackupIssuer?: string;
  /** Live runtime binding source; do not cache configuration-derived policy. */
  readonly independentBackupIssuerSource?: () => string | undefined;
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
  private readonly backupIssuerSource: () => string | undefined;

  get independentBackupIssuer(): string | undefined {
    const value = this.backupIssuerSource();
    if (
      value !== undefined &&
      (typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          value,
        ))
    )
      throw new Error('invalid independent backup issuer');
    return value;
  }

  constructor(options: DbOptions) {
    if (
      options.independentBackupIssuerSource &&
      options.independentBackupIssuer !== undefined
    )
      throw new Error('ambiguous independent backup policy source');
    this.backupIssuerSource =
      options.independentBackupIssuerSource ??
      (() => options.independentBackupIssuer);
    void this.independentBackupIssuer; // Validate at startup and again on every use.
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
