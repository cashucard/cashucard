/**
 * The Workers-runtime suite never touches the network: the config's
 * outboundService answers every outbound fetch in this process. These pin it,
 * so a test that would reach a real host (the anchor route's mempool.space
 * among them) fails here rather than hanging on a runner's network.
 */
import {SELF} from 'cloudflare:test';
import {describe, expect, it} from 'vitest';

describe('the Workers tests are offline', () => {
  it('an outbound fetch is answered by the stub, not by the host', async () => {
    const res = await fetch('https://mempool.space/api/blocks/tip/height');
    expect(res.status).toBe(503);
    expect(res.headers.get('x-ops-test-offline')).toBe('1');
    expect(await res.text()).toBe('no network in the Workers tests');
  });

  it('GET /anchor/tip answers 503 at once: its upstream fails without leaving the machine', async () => {
    const started = Date.now();
    const res = await SELF.fetch('http://x/anchor/tip', {method: 'GET'});
    const took = Date.now() - started;
    expect(res.status).toBe(503);
    expect(((await res.json()) as {reason?: string}).reason).toBe(
      'upstream-unavailable',
    );
    expect(took).toBeLessThan(1000);
  });
});
