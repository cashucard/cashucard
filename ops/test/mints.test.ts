import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMintList,
  DEFAULT_MINTS,
  normalizeMintUrl,
  probeMint,
  sanitizeMintName,
  validateDefaultMints,
  type FetchFn,
} from '../src/config';

const INFO = JSON.stringify({name: 'test mint', version: 'Nutshell/0.22.1'});
const KEYSETS = JSON.stringify({
  keysets: [{id: '00ad268c4d1f5826', unit: 'sat', active: true}],
});

type Reply = {status: number; body?: string} | Error;

/** A fetch that answers per path; records every URL it was asked for. */
function fakeFetch(route: (url: string) => Reply): FetchFn & {
  calls: string[];
  inits: unknown[];
} {
  const calls: string[] = [];
  const inits: unknown[] = [];
  const fn = (async (input: string, init?: unknown) => {
    calls.push(input);
    inits.push(init);
    const r = route(input);
    if (r instanceof Error) throw r;
    return {status: r.status, text: async () => r.body ?? ''};
  }) as FetchFn & {calls: string[]; inits: unknown[]};
  fn.calls = calls;
  fn.inits = inits;
  return fn;
}

const healthy = (url: string): Reply =>
  url.endsWith('/v1/info')
    ? {status: 200, body: INFO}
    : {status: 200, body: KEYSETS};

// ── shape ─────────────────────────────────────────────────────────────────

test('DEFAULT_MINTS passes the shape rules and names Minibits at /Bitcoin', () => {
  validateDefaultMints(DEFAULT_MINTS);
  assert.ok(DEFAULT_MINTS.includes('https://mint.minibits.cash/Bitcoin'));
  assert.ok(!DEFAULT_MINTS.includes('https://mint.minibits.cash'));
});

test('DEFAULT_MINTS is forge first, then Minibits, Macadamia, Cuba Bitcoin (D179)', () => {
  assert.deepEqual(
    [...DEFAULT_MINTS],
    [
      'https://forge.flashapp.me',
      'https://mint.minibits.cash/Bitcoin',
      'https://mint.macadamia.cash',
      'https://mint.cubabitcoin.org',
    ],
  );
});

test('validateDefaultMints rejects bad entries and bad lengths', () => {
  const bad: [string, string[]][] = [
    ['http', ['http://mint.example']],
    ['trailing slash', ['https://mint.example/']],
    ['path trailing slash', ['https://mint.example/Bitcoin/']],
    ['duplicate', ['https://mint.example', 'https://mint.example']],
    ['query', ['https://mint.example?x=1']],
    ['hash', ['https://mint.example#x']],
    ['userinfo', ['https://user:pw@mint.example']],
    ['not a url', ['mint.example']],
    ['empty', []],
    ['too long', Array.from({length: 101}, (_, i) => `https://m${i}.example`)],
  ];
  for (const [name, list] of bad)
    assert.throws(() => validateDefaultMints(list), Error, name);
  validateDefaultMints(['https://mint.example/Bitcoin']);
});

// ── probeMint ─────────────────────────────────────────────────────────────

test('probeMint passes valid info plus non-empty keysets, without following redirects', async () => {
  const f = fakeFetch(healthy);
  assert.deepEqual(await probeMint('https://m.example/Bitcoin', f), {
    url: 'https://m.example/Bitcoin',
    ok: true,
    name: 'test mint',
  });
  assert.deepEqual(f.calls.sort(), [
    'https://m.example/Bitcoin/v1/info',
    'https://m.example/Bitcoin/v1/keysets',
  ]);
  for (const init of f.inits) {
    const i = init as {redirect?: string; signal?: AbortSignal};
    assert.equal(i.redirect, 'manual');
    assert.ok(i.signal instanceof AbortSignal);
  }
});

