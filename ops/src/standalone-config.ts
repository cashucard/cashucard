/** Node-only runtime configuration. Secret values never enter errors or logs. */
import {constants, openSync, readSync, fstatSync, closeSync} from 'node:fs';
import {isIP} from 'node:net';

type Environment = Readonly<Record<string, string | undefined>>;

export function secret(name: string, env: Environment): string | undefined {
  const value = env[name],
    path = env[`${name}_FILE`];
  if (value !== undefined && path !== undefined)
    throw new Error(`Configure exactly one ${name} source`);
  if (path === undefined) return value;
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384)
      throw new Error('Invalid secret file');
    const bytes = Buffer.alloc(16385);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size > 16384) throw new Error('Invalid secret file');
    return bytes.subarray(0, size).toString('utf8').trim();
  } finally {
    closeSync(fd);
  }
}

export function standaloneConfig(env: Environment = process.env) {
  const host = env.OPS_HOST ?? '127.0.0.1';
  const port = Number(env.OPS_PORT ?? '8821');
  if (!isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid listener configuration');
  const admins: unknown = JSON.parse(env.OPS_OPERATOR_ADMINS ?? '[]');
  if (
    !Array.isArray(admins) ||
    admins.length === 0 ||
    admins.length > 32 ||
    !admins.every(
      n => typeof n === 'string' && /^[A-Za-z0-9._@-]{1,64}$/.test(n),
    )
  )
    throw new Error('Configure OPS_OPERATOR_ADMINS');
  const mints: unknown = JSON.parse(env.OPS_MINTS ?? 'null');
  if (
    mints !== null &&
    (!Array.isArray(mints) ||
      mints.length === 0 ||
      mints.length > 100 ||
      !mints.every(m => {
        if (typeof m !== 'string') return false;
        try {
          const u = new URL(m);
          return (
            u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash
          );
        } catch {
          return false;
        }
      }))
  )
    throw new Error('Invalid OPS_MINTS');
  return {
    host,
    port,
    dbPath: env.OPS_DB ?? '/data/ops.sqlite',
    admins: JSON.stringify(admins),
    mints: mints === null ? undefined : (mints as string[]),
    master: secret('OPS_MASTER_KEY', env),
    setup: secret('OPS_OPERATOR_SETUP', env),
    independentBackupIssuer: env.OPS_INDEPENDENT_BACKUP_ISSUER,
  };
}
