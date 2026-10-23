import test from 'node:test';
import assert from 'node:assert/strict';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {
  createProvisioningBatch,
  reserveAttempt,
  getAttempt,
  bindAttempt,
  recordAttempt,
  disposeAttempt,
  issueAttemptKeys,
  ProvisioningError,
  type ProvisioningScope,
  type CompletionRecord,
} from '../src/provisioning';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const scope: ProvisioningScope = {
  operator_id: 1,
  device_id: uuid(1),
  key_env: 'issued',
};
const chip = 'cplc-v1:4790d3213041093363205547';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const config = {
  batch_request_id: uuid(2),
  count: 3,
  mint_url: 'https://mint.test',
  pin_policy: 'perCard' as const,
  daily_usd: 25,
  no_pin_usd: 5,
  load_sha256: 'ab'.repeat(32),
};
function fixture() {
  let random = 0;
  const db = new OpsDb({
    sql: openSqliteFile(':memory:'),
    randomBytes: n => Buffer.alloc(n, ++random),
    now: () => 1700000000,
    master: {getMaster: () => Buffer.alloc(32, 90)},
  });
  for (const name of ['one', 'two'])
    db.db
      .prepare(
        'INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,?,?,?)',
      )
      .run(name, 'test', 'issued', db.now());
  return db;
}
function begin(db: OpsDb) {
  const batch = createProvisioningBatch(db, scope, config);
  return reserveAttempt(db, scope, {
    attempt_id: uuid(3),
    batch_id: batch.batch_id,
    ordinal: 0,
  });
}
function rejects(fn: () => unknown, status = 409) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof ProvisioningError && e.status === status,
  );
}
function record(
  a: ReturnType<typeof begin>,
  over: Partial<CompletionRecord> = {},
): CompletionRecord {
  return {
    attempt_id: a.attempt_id,
    batch_id: a.batch_id,
    ordinal: a.ordinal,
    chip_id: chip,
    installation_id: key,
    display_id: '1798',
    load_sha256: config.load_sha256,
    gp_key_version: 1,
    operator_id: 1,
    device_id: scope.device_id,
    key_env: 'issued',
    configuration_revision: 1,
    verified_stage: 'rotated',
    verified_at: 1700000000,
    ...over,
  };
}

