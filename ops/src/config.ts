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
  /** Present on a real Response; read for content-length only. */
  headers?: {get(name: string): string | null};
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
  /** The mint's `/v1/info` name, sanitized (sanitizeMintName); untrusted. */
  readonly name?: string;
}

/** The longest mint name the service passes on (D180). */
export const MINT_NAME_MAX = 40;

/**
 * A mint's self-reported name is untrusted text: drop C0/C1 controls (which
 * include newlines), line and paragraph separators and the bidi embedding,
 * override and isolate controls, trim, and cut to MINT_NAME_MAX code points.
 * Returns undefined when nothing printable is left.
 */
export function sanitizeMintName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
      '',
    )
    .trim();
  const name = Array.from(cleaned).slice(0, MINT_NAME_MAX).join('').trim();
  return name === '' ? undefined : name;
}

async function getJson(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
  maxBytes = 65536,
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
    // A mint document is a few KB. A declared oversize body is refused
    // unread; an undeclared one is refused after the read.
    const declared = Number(res.headers?.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await (res.body ? res.body.cancel() : Promise.resolve()).catch(() => {});
      return {ok: false, reason: 'too large'};
    }
    const text = await res.text();
    if (text.length > maxBytes) return {ok: false, reason: 'too large'};
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
 * carry a non-empty `keysets` array (NUT-02) with at least one active sat
 * keyset (D180), both as a plain 200 of at most 64 KiB. Redirects are not
 * followed, so a 301 to a dead host fails. Never throws.
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
  const sat = list.some(
    k =>
      typeof k === 'object' &&
      k !== null &&
      (k as {unit?: unknown}).unit === 'sat' &&
      (k as {active?: unknown}).active !== false,
  );
  if (!sat) return {url, ok: false, reason: 'keysets: no active sat'};
  const name = sanitizeMintName((info.body as {name?: unknown}).name);
  return name === undefined ? {url, ok: true} : {url, ok: true, name};
}

const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.onion'];

/**
 * The one shape a discovered or written-in mint URL may take (D180): https,
 * at most 200 characters, no userinfo, query or fragment, port 443 or none,
 * a dotted DNS name that is not an IP literal (URL canonicalises decimal and
 * hex IPv4 forms, so they are caught too) or an internal name. The host is
 * lowercased and one trailing slash is dropped. Returns undefined otherwise.
 * Not a defence against DNS rebinding.
 */
export function normalizeMintUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200)
    return undefined;
  if (raw.includes('?') || raw.includes('#') || /\s/.test(raw))
    return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:') return undefined;
  if (u.username || u.password || u.search || u.hash) return undefined;
  if (u.port !== '') return undefined; // URL drops an explicit :443
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || host.startsWith('['))
    return undefined;
  if (/^[\d.]+$/.test(host)) return undefined;
  if (host === 'localhost' || INTERNAL_SUFFIXES.some(s => host.endsWith(s)))
    return undefined;
  let path = u.pathname;
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path.endsWith('/')) return undefined;
  const out = `https://${host}${path}`;
  return out.length > 200 ? undefined : out;
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
