import {operatorAdminPage} from './operator-admin-page';
/**
 * Node HTTP adapter. The standalone entry configures its listener and database;
 * local callers retain loopback defaults. TLS terminates at the reverse proxy.
 */
import http from 'node:http';

import {AnchorFeed, httpTipFetcher} from './anchor';
import {EnvMaster} from './master';
import {OpsDb} from './db';
import {HolderIssueState} from './issue';
import {route, RouterDeps} from './router';
import {openSqliteFile} from './sqlite-file';
import {DEFAULT_MINTS} from './config';
import {independentBackupHealth} from './recovery-evidence';

export {DEFAULT_MINTS} from './config';

export interface ServeOptions {
  readonly port: number;
  readonly dbPath: string;
  readonly independentBackupIssuer?: string;
  readonly mints?: readonly string[];
  readonly host?: string;
  readonly db?: OpsDb;
  readonly operatorAdmins?: () => string | undefined;
}

export function serve(options: ServeOptions): http.Server {
  const db =
    options.db ??
    (() => {
      const master = new EnvMaster();
      master.getMaster();
      return new OpsDb({
        sql: openSqliteFile(options.dbPath),
        master,
        independentBackupIssuer:
          options.independentBackupIssuer ??
          process.env.OPS_INDEPENDENT_BACKUP_ISSUER,
      });
    })();
  const deps: RouterDeps = {
    db,
    operatorAdmins:
      options.operatorAdmins ?? (() => process.env.OPS_OPERATOR_ADMINS),
    // The last-good header persists to the anchor_tip table and seeds the
    // feed at boot: a restart keeps the header the 503 fallback answers with.
    anchor: new AnchorFeed(httpTipFetcher, undefined, db.tipStore()),
    holderState: new HolderIssueState(),
    mints: options.mints ?? DEFAULT_MINTS,
  };
  const server = http.createServer((req, res) => {
    if (
      req.method === 'GET' &&
      (req.url === '/healthz' || req.url === '/readyz')
    ) {
      let ready = false;
      try {
        db.db.prepare('SELECT 1').get();
        const control = db.db
          .prepare(
            'SELECT recovery_required FROM provisioning_control WHERE id = 1',
          )
          .get() as {recovery_required: number};
        ready =
          req.url === '/healthz' ||
          (control.recovery_required === 0 &&
            !!db.db
              .prepare('SELECT id FROM operators WHERE disabled = 0 LIMIT 1')
              .get() &&
            !(
              independentBackupHealth(db).required &&
              independentBackupHealth(db).stale
            ));
      } catch {
        /* Health responses expose no storage or account details. */
      }
      res.writeHead(ready ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({status: ready ? 'ok' : 'not-ready'}));
      return;
    }
    if (
      req.method === 'GET' &&
      (req.url === '/' || req.url === '/ops/operators')
    ) {
      const page = operatorAdminPage();
      res.writeHead(200, page.headers);
      res.end(page.html);
      return;
    }
    route(deps, req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, {'content-type': 'application/json'});
      }
      res.end(JSON.stringify({reason: 'internal'}));
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.once('close', () => db.close());
  server.once('error', () => db.close());
  server.listen(options.port, options.host ?? '127.0.0.1');
  return server;
}

if (require.main === module) {
  const port = Number(process.env.OPS_PORT ?? '8821');
  const dbPath = process.env.OPS_DB ?? 'data/ops.db';
  serve({port, dbPath});
  // eslint-disable-next-line no-console
  console.log(`ops service on 127.0.0.1:${port}, db ${dbPath}`);
}
