# Provisioner build 7 distribution preparation — 2026-10-23 Pacific

Source is merged main `860eba49a16dcb36b5cff651e18d13a98c90f405` (#137), including
the reset/reuse, status, sign-in, copy, keyboard and safe-exit improvements. The
isolated candidate checkout changes only the public API origin to
`https://cashu-card-ops.old-cell-30e7.workers.dev`; the repository's development
default remains loopback. Version is **1.0.0 (7)**,
`com.islandbitcoin.provisioner` on both platforms.

## Physical acceptance

The [mobile reset report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
records actual SuperMax cleanup, reset and fresh installation, followed by an
independent read-only ACS post-check. The same chip has a new public key matching
its acknowledged installation, applet 2.1, all 128 slots empty, no owner/PIN/record
and a selectable tag. It requires holder-wallet setup before loading or spending.
This report does not expand the physical test's coverage limits.

## Signed artifacts

| Platform | Artifact SHA-256 | Verification |
| --- | --- | --- |
| Android AAB | `906dfaab841ef381ebe76d0a4fc9c2f109cf1ecd74f672a49651636f418007cc` | Build 7, SDK 36, non-debuggable; all 24 64-bit native libraries passed 16 KB alignment; JAR signature verifies and public upload-certificate SHA-256 matches Play enrollment. |
| iOS IPA | `9db84c0ec82fa450764ad654a570e0336c3f4ef1192b15d2819e70070511abc8` | Build 7, Apple Distribution signing; archive passed deep strict verification, team `H7UAM79QQP`, NFC TAG entitlement, `get-task-allow=false`. Exported IPA bytecode matches the verified archive. |

The Android upload certificate is unchanged:
`D1:C1:DE:8B:70:04:BF:43:14:BB:48:83:B1:7A:13:33:59:73:30:C6:0A:D4:47:E0:42:74:CC:B4:25:3D:1B:5E`.
Actual Hermes bytecode on both platforms contains the production API origin and
public dashboard URL. Its gate module enables installation and disables recovery
drills and bench runs. Release preflight passed before native builds. Signing
inputs stayed in private files/process environments, outside chat and arguments.

Artifacts, public verification summaries and build/upload logs are retained in
the operator's local release-candidates directory, outside the repository.

## Internal distribution status

- **Apple:** Xcode reported **Upload succeeded** and **Uploaded package is
  processing** at approximately 2026-10-24T00:18:21Z. The upload used
  `testFlightInternalTestingOnly=true`. Processing, encryption compliance and
  the internal group's final Testing status have not yet been confirmed.
- **Google:** signed, validated AAB prepared; build 7 has not been uploaded or
  rolled out to internal testers yet. Chrome's current session disables
  JavaScript from Apple Events; the operator has been asked to re-enable it to
  continue the existing signed-in store workflow.
- No external TestFlight distribution or public store submission was performed.
  The physical reviewer video and final review access remain separate work.

## GitHub applet asset

A **draft**, unpublished phone release `provisioner-v1.0.0-build.7` targets the
tested source and has the tracked `cashu-javacard-2.1.0.cap` plus its `.sha256`
attached. Its SHA-256 is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
This is the unchanged [protocol v2.1.0 applet](https://github.com/cashucard/cashucard/releases/tag/v2.1.0),
not a new firmware version. The existing protocol tag was not moved.
