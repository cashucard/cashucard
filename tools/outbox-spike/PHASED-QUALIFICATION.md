# Private qualification phases

## Current evidence

The [October 31 hardware report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-31.j3r180-full-capacity-recovery.md)
establishes physical signing, export verification and retirement of the fixed
128-input/128-output packet. The Pixel received a successful SIGN response and
stopped at the 120-second elapsed gate. The approved ACS recovery exported and
verified the committed packet, retired it and returned card 09336320 to blank.

`many-records.cjs` defines the next fixed recipe. The simulator executes it
against the same JavaCard engine. Its phase boundaries and command counts are
offline evidence; physical runtime and interrupted writes still require
qualification. The controller, closed USB policy and campaign admission now have
local simulator coverage, including the installation-only Pixel build and the
receipt that admits phase zero. Hardware access still requires a new named
approved plan.

## Record recipe

The recipe starts with an installed private applet. It uses public synthetic
data from `fixtures/compact-capacity-v1.json`: 46 distinct initial proofs, one
keyset and one input/output per payment. Each canonical packet is 430 bytes and
occupies two of the 90 payload pages. Forty-five records fill the page pool
while 19 header slots remain available.

| Phase | Commands | Checks |
| --- | ---: | --- |
| Prepare fixture | 50 | Set context and keyset, load 46 proofs, check empty record store |
| Capture records 0–14 | 79 | Sign and export 15 records |
| Capture records 15–29 | 79 | Reselect, check state, sign and export 15 more |
| Capture records 30–44 | 79 | Reselect, check state, fill the page pool |
| Refuse and verify full store | 140 | Refuse proof 45 before consumption; compare all 45 scopes and packets |
| Retire, reload and reuse | 13 | Retire record 0, reload proof slot 0 at generation 2, sign record 46, reject the old acknowledgement |
| Verify after reuse | 138 | Compare all 45 current records, including the replacement |
| Retire verified records | 49 | Retire each current scope and confirm reclaimed storage |

Each phase after preparation resets and selects the applet, then checks its
public key and expected status. Captures verify both BIP-340 signatures, exact
canonical bytes and packet identity. Repeated exports must match the retained
scope and packet byte for byte. The replacement has a different packet identity
and generation; the old retirement scope must return `6985` without changing it.

The final status is `[64, 90, 1, 0, 127, 0]`: free headers, free pages, unspent
proofs, spent proofs, empty proof slots and staging state. Proof 45 remains
unspent throughout the refusal/reuse checks. Returning a physical test card to
blank would include separately approved disposal of this synthetic proof and
private-package cleanup.

## Live execution requirements

A live executor must persist admission, per-command intent and received replies,
plus each verified packet, before moving to the next phase. It must bind the
card's CPLC, public key, installation context, image and source fingerprints to
one invocation and preserve earlier phone journals. Each phase keeps the
existing response deadline and 120-second elapsed gate. The counts above provide
a command bound; measured device timings determine whether a phase fits.

An uncertain SIGN requires inspection of the saved intent and committed scope
on the same card. Recovery exports and verifies the existing record before any
retirement. It does not issue another SIGN for that payment. Retirement uses
the exact verified installation, slot, payment ID, generation and packet ID.
The simulator harness executes a command transcript and checks its results
afterward; it cannot serve as this live executor.

## Local phase controller

`phase-recovery.cjs` provides `createJournal`, `executePhase` and
`reconcilePhase`. The caller supplies a transceiver, storage callback, public
installation key and runtime fingerprint. Each invocation derives its next
command from retained receipts for the fixed recipe. It validates the saved
binding and canonical packets before its transport budget begins. The binding
covers the run ID, named CPLC, public key, installation context, qualified image,
recipe, controller/codec/SDK files and externally pinned runtime.

Before recipe commands, the controller selects the ISD, reads CPLC, selects the
private applet and checks its key, format-5 diagnostics and commit floor. An
initialized phase also checks the expected proof/record counts. The controller
persists each command's intent before transmission and its reply before checking
the elapsed gate. A completed export carries durable verification metadata
before a later command can retire its scope. Native-call durations include the
transport/bridge envelope; they remain separate from physical timing evidence.
Each invocation permits at most 160 commands, a 30-second response deadline and
a 120-second gate on further transmissions.

