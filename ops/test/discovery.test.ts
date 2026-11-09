import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {schnorr} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha2';
import {bytesToHex} from '@noble/hashes/utils';

import {DEFAULT_MINTS, type MintProbe} from '../src/config';
import {
  createCatalog,
  createDiscovery,
  createRelayQuery,
  discoverMints,
  MAX_DISCOVERED,
  parseDenylist,
  parseNip87,
  parseStored,
  verifyEvent,
  type DiscoveredMint,
  type NostrEvent,
  type RelayAnswer,
  type RelayQuery,
  type SocketLike,
} from '../src/discovery';

// ── signed test events ────────────────────────────────────────────────────

/** Deterministic test keys: never a real identity. */
function key(n: number): Uint8Array {
  const k = new Uint8Array(32);
  k[31] = n;
  k[0] = 0x11;
  return k;
}

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);
const DAY = 86_400;

function sign(
  n: number,
  kind: number,
  tags: string[][],
  createdAt = NOW_S - DAY,
  content = '',
): NostrEvent {
  const priv = key(n);
  const pubkey = bytesToHex(schnorr.getPublicKey(priv));
  const id = bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([0, pubkey, createdAt, kind, tags, content]),
      ),
    ),
  );
  const sig = bytesToHex(schnorr.sign(id, priv));
  return {id, pubkey, created_at: createdAt, kind, tags, content, sig};
}

const announce = (n: number, url: string, extra: string[][] = []) =>
  sign(n, 38172, [['d', 'x'], ['u', url], ['n', 'mainnet'], ...extra]);
const review = (n: number, url: string, createdAt?: number) =>
  sign(
    n,
    38000,
    [
      ['k', '38172'],
      ['d', 'x'],
      ['u', url],
    ],
    createdAt,
  );

/** An announcement plus reviewers 100..100+count-1 for url. */
function mint(url: string, count: number, from = 100): NostrEvent[] {
  return [
    announce(1, url),
    ...Array.from({length: count}, (_, i) => review(from + i, url)),
  ];
}

// ── verifyEvent / parseNip87 ─────────────────────────────────────────────

const recorded = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/nip87/relays-2026-11-08.json'),
    'utf8',
  ),
) as NostrEvent[];

test('recorded relay events verify, and a tampered copy does not', () => {
  assert.ok(recorded.length > 30);
  for (const ev of recorded) assert.ok(verifyEvent(ev), ev.id);
  const ev = recorded[0];
  assert.equal(verifyEvent({...ev, content: ev.content + 'x'}), false);
  assert.equal(verifyEvent({...ev, created_at: ev.created_at + 1}), false);
  const flipped = (ev.sig[0] === '0' ? '1' : '0') + ev.sig.slice(1);
  assert.equal(verifyEvent({...ev, sig: flipped}), false);
  for (const junk of [null, 1, 'x', [], {}, {...ev, tags: [[1]]}])
    assert.equal(verifyEvent(junk), false);
});

test('parseNip87 groups the recorded events by normalized URL', () => {
  const now = Date.UTC(2026, 10, 9, 6, 0, 0);
  const map = parseNip87(recorded, now);
  const minibits = map.get('https://mint.minibits.cash/Bitcoin');
  assert.ok(minibits && minibits.reviewers.size >= 10);
  assert.equal(minibits.announced, false);
  // mint.gitvid.net published an announcement (with no reviews yet)
  assert.equal(map.get('https://mint.gitvid.net')?.announced, true);
  // an announcement whose `n` is not mainnet is ignored
  assert.equal(map.get('https://mint.cashu.chat')?.announced, false);
  // the floor holds no recorded mint: none is announced with 3 reviewers
  for (const e of map.values())
    assert.ok(!(e.announced && e.reviewers.size >= 3));
});

