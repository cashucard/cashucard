/**
 * The anchor tip: 80-byte validation, the 60 s cache, and upstream failure
 * → 503-shaped answer carrying the last-good header. The fetcher is
 * injected — no network in this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {AnchorFeed, CACHE_SECONDS} from '../src/anchor';
import {
  tipUrl,
  blockIdUrl,
  headerUrl,
  headerHex,
  recordedTip,
  recordedFetch,
} from './fixtures/esplora-tip';

const HEADER = Buffer.from(headerHex, 'hex');
let clock = 1_000_000;

function feed(
  responses: Map<string, Buffer | Error>,
  opts: {now?: () => number} = {},
): AnchorFeed & {calls: number} {
  let calls = 0;
  const fetcher = async (url: string): Promise<Buffer> => {
    calls++;
    const r = responses.get(url);
    if (!r) {
      throw new Error('unexpected url ' + url);
    }
    if (r instanceof Error) {
      throw r;
    }
    return r;
  };
  const f = new AnchorFeed(fetcher, opts.now ?? (() => clock)) as AnchorFeed & {
    calls: number;
  };
  Object.defineProperty(f, 'calls', {get: () => calls});
  return f;
}

test('a good tip is an 80-byte header with its height', async () => {
  const f = feed(recordedTip());
  const r = await f.tip();
  assert.ok(r.ok);
  assert.ok(r.ok && r.tip.header.equals(HEADER));
  assert.ok(r.ok && r.tip.height === 900_000);
});

test('each malformed upstream response or fetch failure keeps the last good tip', async () => {
  const cases: [string, Buffer | Error, number][] = [
    [tipUrl, Buffer.from('900000junk'), 1],
    [tipUrl, new Error('unreachable height'), 1],
    [blockIdUrl, Buffer.from('../invalid'), 2],
    [blockIdUrl, new Error('unreachable ID'), 2],
    [headerUrl, Buffer.from('00'.repeat(79)), 3],
    [headerUrl, Buffer.from('gg'.repeat(80)), 3],
    [headerUrl, Buffer.from('00'.repeat(80)), 3],
    [headerUrl, new Error('unreachable header'), 3],
  ];
  for (const [url, reply, expectedCalls] of cases) {
    let time = 1000;
    const replies = recordedTip();
    const f = feed(replies, {now: () => time});
    assert.ok((await f.tip()).ok);
    replies.set(url, reply);
    time += CACHE_SECONDS;
    const result = await f.tip();
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('unexpected live tip');
    assert.deepEqual(result.stale, {
      height: 900000,
      header: HEADER,
      fetchedAt: 1000,
    });
    assert.equal(
      f.calls,
      3 + expectedCalls + 1,
      'also attempted fallback height',
    );
  }
});

const secondary = (url: string) =>
  url.replace('mempool.space', 'blockstream.info');

test('a primary timeout restarts the complete lookup at the independent provider', async () => {
  const calls: string[] = [];
  const signals = new Map<string, AbortSignal>();
  const feed = new AnchorFeed(
    async (url: string, signal?: AbortSignal) => {
      calls.push(url);
      assert.ok(signal, 'the complete provider lookup is bounded');
      const host = new URL(url).host;
      const previous = signals.get(host);
      if (previous) assert.equal(signal, previous);
      signals.set(host, signal);
      if (url === blockIdUrl)
        throw new DOMException('Timed out', 'TimeoutError');
      return recordedFetch(url.replace('blockstream.info', 'mempool.space'));
    },
    () => 100,
  );
  const result = await feed.tip();
  assert.ok(result.ok && result.tip.header.equals(HEADER));
  assert.deepEqual(calls, [
    tipUrl,
    blockIdUrl,
    secondary(tipUrl),
    secondary(blockIdUrl),
    secondary(headerUrl),
  ]);
  assert.notEqual(
    signals.get('mempool.space'),
    signals.get('blockstream.info'),
  );
  assert.deepEqual(await feed.tip(), result);
  assert.equal(calls.length, 5, 'the fallback result populates the cache');
});

test('an unusable secondary header cannot repair an incomplete primary lookup', async () => {
  const badHeaders = [
    Buffer.from('z'.repeat(160)),
    Buffer.from('00'.repeat(80)),
  ];
  for (const badHeader of badHeaders) {
    const replies = recordedTip();
    replies.set(headerUrl, new Error('failed after resolving primary ID'));
    for (const [url, response] of recordedTip())
      replies.set(secondary(url), response);
    replies.set(secondary(headerUrl), badHeader);
    const f = feed(replies);
    assert.deepEqual(await f.tip(), {ok: false, stale: null});
    assert.equal(f.calls, 6, 'both complete lookup paths were checked');
    replies.delete(secondary(blockIdUrl));
    replies.set(secondary(headerUrl), Buffer.from(headerHex));
    assert.deepEqual(await f.tip(), {ok: false, stale: null});
    assert.equal(
      f.calls,
      11,
      'an ID from the first source cannot supply the second',
    );
  }
});

test('the cache holds for CACHE_SECONDS, then refetches', async () => {
  const f = feed(recordedTip());
  const first = await f.tip();
  assert.ok(first.ok);
  const callsAfterFirst = f.calls;
  clock += CACHE_SECONDS - 1;
  const second = await f.tip();
  assert.ok(second.ok);
  assert.equal(f.calls, callsAfterFirst, 'served from cache');
  clock += 1;
  const third = await f.tip();
  assert.ok(third.ok);
  assert.equal(
    f.calls,
    callsAfterFirst + 3,
    'cache expired: height, block ID and header refetched',
  );
});

test('upstream failure answers the last-good header (503-shaped)', async () => {
  const responses = recordedTip();
  const f = feed(responses);
  const first = await f.tip();
  assert.ok(first.ok);
  clock += CACHE_SECONDS + 1;
  responses.set(tipUrl, new Error('upstream down'));
  const second = await f.tip();
  assert.ok(!second.ok);
  assert.ok(
    second.ok === false &&
      second.stale !== null &&
      second.stale.header.equals(HEADER),
  );
});

test('upstream failure with no last-good is a bare 503-shaped answer', async () => {
  const f = feed(new Map([[tipUrl, new Error('down')]]));
  const r = await f.tip();
  assert.ok(!r.ok);
  assert.equal(r.ok === false ? r.stale : undefined, null);
});

test('a garbage height is rejected like a failed upstream', async () => {
  const f = feed(new Map([[tipUrl, Buffer.from('not-a-number')]]));
  const r = await f.tip();
  assert.ok(!r.ok);
});

// ── the last-good header persists (the 503 fallback survives a restart) ──────

/** An in-memory TipStore, plus a reader for what a "restart" would see. */
function memoryStore() {
  let saved: {header: Buffer; height: number; fetchedAt: number} | undefined;
  return {
    read: () =>
      saved ? {...saved, header: Buffer.from(saved.header)} : undefined,
    write: (tip: {header: Buffer; height: number; fetchedAt: number}) => {
      saved = {...tip, header: Buffer.from(tip.header)};
    },
    peek: () => saved,
  };
}

