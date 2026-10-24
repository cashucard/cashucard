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

| Entry point                        | Contract                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@cashu-card/cardkit`              | Installation plans, SCP02, identity/inspection, key rotation, recovery and reset primitives; see `dist/index.d.ts`.     |
| `@cashu-card/cardkit/cleanup`      | Opt-in settled-entry inspection/cleanup; the caller supplies holder PIN authorization and verified settlement evidence. |
| `@cashu-card/cardkit/testing`      | Node-only fake transport and test fixtures implemented in `testing/`; never import into production bundles.             |
| `@cashu-card/cardkit/package.json` | Package version metadata.                                                                                               |

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
