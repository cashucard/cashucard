import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorSession, hashPassword} from '../src/auth';
import {routeRequest} from '../src/route-request';
import {AnchorFeed} from '../src/anchor';
import {HolderIssueState} from '../src/issue';
import {testDb, testDoDb} from './helpers';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {generateIdentity, identityToRecipient} from 'age-encryption';
import {
  exportEscrowSql,
  decryptEscrowExport,
  restoreEscrowExport,
} from '../src/export';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  disposeAttempt,
} from '../src/provisioning';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chip = 'cplc-v1:4790d3213041093363205547';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

for (const backend of [testDb, testDoDb]) {
  test(`${backend.name}: reviewed external reset releases one fence, retaining history and denying stale retries`, async () => {
    const db = backend();
    try {
      db.db
        .prepare(
          'INSERT INTO operators(name,password_hash,key_env,created) VALUES (?,?,?,?)',
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
      const deps = {
        db,
        anchor: new AnchorFeed(async () => {
          throw Error('unused');
        }),
        holderState: new HolderIssueState(),
        mints: [],
        operatorAdmins: () => '["admin"]',
      };
      const scope = {
        operator_id: 1,
        device_id: uuid(1),
        key_env: 'issued' as const,
      };
      const config = {
        batch_request_id: uuid(2),
        count: 2,
        mint_url: 'https://mint.test',
        pin_policy: 'perCard' as const,
        daily_usd: 0,
        no_pin_usd: 0,
        load_sha256: 'ab'.repeat(32),
      };
      const batch = createProvisioningBatch(db, scope, config);
      reserveAttempt(db, scope, {
        attempt_id: uuid(3),
        batch_id: batch.batch_id,
        ordinal: 0,
      });
      bindAttempt(db, scope, uuid(3), {revision: 0, chip_id: chip});
      disposeAttempt(db, scope, uuid(3), {
        revision: 1,
        kind: 'quarantined',
        reason: 'authentication-failed',
      });
      const old = db.db
        .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id=?')
        .get(uuid(3)) as Record<string, unknown>;
      const keysBefore = db.db.prepare('SELECT * FROM issued_keys').all();
      reserveAttempt(db, scope, {
        attempt_id: uuid(4),
        batch_id: batch.batch_id,
        ordinal: 1,
      });
      assert.throws(
        () => bindAttempt(db, scope, uuid(4), {revision: 0, chip_id: chip}),
        /unresolved/,
      );
      const completion = {
        reset_id: uuid(5),
        source_attempt_id: uuid(6),
        chip_id: chip,
        removed_installation_id: key,
        gp_key_version: 1,
        manager_keys: 'factory',
        cashu_package: 'absent',
        verified_at: db.now(),
      };
      const evidence = {
        revision: 2,
        chip_id: chip,
        source_origin: 'http://127.0.0.1:8821',
        completion,
        receipt: {
          reset_id: uuid(5),
          chip_id: chip,
          removed_installation_id: key,
          operator_id: 1,
          device_id: uuid(7),
          completed_at: db.now(),
          manager_keys: 'factory',
          cashu_package: 'absent',
        },
        observed_absent_at: db.now(),
        evidence_ref: 'docs/reviewed-reset.md',
        reviewed: true,
      };
      const path = `/admin/provisioning/attempts/${uuid(3)}/reconcile-reset`;
      const call = (
        body: unknown,
        admins = '["admin"]',
        token = auth.token,
        database = db,
        target = uuid(3),
      ) =>
        routeRequest(
          {...deps, db: database, operatorAdmins: () => admins},
          new Request('https://ops.test' + path.replace(uuid(3), target), {
            method: 'POST',
            headers: {
              authorization: 'Bearer ' + token,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }),
        );
      assert.equal((await call(evidence, '[]')).status, 403);
      assert.equal((await call(evidence, '["admin"]', 'invalid')).status, 401);
      assert.equal(
        (await call(evidence, '["admin"]', auth.token, db, uuid(4))).status,
        409,
      );
      const stale = new OpsDb({
        sql: db.db,
        now: db.now,
        independentBackupIssuer: uuid(99),
      });
      assert.equal(
        (await call(evidence, '["admin"]', auth.token, stale)).status,
        503,
      );
      for (const changed of [
        {...evidence, reviewed: false},
        {...evidence, revision: 1},
        {...evidence, observed_absent_at: db.now() - 901},
        {
          ...evidence,
          completion: {...completion, chip_id: chip.replace('5547', '5548')},
        },
        {
          ...evidence,
          receipt: {
            ...evidence.receipt,
            removed_installation_id: '03' + 'ab'.repeat(32),
          },
        },
        {...evidence, source_origin: 'http://user:password@127.0.0.1:8821'},
      ])
        assert.ok((await call(changed)).status >= 400);
      assert.throws(
        () => bindAttempt(db, scope, uuid(4), {revision: 0, chip_id: chip}),
        /unresolved/,
      );
      db.db
        .prepare('UPDATE provisioning_control SET recovery_required=1')
        .run();
      assert.equal((await call(evidence)).status, 409);
      db.db
        .prepare('UPDATE provisioning_control SET recovery_required=0')
        .run();
      // Completion before this target stopped cannot release its block.
      assert.equal(
        (
          await call({
            ...evidence,
            completion: {...completion, verified_at: db.now() - 1},
            receipt: {...evidence.receipt, completed_at: db.now() - 1},
          })
        ).status,
        409,
      );
      const accepted = await call(evidence);
      assert.equal(accepted.status, 200);
      assert.deepEqual(await call(evidence), accepted);
      assert.equal(
        (await call({...evidence, evidence_ref: 'changed'})).status,
        409,
      );
      const after = db.db
        .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id=?')
        .get(uuid(3)) as Record<string, unknown>;
      assert.deepEqual(
        {...after, fence_released: 0},
        {...old, fence_released: 0},
      );
      assert.equal(after.fence_released, 1);
      assert.deepEqual(
        db.db.prepare('SELECT * FROM issued_keys').all(),
        keysBefore,
      );
      bindAttempt(db, scope, uuid(4), {revision: 0, chip_id: chip});
      // The old binding and terminal disposition stay immutable on replay.
      assert.equal(
        bindAttempt(db, scope, uuid(3), {revision: 0, chip_id: chip}).revision,
        1,
      );
      assert.equal(
        (
          db.db
            .prepare(
              'SELECT state FROM provisioning_attempts WHERE attempt_id=?',
            )
            .get(uuid(3)) as {state: string}
        ).state,
        'quarantined',
      );
      const identity = await generateIdentity();
      const snapshot = await exportEscrowSql(
        db.db,
        await identityToRecipient(identity),
        db.now(),
      );
      const payload = await decryptEscrowExport(snapshot.armored, identity);
      assert.equal(payload.version, 7);
      if (payload.version !== 7) throw Error('expected v7');
      // Existing receipt timestamps survive a backward correction of the export clock.
      await exportEscrowSql(
        db.db,
        await identityToRecipient(identity),
        db.now() - 60,
      );
      const restored = new OpsDb({sql: openSqliteFile(':memory:')});
      try {
        restoreEscrowExport(restored.db, payload);
        assert.deepEqual(
          restored.db.prepare('SELECT * FROM reset_reconciliations').all(),
          db.db.prepare('SELECT * FROM reset_reconciliations').all(),
        );
        assert.deepEqual(
          restored.db.prepare('SELECT * FROM provisioning_attempts').all(),
          db.db.prepare('SELECT * FROM provisioning_attempts').all(),
        );
        assert.equal(
          (
            restored.db
              .prepare('SELECT recovery_required FROM provisioning_control')
              .get() as {recovery_required: number}
          ).recovery_required,
          1,
        );
      } finally {
        restored.close();
      }
      for (const invalid of [
        {...payload, reset_reconciliations: []},
        {
          ...payload,
          reset_reconciliations: payload.reset_reconciliations!.map(r => ({
            ...r,
            actor_id: 99,
          })),
        },
        {
          ...payload,
          reset_reconciliations: payload.reset_reconciliations!.map(r => ({
            ...r,
            request_json: r.request_json.replace(
              'reviewed-reset',
              'different-reset',
            ),
          })),
        },
        {
          ...payload,
          provisioning_attempts: payload.provisioning_attempts.map(a =>
            a.attempt_id === uuid(3) ? {...a, fence_released: 0} : a,
          ),
        },
      ]) {
        const empty = new OpsDb({sql: openSqliteFile(':memory:')});
        try {
          assert.throws(
            () => restoreEscrowExport(empty.db, invalid),
            /invalid recovery/,
          );
        } finally {
          empty.close();
        }
      }
      disposeAttempt(db, scope, uuid(4), {
        revision: 1,
        kind: 'quarantined',
        reason: 'verification-failed',
      });
      assert.equal(
        (await call(evidence, '["admin"]', auth.token, db, uuid(4))).status,
        409,
      );
      assert.equal(
        (
          db.db
            .prepare(
              'SELECT fence_released FROM provisioning_attempts WHERE attempt_id=?',
            )
            .get(uuid(4)) as {fence_released: number}
        ).fence_released,
        0,
      );
    } finally {
      db.close();
    }
  });
}