test('a fetched tip is written to the store; a restarted feed seeds from it', async () => {
  const store = memoryStore();
  const f = new AnchorFeed(recordedFetch, () => clock, store);
  await f.tip();
  assert.ok(store.peek(), 'the good tip was persisted');
  assert.equal(store.peek()!.height, 900_000);

  // The restart: a NEW feed over the same store, its fetcher dead.
  const restarted = new AnchorFeed(
    async () => {
      throw new Error('upstream down after restart');
    },
    () => clock + CACHE_SECONDS + 1,
    store,
  );
  const r = await restarted.tip();
  assert.ok(!r.ok, 'upstream is down after the restart');
  assert.ok(r.ok === false && r.stale !== null);
  assert.ok(r.ok === false && r.stale!.header.equals(HEADER));
  assert.equal(r.ok === false ? r.stale!.height : -1, 900_000);
});

test('a store row from before the height column (no height) does not seed', () => {
  const store = {
    read: () => ({
      header: Buffer.from(HEADER),
      height: 0,
      fetchedAt: 1,
    }),
    write: () => undefined,
  };
  const f = new AnchorFeed(
    async () => {
      throw new Error('down');
    },
    () => clock,
    store,
  );
  return f.tip().then(r => {
    assert.ok(!r.ok);
    assert.equal(r.ok === false ? r.stale : null, null, 'invalid seed ignored');
  });
});

test('a failed store write does not take the tip down', async () => {
  const f = new AnchorFeed(recordedFetch, () => clock, {
    read: () => undefined,
    write: () => {
      throw new Error('disk full');
    },
  });
  const r = await f.tip();
  assert.ok(r.ok, 'the tip still answers with the store broken');
});
