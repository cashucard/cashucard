# Isolated staging deployment — initial stop and follow-up

2026-10-21. Operator explicitly approved the
[bounded staging deployment](OPS-STAGING-DEPLOYMENT.md). Source pinned to
`0b0bd505810213d2413bd0c751b3703e4f46262f` in an isolated checkout.

## Executed scope

- Wrangler account metadata identified one logged-in account; no production
  Worker/DO/R2 data or secret was queried. Account metadata is private evidence.
- Exact-name checks found neither proposed staging Worker nor backup bucket.
- Generated fresh test master/operator/age material into mode-0600 files in a
  separate mode-0700 Application Support run directory. No values were printed
  or imported from Pixel/Max. No secret has yet been injected into Cloudflare.
- Created only `cashu-card-ops-staging-backups`.
- Uploaded/deployed `cashu-card-ops-staging` and obtained
  `https://cashu-card-ops-staging.old-cell-30e7.workers.dev`.
- The deployment command exited with failure after partially updating triggers:
  cron creation was rejected with code **10072**, account Free-plan limit of five
  cron triggers already reached. No existing schedule or account plan changed.

Read-only HTTPS edge checks, without authentication or backend initialization,
returned root 200 with `readiness: edge-only`, `/anchor/tip` 404 and
`/registry/cards` 404. TLS verification remained enabled. These results establish
the deployed route boundary, not service readiness.

## Stop and evidence limits

Stopped remote configuration before credential injection, operator bootstrap,
synthetic provisioning or backup checks. Asked the operator whether to continue
nonproduction staging with no scheduled backup (explicit unhealthy status), or
wait for an operator-freed cron slot. No automatic upgrade or schedule removal
is authorized or attempted. The Worker/bucket are retained; no teardown occurred.

The public edge exists, but a public URL and root response do not establish an
initialized service, usable operator account or successful backup. No app build
has been retargeted to this origin and no phone/card/reader action occurred.
The local backup identity remains private and is not independent offsite custody.

Local preparation passed 65 Node tests, 12 Workers tests, both typechecks,
formatting and the staging bundle dry run; PR #40's 24 CI checks passed before
merge. These do not substitute for the pending remote smoke/backup evidence.


## Follow-up: cron freed; deployed password runtime incompatibility

The operator authorized removing the unused `meridian-emily` cron. Only its
schedule was removed (verified empty); its Worker was not deleted. Other
Workers were unchanged. Its owning source configuration must also remove the
schedule before a future deployment can restore it.

Redeploying the same pinned staging source succeeded with cron `17 3 * * *`
and Worker version `3acfebc3-bc70-4fdb-8f49-4e718c2ea66d`. Fresh staging
master, backup recipient and one-shot setup secrets were injected through
private stdin. No secret values were emitted to ordinary output.

The first sign-in failed with HTTP 500 / Cloudflare 1101 before any session or
synthetic batch was created. A staging-only diagnostic trace identified
`NotSupportedError`: deployed WebCrypto rejects PBKDF2 iteration counts above
100,000; the configured password work factor is 600,000. Local workerd had
accepted the same work factor. Setup remains incomplete, its one-shot secret
is retained until successful bootstrap verification, and no remote backup has
been demonstrated. D52 records the compatibility fix; this report does not
claim that its subsequent deployment or remote checks have passed.

## Follow-up: corrected deployment and authenticated smoke passed

Merged #42 source `fde6ed56bb1eca750ca7434f0ae12e4a57f617f5` deployed
successfully to the same staging Worker with nightly cron unchanged. Deployment
version: `9af2644c-de8f-45f6-8fec-f2d3bd05f430` (before removing the setup
secret, which creates a subsequent configuration version). The reviewed
staging bundle SHA-256 is
`638e8870acd3121e7c60a5e34cc16e8e76019551cba99536555b881cfe3ff042`.

