# Provisioner data inventory for release review

2026-10-21. This inventory describes the issuer provisioning app and ops
service. It is a review input, not a completed store privacy declaration or
legal determination. Review the final deployed service and included SDKs again
before submission.

The operator supplied [Privacy Policy](https://getflash.io/legal/privacy.html)
and [Terms](https://getflash.io/legal/terms.html). The app exposes both before
sign-in and in Settings. The operator confirmed public support at `support@getflash.io`; the app
provides a Support mail link with a readable address if no mail app opens. Confirm that the policy covers this application and these flows;
the existing consumer-wallet wording alone is not evidence of coverage.

| Data | Purpose and handling | Release review still needed |
| --- | --- | --- |
| Operator name and password | Operator authentication; typed password held in app memory. Service stores a password hash, not the typed password. | Account administration, access requests and retention policy. |
| Session bearer token | App memory; service persists token hashes, expiry and revocation. | Hosting/log redaction and operational retention verification. |
| Device identifier, batch and attempt IDs | Associate an operator/device with a reservation and interrupted attempt. These are operational identifiers, not a claim of anonymity. | Map to store identifier categories and document linkage/retention. |
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
