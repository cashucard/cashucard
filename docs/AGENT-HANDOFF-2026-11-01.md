# Cashu Card assisted settlement handoff

Updated November 1, 2026. The next task is an installation-only Pixel lab build
and its receipt generator. The durable phase controller, closed USB bridge and
admission checks are implemented and tested locally. Hardware qualification of
the many-record workload remains open.

## Start here

```sh
cd /Users/dread/Repos/cashu-card-pixel-capacity
git status --short
git branch --show-current
git log -4 --oneline
```

Use this checkout and branch `feat/compact-phase-recovery`. The tested code head
is `1bbc62884db90ba9fd407bee3bdec02e48e122c5`. This handoff is saved in a subsequent
documentation-only local commit. Check `git rev-parse HEAD` for the current head;
campaign admission requires the actual clean head, including documentation
commits, rather than an older copied `sourceCommit`.

Read these before implementation:

1. [Repository rules](../AGENTS.md), [architecture](ARCHITECTURE.md) and
   [decisions D162 through D164](DECISIONS.md).
2. [Phase recipe and admission contract](../tools/outbox-spike/PHASED-QUALIFICATION.md).
3. [Last physical hardware report](reports/HARDWARE_TEST_REPORT_2026-10-31.j3r180-full-capacity-recovery.md).
4. The current implementation plan at
   `/Users/dread/Repos/cashu-card-assisted-settlement-plan/reports/Assisted settlement implementation plan.md`.
   Its current-status section and October 31 / November 1 follow-ups supersede
   older progress snapshots. It remains local and uncommitted in that worktree.

The original `/Users/dread/Repos/cashu-card` checkout is on a different main head
and had four dirty entries when checked for this handoff. Other worktrees and
unrelated development servers exist. Leave those changes, worktrees and servers
intact.

## User instructions and authorization

- The user explicitly said: **“keep all these iterations local, no need to push
  to github.”** This supersedes earlier standing permission to open and merge
  PRs. Local signed commits are being used; these two implementation commits
  have no remote push, PR or CI run.
- The user now requested a handoff and wrap-up. Implementation is stopped at
  this boundary for the next agent.
- All earlier hardware plans and invocation locks are consumed. There is no
  fresh hardware approval for this iteration. Old “ready,” “approved,” or
  “card on reader” answers authorize only their historical named plans.
- Follow AGENTS.md: prepare a concrete plan naming devices and exact actions,
  then obtain fresh approval before card, reader, phone, ADB or device-build
  access. Offline source work, APK generation without a device, pure tests and
  jCardSim are available now.
- Production systems and the live mint are outside this work. Keep real keys,
  PINs, recovery phrases and credentials out of chat, logs and shell arguments.
- ACS installation attempts remain paused. The intended installation path is
  Pixel NFC; USB work starts with the already installed private image.

## Goal and release boundary

Assisted settlement lets an independent online wallet relay an offline till's
exact pending swaps, recover the original merchant outputs and reclaim verified
spent storage so the holder can top up. It must preserve the till's proceeds,
change obligations and durable recovery, including after replies are lost.

Current work qualifies a private storage/signature prototype and its test
tooling. Production authorization, load provenance, authenticated retirement,
physical interrupted-write qualification, final wire/descriptor review and
wallet/till integration remain in the larger plan. Released firmware, protocol,
provisioner assets, ops deployments and store builds were unchanged by these
local iterations. Build 13 is the last recorded provisioner release in the
implementation plan; current store availability was not checked during this work.

## Local commits

| Commit | Result |
| --- | --- |
| `2e02860730b6c53229c280eca8c5cc2bc9bbbd63` | Previously merged PR #228: fixed many-record simulator recipe, SIGN/native/storage diagnostics and coalesced presentation with every durable write retained. This is the published base known to this task. |
| `c27a43ddcd917a21d88f30445a80eb81be536a0f` | Local: durable phase execution, file journal and scoped lost-response recovery. |
| `1bbc62884db90ba9fd407bee3bdec02e48e122c5` | Local: exact wire compilation, independent Python policy/retirement verification, USB transport and campaign admission. |

