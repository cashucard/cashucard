# AGENTS.md

The guide to this repository for its operator and for AI agents: what it is,
where things are, the commands CI runs, the conventions that cost a day when
missed, and the rules an agent works under. The design is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), the settled calls and their
reasons in [`docs/DECISIONS.md`](docs/DECISIONS.md), and the words in
[`docs/GLOSSARY.md`](docs/GLOSSARY.md). Read the first two before a change to
how the card behaves.

## What this repo is, and what cashucard/javacard is now

`cashucard/cashucard` is the working repository of the shared Cashu card
(protocol 2.1, one wire for Flash and for Foxy's wallet): the JavaCard applet,
its host tools and simulator, the command reference in `spec/`, the TypeScript card
library with the bench-spike app that installs the card from a phone, the provisioning app and its ops-service. It began as a copy of
`cashucard/javacard` main with its whole history. `cashucard/javacard`
is a read-only mirror of this repo's `spec/`: every PR that touches `spec/` here
is mirrored there with `tools/mirror-spec.sh` after it merges, and
cashucard/javacard takes no direct spec edits, so a change to `spec/` is always a
PR here. The protocol's core, NUT-CCP, is `CCP.md` in
[cashucard/nut](https://github.com/cashucard/nut), with its test vectors: a change to
the core starts there, before this repo implements it.

```bash
tools/mirror-spec.sh <path-to-javacard-checkout>          # dry run: the diff; exit 0 identical, 1 differs
tools/mirror-spec.sh <path-to-javacard-checkout> --apply  # copy spec/ as committed at HEAD, then git status there
# Either exits 2, changing nothing, while that checkout's spec/ or this one's has uncommitted changes.
# --apply also exits 2 unless HEAD is in origin/main (as last fetched) and its spec/ is origin/main's,
# and its history has the spec/ that checkout has committed: run it from main after the merge and a
# pull, never from a ticket's worktree. The dry run says when --apply would refuse.
# Nothing outside spec/ is touched. The commit and the push in cashucard/javacard are the operator's.
```

## Layout

| Path | What is there |
|---|---|
| `applet/` | The card's firmware: JavaCard 3.0.5, the floor ([D6](docs/DECISIONS.md#d6)), package `me.flashapp.cashu`. One load file holds three applets, installed in this order: the opener (`Opener`, AID `F0 43 41 53 48 55 43 41 52 44 4D`, which does nothing and comes first because the J3R180 will not take the card's applet as the package's first instance), the card's applet (`CashuApplet`, with `SchnorrHW`; `F0 43 41 53 48 55 43 41 52 44 01`) and the NFC tag (`Tag`). The jCardSim suite is `applet/src/test/java/`. |
| `applet/target/cashu-javacard-2.1.0.cap` | The tracked CAP: the file [`docs/HARDWARE_DEPLOYMENT.md`](docs/HARDWARE_DEPLOYMENT.md) has an operator install, by its sha256. CI's `cap` job converts the source again and fails unless every entry but `META-INF/MANIFEST.MF` is byte-identical to the tracked file's, unless the guide publishes the tracked file's sha256, and unless `tools/cardkit/make-assets.py`'s pins and `apps/provisioner/src/assets/cashu.ts` match it. |
| `tools/cardctl/` | The reference host driver, Python over PC/SC: `cardctl.py`, the BIP-340 verifier `bip340.py`, the owner's P-256 `p256.py`, and seven test files that need no reader, no card and no pyscard. Its venv is the one [`tools/cardctl/README.md`](tools/cardctl/README.md) documents: a Homebrew Python, `.venv` in `tools/cardctl/`, never the macOS system Python 3.9 (pyscard installs there and fails at import). |
| `tools/cardsim/` | The real applet in jCardSim on `http://127.0.0.1:9876`, for the apps' end-to-end runs: the HTTP bridge, its Node client `client.cjs`, the Cashu arithmetic `cashu-crypto.cjs` and the mint e2e `e2e-swap.test.cjs`. flash-pos and flash-mobile pin it by `CASHU_JAVACARD_REF`, so its routes, fixtures and client are a contract with both apps ([`tools/cardsim/README.md`](tools/cardsim/README.md)). `run.sh` and `ctl.sh` are Foxy's line-protocol simulator on port 47431. |
| `tools/chip/` | On-chip checks, Foxy's bench scripts for a card in a reader: `run.sh` puts the card on a loopback port, `reset.sh` resets a card the reader gave up on, `proofstore.sh` checks the store of the mint's proofs on a blank card. They drive a real card (the rules below). |
| `tools/` | Also: `stripcap.py` and `refcheck.py`, which the CAP build runs; `e2e-melt.cjs` and `e2e-redeem.cjs`, 0.x tools that drive a 0.x card and a mint, kept for the sweep of 0.x field cards; `mirror-spec.sh` and its test `mirror-spec.test.sh`. |
| `spec/` | The command reference, mirrored to cashucard/javacard: `APDU.md` (the wire, byte for byte, with the profiles NUT-CCP leaves to implementations: the owner, the clock and the limits, the NFC tag), `CARD-FILE.md` (the 0.x interchange format) and `vectors/` (`headers.json`, `owner.json`, `secret.json`, `transcript.json`). |
| `docs/` | `ARCHITECTURE.md`, `DECISIONS.md` (settled decisions and historical supersessions), `SECURITY-MODEL.md`, `HARDWARE_DEPLOYMENT.md` (build, install, reinstall, the AIDs), Foxy's design (`FOXY-CARD-*.md`), the provisioner's (`PROVISIONER-APP.md`), and one hardware report for each silicon milestone, named `HARDWARE_TEST_REPORT_<YYYY-MM-DD>.<chip>.md` (including the 2026-10-23 full E2E and mobile reset reports). |
| `tools/cardkit/` | Installs the card's applet and rotates the card manager's keys over GlobalPlatform SCP02, as environment-agnostic TypeScript (ENG-738, [D27](docs/DECISIONS.md#d27)): a vendored DES, the session, the commands and the recovering install, with no NFC, HTTP or platform import. The transport is injected as `type Transceiver = (apdu: number[]) => Promise<number[]>`, so the phone and Node run the same code and `gp/test/` runs it against a fake card. Also here: `make-assets.py`, which writes the provisioner's load files from the CAPs, and `hello/`, the smoke test's one-applet package (not the card's: `ant -f applet/build.xml hello-cap` builds it, `HelloTest` runs it in jCardSim). |
| `apps/provisioner/` | React Native operator app (bundle `com.islandbitcoin.provisioner`): authenticated batches, installation, recovery, card status and owned-card reset. It consumes `@cashu-card/cardkit` through `src/cardkit.ts`; demo mode is removed and bench tools are release-gated off. `src/assets/` is generated from the pinned CAP. Holder ownership/PIN/funding belongs in a wallet. |
| `ops/` | Operator APIs/admin console, scoped reservations, chip identity, manager-key escrow, installation/reset receipts, backup exports and recovery fences. Node/SQLite locally; Workers/Durable Object SQLite in deployment. |
| `.github/workflows/`, `tools/ci/`, `tools/release/` | Affected-component CI and the always-running CI gate; independent tag releases and explicit deploy/store-upload pipelines. See `docs/COMPONENT-RELEASES.md` for versions, signing/environment setup and unverified live steps. |

## Build, test and check

CI (`.github/workflows/ci.yml`) runs on main pushes and pull requests.
Affected-component selection retains full integration for protocol/recovery and
unknown source paths; manual and release verification are full. Require `CI gate`
in branch protection; see `docs/COMPONENT-RELEASES.md`. These are its commands, copied from it, under the job each belongs
to; run the jobs your change touches before you push. Nothing here needs a card.
Build cardkit before either consumer installs its `file:` dependency:

```bash
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build)
(cd apps/provisioner && yarn install --frozen-lockfile)
(cd ops && yarn install --frozen-lockfile)
```

Runtime imports use `@cashu-card/cardkit` and `/cleanup`; only Node tests use
`/testing`. Deep `tools/cardkit/gp` imports are unsupported. Yarn classic copies
file dependencies: rebuild and refresh consumer installs after SDK edits.
Two blocks are marked CI-only: they need the runner (`sudo apt-get`, a `pip`
outside any venv, `$RUNNER_TEMP`), and the workstation's way follows each.

`test`, jCardSim tests (JDK 11 and 17):

```bash
mvn -B -f applet/pom.xml test
```

`cardsim`, the cardsim bridge (JDK 11 and 17, Node 22). The jar's build compiles
`applet/src/main/java` in as well, then the jar is started and driven. The `for`
line is CI's wait for the bridge, up to 30 s for `/state` to answer: a SELECT
sent before it does fails. It ends in `break` where CI's step has `exit 0`,
which would end your shell.

```bash
mvn -B -f tools/cardsim/pom.xml package
java -jar tools/cardsim/target/cardsim.jar --port 9876 &
for i in $(seq 1 60); do curl -sf localhost:9876/state >/dev/null && break; sleep 0.5; done
curl -sf -X POST localhost:9876/apdu -d '{"hex":"00A404000BF043415348554341524401"}' \
  | grep -q '"hex":"02019000"'
curl -sf -X POST localhost:9876/apdu -d '{"hex":"00A404000AF0434153485543415244"}' \
  | grep -q '"hex":"9000"'
CARDSIM_URL=http://127.0.0.1:9876 node --test tools/cardsim/client.test.cjs
CARDSIM_URL=http://127.0.0.1:9876 MINT_URL=http://127.0.0.1:3338 EXPECT_KEYSET_ID_BYTES=33 EXPECT_INPUT_FEE_PPK=100 \
  node --test tools/cardsim/e2e-swap.test.cjs
CARDSIM_URL=http://127.0.0.1:9876 MINT_URL=http://127.0.0.1:3339 EXPECT_KEYSET_ID_BYTES=8 EXPECT_INPUT_FEE_PPK=0 \
  node --test tools/cardsim/e2e-swap.test.cjs
```

The two swaps need the Nutshell 0.20.3 mints (FakeWallet) that the steps "Start
a Nutshell 0.20.3 mint" (port 3338, a v2 keyset) and "Start a Nutshell 0.20.3
mint on a pre-v2 keyset (forge's shape)" (port 3339) start in Docker: run those
steps as ci.yml has them.

`cardctl`, cardctl tests (Python 3.11 and 3.13). The seven suites run in
`tools/cardctl` (the step's working directory):

```bash
python test_bip340.py
python test_p256.py
python test_apdu.py
python test_spec_consistency.py
python test_card_file.py
python test_hwtest_65byte_pubkey.py
python test_tip.py
```

The second step proves `requirements.txt` installs and pyscard imports. It is
CI-only, for the runner's Ubuntu and a `pip` with no venv:

```bash
sudo apt-get update
sudo apt-get install -y swig libpcsclite-dev
pip install -r tools/cardctl/requirements.txt
python -c "import smartcard.scard; print('pyscard import OK')"
```

On a workstation the same proof runs in the venv of the layout's `tools/cardctl/`
row, the one [`tools/cardctl/README.md`](tools/cardctl/README.md) makes:

```bash
cd tools/cardctl && .venv/bin/pip install -r requirements.txt && .venv/bin/python -c "import smartcard.scard"
```

`e2e-tools`, e2e tool tests (Node 22). The bridge and mint cases skip without
`CARDSIM_URL` and `MINT_URL`:

```bash
node --test 'tools/**/*.test.cjs'
```

`tools`, the spec mirror script:

```bash
sh tools/mirror-spec.test.sh
```

`cap`, CAP conversion (JDK 17, Ant), with the JavaCard SDKs of
`martinpaljak/oracle_javacard_sdks` at `6a75ec0d6913db236d354f154df7dbc9573d976d`
checked out at `.javacard-sdks`. The tracked CAP is set aside, the source is
converted (the build runs `tools/stripcap.py` and `tools/refcheck.py`), and the
step "Tracked CAP matches the source and the deployment guide" compares the
two. The step "Hello CAP, and the provisioner's load files match the CAPs" builds
the hello applet and runs `make-assets.py --check` on the set-aside CAP. CI-only:
`$RUNNER_TEMP` and `$GITHUB_WORKSPACE` are the runner's, and unset anywhere else.

```bash
mv applet/target/cashu-javacard-2.1.0.cap "$RUNNER_TEMP/tracked.cap"
ant -f applet/build.xml cap -Djc.sdk="$GITHUB_WORKSPACE/.javacard-sdks/jc305u4_kit"
ant -f applet/build.xml hello-cap -Djc.sdk="$GITHUB_WORKSPACE/.javacard-sdks/jc305u4_kit"
python3 tools/cardkit/make-assets.py --check --cap "$RUNNER_TEMP/tracked.cap"
```

On a workstation, [`README.md`](README.md) has the build (the SDKs once, then
`ant` with its default `jc.sdk`, `~/.javacard/sdks/jc305u4_kit`). Set the tracked
CAP aside first, as CI does: `ant cap` rewrites its manifest build time, so a
`--check` against the rewritten file fails at the CAP pin. Run top to bottom:

```bash
git clone https://github.com/martinpaljak/oracle_javacard_sdks ~/.javacard/sdks

cp applet/target/cashu-javacard-2.1.0.cap "${TMPDIR:-/tmp}/tracked.cap"   # the committed CAP, before ant touches it
ant -f applet/build.xml cap
ant -f applet/build.xml hello-cap
python3 tools/cardkit/make-assets.py --check --cap "${TMPDIR:-/tmp}/tracked.cap"
git checkout -- applet/target/cashu-javacard-2.1.0.cap                     # restore the tracked CAP; never commit a local rebuild
```

The README also has the tests, which CI runs in the jobs above:

```bash
mvn -f applet/pom.xml test           # applet: jCardSim, no hardware needed
mvn -f tools/cardsim/pom.xml package # card simulator bridge, its suite, and the jar
node --test 'tools/**/*.test.cjs'    # client and Cashu arithmetic (bridge and mint cases skip)
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build && node --import tsx --test 'gp/test/**/*.test.ts')  # SCP02 and the phone's install, against a fake card
(cd apps/provisioner && yarn install --frozen-lockfile && node_modules/.bin/jest)                         # the provisioner app
cd tools/cardctl && for t in test_bip340 test_p256 test_apdu test_spec_consistency test_card_file test_hwtest_65byte_pubkey; do python3 $t.py; done
```

`tools/cardsim/cardsim.sh` runs the bridge from source, via Maven (README's
"Card simulator").

`cardkit`, the install against a fake card (Node 22, yarn classic), run in
`tools/cardkit`; the library typechecks with no Node types (it runs on the phone):

```bash
yarn install --frozen-lockfile
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/tsc -p tsconfig.test.json --noEmit
node --import tsx --test 'gp/test/**/*.test.ts'
yarn build && yarn test:package
node_modules/.bin/prettier --check .
```

`provisioner`, the app (Node 22, yarn classic), run in `apps/provisioner`. The
bundles prove Metro resolves the installed public cardkit package;
`$RUNNER_TEMP` is the runner's, so point it at a scratch directory first.

```bash
yarn install --frozen-lockfile
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint .
node_modules/.bin/jest
node_modules/.bin/react-native bundle --platform ios --dev false --entry-file index.js --bundle-output "$RUNNER_TEMP/provisioner-ios.js"
node_modules/.bin/react-native bundle --platform android --dev false --entry-file index.js --bundle-output "$RUNNER_TEMP/provisioner-android.js"
```

<a id="conventions-that-bite"></a>

## Implementation conventions

- **SELECT answers the applet's version, and a wire change moves it.** The
  card's applet answers `SELECT` with `02 01 90 00` (2.1), and `GET_INFO`
  begins with the same two bytes. `CashuApplet.VERSION_MAJOR` and
  `VERSION_MINOR` move with every wire-visible change of behaviour and every
  fix a card in the field has to be told apart by (the comment above them;
  [D26](docs/DECISIONS.md#d26) is 2.1's). `AidVersionTest` pins them, the CAP's
  name carries the version, and a change to the wire is a change to Foxy's
  wallet too: agree it with them first.
- **Readers select the applet's whole AID, `F043415348554341524401`, never the
  package AID `F0434153485543415244`** (ENG-681, [D25](docs/DECISIONS.md#d25)).
  On the chip the package AID reaches the opener, which answers `90 00` with no
  version and `6D 00` to every command after. jCardSim gave the package AID to
  the card's applet, so every suite passed a SELECT the chip answers with the
  opener; `tools/cardsim` now resolves a partial name as the chip does.
- **jCardSim proves protocol logic, never silicon** ([D10](docs/DECISIONS.md#d10)).
  It runs on the JVM with a garbage collector and cannot reproduce EEPROM
  exhaustion, torn writes or hardware crypto framing. A green suite is not
  evidence about a chip; a hardware report is.
- **Nothing is allocated after install.** JavaCard Classic never frees `new`,
  so an allocation on a command's path leaks EEPROM on every tap.
  `SchnorrHWMathTest.noAllocationOutsideInstallTime` scans every applet source,
  and a new source file needs its entry in that test's `INSTALL_TIME_METHODS`
  ([`CONTRIBUTING.md`](CONTRIBUTING.md), principle 5; the one exception is
  [D17](docs/DECISIONS.md#d17)'s).
- **Every design change gets a D-entry in [`docs/DECISIONS.md`](docs/DECISIONS.md):**
  what was decided, what was rejected and why. Use the next unused D-number; anchors are
  stable, and a superseded entry is marked and kept.
- **Every silicon milestone gets a hardware report file,**
  `docs/HARDWARE_TEST_REPORT_<YYYY-MM-DD>.<chip>.md`: the card, the
  environment, the CAP's sha256, what ran, and what was not covered.
- **An applet change ships its CAP.** The rebuilt
  `applet/target/cashu-javacard-2.1.0.cap` (JDK 17, `jc305u4_kit`) is committed
  with its new sha256 in `docs/HARDWARE_DEPLOYMENT.md`, or the `cap` job fails.
  A local `ant` run rewrites the tracked file (the manifest records the build
  time), so with no applet change, restore it from git rather than commit it.
  It also moves cardkit's pins: `CAP_SHA256`, `LOAD_FILE_SIZE` and
  `LOAD_FILE_SHA256` in `tools/cardkit/make-assets.py` (then run it and commit
  `apps/provisioner/src/assets/`), the size and block counts in
  `tools/cardkit/gp/test/load.test.ts` and `provision.test.ts` and in the
  provisioner's `__tests__/session.test.ts` and `cardkit-in-the-app.test.ts`,
  and on a version move the CAP's path and name in `make-assets.py` and the
  `02 01` in `gp/provision.ts`'s checks, `gp/test/fake-card.ts`, and the
  provisioner's `src/copy.ts` and its test (`gp/test/provision.test.ts` holds
  the first two to `CashuApplet.java`'s version). `H0_LOAD_FILE_SHA256` in
  `gp/test/transcripts.test.ts` stays: it is the load file in the owner's
  capture, and only a new capture moves it.
- **On a card, delete the tag, then the card's applet, then the opener, and only
  then the package** (`D2760000850101`, `F043415348554341524401`,
  `F04341534855434152444D`, `F0434153485543415244`): the chip refuses to delete
  an instance something still refers to. Reinstall the opener first and the tag
  last. Sweep a card before deleting its applet: every piece on it is locked to
  its key ([`docs/HARDWARE_DEPLOYMENT.md`](docs/HARDWARE_DEPLOYMENT.md)).
- **Some names keep `cashu-javacard` on purpose:** the CAP's file name (from
  `applet/build.xml`), the CI artifact `cashu-javacard-cap`, and the seed of the
  TEST owner key, `cashu-javacard/cardctl test owner key`, which
  `tools/cardctl/p256.py`, the cardsim client and `OwnerKey.java` share and
  `SimCardTest` checks. They are not links to the old repository; renaming one
  is a build or key change of its own.
- **The H0 tests skip until the owner's `gp -d` captures land.** A missing log in
  `tools/cardkit/gp/test/fixtures/` skips its test with `pending H0 fixtures`, and
  a present one makes it required. The skips are expected, and an agent never
  writes a fixture ([`README.md`](tools/cardkit/gp/test/fixtures/README.md) there).
- **The provisioner's load files are pinned.** `tools/cardkit/make-assets.py` pins
  the tracked CAP's sha256 and the card's load file by size and sha256, and writes
  `apps/provisioner/src/assets/` (run it, never edit them); the app re-checks the
  hash before it sends a byte. The tracked CAP is never rebuilt for this: a local
  `ant cap` run rewrites it, so restore it from git first. A new CAP moves the
  pins, every one of them listed under shipping the CAP, above.
- **[D27](docs/DECISIONS.md#d27) covers SCP02 and the vendored DES** (`gp/des.ts`),
  not a package's or a native cipher; SCP02 is all the J3R180 offers. A failed
  login counts towards a lock that is for good, so nothing is retried.

## Rules for agents

- **Never touch cards, readers or phones** unless the ticket's approved plan
  names the device and the actions, and then do exactly those actions. That
  covers `gp`, `tools/chip/`, `tools/e2e-melt.cjs` and `tools/e2e-redeem.cjs`,
  every `cardctl` command (its test files are fine) and an app build on a
  device. jCardSim and `tools/cardsim` need no permission.
- **Never read or write production systems.** That includes the mint at
  `forge.flashapp.me`. The mints in CI are local Nutshell containers with
  FakeWallet; use those.
- **Secrets never pass through prompts or shell history:** PINs, PUKs,
  GlobalPlatform keys other than the factory set (`40` to `4F`) and ENG-738's
  public spike set (`10` to `3F`, in `tools/cardkit/gp/scp02.ts`), and owner
  keys other than cardctl's published TEST key. A step that needs one is the
  operator's.
- **Every behaviour change ships with a test that fails before the change.**
  Run it both ways, and say in the PR what you ran; do not claim testing you
  did not do.
- **Changes to `spec/` are made here, and changes to the core in cashucard/nut;
  never in cashucard/javacard.** Do not push to
  `cashucard/javacard`: the mirror's commit and push there are the
  operator's.
- **ENG-738's hardware steps are all the owner's,** gates H0 to H3: the `gp`
  captures of the spare card (H0), the native builds and runs on the phones
  (H1), the bench runs and drills (H2), and the readouts, screenshots and OS
  versions from the phones (H3). Its plan names no device for an agent. iOS pods
  and signing are the owner's too
  ([`apps/provisioner/README.md`](apps/provisioner/README.md)).
