/** Separate nonproduction entry: reuse the service with a bounded route surface. */
import worker from './worker';
import type {Env} from './do';
import {stagingRouteAllowed} from './staging-routes';
export {OpsStore} from './do';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/') {
      return Response.json(
        {
          service: 'cashu-card-ops-staging',
          scope: 'nonproduction',
          readiness: 'edge-only',
        },
        {headers: {'cache-control': 'no-store'}},
      );
    }
    if (!stagingRouteAllowed(request.method, path)) {
      return Response.json(
        {reason: 'not-found'},
        {status: 404, headers: {'cache-control': 'no-store'}},
      );
    }
    return worker.fetch(request, env);
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