The task checkout was clean at `1bbc628` before adding this handoff. The plan
worktree has untracked `reports/` and `research_notes/` containing local work;
preserve them. Avoid resets, cleans or worktree pruning as a handoff operation.

## Last physical state

| Item | Last recorded state |
| --- | --- |
| Card | J3R180 serial `09336320` |
| CPLC | `cplc-v1:4790d3213041093363205547` |
| Reader | `ACS ACR122U PICC Interface` |
| Phone | Pixel 8 Pro, USB `42201FDJG00048`, Android 17 / API 37 |
| Card result | Verified blank original platform baseline, private objects removed, manager keys unchanged |
| Reader result | Closed successfully |
| Plan | Consumed |

The record dates from October 31. Current connection and identity require a
fresh check under the next approved plan.

On October 31, the Pixel installed the streamed image, loaded all 128 inputs and
staged 128 outputs. SIGN returned `9000` at command 292, then the elapsed gate
stopped further commands. The approved reader recovery found the committed
record, exported all 91 pages / 23,163 canonical bytes, verified both signatures
in Node and independent Python, retired the exact scope and returned the card to
blank after 117 recovery commands. The phone's single-pass elapsed gate did not
pass. This establishes full-fixture physical capacity and recovery, with the
remaining physical claims listed in the report.

Authoritative local state:
`/Users/dread/.cashucard/compact-cursors-2026-10-31/card-state.json`.

## Qualified private image

Preserve this image for the next qualification work. Host changes do not require
a new CAP. The tracked production CAP/assets are separate.

| Pin | Value |
| --- | --- |
| Engine source | `96eb11df58c0969e2d00a1d52a2ca726f8d2d971` |
| CAP SHA-256 | `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27` |
| Load SHA-256 | `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048` |
| Manifest SHA-256 | `b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4` |
| Load size | 28,067 bytes / 114 blocks |
| Fixture SHA-256 | `15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e` |
| Package | `F04341534855434D5054` |
| Opener / main | Package plus `4D` / `01`, installed opener first; no Tag |
| Private selection / diagnostics | `CPROT/2`, format 5 |

The original image is under
`/Users/dread/.cashucard/compact-cursors-2026-10-31/image/`.
A verified copy with the persistent simulator adapter is under
`/Users/dread/.cashucard/phase-recovery-2026-10-31/image/`.
The last iteration revalidated the real qualified artifact and its pins through
`compactArtifact` using local file reads.

## Implemented components

| File under `tools/outbox-spike/` | Responsibility |
| --- | --- |
| `many-records.cjs` | Fixed eight-phase recipe: 45 small retained payments, full-store refusal, retirement/reload/reuse, stale acknowledgement refusal, audit and final scoped retirement. |
| `phase-recovery.cjs` | Validates ordered saved receipts and packet signatures; derives progress; executes a bounded phase or reconciles supported uncertain commands. `preparePhase` compiles its exact wire program. |
| `phase-journal.cjs` | Private, single-writer file journal; synced temporary-file replacement and directory sync; symlink/hardlink rejection; explicit lease retention. |
| `phase_wire.py` | Independent phase/fixture/APDU and reply policy. Independently reconstructs canonical retirement metadata and verifies packet identity and both signatures with `tools/cardctl/bip340.py`. |
| `phase_bridge.py` | Validates the request/hash before PC/SC imports, then exclusively opens only the named reader and applies the ordered policy. |
| `phase-transport.cjs` | Isolated Python process transport with bounded replies, explicit close handling and known child PID reporting. |
| `phase-device.cjs` | Campaign preview/admission and lazy execution under the file lease. Rechecks static admission immediately before connection. |
| `phase-javacard-smoke.cjs`, `phase-host-worker.cjs` | Actual JavaCard-engine tests with a separate killed host, reopened disk journal, lost retirement reply and independent wire checks. |
| `lab-journal.js` | Existing Pixel presentation coalescing; every storage barrier remains awaited. |

### Recovery invariants

