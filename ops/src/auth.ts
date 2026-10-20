/**
 * Operator and holder sessions. Operator auth v1 is a scrypt password
 * (node:crypto, no new native dep — the plan's decision 3); the bearer token
 * is 12 h, revocable server-side, and stored hashed (the DB never holds a
 * live token). Holder sessions are a stub — the real IdP is Phase 5b — and
 * their scope is narrow by design (OPS-GOVERNANCE Q4): one-shot issuance,
 * no batch reads, no cap releases.
 */
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import {OpsDb} from './db';

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

/** scrypt with a per-password salt; the stored string carries its parameters. */
export function hashPassword(password: string): string {
  const salt = Buffer.from(randomBytes(16));
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 64, {N, r, p});
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex!, 'hex');
  const actual = scryptSync(
    password,
    Buffer.from(saltHex!, 'hex'),
    expected.length,
    {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    },
  );
  return timingSafeEqual(expected, actual);
}

const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface IssuedSession {
  /** The bearer token, shown once — only its hash is stored. */
  readonly token: string;
  readonly session: Session;
}

export function createOperatorSession(
  db: OpsDb,
  name: string,
  password: string,
): IssuedSession | null {
  const operator = db.db
    .prepare('SELECT id, password_hash, key_env FROM operators WHERE name = ?')
    .get(name) as
    {id: number; password_hash: string; key_env: KeyEnv} | undefined;
  if (!operator || !verifyPassword(password, operator.password_hash)) {
    return null;
  }
  return issueSession(db, operator.id, 'operator', operator.key_env);
}

/**
 * The holder-session stub (OPS-GOVERNANCE Q5): any well-formed proof gets a
 * scope-holder token, so the contract exists before the IdP does. The proof
 * format is what Phase 5b's IdP will validate; the stub checks shape only.
 */
export function createHolderSession(
  db: OpsDb,
  proof: unknown,
): IssuedSession | null {
  if (
    typeof proof !== 'object' ||
    proof === null ||
    typeof (proof as {env?: unknown}).env !== 'string'
  ) {
    return null;
  }
  const env = (proof as {env: string}).env;
  if (env !== 'factory' && env !== 'issued') {
    return null;
  }
  return issueSession(db, PRINCIPAL_HOLDER, 'holder', env);
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
  if (!row) {
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
