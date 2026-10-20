/**
 * The operator bootstrap: a fresh deploy has an empty `operators` table, so
 * nothing can sign in until the first operator row exists (the finding this
 * closes — the password hash had to be hand-written into SQLite). One CLI:
 *
 *   node --import tsx src/bootstrap.ts <name> <key-env>
 *
 * The password is read from OPS_OPERATOR_PASSWORD (never a prompt, never
 * shell history — AGENTS.md's secrets rule; the env var is the operator's
 * step, the same way OPS_MASTER_KEY is). The first operator may pick the key
 * environment their sessions carry; later operators default to `issued`.
 */
import {hashPassword} from './auth';
import {OpsDb} from './db';

export function bootstrapOperator(
  db: OpsDb,
  name: string,
  password: string,
  keyEnv: 'factory' | 'issued' = 'issued',
): {id: number} {
  if (!/^[A-Za-z0-9._@-]{1,64}$/.test(name)) {
    throw new Error('the operator name is [A-Za-z0-9._@-], 1..64 chars');
  }
  if (password.length < 8) {
    throw new Error('the password is at least 8 characters');
  }
  const info = db.db
    .prepare(
      `INSERT INTO operators (name, password_hash, key_env, created)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET password_hash = excluded.password_hash, key_env = excluded.key_env`,
    )
    .run(name, hashPassword(password), keyEnv, db.now());
  return {id: Number(info.lastInsertRowid)};
}

if (require.main === module) {
  const [name, keyEnvArg] = process.argv.slice(2);
  const password = process.env.OPS_OPERATOR_PASSWORD;
  if (!name || !password) {
    // eslint-disable-next-line no-console
    console.error(
      'usage: OPS_OPERATOR_PASSWORD=<password> node --import tsx src/bootstrap.ts <name> [factory|issued]',
    );
    process.exit(2);
  }
  const keyEnv =
    keyEnvArg === 'factory' || keyEnvArg === 'issued' ? keyEnvArg : 'issued';
  const dbPath = process.env.OPS_DB ?? 'data/ops.db';
  const db = new OpsDb({path: dbPath});
  try {
    const {id} = bootstrapOperator(db, name, password, keyEnv);
    // eslint-disable-next-line no-console
    console.log(`operator ${name} ready (id ${id}, env ${keyEnv})`);
  } finally {
    db.close();
  }
}
