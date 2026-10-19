# On-silicon test report: phones install 2.1 on a J3R180 over NFC (2026-10-18)

ENG-738. The card program's Phase-1 spike: decide whether a phone can be the
GlobalPlatform transport for installing the 2.1 applet — the card side was
already proven (the 2026-10-14 report put 20 KB on this chip through the
ACR122U's RF interface). Here a Google Pixel 8 Pro and an Apple iPhone 13 Pro
Max each ran the full bench sequence against the spare J3R180 with no USB:
the hello-applet smoke, five full installs of the pinned 2.1 load file, a
card-manager key rotation to the spike's public test set and back, and the
torn-run drills. After each phone's sequence, the card was cross-checked
from a Mac on the ACR122U: `cardctl selftest` 12/12 and `gp --list`.

**Verdict: both phones pass; the phone is a GP transport.** The plan's pass
bar was iOS arm-to-done at most 45 s in 5 of 5 installs and no Android
TagLost in 5 of 5. iOS measured 9,335–10,698 ms in five of five; Android
completed five of five with no TagLost, its one captured install 13,065 ms.
The CoreNFC 60 s reader-session budget — the plan's only candidate hard wall
— was exceeded by 461 ms in a drill armed 51.8 s before the tap and the run
still completed; card-active time is ~9–11 s on both phones. Neither
fallback (USB-only install; Android-only or a resumable load) is needed.

The instrument was the spike app `apps/provisioner` plus `tools/cardkit`
(D27: SCP02, vendored DES), driven by the owner; the app shows timings and
the FF21 free-memory figures and never records APDU bytes.

## Card

| Item | Value |
|---|---|
| Chip | NXP JCOP4 J3R180 P71, the spare of the 2026-10-14 reports |
| CPLC | ICFabricator `4790`, ICType `D321`, ICSerialNumber `09336320`, ICFabricationDate `3041` |
| GlobalPlatform | 2.3, ISD `A000000151000000`, SCP02 only (the owner's `gp -i -v`, 2026-10-17: `Supports SCP02 i=15 i=35 i=55 i=75`, no SCP03, no AES set) |
| Keys | factory set `40`…`4F` at the start and at the finish |
| Start state | the 2.1 set installed and empty, per the 2026-10-14 report's end state |

## Environment

| Item | Value |
|---|---|
| Phone 1 | Google Pixel 8 Pro, Android 17 (SDK 37); `com.flash.provisioner` 1.0, arm64 debug APK |
| Phone 2 | iPhone 13 Pro Max ("Max"), iOS 26.5.2; same app, Debug configuration, signed under ISLAND BITCOIN LLC (`H7UAM79QQP`) |
| Phone app's AID allowlist (checked in the built app) | ISD `A000000151000000` first, then applet `F043415348554341524401`, tag `D2760000850101`, hello `F04341534848454C4C4F01`; the package AID deliberately absent (D25) |
| Phone entitlement | `com.apple.developer.nfc.readersession.formats` = `TAG`, present in the built app |
| Bench (cross-checks) | macOS 26.5 (aarch64), ACS ACR122U PICC, `tools/cardctl` in its venv, GlobalPlatformPro v25.10.20 |
| App source | this repo at `edade08`; the iOS build additionally carried the fmt-pod c++17 Podfile setting (uncommitted at build time, needed under Xcode 26; PR#5) |
| Load under test | the tracked CAP's load file: 20,068 bytes, sha256 `fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee`; 82 LOAD blocks of at most 247 bytes + 8-byte MACs; pinned by `make-assets.py` and re-hashed by the app before the first APDU |
| CAP | `applet/target/cashu-javacard-2.1.0.cap`, sha256 `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` |
| Reference time | the same 82-block load took 13.4 s over the ACR122U at H0 (PR #4) |

## What ran, per phone

1. Smoke: the hello applet's package loaded and made selectable, its one
   command answered `HELLO`, then instance and package deleted.
2. Install Cashu card, five times. Run 1 is a teardown of the start state;
   runs 2–5 with the Replace switch on. Full sequence each: probe, open the
   ISD with the factory keys (SCP02), sweep (tag, card applet, opener,
   package), INSTALL-for-load, 82 LOADs, instantiate opener → card applet →
   tag, verify (whole-AID SELECT answers `02 01`, GET_INFO, GET_PUBKEY, tag
   SELECT).
3. Mac cross-check: `cardctl selftest` and `gp --list` (below).
4. Rotate keys and back: factory set → spike test set (ENC `10`…`1F`, MAC
   `20`…`2F`, DEK `30`…`3F`) → factory; each direction proved by opening a
   fresh session on the new set; the card's cryptogram is checked on the
   phone before EXTERNAL AUTHENTICATE, in both candidate sets for the
   rotation.
5. Drills, each followed by one full install and its FF21 line.

## Install: five of five on both phones

iPhone, five measured runs (the bar was 45 s in 5 of 5):

| Run | tap wait | arm → done | 60 s headroom | of it, 82-block load | APDUs | Notes |
|---|---|---|---|---|---|---|
| 1 | 1,366 ms | 9,420 ms | 50,580 ms | 5,709 ms | 101 | first phone install; FF21 164,024 → 109,920 |
| 2 | 775 ms | 9,335 ms | 50,665 ms | 5,586 ms | 102 | Replace on; sweep 805 ms; FF21 net 0 |
| 3 | 775 ms | 9,489 ms | 50,511 ms | 5,695 ms | 102 | same |
| 4 | 1,995 ms | 10,698 ms | 49,302 ms | 5,689 ms | 102 | same |
| 5 | 1,683 ms | 10,393 ms | 49,607 ms | 5,691 ms | 102 | same |

Pixel: five of five completed, **no TagLost in any**, and each torn-run
drill recovered (below) — the Android bar. One run's readout survives (the
last, after the drills): tap wait 3,558 ms, arm→done **13,065 ms**, load
7,031 ms, 101 APDUs, FF21 164,024 → 109,920. The earlier four runs'
timings were not captured — the app keeps only its latest readout and its
Share was failing silently (both fixed in PR #5) — so per-run Android
numbers rest on the owner's observation alone and say so here.

Per-phase on both phones: probe 16–37 ms, ISD select+login (SCP02)
~95–160 ms in 4 APDUs, the three instantiations ~220 ms, ~1.25 s and ~0.24
s (opener, card, tag; the card applet's INSTALL is the slow single APDU at
~1.28 s), verify ~110–140 ms. The slowest LOAD block was ~1.0–1.02 s (the
last). The ACR122U reference for the same load is 13.4 s: the iPhone is
faster than the bench reader, the Pixel about level with it.

## The iOS 60-second budget is not a wall at 60.0 s

Drill 4 on iOS: the NFC session armed, the card tapped ~50 s later:

| tap wait | arm → done | 60 s headroom | card-active time | Result |
|---|---|---|---|---|
| 51,762 ms | 60,461 ms | −461 ms | ~8.7 s (the run's own work above the wait) | **done — completed after the nominal budget** |

CoreNFC on iOS 26.5.2 did not kill the session at 60.0 s. With every normal
run's card-active window at 9–11 s, the 60 s concern behind the plan's
fallback designs (resumable multi-session load; WTX pacing) does not apply.

## Key rotation

Both phones rotated the ISD factory set to the spike test set and back, each
direction proved by a fresh login on the new keys (the app opens with the
new set before reporting done). After each phone the bench's `gp --list`
opened the ISD with the factory defaults (its own warning says it defaulted
to `4041…4F`), and `cardctl selftest` passed 12/12 including the three
BIP-340 AUTH verifications and the fresh-nonce check. Rotation timings were
not captured (same app limitation; attested).

## Drills and free memory

| Drill | Pixel | iPhone |
|---|---|---|
| lift the card mid-LOAD | next tap recovered (probe → sweep → install) | recovered |
| lift at "Installing card" | recovered; the screen required Replace on first (by design) | recovered, same |
| force-quit the app mid-load | recovered after relaunch | recovered after relaunch |
| background mid-load (Android) | recovered | — |
| armed ~50 s before the tap (iOS) | — | completed (above) |

FF21 across the day: 164,024 bytes free on the swept card; 109,920 free
with the 2.1 set on — the install's footprint is 54,104 bytes. Every
Replace run nets 0, and the card ended every drill-plus-install cycle at
the same 109,920: the sweep path reclaims fully and no torn run leaked
EEPROM. The card was never bricked and never needed a bench intervention;
the end state is the applet installed, empty, on factory keys.

## Not covered here

- Pixel install timings for runs 1–4, and all smoke and rotation timings on
  both phones: attested, not captured (the app keeps only its latest
  readout and its Share failed silently during the Pixel session; fixed in
  PR #5).
- A Release-build iOS run — the plan's remedy if Debug timing were
  marginal. It was not marginal (≥4.2× under the bar), so none was run.
- SCP03: the card offers SCP02 only (`gp -i -v`, 2026-10-17); D27 stands.
- Any card but the spare; any transport but the two phones and the ACR122U.
- Funded cards: the app refuses to touch an applet whose GET_INFO is
  non-empty, Replace or not, and none was near money at any point.

## Follow-ups

- PR #5: the fmt-pod c++17 Podfile setting (without it a clean-checkout iOS
  build fails under Xcode 26) and the Share-failure message.
- The program's next steps per the plan: Phase 2 (cardkit's `apdu/` +
  `personalize/` extraction, flash-mobile first) and the Phase-3
  ops-service design — after the Foxy governance conversation.
