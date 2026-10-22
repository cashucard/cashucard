# Recovery custody and independent backup implementation plan

2026-10-21. Current operator selections: an organization password manager
(Vaultwarden on Zion) with designated recovery operators, Nextcloud on the
operator's Start9 server,
and a maximum acceptable 24-hour loss window. This replaces the initial
HashiCorp Vault choice: the HCP account had no cluster, and the operator chose
the simpler custody option (D55). Vaultwarden and Nextcloud are both on Zion.
Hostnames, accounts, paths and credentials belong in a private operator
inventory, not this repository. These selections do not authorize production
deployment, host access or secret transfer.

## Custody

Store the private age identity in a restricted shared vault/collection in the
organization password manager. Designated recovery operators use individual
accounts with MFA and explicit access to that item. Record its public recipient
and a nonsecret key identifier alongside it so an operator can match the correct
identity to an encrypted artifact. Never put the identity in a shared document,
chat, source control, ordinary log or automatically generated diagnostic.

The service has only the public age recipient. The automatic backup-copy job
has no private age identity, production manager keys or decryption authority.
This identity decrypts service recovery backups; it is separate from a holder
wallet's owner key and the service's derivation master. Product-specific access,
recovery and audit features must be verified before claiming they are available.

Before relying on custody, designate recovery operators and verify retrieval
from a separate recovery machine with the normal laptop and Cloudflare
unavailable. Complete account recovery/MFA backup arrangements and the
organization emergency-access procedure privately. Recovering the password
manager must not depend on the only lost device, this Cloudflare account, or
the sole copy of the age identity. Review protected offline emergency access
with the designated operators; do not create an unattended plaintext export.

Vaultwarden and Nextcloud share a server failure domain. Before relying on
this arrangement, retain a protected offline copy of the age identity, its
public recipient/key identifier and concise recovery instructions outside Zion.
The operator confirmed they will personally hold the protected offline
copy outside Zion on an encrypted removable drive; the specific medium and
location are recorded privately. The drive is prepared and a staging identity
copy restored successfully on the original Mac. A restricted organization
Vaultwarden staging copy also passed fresh-unlock exact retrieval with
authenticator MFA enabled. No production identity transfer
has been performed. The operator reported successfully unlocking the drive on
another Mac; backup verification and restore there remain untested. Test that
standalone copy without Vaultwarden, Nextcloud or the normal laptop. Do not depend on
cached vault sessions as the only escape, or store the only emergency copy in
Nextcloud. Separately document Zion/Vaultwarden backup and account/MFA recovery;
a recovery password stored only in that same unavailable vault is circular.

