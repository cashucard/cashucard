# Contributing to cashu-card

An open-source implementation of [NUT-CCP: Cashu Card Protocol](https://github.com/cashucard/nut).
Contributions are welcome from developers, writers and first-time smartcard
contributors.

**Read [`docs/DECISIONS.md`](docs/DECISIONS.md) before proposing a change to how
the product behaves.** It records decisions about recovery, ownership and PINs,
with the evidence and tradeoffs behind them. Use that context when proposing
a change.

<a id="pick-your-path"></a>

## Contribution areas

<a id="casual-contributor--first-time-here"></a>

### First contributions

Start with [`docs/VISION.md`](docs/VISION.md) and
[`docs/GLOSSARY.md`](docs/GLOSSARY.md). You do not need a card, a reader, or any
JavaCard knowledge to help.

Useful without hardware:

- **Documentation.** Check claims against the source and recorded evidence.
- **`cardctl`** (`tools/cardctl/`) is plain Python with tests that run anywhere.
- **`cashu-client`** ([separate repo](https://github.com/cashucard/client))
  is TypeScript, and the mint protocol is well specified by the NUTs.
- **Reading the spec against the code** and reporting where they disagree. This
  has already caught real bugs.

> **Documentation evidence.** Earlier submissions repeated unsupported hardware
> claims from our README and described payment flows before they existed. Check
> commands against the source, link hardware claims to dated reports, and label
> unverified behavior. Preserve the date and scope of historical evidence.

### Developer

```
docs/VISION.md → docs/ARCHITECTURE.md → docs/DECISIONS.md → here
```

Then pick a layer:

| Layer | Language | Hardware needed |
|---|---|---|
| Applet (`applet/`) | JavaCard | No: jCardSim |
| Host driver (`tools/cardctl/`) | Python | Only for `selftest` |
| Phone-side install (`tools/cardkit/`, `apps/provisioner/`) | TypeScript, React Native | No for the suites; the spare card and two phones for the bench run |
| Mint protocol ([cashu-client](https://github.com/cashucard/client)) | TypeScript | No |
| Ops-service (`ops/`) | TypeScript | No: Node/SQLite and local Workers tests |
| Merchant terminal / holder wallet (external repositories) | React Native / Swift | Simulator for logic; named device/card plan for hardware validation |

### AI agent

Read [`AGENTS.md`](AGENTS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DECISIONS.md`](docs/DECISIONS.md) and
[`docs/GLOSSARY.md`](docs/GLOSSARY.md) before editing. Three rules that matter
more here than in an ordinary repo:

1. **JavaCard runtime constraints.** No `long`, no `BigInteger`, no `String` at runtime,
   no collections, no garbage collector. Code that compiles under `javac` can
   still be rejected by the CAP converter, or convert cleanly and leak
   EEPROM on every tap.
2. **Hardware evidence.** jCardSim runs on the
   JVM. It cannot reproduce EEPROM exhaustion, ECDH output framing, or a card
   whose `getS` returns short. All have caused bugs here.
3. **Do not assert what you did not verify.** If you did not run it, say so.

## Development setup

### Prerequisites

- JDK 11+
- Maven 3.8+ (tests) and Apache Ant 1.10+ (CAP build)
- JavaCard SDK 3.0.5+: `git clone https://github.com/martinpaljak/oracle_javacard_sdks ~/.javacard/sdks`
  (3.0.4 is **not** sufficient: `ALG_EC_SVDP_DH_PLAIN_XY` is 3.0.5+)
- jCardSim (pulled in by Maven; no hardware required for tests)
- Python 3.11+ for `tools/cardctl`: **not** macOS system Python 3.9, whose
  `pyscard` build fails at import

### Running tests

Build cardkit before installing app/ops dependencies (Yarn classic file dependencies
copy the built package):

```bash
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build)
(cd apps/provisioner && yarn install --frozen-lockfile)
(cd ops && yarn install --frozen-lockfile)
```

```bash
mvn -f applet/pom.xml test                    # applet
mvn -f tools/cardsim/pom.xml test             # card simulator bridge (compiles the applet in)
(cd tools/cardkit && yarn install --frozen-lockfile && node --import tsx --test 'gp/test/**/*.test.ts')
(cd apps/provisioner && yarn install --frozen-lockfile && node_modules/.bin/jest)
cd tools/cardctl && python3 test_bip340.py && python3 test_apdu.py
node --test 'tools/**/*.test.cjs'             # Node tools; set CARDSIM_URL for the bridge's integration cases
```

No hardware required for any of them.

### Building the CAP

```bash
ant -f applet/build.xml cap
```

CI selects affected components on pull requests and main pushes. App UI changes
run app checks and both Metro bundles; native/build changes also build Android.
Protocol, firmware, cardkit, authentication, recovery/persistence, CI policy and
unknown source paths run full integration, including simulated mint swaps. The
always-running `CI gate` fails if a required job is missing, skipped, cancelled or
unsuccessful. Manual and release CI run everything. See
[component releases](docs/COMPONENT-RELEASES.md) for exact job/deployment boundaries.

Use only `@cashu-card/cardkit`, `/cleanup`, and (for Node tests) `/testing` in
consumers. Do not import its private `gp/` files. A public API change moves the
SDK's own version and includes migration notes when incompatible. Firmware,
provisioner and ops versions are independent; app version/build identities must
agree across package.json, Android and iOS. Release tags do not themselves deploy
ops or upload mobile apps. Existing signing identities are preserved.

CAP conversion still compares every entry except `META-INF/MANIFEST.MF` to the
tracked CAP. An applet change ships its rebuilt CAP and new published hash;
ordinary host/UI changes preserve that file. Hardware reports remain the evidence
for actual device/card behavior.

## Key design principles

1. **Security first.** The card's private key must never leave the chip.
2. **Spend protection is irreversible.** A slot marked spent must never be
   unmarked. No APDU may exist that does so.
3. **Spec alignment.** Commands must match NUT-CCP and `spec/APDU.md`. If the
   spec is ambiguous, raise it before implementing.
4. **Portability.** Any JavaCard 3.0.5+ chip with secp256k1. Avoid
   chip-specific APIs.
5. **No allocation after install.** JavaCard Classic allocates `new` in
   persistent EEPROM and never collects it. Anything reachable from an APDU
   handler must use buffers allocated once at install
   (`JCSystem.makeTransientByteArray`).
   `SchnorrHWMathTest.noAllocationOutsideInstallTime` enforces this across every
   source under `applet/src/main/java/me/flashapp/cashu`. Each file needs an
   entry in that test's `INSTALL_TIME_METHODS` listing its install-time methods;
   a new file with no entry fails the test rather than going unchecked.
   There is one exception, since software 1.20: the 12,288 bytes that hold the
   mint's proofs are reserved by the first `SET_CARD`, because the chip will not
   install an applet whose constructor asks for that much more
   ([D17](docs/DECISIONS.md#d17)). The test lets through that one guarded
   statement (`ONCE_ONLY_ALLOCATIONS`) and nothing beside it.
6. **Local checks must be at least as strict as the mint's.** The card burns a
   slot *before* the mint sees anything, so a check looser than the mint's
   passes locally and still costs the proof. See
   [D7](docs/DECISIONS.md#d7).

## Pull requests

1. Open an issue first for significant changes.
2. All PRs must pass CI.
3. Security-sensitive changes (key handling, spend logic, anything in
   `SchnorrHW`) require two reviewers.
4. A change to the protocol's core starts as a pull request in
   [cashucard/nut](https://github.com/cashucard/nut), before any implementation
   changes. Changes to `spec/` (the command reference, its profiles and the
   vectors) are made here; [cashucard/javacard](https://github.com/cashucard/javacard)
   mirrors this repo's `spec/` after each merge and takes no spec PRs of its own.
5. **Do not claim testing you did not perform.** In a repo handling bearer
   funds, reviewers have to take those statements at face value.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Do not open a public issue for anything
affecting funds.
