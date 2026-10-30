/**
 * Offline recovery into a fresh local SQLite service. The artifact path is
 * public; the age identity must be injected at runtime by the operator's
 * secret manager as OPS_RECOVERY_IDENTITY, or read from a protected local file
 * named by OPS_RECOVERY_IDENTITY_FILE. Never supply an identity as an argument.
 */
import {constants} from 'node:fs';
import {open, readFile} from 'node:fs/promises';

import {OpsDb} from './db';
import {decryptEscrowExport, restoreEscrowExport} from './export';
import {openSqliteFile} from './sqlite-file';

export async function recoverFile(args = process.argv.slice(2)): Promise<void> {
  const [artifactPath, ...extra] = args;
  const directIdentity = process.env.OPS_RECOVERY_IDENTITY;
  const identityPath = process.env.OPS_RECOVERY_IDENTITY_FILE;
  const destination = process.env.OPS_DB;
  if (
    !artifactPath ||
    extra.length ||
    !destination ||
    (!directIdentity && !identityPath) ||
    (directIdentity !== undefined && identityPath !== undefined)
  ) {
    console.error(
      'usage: node --import tsx src/recover.ts <encrypted-artifact>; set OPS_DB and exactly one of OPS_RECOVERY_IDENTITY or OPS_RECOVERY_IDENTITY_FILE',
    );
    process.exitCode = 2;
    return;
  }
  let identity = directIdentity;
  if (identityPath) {
    const file = await open(
      identityPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096)
        throw new Error('unsafe identity file');
      const bytes = Buffer.alloc(4097);
      const {bytesRead} = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 4096) throw new Error('oversized identity file');
      identity = bytes.subarray(0, bytesRead).toString('utf8').trim();
    } finally {
      await file.close();
    }
  }
  if (!identity) throw new Error('empty identity');
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
  recoverFile().catch(() => {
    console.error(
      'recovery failed; verify the artifact, identity and empty destination',
    );
    process.exitCode = 1;
  });
}
