# Private catchable-constructor diagnostic

The current 07297620 evidence has an unconfirmed creation reply, then an exact
registry with package/opener present and main absent. Its public ISD counters
report 92,696 persistent and 3,750 volatile bytes. The normal constructor and
50-reference class shape were preserved. Those observations do not localize
which operation failed, or prove an allocation/crypto/layout cause.

This host-only generator creates a separate diagnostic namespace,
`F0434153485543545243`, with opener `...4D` and diagnostic main `...01`.
It is never a payment installation. The old image, production sources/CAP,
SDK, phone app, policies and journals remain unchanged. It needs a separately
approved named-device plan before any physical access.

## What the diagnostic records

The generated main retains the original instance fields and ordered constructor
statements. It records before/after stage markers around 48 CashuApplet
constructor statements and 16 SchnorrHW constructor statements, without changing
their allocation sizes or cryptographic arguments. A source-bound stage map
contains every statement and hash. Final converter metadata must still show
50 declared cells, first reference index 0 and 50 references.

The main constructor catches `CardRuntimeException` and ordinary
`RuntimeException`. It retains only stage, a fixed exception-family code and
public API reason, then permits registration of the diagnostic object. Its
selection path is safe with partially initialized fields. Its APDU dispatcher
exposes only `CTRACE`/1 selection and a six-byte `B07D000000` status read. It has
no payment, setup, key-read, reset or retry command and offers no Shareable
interface. All original allocations remain inside installation; no APDU reserves
or recreates any object. The trace helper adds primitive static state only.

A successful GP INSTALL means the **diagnostic instance registered**, even if
constructor initialization faulted. Only its decoded outcome distinguishes
complete construction from a caught fault. It must never be called a usable
Cashu installation or interpreted as an original card status word.

| Status byte | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| 0           | Fresh opener, no constructor attempt recorded                              |
| 1           | Entered a stage; not an accepted final main result                         |
| 2           | Completed a stage; not an accepted final main result                       |
| 3           | Caught constructor exception; stage/family/reason follow                   |
| 4           | Original constructor statements completed; final stage must match manifest |

The six response bytes are format 1, status, stage ID, family, reason-high,
reason-low. Family 1 = crypto, 2 = system, 3 = transaction, 4 = ISO, 5 = PIN,
6 = other CardRuntimeException, 7 = RuntimeException (reason zero). No raw
exception message, stack, secret key or PIN is retained. An original statement
and its source file are looked up only through the pinned stage map.

## Evidence limits

JavaCard may roll back atomically updated persistent state when installation
fails before registration; the API also warns against application-driven aborts
while creating objects. This design does not manually abort and does not rely
on non-atomic breadcrumbs surviving a failed INSTALL. See Oracle's
[JCSystem transaction notes](https://docs.oracle.com/cd/E59935_01/api/javacard/framework/JCSystem.html)
and [Applet registration contract](https://docs.oracle.com/cd/E59935_01/api/javacard/framework/Applet.html).
If a diagnostic registration does not return a confirmed success, the host must
stop. No later opener marker is accepted as a reliable constructor location.

A mute card, VM fault, failure in superclass initialization, inability to record
the exception, or failure in registration can still prevent a diagnostic result.
No trace method can convert those events into a known API refusal. The next
transport must retain bounded native failure classification and failed-call
elapsed time, without raising any timeout or retrying.

Instrumentation changes code layout, scalar state, writes and install-time work;
a separate coexisting package also changes the memory baseline. A completed
instrumented constructor does not prove the original image fits or reveal its
old failure. A caught exception localizes this **instrumented image's** boundary
only. It can guide a later controlled experiment; it cannot establish causality
for another CAP. Partial construction may consume resources that remain until a
separately authorized removal. No automatic cleanup is implied.

## Offline build and checks

```text
python3 -B tools/outbox-spike/build-constructor-trace.py <new-output-directory>
python3 -B tools/outbox-spike/compile-constructor-sim.py <same-output-directory>
CONSTRUCTOR_SIM_ARTIFACT=<same-output-directory> node --test tools/outbox-spike/constructor-trace.test.cjs
```

Use JDK 17 and the pinned JavaCard 3.0.5 SDK. Output reuse is refused. Conversion
runs in the isolated output, never rewrites the tracked production CAP and
records SDK/source/helper/stage/CAP/load hashes. A dirty-source development image
is explicitly marked and rejected by physical artifact admission. A final image
must come from signed clean source, then have its exact manifest hash pinned.

Simulator fault injection is compiled into copied simulator sources only. The
harness exercises all 64 stage positions plus seven exception families at the
first stage, producing 71 classified cases including complete construction.
It checks retained reads after reset/reselection and rejects setup, key read,
signing, retirement and malformed APDUs on both complete and partial instances.
Converter sources/CAP exclude the fault hook and harness. Simulator checks do
not measure actual installation budgets, transactions or torn writes on silicon.