An unresolved command blocks normal execution. Reconciliation uses selection
and public read commands; the applet may complete existing burn/reclamation
bookkeeping while handling them. For an uncertain SIGN, it reads the exact
slot's scope and packet, verifies identity/generation and both signatures, and
checks the expected committed state. The receipt is labelled as recovered,
preserving the distinction from a received SIGN reply. A later execution starts
with exports for that record, so signing occurs once.

For an uncertain retirement, reconciliation requires the old scope to be absent,
every other retained scope/packet to match, and the exact post-retirement counts.
A present scope, an unpublished SIGN, incomplete staging, an uncertain setup or
proof load, or inconsistent evidence stops for reviewed recovery. This controller
automatically resumes only the supported states; its recovery path issues no
SIGN, RETIRE, setup, load or authentication commands.

`phase-journal.cjs` holds an exclusive file lease around the caller's operation.
It requires an operator-owned private directory and file, rejects symlinks and
hardlinks, and writes through a new file followed by file sync, rename and
directory sync. A future device launcher must verify its actual runtime/artifact
hashes and installation receipt, then acquire the lease before opening its
connection. Its transceiver should open the device lazily on the first admitted
command, after source/receipt validation; connection setup then counts inside
the invocation budget. A lock left by an interrupted process blocks execution until
reviewed recovery; it is retained on restart. Earlier Pixel journals use their
existing paths and are outside this controller's storage.

## Closed USB admission

`preparePhase` compiles the next invocation into an exact ordered wire program.
It includes the CPLC/key/diagnostic/state checks, expected replies, and retained
canonical packets for every retirement scope. Unexpected BEGIN or APPEND replies
stop the controller before signing. Program generation uses local files and
performs no device access.

`phase_wire.py` independently restricts commands to this fixed synthetic recipe,
phase and namespace. It verifies the canonical metadata, packet identity and both
BIP-340 signatures for each retirement packet using the Python reference
verifier. `phase_bridge.py` validates the private request file and its hash before
importing PC/SC or enumerating readers. It uses the named ACS ACR122U exclusively,
checks every command and reply in order and stops after a mismatch. Recovery
programs contain selection and public reads only; GlobalPlatform management,
installation, deletion and manager-key changes are outside this bridge.

`phase-device.cjs` checks the campaign hash and explicit approval, clean local
source commit, qualified image, runtime, installation evidence and saved phase
journal. It acquires the journal lease, writes and syncs a new immutable wire
request, and rechecks static admission immediately before the lazy connection.
The runtime fingerprint includes the Node/Python executables, OS/architecture,
virtual-environment metadata, pyscard package and bridge/verifier sources.
Python runs with isolated imports, site startup disabled and bytecode writes
disabled, using a fresh private cache prefix and the pinned package directory.

The campaign format is `compact-phase-campaign-v1`. Its fields are `approved`,
`reader`, `chip`, `python`, `sourceCommit`, `binding`, `journal`, `artifact` and
`installation`. The binding uses `runId`, `key` (the compressed public installation
key) and `runtimeSha256`. The installation reference uses `path` and `sha256`.
The journal must already exist under its new run binding.

An installation receipt has format `compact-phase-install-v1`, the installer
source commit, and absolute path/hash pairs for the APK and captured phone
journal: `{format, sourceCommit, apk: {path, sha256}, journal: {path, sha256}}`.
`phase-install-receipt.cjs` reads both files itself. Each must be absolute, a
regular single-link file with no group/other permissions, owned by the invoking
account, inside a directory that account owns with no group/other permissions;
the APK is bounded to 200 MiB and the journal to 1 MiB, is opened
`O_NOFOLLOW`, and is hashed after an inode/device recheck.

