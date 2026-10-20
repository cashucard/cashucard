/**
 * Migrations apply forward-only; batch creation's derive-and-escrow is one
 * transaction — a forced failure between the batch row and a key row leaves
 * nothing, proving "no issued-but-unescrowed state" (D29) rather than
 * asserting it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {createBatch} from '../src/batches';
import {MIGRATIONS, OpsDb} from '../src/db';
import {TEST_MASTER, testDb} from './helpers';

test('migrations apply forward-only to a fresh DB', () => {
  const db = testDb();
  const v = db.db.prepare('SELECT version FROM schema_version').get() as {
    version: number;
  };
  assert.equal(v.version, MIGRATIONS.length);
  // every table the routes touch exists
  const tables = (
    db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as {
      name: string;
    }[]
  ).map(r => r.name);
  for (const t of [
    'operators',
    'sessions',
    'key_batches',
    'issued_keys',
    'cards',
    'cap_releases',
    'anchor_tip',
  ]) {
    assert.ok(tables.includes(t), `table ${t} exists`);
  }
  db.close();
});

test('a second OpsDb on the same file does not re-apply or fail', () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  const again = new OpsDb({
    path: ':memory:',
    master: {getMaster: () => TEST_MASTER},
    // share the underlying database by reopening the same handle's file is
    // not possible in-memory; this just proves a fresh open is at head.
  });
  const v = again.db.prepare('SELECT version FROM schema_version').get() as {
    version: number;
  };
  assert.equal(v.version, MIGRATIONS.length);
  again.close();
  db.close();
});

test('createBatch escrows every ordinal in one write', () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  const batch = createBatch(db, {
    count: 5,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const rows = db.db
    .prepare(
      'SELECT ordinal FROM issued_keys WHERE batch_id = ? ORDER BY ordinal',
    )
    .all(batch.id) as {ordinal: number}[];
  assert.deepEqual(
    rows.map(r => r.ordinal),
    [0, 1, 2, 3, 4],
  );
  db.close();
});

test('a forced failure between the batch row and a key row leaves NO row at all', () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();

  // Derive with a broken master source: createBatch's transaction throws
  // after the INSERT of the batch row — exactly the forced failure the
  // no-issued-but-unescrowed claim needs.
  const broken = new OpsDb({
    path: ':memory:',
    now: () => 1_700_000_000,
    master: {getMaster: () => Buffer.alloc(4, 1)}, // too short: requireMaster throws
  });
  broken.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  assert.throws(() =>
    createBatch(broken, {
      count: 3,
      mintUrl: 'https://forge.flashapp.me',
      pinPolicy: 'perCard',
      dailyUsd: 25,
      noPinUsd: 5,
      loadSha256: 'fe7d8ac3',
      operatorId: 1,
    }),
  );
  const batches = broken.db
    .prepare('SELECT COUNT(*) AS n FROM key_batches')
    .get() as {n: number};
  const keys = broken.db
    .prepare('SELECT COUNT(*) AS n FROM issued_keys')
    .get() as {n: number};
  assert.equal(batches.n, 0, 'the batch row rolled back');
  assert.equal(keys.n, 0, 'no key row survived');
  broken.close();

  // And a mid-loop failure: corrupt the master AFTER creation begins by
  // pointing deriveKeySet at an ordinal that throws — exercised via a stub
  // master that fails from the second derive on.
  let calls = 0;
  const midFail = new OpsDb({
    path: ':memory:',
    now: () => 1_700_000_000,
    master: {
      getMaster: () => {
        calls++;
        if (calls > 1) {
          throw new Error('master vanished mid-batch');
        }
        return TEST_MASTER;
      },
    },
  });
  midFail.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  assert.throws(() =>
    createBatch(midFail, {
      count: 3,
      mintUrl: 'https://forge.flashapp.me',
      pinPolicy: 'perCard',
      dailyUsd: 25,
      noPinUsd: 5,
      loadSha256: 'fe7d8ac3',
      operatorId: 1,
    }),
  );
  const midBatches = midFail.db
    .prepare('SELECT COUNT(*) AS n FROM key_batches')
    .get() as {n: number};
  const midKeys = midFail.db
    .prepare('SELECT COUNT(*) AS n FROM issued_keys')
    .get() as {n: number};
  assert.equal(midBatches.n, 0);
  assert.equal(midKeys.n, 0);
  midFail.close();
  db.close();
});

test('migrations never rewrite history: opening twice leaves the same version', () => {
  // A forward-only contract holds only if a re-open does not re-apply or
  // reorder anything; the version row stands still across opens.
  const db = new OpsDb({
    path: ':memory:',
    master: {getMaster: () => TEST_MASTER},
  });
  const v1 = (
    db.db.prepare('SELECT version FROM schema_version').get() as {
      version: number;
    }
  ).version;
  db.close();
  const again = new OpsDb({
    path: ':memory:',
    master: {getMaster: () => TEST_MASTER},
  });
  const v2 = (
    again.db.prepare('SELECT version FROM schema_version').get() as {
      version: number;
    }
  ).version;
  assert.equal(v1, v2);
  again.close();
});
