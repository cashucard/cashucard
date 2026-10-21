/**
 * The ops service on Workers (the ENG-740 hosting amendment): one Durable
 * Object, `OpsStore`, whose embedded SQLite IS the escrow DB. The DO gives
 * the design's assumed shape — single-threaded, transactional, one writer —
 * by the runtime's own execution model, and its storage brings built-in PITR
 * where the plain-VM file had only the backup step.
 *
 * The Worker's fetch forwards every request to the one object
 * (`idFromName('ops')`); the DO runs the same route table, the same modules,
 * over the sql-do backend. OPS_MASTER_KEY arrives as a wrangler secret
 * (`wrangler secret put` — never shell history); PBKDF2 replaces scrypt
 * through the pwhash seam.
 */
import {DurableObject} from 'cloudflare:workers';

import {AnchorFeed, httpTipFetcher} from './anchor';
import {EnvMaster} from './master';
import {OpsDb} from './db';
import {HolderIssueState} from './issue';
import {HttpError, RouterDeps} from './router';
import {routeRequest} from './route-request';
import {openSqlStorage} from './sql-do';
import {DEFAULT_MINTS} from './config';
import {SubtlePwHash} from './pwhash';
import {applyOperatorSetup} from './operator-setup';
import {resolveSession} from './auth';
import {recoveryHttp, type RecoveryBindings} from './recovery-http.workers';

export interface Env extends RecoveryBindings {
  OPS_MASTER_KEY: string;
  /** One-shot bootstrap/recovery command injected as a runtime secret. */
  OPS_OPERATOR_SETUP?: string;
  OPS_DO: DurableObjectNamespace;
  /** Optional override of the served mint list, JSON array. */
  OPS_MINTS?: string;
  /** Optional R2 binding: set with the export cron to ship nightly escrow backups. */
  OPS_BACKUPS?: R2Bucket;
  /** Optional age recipient (public key) the nightly export encrypts to. */
  OPS_BACKUP_RECIPIENT?: string;
}

export class OpsStore extends DurableObject<Env> {
  private readonly deps: RouterDeps;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const master = new EnvMaster(() => env.OPS_MASTER_KEY);
    master.getMaster(); // fail fast at first touch, not on the first batch
    const db = new OpsDb({sql: openSqlStorage(ctx.storage), master});
    const passwordHasher = new SubtlePwHash();
    ctx.blockConcurrencyWhile(async () => {
      await applyOperatorSetup(db, env.OPS_OPERATOR_SETUP, passwordHasher);
    });
    this.deps = {
      db,
      passwordHasher,
      // The last-good header persists to the anchor_tip table and seeds the
      // feed at boot (the DO's constructor IS the boot).
      anchor: new AnchorFeed(httpTipFetcher, undefined, db.tipStore()),
      holderState: new HolderIssueState(),
      mints: env.OPS_MINTS ? JSON.parse(env.OPS_MINTS) : DEFAULT_MINTS,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const recovery = await recoveryHttp(this.deps.db, request, this.env);
    if (recovery) return recovery;
    if (
      new URL(request.url).pathname === '/ops/backup-status' &&
      request.method === 'GET'
    ) {
      const authorization = request.headers.get('authorization');
      const session = resolveSession(
        this.deps.db,
        authorization?.startsWith('Bearer ')
          ? authorization.slice(7).trim()
          : null,
      );
      if (!session) {
        return Response.json({reason: 'no-session'}, {status: 401});
      }
      const status = await this.ctx.storage.get<{
        last_success_at: number;
        key: string;
      }>('backup-status');
      const configured =
        !!this.env.OPS_BACKUPS && !!this.env.OPS_BACKUP_RECIPIENT;
      const stale =
        !status || Date.now() - status.last_success_at > 26 * 60 * 60 * 1000;
      return Response.json(
        {configured, stale, last_success: status ?? null},
        {status: configured && !stale ? 200 : 503},
      );
    }
    return handleOpsRequest(this.deps, request);
  }

  /**
   * The nightly escrow export (OPS-GOVERNANCE Q2's extract-and-leave story):
   * a Worker cron triggers the Worker, the Worker calls this method, and the
   * whole DB's escrow rows go to R2 age-encrypted to the operator's
   * recipient key. The export is a read; it never touches live state.
   */
  async exportEscrow(): Promise<{key: string; bytes: number}> {
    const bucket = this.env.OPS_BACKUPS;
    const recipient = this.env.OPS_BACKUP_RECIPIENT;
    if (!bucket || !recipient) {
      throw new Error('backup configuration is incomplete');
    }
    const {exportEscrowSql} = await import('./export');
    const {armored, bytes} = await exportEscrowSql(this.deps.db.db, recipient);
    const key = `escrow/${new Date().toISOString()}-${crypto.randomUUID()}.age`;
    await bucket.put(key, armored);
    await this.ctx.storage.put('backup-status', {
      last_success_at: Date.now(),
      key,
    });
    return {key, bytes};
  }
}

/** The Worker-side entry: forward to the one DO, mapping errors to responses. */
export async function handleOpsRequest(
  deps: RouterDeps,
  request: Request,
): Promise<Response> {
  try {
    const {status, body} = await routeRequest(deps, request);
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(
        JSON.stringify({reason: e.code, message: e.message}),
        {
          status: e.status,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        },
      );
    }
    return new Response(JSON.stringify({reason: 'internal'}), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }
}
