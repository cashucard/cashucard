import {operatorAdminPage} from './operator-admin-page';
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
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {independentBackupHealth} from './recovery-evidence';

import {AnchorFeed, httpTipFetcher} from './anchor';
import {EnvMaster} from './master';
import {OpsDb} from './db';
import {HolderIssueState} from './issue';
import {HttpError, RouterDeps} from './router';
import {routeRequest} from './route-request';
import {openSqlStorage} from './sql-do';
import {createMintList, DEFAULT_MINTS} from './config';
import {
  createCatalog,
  createDiscovery,
  createRelayQuery,
  parseDenylist,
  STORAGE_KEY,
  type Discovery,
  type SocketConnect,
} from './discovery';
import {NativePwHash} from './pwhash';
import {applyOperatorSetup} from './operator-setup';
import {resolveSession} from './auth';
import {recoveryHttp, type RecoveryBindings} from './recovery-http.workers';

export interface Env extends RecoveryBindings {
  OPS_OPERATOR_ADMINS?: string;
  OPS_MASTER_KEY: string;
  /** Explicit opt-in; must match this deployment's recovery issuer UUID. */
  OPS_INDEPENDENT_BACKUP_ISSUER?: string;
  /** One-shot bootstrap/recovery command injected as a runtime secret. */
  OPS_OPERATOR_SETUP?: string;
  OPS_DO: DurableObjectNamespace;
  /** Optional override of the served mint list, JSON array. */
  OPS_MINTS?: string;
  /** NIP-87 mint discovery (D180): on unless "off"; ignored under OPS_MINTS. */
  OPS_MINT_DISCOVERY?: string;
  /** JSON array of mint URLs never offered as discovered (D180). */
  OPS_MINT_DENYLIST?: string;
  /** Optional R2 binding: set with the export cron to ship nightly escrow backups. */
  OPS_BACKUPS?: R2Bucket;
  /** Optional age recipient (public key) the nightly export encrypts to. */
  OPS_BACKUP_RECIPIENT?: string;
}

/**
 * workerd's outbound WebSocket: a fetch with `Upgrade: websocket` to the
 * relay's https URL, then accept() (D180). Throws when the relay refuses.
 */
export const workersSocketConnect: SocketConnect = async relay => {
  const res = await fetch(relay.replace(/^wss:/, 'https:'), {
    headers: {Upgrade: 'websocket'},
    signal: AbortSignal.timeout(5000),
  });
  const ws = res.webSocket;
  if (!ws) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`relay refused upgrade: ${res.status}`);
  }
  ws.accept();
  return ws as unknown as Awaited<ReturnType<SocketConnect>>;
};

/** The discovery wiring, or undefined when OPS_MINTS or the kill switch rules it out. */
function discoveryFor(
  env: Env,
  ctx: DurableObjectState,
): Discovery | undefined {
  if (env.OPS_MINTS || env.OPS_MINT_DISCOVERY === 'off') return undefined;
  let denylist: readonly string[];
  try {
    denylist = parseDenylist(env.OPS_MINT_DENYLIST);
  } catch {
    // A denylist that cannot be read must not let a pulled mint back in:
    // discovery stays off; the defaults are still served.
    console.warn('OPS_MINT_DENYLIST unreadable: mint discovery is off');
    return undefined;
  }
  return createDiscovery({
    query: createRelayQuery(workersSocketConnect),
    defaults: DEFAULT_MINTS,
    denylist,
    store: {
      load: () => ctx.storage.get(STORAGE_KEY),
      save: value => ctx.storage.put(STORAGE_KEY, value),
    },
    background: p => ctx.waitUntil(p),
  });
}

