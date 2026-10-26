import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import * as age from 'age-encryption';
import {backupFile} from '../src/backup-file';

test('a mistyped backup database path fails instead of creating an empty recovery artifact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-backup-file-'));
  try {
    const missing = join(dir, 'missing.sqlite');
    const recipient = await age.identityToRecipient(
      await age.generateIdentity(),
    );
    await assert.rejects(backupFile(missing, join(dir, 'exports'), recipient));
    assert.equal(existsSync(missing), false);
    assert.equal(existsSync(join(dir, 'exports')), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
