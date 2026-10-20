/**
 * Operator and holder sessions. Operator auth v1 is a password whose hash
 * goes through the pwhash seam (scrypt on Node, PBKDF2-SHA256 over WebCrypto
 * on the Durable Object — the ENG-740 Workers amendment; the stored string's
 * prefix picks the verifier, so hashes outlive backend changes); the bearer
 * token is 12 h, revocable server-side, and stored hashed (the DB never holds
 * a live token). Holder access is disabled until verified identity and
 * card authorization exist (D30), including previously minted holder tokens.
 */
import {createHash, randomBytes} from 'node:crypto';

import {OpsDb} from './db';
import {NodePwHash, type PasswordHasher} from './pwhash';

export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 h
export const PRINCIPAL_HOLDER = 0; // holder sessions have no operators row

export type SessionKind = 'operator' | 'holder';
export type KeyEnv = 'factory' | 'issued';

export interface Session {
  readonly tokenHash: string;
  readonly principalId: number;
  readonly kind: SessionKind;
  readonly env: KeyEnv;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

/**
 * The process's hasher: scrypt on Node (the server, the ops CLI, the tests).
 * The Durable Object constructs a SubtlePwHash and hands it to
 * `createOperatorSession` — hash/verify dispatch on the stored prefix either
 * way, so a row written by one backend verifies on the other.
 */
export const defaultPwHash: PasswordHasher = new NodePwHash();

/** scrypt (or PBKDF2, via the seam) with a per-password salt; self-describing string. */
export function hashPassword(password: string): Promise<string> {
  return defaultPwHash.hash(password);
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  return defaultPwHash.verify(password, stored);
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface IssuedSession {
  /** The bearer token, shown once — only its hash is stored. */
  readonly token: string;
  readonly session: Session;
}

export async function createOperatorSession(
  db: OpsDb,
  name: string,
  password: string,
  pwHash: PasswordHasher = defaultPwHash,
): Promise<IssuedSession | null> {
  reserveLoginAttempt(db);
  const operator = db.db
    .prepare('SELECT id, password_hash, key_env FROM operators WHERE name = ?')
    .get(name) as
    {id: number; password_hash: string; key_env: KeyEnv} | undefined;
  if (!operator || !(await pwHash.verify(password, operator.password_hash))) {
    return null;
  }
  // Password verification yields to other requests. Credential recovery must
  // invalidate a login already in flight, as well as previously issued tokens.
  return db.db.transaction(() => {
    const current = db.db
      .prepare('SELECT password_hash, key_env FROM operators WHERE id = ?')
      .get(operator.id) as {password_hash: string; key_env: KeyEnv} | undefined;
    if (
      !current ||
      current.password_hash !== operator.password_hash ||
      current.key_env !== operator.key_env
    ) {
      return null;
    }
    return issueSession(db, operator.id, 'operator', current.key_env);
  });
}

/** Consumer identity and card authorization are not implemented (D30). */
export function createHolderSession(
  _db: OpsDb,
  _proof: unknown,
): IssuedSession | null {
  return null;
}

/** A service-wide work budget, durable across process or object restarts. */
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_SECONDS = 60;

export class LoginRateLimitError extends Error {
  constructor() {
    super('operator sign-in attempt budget exhausted; retry after the window');
  }
}

function reserveLoginAttempt(db: OpsDb): void {
  // Reserve before the asynchronous verifier: concurrent requests cannot all
  // observe an unused slot. One row bounds storage even for rotating names.
  db.db.transaction(() => {
    const now = db.now();
    const row = db.db
      .prepare(
        'SELECT window_start, attempts FROM login_attempt_budget WHERE id = 1',
      )
      .get() as {window_start: number; attempts: number} | undefined;
    const reset = !row || now - row.window_start >= LOGIN_WINDOW_SECONDS;
    if (!reset && row.attempts >= LOGIN_MAX_ATTEMPTS) {
      throw new LoginRateLimitError();
    }
    db.db
      .prepare(
        `INSERT INTO login_attempt_budget (id, window_start, attempts)
      VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET
      window_start = excluded.window_start, attempts = excluded.attempts`,
      )
      .run(reset ? now : row.window_start, reset ? 1 : row.attempts + 1);
  });
}

function issueSession(
  db: OpsDb,
  principalId: number,
  kind: SessionKind,
  env: KeyEnv,
): IssuedSession {
  const token = Buffer.from(randomBytes(32)).toString('hex');
  const now = db.now();
  const expiresAt = now + SESSION_TTL_SECONDS;
  db.db
    .prepare(
      `INSERT INTO sessions (token_hash, principal_id, kind, env, expires_at, created)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), principalId, kind, env, expiresAt, now);
  return {
    token,
    session: {
      tokenHash: hashToken(token),
      principalId,
      kind,
      env,
      expiresAt,
      revokedAt: null,
    },
  };
}

/** The session a live bearer token carries, or null: expired or revoked. */
export function resolveSession(
  db: OpsDb,
  token: string | null | undefined,
): Session | null {
  if (!token) {
    return null;
  }
  const row = db.db
    .prepare('SELECT * FROM sessions WHERE token_hash = ?')
    .get(hashToken(token)) as
    | {
        token_hash: string;
        principal_id: number;
        kind: SessionKind;
        env: KeyEnv;
        expires_at: number;
        revoked_at: number | null;
      }
    | undefined;
  if (!row || row.kind !== 'operator') {
    return null;
  }
  // better-sqlite3 returns NULL columns as null; the column is revoked_at
  // (snake_case in the schema), never a camelCase field.
  const revokedAt = row.revoked_at ?? null;
  if (revokedAt !== null || row.expires_at <= db.now()) {
    return null;
  }
  return {
    tokenHash: row.token_hash,
    principalId: row.principal_id,
    kind: row.kind,
    env: row.env,
    expiresAt: row.expires_at,
    revokedAt,
  };
}

export function revokeSession(db: OpsDb, token: string): boolean {
  const info = db.db
    .prepare(
      'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    )
    .run(db.now(), hashToken(token));
  return info.changes > 0;
}

/**
 * Revokes every live session of a principal — the stolen-phone answer the
 * threat model's row 2 claims: an operator who still holds THEIR token
 * revokes a principal's sessions without possessing the stolen one. The
 * operator's own sessions included, by design: revoking yourself is
 * sign-out with ceremony.
 */
export function revokeSessionsForPrincipal(
  db: OpsDb,
  principalId: number,
): number {
  const info = db.db
    .prepare(
      'UPDATE sessions SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL',
    )
    .run(db.now(), principalId);
  return info.changes;
}

/** The live (unexpired, unrevoked) sessions of a principal, hashes only. */
export function listSessionsForPrincipal(
  db: OpsDb,
  principalId: number,
): Session[] {
  const rows = db.db
    .prepare(
      `SELECT * FROM sessions
       WHERE principal_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created`,
    )
    .all(principalId, db.now()) as {
    token_hash: string;
    principal_id: number;
    kind: SessionKind;
    env: KeyEnv;
    expires_at: number;
    revoked_at: number | null;
    created: number;
  }[];
  return rows.map(r => ({
    tokenHash: r.token_hash,
    principalId: r.principal_id,
    kind: r.kind,
    env: r.env,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at ?? null,
  }));
}
