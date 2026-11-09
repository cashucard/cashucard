/**
 * NIP-87 mint discovery behind GET /mints (ENG-832, D180), the way cashu.me
 * finds mints: kind 38172 mint announcements and kind 38000 reviews
 * (`#k=38172`) from three public relays, grouped by mint URL. A discovered
 * mint is offered only with a verified announcement and at least
 * MIN_REVIEWERS distinct verified reviewers, and only after it passes the
 * same probe as the defaults (config.ts probeMint, active sat keyset).
 *
 * Nothing here runs at construction, and a request never waits on a relay:
 * ready() loads the stored set once, snapshot() returns the last-good set
 * synchronously and, once that set is past its TTL, starts one background
 * refresh.
 */
import {schnorr} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha2';
import {bytesToHex} from '@noble/hashes/utils';

import {
  normalizeMintUrl,
  probeMint,
  sanitizeMintName,
  type MintProbe,
} from './config';

/** The relays cashu.me reads (cashubtc/cashu.me mintRecommendations.ts). */
export const DISCOVERY_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];
export const MIN_REVIEWERS = 3;
export const MAX_CANDIDATES = 15;
export const MAX_DISCOVERED = 10;
export const DISCOVERY_TTL_OK_MS = 3_600_000;
export const DISCOVERY_TTL_FAIL_MS = 60_000;
export const PROBE_POOL = 3;
export const STORAGE_KEY = 'mint-discovery';

const MINT_ANNOUNCEMENT = 38172;
const RECOMMENDATION = 38000;
const FUTURE_SLACK_S = 600;
const REVIEW_MAX_AGE_S = 730 * 86_400; // 24 months
const MAX_URL_TAGS = 5;
const MAX_URLS = 2000;
const MAX_FRAME = 256 * 1024;
const MAX_EVENTS_PER_RELAY = 2000;
/** Retained event JSON per relay; the DO has 128 MB for everything. */
const MAX_BYTES_PER_RELAY = 2 * 1024 * 1024;
/** A NIP-87 event is small; a bigger one is dropped before it is kept. */
const MAX_CONTENT = 4096;
const MAX_TAGS = 64;
const RELAY_TIMEOUT_MS = 6000;
const RELAY_DEADLINE_MS = 8000;

export interface NostrEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

function isEventShape(ev: unknown): ev is NostrEvent {
  if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) return false;
  const e = ev as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    HEX64.test(e.id) &&
    typeof e.pubkey === 'string' &&
    HEX64.test(e.pubkey) &&
    typeof e.sig === 'string' &&
    HEX128.test(e.sig) &&
    Number.isSafeInteger(e.created_at) &&
    Number.isSafeInteger(e.kind) &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every(t => Array.isArray(t) && t.every(v => typeof v === 'string'))
  );
}