test('batch retries preserve escrow and scope; failures roll back reservation and keys', () => {
  const db = fixture();
  const batch = createProvisioningBatch(db, scope, config);
  assert.deepEqual(createProvisioningBatch(db, scope, {...config}), batch);
  rejects(() => createProvisioningBatch(db, scope, {...config, count: 2}));
  rejects(() =>
    createProvisioningBatch(db, {...scope, device_id: uuid(9)}, config),
  );
  rejects(
    () => createProvisioningBatch(db, {...scope, operator_id: 2}, config),
    404,
  );
  rejects(
    () =>
      createProvisioningBatch(db, scope, {
        ...config,
        pin_batch: 'secret',
      } as typeof config),
    400,
  );
  assert.equal(
    (
      db.db.prepare('SELECT COUNT(*) AS n FROM issued_keys').get() as {
        n: number;
      }
    ).n,
    3,
  );
  const broken = new OpsDb({sql: openSqliteFile(':memory:')});
  broken.db
    .prepare(
      "INSERT INTO operators(name,password_hash,key_env,created) VALUES('op','test','issued',1)",
    )
    .run();
  assert.throws(() => createProvisioningBatch(broken, scope, config));
  for (const table of ['key_batches', 'issued_keys', 'provisioning_batches'])
    assert.equal(
      (
        broken.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n,
      0,
    );
  db.close();
  broken.close();
});

test('attempt/bind retries persist; scope, active device, ordinal and revision gates hold', () => {
  const db = fixture();
  const a = begin(db);
  const restarted = new OpsDb({sql: db.db, now: db.now});
  assert.deepEqual(
    reserveAttempt(restarted, scope, {
      attempt_id: a.attempt_id,
      batch_id: a.batch_id,
      ordinal: 0,
    }),
    a,
  );
  rejects(() =>
    reserveAttempt(db, scope, {
      attempt_id: uuid(4),
      batch_id: a.batch_id,
      ordinal: 1,
    }),
  );
  rejects(
    () => getAttempt(db, {...scope, device_id: uuid(8)}, a.attempt_id),
    404,
  );
  rejects(() => issueAttemptKeys(db, scope, uuid(99)), 404);
  assert.equal(
    issueAttemptKeys(db, scope, a.attempt_id).attempt_id,
    a.attempt_id,
  );
  const bound = bindAttempt(db, scope, a.attempt_id, {
    revision: 0,
    chip_id: chip,
  });
  assert.deepEqual(
    bindAttempt(restarted, scope, a.attempt_id, {revision: 0, chip_id: chip}),
    bound,
  );
  rejects(() =>
    bindAttempt(db, scope, a.attempt_id, {
      revision: 1,
      chip_id: chip.replace('5547', '5548'),
    }),
  );
  rejects(() =>
    disposeAttempt(db, scope, a.attempt_id, {
      revision: 0,
      kind: 'abandoned',
      reason: 'stop',
    }),
  );
  assert.equal(getAttempt(restarted, scope, a.attempt_id).revision, 1);
  db.close();
});

test('terminal dispositions release devices but retain blocked chip and consumed ordinal', () => {
  const db = fixture();
  const a = begin(db);
  bindAttempt(db, scope, a.attempt_id, {revision: 0, chip_id: chip});
  const input = {
    revision: 1,
    kind: 'quarantined' as const,
    reason: 'uncertain rotation',
  };
  const receipt = disposeAttempt(db, scope, a.attempt_id, input);
  assert.deepEqual(disposeAttempt(db, scope, a.attempt_id, input), receipt);
  rejects(() =>
    disposeAttempt(db, scope, a.attempt_id, {...input, reason: 'changed'}),
  );
  rejects(() => issueAttemptKeys(db, scope, a.attempt_id));
  rejects(() =>
    reserveAttempt(db, scope, {
      attempt_id: uuid(4),
      batch_id: a.batch_id,
      ordinal: 0,
    }),
  );
  const b = reserveAttempt(db, scope, {
    attempt_id: uuid(4),
    batch_id: a.batch_id,
    ordinal: 1,
  });
  assert.throws(
    () => bindAttempt(db, scope, b.attempt_id, {revision: 0, chip_id: chip}),
    (e: unknown) =>
      e instanceof ProvisioningError &&
      e.status === 409 &&
      e.code === 'chip-unresolved',
  );
  rejects(
    () =>
      bindAttempt(db, scope, b.attempt_id, {
        revision: 0,
        chip_id: 'cplc-v1:4790d3213041000000005547',
      }),
    400,
  );
  db.close();
});

test('completion validates full identity/config, freezes receipts and preserves suffix collisions', () => {
  const db = fixture();
  const a = begin(db);
  bindAttempt(db, scope, a.attempt_id, {revision: 0, chip_id: chip});
  for (const bad of [
    {installation_id: '02' + 'ff'.repeat(32)},
    {installation_id: '02' + '00'.repeat(32)},
    {display_id: '0000'},
    {ordinal: 1},
    {load_sha256: 'cd'.repeat(32)},
    {key_env: 'factory'},
    {verified_stage: 'ready'},
    {verified_stage: 'installed'},
    {pin: '123456'},
  ]) {
    assert.throws(
      () =>
        recordAttempt(db, scope, a.attempt_id, {
          revision: 1,
          record: {...record(a), ...bad} as CompletionRecord,
        }),
      ProvisioningError,
    );
  }
  assert.equal(getAttempt(db, scope, a.attempt_id).state, 'active');
  assert.equal(
    issueAttemptKeys(db, scope, a.attempt_id).attempt_id,
    a.attempt_id,
  );
  const body = record(a);
  const receipt = recordAttempt(db, scope, a.attempt_id, {
    revision: 1,
    record: body,
  });
  assert.equal(receipt.ready_for_holder, false);
  assert.deepEqual(
    recordAttempt(db, scope, a.attempt_id, {revision: 1, record: {...body}}),
    receipt,
  );
  rejects(() =>
    recordAttempt(db, scope, a.attempt_id, {
      revision: 2,
      record: {...body, verified_at: 1700000001},
    }),
  );
  const b = reserveAttempt(db, scope, {
    attempt_id: uuid(4),
    batch_id: a.batch_id,
    ordinal: 1,
  });
  bindAttempt(db, scope, b.attempt_id, {revision: 0, chip_id: chip});
  rejects(() =>
    recordAttempt(db, scope, b.attempt_id, {revision: 1, record: record(b)}),
  );
  const second = recordAttempt(db, scope, b.attempt_id, {
    revision: 1,
    record: record(b, {installation_id: '03' + key.slice(2)}),
  });
  assert.notEqual(second.installation_id, receipt.installation_id);
  assert.equal(
    (
      db.db
        .prepare(
          'SELECT COUNT(*) AS n FROM provisioning_records WHERE display_id=?',
        )
        .get('1798') as {n: number}
    ).n,
    2,
  );
  db.close();
});

test('restored service permits inspection but pauses even identical mutations and all key reads', () => {
  const db = fixture();
  const a = begin(db);
  db.db
    .prepare('UPDATE provisioning_control SET recovery_required=1 WHERE id=1')
    .run();
  assert.equal(getAttempt(db, scope, a.attempt_id).attempt_id, a.attempt_id);
  for (const action of [
    () => createProvisioningBatch(db, scope, config),
    () =>
      reserveAttempt(db, scope, {
        attempt_id: a.attempt_id,
        batch_id: a.batch_id,
        ordinal: 0,
      }),
    () => bindAttempt(db, scope, a.attempt_id, {revision: 0, chip_id: chip}),
    () =>
      recordAttempt(db, scope, a.attempt_id, {revision: 0, record: record(a)}),
    () =>
      disposeAttempt(db, scope, a.attempt_id, {
        revision: 0,
        kind: 'abandoned',
        reason: 'stop',
      }),
    () => issueAttemptKeys(db, scope, a.attempt_id),
  ]) {
    assert.throws(
      action,
      (e: unknown) =>
        e instanceof ProvisioningError && e.code === 'recovery-required',
    );
  }
  db.close();
});

test('24-hour independent-copy expiry stops issuance but preserves replay and terminal evidence', () => {
  const db = fixture();
  const issuer = uuid(80),
    connection = uuid(81);
  Object.defineProperty(db, 'independentBackupIssuer', {value: issuer});
  assert.throws(
    () => createProvisioningBatch(db, scope, config),
    /independent-backup-stale/,
  );
  assert.equal(db.db.prepare('SELECT 1 FROM key_batches').get(), undefined);
  db.db
    .prepare(
      `INSERT INTO recovery_connections (id,issuer_id,name,token_hash,approved_by,created,can_attest) VALUES (?,?,?,'test',1,?,1)`,
    )
    .run(connection, issuer, 'copier', db.now());
  db.db
    .prepare(`INSERT INTO recovery_copy_receipts VALUES (?,?,?,?,?,?,?)`)
    .run(
      connection,
      issuer,
      'escrow/test.age',
      db.now() - 86399,
      'a'.repeat(64),
      3,
      db.now(),
    );
  const batch = createProvisioningBatch(db, scope, config);
  const attempt = reserveAttempt(db, scope, {
    attempt_id: uuid(3),
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  issueAttemptKeys(db, scope, attempt.attempt_id);
  db.db
    .prepare('UPDATE recovery_copy_receipts SET exported_at = ?')
    .run(db.now() - 86400);
  assert.deepEqual(createProvisioningBatch(db, scope, config), {
    ...batch,
    next_ordinal: 1,
  });
  assert.deepEqual(
    reserveAttempt(db, scope, {
      attempt_id: uuid(3),
      batch_id: batch.batch_id,
      ordinal: 0,
    }),
    attempt,
  );
  assert.throws(
    () => issueAttemptKeys(db, scope, attempt.attempt_id),
    /independent-backup-stale/,
  );
  assert.throws(
    () =>
      reserveAttempt(db, scope, {
        attempt_id: uuid(4),
        batch_id: batch.batch_id,
        ordinal: 1,
      }),
    /independent-backup-stale/,
  );
  assert.throws(
    () =>
      createProvisioningBatch(db, scope, {
        ...config,
        batch_request_id: uuid(5),
      }),
    /independent-backup-stale/,
  );
  const terminal = disposeAttempt(db, scope, attempt.attempt_id, {
    kind: 'abandoned',
    reason: 'backup outage',
    revision: 0,
  });
  assert.equal(terminal.kind, 'abandoned');
  db.close();
});

test('stale backup still accepts completion evidence from an interrupted installation', () => {
  const db = fixture();
  const attempt = begin(db);
  bindAttempt(db, scope, attempt.attempt_id, {revision: 0, chip_id: chip});
  Object.defineProperty(db, 'independentBackupIssuer', {value: uuid(80)});
  const receipt = recordAttempt(db, scope, attempt.attempt_id, {
    revision: 1,
    record: record(attempt),
  });
  assert.equal(receipt.verified_stage, 'rotated');
  assert.equal(getAttempt(db, scope, attempt.attempt_id).state, 'recorded');
  db.close();
});
