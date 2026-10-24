# Provisioner data inventory for release review

2026-10-21. This inventory describes the issuer provisioning app and ops
service. Use it when completing store privacy declarations and obtaining legal
review. Review the final deployed service and included SDKs again before
submission.

The operator supplied [Privacy Policy](https://getflash.io/legal/privacy.html)
and [Terms](https://getflash.io/legal/terms.html). The app exposes both before
sign-in and in Settings. The operator confirmed public support at `support@getflash.io`; the app
provides a Support mail link with a readable address if no mail app opens. Confirm that the policy covers this application and these flows;
the existing consumer-wallet wording alone is not evidence of coverage.

| Data | Purpose and handling | Release review still needed |
| --- | --- | --- |
| Operator name and password | Operator authentication; typed password held in app memory. Service retains the password hash; typed passwords remain transient. | Account administration, access requests and retention policy. |
| Session bearer token | App memory; service persists token hashes, expiry and revocation. | Hosting/log redaction and operational retention verification. |
| Device identifier, batch and attempt IDs | Associate an operator/device with a reservation and interrupted attempt. These identifiers link operational records. | Map to store identifier categories and document linkage/retention. |
| Chip CPLC identity, install configuration, dispositions and receipts | Prevent chip reuse, recover interrupted work and retain installation evidence. Service persists journals/records; the app persists its recovery journal through AsyncStorage. | User-facing explanation, device backup behavior and retention/deletion rules that preserve recovery safety. |
| Issued GlobalPlatform manager keys | Service derives and escrows manager keys; they are operational secrets, distinct from holder ownership. They are not holder private keys or PINs. Database schema stores key bytes; no application-level encryption claim is made for those fields. | Restrict service/operator access, verify platform storage protection and complete recovery custody. |
| Escrow backup and recovery metadata | Exports are encrypted to an age recipient. Planned independent Nextcloud copies contain ciphertext. The recovery identity belongs in restricted Vaultwarden custody plus a protected offline copy outside Zion. | Scheduled copy integrity/freshness, retention, alert delivery and actual restore evidence. Selection of custody locations is not proof of implementation. |
| Mint/configuration and installed public card information | Configure and audit issuance. Completion means awaiting holder setup. Current issuer completion does not establish holder ownership or PIN readiness. | Confirm which fields appear in each deployed record and reviewer flow. |
| Network metadata | Requests go to the configured ops origin and hosting providers may process connection metadata. Legal pages open in the system browser on a user press. | Confirm provider logging, IP retention, processing locations and contractual disclosures; do not assert none. |

Sources in this repository: `ops/src/db.ts` (persistent tables and migrations),
`ops/src/auth.ts`, `apps/provisioner/src/store.tsx`,
`apps/provisioner/src/journalStorage.ts`, and the
[recovery plan](OPS-RECOVERY-PLAN.md). Review included dependencies and native
privacy manifests separately; absence of an analytics feature in app code does
not establish a universal no-data-collection claim.

Before store submission, assign responsibility for support and privacy requests,
confirm retention periods and lawful deletion/recovery handling, review whether
operator account deletion requirements apply, and reconcile Apple privacy and
Google Data safety answers with actual deployed behavior. Do not delete a local
interruption journal or quarantined-chip evidence merely to implement a generic
reset or account-removal button.

## Native manifest and store mapping review (2026-10-21)

The app privacy manifest now describes the first-party service flows instead of
leaving collected data empty. All four categories are linked to the operator
account, used for app functionality, and not used for tracking in this app:

| Apple manifest category | Concrete first-party flow |
| --- | --- |
| User ID | Login handle and operator ID associated with sessions and issuance. |
| Device ID | App-generated device UUID, chip CPLC identity and installation public-key identity associated with an attempt. The UUID is not an advertising identifier. |
| Other User Content | Operator-selected batch configuration, including the mint URL and installation settings submitted to the service. |
| Other Usage Data | Batch/attempt reservations, dispositions, completion receipts and their timestamps retained for interruption recovery and audit. |

These names and the app-functionality purpose use Apple's documented [collected
data
types](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)
and
[purposes](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatypepurposes).
The existing required-reason API entries remain unchanged. The unused location
purpose string was removed: the app requests NFC access. Location permission was
removed. This metadata change adds no permission, data field, analytics SDK or
network call.

For Google Data safety review, map these flows against user IDs, device/other
IDs, other user-generated content and other app actions respectively. Review
password/session handling and the ephemeral-processing rules separately; a
hashed password stored by the service is not the same as no credential data. See
Google's [Data safety
instructions](https://support.google.com/googleplay/android-developer/answer/10787469).
Use these inputs when completing the console answers. Hosting-provider logs and
third-party SDK behavior require their own review. Inspect the final signed
archive's aggregated privacy report before submission.

The supplied live privacy and terms pages were checked on this date. Both are
dated January 2024 and describe the consumer Flash wallet; they do not explicitly
explain this tool's chip identities, interrupted-install journal or escrow
recovery. A working link does not settle provisioner coverage. The policy owner
must confirm coverage or approve a supplement, retention/deletion handling and
hosting disclosures before either store submission. Keep the supplied URLs until
a reviewed public replacement is available; no website was modified here.
