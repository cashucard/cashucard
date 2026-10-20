/**
 * The Worker entry (the ENG-740 hosting amendment): every request forwards to
 * the one OpsStore Durable Object — the DO is the single writer the design
 * assumes — and the nightly cron drives the escrow export to R2. TLS and the
 * edge are the platform's; the loopback/reverse-proxy step of the droplet
 * recipe disappears here.
 */
import {OpsStore, type Env} from './do';

export {OpsStore};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.OPS_DO.idFromName('ops');
    const stub = env.OPS_DO.get(id);
    return stub.fetch(request);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    // The nightly export: the governance answer's extract-and-leave story.
    // Failures surface as the cron's failed invocation (alertable), and a
    // missed night is the export cadence's window — the runbook's number.
    const id = env.OPS_DO.idFromName('ops');
    // The typed stub: Rpc notifies the namespace of the class's methods.
    const stub = env.OPS_DO.get(
      id,
    ) as DurableObjectStub<Rpc.DurableObjectBranded> &
      Pick<OpsStore, 'exportEscrow'>;
    await stub.exportEscrow();
  },
} satisfies ExportedHandler<Env>;
