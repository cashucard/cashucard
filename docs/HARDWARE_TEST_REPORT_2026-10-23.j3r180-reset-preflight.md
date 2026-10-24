<a id="read-only-reset-preflight--j3r180-2026-10-23"></a>

# Read-only reset preflight: J3R180, 2026-10-23

## Scope and environment

The operator placed each of the three owner-held cards on an ACS ACR122U
PICC Interface USB reader connected to the Mac. The operator approved an
identity-only CPLC read on the initially unidentified card and subsequent
swaps. After CPLC identified card `09336320`, the operator separately approved
one read-only applet inspection. Python 3.10 with pyscard 2.3.1 drove PC/SC;
`tools/cardctl/read_only_preflight.py` performed the full inspection. Its five
reader-free tests passed before the hardware run.

The tracked 2.1 CAP in this checkout is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`
(SHA-256). This run read the installed applet version; it did not prove that
the installed load file has those exact bytes.

## Commands and observations

For each identification, exactly `SELECT ISD` and `GET DATA 9F7F` were sent
once. The observed CPLC IDs, in order, were:

| Serial | CPLC identity | Further APDUs |
| --- | --- | --- |
| `07297620` | `cplc-v1:4790d3213180072976207515` | None |
| `09336120` | `cplc-v1:4790d3213041093361205547` | None |
| `09336320` | `cplc-v1:4790d3213041093363205547` | See below |

For `09336320`, the separate approved preflight rechecked CPLC, then sent
`SELECT` full Cashu applet AID, `GET_INFO`, `GET_PUBKEY`, and `SELECT` NFC tag
AID once each. The applet selected as version 2.1 and reported:

| Field | Observed |
| --- | --- |
| Installation public key | `036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490` |
| Unspent / spent / empty slots | `0 / 0 / 128` |
| Owner / PIN / record | absent / none / absent |
| Locked / tag present | no / yes |

The installation ID matches the recorded attempt
`ac3575ad-6be4-4595-b213-97f89afabda6` in the retained local
`eng-741-2026-10-20` ops database. A metadata-only, read-only query found that
attempt in `recorded` state with an escrow row present. The query did not read
or print key bytes. It did not inspect production or staging service state.

## Boundaries

No GlobalPlatform authentication, DELETE, LOAD, PUT KEY, owner command, write
or retry was attempted. Zero occupied proof slots describe this
card's current applet state. Mint reconciliation and the active manager keys
require separate evidence. Before an owned-card reset, the service must
reconcile any later attempt on this chip across origins, verify exact escrow
provenance, persist a card-specific intent and handle interruption. No reset
was authorized or performed in this run.
