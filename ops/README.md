# Ops service

ENG-740 ports the provisioning service to one Worker and one SQLite-backed
Durable Object. [The rollout plan](../docs/OPS-WORKERS-PLAN.md) lists the release
gates. Passing local checks does not authorize deployment or card operations.
Consumer/holder provisioning is disabled until verified identity and card
ownership authorization exist.

## Local checks

Use Node 22 (the native SQLite adapter must match the Node ABI):

```sh
yarn typecheck
yarn typecheck:workers
yarn test:node
yarn test:workers
yarn format:check
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir /tmp/cashu-ops-review-bundle
```

These use local SQLite and workerd. They need no Cloudflare account, phones,
cards or production mint. The Wrangler command only creates a local bundle.

## Initial operator on Workers

Only the operator controlling deployment secrets can initialize access. There
is no HTTP registration endpoint. Supply the optional `OPS_OPERATOR_SETUP`
Wrangler secret as a JSON object with these fields:

| Field      | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `action`   | `bootstrap` for an empty operator table                               |
| `nonce`    | A fresh unique command identifier, 16–128 letters, digits, `_` or `-` |
| `name`     | Operator name: 1–64 letters, digits, `.`, `_`, `@` or `-`             |
| `password` | 12–1024 characters, supplied privately                                |
| `keyEnv`   | Optional `factory` or `issued`; defaults to `issued`                  |

The operator supplies this JSON to `wrangler secret put OPS_OPERATOR_SETUP`
through its private interactive input or an approved secret-manager pipe.
Never put a password in a command argument, environment assignment typed into
shell history, chat, committed file or ordinary terminal output. Select the
intended deployment/environment explicitly; these steps change deployed state
and are the operator's release procedure.

The first request instantiates the actual `OpsStore`. It blocks requests while
hashing the password with the Workers backend and committing the operator and
command marker together. Sign in through `POST /auth/operator/session` using a
private client. Confirm success, then remove the setup secret with
`wrangler secret delete OPS_OPERATOR_SETUP`. Any request route can trigger
initialization; no special public setup URL exists.

Bootstrap refuses a database containing any operator. It never updates an
existing account or adds another operator through the initial setup path.
Reapplying an already committed nonce is a no-op, including after object
restart; changing the password with the same nonce does nothing. Keep a
nonsecret record of used nonces and action/name. A nonce reused for a different
action or name fails. Correcting invalid setup means replacing/removing the
secret; invalid setup blocks object startup rather than serving partially
initialized state.

## Recover operator access

A deployment administrator can recover without an existing bearer session.
Supply a new `OPS_OPERATOR_SETUP` secret with `action: "recover"`, a fresh
nonce, the **existing** operator's name and a replacement password. Omit
`keyEnv`: recovery preserves the existing privilege environment. The next
object initialization changes the password and revokes all sessions belonging
to that operator in the same transaction. Verify a fresh sign-in, then delete
the secret. An object restart does not repeat revocation for that nonce.
Recovery refuses unknown names and cannot implicitly create an administrator.

Cloudflare deployment/account access is therefore administrative access to the
service, its escrow and operator recovery. Secure and recover that account
separately; this mechanism does not provide separation from a compromised
Cloudflare account or running Worker. Keep an independently decryptable backup
outside that account as required by the rollout plan.

## Local Node bootstrap

The local CLI writes only `OPS_DB` (default `data/ops.db`); it does **not**
initialize the deployed Durable Object. Inject `OPS_OPERATOR_PASSWORD` from a
secret manager, then run one of:

```sh
yarn bootstrap-operator bootstrap operator-name issued
yarn bootstrap-operator recover operator-name
```

The same insert-only bootstrap and explicit recovery checks apply. Recovery
revokes sessions; secrets never appear in the CLI's success/error output.

## Backup configuration and monitoring

The nightly schedule is 03:17 UTC. Before deployment, bind an R2 bucket as
`OPS_BACKUPS` and set `OPS_BACKUP_RECIPIENT` to the operator's public age
recipient. Keep the matching private identity in an independently recoverable
secret store outside this Cloudflare account. Missing configuration fails the
scheduled invocation instead of silently skipping it.

Each successful export writes a uniquely named `escrow/<timestamp>-<uuid>.age`
object. Version 2 contains manager keys, batch metadata, card mappings, CAP
releases, operator identities and provisioning reservations, chip bindings,
full installation records and retry receipts. It excludes operator passwords, sessions,
PINs and the derivation master. Exports are encrypted recovery snapshots;
they are not the signed, partner-filtered deliverable proposed in governance.