Bootstrap/sign-in succeeded over verified HTTPS. Removed the one-shot setup
secret after verification. Authenticated smoke checks passed for the exact
local-only mint list, synthetic count-1 batch and identical request replay,
reservation and reconciliation, key issuance and byte-identical replay,
same-token foreign-device denial on reconciliation/key issuance, blocked
anchor/registry/holder routes, sign-out and rejected signed-out bearer. No
physical card identity was supplied or bound; no card installation or external
mint call occurred. All temporary smoke operator sessions were revoked.

Authenticated backup status was HTTP 503 with `configured: true`, `stale: true`
and `last_success: null`. This is expected before the first scheduled success;
no cron invocation, export endpoint, R2 artifact read or restore was forced.
Remote nightly success and independent recovery custody remain unproven.

Warm sign-in measurements were 8.4–11.5 seconds; the first bootstrap plus login
took 24.8 seconds. The app's original 10-second deadline was insufficient.
The D53 candidate's actual `ApiClient` signed in remotely in 10.9 seconds,
read the expected mint metadata, revoked the smoke operator's sessions and
verified bearer rejection. Public evidence contains no password, token,
manager-key material, raw receipt or card identity. These few timings establish
functional compatibility, not a production load/abuse-resistance claim.

An isolated staging app checkout passed public HTTPS-origin/release-gate
preflight and generated iOS/Android release JavaScript bundles. It retains both
physical installation and recovery drills disabled. No native build, phone
install or distributed release is part of this evidence; the committed app's
local development origin is unchanged. Candidate source is #42 plus D53's
client deadline change and the staging-only public origin override.

Candidate artifact SHA-256:

- Public origin configuration:
  `868b3b7dc9ab24f9135d4f2cb7ec8681c9ffab52dd61b7875689c1db44460669`
- iOS JavaScript:
  `f1d9bde1b09b8473ca6a5b595d0e33fe573ede9215757603f98281430d8dc626`
- Android JavaScript:
  `1ff7e8e514b29fe2e2056b418ed3ba28bf884bf332c6e1ed8d4b09b2753b4f4c`

## Atoll Recovery beta.3 issuer pairing and browser authorization

Reviewed main source `36036d316433bb24e531e3961444456a0077e137` deployed to
`cashu-card-ops-staging`, version `71b6f22e-02a5-4025-9720-61c459a00fcf`.
The nightly `17 3 * * *` cron remains unchanged. Recovery enrollment is limited
to the explicitly configured staging recovery administrator, independently of
provisioning access. No production deployment was made.

Zion (StartOS 0.4.0.3) completed the upgrade from Atoll Recovery beta.2 to
`0.1.0-beta.3:0`. The package's Connect Issuer action accepted a short-lived
code from the staging approval page and reported success without R2 credential
entry. The staging administrator session was signed out afterward.

Connect Nextcloud prefilled `https://cloud.bobodread.com` from the saved
configuration. The first approval used an administrator session despite a
separate browser window. Finish Nextcloud Connection rejected it and cleared
the pending flow. The helper's reviewed rejection path revokes the returned
app password; independent revocation verification was not performed. After
explicit browser logout and verified sign-in as `atoll-recovery`, a fresh
approval and Finish Nextcloud Connection succeeded. No app password was pasted
into the new form. The existing dedicated destination was preserved.

The copy runner started after configuration. Recovery Status returned Failed,
source age Unknown, alerts Disabled and no accepted notification. A separate
authenticated read-only listing confirmed zero objects in the staging escrow
prefix. This is not evidence of a successful transfer or destination read-back.
No export was forced, no synthetic artifact was inserted, and no restore or
StartOS backup/restore round trip was performed. The existing restricted R2
reader remains available as a fallback until paired transfer is verified.

Published universal, x86_64 and aarch64 beta.3 artifacts were downloaded and
matched the local registered-key signed build hashes. Package source:
`624221d88a2c3ae815283296bcfff390884172f9`, merged through package PR #2.
Universal SHA-256:
`fdeb3e302ed23171baa6a6da755ffb4744f57ab78e0c8ccbba6bbfe8b86bba90`.
Registry indexing and actual artifact/restore validation remain outstanding;
the GitHub prerelease is not a production-readiness claim.
