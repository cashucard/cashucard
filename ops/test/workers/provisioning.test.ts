import {env} from 'cloudflare:workers';
import {SELF, evictDurableObject} from 'cloudflare:test';
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