`GET /ops/backup-status` with an operator bearer returns configuration status,
the last successful export's timestamp and object key, and whether it is stale.
It returns 503 before the first success, with incomplete configuration, or
after 26 hours without success. It returns no key material. Configure external
monitoring for failed cron invocations and that stale status; account for the
12 h bearer expiry in the monitoring client. The code reports these conditions;
it does not create an alert destination or manage monitoring credentials.

Copy completed encrypted objects to a destination outside this Cloudflare
account, verify their checksums and decrypt a sample using the independent
identity. Choose retention that preserves older successful snapshots; do not
replace every independent copy with the newest file. With nightly export and
immediate independent copy, the nominal loss window is up to 24 hours of new
records; delayed or failed copying extends it. The release operator must record
the accepted window and independent copy procedure. A successful R2 write alone
does not satisfy independent disaster recovery.

## Restore without the original service

Download an encrypted artifact to the recovery machine. Inject its age identity
as `OPS_RECOVERY_IDENTITY` through a secret manager and set `OPS_DB` to a fresh
local destination on protected storage, then run:

```sh
node --import tsx src/recover.ts /path/to/escrow-artifact.age
```

For a protected offline copy, set `OPS_RECOVERY_IDENTITY_FILE` instead of
`OPS_RECOVERY_IDENTITY`. Its value is the local identity file's path, never the
key itself. The CLI reads a regular, non-symlink file with no group/other
permissions (for example, mode 0600), bounded to 4096 bytes. A trailing newline
is accepted. Setting both identity sources is an error; neither silently wins.
Unreadable, unsafe, empty or invalid key files fail before the destination is
opened. Errors never echo the key, file contents or exception details.

```sh
OPS_DB=/protected/recovery/ops.sqlite \
OPS_RECOVERY_IDENTITY_FILE=/protected/offline-copy/recovery-identity.txt \
  node --import tsx src/recover.ts /protected/offline-copy/escrow-artifact.age
```

Use the actual protected paths on the recovery computer. Install this checkout's
locked dependencies using Node 22 before running the CLI; do not copy a native
SQLite module built for another Node version or CPU. A file-backed restore on
the original computer is not evidence of a successful separate-machine drill.
The restored SQLite file is plaintext operational escrow: keep it protected,
never copy it back to Nextcloud as a backup, and remove rehearsal destinations
after recording only nonsecret verification results.

The CLI authenticates and validates the artifact, refuses an occupied service,
and restores atomically. Newly created files use operator-only permissions.
Version 1 artifacts remain supported as legacy data without reconstructed
reservations. Restoring either version sets `recovery_required=1`: provisioning
mutations and key fetches are paused, with authenticated scoped attempt reads
available for inspection. This prevents missing post-snapshot requests from
silently being created again. No HTTP unlock or automatic client recovery is
provided; reconciliation and fencing stale clients are a release gate before
reopening. Do not clear the control flag as a substitute for reconciliation.
The local SQLite database now contains plaintext manager keys; do not upload
or share it as an encrypted backup. Restored operator credentials are disabled
and sessions are absent. Use explicit local operator recovery before sign-in.
Offline escrow inspection uses stored rows without the original derivation master;
HTTP key retrieval remains paused after restore.
The Node server and Worker currently require a configured master at startup;
a fresh replacement master can create future batches without changing old keys.

This is a supported restore path to the local Node service. Importing SQLite
into Durable Object storage requires a separately reviewed procedure before
cutover. Remove any leftover setup secret
before restoring operators into a hosted object; setup markers are not exported
and a replayed bootstrap correctly refuses a populated operator table.

The release drill restores a downloaded artifact into an empty database,
recovers operator access, and verifies ENC/MAC/DEK lookup for a registered test
card through its stored batch and ordinal using the local recovery drill, not
the paused HTTP endpoint. It needs no physical card. Preserve
the old service and artifacts until that drill succeeds.

## Deployment and rollback

The explicit production configuration is `wrangler.production.toml`; the default
`wrangler.toml` remains a starter template. Production uses its own recovery
recipient/issuer and bucket, a 12-hour export schedule and required independent
copy evidence. No initial receipt means issuance is blocked. The private age
identity is never a Worker binding. See the
[custody evidence](../docs/OPS_PRODUCTION_CUSTODY_REPORT_2026-10-22.md) and
[release plan](../docs/PROVISIONER-PRODUCTION-READINESS.md) for outstanding gates.
Validate the explicit configuration locally before deploying it:

```bash
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.production.toml --dry-run --outdir /tmp/ops-production-worker
```

