# J3R180 allocation comparison

## Device and approval

The operator approved the pinned 256-byte, 4 KiB and segmented 16 KiB plan,
including declared creation-refusal cleanup, for only card 09336320
(`cplc-v1:4790d3213041093363205547`) on `ACS ACR122U PICC Interface`.
The plan required stopping the sequence after a refusal. The starting blank
state came from the separately approved cleanup in the
[previous report](HARDWARE_TEST_REPORT_2026-10-27.j3r180-assisted-preflight.md).

Host: `mlod`, macOS 26.5 (25F71), Python 3.10.22 with pyscard. The private
artifact was built with JDK 17 and JavaCard 3.0.5 from source
`e0e8cf94b4c330ed32bd499c0a5a6dbecce2842c`, reviewed and merged by #196.

## Artifact and execution

- Pool: 256 bytes in one persistent array, allocated in the constructor.
- CAP SHA-256: `dcf53a4888ab4e4abcd8a7345302cd54bde190aa613310c111494d43bbbf6aba`.
- Manifest SHA-256: `e4b5cf51bf4751679d6d74b9b3c383fe34ebb02e4ac55a50a83c4dc774ddeff8`.
- Load file: 19,751 bytes; SHA-256 `b4b2a31c3a0314bf98e19ac040d3c4fe4377d51008e26be9268629fe893990b5`.
- Protected journal: `comparison-256-1-09336320-ready.json`; last persisted
  `2026-10-28T08:32:00.522473+00:00`.

An earlier invocation stopped at `before-reader`, before any card command.
macOS showed no connected USB devices. The original journal was retained;
the operator reconnected the reader and confirmed ready before the fresh run.

The fresh invocation matched CPLC, proved the known factory channel and the
exact three platform entries, loaded the private package and created its
opener. Probe creation returned empty-body `6F00`. Under the approved refusal
policy, the runner persisted that result, rematched CPLC, proved a new factory
channel, removed only private probe objects and verified the exact original
platform baseline. It closed the reader and exited 2, `install-refused-cleaned`,
stage `factory-blank-ready-for-ccp`.

There was no probe selection, resource query or dummy publication. The larger
profiles were not run. There was no retry, key change, production-service
access, funding or production-app installation. All protected journals remain
retained. The card is blank and ready for CCP installation.

## Interpretation and next control

The 256-byte refusal supplies no allocation-capacity measurement. The earlier
successful constructor control had a 19,635-byte load file; both the 256-byte
and 16 KiB single-pool profiles had 19,751-byte load files. Their comparison
changed both allocation and image layout. The documented
[load-file-size sensitivity and constructor budget](../FOXY-CARD-HARDWARE.md)
remain confounders. The generic status cannot identify the failing operation.

A next diagnostic should use one identical CAP for its baseline and reservation
sizes, and separate installation from the reservation command. A guarded,
one-time private post-install reservation can measure this without selecting a
new constructor budget for each candidate. This follows the existing deferred
proof-store precedent while keeping the experiment outside released firmware.
Actual reservation, publication, final outbox fit and interruption behavior
remain physical validation gates requiring their own approved action plan.

## Approved fixed-image attempt and interrupted transfer

The operator separately approved the fixed-image post-install plan from #197
and confirmed the same card ready. Artifact source was
`5fe9b58e7fa49ed9486db1a2204ea892a2bee723`.

- CAP SHA-256: `771d3a52d960d683b86951ba1f4096d1a593038e44acc99dbf52b68f9bca1b9c`.
- Manifest SHA-256: `57300116c98edef310daffc7d2171ff63fdf10ca6aaced21c843fdff3e37b2d4`.
- Load file: 19,931 bytes; SHA-256 `d82cbc4f722afff13289d8a10af17c64cc67e0a21cb7ffbfb21c1b820bff7023`.
- Journal: `post-install-v3-256-09336320.json`, last persisted
  `2026-10-28T08:57:30.351539+00:00`.

The invocation matched CPLC, proved a factory channel and the exact platform
baseline, then began loading. It stopped at `load-block-13`, with
`operation-failed`. The bridge closed. No applet was created; there was no
selection, measurement, reservation or publication. Larger stages were not
started. The error did not qualify for the approved automatic cleanup, so
there was no cleanup or transfer retry in this invocation.

macOS still listed the ACS reader after the stop. All 81 LOAD framings from the
pinned file passed the bridge's validator offline, including block 13, using
synthetic MAC bytes. This checks framing only. The old bridge discarded the
exception category and PC/SC result, so the transfer cause remains unresolved.
This result supplies no allocation-capacity evidence.

### Separately approved cleanup after LOAD

