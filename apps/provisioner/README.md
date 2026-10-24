# Cashu Card Provisioner

The shipping app signs operators into the ops-service, installs the shared Cashu
card applet, records manager-key rotation, restores interrupted work and supports
explicit owned-card reset. Holder wallets own PIN/ownership setup, funding and
payments. Demo mode has been removed; the legacy bench described below is gated
off in distributed builds. Bundle ID: `com.islandbitcoin.provisioner`.

See the [current operator flow](../../docs/PROVISIONER-APP.md) for the shipped
sign-in, batch, installation and recovery experience.

Build `tools/cardkit` first, then install this app's dependencies. The app consumes
`@cashu-card/cardkit` through `src/cardkit.ts`; Metro resolves the installed public
package rather than a sibling `gp/` source path. Refresh the file dependency after
SDK edits. See the [architecture](../../docs/ARCHITECTURE.md) and
[independent release/signing guide](../../docs/COMPONENT-RELEASES.md).

<a id="legacy-bench-reference-not-a-shipping-route"></a>

## Legacy bench reference (Debug builds only)

The original ENG-738 spare-card bench is retained for approved laboratory Debug
builds only. `BENCH_RUNS_ENABLED` defaults to false: Settings hides it, navigation
rejects entry and its handlers cannot open NFC. Native Release builds require
that flag and recovery drills to remain disabled. Do not enable bench writes to
bypass the production coordinator or its stopped-card evidence.

