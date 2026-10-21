# Provisioner App Store and Google Play release

2026-10-21. The operator's target is a full production provisioner distributed
through App Store and Google Play. This is the issuer installation application;
it must accurately report awaiting holder setup. Holder wallet ownership/PIN
orchestration remains separate. A demo-only app with installation disabled is
not the completed production deliverable.

## Current release audit

| Area | Evidence / required next work |
| --- | --- |
| Identity | Preserve `com.islandbitcoin.provisioner` and current signing continuity until store enrollment is reviewed. Do not rename IDs or replace keys to bypass a validation setup. |
| Android signing | D56 removes fixed Release passwords/keystore defaults and requires private upload signing inputs through the actual Gradle Release prerequisites. No key or signed artifact was generated for this change. |
| Android native compatibility | Manifest target is API 36; compile SDK is still 35 with RN 0.77.1's toolchain. Review/align compile SDK, AGP and Gradle; build the complete AAB and validate native library page alignment/compatibility. A target integer and JS bundle are insufficient evidence. |
| Apple toolchain | Local Xcode is 26.6; project deployment target is iOS 15.1. A signed archive/export and native NFC/entitlement review remain pending. iOS pods/signing and device installs retain repository approval rules. |
| Runtime endpoint | Only isolated staging has remote functional evidence. Committed default remains local; production configuration/deployment is pending. A store candidate must select its reviewed production origin explicitly. |
| App capability | Installation and recovery-drill gates remain false. Enable only a reviewed platform capability after its exact evidence; never enable recovery drills for distribution. Preserve quarantined chips/journals. |
| Privacy/support | No approved product privacy/support URLs are configured in the app yet. Prepare a concrete data inventory and user-facing links; do not publish fabricated URLs or an unsupported no-data claim. Review app/SDK manifests and store declarations against actual flows. |
| Reviewer access | Prepare scoped reviewer access, instructions and hardware evidence without giving app-store reviewers production manager keys or access to operational batches. Public demo UI does not by itself fulfill review access. |
| Operational recovery | Implement the independent copy service and custody/restore gates in the recovery plan. Production freshness enforcement, alert delivery and restore/reconciliation remain unfinished. |
| Distribution | Developer accounts/listings, upload signing continuity, store metadata, age/content/financial declarations and review notes remain to be confirmed. No upload or submission is authorized merely by this plan. |

## Requirements verified from official sources

Recheck these at submission time; dated requirements are not evergreen policy.

- Apple currently requires Xcode 26+/iOS 26 SDK+ for uploads, effective
  April 28, 2026. Its announced iOS 27 SDK requirement starts April 2027;
  do not apply that future date as today's minimum.
  [Current requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a),
  [announced future requirement](https://developer.apple.com/app-store/submitting/).
- Google Play requires API 36+ for new phone apps/updates at this review date.
  Check exceptions and deadlines on the
  [official target API page](https://support.google.com/googleplay/android-developer/answer/11926878).
- Android App Bundles use an upload key with Play App Signing. Preserve or
  explicitly reconcile existing enrollment rather than create a replacement
  identity automatically.
  [Android signing](https://developer.android.com/studio/publish/app-signing).
- Apple requires accessible privacy policy information and sufficient reviewer
  access. Hardware-dependent apps need a video of the app interacting with
  hardware on a physical Apple device; prepare an approved device/video plan
  when that release evidence is needed. This does not block software work.
  [Review guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [complete review information](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review).

## Execution order

1. Harden upload signing; align and verify native Android release compatibility.
   Keep focused regression coverage and record full-native build results
   separately from passing JS bundles.
2. Implement independent backup transfer/verification and the StartOS package
   locally. Only install on Zion after a concrete bounded remote plan. Finish
   restricted Vaultwarden custody and the designated operator's offline copy;
   neither copy process nor Cloudflare receives that private identity.
3. Complete issuer production UX, privacy/support links and data inventory.
   Reconcile issuer install-only scope with holder-wallet integration requirements;
   no installation receipt certifies holder readiness.
4. Review platform installation evidence and required store hardware video.
   Keep the unavailable full Max drill from blocking steps 1–3. Do not claim
   simulator tests prove a missing device/write capability.
5. Complete the production origin/deployment, backup/alerts, remote-artifact
   restore and recovery-fencing gates; build reproducible store candidates with
   reviewed endpoint, gates, version/build numbers and signing identity.
6. Prepare reviewer account scope, listings, screenshots/video, privacy/data
   declarations and signing/enrollment verification. Use TestFlight/Play testing
   tracks before public release, with explicit authorization for those uploads.
   Submit/publish only the final reviewed artifacts with operator approval.

The [production-readiness plan](PROVISIONER-PRODUCTION-READINESS.md),
[recovery implementation plan](OPS-RECOVERY-PLAN.md) and
[staging evidence](OPS_STAGING_REPORT_2026-10-21.md) remain the detailed sources.
No phone/card operation, production access, store connection or upload occurred
in this audit. No stage in this document constitutes store approval.
