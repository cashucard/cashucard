/**
 * The transport adapter for the Workers side: a Web `Request` in, a
 * {status, body} out, driving the SAME route table the node:http server
 * drives. The route function's req/res surface is node:http's; this adapter
 * hands it a minimal IncomingMessage-shaped object (method, url, headers,
 * the body stream) and collects what the handlers send. No sockets opened —
 * the objects are plain structures.
 *
 * The one route whose answer is not JSON-shaped is none: every handler in
 * route() ends in sendJson, so the adapter's contract is exactly
 * {status, body-object}.
 */
import {IncomingMessage, ServerResponse} from 'node:http';

import {route, RouterDeps, HttpError} from './router';
import {sendJson} from './router';

export interface RouteAnswer {
  readonly status: number;
  readonly body: unknown;
}

export async function routeRequest(
  deps: RouterDeps,
  request: Request,
): Promise<RouteAnswer> {
  const url = new URL(request.url);
  const method = request.method;
  // Headers -> plain record without DOM's Headers typing (the Node tsconfig
  // has no DOM.iterable; the runtime object does carry entries()).
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const rawBody =
    method === 'GET' || method === 'HEAD' ? '' : await readLimitedBody(request);

  const answer = await collectAnswer(deps, {
    method,
    url: url.pathname + (url.search || ''),
    headers,
    rawBody,
  });
  return answer;
}

/** Bound memory before buffering; the Node router's limit is too late here. */
async function readLimitedBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1 << 20) {
        await reader.cancel();
        throw new HttpError(413, 'body-too-large', 'the body is over 1 MiB');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The minimal IncomingMessage shape route() reads. */
interface ReqLike {
  method: string;
  url: string;
  headers: Record<string, string>;
  [Symbol.asyncIterator](): AsyncIterator<Buffer>;
}

async function collectAnswer(
  deps: RouterDeps,
  spec: {
    method: string;
    url: string;
    headers: Record<string, string>;
    rawBody: string;
  },
): Promise<RouteAnswer> {
  const req = makeReq(spec);
  const {res, result} = makeRes();
  await route(
    deps,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  );
  return result();
}

function makeReq(spec: {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}): ReqLike {
  const body = Buffer.from(spec.rawBody, 'utf8');
  let sent = false;
  // route()'s readBody drives the EventEmitter surface (on('data') /
  // on('end') / on('error')); the async iterator is for anyone who iterates.
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const emit = (event: string, ...args: unknown[]) => {
    for (const fn of listeners[event] ?? []) {
      fn(...args);
    }
    listeners[event] = [];
  };
  const req = {
    method: spec.method,
    url: spec.url,
    headers: spec.headers,
    on(event: string, fn: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
      // 'data' registrations after construction: push the body through on
      // the next tick so the handler is always already attached.
      if (event === 'data') {
        queueMicrotask(() => {
          if (!sent) {
            sent = true;
            fn(body);
          }
          emit('end');
        });
      }
      return req;
    },
    destroy() {
      // nothing to tear down in the capture
    },
    [Symbol.asyncIterator]() {
      return (async function* () {
        if (!sent) {
          sent = true;
          yield body;
        }
      })();
    },
  };
  return req;
}

/** A ServerResponse capture: writeHead/end record instead of transmit. */
function makeRes(): {
  res: unknown;
  result: () => RouteAnswer;
} {
  let status = 200;
  let payload = '';
  let headersSent = false;
  const res = {
    writeHead(code: number) {
      status = code;
      headersSent = true;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (typeof chunk === 'string') {
        payload += chunk;
      } else if (chunk) {
        payload += Buffer.from(chunk).toString('utf8');
      }
    },
    get headersSent() {
      return headersSent;
    },
    destroy() {
      // nothing to tear down in the capture
    },
  };
  return {
    res,
    result: () => {
      let body: unknown = null;
      try {
        body = payload === '' ? null : JSON.parse(payload);
      } catch {
        body = {reason: 'internal', message: 'unparseable handler answer'};
      }
      return {status, body};
    },
  };
}

// re-exported so do.ts's import of sendJson resolves to the router's own
export {sendJson};