The historical bench operations below are described for that controlled Debug
workflow. The decision behind the GlobalPlatform implementation is
[D27](../../docs/DECISIONS.md#d27); the shared library is
[`@cashu-card/cardkit`](../../tools/cardkit), installed as a public package.

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

<a id="what-it-will-not-do"></a>

## Bench safety boundaries

- The bench sends bytes only when the load file's sha256 matches the build's.
- The bench checks the card's cryptogram before EXTERNAL AUTHENTICATE and never
  attempts login with unproved keys. After wrong keys or refused login, every
  button stays off until the app restarts. Failed logins lock a card for good.
- The bench never retries a command.
- The bench deletes only the card's three instances and package, plus the hello
  applet and its package. It never deletes the card manager.
- The bench refuses to remove a card applet that holds anything (an unspent or
  spent piece, an owner, a PIN or a record), with Replace on or off.
- The readout never includes APDU bytes. It includes INS, lengths, SW and times.

## The readout

The tap wait, arm to done against iOS's 60-second session (the headroom), the
critical path (login to the last INSTALL, apart from the sweep and the checks),
each phase with its APDU count and slowest APDU, every APDU over Android's default
618 ms, Android's effective timeout after `setTimeout(15000)`, and the free memory
(GET DATA `FF21`) before and after. Share sends it as text; if Share itself
fails, the status line says so, and the readout is selectable, so a long-press
copies it by hand.

A run that stops says why. For an NFC failure, iOS reports the NFC library's
error class, such as `TagConnectionLost` or `SessionInvalidated`; Android keeps
its own error text. A session that never reached the card is named on the screen
the same way, for example
`No card session: Timeout.`

## Operator app

Sign-in opens real batch setup, installation/recovery, card checks and settings.
Build 7 removed the design-review demo mode, fake-card chooser and
unauthenticated route into the app (D105). Device diagnostics are explicit read-only actions after operator sign-in. The lab bench
remains gated off in normal releases. Review access uses a scoped operator
account and real hardware evidence.

The sign-in form scrolls on small screens; its action stays above the keyboard.
Next focuses Password, and Go submits the form. iOS uses keyboard avoidance;
Android uses the activity's existing `adjustResize` without duplicate padding.

The screens are set in bundled OFL Figtree (`assets/fonts/`, linked with
`react-native-asset`; re-run it when fonts change). Type, color and spacing
tokens live in `src/theme.ts`; copy in `src/strings.ts`.

Build iPhone apps with the Release configuration (`-configuration Release`). A
Debug build on a physical iPhone looks for a Metro packager at launch (`ip.txt`)
and can hang on a blank screen when another project's Metro holds :8081. Release
starts without consulting a packager.

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

`src/journalStorage.ts` retains one atomic schema 3 envelope under the original
fixed key. `src/workspaceStorage.ts` migrates the old batch/reset journals and
keeps separate workspaces for each service origin, operator ID and key environment,
with one unchanged device ID. Sign-out never clears evidence, late writes stay
bound to their original workspace, and malformed data blocks rather than opening
a fresh store. Older app binaries reject the migrated envelope; coordinate any
downgrade with the administrator. There is no fallback store. A schema 1 standalone attempt or
malformed snapshot is preserved and stops; it cannot silently generate another
device/batch. Sign-in now retains the service's stable `operator_id`; the typed
reservation adapter keeps the token in memory and scopes all requests to it.

`src/ProvisioningStore.tsx` now connects the coordinator to the real operator
screens, separately from the legacy outbox. Native storage/session
adapters load lazily: a missing native module pauses real work without breaking
sign-in. Sign-out retains evidence, and another operator/environment or
service cannot view attempt details or replay it. One operation queue survives
React remounts. Actor changes cancel an armed session and block further commands;
cancellation during key prefetch prevents NFC from opening later.

`src/releaseGates.ts` enables installation for internal testing. Both batch creation
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
GET DATA CPLC only. Its signed-in screen labels physical-card access; the read
itself needs no further service request. Cancel/back ends only its own session. It does
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
layout. The identity diagnostic labels physical-card access as read-only; other
screens have no simulated-card banner. Its content can scroll at larger
text sizes. These changes do not arm NFC or enable installation.

### Service origin for a release candidate

The default comes from `src/serviceOrigin.json` and remains the local
`http://127.0.0.1:8821` development service. To prepare an isolated release
checkout with an operator-supplied public HTTPS origin (example only):

```sh
yarn configure:service --origin https://ops.example.com
yarn check:release
```

The configuration is public and contains no password/token. The tool rejects
credentials, non-origin URLs, HTTP and local/IP production targets without
contacting any host. It writes atomically and never echoes a rejected input.
`check:release` also parses the release-gate source and requires recovery drills
and bench runs to be literal disabled constants. It does not enable physical installation,
validate the deployment certificate or replace release review. Rebuild the app
and retain the chosen origin/configuration and artifact hashes. Do not ship the
example origin. Supply the actual reviewed service origin before distribution.

Native Release builds enforce this check automatically: Gradle runs it before
Release JS bundling, pre-build and signing validation; Xcode's bundle phase runs
it for every configuration other than `Debug`. A local endpoint or enabled
recovery drills stop the build. Debug retains local validation support. There
is no Release bypass; use Debug for local diagnostics. This validates build
configuration only, not production deployment or physical capability evidence.

For an explicitly local validation checkout, use `--local` with configure;
`node scripts/configure-service.cjs --check --local` checks that format without
requiring production gates. Local HTTP is restricted to loopback/emulator
addresses; LAN validation must use HTTPS. TLS trust still needs a separately
approved device setup. Do not modify the app endpoint during an active batch:
its saved origin is part of the recovery scope. Keep the original build/origin
available to reconcile saved work rather than clearing storage.

### Android upload signing

Release builds require these private environment inputs from the release
operator's protected environment or secret manager:

- `CASHU_ANDROID_UPLOAD_KEYSTORE`: absolute path to the existing upload keystore.
- `CASHU_ANDROID_UPLOAD_STORE_PASSWORD`: its store password.
- `CASHU_ANDROID_UPLOAD_KEY_ALIAS`: the registered upload alias.
- `CASHU_ANDROID_UPLOAD_KEY_PASSWORD`: its key password.

Do not type values into command arguments/history or commit a keystore/password.
There is no default release identity. `preReleaseBuild` and
`validateSigningRelease` depend on the signing preflight, which rejects missing
inputs, unreadable files and the published debug key even when renamed. The
Android plugin then checks the actual key format/alias/password. Debug builds
continue using the development key. An explicitly invoked preflight is:

```sh
node scripts/check-android-signing.cjs
```

Do not generate a replacement upload key until Play Console signing/enrollment
state and certificate continuity have been reviewed. This setup does not grant
store access or authorize a signed upload. See the
[store release plan](../../docs/PROVISIONER-STORE-RELEASE.md).


### Cards home and shared phones

Sign-in opens Cards. Continue a saved batch/reset deliberately, or open Settings
and card tools. Stop for now returns to Cards; it does not end or erase work.
End batch is available on Cards when no attempt is active and asks for
confirmation before closing unused places through the service. Close finished
batch releases a fully acknowledged batch so New batch is available. A pending
card attempt must be completed or its stop acknowledged before ending its batch.
Another operator can prepare their own batch, while device/chip holds continue
to prevent a second installation around unresolved work. See
[D111](../../docs/DECISIONS.md#d111).
