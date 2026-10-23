import type {OpsStore} from '../../src/do';
import {env} from 'cloudflare:workers';
import {evictDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

it('real DO retains reviewed reset reconciliation after eviction and admits only the fresh attempt', async () => {
  const stub = env.OPS_DO.get(
    env.OPS_DO.idFromName('reset-reconciliation'),
  ) as DurableObjectStub & Pick<OpsStore, 'dispatch'>;
  const login = await stub.fetch('https://ops.test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  const {token} = (await login.json()) as {token: string};
  const uuid = (n: number) =>
    `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const chip = 'cplc-v1:4790d3213041093363205547';
  async function call(path: string, body?: unknown, admins = '["lead-setup"]') {
    const res = await stub.dispatch(
      new Request('https://ops.test' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {authorization: 'Bearer ' + token},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      }),
      null,
      undefined,
      admins,
    );
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  }
  const batch = await call('/provisioning/batches', {
    device_id: uuid(1),
    batch_request_id: uuid(2),
    count: 2,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard',
    daily_usd: 0,
    no_pin_usd: 0,
    load_sha256: 'ab'.repeat(32),
  });
  const batchId = (batch.body.batch as {batch_id: number}).batch_id;
  for (const ordinal of [0, 1]) {
    expect(
      (
        await call('/provisioning/attempts', {
          device_id: uuid(1),
          attempt_id: uuid(ordinal + 3),
          batch_id: batchId,
          ordinal,
        })
      ).status,
    ).toBe(200);
    if (!ordinal) {
      expect(
        (
          await call(`/provisioning/attempts/${uuid(3)}/bind`, {
            device_id: uuid(1),
            revision: 0,
            chip_id: chip,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(`/provisioning/attempts/${uuid(3)}/disposition`, {
            device_id: uuid(1),
            revision: 1,
            kind: 'quarantined',
            reason: 'authentication-failed',
          })
        ).status,
      ).toBe(200);
    }
  }
  const bind = {device_id: uuid(1), revision: 0, chip_id: chip};
  expect(
    (await call(`/provisioning/attempts/${uuid(4)}/bind`, bind)).status,
  ).toBe(409);
  const now = Math.floor(Date.now() / 1000);
  const key =
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const evidence = {
    revision: 2,
    chip_id: chip,
    source_origin: 'http://127.0.0.1:8821',
    completion: {
      reset_id: uuid(5),
      source_attempt_id: uuid(6),
      chip_id: chip,
      removed_installation_id: key,
      gp_key_version: 1,
      manager_keys: 'factory',
      cashu_package: 'absent',
      verified_at: now,
    },
    receipt: {
      reset_id: uuid(5),
      chip_id: chip,
      removed_installation_id: key,
      operator_id: 1,
      device_id: uuid(7),
      completed_at: now,
      manager_keys: 'factory',
      cashu_package: 'absent',
    },
    observed_absent_at: now,
    evidence_ref: 'docs/reviewed-reset.md',
    reviewed: true,
  };
  const path = `/admin/provisioning/attempts/${uuid(3)}/reconcile-reset`;
  expect((await call(path, evidence, '[]')).status).toBe(403);
  const accepted = await call(path, evidence);
  expect(accepted.status).toBe(200);
  await evictDurableObject(stub);
  expect(await call(path, evidence)).toEqual(accepted);
  const history = await call('/admin/provisioning/attempts');
  const old = (history.body.attempts as Array<Record<string, unknown>>).find(
    a => a.attempt_id === uuid(3),
  );
  expect(old?.state).toBe('quarantined');
  expect(old?.fence_released).toBe(1);
  expect(
    (await call(`/provisioning/attempts/${uuid(4)}/bind`, bind)).status,
  ).toBe(200);
}, 30000);
