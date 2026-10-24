# Provisioner build 7 candidate — 2026-10-23

This is the current preparation record. The October 21 store audit and build 3–6
reports remain dated evidence; their pending-work lists are not the build 7
status. Build 7 passed the on-phone cleanup/reset/reinstallation drill; it is
uploaded to Apple for internal processing; Google upload and final internal
availability remain pending. See the [hardware report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
and [distribution record](PROVISIONER_BUILD7_DISTRIBUTION_REPORT_2026-10-23.md).

## Candidate scope

Version **1.0.0 (7)** retains `com.islandbitcoin.provisioner` and existing store
signing identities. The tracked protocol 2.1 CAP is unchanged:
`applet/target/cashu-javacard-2.1.0.cap`, SHA-256
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.

| Change | Review | Result |
| --- | --- | --- |
| Deliberate reset/reuse from the phone | [#128](https://github.com/lnflash/cashu-card/pull/128), D101 | Review exact identity and authorized key provenance; reject value; check retained spent entries at the recorded mint before separate PIN-protected cleanup; recover reset completion without replaying card writes. |
| Actionable card status | [#129](https://github.com/lnflash/cashu-card/pull/129), D102 | A read-only check directs operators to wallet setup/use, saved work, administrator review or an eligible reset review. |
| Sign-in password processing | [#130](https://github.com/lnflash/cashu-card/pull/130), D103 | Upgrade only after a valid legacy sign-in; retain existing credentials and sessions. Local KDF median approximately 75 ms versus 2.1 s; first legacy sign-in and live end-to-end timing remain separate. |
| Completion and recovery messages | [#131](https://github.com/lnflash/cashu-card/pull/131), D104 | Separate installation saved, wallet setup, stopped attempts, card recovery and service-only retries. App and console use bounded, actionable reasons. |

The sign-in follow-up (D105) keeps the action above the keyboard, adds Next/Go
keyboard actions and removes demo entry points, fake-card flows and demo state.
SuperMax acceptance confirmed the keyboard action is visible and demo entry is gone.
D108 adds native PIN-field keyboard scrolling and Done. The [safe-exit audit](PROVISIONER-SAFE-EXITS.md)
(D109) adds consistent exits while preserving durable work and service holds.

No new applet wire behavior, manager-key guessing, proof/value deletion shortcut,
service origin migration or recovery-drill enablement is included. Existing
quarantine and recovery fences remain enforced.

## Build configuration

Prepare the native candidates in an isolated release checkout using the existing
API origin **`https://cashu-card-ops.old-cell-30e7.workers.dev`**. Do not replace
it with the dashboard hostname: saved work and issuer scope retain the API origin.
Settings shows the public dashboard **`https://ops.cashucard.org`**.

Run `yarn configure:service --origin` with that origin, then `yarn check:release`
in `apps/provisioner`. The repository development default stays loopback.
Installation is enabled; recovery drills and bench runs stay disabled. A passed
configuration check does not certify physical behavior or authorize distribution.

## Service rollout and acceptance plan

The rollout includes #128's eligibility metadata, #130's password processing and
#131's operator copy and bounded reset reasons. It does not change the database
schema, encrypted backup format, issuer, DO/R2 bindings, routes or export schedule.
Deploy the reviewed source first to staging, then to production only within the
approved rollout scope. Preserve the previous Worker version as the rollback
reference. Do not restore an old database to roll back code.

Check the public health response and signed-in console; test one normal valid
sign-in and then one repeat sign-in using credentials entered by the operator.
Collect browser timings only, never passwords or tokens. The first valid legacy
sign-in may still pay the old verification cost; measure the repeat separately.
A native scrypt cost cap retains compatible verification/fallback behavior.
See [performance evidence](OPERATOR_SIGN_IN_PERFORMANCE_2026-10-23.md).

## Remaining acceptance

1. Build identity and subsequent app changes passed all required CI checks
   before merge. The final safe-exit change passed 173 app tests and all 30 CI
   checks. Native CI uses a disposable test signer and staging endpoint; its AAB
   is not a store artifact.
2. The approved SuperMax drill completed fresh settlement/PIN cleanup, reset and
   fresh installation. Batch 6 is acknowledged with a new key ending `72fe` and
   no pending record. The independent read-only USB post-check matched the full
   new key and empty, unowned state. See the [hardware report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
   before treating this as evidence for scenarios outside the successful path.
3. Signed build 7 candidates passed actual bundled origin/gate and build-number
   checks. The iOS archive passed strict deep signature verification with NFC
   TAG and debugging disabled. Android matched the enrolled upload certificate,
   targeted SDK 36 and passed 16 KB alignment for all 24 64-bit libraries. Local
   artifact hashes are retained; store upload/processing is a separate step.
4. Retain the completed SuperMax drill and its dated hardware report.
   The [build 6 end-to-end report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
   already covers holder setup, loading and online/offline payments; it does not
   validate the new mobile spent-entry cleanup/reset implementation; the separate
   build 7 report above records that acceptance.
5. Record the physical iPhone demonstration video and review final store access,
   disclosures and release notes. Upload accepted candidates to existing internal
   tracks before a public submission.

The GitHub release must include the **tracked CAP and its SHA-256 file**. The
existing [protocol v2.1.0 release](https://github.com/lnflash/cashu-card/releases/tag/v2.1.0)
contains that unchanged CAP. Do not move its tag or label it a new applet build.
A build 7 phone release should reference the protocol version and attach those
same verified files. Signed phone binaries remain store artifacts.
