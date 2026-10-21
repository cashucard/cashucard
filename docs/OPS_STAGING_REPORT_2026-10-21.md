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
