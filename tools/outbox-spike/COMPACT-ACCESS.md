# Compact prototype access profile

The [Pixel diagnostic run](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-capacity-deadline-stop.md)
loaded 128 inputs and confirmed 72 outputs before the unchanged 120-second host
gate stopped it. Its stage envelopes include host persistence, transport and
card work, so they cannot isolate chip execution cost.

## Offline measurement

Host-only simulator instrumentation counts each linked-page dereference and
ordered store to the compact pool. It also supports interruption after a chosen
pool-byte store. These counters and cut controls enter only copied simulator
sources. The converter's original generated sources and CAP exclude them.

The fixed 128-input/128-output fixture produces these counts. The baseline is
the private helper at `5ea012f4ca208bef062d0fe772e78a5d0d61804d`; the optimized
helper uses the same fixture, byte-backed layout and canonical format.

| Phase | Baseline page-link reads | Optimized page-link reads | Reduction |
| --- | ---: | ---: | ---: |
| Output staging, all 22 commands | 311,533 | 24,820 | 92.03% |
| Sign/publish command | 185,926 | 37,211 | 79.99% |
| Export, all 91 commands | 981,640 | 25,065 | 97.45% |
| These phases combined | 1,479,099 | 87,096 | 94.11% |

These are deterministic JVM operation counts. They establish neither silicon
latency nor completion within the phone's time limit. The first export retains
full integrity validation; each subsequent export still validates the page
chain and streams the requested bytes.

## Implementation

Page-aware transfers resolve the first address once and follow links at page
boundaries. Each page crossing validates ownership. Writes retain the original
ordered byte stores and publication boundary. Output duplicate checks fetch
each older point once into existing scratch, compare its full 33 bytes against
the incoming batch, and finish every check before writing the new frame.

Signing uses page-aware reads for amounts and points. Input duplicate checks use
a 16-byte bitmap in existing transient scratch. Canonical rendering advances
local cursors through input/output references and skips frame accesses outside
the requested export range. Hashing still processes every canonical byte.
There are no new fields, arrays, runtime allocations or caches across commands.

The generated CAP passes the JavaCard 3.0.5 converter/verifier and retains the
original 50-cell, 50-reference instance shape. Released firmware/CAP/assets,
protocol files, cardkit and current Pixel image pins remain unchanged. A future
physical test needs a separately prepared exact image/APK and named approval.

The explicit `capacity-optimized` lab mode admits a separately pinned image
from commit `038e298ec7c846cec75e7e40366b1bc4d25a88d6`. Its load file is
27,343 bytes in 111 blocks. The normal fixed workflow is 396 commands; all
existing ceilings remain. The generated version-code-3 APK keeps the same
private app ID and uses its own consumed plan/key while preserving earlier
creation, capacity and diagnostic records. Existing modes retain their original
image pins. Unknown modes and interchanged image profiles fail before APDUs.

## Journal workload

The complete fake Pixel workflow saves 1,676 snapshots, serializing 25,945,234
bytes in total. This measures snapshot volume; Android persistence latency was
unmeasured. Every existing persistence barrier is retained, including intent
before transmission, received pages before the next request and the verified
packet before retirement. The next hardware test keeps the existing response,
elapsed and command bounds.

## Regression coverage

The page-access budget regression fails against the baseline helper. The full
simulator suite passes with the optimized helper, including both independently
verified signatures, the exact 23,163-byte canonical export, retirement and
the existing publication/recovery cuts. Additional checks cover:

- Logical-reference comparisons across fragmented pages and buffer offsets.
- Every one of 228 ordered byte-store cuts, preserving the exact written prefix.
- Invalid spans and broken next-page/ownership metadata.
- Duplicate points within a batch and against previously staged points.
- A duplicated input reference, with all proofs retained as unspent.
- Corruption in an unrequested page, including after the export cache is warm.
- Staging-write cuts around a page boundary, hidden scopes and reclamation on
  reselect with unspent proofs preserved.

The direct access harness runs 294 cases. Simulator interruption checks model
Java execution boundaries; physical torn writes and EEPROM timing require
their own measured hardware evidence.

Use the existing private build and smoke commands in [README](README.md#private-javacard-fixture-prototype).
The large-workload smoke test prints its page-link counts, and the Pixel capacity
test prints fake journal volume. Neither command opens a reader or phone.
