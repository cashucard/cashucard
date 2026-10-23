import type {CleanupOptions} from './cardkit';
export class MintSettlementError extends Error {
  constructor() {
    super(
      'Settlement could not be confirmed. Keep the card and retry after reconnecting.',
    );
  }
}

/** Public mint requests only. No credentials, redirects, retries or raw errors. */
export const mintSettlementJson = async (
  origin: string,
  path: string,
  body?: Parameters<CleanupOptions['mintJson']>[2],
  signal?: AbortSignal,
): Promise<unknown> => {
  if (signal?.aborted) {
    throw new MintSettlementError();
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  try {
    return await new Promise<unknown>((resolve, reject) => {
      stop = () => reject(new Error('cancelled'));
      controller.signal.addEventListener('abort', stop, {once: true});
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, 15000);
      const request = async () => {
        const url = origin + path;
        const r = await fetch(url, {
          method: body ? 'POST' : 'GET',
          redirect: 'error',
          signal: controller.signal,
          credentials: 'omit',
          headers: {'Content-Type': 'application/json'},
          ...(body ? {body: JSON.stringify(body)} : {}),
        });
        if (
          !r.ok ||
          r.redirected ||
          (r.url && r.url !== url) ||
          Number(r.headers?.get('content-length')) > 65536
        ) {
          throw new Error('mint response');
        }
        const raw = await r.text();
        if (raw.length > 65536) {
          throw new Error('mint response');
        }
        return JSON.parse(raw) as unknown;
      };
      request().then(resolve, reject);
    });
  } catch {
    throw new MintSettlementError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (stop) {
      controller.signal.removeEventListener('abort', stop);
    }
  }
};