test('parseNip87 counts one reviewer once and merges URL spellings', () => {
  const url = 'https://mint.example/Bitcoin';
  const map = parseNip87(
    [
      announce(1, 'https://MINT.example/Bitcoin/'),
      review(2, url),
      sign(
        2,
        38000,
        [
          ['k', '38172'],
          ['u', url],
        ],
        NOW_S - 2 * DAY,
      ),
      review(3, 'https://mint.example/Bitcoin/'),
      review(3, url), // a duplicate reviewer
    ],
    NOW,
  );
  assert.deepEqual([...map.keys()], [url]);
  assert.equal(map.get(url)!.announced, true);
  assert.equal(map.get(url)!.reviewers.size, 2);
});

test('parseNip87 ignores malformed, forged, stale, future and off-topic events', () => {
  const url = 'https://mint.example';
  const good = review(2, url);
  const events: unknown[] = [
    null,
    'event',
    42,
    [],
    {...good, id: 'ab'.repeat(32)}, // tampered id
    {...review(3, url), sig: 'cd'.repeat(64)}, // bad signature
    {...review(4, url), pubkey: 'XYZ'}, // pubkey not hex64
    review(5, url, NOW_S + 601), // 10+ minutes in the future
    review(6, url, NOW_S - 731 * DAY), // older than 24 months
    sign(7, 38000, [
      ['k', '38173'],
      ['u', url],
    ]), // a fedimint review
    sign(8, 38000, [['u', url]]), // no k
    sign(9, 38000, [['k', '38172']]), // no u
    sign(10, 38172, [['d', 'x']]), // announcement, no u
    announce(11, url, [['n', 'testnet']]), // non-mainnet
    sign(12, 1, [['u', url]]), // another kind
    sign(13, 38000, [
      ['k', '38172'],
      ['u', 'http://mint.example'],
    ]), // not https
    sign(14, 38000, [
      ['k', '38172'],
      ['u', 'https://127.0.0.1'],
    ]), // an IP
  ];
  const map = parseNip87(events, NOW);
  assert.equal(map.size, 0);
  // a fresh review just inside both windows counts
  const inside = parseNip87(
    [review(5, url, NOW_S + 599), review(6, url, NOW_S - 729 * DAY)],
    NOW,
  );
  assert.equal(inside.get(url)!.reviewers.size, 2);
  // an old announcement still counts: only reviews expire
  const oldAnnouncement = sign(1, 38172, [['u', url]], NOW_S - 1000 * DAY);
  assert.equal(parseNip87([oldAnnouncement], NOW).get(url)!.announced, true);
});

test('parseNip87 reads at most 5 u tags per event and verifies an id once', () => {
  const urls = Array.from({length: 7}, (_, i) => `https://m${i}.example`);
  const many = sign(2, 38000, [['k', '38172'], ...urls.map(u => ['u', u])]);
  let verified = 0;
  const map = parseNip87([many, many, many], NOW, (ev): ev is NostrEvent => {
    verified++;
    return verifyEvent(ev);
  });
  assert.equal(map.size, 5);
  assert.equal(verified, 1);
});

// ── discoverMints ────────────────────────────────────────────────────────

const answer = (events: unknown[]): RelayAnswer => ({answered: true, events});
const relaysOf =
  (...answers: (RelayAnswer | Error)[]): RelayQuery =>
  async relay => {
    const a = answers[['r0', 'r1', 'r2'].indexOf(relay)];
    if (a instanceof Error) throw a;
    return a ?? {answered: false, events: []};
  };
const RELAYS = ['r0', 'r1', 'r2'];
const okProbe = async (url: string): Promise<MintProbe> => ({
  url,
  ok: true,
  name: `name of ${new URL(url).hostname}`,
});

