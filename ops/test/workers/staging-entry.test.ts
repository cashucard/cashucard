import {expect, it} from 'vitest';
import staging from '../../src/staging-entry.workers';
import type {Env} from '../../src/do';
it('staging root and denied routes never instantiate the backend', async () => {
  const noBackend = {
    OPS_DO: {
      idFromName() {
        throw new Error('backend access forbidden');
      },
    },
  } as unknown as Env;
  const root = await staging.fetch(
    new Request('https://staging.test/'),
    noBackend,
  );
  expect(root.status).toBe(200);
  expect(await root.json()).toMatchObject({
    scope: 'nonproduction',
    readiness: 'edge-only',
  });
  for (const path of [
    '/anchor/tip',
    '/registry/cards',
    '/auth/holder/session',
  ]) {
    const res = await staging.fetch(
      new Request(`https://staging.test${path}`),
      noBackend,
    );
    expect(res.status).toBe(404);
  }
});
