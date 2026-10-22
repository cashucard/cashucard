import {env} from 'cloudflare:workers';
import {SELF, evictDurableObject, runInDurableObject} from 'cloudflare:test';
import {OpsDb} from '../../src/db';
import {openSqlStorage} from '../../src/sql-do';
import {handleOpsRequest} from '../../src/do';
import {HolderIssueState} from '../../src/issue';
import {AnchorFeed} from '../../src/anchor';
import {expect, it} from 'vitest';

const DEVICE = '10000000-0000-4000-8000-000000000001';
const REQUEST = '10000000-0000-4000-8000-000000000002';
const ATTEMPT = '10000000-0000-4000-8000-000000000003';
const KEY =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const CHIP = 'cplc-v1:4790d3213180072976207515';

it('reservation, binding and completion persist through DO eviction, without legacy numeric fallback', async () => {
  const login = await SELF.fetch('https://ops/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  expect(login.status).toBe(200);
  const {token, operator_id} = (await login.json()) as {
    token: string;
    operator_id: number;
  };
  async function call(path: string, body?: unknown) {
    const res = await SELF.fetch(`https://ops${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {authorization: `Bearer ${token}`},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
      cache: res.headers.get('cache-control'),
    };
  }
  const config = {
    device_id: DEVICE,
    batch_request_id: REQUEST,
    count: 2,
    mint_url: 'https://mint.example',
    pin_policy: 'perCard',
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'cd'.repeat(32),
  };
  const created = await call('/provisioning/batches', config);
  expect(created.status).toBe(200);
  expect(await call('/provisioning/batches', config)).toEqual(created);
  const batchId = (created.body.batch as {batch_id: number}).batch_id;
  const reservation = await call('/provisioning/attempts', {
    device_id: DEVICE,
    attempt_id: ATTEMPT,
    batch_id: batchId,
    ordinal: 0,
  });
  expect(reservation.status).toBe(200);
  const bound = await call(`/provisioning/attempts/${ATTEMPT}/bind`, {
    device_id: DEVICE,
    revision: 0,
    chip_id: CHIP,
  });
  expect(bound.status).toBe(200);
  const keys = await call('/keys/issue', {
    device_id: DEVICE,
    attempt_id: ATTEMPT,
  });
  expect(keys.status).toBe(200);
  expect(keys.cache).toBe('no-store');
  for (const name of ['enc', 'mac', 'dek'])
    expect(keys.body[name]).toMatch(/^[0-9a-f]{32}$/);
  await evictDurableObject(env.OPS_DO.get(env.OPS_DO.idFromName('ops')));
  const recovered = await call(
    `/provisioning/attempts/${ATTEMPT}?device_id=${DEVICE}`,
  );
  expect(recovered.status).toBe(200);
  expect(
    (recovered.body.attempt as {bind_receipt: unknown}).bind_receipt,
  ).toEqual(bound.body.receipt);
  expect(
    (await call('/keys/issue', {device_id: DEVICE, attempt_id: ATTEMPT})).body,
  ).toEqual(keys.body);
  const record = {
    attempt_id: ATTEMPT,
    batch_id: batchId,
    ordinal: 0,
    chip_id: CHIP,
    installation_id: KEY,
    display_id: '1798',
    load_sha256: config.load_sha256,
    gp_key_version: 1,
    operator_id,
    device_id: DEVICE,
    key_env: 'issued',
    configuration_revision: 1,
    verified_stage: 'rotated',
    verified_at: 1700000000,
  };
  const request = {device_id: DEVICE, revision: 1, record};
  const receipt = await call(
    `/provisioning/attempts/${ATTEMPT}/record`,
    request,
  );
  expect(receipt.status).toBe(200);
  expect(
    (receipt.body.receipt as {ready_for_holder: boolean}).ready_for_holder,
  ).toBe(false);
  expect(
    await call(`/provisioning/attempts/${ATTEMPT}/record`, request),
  ).toEqual(receipt);
  expect(
    (
      await call(`/provisioning/attempts/${ATTEMPT}/record`, {
        ...request,
        record: {...record, verified_at: 1700000001},
      })
    ).status,
  ).toBe(409);
  expect(
    (await call('/keys/issue', {batch_id: batchId, ordinal: 0})).status,
  ).toBe(409);
  expect(
    (await call('/keys/issue', {device_id: DEVICE, attempt_id: ATTEMPT}))
      .status,
  ).toBe(409);
});

it('configured freshness policy returns 503 through the real DO SQL and shared HTTP router', async () => {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName('stale-backup-gate'));
  const login = await stub.fetch('https://test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  const {token} = (await login.json()) as {token: string};
  await runInDurableObject(stub, async (_instance, ctx) => {
    const db = new OpsDb({
      sql: openSqlStorage(ctx.storage),
      independentBackupIssuer: '11111111-2222-4333-8444-555555555555',
      master: {getMaster: () => Buffer.alloc(32, 90)},
    });
    const response = await handleOpsRequest(
      {
        db,
        holderState: new HolderIssueState(),
        mints: [],
        anchor: new AnchorFeed(async () => {
          throw new Error('unused test feed');
        }),
      },
      new Request('https://test/provisioning/batches', {
        method: 'POST',
        headers: {authorization: 'Bearer ' + token},
        body: JSON.stringify({
          device_id: DEVICE,
          batch_request_id: REQUEST,
          count: 1,
          mint_url: 'https://mint.example',
          pin_policy: 'perCard',
          daily_usd: 25,
          no_pin_usd: 5,
          load_sha256: 'cd'.repeat(32),
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({reason: 'independent-backup-stale'});
    expect(db.db.prepare('SELECT 1 FROM key_batches').get()).toBeUndefined();
  });
});

it('a warm object observes policy binding activation and removal without reconstruction', async () => {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName('warm-policy-update'));
  const login = await stub.fetch('https://test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  const {token} = (await login.json()) as {token: string};
  await runInDurableObject(stub, async instance => {
    const store = instance as import('../../src/do').OpsStore;
    const bindings = (
      store as unknown as {
        env: {
          OPS_INDEPENDENT_BACKUP_ISSUER?: string;
          OPS_RECOVERY_ISSUER_ID: string;
        };
      }
    ).env;
    const original = bindings.OPS_INDEPENDENT_BACKUP_ISSUER;
    const status = async () =>
      (await (
        await store.fetch(
          new Request('https://test/ops/backup-status', {
            headers: {authorization: 'Bearer ' + token},
          }),
        )
      ).json()) as {independent_copy: {required: boolean}};
    try {
      expect((await status()).independent_copy.required).toBe(false);
      bindings.OPS_INDEPENDENT_BACKUP_ISSUER = bindings.OPS_RECOVERY_ISSUER_ID;
      expect((await status()).independent_copy.required).toBe(true);
      bindings.OPS_INDEPENDENT_BACKUP_ISSUER =
        '99999999-2222-4333-8444-555555555555';
      await expect(status()).rejects.toThrow(
        'independent backup issuer does not match recovery issuer',
      );
      bindings.OPS_INDEPENDENT_BACKUP_ISSUER = bindings.OPS_RECOVERY_ISSUER_ID;
      const refused = await store.fetch(
        new Request('https://test/provisioning/attempts', {
          method: 'POST',
          headers: {authorization: 'Bearer ' + token},
          body: JSON.stringify({
            device_id: DEVICE,
            attempt_id: ATTEMPT,
            batch_id: 9007199254740991,
            ordinal: 0,
          }),
        }),
      );
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({
        reason: 'independent-backup-stale',
      });
      bindings.OPS_INDEPENDENT_BACKUP_ISSUER = undefined;
      expect((await status()).independent_copy.required).toBe(false);
    } finally {
      bindings.OPS_INDEPENDENT_BACKUP_ISSUER = original;
    }
  });
});

it('each edge request supplies current policy even when the object retains an old environment snapshot', async () => {
  const worker = (await import('../../src/worker')).default;
  const login = await worker.fetch(
    new Request('https://test/auth/operator/session', {
      method: 'POST',
      body: JSON.stringify({
        name: 'lead-setup',
        password: 'correct horse battery',
      }),
    }),
    env,
  );
  const {token} = (await login.json()) as {token: string};
  const headers = {
    authorization: 'Bearer ' + token,
    'x-ops-independent-backup-issuer': '',
  };
  const changed = {
    ...env,
    OPS_INDEPENDENT_BACKUP_ISSUER: env.OPS_RECOVERY_ISSUER_ID!,
  };
  const status = async (bindings: typeof env) => {
    const response = await worker.fetch(
      new Request('https://test/ops/backup-status', {headers}),
      bindings,
    );
    return (await response.json()) as {independent_copy: {required: boolean}};
  };
  expect((await status(env)).independent_copy.required).toBe(false);
  expect((await status(changed)).independent_copy.required).toBe(true);
  const pair = await Promise.all([status(changed), status(env)]);
  expect(pair.map(s => s.independent_copy.required)).toEqual([true, false]);
  const adminPath = new Request('https://test/ops/recovery/connections', {
    headers,
  });
  expect(
    (await worker.fetch(adminPath.clone(), {...env, OPS_RECOVERY_ADMINS: '[]'}))
      .status,
  ).toBe(403);
  expect((await worker.fetch(adminPath.clone(), env)).status).toBe(200);
  await expect(
    status({
      ...env,
      OPS_INDEPENDENT_BACKUP_ISSUER: null,
    } as unknown as typeof env),
  ).rejects.toThrow('independent backup issuer does not match recovery issuer');
  const refused = await worker.fetch(
    new Request('https://test/provisioning/attempts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_id: '20000000-0000-4000-8000-000000000001',
        attempt_id: '20000000-0000-4000-8000-000000000003',
        batch_id: 9007199254740991,
        ordinal: 0,
      }),
    }),
    changed,
  );
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({reason: 'independent-backup-stale'});
});
