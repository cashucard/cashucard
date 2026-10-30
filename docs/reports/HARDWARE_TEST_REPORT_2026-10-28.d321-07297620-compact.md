# D321 07297620 compact installation attempt and cleanup

## Scope and result

Following the operator-authorized test-value disposal and blank qualification,
one fixed compact prototype attempt ran on card
`cplc-v1:4790d3213180072976207515` (serial 07297620), on the ACS ACR122U PICC
Interface USB reader. Package loading completed and opener creation succeeded.
The main-instance creation was unconfirmed: the host stopped at `install-01`
with `operation-failed`. The invocation supplied no setup, signing, export or
retirement evidence. A separate cleanup-only continuation matched identity,
proved the factory keys and restored the exact four-file blank baseline. The
reader closed after each invocation.

Production firmware and services were outside this private synthetic test.
The operator's explicit acceptance of losing the earlier 32 test sats and eight
spent entries is recorded in the [blanking report](HARDWARE_TEST_REPORT_2026-10-28.d321-07297620-blank.md).

## Artifacts and environment

Host: operator Mac, Node 22, existing Homebrew Python 3.10/pyscard venv. Cardkit:
public package API version 0.2.0. Runtime source:
`0eb0a656d3bdb9b6b6b035a09dc8894ca5e1e06e`, merged by #207. Private image
source: `c23c492eafba998fad14f5ef5a82d6686b67d98d`, merged by #206.

| Pin | Value |
| --- | --- |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load-file SHA-256 | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` |
| Load-file size | 26,934 bytes |
| Manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Runtime fingerprint | `26659fc94adbfeffbdba41d8623ac154a2d9fc5f12a1b63e21236e9e28e8f5b5` |
| Private package AID | `F04341534855434D5054` |
| Private selector / format / setup INS | CPROT/2 / 5 / `7E` |
| Original instance size / references | 50 / 50 |

The fixed plan admitted two synthetic inputs and two outputs, independent
verification of both signatures and the 559-byte packet, exact retirement and
private cleanup. It retained 30-second response deadlines, a 120-second gate
on further transmission, a 512-command ceiling and single-attempt writes.

## Observations

| Stage | Observation |
| --- | --- |
| Initial checks | Exact CPLC, Cashu/probe absence and four-file baseline matched |
| Manager authentication | Published factory set proved at key version 1 |
| LOAD | All 110 blocks completed, aggregate 16,232.351 ms |
| Opener creation | Completed, 236.080 ms |
| Main-instance creation | Unconfirmed; stopped with generic `operation-failed` |
| Setup and synthetic workload | Unreached |
| Separate cleanup | Private applet, opener and package delete sequence completed |
| Final registry | Exact original four files, blank baseline verified |

The stopped journal lacks a card status or native transport code. Offline
review found that cardkit's `TransportError` wraps a transceiver failure while
the runner recognized only direct `ProbeFailure` instances. This is a reporting
bug; the original cause cannot be recovered from the journal. It does not
establish whether the underlying event was a card refusal, reader failure or
memory limit. D154 preserves bounded diagnostics for future invocations while
keeping the existing cleanup admission unchanged.

A subsequent read-only connection sent SELECT ISD, GET CPLC and GET DATA `FF21`
once each. Identity matched and memory data returned `9000`:

```text
ff21108102000182040001d484830400000ea6
```

The parsed public values were tag 81 = 1, persistent availability 119,940 bytes
and volatile availability 3,750 bytes. This post-cleanup snapshot measures
reported availability; it does not identify the earlier creation failure or
prove a maximum allocatable array size. The connection closed without
manager authentication.

## Evidence retention and remaining work

The protected directory `assisted-compact-07297620-2026-10-28` contains the
pinned plan, authority record, filesystem-only preview, execution record,
stopped journal, separate cleanup plan/journal and read-only memory result.

| Evidence file | SHA-256 |
| --- | --- |
| `prototype-journal.json` | `ecb21712073126d7d7802401656f7b0380ce4b133a9d6a03c00a8d8609dc4e56` |
| `cleanup-journal.json` | `5d56123c62762fffb1cc7a4ab423dc6f5f5cff1ac5e68e11a3a6492c479b2ab1` |

## Diagnostic continuation

PR #208 merged after review and all 22 CI checks passed, at
`669880bcbbc6f879146f1915bc546784726b7b8d`. One reviewed continuation used
its source `f28bb6e2a125bc658bb05c653518f14cb4085064` and fingerprint
`75ed5f53719ddde8b11f79a340990c6372bfdef9d3260e69e657e3e65453d6f1`.
The CAP, private commands, exact card baseline and fixed workload were unchanged.
The protected directory `assisted-compact-07297620-diagnostics-2026-10-28`
retains its plan/authority, exact-head CI evidence and both invocation journals.

All 110 LOAD blocks completed in aggregate 16,195.807 ms; opener creation
completed in 239.754 ms. Main-instance creation stopped at `install-01` with
`reader-transmit-failed`, PC/SC `80100016`. The journal contains no card status
word for that command. Setup and the synthetic payment were unreached. The
reader closed and there was no automatic retry or deletion.

The [PC/SC headers](https://github.com/smartcardservices/smartcardservices/blob/master/SmartCardServices/src/PCSC/pcsclite.h)
name `80100016` as `SCARD_E_NOT_TRANSACTED`. The code identifies a failed
host/reader transaction; it does not establish which card/reader condition
prevented the reply. The original invocation's discarded cause remains unknown.
The continuation confirms this failure before setup on this card; it provides
no evidence about compact allocation, signing or packet limits.

A separate cleanup-only plan reviewed the stopped state and the operator's
requested blank end state. The invocation matched exact CPLC, proved one
factory-version-1 channel, checked the four-file baseline plus only private
objects, ran the private applet/opener/package delete sequence and verified the
original blank baseline. It performed no installation or fixture operation.
The reader closed. No further installation attempt followed.

| Continuation evidence | SHA-256 |
| --- | --- |
| `prototype-journal.json` | `93172a0004ff17c3752dfc9a0bda7a07ae1ac849ccaa4457147137f8157b6c73` |
| `cleanup-journal.json` | `9185333af1fa9655659144a39d5cf2be8c367253725e8d2a0a27a293934791a0` |

07297620 ended blank with factory manager keys at version 1 and all four
pre-existing load files preserved, including `A00000016443446F634C697465`.
The card remains unsuitable for further blind installation attempts. The
available evidence supports isolating the card/reader path before changing
firmware. Integrated allocation, both physical signatures, verified export,
latency, capacity and actual power-loss recovery remain open.
