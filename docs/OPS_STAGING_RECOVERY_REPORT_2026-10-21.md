# Staging independent-copy and isolated restore check

2026-10-21 (Pacific). This report concerns the isolated Cashu staging service,
Atoll Recovery on Zion and a disposable local recovery database. It does not
certify production custody, a separate recovery machine or reopening a service.

## Authorized scope

The operator approved bringing the staging run forward, then restoring its
nightly schedule after the check. The live schedule was read first:
`17 3 * * *`. A trigger-only Wrangler operation changed it to `13 0 * * *`,
with the upcoming invocation at 2026-10-22 00:13 UTC (17:13 Pacific).
Cloudflare's API confirmed the temporary schedule at 2026-10-21 23:53:55 UTC.
The repository's nightly configuration remained unchanged. No export endpoint,
extra cron slot, production deployment or card/reader/phone operation was added.

Before the run, authenticated listings found zero staging escrow objects and
zero artifacts in the dedicated Nextcloud directory. The local Node 22/SQLite
recovery environment initialized successfully without loading an identity.

## Results

The scheduled invocation completed successfully at 00:13 UTC. The scoped R2
listing contained one encrypted export. Authenticated service backup status
returned HTTP 200, `configured: true`, `stale: false` and last success
2026-10-22 00:13:06.064 UTC. Its temporary operator session was revoked, and the
same bearer was then rejected with HTTP 401.

Atoll beta.4 was restarted to run its copy cycle immediately. That cycle failed
before a source request reached the Worker; the dedicated Nextcloud directory
remained empty. A disposable Python 3.13 runtime reproduced edge HTTP 403 with
Python’s default user agent, versus the expected Worker HTTP 401 for the same
public invalid credential when identified as `Atoll Recovery`. The pairing
helper already used that product identity; the download client did not.

The correction is cashu-card PR #58: one request-header change with an assertion
in the existing pagination/download test. The assertion failed before the fix;
all five issuer tests passed afterward. No authentication or TLS rule changed.
A corrected package is being prepared; live paired transfer and isolated restore
remain unverified until its installation. No manual transfer was used to turn
copy health green, and the recovery identity was not loaded.

The bounded check was stopped after diagnosing the copy failure so its cleanup
could restore nightly scheduling. Cloudflare’s API independently confirmed
`17 3 * * *`, modified at 2026-10-22 00:19:15.944 UTC. The temporary capture was
stopped. The encrypted export remains available for retry without another cron
change. This is a successful controlled staging export and schedule restoration,
not a successful independent-copy/restore drill.

## Beta.5 follow-up: copy and isolated restore passed

The reviewed fix shipped in signed Atoll Recovery 0.1.0-beta.5:0 (package
PR #4 and upstream PR #58 passed their checks and merged). Zion retained its
setup through upgrade. Its runner copied the retained export into Nextcloud;
no manual transfer seeded that destination. The dashboard reports a fresh
verified copy. NTFY received the healthy transition at 17:39 Pacific after
the failure notification at 17:38.

An independent Nextcloud download verified the manifest, size (2,291 bytes)
and SHA-256:
`f7098790d9f14225cfcfd1f638c4793af9e5a1a6eb29527c66dba4f9cd4c762f`.
A scoped read of the original R2 object matched the same ciphertext digest.

The supported CLI restored that download into a fresh protected temporary
SQLite database with the existing staging age identity and no service master.
Verification found one operator, one batch and one escrow key set; all escrow
keys matched the authenticated snapshot. There were zero card mappings, so
populated card mapping recovery was not exercised. Recovery remained fenced,
operator credentials were disabled, sessions and companion credentials were
absent, and an occupied destination was refused. The plaintext database was
removed. Source backup status remained fresh; the temporary operator session
was revoked and verified rejected afterward.

A final independent Cloudflare API read confirmed the sole schedule remained
`17 3 * * *`. The first failed bounded-run record is retained; this follow-up
records the successful copy/restore without rewriting that earlier attempt.

## Recovery scope and remaining gates

The intended artifact path is staging cron → encrypted R2 export → paired Atoll
reader → dedicated Nextcloud account → verified local encrypted download → an
empty protected SQLite database. The copy manifest must match the downloaded
ciphertext's size and SHA-256 before decryption. Restore verification checks
escrow key sets and any available card mappings, disabled operator credentials,
absent sessions/companion credentials, the recovery fence and rejection of an
occupied destination. The disposable plaintext database is removed afterward.

The rehearsal uses the protected staging identity already on the original Mac.
It does not test Vaultwarden retrieval, the separately held offline identity,
a second recovery computer or recovery while the normal laptop is unavailable.
No restore result authorizes clearing the recovery fence or resuming issuance.
Production custody, accepted-loss-window enforcement and reviewed reconciliation
remain separate gates.