Deployment must preserve this issuer UUID, Durable Object identity and recovery
recipient. Provision the named R2 bucket and inject a fresh production master
privately; never copy staging secrets. Bootstrap `production-lead` using the
existing one-shot setup mechanism, verify access, then remove its setup secret.
Check cron capacity without removing an unrelated service's trigger. Pair the
companion into a separate production destination while retaining staging
artifacts; grant attestation only to the verified reader. Actual production
copy/restore acceptance and independent alerting remain required before release.

Deployments are operator-run after the rollout gates, using a dedicated
Cloudflare environment and storage isolated from the mint. Confirm the account,
bindings, independent backup access, alerting, and secret injection before the
release. Check sign-in and registry reads, then verify a fresh backup artifact
and its restored mapping. Never test with production mint commands or devices
under this runbook.

SQL migrations are forward-only and apply inside storage transactions. Capture
a usable backup before changing schema. A code rollback is safe only if the old
code understands the current schema and stored password/export formats; do not
assume a Worker rollback undoes database writes. PITR can rewind later registry
and escrow rows, so reconcile cards issued after the selected restore point
before reopening issuance. Never delete a Durable Object namespace or rename
its singleton object as a rollback technique.

The provisioner now has a separate real installation loop and durable journal
(ENG-741); installation completion remains awaiting holder setup. Committed
physical installation and recovery-drill gates stay disabled. Service deployment
alone does not enable a card-writing path; all device work retains AGENTS.md's
hardware rules.

## Provisioning reservation API

All provisioning routes require an operator session. Sign-in now returns
`operator_id`; use that ID for journal scoping. `device_id`, `batch_request_id`
and `attempt_id` are canonical lowercase UUIDs supplied by a durable client.
They are operational identifiers; authorization comes from the operator session
and scoped device reservation. See the full
[identity and recovery contract](../docs/PROVISIONER-RECOVERY.md).

