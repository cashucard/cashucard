# J3R180 recorded-reset repeat stopped at opener creation

## Result

The operator approved one full-slot repeat on 09336320 after the explicitly
confirmed five-second lift and read-only memory comparison. The image, workload,
runtime and bounds were unchanged. Identity/factory/baseline checks passed and
all 110 LOAD blocks completed. The first instance's creation (private opener)
then stopped with `reader-transmit-failed`, PC/SC `80100016`, without a card
status word. Main creation, setup, fixture loading, signing and export were
unreached. This run provides no capacity result.

A separately reviewed cleanup-only continuation restored the exact original
three-file blank baseline and closed the reader. The pre-delete registry listed
only the private load file alongside the platform baseline; neither private
instance was listed. No installation retry followed. As agreed in the approved
plan, installation tests on this reader path are stopped pending an independent
transport/reader control.

## Device, plan and artifacts

| Item | Value |
| --- | --- |
| Date | 2026-10-29 |
| Host / reader | Operator Mac / ACS ACR122U PICC Interface over USB/PCSC |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| Starting condition | Operator-confirmed five-second lift/return, then only approved ISD/CPLC/memory reads; operator confirmed card unchanged before this invocation |
| Approved plan | `assisted-compact-09336320-capacity-coldstart-2026-10-29/plan.md` |
| Workload | `128-input-128-output-v1`, selected but unreached |
| Runtime source / merge | `8578f6ade5d91231434c3da212f59ae084ace18a` / `c1bd8432a4194a30e377dcaa6222d70172c64e0a`, #211 |
| Runtime review/CI | Exact-head review and all 22 checks passed |
| Runtime fingerprint | `6974cef485fbced3c65c677301ddc1354afea6a037cd5d0e45024408a8794f98` |
| Private image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d`, #206 |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load SHA-256 / bytes | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` / 26,934 |
| Manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Package / private ABI | `F04341534855434D5054` / CPROT/2, format 5, SETUP `7E` |
| Host tools | Node 22; Homebrew Python 3.10/pyscard; public cardkit 0.2.0 API |

The plan allowed exactly one capacity repeat. Single attempts, 30-second response
deadlines, the 120-second gate on further transmissions and the 512-command
ceiling remained in force. Its scope excluded real funds, production services,
owner/PIN operations, manager-key changes and further power cuts. The optional
declared-refusal cleanup branch was unused; the original uncertain exchange
stopped with retained state and a closed reader.

## Observations

A passive existing `onStage` observer recorded host timestamps in RAM and wrote
them at completion/stopping. It added no APDU or deadline change. The timing
envelope includes host failure handling and reader closure; it is not an isolated
native command latency.

| Observation | Result |
| --- | --- |
| Identity / factory keys / initial baseline | Exact card / published factory version 1 proved / original three files |
| LOAD | 110 blocks, aggregate 16,318.610 ms |
| Stopped stage | `install-4D`, first private instance creation |
| Public failure | `reader-transmit-failed`, PC/SC `80100016` |
| Whole host envelope, including closure | 19,159.976 ms |
| Failed-stage envelope, including closure | 20.763 ms |
| Main / setup / fixtures / signatures / export | Unreached |
| Card status word at failed exchange | Unavailable |

The failure occurred before the 30-second host response deadline or 120-second
transmission gate. It supplies no allocation or full-packet performance limit.
The [earlier creation stop](HARDWARE_TEST_REPORT_2026-10-29.j3r180-capacity-create-stop.md)
was at the main instance; this one is at the opener, before the main constructor
or large fixture can run. The earlier
[small physical success](HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md)
remains valid for its observed invocation. These observations do not assign the
underlying card, reader, power, driver or transport cause. A recorded field reset
did not make this invocation pass.

## Cleanup and remaining gate

The cleanup plan reviewed the stopped state, matched the same CPLC, required
production/previous probe absence, proved one fresh factory-version-1 channel
and required the exact baseline plus only private objects. A filesystem observer
copied the public registry before the first DELETE without adding a card read.
It listed private package `F04341534855434D5054` and the three original platform
files, with no private application instance. Cleanup ran only the private
main/opener/package delete sequence, then required exactly:

- `A0000001515350`
- `A0000000620204`
- `A0000000620202`

The cleanup journal ended `cleaned`, with `blankBaselineVerified: true` and
successful reader closure. The card ended blank at factory key version 1;
private journals/artifacts were retained. The cleanup performed no installation,
setup, fixture command, key change or power cut.

Further installation attempts through this ACS path are paused. The next
hardware gate is a separately prepared creation-only control on an independent
transport, using the same card/image and preserving exact identity, factory-key,
registry and cleanup boundaries. Current availability of a phone or contact
reader requires operator input; no alternative-device plan is approved yet.
Capacity, many-small-record and real interrupted-write gates remain open.
Released apps and production firmware remain unchanged.

## Evidence integrity

Protected evidence is retained under
`assisted-compact-09336320-capacity-coldstart-2026-10-29`, including the approved
plan, prior lift/memory hashes, exact-head CI, wrapper/options pins, complete
stopped journal, timing envelope and separately reviewed cleanup evidence.

| Evidence | SHA-256 |
| --- | --- |
| `plan.md` | `70c7eec6f62b3dd11379745d2159719ce3dba079b59c18c7bc2fac418265375e` |
| `prototype-journal.json` | `a5993127c09b03fcdb1214bb4a5c2689e62602218e868b6bf8212d945fd9d23a` |
| `stage-envelope.json` | `6719b8acf7754ba148b0be13979d7904ebf18ae0b530f4627eadc2833c7df230` |
| `registry-before-delete.json` | `e6667a174205e5f244b6d7b40d8fc6f771d767178cefa5f59be632797317c925` |
| `cleanup-journal.json` | `6ea09f01e470f32adf4130152685f639ec92e3b92c554789a481566147f93ff0` |
