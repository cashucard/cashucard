import test from 'node:test';
import assert from 'node:assert/strict';
import {testDb} from './helpers';
import {OpsDb} from '../src/db';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  recordAttempt,
} from '../src/provisioning';
import {
  authorizeResetIntent,
  getResetIntent,
  issueResetKeys,
} from '../src/reset-intents';
import {completeReset} from '../src/reset-results';
import {findResetSource} from '../src/reset-source';
import {
  exportEscrowSql,
  decryptEscrowExport,
  restoreEscrowExport,
} from '../src/export';
import {generateIdentity, identityToRecipient} from 'age-encryption';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope = {operator_id: 1, device_id: uuid(1), key_env: 'issued' as const};
const chip = 'cplc-v1:4790d3213041093363205547';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const request = {
  reset_id: uuid(4),
  source_attempt_id: uuid(3),
  chip_id: chip,
  installation_id: key,
  consent: {
    erase_owner_and_proofs: true as const,
    value_handled: true as const,
  },
  inspection: {
    unspent: 0,
    spent: 0,
    tag_present: true,
    has_owner: false,
    pin_present: false,
    record_present: false,
  },
};
function fixture() {
  const db = testDb();
  for (const name of ['one', 'two'])
    db.db
      .prepare(
        'INSERT INTO operators(name,password_hash,key_env,created) VALUES (?,?,?,?)',
      )
      .run(name, 'test', 'issued', db.now());
  const config = {
    batch_request_id: uuid(2),
    count: 2,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard' as const,
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'ab'.repeat(32),
  };
  const batch = createProvisioningBatch(db, scope, config);
  reserveAttempt(db, scope, {
    attempt_id: uuid(3),
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  bindAttempt(db, scope, uuid(3), {revision: 0, chip_id: chip});
  recordAttempt(db, scope, uuid(3), {
    revision: 1,
    record: {
      attempt_id: uuid(3),
      batch_id: batch.batch_id,
      ordinal: 0,
      chip_id: chip,
      installation_id: key,
      display_id: key.slice(-4),
      load_sha256: config.load_sha256,
      gp_key_version: 1,
      operator_id: 1,
      device_id: scope.device_id,
      key_env: 'issued',
      configuration_revision: 1,
      verified_stage: 'rotated',
      verified_at: db.now(),
    },
  });
  return {db, batch, config};
}

test('reset authorization is durable, card-specific, idempotent and fenced from normal provisioning', () => {
  const {db, batch, config} = fixture();
  const otherDevice = {...scope, device_id: uuid(8)};
  const otherBatch = createProvisioningBatch(db, otherDevice, {
    ...config,
    batch_request_id: uuid(9),
  });
  const otherAttempt = reserveAttempt(db, otherDevice, {
    attempt_id: uuid(10),
    batch_id: otherBatch.batch_id,
    ordinal: 0,
  });
  const receipt = authorizeResetIntent(db, scope, request);
  assert.deepEqual(authorizeResetIntent(db, scope, {...request}), receipt);
  assert.deepEqual(getResetIntent(db, scope, request.reset_id), {
    request,
    receipt,
    completion_receipt: null,
  });
  assert.throws(() =>
    authorizeResetIntent(db, scope, {...request, reset_id: uuid(5)}),
  );
  assert.throws(() =>
    authorizeResetIntent(db, scope, {
      ...request,
      inspection: {...request.inspection, has_owner: true},
    }),
  );
  assert.throws(
    () =>
      reserveAttempt(db, scope, {
        attempt_id: uuid(6),
        batch_id: batch.batch_id,
        ordinal: 1,
      }),
    /reset/,
  );
  assert.throws(
    () =>
      bindAttempt(db, otherDevice, otherAttempt.attempt_id, {
        revision: 0,
        chip_id: chip,
      }),
    /reset/,
  );
  db.close();
});

test('only the authorized device gets escrow; completion is immutable and releases admission', () => {
  const {db, batch} = fixture();
  authorizeResetIntent(db, scope, request);
  assert.throws(() =>
    issueResetKeys(db, {...scope, device_id: uuid(9)}, request.reset_id),
  );
  const issued = issueResetKeys(db, scope, request.reset_id);
  assert.equal(issued.enc.length, 16);
  assert.equal(issued.chip_id, chip);
  const staleBackup = new OpsDb({
    sql: db.db,
    now: db.now,
    independentBackupIssuer: uuid(99),
  });
  assert.throws(
    () => issueResetKeys(staleBackup, scope, request.reset_id),
    /independent-backup-stale/,
  );
  const record = {
    reset_id: request.reset_id,
    source_attempt_id: request.source_attempt_id,
    chip_id: chip,
    removed_installation_id: key,
    gp_key_version: 1,
    manager_keys: 'factory' as const,
    cashu_package: 'absent' as const,
    verified_at: db.now(),
  };
  assert.throws(() =>
    completeReset(db, scope, request.reset_id, {
      ...record,
      chip_id: chip.replace('5547', '5548'),
    }),
  );
  const receipt = completeReset(staleBackup, scope, request.reset_id, record);
  assert.deepEqual(
    completeReset(db, scope, request.reset_id, {...record}),
    receipt,
  );
  assert.deepEqual(
    getResetIntent(db, scope, request.reset_id).completion_receipt,
    receipt,
  );
  assert.throws(() =>
    completeReset(db, scope, request.reset_id, {...record, gp_key_version: 2}),
  );
  assert.throws(() => issueResetKeys(db, scope, request.reset_id));
  assert.deepEqual(findResetSource(db, chip, key), {status: 'reset-completed'});
  const attempt = reserveAttempt(db, scope, {
    attempt_id: uuid(6),
    batch_id: batch.batch_id,
    ordinal: 1,
  });
  assert.equal(
    bindAttempt(db, scope, attempt.attempt_id, {revision: 0, chip_id: chip})
      .chip_id,
    chip,
  );
  db.close();
});

test('missing provenance, proof slots, consent, wrong actor and restore fence stop authorization', () => {
  const {db} = fixture();
  for (const changed of [
    {...request, source_attempt_id: uuid(7)},
    {...request, chip_id: chip.replace('5547', '5548')},
    {...request, inspection: {...request.inspection, unspent: 1}},
    {...request, inspection: {...request.inspection, spent: 1}},
    {...request, inspection: {...request.inspection, tag_present: false}},
    {...request, consent: {...request.consent, value_handled: false}},
  ])
    assert.throws(() => authorizeResetIntent(db, scope, changed));
  assert.throws(() =>
    authorizeResetIntent(db, {...scope, operator_id: 2}, request),
  );
  db.db.prepare('UPDATE provisioning_control SET recovery_required = 1').run();
  assert.throws(
    () => authorizeResetIntent(db, scope, request),
    /recovery-required/,
  );
  assert.deepEqual(db.db.prepare('SELECT * FROM reset_intents').all(), []);
  db.close();
});

test('encrypted recovery retains reset intent and rejects changed bindings', async () => {
  for (const completed of [false, true]) {
    const {db} = fixture();
    authorizeResetIntent(db, scope, request);
    if (completed)
      completeReset(db, scope, request.reset_id, {
        reset_id: request.reset_id,
        source_attempt_id: request.source_attempt_id,
        chip_id: chip,
        removed_installation_id: key,
        gp_key_version: 1,
        manager_keys: 'factory',
        cashu_package: 'absent',
        verified_at: db.now(),
      });
    const identity = await generateIdentity();
    const {armored} = await exportEscrowSql(
      db.db,
      await identityToRecipient(identity),
      db.now(),
    );
    const payload = await decryptEscrowExport(armored, identity);
    const restored = testDb();
    restoreEscrowExport(restored.db, payload);
    assert.deepEqual(
      getResetIntent(restored, scope, request.reset_id),
      getResetIntent(db, scope, request.reset_id),
    );
    assert.throws(
      () => authorizeResetIntent(restored, scope, request),
      /recovery-required/,
    );
    const corrupt = JSON.parse(JSON.stringify(payload));
    corrupt.reset_intents[0].chip_id = chip.replace('5547', '5548');
    const empty = testDb();
    assert.throws(
      () => restoreEscrowExport(empty.db, corrupt),
      /invalid recovery/,
    );
    if (completed) {
      const corruptResult = JSON.parse(JSON.stringify(payload));
      const body = JSON.parse(corruptResult.reset_results[0].body_json);
      corruptResult.reset_results[0].body_json = JSON.stringify({
        ...body,
        removed_installation_id: '03' + key.slice(2),
      });
      assert.throws(
        () => restoreEscrowExport(empty.db, corruptResult),
        /invalid recovery/,
      );
    }
    db.close();
    restored.close();
    empty.close();
  }
});
