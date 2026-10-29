# Outbox diagnostic probes

These private probes separate the applet's existing installation path from a
candidate outbox allocation. The format-2 constructor control installed and
returned counters; adding one 16 KiB array failed at applet creation. The cause
remains unresolved. Both attempts and their cleanup are recorded in the
[hardware report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-27.j3r180-assisted-preflight.md).

## Profiles

| Format-2 profile            | Pool                        | Installation change                                                      | Dummy publication                      |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| `constructor-control`       | 0                           | Original constructor preserved exactly                                   | Refused                                |
| `pool-allocation`           | 256 bytes, 4 KiB or 16 KiB  | One persistent byte-array allocation after the original constructor work | Conditional, once                      |
| `segmented-pool-allocation` | 16 KiB as four 4 KiB arrays | Four persistent arrays after the original constructor work               | Conditional, once in the first segment |

All profiles preserve the original transient allocations. Optional memory
queries run after installation and selection. The control uses the same private
package, AIDs and probe dispatcher as the pool profile, allowing installation,
allocation and diagnostics to be evaluated separately.

## Build and simulation

Use JDK 17, Ant and the pinned JavaCard 3.0.5 SDK. Each output directory must be
new. Generated CAPs, load files, sources and manifests remain in that directory.
The manifest pins the original sources, generator, profile, CAP and load bytes.

```sh
python3 tools/outbox-spike/test_probe.py
python3 tools/outbox-spike/build-probe.py /tmp/outbox-probe-0 --pool-bytes 0
python3 tools/outbox-spike/build-probe.py /tmp/outbox-probe-16384 --pool-bytes 16384
mvn -B -f tools/cardsim/pom.xml package -DskipTests
for pool in 0 16384; do
  probe_dir="/tmp/outbox-probe-$pool"
  mkdir "$probe_dir/classes"
  javac --release 11 -cp tools/cardsim/target/cardsim.jar -d "$probe_dir/classes" \
    "$probe_dir"/src/me/flashapp/cashu/*.java tools/outbox-spike/ProbeSmoke.java
  java -cp "$probe_dir/classes:tools/cardsim/target/cardsim.jar" ProbeSmoke "$pool"
done
```

CI converts and exercises the control, all three single-array sizes and the
segmented profile in jCardSim. It separately verifies the released CAP and
generated provisioner assets.

## Private format-2 interface

Package AID: `F0434153485550524F4245`, version 0.0. Install the opener (`...4D`)
first, then the probe (`...01`). Selection returns ASCII `PROBE`, format byte 2
and the pool size as uint16 big endian. Commands use CLA `B0`, P1/P2 zero.

| INS  | Operation                                                    | Response         |
| ---- | ------------------------------------------------------------ | ---------------- |
| `7D` | Query current memory counters and commit capacity            | 16 bytes         |
| `7E` | Pool profile: toggle 128 persistent bytes in one transaction | Publication byte |

The control refuses `7E`. The host skips publication when diagnostics are
unavailable or the reported maximum/unused commit capacity is below 128 bytes.
A larger reported capacity still requires a physical test because transaction
bookkeeping consumes space.

| Offset  | Width       | Field                                                                    |
| ------- | ----------- | ------------------------------------------------------------------------ |
| 0, 2, 4 | uint16 each | Reported persistent, transient-reset and transient-deselect availability |
| 6, 8    | uint16 each | Maximum and unused commit capacity                                       |
| 10      | uint16      | Pool size                                                                |
| 12      | byte        | Publication marker (control: zero)                                       |
| 13      | byte        | Format 2                                                                 |
| 14      | byte        | Saturation bits: persistent=1, reset=2, deselect=4                       |
| 15      | byte        | Reserved, zero                                                           |