The phone evidence must have plan `pixel-phase-install-v1`, status and stage
`installed-for-phases`, no failure, the public key matched by the campaign
binding, `factoryVersionVerified: 1`, `initialBaselineVerified: true`,
`installedRegistryVerified: true`, and uninitialized format-5 diagnostics.
`run-compact.cjs` reads those bytes at setup state 0: format 5, setup state
zero, no saturated counter, and both commit counters at least 128. Its build
records mode `phase-install`, the receipt's installer source, the pinned
manifest/CAP/load hashes and block count, and its artifact names the pinned
source and image hashes. Existing capacity or
cleanup journals, and any record carrying `blankBaselineVerified: true`, fail
this contract. The phone app journals no CPLC, so the card is the campaign's own
`chip`; the app admitted only that chip before installing.

The installer is `--mode phase-install` in `prepare-pixel.cjs`: private app
version code 5 (`0.0.5-lab`), plan `pixel-phase-install-v1`, journal key
`cashucard-private-capacity-install-v1`, the qualified image pins and
`pixel-install.json`. See [PIXEL-CONTROL.md](PIXEL-CONTROL.md) for its command
set. Its evidence comes from the phone journal the app writes; it must be
exported before the card is used again, and no host step reconstructs it.

Preview is the default and reads local files:

```sh
node tools/outbox-spike/phase-device.cjs \
  --campaign /absolute/private/campaign.json --sha256 CAMPAIGN_SHA256
```

`--mode reconcile` previews supported recovery. Actual execution additionally
requires `--execute`, a campaign with explicit named approval, and the complete
installation evidence. This software iteration grants no hardware approval.

Startup or close uncertainty retains the lease and records the host PID plus
the bridge PID when available. Clearing it requires reviewed recovery and
confirmation of the processes/connection state. A PID alone is insufficient
authority to remove a lease. Request files remain local evidence. Admission
errors print a fixed message, keeping private configuration values out of logs.

`phase-javacard-smoke.cjs` exercises all eight phases with this file journal and a
persistent JavaCard simulator. Its CPLC/ISD replies are synthetic; all private
commands execute against the real applet source. It kills a separate host
process after successful signing and before reply delivery, confirms the stale
lease blocks access, then clears that exact exited test worker's lease and
recovers from disk in a new host process. It also drops a successful retirement
reply. Both recoveries verify packet retention, and the run finishes with 46
SIGN commands and 47 retirement commands (including the required stale
acknowledgement refusal). This test's explicit lease cleanup is confined to its
temporary directory.

## Timing and presentation

The private Pixel controller records the native-call envelope separately from
the persistence envelope. Native time includes the JavaScript/native bridge and
queue. Persistence time includes serialization and the awaited storage callback.
`serializedCodeUnits` measures UTF-16 string length. Stored counters cover
completed saves preceding that snapshot, as marked by the `accounting` field;
the returned state also includes the final completed save.

A successful, exact-length private SIGN reply retains its 45-byte public scope
and native duration before the elapsed gate is checked. That observed scope is
recovery evidence and still requires packet verification. Journal diagnostics
exclude authentication response bodies and arbitrary native error messages.

`lab-journal.js` awaits every storage write. It presents progress once per
running stage and presents every armed/terminal update, preserving the latest
session and export metadata. Rendering is coalesced; durable barriers remain
unchanged. The existing CAP, image pins and timeout values remain unchanged.

## Offline verification

With Node 22, JDK 17 and the cardsim jar built, copy the reviewed private
artifact into a new scratch directory, excluding earlier `sim-src/` and
`sim-classes/` outputs. The adapter checks its generated source hashes before
creating fresh simulator outputs. Run:

```sh
python3 tools/outbox-spike/compile-compact-sim.py /absolute/private-artifact
node tools/outbox-spike/compact-javacard-smoke.cjs /absolute/private-artifact
node tools/outbox-spike/phase-javacard-smoke.cjs /absolute/private-artifact
node --test 'tools/**/*.test.cjs'
```

The simulator suite checks the recipe on the JavaCard engine, including the
capacity refusal, slot reuse and stale acknowledgement. Controller tests check
successful SIGN replies crossing the elapsed gate, separate timing counters,
lagged save accounting and storage-before-presentation behavior.
