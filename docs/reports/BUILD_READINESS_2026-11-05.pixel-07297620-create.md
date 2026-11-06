# 07297620 Pixel creation build readiness

The isolated creation app is built and inspected. No phone access or card
installation is claimed by this report. The operator confirmed the Pixel 8 Pro
for the [named creation plan](HARDWARE_PLAN_2026-11-05.pixel-07297620-create.md).

- Signed source: `eefe1235ccbd647b6e9a6f56de5fc75d769f958e`. The new controller/generator/UI were
  included in 225 passing outbox tests, with no skips; their initial absent-code
  regressions failed before implementation. The exact retained load file also
  passed through fake-card SCP02. No production applet/assets/profile changed.
- Generated project: `/private/tmp/card072-create-20261105-1`, from clean source.
- New app: `org.cashucard.card072creation`, version 1 /
  `0.0.1-card072-lab`, label `Card 07297620 Creation`.
- APK SHA-256: `0c3e9f1b8b7d41c2f539d81506742191537b0e164a55c2301d4c6b98d2366988`; 39533596 bytes.
- One v2 signer: Android Debug, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Permissions: NFC, VIBRATE and the new app's own non-exported receiver guard.
  No Internet or overlay permission; NFC required; release variants and
  developer support disabled. No release signer or production credential used.
- Bundled JS SHA-256:
  `72c088e28a26c39bcb5aedb1302d4e417ed62e641679e57ba591fa2c7d9322fd`.
  Eight expected source/card/image/journal bindings were verified. No FakeCard
  testing implementation was found in the bundle.
- Fifteen SDK source entry files matched the freshly copied committed SDK.
  The copied native NFC failure classifier matches its known patched hash
  `83ee9eaf22253562b200bf7ea9c57cb04afa71785314e05d4dd515cc26042e9c`.

The build used the existing frozen dependency cache, Node 22.23.4, JDK 17 and
the local Android SDK. Metro bundled successfully; Gradle offline
`:app:assembleDebug` for arm64 completed in 30 seconds. Metro reported known
Noble crypto subpath fallback warnings; bundle generation completed.

The image is the exact proposed streamed candidate, manifest
`b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4`,
CAP `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`,
load `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048`
(28,067 bytes, 114 blocks). Generation verified the full retained artifact; no
CAP was rebuilt. The new profile expects this card's exact four-file baseline
and two private instances plus package after creation; no key from another
card is used.

Private `activation.json`, APK, `lab-build.json`, frozen plan and logs are
retained under `~/.cashucard/pixel-07297620-create-2026-11-05/`, new private
files only. Activation receipt SHA-256:
`43be35db3b710470ec5f0d97f5b182afa6857068b6aff6c003f7946b4968ccb4`. It binds the exact APK, source, plan,
build, SDK/NFC checks, expected phone and preserved successful readiness hash.

The next gate is one named-device inventory, then installation without
replacement and launch of only this new package. Any mismatch or existing
package stops; no phone journal is cleared. The operator must arm the one-use
creation test and tap the card. Current evidence establishes build readiness,
not a native NFC or silicon result.
