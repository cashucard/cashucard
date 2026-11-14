# @cashu-card/cardkit

Versioned TypeScript/JavaScript API for Cashu Card installation and recovery over
an injected `Transceiver`. Callers supply NFC, network or other transport and
decide whether an operator may reset a card.

```ts
import {provision, type Transceiver} from '@cashu-card/cardkit';
import {readResetReview} from '@cashu-card/cardkit/cleanup';
// Node tests only:
import {FakeCard} from '@cashu-card/cardkit/testing';
```

| Entry point                        | Contract                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@cashu-card/cardkit`              | Installation plans, SCP02 and SCP03, identity/inspection, key rotation, recovery and reset primitives; see `dist/index.d.ts`. |
| `@cashu-card/cardkit/cleanup`      | Opt-in settled-entry inspection/cleanup; the caller supplies holder PIN authorization and verified settlement evidence.       |
| `@cashu-card/cardkit/testing`      | Node-only fake transport and test fixtures implemented in `testing/`; never import into production bundles.                   |
| `@cashu-card/cardkit/package.json` | Package version metadata.                                                                                                     |

Deep imports into `gp/`, `dist/` or test directories are private and rejected by
package exports. Native Metro uses the `react-native` source condition; ordinary
Node uses compiled CommonJS. Both resolve the same declared public surface.
The core typecheck excludes Node ambient types. The Node-only testing entry point
is compiled separately into the distribution without the GP unit suites or
owner-supplied hardware captures.

Build before installing either repository consumer:

```sh
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build)
(cd apps/provisioner && yarn install --frozen-lockfile)
(cd ops && yarn install --frozen-lockfile)
```

The app/ops use explicit `file:` dependencies. Yarn classic copies these packages;
a cardkit source edit requires rebuilding and refreshing the consumer install
(`yarn install --force --frozen-lockfile` if its cached copy is unchanged).
Metro needs no sibling-source watch folder or private import alias. External
consumers can install the packed GitHub release artifact; npm publication remains
disabled (`private: true`).

`package.json` is the version authority, starting with the public API at 0.2.0.
Patch versions preserve the public API. Before 1.0, an incompatible API change
requires a minor version and migration notes; after 1.0, it requires a major.
Consumers must explicitly review updates. Firmware/protocol versions and pinned
CAP/load-file hashes remain separate from the host API version.

```sh
yarn build
yarn typecheck
yarn test
yarn test:package
yarn format:check
npm pack --ignore-scripts
```

The package test packs the actual distributable, loads it in ordinary Node,
checks supported exports/private-path rejection, and scans app/ops imports.
GP tests use fake cards and do not authorize a real reader or phone action.
See [component releases](../../docs/COMPONENT-RELEASES.md).

## 0.3.0: protocol 2.3, and change owed

0.3.0 reads and installs the 2.3 card (`CARD_VERSION` is `[2, 3]`) and holds
every reset and every "empty" test to the change a card is owed. It also carries
the SCP03 changes below. Migration:

- **Change owed.** A card that paid and has not had its change back yet is not
  empty, and nothing removes it: the change is lost with the applet. A 2.3 card
  says so in `GET_INFO` byte 29; a 2.1 or 2.2 card is asked `GET_CHANGE` (its
  byte 29 means something else). `InstallationInspection.publicState` gains
  `changeOwed`, and `empty` is false while it is set; `assessResetPreflight`
  refuses such a card ("the holder's wallet brings it home"); `resetOwnedCard`
  stops `guarded` before it saves anything, fresh or resumed; `provision`'s
  probe never sweeps one, Replace on or off. New: `readChangeOwed(ask, info)`,
  `changeOwedByte(info)` and `GET_CHANGE`. `notEmpty` names change owed on a
  2.3 card. Inspection, the probe and the reset send one more plain command
  (`GET_CHANGE`, `B0 19 00 00 00`) to a 2.1 or 2.2 card, and none to a 2.3 card.
- **Versions.** The probe removes only a card applet of a version this kit
  knows (`CARD_VERSIONS`: 2.1, 2.2, 2.3), and only when its `GET_INFO` names
  the version `SELECT` did; any other 2.x stops `guarded` after `SELECT`.
  `holderCommands` throws `unsupported applet version` on a 2.3 card and the
  settled-entry cleanup stops `unsupported-card` on one with spent entries
  (`ADMINISTERED_CARD_VERSIONS`: their owner commands and secrets are 2.2's); a
  2.3 card's holder wallet frees its spent places.
- **`ResetReview`** (`@cashu-card/cardkit/cleanup`) gains `changeOwed` and
  `version` (`'2.1'`, `'2.2'` or `'2.3'`). `readResetReview` reads a 2.3 card of
  two units (format `05` in `GET_INFO` byte 8 and `GET_CARD` byte 0) and refuses
  format `05` from any other version. A review saved by 0.2, without the two new
  fields, still matches its card in `cleanupSettledEntries`.
- **`FakeCard`** answers `02 03`, `GET_CHANGE`, and takes `change` (openings owed)
  and `minor` (1, 2 or 3) in `setCardState`.
- `tools/outbox-spike`'s runners require the reviewed 0.2.0 and refuse 0.3.0
  until they are reviewed against it ([D181](../../docs/DECISIONS.md#d181)).

## 0.3.0: SCP03 beside SCP02, and the J3R452's first contact

`openSession` reads the protocol from INITIALIZE UPDATE's reply and opens SCP02
(the J3R180) or SCP03 (the J3R452) behind one interface
([D181](../../docs/DECISIONS.md#d181)), and a J3R452 as it ships, at key
version FF with the seller's NDEF tag, is moved to the state a J3R180 starts in
([D182](../../docs/DECISIONS.md#d182)). Signatures and types change, so they
ship in the minor release 0.3.0. Migration:

- `putKeys(keys, sessionDek, options)` is now `putKeys(keys, session, options)`:
  pass the open session where `session.keys.dek` went. Its protocol picks the
  key type and check value (`80` and the DES3 KCV, or `88` and the AES KCV).
- `openSession` and `externalAuthenticate` return `SecureSession`, which is
  `Session` (SCP02) or `Scp03Session` (SCP03). Both wrap and send alike; narrow
  on `session.scp` (2 or 3) where code names `Session`.
- `Handshake` carries `sdAid`, the security domain INITIALIZE UPDATE went to,
  so a handshake built by hand needs it.
  `initializeUpdate(tx, random, kvn, sdAid)`, `openSession`'s `sdAid` option and
  `RunOptions.sdAid` (provision, rotation and confirmation) take it; all
  default to the ISD, `A000000151000000`, as before. `resetOwnedCard` takes the
  ISD alone and stops `guarded`, before its first APDU, at any other `sdAid`.
- On an SCP03 card, `provision`'s sweep of the Cashu AIDs reads the registry
  first and stops `guarded`, deleting nothing, unless every Cashu object is the
  Cashu package's: the J3R452 comes with the seller's NDEF tag at
  `D2760000850101`. An SCP02 run sends the same APDUs as before.
  `readCashuRegistry(send, domain)` takes the security domain to hold them to,
  the ISD by default.
- New: the SCP03 primitives (`aesEcb`, `cmac`, `scp03Kdf`, `aesKcv`,
  `parseScp03Reply`, `scp03ReplyLength`, `scp03KeysIfMatches`,
  `scp03HostCryptogram`, `Scp03Session` and the rest of `gp/scp03.ts`) and a
  runtime dependency on `@noble/ciphers` 1.3.0. `FakeCard` takes `scp: 3`,
  `isd` and `sellerApplets` (the J3R452 test card's four applets,
  `SELLER_APPLETS`).
- `rotateKeys` makes first contact on an SCP03 card at `SHIPPED_KVN` (FF):
  PUT KEY with P1 `00` and new version `FACTORY_KVN` (01); the reopen reads
  the key information with GET DATA `E0`, which needs no key and must list the
  new set's three AES-128 keys at 01 and nothing else, then proves the new set
  at 01; `RotateResult.firstContact` is set. It now stops `guarded`
  before EXTERNAL AUTHENTICATE where it used to go on: P1 `00` anywhere else (a
  `putKey: {p1: 0}` at 01, or the default at version 00), FF under SCP02, the
  new set already at FF, and any `putKey` at first contact. At version 01 it
  sends the same APDUs as before.
- `ProvisionOptions.replaceSellerTag`, off by default, deletes the seller's
  NDEF tag at `D2760000850101` before an SCP03 sweep when the new
  `readForeignTag(send, domain)` shows it in the seller's shape.
  `ProvisionResult` is now an interface with `sellerTagRemoved`, so code that
  builds one needs the field, and `RunEvent` gains
  `{type: 'sellerTagRemoved', confirmed}` (false when the DELETE's answer never
  came), so a switch over it that must be exhaustive needs that case.
- New: `getKeyInformation()`, GET DATA `00E0`, and `parseKeyInformation`,
  which reads its key information template as `gp -i` does and throws for
  anything else, with the `KeyInformation` type.
- `resetOwnedCard` stops `guarded` at key version FF, as at 00.
- `FakeCard`'s SCP03 PUT KEY takes P1 `00` on a card at version FF, for a new
  version from 01 to 7F, and drops the FF set, as the test card did. With
  `keepsShippedSet: 'new' | 'shipped'` it keeps that set instead, in
  `FakeCard.shipped`, and P1 `00` then picks the set the option names.
  `FakeCard` answers GET DATA `E0`, plain or under the C-MAC, with keys 01 to
  03 of every set it holds.
