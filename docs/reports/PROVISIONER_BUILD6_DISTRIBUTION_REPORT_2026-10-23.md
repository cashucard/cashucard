<a id="provisioner-build-6-internal-distribution--2026-10-23-utc"></a>

# Provisioner build 6 internal distribution: 2026-10-23 UTC

Source is main `be60adf30e49183dee849446bb5c683c8a2ea86e` (PR #108), including PR #107's batch-closure and operator UX changes. The isolated candidate checkout changed only the public service origin to `https://cashu-card-ops.old-cell-30e7.workers.dev`; the repository development default remains loopback. The production Worker with migration 8 was deployed first as `2d172d3e-54b0-4682-9473-e34c0464a530`.

## GitHub applet release

[`v2.1.0`](https://github.com/cashucard/cashucard/releases/tag/v2.1.0) targets the merged source and contains `cashu-javacard-2.1.0.cap` and its `.sha256` file. The tracked CAP, deployment guide, and downloaded release asset agree on SHA-256 `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`. The CAP is 95,167 bytes. This is the card protocol release; the signed phone apps remain store artifacts.

## Signed phone candidates

Both candidates are `com.islandbitcoin.provisioner` version 1.0.0, build 6. Recovery drills and bench tools remain disabled. No phone, reader, or card was operated during these builds.

| Platform | Artifact SHA-256 | Verification |
| --- | --- | --- |
| Android AAB | `99d482f9afc64424a84f74f3f32d73b7147b5ebe6aaf1c21a0bf048634060b29` | Version code 6; target SDK 36; all 24 64-bit libraries checked for 16 KB alignment; upload certificate SHA-256 matches Play enrollment `D1:C1:DE:8B:70:04:BF:43:14:BB:48:83:B1:7A:13:33:59:73:30:C6:0A:D4:47:E0:42:74:CC:B4:25:3D:1B:5E`; signed bundle verifies. |
| iOS IPA | `f1d272d23777e3bbe00a7a1e812f2bde3a05d205bb14e7813b6c927bcf4160a1` | Distribution-signed archive passed deep strict verification; build 6, team `H7UAM79QQP`, NFC entitlement present, `get-task-allow=false`. |

The actual Android and iOS bundles contain the production HTTPS service origin.
The app's release preflight passed before both native builds. Signed candidates
and logs are in the operator-only local release-candidates directory, outside
the repository.

## Internal tracks

- Google Play internal testing accepted version code 6 and shows `1.0.0 (6) - batch recovery and operator UX` as **Available to internal testers**. The only warning is no deobfuscation file; this build does not enable R8/ProGuard minification. Play reported no loss of supported devices from build 5.
- App Store Connect accepted the internal-only Xcode upload. Build 6 processed, and its standard-encryption and No-France answers were saved, matching prior builds. Alpha shows `1.0.0 (6)` as **Testing** for its three internal testers. External TestFlight and public App Store distribution were not changed.

The public store submissions remain a separate review step. Reviewer access and
a hardware demonstration video still need acceptance against the final build;
issue #92 tracks safe reprovision/reset as a separately disclosed limitation.
The app must describe installed cards as awaiting holder-wallet setup before
loading or spending.
