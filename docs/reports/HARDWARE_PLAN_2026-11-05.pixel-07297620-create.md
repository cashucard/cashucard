# Pixel 8 Pro creation-only control for 07297620

- Plan ID: `pixel-07297620-create-v1`.
- `approved: true` within the operator's execution instruction for the selected
  07297620 replacement plan. The operator then confirmed **"Pixel 8 Pro (Android)
  is available"** after readiness succeeded. This names only creation, public
  verification and retention of the installation for later planned work.
- Card: exactly `cplc-v1:4790d3213180072976207515`, serial `07297620`, batch
  `7515`. The completed readiness journal is pinned below; fresh NFC identity
  and complete registry/factory proof must still pass before a write.
- Phone: Pixel 8 Pro (`husky`), expected USB serial `42201FDJG00048`. One named
  device only. A different/multiple/unauthorized device stops before install.
- ACS reader: no connection or command belongs to this plan. The operator moves
  the card off it before tapping the phone.

## Prerequisite evidence

The post-reset readiness invocation completed nine commands, proved public
factory keys at version 1, matched empty applications and all four original
platform load files, rematched CPLC, independently decoded its saved evidence
and confirmed reader closure. Its final journal SHA-256 is
`c45962384f33478f1022ece106471e46e5966f8989e8a686504f2a3b5659c29d`, at
`~/.cashucard/readiness-07297620-2026-11-05/pass-2/readiness.json`.

This does not attest the operator's reset method, release an ops fence or prove
creation on this card. All prior evidence, phone apps and journals stay intact.
No ops-service or production mint is accessed, and no production record changes.

## Pinned image, profile and new app

The dedicated `pixel-07297620-create.json` binds this card and its four baseline
E3 frames, plus the known package/instance shapes of this exact private image.
No installation public key is copied from another card; the new key is read
and validated only after creation.

| Item               | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Image source       | `96eb11df58c0969e2d00a1d52a2ca726f8d2d971`                         |
| Manifest SHA-256   | `b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4` |
| CAP SHA-256        | `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27` |
| Load SHA-256       | `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048` |
| Load size / blocks | 28,067 bytes / 114 short blocks                                    |
| Private package    | `F04341534855434D5054`                                             |
| New Android app    | `org.cashucard.card072creation`                                    |
| Version            | 1 / `0.0.1-card072-lab`                                            |
| Journal key        | `cashucard-card072-creation-v1`                                    |

The candidate artifact retained at
`~/.cashucard/qualification-phases-2026-10-31/image/` was checked with the existing
full artifact validator, including generated sources, CAP and load bytes. Do not
rebuild the tracked production CAP or edit generated production assets.

Generate a new project outside the checkout using
`prepare-pixel-07297620.cjs`, from clean signed source. Its manifest removes
Internet and overlay permissions, disables developer support and release
variants, and uses only the published Android debug signer. Retain its own app
ID and storage; never upgrade, uninstall, clear or reset an existing app.
The generated NFC dependency patch checks the known original/patched source
hashes and redacts native exception detail. Do not change the common patch's
old-app allowlist or the old Pixel controllers/profiles/baseline.

Offline qualification completed before generation: all 225 outbox tests passed
with no skips, including the exact candidate load through fake-card SCP02 and
the new controller/generator/UI cases. Targeted formatting and whitespace checks
passed. Initial missing-implementation regressions are retained at
`/private/tmp/pixel-07297620-create-red.log` and
`/private/tmp/prepare-pixel-07297620-red.log`. Full log:
`/private/tmp/pixel-07297620-outbox-full.log`. Native compilation/APK inspection
and physical NFC remain subsequent gates.

## Offline build and device admission

1. Run affected host/controller/generator tests, including the exact pinned load
   through fake-card SCP02, fault cases and fresh-journal behavior. Pin source.
2. Generate the isolated project into a new private host directory. Build the
   SDK and install frozen dependencies, then bundle JS and build the debug APK.
   This is a host-only build; no `run-android`, attached-device build or iOS
   signing/pods. Preserve build logs and the resulting APK/source/runtime hashes.
3. Inspect the APK with Android tools: exact new app/version, no Internet or
   overlay permission, NFC required, known debug signer, bundled core/profile,
   correct source/load/manifest and no testing FakeCard code. Bind the actual
   APK SHA-256, signer and `lab-build.json` in a new private activation receipt
   before device installation. No unknown package or signer is admitted.
