import assert from 'node:assert/strict';
import test from 'node:test';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  recordAttempt,
  disposeAttempt,
} from '../src/provisioning';
import {findResetSource} from '../src/reset-source';
import {provisioningHttp} from '../src/provisioning-http';
import type {Session} from '../src/auth';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = {operator_id: 1, device_id: uuid(1), key_env: 'issued' as const};
const chip = 'cplc-v1:4790d3213041093363205547';
const installation =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
function fixture() {
  const db = new OpsDb({
    sql: openSqliteFile(':memory:'),
    randomBytes: n => Buffer.alloc(n, 7),
    now: () => 1700000000,
    master: {getMaster: () => Buffer.alloc(32, 90)},
  });
  db.db
    .prepare(
      'INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,?,?,?)',
    )
    .run('one', 'test', 'issued', db.now());
  const config = {
    batch_request_id: uuid(2),
    count: 2,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard' as const,
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'ab'.repeat(32),
  };
  const batch = createProvisioningBatch(db, scope, config);
  const attempt = reserveAttempt(db, scope, {
    attempt_id: uuid(3),
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  bindAttempt(db, scope, attempt.attempt_id, {revision: 0, chip_id: chip});
  return {db, batch, attempt, config};
}

test('lookup requires the exact chip and installation, and exposes only escrow metadata', () => {
  const {db, batch, attempt, config} = fixture();
  recordAttempt(db, scope, attempt.attempt_id, {
    revision: 1,
    record: {
      attempt_id: attempt.attempt_id,
      batch_id: batch.batch_id,
      ordinal: 0,
      chip_id: chip,
      installation_id: installation,
      display_id: installation.slice(-4),
      load_sha256: config.load_sha256,
      gp_key_version: 1,
      operator_id: 1,
      device_id: scope.device_id,
      key_env: 'issued',
      configuration_revision: 1,
      verified_stage: 'rotated',
      verified_at: db.now(),
    },
  });
  assert.deepEqual(findResetSource(db, chip, installation), {
    status: 'found',
    source: {
      attemptId: attempt.attempt_id,
      batchId: batch.batch_id,
      ordinal: 0,
      keySourceRef: `escrow:${attempt.attempt_id}`,
    },
  });
  const session: Session = {
    tokenHash: 'test',
    principalId: 1,
    kind: 'operator',
    env: 'issued',
    expiresAt: db.now() + 60,
    revokedAt: null,
  };
  const url = new URL(
    `https://example.test/provisioning/reset-source?chip_id=${chip}&installation_id=${installation}`,
  );
  const answer = provisioningHttp(db, session, 'GET', url.pathname, url, {});
  assert.equal(answer.status, 200);
  assert.equal(JSON.stringify(answer).includes('enc'), false);
  assert.deepEqual(answer.body, {
    lookup: findResetSource(db, chip, installation),
    can_reset: true,
  });
  const foreign = provisioningHttp(
    db,
    {...session, principalId: 2},
    'GET',
    url.pathname,
    url,
    {},
  );
  assert.equal((foreign.body as {can_reset: boolean}).can_reset, false);
  db.db.prepare('UPDATE provisioning_control SET recovery_required=1').run();
  const fenced = provisioningHttp(db, session, 'GET', url.pathname, url, {});
  assert.equal((fenced.body as {can_reset: boolean}).can_reset, false);
  db.db.prepare('UPDATE provisioning_control SET recovery_required=0').run();
  assert.deepEqual(
    findResetSource(db, chip.replace('5547', '5548'), installation),
    {status: 'missing'},
  );
  assert.deepEqual(findResetSource(db, chip, '03' + installation.slice(2)), {
    status: 'missing',
  });
  db.db
    .prepare('DELETE FROM issued_keys WHERE batch_id = ? AND ordinal = 0')
    .run(batch.batch_id);
  assert.deepEqual(findResetSource(db, chip, installation), {
    status: 'escrow-missing',
  });
  db.close();
});

test('unresolved attempts and missing escrow never appear reusable', () => {
  const {db, attempt} = fixture();
  assert.deepEqual(findResetSource(db, chip, installation), {
    status: 'unresolved',
  });
  disposeAttempt(db, scope, attempt.attempt_id, {
    revision: 1,
    kind: 'quarantined',
    reason: 'uncertain',
  });
  assert.deepEqual(findResetSource(db, chip, installation), {
    status: 'unresolved',
  });
  db.close();
});
