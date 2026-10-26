import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {serve} from '../src/server';

test('standalone health distinguishes a running database from an unconfigured operator', async () => {
  process.env.OPS_MASTER_KEY = '55'.repeat(32); // Synthetic software-only fixture.
  const dir = mkdtempSync(join(tmpdir(), 'ops-standalone-'));
  const server = serve({port: 0, dbPath: join(dir, 'ops.sqlite')});
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const live = await fetch(`${origin}/healthz`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {status: 'ok'});
    assert.equal(live.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${origin}/readyz`)).status, 503);
    assert.equal(statSync(join(dir, 'ops.sqlite')).mode & 0o077, 0);
    assert.equal((await fetch(`${origin}/admin/operators`)).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(e => (e ? reject(e) : resolve())),
    );
    rmSync(dir, {recursive: true, force: true});
  }
});
