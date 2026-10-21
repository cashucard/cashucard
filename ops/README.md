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

This is a supported escape to the local Node service, not an automated upload
of SQLite into Durable Object storage. For a new hosted service, define and
review the import procedure before cutover. Remove any leftover setup secret
before restoring operators into a hosted object; setup markers are not exported
and a replayed bootstrap correctly refuses a populated operator table.

The release drill restores a downloaded artifact into an empty database,
recovers operator access, and verifies ENC/MAC/DEK lookup for a registered test
card through its stored batch and ordinal using the local recovery drill, not
the paused HTTP endpoint. It needs no physical card. Preserve
the old service and artifacts until that drill succeeds.

## Deployment and rollback

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
They are operational identifiers, not credentials. See the full
[identity and recovery contract](../docs/PROVISIONER-RECOVERY.md).

| Method and path                                | Request and result                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /provisioning/batches`                   | `device_id`, `batch_request_id`, `count`, `mint_url`, `pin_policy`, `daily_usd`, `no_pin_usd`, `load_sha256`; returns `batch` with immutable configuration and next ordinal |
| `POST /provisioning/attempts`                  | `device_id`, `attempt_id`, `batch_id`, `ordinal`; returns the owned reservation                                                                                             |
| `GET /provisioning/attempts/:id?device_id=...` | Returns reservation state and any immutable receipts; no keys                                                                                                               |
| `POST /provisioning/attempts/:id/bind`         | `device_id`, `revision`, `chip_id`; returns binding receipt                                                                                                                 |
| `POST /keys/issue`                             | `device_id`, `attempt_id`; optional `batch_id`/`ordinal` must match; returns the same per-attempt hex keys while active                                                     |
| `POST /provisioning/attempts/:id/record`       | `device_id`, `revision`, strict `record`; returns a terminal rotation receipt, never holder readiness                                                                       |
| `POST /provisioning/attempts/:id/disposition`  | `device_id`, `revision`, `kind` (`quarantined`/`abandoned`), `reason`; consumes the ordinal and frees the device while preserving unresolved chip blocking                  |

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

The operator selected organization HashiCorp Vault custody (setup unfinished),
Nextcloud on Start9 for independent encrypted copies, and a 24-hour maximum
loss window. The [recovery implementation plan](../docs/OPS-RECOVERY-PLAN.md)
records those choices, proposed cadence and outstanding access/restore gates.
It does not authorize server access, transfer keys or change the staging cron.
