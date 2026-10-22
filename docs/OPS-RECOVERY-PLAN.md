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
authenticator MFA enabled. The subsequent
[separate-Mac staging restore](OPS_SECOND_MAC_RESTORE_REPORT_2026-10-22.md)
passed from that offline copy. The separate
[production custody check](OPS_PRODUCTION_CUSTODY_REPORT_2026-10-22.md)
now records a new production identity, verified offline copy and fresh-unlock
Vaultwarden retrieval; an actual production export/restore remains pending.
Do not depend on
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
The beta.5 rehearsal copied the export into Nextcloud, read-back
matched the source, and isolated restoration verified all escrow keys and the
recovery fence. Beta.6 subsequently added the verified independent-copy receipt
flow. Separate-Mac staging restoration also passed as linked above. See the
[controlled recovery check](OPS_STAGING_RECOVERY_REPORT_2026-10-21.md).

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

## Issuance enforcement implementation contract

The source implementation is merged in PRs #68–77. The bounded staging
receipt/refusal/recovery drill passed; see the [staging recovery report](OPS_STAGING_RECOVERY_REPORT_2026-10-21.md).
Policy remains opt-in and production activation still requires release review.
Authenticated status can observe the configured recovery issuer before policy
activation, so verifying copy health never requires enabling issuance enforcement.
Keep the current D61 companion credentials read-only. Add a separately approved,
revocable copy-attestation scope; existing connections must not gain that scope
through migration. A recovery administrator must deliberately enroll the copier
for this authority. It does not receive plaintext escrow or the recovery key.

The exporter must publish the exact snapshot `exported_at`, ciphertext SHA-256
and byte length plus stable issuer UUID as immutable source metadata. Atoll may submit a receipt only
after reading the artifact and its manifest back from Nextcloud and comparing
both against the source. The issuer validates the object identity, digest, size,
issuer and snapshot time against its own export metadata. Future-dated evidence,
unknown objects, invalid metadata and revoked attestors cannot advance health.
A retried or delayed receipt cannot move freshness backward or refresh an old
snapshot by changing its copy time. This is a trusted copier assertion, not an
independent cryptographic proof of storage at Nextcloud.

Evaluate the age of the latest eligible source snapshot using the service clock.
Missing evidence or an age of **24 hours or more** blocks new issuance. Export
success in R2 alone cannot satisfy this gate. Keep export health and independent
copy health distinct in the authenticated status response. A restored service
remains fenced and must not inherit usable attestation credentials or a healthy
receipt from the snapshot.

Enforce the decision inside the same shared domain transactions used by Node and
Workers. New batch creation derives escrow keys eagerly, so it must be covered,
as must new attempt reservation and key disclosure. Matching idempotent batch
and reservation lookups can return their existing state without creating work.
Do not add this check to the general `writable` helper: outcome recording,
quarantine, terminal dispositions and safe reads must remain possible during a
backup outage. Key disclosure during interrupted-install recovery needs an
explicitly reviewed recovery exception; a stale backup must not become a generic
permission to fetch keys by labeling a request a retry. Cached keys already on a
phone cannot be revoked by this server check; the mobile flow must honor the
service refusal before starting another installation, and that limit must be
stated in the operational guarantee.

Implement in reviewable slices:

1. Export metadata and local receipt validation/persistence, with an explicit
   separately granted capability and no credential upgrade by default.
2. Shared transactional issuance checks, authenticated health and mobile refusal
   handling; preserve the existing recovery fence and stopped-attempt evidence.
3. Atoll read-back receipt delivery with durable retry, followed by a bounded
   staging drill. Production activation and cadence changes remain separate.

Keep regression coverage focused on authority and failure boundaries: legacy
readers cannot attest; bad source metadata cannot advance health; an old snapshot
with a new receipt stays stale; exact 24-hour expiry blocks new work atomically;
replay does not allocate another batch/attempt; outcome recording still works;
and restore cannot inherit healthy authorization. Exercise the shared domain on
Node, with a small real Workers/R2 test for metadata and receipt routing. Run each
behavior regression against the old implementation before the fix and record
that result in its PR. No hardware or live production service is needed.

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
isolated restoration from the copied artifact passed. Staging Vaultwarden custody
and the operator-held encrypted-drive copy also passed their documented checks.
The [separate-Mac staging restore](OPS_SECOND_MAC_RESTORE_REPORT_2026-10-22.md)
now passed from the encrypted offline copy, including exact escrow comparison,
credential/fence checks and plaintext-database cleanup. Production identity custody
subsequently passed the [documented check](OPS_PRODUCTION_CUSTODY_REPORT_2026-10-22.md).
Actual production export/copy/restore acceptance, reviewed
retention, whole-host monitoring, push delivery, human acknowledgement, production 24-hour
copy acceptance and the reopening procedure remain pending. The live staging
refusal/recovery drill passed with the policy restored off afterward. The staging
cron remains nightly; no production deployment or recovery identity transfer
is certified by the rehearsal.

The later [production deployment](OPS_PRODUCTION_DEPLOYMENT_REPORT_2026-10-22.md)
has its required-copy policy enabled and initially rejects issuance for missing
evidence. Staging remains nightly, with a separate production 12-hour cron in the
operator-selected freed slot. D73 defines additive issuer support in Atoll so
production does not replace staging's verified source or reuse its copy history.
