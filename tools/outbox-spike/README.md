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

| INS  | Operation                                            | Response                                |
| ---- | ---------------------------------------------------- | --------------------------------------- |
| `7D` | Read measurements                                    | 24 bytes, layout below                  |
| `7E` | Toggle 128 dummy persistent bytes in one transaction | One byte: first dummy byte after commit |

Measurement response: four uint32 values (persistent memory before and after
pool allocation, transient-reset and transient-deselect memory after install),
then uint16 maximum commit capacity, uint16 unused commit capacity, uint16 pool
size, one dummy publication byte and format byte 1. Multi-byte fields are big
endian. Counters are captured after the current applet's full constructor runs.
The [JavaCard memory API](https://docs.oracle.com/cd/E59935_01/api/javacard/framework/JCSystem.html)
reports an upper bound; fragmentation and transaction overhead affect usable
capacity. The builder compiles against the 3.0.5 API.

## USB runner and physical test gate

Build cardkit's public package with `yarn --cwd tools/cardkit install
--frozen-lockfile` and `yarn --cwd tools/cardkit build`. The runner requires the
reviewed 0.2.0 API. A newly generated manifest now also pins `load-file.bin`.
The runner's default preview validates both artifacts and opens no reader:

```sh
node tools/outbox-spike/run-probe.cjs \
  --manifest /tmp/outbox-probe-16k/manifest.json \
  --expect-manifest-sha256 <reviewed-manifest-sha256> \
  --chip cplc-v1:4790d3213041093363205547 \
  --reader 'ACS ACR122U PICC Interface'
```

Execution additionally requires `--execute --factory-reset-confirmed`, an
explicit Python with pyscard and a new absolute journal path inside a private
operator-owned directory. Review the complete action list before enabling it.

1. The operator completes CCP's ordinary reset for the empty disposable card.
   Its service records the reset and returns manager keys to the known factory
   state. Keep the same card isolated from the others.
2. The USB runner matches CPLC and requires the production and probe objects to
   be absent. It verifies the factory cryptogram before external authentication,
   then checks the registry before loading the pinned probe package. The opener
   is instantiated first; the probe follows. The tag instance is omitted.
3. Select the private probe, read memory, perform one dummy 128-byte transaction
   and read the retained result. Save the measurements and command timing.
4. Match CPLC again, open one new known-factory-key channel, delete only the
   probe/card instance, opener and package, and verify registry absence. The
   runner ends with the card factory-blank.
5. The operator creates a fresh CCP batch to restore the released applet and
   its service record. Any holder-wallet setup follows afterward.

The runner journals every next stage before mutation, refuses journal reuse and
stops on every unexpected identity, state, cryptogram, status or transport
failure. It performs no key rotation. An interrupted run retains its journal for
a separately reviewed cleanup plan; it cannot be restarted automatically.
`probe_bridge.py` permits only public inspection, factory-version SCP02, private
probe install/load/delete, registry reads and the probe's dummy command.

This is a resource floor: it measures a candidate pool and a contiguous dummy
transaction. The real outbox's record layout, descriptor signature, publication
transaction, NFC latency, power-loss behavior and wear require their own measured
drills. Simulator memory counts cannot establish physical capacity. The probe
stays outside normal provisioning and release artifacts.
