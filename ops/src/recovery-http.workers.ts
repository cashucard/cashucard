/** Existing encrypted exports only. This credential never enters the card API. */
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {resolveSession} from './auth';
import type {OpsDb} from './db';
import {recoverySetup} from './recovery-setup.workers';

export interface RecoveryBindings {
  OPS_BACKUPS?: R2Bucket;
  OPS_BACKUP_RECIPIENT?: string;
  /** Deployment-controlled JSON array of operator names allowed to enroll. */
  OPS_RECOVERY_ADMINS?: string;
  /** Stable public UUID, unique to this issuer/environment. */
  OPS_RECOVERY_ISSUER_ID?: string;
}
const EXPORT_NAME =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.age$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 256 * 1024 * 1024;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
class Failure extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}
function json(body: unknown, status = 200) {
  return Response.json(body, {status, headers});
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Failure(400, 'invalid-body');
  let bytes = new Uint8Array();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (bytes.length + part.value.length > 4096) {
        await reader.cancel();
        throw new Failure(413, 'body-too-large');
      }
      const next = new Uint8Array(bytes.length + part.value.length);
      next.set(bytes);
      next.set(part.value, bytes.length);
      bytes = next;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value;
  } catch (e) {
    if (e instanceof Failure) throw e;
    throw new Failure(400, 'invalid-body');
  } finally {
    reader.releaseLock();
  }
}
function issuer(env: RecoveryBindings): string {
  if (
    !env.OPS_RECOVERY_ISSUER_ID ||
    !UUID.test(env.OPS_RECOVERY_ISSUER_ID) ||
    !env.OPS_BACKUPS ||
    !env.OPS_BACKUP_RECIPIENT
  )
    throw new Failure(503, 'recovery-not-configured');
  return env.OPS_RECOVERY_ISSUER_ID;
}
function admin(db: OpsDb, request: Request, env: RecoveryBindings) {
  const value = request.headers.get('authorization') ?? '';
  const session = resolveSession(
    db,
    value.startsWith('Bearer ') ? value.slice(7) : null,
  );
  if (!session || session.kind !== 'operator')
    throw new Failure(401, 'no-session');
  let allowed: unknown;
  try {
    allowed = JSON.parse(env.OPS_RECOVERY_ADMINS ?? '[]');
  } catch {
    throw new Failure(503, 'recovery-not-configured');
  }
  const user = db.db
    .prepare('SELECT name FROM operators WHERE id = ?')
    .get(session.principalId) as {name: string} | undefined;
  if (!Array.isArray(allowed) || !user || !allowed.includes(user.name))
    throw new Failure(403, 'recovery-admin-required');
  return session.principalId;
}
function companion(db: OpsDb, request: Request, issuerId: string) {
  const value = request.headers.get('authorization') ?? '';
  if (!value.startsWith('Bearer recovery-v1.'))
    throw new Failure(401, 'no-recovery-credential');
  const secret = value.slice('Bearer recovery-v1.'.length);
  if (!SECRET.test(secret)) throw new Failure(401, 'no-recovery-credential');
  const found = db.db
    .prepare(
      'SELECT id FROM recovery_connections WHERE token_hash = ? AND issuer_id = ? AND revoked IS NULL',
    )
    .get(digest(secret), issuerId);
  if (!found) throw new Failure(401, 'no-recovery-credential');
}
export async function recoveryHttp(
  db: OpsDb,
  request: Request,
  env: RecoveryBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith('/ops/recovery/') &&
    !url.pathname.startsWith('/recovery/')
  )
    return null;
  if (url.protocol !== 'https:') return json({reason: 'https-required'}, 400);
  if (url.pathname === '/ops/recovery/setup' && request.method === 'GET')
    return recoverySetup();
  try {
    const issuerId = issuer(env);
    if (url.pathname.startsWith('/ops/recovery/')) {
      const adminId = admin(db, request, env);
      if (
        url.pathname === '/ops/recovery/pairings' &&
        request.method === 'POST'
      ) {
        const input = await body(request);
        if (
          typeof input.name !== 'string' ||
          !/^[A-Za-z0-9 ._-]{1,64}$/.test(input.name)
        )
          throw new Failure(400, 'invalid-name');
        const code = randomBytes(32).toString('base64url');
        const expires = db.now() + 600;
        db.db.transaction(() => {
          db.db
            .prepare('DELETE FROM recovery_pairings WHERE expires <= ?')
            .run(db.now());
          const count = db.db
            .prepare('SELECT COUNT(*) AS n FROM recovery_pairings')
            .get() as {n: number};
          const devices = db.db
            .prepare('SELECT COUNT(*) AS n FROM recovery_connections')
            .get() as {n: number};
          if (count.n >= 20 || devices.n >= 100)
            throw new Failure(409, 'recovery-capacity');
          db.db
            .prepare(
              'INSERT INTO recovery_pairings (code_hash, issuer_id, name, approved_by, expires) VALUES (?, ?, ?, ?, ?)',
            )
            .run(digest(code), issuerId, input.name, adminId, expires);
        });
        return json({code, expires_at: expires, issuer_id: issuerId}, 201);
      }
      if (
        url.pathname === '/ops/recovery/connections' &&
        request.method === 'GET'
      ) {
        return json({
          connections: db.db
            .prepare(
              'SELECT id, name, approved_by, created, revoked FROM recovery_connections WHERE issuer_id = ? ORDER BY created',
            )
            .all(issuerId),
        });
      }
      const id = url.pathname.slice('/ops/recovery/connections/'.length);
      if (
        url.pathname.startsWith('/ops/recovery/connections/') &&
        request.method === 'DELETE' &&
        UUID.test(id)
      ) {
        db.db
          .prepare(
            'UPDATE recovery_connections SET revoked = ? WHERE id = ? AND issuer_id = ? AND revoked IS NULL',
          )
          .run(db.now(), id, issuerId);
        return json({revoked: true});
      }
      throw new Failure(404, 'not-found');
    }
    if (url.pathname === '/recovery/claim' && request.method === 'POST') {
      const input = await body(request);
      if (
        typeof input.code !== 'string' ||
        !SECRET.test(input.code) ||
        typeof input.secret !== 'string' ||
        !SECRET.test(input.secret)
      )
        throw new Failure(401, 'invalid-pairing');
      const codeHash = digest(input.code),
        tokenHash = digest(input.secret);
      const connectionId = db.db.transaction(() => {
        const pairing = db.db
          .prepare(
            'SELECT name, approved_by, expires, connection_id FROM recovery_pairings WHERE code_hash = ? AND issuer_id = ?',
          )
          .get(codeHash, issuerId) as
          | {
              name: string;
              approved_by: number;
              expires: number;
              connection_id: string | null;
            }
          | undefined;
        if (!pairing || pairing.expires <= db.now())
          throw new Failure(401, 'invalid-pairing');
        if (pairing.connection_id) {
          const same = db.db
            .prepare(
              'SELECT id FROM recovery_connections WHERE id = ? AND token_hash = ? AND revoked IS NULL',
            )
            .get(pairing.connection_id, tokenHash) as {id: string} | undefined;
          if (!same) throw new Failure(401, 'invalid-pairing');
          return same.id;
        }
        const count = db.db
          .prepare('SELECT COUNT(*) AS n FROM recovery_connections')
          .get() as {n: number};
        if (count.n >= 100) throw new Failure(409, 'recovery-capacity');
        const id = randomUUID();
        db.db
          .prepare(
            'INSERT INTO recovery_connections (id, issuer_id, name, token_hash, approved_by, created) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            issuerId,
            pairing.name,
            tokenHash,
            pairing.approved_by,
            db.now(),
          );
        db.db
          .prepare(
            'UPDATE recovery_pairings SET connection_id = ? WHERE code_hash = ?',
          )
          .run(id, codeHash);
        return id;
      });
      return json({issuer_id: issuerId, connection_id: connectionId});
    }
    companion(db, request, issuerId);
    if (request.method !== 'GET') throw new Failure(405, 'method-not-allowed');
    if (url.pathname === '/recovery/exports') {
      const cursor = url.searchParams.get('cursor') ?? undefined;
      if (cursor && cursor.length > 1024)
        throw new Failure(400, 'invalid-cursor');
      const page = await env.OPS_BACKUPS!.list({
        prefix: 'escrow/',
        limit: 1000,
        cursor,
      });
      return json({
        issuer_id: issuerId,
        objects: page.objects
          .filter(
            o =>
              EXPORT_NAME.test(o.key.slice(7)) &&
              o.size > 0 &&
              o.size <= MAX_BYTES,
          )
          .map(o => ({Name: o.key.slice(7), Size: o.size, IsDir: false})),
        cursor: page.truncated ? page.cursor : null,
      });
    }
    if (url.pathname.startsWith('/recovery/exports/')) {
      const name = decodeURIComponent(
        url.pathname.slice('/recovery/exports/'.length),
      );
      if (!EXPORT_NAME.test(name)) throw new Failure(404, 'not-found');
      const object = await env.OPS_BACKUPS!.get('escrow/' + name);
      if (!object || object.size <= 0 || object.size > MAX_BYTES)
        throw new Failure(404, 'not-found');
      return new Response(object.body, {
        headers: {
          ...headers,
          'content-type': 'application/octet-stream',
          'content-length': String(object.size),
        },
      });
    }
    throw new Failure(404, 'not-found');
  } catch (e) {
    if (e instanceof Failure) return json({reason: e.reason}, e.status);
    return json({reason: 'recovery-unavailable'}, 503);
  }
}