- Save intent before transmitting; save a received reply before checking the
  elapsed gate. Unexpected staging replies stop before SIGN.
- An unresolved command blocks normal execution. A published uncertain SIGN is
  reconciled through its scope, exact packet, signatures and committed counts.
  The recovered receipt is labelled; SIGN is not repeated.
- A completed uncertain retirement requires the old scope absent, every other
  retained packet unchanged and exact post-retirement counts. Recovery does not
  issue another RETIRE.
- Unpublished SIGN, incomplete staging, uncertain setup/load, a still-present
  retirement scope and inconsistent evidence require reviewed recovery.
- Selection and public read APDUs can finish the applet's existing burn or
  reclamation bookkeeping. Describe this explicitly in a hardware plan rather
  than promising zero internal persistent writes.
- Startup/close uncertainty retains the lease. Known host/bridge PIDs help
  inspection; a PID alone does not authorize removing a lease. There is no
  automatic stale-lock cleanup.
- Old hardware/Pixel journals remain at their original locations and keys.
  Editing source/runtime can invalidate bindings; do not rewrite old journal
  fingerprints to force continuation.

### Bounds and capacity

USB phase invocations keep 30-second responses, a 120-second gate on further
transmission and at most 160 commands. The existing Pixel path keeps its
15-second native response, 120-second gate and 512-command limit.

Each small canonical packet is 430 bytes and consumes two payload pages. Forty-five
records fill the 90-page pool while 19 headers remain free. The final recipe
state is `[64,90,1,0,127,0]`: one deliberately unused synthetic proof remains.
Returning a physical test card to blank therefore requires an explicitly planned
cleanup, which this USB phase bridge excludes along with installation and key
changes.

## Latest validation

At tested code commit `1bbc628`:

- Full Node host suites: **242 tests; 234 passed, 8 external-service cases
  skipped, zero failures**.
- The JavaCard integration completed all eight phases. All **12** normal or
  recovery wire programs matched the independent Python checker, including a
  killed signing host and lost retirement reply. A corrupted retirement
  descriptor signature was refused.
- Five Python policy cases cover order, namespace, identity, file permissions,
  diagnostics, response checks and retirement-proof gates.
- The real process transport ran against an explicitly supplied fake PC/SC
  package. No real reader driver or device was opened by these tests.
- Regression red/green evidence covers unexpected staging replies, absent
  retirement packet proof and private preview-error output.
- Formatting and diff checks passed. The previous 15 compact JavaCard cases had
  also passed during the controller iteration; JavaCard source/image remained
  unchanged in the USB-adapter iteration.

Evidence directories are private local files:

| Directory | Evidence |
| --- | --- |
| `/Users/dread/.cashucard/phase-device-2026-10-31/` | Latest `validation.json`, source/test hashes, static runtime record, `tools-green.log`, `engine-wire-green.log`, admission and regression logs. Its validation date is November 1 despite the directory's start-date name. |
| `/Users/dread/.cashucard/phase-recovery-2026-10-31/` | Controller validation, earlier host/simulator results and the simulator-ready image copy. |
| `/Users/dread/.cashucard/qualification-phases-2026-10-31/` | PR #228 recipe/diagnostic validation and generated bundle evidence. |
| `/Users/dread/.cashucard/compact-cursors-2026-10-31/` | Consumed physical plan, phone/recovery journals, verified packet and blank-state evidence. |

No broad rerun is needed for this documentation-only handoff. After relevant
source changes, the established offline commands are:

```sh
cd /Users/dread/Repos/cashu-card-pixel-capacity
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"

node --test tools/outbox-spike/phase-device.test.cjs
env -u MINT_URL -u CARDSIM_URL node --test 'tools/**/*.test.cjs'
node tools/outbox-spike/phase-javacard-smoke.cjs \
  /Users/dread/.cashucard/phase-recovery-2026-10-31/image
```

Use plain `node SCRIPT ARTIFACT` for this simulator script. `node --test SCRIPT
ARTIFACT` treats the artifact path as another test input. If the Java adapter
changes, compile into a fresh scratch copy of the reviewed artifact; exclude
old `sim-src/` and `sim-classes/` outputs. Keep the original generated CAP sources
and image pins intact.

