# Pixel 8 Pro ready for the 07297620 creation tap

The reviewed standalone app is installed without replacement and launched on
the expected Pixel. The next action is the operator's physical NFC tap; no
creation controller or NFC request was armed by the agent. This report does
not claim that the card's private installation has been created.

## Device and exact package

- Pixel 8 Pro, USB serial `42201FDJG00048`. One named device was
  present and authorized. Android `17`, build
  `CP3A.261005.005`, security patch `2026-10-05`.
- Fingerprint: `google/husky/husky:17/CP3A.261005.005/2026102101:user/release-keys`.
- New package `org.cashucard.card072creation`, version code 1, version name
  `0.0.1-card072-lab`, label `Card 07297620 Creation`.
- Signed source `eefe1235ccbd647b6e9a6f56de5fc75d769f958e`; APK SHA-256
  `0c3e9f1b8b7d41c2f539d81506742191537b0e164a55c2301d4c6b98d2366988`, known single Android Debug v2 signer.
- Dedicated journal key `cashucard-card072-creation-v1`; no shared old-app journal.
- [Build and APK inspection](BUILD_READINESS_2026-11-05.pixel-07297620-create.md)
  and the [named plan](HARDWARE_PLAN_2026-11-05.pixel-07297620-create.md) bind
  source, image, new package, device, commands, end state and stop behavior.

The first inventory script had a parse error before any ADB command ran; its
corrected execution made the single named-device inventory. Android's scoped
`pm path` query returned status 1 with empty output for the absent package.
A package-name-filtered `pm list packages` query independently confirmed
absence; no broader package enumeration occurred. No app was installed during
these checks. System metadata was recorded after the successful admission.

The exact preserved APK was then installed once with `adb -s <named-serial>
install <pinned-apk>`, without replacement/downgrade flags. Installation returned
Success. Scoped package metadata verified the intended version. The exact new
MainActivity launched with Status ok, and its process remained present on the
subsequent scoped PID check. No replace, uninstall, data-clear, root, broad
logcat or unrelated app operation was issued. The existing provisioner and
older lab apps/journals were not targeted.

A local probe using this project's bundled Hermes VM verified Array.at, negative
indexing, Object.fromEntries, BigInt, Uint8Array and the modern syntax used by
the portable controller. No source/APK change followed inspection. This is a
runtime-primitive check, not native NFC qualification.

## Evidence and operator handoff

New private admission/inventory/install/launch receipts and `handoff.json` are
retained alongside the APK under
`~/.cashucard/pixel-07297620-create-2026-11-05/`. No existing evidence file was
edited or deleted. No reader connection, card command, production lookup or
ops-state change occurred during phone installation.

The operator should remove card 07297620 from the ACS reader, keep it off the
phone until ready, open the new app and press START CREATION TEST once. Hold the
card still until Created or Stopped, then report the result. Do not attempt a
second tap or clear the journal after a stop. Collection of this new app's
public journal and independent evidence decoding follow a terminal result.
