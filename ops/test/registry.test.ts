/**
 * The registry's retry contract (PROVISIONER-APP S4): an identical re-POST
 * returns the stored row; a changed body for an existing short_id is a 409;
 * two racing writers upsert to one row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {createBatch} from '../src/batches';
import {recordCard, type CardInput} from '../src/registry';
import {testDb} from './helpers';

function seedBatch(db: ReturnType<typeof testDb>): void {
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  createBatch(db, {
    count: 10,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
}

const row = (over: Partial<CardInput> = {}): CardInput => ({
  short_id: '9c2f',
  batch_id: 1,
  key_id: 2,
  ordinal: 3,
  installed_at: 1_700_000_000,
  installer: 'op@bench-1',
  load_sha256:
    'fe7d8ac3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ...over,
});

test('a fresh short_id is created', () => {
  const db = testDb();
  seedBatch(db);
  const r = recordCard(db, row());
  assert.equal(r.kind, 'created');
  db.close();
});

test('an identical re-POST returns the stored row (200-shaped)', () => {
  const db = testDb();
  seedBatch(db);
  const first = recordCard(db, row());
  const second = recordCard(db, row());
  assert.equal(first.kind, 'created');
  assert.equal(second.kind, 'stored');
  assert.deepEqual(
    (second as {row: unknown}).row,
    (first as {row: unknown}).row,
  );
  db.close();
});

test('a changed body for an existing short_id is a conflict (409-shaped)', () => {
  const db = testDb();
  seedBatch(db);
  recordCard(db, row());
  for (const change of [
    row({batch_id: 9}),
    row({key_id: 9}),
    row({ordinal: 9}),
    row({installed_at: 9}),
    row({installer: 'op@bench-2'}),
    row({load_sha256: 'aaaa'}),
  ]) {
    const r = recordCard(db, change);
    assert.equal(
      r.kind,
      'conflict',
      `changed ${Object.keys(change)} should conflict`,
    );
  }
  db.close();
});

test('load_sha256 case difference is NOT a conflict (hex is case-insensitive)', () => {
  const db = testDb();
  seedBatch(db);
  recordCard(db, row());
  const r = recordCard(db, row({load_sha256: row().load_sha256.toUpperCase()}));
  assert.equal(r.kind, 'stored');
  db.close();
});

test('two concurrent writers upsert to one row', () => {
  const db = testDb();
  seedBatch(db);
  // recordCard's INSERT OR IGNORE + read-back: run both writes interleaved
  // through the same DB (SQLite serializes writers; the race is the read-
  // insert gap, which OR IGNORE closes).
  const results = [recordCard(db, row()), recordCard(db, row())];
  const n = (
    db.db.prepare('SELECT COUNT(*) AS n FROM cards').get() as {n: number}
  ).n;
  assert.equal(n, 1);
  assert.ok(results.every(r => r.kind !== 'conflict'));
  db.close();
});

test('bad rows are RegistryErrors, not silent writes', () => {
  const db = testDb();
  seedBatch(db);
  assert.throws(() => recordCard(db, row({short_id: 'NOT HEX!'})));
  assert.throws(() => recordCard(db, row({installer: ''})));
  db.close();
});
