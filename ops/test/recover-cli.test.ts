import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {generateIdentity, identityToRecipient} from 'age-encryption';
import {exportEscrowSql} from '../src/export';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {testDb} from './helpers';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cashu-recovery-cli-'));
  const identity = await generateIdentity();
  const keyFile = join(dir, 'identity.txt');
  const artifact = join(dir, 'backup.age');
  const source = testDb();
  try {
    source.db
      .prepare(
        "INSERT INTO operators (name, password_hash, key_env, created) VALUES ('operator', 'x', 'issued', 1)",
      )
      .run();
    const out = await exportEscrowSql(
      source.db,
      await identityToRecipient(identity),
      1_700_000_000,
    );
    writeFileSync(keyFile, identity + '\n', {mode: 0o600});
    writeFileSync(artifact, out.armored, {mode: 0o600});
  } finally {
    source.close();
  }
  const run = (name: string, options: Record<string, string>) => {
    const env = {...process.env};
    delete env.OPS_RECOVERY_IDENTITY;
    delete env.OPS_RECOVERY_IDENTITY_FILE;
    delete env.OPS_MASTER_KEY;
    const destination = join(dir, name + '.sqlite');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('src/recover.ts'), artifact],
      {
        env: {...env, OPS_DB: destination, ...options},
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(identity),
      'CLI must not disclose identity',
    );
    return {result, destination};
  };
  return {dir, identity, keyFile, run};
}

test('restore CLI accepts a protected identity file and preserves the recovery fence', async () => {
  const f = await fixture();
  try {
    const {result, destination} = f.run('file', {
      OPS_RECOVERY_IDENTITY_FILE: f.keyFile,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(destination).mode & 0o777, 0o600);
    const db = new OpsDb({sql: openSqliteFile(destination)});
    try {
      assert.deepEqual(
        db.db
          .prepare('SELECT recovery_required FROM provisioning_control')
          .get(),
        {recovery_required: 1},
      );
      assert.deepEqual(
        db.db.prepare('SELECT password_hash FROM operators').all(),
        [{password_hash: '!recovery-disabled'}],
      );
    } finally {
      db.close();
    }
    const legacy = f.run('environment', {OPS_RECOVERY_IDENTITY: f.identity});
    assert.equal(legacy.result.status, 0, legacy.result.stderr);
  } finally {
    rmSync(f.dir, {recursive: true, force: true});
  }
});

test('restore CLI refuses ambiguous or unsafe file sources before creating a database', async () => {
  const f = await fixture();
  try {
    const both = f.run('both', {
      OPS_RECOVERY_IDENTITY: f.identity,
      OPS_RECOVERY_IDENTITY_FILE: f.keyFile,
    });
    assert.notEqual(both.result.status, 0);
    assert.equal(existsSync(both.destination), false);
    chmodSync(f.keyFile, 0o644);
    const exposed = f.run('exposed', {OPS_RECOVERY_IDENTITY_FILE: f.keyFile});
    assert.notEqual(exposed.result.status, 0);
    assert.equal(existsSync(exposed.destination), false);
    chmodSync(f.keyFile, 0o600);
    const link = join(f.dir, 'identity-link.txt');
    symlinkSync(f.keyFile, link);
    const symlink = f.run('symlink', {OPS_RECOVERY_IDENTITY_FILE: link});
    assert.notEqual(symlink.result.status, 0);
    assert.equal(existsSync(symlink.destination), false);
  } finally {
    rmSync(f.dir, {recursive: true, force: true});
  }
});
