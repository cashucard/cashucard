# Pixel validation setup — in progress, no card operations

ENG-741, 2026-10-20. The operator explicitly approved a local validation
build/install and one-card batch persistence check, stopping before NFC.
The card was to remain away from the Pixel. No card mutation is authorized
by this setup.

## Environment and build

- Pixel 8 Pro, ADB `42201FDJG00048`; Android 17/API 37 as recorded in the
  earlier phone-CPLC report. No other phone was used.
- App `com.islandbitcoin.provisioner`, Debug arm64 build.
- Source `a8cee93998dfff4f6254c65217ee78ec0e03d91d` in a detached isolated
  checkout `/Users/dread/Repos/cashu-card-pixel-drill`.
- Sole tracked local delta: both release gates set true in `releaseGates.ts`.
  Delta SHA-256: `e934be44a07f6e35a9fe8254f86a23d827a1d810aa3f078979b588ba557af9b3`.
  These edits are uncommitted; the review checkout retains both gates false.
- Build: JDK 17, Node 22.23.3, Gradle `:app:assembleDebug`,
  `-PreactNativeArchitectures=arm64-v8a -PreactNativeDevServerPort=8085`.
  Build succeeded (154 tasks).
- APK SHA-256:
  `d80e3904486349653bc3c14d03b4bbf006e01a63e6a36b2b50e5cbc11a6c3045`.
- Debug JS is served separately by isolated Metro on 8085, not embedded in
  the APK. A host-fetched Android development bundle has SHA-256
  `dc2a1de8e545787bf25a2808f77a3d80944ae7440050f01563a3a55cea9e0136`;
  both enabled gate assignments were checked in that bundle. This hash
  describes the saved host fetch, not an attested capture of phone traffic.

The existing package was updated with `adb install -r`; no uninstall or
clear-data operation occurred. Added the isolated Metro reverse mapping
8085 -> 8085 while preserving service mapping Pixel 8821 -> Mac 8822.
Forced app stop and launched its MainActivity. The sign-in screen was
observed; the operator was asked to enter the retained local login privately.
No credentials were entered by the agent or included in this report.

## Service

The isolated Node service listens only on Mac `127.0.0.1:8822`. Its mint list
is only `http://127.0.0.1:3338`; no mint calls are part of this check. Its
private state remains in the documented mode-0700 local run directory with
mode-0600 database/runtime/login files. No production system is involved.
The tracked CAP is not installed in this setup; its repository SHA-256 is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.

## Results pending

Validation-app sign-in, one-card batch creation and restart persistence are
not yet established. No NFC, attempt reservation, card authentication, LOAD,
DELETE, key rotation or proof/PIN/owner operation has been performed.
