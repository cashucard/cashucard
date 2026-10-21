import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingRouteAllowed} from '../src/staging-routes';
const attempt = '00000000-0000-4000-8000-000000000001';
test('staging permits only operator provisioning and backup-status methods', () => {
  for (const [method, path] of [
    ['GET', '/mints'],
    ['POST', '/auth/operator/session'],
    ['POST', '/auth/operator/signout'],
    ['GET', '/auth/operator/sessions'],
    ['POST', '/auth/operator/revoke'],
    ['GET', '/ops/backup-status'],
    ['POST', '/keys/issue'],
    ['POST', '/provisioning/batches'],
    ['POST', '/provisioning/attempts'],
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
    ['GET', `/provisioning/attempts/${attempt}/record`],
  ])
    assert.equal(
      stagingRouteAllowed(method!, path!),
      false,
      `${method} ${path}`,
    );
});