test('probeMint fails each broken mint, never throws, never echoes a body', async () => {
  const html = '<html>soft 404 secret-body</html>';
  const cases: [string, (url: string) => Reply][] = [
    // the cashucard#239 case: the root Minibits URL answers 404 at /v1/info
    [
      'info 404',
      u => (u.endsWith('/v1/info') ? {status: 404, body: html} : healthy(u)),
    ],
    [
      'keysets 500',
      u => (u.endsWith('/v1/keysets') ? {status: 500, body: html} : healthy(u)),
    ],
    [
      'empty keysets',
      u =>
        u.endsWith('/v1/keysets')
          ? {status: 200, body: '{"keysets":[]}'}
          : healthy(u),
    ],
    [
      'keysets not an array',
      u =>
        u.endsWith('/v1/keysets')
          ? {status: 200, body: '{"keysets":{}}'}
          : healthy(u),
    ],
    ['html 200', () => ({status: 200, body: html})],
    [
      'info not an object',
      u => (u.endsWith('/v1/info') ? {status: 200, body: '"x"'} : healthy(u)),
    ],
    ['301', () => ({status: 301})],
    [
      'fetch throws',
      () => {
        const e = new TypeError('fetch failed: secret-body');
        return e;
      },
    ],
    [
      'abort',
      () => {
        const e = new Error('timed out');
        e.name = 'TimeoutError';
        return e;
      },
    ],
  ];
  for (const [name, route] of cases) {
    const r = await probeMint('https://m.example', fakeFetch(route));
    assert.equal(r.ok, false, name);
    assert.equal(typeof r.reason, 'string', name);
    assert.ok(!r.reason!.includes('secret-body'), `${name}: ${r.reason}`);
  }
  const notFound = await probeMint(
    'https://m.example',
    fakeFetch(u =>
      u.endsWith('/v1/info') ? {status: 404, body: html} : healthy(u),
    ),
  );
  assert.equal(notFound.reason, 'info: http 404');
  const timedOut = await probeMint(
    'https://m.example',
    fakeFetch(() => {
      const e = new Error('timed out');
      e.name = 'TimeoutError';
      return e;
    }),
  );
  assert.equal(timedOut.reason, 'info: TimeoutError');
});

test('probeMint times out a hanging mint through its abort signal', async () => {
  // AbortSignal.timeout's timer is unref'd, and a promise that never settles
  // holds no handle, so without a ref'd timer the event loop can drain before
  // the signal fires (the runner then cancels the test). Hold one until done.
  const keepAlive = setTimeout(() => {}, 10_000);
  let aborted = 0;
  const hanging: FetchFn = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted++;
        reject(init.signal!.reason);
      });
    });
  try {
    const r = await probeMint('https://m.example', hanging, 20);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'info: TimeoutError');
    assert.equal(aborted, 2);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('probeMint releases the body of every non-200 response', async () => {
  // A stream-backed body (a real Response) is cancelled, not read.
  let cancelled = 0;
  let read = 0;
  const streamed: FetchFn = async url => ({
    status: url.endsWith('/v1/info') ? 404 : 500,
    text: async () => {
      read++;
      return 'not found';
    },
    body: {
      cancel: async () => {
        cancelled++;
      },
    },
  });
  const r1 = await probeMint('https://m.example', streamed);
  assert.equal(r1.reason, 'info: http 404');
  assert.equal(cancelled, 2);
  assert.equal(read, 0);

  // Without a body handle the body is drained instead; a failing drain or
  // cancel never turns into a throw or a different reason.
  read = 0;
  const plain: FetchFn = async () => ({
    status: 301,
    text: async () => {
      read++;
      throw new Error('drain failed');
    },
  });
  const r2 = await probeMint('https://m.example', plain);
  assert.equal(r2.reason, 'info: http 301');
  assert.equal(read, 2);

  const badCancel: FetchFn = async () => ({
    status: 503,
    text: async () => '',
    body: {cancel: () => Promise.reject(new Error('boom'))},
  });
  const r3 = await probeMint('https://m.example', badCancel);
  assert.equal(r3.reason, 'info: http 503');
});

// ── createMintList ────────────────────────────────────────────────────────

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

test('createMintList drops a bad mint, keeps order and logs url and reason', async () => {
  const logs: unknown[][] = [];
  const list = createMintList([A, B, C], {
    fetchFn: fakeFetch(u => (u.startsWith(B) ? {status: 404} : healthy(u))),
    log: (...args) => logs.push(args),
  });
  assert.deepEqual(await list(), [A, C]);
  assert.deepEqual(logs, [['mint dropped', B, 'info: http 404']]);
});

test('createMintList does no I/O until called and coalesces concurrent callers', async () => {
  const f = fakeFetch(healthy);
  const list = createMintList([A, B], {fetchFn: f, log: () => {}});
  assert.equal(f.calls.length, 0, 'no probe at construction');
  const results = await Promise.all([list(), list(), list(), list()]);
  for (const r of results) assert.deepEqual(r, [A, B]);
  assert.equal(f.calls.length, 4, 'one probe: two mints, two paths each');
});