The static runtime record points to
`/Users/dread/Repos/cashu-card-reprovision/tools/cardctl/.venv/bin/python`
(Python 3.10 site-packages in the recorded environment). It was fingerprinted
through filesystem reads only. Recompute the runtime after relevant changes;
do not substitute system Python or assume a different venv version.

## Next local implementation

### Installation-only Pixel profile

The `phase-install` mode remains to be implemented. Its admission contract is
already enforced, and `prepare-pixel.cjs` currently rejects the mode. Work principally in:

- `pixel-control.js` and its fake-card tests;
- `PixelControlApp.jsx`;
- `prepare-pixel.cjs` and its generation tests;
- a new receipt generator and targeted tests.

The profile must verify the named chip, prove factory version 1 without retries,
verify its exact initial platform baseline, load the existing qualified image,
install opener then main, and verify the installed registry. It then reads
uninitialized format-5 diagnostics and the curve-valid public installation key
and stops. It must finish before fixture SETUP, proof loading, SIGN, retirement,
cleanup or key rotation. The USB phase-zero invocation owns fixture setup.

Do not reuse `blankBaselineVerified` as proof of initial admission: existing
`pixel-control.js` sets that field only after final cleanup. The new initial and
installed-registry proof fields need distinct, correctly placed checks.

Last observed private APK was `org.cashucard.capacitylab`, version 4 /
`0.0.4-lab`. Use a new private version and unique consumed journal key. Preserve
all four existing capacity-app journals byte for byte:

```text
cashucard-private-capacity-v1
cashucard-private-capacity-diagnostics-v1
cashucard-private-capacity-optimized-v1
cashucard-private-capacity-streamed-v1
```

The creation lab has a separate application identity. Keep it and the production
provisioner untouched. Retain NFC-only permissions, disabled developer support,
disabled release variants and the reviewed native failure classifier. Generate
the isolated Android project outside the checkout from clean committed source;
local APK building/inspection is possible before device approval.

### Receipt contract

`phase-device.cjs` currently requires a receipt with:

```text
format: compact-phase-install-v1
sourceCommit: reviewed installer source commit
apk: {path, sha256}
journal: {path, sha256}
```

The captured phone journal must contain:

```text
plan: pixel-phase-install-v1
status: installed-for-phases
chip: cplc-v1:4790d3213041093363205547
cardKey: observed compressed public installation key
factoryVersionVerified: 1
initialBaselineVerified: true
installedRegistryVerified: true
diagnostics: uninitialized format-5 diagnostics with the commit floor
build.mode: phase-install
build.source: the receipt's sourceCommit
build.manifest / build.cap / build.load: the qualified image hashes
```

Build the receipt from successful captured evidence and the actual APK bytes.
Old journals and a manually relabelled stopped attempt do not qualify. The APK
hash belongs in the external receipt, avoiding a self-referential embedded APK
hash. Implement and verify the generator offline first.

### Hardware preparation after the installer is ready

Prepare the full named plan, pinned APK/source/runtime/evidence and bounded
recovery/return-to-blank actions before asking the user for approval. Preserve
the existing image and test fixture. Use the new installation evidence to bind
the observed key into the phase journal and campaign. Keep approval false until
fresh explicit approval arrives.

The public key in the October 31 report belonged to the deleted installation.
The next installation generates a new key; capture and bind that new value.

The adapter defaults to local preview. It additionally requires complete valid
installation evidence, a clean pinned source head and matching journal/runtime
even before it can prepare a usable campaign. `--execute` is a hardware action;
do not invoke it against real devices during continuation without that approval.

## Wrap-up state

The local test commands and their child processes completed and were reaped.
A process-working-directory check found no Node, Java or Python process in this
task checkout or its current evidence directories. No task server was left
running. Unrelated servers/processes were left intact. No new subagent work was
started during these iterations.

The next agent can begin the installer-only source work immediately. No further
card tap, connection check, store action or remote publication is currently
authorized or needed for that local implementation step.