/** NIP-01: sha256 of the canonical array, as hex. */
function computeId(ev: NostrEvent): string {
  const canonical = JSON.stringify([
    0,
    ev.pubkey,
    ev.created_at,
    ev.kind,
    ev.tags,
    ev.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

/** NIP-01: the id is sha256 of the canonical array; the sig is BIP-340. Never throws. */
export function verifyEvent(ev: unknown): ev is NostrEvent {
  try {
    if (!isEventShape(ev)) return false;
    if (computeId(ev) !== ev.id) return false;
    return schnorr.verify(ev.sig, ev.id, ev.pubkey);
  } catch {
    return false;
  }
}

export interface MintEvidence {
  announced: boolean;
  readonly reviewers: Set<string>;
}

function tagValues(ev: NostrEvent, name: string): string[] {
  return ev.tags.filter(t => t[0] === name && t.length > 1).map(t => t[1]);
}

/**
 * Group NIP-87 events by normalized mint URL. Pure apart from the signature
 * check. Cheap filters run before verification, so a malformed, stale or
 * off-topic event costs no curve work. A copy whose content does not hash
 * to its id is dropped before it can be remembered, and the rest are
 * deduplicated on id and sig together: the id fixes the content, so equal
 * keys are the same event and need one signature check, while one relay's
 * altered or bad-sig copy of an id never shadows the genuine copy another
 * relay returns.
 */
export function parseNip87(
  events: readonly unknown[],
  nowMs: number,
  verify: (ev: unknown) => ev is NostrEvent = verifyEvent,
): Map<string, MintEvidence> {
  const nowS = Math.floor(nowMs / 1000);
  const out = new Map<string, MintEvidence>();
  const seen = new Set<string>();
  for (const raw of events) {
    if (!isEventShape(raw)) continue;
    const ev = raw;
    const copy = `${ev.id}:${ev.sig}`;
    if (seen.has(copy)) continue;
    if (ev.created_at > nowS + FUTURE_SLACK_S) continue;
    let review: boolean;
    if (ev.kind === MINT_ANNOUNCEMENT) {
      if (tagValues(ev, 'n').some(n => n !== 'mainnet')) continue;
      review = false;
    } else if (ev.kind === RECOMMENDATION) {
      if (!tagValues(ev, 'k').includes(String(MINT_ANNOUNCEMENT))) continue;
      if (ev.created_at < nowS - REVIEW_MAX_AGE_S) continue;
      review = true;
    } else continue;
    const urls = new Set<string>();
    for (const u of tagValues(ev, 'u').slice(0, MAX_URL_TAGS)) {
      const n = normalizeMintUrl(u);
      if (n) urls.add(n);
    }
    if (urls.size === 0) continue;
    try {
      if (computeId(ev) !== ev.id) continue;
    } catch {
      continue;
    }
    seen.add(copy);
    if (!verify(ev)) continue;
    for (const url of urls) {
      let entry = out.get(url);
      if (!entry) {
        if (out.size >= MAX_URLS) continue;
        entry = {announced: false, reviewers: new Set()};
        out.set(url, entry);
      }
      if (review) entry.reviewers.add(ev.pubkey);
      else entry.announced = true;
    }
  }
  return out;
}

// ── relay transport ──────────────────────────────────────────────────────

/** The part of a WebSocket the query uses (DOM, Node 22 and workerd alike). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', fn: (e: {data: unknown}) => void): void;
  addEventListener(type: 'close' | 'error', fn: () => void): void;
}

/** Opens an already-connected socket, or throws. */
export type SocketConnect = (relay: string) => Promise<SocketLike>;

export interface RelayAnswer {
  /** True when the relay sent EOSE, CLOSED or at least one event. */
  readonly answered: boolean;
  readonly events: readonly unknown[];
}

/** Queries one relay for the NIP-87 events. Never throws. */
export type RelayQuery = (relay: string) => Promise<RelayAnswer>;

export const NIP87_FILTERS = [
  {kinds: [MINT_ANNOUNCEMENT], limit: 500},
  {kinds: [RECOMMENDATION], '#k': [String(MINT_ANNOUNCEMENT)], limit: 500},
] as const;

/** Node 22+ and browsers: the global WebSocket, resolved once open. */
export const globalSocketConnect: SocketConnect = relay =>
  new Promise((resolve, reject) => {
    const Ctor = (
      globalThis as unknown as {
        WebSocket?: new (url: string) => SocketLike & {
          addEventListener(type: 'open', fn: () => void): void;
        };
      }
    ).WebSocket;
    if (!Ctor) {
      reject(new Error('no WebSocket'));
      return;
    }
    const ws = new Ctor(relay);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('socket error')));
    ws.addEventListener('close', () => reject(new Error('socket closed')));
  });

export function createRelayQuery(
  connect: SocketConnect = globalSocketConnect,
  timeoutMs = RELAY_TIMEOUT_MS,
): RelayQuery {
  return relay =>
    new Promise<RelayAnswer>(resolve => {
      const subId = `nip87-${Math.random().toString(36).slice(2, 10)}`;
      const events: unknown[] = [];
      let bytes = 0;
      let answered = false;
      let done = false;
      let socket: SocketLike | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (socket) {
          try {
            socket.send(JSON.stringify(['CLOSE', subId]));
          } catch {
            /* the socket may already be gone */
          }
          try {
            socket.close(1000, 'done');
          } catch {
            /* ignore */
          }
        }
        resolve({answered: answered || events.length > 0, events});
      };
      const timer = setTimeout(finish, timeoutMs);
      connect(relay).then(
        ws => {
          socket = ws;
          if (done) {
            finish(); // too late; close what opened
            try {
              ws.close(1000, 'done');
            } catch {
              /* ignore */
            }
            return;
          }
          ws.addEventListener('message', e => {
            if (done) return;
            if (typeof e.data !== 'string' || e.data.length > MAX_FRAME) return;
            // Every frame counts, kept or not: a flood ends the query early.
            bytes += e.data.length;
            if (bytes > MAX_BYTES_PER_RELAY) {
              finish();
              return;
            }
            let msg: unknown;
            try {
              msg = JSON.parse(e.data);
            } catch {
              return;
            }
            if (!Array.isArray(msg) || msg[1] !== subId) return;
            if (msg[0] === 'EVENT') {
              const ev = msg[2] as {content?: unknown; tags?: unknown} | null;
              if (
                typeof ev !== 'object' ||
                ev === null ||
                typeof ev.content !== 'string' ||
                ev.content.length > MAX_CONTENT ||
                !Array.isArray(ev.tags) ||
                ev.tags.length > MAX_TAGS
              )
                return;
              events.push(ev);
              if (events.length >= MAX_EVENTS_PER_RELAY) finish();
            } else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') {
              answered = true;
              finish();
            }
          });
          ws.addEventListener('close', finish);
          ws.addEventListener('error', finish);
          try {
            ws.send(JSON.stringify(['REQ', subId, ...NIP87_FILTERS]));
          } catch {
            finish();
          }
        },
        () => finish(),
      );
    });
}

