import type {OpsDb} from './db';

/** All callers hold the service transaction while making admission decisions. */
export function hasPendingReset(
  db: OpsDb,
  kind: 'chip' | 'device',
  id: string,
): boolean {
  const column = kind === 'chip' ? 'chip_id' : 'device_id';
  return !!db.db
    .prepare(
      `SELECT 1 FROM reset_intents i LEFT JOIN reset_results r ON r.reset_id = i.reset_id
    WHERE i.${column} = ? AND r.reset_id IS NULL LIMIT 1`,
    )
    .get(id);
}
