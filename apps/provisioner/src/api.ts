import type {
  ReservationService,
  RemoteBatch,
  ReservedAttempt,
} from './provisioningWorkflow';

/**
 * The one HTTP surface to the ops service (ENG-740): fetch with a timeout and
 * typed errors, so tests mock this module and nothing else. The outbox holds
 * registry rows whose POST failed: the body is frozen at first write and
 * re-posted byte-identical — a partial field change between retries must not
 * become a 409 the bench cannot resolve (api.test.ts pins the freeze).
 *
 * The bearer token is a 12 h secret held in memory only (the threat model's
 * confiscated-phone row assumes device loss of the token and nothing more);
 * no Keychain dependency in v1.
 */

export interface CardRegistryRow {
  readonly short_id: string;
  readonly batch_id: number;
  readonly key_id: number;
  readonly ordinal: number;
  readonly installed_at: number;
  readonly installer: string;
  readonly load_sha256: string;
}

export interface OperatorSession {
  readonly operator_id: number;
  readonly env: 'factory' | 'issued';
  readonly token: string;
}

/** The service's own reasons, surfaced verbatim (S1: never improvised). */
export class ApiServiceError extends Error {
  constructor(readonly reason: string, readonly status?: number) {
    super(reason);
    this.name = 'ApiServiceError';
  }
}

export class ApiUnreachableError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super('the record service cannot be reached');
    this.name = 'ApiUnreachableError';
    this.cause = cause;
  }
}

const TIMEOUT_MS = 10_000;

/** The transport, injectable so the tests never open a socket. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
}

export class ApiClient {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(readonly options: ApiClientOptions) {
    this.fetcher = options.fetcher ?? ((u, i) => fetch(u, i));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  private async call(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    // The documented timeout, actually applied: a hung ops socket must not
    // stall sign-in, nor one retry pass per pending row, past TIMEOUT_MS.
    // The abort races the fetcher — a fetcher that ignores the signal (or a
    // platform fetch that honors it late) still resolves the call.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const pending = this.fetcher(this.options.baseUrl + path, {
        method,
        headers: {
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      } as RequestInit);
      res = await new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(new Error('the request timed out'));
        controller.signal.addEventListener('abort', onAbort, {once: true});
        pending.then(
          v => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(v);
          },
          e => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(e);
          },
        );
      });
    } catch (e) {
      if (timedOut) {
        throw new ApiUnreachableError(
          new Error(`the request exceeded ${this.timeoutMs} ms`),
        );
      }
      throw new ApiUnreachableError(e);
    } finally {
      clearTimeout(timer);
    }
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new ApiServiceError(`HTTP ${res.status}`, res.status);
    }
    if (!res.ok) {
      const reason =
        typeof json.reason === 'string' ? json.reason : `HTTP ${res.status}`;
      throw new ApiServiceError(reason, res.status);
    }
    return json;
  }

  /** POST /auth/operator/session — the S1 call. */
  async operatorSession(
    name: string,
    password: string,
  ): Promise<OperatorSession> {
    const json = await this.call('POST', '/auth/operator/session', null, {
      name,
      password,
    });
    const env = json.env;
    if (env !== 'factory' && env !== 'issued') {
      throw new ApiServiceError('the service named no known key environment');
    }
    if (
      !Number.isSafeInteger(json.operator_id) ||
      (json.operator_id as number) <= 0 ||
      typeof json.token !== 'string' ||
      !json.token ||
      json.kind !== 'operator'
    ) {
      throw new ApiServiceError('the operator session is malformed');
    }
    return {operator_id: json.operator_id as number, env, token: json.token};
  }

  /** Session-bound reservation transport; credentials remain in memory. */
  reservations(session: OperatorSession): ReservationService {
    return {
      scope: {
        service_origin: this.options.baseUrl,
        operator_id: session.operator_id,
        key_env: session.env,
      },
      batch: async request =>
        (
          await this.call(
            'POST',
            '/provisioning/batches',
            session.token,
            request,
          )
        ).batch as unknown as RemoteBatch,
      reserve: async request =>
        (
          await this.call(
            'POST',
            '/provisioning/attempts',
            session.token,
            request,
          )
        ).attempt as unknown as ReservedAttempt,
      attempt: async (device_id, attempt_id) =>
        (
          await this.call(
            'GET',
            `/provisioning/attempts/${encodeURIComponent(
              attempt_id,
            )}?device_id=${encodeURIComponent(device_id)}`,
            session.token,
          )
        ).attempt as unknown as ReservedAttempt,
    };
  }

  /** GET /mints — the real-mode mint list. */
  async mints(token: string): Promise<string[]> {
    const json = await this.call('GET', '/mints', token);
    const mints = json.mints;
    if (!Array.isArray(mints) || !mints.every(m => typeof m === 'string')) {
      throw new ApiServiceError('the mint list is malformed');
    }
    return mints as string[];
  }

  /** POST /registry/cards — idempotent on the service; unreachable throws. */
  async postCard(token: string, row: CardRegistryRow): Promise<void> {
    await this.call('POST', '/registry/cards', token, row);
  }
}

/**
 * The registry outbox. Rows enter with `pending: true` when the POST fails
 * and are re-posted on interval and app-foreground until the service answers;
 * the body is frozen at first write.
 */
export class RegistryOutbox {
  private readonly rows: {row: CardRegistryRow; pending: boolean}[] = [];

  constructor(private readonly client: ApiClient) {}

  /** The row body is captured here, once; retries re-post exactly these bytes. */
  add(row: CardRegistryRow): void {
    this.rows.push({row: {...row}, pending: true});
  }

  get pendingRows(): readonly CardRegistryRow[] {
    return this.rows.filter(r => r.pending).map(r => r.row);
  }

  get all(): readonly {row: CardRegistryRow; pending: boolean}[] {
    return this.rows;
  }

  /**
   * One retry pass. Resolves when every row has been answered or exhausted
   * its pass; answered rows flip to `pending: false` in place. A 401 (the
   * 12 h token dead) aborts the pass with that error: no row can succeed
   * behind it, and the caller — the store's retry pass — signs out on it
   * instead of re-posting 401s forever.
   */
  async retryAll(
    token: string,
  ): Promise<{posted: number; stillPending: number}> {
    let posted = 0;
    for (const entry of this.rows) {
      if (!entry.pending) {
        continue;
      }
      try {
        // The frozen body: entry.row, never a re-read of live state.
        await this.client.postCard(token, entry.row);
        entry.pending = false;
        posted++;
      } catch (e) {
        if (e instanceof ApiServiceError && e.status === 401) {
          throw e;
        }
        if (e instanceof ApiServiceError && e.status === 409) {
          // A conflict cannot be resolved by the bench: keep it pending and
          // visible rather than dropping a programmed card's row.
          continue;
        }
        continue; // unreachable or 5xx: next pass
      }
    }
    return {
      posted,
      stillPending: this.rows.filter(r => r.pending).length,
    };
  }
}