4. One `adb devices -l` inventory. For the exact named Pixel, record only model,
   Android version/build/fingerprint/security patch and this new package's
   presence. Stop on a different/unauthorized device or if the package already
   exists; no `install -r`, downgrade, uninstall or app-data clear is allowed.
5. Install the exact APK once, without replacement, on the named serial. Query
   only its package/version, launch its exact MainActivity and verify its process
   is running. Existing provisioner and lab packages are untouched. Do not dump
   unrelated applications, credentials or broad logcat.

The native build and device actions are this private control, not a claim that
ENG-738's owner H0–H3 or production release gates have passed. No iOS operation or
production signing identity is used.

## One NFC invocation and installed end state

The operator removes 07297620 from the reader, keeps it off the phone initially,
then taps **START CREATION TEST** in the new app and holds it still at the Pixel's
NFC antenna. Arming is consumed in this new app's durable journal before NFC
starts. No automatic start on launch, restart, retry or journal-clear action.

| Stage              | Commands                                                                                             | Nominal / maximum |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------: |
| Initial identity   | SELECT ISD, GET CPLC, exact raw/parsed match                                                         |             2 / 2 |
| Factory channel    | SELECT ISD, INITIALIZE UPDATE at version 1, prove factory cryptogram, then one EXTERNAL AUTHENTICATE |             3 / 3 |
| Initial registry   | Full applications/load-files; exact empty/four-file baseline                                         |             2 / 8 |
| Load               | INSTALL for load, then the exact 114 pinned blocks                                                   |         115 / 115 |
| Create             | Opener `...4D`, then main `...01`; privileges zero, fixed parameters                                 |             2 / 2 |
| Installed registry | Full applications/load-files; exact two instances, private package plus all four platform frames     |             2 / 8 |
| Public checks      | Full main SELECT CPROT/2, INS 7D format-5 unset-up diagnostics, INS 7A new valid compressed key      |             3 / 3 |
| Final identity     | SELECT ISD, GET CPLC; exact match                                                                    |             2 / 2 |
| Total              | No extra command classes                                                                             |         131 / 143 |

Hard ceiling **160 commands**, a **120-second** gate on further transmissions,
**30-second** response bound shortened by remaining budget, and the unchanged
Android IsoDep timeout **15,000 ms**, reported maximum transceive at least 261.
These limits grant no retries or unlisted command type. Each secure command is
held to its exact prebuilt bytes. Management success requires `9000` and only
an empty body or GP `00` acknowledgement.

Persist public intent before each command and public reply before continuation.
Never journal authentication bodies, challenges/MACs or native exception text.
Each registry kind is complete within four pages and exact canonical E3 sets.
The four platform frames, including CardDocLite, remain unchanged. Diagnostics
must have setup state/pool/DLEQ zero, format 5, valid counters and commit floor
at least 128. The newly read public key must be a valid compressed secp256k1 point.

Success leaves the private installation **installed and unset-up**, terminal
status `installed-unset-up`, with recorded key, image, full installed registry,
diagnostics, final identity, timings and NFC session metadata. No SETUP, proof,
signing, export, retirement, DELETE or manager-key change. The shared NFC session
always requests teardown; record that request without claiming an independently
observed physical closure. No second connection follows automatically.

On any failed/late/uncertain reply or journal/field loss, stop and retain the
card/journal. No automatic cleanup, second install, key guess, reset or new plan
is authorized. Unconfirmed creation is not a card refusal or permission to erase.

## Collection and next gate

After a terminal result, stop only the new app process. Copy only its own
AsyncStorage database and necessary sidecars consistently through `run-as` into
new private host files. Parse the fixed journal key locally and retain an
immutable JSON copy/hash; no keys or data from other apps are collected.
Independently decode its public registry/key/diagnostic evidence against this
profile and the pinned build/APK receipt. Retain a hardware report with device
OS, APK/source/image hashes, command count, full result and exclusions.

A successful creation is the prerequisite for a separate smallest-payment
phone/till plan. No funds are loaded by this control. The original acceptance
condition remains independent exact-once merchant proceeds, not creation alone.
