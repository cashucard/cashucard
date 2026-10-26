# Provisioner production-readiness execution plan

2026-10-20. Operator direction: the unavailable spare for a full Max drill
must not block completion of the application and service. Continue software
implementation, local integration and operational preparation independently.
Hardware validation remains evidence for enabling a specific physical write
path; it is not a prerequisite for starting the work below.

## Current baseline

PRs #30 and #31 are merged. The operator app has identity binding, durable
reservations/journals, installation, assigned-key rotation and frozen-record
replay. All 120 app tests and both release bundles passed at #31. The service
has Node/Workers implementations, controlled bootstrap, encrypted exports and
local restore coverage. None of these results certifies holder readiness or
constitutes a production deployment.

Pixel's three recovery boundaries passed; Max's full write drill stopped after
an interruption. Preserve card 09336120 and its stopped attempt. Do not reset
state, create a new service to evade its chip block, or make more hardware work
the critical path for the following software milestones.

## Execution sequence

| Order | Deliverable | Acceptance |
| --- | --- | --- |
| 1 | Personalization contract | Holder wallet controls the owner key (D44). Follow the holder-handoff contract for mint/unit configuration, PIN handling, anchored satoshi limits and recovery. Issuer installation completion remains separate from holder payment readiness. |
| 2 | Personalization engine and durable orchestration | Inject transport, signing and approved configuration; preserve identity and scope. Lost replies/restarts cannot invent a PIN, retry an uncertain PIN, duplicate personalization or claim readiness from rotation alone. No new card wire behavior without protocol agreement. |
| 3 | Service completion contract | Record immutable configuration identity and verified completion, enforce operator/device/attempt scope, support idempotent completion and recovery exports. A client boolean cannot certify holder readiness. Extend both Node and Workers through the shared domain logic. |
| 4 | Complete operator experience | Accurate progress/native-sheet phases, explicit secret handoff, stop/reconcile/export flows, pending-record recovery and usable batch summary. Remove contradictory demo-era production copy. Never display an install-only card as ready. |
| 5 | Operational release preparation | Review production origin/build configuration, bootstrap, backup destination/alerts and accepted data-loss window, restore/reconciliation procedure, access control and rollback. Prepare deployable artifacts/runbook without accessing production. |
| 6 | Release review by capability/platform | Review software/integration evidence separately from hardware coverage. Internal installation is operator-approved in D74; public capability approval remains separate. Keep consumer provisioning and recovery-drill controls disabled in distributed builds. |

The owner authority decision and [holder-handoff
contract](PROVISIONER-HOLDER-HANDOFF.md) now define the boundary. The next
slices are honest operator handoff UX and portable card configuration/read-back,
followed by wallet-owned setup orchestration. Supervised repair of the stopped
card is a separate future capability. Personalization and service completion can
proceed independently.

## Execution status after the isolated staging rehearsal (2026-10-21)

- Issuer UX now reports installed/recorded cards as awaiting holder setup,
  removes issuer PIN/limit promises and exports bounded public recovery evidence.
- Public card configuration codecs/read-back and the injected owner-command
  signer are implemented and tested. Initial owner/PIN setup, uncertain-PIN
  recovery and complete holder-wallet orchestration remain separate unfinished
  integration work; issuer receipts continue to assert no holder readiness.
- A dedicated staging Worker/DO/R2 deployment now passes authenticated synthetic
  reservation/replay, device scope and key issuance checks. The actual app API
  client works with its bounded sign-in deadline. See the
  [staging report](reports/OPS_STAGING_REPORT_2026-10-21.md) for exact evidence/limits.
- An isolated app candidate has the staging HTTPS origin, disabled physical/
  recovery gates, release preflight and both JavaScript bundles. It is not an
  installed native release or a production artifact.
- Scheduled staging export, independently verified Nextcloud transfer, NTFY
  failure/healthy web receipt and isolated restoration from that artifact now
  passed. See the [recovery report](reports/OPS_STAGING_RECOVERY_REPORT_2026-10-21.md).
  The [separate-Mac staging restore](reports/OPS_SECOND_MAC_RESTORE_REPORT_2026-10-22.md)
  also passed from the protected offline copy. Production custody, whole-host monitoring,
  production activation of the tested 24-hour issuance gate and reviewed reconciliation/fencing before
  reopening remain open. The rehearsal used the original Mac's staging identity.
- Native Release builds now enforce the existing HTTPS-origin and disabled
  recovery-drill preflight. This prevents accidentally packaging the committed
  localhost configuration; it does not certify an endpoint or enable hardware.
- Production deployment and signed release preparation were subsequently
  authorized on October 22; see the current execution status below. Physical
  enablement still requires its specific device/action evidence. The missing
  full Max drill does not block software preparation or staging work.

## Production and signing preparation (2026-10-22)

The operator authorized work on production deployment, production app
configuration, signed release builds and store preparation. This is not store
submission or public rollout approval. The inventory below records the initial
preparation state; the subsequent deployment report records changes after that
inventory. No signed candidate or store upload has been produced.

- Exact Cloudflare lookups return not found for Worker `cashu-card-ops` and R2
  bucket `cashu-card-ops-backups`. The account's workers.dev subdomain is
  `old-cell-30e7`. The committed `ops/wrangler.toml` remains an incomplete
  deployment template; do not deploy it as a production-ready configuration.
- Production needs its own issuer UUID, master key, age recipient/private
  identity, restricted recovery custody and independently verified backup.
  Do not reuse staging secrets or silently replace Atoll's staging pairing.
  Configure the tested independent-copy gate from the first production
  deployment; missing initial evidence must keep issuance closed.
