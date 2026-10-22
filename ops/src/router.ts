import {operatorAdminRequest} from './operator-admin';
/**
 * The one HTTP surface: a node:http router, no framework. Bearer-token auth
 * on every route but one: GET /anchor/tip is public, because its answer is
 * public data — an 80-byte block header straight off mempool.space — and
 * cardctl's fetch_tip (a bench tool with no session) is its caller. The
 * sessions-clean claim (no key material in a cached response) is unaffected:
 * the tip never carries keys. TLS lives at the reverse proxy, the service
 * binds localhost.
 *
 * The routes (D29):
 *   POST /auth/operator/session   password -> 12 h token
 *   POST /auth/holder/session     disabled until consumer authorization exists
 *   POST /auth/operator/signout   revoke the bearer's own session
 *   GET  /auth/operator/sessions  the operator's live sessions (operator only)
 *   POST /auth/operator/revoke    revoke a principal's live sessions (operator only)
 *   POST /keys/issue              {device_id, attempt_id}; owned active reservation
 *   GET  /mints                   active mint list
 *   GET  /anchor/tip              PUBLIC: 80-byte header, 60 s cache, 503 with last-good
 *   POST /provisioning/*          operator-only durable reservations and receipts
 *   POST /registry/cards          retired: 410 reservation-required
 *   GET  /registry/cards?batch_id operator only
 *   POST /registry/cap-releases   operator only
 */
import {IncomingMessage, ServerResponse} from 'node:http';

import {
  LoginRateLimitError,
  createOperatorSession,
  listSessionsForPrincipal,
  resolveSession,
  revokeSession,
  revokeSessionsForPrincipal,
  Session,
} from './auth';
import {AnchorFeed} from './anchor';
import {listBatches} from './batches';
import {OpsDb} from './db';
import type {PasswordHasher} from './pwhash';
import {HolderIssueState} from './issue';
import {ProvisioningError} from './provisioning';
import {BackupFreshnessError} from './recovery-evidence';
import {provisioningHttp, reservedKeys} from './provisioning-http';
import {addCapRelease, listCapReleases, RegistryError} from './registry';

const BODY_LIMIT = 1 << 20; // 1 MiB; a registry row is a few hundred bytes

export interface RouterDeps {
  readonly operatorAdmins?: () => string | undefined;
  readonly db: OpsDb;
  readonly passwordHasher?: PasswordHasher;
  readonly anchor: AnchorFeed;
  readonly holderState: HolderIssueState;
  /** The mints the service serves (the registry the screens read). */
  readonly mints: readonly string[];
}

interface JsonBody {
  [key: string]: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'body-too-large', 'the body is over 1 MiB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw: string): JsonBody {
  if (raw.trim() === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad-json', 'the body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'bad-json', 'the body is a JSON object');
  }
  return parsed as JsonBody;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return null;
  }
  return h.slice('Bearer '.length).trim() || null;
}

function requireSession(deps: RouterDeps, req: IncomingMessage): Session {
  const session = resolveSession(deps.db, bearer(req));
  if (!session) {
    throw new HttpError(401, 'no-session', 'a live bearer token is required');
  }
  return session;
}

function requireOperator(deps: RouterDeps, req: IncomingMessage): Session {
  const session = requireSession(deps, req);
  if (session.kind !== 'operator') {
    throw new HttpError(403, 'operator-only', 'this route is operator-only');
  }
  return session;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function intField(body: JsonBody, name: string): number {
  const v = body[name];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new HttpError(400, 'bad-field', `${name} is an integer`);
  }
  return v;
}

function strField(body: JsonBody, name: string): string {
  const v = body[name];
  if (typeof v !== 'string' || v === '') {
    throw new HttpError(400, 'bad-field', `${name} is a non-empty string`);
  }
  return v;
}

