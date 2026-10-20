/**
 * Offline recovery into a fresh local SQLite service. The artifact path is
 * public; the age identity must be injected at runtime by the operator's
 * secret manager as OPS_RECOVERY_IDENTITY, never supplied as an argument.
 */
import {readFile} from 'node:fs/promises';

import {OpsDb} from './db';
import {decryptEscrowExport, restoreEscrowExport} from './export';
import {openSqliteFile} from './sqlite-file';

async function main(): Promise<void> {
  const [artifactPath, ...extra] = process.argv.slice(2);
  const identity = process.env.OPS_RECOVERY_IDENTITY;
  const destination = process.env.OPS_DB;
  if (!artifactPath || extra.length || !identity || !destination) {
    console.error(
      'usage: node --import tsx src/recover.ts <encrypted-artifact>; set OPS_DB and inject OPS_RECOVERY_IDENTITY through a secret manager',
    );
    process.exitCode = 2;
    return;
  }
  // Authenticate and validate before opening the destination. Recovery errors
  // must never print decrypted data, identities, keys or exception contents.
  const payload = await decryptEscrowExport(
    await readFile(artifactPath, 'utf8'),
    identity,
  );
  // The restored SQLite file contains plaintext manager keys. Newly created
  // files and journals must be readable only by this operator.
  process.umask(0o077);
  const db = new OpsDb({sql: openSqliteFile(destination)});
  try {
    restoreEscrowExport(db.db, payload);
  } finally {
    db.close();
  }
  console.log(
    'recovery complete; reset operator credentials before signing in; existing key lookup needs no master',
  );
}

if (require.main === module) {
  main().catch(() => {
    console.error(
      'recovery failed; verify the artifact, identity and empty destination',
    );
    process.exitCode = 1;
  });
}
