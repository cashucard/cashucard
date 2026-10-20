/**
 * The api surface and the outbox. The pin the plan names: the outbox freezes
 * the row body at first write and re-posts it byte-identical — a partial
 * field change between retries must not become a 409 the bench cannot
 * resolve. Transport failures are ApiUnreachableError; the service's own
 * reason strings are surfaced verbatim (S1).
 */
import {
  ApiClient,
  ApiServiceError,
  ApiUnreachableError,
  RegistryOutbox,
  type CardRegistryRow,
} from '../src/api';

const row = (over: Partial<CardRegistryRow> = {}): CardRegistryRow => ({
  short_id: '9c2f',
  batch_id: 1,
  key_id: 2,
  ordinal: 3,
  installed_at: 1_700_000_000,
  installer: 'op@bench-1',
  load_sha256: 'fe7d8ac3',
  ...over,
});

/** A fetcher that answers from a script, recording every body it is handed. */
function scriptedFetcher(
  script: Array<
    (url: string, body: unknown) => {status: number; json: unknown}
  >,
): {
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  bodies: unknown[];
  calls: number;
} {
  const state = {bodies: [] as unknown[], calls: 0};
  const fetcher = async (
    url: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const step = script[Math.min(state.calls, script.length - 1)];
    state.calls++;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.bodies.push(body);
    const answer = step(url, body);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.json,
    } as Response;
  };
  return {...state, fetcher};
}

test('operatorSession returns the service env and token', async () => {
  const {fetcher} = scriptedFetcher([
    () => ({
      status: 200,
      json: {token: 't0k3n', kind: 'operator', env: 'issued', expires_at: 1},
    }),
  ]);
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  const s = await client.operatorSession('bench-lead', 'pw');
  expect(s.token).toBe('t0k3n');
  expect(s.env).toBe('issued');
});

test('a failed sign-in surfaces the service reason, verbatim', async () => {
  const {fetcher} = scriptedFetcher([
    () => ({
      status: 401,
      json: {
        reason: 'bad-credentials',
        message: 'the name or password is wrong',
      },
    }),
  ]);
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  await expect(client.operatorSession('bench-lead', 'nope')).rejects.toThrow(
    ApiServiceError,
  );
  try {
    await client.operatorSession('bench-lead', 'nope');
  } catch (e) {
    expect((e as ApiServiceError).reason).toBe('bad-credentials');
  }
});

test('a network failure is ApiUnreachableError, not a generic throw', async () => {
  const fetcher = async (): Promise<Response> => {
    throw new TypeError('Network request failed');
  };
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  await expect(client.operatorSession('n', 'p')).rejects.toBeInstanceOf(
    ApiUnreachableError,
  );
});

test('the outbox freezes the row body at first write and re-posts it byte-identical', async () => {
  const {fetcher, bodies} = scriptedFetcher([
    () => ({status: 503, json: {reason: 'upstream-unavailable'}}), // first try fails
    () => ({status: 200, json: {stored: {}}}), // retry answers
  ]);
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  const outbox = new RegistryOutbox(client);
  const original = row();
  outbox.add(original);

  // Between the failure and the retry the app's live state moved on — a
  // partial field change that must NOT leak into the re-post.
  // (the original row object is frozen by the outbox; live state may drift)

  const first = await outbox.retryAll('tok');
  expect(first.posted).toBe(0);
  expect(first.stillPending).toBe(1);
  const firstBody = bodies[0];

  const second = await outbox.retryAll('tok');
  expect(second.posted).toBe(1);
  expect(second.stillPending).toBe(0);
  expect(bodies[1]).toEqual(firstBody);
  expect(bodies[1]).toEqual(original);
});

test('outbox rows flip to pending: false and stay there; answered rows are not re-posted', async () => {
  let calls = 0;
  const fetcher = async (): Promise<Response> => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({stored: {}}),
    } as Response;
  };
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  const outbox = new RegistryOutbox(client);
  outbox.add(row({short_id: 'aaaa'}));
  outbox.add(row({short_id: 'bbbb'}));
  await outbox.retryAll('tok');
  expect(calls).toBe(2);
  await outbox.retryAll('tok');
  expect(calls).toBe(2, 'answered rows are never re-posted');
  expect(outbox.pendingRows.length).toBe(0);
});

test('a 409 keeps the row pending and visible, never dropped', async () => {
  const {fetcher, bodies} = scriptedFetcher([
    () => ({status: 409, json: {reason: 'short-id-exists'}}),
    () => ({status: 409, json: {reason: 'short-id-exists'}}),
  ]);
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  const outbox = new RegistryOutbox(client);
  outbox.add(row());
  const r = await outbox.retryAll('tok');
  expect(r.posted).toBe(0);
  expect(r.stillPending).toBe(1);
  expect(bodies.length).toBe(1);
});
