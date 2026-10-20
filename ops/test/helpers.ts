/**
 * Shared test wiring: an in-memory DB with a fixed master and clock, over the
 * better-sqlite3 backend — and, in `testDoDb`, the same over the DO adapter
 * backed by a real SQLite engine, so every seam-facing module is exercised on
 * both backends (the Workers port's guarantee). The DO fake is a real SQLite
 * file behind the SqlStorage shape — not a mock that agrees with the adapter
 * by construction.
 */
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {openSqlStorage} from '../src/sql-do';
import type {SqlStorageLike} from '../src/sql-do';

export const TEST_MASTER = Buffer.alloc(32, 0x5a);

let counter = 0;

function nextRandom(): (n: number) => Buffer {
  const c = ++counter;
  return n => {
    // deterministic but distinct per call
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      buf[i] = (c * 7 + i * 13 + 1) & 0xff;
    }
    return buf;
  };
}

export function testDb(): OpsDb {
  return new OpsDb({
    sql: openSqliteFile(':memory:'),
    randomBytes: nextRandom(),
    now: () => 1_700_000_000,
    master: {getMaster: () => TEST_MASTER},
  });
}

type SqliteDb = import('better-sqlite3').Database;

/** A real in-memory SQLite behind the DO storage's shape. */
function sqliteMemory(): SqliteDb {
  const Database = require('better-sqlite3') as new (p: string) => SqliteDb;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

/** The SqlStorage stand-in: SELECT answers rows, anything else answers rowsWritten. */
export function doStorage(): SqlStorageLike {
  const db = sqliteMemory();
  return {
    sql: {
      exec(query: string, ...params: unknown[]) {
        const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(query);
        if (isSelect) {
          const rows = db.prepare(query).all(...toBuffers(params)) as Record<
            string,
            unknown
          >[];
          return {toArray: () => rows, rowsWritten: 0};
        }
        const info = db.prepare(query).run(...toBuffers(params));
        return {toArray: () => [], rowsWritten: Number(info.changes)};
      },
    },
    transactionSync<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}

function toBuffers(params: unknown[]): unknown[] {
  return params.map(p =>
    Buffer.isBuffer(p) || typeof p !== 'object' || p === null
      ? p
      : Buffer.from(p as Uint8Array),
  );
}

/** OpsDb over the DO adapter — the same modules, the second backend. */
export function testDoDb(): OpsDb {
  return new OpsDb({
    sql: openSqlStorage(doStorage()),
    randomBytes: nextRandom(),
    now: () => 1_700_000_000,
    master: {getMaster: () => TEST_MASTER},
  });
}