// ── discovery ────────────────────────────────────────────────────────────

export interface DiscoveredMint {
  readonly url: string;
  readonly reviews: number;
  readonly name?: string;
}

export interface DiscoveryDeps {
  readonly query: RelayQuery;
  readonly relays?: readonly string[];
  /** Normalized URLs never offered as discovered (the defaults). */
  readonly defaults: readonly string[];
  readonly denylist?: readonly string[];
  readonly probe?: (url: string) => Promise<MintProbe>;
  readonly now?: () => number;
  readonly log?: (...args: unknown[]) => void;
}

export interface DiscoveryResult {
  /** False when no relay answered: the caller keeps its old set. */
  readonly answered: boolean;
  readonly mints: readonly DiscoveredMint[];
}

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalizedSet(list: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of list ?? []) {
    const n = normalizeMintUrl(raw);
    if (n) out.add(n);
  }
  return out;
}

/** The single refresh path. Never throws. */
export async function discoverMints(
  deps: DiscoveryDeps,
): Promise<DiscoveryResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.warn;
  const probe = deps.probe ?? ((url: string) => probeMint(url));
  const relays = deps.relays ?? DISCOVERY_RELAYS;

  // Relays first, then probes: never more than workerd's 6 connections.
  const answers = await withDeadline(
    Promise.allSettled(relays.map(r => deps.query(r))),
    RELAY_DEADLINE_MS,
    [] as PromiseSettledResult<RelayAnswer>[],
  );
  const events: unknown[] = [];
  let answered = false;
  answers.forEach((a, i) => {
    if (a.status === 'fulfilled' && a.value.answered) {
      answered = true;
      events.push(...a.value.events);
    } else log('mint discovery: relay did not answer', relays[i]);
  });
  if (!answered) return {answered: false, mints: []};

  const excluded = normalizedSet(deps.defaults);
  const denied = normalizedSet(deps.denylist);
  const ranked = [...parseNip87(events, now())]
    .filter(
      ([url, e]) =>
        e.announced &&
        e.reviewers.size >= MIN_REVIEWERS &&
        !excluded.has(url) &&
        !denied.has(url),
    )
    .map(([url, e]) => ({url, reviews: e.reviewers.size}))
    .sort((a, b) =>
      b.reviews !== a.reviews
        ? b.reviews - a.reviews
        : a.url < b.url
          ? -1
          : a.url > b.url
            ? 1
            : 0,
    )
    .slice(0, MAX_CANDIDATES);

  const results: (MintProbe | undefined)[] = new Array(ranked.length);
  let next = 0;
  const worker = async () => {
    while (next < ranked.length) {
      const i = next++;
      try {
        results[i] = await probe(ranked[i].url);
      } catch {
        results[i] = {url: ranked[i].url, ok: false, reason: 'probe threw'};
      }
    }
  };
  await Promise.all(Array.from({length: PROBE_POOL}, worker));

  const mints: DiscoveredMint[] = [];
  ranked.forEach((c, i) => {
    const r = results[i];
    if (!r || !r.ok) {
      log('discovered mint dropped', c.url, r?.reason ?? 'not probed');
      return;
    }
    if (mints.length >= MAX_DISCOVERED) return;
    mints.push(r.name ? {...c, name: r.name} : c);
  });
  return {answered: true, mints};
}

// ── the cached set ───────────────────────────────────────────────────────

/** Durable storage for the last-good set (DO KV in Workers; none in Node). */
export interface DiscoveryStore {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

interface Stored {
  readonly v: 1;
  readonly at: number;
  readonly mints: readonly DiscoveredMint[];
}

/** Re-validates a stored snapshot; anything unexpected is discarded. */
export function parseStored(raw: unknown): Stored | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const s = raw as {v?: unknown; at?: unknown; mints?: unknown};
  if (s.v !== 1 || !Number.isSafeInteger(s.at) || !Array.isArray(s.mints))
    return undefined;
  const mints: DiscoveredMint[] = [];
  for (const m of s.mints.slice(0, MAX_DISCOVERED)) {
    if (typeof m !== 'object' || m === null) return undefined;
    const {url, reviews, name} = m as Record<string, unknown>;
    if (typeof url !== 'string' || normalizeMintUrl(url) !== url)
      return undefined;
    if (!Number.isSafeInteger(reviews) || (reviews as number) < 0)
      return undefined;
    const clean = sanitizeMintName(name);
    if (name !== undefined && clean !== name) return undefined;
    mints.push(
      clean
        ? {url, reviews: reviews as number, name: clean}
        : {url, reviews: reviews as number},
    );
  }
  return {v: 1, at: s.at as number, mints};
}

