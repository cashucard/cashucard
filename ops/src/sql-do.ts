/**
 * The Durable Object backend of the DB seam (the ENG-740 Workers amendment):
 * `ctx.storage.sql` — the DO's embedded SQLite, single-threaded by the
 * runtime, transactional via `transactionSync`. No node:fs, no file path: the
 * database IS the object's storage, with PITR the platform gives.
 *
 * `exec` cannot carry BEGIN/COMMIT on SqlStorage, so the migrations' ordered
 * strings are split on `;` at this boundary — the schema is DDL whose
 * statements never contain a semicolon inside a string literal (the CHECK
 * constraints name bare words only), which this split relies on.
 *
 * `changes` comes off the cursor's `rowsWritten` (the one write-counting
 * signal SqlStorage gives; `lastInsertRowid` has no portable read, so the two
 * callers that need a fresh row's id — bootstrap and batch creation — read it
 * back by its natural key, and the seam says so at the call sites).
 */
import type {SqlHandle, SqlRunResult, SqlStatement} from './sql';

/**
 * The slice of SqlStorage this adapter uses. The real `SqlStorage` carries
 * `exec` only — the transaction lives on `DurableObjectStorage`
 * (`transactionSync`) — so the adapter takes the DO's storage object, not the
 * bare SQL handle; both shapes are structurally satisfiable in tests.
 */
export interface SqlStorageLike {
  sql: {
    exec(
      query: string,
      ...params: unknown[]
    ): {toArray(): Record<string, unknown>[]; rowsWritten: number};
  };
  transactionSync<T>(fn: () => T): T;
}

export function openSqlStorage(storage: SqlStorageLike): SqlHandle {
  const sql = storage.sql;
  return {
    prepare(query: string): SqlStatement {
      return {
        get: (...params) =>
          normalizeRows(sql.exec(query, ...params).toArray())[0],
        all: (...params) => normalizeRows(sql.exec(query, ...params).toArray()),
        run: (...params): SqlRunResult => {
          const cursor = sql.exec(query, ...params);
          cursor.toArray(); // drain: the write lands when the cursor is consumed
          return {changes: cursor.rowsWritten, lastInsertRowid: 0};
        },
      };
    },
    exec: multi => {
      for (const stmt of splitStatements(multi)) {
        if (stmt.trim() !== '') {
          sql.exec(stmt);
        }
      }
    },
    transaction: fn => storage.transactionSync(fn),
  };
}

/** Expose the same BLOB shape as the Node adapter at the storage boundary. */
function normalizeRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof ArrayBuffer ? Buffer.from(value) : value,
      ]),
    ),
  );
}

/** Splits a multi-statement string on `;` — safe for the migrations' DDL. */
export function splitStatements(multi: string): string[] {
  return multi.split(';');
}
