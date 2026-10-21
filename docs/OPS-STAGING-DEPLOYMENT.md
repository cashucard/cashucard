# First remote ops deployment: isolated staging

Prepared 2026-10-21. The Workers port and earlier Wrangler dry runs did not
create a public service. This plan prepares a staging rehearsal; it does not
claim deployment or authorize Cloudflare access by itself.

## Exact target and boundaries

- Configuration: `ops/wrangler.staging.toml`.
- Worker: `cashu-card-ops-staging`, Workers-managed `workers.dev` HTTPS address;
  no custom domain, route or production-named Worker is changed.
- DO: the staging Worker's own `OpsStore` SQLite namespace, instance name `ops`.
- R2: new `cashu-card-ops-staging-backups` bucket, never a production bucket.
- Only operator auth/session management, mint-list metadata, scoped provisioning
  and authenticated backup status are routed. Holder, registry and anchor routes
  return 404 before backend access; the staging root is explicitly edge-only.
- Served mint reference: `http://127.0.0.1:3338`, metadata only. No mint, Bitcoin
  tip service, physical card, reader or phone is accessed in this scope.
- New random test master, issued operator and age identity/recipient, retained
  in a separate protected local directory. No Pixel/Max database, credentials,
  card identity, assigned manager keys, wallet seed or owner key is imported.

## Proposed remote execution scope (approval required)

1. Pin reviewed merged source and the staging bundle hash. Use existing Wrangler
   login only for read-only account metadata and the explicitly selected staging
   target. Do not read production Worker/DO/R2 data or secrets. If account choice
   is ambiguous, stop for account selection. Check only the exact staging resource
   names; an existing Worker/bucket needs explicit reconciliation, not overwrite.
2. Create the staging bucket and deploy only the explicit staging config. If
   the account needs plan enrollment/billing activation or new permissions, stop
   for its owner; do not enable account products automatically.
3. Generate the separate test material locally into mode-0600 files under a
   mode-0700 run directory. Inject master, public backup recipient and one-shot
   operator bootstrap through private stdin, never command arguments, prompts,
   shell history or ordinary logs. Retain the private age identity separately
   from Cloudflare. This local rehearsal is not independent offsite custody.
4. Verify the returned workers.dev hostname and TLS before private login.
   Trigger bootstrap, sign in with the generated test operator and remove the
   one-shot setup secret after successful verification. Keep its password in a
   private operator file; do not reuse phone-validation credentials.
5. Run only synthetic operator smoke checks: exact local-only mint metadata,
   one count-1 test batch, reservation/reconciliation and auth/sign-out. No
   physical card identities or writes and no holder-readiness assertion. Redact
   bearer/key/credential material from all evidence and outputs. Check blocked
   routes and same-token scope enforcement without calling external services.
6. Inspect only this staging service's authenticated backup status. Missing or
   not-yet-successful backup must remain unhealthy. The configured nightly cron
   is not forced by exposing a public export endpoint. Record first remote
   backup success when it actually occurs; local scheduled/R2 tests do not count
   as a deployed nightly run. Do not wait indefinitely or claim it passed early.
7. Retain a nonsecret report of source/config/bundle, target, routes, smoke
   outcomes and backup limits. Use the returned origin in an isolated app release
   candidate and run its release preflight. No phone install is part of this
   deployment scope. Production configuration, physical release gates and
   consumer issuance stay unchanged. Teardown/deletion is a separate action.

The actual hostname is deployment output; the operator need not invent a custom
hostname beforehand. Stop on unexpected account/resource, failed bootstrap,
TLS failure or secret-output risk. Never enumerate production card keys.

## Locally reviewable preparation

From `ops/`, Node 22, no remote deployment:

```sh
yarn typecheck
yarn typecheck:workers
yarn test:node
yarn test:workers
yarn format:check
WRANGLER_SEND_METRICS=false node node_modules/wrangler/bin/wrangler.js deploy \
  --config wrangler.staging.toml --dry-run --outdir /tmp/cashu-staging-worker
```

The entry follows the existing `.workers.ts` runtime boundary so Node-only
checking does not import `cloudflare:workers`. Route-policy tests cover allowed
methods and denied paths; a workerd test proves root/denied routes need no
backend binding. The Worker uses shared service logic rather than a divergent
staging implementation. Production deployment still requires its independent
backup destination/alerts, accepted recovery window, governance and recovery
reconciliation/fencing review documented in `ops/README.md`.
