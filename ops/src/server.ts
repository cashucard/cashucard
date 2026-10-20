/**
 * The service entry — the Node/dev side (D29): node:http on loopback, TLS at
 * the reverse proxy. The deployed shape is the Workers entry
 * (`worker.ts` + the Durable Object in `do.ts`, the ENG-740 hosting
 * amendment); this server and `bootstrap.ts` stay the ops-cli/dev path over
 * the same modules and the same DB seam. OPS_MASTER_KEY comes from the
 * runtime-injected environment — never a prompt, never shell history
 * (AGENTS.md).
 */
import http from 'node:http';

import {AnchorFeed, httpTipFetcher} from './anchor';
import {EnvMaster} from './master';
import {OpsDb} from './db';
import {HolderIssueState} from './issue';
import {route, RouterDeps} from './router';
import {openSqliteFile} from './sqlite-file';
import {DEFAULT_MINTS} from './config';

export {DEFAULT_MINTS} from './config';

export interface ServeOptions {
  readonly port: number;
  readonly dbPath: string;
  readonly mints?: readonly string[];
}

export function serve(options: ServeOptions): http.Server {
  const master = new EnvMaster();
  master.getMaster(); // fail fast at boot, not on the first batch
  const db = new OpsDb({sql: openSqliteFile(options.dbPath), master});
  const deps: RouterDeps = {
    db,
    // The last-good header persists to the anchor_tip table and seeds the
    // feed at boot: a restart keeps the header the 503 fallback answers with.
    anchor: new AnchorFeed(httpTipFetcher, undefined, db.tipStore()),
    holderState: new HolderIssueState(),
    mints: options.mints ?? DEFAULT_MINTS,
  };
  const server = http.createServer((req, res) => {
    route(deps, req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, {'content-type': 'application/json'});
      }
      res.end(JSON.stringify({reason: 'internal'}));
    });
  });
  server.listen(options.port, '127.0.0.1');
  return server;
}

if (require.main === module) {
  const port = Number(process.env.OPS_PORT ?? '8821');
  const dbPath = process.env.OPS_DB ?? 'data/ops.db';
  serve({port, dbPath});
  // eslint-disable-next-line no-console
  console.log(`ops service on 127.0.0.1:${port}, db ${dbPath}`);
}
