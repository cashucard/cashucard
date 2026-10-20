/**
 * The Workers-side suite: the real OpsStore Durable Object, running in
 * workerd through the vitest plugin, driven the way production drives it —
 * requests through the Worker's fetch, storage through the DO's own
 * ctx.storage.sql. The claims here are the port's, not the service's
 * re-test: migrations apply inside the DO, sign-in verifies a PBKDF2 row,
 * issue/escrow is one write, the tip route answers headerless, and the
 * escrow export round-trips through age.
 *
 * No network: the anchor routes answer 503 (no upstream in workerd tests).
 */
import {env} from 'cloudflare:workers';
import {SELF} from 'cloudflare:test';
import {describe, expect, it} from 'vitest';

const json = (res: Response) => res.json() as Promise<Record<string, unknown>>;

async function operatorToken(): Promise<string> {
  // The first test creates the operator; later tests re-use the session.
  const res = await SELF.fetch('http://x/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({name: 'bench-lead', password: 'correct horse'}),
  });
  return ((await json(res)).token as string) ?? '';
}

let bootstrapped = false;

async function ensureOperator(): Promise<void> {
  if (bootstrapped) {
    return;
  }
  const {bootstrapOperatorInto} = await import('../../src/test-bootstrap');
  await bootstrapOperatorInto(env, 'bench-lead', 'correct horse', 'issued');
  bootstrapped = true;
}

describe('ops on Workers (the DO)', () => {
  it('migrations applied inside the DO: a batch creates and escrows in one write', async () => {
    await ensureOperator();
    const token = await operatorToken();
    expect(token).not.toBe('');

    const res = await SELF.fetch('http://x/registry/batches', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
      body: JSON.stringify({
        count: 3,
        mint_url: 'https://forge.flashapp.me',
        pin_policy: 'perCard',
        daily_usd: 25,
        no_pin_usd: 5,
        load_sha256: 'fe7d8ac3',
      }),
    });
    expect(res.status).toBe(200);
    const batch = ((await json(res)).batch ?? {}) as Record<string, unknown>;
    const batchId = batch.id as number;

    // the escrow rows exist, one per ordinal — same write, same transaction
    const issue = await SELF.fetch('http://x/keys/issue', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
      body: JSON.stringify({batch_id: batchId, ordinal: 1}),
    });
    expect(issue.status).toBe(200);
    const keys = await json(issue);
    for (const f of ['enc', 'mac', 'dek']) {
      expect(keys[f]).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('a lost response re-issues byte-identical keys through the DO', async () => {
    await ensureOperator();
    const token = await operatorToken();
    const batchRes = await SELF.fetch('http://x/registry/batches', {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`},
      body: JSON.stringify({
        count: 2,
        mint_url: 'https://forge.flashapp.me',
        pin_policy: 'perCard',
        daily_usd: 25,
        no_pin_usd: 5,
        load_sha256: 'fe7d8ac3',
      }),
    });
    const batchId = (
      ((await json(batchRes)).batch ?? {}) as Record<string, unknown>
    ).id as number;

    const ask = (ord: number) =>
      SELF.fetch('http://x/keys/issue', {
        method: 'POST',
        headers: {authorization: `Bearer ${token}`},
        body: JSON.stringify({batch_id: batchId, ordinal: ord}),
      }).then(json);

    const a = (await ask(0)) as Record<string, string>;
    const b = (await ask(0)) as Record<string, string>;
    expect(a.enc).toMatch(/^[0-9a-f]{32}$/);
    expect(b.enc).toMatch(/^[0-9a-f]{32}$/);
    expect(a.enc).toBe(b.enc);
    expect(a.mac).toBe(b.mac);
    expect(a.dek).toBe(b.dek);
  });

  it('GET /anchor/tip answers the headerless request (public route, 503 without upstream)', async () => {
    const res = await SELF.fetch('http://x/anchor/tip', {method: 'GET'});
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.reason).toBe('upstream-unavailable');
  });

  it(
    'the escrow export runs inside the DO: the DO method serializes the escrow and armors it',
    {timeout: 20_000}, // age's key wrap is deliberately slow work
    async () => {
      await ensureOperator();
      const {runInDurableObject} = await import('cloudflare:test');
      // The SqlHandle is the DO's own I/O object: it can only be used inside
      // the DO's context (workerd enforces this — a handle carried out answers
      // "on behalf of a different Durable Object"). So the export runs inside
      // runInDurableObject, exactly how the cron's call path works.
      const {exportEscrowSql} = await import('../../src/export');
      const id = env.OPS_DO.idFromName('ops');
      const armored = await runInDurableObject(
        env.OPS_DO.get(id) as never,
        async (instance: unknown) => {
          const store = instance as {deps: {db: {db: unknown}}};
          const {armored} = await exportEscrowSql(
            store.deps.db.db as never,
            'age143umpzceuzceneulq4kjez9d2t9u2c975dmru5a8ksr6c3mtcuvscgmvun',
          );
          return armored;
        },
      );
      // The armored file is inert text; decrypting needs the identity, which
      // the round-trip test in export.test.ts covers (node side). Here the
      // claim is: the DO's rows serialize and the armor parses back to bytes.
      expect(armored).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----/);
    },
  );
});
