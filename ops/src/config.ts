/** Shared defaults without importing the Node server or native SQLite. */

/**
 * The mints the service offers when no OPS_MINTS override is set (D179).
 * Forge is first because fast-start preselects the first entry for a new
 * operator. Each entry is a mint base URL: `${url}/v1/info` must answer.
 */
export const DEFAULT_MINTS: readonly string[] = [
  'https://forge.flashapp.me',
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.macadamia.cash',
  'https://mint.cubabitcoin.org',
];

/**
 * Shape rules for the code-owned default list. OPS_MINTS keeps its own,
 * looser rules (standalone-config.ts): rejecting a trailing slash there would
 * break deployments that work today.
 */
export function validateDefaultMints(list: readonly string[]): void {
  if (list.length < 1 || list.length > 100)
    throw new Error('default mint list must have 1 to 100 entries');
  const seen = new Set<string>();
  for (const entry of list) {
    let u: URL;
    try {
      u = new URL(entry);
    } catch {
      throw new Error(`default mint is not a URL: ${entry}`);
    }
    if (u.protocol !== 'https:')
      throw new Error(`default mint is not https: ${entry}`);
    if (u.username || u.password || u.search || u.hash)
      throw new Error(`default mint has userinfo, query or hash: ${entry}`);
    if (entry.endsWith('/'))
      throw new Error(`default mint has a trailing slash: ${entry}`);
    if (seen.has(entry))
      throw new Error(`default mint is duplicated: ${entry}`);
    seen.add(entry);
  }
}

// A bad edit to DEFAULT_MINTS fails every test run and every boot.
validateDefaultMints(DEFAULT_MINTS);

export type FetchFn = (
  input: string,
  init?: {signal?: AbortSignal; redirect?: 'manual'},
) => Promise<{
  status: number;
  text(): Promise<string>;
  /** Present on a real Response; cancelled so a non-200 frees its slot. */
  body?: {cancel(): Promise<void>} | null;
}>;

/** Calls the global fetch at call time (a detached `fetch` throws in workerd). */
const globalFetch: FetchFn = (input, init) =>
  fetch(input, init) as unknown as ReturnType<FetchFn>;

export interface MintProbe {
  readonly url: string;
  readonly ok: boolean;
  /** A status code or an error name; never a response body. */
  readonly reason?: string;
}

async function getJson(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<{ok: true; body: unknown} | {ok: false; reason: string}> {
  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    if (res.status !== 200) {
      // An unread body holds one of workerd's 6 outbound connection slots
      // until the runtime cancels it, which can starve the other probes.
      await (res.body ? res.body.cancel() : res.text()).catch(() => {});
      return {ok: false, reason: `http ${res.status}`};
    }
    const text = await res.text();
    try {
      return {ok: true, body: JSON.parse(text)};
    } catch {
      return {ok: false, reason: 'not json'};
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error && e.name ? e.name : 'fetch failed',
    };
  }
}

/**
 * Probe one mint: `/v1/info` must be a JSON object and `/v1/keysets` must
 * carry a non-empty `keysets` array (NUT-02), both as a plain 200. Redirects
 * are not followed, so a 301 to a dead host fails. Never throws.
 */
export async function probeMint(
  url: string,
  fetchFn: FetchFn = globalFetch,
  timeoutMs = 5000,
): Promise<MintProbe> {
  const [info, keysets] = await Promise.all([
    getJson(fetchFn, `${url}/v1/info`, timeoutMs),
    getJson(fetchFn, `${url}/v1/keysets`, timeoutMs),
  ]);
  if (!info.ok) return {url, ok: false, reason: `info: ${info.reason}`};
  if (
    typeof info.body !== 'object' ||
    info.body === null ||
    Array.isArray(info.body)
  )
    return {url, ok: false, reason: 'info: not an object'};
  if (!keysets.ok)
    return {url, ok: false, reason: `keysets: ${keysets.reason}`};
  const list = (keysets.body as {keysets?: unknown} | null)?.keysets;
  if (!Array.isArray(list) || list.length === 0)
    return {url, ok: false, reason: 'keysets: empty'};
  return {url, ok: true};
}

export interface MintListOptions {
  readonly fetchFn?: FetchFn;
  readonly now?: () => number;
  readonly log?: (...args: unknown[]) => void;
  readonly ttlOkMs?: number;
  readonly ttlFailMs?: number;
  readonly timeoutMs?: number;
}

/**
 * The served default list: probed lazily on first use, coalesced across
 * concurrent callers, cached for ttlOkMs while at least one mint answers.
 * When every mint fails, the last-good list is served (or [] if there never
 * was one) and the probe is retried after ttlFailMs. No I/O until called.
 */
export function createMintList(
  defaults: readonly string[],
  options: MintListOptions = {},
): () => Promise<readonly string[]> {
  const fetchFn = options.fetchFn ?? globalFetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? console.warn;
  const ttlOkMs = options.ttlOkMs ?? 600_000;
  const ttlFailMs = options.ttlFailMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 5000;
  let lastGood: readonly string[] | undefined;
  let cached: {list: readonly string[]; until: number} | undefined;
  let inFlight: Promise<readonly string[]> | undefined;

  async function run(): Promise<readonly string[]> {
    const settled = await Promise.allSettled(
      defaults.map(url => probeMint(url, fetchFn, timeoutMs)),
    );
    const survivors: string[] = [];
    settled.forEach((r, i) => {
      const url = defaults[i];
      if (r.status === 'fulfilled' && r.value.ok) survivors.push(url);
      else
        log(
          'mint dropped',
          url,
          r.status === 'fulfilled' ? r.value.reason : 'probe threw',
        );
    });
    if (survivors.length > 0) {
      lastGood = survivors;
      cached = {list: survivors, until: now() + ttlOkMs};
      return survivors;
    }
    const fallback = lastGood ?? [];
    log(
      'all default mints failed probe',
      lastGood ? 'serving last-good list' : 'serving an empty list',
    );
    cached = {list: fallback, until: now() + ttlFailMs};
    return fallback;
  }

  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.list);
    if (!inFlight)
      inFlight = run().finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
