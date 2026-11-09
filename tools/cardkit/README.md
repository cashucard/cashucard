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

## Unreleased: SCP03 beside SCP02, and the J3R452's first contact

`openSession` reads the protocol from INITIALIZE UPDATE's reply and opens SCP02
(the J3R180) or SCP03 (the J3R452) behind one interface
([D181](../../docs/DECISIONS.md#d181)), and a J3R452 as it ships, at key
version FF with the seller's NDEF tag, is moved to the state a J3R180 starts in
([D182](../../docs/DECISIONS.md#d182)). Signatures and types change, so the
next release is a minor one. The version stays 0.2.0 until the owner moves it
with a review of the `tools/outbox-spike` runners that pin it (D181). Migration:

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
  PUT KEY with P1 `00` and new version `FACTORY_KVN` (01), the reopen held to
  01, and `RotateResult.firstContact` set. It now stops `guarded` before
  EXTERNAL AUTHENTICATE where it used to go on: P1 `00` anywhere else (a
  `putKey: {p1: 0}` at 01, or the default at version 00), FF under SCP02, and
  the new set already at FF. At version 01 it sends the same APDUs as before.
- `ProvisionOptions.replaceSellerTag`, off by default, deletes the seller's
  NDEF tag at `D2760000850101` before an SCP03 sweep when the new
  `readForeignTag(send, domain)` shows it in the seller's shape.
  `ProvisionResult` is now an interface with `sellerTagRemoved`, so code that
  builds one needs the field, and `RunEvent` gains `{type: 'sellerTagRemoved'}`,
  so a switch over it that must be exhaustive needs that case.
- `resetOwnedCard` stops `guarded` at key version FF, as at 00.
- `FakeCard`'s SCP03 PUT KEY takes P1 `00` on a card at version FF, for a new
  version from 01 to 7F, and drops the FF set, as the test card did.