Use a restricted Vaultwarden organization collection for the online identity,
with named individual members and verified access permissions. See
[Vaultwarden's documented organization/collection support](https://github.com/dani-garcia/vaultwarden).
No credential or identity is generated or transferred by this document.

No HCP cluster, subscription or Vault deployment is required by this plan.
Existing local staging key material remains rehearsal material, not production
custody. No identity upload, migration, new production key or password-manager
account change occurred while recording this decision.

## Independent encrypted copy

Use a dedicated Nextcloud backup account and directory, with its own revocable
app password, rather than the operator's main login. Nextcloud supports
[WebDAV file access](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html).
Do not assume an app password itself confines access to one directory: isolate
the account's accessible data. Obtain the actual WebDAV endpoint from Nextcloud;
the Start9 dashboard address is not evidence of that endpoint.

Use an independently operated pull job with a paired backup-only issuer reader
and dedicated Nextcloud write credentials (D61). Pairing removes manual R2
credential entry; direct bucket-scoped R2 read/list remains an advanced fallback.
It copies only encrypted artifacts and a nonsecret verification manifest. Do not
put Nextcloud credentials in the Worker or decrypt artifacts during routine copies. The operator confirmed
Start9 is the only always-on server and reports
StartOS **0.4.0.3**. Target a separate packaged StartOS backup service using the
[0.4 daemon/volume/health-check model](https://docs.start9.com/packaging/0.4.0.x/main.html).
The service owns its scheduled loop, protected transfer configuration and
verification state. Expose freshness through a health check; it must not require
SSH host cron, edits inside Nextcloud's container or the private age identity.
Pin SDK/image versions and validate package compatibility with 0.4.0.3 before
any installation. Documentation support is not a built/validated package.
The [local copy runner](../tools/backup-copy/README.md) implements additive
read-back verification and source-time health with a loopback WebDAV check.
Atoll Recovery beta.3 is installed on Zion, and live issuer pairing and dedicated
Nextcloud browser authorization succeeded. The runner starts and retains setup
through restart. A controlled staging cron invocation now produced an encrypted
export and fresh service backup status; the original nightly schedule was
restored. The first paired copy hit an edge user-agent rejection, fixed in #58.
Beta.5 is now installed: its runner copied the export into Nextcloud, read-back
matched the source, and isolated restoration verified all escrow keys and the
recovery fence. Separate-machine recovery and offline custody remain untested. See the [controlled recovery check](OPS_STAGING_RECOVERY_REPORT_2026-10-21.md).

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
The operator selected an existing Start9 marketplace notification package on
Zion. NTFY 2.32.0:0 is installed with HTTPS and a dedicated read-only subscriber;
Atoll beta.4 obtained its private write-only publisher through the package
action. Its first failure alert appeared in the authenticated read-only web
subscription. Server acceptance and web receipt are verified; phone/desktop push
and human acknowledgement remain separate checks.
An independent monitor is still required for loss of Zion. Implement/test the
issuance gate before claiming the 24-hour limit is enforced. A 12-hour cadence
provides retry margin; it cannot guarantee the objective through an unbounded
outage. Nightly exports plus a later copy can exceed 24 hours even in routine scheduling, so cadence alone
must not be described as satisfying the accepted maximum.

## Bounded execution sequence and acceptance

1. Configure restricted Vaultwarden shared custody, designate recovery
   operators, and prepare/test the separately held offline recovery copy. Keep all material in
   private operator-controlled channels; no keys or tokens enter chat/history.
2. Confirm Nextcloud WebDAV endpoint, dedicated account, independent recovery
   access and the dedicated StartOS 0.4.0.3 runner package. Confirm retention and alert recipient.
3. Implement the thin local copy/verification orchestration with an injected
   transfer runner; exercise transfer compatibility against local fixtures. Tight regressions: interrupted copy never advances freshness,
   wrong read-back fails, old source with a new copy time stays stale, existing
   snapshots survive retries/deletions. No external host is needed for tests.
4. Obtain a bounded remote plan for that runner/account/directory and stage a
   synthetic encrypted copy. Do not enumerate unrelated Nextcloud files or
   install/modify Start9 services as discovery. An application password or R2
   credential is supplied privately by the operator, never as a prompt value.
5. Observe an actual scheduled staging backup, independently copy it and prove
   recovery from the Nextcloud artifact on a separate machine. A designated
   operator retrieves the identity from the password manager only for the
   approved restore drill. No cards/mints.
6. Restore into an empty protected Node database; verify escrow mapping and
   disabled old credentials/sessions. Preserve the recovery-required fence.
   Define/review reconciliation and stale-client fencing before reopening any
   recovered service; clearing the flag is not a recovery procedure.
7. Only then review production configuration, cadence, freshness enforcement,
   alerts, custody and release approval. Staging success never enables physical
   installation or establishes holder readiness.

Current evidence includes the [staging report](OPS_STAGING_REPORT_2026-10-21.md)
and [actual export/copy/restore report](OPS_STAGING_RECOVERY_REPORT_2026-10-21.md).
Scheduled staging export, independent Nextcloud read-back, NTFY web receipt and
isolated restoration from the copied artifact passed. Password-manager custody,
the operator-held offline recovery copy, separate-machine recovery, reviewed
retention, whole-host monitoring, push delivery, human acknowledgement, 24-hour
issuance enforcement and the reopening procedure remain pending. The staging
cron remains nightly; no production deployment or recovery identity transfer
is certified by the rehearsal.
