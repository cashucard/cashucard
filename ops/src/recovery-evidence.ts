/** Issuer-side validation. Receipts assert read-back by a trusted scoped copier. */
import type {OpsDb} from './db';

export interface SourceMetadata {
  exported_at: number;
  sha256: string;
  bytes: number;
}
export function sourceMetadata(
  metadata: Record<string, string> | undefined,
  size: number,
  now: number,
): SourceMetadata | null {
  if (!metadata || metadata.version !== '1') return null;
  const {exported_at, ciphertext_bytes, ciphertext_sha256} = metadata;
  if (
    !/^[1-9][0-9]*$/.test(exported_at ?? '') ||
    !/^[1-9][0-9]*$/.test(ciphertext_bytes ?? '') ||
    !/^[0-9a-f]{64}$/.test(ciphertext_sha256 ?? '')
  )
    return null;
  const time = Number(exported_at),
    bytes = Number(ciphertext_bytes);
  if (
    !Number.isSafeInteger(time) ||
    time > now ||
    !Number.isSafeInteger(bytes) ||
    bytes !== size ||
    bytes > 256 * 1024 * 1024
  )
    return null;
  return {exported_at: time, bytes, sha256: ciphertext_sha256!};
}

export function saveCopyReceipt(
  db: OpsDb,
  connection: string,
  issuer: string,
  key: string,
  source: SourceMetadata,
): boolean {
  return db.db.transaction(() => {
    const allowed = db.db
      .prepare(
        'SELECT 1 FROM recovery_connections WHERE id = ? AND issuer_id = ? AND can_attest = 1 AND revoked IS NULL',
      )
      .get(connection, issuer);
    if (!allowed) return false;
    db.db
      .prepare(
        `INSERT INTO recovery_copy_receipts
      (connection_id, issuer_id, object_key, exported_at, sha256, bytes, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET object_key = excluded.object_key,
      exported_at = excluded.exported_at, sha256 = excluded.sha256,
      bytes = excluded.bytes, received_at = excluded.received_at
      WHERE excluded.exported_at > recovery_copy_receipts.exported_at`,
      )
      .run(
        connection,
        issuer,
        key,
        source.exported_at,
        source.sha256,
        source.bytes,
        db.now(),
      );
    return true;
  });
}

export class BackupFreshnessError extends Error {
  constructor() {
    super('independent-backup-stale');
  }
}

/** Unix seconds; copy/receipt time never extends the source snapshot lifetime. */
export function independentBackupHealth(db: OpsDb) {
  const issuer = db.independentBackupIssuer;
  if (!issuer) return {required: false, stale: true, exported_at: null};
  const row = db.db
    .prepare(
      `SELECT MAX(r.exported_at) AS exported_at
    FROM recovery_copy_receipts r JOIN recovery_connections c ON c.id = r.connection_id
    WHERE r.issuer_id = ? AND c.issuer_id = ? AND c.can_attest = 1
      AND c.revoked IS NULL AND r.exported_at > 0 AND r.exported_at <= ?`,
    )
    .get(issuer, issuer, db.now()) as {exported_at: number | null};
  const time = row.exported_at;
  return {
    required: true,
    stale: time === null || db.now() - time >= 86400,
    exported_at: time,
  };
}
export function assertIndependentBackup(db: OpsDb): void {
  const health = independentBackupHealth(db);
  if (health.required && health.stale) throw new BackupFreshnessError();
}
