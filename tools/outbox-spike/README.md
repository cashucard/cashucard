# Outbox resource probe

This prepares the early physical-chip resource check in the assisted-settlement
plan. Build a separate test CAP from the current applet's installation path with
a candidate persistent pool. The first profile reserves 16 KiB and adds no
transient arrays. A private dispatcher exposes memory counts and a dummy
transaction; production payment, setup, PIN, load and reset commands are refused.

## Build and local checks

Use JDK 17, Ant and the same pinned JavaCard 3.0.5 SDK as the production build.
Choose a new scratch directory. The builder refuses to overwrite an old one.

```sh
python3 tools/outbox-spike/test_probe.py
python3 tools/outbox-spike/build-probe.py /tmp/outbox-probe-16k
# Optional: --sdk /path/to/jc305u4_kit and --pool-bytes 16384
```

The directory contains `resource-probe.cap`, generated source/build files and a
manifest binding the original source hashes, generator hash and CAP hash. The
released CAP and provisioner assets are outside the output directory. CAP
conversion runs in CI alongside the regular production CAP checks.

After building the existing cardsim jar, check command dispatch in jCardSim:

```sh
mkdir /tmp/outbox-probe-16k/classes
javac --release 11 -cp tools/cardsim/target/cardsim.jar \
  -d /tmp/outbox-probe-16k/classes \
  /tmp/outbox-probe-16k/src/me/flashapp/cashu/*.java tools/outbox-spike/ProbeSmoke.java
java -cp /tmp/outbox-probe-16k/classes:tools/cardsim/target/cardsim.jar ProbeSmoke
```

## Private test interface

Package AID: `F0434153485550524F4245`. Install its opener (`...4D`) before its
probe applet (`...01`), as with the normal package. Package version: 0.0.
Selection answers ASCII `PROBE`, format byte 1 and the pool size as uint16 big
endian. Commands use CLA `B0`, P1/P2 zero:

| INS | Operation | Response |
| --- | --- | --- |
| `7D` | Read measurements | 24 bytes, layout below |
| `7E` | Toggle 128 dummy persistent bytes in one transaction | One byte: first dummy byte after commit |

Measurement response: four uint32 values (persistent memory before and after
pool allocation, transient-reset and transient-deselect memory after install),
then uint16 maximum commit capacity, uint16 unused commit capacity, uint16 pool
size, one dummy publication byte and format byte 1. Multi-byte fields are big
endian. Counters are captured after the current applet's full constructor runs.
The [JavaCard memory API](https://docs.oracle.com/cd/E59935_01/api/javacard/framework/JCSystem.html)
reports an upper bound; fragmentation and transaction overhead affect usable
capacity. The builder compiles against the 3.0.5 API.

## Physical test gate

Physical use requires a separately approved action list naming the reader and
disposable card. First establish its identity, empty/reconciled value and change
state, and manager-key provenance. Installing this replacement removes the old
applet and its identity. Use the approved protected installer, with one known-key
authentication attempt and no guessed keys or retries. Read measurements, perform
one dummy transaction and read its result, then remove the probe and restore the
approved released applet. Preserve the manifest and results in a hardware report.

This is a resource floor: it measures a candidate pool and a contiguous dummy
transaction. The real outbox's record layout, descriptor signature, publication
transaction, NFC latency, power-loss behavior and wear require their own measured
drills. Simulator memory counts cannot establish physical capacity. The probe
stays outside normal provisioning and release artifacts.
