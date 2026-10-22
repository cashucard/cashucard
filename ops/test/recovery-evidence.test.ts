import test from 'node:test';
import assert from 'node:assert/strict';
import {testDb, testDoDb} from './helpers';
import {OpsDb} from '../src/db';
import {independentBackupHealth} from '../src/recovery-evidence';

for (const [backend, make] of [
  ['Node', testDb],
  ['DO SQL', testDoDb],
] as const) {
  test(`${backend}: freshness uses source age, issuer and live capability, never receipt time`, () => {
    const base = make();
    const issuer = '11111111-2222-4333-8444-555555555555';
    const db = new OpsDb({
      sql: base.db,
      now: base.now,
      independentBackupIssuer: issuer,
    });
    db.db
      .prepare(
        "INSERT INTO operators (name,password_hash,key_env,created) VALUES ('op','test','issued',1)",
      )
      .run();
    db.db
      .prepare(
        "INSERT INTO recovery_connections (id,issuer_id,name,token_hash,approved_by,created,can_attest) VALUES ('copier',?,'copier','test',1,1,1)",
      )
      .run(issuer);
    assert.equal(independentBackupHealth(db).stale, true);
    db.db
      .prepare('INSERT INTO recovery_copy_receipts VALUES (?,?,?,?,?,?,?)')
      .run(
        'copier',
        issuer,
        'escrow/test.age',
        db.now() - 86400,
        'a'.repeat(64),
        3,
        db.now(),
      );
    assert.equal(independentBackupHealth(db).stale, true);
    db.db
      .prepare('UPDATE recovery_copy_receipts SET exported_at = ?')
      .run(db.now() - 86399);
    assert.equal(independentBackupHealth(db).stale, false);
    assert.deepEqual(independentBackupHealth(base, issuer), {
      required: false,
      stale: false,
      exported_at: db.now() - 86399,
    });
    db.db.prepare('UPDATE recovery_connections SET revoked = 1').run();
    assert.equal(independentBackupHealth(db).stale, true);
    db.db
      .prepare('UPDATE recovery_connections SET revoked = NULL, can_attest = 0')
      .run();
    assert.equal(independentBackupHealth(db).stale, true);
    db.db.prepare('UPDATE recovery_connections SET can_attest = 1').run();
    db.db
      .prepare('UPDATE recovery_copy_receipts SET exported_at = ?')
      .run(db.now() + 1);
    assert.equal(independentBackupHealth(db).stale, true);
    db.db
      .prepare(
        'UPDATE recovery_copy_receipts SET exported_at = ?, issuer_id = ?',
      )
      .run(db.now(), 'other');
    assert.equal(independentBackupHealth(db).stale, true);
    db.close();
  });
}