test('discoverMints ranks by reviewers, applies the floor and drops defaults', async () => {
  const events = [
    ...mint('https://three.example', 3),
    ...mint('https://five.example', 5),
    ...mint('https://bbb.example', 4),
    ...mint('https://aaa.example', 4),
    ...mint('https://two.example', 2), // below the floor
    ...Array.from({length: 9}, (_, i) =>
      review(200 + i, 'https://unannounced.example'),
    ),
    ...mint(DEFAULT_MINTS[1], 9), // a default is never "discovered"
  ];
  const result = await discoverMints({
    query: relaysOf(answer(events)),
    relays: RELAYS,
    defaults: DEFAULT_MINTS,
    probe: okProbe,
    now: () => NOW,
    log: () => {},
  });
  assert.equal(result.answered, true);
  assert.deepEqual(
    result.mints.map(m => [m.url, m.reviews]),
    [
      ['https://five.example', 5],
      ['https://aaa.example', 4],
      ['https://bbb.example', 4],
      ['https://three.example', 3],
    ],
  );
  assert.equal(result.mints[0].name, 'name of five.example');
});

test('discoverMints probes at most 15, keeps 10, and drops failures and the denylist', async () => {
  const events = Array.from({length: 20}, (_, i) =>
    mint(`https://m${String(i).padStart(2, '0')}.example`, 3 + (20 - i)),
  ).flat();
  const probed: string[] = [];
  let live = 0;
  let peak = 0;
  const logs: unknown[][] = [];
  const result = await discoverMints({
    query: relaysOf(answer(events)),
    relays: RELAYS,
    defaults: [],
    denylist: ['https://M00.example/', 'not a url'],
    probe: async url => {
      probed.push(url);
      live++;
      peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 1));
      live--;
      if (url === 'https://m01.example')
        return {url, ok: false, reason: 'keysets: no active sat'};
      if (url === 'https://m02.example') throw new Error('boom');
      return {url, ok: true};
    },
    now: () => NOW,
    log: (...a) => logs.push(a),
  });
  assert.equal(probed.length, 15);
  assert.ok(!probed.includes('https://m00.example'), 'denylisted');
  assert.ok(peak <= 3, `pool of 3, saw ${peak}`);
  assert.equal(result.mints.length, MAX_DISCOVERED);
  const urls = result.mints.map(m => m.url);
  assert.ok(!urls.includes('https://m01.example'));
  assert.ok(!urls.includes('https://m02.example'));
  assert.equal(urls[0], 'https://m03.example');
  assert.ok(
    logs.some(
      l =>
        l[0] === 'discovered mint dropped' &&
        l[1] === 'https://m01.example' &&
        l[2] === 'keysets: no active sat',
    ),
  );
});

test('discoverMints merges a partial relay failure and reports no answer when all fail', async () => {
  const url = 'https://split.example';
  const [a, ...reviews] = mint(url, 3);
  const partial = await discoverMints({
    query: relaysOf(
      answer([a, reviews[0]]),
      new Error('down'),
      answer([reviews[1], reviews[2], a]),
    ),
    relays: RELAYS,
    defaults: [],
    probe: okProbe,
    now: () => NOW,
    log: () => {},
  });
  assert.deepEqual(
    partial.mints.map(m => m.url),
    [url],
  );
  const none = await discoverMints({
    query: relaysOf(new Error('down'), {answered: false, events: []}),
    relays: RELAYS,
    defaults: [],
    probe: okProbe,
    log: () => {},
  });
  assert.deepEqual(none, {answered: false, mints: []});
});

// ── createDiscovery ──────────────────────────────────────────────────────

function controlled() {
  let calls = 0;
  let up = true;
  let events: unknown[] = mint('https://one.example', 3);
  const gates: (() => void)[] = [];
  let hold = false;
  const query: RelayQuery = async () => {
    calls++;
    if (hold) await new Promise<void>(r => gates.push(r));
    return up ? answer(events) : {answered: false, events: []};
  };
  return {
    query,
    get calls() {
      return calls;
    },
    set up(v: boolean) {
      up = v;
    },
    set events(v: unknown[]) {
      events = v;
    },
    set hold(v: boolean) {
      hold = v;
    },
    release() {
      for (const g of gates.splice(0)) g();
    },
  };
}

