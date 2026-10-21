# Pixel validation setup — batch restart persistence passed

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

## Batch creation and process restart

The operator signed into the validation app. Before creation, selecting the
local mint removed the custom-URL row and shifted the count field. An initial
automation sequence used the stale count coordinates, then Back exited the
app rather than dismissing a keyboard. No batch was created by that sequence;
the operator signed in again. The next sequence inspected updated bounds
after each action, verified count 1 and enabled Start, and created one batch.

Observed UI: `0 of 1 attempts acknowledged`, local validation recovery panel,
`No pause armed`. Install/Continue was never tapped.

Public saved identifiers:

- Batch: 1; operator: 1; key environment: issued.
- Device: `4794470b-dfef-447e-bbd8-7ebadcd9f41d`.
- Batch request: `849592a9-a1fb-40e1-8fe0-24eea8747b30`.
- Count 1; mint `http://127.0.0.1:3338`; `pin_policy: perCard`.
- Load SHA-256:
  `fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee`.
- Active attempt: null; history: empty; next ordinal: 0.

The service database contains one batch, one issued-key escrow row and zero
provisioning attempts. A consistent `VACUUM INTO` snapshot and matching private
runtime were retained in the private run directory as `before-card-write.db`
and `before-card-write-runtime.json`, both mode 0600. Snapshot integrity is
`ok`; metadata confirms one count-1 batch, one escrow row, zero attempts. No
key values were printed or requested through the key API. This is local
retention only, not an encrypted independent export/restore proof.

Forced app stop, then copied its AsyncStorage database to the private run
directory. The saved schema-2 workflow contains the exact identifiers above
and no active attempt. Serialized workflow SHA-256:
`2c7156f33a578f07b0757100b876aa8fc932dc683fc8405f9ec0c5ed54f4210a`.
Relaunched MainActivity; the operator signed in again. The post-restart UI
showed the validation panel, `No pause armed` and `0 of 1 attempts acknowledged`.
A second private copy of AsyncStorage yielded a parsed workflow exactly equal
to the pre-restart value, with the same serialized SHA-256. Batch 1, device ID
and batch request ID survived; active attempt remains null. This establishes
process-restart batch persistence on the Pixel, not card-install recovery.

No NFC, attempt reservation, card authentication, LOAD, DELETE, key rotation
or proof/PIN/owner operation has been performed.