export class OpsStore extends DurableObject<Env> {
  private readonly deps: RouterDeps;
  private readonly discovery: Discovery | undefined;
  private readonly requestPolicy = new AsyncLocalStorage<{
    issuer: string | undefined;
    recoveryAdmins: string | undefined;
    operatorAdmins: string | undefined;
  }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const master = new EnvMaster(() => env.OPS_MASTER_KEY);
    master.getMaster(); // fail fast at first touch, not on the first batch
    const db = new OpsDb({
      sql: openSqlStorage(ctx.storage),
      master,
      independentBackupIssuerSource: () => this.backupPolicyIssuer(),
    });
    const passwordHasher = new NativePwHash();
    ctx.blockConcurrencyWhile(async () => {
      await applyOperatorSetup(db, env.OPS_OPERATOR_SETUP, passwordHasher);
    });
    // Discovery does no I/O here: the stored set loads and the relays are
    // asked on the first GET /mints, in the background (D180).
    this.discovery = discoveryFor(env, ctx);
    const defaults = env.OPS_MINTS ? undefined : createMintList(DEFAULT_MINTS);
    const catalog =
      defaults && this.discovery
        ? createCatalog(defaults, this.discovery)
        : undefined;
    this.deps = {
      db,
      passwordHasher,
      operatorAdmins: () =>
        this.requestPolicy.getStore()
          ? this.requestPolicy.getStore()!.operatorAdmins
          : this.env.OPS_OPERATOR_ADMINS,
      // The last-good header persists to the anchor_tip table and seeds the
      // feed at boot (the DO's constructor IS the boot).
      anchor: new AnchorFeed(httpTipFetcher, undefined, db.tipStore()),
      holderState: new HolderIssueState(),
      mints: env.OPS_MINTS ? JSON.parse(env.OPS_MINTS) : DEFAULT_MINTS,
      // The defaults are probed lazily on the first GET /mints, never here
      // or in blockConcurrencyWhile: a slow mint would stall every request.
      // An OPS_MINTS override is authoritative and served unprobed.
      availableMints: catalog ? catalog.availableMints : defaults,
      mintInfo: catalog?.mintInfo,
    };
  }

  /** Refreshes the discovered mint set now (the cron fallback path, D180). */
  async refreshMintDiscovery(): Promise<void> {
    await this.discovery?.refresh();
  }

  private backupPolicyIssuer(): string | undefined {
    const context = this.requestPolicy.getStore();
    const issuer = context
      ? context.issuer
      : this.env.OPS_INDEPENDENT_BACKUP_ISSUER;
    if (issuer !== undefined && issuer !== this.env.OPS_RECOVERY_ISSUER_ID)
      throw new Error(
        'independent backup issuer does not match recovery issuer',
      );
    return issuer;
  }

  /** Private capability RPC: policy comes from the edge binding, never HTTP data. */
  async dispatch(
    request: Request,
    requiredIssuer: string | null,
    recoveryAdmins?: string,
    operatorAdmins?: string,
  ): Promise<Response> {
    if (
      requiredIssuer !== null &&
      requiredIssuer !== this.env.OPS_RECOVERY_ISSUER_ID
    )
      throw new Error(
        'independent backup issuer does not match recovery issuer',
      );
    return this.requestPolicy.run(
      {issuer: requiredIssuer ?? undefined, recoveryAdmins, operatorAdmins},
      () => this.fetch(request),
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (
      request.method === 'GET' &&
      ['/', '/ops/operators'].includes(new URL(request.url).pathname)
    ) {
      const page = operatorAdminPage();
      return new Response(page.html, {headers: page.headers});
    }
    const context = this.requestPolicy.getStore();
    const recovery = await recoveryHttp(this.deps.db, request, {
      OPS_BACKUPS: this.env.OPS_BACKUPS,
      OPS_BACKUP_RECIPIENT: this.env.OPS_BACKUP_RECIPIENT,
      OPS_RECOVERY_ISSUER_ID: this.env.OPS_RECOVERY_ISSUER_ID,
      OPS_RECOVERY_ADMINS: context
        ? context.recoveryAdmins
        : this.env.OPS_RECOVERY_ADMINS,
    });
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
      const independent_copy = independentBackupHealth(
        this.deps.db,
        this.env.OPS_RECOVERY_ISSUER_ID,
      );
      return Response.json(
        {configured, stale, last_success: status ?? null, independent_copy},
        {
          status:
            configured &&
            !stale &&
            !(independent_copy.required && independent_copy.stale)
              ? 200
              : 503,
        },
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
    const {armored, bytes, exported_at} = await exportEscrowSql(
      this.deps.db.db,
      recipient,
    );
    const key = `escrow/${new Date().toISOString()}-${crypto.randomUUID()}.age`;
    await bucket
      .put(key, armored, {
        // Store source metadata with the ciphertext in the same R2 write. Copy
        // time and the object filename are not the database snapshot time.
        customMetadata: {
          version: '1',
          issuer_id: this.env.OPS_RECOVERY_ISSUER_ID ?? '',
          exported_at: String(exported_at),
          ciphertext_sha256: createHash('sha256').update(armored).digest('hex'),
          ciphertext_bytes: String(new TextEncoder().encode(armored).length),
        },
        onlyIf: {etagDoesNotMatch: '*'},
      })
      .then(object => {
        if (!object) throw new Error('backup object already exists');
      });
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