const flush = () => new Promise(r => setTimeout(r, 5));

test('snapshot serves nothing until the first refresh lands, then caches for the TTL', async () => {
  let t = NOW;
  const relay = controlled();
  const d = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => t,
    log: () => {},
  });
  assert.equal(relay.calls, 0, 'no I/O at construction');
  assert.deepEqual(d.snapshot(), []);
  await flush();
  assert.deepEqual(
    d.snapshot().map(m => m.url),
    ['https://one.example'],
  );
  assert.equal(relay.calls, 1);
  t += 3_600_000 - 1;
  d.snapshot();
  await flush();
  assert.equal(relay.calls, 1, 'cached for an hour');
  t += 1;
  relay.events = mint('https://two.example', 4);
  d.snapshot();
  await flush();
  assert.equal(relay.calls, 2);
  assert.deepEqual(
    d.snapshot().map(m => m.url),
    ['https://two.example'],
  );
});

test('concurrent snapshots start one refresh', async () => {
  const relay = controlled();
  relay.hold = true;
  const background: Promise<unknown>[] = [];
  const d = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => NOW,
    log: () => {},
    background: p => background.push(p),
  });
  for (let i = 0; i < 5; i++) d.snapshot();
  await flush();
  assert.equal(relay.calls, 1);
  assert.equal(background.length, 1, 'handed to waitUntil once');
  relay.release();
  await Promise.all(background);
  assert.equal(d.snapshot().length, 1);
});

test('when no relay answers the old set is kept and retried after a minute', async () => {
  let t = NOW;
  const relay = controlled();
  const d = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => t,
    log: () => {},
  });
  await d.refresh();
  assert.equal(d.snapshot().length, 1);
  relay.up = false;
  t += 3_600_000;
  d.snapshot();
  await flush();
  assert.equal(relay.calls, 2);
  assert.equal(d.snapshot().length, 1, 'old set kept');
  t += 59_999;
  d.snapshot();
  await flush();
  assert.equal(relay.calls, 2, 'not before a minute');
  t += 1;
  d.snapshot();
  await flush();
  assert.equal(relay.calls, 3, 'retried after a minute');
  // all relays down from cold: nothing discovered (the defaults alone serve)
  const cold = createDiscovery({
    query: async () => ({answered: false, events: []}),
    relays: ['r0'],
    defaults: [],
    log: () => {},
  });
  await cold.refresh();
  assert.deepEqual(cold.snapshot(), []);
});

test('a stale refresh cannot overwrite a newer one', async () => {
  let n = 0;
  const gates: (() => void)[] = [];
  const d = createDiscovery({
    query: async () => {
      const mine = ++n;
      if (mine === 1) await new Promise<void>(r => gates.push(r));
      return answer(mint(`https://gen${mine}.example`, 3));
    },
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => NOW,
    log: () => {},
  });
  const first = d.refresh();
  await flush();
  await d.refresh(); // the second refresh lands first
  assert.deepEqual(
    d.snapshot().map(m => m.url),
    ['https://gen2.example'],
  );
  gates[0]();
  await first;
  assert.deepEqual(
    d.snapshot().map(m => m.url),
    ['https://gen2.example'],
    'the older refresh is discarded',
  );
});

