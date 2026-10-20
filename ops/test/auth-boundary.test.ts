import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AnchorFeed} from '../src/anchor';
import {
  createHolderSession,
  createOperatorSession,
  resolveSession,
} from '../src/auth';
import {applyOperatorSetup} from '../src/operator-setup';
import {createBatch} from '../src/batches';
import {OpsDb} from '../src/db';
import {HolderIssueState, issueKeys} from '../src/issue';
import {routeRequest} from '../src/route-request';
import type {RouterDeps} from '../src/router';
import {testDb} from './helpers';

function depsFor(db: OpsDb): RouterDeps {
  return {
    db,
    anchor: new AnchorFeed(async () => {
      throw new Error('no network');
    }),
    holderState: new HolderIssueState(),
    mints: [],
  };
}
function call(deps: RouterDeps, path: string, body: unknown, token?: string) {
  return routeRequest(
    deps,
    new Request(`https://local.test${path}`, {
      method: 'POST',
      headers: token ? {authorization: `Bearer ${token}`} : {},
      body: JSON.stringify(body),
    }),
  );
}

test('disabled holder sign-in and legacy tokens cannot retrieve keys; operators still can', async () => {
  const db = testDb();
  const deps = depsFor(db);
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('operator', 'test', 'issued', 1)",
    )
    .run();
  const batch = createBatch(db, {
    count: 1,
    mintUrl: 'https://mint.test',
    pinPolicy: 'perCard',
    dailyUsd: 1,
    noPinUsd: 0,
    loadSha256: 'abcd',
    operatorId: 1,
  });
  const token = 'previously-issued-holder';
  db.db
    .prepare(
      `INSERT INTO sessions (token_hash, principal_id, kind, env, expires_at, created)
    VALUES (?, 0, 'holder', 'issued', ?, ?)`,
    )
    .run(
      createHash('sha256').update(token).digest('hex'),
      db.now() + 3600,
      db.now(),
    );
  assert.equal(createHolderSession(db, {env: 'issued'}), null);
  assert.equal(resolveSession(db, token), null);
  assert.equal(
    (await call(deps, '/auth/holder/session', {proof: {env: 'issued'}})).status,
    403,
  );
  const denied = await call(
    deps,
    '/keys/issue',
    {batch_id: batch.id, ordinal: 0},
    token,
  );
  assert.equal(denied.status, 401);
  assert.ok(!('enc' in (denied.body as object)));
  assert.deepEqual(
    issueKeys(
      db,
      batch.id,
      0,
      {kind: 'holder', tokenHash: 'old'},
      deps.holderState,
    ),
    {ok: false, reason: 'holder-disabled'},
  );
  const operatorDeps = {
    ...deps,
    passwordHasher: {hash: async () => 'test', verify: async () => true},
  };
  const operator = await call(operatorDeps, '/auth/operator/session', {
    name: 'operator',
    password: 'test',
  });
  assert.equal(operator.status, 200);
  const operatorToken = (operator.body as {token: string}).token;
  const deviceId = '00000000-0000-4000-8000-000000000001';
  const attemptId = '00000000-0000-4000-8000-000000000003';
  const reservedBatch = await call(
    deps,
    '/provisioning/batches',
    {
      device_id: deviceId,
      batch_request_id: '00000000-0000-4000-8000-000000000002',
      count: 1,
      mint_url: 'https://mint.test',
      pin_policy: 'perCard',
      daily_usd: 1,
      no_pin_usd: 0,
      load_sha256: 'ab'.repeat(32),
    },
    operatorToken,
  );
  assert.equal(reservedBatch.status, 200);
  const reservedBatchId = (reservedBatch.body as {batch: {batch_id: number}})
    .batch.batch_id;
  assert.equal(
    (
      await call(
        deps,
        '/provisioning/attempts',
        {
          device_id: deviceId,
          attempt_id: attemptId,
          batch_id: reservedBatchId,
          ordinal: 0,
        },
        operatorToken,
      )
    ).status,
    200,
  );
  const issued = await call(
    deps,
    '/keys/issue',
    {
      attempt_id: attemptId,
      device_id: deviceId,
    },
    operatorToken,
  );
  assert.equal(issued.status, 200);
  assert.match((issued.body as {enc: string}).enc, /^[0-9a-f]{32}$/);
});

test('login budget bounds concurrent hashing, persists across reconstruction and expires', async () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('operator', 'test', 'issued', 1)",
    )
    .run();
  let verifications = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  const passwordHasher = {
    hash: async () => 'test',
    verify: async () => {
      verifications++;
      await pending;
      return false;
    },
  };
  const deps = {...depsFor(db), passwordHasher};
  const attempts = Array.from({length: 10}, () =>
    call(deps, '/auth/operator/session', {name: 'operator', password: 'wrong'}),
  );
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(verifications, 10);
    const restartedDb = new OpsDb({sql: db.db, now: db.now});
    const restarted = {...depsFor(restartedDb), passwordHasher};
    assert.equal(
      (
        await call(restarted, '/auth/operator/session', {
          name: 'operator',
          password: 'wrong',
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await call(restarted, '/auth/operator/session', {
          name: 'another-name',
          password: 'wrong',
        })
      ).status,
      429,
    );
    assert.equal(verifications, 10);
  } finally {
    release();
    await Promise.all(attempts);
  }
  (db as {now: () => number}).now = () => 1_700_000_061;
  assert.equal(
    (
      await call(deps, '/auth/operator/session', {
        name: 'operator',
        password: 'wrong',
      })
    ).status,
    401,
  );
  assert.equal(verifications, 11);
});

test('a pending login cannot mint a session after administrative credential recovery', async () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('operator', 'old-hash', 'issued', 1)",
    )
    .run();
  let started!: () => void;
  const verifying = new Promise<void>(resolve => {
    started = resolve;
  });
  let release!: () => void;
  const deferred = new Promise<void>(resolve => {
    release = resolve;
  });
  const passwordHasher = {
    hash: async () => 'new-hash',
    verify: async () => {
      started();
      await deferred;
      return true;
    },
  };
  const login = createOperatorSession(
    db,
    'operator',
    'old password',
    passwordHasher,
  );
  await verifying;
  await applyOperatorSetup(
    db,
    JSON.stringify({
      action: 'recover',
      nonce: 'pending_login_recovery_001',
      name: 'operator',
      password: 'replacement password',
    }),
    passwordHasher,
  );
  release();
  assert.equal(await login, null);
  assert.equal(
    (db.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {n: number})
      .n,
    0,
  );
});