export interface DiscoveryOptions extends DiscoveryDeps {
  readonly store?: DiscoveryStore;
  readonly ttlOkMs?: number;
  readonly ttlFailMs?: number;
  /** Hands a background refresh to the runtime (ctx.waitUntil). */
  readonly background?: (p: Promise<unknown>) => void;
}

export interface Discovery {
  /** The last-good set, now; starts a coalesced refresh when stale. */
  snapshot(): readonly DiscoveredMint[];
  /**
   * Resolves once the stored set is loaded (DO storage only, never a
   * relay), so the first snapshot() after a restart serves it.
   */
  ready(): Promise<void>;
  /** Runs a refresh now (the cron path and tests). Never throws. */
  refresh(): Promise<void>;
}

export function createDiscovery(options: DiscoveryOptions): Discovery {
  const now = options.now ?? Date.now;
  const log = options.log ?? console.warn;
  const ttlOkMs = options.ttlOkMs ?? DISCOVERY_TTL_OK_MS;
  const ttlFailMs = options.ttlFailMs ?? DISCOVERY_TTL_FAIL_MS;
  let mints: readonly DiscoveredMint[] = [];
  let until = 0;
  let loaded = !options.store;
  let started = 0;
  let committed = 0;
  let committedAt = 0;
  let inFlight: Promise<void> | undefined;

  let loading: Promise<void> | undefined;
  function load(): Promise<void> {
    if (loaded) return Promise.resolve();
    return (loading ??= readStore().finally(() => {
      loaded = true;
    }));
  }

  async function readStore(): Promise<void> {
    try {
      const stored = parseStored(await options.store!.load());
      if (stored && stored.at > committedAt) {
        mints = stored.mints;
        committedAt = stored.at;
        until = stored.at + ttlOkMs;
      }
    } catch (e) {
      log('mint discovery: stored set unreadable', (e as Error)?.name);
    }
  }

  async function run(): Promise<void> {
    const gen = ++started;
    try {
      const result = await discoverMints({...options, log, now});
      if (!result.answered) {
        // A failure never supersedes: an older refresh that still answers
        // may land after this one.
        if (gen >= committed) until = now() + ttlFailMs;
        return;
      }
      if (gen < committed) return; // a newer answer already landed
      committed = gen;
      const at = now();
      mints = result.mints;
      committedAt = at;
      until = at + ttlOkMs;
      if (options.store)
        await options.store
          .save({v: 1, at, mints: result.mints} satisfies Stored)
          .catch(e => log('mint discovery: store failed', (e as Error)?.name));
    } catch (e) {
      if (gen >= committed) until = now() + ttlFailMs;
      log('mint discovery failed', (e as Error)?.name);
    }
  }

  function kick(): Promise<void> {
    if (!inFlight)
      inFlight = (async () => {
        await load();
        if (now() < until) return; // the stored set is still fresh
        await run();
      })().finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    snapshot() {
      if (now() >= until) {
        const wasIdle = !inFlight;
        const p = kick();
        if (wasIdle) options.background?.(p);
      }
      return mints;
    },
    ready: load,
    async refresh() {
      await load();
      await run();
    },
  };
}

export type MintInfo = Record<string, {name?: string; reviews: number}>;

/**
 * GET /mints's catalog: the probed defaults in D179 order, then the
 * discovered set minus anything already listed; mintInfo describes the
 * discovered entries only.
 */
export function createCatalog(
  mintList: () => Promise<readonly string[]>,
  discovery: Pick<Discovery, 'snapshot' | 'ready'>,
): {
  availableMints: () => Promise<readonly string[]>;
  mintInfo: () => MintInfo;
} {
  return {
    async availableMints() {
      // ready() reads DO storage, never a relay, so a restarted object
      // serves its stored set on the first request (D180).
      const [defaults] = await Promise.all([mintList(), discovery.ready()]);
      const listed = new Set(defaults);
      const extra = discovery
        .snapshot()
        .map(m => m.url)
        .filter(u => !listed.has(u));
      return [...defaults, ...extra];
    },
    mintInfo() {
      const info: MintInfo = {};
      for (const m of discovery.snapshot())
        info[m.url] = m.name
          ? {name: m.name, reviews: m.reviews}
          : {reviews: m.reviews};
      return info;
    },
  };
}

/** Parses OPS_MINT_DENYLIST: a JSON array of URL strings, or throws. */
export function parseDenylist(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const list: unknown = JSON.parse(raw);
  if (
    !Array.isArray(list) ||
    list.length > 500 ||
    !list.every(u => typeof u === 'string')
  )
    throw new Error('OPS_MINT_DENYLIST must be a JSON array of URL strings');
  return list as string[];
}
