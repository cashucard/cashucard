import type {CleanupOptions} from './cardkit';

/** Public mint requests only. No credentials, redirects, retries or raw errors. */
export const mintSettlementJson: CleanupOptions['mintJson'] = async (
  origin,
  path,
  body,
) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<unknown>((resolve, reject) => {
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
    throw new Error(
      'Settlement could not be confirmed. Keep the card and retry after reconnecting.',
    );
  } finally {
    clearTimeout(timer);
  }
};
