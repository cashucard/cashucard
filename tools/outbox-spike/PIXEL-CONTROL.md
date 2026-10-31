# Pixel creation control

This private lab app tests creation through Android IsoDep after the ACS PC/SC
creation stops. It uses the unchanged CPROT/2, format-5 image from D152. A result
compares transport paths; it cannot by itself identify the cause of the ACS
failures or establish capacity and interrupted-write behavior.

## Scope

The only admitted chip is `cplc-v1:4790d3213041093363205547` (09336320). Its
original three platform load files must match byte for byte. The app verifies
the fixed 26,934-byte image hash, checks production and earlier probe absence,
proves the published factory keys at version 1, then loads the private package
and creates its opener and main instance. It selects CPROT/2, reads format-5
diagnostics and validates the public key. Setup and payment-fixture commands are
outside this control.

After a fully verified creation, it matches CPLC again, proves one fresh factory
channel, requires the exact private instance/package set alongside the original
baseline, deletes private main, opener and package, then verifies the blank
baseline. Every stopped stage preserves evidence and requires separately
reviewed cleanup; an uncertain command is never retried. There are at most 256
commands and a 120-second gate on further transmissions. Android uses the
existing 15-second IsoDep response timeout and requires a reported frame limit
of at least 261 bytes. Unconfirmed limits stop before APDUs. Cancelling requests NFC teardown
and stops further commands; a command already delivered can have taken effect.

Intent and public results are persisted around each transmission. The journal
contains stage, four-byte command header, status, timings, registry and public
key, excluding authentication frames, challenges and MACs. The first attempt is
consumed before NFC discovery. Relaunch preserves the consumed state. Sharing
the public journal is the only result-export action.

## Isolation

`prepare-pixel.cjs` creates a fresh project outside the checkout from committed
files. The application ID is `org.cashucard.compactlab`, with the label
**Cashu Card Lab**. It keeps the installed provisioner's app data separate.
The generated manifest removes Internet and overlay permissions, developer support is
disabled, release variants are disabled, and the sole signer is the published
Android debug key. A bundled JavaScript asset runs without Metro. The normal
CCP entry, ops-service client and store upload lanes are excluded from its entry
graph. Each artifact records its source, template/core/UI/session hashes and
the original CAP/load/manifest hashes.

## Local preparation

These commands build local files and access no phone or reader. Commit the
reviewed source before generation. Use a new private absolute output directory;
the generator refuses an existing directory or one inside this checkout.

```sh
node tools/outbox-spike/prepare-pixel.cjs --artifact /absolute/pinned-artifact --output /absolute/new-lab-project
cd /absolute/new-lab-project
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build)
cd apps/provisioner
yarn install --frozen-lockfile
mkdir -p android/app/src/main/assets
node_modules/.bin/react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2
```

Inspect the final APK manifest, application ID, signer and SHA-256 before
installation. Confirm that release tasks are absent and the merged APK requests
NFC but has no Internet permission. Preserve `lab-build.json`, build logs and
the exact APK with the reviewed physical plan.

## Physical approval gate

Prepare a plan naming the connected Pixel, card 09336320, exact APK/source/image
hashes, USB device-identification/install/launch steps, the single creation
session and successful return-to-blank sequence above. Obtain approval before
device inventory, installation, launching or card commands. Availability alone
is not that approval. The stopped ACS installation path stays paused.

Do not clear the lab journal, reinstall to bypass a consumed attempt, arm another
session after failure, enable CCP bench tools, change manager keys, or contact a
mint/ops-service under this plan. Physical findings belong in a dated hardware
report after the approved invocation.

## Fixed full-capacity mode

The creation control passed on Pixel 8 Pro in
[the hardware report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-compact-creation.md).
The next prepared software adds explicit `--mode capacity` to the generator.
This selects `org.cashucard.capacitylab` and a separate consumed journal, keeping
the creation app/evidence intact. Unknown modes fail before generation.
The CAP/load bytes, factory-key checks, identity and baseline rules stay pinned.

The sole capacity fixture is the committed 58,507-byte
`fixtures/compact-capacity-v1.json`, SHA-256
`15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e`.
The portable phone command builder matches the independent Node workload for
every setup/keyset/proof/staging/export command. It sets up the existing private
pool/DLEQ allocation, loads 128 synthetic proofs, stages 128 merchant outputs
through 22 commands, signs once, reselects and exports 23,163 bytes through 91
pages. These are synthetic fixtures; the APK has no mint or ops-service traffic.

