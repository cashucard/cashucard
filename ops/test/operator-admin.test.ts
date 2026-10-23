import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
} from '../src/provisioning';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorSession, hashPassword, resolveSession} from '../src/auth';
import {routeRequest} from '../src/route-request';
import {AnchorFeed} from '../src/anchor';
import {HolderIssueState} from '../src/issue';
import {testDb} from './helpers';

test('only deployment admins manage operators; disable/reset revoke sessions and preserve history', async () => {
  const db = testDb();
  try {
    db.db
      .prepare(
        'INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,?,?,?)',
      )
      .run(
        'admin',
        await hashPassword('admin-password-long'),
        'issued',
        db.now(),
      );
    const admin = (await createOperatorSession(
      db,
      'admin',
      'admin-password-long',
    ))!;
    const deps = {
      db,
      anchor: new AnchorFeed(async () => {
        throw Error('unused');
      }),
      holderState: new HolderIssueState(),
      mints: [],
      operatorAdmins: () => '["admin"]',
    };
    const call = (
      method: string,
      path: string,
      token: string,
      body?: unknown,
    ) =>
      routeRequest(
        deps,
        new Request('https://ops.test' + path, {
          method,
          headers: {
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
          },
          ...(body ? {body: JSON.stringify(body)} : {}),
        }),
      );
    assert.equal(
      (await call('GET', '/admin/operators', admin.token)).status,
      200,
    );
    const added = await call('POST', '/admin/operators', admin.token, {
      name: 'staff',
      password: 'staff-password-long',
      keyEnv: 'issued',
    });
    assert.equal(added.status, 201);
    const staff = (await createOperatorSession(
      db,
      'staff',
      'staff-password-long',
    ))!;
    assert.equal(
      (await call('GET', '/admin/operators', staff.token)).status,
      403,
    );
    assert.equal(
      (await call('GET', '/admin/provisioning/attempts', staff.token)).status,
      403,
    );
    const scope = {
      operator_id: admin.session.principalId,
      key_env: 'issued' as const,
      device_id: '00000000-0000-4000-8000-000000000001',
    };
    const batch = createProvisioningBatch(db, scope, {
      batch_request_id: '00000000-0000-4000-8000-000000000002',
      count: 1,
      mint_url: 'https://mint.test',
      pin_policy: 'perCard',
      daily_usd: 0,
      no_pin_usd: 0,
      load_sha256: 'a'.repeat(64),
    });
    const attempt = reserveAttempt(db, scope, {
      attempt_id: '00000000-0000-4000-8000-000000000003',
      batch_id: batch.batch_id,
      ordinal: 0,
    });
    bindAttempt(db, scope, attempt.attempt_id, {
      revision: 0,
      chip_id: 'cplc-v1:4790d3213041093363205547',
    });
    const support = (
      await call('GET', '/admin/provisioning/attempts', admin.token)
    ).body as {attempts: Array<Record<string, unknown>>};
    assert.equal(
      support.attempts[0]!.chip_id,
      'cplc-v1:4790d3213041093363205547',
    );
    assert.equal(support.attempts[0]!.state, 'active');
    assert.ok(
      !('enc' in support.attempts[0]!) &&
        !('body_json' in support.attempts[0]!),
    );
    assert.equal(
      (
        await call('POST', '/admin/operators', staff.token, {
          name: 'intruder',
          password: 'intruder-password',
        })
      ).status,
      403,
    );
    const id = staff.session.principalId;
    assert.equal(
      (await call('POST', `/admin/operators/${id}/disable`, admin.token))
        .status,
      200,
    );
    assert.equal(resolveSession(db, staff.token), null);
    assert.equal(
      await createOperatorSession(db, 'staff', 'staff-password-long'),
      null,
    );
    assert.equal(
      (
        await call(
          'POST',
          `/admin/operators/${id}/reset-password`,
          admin.token,
          {password: 'new-password-long'},
        )
      ).status,
      200,
    );
    assert.equal(
      await createOperatorSession(db, 'staff', 'new-password-long'),
      null,
      'reset does not reenable a disabled account',
    );
    assert.equal(
      (await call('POST', `/admin/operators/${id}/enable`, admin.token)).status,
      200,
    );
    const replacement = (await createOperatorSession(
      db,
      'staff',
      'new-password-long',
    ))!;
    assert.ok(replacement);
    assert.equal(
      (
        await call(
          'POST',
          `/admin/operators/${id}/reset-password`,
          admin.token,
          {password: 'third-password-long'},
        )
      ).status,
      200,
    );
    assert.equal(resolveSession(db, replacement.token), null);
    assert.equal(
      (
        await call(
          'POST',
          `/admin/operators/${admin.session.principalId}/disable`,
          admin.token,
        )
      ).status,
      409,
    );
    const audit = await call('GET', '/admin/operators/audit', admin.token);
    assert.equal(audit.status, 200);
    assert.equal((audit.body as {events: unknown[]}).events.length, 5);
    assert.ok(!JSON.stringify(audit.body).includes('password-long'));
    assert.equal((await call('GET', '/admin/operators', '')).status, 401);
    assert.equal(
      (await call('GET', '/admin/operators', admin.token)).status,
      200,
    );
    deps.operatorAdmins = () => '[]';
    assert.equal(
      (await call('GET', '/admin/operators', admin.token)).status,
      403,
      'live policy changes apply immediately',
    );
  } finally {
    db.close();
  }
});

