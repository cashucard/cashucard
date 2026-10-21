# Recovery custody and independent backup implementation plan

2026-10-21. Operator selections: existing organization HashiCorp Vault (setup
unfinished), Nextcloud on the operator's Start9 server, and a maximum acceptable
24-hour loss window. Hostnames, accounts, paths and credentials belong in a
private operator inventory, not this repository. These selections do not
authorize production deployment, host access or secret transfer.

## Custody

Designated recovery operators retrieve the private age identity from the
organization Vault using individual accounts and reviewed access policies.
The service has only the public age recipient. The automatic backup-copy job
has no private age identity, production manager keys or decryption authority.
Do not confuse this identity with Vault's own unseal/recovery material or a
holder wallet's owner key.

Before relying on Vault, finish authentication/policies, audit access, backup
and unseal/recovery arrangements, and test access from a recovery machine with
the normal laptop and Cloudflare unavailable. Record the designated operator
roles and emergency-access procedure privately. Recovering Vault must not
require the same lost Cloudflare account or the only copy of this identity.
Existing local staging key material is rehearsal material, not production
custody. No key migration or production key creation is performed by this plan.

HashiCorp references:
[production hardening](https://developer.hashicorp.com/vault/docs/concepts/production-hardening),
[seal/unseal](https://developer.hashicorp.com/vault/docs/concepts/seal),
[storage and backup patterns](https://developer.hashicorp.com/vault/docs/internals/recommended-patterns).

## Independent encrypted copy

Use a dedicated Nextcloud backup account and directory, with its own revocable
app password, rather than the operator's main login. Nextcloud supports
[WebDAV file access](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html).
Do not assume an app password itself confines access to one directory: isolate
the account's accessible data. Obtain the actual WebDAV endpoint from Nextcloud;
the Start9 dashboard address is not evidence of that endpoint.

Prefer an independently operated pull job with bucket-scoped R2 read/list
credentials and Nextcloud write credentials. It copies only encrypted artifacts
and a nonsecret verification manifest. Do not put Nextcloud credentials in the
Worker or decrypt artifacts during routine copies. Runner placement remains to
be confirmed against supported Start9 deployment options; Nextcloud being
installed does not prove that an arbitrary scheduled job can run on that host.

Use an established transfer client such as rclone for
[R2](https://developers.cloudflare.com/r2/examples/rclone/) and
[Nextcloud WebDAV](https://rclone.org/webdav/), keeping credentials in protected
configuration. Use additive copies and explicit read-back verification; never
use destructive sync. Implement only the small snapshot selection, verification
and freshness layer needed here, rather than custom S3 signing or WebDAV auth.

Download a complete R2 artifact to a private temporary file; compute its SHA-256;
upload under a unique snapshot name; download the independent copy and compare
bytes/hash before recording success. A transport ETag or successful upload alone
is not a verification receipt. Preserve old verified snapshots and record their
source creation time, copy verification time, size and digest. A digest detects
copy corruption; authenticated age decryption during a restore drill is the
integrity/recipient check. Do not mirror upstream deletions, overwrite the only
known-good snapshot or add automated pruning before retention is reviewed.

Nextcloud is online storage, not an offline drive or immutable store. Recovery
must work without Cloudflare authentication, DNS/proxy access dependencies and
the normal laptop; establish an independent access path if needed. Filesystem
snapshots/offline copies administered separately from the copy credential are
additional protection. Record physical/storage failure domains before claiming
that this is an offsite disaster-recovery copy.

## 24-hour recovery objective

The accepted maximum is 24 hours of service history requiring reconciliation.
Physical cards issued after a recovered snapshot can still exist; restore must
remain fenced until those attempts are reconciled.

Proposed production export cadence: every 12 hours, followed by an independent
copy check at least every 15 minutes. Both exports fit one cron expression
(e.g. `17 3,15 * * *`, UTC), so this needs no additional cron slot. This is a
proposal for production preparation; the approved staging schedule remains
`17 3 * * *` until an explicit staging change is reviewed.

Measure freshness using the source snapshot time of the newest independently
verified copy, not its download/upload time. Alert on export/copy failure and
when that source age reaches 18 hours. At 24 hours, treat recovery health as
failed and require issuance to stop until fresh independent evidence exists.
Select alert delivery/acknowledgement and implement/test the issuance gate before
claiming this is enforced. A 12-hour cadence provides retry margin; it cannot
guarantee the objective through an unbounded outage. Nightly exports plus a
later copy can exceed 24 hours even in routine scheduling, so cadence alone
must not be described as satisfying the accepted maximum.

## Bounded execution sequence and acceptance

1. Finish Vault custody and designate recovery operators. Keep all material in
   private operator-controlled channels; no keys or tokens enter chat/history.
2. Confirm Nextcloud WebDAV endpoint, dedicated account, independent recovery
   access and supported always-on runner. Confirm retention and alert recipient.
3. Implement the thin local copy/verification orchestration with an injected
   transfer runner; exercise transfer compatibility against local fixtures. Tight regressions: interrupted copy never advances freshness,
   wrong read-back fails, old source with a new copy time stays stale, existing
   snapshots survive retries/deletions. No external host is needed for tests.
4. Obtain a bounded remote plan for that runner/account/directory and stage a
   synthetic encrypted copy. Do not enumerate unrelated Nextcloud files or
   install/modify Start9 services as discovery. An application password or R2
   credential is supplied privately by the operator, never as a prompt value.
5. Observe an actual scheduled staging backup, independently copy it and prove
   recovery from the Nextcloud artifact on a separate machine. Vault supplies
   decryption authority only for the approved restore drill. No cards/mints.
6. Restore into an empty protected Node database; verify escrow mapping and
   disabled old credentials/sessions. Preserve the recovery-required fence.
   Define/review reconciliation and stale-client fencing before reopening any
   recovered service; clearing the flag is not a recovery procedure.
7. Only then review production configuration, cadence, freshness enforcement,
   alerts, custody and release approval. Staging success never enables physical
   installation or establishes holder readiness.

Current evidence is the [staging report](OPS_STAGING_REPORT_2026-10-21.md).
Vault custody, independent scheduled copy, actual nightly success, remote-artifact
restore, retention, alerts and reopening procedure are pending—not certified by
this document. No server connection, credential transfer or cron change occurred
while recording these choices.
