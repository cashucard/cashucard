/**
 * The BTC tip the daily-limit clock anchors to (D20): mempool.space REST,
 * a 60 s cache, and the last-good header kept for an upstream failure — the
 * plan's decision 4. Shape-validated only (80 bytes, like cardctl's
 * HEADER_LEN check at cardctl.py:479-480); proof-of-work is NOT verified and
 * the threat model's row 10 says so.
 */
export const HEADER_LEN = 80;
export const CACHE_SECONDS = 60;
const MEMPOOL_TIP = 'https://mempool.space/api/blocks/tip/height';
const MEMPOOL_BLOCK = (height: number) =>
  `https://mempool.space/api/block-height/${height}`;

export interface TipHeader {
  readonly header: Buffer;
  readonly fetchedAt: number;
  readonly height: number;
}

/** The fetch, injectable so tests (and cardctl's offline suite) never touch a network. */
export type TipFetcher = (url: string) => Promise<Buffer>;

export const httpTipFetcher: TipFetcher = async url => {
  const res = await fetch(url, {signal: AbortSignal.timeout(10_000)});
  if (!res.ok) {
    throw new UpstreamError(`upstream answered ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

export class UpstreamError extends Error {}

export class AnchorFeed {
  private lastGood: TipHeader | null = null;
  private fetchedAt: number = 0;

  constructor(
    private readonly fetcher: TipFetcher = httpTipFetcher,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

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
    try {
      const heightBuf = await this.fetcher(MEMPOOL_TIP);
      const height = Number.parseInt(heightBuf.toString('ascii').trim(), 10);
      if (!Number.isInteger(height) || height <= 0) {
        throw new UpstreamError('upstream height is not a number');
      }
      const header = await this.fetcher(MEMPOOL_BLOCK(height));
      if (header.length !== HEADER_LEN) {
        throw new UpstreamError(
          `tip header is ${header.length} bytes, not ${HEADER_LEN}`,
        );
      }
      const tip: TipHeader = {header, fetchedAt: now, height};
      this.lastGood = tip;
      this.fetchedAt = now;
      return {ok: true, tip};
    } catch (e) {
      if (e instanceof UpstreamError || e instanceof Error) {
        // fall through to last-good
      }
      return {ok: false, stale: this.lastGood};
    }
  }
}