test('createMintList caches a good result for ttlOkMs, then re-probes', async () => {
  let t = 1000;
  const f = fakeFetch(healthy);
  const list = createMintList([A], {
    fetchFn: f,
    now: () => t,
    log: () => {},
    ttlOkMs: 100,
  });
  await list();
  assert.equal(f.calls.length, 2);
  t += 99;
  await list();
  assert.equal(f.calls.length, 2, 'cached within ttlOkMs');
  t += 1;
  await list();
  assert.equal(f.calls.length, 4, 're-probed after ttlOkMs');
});

test('createMintList serves last-good when all fail, [] with no history, and retries after ttlFailMs', async () => {
  let t = 0;
  let up = false;
  const logs: unknown[][] = [];
  const f = fakeFetch(u => (up ? healthy(u) : {status: 503}));
  const list = createMintList([A, B], {
    fetchFn: f,
    now: () => t,
    log: (...args) => logs.push(args),
    ttlOkMs: 1000,
    ttlFailMs: 10,
  });
  // never a good probe: []
  assert.deepEqual(await list(), []);
  assert.ok(
    logs.some(
      l =>
        l[0] === 'all default mints failed probe' &&
        l[1] === 'serving an empty list',
    ),
  );
  const afterFirst = f.calls.length;
  t += 9;
  assert.deepEqual(await list(), []);
  assert.equal(f.calls.length, afterFirst, 'failure cached within ttlFailMs');
  // recovers after ttlFailMs
  up = true;
  t += 1;
  assert.deepEqual(await list(), [A, B]);
  // everything fails after a good run: last-good
  up = false;
  t += 1000;
  logs.length = 0;
  assert.deepEqual(await list(), [A, B]);
  assert.ok(
    logs.some(
      l =>
        l[0] === 'all default mints failed probe' &&
        l[1] === 'serving last-good list',
    ),
  );
  // and the failure is retried after ttlFailMs, not ttlOkMs
  const beforeRetry = f.calls.length;
  t += 10;
  await list();
  assert.equal(f.calls.length, beforeRetry + 4);
});

test('createMintList drops a mint whose fetch throws synchronously', async () => {
  const logs: unknown[][] = [];
  const list = createMintList([A], {
    fetchFn: () => {
      throw new Error('sync throw');
    },
    log: (...args) => logs.push(args),
  });
  assert.deepEqual(await list(), []);
  assert.equal(logs[0][0], 'mint dropped');
});

// ── the sat gate, the name and the size cap (D180) ───────────────────────

const withKeysets =
  (keysets: unknown) =>
  (url: string): Reply =>
    url.endsWith('/v1/info')
      ? {status: 200, body: INFO}
      : {status: 200, body: JSON.stringify({keysets})};

test('probeMint requires an active sat keyset', async () => {
  const usdOnly = await probeMint(
    'https://m.example',
    fakeFetch(withKeysets([{id: '00aa', unit: 'usd', active: true}])),
  );
  assert.deepEqual(usdOnly, {
    url: 'https://m.example',
    ok: false,
    reason: 'keysets: no active sat',
  });
  const inactiveSat = await probeMint(
    'https://m.example',
    fakeFetch(
      withKeysets([
        {id: '00aa', unit: 'sat', active: false},
        {id: '00bb', unit: 'usd', active: true},
      ]),
    ),
  );
  assert.equal(inactiveSat.reason, 'keysets: no active sat');
  const noUnit = await probeMint(
    'https://m.example',
    fakeFetch(withKeysets([{id: '00aa'}, null, 'x'])),
  );
  assert.equal(noUnit.reason, 'keysets: no active sat');
  const mixed = await probeMint(
    'https://m.example',
    fakeFetch(
      withKeysets([
        {id: '00aa', unit: 'usd', active: true},
        {id: '00bb', unit: 'sat', active: true},
      ]),
    ),
  );
  assert.equal(mixed.ok, true);
  // NUT-02 older mints omit `active`: absent counts as active.
  const noActive = await probeMint(
    'https://m.example',
    fakeFetch(withKeysets([{id: '00bb', unit: 'sat'}])),
  );
  assert.equal(noActive.ok, true);
});

test('createMintList drops a default whose only keyset is usd', async () => {
  const logs: unknown[][] = [];
  const list = createMintList([A, B], {
    fetchFn: fakeFetch(u =>
      u.startsWith(B)
        ? withKeysets([{id: '00aa', unit: 'usd', active: true}])(u)
        : healthy(u),
    ),
    log: (...args) => logs.push(args),
  });
  assert.deepEqual(await list(), [A]);
  assert.deepEqual(logs, [['mint dropped', B, 'keysets: no active sat']]);
});

