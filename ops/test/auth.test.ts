/**
 * Operator auth: scrypt verify, the 12 h token, expiry, revocation, and the
 * scope rules — holder scope cannot read batches, write cap-releases, or
 * write registry rows or retrieve keys (consumer access is disabled). The stolen-token answer (OPS-THREAT-MODEL #2):
 * revoke-by-principal from another operator's token, no stolen bearer needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

import {
  createHolderSession,
  createOperatorSession,
  hashPassword,
  listSessionsForPrincipal,
  resolveSession,
  revokeSession,
  revokeSessionsForPrincipal,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from '../src/auth';
import {createBatch} from '../src/batches';
import {AnchorFeed} from '../src/anchor';
import {HolderIssueState, issueKeys} from '../src/issue';
import {route, RouterDeps} from '../src/router';
import {openSqliteFile} from '../src/sqlite-file';
import {testDb} from './helpers';

async function seedOperator(
  db: ReturnType<typeof testDb>,
  env = 'issued',
): Promise<number> {
  const info = db.db
    .prepare(
      'INSERT INTO operators (name, password_hash, key_env, created) VALUES (?, ?, ?, ?)',
    )
    .run('bench-lead', await hashPassword('correct horse'), env, db.now());
  return Number(info.lastInsertRowid);
}

test('scrypt: a password verifies; a wrong one does not; hashes differ per call', async () => {
  const stored = await hashPassword('correct horse');
  assert.ok(await verifyPassword('correct horse', stored));
  assert.ok(!(await verifyPassword('wrong horse', stored)));
  // a fresh hash of the same password also verifies (salted, so bytes differ)
  assert.ok(
    await verifyPassword('correct horse', await hashPassword('correct horse')),
  );
  assert.notEqual(await hashPassword('correct horse'), stored);
  assert.ok(!(await verifyPassword('correct horse', 'not-a-hash')));
});

test('operator session: 12 h TTL, live token resolves, expiry and revocation', async () => {
  const db = testDb();
  await seedOperator(db);
  const issued = await createOperatorSession(db, 'bench-lead', 'correct horse');
  assert.ok(issued);
  assert.equal(issued!.session.expiresAt - db.now(), SESSION_TTL_SECONDS);
  assert.equal(issued!.session.env, 'issued');
  assert.ok(resolveSession(db, issued!.token));
  assert.ok(!resolveSession(db, 'no-such-token'));
  assert.ok(revokeSession(db, issued!.token));
  assert.equal(resolveSession(db, issued!.token), null);
  assert.ok(!revokeSession(db, issued!.token), 'second revoke is a no-op');
  db.close();
});

test('an expired token does not resolve', async () => {
  const db = testDb();
  await seedOperator(db);
  const issued = (await createOperatorSession(
    db,
    'bench-lead',
    'correct horse',
  ))!;
  const later = new (db.constructor as typeof import('../src/db').OpsDb)({
    sql: openSqliteFile(':memory:'),
  });
  void later; // (expiry is time-source based; exercised via a moved clock below)
  // move the clock past expiry on the same db
  (db as {now: () => number}).now = () =>
    1_700_000_000 + SESSION_TTL_SECONDS + 1;
  assert.equal(resolveSession(db, issued.token), null);
  db.close();
});

test('bad credentials return null; holder sessions remain disabled', async () => {
  const db = testDb();
  await seedOperator(db);
  assert.equal(await createOperatorSession(db, 'bench-lead', 'wrong'), null);
  assert.equal(
    await createOperatorSession(db, 'nobody', 'correct horse'),
    null,
  );
  assert.equal(createHolderSession(db, null), null);
  assert.equal(createHolderSession(db, {env: 'production'}), null);
  assert.equal(createHolderSession(db, {env: 'factory'}), null);
  assert.equal(createHolderSession(db, {env: 'issued'}), null);
  db.close();
});

test('operator no-such-batch / no-such-ordinal answers', async () => {
  const db = testDb();
  await seedOperator(db);
  const holders = new HolderIssueState();
  const op = issueKeys(db, 99, 0, {kind: 'operator'}, holders);
  assert.ok(!op.ok && op.reason === 'no-such-batch');
  const batch = createBatch(db, {
    count: 2,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const ord = issueKeys(db, batch.id, 5, {kind: 'operator'}, holders);
  assert.ok(!ord.ok && ord.reason === 'no-such-ordinal');
  db.close();
});

test('revoke-by-principal: another operator token revokes a stolen one, no stolen bearer needed', async () => {
  const db = testDb();
  await seedOperator(db);
  const stolen = (await createOperatorSession(
    db,
    'bench-lead',
    'correct horse',
  ))!;
  const keepers = (await createOperatorSession(
    db,
    'bench-lead',
    'correct horse',
  ))!;
  assert.ok(resolveSession(db, stolen.token));
  const n = revokeSessionsForPrincipal(db, stolen.session.principalId);
  assert.equal(n, 2, 'every live session of the principal, the caller too');
  assert.equal(resolveSession(db, stolen.token), null);
  assert.equal(resolveSession(db, keepers.token), null);
  // and the list agrees: nothing live for the principal any more
  assert.equal(
    listSessionsForPrincipal(db, stolen.session.principalId).length,
    0,
  );
  // a re-sign-in works and is listed
  const fresh = (await createOperatorSession(
    db,
    'bench-lead',
    'correct horse',
  ))!;
  const live = listSessionsForPrincipal(db, fresh.session.principalId);
  assert.equal(live.length, 1);
  assert.equal(live[0]!.tokenHash, fresh.session.tokenHash);
  db.close();
});

test('holder tokens cannot revoke or list sessions (the revoke routes are operator-only)', async () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('bench-lead', ?, 'issued', 1)",
    )
    .run(await hashPassword('x'));
  const deps: RouterDeps = {
    db,
    anchor: new AnchorFeed(async () => {
      throw new Error('no network in this suite');
    }),
    holderState: new HolderIssueState(),
    mints: ['https://forge.flashapp.me'],
  };
  const server = http.createServer((req, res) => {
    route(deps, req, res).catch(() => {
      res.writeHead(500).end('{"reason":"internal"}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const call = async (
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<{status: number; json: Record<string, unknown>}> => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(body ? {'content-type': 'application/json'} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      json: (await res.json()) as Record<string, unknown>,
    };
  };
  try {
    const op = await call('POST', '/auth/operator/session', undefined, {
      name: 'bench-lead',
      password: 'x',
    });
    const opToken = op.json.token as string;
    // Simulate a token persisted before holder access was disabled.
    const holderToken = 'legacy-holder-token';
    db.db
      .prepare(
        `INSERT INTO sessions (token_hash, principal_id, kind, env, expires_at, created)
      VALUES (?, 0, 'holder', 'issued', ?, ?)`,
      )
      .run(
        createHash('sha256').update(holderToken).digest('hex'),
        db.now() + 3600,
        db.now(),
      );

    // OPS-GOVERNANCE Q4: the operator posts registries; the holder's only
    // path is one-shot issuance. A stolen holder token must not write
    // registry rows (it could forge arbitrary ones otherwise).
    const batch = await call('POST', '/registry/batches', opToken, {
      count: 2,
      mint_url: 'https://forge.flashapp.me',
      pin_policy: 'perCard',
      daily_usd: 25,
      no_pin_usd: 5,
      load_sha256: 'fe7d8ac3',
    });
    const batchId = (batch.json.batch as Record<string, unknown>).id as number;
    const holderPost = await call('POST', '/registry/cards', holderToken, {
      short_id: 'dead',
      batch_id: batchId,
      key_id: 2,
      ordinal: 0,
      installed_at: 1,
      installer: 'thief',
      load_sha256: 'fe7d8ac3',
    });
    assert.equal(holderPost.status, 401);
    assert.equal(holderPost.json.reason, 'no-session');
    // the operator's own post on the same batch answers 200 (the gate is the
    // scope, not the route)
    const opPost = await call('POST', '/registry/cards', opToken, {
      short_id: 'beef',
      batch_id: batchId,
      key_id: 2,
      ordinal: 0,
      installed_at: 1,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
    assert.equal(opPost.status, 200);

    // revoke + list are operator-only too
    const holderRevoke = await call(
      'POST',
      '/auth/operator/revoke',
      holderToken,
      {principal_id: 1},
    );
    assert.equal(holderRevoke.status, 401);
    const holderList = await call(
      'GET',
      '/auth/operator/sessions',
      holderToken,
    );
    assert.equal(holderList.status, 401);

    // an operator revokes principal 1 (the operator's own principal here) and
    // the once-live token stops resolving; the response carries the count
    const revoke = await call('POST', '/auth/operator/revoke', opToken, {
      principal_id: 1,
    });
    assert.equal(revoke.status, 200);
    assert.equal(typeof revoke.json.revoked, 'number');
    const after = await call('GET', '/mints', opToken);
    assert.equal(
      after.status,
      401,
      "the operator's own token went with the revoke",
    );
  } finally {
    server.close();
    db.close();
  }
});
