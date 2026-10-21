# Cashu card provisioner (ENG-738)

A bench spike: can a Pixel 8 Pro and an iPhone install the card's 2.1 applet on a
J3R180 over NFC, with no USB reader? One screen, three runs, and a readout of what
each measured. For the spare card only. The decision behind it is
[D27](../../docs/DECISIONS.md#d27); the GlobalPlatform code is
[`tools/cardkit`](../../tools/cardkit), bundled from the repository.

## What it does

- **Smoke test (hello applet).** Loads a 280-byte package of one applet, installs
  it, hears `HELLO` to INS 01, and deletes it again. Proves the transport: the
  secure channel, a LOAD of more than one block, an INSTALL, a DELETE.
- **Install Cashu card.** The three-step install of
  [`HARDWARE_DEPLOYMENT.md`](../../docs/HARDWARE_DEPLOYMENT.md): the 20,068-byte
  load file in 82 blocks, the opener, the card's applet, then the tag under
  `D2760000850101`. Then it checks the card's applet answers `02 01`, `GET_INFO`
  (30 bytes), `GET_PUBKEY` (33 bytes) and the tag's SELECT.
- **Rotate keys and back.** The card manager from its factory keys (`40` to `4F`)
  to the spike's public test set (ENC `10` to `1F`, MAC `20` to `2F`, DEK `30` to
  `3F`) and back, each proved by a fresh login.
- **Replace existing install (spare card only).** Off by default. With it on, an
  installed card applet is removed first, and only if its `GET_INFO` is empty.

Every run starts from the card as it is: it checks for an installed applet, logs
in, removes whatever a torn run left (newest instance first, then the package) and
then loads. A card moved mid-run is fine; tap again. Once the card applet's INSTALL
has gone out, the next run finds the applet and removes it only with Replace on,
so after a pull from Installing card on, the screen says to turn Replace on first.

## What it will not do

- Send a byte when the load file's sha256 is not the build's.
- Log in with keys the card has not proved: the card's cryptogram is checked on
  the phone before EXTERNAL AUTHENTICATE. After wrong keys or a refused login every
  button stays off until the app is restarted. Failed logins lock a card for good.
- Retry anything.
- Delete anything but the card's three instances and package, and the hello
  applet and its package; never the card manager.
- Remove a card applet that holds anything (an unspent or spent piece, an owner,
  a PIN, a record), with Replace on or off.
- Put APDU bytes in the readout: it has INS, lengths, SW and times only.

## The readout

The tap wait, arm to done against iOS's 60-second session (the headroom), the
critical path (login to the last INSTALL, apart from the sweep and the checks),
each phase with its APDU count and slowest APDU, every APDU over Android's default
618 ms, Android's effective timeout after `setTimeout(15000)`, and the free memory
(GET DATA `FF21`) before and after. Share sends it as text; if Share itself
fails, the status line says so, and the readout is selectable, so a long-press
copies it by hand.

A run that stops says why. For an NFC failure that is the NFC library's error
class, such as `TagConnectionLost` or `SessionInvalidated`, since an iOS error
carries nothing else; Android's errors keep their own text. A session that never
reached the card is named on the screen the same way, for example
`No card session: Timeout.`

## The designed app and demo mode (ENG-739)

The app now boots the designed flow of
[`docs/PROVISIONER-APP.md`](../../docs/PROVISIONER-APP.md): sign-in, batch
setup, the programming loop, batch summary, settings. Demo mode (Settings →
Demo mode) runs every state of the loop against a fake card
(`src/demo/fakeCard.ts`) built on cardkit's own SCP02 crypto, in the measured
cadence — the design review lives on a phone, with no card and no service.
The real-hardware path is this spike's screen, kept at Settings → Bench runs.

The screens are set in bundled OFL Figtree (`assets/fonts/`, linked with
`react-native-asset`; re-run it when fonts change). Type, color and spacing
tokens live in `src/theme.ts`; copy in `src/strings.ts`.

