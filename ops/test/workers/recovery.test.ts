import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import {OpsDb} from '../../src/db';
import {openSqlStorage} from '../../src/sql-do';
import {createOperatorSession} from '../../src/auth';

async function fixture(name: string) {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName(name));
  const login = await stub.fetch('https://test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  const {token} = (await login.json()) as {token: string};
  const call = (
    path: string,
    method = 'GET',
    value?: unknown,
    bearer = token,
  ) =>
    stub.fetch('https://test' + path, {
      method,
      headers: {authorization: 'Bearer ' + bearer},
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  return {stub, call};
}
it('pairing is expiring, replay-safe for one device and revocable with durable hashed state', async () => {
  const {stub, call} = await fixture('recovery-pairing');
  const enrollment = await call('/ops/recovery/pairings', 'POST', {
    name: 'Zion staging',
  });
  expect(enrollment.status).toBe(201);
  const {code} = (await enrollment.json()) as {code: string};
  const secret = 'a'.repeat(43);
  const claim = () => call('/recovery/claim', 'POST', {code, secret}, '');
  const first = await claim();
  expect(first.status).toBe(200);
  const connection = (await first.json()) as {connection_id: string};
  expect(await (await claim()).json()).toEqual(connection);
  expect(
    (await call('/recovery/claim', 'POST', {code, secret: 'b'.repeat(43)}, ''))
      .status,
  ).toBe(401);
  const bearer = 'recovery-v1.' + secret;
  expect(
    (await call('/recovery/exports', 'GET', undefined, bearer)).status,
  ).toBe(200);
  expect(
    (await call('/ops/recovery/connections', 'GET', undefined, bearer)).status,
  ).toBe(401);
  expect((await call('/registry/batches', 'POST', {}, bearer)).status).toBe(
    401,
  );
  await call('/ops/recovery/connections/' + connection.connection_id, 'DELETE');
  expect(
    (await call('/recovery/exports', 'GET', undefined, bearer)).status,
  ).toBe(401);
  expect((await claim()).status).toBe(401);
  const pending = (await (
    await call('/ops/recovery/pairings', 'POST', {name: 'expired'})
  ).json()) as {code: string};
  await runInDurableObject(stub, (_instance, ctx) => {
    const db = new OpsDb({sql: openSqlStorage(ctx.storage)});
    db.db.prepare('UPDATE recovery_pairings SET expires = 1').run();
    const raw = db.db
      .prepare('SELECT token_hash FROM recovery_connections')
      .all() as {token_hash: string}[];
    expect(raw[0]!.token_hash).not.toContain(secret);
  });
  expect(
    (
      await call(
        '/recovery/claim',
        'POST',
        {code: pending.code, secret: 'c'.repeat(43)},
        '',
      )
    ).status,
  ).toBe(401);
});
it('ordinary provisioning access cannot enroll; backup credentials read only matching ciphertext objects', async () => {
  const {stub, call} = await fixture('recovery-scope');
  expect(
    (
      await stub.fetch('http://test/recovery/claim', {
        method: 'POST',
        body: '{}',
      })
    ).status,
  ).toBe(400);
  const pageResponse = await call('/ops/recovery/setup');
  expect(pageResponse.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  );
  const operatorToken = await runInDurableObject(
    stub,
    async (_instance, ctx) => {
      const db = new OpsDb({sql: openSqlStorage(ctx.storage)});
      db.db
        .prepare(
          "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('card-only', 'fixture', 'issued', 1)",
        )
        .run();
      return (await createOperatorSession(db, 'card-only', 'fixture', {
        hash: async () => 'fixture',
        verify: async () => true,
      }))!.token;
    },
  );
  expect(
    (
      await call(
        '/ops/recovery/pairings',
        'POST',
        {name: 'denied'},
        operatorToken,
      )
    ).status,
  ).toBe(403);
  expect((await call('/recovery/exports')).status).toBe(401);
  const {code} = (await (
    await call('/ops/recovery/pairings', 'POST', {name: 'reader'})
  ).json()) as {code: string};
  const secret = 'd'.repeat(43);
  await call('/recovery/claim', 'POST', {code, secret}, '');
  const bearer = 'recovery-v1.' + secret;
  const name =
    '2026-10-21T00:00:00.000Z-11111111-2222-4333-8444-555555555555.age';
  await env.OPS_BACKUPS!.put('escrow/' + name, 'ciphertext-fixture');
  await env.OPS_BACKUPS!.put('other/private', 'outside-scope');
  await env.OPS_BACKUPS!.put('escrow/not-an-export', 'ignored');
  const page = (await (
    await call('/recovery/exports', 'GET', undefined, bearer)
  ).json()) as {objects: {Name: string}[]};
  expect(page.objects.map(o => o.Name)).toEqual([name]);
  const download = await call(
    '/recovery/exports/' + name,
    'GET',
    undefined,
    bearer,
  );
  expect(new TextDecoder().decode(await download.arrayBuffer())).toBe(
    'ciphertext-fixture',
  );
  expect(download.headers.get('cache-control')).toBe('no-store');
  expect(
    (await call('/recovery/exports/other%2Fprivate', 'GET', undefined, bearer))
      .status,
  ).toBe(404);
  expect((await call('/recovery/exports', 'POST', {}, bearer)).status).toBe(
    405,
  );
  expect(
    (
      await call(
        '/recovery/claim',
        'POST',
        {code: 'x'.repeat(5000), secret},
        '',
      )
    ).status,
  ).toBe(413);
});
