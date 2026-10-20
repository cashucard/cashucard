/**
 * The Workers tests' env typing: `Cloudflare.Env` is what `cloudflare:test`'s
 * `env` and the DO base class read; this file merges the service's Env into
 * it (declaration merging, as workers-types' comment prescribes).
 */
import type {Env as OpsEnv} from '../../src/do';

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Env extends OpsEnv {}
  }
}

export {};
