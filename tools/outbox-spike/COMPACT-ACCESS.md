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


## Local cursors and buffered hashing, October 31

The optimized Pixel run later staged all 128 inputs and outputs but lost the
signing reply. Separately approved recovery established unpublished staging
and returned 09336320 to its original blank baseline; see the
[recovery report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-optimized-sign-stop.md#approved-recovery-and-final-blank-state).

The next private helper removes remaining repeated head-to-offset scans. Prior
output-point checks, input-generation reads, output validation, canonical fields
and payment-message output reads advance command-local cursors through owned
pages. Reads retain logical span/buffer bounds, cursor alignment and page-owner
checks. Whole-chain validation still precedes canonical rendering, including
exports whose first integrity check is cached. The cursor derives from the
validated chain and stays within its current command.

Canonical hashing now buffers 128-byte blocks in the original 196-byte
transient scratch. The final partial block is hashed before digest finalization;
a full final block is already consumed. Tagged hashing retains its two tag-hash
prefixes. Export uses its existing clipped-copy path. Hash scratch must have at
least 128 bytes and be separate from both persistent pool and proof storage.
Input validation uses bytes 32–36 for one reference, alongside sum bytes 0–3
and the duplicate bitmap at 16–31; hashing takes over scratch after validation.
There are no new applet fields, arrays or allocations. Persistent write order,
publication and recovery semantics are retained.

The baseline is the helper shipped in #221 (unchanged through #224). Both
versions run the same fixed large fixture, with the same canonical packet and
both independently checked signatures. Host-only instrumentation records:

| Operation | Previous optimized helper | Cursor/buffered helper |
| --- | ---: | ---: |
| Output-staging page-link reads, all 22 commands | 24,820 | 1,496 |
| Signing/publication page-link reads | 37,211 | 1,479 |
| Export page-link reads, all 91 commands | 25,065 | 10,912 |
| Those page-link reads combined | 87,096 | 13,887 |
| Canonical digest updates during signing | 2,849 | 545 |
| Canonical digest input bytes during signing | 69,361 | 69,361 |
| Canonical digest updates below 32 bytes | 1,389 | 0 |

The new call counter wraps only CompactState digest updates in copied simulator
sources. It includes three canonical passes during signing and the tagged
prefix. It excludes payment-message updates and Schnorr's internal hashing.
These operation counts identify reduced work; physical latency remains open.

The tighter page-walk and digest-call regressions fail against the previous
helper. Converter/simulator checks retain the original 50-cell/50-reference
instance shape, exact 23,163-byte packet, both signatures and recovery cuts.
Eight mint-length variations exercise canonical hash remainders 0, 1, 31, 32,
63, 64, 65 and 127. Direct checks compare cursor reads against a fragmented
logical reference and reject invalid spans, misalignment, foreign ownership,
broken links, unsafe scratch aliases and invalid advances. All 228 ordered
pool-byte write cuts remain. Simulator hooks stay outside CAP sources.

Existing Pixel profiles retain their earlier exact image pins. This helper
requires its own converted image, separate lab journal/profile, reviewed build
and approved named plan before physical execution. The 15-second phone timeout,
120-second transmission gate, command ceiling, fixture and journal barriers
remain unchanged. Production firmware/assets and the protocol are unchanged.


The `capacity-streamed` mode pins the converted image from commit
`96eb11df58c0969e2d00a1d52a2ca726f8d2d971`, with 28,067 load bytes in 114
blocks. The private lab version code is 4 / `0.0.4-lab`, with journal key
`cashucard-private-capacity-streamed-v1`. The fake full workflow uses 399
commands. Earlier modes, image pins and consumed journal keys remain. Crossed
image tests cover all six distinct pairs before any APDU.
