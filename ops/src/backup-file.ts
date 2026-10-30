/** Encrypted, consistent export for standalone deployments and external schedulers. */
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {OpsDb} from './db';
import {exportEscrowSql} from './export';
import {openSqliteFile} from './sqlite-file';

export async function backupFile(
  dbPath: string,
  directory: string,
  recipient: string,
): Promise<string> {
  if (!(await lstat(dbPath)).isFile())
    throw new Error('Backup requires an existing database file');
  const db = new OpsDb({sql: openSqliteFile(dbPath)});
  let result;
  try {
    result = await exportEscrowSql(db.db, recipient);
  } finally {
    db.close();
  }
  await mkdir(directory, {recursive: true, mode: 0o700});
  const name = `${result.exported_at}-${randomUUID()}.age`;
  const temporary = join(directory, `.${name}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(result.armored, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, name));
    const parent = await open(directory, 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return name;
}
