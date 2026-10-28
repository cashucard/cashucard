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
transaction in publication/retirement, then resume the retained image. Repeated
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
opaque packets, internal 32-bit counters and scope comparisons do not assign protocol bytes or implement signatures, owner
verification or the protocol codec. Full keyset registry/DLEQ setup, JavaCard
conversion, integrated cryptography, power cuts and latency remain later gates.
