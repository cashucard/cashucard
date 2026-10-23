import {mintSettlementJson, MintSettlementError} from '../src/mintSettlement';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('settlement requests carry only public query data and reject redirects or oversized replies', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    redirected: false,
    url: 'https://mint.test/v1/checkstate',
    text: async () => '{"states":[]}',
  } as Response);
  await expect(
    mintSettlementJson('https://mint.test', '/v1/checkstate', {
      Ys: ['public-Y'],
    }),
  ).resolves.toEqual({states: []});
  const [, init] = fetcher.mock.calls[0];
  expect(init?.headers).toEqual({'Content-Type': 'application/json'});
  expect(init?.redirect).toBe('error');
  expect(init?.body).toBe('{"Ys":["public-Y"]}');
  for (const reply of [
    {redirected: true, url: 'https://other.test/'},
    {
      redirected: false,
      url: 'https://mint.test/v1/checkstate',
      text: async () => 'x'.repeat(65537),
    },
  ]) {
    fetcher.mockResolvedValueOnce({
      ok: true,
      text: async () => '{}',
      ...reply,
    } as Response);
    await expect(
      mintSettlementJson('https://mint.test', '/v1/checkstate', {Ys: []}),
    ).rejects.toThrow('Settlement could not be confirmed');
  }
});
test('a transport that ignores abort cannot keep the reset waiting indefinitely', async () => {
  jest.useFakeTimers();
  jest.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
  const request = mintSettlementJson('https://mint.test', '/v1/keysets');
  const outcome = request.catch(error => error);
  await jest.advanceTimersByTimeAsync(15001);
  expect(await outcome).toEqual(
    new Error(
      'Settlement could not be confirmed. Keep the card and retry after reconnecting.',
    ),
  );
}, 1000);

test('operator stop aborts settlement checks without waiting for an unresponsive mint', async () => {
  const controller = new AbortController();
  const native = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => new Promise(() => {}));
  try {
    const pending = mintSettlementJson(
      'https://mint.test',
      '/v1/checkstate',
      {Ys: []},
      controller.signal,
    );
    const outcome = pending.catch(error => error);
    controller.abort();
    expect(await outcome).toBeInstanceOf(MintSettlementError);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    native.mockRestore();
  }
});