**iPhone builds are Release, not Debug** (`-configuration Release`): a Debug
build on a physical iPhone looks for a Metro packager at launch (`ip.txt`),
and on a Mac where another project's Metro holds :8081 the app can hang on a
blank screen. Release never consults a packager.

## Build and run (the owner, gate H1)

Bundle id and Android `applicationId`: `com.islandbitcoin.provisioner`.

```sh
yarn install --frozen-lockfile
yarn android                       # the Pixel 8 Pro
(cd ios && pod install)            # then open ios/CashuProvisioner.xcworkspace in Xcode:
                                   # set the team; NFC Tag Reading is in CashuProvisioner.entitlements
plutil -p <the built .app>/Info.plist | grep -A5 select-identifiers   # A000000151000000 first
```

The iOS sheet can select only the AIDs listed in `Info.plist`
(`com.apple.developer.nfc.readersession.iso7816.select-identifiers`): the card
manager first, the card's applet, the tag and the hello applet. Never the package
AID. A missing AID looks like a card fault. A missing entitlement ends the session
before any card, and the screen says `No card session: SecurityViolation.`

## Checks (CI runs them)

```sh
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint .
node_modules/.bin/jest
node_modules/.bin/react-native bundle --platform ios --dev false --entry-file index.js --bundle-output "$TMPDIR/p.js"
node_modules/.bin/react-native bundle --platform android --dev false --entry-file index.js --bundle-output "$TMPDIR/p.js"
```

`src/assets/cashu.ts` and `hello.ts` are written by
`python3 tools/cardkit/make-assets.py` (from the tracked CAP, and from
`ant -f applet/build.xml hello-cap`); CI checks them with `--check`. Do not edit them.

### ENG-741 durable provisioning state

`src/provisioningWorkflow.ts` is the single coordinator over a schema 2 snapshot:
stable device UUID, scoped PIN-free batch request, pending reservation, embedded
attempt journal and acknowledged history. Persist the creation UUID before its
POST; lost responses replay the same request after reopening. Once acknowledged,
an attempt is inspected; a missing server attempt stops for reconciliation.

`src/journal.ts` validates attempt stages, pre-install identity/replacement
consent, frozen completion records and terminal receipt identity. The
coordinator's `withAttempt` serializes these commits with batch operations. Its
caller must verify the card before reporting installation/rotation, and await
intent before calling cardkit. Failed writes latch the writer until reopening.
`advance` reconciles the server receipt and atomically saves history and batch
progress. An explicit `closeBatch` only releases local history after the entire
batch is acknowledged and recognized by the service; device identity survives.
Quarantined/abandoned server states stop for explicit disposition handling.

`src/journalStorage.ts` replaces one AsyncStorage value under a fixed key. There
is no fallback store or clearing on sign-out. A schema 1 standalone attempt or
malformed snapshot is preserved and stops; it cannot silently generate another
device/batch. Sign-in now retains the service's stable `operator_id`; the typed
reservation adapter keeps the token in memory and scopes all requests to it.

`src/ProvisioningStore.tsx` now connects the coordinator to the real operator
screens, separately from demo and the legacy outbox. Native storage/session
adapters load lazily: a missing native module pauses real work without breaking
sign-in or demo. Sign-out retains evidence, and another operator/environment or
service cannot view attempt details or replay it. One operation queue survives
React remounts. Actor changes cancel an armed session and block further commands;
cancellation during key prefetch prevents NFC from opening later.

`src/releaseGates.ts` keeps production installation disabled. Both batch creation
and programming enforce the gate; software-only record recovery and explicit
disposition remain usable. Reauthentication, foregrounding and a 30-second timer
retry only frozen records, without keys or NFC. Summaries report acknowledged
installation/rotation records and stops, never a PIN or holder readiness.
Existing installations stop for operator review; there is no replacement-consent
screen or partial-install repair yet.

The native dependency is pinned, but iOS pods, native builds, both-phone CPLC
checks and termination drills remain operator steps under an approved device
plan. Jest checks storage/restart semantics, not device power-loss durability.
See the [recovery contract](../../docs/PROVISIONER-RECOVERY.md).