| Method and path                                                  | Request and result                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /provisioning/batches`                                     | `device_id`, `batch_request_id`, `count`, `mint_url`, `pin_policy`, `daily_usd`, `no_pin_usd`, `load_sha256`; returns `batch` with immutable configuration and next ordinal |
| `POST /provisioning/attempts`                                    | `device_id`, `attempt_id`, `batch_id`, `ordinal`; returns the owned reservation                                                                                             |
| `GET /provisioning/attempts/:id?device_id=...`                   | Returns reservation state and any immutable receipts; no keys                                                                                                               |
| `GET /provisioning/reset-source?chip_id=...&installation_id=...` | Returns `missing`, `unresolved`, `escrow-missing`, `reset-completed` or a matching recorded attempt and escrow reference; no keys and no reset authorization                |
| `POST /provisioning/reset-intents`                               | `device_id`, strict `request`; saves card-specific authorization and inspection/consent before any card mutation                                                            |
| `GET /provisioning/reset-intents/:id?device_id=...`              | Returns saved request, authorization receipt and completion receipt; no keys                                                                                                |
| `POST /provisioning/reset-intents/:id/keys`                      | `device_id`; returns source escrow only to the authorized operator/device while unfinished, with restore and backup gates                                                   |
| `POST /provisioning/reset-intents/:id/complete`                  | `device_id`, strict `record`; saves factory-key/absent-package evidence, closes key access and releases the reset fence                                                     |
| `POST /provisioning/attempts/:id/bind`                           | `device_id`, `revision`, `chip_id`; returns binding receipt                                                                                                                 |
| `POST /keys/issue`                                               | `device_id`, `attempt_id`; optional `batch_id`/`ordinal` must match; returns the same per-attempt hex keys while active                                                     |
| `POST /provisioning/attempts/:id/record`                         | `device_id`, `revision`, strict `record`; returns a terminal rotation receipt, never holder readiness                                                                       |
| `POST /provisioning/attempts/:id/disposition`                    | `device_id`, `revision`, `kind` (`quarantined`/`abandoned`), `reason`; consumes the ordinal and frees the device while preserving unresolved chip blocking                  |

Idempotent retries are scoped and checked before revision conflicts. Changed
request content is 409; missing or inaccessible reservations are 404. Restore
pause is 409 `recovery-required`. Keys are returned only from the reservation-
scoped key endpoint, and responses carry `Cache-Control: no-store`.

Legacy batch creation and suffix-only card registration POSTs return 410.
Legacy GETs are owner-filtered and omit PINs; they do not include the new full-
installation history. Migrate clients to the new API before real provisioning.
The app's current sign-in/mint reads remain available, but no real batch loop
is claimed by this service change.

## First remote staging rehearsal

The port/dry-run checks above do not deploy a service. A separately reviewed
[staging deployment plan](../docs/OPS-STAGING-DEPLOYMENT.md) uses
`wrangler.staging.toml`, its own Worker/DO/R2 names and fresh test material.
It obtains a workers.dev hostname only after an approved remote deployment.
The staging entry blocks holder, legacy registry and anchor routes before
backend access. Do not use the default production-named config to discover a
URL or import phone-validation databases into staging.

The approved staging rehearsal now has successful remote operator and synthetic
provisioning checks; see the [dated evidence](../docs/OPS_STAGING_REPORT_2026-10-21.md).
Deployed native PBKDF2 has a 100k cap, so D52 preserves the 600k work factor
through the pinned fallback. Sign-in is correspondingly expensive: the app
allows 30 seconds only for that call (D53); other requests remain bounded at
10 seconds. These functional timings do not establish production capacity.
The first scheduled backup, independent copy and remote-artifact restore drill
remain separate evidence. No production deployment is authorized by staging.

The operator selected organization Vaultwarden custody, with a separately held offline recovery copy,
Nextcloud on Start9 for independent encrypted copies, and a 24-hour maximum
loss window. The [recovery implementation plan](../docs/OPS-RECOVERY-PLAN.md)
records those choices, proposed cadence and outstanding access/restore gates.
It does not authorize server access, transfer keys or change the staging cron.

## Atoll Recovery enrollment

Set public deployment configuration `OPS_RECOVERY_ISSUER_ID` to a stable UUID
unique to this issuer/environment, and `OPS_RECOVERY_ADMINS` to a JSON array of
existing operator names explicitly allowed to enroll backup readers. Empty or
missing configuration does not grant that permission. The existing R2 binding
and public age recipient must also be configured. No R2 API credential is needed
by the companion when paired.

Open `/ops/recovery/setup` over HTTPS and sign in as a designated recovery admin.
Create a named pairing code and enter it privately into Atoll Recovery's Connect
Issuer action with this service's origin. Codes expire after ten minutes. The
same device can recover a lost claim response while the code is valid; a different
device cannot reuse it. Use the same page to list and revoke connections, then
sign out. Never send codes or credentials in chat, URLs or ordinary logs.

The backup-only API is `GET /recovery/exports` (bounded cursor pagination) and
`GET /recovery/exports/NAME` (existing encrypted snapshots only). Its independent
credential does not authenticate to card APIs. It cannot trigger exports or
retrieve plaintext recovery material. Existing snapshots in Nextcloud survive
issuer outages; new downloads wait for issuer recovery. Direct R2 access remains
an advanced recovery fallback. Re-enroll after a service restoration: exports do
not restore companion sessions or grants.

### Independent-copy freshness policy (not enabled by default)

`OPS_INDEPENDENT_BACKUP_ISSUER` explicitly opts into the 24-hour issuance fence.
Its value is the public issuer UUID; Workers require it to equal
`OPS_RECOVERY_ISSUER_ID`. An invalid value fails startup and authorization-time validation. The edge passes its current binding through private request RPC; the object
scopes it to that request so warm binding snapshots and overlapping calls cannot
retain or replace another request’s policy. Verify authenticated status after activation. Do not set it on an
existing deployment until the copier receipt flow, outage behavior and mobile
refusal handling have passed a bounded staging drill. Existing configuration
and cron remain unchanged. The current companion HTTP implementation is Workers;
the Node domain supports the same policy, but has no companion enrollment API.

A recovery administrator can separately grant a paired connection attestation
with `POST /ops/recovery/connections/<id>/attestation`, body `{"enabled":true}`.
The operator session must belong to the deployment's recovery-admin allowlist.
Use `false` to remove the capability; either operation discards prior evidence.
Ordinary pairing never grants it. Revoking the connection invalidates evidence.

A companion reads `GET /recovery/metadata/<encoded-export-name>` and, **only after
verifying the destination artifact and manifest by read-back**, submits
`POST /recovery/copy-receipts` with `name`, `exported_at` (Unix seconds), `sha256`
and `bytes` matching that source. The receipt uses the scoped companion bearer,
never an operator credential. Legacy objects without metadata remain downloadable
but are ineligible. The issuer trusts the authorized copier's read-back assertion;
it does not have Nextcloud credentials or prove destination possession itself.

When enabled, missing or expired evidence returns HTTP 503 with reason
`independent-backup-stale` for new batch creation, reservation and key retrieval.
Matching batch/reservation retries remain readable, and outcome/disposition
submission remains available. `/ops/backup-status` reports `independent_copy`
separately from R2 export status and returns unhealthy if a required copy is
stale. A fresh receipt cannot reopen a service fenced for recovery.

## Operator administration

Open `https://<ops-origin>/ops/operators` and sign in with a deployment-designated
administrator. Production designates `production-lead`. Its password belongs in
the restricted service-secrets vault item; never share that administrative login
with routine provisioning operators.

