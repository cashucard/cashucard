/** Read-only escrow provenance lookup. No manager keys leave this boundary. */
import type {OpsDb} from './db';
import {assertChipId, assertInstallationId} from './provisioning';

export type ResetSourceLookup =
  | {status: 'missing' | 'unresolved' | 'escrow-missing' | 'reset-completed'}
  | {
      status: 'found';
      source: {
        attemptId: string;
        batchId: number;
        ordinal: number;
        keySourceRef: string;
      };
    };

/**
 * Match both public identities to one recorded install and its escrow row.
 * A later unresolved attempt on this chip wins over an older record. A match
 * says where the keys were stored, not that they are currently active on card.
 */
export function findResetSource(
  db: OpsDb,
  chipId: string,
  installationId: string,
): ResetSourceLookup {
  assertChipId(chipId);
  assertInstallationId(installationId);
  const unresolved = db.db
    .prepare(
      "SELECT 1 FROM provisioning_attempts WHERE chip_id = ? AND state IN ('active','quarantined','abandoned') AND fence_released = 0 LIMIT 1",
    )
    .get(chipId);
  if (unresolved) return {status: 'unresolved'};
  if (
    db.db
      .prepare(
        `SELECT 1 FROM reset_intents i JOIN reset_results r ON r.reset_id = i.reset_id
    WHERE i.chip_id = ? AND i.installation_id = ?`,
      )
      .get(chipId, installationId)
  )
    return {status: 'reset-completed'};
  const row = db.db
    .prepare(
      `SELECT a.attempt_id, a.batch_id, a.ordinal,
              CASE WHEN k.batch_id IS NULL THEN 0 ELSE 1 END AS has_escrow
       FROM provisioning_records r
       JOIN provisioning_attempts a ON a.attempt_id = r.attempt_id
       LEFT JOIN issued_keys k ON k.batch_id = a.batch_id AND k.ordinal = a.ordinal
       WHERE a.chip_id = ? AND r.installation_id = ? AND a.state = 'recorded'`,
    )
    .get(chipId, installationId) as
    | {
        attempt_id: string;
        batch_id: number;
        ordinal: number;
        has_escrow: number;
      }
    | undefined;
  if (!row) return {status: 'missing'};
  if (!row.has_escrow) return {status: 'escrow-missing'};
  return {
    status: 'found',
    source: {
      attemptId: row.attempt_id,
      batchId: row.batch_id,
      ordinal: row.ordinal,
      keySourceRef: `escrow:${row.attempt_id}`,
    },
  };
}
