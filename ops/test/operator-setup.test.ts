import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {bootstrapOperator} from '../src/bootstrap';
import {applyOperatorSetup} from '../src/operator-setup';
import {
  createOperatorSession,
  defaultPwHash,
  resolveSession,
} from '../src/auth';

test('bootstrap never silently changes an existing operator', async () => {
  const db = new OpsDb({sql: openSqliteFile(':memory:')});
  await bootstrapOperator(db, 'lead', 'original password');
  await assert.rejects(() =>
    bootstrapOperator(db, 'lead', 'replacement password'),
  );
});

test('setup recovery is explicit, revokes sessions, and cannot replay after restart', async () => {
  const sql = openSqliteFile(':memory:');
  let db = new OpsDb({sql});
  const bootstrap = JSON.stringify({
    action: 'bootstrap',
    nonce: 'bootstrap_nonce_001',
    name: 'lead',
    password: 'original password',
    keyEnv: 'factory',
  });
  assert.equal(
    (await applyOperatorSetup(db, bootstrap, defaultPwHash))?.applied,
    true,
  );
  const old = await createOperatorSession(db, 'lead', 'original password');
  assert.ok(old);
  await assert.rejects(() =>
    applyOperatorSetup(
      db,
      JSON.stringify({
        action: 'recover',
        nonce: 'recover_nonce_001',
        name: 'missing',
        password: 'replacement password',
      }),
      defaultPwHash,
    ),
  );
  const recover = JSON.stringify({
    action: 'recover',
    nonce: 'recover_nonce_001',
    name: 'lead',
    password: 'replacement password',
  });
  assert.equal(
    (await applyOperatorSetup(db, recover, defaultPwHash))?.applied,
    true,
  );
  assert.equal(resolveSession(db, old.token), null);
  assert.equal(
    await createOperatorSession(db, 'lead', 'original password'),
    null,
  );
  const fresh = await createOperatorSession(db, 'lead', 'replacement password');
  assert.ok(fresh);
  assert.equal(fresh.session.env, 'factory');
  db = new OpsDb({sql});
  assert.equal(
    (await applyOperatorSetup(db, recover, defaultPwHash))?.applied,
    false,
  );
  assert.ok(resolveSession(db, fresh.token));
  assert.equal(
    (await applyOperatorSetup(db, bootstrap, defaultPwHash))?.applied,
    false,
  );
  assert.ok(await createOperatorSession(db, 'lead', 'replacement password'));
});
