# Signed release candidate acceptance — 2026-10-22

These are review candidates, not approval for public store publication. Both
artifacts use `com.islandbitcoin.provisioner`, version 1.0.0, build 3, and the
production HTTPS ops-service origin. The operator subsequently approved
internal distribution of both artifacts; see the upload record below.
Source: main `1ff98eb978eb587d7703b4dd928259060880005e`, with the service-origin
configuration overridden for the candidate builds only.

## Android

The signed AAB's certificate matches the existing Play upload certificate.
The actual bundle targets SDK 36, is not debuggable, and passes the 16 KB ELF
alignment check for all 24 included 64-bit native libraries. Its only platform
permissions are Internet, NFC, vibration and the app's private receiver permission.
Cleartext traffic uses the target-SDK default of disabled. Both signing
passwords were checked absent from all inflated bundle entries.

AAB SHA-256:
`bdf1c81838666490d1d8c0be0f6eebca959da9ec8210f02096182f99de161022`.

## iOS

A generic-device Release archive and App Store Connect export completed using
Island Bitcoin's distribution identity and the app-specific distribution
profile. The archive passed strict deep signature verification. The actual
archive has team H7UAM79QQP, NFC TAG entitlement and debugging disabled.
Arbitrary network loads are disabled; local networking remains allowed.
The exported IPA's identifier, version, build and bundled production origin
were independently checked.

IPA SHA-256:
`ff15826428b92ed874fe0db4c0121f8d17d613664fa8251e4781b6a4ba297f83`.

## Production recovery acceptance

The independent Nextcloud production copy was downloaded with its manifest.
Its size and SHA-256 matched. The production identity was retrieved from
Vaultwarden into process memory and used to restore into a temporary empty
local database. SQLite integrity passed; the recovery fence was set; the one
operator's credentials were disabled. Sessions, pairings, recovery connections
and copy receipts were absent. The temporary plaintext database and associated
files were removed. No identity file was written to the laptop.

Snapshot: `2026-10-22T21:14:55.704Z-e135fc43-608e-44c9-bd5d-ff285ce21978.age`.
This initial production snapshot contains no batches, issued keys or cards.
It proves the production custody/copy/decryption/fencing path, not recovery of
production card mappings. The separate staging restore covers populated keys.
Both staging and production schedules remain enabled; meridian-jabari's
schedule alone was retired with operator approval.

## Release gates at build 3 (superseded for internal installation by D74)

- Card installation remains disabled (`CARD_INSTALLATION_VALIDATED=false`).
  Recovery drills and bench tools also remain disabled. Existing hardware
  reports must be reconciled with the platform release capability before a
  public provisioning release; these candidates cannot install cards.
- Apple's encryption/export-compliance classification is not declared. The
  app includes SCP02 cryptography as well as platform TLS; classification must
  account for the actual shipped implementation.
- Monitoring that can report loss of Zion from outside Zion remains open.
- Atoll's additional-issuer reply-loss fix still needs its final reviewed
  package build, CI and runtime acceptance; the currently installed package
  already has healthy independent staging and production copy histories.
- Final store declarations, reviewer access/instructions and submission review
  remain necessary. No public submission is authorized by this report.

## Internal distribution — operator approved

Google Play accepted version code 3 and published release
`1.0.0 (3) - production service internal` to the internal track on October 22.
The console reports available to internal testers; the existing Flash Alpha
Test List has five users. The release notes explicitly limit testing to sign-in,
service connectivity and the operator interface, with physical installation
disabled. No supported devices were removed. The sole warning is the absent
deobfuscation file; this build does not enable ProGuard/R8 minification.

Xcode uploaded the archive successfully with `testFlightInternalTestingOnly`
enabled. App Store Connect acknowledged build 1.0.0 (3) and began processing.
No public App Store submission or external TestFlight distribution was made.
Processing completed and Apple identifies build 3 as Internal. The operator
answered No to France distribution. The standard-encryption-outside-Apple-OS
option matches the bundled SCP02 implementation. After compliance completion,
the Alpha internal group shows build 1.0.0 (3) as Testing, with three testers
and automatic Xcode-build distribution enabled. Build 2 remains available; no
external group was changed. Both platforms are now available for internal testing.


## Installation-enabled internal build 4

D74 records the operator's explicit approval to enable installation on both
platforms. Build 4 uses source `727c742` plus the candidate-only production-origin
override. Both native builds succeeded. Actual Hermes disassembly independently
confirms installation true, recovery drills false and bench runs false in each
platform's bundled release-gate module. The iOS archive passed strict deep
signature verification and build-number/origin checks. Android passed the
enrolled signing-certificate match, version/origin checks, signing-password
exclusion and the 24-library 16 KB ELF check.

Android AAB SHA-256:
`d0c22079c722c1bb9474c58ca6d7fdd50305b9b88d170b0d4d3f1405e967321c`.

The new coordinator-default test failed before the flag change and passed
afterward; all 133 app tests passed, TypeScript passed, and changed-file ESLint
passed. No physical device or card was operated.

The first iOS upload attempt failed before transport because Xcode's saved
Apple account credentials were missing a username. Reauthentication was
requested; the valid archive is retained for upload without another build.


### Build 4 distribution follow-up

Google Play reports `1.0.0 (4) - card installation enabled` available to the
existing internal testers. After the operator reauthenticated Xcode, the
internal-only iOS upload succeeded on October 22 at 22:54 UTC. Apple accepted
build 1.0.0 (4) for processing. Processing completed; standard encryption and
the operator-approved No-France answer were saved. Alpha now shows build 4
as Testing for all three internal testers. Both stores therefore have the
installation-enabled build available internally. PR #87 passed all 29 checks and merged as
`5733d1e7388632ed230723544995431e57a7cc29`. No public submission was made.
