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

## Encrypted removable-drive custody rehearsal

The operator selected themselves as offline custodian and an encrypted removable
drive as the medium outside Zion. After a read-only inventory and explicit erase
approval, the confirmed 246 GB external USB drive was formatted as encrypted
APFS. The operator entered its password in private native dialogs; it was not
placed in chat, command arguments, shell history or a saved password file.
File ownership was enabled through native administrator authentication. Encryption
and a lock/unlock cycle passed before copying any recovery material.

The existing staging identity was copied without displaying its contents into a
0700 directory with a 0600 key file. Its public recipient was derived and recorded
with the staging issuer identifier. A copy of the previously verified independent
Nextcloud ciphertext and manifest was added after size/hash verification. No
production identity was generated, retargeted or copied.

The supported restore CLI then read the identity and encrypted artifact from the
drive into a fresh temporary database on the original Mac, without a service
master. All escrow keys matched; one operator, one batch and one key set were
restored, with zero card mappings. Recovery remained fenced, credentials disabled,
and sessions/companion credentials absent. The temporary plaintext database was
removed. A sanitized report and instructions were retained. The drive was then
unmounted and locked successfully.

This establishes a working encrypted-drive staging copy. Vaultwarden custody,
physical storage placement, separate-machine recovery and production custody
require their own acceptance checks.
The operator subsequently reported connecting this drive to another Mac and
unlocking it successfully. This confirms cross-machine unlock only: no file
verification, decryption or restore was observed on that Mac. Its password must
be independently recoverable outside
Zion and must not exist only on the drive it unlocks.

## Organization Vaultwarden custody follow-up

The operator signed in privately and enabled an authenticator-app second factor;
the account's two-step settings showed that provider turned on. A dedicated
staging recovery collection was created in the existing organization. Its saved
access list grants only the selected operator management access. Organization
owner/administrator access was reviewed as part of the effective scope, rather
than assuming a collection excludes those roles. No unrelated vault items were
opened or changed.

The staging identity and public matching metadata were saved as an explicitly
staging-only secure note through the encrypted web vault. Private content was
not returned in tool output, chat, command arguments or ordinary logs. The saved
note matched the source exactly. After a full page reload locked the vault, the
operator unlocked it privately and the saved item was retrieved again from the
restricted collection; its content still matched exactly without displaying it.
The note was closed and the vault locked afterward. The encrypted drive remained
locked. No production identity was generated or transferred.

This verifies staging organization custody and fresh-unlock retrieval on the
original Mac. It does not prove a second operator's recovery access, standalone
account/MFA recovery, separate-machine retrieval, physical storage placement or
production custody. The unlock password and authenticator recovery arrangements
must remain independently recoverable outside Zion.

## Verified copy receipts and staging issuance policy

The source implementation in PRs #68–77 adds issuer-bound snapshot metadata,
separately granted copy-attestation authority and the shared 24-hour issuance
gate. The app explains a stale-backup refusal and retains its saved attempt
before opening NFC. The exact 24-hour boundary, replay, safe outcome recording,
revocation and issuer/source binding are covered by focused local regressions.

Atoll Recovery **0.1.0-beta.6:1** was built for both architectures, reviewed and
published after green CI, indexed on the Atoll registry with a matching package
commitment, and upgraded on Zion through its normal marketplace update. Real-SDK
checks verify default-off receipt settings and explicit enable/disable without
retargeting credentials or locations. All 19 Python tests passed in the Linux
runner image, including the rclone/WebDAV round-trip. Existing encrypted copies,
configuration and notification routing were retained; copy health and receiver
acceptance were observed healthy after upgrade.

Only the existing **Zion staging** connection received an explicit administrator
grant. The stopped-service action then enabled receipt delivery. The first
brought-forward cron windows did not observe an export and restored the nightly
schedule; later scheduled exports were observed during the propagation window.
The protected trace contains five scheduled events with zero scheduled exceptions.
Atoll reported successful destination artifact/manifest read-back and the issuer
accepted its matching source receipt. This remains a trusted copier assertion,
not cryptographic proof of Nextcloud possession. No new artifact was decrypted
or restored in this receipt drill.

Initial policy-activation attempts correctly remained failed in the private
records: warm objects retained old binding snapshots despite correct control-plane
configuration. D71's private request RPC supplies current policy and recovery-admin
permissions from the edge, using AsyncLocalStorage to isolate overlapping calls.
A replacement-environment regression failed before this fix and passed afterward;
all 72 Node and 19 Workers tests and relevant type/format checks passed.

The final live drill warmed the service with enforcement off, then changed the
staging policy binding without changing its code. Authenticated status showed
`required: true` with fresh copy evidence. A reservation probe against a deliberately
nonexistent batch returned 404. Removing attestation authority deleted its eligible
evidence: health and the same reservation probe returned **503**, with reason
`independent-backup-stale`. Regranting authority and restarting Atoll recovered
fresh evidence through actual destination read-back and receipt submission; the
same probe again returned 404. The recovered snapshot timestamp stayed unchanged
through recopy; receipt time did not advance its source age. The probe created no batch, attempt or card mapping and
requested no keys. The exact 24-hour expiry was tested with injected clocks;
this live drill exercised missing-evidence refusal and recovery without changing
the service clock.

The temporary enabled Worker version was `2585e044-f62a-4410-9193-bfe34405c458`.
The final restored version is `5c78abd8-9ff7-40f9-9d2f-ac9dcfcc6ea5`, with
`required: false`, fresh copy evidence and HTTP 200. The schedule API confirmed
only `17 3 * * *` after the drill. Temporary configuration was removed; no
production deployment, production recovery-key transfer, physical gate change,
card operation or production mint access occurred. Production activation, 12-hour export
cadence and release approval remain separate gates.

## Recovery scope and remaining gates

The intended artifact path is staging cron → encrypted R2 export → paired Atoll
reader → dedicated Nextcloud account → verified local encrypted download → an
empty protected SQLite database. The copy manifest must match the downloaded
ciphertext's size and SHA-256 before decryption. Restore verification checks
escrow key sets and any available card mappings, disabled operator credentials,
absent sessions/companion credentials, the recovery fence and rejection of an
occupied destination. The disposable plaintext database is removed afterward.

The initial rehearsal used the protected staging identity on the original Mac;
the follow-ups verified its encrypted-drive copy and fresh-unlock Vaultwarden
retrieval on that same Mac. The operator also reported successful drive unlock
on another Mac. Restoring and verifying the backup there while the normal laptop
is unavailable remains untested.
No restore result authorizes clearing the recovery fence or resuming issuance.
Production custody, production accepted-loss-window enforcement and reviewed reconciliation
remain separate gates.

## Separate-Mac follow-up (2026-10-22)

The [dated separate-Mac report](OPS_SECOND_MAC_RESTORE_REPORT_2026-10-22.md)
records the subsequent actual restore from the encrypted drive, exact escrow
comparison, preserved recovery fence/disabled credentials and cleanup. This
adds evidence beyond the earlier reported unlock without changing the limits
of that earlier check. Production custody and reopening remain separate gates.