The operator approved one cleanup-only connection. The runner matched the same
CPLC, proved one known-factory channel, checked the platform baseline plus only
permitted private objects, deleted only the private probe objects and verified
the exact original platform entries. Journal
`post-install-v3-cleanup-09336320.json`, last persisted `2026-10-28T09:00:43.608576+00:00`,
ended `cleaned`, `factory-blank-ready-for-ccp`. The reader closed. There was no
LOAD retry, creation, reservation, publication, key change or production access.
All journals remain retained. The card is blank and ready for CCP installation.

## Approved diagnostic rerun

The operator approved the bounded rerun and its reviewed private-command
backout, with the same artifact and card. The host/bridge source was
`8f2a6b67c3260c6caa141daf9a7ff13f7495d65c` from #198. The fresh journal
`post-install-v3-diag-256-09336320.json` last persisted
`2026-10-28T09:20:33.771Z`.

This transfer completed. The opener was created, but probe creation returned
empty-body `6F00`. The approved refusal cleanup succeeded and verified exactly
the original three platform entries. The journal ended
`install-refused-cleaned`, `factory-blank-ready-for-ccp`, and the reader closed.
No selection, memory measurement, pool reservation or dummy publication ran.
The 4 KiB and 16 KiB stages were not started. The separate backout was not needed.
There was no retry, key change or production access.

This confirms failure before the post-install allocation command. The private
constructor preserves the original constructor body, so the failed image has
no additional pool allocation during creation. Image/class layout and the
card's current initialization baseline remain unresolved variables. It gives
no evidence for a 256-byte allocation limit. A subsequent comparison should
revalidate the previously successful pinned control, then hold each candidate
image fixed while measuring its requested reservations. The public ISD memory
tag can supplement the capped JavaCard counters if the card supports its
documented structure. Further physical actions require their named approval.

## Approved known-control and fixed-layout comparison

The operator approved the pinned control/layout plan and confirmed 09336320
ready. Host source was `f1cb5ea48d51a78cf16fa674a26ffd9aea552d08` from #199.
Each invocation matched CPLC, read public ISD tag FF21 before authentication,
proved the factory channel and required the exact original platform entries.

| Invocation | Load bytes | Pre-load persistent bytes | Pre-load volatile bytes | Outcome | Journal persisted (UTC) |
| --- | --- | --- | --- | --- | --- |
| Known control | 19,635 | 163,648 | 3,990 | Complete, zero pool, no dummy publication | 2026-10-28T13:05:09.415Z |
| Layout A, requested 256 | 20,068 | 164,176 | 3,990 | Creation `6F00`, refusal-cleaned | 2026-10-28T13:05:50.363Z |
| Layout B, requested 256 | 20,196 | 163,648 | 3,990 | Creation `6F00`, refusal-cleaned | 2026-10-28T13:07:34.207Z |

FF21 tag 81 was 1 for all three, retained without interpretation. The control
returned the same capped counters as before: persistent 32767 (saturated),
transient-reset 2574, transient-deselect 2560, maximum and unused commit 5120.
Its pool and publication marker were zero. Its exact known manifest/CAP pins
are in the previous report and were reused unchanged.

Layout A CAP SHA-256:
`883f651fa26c9a9c349bff9362bfae761702266da7ae13dd1664869d1d2c870f`;
manifest `ee50268fec9e5848d4f2fd4aa5178ae6b107700e238942ba12f22daa5b3cecc4`.
Layout B CAP SHA-256:
`8dc745733c5e9a2dea3197437568a153c2f89ad48581988b0d9f5caad73cf225`;
manifest `e0b142d2135fe02bee7cddff3295894d4f96eac4f7acae41d6af367d78b015fa`.
Both came from `cc0df517d700b4e861dedb8ddeef0497c9dd4996`.

The initial A creation refusal and verified cleanup qualified for the plan's
single alternate-image branch. B also returned empty-body `6F00` at
`install-01`, then completed its approved cleanup. Both failed before selection,
measurement, reservation or publication. No 4 KiB/16 KiB stages or separate
backout ran. The three final journals verified exactly the original platform
baseline and `factory-blank-ready-for-ccp`; connections closed. There were no
retries, key changes or production accesses. The card remains blank.

The baseline still installs, while both modified layouts fail before pool
allocation. Oracle's pinned 3.0.5 verifier metadata shows a remaining confound:
the control has declared instance size 50 and 50 reference fields, while both
failed format-3 images have size 52 and 51 reference fields. Source-level
constructor equality did not preserve the instance-field layout. These results
do not establish which initialization difference caused the refusal or a
memory-capacity limit. The next private diagnostic preserves the original
field layout and constructor, reusing state unused by its restricted dispatcher;
its converted shape must match the known control before physical approval.
