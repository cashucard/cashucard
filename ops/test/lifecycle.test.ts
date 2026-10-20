import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';

test('closing OpsDb releases its native SQLite connection', () => {
  const db = new OpsDb({sql: openSqliteFile(':memory:')});
  const statement = db.db.prepare('SELECT version FROM schema_version');
  assert.ok(statement.get());
  db.close();
  assert.throws(() => statement.get(), /not open|closed/i);
  assert.throws(() => db.db.prepare('SELECT 1'), /not open|closed/i);
  // Cleanup paths can converge on the same handle.
  assert.doesNotThrow(() => db.close());
});

test('a fresh local database creates its missing parent directories', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ops-fresh-db-'));
  try {
    const db = new OpsDb({
      sql: openSqliteFile(join(scratch, 'data', 'ops.db')),
    });
    try {
      assert.ok(db.db.prepare('SELECT version FROM schema_version').get());
    } finally {
      db.close();
    }
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
});