test('the store round-trips the last-good set and a bad one is discarded', async () => {
  let saved: unknown;
  const relay = controlled();
  const store = {
    load: async () => saved,
    save: async (v: unknown) => {
      saved = v;
    },
  };
  const d1 = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => NOW,
    log: () => {},
    store,
  });
  await d1.refresh();
  assert.deepEqual(saved, {
    v: 1,
    at: NOW,
    mints: [
      {url: 'https://one.example', reviews: 3, name: 'name of one.example'},
    ],
  });
  // a new instance (DO restart) serves the stored set without asking relays
  const before = relay.calls;
  const d2 = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => NOW + 1000,
    log: () => {},
    store,
  });
  d2.snapshot();
  await flush();
  assert.equal(relay.calls, before, 'a fresh stored set needs no relay');
  assert.deepEqual(
    d2.snapshot().map(m => m.url),
    ['https://one.example'],
  );
  // a stored set past its TTL is served and refreshed
  const d3 = createDiscovery({
    query: relay.query,
    relays: ['r0'],
    defaults: [],
    probe: okProbe,
    now: () => NOW + 3_600_000,
    log: () => {},
    store,
  });
  d3.snapshot();
  await flush();
  assert.equal(relay.calls, before + 1);

  const bad: unknown[] = [
    undefined,
    null,
    'x',
    {v: 2, at: NOW, mints: []},
    {v: 1, at: 'now', mints: []},
    {v: 1, at: NOW, mints: [{url: 'http://x.example', reviews: 3}]},
    {v: 1, at: NOW, mints: [{url: 'https://X.example', reviews: 3}]},
    {v: 1, at: NOW, mints: [{url: 'https://x.example', reviews: -1}]},
    {
      v: 1,
      at: NOW,
      mints: [{url: 'https://x.example', reviews: 3, name: 'a\nb'}],
    },
    {v: 1, at: NOW, mints: [null]},
  ];
  for (const b of bad)
    assert.equal(parseStored(b), undefined, JSON.stringify(b));
  const d4 = createDiscovery({
    query: async () => ({answered: false, events: []}),
    relays: ['r0'],
    defaults: [],
    now: () => NOW,
    log: () => {},
    store: {
      load: async () => ({
        v: 9,
        at: NOW,
        mints: [{url: 'https://x.example', reviews: 9}],
      }),
      save: async () => {},
    },
  });
  d4.snapshot();
  await flush();
  assert.deepEqual(d4.snapshot(), [], 'unknown version discarded');
  const d5 = createDiscovery({
    query: async () => ({answered: false, events: []}),
    relays: ['r0'],
    defaults: [],
    now: () => NOW,
    log: () => {},
    store: {
      load: async () => {
        throw new Error('storage');
      },
      save: async () => {},
    },
  });
  await d5.refresh();
  assert.deepEqual(d5.snapshot(), []);
});

// ── createCatalog ────────────────────────────────────────────────────────

test('createCatalog lists probed defaults first, then the discovered set without duplicates', async () => {
  const snap: DiscoveredMint[] = [
    {url: 'https://d1.example', reviews: 7, name: 'D1'},
    {url: 'https://a.example', reviews: 5, name: 'dup of a default'},
    {url: 'https://d2.example', reviews: 3},
  ];
  const c = createCatalog(
    async () => ['https://a.example', 'https://b.example'],
    {
      snapshot: () => snap,
    },
  );
  assert.deepEqual(await c.availableMints(), [
    'https://a.example',
    'https://b.example',
    'https://d1.example',
    'https://d2.example',
  ]);
  assert.deepEqual(c.mintInfo()['https://d1.example'], {
    name: 'D1',
    reviews: 7,
  });
  assert.deepEqual(c.mintInfo()['https://d2.example'], {reviews: 3});
});

test('parseDenylist reads a JSON array of strings and refuses anything else', () => {
  assert.deepEqual(parseDenylist(undefined), []);
  assert.deepEqual(parseDenylist(' '), []);
  assert.deepEqual(parseDenylist('["https://x.example"]'), [
    'https://x.example',
  ]);
  for (const bad of ['{', '{}', '[1]', '"x"'])
    assert.throws(() => parseDenylist(bad), Error, bad);
});

// ── the relay query over a fake socket ───────────────────────────────────

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  private readonly handlers: Record<string, ((e: {data: unknown}) => void)[]> =
    {};
  constructor(
    private readonly onSend?: (s: FakeSocket, data: string) => void,
  ) {}
  send(data: string): void {
    this.sent.push(data);
    this.onSend?.(this, data);
  }
  close(): void {
    this.closed = true;
  }
  addEventListener(type: string, fn: (e: {data: unknown}) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  emit(type: string, data?: unknown): void {
    for (const fn of this.handlers[type] ?? []) fn({data});
  }
  subId(): string {
    return JSON.parse(this.sent[0])[1];
  }
}