test('probeMint passes a sanitized, truncated name and omits a missing one', async () => {
  const named = (name: unknown) =>
    fakeFetch(u =>
      u.endsWith('/v1/info')
        ? {status: 200, body: JSON.stringify({name})}
        : {status: 200, body: KEYSETS},
    );
  const evil = '  Good\u202eMint\n\u0007\u2066x\u0085y  ';
  assert.equal(
    (await probeMint('https://m.example', named(evil))).name,
    'GoodMintxy',
  );
  const long = 'A'.repeat(39) + '\u{1F600}' + 'B'.repeat(10);
  const cut = (await probeMint('https://m.example', named(long))).name!;
  assert.equal(Array.from(cut).length, 40);
  assert.ok(cut.endsWith('\u{1F600}'), 'a surrogate pair is never split');
  for (const bad of [undefined, 42, {x: 1}, '\u202e\n  '])
    assert.ok(
      !('name' in (await probeMint('https://m.example', named(bad)))),
      String(bad),
    );
  assert.equal(sanitizeMintName('a\r\nb'), 'ab');
  assert.equal(sanitizeMintName(''), undefined);
});

test('probeMint refuses an oversized body, unread when content-length says so', async () => {
  let read = 0;
  let cancelled = 0;
  const declared: FetchFn = async () => ({
    status: 200,
    headers: {get: (h: string) => (h === 'content-length' ? '70000' : null)},
    text: async () => {
      read++;
      return INFO;
    },
    body: {
      cancel: async () => {
        cancelled++;
      },
    },
  });
  const r1 = await probeMint('https://m.example', declared);
  assert.equal(r1.reason, 'info: too large');
  assert.equal(read, 0);
  assert.equal(cancelled, 2);
  const big = JSON.stringify({name: 'x', pad: 'p'.repeat(70_000)});
  const undeclared = await probeMint(
    'https://m.example',
    fakeFetch(u =>
      u.endsWith('/v1/info') ? {status: 200, body: big} : healthy(u),
    ),
  );
  assert.equal(undeclared.reason, 'info: too large');
  // a small declared length is read as usual
  const small: FetchFn = async url => ({
    status: 200,
    headers: {get: () => '120'},
    text: async () => (url.endsWith('/v1/info') ? INFO : KEYSETS),
  });
  assert.equal((await probeMint('https://m.example', small)).ok, true);
});

// ── normalizeMintUrl ──────────────────────────────────────────────────────

test('normalizeMintUrl accepts a public https mint and normalizes it', () => {
  const ok: [string, string][] = [
    ['https://mint.example', 'https://mint.example'],
    ['https://mint.example/', 'https://mint.example'],
    ['https://MINT.Example/Bitcoin', 'https://mint.example/Bitcoin'],
    ['https://mint.example/Bitcoin/', 'https://mint.example/Bitcoin'],
    ['https://mint.example:443', 'https://mint.example'],
  ];
  for (const [raw, want] of ok) assert.equal(normalizeMintUrl(raw), want, raw);
  for (const d of DEFAULT_MINTS) assert.equal(normalizeMintUrl(d), d);
});

test('normalizeMintUrl rejects IPs, internal names, ports, userinfo and http', () => {
  const bad: unknown[] = [
    'http://mint.example',
    'https://127.0.0.1',
    'https://10.0.0.1:443',
    'https://[::1]',
    'https://[2001:db8::1]/x',
    'https://2130706433', // decimal 127.0.0.1
    'https://0x7f000001', // hex 127.0.0.1
    'https://0177.0.0.1', // octal
    'https://localhost',
    'https://mint.localhost',
    'https://printer.local',
    'https://svc.internal',
    'https://abc.onion',
    'https://intranet',
    'https://mint.example.',
    'https://mint.example:8443',
    'https://user:pw@mint.example',
    'https://user@mint.example',
    'https://mint.example?x=1',
    'https://mint.example/?',
    'https://mint.example#x',
    'https://mint.example//',
    'https://mint.example/a b',
    `https://mint.example/${'a'.repeat(200)}`,
    'mint.example',
    'wss://mint.example',
    '',
    42,
    null,
    undefined,
  ];
  for (const raw of bad)
    assert.equal(normalizeMintUrl(raw), undefined, String(raw));
});
