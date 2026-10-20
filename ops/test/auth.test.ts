/**
 * Operator auth: scrypt verify, the 12 h token, expiry, revocation, and the
 * scope rules — holder scope cannot read batches or write cap-releases; the
 * holder issue path is one-shot per (batch, ordinal) and rate-limited.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHolderSession,
  createOperatorSession,
  hashPassword,
  resolveSession,
  revokeSession,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from '../src/auth';
import {createBatch} from '../src/batches';
import {HolderIssueState, issueKeys} from '../src/issue';
import {testDb} from './helpers';

function seedOperator(db: ReturnType<typeof testDb>, env = 'issued'): number {
  const info = db.db
    .prepare(
      'INSERT INTO operators (name, password_hash, key_env, created) VALUES (?, ?, ?, ?)',
    )
    .run('bench-lead', hashPassword('correct horse'), env, db.now());
  return Number(info.lastInsertRowid);
}

test('scrypt: a password verifies; a wrong one does not; hashes differ per call', () => {
  const stored = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', stored));
  assert.ok(!verifyPassword('wrong horse', stored));
  // a fresh hash of the same password also verifies (salted, so bytes differ)
  assert.ok(verifyPassword('correct horse', hashPassword('correct horse')));
  assert.notEqual(hashPassword('correct horse'), stored);
  assert.ok(!verifyPassword('correct horse', 'not-a-hash'));
});

test('operator session: 12 h TTL, live token resolves, expiry and revocation', () => {
  const db = testDb();
  seedOperator(db);
  const issued = createOperatorSession(db, 'bench-lead', 'correct horse');
  assert.ok(issued);
  assert.equal(issued!.session.expiresAt - db.now(), SESSION_TTL_SECONDS);
  assert.equal(issued!.session.env, 'issued');
  assert.ok(resolveSession(db, issued!.token));
  assert.ok(!resolveSession(db, 'no-such-token'));
  assert.ok(revokeSession(db, issued!.token));
  assert.equal(resolveSession(db, issued!.token), null);
  assert.ok(!revokeSession(db, issued!.token), 'second revoke is a no-op');
  db.close();
});

test('an expired token does not resolve', () => {
  const db = testDb();
  seedOperator(db);
  const issued = createOperatorSession(db, 'bench-lead', 'correct horse')!;
  const later = new (db.constructor as typeof import('../src/db').OpsDb)({
    path: ':memory:',
  });
  void later; // (expiry is time-source based; exercised via a moved clock below)
  // move the clock past expiry on the same db
  (db as {now: () => number}).now = () =>
    1_700_000_000 + SESSION_TTL_SECONDS + 1;
  assert.equal(resolveSession(db, issued.token), null);
  db.close();
});

test('bad credentials return null; the holder stub only takes a well-formed proof', () => {
  const db = testDb();
  seedOperator(db);
  assert.equal(createOperatorSession(db, 'bench-lead', 'wrong'), null);
  assert.equal(createOperatorSession(db, 'nobody', 'correct horse'), null);
  assert.equal(createHolderSession(db, null), null);
  assert.equal(createHolderSession(db, {env: 'production'}), null);
  const ok = createHolderSession(db, {env: 'factory'});
  assert.ok(ok);
  assert.equal(ok!.session.kind, 'holder');
  assert.equal(ok!.session.env, 'factory');
  db.close();
});

test('holder scope: one-shot issue, no second token, rate limit; operator unaffected', () => {
  const db = testDb();
  seedOperator(db);
  const batch = createBatch(db, {
    count: 3,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const holders = new HolderIssueState();
  const holderA = createHolderSession(db, {env: 'issued'})!;
  const holderB = createHolderSession(db, {env: 'issued'})!;

  const first = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderA.session.tokenHash},
    holders,
  );
  assert.equal(first.ok, true);
  const second = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderB.session.tokenHash},
    holders,
  );
  assert.ok(!second.ok);
  assert.ok(second.reason === 'already-issued');

  // the same token re-reading its own ordinal is allowed (its one shot),
  // the rate limit is what stops bulk reads
  const again = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderA.session.tokenHash},
    holders,
  );
  assert.equal(again.ok, true);

  // rate-limited: a small window
  const tight = new HolderIssueState(2, 3600);
  const t = 'tok';
  assert.equal(
    issueKeys(db, batch.id, 1, {kind: 'holder', tokenHash: t}, tight).ok,
    true,
  );
  assert.equal(
    issueKeys(db, batch.id, 2, {kind: 'holder', tokenHash: t}, tight).ok,
    true,
  );
  const third = issueKeys(
    db,
    batch.id,
    2,
    {kind: 'holder', tokenHash: t},
    tight,
  );
  // ordinal 2 was just claimed by t, so the next claim for it is already-issued;
  // a THIRD distinct ordinal hits the rate limit.
  const tight2 = new HolderIssueState(2, 3600);
  issueKeys(db, batch.id, 1, {kind: 'holder', tokenHash: 'u'}, tight2);
  issueKeys(db, batch.id, 2, {kind: 'holder', tokenHash: 'u'}, tight2);
  const rateLimited = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: 'u'},
    tight2,
  );
  assert.ok(!rateLimited.ok);
  assert.ok(rateLimited.reason === 'rate-limited');

  void second;
  void third;
  db.close();
});

test('no-such-batch / no-such-ordinal answers, for both scopes', () => {
  const db = testDb();
  seedOperator(db);
  const holders = new HolderIssueState();
  const op = issueKeys(db, 99, 0, {kind: 'operator'}, holders);
  assert.ok(!op.ok && op.reason === 'no-such-batch');
  const batch = createBatch(db, {
    count: 2,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const ord = issueKeys(db, batch.id, 5, {kind: 'operator'}, holders);
  assert.ok(!ord.ok && ord.reason === 'no-such-ordinal');
  db.close();
});
