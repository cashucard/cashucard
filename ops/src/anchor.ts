/**
 * The BTC tip the daily-limit clock anchors to (D20): mempool.space and Blockstream Esplora,
 * a 60 s cache, and the last-good header kept for an upstream failure — the
 * plan's decision 4. The 80-byte header must hash to the block ID returned
 * for its height. The upstream is trusted to select the canonical chain.
 *
 * The last-good header persists to the `anchor_tip` table (one row, id = 1)
 * and is seeded from it at boot, so a restart does not silently lose the
 * header the 503 fallback promises. The store is injectable; without one the
 * feed behaves exactly as before, in memory only.
 */
import {createHash} from 'node:crypto';

export const HEADER_LEN = 80;
export const CACHE_SECONDS = 60;
const ESPLORA_ORIGINS = [
  'https://mempool.space/api',
  'https://blockstream.info/api',
];
// Each provider gets one deadline across all three reads, within cardctl's 15 s budget.
const PROVIDER_TIMEOUT_MS = 5_000;

export interface TipHeader {
  readonly header: Buffer;
  readonly fetchedAt: number;
  readonly height: number;
}

/** The fetch, injectable so tests (and cardctl's offline suite) never touch a network. */
export type TipFetcher = (url: string, signal?: AbortSignal) => Promise<Buffer>;

/** The last-good header's store; the ops DB's anchor_tip table in production. */
export interface TipStore {
  read(): {header: Buffer; height: number; fetchedAt: number} | undefined;
  write(tip: {header: Buffer; height: number; fetchedAt: number}): void;
}

export const httpTipFetcher: TipFetcher = async (url, signal) => {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new UpstreamError(`upstream answered ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

export class UpstreamError extends Error {}

async function readProviderTip(
  origin: string,
  fetcher: TipFetcher,
  fetchedAt: number,
): Promise<TipHeader> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const heightText = (await fetcher(`${origin}/blocks/tip/height`, signal))
    .toString('utf8')
    .trim();
  const height = Number(heightText);
  if (!/^[1-9][0-9]*$/.test(heightText) || !Number.isSafeInteger(height)) {
    throw new UpstreamError('invalid tip height');
  }
  const blockId = (await fetcher(`${origin}/block-height/${height}`, signal))
    .toString('utf8')
    .trim();
  if (!/^[0-9a-f]{64}$/i.test(blockId)) {
    throw new UpstreamError('invalid block ID');
  }
  const headerHex = (await fetcher(`${origin}/block/${blockId}/header`, signal))
    .toString('utf8')
    .trim();
  if (headerHex.length !== HEADER_LEN * 2 || !/^[0-9a-f]+$/i.test(headerHex)) {
    throw new UpstreamError('invalid block header');
  }
  const header = Buffer.from(headerHex, 'hex');
  const firstHash = createHash('sha256').update(header).digest();
  const headerId = createHash('sha256')
    .update(firstHash)
    .digest()
    .reverse()
    .toString('hex');
  if (headerId !== blockId.toLowerCase()) {
    throw new UpstreamError('block header and block ID disagree');
  }
  return {header, height, fetchedAt};
}

export class AnchorFeed {
  private lastGood: TipHeader | null = null;
  private fetchedAt: number = 0;

  constructor(
    private readonly fetcher: TipFetcher = httpTipFetcher,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly store?: TipStore,
  ) {
    // Seed from the persisted last-good: a restart keeps the header the 503
    // fallback answers with (finding: the table was dead schema before).
    const saved = this.store?.read();
    if (
      saved &&
      saved.header.length === HEADER_LEN &&
      Number.isInteger(saved.height) &&
      saved.height > 0
    ) {
      this.lastGood = {
        header: Buffer.from(saved.header),
        height: saved.height,
        fetchedAt: saved.fetchedAt,
      };
      this.fetchedAt = saved.fetchedAt;
    }
  }

  /**
   * The tip header: from cache within CACHE_SECONDS, from upstream otherwise.
   * Upstream failure answers the last-good header — the caller decides, via
   * `stale`, whether to surface it as a 503-shaped answer or serve it.
   */
  async tip(): Promise<
    {ok: true; tip: TipHeader} | {ok: false; stale: TipHeader | null}
  > {
    const now = this.now();
    if (this.lastGood && now - this.fetchedAt < CACHE_SECONDS) {
      return {ok: true, tip: this.lastGood};
    }
    for (const origin of ESPLORA_ORIGINS) {
      let tip: TipHeader;
      try {
        tip = await readProviderTip(origin, this.fetcher, now);
      } catch {
        continue;
      }
      this.lastGood = tip;
      this.fetchedAt = now;
      try {
        this.store?.write(tip);
      } catch {
        // A failed persistence write must not take the tip down; the
        // in-memory last-good still serves, and the next fetch rewrites.
      }
      return {ok: true, tip};
    }
    return {ok: false, stale: this.lastGood};
  }
}
