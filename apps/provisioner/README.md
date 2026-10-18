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
then loads. A card moved mid-run is fine; tap again.

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
(GET DATA `FF21`) before and after. Share sends it as text.

## Build and run (the owner, gate H1)

Bundle id and Android `applicationId`: `com.flash.provisioner`.

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
AID. A missing AID or entitlement looks like a card fault.

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