- Apple Developer is authenticated for `ISLAND BITCOIN LLC` (`H7UAM79QQP`) and
  lists valid distribution certificates. Local signing identities are
  development identities only. The existing Match repository has distribution
  material but no `com.islandbitcoin.provisioner` App Store profile. Certificate
  availability in the portal does not establish local private-key availability.
- A local Android release keystore exists. Its public certificate SHA-256 is
  `D1:C1:DE:8B:70:04:BF:43:14:BB:48:83:B1:7A:13:33:59:73:30:C6:0A:D4:47:E0:42:74:CC:B4:25:3D:1B:5E`.
  The operator copied Play's enrolled **upload** fingerprint and it matches
  exactly. The Play app-signing certificate is a different identity. No upload
  key reset or enrollment change is needed.
- Narrow searches in the unlocked Vaultwarden vault found no provisioner,
  keystore or Fastlane item. An `Android dev keypair` password did not unlock
  the local release keystore; it had no attachment or provisioner reference.
  No vault credential was changed, and this does not establish that signing
  material is absent from other custodians or locations.
- Historical release configuration unlocked the original Android keystore.
  A separate private working copy was imported with a new random password,
  retaining its one private-key entry and verified enrolled certificate.
  The original file's digest is unchanged. The copy and its local credentials
  have mode `0600` in a directory with mode `0700`, outside all checkouts.
  Android signing preflight passes with those private environment inputs.
  Its offline backup subsequently passed second-Mac unlock/certificate
  verification; see the custody report below. This is not a signed build.

The [production custody report](reports/OPS_PRODUCTION_CUSTODY_REPORT_2026-10-22.md)
records the separate production age identity, verified restricted Vaultwarden
retrieval and encrypted-drive copy, and the Android upload-key backup check.
The drive is unmounted and locked. `ops/wrangler.production.toml` now defines
the explicit production recipient, issuer, isolated bucket, 12-hour export cron
and independent-copy policy. The subsequent
[production deployment report](reports/OPS_PRODUCTION_DEPLOYMENT_REPORT_2026-10-22.md)
records the deployed service, private bootstrap/master injection, removed
one-shot setup secret and initial refusal checks. Both staging and production
are scheduled after the operator freed `meridian-jabari`'s slot. Production export, independent Nextcloud copy and temporary-database restore
acceptance have now passed. The additive Atoll capability in D73 keeps staging
and production histories separate. See the
[signed candidate and recovery acceptance report](reports/PROVISIONER_RELEASE_CANDIDATE_REPORT_2026-10-22.md)
for the evidence and remaining release gates.

The separate-Mac staging restore is complete. Remaining operational acceptance
includes monitoring independent of Zion,
and reviewed restore reconciliation before reopening issuance. Signed artifacts
must demonstrate their actual HTTPS origin, native transport policy, platform
entitlements and included dependencies before final store declarations.

## Contract constraints already established

- The current wire defines PIN setup/verification, card configuration, owner
  with anchor, and owner-signed limits; use [APDU Personalisation](../spec/APDU.md#personalisation)
  as the wire authority. The historical screen brief is superseded.
- Limits on the card are sats. Dollar inputs need an explicit conversion
  source, rounding, timestamp and frozen configuration; never silently treat
  dollars as sats or change limits on replay.
- No PIN, low-entropy PIN hash, manager key, bearer token or owner private key
  belongs in the ordinary journal, logs or export. PIN-setting reply loss and
  process loss must have a defined safe stop or authorized recovery path.
- Issuer-owned handoff needs a real owner-key authority and recovery policy.
  Holder-in-hand setup is a different product flow; do not silently substitute
  an ephemeral phone key or the published TEST owner key.
- Read-back evidence must distinguish configured state from a host-side claim.
  Any non-readable field requires an explicit proof/receipt or safe stop.

## Tight validation

Keep existing protocol/crypto suites. Add one focused regression per invariant:
configuration identity/replay, interruption at a changed irreversible boundary,
unknown PIN/owner state, actor mismatch, and no readiness without complete
verified evidence. Use fake transports and local services/mints; exercise the
Workers boundary only for storage/runtime behavior the Node suite cannot prove.
Do not multiply every UI state across every backend/platform or generate raw
hardware captures. Run relevant checks before PRs; native/hardware evidence is
tracked separately and never inferred from simulator results.

## Diagnostic Max build handoff

Built the #31 diagnostics on the isolated Max checkout with its existing HTTPS,
network-purpose and validation-gate overrides. Xcode's incremental build
succeeded but left a stale resource seal; the first signature check failed.
The initial install command nevertheless completed. Re-signed with the existing
configured development identity, then strict/deep verification passed and the
corrected artifact was installed again before any launch or card operation.
No uninstall, storage clearing, new attempt or card command occurred.

- Product source through `aed2d86b700a0a76918ce38c0c01aa8abfefe37d`;
  isolated checkout remains based at `3b4caa0` with selected app fixes applied.
- Total local diff SHA-256: `8163cc56267eda76fd5a34d10442ed264e68cc1d3218510559f4e824fc9dd614`.
- Corrected executable SHA-256: `9ac98a0ff91aa59e1bfefbcad5b5f042a9d0025c29b17dea03133f3915519f64`.
- Bundled JS SHA-256: `ac800cffb5473e4412557fa6e586609e999e6cbb4543ddca2a15f6a1790261e6`.

The updated build is diagnostic preparation only. No further Max drill is
required to start the software execution sequence above.
