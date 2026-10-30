# D321 07297620 inspection and operator-authorized blanking

## Scope and result

The operator selected a different card on the ACS ACR122U PICC Interface and
instructed inspection, blanking and continuation with that card. Read-only
inspection identified `cplc-v1:4790d3213180072976207515`, serial 07297620,
and an installed protocol-2.0 applet. The operator subsequently accepted
discarding its 32 test sats and eight retained spent entries, confirming no
outside obligations. The operation removed only the Cashu objects. The final
registry preserved all four pre-existing baseline load files. A bounded
read-only connection rechecked CPLC and confirmed all four Cashu AIDs absent.
The reader closed and the card ended blank.

This was explicit test-card disposal. It establishes neither settlement nor a
value-preserving production reset. Production services and the mint were not
contacted, and their records were unchanged.

## Evidence and public state

Host: operator Mac. Reader: ACS ACR122U PICC Interface over USB/PCSC. Native
transport: existing Homebrew Python 3.10 venv and pyscard. Source checkout:
`c23c492eafba998fad14f5ef5a82d6686b67d98d`, merged by #206. The protocol-2.0
read contract was checked against tag `v2.0.0`, commit
`bced1c41726ef23e733cb228fd46f6fba568467d`.

| Observation before erasure | Result |
| --- | --- |
| SELECT / GET_INFO version | 2.0 |
| Slot counts | 1 unspent, 8 retained spent, 119 empty |
| Aggregate balance and unit | 32 sat |
| Owner / PIN / configuration | present / set / set |
| Locked / tag present | no / yes |
| Installation ID | `028ce600ea74f0690113055c5344e02149c20549afcf872beb839846213dc47768` |
| Factory manager keys | cryptogram proved the published factory set; version 1 |

Inspection used SELECT ISD, GET CPLC, full applet SELECT, GET_INFO, GET_PUBKEY,
tag SELECT, aggregate GET_BALANCE and public GET_CARD. It read no proof secrets,
PIN, owner private key or manager-key bytes. No write followed until explicit
loss acceptance. Fresh state/key/balance/configuration checks bound the disposal
to the accepted installation. Factory proof preceded EXTERNAL AUTHENTICATE.
Each authenticated invocation proved the same factory set once; there was no
alternate key candidate or automatic retry.

Private evidence is retained under `assisted-compact-abi2-2026-10-28` in the
operator's protected evidence directory. `alternate-card-inspection` contains
the conditional version check, 2.0 public-state and aggregate balance results.
`alternate-card-blank` contains explicit loss consent, pinned plans/scripts,
offline tests and the complete erase/verification journals. Authentication
payloads and raw native exceptions are excluded from those journals.

## Registry discovery and erase

The first discard invocation matched the bound state and proved factory keys,
then stopped before deletion because the original three-entry profile did not
admit the extra pre-existing load file. Its complete observed TLV was pinned
for the reviewed continuation:

```text
e3214f0da00000016443446f634c6974659f700101ce020100cc08a000000151000000
```

The continuation rechecked state and factory proof, required the four captured
baseline entries plus only Cashu objects, then deleted tag, card applet, opener
and package in that order. The final authenticated GET STATUS returned no
application instances and exactly these load files under the ISD:

| AID | Version |
| --- | --- |
| `A0000001515350` | 255.255 |
| `A00000016443446F634C697465` | 1.0 |
| `A0000000620204` | 1.0 |
| `A0000000620202` | 1.3 |

An additional opener SELECT verification was blocked by the reset transport's
read allowlist after deletion. The journal stopped at that verification stage.
Offline policy review identified that command boundary; there was no repeated
DELETE. A separate reviewed read-only transport admitted the six final reads:
SELECT ISD, GET CPLC, then SELECT tag, card, opener and package. It matched the
same CPLC and obtained empty `6A82` for every Cashu AID. That connection closed.

The blanking phase performed no manager-key change, package LOAD/INSTALL,
owner/PIN operation, proof export or mint request. Public factory keys remain
at version 1. The accepted test value and installation key were discarded.

## Qualification boundary

The card's distinct baseline is recorded in D153. Its profile is selected by
exact CPLC and compared byte for byte. 09336320 retains its separate three-file
profile. This report establishes blank readiness and manager-key provenance;
the compact prototype has not yet been installed or run on 07297620.
