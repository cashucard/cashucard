/**
 * The better-sqlite3 backend of the DB seam — the Node dev/ops-cli side. The
 * file lives where the deploy runbook points; ':memory:' for tests.
 */
import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

import type {SqlHandle, SqlStatement} from './sql';

export function openSqliteFile(path: string): SqlHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  }
  const db = new Database(path);
  // One-writer discipline, like the session DBs; foreign keys so a stray
  // batch_id is an error at the INSERT, not silent.
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  return {
    close: () => {
      if (db.open) db.close();
    },
    prepare(sql: string): SqlStatement {
      const stmt = db.prepare(sql);
      return {
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params),
        run: (...params) => {
          const info = stmt.run(...params) as {
            changes: number;
            lastInsertRowid: number | bigint;
          };
          return {changes: info.changes, lastInsertRowid: info.lastInsertRowid};
        },
      };
    },
    exec: sql => db.exec(sql),
    transaction: fn => db.transaction(fn)(), // run it now; returns fn's result
  };
}
