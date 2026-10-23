import type {OpsStore} from '../../src/do';
import {env} from 'cloudflare:workers';
import {evictDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

it('real DO enforces live admin policy and persists disabled accounts and audit after eviction', async () => {
  const stub = env.OPS_DO.get(
    env.OPS_DO.idFromName('operator-admin-lifecycle'),
  ) as DurableObjectStub & Pick<OpsStore, 'dispatch'>;
  const auth = await stub.fetch('https://ops.test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  expect(auth.status).toBe(200);
  const {token} = (await auth.json()) as {token: string};
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    admins = '["lead-setup"]',
  ) => {
    const response = await stub.dispatch(
      new Request('https://ops.test' + path, {
        method,
        headers: {authorization: 'Bearer ' + token},
        ...(body ? {body: JSON.stringify(body)} : {}),
      }),
      null,
      undefined,
      admins,
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: response.headers,
    });
  };
  expect((await call('GET', '/admin/operators', undefined, '[]')).status).toBe(
    403,
  );
  const added = await call('POST', '/admin/operators', {
    name: 'new-staff',
    password: 'new-staff-password',
  });
  expect(added.status).toBe(201);
  const {id} = (await added.json()) as {id: number};
  expect(
    (await call('POST', `/admin/operators/${id}/disable`, {})).status,
  ).toBe(200);
  await evictDurableObject(stub);
  const operators = (await (await call('GET', '/admin/operators')).json()) as {
    operators: Array<{name: string; disabled: number}>;
  };
  expect(operators.operators.find(x => x.name === 'new-staff')?.disabled).toBe(
    1,
  );
  expect((await call('GET', '/admin/operators', undefined, '[]')).status).toBe(
    403,
  );
  const audit = (await (
    await call('GET', '/admin/operators/audit')
  ).json()) as {events: unknown[]};
  expect(audit.events).toHaveLength(2);
  const root = await stub.fetch('https://ops.test/');
  expect(root.status).toBe(200);
  expect(root.headers.get('Content-Type')).toContain('text/html');
  expect(await root.text()).toContain('Cashu Card Provisioner');
  const page = await stub.fetch('https://ops.test/ops/operators');
  expect(page.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  );
  expect(await page.text()).toContain('Operator administration');
}, 30000);