The TypeScript check includes app source and tests. Node types are available
for the test-only cardkit fake; cardkit retains its separate Node-free library
check. The earlier declaration-only include did not typecheck the app.

### Injected card orchestration

`src/provisioningTap.ts` composes the journal, service and cardkit under an
injected NFC session. `runReservedAttempt` reconciles first, fetches only that
attempt's keys before arming NFC, binds the inspected CPLC before mutation,
then installs/recovers, rotates/confirms and freezes the exact completion body.
The record POST runs after the session closes. Pending record retries use no
NFC or key lookup. It reports exact installation/rotation stages; it does not
perform mint/owner/PIN personalization or report holder readiness.

The read-only cardkit inspector returns the full installation key, empty-state
and tag evidence. An interrupted complete new installation can be adopted;
absent, partial or untouched old states quarantine without a recovery sweep.
The saved intent names the verified pre-install inspection state separately
from the new key. Older draft intents lacking that evidence stop for
reconciliation. A durable rotation state confirms only the assigned set, without
another PUT KEY. The confirmed GP key version enters the durable state and frozen record.

`acknowledgeQuarantine` is an explicit operator action. It persists disposition
intent before POST, recovers a lost acknowledgement from the service, and only
then archives the attempt and advances the ordinal. The bound chip remains
blocked on the service. Neither restart nor another batch clears the quarantine.

The gated real screen uses these functions through native `withCard`.
Software tests use the existing GP card and injected transports. Under explicit
operator authorization, native rebuilds and three documented read-only CPLC reads
on both the Pixel and Max passed on 2026-10-20; see the
[hardware report](../../docs/HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md).
A separately approved Pixel replacement run passed three saved-boundary
restarts (install result, rotation result, frozen record); see the
[Pixel recovery report](../../docs/HARDWARE_TEST_REPORT_2026-10-20.d321-pixel-recovery.md).
The spare's post-write CPLC also matched on Max in an
[operator-confirmed read-only post-check](../../docs/HARDWARE_TEST_REPORT_2026-10-20.d321-max-postcheck.md).
The completed run's escrow also passed a
[local encrypted-export/CLI restore check](../../docs/RECOVERY_TEST_REPORT_2026-10-20.pixel-escrow.md).
iPhone write/recovery, partial LOAD, actual lost replies and the other
checklist cases remain outstanding. Personalization is unvalidated, and both
committed release gates remain false.

The next native validation steps are in the
[proposed owner-run checklist](../../docs/PROVISIONER-DEVICE-VALIDATION.md).
Settings → Read physical card identity supplies the read-only phone probe:
entering the screen does not arm NFC; the explicit read issues SELECT ISD and
GET DATA CPLC only. It also works through the demo door without a service, but
labels its physical-card action. Cancel/back ends only its own session. It does
not authenticate, modify cards, alter saved attempts or enable installation.
Local validation builds can additionally enable `RECOVERY_DRILLS_ENABLED` in
`src/releaseGates.ts` to select a one-shot pause at a known durable boundary.
The flag defaults false and does not bypass the installation gate. The real
batch screen then shows the selected/reached boundary and actual saved stage;
continue or stop deliberately, or terminate while paused for the approved drill.
The frozen-record checkpoint is after NFC closes and before POST. Signing out
or unmounting stops a paused run without discarding evidence. Pause configuration
is never persisted and normal recovery runs after reopening. Mid-APDU failure,
torn LOAD and lost PUT KEY replies are not simulated by these controls.
The checklist is not a hardware report or permission to operate devices.

### Phone UI follow-up

Shared screens use `react-native-safe-area-context` (pinned 5.10.1) for native
insets, including Android edge-to-edge windows. This adds a native dependency:
run pod install and rebuild the phones before loading this revision's bundle.
The root provider supplies all shared screens; titles wrap in normal header
layout. The identity diagnostic always shows “PHYSICAL CARD — read-only”, while
ordinary demo screens retain their demo banner. Its content can scroll at larger
text sizes. These changes do not arm NFC or enable installation.
