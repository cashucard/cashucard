import {env} from 'cloudflare:workers';
import {evictDurableObject, runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

it('constructor bootstraps the actual DO once and retains operator sessions after eviction', async () => {
  const stub = env.OPS_DO.get(
    env.OPS_DO.idFromName('operator-setup-lifecycle'),
  );
  const login = () =>
    stub.fetch('http://x/auth/operator/session', {
      method: 'POST',
      body: JSON.stringify({
        name: 'lead-setup',
        password: 'correct horse battery',
      }),
    });
  const response = await login();
  expect(response.status).toBe(200);
  const {token} = (await response.json()) as {token: string};
  const state = await runInDurableObject(stub, (_instance, ctx) => {
    return ctx.storage.sql
      .exec('SELECT password_hash FROM operators WHERE name = ?', 'lead-setup')
      .toArray()[0];
  });
  expect(state.password_hash).toMatch(/^scrypt\$16384\$8\$5\$/);
  await evictDurableObject(stub);
  const alive = await stub.fetch('http://x/auth/operator/sessions', {
    headers: {authorization: `Bearer ${token}`},
  });
  // Resolve through an authenticated route, independent of private DO fields.
  expect(alive.status).toBe(200);
  const count = await runInDurableObject(stub, (_instance, ctx) => {
    return ctx.storage.sql
      .exec('SELECT COUNT(*) AS n FROM operator_setup_commands')
      .toArray()[0].n;
  });
  expect(count).toBe(1);
});
