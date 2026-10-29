# J3R180 full-slot attempt stopped during applet creation

## Result

The operator approved the fixed 128-input/128-output capacity plan and confirmed
blank card 09336320 ready on the ACS ACR122U PICC Interface. The run matched CPLC,
proved the factory keys, verified the original three-file baseline, completed
all 110 LOAD blocks and created the private opener. Main-instance creation then
stopped with `reader-transmit-failed`, PC/SC `80100016`, without a card status
word. Setup, fixture loading, signing and export were unreached. This invocation
provides no full-slot capacity or latency measurement.

A separately reviewed cleanup-only continuation restored the exact original
three-file blank baseline. The reader closed after both invocations. The card
ended blank with manager keys still at factory version 1. No installation retry
followed the failure.

## Device, authority and artifact

| Item | Value |
| --- | --- |
| Run date | 2026-10-29 |
| Host / reader | Operator Mac / ACS ACR122U PICC Interface over USB/PCSC |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| Workload | `128-input-128-output-v1`, selected but unreached |
| Runtime source | `8578f6ade5d91231434c3da212f59ae084ace18a`, #211 |
| Runtime merge | `c1bd8432a4194a30e377dcaa6222d70172c64e0a`, reviewed and all 22 CI checks passed |
| Runtime fingerprint | `6974cef485fbced3c65c677301ddc1354afea6a037cd5d0e45024408a8794f98` |
| Image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d`, #206 |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load SHA-256 / bytes | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` / 26,934 |
| Manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Private package | `F04341534855434D5054`, opener `...4D`, applet `...01` |
| Selector / format / setup | CPROT/2 / 5 / `7E` |
| Host tools | Node 22; Homebrew Python 3.10/pyscard; public cardkit 0.2.0 API |

The approved plan is `compact-09336320-capacity-2026-10-28`; preparation occurred
the previous day. It retained single attempts, 30-second response deadlines,
a 120-second gate on further transmissions and a 512-command ceiling. Its
physical scope excluded production services, real funds, owner/PIN operations,
key changes and power cuts. The declared-refusal cleanup branch was unused;
transport uncertainty stopped the original invocation with retained evidence.

## Observations and cleanup

| Observation | Result |
| --- | --- |
| Initial identity / baseline | Exact 09336320 and original three platform files |
| Factory proof | Published factory set, version 1 |
| LOAD blocks | 110 completed, aggregate 16,308.523 ms |
| Opener creation | 237.184 ms |
| Main-instance creation | Unconfirmed; reader transmit failure `80100016` |
| Setup / fixture loads / signatures / export pages | Unreached / 0 / 0 / 0 |

The cleanup plan reviewed the stopped journal before opening a fresh connection.
It rematched CPLC, required production/previous probe absence, proved one factory
channel and required the original baseline plus only permitted private objects.
An existing host stage observer saved the public registry immediately before
the first DELETE; this filesystem observation added no APDU.

That registry listed the private opener as the only application instance and
the private package alongside the three baseline load files. It did not list
the private main applet. Cleanup ran the private main/opener/package delete
sequence, then verified exactly `A0000001515350`, `A0000000620204` and
`A0000000620202`. Its journal ended `cleaned` with `blankBaselineVerified: true`;
reader closure succeeded and journal locks were released. It performed no
LOAD, INSTALL, SETUP, fixture operation, key change or power cut.

## Interpretation and next diagnostic gate

The same card and CAP previously completed the
[small physical payment](HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md).
Card 07297620 also produced the
[same code during creation](HARDWARE_TEST_REPORT_2026-10-28.d321-07297620-compact.md).
This new observation prevents treating that earlier failure as isolated to
07297620. It does not identify a firmware, memory, power or reader cause.
The large fixture had not been sent when creation failed.