/** The route table. Each handler returns [status, body]. */
export async function route(
  deps: RouterDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  try {
    if (
      path === '/admin/provisioning/attempts' ||
      path === '/admin/operators' ||
      path.startsWith('/admin/operators/')
    ) {
      const body = method === 'POST' ? parseJson(await readBody(req)) : {};
      const [status, answer] = await operatorAdminRequest(
        deps,
        bearer(req),
        method,
        path,
        body,
      );
      sendJson(res, status, answer);
      return;
    }
    // ── auth ──────────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/operator/session') {
      const body = parseJson(await readBody(req));
      const name = strField(body, 'name');
      const password = strField(body, 'password');
      const issued = await createOperatorSession(
        deps.db,
        name,
        password,
        deps.passwordHasher,
      );
      if (!issued) {
        throw new HttpError(
          401,
          'bad-credentials',
          'the name or password is wrong',
        );
      }
      sendJson(res, 200, {
        token: issued.token,
        kind: issued.session.kind,
        operator_id: issued.session.principalId,
        env: issued.session.env,
        expires_at: issued.session.expiresAt,
      });
      return;
    }
    if (method === 'POST' && path === '/auth/holder/session') {
      throw new HttpError(
        403,
        'holder-disabled',
        'consumer provisioning is disabled',
      );
    }
    if (method === 'POST' && path === '/auth/operator/signout') {
      const token = bearer(req);
      if (!token || !revokeSession(deps.db, token)) {
        throw new HttpError(
          401,
          'no-session',
          'a live bearer token is required',
        );
      }
      sendJson(res, 200, {revoked: true});
      return;
    }
    // The stolen-phone answer (OPS-THREAT-MODEL #2): an operator revokes a
    // principal's live sessions — theirs included — WITHOUT possessing the
    // stolen token, and can list what is live first. Both operator-only: a
    // holder token must not revoke or list operator sessions.
    if (method === 'GET' && path === '/auth/operator/sessions') {
      const session = requireOperator(deps, req);
      sendJson(res, 200, {
        sessions: listSessionsForPrincipal(deps.db, session.principalId).map(
          s => ({
            kind: s.kind,
            env: s.env,
            expires_at: s.expiresAt,
            token_hash: s.tokenHash,
          }),
        ),
      });
      return;
    }
    if (method === 'POST' && path === '/auth/operator/revoke') {
      requireOperator(deps, req);
      const body = parseJson(await readBody(req));
      const principalId = intField(body, 'principal_id');
      const revoked = revokeSessionsForPrincipal(deps.db, principalId);
      sendJson(res, 200, {revoked});
      return;
    }

    // The new operator workflow is reservation-scoped before any key read.
    if (path.startsWith('/provisioning/')) {
      const session = requireOperator(deps, req);
      const body = method === 'POST' ? parseJson(await readBody(req)) : {};
      const result = provisioningHttp(
        deps.db,
        session,
        method,
        path,
        url,
        body,
      );
      sendJson(res, result.status, result.body);
      return;
    }
    if (method === 'POST' && path === '/keys/issue') {
      const session = requireOperator(deps, req);
      sendJson(
        res,
        200,
        reservedKeys(deps.db, session, parseJson(await readBody(req))),
      );
      return;
    }

    // ── mints ─────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/mints') {
      requireSession(deps, req);
      sendJson(res, 200, {mints: [...deps.mints]});
      return;
    }

    // ── anchor tip ────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/anchor/tip') {
      // Deliberately public: the body is an 80-byte public block header (plus
      // its height and fetch time) and the client is cardctl's fetch_tip, a
      // bench tool that holds no session. Nothing here is per-card or
      // per-operator data, so the sessions-clean claim still holds.
      const tip = await deps.anchor.tip();
      if (tip.ok) {
        sendJson(res, 200, {
          header: tip.tip.header.toString('hex'),
          height: tip.tip.height,
          fetched_at: tip.tip.fetchedAt,
        });
      } else if (tip.stale) {
        sendJson(res, 503, {
          reason: 'upstream-unavailable',
          header: tip.stale.header.toString('hex'),
          height: tip.stale.height,
          fetched_at: tip.stale.fetchedAt,
        });
      } else {
        sendJson(res, 503, {reason: 'upstream-unavailable'});
      }
      return;
    }

    // ── registry: cards ───────────────────────────────────────────────────
    if (method === 'POST' && path === '/registry/cards') {
      requireOperator(deps, req);
      throw new HttpError(
        410,
        'reservation-required',
        'use the provisioning attempt record endpoint',
      );
    }
    if (method === 'GET' && path === '/registry/cards') {
      const session = requireOperator(deps, req);
      const rawId = url.searchParams.get('batch_id');
      const batchId = rawId ? Number(rawId) : NaN;
      if (!Number.isSafeInteger(batchId) || batchId < 1) {
        throw new HttpError(
          400,
          'bad-field',
          'batch_id is a positive integer query parameter',
        );
      }
      const batch = deps.db.db
        .prepare('SELECT operator_id FROM key_batches WHERE id = ?')
        .get(batchId) as {operator_id: number} | undefined;
      if (!batch || batch.operator_id !== session.principalId) {
        throw new HttpError(404, 'not-found', 'no owned batch');
      }
      sendJson(res, 200, {cards: recordCardList(deps, batchId)});
      return;
    }

    // ── registry: cap releases ────────────────────────────────────────────
    if (method === 'POST' && path === '/registry/cap-releases') {
      requireOperator(deps, req);
      const body = parseJson(await readBody(req));
      try {
        const row = addCapRelease(
          deps.db,
          strField(body, 'version'),
          strField(body, 'sha256'),
        );
        sendJson(res, 200, {stored: row});
      } catch (e) {
        if (e instanceof RegistryError) {
          throw new HttpError(400, 'bad-row', e.message);
        }
        throw e;
      }
      return;
    }
    if (method === 'GET' && path === '/registry/cap-releases') {
      requireSession(deps, req);
      sendJson(res, 200, {releases: listCapReleases(deps.db)});
      return;
    }

    // ── batches (operator: the registry read the summary screens want) ────
    if (method === 'POST' && path === '/registry/batches') {
      requireOperator(deps, req);
      throw new HttpError(
        410,
        'reservation-required',
        'use idempotent provisioning batch creation',
      );
    }
    if (method === 'GET' && path === '/registry/batches') {
      const session = requireOperator(deps, req);
      sendJson(res, 200, {
        batches: listBatches(deps.db)
          .filter(b => b.operator_id === session.principalId)
          .map(b => {
            const {pin_batch: _pin, ...visible} = b;
            return {...visible, ordinal_salt: b.ordinal_salt.toString('hex')};
          }),
      });
      return;
    }

    sendJson(res, 404, {reason: 'no-such-route'});
  } catch (e) {
    if (e instanceof BackupFreshnessError) {
      sendJson(res, 503, {reason: 'independent-backup-stale'});
      return;
    }
    if (e instanceof ProvisioningError) {
      sendJson(res, e.status, {reason: e.code, message: e.message});
      return;
    }
    if (e instanceof LoginRateLimitError) {
      sendJson(res, 429, {reason: 'login-rate-limited', message: e.message});
      return;
    }
    if (e instanceof HttpError) {
      sendJson(res, e.status, {reason: e.code, message: e.message});
      return;
    }
    sendJson(res, 500, {
      reason: 'internal',
      message: 'an internal error happened',
    });
  }
}

function recordCardList(deps: RouterDeps, batchId: number): unknown[] {
  // listCards imported lazily to keep the route table readable
  const {listCards} = require('./registry') as typeof import('./registry');
  return listCards(deps.db, batchId);
}

export {sendJson};
