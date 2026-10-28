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

## Measurement boundary

The generated probes and their source changes stay outside released firmware,
protocol assignments and provisioner assets. Simulator success establishes code
behavior. Silicon evidence requires the approved physical run and a hardware
report. A pool reservation and contiguous dummy transaction are a resource floor;
final record layout, descriptor signing, full publication overhead, power-loss
behavior, limits and wear remain later validation gates.
