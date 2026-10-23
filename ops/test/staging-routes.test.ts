import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingRouteAllowed} from '../src/staging-routes';
const attempt = '00000000-0000-4000-8000-000000000001';
test('staging permits only operator provisioning and backup-status methods', () => {
  for (const [method, path] of [
    ['GET', '/mints'],
    ['GET', '/ops/operators'],
    ['GET', '/admin/operators'],
    ['GET', '/admin/operators/audit'],
    ['POST', '/admin/operators'],
    ...['disable', 'enable', 'reset-password'].map(a => [
      'POST',
      `/admin/operators/2/${a}`,
    ]),
    ['POST', '/auth/operator/session'],
    ['POST', '/auth/operator/signout'],
    ['GET', '/auth/operator/sessions'],
    ['POST', '/auth/operator/revoke'],
    ['GET', '/ops/backup-status'],
    ['GET', '/ops/recovery/setup'],
    ['GET', '/ops/recovery/connections'],
    ['POST', '/ops/recovery/pairings'],
    ['POST', '/recovery/claim'],
    ['POST', '/recovery/copy-receipts'],
    ['POST', `/ops/recovery/connections/${attempt}/attestation`],
    [
      'GET',
      '/recovery/metadata/2026-10-21T00%3A00%3A00.000Z-11111111-2222-4333-8444-555555555555.age',
    ],
    ['GET', '/recovery/exports'],
    [
      'GET',
      '/recovery/exports/2026-10-21T00%3A00%3A00.000Z-11111111-2222-4333-8444-555555555555.age',
    ],
    ['DELETE', `/ops/recovery/connections/${attempt}`],
    ['POST', '/keys/issue'],
    ['POST', '/provisioning/batches'],
    ['POST', '/provisioning/attempts'],
    ['GET', '/provisioning/reset-source'],
    ['POST', '/provisioning/reset-intents'],
    ['GET', `/provisioning/reset-intents/${attempt}`],
    ['POST', `/provisioning/reset-intents/${attempt}/keys`],
    ['POST', `/provisioning/reset-intents/${attempt}/complete`],
    ['GET', `/provisioning/attempts/${attempt}`],
    ...['bind', 'record', 'disposition'].map(action => [
      'POST',
      `/provisioning/attempts/${attempt}/${action}`,
    ]),
  ])
    assert.equal(
      stagingRouteAllowed(method!, path!),
      true,
      `${method} ${path}`,
    );
});
test('staging blocks anchor, holder, legacy, unknown paths and wrong methods', () => {
  for (const [method, path] of [
    ['GET', '/anchor/tip'],
    ['POST', '/auth/holder/session'],
    ['GET', '/registry/cards'],
    ['POST', '/registry/cards'],
    ['GET', '/keys/issue'],
    ['POST', '/mints'],
    ['DELETE', `/provisioning/attempts/${attempt}`],
    ['POST', `/provisioning/attempts/${attempt}`],
    ['GET', '/provisioning/attempts/not-a-uuid'],
    ['GET', '/unknown'],
    ['DELETE', '/admin/operators/2'],
    ['GET', '/admin/operators/2/disable'],
    ['POST', '/recovery/exports'],
    ['DELETE', '/ops/recovery/connections'],
    ['GET', '/recovery/exports/other/path'],
    ['GET', `/provisioning/attempts/${attempt}/record`],
  ])
    assert.equal(
      stagingRouteAllowed(method!, path!),
      false,
      `${method} ${path}`,
    );
});
