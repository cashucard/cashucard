/** Deployment-only setup; never exposed through the HTTP router. */
import type {OpsDb} from './db';
import type {PasswordHasher} from './pwhash';

interface Setup {
  action: 'bootstrap' | 'recover';
  nonce: string;
  name: string;
  password: string;
  keyEnv?: 'factory' | 'issued';
}

function parseSetup(raw: string): Setup {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid operator setup JSON');
  }
  const s = value as Partial<Setup> | null;
  if (
    !s ||
    (s.action !== 'bootstrap' && s.action !== 'recover') ||
    typeof s.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(s.nonce) ||
    typeof s.name !== 'string' ||
    !/^[A-Za-z0-9._@-]{1,64}$/.test(s.name) ||
    typeof s.password !== 'string' ||
    s.password.length < 12 ||
    s.password.length > 1024 ||
    (s.keyEnv !== undefined &&
      s.keyEnv !== 'factory' &&
      s.keyEnv !== 'issued') ||
    (s.action === 'recover' && s.keyEnv !== undefined)
  ) {
    throw new Error('invalid operator setup fields');
  }
  return s as Setup;
}

/**
 * Apply one secret-injected command. The caller blocks DO requests until this
 * resolves. The marker and credential write commit together; an object restart
 * never replays recovery and revokes newly created sessions. A changed password
 * requires a new nonce. Passwords and hashes are never included in errors.
 */
export async function applyOperatorSetup(
  db: OpsDb,
  raw: string | undefined,
  hasher: PasswordHasher,
): Promise<{id: number; applied: boolean} | undefined> {
  if (raw === undefined) {
    return undefined;
  }
  const setup = parseSetup(raw);
  db.db.exec(`CREATE TABLE IF NOT EXISTS operator_setup_commands (
    nonce TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    operator_id INTEGER NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const previous = () => {
    const row = db.db
      .prepare(
        'SELECT action, operator_id, name FROM operator_setup_commands WHERE nonce = ?',
      )
      .get(setup.nonce) as
      {action: string; operator_id: number; name: string} | undefined;
    if (row && (row.action !== setup.action || row.name !== setup.name)) {
      throw new Error('operator setup nonce already used for another command');
    }
    return row;
  };
  const applied = previous();
  if (applied) {
    return {id: applied.operator_id, applied: false};
  }
  const passwordHash = await hasher.hash(setup.password);
  return db.db.transaction(() => {
    const raced = previous();
    if (raced) {
      return {id: raced.operator_id, applied: false};
    }
    let id: number;
    if (setup.action === 'bootstrap') {
      if (db.db.prepare('SELECT id FROM operators LIMIT 1').get()) {
        throw new Error(
          'bootstrap requires an empty operator table; use explicit recovery',
        );
      }
      db.db
        .prepare(
          'INSERT INTO operators (name, password_hash, key_env, created) VALUES (?, ?, ?, ?)',
        )
        .run(setup.name, passwordHash, setup.keyEnv ?? 'issued', db.now());
      id = (
        db.db
          .prepare('SELECT id FROM operators WHERE name = ?')
          .get(setup.name) as {id: number}
      ).id;
    } else {
      const row = db.db
        .prepare('SELECT id FROM operators WHERE name = ?')
        .get(setup.name) as {id: number} | undefined;
      if (!row) {
        throw new Error('recovery requires an existing named operator');
      }
      id = row.id;
      db.db
        .prepare('UPDATE operators SET password_hash = ? WHERE id = ?')
        .run(passwordHash, id);
      db.db
        .prepare(
          'UPDATE sessions SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL',
        )
        .run(db.now(), id);
    }
    db.db
      .prepare(
        'INSERT INTO operator_setup_commands (nonce, action, operator_id, name, applied_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(setup.nonce, setup.action, id, setup.name, db.now());
    return {id, applied: true};
  });
}
