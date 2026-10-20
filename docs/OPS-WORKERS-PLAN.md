# Ops service deployment and provisioning rollout plan

Updated 2026-10-20 after review of the recovered ENG-740 Workers port.
Ship operator provisioning first, using one Cloudflare Worker forwarding to
one SQLite-backed Durable Object. Consumer provisioning in flash-mobile and
Foxy's wallet follows verified identity, card ownership authorization and
interrupted-install recovery. D29's deterministic derivation and atomic escrow
remain; [D30](DECISIONS.md#d30) records the hosting and rollout amendment.

## Current validation

The recovered implementation passed both Node and Workers typechecks,
formatting, 44 Node tests on Node 22, four Workers tests using the corrected
`.mts` config path, and a Wrangler deployment dry run. Nothing was deployed.
That baseline did not exercise PBKDF2, object restart recovery or restoration
of a complete backup. The implementation pass now passes 54 Node tests and
10 Workers tests, both typechecks, formatting and the local Worker bundle.
The added runtime checks cover PBKDF2, actual object eviction, constructor
bootstrap and restoration of the scheduled R2 artifact. The bundle no longer
includes the native SQLite backend. Operator deployment configuration and the
ENG-741 app work remain outstanding.

The ENG-741 service increment adds scoped reservations, full installation identity
and version 2 recovery exports. Restores pause provisioning until reconciliation
and stale-client fencing; no unlock workflow is implemented. The durable journal, batch coordinator and injected orchestration are implemented.
Real screens now use them behind a disabled installation gate. Read-only CPLC
reads on Pixel and Max match the USB baseline on one card
([report](HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md)); identity through
install/rotation, distinct-card sampling, termination and personalization remain
outstanding. This increment passes 63 Node
tests, 11 Workers tests, both typechecks, formatting and a deployment dry run.

## Execution order and checkpoints

Implement in `/Users/dread/Repos/cashu-card-eng-740` on
`jabariennis/eng-740-workers-port`, preserving the recovered port and its
uncommitted changes. The main checkout's sign-in UI work is separate.
Use Node 22; the installed native SQLite module was built for that version.
The working Node used during validation was
`/Users/dread/.nvm/versions/node/v22.23.3/bin/node`; the Homebrew Node 22
installation failed to start because a shared library was missing.

Each row is a reviewable implementation checkpoint. Record the failing
regression and passing check at each checkpoint; do not describe the recovered
port as release-ready merely because its baseline suites pass.

| Order | Change | Acceptance | Status |
|---|---|---|---|
| 1 | Repair test commands and CI selection | Standard commands run Node and Workers suites separately; both typechecks and bundle check run in CI | Implemented; local checks passed |
| 2 | Disable holder access and bound operator login work | Anonymous holder sign-in denied; an existing holder token cannot issue keys; operator issuance still works; excess login attempts rejected before hashing | Implemented; regressions passed |
| 3 | Correct the Workers boundary | Saved anchor restored after object restart; actual password backend verified; Worker bundle excludes the native SQLite backend | Implemented; runtime checks passed |
| 4 | Add controlled operator bootstrap and recovery | Empty local DO becomes usable; bootstrap cannot silently replace an existing operator; administrative recovery works without a live session | Implemented; local lifecycle checks passed |
| 5 | Complete encrypted backup and restore | Scheduled path writes a versioned artifact; restoring it to an empty service recovers keys by card ID without the old DB or master; missing backup configuration is visible | Implemented locally; independent destination and alerts need operator configuration |
| 6 | Finish deployment documentation and readiness review | Threat model and runbook match implementation; independent backup procedure and data-loss window are explicit; deployment gates reviewed | Documented; release review and operator configuration outstanding |
| 7 | Execute ENG-741 app integration | Real batch/ordinal assignment and persisted outbox survive simulated interruption and restart without storing manager keys or PINs | Contract, identity reader, reservations, durable state, orchestration and gated real screens implemented; device validation and personalization outstanding |

Checkpoint 1 provides the same routine commands as CI.
Checkpoints 2–6 together satisfy the ENG-740 deployment gates; completing
one checkpoint is not permission to deploy. Keep consumer provisioning disabled
through all seven checkpoints.

The routine service checks, from `ops/` with Node 22 first on `PATH`, are:

```sh
yarn typecheck
yarn typecheck:workers
yarn test:node
yarn test:workers
yarn format:check
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir /tmp/cashu-ops-review-bundle
```

`test:workers` now selects `vitest.workers.config.mts`.
Do not reinstall dependencies or rebuild the native module just to compensate
for using the wrong Node version.

Implementation and validation use local test databases, workerd, fake cards and
public test keys. The operator supplies real credentials, configures the
independent backup destination and confirms its recovery window before release.
Real deployment and hardware drills are separate actions; this execution plan
does not authorize production access or device operations.

## ENG 740 deployment gates

Complete these before a public deployment with real card-manager keys:

1. **Close holder access.** Disable holder-session creation and holder key
   issuance in the deployed service until the consumer gate below is met.
   The current shape-only proof can mint a token that reads existing keys by
   batch and ordinal. Enforce the restriction on the server, regardless of
   whether a consumer app exposes the feature. Bound operator sign-in attempts
   before expensive password verification and return no key material in logs.
2. **Bootstrap and recover operator access.** Provide a controlled deployment
   tool that writes the first operator into the actual Durable Object. Keep
   bootstrap credentials out of prompts, arguments and shell history. Make
   reruns deliberate, close initial bootstrap after use, and document how an
   operator recovers access without a live bearer token. No permanent public
   registration endpoint is required.
3. **Finish the platform boundary.** Normalize SQL BLOB results consistently,
   including the persisted anchor tip. Select and wire the actual Workers
   password verifier, test the stored format it writes and any supported legacy
   format, and remove claims about crypto paths that are not exercised. Move
   shared configuration out of the Node server so the Worker does not pull the
   native SQLite backend into its bundle.
4. **Make recovery complete.** Version the encrypted export and include the
   card-ID to batch/ordinal mapping, batch metadata and records needed to restore
   key lookup without the original database or derivation master. Restore into
   an empty service and verify byte-identical key lookup for a registered test
   card. Keep a decryptable copy outside the same Cloudflare account, with the
   recipient identity held separately. Configure the backup schedule and alert
   on failed or stale backups; a disabled backup must not look healthy. Record
   the accepted data-loss window between exports. Partner exports must filter
   ownership and carry the service signature promised in governance before
   that contract is offered.
5. **Finish CI and the runbook.** Correct the Workers config filename and split
   Node and Workers test selection. Run Workers typechecking and a local bundle
   check in CI. Document environments, secret injection, bootstrap, deployment,
   migrations, rollback constraints, backup verification and restoration.
   Update the threat model for Cloudflare account access, runtime secrets,
   storage encryption and independent recovery; do not carry forward the
   droplet's separate-KEK claims without an implemented equivalent.

Cloudflare PITR complements the independent export; restoring inside the same
account does not cover loss of that account. A Worker runtime secret also does
not isolate the master from a compromised running service. Per-partner custody
and access remain subject to [governance sign-off](OPS-GOVERNANCE.md).

## ENG 741 operator provisioning gates

The implementation contract is now
[`PROVISIONER-RECOVERY.md`](PROVISIONER-RECOVERY.md), recorded in
[D31](DECISIONS.md#d31). It fixes the identities, proposed reservation API,
durable stages and recovery decisions; hardware verification and personalization
remain explicit gates.

The original review found that `LoopScreen.run` used demo behavior outside demo
mode and the registry used a two-byte suffix. The implementation now routes real
operator screens through the durable workflow and records full installation keys;
the suffix is display-only. Demo and the legacy memory outbox are separate.
Real installation stays disabled until the device evidence is reviewed.

Before automatic recovery, define a stable pre-install chip identity or an
equivalent explicit operator reconciliation contract. Applet public keys only
exist after install and change on reinstall. The CPLC reader is implemented and wired into the gated loop, but its phone
stability evidence is outstanding. Neither NFC UID nor SCP02 diversification data
is a substitute for that evidence. If the card cannot be matched
to the saved attempt, stop before authentication rather than trying candidate
keys. Hardware evidence for an identity contract needs a separately approved
device plan; it is not supplied by the service tests.

The app now uses real service batch IDs and reserved ordinals; native validation
remains necessary before claiming the operator workflow is complete. Reserve and durably record the attempt's batch,
ordinal and recovery context before an irreversible card operation. Persist
the frozen registry outbox across app termination and reauthentication, without
persisting card-manager keys or PINs. Define recovery when rotation succeeds
but its response or registry POST is lost: retrieve the same authorized key set
and reconcile the same attempt, without silently consuming another ordinal or
trying alternate keys against the card.

Make batch creation idempotent with a persisted request ID so a lost creation
response retrieves the same batch. Initially allocate each batch to one device
run; sharing a batch across phones needs server-side ordinal reservation.
Use cardkit's offline cryptogram matching for the known factory and assigned
key sets when recovering a lost PUT KEY reply; never trial-login with alternate
sets. A completed installation must be verified and registered, not swept merely
because its previous success response was lost. Define the mint, PIN, owner and
limit-setting sequence separately: install and rotation alone do not complete
the designed provisioning workflow.

Acceptance includes an interrupted run and an app restart with a pending record,
followed by reconciliation without duplicate assignments or lost registry rows.
Automated checks use fake cards; any phone or silicon drill needs the device and
actions named in an approved hardware plan under AGENTS.md.
The [proposed device validation checklist](PROVISIONER-DEVICE-VALIDATION.md) records
the candidate devices, missing validation tooling and the evidence required.

## Consumer provisioning gate

Provisioning may later live in flash-mobile and Foxy's wallet. Public factory
keys allow installation; access to an existing card's private manager keys
requires a separate server authorization decision.

Before enabling consumer access, implement verified identity, proof of authority
over the specific card or installation attempt, durable issuance and replay
rules, bounded requests and interrupted-install recovery. Knowing a batch ID,
ordinal or public card ID is not authorization. Persist any one-shot claims in
storage so object eviction or deployment cannot reset them. Keep the fleet
master on the service and fetch only the authorized per-card set for the run.
Foxy's governance sign-off still gates Phase 5b.

## Focused validation strategy

Test each guarantee at the lowest layer that can prove it. Keep business rules
in the Node suite rather than duplicating the whole route matrix on Workers.

| Layer | Guarantees to cover |
|---|---|
| Node business rules | Authorization boundaries; deterministic reissue; atomic escrow rollback; idempotent registry writes |
| Workers runtime | Fresh migrations and transaction rollback; actual password verification; BLOB and anchor restoration after object restart; scheduled export to storage and restoration of that exported artifact |
| Provisioner with fake card and storage | Stable batch/ordinal assignment; lost rotation response; persisted outbox and restart reconciliation |
| Build | Worker typecheck and local deployment bundle |

Use a small number of integration scenarios; each assertion must protect an
observable guarantee. Add a regression for a reproduced defect, demonstrate it
fails before the fix, then passes after. Reuse existing tests when they already
prove the property. No live Cloudflare, mint, phone or card is needed in CI.

## Architecture choices

One SQLite-backed Durable Object preserves the service's single-writer,
synchronous transaction model with little infrastructure to operate. Retain
the local Node adapter for development and recovery tooling. D1 or distributed
services would introduce another transaction model without a demonstrated
provisioning workload that needs it; revisit only with measured contention or
an agreed partner isolation requirement. A dedicated VM remains an alternative
if custody requirements rule out Cloudflare. Neither hosting choice substitutes
for card authorization or a tested recovery path.
