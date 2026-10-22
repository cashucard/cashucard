/**
 * The nightly escrow export (the Workers amendment's extract-and-leave
 * story): readEscrow returns every row hex-encoded; exportEscrowSql arms the
 * payload to the recipient; decryptEscrowExport round-trips it byte for byte
 * with the age identity. The armor file without the identity is inert —
 * asserted by attempting a decrypt with the wrong identity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {createBatch} from '../src/batches';
import {
  decryptEscrowExport,
  exportEscrowSql,
  readEscrow,
  type EscrowExport,
} from '../src/export';
import {generateIdentity, identityToRecipient} from 'age-encryption';
import {TEST_MASTER, testDb} from './helpers';

async function seeded(): Promise<ReturnType<typeof testDb>> {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('op', 'x', 'issued', 1)",
    )
    .run();
  createBatch(db, {
    count: 4,
    mintUrl: 'https://forge.flashapp.me',
    pinPolicy: 'perCard',
    dailyUsd: 25,
    noPinUsd: 5,
    loadSha256: 'fe7d8ac3',
    operatorId: 1,
  });
  return db;
}

test('readEscrow returns every issued row, hex, in batch-ordinal order', async () => {
  const db = await seeded();
  const rows = readEscrow(db.db);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map(r => `${r.batch_id}:${r.ordinal}`),
    ['1:0', '1:1', '1:2', '1:3'],
  );
  for (const r of rows) {
    assert.match(r.enc, /^[0-9a-f]{32}$/);
    assert.match(r.mac, /^[0-9a-f]{32}$/);
    assert.match(r.dek, /^[0-9a-f]{32}$/);
  }
  db.close();
});

test('the escrow export round-trips: decrypt(identity) returns the same rows', async () => {
  const db = await seeded();
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const result = await exportEscrowSql(db.db, recipient, 1_700_000_000);
  assert.equal(result.exported_at, 1_700_000_000);
  const {armored} = result;
  assert.match(armored, /^-----BEGIN AGE ENCRYPTED FILE-----/);

  const out = await decryptEscrowExport(armored, identity);
  assert.equal(out.exported_at, 1_700_000_000);
  const expected = readEscrow(db.db);
  assert.deepEqual(out.keys, expected);
  db.close();
});

test('the armored export is inert without the identity: a wrong one cannot read it', async () => {
  const db = await seeded();
  const recipient = await identityToRecipient(await generateIdentity());
  const wrongIdentity = await generateIdentity();
  const {armored} = await exportEscrowSql(db.db, recipient, 1_700_000_000);
  await assert.rejects(() => decryptEscrowExport(armored, wrongIdentity));
  db.close();
});

test('the exported rows re-derive the escrow: the master+salt rebuilds the same keys', async () => {
  // The export's whole point: with the file AND the master (a secret the
  // escrow deliberately is not), every card's set is rebuildable offline.
  const db = await seeded();
  const identity = await generateIdentity();
  const {armored} = await exportEscrowSql(
    db.db,
    await identityToRecipient(identity),
  );
  const out: EscrowExport = await decryptEscrowExport(armored, identity);

  const {deriveKeySet} = await import('../src/keys');
  const batch = db.db
    .prepare('SELECT ordinal_salt FROM key_batches WHERE id = 1')
    .get() as {ordinal_salt: Buffer};
  const ks = deriveKeySet(TEST_MASTER, batch.ordinal_salt, 2);
  const row = out.keys.find(r => r.ordinal === 2)!;
  assert.equal(row.enc, ks.enc.toString('hex'));
  assert.equal(row.mac, ks.mac.toString('hex'));
  assert.equal(row.dek, ks.dek.toString('hex'));
  db.close();
});

test('recovery export restores card lookup without the derivation master or credentials', async () => {
  const source = await seeded();
  source.db
    .prepare(
      "UPDATE key_batches SET pin_policy = 'batch', pin_batch = '123456'",
    )
    .run();
  source.db
    .prepare(
      "INSERT INTO cards VALUES ('abc123', 1, 1, 2, 1700000000, 'op', 'fe7d8ac3')",
    )
    .run();
  source.db
    .prepare("INSERT INTO cap_releases VALUES ('2.1', ?, 1)")
    .run('ab'.repeat(32));
  const identity = await generateIdentity();
  const {armored} = await exportEscrowSql(
    source.db,
    await identityToRecipient(identity),
  );
  const payload = await decryptEscrowExport(armored, identity);
  assert.equal((payload as unknown as {version: number}).version, 3);
  assert.ok(!JSON.stringify(payload).includes('123456'));
  assert.ok(!JSON.stringify(payload).includes('password_hash'));
  const {restoreEscrowExport} = await import('../src/export');
  const {OpsDb} = await import('../src/db');
  const {openSqliteFile} = await import('../src/sqlite-file');
  const restored = new OpsDb({sql: openSqliteFile(':memory:')});
  restoreEscrowExport(restored.db, payload);
  const row = restored.db
    .prepare(
      `SELECT k.enc, k.mac, k.dek FROM cards c JOIN issued_keys k ON c.batch_id = k.batch_id AND c.ordinal = k.ordinal WHERE c.short_id = ?`,
    )
    .get('abc123');
  assert.deepEqual(
    row,
    source.db
      .prepare(
        'SELECT enc, mac, dek FROM issued_keys WHERE batch_id = 1 AND ordinal = 2',
      )
      .get(),
  );
  assert.deepEqual(
    restored.db.prepare('SELECT * FROM cap_releases').all(),
    source.db.prepare('SELECT * FROM cap_releases').all(),
  );
  assert.equal(
    (
      restored.db.prepare('SELECT pin_batch FROM key_batches').get() as {
        pin_batch: null;
      }
    ).pin_batch,
    null,
  );
  assert.throws(() => restoreEscrowExport(restored.db, payload), /empty/);
});

test('recovery rejects invalid relationships and rolls back a failed insertion', async () => {
  const source = await seeded();
  const identity = await generateIdentity();
  const {armored} = await exportEscrowSql(
    source.db,
    await identityToRecipient(identity),
  );
  const payload = await decryptEscrowExport(armored, identity);
  const {restoreEscrowExport} = await import('../src/export');
  const {OpsDb} = await import('../src/db');
  const {openSqliteFile} = await import('../src/sqlite-file');
  const target = new OpsDb({sql: openSqliteFile(':memory:')});
  for (const invalid of [
    {...payload, version: 99},
    {...payload, keys: payload.keys.slice(1)},
    {...payload, keys: [...payload.keys, payload.keys[0]]},
    {...payload, batches: payload.batches.map(b => ({...b, operator_id: 99}))},
    {
      ...payload,
      operators: payload.operators.map(o => ({
        ...o,
        password_hash: 'excluded',
      })),
    },
  ])
    assert.throws(
      () => restoreEscrowExport(target.db, invalid),
      /invalid recovery/,
    );
  const failing = {
    ...target.db,
    prepare(sql: string) {
      if (sql === 'INSERT INTO issued_keys VALUES (?, ?, ?, ?, ?, ?)')
        throw new Error('forced insertion failure');
      return target.db.prepare(sql);
    },
    exec: target.db.exec.bind(target.db),
    transaction: target.db.transaction.bind(target.db),
  };
  assert.throws(
    () => restoreEscrowExport(failing, payload),
    /forced insertion/,
  );
  assert.deepEqual(target.db.prepare('SELECT * FROM operators').all(), []);
  assert.deepEqual(target.db.prepare('SELECT * FROM key_batches').all(), []);
  restoreEscrowExport(target.db, payload);
  assert.equal(
    (
      target.db.prepare('SELECT COUNT(*) AS n FROM issued_keys').get() as {
        n: number;
      }
    ).n,
    4,
  );
});

test('v2 preserves provisioning retry identities, blocked chips and receipts; v1 stays legacy', async () => {
  const source = await seeded();
  const {restoreEscrowExport} = await import('../src/export');
  const {OpsDb} = await import('../src/db');
  const {openSqliteFile} = await import('../src/sqlite-file');
  const sha = 'ab'.repeat(32);
  source.db.prepare('UPDATE key_batches SET load_sha256 = ?').run(sha);
  const device = '11111111-1111-4111-8111-111111111111';
  const request = '22222222-2222-4222-8222-222222222222';
  const config = {
    count: 4,
    mint_url: 'https://forge.flashapp.me',
    pin_policy: 'perCard',
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: sha,
    key_env: 'issued',
    configuration_revision: 1,
  };
  source.db
    .prepare('INSERT INTO provisioning_batches VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      1,
      request,
      1,
      device,
      JSON.stringify(config),
      'issued',
      3,
      1700000000,
    );
  const installation =
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const completed = '33333333-3333-4333-8333-333333333333';
  for (let ordinal = 0; ordinal < 3; ordinal++) {
    const attempt =
      ordinal === 0
        ? completed
        : `${ordinal + 3}4444444-4444-4444-8444-444444444444`;
    const chip =
      ordinal === 2 ? null : `cplc-v1:4790d32130410933632${ordinal}5547`;
    const disposition =
      ordinal === 1
        ? {kind: 'quarantined', reason: 'authentication refused'}
        : null;
    source.db
      .prepare(
        'INSERT INTO provisioning_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        attempt,
        1,
        ordinal,
        1,
        device,
        ordinal === 2 ? 0 : 2,
        ordinal === 0 ? 'recorded' : ordinal === 1 ? 'quarantined' : 'active',
        chip,
        1700000000,
        chip
          ? JSON.stringify({
              attempt_id: attempt,
              chip_id: chip,
              revision: 1,
              bound_at: 1700000000,
            })
          : null,
        disposition ? JSON.stringify(disposition) : null,
        disposition
          ? JSON.stringify({
              attempt_id: attempt,
              ...disposition,
              revision: 2,
              acknowledged_at: 1700000000,
            })
          : null,
      );
  }
  const body = {
    attempt_id: completed,
    batch_id: 1,
    ordinal: 0,
    chip_id: 'cplc-v1:4790d3213041093363205547',
    installation_id: installation,
    display_id: installation.slice(-4),
    load_sha256: sha,
    gp_key_version: 1,
    operator_id: 1,
    device_id: device,
    key_env: 'issued',
    configuration_revision: 1,
    verified_stage: 'rotated',
    verified_at: 1700000000,
  };
  const receipt = {
    attempt_id: completed,
    installation_id: installation,
    revision: 2,
    recorded_at: 1700000000,
    verified_stage: 'rotated',
    ready_for_holder: false,
  };
  source.db
    .prepare('INSERT INTO provisioning_records VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      completed,
      installation,
      installation.slice(-4),
      JSON.stringify(body),
      JSON.stringify(receipt),
      1700000000,
    );
  const identity = await generateIdentity();
  const {armored} = await exportEscrowSql(
    source.db,
    await identityToRecipient(identity),
  );
  const payload = await decryptEscrowExport(armored, identity);
  assert.equal(payload.version, 3);
  if (payload.version !== 3) throw new Error('expected v3');
  const target = new OpsDb({sql: openSqliteFile(':memory:')});
  restoreEscrowExport(target.db, payload);
  for (const table of [
    'provisioning_batches',
    'provisioning_attempts',
    'provisioning_records',
  ])
    assert.deepEqual(
      target.db.prepare(`SELECT * FROM ${table}`).all(),
      source.db.prepare(`SELECT * FROM ${table}`).all(),
    );
  assert.deepEqual(
    target.db
      .prepare('SELECT recovery_required FROM provisioning_control')
      .get(),
    {recovery_required: 1},
  );
  for (const invalid of [
    {...payload, provisioning_attempts: payload.provisioning_attempts.slice(1)},
    {
      ...payload,
      provisioning_batches: payload.provisioning_batches.map(b => ({
        ...b,
        operator_id: 99,
      })),
    },
    {
      ...payload,
      provisioning_records: payload.provisioning_records.map(r => ({
        ...r,
        display_id: 'ffff',
      })),
    },
    {
      ...payload,
      provisioning_records: payload.provisioning_records.map(r => ({
        ...r,
        body_json: JSON.stringify({...body, pin: '1234'}),
      })),
    },
    {
      ...payload,
      provisioning_attempts: payload.provisioning_attempts.map(a =>
        a.attempt_id === completed ? {...a, revision: 4} : a,
      ),
    },
  ]) {
    const empty = new OpsDb({sql: openSqliteFile(':memory:')});
    assert.throws(
      () => restoreEscrowExport(empty.db, invalid),
      /invalid recovery/,
    );
    empty.close();
  }
  // v1 retains old suffix-only mappings but must not invent modern ownership.
  const {
    operator_audit: _audit,
    provisioning_batches: _b,
    provisioning_attempts: _a,
    provisioning_records: _r,
    ...base
  } = payload;
  const legacy = new OpsDb({sql: openSqliteFile(':memory:')});
  const oldOperators = base.operators.map(({disabled: _disabled, ...op}) => op);
  restoreEscrowExport(legacy.db, {
    ...base,
    operators: oldOperators,
    version: 1,
  });
  const legacy2 = new OpsDb({sql: openSqliteFile(':memory:')});
  const {operator_audit: _v3audit, ...v2} = payload;
  restoreEscrowExport(legacy2.db, {...v2, operators: oldOperators, version: 2});
  assert.equal(
    (
      legacy2.db
        .prepare('SELECT count(*) AS n FROM provisioning_attempts')
        .get() as {n: number}
    ).n,
    payload.provisioning_attempts.length,
  );
  legacy2.close();
  assert.deepEqual(
    legacy.db.prepare('SELECT * FROM provisioning_attempts').all(),
    [],
  );
  assert.deepEqual(
    legacy.db
      .prepare('SELECT recovery_required FROM provisioning_control')
      .get(),
    {recovery_required: 1},
  );
  legacy.close();
  target.close();
  source.close();
});

test('a backward wall-clock correction does not prevent exporting and restoring a completed attempt', async () => {
  const source = await seeded();
  const {OpsDb} = await import('../src/db');
  const {openSqliteFile} = await import('../src/sqlite-file');
  const {restoreEscrowExport} = await import('../src/export');
  const {
    createProvisioningBatch,
    reserveAttempt,
    bindAttempt,
    recordAttempt,
    getAttempt,
  } = await import('../src/provisioning');
  let clock = 1_700_000_000;
  const db = new OpsDb({
    sql: source.db,
    now: () => clock,
    master: {getMaster: () => TEST_MASTER},
  });
  const scope = {
    operator_id: 1,
    device_id: '11111111-1111-4111-8111-111111111111',
    key_env: 'issued' as const,
  };
  const batch = createProvisioningBatch(db, scope, {
    batch_request_id: '22222222-2222-4222-8222-222222222222',
    count: 1,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard',
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'ab'.repeat(32),
  });
  const attempt = reserveAttempt(db, scope, {
    attempt_id: '33333333-3333-4333-8333-333333333333',
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  const chip = 'cplc-v1:4790d3213180072976207515';
  const binding = bindAttempt(db, scope, attempt.attempt_id, {
    revision: 0,
    chip_id: chip,
  });
  clock -= 1;
  const installation =
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const receipt = recordAttempt(db, scope, attempt.attempt_id, {
    revision: binding.revision,
    record: {
      attempt_id: attempt.attempt_id,
      batch_id: batch.batch_id,
      ordinal: 0,
      chip_id: chip,
      installation_id: installation,
      display_id: installation.slice(-4),
      load_sha256: batch.config.load_sha256,
      gp_key_version: 1,
      operator_id: scope.operator_id,
      device_id: scope.device_id,
      key_env: scope.key_env,
      configuration_revision: 1,
      verified_stage: 'rotated',
      verified_at: clock,
    },
  });
  assert.ok(receipt.recorded_at < attempt.created);
  const identity = await generateIdentity();
  const {armored} = await exportEscrowSql(
    db.db,
    await identityToRecipient(identity),
    clock,
  );
  const payload = await decryptEscrowExport(armored, identity);
  const target = new OpsDb({sql: openSqliteFile(':memory:')});
  try {
    restoreEscrowExport(target.db, payload);
    assert.deepEqual(
      getAttempt(target, scope, attempt.attempt_id).completion_receipt,
      receipt,
    );
    assert.deepEqual(readEscrow(target.db), readEscrow(db.db));
  } finally {
    target.close();
    source.close();
  }
});
