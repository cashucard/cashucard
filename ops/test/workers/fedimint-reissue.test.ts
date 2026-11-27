import {env} from 'cloudflare:workers';
import {evictDurableObject} from 'cloudflare:test';
import {ed25519} from '@noble/curves/ed25519';
import {expect, it} from 'vitest';
import worker from '../../src/worker';
import {
  canonicalFedimintResetPayload,
  FEDIMINT_RESET_PURPOSE,
} from '../../src/fedimint-reset-proof';

it('edge policy scopes a signed reissue and its receipt survives a real Durable Object eviction', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const policy = {
    source_origin: 'https://fed.example',
    target_origin: 'https://ops.test',
    public_key_hex: Buffer.from(ed25519.getPublicKey(secret)).toString('hex'),
  };
  const trusted = {
    ...env,
    OPS_DO: env.OPS_DO,
    OPS_OPERATOR_ADMINS: '["lead-setup"]',
    OPS_FEDIMINT_REISSUE_TRUST: JSON.stringify(policy),
  };
  const id = (n: number) =>
    '04000000-0000-4000-8000-' + String(n).padStart(12, '0');
  let token = '';
  async function call(path: string, body?: unknown, enabled = true) {
    const response = await worker.fetch(
      new Request('https://ops.test' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      }),
      enabled ? trusted : {...trusted, OPS_FEDIMINT_REISSUE_TRUST: undefined},
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }
  const session = await call('/auth/operator/session', {
    name: 'lead-setup',
    password: 'correct horse battery',
  });
  expect(session.status).toBe(200);
  token = session.body.token as string;
  const device_id = id(1),
    attempt_id = id(3),
    chip_id = 'cplc-v1:' + 'c5'.repeat(12);
  const batch = await call('/provisioning/batches', {
    device_id,
    batch_request_id: id(2),
    count: 2,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard',
    daily_usd: 0,
    no_pin_usd: 0,
    load_sha256: 'a2'.repeat(32),
  });
  expect(batch.status).toBe(200);
  const {batch_id} = batch.body.batch as {batch_id: number};
  const attempts = '/provisioning/attempts';
  const path = '/admin' + attempts + '/' + attempt_id + '/fedimint-reset/';
  expect(
    (await call(attempts, {device_id, batch_id, attempt_id, ordinal: 0}))
      .status,
  ).toBe(200);
  expect(
    (
      await call(attempts + '/' + attempt_id + '/bind', {
        device_id,
        revision: 0,
        chip_id,
      })
    ).status,
  ).toBe(200);
  const stopped = await call(attempts + '/' + attempt_id + '/disposition', {
    device_id,
    revision: 1,
    kind: 'quarantined',
    reason: 'authentication-failed',
  });
  expect(stopped.status).toBe(200);
  const list = await call('/admin' + attempts);
  const row = (
    list.body.attempts as {
      attempt_id: string;
      fedimint_reset_target: {target_bound_at: number};
    }[]
  ).find(a => a.attempt_id === attempt_id)!;
  const bound = row.fedimint_reset_target.target_bound_at;
  // Both services keep different time precision. Insert two separate instants
  // after the recorded stop and let workerd's clock advance past the observation.
  const verified = Math.floor(Date.now() / 1000) * 1000 + 1000;
  const observed = verified + 2;
  await new Promise<void>(resolve =>
    setTimeout(resolve, observed + 1000 - Date.now()),
  );
  const payload = {
    purpose: FEDIMINT_RESET_PURPOSE,
    target_origin: policy.target_origin,
    source_origin: policy.source_origin,
    revision: 2,
    chip_id,
    attempt_id,
    target_bound_at: bound,
    short_id: '1616abcd',
    operator_id: 11,
    setup_journal_sha256: 'c7'.repeat(32),
    gp_key_version: 1,
    manager_keys: 'factory',
    package: 'absent',
    verified_at_ms: verified,
    completed_at_ms: verified + 1,
    source_snapshot_sha256: '64'.repeat(32),
    source_snapshot_created_at_ms: verified + 1,
    observed_at_ms: observed,
    cashu_select_sw: '6a82',
    fedimint_select_sw: '6a82',
  } as const;
  const proof = {
    payload,
    signature_hex: Buffer.from(
      ed25519.sign(
        new TextEncoder().encode(canonicalFedimintResetPayload(payload)),
        secret,
      ),
    ).toString('hex'),
  };
  expect((await call(path + 'preview', {proof}, false)).status).toBe(503);
  expect((await call(path + 'preview', {proof})).status).toBe(200);
  const accepted = await call(path + 'approve', {proof});
  expect(accepted.status).toBe(200);
  await evictDurableObject(env.OPS_DO.get(env.OPS_DO.idFromName('ops')));
  expect(await call(path + 'approve', {proof})).toEqual(accepted);
  expect(
    (await call(attempts, {device_id, batch_id, attempt_id: id(4), ordinal: 1}))
      .status,
  ).toBe(200);
  expect(
    (
      await call(attempts + '/' + id(4) + '/bind', {
        device_id,
        revision: 0,
        chip_id,
      })
    ).status,
  ).toBe(200);
}, 30000);
