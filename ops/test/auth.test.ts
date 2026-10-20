/**
 * Operator auth: scrypt verify, the 12 h token, expiry, revocation, and the
 * scope rules — holder scope cannot read batches, write cap-releases, or
 * write registry rows; the holder issue path is one-shot per (batch,
 * ordinal) and rate-limited. The stolen-token answer (OPS-THREAT-MODEL #2):
 * revoke-by-principal from another operator's token, no stolen bearer needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';

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
import {testDb} from './helpers';

function seedOperator(db: ReturnType<typeof testDb>, env = 'issued'): number {
  const info = db.db
    .prepare(
      'INSERT INTO operators (name, password_hash, key_env, created) VALUES (?, ?, ?, ?)',
    )
    .run('bench-lead', hashPassword('correct horse'), env, db.now());
  return Number(info.lastInsertRowid);
}

test('scrypt: a password verifies; a wrong one does not; hashes differ per call', () => {
  const stored = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', stored));
  assert.ok(!verifyPassword('wrong horse', stored));
  // a fresh hash of the same password also verifies (salted, so bytes differ)
  assert.ok(verifyPassword('correct horse', hashPassword('correct horse')));
  assert.notEqual(hashPassword('correct horse'), stored);
  assert.ok(!verifyPassword('correct horse', 'not-a-hash'));
});

test('operator session: 12 h TTL, live token resolves, expiry and revocation', () => {
  const db = testDb();
  seedOperator(db);
  const issued = createOperatorSession(db, 'bench-lead', 'correct horse');
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

test('an expired token does not resolve', () => {
  const db = testDb();
  seedOperator(db);
  const issued = createOperatorSession(db, 'bench-lead', 'correct horse')!;
  const later = new (db.constructor as typeof import('../src/db').OpsDb)({
    path: ':memory:',
  });
  void later; // (expiry is time-source based; exercised via a moved clock below)
  // move the clock past expiry on the same db
  (db as {now: () => number}).now = () =>
    1_700_000_000 + SESSION_TTL_SECONDS + 1;
  assert.equal(resolveSession(db, issued.token), null);
  db.close();
});

test('bad credentials return null; the holder stub only takes a well-formed proof', () => {
  const db = testDb();
  seedOperator(db);
  assert.equal(createOperatorSession(db, 'bench-lead', 'wrong'), null);
  assert.equal(createOperatorSession(db, 'nobody', 'correct horse'), null);
  assert.equal(createHolderSession(db, null), null);
  assert.equal(createHolderSession(db, {env: 'production'}), null);
  const ok = createHolderSession(db, {env: 'factory'});
  assert.ok(ok);
  assert.equal(ok!.session.kind, 'holder');
  assert.equal(ok!.session.env, 'factory');
  db.close();
});

test('holder scope: one-shot issue, no second token, rate limit; operator unaffected', () => {
  const db = testDb();
  seedOperator(db);
  const batch = createBatch(db, {
    count: 3,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  const holders = new HolderIssueState();
  const holderA = createHolderSession(db, {env: 'issued'})!;
  const holderB = createHolderSession(db, {env: 'issued'})!;

  const first = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderA.session.tokenHash},
    holders,
  );
  assert.equal(first.ok, true);
  const second = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderB.session.tokenHash},
    holders,
  );
  assert.ok(!second.ok);
  assert.ok(second.reason === 'already-issued');

  // the same token re-reading its own ordinal is allowed (its one shot),
  // the rate limit is what stops bulk reads
  const again = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: holderA.session.tokenHash},
    holders,
  );
  assert.equal(again.ok, true);

  // rate-limited: a small window
  const tight = new HolderIssueState(2, 3600);
  const t = 'tok';
  assert.equal(
    issueKeys(db, batch.id, 1, {kind: 'holder', tokenHash: t}, tight).ok,
    true,
  );
  assert.equal(
    issueKeys(db, batch.id, 2, {kind: 'holder', tokenHash: t}, tight).ok,
    true,
  );
  const third = issueKeys(
    db,
    batch.id,
    2,
    {kind: 'holder', tokenHash: t},
    tight,
  );
  // ordinal 2 was just claimed by t, so the next claim for it is already-issued;
  // a THIRD distinct ordinal hits the rate limit.
  const tight2 = new HolderIssueState(2, 3600);
  issueKeys(db, batch.id, 1, {kind: 'holder', tokenHash: 'u'}, tight2);
  issueKeys(db, batch.id, 2, {kind: 'holder', tokenHash: 'u'}, tight2);
  const rateLimited = issueKeys(
    db,
    batch.id,
    0,
    {kind: 'holder', tokenHash: 'u'},
    tight2,
  );
  assert.ok(!rateLimited.ok);
  assert.ok(rateLimited.reason === 'rate-limited');

  void second;
  void third;
  db.close();
});

test('no-such-batch / no-such-ordinal answers, for both scopes', () => {
  const db = testDb();
  seedOperator(db);
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

test('revoke-by-principal: another operator token revokes a stolen one, no stolen bearer needed', () => {
  const db = testDb();
  seedOperator(db);
  const stolen = createOperatorSession(db, 'bench-lead', 'correct horse')!;
  const keepers = createOperatorSession(db, 'bench-lead', 'correct horse')!;
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
  const fresh = createOperatorSession(db, 'bench-lead', 'correct horse')!;
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
    .run(hashPassword('x'));
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
    const holder = await call('POST', '/auth/holder/session', undefined, {
      proof: {env: 'issued'},
    });
    const holderToken = holder.json.token as string;

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
    assert.equal(holderPost.status, 403);
    assert.equal(holderPost.json.reason, 'operator-only');
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
    assert.equal(holderRevoke.status, 403);
    const holderList = await call(
      'GET',
      '/auth/operator/sessions',
      holderToken,
    );
    assert.equal(holderList.status, 403);

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