The [legacy JavaCard memory API](https://docs.oracle.com/cd/E59935_01/api/javacard/framework/JCSystem.html)
reports availability counters capped at 32767. Saturation is explicit. These
post-install counters cannot establish exact free EEPROM, contiguous allocation
limits or an exact control/pool difference. Successful pool installation is the
evidence that its reservation was accepted.

An empty-body `6F00`, `6A81` or `6D00` from the optional `7D` query records
`unavailable`, skips any pending publication and permits the planned cleanup.
Malformed data, other statuses and transport failures stop the run. Other
commands retain the stop-on-failure rule. A successful cleanup with unavailable
counters supplies removal evidence while resource measurements remain absent.

The runner also accepts the existing pinned format-1 artifact for review and
cleanup. Its 24-byte response and install-time snapshots retain their original
meaning. New builds use format 2.

## Physical plan and runner modes

The approved plan must name the card, reader, selected profile, artifact hashes
and actions. The default command validates artifacts and reports
`cardAccessed: false`:

```sh
node tools/outbox-spike/run-probe.cjs \
  --manifest /tmp/outbox-probe-0/manifest.json \
  --expect-manifest-sha256 <reviewed-manifest-sha256> \
  --chip cplc-v1:4790d3213041093363205547 \
  --reader 'ACS ACR122U PICC Interface' --platform-baseline
```

Build cardkit 0.2.0's public package before execution. Reader modes additionally
require a confirmed factory reset, explicit Python with pyscard and a fresh
absolute journal path in a private operator-owned directory. The retained
successful cleanup of this same factory-reset card can establish its starting
state; the runner revalidates it on connection.

1. Match CPLC, require production/probe objects absent and prove factory-version-1
   keys before external authentication.
2. Verify the registry baseline. `--platform-baseline` is restricted to 09336320
   and requires all three complete platform entries captured by the approved
   inspection and the owner's earlier `gp-install-opener.txt`. Versions,
   lifecycle and domain are pinned; extra, missing or modified entries stop.
3. Load the pinned private package, create its opener, then its selected probe.
4. Select and verify its format/profile. Read optional counters. For an eligible
   pool profile, publish once and read the result. The control performs reads.
5. Match CPLC again, open one new factory-key channel and verify the baseline
   plus permitted probe AIDs. Delete probe, opener and package in that order,
   then verify exactly the original platform baseline remains.
6. End factory-blank. The operator can restore a service-recorded released applet
   through a fresh CCP batch.

`--inspect-registry` performs public inspection and one factory channel's bounded
GET STATUS queries. `--cleanup-only` permits private probe deletion after its
identity/baseline checks. Modes are mutually exclusive. The PC/SC bridge enforces
mode restrictions and permits deletion only of private probe AIDs; it also blocks
publication following a zero-pool selection.

Every next stage is persisted before mutation. Journals refuse reuse and retain
fixed status-word failure codes and public registry evidence. Authentication
payloads and arbitrary error text stay out of logs. An unexpected failure closes
the reader and preserves the journal for review; the host performs neither a
retry nor automatic cleanup.

Reader failures retain fixed enumeration, connection, validation and transmit
categories. A supplied PC/SC HRESULT is normalized to eight hexadecimal digits.
The host accepts only those fixed codes and that numeric shape; unknown bridge
errors become `reader-protocol-error`. Pipe closure and response timeout have
their own fixed codes. A later disconnect failure preserves the first error.
These diagnostics supply no authority for a transfer retry or cleanup.

## Bounded allocation comparisons

The successful original-constructor control and the single-array 16 KiB refusal
are recorded in the hardware report. A further plan can compare 256 bytes,
4 KiB and four 4 KiB arrays. Each profile needs its own pinned artifact and fresh
journal. The segmented build uses `--pool-bytes 16384 --segments 4`; the manifest
binds its layout. Its dummy transaction touches the first segment only.

Continue a comparison sequence only after the preceding profile has valid
measurements, a confirmed and re-read dummy publication, and verified cleanup.
A refused creation or unavailable measurement ends the sequence. This is a
fixed comparison, with each permitted stage included in the approval.

An explicit `--cleanup-on-install-refusal` can be included in an approved
format-2 allocation plan. It applies only to empty-body `6F00`/`6A84` replies
from probe creation, after package loading and opener creation. The host
persists the refusal before any next action, rematches CPLC, proves one new
factory channel, checks the exact registry and removes only private probe
objects. It then verifies the original baseline and returns
`install-refused-cleaned` with CLI exit code 2. This ends the allocation
sequence while leaving the card blank. The retained refusal supplies no
resource measurement.

The option is off by default and requires an execution profile with a pool.
Authentication, transport, other statuses, nonempty error replies, journal
failures and registry discrepancies retain the stop-with-journal behavior.
A failed cleanup keeps both the first refusal and the cleanup failure.

## Fixed-image post-install reservation

The [256-byte physical result](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-28.j3r180-allocation-comparison.md)
returned `6F00` at creation and completed its approved cleanup. Its 19,751-byte
image differed from the successful 19,635-byte control. Existing chip reports
document both load-size sensitivity and a constructor budget, leaving those
comparisons unable to isolate allocation capacity.

Format 3 installs the original constructor and reserves a pool with one private
command afterwards. All three requested sizes use the identical CAP and
manifest. The process persists an attempt marker before the one guarded
allocation, outside a transaction. Subsequent reservation attempts are refused,
including after deselection. This private exception is described in D144.

```sh
python3 tools/outbox-spike/build-probe.py /tmp/outbox-post-install \
  --pool-bytes 0 --post-install
```

Compile its generated source with `ProbeSmoke.java` as above, passing `post`
to the smoke program. It checks all three sizes, invalid-size refusal, publication
before reservation, and repeat-attempt refusal in jCardSim.

Selection reports format 3 and actual reserved bytes, initially zero. The
16-byte measurement response uses the same counters as format 2, with format
byte 3 and byte 15 holding the persistent attempt marker (0 or 1).

`B0 7C 00 00 02 <size:uint16> 03` requests exactly 256, 4096 or 16384 bytes.
Response `00 0000` confirms allocation; `01 <reason:uint16>` reports a caught
`SystemException`. The raw public reason is retained without inferring its
cause. Querying actual reservation state confirms the outcome. No other
reservation size or retry is admitted by the host, bridge or applet.

The runner requires `--reserve-bytes 256` (or 4096/16384) with this artifact.
Its execution records baseline counters with zero reservation, reserves once,
reads actual reserved bytes and commit capacity, then conditionally publishes
and cleans up. The same manifest hash must be used at each comparison stage.
Advance only after valid baseline/reservation/publication measurements and
verified cleanup. The bridge requires a fresh format-3 selection and transmits
at most one reservation command per connection.

An approved plan may include `--cleanup-on-allocation-refusal`. It persists a
structured refusal, confirms zero reserved bytes, an attempt marker and no
publication, then uses the existing identity/factory-channel/registry cleanup
gates. Result `allocation-refused-cleaned` exits 2 and ends the sequence.
The option is off by default. Uncertain delivery, unexpected results or failed
confirmation stop with the journal. `--cleanup-on-install-refusal` separately
covers the declared empty-body creation refusals before any reservation.
Registry-only and cleanup-only modes require the requested size for artifact
admission but permit no reservation command.

## Known control and fixed layout variants

The format-3 diagnostic rerun completed LOAD but failed creation, before its
reservation command. It completed the approved cleanup. The next comparison
starts with the previously successful pinned constructor control, requiring
valid counters and verified cleanup before trying a new image.

`--image-padding padding-a` and `padding-b` are fixed post-install build
profiles. They change only the existing unreachable `sizeTheFile` method;
constructor and runtime command code stay identical. Current load sizes are
20,068 and 20,196 bytes. The first matches the released image's measured size;
installation of a new image still needs physical evidence. All reservation
sizes within a selected image use the same CAP and manifest.

```sh
python3 tools/outbox-spike/build-probe.py /tmp/outbox-padding-a \
  --pool-bytes 0 --post-install --image-padding padding-a
```

The manifest records the fixed padding name. Unknown profiles and padding of
legacy formats are refused. CI converts and exercises both variants. An
approved comparison may move to the second fixed image after the first image's
initial creation refusal and verified cleanup; that branch must be stated in
the plan. Other failures end the sequence under its approved backout rules.

`--read-platform-memory` adds one public `80 CA FF 21 00` after matching CPLC,
before authentication. It requires an explicit execution with the named 09336320
platform baseline. The parser admits `FF21 10 8102 <uint16> 8204 <uint32>
8304 <uint32>`: tag 82 reports persistent bytes and tag 83 volatile bytes; tag 81
is retained without interpretation. This is the format documented in the chip
notes. Empty `6A88`, `6A86` or `6D00` records unavailable. Other statuses,
malformed data or transport failures stop before loading. These counters are
informational; the approved plan fixes every allocation size.

## Field-preserving diagnostic

The known control installed again, while both layout candidates were refused
before reservation. Converted metadata identified another difference: the
control has instance size 50 and 50 references; the failed format-3 images have
size 52 and 51 references. The cause remains unresolved.

`--state-storage existing-fields` preserves all original field declarations and
the constructor. Only its private dispatcher and unused padding method change.
The dispatcher borrows the initially null `dleq` reference for its pool and the
persistent `cardLocked[0]` byte for the one-attempt marker. Its command set
continues to refuse production operations. These meanings apply only to this
private disposable image; production locking and proof storage are unchanged.

```sh
python3 tools/outbox-spike/build-probe.py /tmp/outbox-existing-a \
  --pool-bytes 0 --post-install --state-storage existing-fields \
  --image-padding padding-a
```

A host-only helper uses the pinned 3.0.5 verifier to inspect the converted CAP.
The manifest records `classShape`, its inspector hash and the storage mode.
The existing-fields profile requires instance size 50, first reference token 0
and reference count 50. Unknown modes or mismatches are refused before reader
access. The helper's classes stay outside the CAP. Original added-field
artifacts remain usable for their separately approved cleanup. Selection also
records only the public PROBE format/size; a mismatched format has a fixed
`probe-selection-mismatch` code and stops without automatic cleanup.

Instance size describes field cells; reference count describes reference
fields, as defined in [Oracle's VM specification, section 6.9.2.3](https://docs.oracle.com/cd/E59935_01/JCVMS.pdf#page=102).
These values describe layout. The memory API and ISD counters separately report
availability. Source equality and simulator checks complement the converted
metadata check. The smoke test exercises repeat-reservation refusal within a
session and after simulator reset.

Both fixed padding profiles are available with existing state. Their current
load sizes remain 20,068 and 20,196 bytes. Each selected image stays fixed
across reservation sizes, under a newly approved named hardware plan.

## Measurement boundary

The generated probes and their source changes stay outside released firmware,
protocol assignments and provisioner assets. Simulator success establishes code
behavior. Silicon evidence requires the approved physical run and a hardware
report. A pool reservation and contiguous dummy transaction are a resource floor;
final record layout, descriptor signing, full publication overhead, power-loss
behavior, limits and wear remain later validation gates.

## Software storage model

`storage-model.cjs` is a host-only model with one bounded byte image. It has
no card transport and is excluded from firmware and release assets. Run its
focused checks with:

```sh
node --test tools/outbox-spike/storage-model.test.cjs
```

The model exercises hidden staging, one publication/burn-intent boundary,
mandatory recovery before export or proof use, generation-scoped retirement,
and resumable page release. Tests cut after every byte write and modeled atomic
transaction in publication/retirement, then resume the retained image. The largest
assumed atomic mutation covers 13 bytes; staged length, digest and page maps
are written byte by byte and may tear. Repeated
cuts during recovery, wrong-card/stale acknowledgements, exhaustion and byte
versus record capacity are included.

The default candidate places 32 record headers, installation/counter state,
proof status/generation bookkeeping and 109 data pages inside 16,384 bytes.
A complete-packet storage candidate fits 27 synthetic packets sized from the
draft's one-input/one-output, 33-byte-keyset, 24-byte-URL encoding. Its
128-input equivalent exceeds the budget. This supports prototyping compact
slot/keyset references with streamed export before choosing production limits.
See [D148](../../docs/DECISIONS.md#d148).

The model assumes each annotated transaction is all-or-nothing. Its synthetic
opaque packets, internal 32-bit counters and scope comparisons do not assign
protocol bytes or implement signatures, owner
verification or the protocol codec. Full keyset registry/DLEQ setup, JavaCard
conversion, integrated cryptography, power cuts and latency remain later gates.

## Compact candidate export

`compact-export.cjs` reconstructs the open protocol draft from immutable fixture
state and ordered slot/generation references. Its compact payload retains a
format/count header, 38-byte outputs (amount, registry reference and blinded
point), and the two 64-byte signatures. Existing proof slots supply amount,
nonce, C and their full-keyset mapping. The configured context supplies the card
key, installation nonce, mint and unit.

The signed [candidate vector](fixtures/assisted-settlement-v1.json) comes from
cashucard/nut's `proposals/vectors/assisted-settlement-v1.json` at commit
`6e83214ef3eed97b19fc95cd8a583ee87af80553`. Its SHA-256 is
`d1868e1d81c5784b448ee16b12360f213dfc8307bde145112d6cf6d81a96ed68`.
An independent Python encoder and the existing reference BIP-340 test signer
produced its bytes; `make-vector.py --check` reproduces the fixture independently
of the Node codec. It uses the published test scalar 3 and synthetic points.
It covers mixed 8/33-byte keysets and a payment ID above Number's exact range.

```sh
node --test tools/outbox-spike/compact-export.test.cjs
```

Export verifies SIG_ALL and the tagged descriptor before returning any page.
Canonical body and payment hashes stream through fields, and packet pages are
bounded to 1–255 bytes. The packet ID remains SHA-256 of the canonical body;
the storage model's framing checksum serves its separate internal integrity
purpose. Final owner-authorized retirement must bind the canonical packet ID.

The model's synchronous builder preflights record/byte capacity and fixes the
identity and input generations before signing. A failed builder or invalid
signature leaves the proofs unconsumed. This is single-command admission;
network work and a durable cross-session capacity reservation are outside it.

The 16 KiB budget reserves 724 bytes for maximum context, eight full-ID registry
entries and proof mappings, plus the extra bytes for future uint64 global/record
IDs. With 64 candidate headers, 89 data pages remain. The small synthetic workload
fits 44 payments. A 128-input/128-output record occupies 4,994 compact payload
bytes plus 641 reference bytes, then exports 23,163 bytes for the test context.
These bounds remain prototype choices.

`fixtureView` represents preverified immutable load state. It checks ranges,
points, unique prefix mappings and supported date-zero/sat metadata; actual load
provenance, owner authorization, DLEQ, fee policy and mint settlement remain
integration work. The host fixture/snapshot objects use Node's heap. Reserved
field bytes do not establish JavaCard object overhead or transient-memory fit;
combined proof/DLEQ setup, hardware signing and tear checks remain required.

## Private JavaCard fixture prototype

`build-compact.py` converts a separate package, `F04341534855434D5054`, with
opener `...4D` and fixture applet `...01`. It keeps the original constructor,
instance fields, crypto engines, transient buffers and proof hex cache. One
private setup attempt allocates the 12 KiB DLEQ store and a 16 KiB byte-backed
pool. The pool borrows the receipt reference; its old buffer remains allocated.

```sh
# Offline only; requires JDK 17 and the pinned JavaCard 3.0.5 SDK.
# Every output directory must be new.
mvn -B -f tools/cardsim/pom.xml package -DskipTests
python3 tools/outbox-spike/build-compact.py /tmp/compact-javacard
python3 tools/outbox-spike/compile-compact-sim.py /tmp/compact-javacard
node tools/outbox-spike/compact-javacard-smoke.cjs /tmp/compact-javacard
```

CI converts the CAP and checks its original instance shape, then tests signing,
streaming, capacity and recovery. Existing hardware tools reject the new package
and manifest kind. Physical access requires a separately reviewed runner and
named approved plan. The release firmware and provisioner assets are unchanged.

The private fixture ABI uses CLA `B0`, P1/P2 zero and short APDUs. Case-2 commands
use Le=0. Selection returns ASCII `CPROT` and private ABI byte 2 (manifest/diagnostic format 5). Fixture loading accepts
public synthetic proof data and structural compressed-point prefixes; holder
permission, mint/DLEQ/fee verification and receipt/limit integration are separate
work. Unsigned retirement is a bench command. This ABI is excluded from production.

| INS | Private operation | Data | Response |
| --- | --- | --- | --- |
| `7E` | One setup attempt | initial counter (8), nonce (32), mint length (1), ASCII HTTPS mint (up to 214) | `01` |
| `78` | Append immutable keyset | index (1), ID length (1), ID (8 or 33) | count (1) |
| `71` | Load fixture | slot (1), generation (4), registry index (1), amount (4), nonce (32), C (33) | slot (1) |
| `72` | Reserve hidden staging | input count (1), output count (1), ordered slots | index (1) |
| `73` | Stage merchant outputs | groups: amount (4), registry index (1), B_ (33) | staged count (1) |
| `74` | Sign and publish | none | scope (45) |
| `75` | Export committed packet | index (1), offset (2), count (1) | up to 255 bytes |
| `7C` | Read committed scope | index (1) | scope (45) |
| `77` | Retire fixture record | exact scope (45) | `01` |
| `76` | Status | none | free headers/pages, unspent/spent/empty slots, active stage (6) |
| `79` | Record states | none | 64 bytes |
| `7A` | Public installation key | none | 33 bytes |
| `7B` | Abandon staging | none | `01` |
| `7D` | Diagnostics | none | memory/commit counters, pool/DLEQ lengths, setup state, format 5 (16) |

Scope is index (1), payment ID (8), generation (4) and canonical packet ID (32).
Signatures and payload stay hidden until publication. Reselection discards
abandoned staging, resumes burns and completes retirement before slot reuse.
Export checks immutable data once per selected session; mutations/reselection
invalidate that transient validation cache.

`CompactHarness` uses host reflection for the published scalar-3 test key.
`CompactCut` adds selected boundary interruptions to separate simulator copies.
Both are excluded from CAP inputs; generated-source hashes are checked before
instrumentation. Tests cover mixed/full keysets, large paged export, a full
45-record workload, uint64 exhaustion, stale scopes, partial loads, publication
and retirement cuts, and fresh-session corruption rejection. Simulator checks
leave physical memory, transaction rollback, wear and latency unverified. See
[D150](../../docs/DECISIONS.md#d150) for the design and remaining gates.

## Private compact hardware runner

The first physical image installed and answered diagnostics, then returned
`6E00` for setup instruction `70`. That instruction belongs to JavaCard runtime
channel management. The revised private ABI uses `7E`, selection `CPROT/2` and
manifest/diagnostic format 5. New runner admission rejects earlier formats.
The [physical report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-setup.md)
records the stop and verified cleanup. The corrected image subsequently
completed the [small physical payment](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md)
on 09336320, with independent signature/export verification and return to blank.

`run-compact.cjs` runs explicitly selected fixed synthetic profiles of the converted prototype.
Preview reads local files and returns the runner fingerprint. Execution requires
the exact manifest hash, source commit and fingerprint, an absolute Python path,
a new journal inside a private operator-owned directory, and explicit factory
reset confirmation. The fingerprint includes the runner, both bridge policies,
fixture/codec dependencies, and the built cardkit files and dependency pins.

```sh
# Preview only. Replace the two pins with those from the reviewed conversion.
node tools/outbox-spike/run-compact.cjs \
  --manifest /absolute/private-artifact/manifest.json \
  --expect-manifest-sha256 MANIFEST_SHA256 \
  --expect-source-commit SOURCE_COMMIT \
  --chip cplc-v1:4790d3213041093363205547 \
  --reader 'ACS ACR122U PICC Interface'
```

The fixed workload supports two explicitly named cards on the ACS ACR122U
reader: 09336320 and 07297620. Their exact CPLC IDs select separate captured
baselines. The former requires three platform load files; the latter preserves
its additional `A00000016443446F634C697465` load file. Each full TLV, version,
lifecycle and domain must match. An unknown card or an entry from the other
profile stops the run before loading. Both cards were observed with factory
manager keys at version 1; a named plan still governs each physical run.

It matches CPLC,
requires production/previous probe objects absent, proves one factory-key
channel and verifies the selected card's exact captured platform registry. It loads only
the compact package, installs opener then fixture applet, records diagnostics,
and attempts the combined 12 KiB DLEQ/16 KiB pool setup once.

With valid diagnostics and at least the previously measured 128-byte commit
floor, it loads two public synthetic proofs and stages two merchant outputs.
It signs once, confirms consumption, reselects, exports 559 bytes in three pages,
and verifies both signatures, exact canonical bytes and scope against the
card-generated public key. Only then does it retire that exact fixture record,
confirm empty/reclaimed state and remove the private applet, opener and package.
Cleanup rematches CPLC, proves one fresh factory-key channel and verifies the
selected card's original baseline. Synthetic mint metadata is used locally.

The dedicated PC/SC policy permits the exact fixture commands, single attempts,
bounded diagnostics/status reads and retirement matching the returned scope.
It rejects manager-key changes, production mutations and unrelated deletes.
Each response has a 30-second deadline; a 120-second elapsed gate and 512-command
ceiling stop further transmissions. These bounds stop the drill on uncertainty.
The journal retains public packet/state, timings and fixed failure categories.
Received export pages are persisted as they arrive, including during an
interrupted export. Available pages remain evidence; complete packet verification
is required before retirement.

An approved plan may add `--cleanup-on-declared-refusal`. It applies only to
empty-body `6F00`/`6A84` replies from fixture creation or setup, before fixture
loading. The refusal is persisted before identity/authentication/registry checks
and private cleanup. Result `declared-refusal-cleaned` exits 2 and ends the test.
Other failures close the reader and retain the journal for a reviewed next action.
`--cleanup-only` is a separate mode for an explicitly approved cleanup plan.

Physical execution requires a new plan naming the exact artifact, runner, card
and actions under [AGENTS.md](../../AGENTS.md#rules-for-agents). Existing hardware
approvals are complete. The default profile measures combined allocation and one
small signed export; broader capacity, physical power-loss recovery, wear, mint/owner
authorization and release enablement remain separate gates. See
[D151](../../docs/DECISIONS.md#d151).


### Full-slot capacity profile

Add `--workload 128-input-128-output-v1` to preview or execute the fixed full-slot
case. It is admitted only for card 09336320 and uses the same private format-5
CAP. The default remains `two-input-two-output-v1`. Unknown names and an
unqualified card/profile combination fail before opening a reader. An explicit
profile is also passed to the Python bridge so small-profile admission stays
separate.

`fixtures/compact-capacity-v1.json` contains public synthetic inputs and outputs.
The profile loads 128 distinct slots, stages 128 outputs in 22 commands of up to
six outputs, and signs one payment. Expected consumed state is 63 free headers,
45 free pages, zero unspent, 128 spent, zero empty and no active staging. After
reselection, 91 export pages reconstruct 23,163 canonical bytes. Both signatures,
exact packet and scope must verify before retirement restores 128 empty slots,
64 free headers and 90 free pages. Normal cleanup returns the card to its exact
three-file blank baseline. The existing 30-second response deadline, 120-second
elapsed gate and 512-command ceiling apply unchanged. Their host stop retains
`drill-bound-exceeded` through the SDK transport wrapper.

The simulator uses this exact catalogue/command stream for its large case,
including full reclamation. Offline policy tests compare every Node command
with independent Python construction. Runner tests cover a complete large
export, incorrect/truncated bytes and a lost final-page response: uncertainty
preserves received pages and performs neither retirement nor deletion. The
physical full-slot run remains pending a named approved plan. This candidate
output count does not freeze the protocol's eventual limits.

### Interruption evidence sequence

| Gate | Required evidence |
| --- | --- |
| Full-slot case | Combined allocation, exact large signed packet, full retirement and blank cleanup on silicon |
| Many small records | Measured refusal before consumption, retained existing packets and reuse only after verified retirement |
| Power loss between commands | Operator removes the card after staging and after publication; a fresh process matches identity and proves the expected abandoned or committed state |
| Power cut during a write | A bounded separately reviewed drill observes either the pre-commit state or a complete recoverable published packet, including resumed burn/retirement bookkeeping |

Simulator reset/cut cases cover logical recovery boundaries. Physical removal
between APDUs establishes a different claim from interrupting an in-progress
write. A future interruption runner needs phase-specific durable journals,
identity/key/context checks, explicit uncertainty handling and reviewed recovery
commands before either physical step. Existing approvals have been consumed;
this documentation authorizes no new card access.
