import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {recoverySetup} from '../src/recovery-setup.workers';

// Execute the actual approval-page handlers; transport authority is covered by
// the real Workers recovery tests. This small DOM seam needs no browser/server.
interface Element {
  textContent: string;
  children: (Element | string)[];
  onclick?: () => Promise<void>;
  append(...nodes: (Element | string)[]): void;
  replaceChildren(): void;
}
const element = (): Element => ({
  textContent: '',
  children: [],
  append(...nodes) {
    this.children.push(...nodes);
  },
  replaceChildren() {
    this.children = [];
  },
});
test('approval HTML prevents CDN script injection without changing its CSP', () => {
  const response = recoverySetup();
  assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
  assert.match(
    response.headers.get('content-security-policy')!,
    /script-src 'nonce-/,
  );
});

test('administrator explicitly grants/removes copy attestation; revoked readers offer no grant', async () => {
  const html = await recoverySetup().text();
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]!;
  for (const [can_attest, revoked] of [
    [0, null],
    [1, null],
    [0, 1],
  ]) {
    const nodes = new Map<string, Element>();
    const requests: {path: string; method?: string; body?: string}[] = [];
    const context = createContext({
      document: {
        getElementById(id: string) {
          if (!nodes.has(id)) nodes.set(id, element());
          return nodes.get(id);
        },
        createElement: element,
        createTextNode: (text: string) => text,
      },
      confirm: () => true,
      fetch: async (
        path: string,
        options: {method?: string; body?: string},
      ) => {
        requests.push({path, ...options});
        return Response.json({
          connections: [{id: 'reader', name: 'copier', can_attest, revoked}],
        });
      },
    });
    runInContext(script, context);
    await runInContext('connections()', context);
    const buttons = nodes
      .get('connections')!
      .children.flatMap(li => (typeof li === 'string' ? [] : li.children))
      .filter((n): n is Element => typeof n !== 'string');
    const toggle = buttons.find(
      b =>
        b.textContent ===
        (can_attest ? 'Remove copy attestations' : 'Allow copy attestations'),
    );
    if (revoked) {
      assert.equal(toggle, undefined);
      continue;
    }
    assert.ok(toggle, 'a separate administrator action must be offered');
    await toggle.onclick!();
    const write = requests.find(r => r.method === 'POST');
    assert.equal(write?.path, '/ops/recovery/connections/reader/attestation');
    assert.deepEqual(JSON.parse(write!.body!), {enabled: !can_attest});
  }
});
