/**
 * The confiscated-phone claim (OPS-THREAT-MODEL #2): no response the phone
 * caches beyond one run contains key material. Every route the phone can
 * call is walked here with a real router over a real in-memory DB; the only
 * route that may return key bytes is /keys/issue, the per-run fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';

import {AnchorFeed} from '../src/anchor';
import {hashPassword} from '../src/auth';
import {HolderIssueState} from '../src/issue';
import {route, RouterDeps} from '../src/router';
import {testDb} from './helpers';

/** A loopback server wired to the real route table, torn down per test. */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
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
  const port = (server.address() as {port: number}).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    db.close();
  }
}

const KEY_FIELDS = ['enc', 'mac', 'dek'];
const KEY_HEX_LEN = 32; // 16 bytes hex

function assertNoKeyMaterial(
  body: Record<string, unknown>,
  where: string,
): void {
  for (const f of KEY_FIELDS) {
    const v = body[f];
    assert.ok(
      !(
        typeof v === 'string' &&
        v.length === KEY_HEX_LEN &&
        /^[0-9a-f]+$/.test(v)
      ),
      `${where} must not carry key material (${f})`,
    );
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{status: number; json: Record<string, unknown>}> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? {authorization: `Bearer ${token}`} : {}),
      ...(body ? {'content-type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return {status: res.status, json};
}

test('every phone-cacheable route carries no key material; only /keys/issue does', async () => {
  await withServer(async base => {
    const signin = await call(
      base,
      'POST',
      '/auth/operator/session',
      undefined,
      {
        name: 'bench-lead',
        password: 'x',
      },
    );
    assert.equal(signin.status, 200);
    const token = signin.json.token as string;
    // The sign-in response itself: token + env, never keys
    assertNoKeyMaterial(signin.json, 'sign-in');
    assert.equal(signin.json.env, 'issued');

    const batch = await call(base, 'POST', '/registry/batches', token, {
      count: 2,
      mint_url: 'https://forge.flashapp.me',
      pin_policy: 'perCard',
      daily_usd: 25,
      no_pin_usd: 5,
      load_sha256: 'fe7d8ac3',
    });
    assert.equal(batch.status, 200);
    assertNoKeyMaterial(batch.json, 'batch create');
    const batchId = (batch.json.batch as Record<string, unknown>).id as number;

    const mints = await call(base, 'GET', '/mints', token);
    assert.equal(mints.status, 200);
    assertNoKeyMaterial(mints.json, 'mints');

    const cards = await call(base, 'POST', '/registry/cards', token, {
      short_id: '9c2f',
      batch_id: batchId,
      key_id: 2,
      ordinal: 0,
      installed_at: 1,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
    assert.equal(cards.status, 200);
    assertNoKeyMaterial(cards.json, 'registry post');
    const stored = cards.json.stored as Record<string, unknown>;
    assertNoKeyMaterial(stored, 'registry stored row');

    const cardsRead = await call(
      base,
      'GET',
      `/registry/cards?batch_id=${batchId}`,
      token,
    );
    assert.equal(cardsRead.status, 200);
    for (const c of cardsRead.json.cards as Record<string, unknown>[]) {
      assertNoKeyMaterial(c, 'registry read');
    }

    // The one route that DOES return keys: exactly one, the per-run fetch.
    const issue = await call(base, 'POST', '/keys/issue', token, {
      batch_id: batchId,
      ordinal: 0,
    });
    assert.equal(issue.status, 200);
    for (const f of KEY_FIELDS) {
      const v = issue.json[f];
      assert.equal(typeof v, 'string', `keys/issue carries ${f}`);
      assert.match(v as string, /^[0-9a-f]{32}$/, `${f} is 16 bytes hex`);
    }
  });
});

test('holder sign-in and holder issue responses follow the same rule', async () => {
  await withServer(async base => {
    const holder = await call(base, 'POST', '/auth/holder/session', undefined, {
      proof: {env: 'issued'},
    });
    assert.equal(holder.status, 200);
    assertNoKeyMaterial(holder.json, 'holder sign-in');
    const token = holder.json.token as string;

    // the holder signs in against a batch that exists (created by an operator)
    const op = await call(base, 'POST', '/auth/operator/session', undefined, {
      name: 'bench-lead',
      password: 'x',
    });
    const opToken = op.json.token as string;
    const batch = await call(base, 'POST', '/registry/batches', opToken, {
      count: 1,
      mint_url: 'https://forge.flashapp.me',
      pin_policy: 'perCard',
      daily_usd: 25,
      no_pin_usd: 5,
      load_sha256: 'fe7d8ac3',
    });
    const batchId = (batch.json.batch as Record<string, unknown>).id as number;

    const issue = await call(base, 'POST', '/keys/issue', token, {
      batch_id: batchId,
      ordinal: 0,
    });
    assert.equal(issue.status, 200);
    for (const f of KEY_FIELDS) {
      assert.match(issue.json[f] as string, /^[0-9a-f]{32}$/);
    }
    // one-shot: a different holder token gets already-issued (no keys)
    const holder2 = await call(
      base,
      'POST',
      '/auth/holder/session',
      undefined,
      {
        proof: {env: 'issued'},
      },
    );
    const second = await call(
      base,
      'POST',
      '/keys/issue',
      holder2.json.token as string,
      {
        batch_id: batchId,
        ordinal: 0,
      },
    );
    assert.equal(second.status, 404);
    assert.equal(second.json.reason, 'already-issued');
    assertNoKeyMaterial(second.json, 'already-issued answer');

    // holder cannot read batches or write cap releases
    const batchRead = await call(
      base,
      'GET',
      `/registry/cards?batch_id=${batchId}`,
      token,
    );
    assert.equal(batchRead.status, 403);
    const cap = await call(base, 'POST', '/registry/cap-releases', token, {
      version: '2.1.0',
      sha256: 'a'.repeat(64),
    });
    assert.equal(cap.status, 403);
  });
});

test('an anchor tip 503 (no upstream in this suite) carries no key material', async () => {
  await withServer(async base => {
    const op = await call(base, 'POST', '/auth/operator/session', undefined, {
      name: 'bench-lead',
      password: 'x',
    });
    const tip = await call(base, 'GET', '/anchor/tip', op.json.token as string);
    assert.equal(tip.status, 503);
    assertNoKeyMaterial(tip.json, 'anchor 503');
  });
});

// ── GET /anchor/tip is public: cardctl's fetch_tip must reach it ────────────
//
// fetch_tip (tools/cardctl/cardctl.py) sends NO Authorization header — it is
// a bench tool with no session — so the route must answer exactly that
// request. This test drives the real router over a real socket with the
// request fetch_tip constructs (same path, no header), not a parsed-body
// stub, so an auth regression here is a red test rather than a dead feature.

test('the exact request cardctl.fetch_tip constructs (no Authorization header) answers the tip', async () => {
  await withServer(async base => {
    // The one urlopen call fetch_tip makes: GET {base}/anchor/tip, no
    // headers, 15 s timeout. Reconstructed verbatim from cardctl.py:1426-1428
    // (a bare urllib Request carries no Authorization header; that fetch_tip
    // adds none is pinned on the Python side, test_tip.py's header test).
    const url = base.replace(/\/$/, '') + '/anchor/tip';
    const res = await fetch(url, {method: 'GET'}); // no Authorization
    assert.equal(
      res.status,
      503,
      'the unauthenticated tip request reaches the route (503: no upstream here)',
    );
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.reason, 'upstream-unavailable');
    assertNoKeyMaterial(json, 'unauthenticated tip');
  });
});