test('disabled status and audit survive encrypted recovery; in-flight revoked admin cannot commit', async () => {
  const {generateIdentity, identityToRecipient} =
    await import('age-encryption');
  const {exportEscrowSql, decryptEscrowExport, restoreEscrowExport} =
    await import('../src/export');
  const db = testDb(),
    target = testDb();
  try {
    db.db
      .prepare(
        'INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,?,?,?)',
      )
      .run(
        'admin',
        await hashPassword('admin-password-long'),
        'issued',
        db.now(),
      );
    const auth = (await createOperatorSession(
      db,
      'admin',
      'admin-password-long',
    ))!;
    const {operatorAdminRequest} = await import('../src/operator-admin');
    const deps = {
      db,
      anchor: new AnchorFeed(async () => {
        throw Error('unused');
      }),
      holderState: new HolderIssueState(),
      mints: [],
      operatorAdmins: () => '["admin"]',
    };
    const [, answer] = await operatorAdminRequest(
      deps,
      auth.token,
      'POST',
      '/admin/operators',
      {name: 'staff', password: 'staff-password-long'},
    );
    const id = (answer as {id: number}).id;
    await operatorAdminRequest(
      deps,
      auth.token,
      'POST',
      `/admin/operators/${id}/disable`,
      {},
    );
    const identity = await generateIdentity();
    const artifact = await exportEscrowSql(
      db.db,
      await identityToRecipient(identity),
    );
    const payload = await decryptEscrowExport(artifact.armored, identity);
    assert.equal(payload.version, 7);
    assert.ok(!JSON.stringify(payload).includes('password_hash'));
    restoreEscrowExport(target.db, payload);
    assert.deepEqual(
      target.db.prepare('SELECT id,disabled FROM operators ORDER BY id').all(),
      db.db.prepare('SELECT id,disabled FROM operators ORDER BY id').all(),
    );
    assert.deepEqual(
      target.db.prepare('SELECT * FROM operator_audit ORDER BY id').all(),
      db.db.prepare('SELECT * FROM operator_audit ORDER BY id').all(),
    );
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(r => (entered = r));
    const hash = async () => {
      entered();
      await new Promise<void>(r => (release = r));
      return 'unused-test-hash';
    };
    const pending = operatorAdminRequest(
      {...deps, passwordHasher: {hash, verify: async () => false}},
      auth.token,
      'POST',
      '/admin/operators',
      {name: 'late', password: 'late-password-long'},
    );
    await waiting;
    db.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE principal_id = ?')
      .run(db.now(), auth.session.principalId);
    release();
    await assert.rejects(pending, /no-session/);
    assert.equal(
      db.db.prepare('SELECT id FROM operators WHERE name = ?').get('late'),
      undefined,
    );
  } finally {
    db.close();
    target.close();
  }
});
