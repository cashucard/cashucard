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
      json: {
        operator_id: 1,
        token: 't0k3n',
        kind: 'operator',
        env: 'issued',
        expires_at: 1,
      },
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

test('a bind conflict carries a bounded operation, not a request path', async () => {
  const {fetcher} = scriptedFetcher([
    () => ({
      status: 409,
      json: {reason: 'chip-unresolved', message: 'private detail'},
    }),
  ]);
  const service = new ApiClient({
    baseUrl: 'https://ops.test',
    fetcher,
  }).reservations({operator_id: 7, env: 'issued', token: 'secret'});
  await expect(
    service.bind('device', 'attempt', {revision: 0, chip_id: 'chip'}),
  ).rejects.toMatchObject({
    name: 'ApiServiceError',
    status: 409,
    reason: 'chip-unresolved',
    operation: 'bind-card',
  });
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
  expect(calls).toBe(2);
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

test('a 401 aborts the retry pass (the caller signs out; no row can succeed behind it)', async () => {
  const {fetcher, bodies} = scriptedFetcher([
    () => ({status: 401, json: {reason: 'no-session'}}),
    () => ({status: 200, json: {stored: {}}}),
  ]);
  const client = new ApiClient({baseUrl: 'http://ops.test', fetcher});
  const outbox = new RegistryOutbox(client);
  outbox.add(row({short_id: 'aaaa'}));
  outbox.add(row({short_id: 'bbbb'}));
  await expect(outbox.retryAll('tok')).rejects.toMatchObject({
    name: 'ApiServiceError',
    status: 401,
  });
  expect(bodies.length).toBe(1);
  expect(outbox.pendingRows.length).toBe(2);
});

test('the documented timeout actually fires: a hung fetcher rejects in ApiUnreachableError', async () => {
  let sawSignal: AbortSignal | null = null;
  const hung = (_url: string, init?: RequestInit): Promise<Response> => {
    sawSignal = (init?.signal as AbortSignal) ?? null;
    return new Promise<Response>(() => undefined); // never resolves
  };
  const client = new ApiClient({
    baseUrl: 'http://ops.test',
    fetcher: hung,
    timeoutMs: 20,
  });
  await expect(client.operatorSession('n', 'p')).rejects.toBeInstanceOf(
    ApiUnreachableError,
  );
  expect(sawSignal).not.toBeNull();
  expect(sawSignal!.aborted).toBe(true);
});

test('the timeout does not fire on a healthy response; the timer is cleared', async () => {
  const {fetcher} = scriptedFetcher([
    () => ({
      status: 200,
      json: {
        operator_id: 1,
        token: 't',
        kind: 'operator',
        env: 'factory',
        expires_at: 1,
      },
    }),
  ]);
  const client = new ApiClient({
    baseUrl: 'http://ops.test',
    fetcher,
    timeoutMs: 20,
  });
  const s = await client.operatorSession('n', 'p');
  expect(s.token).toBe('t');
});

test('operator identity scopes the reservation transport and no numeric-only issuance is substituted', async () => {
  const bodies: unknown[] = [];
  const paths: string[] = [];
  const headers: unknown[] = [];
  const fetcher = async (
    url: string,
    init?: RequestInit,
  ): Promise<Response> => {
    paths.push(url);
    headers.push(init?.headers);
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return {
      ok: true,
      status: 200,
      json: async () =>
        paths.length === 1
          ? {
              operator_id: 17,
              kind: 'operator',
              env: 'issued',
              token: 'memory-only',
            }
          : {batch: {batch_id: 3}, attempt: {attempt_id: 'attempt'}},
    } as Response;
  };
  const client = new ApiClient({baseUrl: 'https://ops.test', fetcher});
  const session = await client.operatorSession('lead', 'password');
  const service = client.reservations(session);
  expect(service.scope).toEqual({
    operator_id: 17,
    key_env: 'issued',
    service_origin: 'https://ops.test',
  });
  const request = {
    device_id: 'device',
    batch_request_id: 'request',
    count: 1,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard' as const,
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'ab'.repeat(32),
  };
  await service.batch(request);
  await service.reserve({
    device_id: 'device',
    attempt_id: 'attempt',
    batch_id: 3,
    ordinal: 0,
  });
  await service.attempt('device', 'attempt');
  expect(paths.slice(1)).toEqual([
    'https://ops.test/provisioning/batches',
    'https://ops.test/provisioning/attempts',
    'https://ops.test/provisioning/attempts/attempt?device_id=device',
  ]);
  expect(bodies[1]).toEqual(request);
  expect(bodies.slice(1)).not.toContainEqual(
    expect.objectContaining({token: expect.anything()}),
  );
  expect(headers[3]).toEqual(
    expect.objectContaining({Authorization: 'Bearer memory-only'}),
  );
});

test('sign-in cannot return a session with missing stable operator identity', async () => {
  const {fetcher} = scriptedFetcher([
    () => ({
      status: 200,
      json: {kind: 'operator', env: 'issued', token: 'token'},
    }),
  ]);
  await expect(
    new ApiClient({baseUrl: 'https://ops.test', fetcher}).operatorSession(
      'lead',
      'password',
    ),
  ).rejects.toThrow('malformed');
});

test('card orchestration routes preserve frozen records and scoped key/disposition requests', async () => {
  const requests: {url: string; body: unknown}[] = [];
  const client = new ApiClient({
    baseUrl: 'https://ops.test',
    fetcher: async (url, init) => {
      requests.push({url, body: JSON.parse(String(init!.body))});
      return {
        ok: true,
        status: 200,
        json: async () => ({receipt: {}, enc: 'key'}),
      } as Response;
    },
  });
  const service = client.reservations({
    operator_id: 7,
    env: 'issued',
    token: 'memory-only',
  });
  await service.bind('device', 'attempt', {revision: 0, chip_id: 'chip'});
  await service.keys('device', 'attempt');
  const frozen = '{"verified_at":123,"display_id":"abcd"}';
  await service.record('device', 'attempt', 1, frozen);
  await service.disposition('device', 'attempt', {
    revision: 1,
    kind: 'quarantined',
    reason: 'authentication-failed',
  });
  expect(requests).toEqual([
    {
      url: 'https://ops.test/provisioning/attempts/attempt/bind',
      body: {device_id: 'device', revision: 0, chip_id: 'chip'},
    },
    {
      url: 'https://ops.test/keys/issue',
      body: {device_id: 'device', attempt_id: 'attempt'},
    },
    {
      url: 'https://ops.test/provisioning/attempts/attempt/record',
      body: {device_id: 'device', revision: 1, record: JSON.parse(frozen)},
    },
    {
      url: 'https://ops.test/provisioning/attempts/attempt/disposition',
      body: {
        device_id: 'device',
        revision: 1,
        kind: 'quarantined',
        reason: 'authentication-failed',
      },
    },
  ]);
  expect(JSON.stringify(requests)).not.toContain('memory-only');
});

test('sign-in has a bounded 30s budget while ordinary requests retain 10s', async () => {
  jest.useFakeTimers();
  const signals: AbortSignal[] = [];
  const client = new ApiClient({
    baseUrl: 'https://ops.test',
    fetcher: (_url, init) => {
      signals.push(init!.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    },
  });
  try {
    const login = client
      .operatorSession('lead', 'public test password')
      .catch(error => error);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(signals[0]!.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await login).toBeInstanceOf(ApiUnreachableError);
    expect(signals[0]!.aborted).toBe(true);
    const mint = client.mints('public-test-token').catch(error => error);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await mint).toBeInstanceOf(ApiUnreachableError);
    expect(signals[1]!.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
