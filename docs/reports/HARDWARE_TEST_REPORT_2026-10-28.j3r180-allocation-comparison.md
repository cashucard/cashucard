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
