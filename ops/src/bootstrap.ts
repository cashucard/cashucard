/** Local SQLite bootstrap/recovery CLI; deployed Workers use OPS_OPERATOR_SETUP. */
import {randomUUID} from 'node:crypto';
import {defaultPwHash} from './auth';
import {OpsDb} from './db';
import {applyOperatorSetup} from './operator-setup';
import {openSqliteFile} from './sqlite-file';

export async function bootstrapOperator(
  db: OpsDb,
  name: string,
  password: string,
  keyEnv: 'factory' | 'issued' = 'issued',
): Promise<{id: number}> {
  const result = await applyOperatorSetup(
    db,
    JSON.stringify({
      action: 'bootstrap',
      nonce: randomUUID(),
      name,
      password,
      keyEnv,
    }),
    defaultPwHash,
  );
  return {id: result!.id};
}

if (require.main === module) {
  const [action, name, keyEnvArg] = process.argv.slice(2);
  const password = process.env.OPS_OPERATOR_PASSWORD;
  if (
    (action !== 'bootstrap' && action !== 'recover') ||
    !name ||
    !password ||
    (keyEnvArg !== undefined &&
      keyEnvArg !== 'factory' &&
      keyEnvArg !== 'issued') ||
    (action === 'recover' && keyEnvArg !== undefined)
  ) {
    console.error(
      'usage: node --import tsx src/bootstrap.ts <bootstrap|recover> <name> [factory|issued]; supply OPS_OPERATOR_PASSWORD through a secret manager',
    );
    process.exit(2);
  }
  const db = new OpsDb({
    sql: openSqliteFile(process.env.OPS_DB ?? 'data/ops.db'),
  });
  applyOperatorSetup(
    db,
    JSON.stringify({
      action,
      nonce: randomUUID(),
      name,
      password,
      ...(action === 'bootstrap' ? {keyEnv: keyEnvArg ?? 'issued'} : {}),
    }),
    defaultPwHash,
  )
    .then(() => console.log('operator setup applied'))
    .catch(() => {
      console.error(
        'operator setup failed; check action, name and setup requirements',
      );
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
