/** Disposable local browser fixture. Published test credentials and synthetic escrow only. */
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpsDb} from '../src/db.ts';
import {openSqliteFile} from '../src/sqlite-file.ts';
import {hashPassword} from '../src/auth.ts';
import {serve} from '../src/server.ts';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  disposeAttempt,
} from '../src/provisioning.ts';
(async () => {
  process.env.OPS_MASTER_KEY = '5a'.repeat(32);
  process.env.OPS_OPERATOR_ADMINS = '["local-admin"]';
  const directory = mkdtempSync(join(tmpdir(), 'cashu-admin-fixture-'));
  const database = join(directory, 'ops.sqlite');
  const db = new OpsDb({
    sql: openSqliteFile(database),
    master: {getMaster: () => Buffer.alloc(32, 0x5a)},
  });
  if (!db.db.prepare('SELECT id FROM operators LIMIT 1').get()) {
    for (const [name, disabled] of [
      ['local-admin', 0],
      ['local-staff', 0],
      ['north-team', 1],
    ] as const)
      db.db
        .prepare(
          'INSERT INTO operators (name,password_hash,key_env,created,disabled) VALUES (?,?,?,?,?)',
        )
        .run(
          name,
          await hashPassword('published-test-password'),
          'issued',
          db.now(),
          disabled,
        );
    const scope = {
      operator_id: 1,
      key_env: 'issued' as const,
      device_id: '00000000-0000-4000-8000-000000000001',
    };
    const batch = createProvisioningBatch(db, scope, {
      batch_request_id: '00000000-0000-4000-8000-000000000002',
      count: 2,
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
    disposeAttempt(db, scope, attempt.attempt_id, {
      revision: 1,
      kind: 'quarantined',
      reason: 'authentication-failed',
    });
    reserveAttempt(db, scope, {
      attempt_id: '00000000-0000-4000-8000-000000000004',
      batch_id: batch.batch_id,
      ordinal: 1,
    });
    db.db
      .prepare(
        'INSERT INTO operator_audit (actor_id,target_id,action,created) VALUES (?,?,?,?)',
      )
      .run(1, 2, 'create', db.now() - 1800);
    db.db
      .prepare(
        'INSERT INTO operator_audit (actor_id,target_id,action,created) VALUES (?,?,?,?)',
      )
      .run(1, 3, 'disable', db.now() - 600);
  }
  db.close();
  const server = serve({port: 0, dbPath: database});
  server.once('listening', () =>
    console.log(
      'ADMIN_CONSOLE_ORIGIN=http://127.0.0.1:' +
        (server.address() as {port: number}).port,
    ),
  );
  process.once('SIGTERM', () =>
    server.close(() => {
      rmSync(directory, {recursive: true, force: true});
      process.exit(0);
    }),
  );
})();
