<a id="android-api-36-native-build--local-test-signing-only"></a>

# Android API 36 native build: local test signing only

2026-10-21. Based on merged #46 (`281a936`) with compile SDK 36, AGP 8.10.1,
Gradle 8.11.1/checksum and an isolated staging-origin override. The existing
application ID `com.islandbitcoin.provisioner`, target SDK 36, four ABIs,
React Native 0.77.1/dependencies, installation gate false and recovery-drill gate
false are unchanged. Production store records already exist in both stores;
this build neither reads nor changes their signing identity or enrollment.

## What ran

- Host-only Gradle configuration/preDebugBuild passed with the new toolchain.
- Full `:app:bundleRelease --max-workers=2` passed: 258 tasks, all four configured
  architectures, including vital Release lint. No phone, card or emulator.
- A fresh RSA test signer was generated into a separate protected local directory
  using a random password held only in the build process/private environment.
  Its subject is explicitly `Cashu Local Build Test / NOT FOR DISTRIBUTION`.
  It is not registered with Play and is not a replacement upload key.
- `jarsigner -verify` verified the AAB signature. Self-signed test certificates
  are not a production trust/custody assertion.
- Bundletool 1.18.3 validates the AAB. Its actual manifest reports compile SDK 36,
  target SDK 36, expected package ID and `debuggable=false`.
- The actual bundle configuration requests `PAGE_ALIGNMENT_16K` for uncompressed
  native libraries. All 24 arm64-v8a/x86_64 ELF libraries have 16KB-compatible
  LOAD alignment and congruent file/virtual offsets, checked with NDK llvm-readelf.
- Two focused artifact regressions cover the prior compile-SDK-35 mismatch,
  a debuggable release, missing/4KB/mixed ELF LOAD segments and misaligned
  offsets. They failed with SDK/alignment validation disabled and passed with
  it restored. No synthetic hardware captures or runtime test claims.

AAB SHA-256:
`2b4655a95db7c768d766aebf1211e3e5f9c5a50751b7bf4bb9a405843fde0525`

Test signer certificate SHA-256:
`a2c96881a0a685cbbbeecc3b55801bc6c21f3416e8922c6369718eeb5d6a8f81`

The local copy is labelled `NOT-FOR-DISTRIBUTION-api36.aab` in the protected
native-build evidence directory. No private key/password is included here.

## Limits and reproducible checks

This verifies host compilation and artifact format/alignment. Execution on
Android 16/16KB devices, NFC correctness, iOS compatibility, production backend
readiness, Play signing continuity and store approval require separate checks.
No upload, store connection or installation occurred. CMake emitted
SDK-XML-version warnings from the local installed tools; these were nonfatal and
are not hidden by this change.

The PR adds a native workflow restricted to Android toolchain/native dependency
and checker changes. It builds with a fresh test-only signer, verifies artifact
SDK/release/alignment and does not upload the bundle. Its CI result must be
recorded independently of this local report.

```sh
python3 scripts/test_android_bundle.py
python3 scripts/check-android-bundle.py android/app/build/outputs/bundle/release/app-release.aab \
  --readelf /path/to/ndk/toolchains/llvm/prebuilt/HOST/bin/llvm-readelf
```

Run from `apps/provisioner`; bundletool must be on PATH, or supply its pinned
jar through `BUNDLETOOL_JAR`. Native signing uses D56's private environment
inputs; do not generate a new production upload identity from these test steps.
See [D57](../DECISIONS.md#d57) and the [store release plan](../PROVISIONER-STORE-RELEASE.md).
