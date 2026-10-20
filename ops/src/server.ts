/**
 * The service entry: node:http on loopback, TLS at the reverse proxy (D29's
 * hosting decision). OPS_MASTER_KEY comes from the runtime-injected
 * environment — never a prompt, never shell history (AGENTS.md).
 */
import http from 'node:http';

import {AnchorFeed} from './anchor';
import {EnvMaster} from './master';
import {OpsDb} from './db';
import {HolderIssueState} from './issue';
import {route, RouterDeps} from './router';

export const DEFAULT_MINTS = [
  'https://forge.flashapp.me',
  'https://mint.minibits.cash',
  'https://mint.macadamia.cash',
  'https://mint.cubabitcoin.org',
];

export interface ServeOptions {
  readonly port: number;
  readonly dbPath: string;
  readonly mints?: readonly string[];
}

export function serve(options: ServeOptions): http.Server {
  const master = new EnvMaster();
  master.getMaster(); // fail fast at boot, not on the first batch
  const db = new OpsDb({path: options.dbPath, master});
  const deps: RouterDeps = {
    db,
    anchor: new AnchorFeed(),
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
