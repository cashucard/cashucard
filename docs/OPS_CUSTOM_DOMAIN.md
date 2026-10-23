# Cashu Card console custom domain

Target: **https://ops.cashucard.org/**. The current workers.dev origin and
/ops/operators path continue to work. This is the same production Worker and
the same OpsStore; no database, key, credential or cron migration is needed.

## DNS and activation

1. Add `cashucard.org` as a zone in the existing Cloudflare account that owns
   `cashu-card-ops`. Review any imported DNS records before changing nameservers.
2. At Namecheap, select Custom DNS and enter the two nameservers assigned
   specifically to this Cloudflare zone. Keep domain registration at Namecheap.
   If DNSSEC is already enabled, follow Cloudflare's DNSSEC migration guidance
   before changing delegation; do not carry a stale DS record across.
3. Wait until Cloudflare reports the zone Active. Do not invent an A record or
   CNAME to the workers.dev hostname. Workers Custom Domains create their own
   DNS record and managed certificate. An existing CNAME at `ops` must be
   resolved before attaching the custom domain.
4. In `ops/wrangler.production.toml`, replace `routes = []` with:

   ```toml
   routes = [{ pattern = "ops.cashucard.org", custom_domain = true }]
   ```

   Keep `workers_dev = true`. Deploy that explicit production configuration.
   Do not remove other bindings, secrets or schedules. Keep this route in source
   control so subsequent deployments preserve it.
5. After certificate activation, verify `/` and `/ops/operators` return the
   console with no-store and restrictive CSP; `/admin/operators` denies
   anonymous access. Sign in through the new origin and verify the expected
   production workspace. Sessions remain memory-only and require a new sign-in
   in the new origin. The browser API calls are already same-origin.
6. Confirm the original workers.dev URL still works. Mobile builds, Atoll
   pairings and backup consumers retain their existing configured origin.
   Moving them to the new hostname requires a separate reviewed change.

Rollback: remove only the custom-domain route from this configuration and
redeploy; continue using workers.dev. Do not touch OpsStore or escrow data.

Reference: [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