test('the relay query collects events until EOSE and sends CLOSE', async () => {
  const ev = review(2, 'https://x.example');
  const sock = new FakeSocket((s, data) => {
    const msg = JSON.parse(data);
    if (msg[0] !== 'REQ') return;
    queueMicrotask(() => {
      s.emit('message', JSON.stringify(['NOTICE', 'hello']));
      s.emit('message', '{not json');
      s.emit('message', 42);
      s.emit('message', JSON.stringify(['EVENT', 'other-sub', ev]));
      s.emit('message', JSON.stringify(['EVENT', msg[1], ev]));
      s.emit(
        'message',
        JSON.stringify([
          'EVENT',
          msg[1],
          {...ev, content: 'x'.repeat(300_000)},
        ]),
      );
      s.emit('message', JSON.stringify(['EOSE', msg[1]]));
      s.emit('message', JSON.stringify(['EVENT', msg[1], ev])); // after EOSE
    });
  });
  const r = await createRelayQuery(async () => sock)('wss://r.example');
  assert.equal(r.answered, true);
  assert.deepEqual(r.events, [ev]);
  const req = JSON.parse(sock.sent[0]);
  assert.equal(req[0], 'REQ');
  assert.deepEqual(req.slice(2), [
    {kinds: [38172], limit: 500},
    {kinds: [38000], '#k': ['38172'], limit: 500},
  ]);
  assert.deepEqual(JSON.parse(sock.sent.at(-1)!), ['CLOSE', sock.subId()]);
  assert.ok(sock.closed);
});

test('the relay query ends on CLOSED, close, timeout and connect failure, never throwing', async () => {
  const closedSock = new FakeSocket((s, data) => {
    const msg = JSON.parse(data);
    if (msg[0] === 'REQ')
      queueMicrotask(() =>
        s.emit('message', JSON.stringify(['CLOSED', msg[1], 'blocked'])),
      );
  });
  const closed = await createRelayQuery(async () => closedSock)('wss://r');
  assert.equal(closed.answered, true);
  assert.deepEqual(closed.events, []);

  const dropSock = new FakeSocket((s, data) => {
    if (JSON.parse(data)[0] === 'REQ') queueMicrotask(() => s.emit('close'));
  });
  const dropped = await createRelayQuery(async () => dropSock)('wss://r');
  assert.equal(dropped.answered, false);

  const silent = new FakeSocket();
  const timed = await createRelayQuery(async () => silent, 20)('wss://r');
  assert.deepEqual(timed, {answered: false, events: []});
  assert.deepEqual(JSON.parse(silent.sent.at(-1)!)[0], 'CLOSE');
  assert.ok(silent.closed);

  // events then a timeout: what arrived still counts as an answer
  const ev = review(2, 'https://x.example');
  const partial = new FakeSocket((s, data) => {
    const msg = JSON.parse(data);
    if (msg[0] === 'REQ')
      queueMicrotask(() =>
        s.emit('message', JSON.stringify(['EVENT', msg[1], ev])),
      );
  });
  const slow = await createRelayQuery(async () => partial, 20)('wss://r');
  assert.equal(slow.answered, true);
  assert.equal(slow.events.length, 1);

  const refused = await createRelayQuery(async () => {
    throw new Error('refused');
  })('wss://r');
  assert.deepEqual(refused, {answered: false, events: []});

  // a connect that resolves after the timeout is closed, not leaked
  const late = new FakeSocket();
  const lateQuery = await createRelayQuery(
    () => new Promise(r => setTimeout(() => r(late), 40)),
    10,
  )('wss://r');
  assert.equal(lateQuery.answered, false);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(late.closed);
});
