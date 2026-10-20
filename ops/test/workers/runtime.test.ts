import {env} from 'cloudflare:workers';
import {evictDurableObject, runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

import type {OpsDb} from '../../src/db';
import {SubtlePwHash} from '../../src/pwhash';
import {routeRequest} from '../../src/route-request';
import type {RouterDeps} from '../../src/router';

it('restores the saved anchor BLOB after object eviction', async () => {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName('runtime-anchor'));
  await runInDurableObject(stub, (_instance, ctx) => {
    ctx.storage.sql.exec(
      'INSERT INTO anchor_tip (id, header, height, fetched_at) VALUES (1, ?, ?, ?)',
      new Uint8Array(80).fill(7).buffer,
      900000,
      1000,
    );
  });
  await evictDurableObject(stub);
  const saved = await runInDurableObject(stub, instance => {
    const {db} = (instance as unknown as {deps: {db: OpsDb}}).deps;
    const tip = db.tipStore().read();
    return tip
      ? {header: tip.header.toString('hex'), height: tip.height}
      : null;
  });
  expect(saved).toEqual({header: '07'.repeat(80), height: 900000});
});

it('hashes and verifies the deployed PBKDF2 format in workerd', async () => {
  const hasher = new SubtlePwHash();
  const stored = await hasher.hash('local test password');
  expect(stored).toMatch(/^pbkdf2\$600000\$/);
  expect(await hasher.verify('local test password', stored)).toBe(true);
  expect(await hasher.verify('wrong', stored)).toBe(false);
});

it('rejects oversized streamed bodies at the Workers boundary', async () => {
  let sent = false;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent) {
          controller.error(new Error('read continued beyond the limit'));
        } else {
          sent = true;
          controller.enqueue(new Uint8Array((1 << 20) + 1));
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    {highWaterMark: 0},
  );
  await expect(
    routeRequest(
      {} as RouterDeps,
      new Request('https://test/auth/operator/session', {
        method: 'POST',
        body,
      }),
    ),
  ).rejects.toMatchObject({status: 413});
  expect(cancelled).toBe(true);
});
