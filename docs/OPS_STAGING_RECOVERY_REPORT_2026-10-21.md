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
