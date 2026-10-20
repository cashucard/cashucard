/**
 * The anchor tip: 80-byte validation, the 60 s cache, and upstream failure
 * → 503-shaped answer carrying the last-good header. The fetcher is
 * injected — no network in this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {AnchorFeed, CACHE_SECONDS, HEADER_LEN} from '../src/anchor';

const HEADER = Buffer.alloc(HEADER_LEN, 0xab);
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

const heightOf = (h: number) => Buffer.from(String(h), 'ascii');
const TIP_URL = 'https://mempool.space/api/blocks/tip/height';
const blockUrl = (h: number) => `https://mempool.space/api/block-height/${h}`;

test('a good tip is an 80-byte header with its height', async () => {
  const f = feed(
    new Map([
      [TIP_URL, heightOf(900_000)],
      [blockUrl(900_000), HEADER],
    ]),
  );
  const r = await f.tip();
  assert.ok(r.ok);
  assert.ok(r.ok && r.tip.header.equals(HEADER));
  assert.ok(r.ok && r.tip.height === 900_000);
});

test('a wrong-length header is rejected (shape validation, cardctl parity)', async () => {
  const f = feed(
    new Map([
      [TIP_URL, heightOf(900_000)],
      [blockUrl(900_000), Buffer.alloc(79)],
    ]),
  );
  const r = await f.tip();
  assert.ok(!r.ok);
  assert.equal(r.ok === false ? r.stale : null, null, 'no last-good yet');
});

test('the cache holds for CACHE_SECONDS, then refetches', async () => {
  const f = feed(
    new Map([
      [TIP_URL, heightOf(900_000)],
      [blockUrl(900_000), HEADER],
    ]),
  );
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
    callsAfterFirst + 2,
    'cache expired: height + header refetched',
  );
});

test('upstream failure answers the last-good header (503-shaped)', async () => {
  const responses = new Map<string, Buffer | Error>([
    [TIP_URL, heightOf(900_000)],
    [blockUrl(900_000), HEADER],
  ]);
  const f = feed(responses);
  const first = await f.tip();
  assert.ok(first.ok);
  clock += CACHE_SECONDS + 1;
  responses.set(TIP_URL, new Error('upstream down'));
  const second = await f.tip();
  assert.ok(!second.ok);
  assert.ok(
    second.ok === false &&
      second.stale !== null &&
      second.stale.header.equals(HEADER),
  );
});

test('upstream failure with no last-good is a bare 503-shaped answer', async () => {
  const f = feed(new Map([[TIP_URL, new Error('down')]]));
  const r = await f.tip();
  assert.ok(!r.ok);
  assert.equal(r.ok === false ? r.stale : undefined, null);
});

test('a garbage height is rejected like a failed upstream', async () => {
  const f = feed(new Map([[TIP_URL, Buffer.from('not-a-number')]]));
  const r = await f.tip();
  assert.ok(!r.ok);
});
