/** Portable process entry; the image runs compiled JavaScript with production dependencies. */
import {once} from 'node:events';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {defaultPwHash} from './auth';
import {backupFile} from './backup-file';
import {OpsDb} from './db';
import {EnvMaster} from './master';
import {applyOperatorSetup} from './operator-setup';
import {serve} from './server';
import {standaloneConfig} from './standalone-config';
import {openSqliteFile} from './sqlite-file';
import {recoverFile} from './recover';

async function main(): Promise<void> {
  process.umask(0o077);
  const [command = 'serve', ...args] = process.argv.slice(2);
  if (command === 'init') {
    const [name, ...extra] = args;
    if (!name || extra.length || !/^[A-Za-z0-9._@-]{1,64}$/.test(name))
      throw new Error('Invalid operator name');
    const dir = process.env.OPS_SECRETS_DIR ?? '/secrets';
    await mkdir(dir, {recursive: true, mode: 0o700});
    if ((await readdir(dir)).length)
      throw new Error('Initialization requires an empty secrets directory');
    // Exclusive creates preserve an existing issuer and its recovery material.
    await writeFile(
      join(dir, 'master-key'),
      randomBytes(32).toString('hex') + '\n',
      {flag: 'wx', mode: 0o600},
    );
    await writeFile(
      join(dir, 'operator-setup.json'),
      JSON.stringify(
        {
          action: 'bootstrap',
          nonce: randomUUID(),
          name,
          password: randomBytes(24).toString('base64url'),
          keyEnv: 'issued',
        },
        null,
        2,
      ) + '\n',
      {flag: 'wx', mode: 0o600},
    );
    console.log(
      'Private master-key and operator-setup.json files created. Save them in your secrets vault.',
    );
    return;
  }
  if (command === 'restore') {
    await recoverFile(args);
    return;
  }
  if (args.length) throw new Error('Unexpected arguments');
  if (command === 'backup') {
    const recipient = process.env.OPS_BACKUP_RECIPIENT;
    if (!recipient) throw new Error('Configure OPS_BACKUP_RECIPIENT');
    const name = await backupFile(
      process.env.OPS_DB ?? '/data/ops.sqlite',
      process.env.OPS_BACKUP_DIR ?? '/backups',
      recipient,
    );
    console.log(`Encrypted backup saved: ${name}`);
    return;
  }
  if (command !== 'serve') throw new Error('Unknown command');
  const config = standaloneConfig();
  const master = new EnvMaster(() => config.master);
  master.getMaster();
  const db = new OpsDb({
    sql: openSqliteFile(config.dbPath),
    master,
    independentBackupIssuer: config.independentBackupIssuer,
  });
  try {
    await applyOperatorSetup(db, config.setup, defaultPwHash);
    const adminNames: string[] = JSON.parse(config.admins);
    if (
      !adminNames.some(name =>
        db.db
          .prepare('SELECT id FROM operators WHERE name = ? AND disabled = 0')
          .get(name),
      )
    )
      throw new Error('An active configured administrator is required');
    const server = serve({...config, db, operatorAdmins: () => config.admins});
    await once(server, 'listening');
    console.log('Cashu Card ops-service listening');
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      server.close(error => {
        clearTimeout(deadline);
        if (error) process.exitCode = 1;
      });
      server.closeIdleConnections();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    db.close();
    throw error;
  }
}

if (require.main === module)
  main().catch(() => {
    console.error(
      'ops-service failed; check configuration, secret files and persistent storage',
    );
    process.exitCode = 1;
  });

export {main};
