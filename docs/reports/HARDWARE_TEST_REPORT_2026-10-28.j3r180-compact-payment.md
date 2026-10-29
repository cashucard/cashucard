# J3R180 compact synthetic payment and verified cleanup

## Result

One approved private prototype run completed on card 09336320 through the ACS
ACR122U PICC Interface. The corrected setup instruction allocated the 12,288-byte
DLEQ store and 16,384-byte compact outbox together. The card signed one synthetic
two-input/two-output payment, retained it across applet reselection and exported
the complete 559-byte canonical packet. The runner verified both BIP-340
signatures, exact bytes and record scope before retiring the fixture. It then
removed only the private objects, verified the original three-file blank
baseline and closed the reader. The card ended blank with factory keys at
version 1.

## Device, scope and artifacts

The operator approved the prepared named plan and continuation. This test used
public synthetic fixtures in a private package with production commands
unreachable. Production systems, real funds, owner/PIN operations and key changes
were outside its scope. The current production CAP and app release are unchanged.

| Item | Value |
| --- | --- |
| Date | 2026-10-28 local, 2026-10-29 UTC |
| Host / reader | Operator Mac / ACS ACR122U PICC Interface, USB/PCSC |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| Runtime source | `f28bb6e2a125bc658bb05c653518f14cb4085064`, reviewed in #208 |
| Runtime merge | `669880bcbbc6f879146f1915bc546784726b7b8d`, all 22 CI checks passed |
| Runtime fingerprint | `75ed5f53719ddde8b11f79a340990c6372bfdef9d3260e69e657e3e65453d6f1` |
| Private image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d`, #206 |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load-file SHA-256 | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` |
| Load-file bytes / blocks | 26,934 / 110 |
| Manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Private package | `F04341534855434D5054`, opener `...4D`, applet `...01` |
| Selector / format / setup INS | CPROT/2 / 5 / `7E` |
| SDK / converted instance shape | JavaCard 3.0.5 / 50 cells, first reference 0, 50 references |
| Host tools | Node 22; existing Homebrew Python 3.10/pyscard venv; cardkit 0.2.0 |

The protected evidence directory is
`assisted-compact-09336320-abi2-2026-10-28`. It contains the approved plan,
filesystem-only preview, operator approval and exact-head CI record, complete
journal, result and independent Python verification. The plan limits execution
to one attempt, 30-second response deadlines, a 120-second gate on further
transmission and 512 commands. The declared-refusal cleanup branch was unused.

## Allocation and transaction counters

| Counter | Before setup | After setup |
| --- | ---: | ---: |
| Persistent availability | 32,767, saturated | 32,767, saturated |
| Transient reset availability | 2,574 | 2,574 |
| Transient deselect availability | 2,560 | 2,560 |
| Maximum commit capacity | 5,120 | 5,120 |
| Unused commit capacity | 5,120 | 5,120 |
| Private pool bytes | 0 | 16,384 |
| DLEQ bytes | 0 | 12,288 |
| Setup state | 0 | 2 |

The persistent availability API saturated at its signed-short ceiling, so these
readings establish successful combined allocation rather than the remaining
persistent capacity. The original constructor/fields and Schnorr implementation
were preserved. Setup reserves the private stores once outside a transaction;
the candidate staging identity uses a 21-data-byte transaction.

## Synthetic payment and verification

The fixed fixture loads two public synthetic proofs into slots 7 and 3 with
generations 9 and 11, uses mixed full 33-byte and 8-byte keyset IDs, and prepares
two merchant outputs. Record identity is uint64 `9007199254740993`, generation 1,
index 0. The card generates its own test key during installation.

After staging the outputs, the card returned one 45-byte scope. Public state
showed two spent entries, 126 empty slots, 63 free headers and 88 free pages.
Applet reselection was followed by reading that same retained scope. Three
export pages of 255, 255 and 49 bytes reconstructed the canonical packet.
The host verified exact packet materialization, both signature messages, the
payment and descriptor signatures, and the scope's packet ID before issuing
unsigned private fixture retirement. Retirement restored 128 empty slots,
64 free headers and 90 free pages.

A separate offline Python materialization used the retained public card key,
fixed input/output definitions and returned signatures. It rebuilt all 559 bytes,
recomputed both messages and the packet ID, and verified both signatures through
`tools/cardctl/bip340.py`. Its exact bytes and hashes matched the runner result.

| Verified value | Result |
| --- | --- |
| Packet ID | `675ba410fbd154bc8f9cf466b38874bd0e64d12886b8f19a63931344ac83557a` |
| Payment message | `0ec38a7225ec257fa411690d472c21e17718add7df3a9c816156393091691743` |
| Descriptor message | `be10a78823710db4132dbba1de72183017fe9e5655e99ca9c9d5ecd983144b36` |
| Payment / descriptor signature | valid / valid in both host verifiers |

## Single-run timings

These host-observed timings include USB transport and host overhead. They are
one observation per stage, without a latency distribution or NFC measurement.

| Stage | Milliseconds |
| --- | ---: |
| LOAD, 110 blocks combined | 16,297.904 |
| Main applet creation | 1,401.127 |
| Combined setup | 562.200 |
| Sign and publish both commitments | 2,555.013 |
| Export, three pages combined | 450.033 |
| Runner packet verification | 123.031 |
| Fixture retirement | 164.410 |

## Cleanup and evidence integrity

After verified retirement, the runner rematched CPLC, proved one fresh
factory-version-1 channel and checked the registry. It deleted only private
applet, opener and package in order, then required exactly the original three
platform load files: `A0000001515350`, `A0000000620204`, `A0000000620202`.
The journal ended `complete` at `verify-blank-registry`, with
`blankBaselineVerified: true`. The reader closed and its journal lock was
released. The independent verification occurred offline after cleanup.

| Protected evidence | SHA-256 |
| --- | --- |
| `plan.md` | `e9e15a4d59e875b002f43b56add2dd909715a128d8904d9ae0438b45c7ed2d01` |
| `prototype-journal.json` | `08742252d4a7546409824366b0c82a919e995238418b0048b1385f0ffeb9f40f` |
| `independent-verification.json` | `64a8e61a246b3182e470091f35cd59abfe641cfa6d205e516eacb617df76ee75` |

## Remaining gates

This completes the small physical allocation/signing/export/retirement gate
from D151 and the corrected setup check from D152 on 09336320. The same image's
creation failure on 07297620 remains separately documented in its
[transport report](HARDWARE_TEST_REPORT_2026-10-28.d321-07297620-compact.md).
Success on this card does not identify that other card's failure cause.

Next gates are measured high-water/full-record capacity and actual power-loss
recovery, then production authorization/load provenance, authenticated retirement,
final descriptor/limits, portable relay and wallet/till interoperability. Applet
reselection in this test establishes retained state across selection; actual
power-cut recovery remains untested. Assisted settlement stays disabled in
released apps until the remaining protocol, merchant and physical gates pass.
