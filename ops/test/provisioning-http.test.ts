import test from 'node:test';
import assert from 'node:assert/strict';
import {AnchorFeed} from '../src/anchor';
import {HolderIssueState} from '../src/issue';
import {routeRequest} from '../src/route-request';
import type {RouterDeps} from '../src/router';
import {testDb} from './helpers';
import {reserveAttempt, bindAttempt, recordAttempt} from '../src/provisioning';

const DEVICE = '00000000-0000-4000-8000-000000000001';
const OTHER_DEVICE = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';
const ATTEMPT = '00000000-0000-4000-8000-000000000004';
const batchBody = {
  device_id: DEVICE,
  batch_request_id: REQUEST,
  count: 2,
  mint_url: 'https://mint.example',
  pin_policy: 'perCard',
  daily_usd: 25,
  no_pin_usd: 5,
  load_sha256: 'ab'.repeat(32),
};

async function setup() {
  const db = testDb();
  for (const name of ['alice', 'bob'])
    db.db
      .prepare(
        "INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,'test','issued',1)",
      )
      .run(name);
  const deps: RouterDeps = {
    db,
    anchor: new AnchorFeed(async () => {
      throw new Error('offline');
    }),
    holderState: new HolderIssueState(),
    mints: [],
    passwordHasher: {hash: async () => 'test', verify: async () => true},
  };
  async function call(path: string, body?: unknown, token?: string) {
    return routeRequest(
      deps,
      new Request(`https://ops.test${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: token ? {authorization: `Bearer ${token}`} : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
  const login = async (name: string) =>
    (
      await call('/auth/operator/session', {
        name,
        password: 'public test password',
      })
    ).body as {token: string; operator_id: number};
  return {db, call, alice: await login('alice'), bob: await login('bob')};
}

test('reset HTTP keeps keys scoped to an unfinished authorization and returns replayable completion', async () => {
  const {db, call, alice, bob} = await setup();
  try {
    const created = await call('/provisioning/batches', batchBody, alice.token);
    const batch_id = (created.body as {batch: {batch_id: number}}).batch
      .batch_id;
    const scope = {
      operator_id: 1,
      device_id: DEVICE,
      key_env: 'issued' as const,
    };
    const chip_id = 'cplc-v1:4790d3213041093363205547';
    const installation_id =
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    reserveAttempt(db, scope, {attempt_id: ATTEMPT, batch_id, ordinal: 0});
    bindAttempt(db, scope, ATTEMPT, {revision: 0, chip_id});
    recordAttempt(db, scope, ATTEMPT, {
      revision: 1,
      record: {
        attempt_id: ATTEMPT,
        batch_id,
        ordinal: 0,
        chip_id,
        installation_id,
        display_id: installation_id.slice(-4),
        load_sha256: batchBody.load_sha256,
        gp_key_version: 1,
        operator_id: 1,
        device_id: DEVICE,
        key_env: 'issued',
        configuration_revision: 1,
        verified_stage: 'rotated',
        verified_at: db.now(),
      },
    });
    const request = {
      reset_id: REQUEST,
      source_attempt_id: ATTEMPT,
      chip_id,
      installation_id,
      consent: {erase_owner_and_proofs: true, value_handled: true},
      inspection: {
        unspent: 0,
        spent: 0,
        tag_present: true,
        has_owner: false,
        pin_present: false,
        record_present: false,
      },
    };
    const body = {device_id: DEVICE, request};
    const path = `/provisioning/reset-intents/${REQUEST}`;
    assert.equal((await call('/provisioning/reset-intents', body)).status, 401);
    assert.equal(
      (await call('/provisioning/reset-intents', body, bob.token)).status,
      409,
    );
    assert.equal(
      (await call('/provisioning/reset-intents', body, alice.token)).status,
      200,
    );
    const read = await call(
      `${path}?device_id=${DEVICE}`,
      undefined,
      alice.token,
    );
    assert.equal(read.status, 200);
    assert.equal(Object.hasOwn(read.body as object, 'enc'), false);
    assert.equal(
      (await call(`${path}/keys`, {device_id: DEVICE}, bob.token)).status,
      404,
    );
    assert.equal(
      (await call(`${path}/keys`, {device_id: OTHER_DEVICE}, alice.token))
        .status,
      404,
    );
    const keys = await call(`${path}/keys`, {device_id: DEVICE}, alice.token);
    assert.equal(keys.status, 200);
    assert.match((keys.body as {enc: string}).enc, /^[0-9a-f]{32}$/);
    const record = {
      reset_id: REQUEST,
      source_attempt_id: ATTEMPT,
      chip_id,
      removed_installation_id: installation_id,
      gp_key_version: 1,
      manager_keys: 'factory',
      cashu_package: 'absent',
      verified_at: db.now(),
    };
    const completed = await call(
      `${path}/complete`,
      {device_id: DEVICE, record},
      alice.token,
    );
    assert.equal(completed.status, 200);
    assert.deepEqual(
      await call(`${path}/complete`, {device_id: DEVICE, record}, alice.token),
      completed,
    );
    assert.equal(
      (await call(`${path}/keys`, {device_id: DEVICE}, alice.token)).status,
      409,
    );
  } finally {
    db.close();
  }
});

test('HTTP batch retries return one escrowed batch and publish a stable operator identity', async () => {
  const {db, call, alice} = await setup();
  try {
    assert.equal(alice.operator_id, 1);
    assert.equal((await call('/provisioning/batches', batchBody)).status, 401);
    const first = await call('/provisioning/batches', batchBody, alice.token);
    assert.equal(first.status, 200);
    assert.deepEqual(
      await call('/provisioning/batches', batchBody, alice.token),
      first,
    );
    assert.equal(
      (
        await call(
          '/provisioning/batches',
          {...batchBody, count: 3},
          alice.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          '/provisioning/batches',
          {...batchBody, pin_batch: 'not-accepted'},
          alice.token,
        )
      ).status,
      400,
    );
    assert.deepEqual(
      db.db.prepare('SELECT count(*) AS count FROM key_batches').get(),
      {count: 1},
    );
  } finally {
    db.close();
  }
});

test('ending an unfinished batch is idempotent and fences later reservations', async () => {
  const {db, call, alice, bob} = await setup();
  try {
    const created = await call('/provisioning/batches', batchBody, alice.token);
    const batchId = (created.body as {batch: {batch_id: number}}).batch
      .batch_id;
    const path = `/provisioning/batches/${batchId}/end`;
    const body = {device_id: DEVICE, reason: 'operator-ended'};
    assert.equal((await call(path, body, bob.token)).status, 404);
    const first = await call(path, body, alice.token);
    assert.equal(first.status, 200);
    assert.deepEqual(await call(path, body, alice.token), first);
    assert.equal(
      (
        await call(
          '/provisioning/attempts',
          {
            device_id: DEVICE,
            attempt_id: ATTEMPT,
            batch_id: batchId,
            ordinal: 0,
          },
          alice.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (await call(path, {...body, reason: 'different'}, alice.token)).status,
      400,
    );
  } finally {
    db.close();
  }
});

test('batch cannot end while a card attempt is active', async () => {
  const {db, call, alice} = await setup();
  try {
    const created = await call('/provisioning/batches', batchBody, alice.token);
    const batchId = (created.body as {batch: {batch_id: number}}).batch
      .batch_id;
    await call(
      '/provisioning/attempts',
      {
        device_id: DEVICE,
        attempt_id: ATTEMPT,
        batch_id: batchId,
        ordinal: 0,
      },
      alice.token,
    );
    const path = `/provisioning/batches/${batchId}/end`;
    const body = {device_id: DEVICE, reason: 'operator-ended'};
    assert.equal((await call(path, body, alice.token)).status, 409);
    const disposed = await call(
      `/provisioning/attempts/${ATTEMPT}/disposition`,
      {
        device_id: DEVICE,
        revision: 0,
        kind: 'abandoned',
        reason: 'operator-ended',
      },
      alice.token,
    );
    assert.equal(disposed.status, 200);
    assert.equal((await call(path, body, alice.token)).status, 200);
  } finally {
    db.close();
  }
});

test('HTTP attempts enforce operator/device ownership and cannot bypass reservations via legacy routes', async () => {
  const {db, call, alice, bob} = await setup();
  try {
    const batch = await call('/provisioning/batches', batchBody, alice.token);
    assert.equal(batch.status, 200);
    const batchId = (batch.body as {batch: {batch_id: number}}).batch.batch_id;
    const reservation = await call(
      '/provisioning/attempts',
      {device_id: DEVICE, attempt_id: ATTEMPT, batch_id: batchId, ordinal: 0},
      alice.token,
    );
    assert.equal(reservation.status, 200);
    assert.equal(
      (
        await call(
          `/provisioning/attempts/${ATTEMPT}?device_id=${DEVICE}`,
          undefined,
          bob.token,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          `/provisioning/attempts/${ATTEMPT}?device_id=${OTHER_DEVICE}`,
          undefined,
          alice.token,
        )
      ).status,
      404,
    );
    const keyPath = '/keys/issue';
    const denied = await call(
      keyPath,
      {device_id: DEVICE, attempt_id: ATTEMPT},
      bob.token,
    );
    assert.equal(denied.status, 404);
    assert.ok(!JSON.stringify(denied.body).includes('escrowed_at'));
    const keys = await call(
      keyPath,
      {device_id: DEVICE, attempt_id: ATTEMPT},
      alice.token,
    );
    assert.equal(keys.status, 200);
    assert.equal((keys.body as {attempt_id: string}).attempt_id, ATTEMPT);
    assert.match((keys.body as {enc: string}).enc, /^[0-9a-f]{32}$/);
    assert.equal(
      (await call('/keys/issue', {batch_id: batchId, ordinal: 0}, alice.token))
        .status,
      409,
    );
    assert.equal(
      (
        await call(
          '/keys/issue',
          {
            attempt_id: REQUEST,
            device_id: DEVICE,
            batch_id: batchId,
            ordinal: 0,
          },
          alice.token,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          '/keys/issue',
          {
            attempt_id: ATTEMPT,
            device_id: DEVICE,
            batch_id: batchId,
            ordinal: 1,
          },
          alice.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (await call('/registry/batches', batchBody, alice.token)).status,
      410,
    );
    assert.equal(
      (await call('/registry/cards', {batch_id: batchId}, alice.token)).status,
      410,
    );
    assert.equal(
      (await call(`/registry/cards?batch_id=${batchId}`, undefined, bob.token))
        .status,
      404,
    );
    assert.deepEqual(
      (await call('/registry/batches', undefined, bob.token)).body,
      {batches: []},
    );
  } finally {
    db.close();
  }
});
