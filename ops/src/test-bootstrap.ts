/**
 * The Workers tests' operator bootstrap: `bootstrapOperator` writes through
 * an OpsDb; on the DO the OpsDb is private to the instance, so this runs the
 * same insert through `runInDurableObject`. Not part of the service surface.
 */
import type {Env} from './do';
import {SubtlePwHash} from './pwhash';
import {OpsDb} from './db';
import {openSqlStorage} from './sql-do';

export async function bootstrapOperatorInto(
  env: Env,
  name: string,
  password: string,
  keyEnv: 'factory' | 'issued',
): Promise<void> {
  const {runInDurableObject} = await import('cloudflare:test');
  const id = env.OPS_DO.idFromName('ops');
  await runInDurableObject(
    env.OPS_DO.get(id) as never,
    async (instance: unknown) => {
      const store = instance as {
        deps: {db: OpsDb};
      };
      const db = store.deps.db;
      db.db
        .prepare(
          `INSERT INTO operators (name, password_hash, key_env, created)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET password_hash = excluded.password_hash, key_env = excluded.key_env`,
        )
        .run(name, await new SubtlePwHash().hash(password), keyEnv, db.now());
    },
  );
}

export {openSqlStorage};
