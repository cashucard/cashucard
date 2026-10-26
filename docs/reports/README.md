# Reports

Dated evidence: what ran, on which card, phone or service, and what was and
was not covered. Each report keeps the date and scope of its run; a later
report or decision does not rewrite it. The plans here are the approved scope
for a named run. Repeating a run requires its own approval.

Start with the [physical card end-to-end run](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
and the [mobile reset report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md).

## Card hardware

| Date | Report | Subject |
| --- | --- | --- |
| 2026-09-01 | [J3R452](HARDWARE_TEST_REPORT_2026-09-01.j3r452.md) ([中文](HARDWARE_TEST_REPORT_2026-09-01.j3r452.zh-CN.md)) | Historical upstream report: the applet on an NXP JCOP4.5 J3R452 |
| 2026-09-22 | [J3R180](HARDWARE_TEST_REPORT_2026-09-22.j3r180.md) | Historical upstream report: the applet on an NXP JCOP4 J3R180 |
| 2026-10-14 | [2.1 on J3R180](HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md) | Protocol 2.1 installs and passes selftest on a J3R180 |
| 2026-10-18 | [Phones install over NFC](HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md) | Phones install 2.1 on a J3R180 over NFC |
| 2026-10-20 | [USB CPLC identity](HARDWARE_TEST_REPORT_2026-10-20.d321-cplc.md) | Card identity read through a USB reader |
| 2026-10-20 | [USB preflight](HARDWARE_TEST_REPORT_2026-10-20.d321-usb-preflight.md) | An incomplete USB preflight attempt |
| 2026-10-20 | [Phone CPLC identity](HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md) | Card identity read by the provisioner on phones |
| 2026-10-20 | [Pixel batch persistence](HARDWARE_TEST_REPORT_2026-10-20.pixel-batch-persistence.md) | Pixel setup: saved batches survive a restart |
| 2026-10-20 | [Pixel recovery](HARDWARE_TEST_REPORT_2026-10-20.d321-pixel-recovery.md) | Replacement and interrupted-install recovery at three boundaries |
| 2026-10-20 | [Pixel escrow recovery](RECOVERY_TEST_REPORT_2026-10-20.pixel-escrow.md) | Local encrypted escrow restored after the Pixel drill |
| 2026-10-20 | [Max setup](HARDWARE_TEST_REPORT_2026-10-20.max-validation-setup.md) | Max setup: persistence passed, no card operations |
| 2026-10-20 | [Max candidate card](HARDWARE_TEST_REPORT_2026-10-20.d321-max-candidate.md) | Read-only USB discovery of the card for the Max drill |
| 2026-10-20 | [Max post-check](HARDWARE_TEST_REPORT_2026-10-20.d321-max-postcheck.md) | Max reads the card's identity after Pixel provisioning |
| 2026-10-20 | [Max recovery drill](HARDWARE_TEST_REPORT_2026-10-20.d321-max-recovery.md) | Max fresh-card recovery drill, stopped in progress |
| 2026-10-23 | [Reset preflight](HARDWARE_TEST_REPORT_2026-10-23.j3r180-reset-preflight.md) | Read-only check of card 09336320 before its reset |
| 2026-10-23 | [Owned-card reset](HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md) | USB reset of card 09336320 to factory manager keys |
| 2026-10-23 | [Physical end-to-end run](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md) | Install, holder setup, funding, payments and settlement on card 09336320 |
| 2026-10-23 | [Mobile reset and reuse](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md) | Reset and reinstall of card 09336320 from a phone |

## Hardware plans

| Date | Plan | Subject |
| --- | --- | --- |
| 2026-10-20 | [Device validation](PROVISIONER-DEVICE-VALIDATION.md) | Proposed owner-run checklist for the installation gate |
| 2026-10-20 | [First write drill](PROVISIONER-FIRST-WRITE-DRILL.md) | Proposed scope for the first provisioning write |
| 2026-10-20 | [Max write drill](PROVISIONER-MAX-WRITE-DRILL.md) | Proposed scope for an iPhone write run |
| 2026-10-23 | [Owned-card reset drill](OWNED-CARD-RESET-DRILL.md) | Approved scope for the reset of card 09336320 (completed) |
| 2026-10-23 | [Physical end-to-end plan](PHYSICAL-CARD-E2E-PLAN.md) | Approved devices and value cap for the end-to-end run (completed) |
| 2026-10-23 | [Spent-entry audit](SPENT-SETTLEMENT-AUDIT-PLAN.md) | Read-only check that card 09336320's spent entries settled (completed) |

## Ops service

| Date | Report | Subject |
| --- | --- | --- |
| 2026-10-21 | [Staging deployment](OPS_STAGING_REPORT_2026-10-21.md) | Isolated staging deployment: initial stop and follow-up |
| 2026-10-21 | [Staging restore](OPS_STAGING_RECOVERY_REPORT_2026-10-21.md) | Staging independent copy and isolated restore |
| 2026-10-22 | [Second-Mac restore](OPS_SECOND_MAC_RESTORE_REPORT_2026-10-22.md) | Staging recovery on a separate Mac |
| 2026-10-22 | [Production deployment](OPS_PRODUCTION_DEPLOYMENT_REPORT_2026-10-22.md) | Production service preparation and deployment |
| 2026-10-22 | [Production custody](OPS_PRODUCTION_CUSTODY_REPORT_2026-10-22.md) | Production recovery custody |
| 2026-10-23 | [Operator sign-in performance](OPERATOR_SIGN_IN_PERFORMANCE_2026-10-23.md) | Operator sign-in timing |

## Provisioner builds

| Date | Report | Subject |
| --- | --- | --- |
| 2026-10-21 | [Android build](PROVISIONER_ANDROID_BUILD_REPORT_2026-10-21.md) | Android API 36 native build, local test signing only |
| 2026-10-21 | [iOS resources](PROVISIONER_IOS_RESOURCE_REPORT_2026-10-21.md) | iOS resource preparation check |
| 2026-10-22 | [Release candidate](PROVISIONER_RELEASE_CANDIDATE_REPORT_2026-10-22.md) | Signed release candidate acceptance |
| 2026-10-22 | [Store audit](PROVISIONER_STORE_AUDIT_2026-10-22.md) | App Store and Google Play readiness audit |
| 2026-10-23 | [Build 6 distribution](PROVISIONER_BUILD6_DISTRIBUTION_REPORT_2026-10-23.md) | Build 6 internal distribution |
| 2026-10-23 | [Build 7 candidate](PROVISIONER_BUILD_7_READINESS.md) | Build 7 scope and checks |
| 2026-10-23 | [Build 7 distribution](PROVISIONER_BUILD7_DISTRIBUTION_REPORT_2026-10-23.md) | Build 7 distribution preparation |

Screenshots cited by the reports are in [`hardware/`](hardware/).