The console lists operators and their key environment/status. Create a separate
named account with a password of at least 12 characters and the appropriate key
environment (`issued` is the default). Deliver the password through your secrets
vault. Disable access instead of deleting an operator: this revokes existing
sessions while preserving batch/card history. Resetting a password also revokes
sessions and does not re-enable a disabled account. Re-enable is an explicit
separate action. Self-disable is refused. Resetting your own password signs you
out; sign in again with the new password.

Deployment administrators control `OPS_OPERATOR_ADMINS`, a JSON array of exact
operator names. It defaults empty and is separate from `OPS_RECOVERY_ADMINS`.
An ordinary operator cannot add administrators. Node reads the same environment
variable; Workers forward its current value through private RPC to avoid a
cached grant. Invalid configuration fails closed. Keep Cloudflare account
recovery independent of the service. Deployment-only password recovery does not
re-enable a deliberately disabled account.

Authenticated endpoints: `GET /admin/operators`, `POST /admin/operators` with
`{name,password,keyEnv?}`, `POST /admin/operators/:id/disable`, `/enable`, or
`/reset-password` with `{password}`. `GET /admin/operators/audit` returns the 100
most recent successful administrative mutations. These endpoints require the
allowlisted administrator's bearer token. No password/hash is returned or
recorded in the audit trail.

New recovery artifacts use export format v7, preserving account disabled state,
the administrative audit trail, ended-batch fences, reset intents, completion
receipts and reviewed cross-service reset reconciliations. Use the recovery CLI
from this revision or later: older restore tools reject v7. The CLI still
restores v1–v6 backups. All restored passwords remain disabled until
controlled recovery, and the provisioning reconciliation fence remains enabled.

For a completed reset whose original keys were held at another service, see
[`RESET-RECONCILIATION.md`](../docs/RESET-RECONCILIATION.md). The administrator
review action releases only one terminal attempt's chip block and retains
its original history. It never imports manager keys or performs a card write.

For an owned test card whose keys remain in a historical local source DB,
`src/local-reset.ts` previews metadata by default. Execution uses explicit
consent, a protected DB snapshot, a durable journal and the restricted PC/SC
bridge. It accepts only the historical loopback service scope. Follow the
[named-card recovery drill](../docs/OWNED-CARD-RESET-DRILL.md); approval is
required before its card-changing command. It does not clear a production
quarantine or transfer keys to another service.

`GET /admin/provisioning/attempts` and the console's read-only support section
show the 100 most recent attempt identities, states and chip bindings. They
expose no keys, PINs or frozen record bodies, and cannot repair or clear a
quarantined card. Use this evidence alongside the phone's retained journal;
a generic reconciliation conflict is not permission to retry card writes.

### Console experience and browser acceptance

The console separates Operators, Installations and Activity. Search and status
filters operate on the returned records; installation/activity views show the
latest 100 entries and omit lifetime totals. Account details contain reset and access
controls. Destructive access changes use a keyboard-accessible confirmation
dialog; password creation/reset requires saving the new password to your vault
before submission. Generated passwords use browser cryptographic randomness.
Partial refresh failures are labelled rather than displayed as empty lists.

For console changes, run the single real-browser acceptance journey with Node
22 and an installed Chrome (from `ops/`):

```sh
node tools/admin-console-smoke.cjs
# On other systems, set CHROME_BIN to the installed Chrome executable.
```

It starts a disposable loopback-only SQLite fixture with published test
credentials and synthetic keys, uses a separate headless Chrome profile, checks
sign-in/admin authorization, filters, account creation, reset, disable/re-enable,
details, Escape, mobile layout/sign-out and partial-refresh recovery, then stops
the fixture. No production origin is permitted. Screenshots are written to a
temporary directory printed by the check. No browser automation dependency is
added to the service or CI.

## Package and deployment boundary

The service consumes the versioned `@cashu-card/cardkit` package through its public
exports; build the SDK before installing this directory. Node-only fakes use the
`/testing` entry point in tests. Ops versions/tags are independent of firmware and
the mobile app. The [component release guide](../docs/COMPONENT-RELEASES.md)
describes checked staging/production artifacts and explicit scoped deployment.
A tag does not deploy a Worker or rotate recovery/master secrets.
