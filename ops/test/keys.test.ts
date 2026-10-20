/**
 * HKDF derivation is deterministic: the same master+salt+ordinal re-derives
 * byte-identical sets (the lost-response retry guarantee), and distinct
 * ordinals never collide. The full batch-create → re-issue path is the same
 * guarantee end to end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {createBatch, getBatch} from '../src/batches';
import {deriveKeySet} from '../src/keys';
import {TEST_MASTER, testDb} from './helpers';

const salt = Buffer.alloc(16, 0x21);

test('same master, salt and ordinal derive byte-identical sets', () => {
  const a = deriveKeySet(TEST_MASTER, salt, 7);
  const b = deriveKeySet(TEST_MASTER, salt, 7);
  assert.deepEqual(a.enc, b.enc);
  assert.deepEqual(a.mac, b.mac);
  assert.deepEqual(a.dek, b.dek);
});

test('distinct ordinals never collide, on any of the three keys', () => {
  const seen = new Set<string>();
  for (let ordinal = 0; ordinal < 200; ordinal++) {
    const ks = deriveKeySet(TEST_MASTER, salt, ordinal);
    for (const k of [ks.enc, ks.mac, ks.dek]) {
      const hex = k.toString('hex');
      assert.ok(!seen.has(hex), `key ${hex} repeats at ordinal ${ordinal}`);
      seen.add(hex);
    }
    assert.equal(ks.enc.length, 16);
    assert.equal(ks.mac.length, 16);
    assert.equal(ks.dek.length, 16);
  }
});

test('a different salt derives different keys (batches do not share sets)', () => {
  const a = deriveKeySet(TEST_MASTER, Buffer.alloc(16, 1), 0);
  const b = deriveKeySet(TEST_MASTER, Buffer.alloc(16, 2), 0);
  assert.notDeepEqual(a.enc, b.enc);
  assert.notDeepEqual(a.mac, b.mac);
  assert.notDeepEqual(a.dek, b.dek);
});

test('a lost response re-issues identical bytes through the service path', () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  const batch = createBatch(db, {
    count: 4,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const stored = batch.id;
  // The phone's first request was lost; the retry reads the same escrow row.
  const row1 = db.db
    .prepare(
      'SELECT enc, mac, dek FROM issued_keys WHERE batch_id = ? AND ordinal = ?',
    )
    .get(stored, 2) as {enc: Buffer; mac: Buffer; dek: Buffer};
  const row2 = db.db
    .prepare(
      'SELECT enc, mac, dek FROM issued_keys WHERE batch_id = ? AND ordinal = ?',
    )
    .get(stored, 2) as {enc: Buffer; mac: Buffer; dek: Buffer};
  assert.deepEqual(row1, row2);

  // And re-deriving offline from the batch's salt matches the escrow row —
  // the property that makes the escrow the backup, not the phone.
  const b = getBatch(db, stored)!;
  const derived = deriveKeySet(TEST_MASTER, b.ordinal_salt, 2);
  assert.deepEqual(derived.enc, row1.enc);
  assert.deepEqual(derived.mac, row1.mac);
  assert.deepEqual(derived.dek, row1.dek);
  db.close();
});

test('bad inputs throw: short master, negative ordinal', () => {
  assert.throws(() => deriveKeySet(Buffer.alloc(8, 1), salt, 0));
  assert.throws(() => deriveKeySet(TEST_MASTER, salt, -1));
  assert.throws(() => deriveKeySet(TEST_MASTER, salt, 1.5));
});
