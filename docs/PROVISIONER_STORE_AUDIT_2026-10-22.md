# Provisioner store audit — 2026-10-22

Read-only inspection of the operator's authenticated Chrome sessions. Only the
existing provisioner records were inspected. No store metadata, declarations,
signing enrollment, release tracks or review submissions were changed.

## Existing identities and builds

| Store | Observed record | Evidence and next step |
| --- | --- | --- |
| Apple | Cashu Card Provisioner; Apple ID `6824651949`; bundle ID `com.islandbitcoin.provisioner`; SKU `cashu-provisioner` | iOS version 1.0 is Prepare for Submission. Selected build is 1.0.0 (2). TestFlight build 2 is Approved and assigned to Alpha and Beta. This is TestFlight status, not public App Store approval. |
| Google | Cashu Provisioner (Operator); app ID `4974910129036132835`; package `com.islandbitcoin.provisioner` | Internal testing is active. Latest releases/bundles shows active version code 2 / version 1.0.0 and inactive version code 1 / version 1.0. Preserve the existing application ID. |
| Google signing | Play App Signing enrolled; signing key is in use; separate upload key shown | Private local upload-key certificate has not been compared with the enrolled upload certificate. No reset, key upgrade or certificate export was performed. |

The local Android version code was already 2 and the local iOS build number
was 1. Both candidate build numbers now become **3**, preserving marketing
versions and signing/team configuration. Recheck the consoles immediately
before upload because another upload can consume that number. No signed
archive, bundle or upload is produced by this change. The local Xcode team
setting is not proof of the distribution certificate's identity or validity.

An additional unsubmitted macOS 1.0 platform exists in the Apple record. Leave
it untouched; this release scope remains the iOS and Android phone application.

## Privacy discrepancy requiring correction

Apple App Privacy currently shows no policy URL and an unstarted collection
questionnaire (Get Started). The operator-supplied privacy URL is
`https://getflash.io/legal/privacy.html`, but its provisioner coverage remains
unapproved. Do not mistake the app's working policy link for completed console
metadata. The iOS Support URL and Marketing URL fields are empty. Its release
mode is currently automatic after approval; choose a reviewed release mode
before submitting rather than assuming approval cannot publish the app.

Google already links `https://getflash.io/legal/privacy.html` in its policy
declaration. Google App content lists ten actioned declarations dated October 19. Its saved
Data safety questionnaire answers **No** to collecting or sharing required data
types. That answer conflicts with the current app/service inventory: operator
identifiers, generated device/chip identifiers, batch settings and attempt
activity leave the device and persist in the service. An actioned declaration
is not evidence that the answer describes the current candidate.

Prepare corrected answers from [the data inventory](PROVISIONER-DATA-INVENTORY.md):

- Apple: review linked User ID, Device ID, Other User Content and Other Usage
  Data for app functionality, without tracking, against the final archive.
- Google: review User IDs, Device or other IDs, Other user-generated content
  and Other actions, including credential handling and provider processing.
  Do not infer sharing exemptions or ephemeral processing from a category name.
- Confirm operational retention, account-deletion handling, recovery-evidence
  retention and provider disclosures before publishing either questionnaire.
- Confirm public policy coverage and a real support web URL. Public support
  email is `support@getflash.io`; the terms URL is not a substitute support URL.

The Google questionnaire was navigated without changing any answer or saving a
draft. No reviewer credentials were opened or copied. Apple review-contact and
sign-in input values were not inspected.

## Next release checks

1. Match the existing Android upload certificate to the intended private upload
   key without disclosing private material. Reconcile Apple distribution
   identity, provisioning profile and NFC entitlements through the approved
   owner signing workflow.
2. Complete policy coverage and accurate store disclosures; prepare scoped
   review access and physical Apple-device hardware video under an approved
   device plan.
3. Finish production service/custody/restore and platform capability gates from
   the production-readiness plan before building the production candidate.
4. Review exact signed artifacts, configured origin, build numbers and release
   notes. Obtain explicit approval for testing-track uploads and submission.

No native build, phone/card operation, production service access, new signing
identity, store upload or public release occurred in this audit.