Persist each received page before requesting the next. The portable verifier
rebuilds every canonical byte from the pinned fixture and observed card key,
matches the exact record identity/generation and packet hash, and verifies both
BIP-340 signatures with the installed noble library. It matches the existing
Node codec, whose BIP-340 implementation supplies an independent check in tests.
Only after saving the complete verified packet does the controller retire that
exact scope, require 128 empty slots/64 free headers/90 free pages, and enter the
existing fresh-channel private-only cleanup. Any stopped or invalid export,
signature, status, scope or persistence result preserves evidence and sends no
retirement or deletion.

The capacity ceiling is 512 commands, matching the existing fixed host capacity
runner. The 120-second elapsed gate, 15-second native response timeout, one
signing attempt and short-frame limit remain. This control tests one large
record; many-small-record and physical interrupted-write tests are separate.
The capacity APK and its physical run need a fresh named approved plan; the
completed creation plan is consumed. A successful run ends blank. A stopped
signing/export run keeps the card and journal aside for reviewed recovery.

## Failure diagnostics and preserved attempts

The [first Pixel capacity invocation](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-capacity-load-stop.md)
stopped during proof loading. The pinned Android dependency 3.17.2 collapses
transceive exceptions into `transceive fail`. The generated lab's postinstall
now applies a hash-pinned, idempotent change to its own dependency copy. Only
the transceive catch changes: it returns one fixed token for TagLostException,
IOException, SecurityException, IllegalStateException or other Exception, and
omits the original exception log. IOException has several possible causes;
the category supplies no timeout diagnosis. The dependency's NFC behavior and
the normal CCP source/dependencies are unchanged.

The controller measures the JS-to-native await after durable command intent.
On rejection or short reply it retains `failedExchange` with command number,
stage, finite category and elapsed milliseconds, or null for an invalid clock
measurement. Bridge/queue time is included. Raw native messages, stacks,
authentication frames and nested causes are excluded. An unknown error maps to
`unclassified`. The main failure remains `transport-uncertain`, and every such
stop preserves the card without retry, retirement or automatic cleanup.
Session-finalization errors preserve an earlier stopped reason and evidence.

The generated version is 0.0.2-lab (code 2). Explicit
`--mode capacity-diagnostics` keeps application ID `org.cashucard.capacitylab`
for an approved upgrade, and uses plan `pixel-capacity-diagnostics-v1` with key
`cashucard-private-capacity-diagnostics-v1`. The prior
`cashucard-private-capacity-v1` record stays in the same app storage. Existing
creation/capacity modes retain their consumed keys. The diagnostic mode admits
the same image, fixture and command path, with unchanged bounds. Unknown modes
are refused. It has a single start action, and its own journal prevents a
second diagnostic invocation. Installation, upgrade and arming require their
own exact approved plan; preparing this software authorizes no device access.

Preserve the pre-upgrade database archive and journal as evidence. A named run
plan should collect terminal results after the operator reports completion or
stop, avoiding host UI automation during card commands. That removes an
unmeasured observation variable without assigning it as the earlier cause.
Local native-classifier regressions need JDK 17; CI installs it explicitly.

## Optimized image control

The [offline access profile](COMPACT-ACCESS.md) records the prototype's page
traversal changes and preservation checks. Explicit `--mode capacity-optimized`
admits only the new image pins in `pixel-optimized.json`: source
`038e298ec7c846cec75e7e40366b1bc4d25a88d6`, 27,343 load bytes, 111 blocks,
the same private AIDs and CPROT/2 format 5. Existing modes keep their old image
pins, so use the matching retained artifact directory when generating a build.

This mode generates private app version code 3, titled Pixel optimized capacity,
with plan `pixel-capacity-optimized-v1` and key
`cashucard-private-capacity-optimized-v1`. It preserves both earlier capacity
and diagnostic keys in the same app sandbox. Its normal fake path has 396
commands, retaining the existing 512-command ceiling, 120-second elapsed gate,
15-second native timeout and short-frame limit. Packet verification, durable
pages and verified packet, scoped retirement and cleanup admission are
unchanged. A source/image mismatch stops before the first APDU.

Prepare and review an exact APK and named plan before upgrading or arming this
mode on a phone. Preserve and compare both prior journals around the approved
upgrade. Follow the diagnostic plan's operator-reported terminal result and
conditional cleanup boundaries. The offline access improvement has yet to be
measured on silicon; the earlier plans are consumed.
