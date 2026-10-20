/**
 * The one HTTP surface: a node:http router, no framework. Bearer-token auth
 * on every route; TLS lives at the reverse proxy, the service binds localhost.
 *
 * The routes (D29):
 *   POST /auth/operator/session   password -> 12 h token
 *   POST /auth/holder/session     proof stub -> scope-holder token
 *   POST /auth/operator/signout   revoke the bearer's own session
 *   GET  /auth/operator/sessions  the operator's live sessions (operator only)
 *   POST /auth/operator/revoke    revoke a principal's live sessions (operator only)
 *   POST /keys/issue              {batch_id, ordinal}; operator or one-shot holder
 *   GET  /mints                   active mint list
 *   GET  /anchor/tip              80-byte header, 60 s cache, 503 with last-good
 *   POST /registry/cards          operator-only, idempotent upsert (identical -> 200, changed -> 409)
 *   GET  /registry/cards?batch_id operator only
 *   POST /registry/cap-releases   operator only
 */
import {IncomingMessage, ServerResponse} from 'node:http';

import {
  createHolderSession,
  createOperatorSession,
  listSessionsForPrincipal,
  resolveSession,
  revokeSession,
  revokeSessionsForPrincipal,
  Session,
} from './auth';
import {AnchorFeed} from './anchor';
import {BatchError, createBatch, listBatches} from './batches';
import {OpsDb} from './db';
import {HolderIssueState, issueKeys} from './issue';
import {
  addCapRelease,
  getCard,
  listCapReleases,
  recordCard,
  RegistryError,
} from './registry';

const BODY_LIMIT = 1 << 20; // 1 MiB; a registry row is a few hundred bytes

export interface RouterDeps {
  readonly db: OpsDb;
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
    // ── auth ──────────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/auth/operator/session') {
      const body = parseJson(await readBody(req));
      const name = strField(body, 'name');
      const password = strField(body, 'password');
      const issued = createOperatorSession(deps.db, name, password);
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
        env: issued.session.env,
        expires_at: issued.session.expiresAt,
      });
      return;
    }
    if (method === 'POST' && path === '/auth/holder/session') {
      const body = parseJson(await readBody(req));
      const issued = createHolderSession(deps.db, body.proof);
      if (!issued) {
        throw new HttpError(
          401,
          'bad-proof',
          'the holder proof is not well-formed',
        );
      }
      sendJson(res, 200, {
        token: issued.token,
        kind: issued.session.kind,
        env: issued.session.env,
        expires_at: issued.session.expiresAt,
      });
      return;
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

    // ── keys ──────────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/keys/issue') {
      const session = requireSession(deps, req);
      const body = parseJson(await readBody(req));
      const batchId = intField(body, 'batch_id');
      const ordinal = intField(body, 'ordinal');
      const result = issueKeys(
        deps.db,
        batchId,
        ordinal,
        session.kind === 'operator'
          ? {kind: 'operator'}
          : {kind: 'holder', tokenHash: session.tokenHash},
        deps.holderState,
      );
      if (!result.ok) {
        const status = result.reason === 'rate-limited' ? 429 : 404;
        sendJson(res, status, {reason: result.reason});
        return;
      }
      // The one response a phone takes keys from; nothing else the phone can
      // call returns key material (ops/test/sessions-clean.test.ts pins it).
      sendJson(res, 200, {
        batch_id: result.keys.batch_id,
        ordinal: result.keys.ordinal,
        enc: result.keys.enc.toString('hex'),
        mac: result.keys.mac.toString('hex'),
        dek: result.keys.dek.toString('hex'),
        escrowed_at: result.keys.escrowed_at,
      });
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
      requireSession(deps, req);
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
      // Operator-only (OPS-GOVERNANCE Q4): the operator posts registries and
      // the holder's only path is one-shot key issuance — a holder token
      // must not write registry rows.
      requireOperator(deps, req);
      const body = parseJson(await readBody(req));
      const row = {
        short_id: strField(body, 'short_id'),
        batch_id: intField(body, 'batch_id'),
        key_id: intField(body, 'key_id'),
        ordinal: intField(body, 'ordinal'),
        installed_at: intField(body, 'installed_at'),
        installer: strField(body, 'installer'),
        load_sha256: strField(body, 'load_sha256'),
      };
      try {
        const result = recordCard(deps.db, row);
        if (result.kind === 'conflict') {
          // The existing row, so the caller can see WHAT differs; a bare
          // {kind: 'conflict'} names no row at all.
          const existing = getCard(deps.db, row.short_id);
          sendJson(res, 409, {
            reason: 'short-id-exists',
            stored: existing,
          });
          return;
        }
        sendJson(res, 200, {stored: result.row});
      } catch (e) {
        if (e instanceof RegistryError) {
          throw new HttpError(400, 'bad-row', e.message);
        }
        throw e;
      }
      return;
    }
    if (method === 'GET' && path === '/registry/cards') {
      requireOperator(deps, req);
      const batchId = Number.parseInt(
        url.searchParams.get('batch_id') ?? '',
        10,
      );
      if (!Number.isInteger(batchId)) {
        throw new HttpError(
          400,
          'bad-field',
          'batch_id is an integer query parameter',
        );
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
      const session = requireOperator(deps, req);
      const body = parseJson(await readBody(req));
      try {
        const batch = createBatch(deps.db, {
          count: intField(body, 'count'),
          mintUrl: strField(body, 'mint_url'),
          pinPolicy:
            body.pin_policy === 'batch'
              ? 'batch'
              : body.pin_policy === 'perCard'
                ? 'perCard'
                : (() => {
                    throw new HttpError(
                      400,
                      'bad-field',
                      'pin_policy is batch|perCard',
                    );
                  })(),
          pinBatch:
            typeof body.pin_batch === 'string' ? body.pin_batch : undefined,
          dailyUsd: typeof body.daily_usd === 'number' ? body.daily_usd : 0,
          noPinUsd: typeof body.no_pin_usd === 'number' ? body.no_pin_usd : 0,
          loadSha256: strField(body, 'load_sha256'),
          operatorId: session.principalId,
        });
        sendJson(res, 200, {
          batch: {...batch, ordinal_salt: batch.ordinal_salt.toString('hex')},
        });
      } catch (e) {
        if (e instanceof BatchError) {
          throw new HttpError(400, 'bad-batch', e.message);
        }
        throw e;
      }
      return;
    }
    if (method === 'GET' && path === '/registry/batches') {
      requireOperator(deps, req);
      sendJson(res, 200, {
        batches: listBatches(deps.db).map(b => ({
          ...b,
          ordinal_salt: b.ordinal_salt.toString('hex'),
        })),
      });
      return;
    }

    sendJson(res, 404, {reason: 'no-such-route'});
  } catch (e) {
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