The [PC/SC API](https://pcsclite.apdu.fr/api/group__API.html) identifies
`SCARD_E_NOT_TRANSACTED` as an unsuccessful APDU exchange. Its presence supplies
neither a JavaCard exception nor an allocation diagnosis. Baseline verification
establishes object removal; the run supplied no post-cleanup memory snapshot.

After cleanup, installation attempts remained paused while the operator approved
the read-only cold-reset comparison below. Full-slot, many-small-record and
actual interrupted-write gates remain open. Assisted settlement remains disabled
in released apps.

## Evidence retention

Protected evidence remains under
`assisted-compact-09336320-capacity-2026-10-28`: the approved plan, approval and
exact-head CI record, stopped journal, cleanup plan/review/observer, pre-delete
registry snapshot, cleaned journal and result files. The earlier prepared date
in that directory identifies the plan, while the execution record gives the
actual run timestamp.

| Evidence | SHA-256 |
| --- | --- |
| `plan.md` | `75c4c89d79249f6dd6c1780db6ea8d94101186bac7e9924e73767d18aed51f9f` |
| `prototype-journal.json` | `12fffb7c4ff42c60f12e0f9af2ca51dc58ab7090a1e650a45e9928d6a8fcd107` |
| `registry-before-delete.json` | `8ef22f734962c48fb684ac422423e2459a36e519680fd781408151f86cfbd7ac` |
| `cleanup-journal.json` | `41aa344d057a687c21466cbe6ef7910936e1dd37f17d3b98e2a46d840b536e8b` |


## Read-only cold-reset comparison

The operator approved a separate plan and confirmed the blank card had stayed
on the reader since cleanup. The first connection sent SELECT ISD, GET CPLC and
GET DATA FF21 once each, matched 09336320, recorded the public memory values and
closed. The operator then confirmed lifting the card away for five seconds and
returning it. A second connection sent the same three reads, matched the same
CPLC, recorded memory and closed. There was no authentication, applet selection,
write, reader configuration change or installation in this diagnostic.

| Public counter | Before lift | After lift | Change |
| --- | ---: | ---: | ---: |
| FF21 tag 81 | 1 | 1 | 0 |
| Persistent availability, bytes | 164,176 | 164,176 | 0 |
| Volatile availability, bytes | 3,990 | 3,990 | 0 |

Both replies returned `9000`. These values match an earlier blank-card snapshot
in the [allocation report](HARDWARE_TEST_REPORT_2026-10-28.j3r180-allocation-comparison.md).
The comparison shows no additional reported memory reclaimed by this power
cycle. Aggregate availability does not measure maximum contiguous allocation or
identify the cause of the failed constructor/APDU exchange.

The retained sequence motivates one controlled cold-start comparison: the small
run passed after the operator swapped 09336320 onto the reader; the later
creation failure followed its cleanup while the card remained powered. The
07297620 failures also followed deletion of an existing installation or failed
private image. A reset-sensitive card/reader state is a hypothesis consistent
with that sequence. The current evidence cannot distinguish it from intermittent
transport, power or other runtime conditions. This read-only plan performed no
installation and does not authorize a retry.

Protected comparison evidence is retained under
`assisted-compact-09336320-memory-2026-10-29`, including the approved plan,
helper/runtime pins, operator lift confirmation, both results and comparison.
The helper's direct execution is preview-only. Four offline fake-transport cases
covered exact reads, identity mismatch before memory, fixed transport evidence,
and unavailable/malformed data with reader closure.

| Comparison evidence | SHA-256 |
| --- | --- |
| `plan.md` | `8ef3f73f59479ced130b3ea1a339e93505d441851aa04aff85b14358c71b581a` |
| `before.json` | `7f879543e1cc61ffc211b9887a89e2f872632acd9970d8d792a3229928ae6162` |
| `after.json` | `0cea702568e4251d853ee01a57846719e62e50e270cbe161d708df2ecfe279e1` |
| `comparison.json` | `747d1319c7014e9280b9bd20e6e498ae3d738a599ccf38cc94f727e37d2a827f` |
