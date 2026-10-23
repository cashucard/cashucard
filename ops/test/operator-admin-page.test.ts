import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {operatorAdminPage} from '../src/operator-admin-page';

test('served console script/style match the restrictive CSP and require no third-party assets', () => {
  const page = operatorAdminPage();
  const script = /<script>([\s\S]*?)<\/script>/.exec(page.html)![1]!;
  const style = /<style>([\s\S]*?)<\/style>/.exec(page.html)![1]!;
  const csp = page.headers['content-security-policy'];
  for (const source of [script, style])
    assert.ok(
      csp.includes(
        "'sha256-" + createHash('sha256').update(source).digest('base64') + "'",
      ),
    );
  assert.doesNotThrow(() => new Script(script));
  assert.ok(csp.includes("connect-src 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import\b/.test(page.html));
  assert.equal(page.headers['cache-control'], 'no-store, no-transform');
});

test('console uses wallet-neutral Cashu branding and a bundled logo', () => {
  const {html} = operatorAdminPage();
  assert.match(html, /Cashu Card Provisioner/);
  assert.doesNotMatch(html, /\b(?:flash|foxy)\b/i);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('installation states explain the outcome while preserving machine filter values', () => {
  const {html} = operatorAdminPage();
  assert.match(html, /<option value="recorded">Installation saved<\/option>/);
  assert.match(html, /<option value="quarantined">Needs review<\/option>/);
  assert.match(html, /<option value="abandoned">Stopped<\/option>/);
  assert.doesNotMatch(html, /before using the card again/);
});
