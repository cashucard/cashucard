# Assisted-settlement resource preflight: J3R180 09336320

Status: physical identity and empty-state check completed at `2026-10-27T16:41:05.278958+00:00`.
The operator approved one read-only connection on the named USB reader before
this run, after confirming this card was empty and available for the later
resource test.

## Environment and identities

- Host: macOS 26.5.
- Reader: **ACS ACR122U PICC Interface**.
- Card: **cplc-v1:4790d3213041093363205547**, serial **09336320**, previously tracked as a J3R180.
- Current applet installation public key: `03e27c70ddd8a4a0d88f41a65f52b543c7ad231373fc452593e46eb5a5996cd530`.
- Reference released CAP: `applet/target/cashu-javacard-2.1.0.cap`, SHA-256
  `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`. This identifies the repository artifact; installed CAP bytes were
  outside this inspection.

## Measured public state

The reviewed `tools/cardctl/read_only_preflight.py` used one connection and
exactly SELECT ISD, GET CPLC, SELECT full Cashu applet AID, GET_INFO, GET_PUBKEY
and SELECT tag. The CPLC matched before any applet query.

| Observation | Result |
| --- | --- |
| SELECT / GET_INFO version | 2.1 |
| Proof slots | 0 unspent, 0 retained spent, 128 empty |
| Owner | Unset |
| PIN | None |
| Card configuration | Unset |
| Locked | No |
| NFC tag applet | Present |

The connection performed public reads only. Authentication, manager-key
provenance, mint/service reconciliation, resource-probe installation and memory
measurements remain separate gates. No PIN, owner key, proof secret or manager
key was collected.

## Next gate

The resource probe requires an ordinary CCP reset first, preserving its service
history and returning the manager to the documented factory state. The approved
probe runner must then match this chip, prove the known factory keys, install the
pinned private test package, measure once and verify its removal. A fresh CCP
installation restores a service-recorded released applet afterward. Each write
stage requires the operator's separate device/action-specific approval.

## Approved resource invocation: stopped before installation

After the operator reported CCP's reset complete and returned the same isolated
card to the ACS reader, the approved pinned runner executed once. The source
runner is the implementation merged in #190 (`f7db9ab`); the private probe CAP
SHA-256 is `c9947a692ccd97f65a6343ab5b0bb0e321a34c0eabe9f8b2ed99ec17a0c2aedd`,
manifest SHA-256 `417ca3b71f17dfca0935b4b8b68d3b46da1cc3f075065d8778bccccb67f65222`.

The journal records `status: stopped`, `stage: require-empty-registry`.
Reaching that gate establishes that CPLC matched, the known production/probe
SELECTs returned absent, and the factory-version-1 SCP02 channel authenticated.
The original journal contains no registry reply details, so it cannot distinguish
a status refusal, parser refusal or unexpected object. No INSTALL, LOAD, DELETE,
dummy publication or key rotation was reached. The connection closed; there was
no retry or automatic cleanup.

No memory or transaction measurement was obtained. Preserve the original private
journal. A registry-only diagnostic requires separate approval; the blank-registry
gate remains enforced and any unknown objects must be retained.

## Separately approved registry-only diagnostic

The registry-only runner at `0bb410d` executed once against the same CPLC using
one verified factory-version-1 channel. It completed inspection and closed the
connection. No probe installation, deletion, dummy command, key change, fallback
or retry occurred.

Applications returned `6A88` with no data. Load files returned `9000`, with these
three entries under domain `A000000151000000`, lifecycle `01`:

| AID | Version | Identified package |
| --- | --- | --- |
| `A0000001515350` | 255.255 | SSD creation package |
| `A0000000620204` | 1.0 | `javacardx.biometry1toN` |
| `A0000000620202` | 1.3 | `javacardx.biometry` |

Their complete public load-file TLVs match the owner's existing
`tools/cardkit/gp/test/fixtures/gp-install-opener.txt` GET STATUS response.
[GlobalPlatformPro's documentation](https://github.com/martinpaljak/GlobalPlatformPro#readme)
also identifies these packages. The original gate failed because its empty
registry assumption excluded these pre-existing platform load files. The
diagnostic obtained no resource measurements.

D140 pins their full entries for the explicitly selected 09336320 profile.
The corrected drill must preserve all three, install/remove only the private
probe, and stop on any baseline difference. The diagnostic approval does not
authorize that write invocation; its revised plan is a separate gate.

## Approved platform-profile drill: stopped at applet creation

The operator separately approved the corrected platform-profile drill. Runner
source `dc65b71` used the original pinned CAP and manifest. It matched CPLC and
the exact platform baseline, loaded the private package and confirmed opener
creation. The invocation then stopped at `install-01`, `operation-failed`.

The original host did not retain the status word for this non-registry failure.
It therefore cannot distinguish a card refusal from another command-path
failure or establish whether the final applet instance exists. No SELECT of the
probe, memory read, dummy transaction or cleanup was reached. The connection
closed without retry. Do not infer a 16 KiB capacity limit from this result.

Retain this stopped journal with the earlier journals. The package and opener
were confirmed created, so the card needs the separately approved cleanup-only
plan before a normal CCP installation. D141 restricts that cleanup to the
private probe AIDs while preserving the three exact platform entries. The
underlying applet-creation failure remains an open resource-prototype gate.


## Separately approved cleanup: complete

The operator approved cleanup only. Runner source `3f96ea0` executed once with
`--cleanup-only --platform-baseline` against the same CPLC and ACS reader. It
matched identity, required production objects absent, opened one verified
factory-version-1 channel, validated the platform baseline, and deleted only
the private probe applet, opener and package (an absent object was acceptable).
The protected journal finished `status: cleaned`,
`stage: factory-blank-ready-for-ccp`. The reader connection closed.

Final applications: `6A88`, no data. Final load files: `9000`, exactly the same
three complete platform entries recorded above. No private probe objects remain.
The cleanup performed no LOAD, INSTALL, memory measurement, dummy transaction,
key change or retry. The card has no Cashu applet and is ready for an ordinary
service-recorded CCP installation.

All earlier journals remain unchanged. The cleanup establishes removal and
platform preservation, not resource feasibility. The applet-creation failure
remains unresolved; a revised diagnostic artifact and its named action plan
require review before any future physical probe.


## Approved format-2 control and pool comparison

The operator approved the pinned two-stage plan in #195, conditional on valid
control measurements and verified cleanup before entering the pool stage.
Both artifacts were generated from source `6d7abf0f3064cb015755bae5106cf5c5fed552d4`.
The same named CPLC and ACS reader were used. No production service was accessed.

- Control journal last persisted: `2026-10-28T01:22:34.029661+00:00`. CAP SHA-256 `57f841ed96839035cd012f6975d2f34ab86bac69dbea458889819c6b2ffacef6`; manifest SHA-256 `a1b539e559a6fb94ad9bbf63a5b31e20f14d8f89ac1bb76b42644dcf0839ba52`.
- Pool journal last persisted: `2026-10-28T01:23:17.844400+00:00`. CAP SHA-256 `ee10e0ef67d1e16eb9e406d006816fedea078eaa044ea3b803a47dffdbce158d`; manifest SHA-256 `9ebf50e0e1e44ad508042d99ad9401daac4764b4fa28f04a1227d274a7382c13`.

### Constructor control

The original constructor installed and selected successfully. The post-install
query returned format 2, zero pool bytes, publication marker zero, and:

| Reported quantity | Bytes |
| --- | --- |
| Persistent availability counter | 32767, saturated |
| Transient-reset availability counter | 2574 |
| Transient-deselect availability counter | 2560 |
| Maximum commit capacity | 5120 |
| Unused commit capacity | 5120 |

These availability counters are upper-bound reports capped at 32767. The
persistent value supplies no exact free-space or contiguous-allocation figure.
The control performs no dummy publication. Its final status was `complete`,
stage `factory-blank-ready-for-ccp`; all three platform entries were preserved.
The connection closed. The host checked this exact pinned control journal,
valid measurement structure and final registry before entering stage two.

### 16 KiB pool

The second invocation matched CPLC and the same platform baseline, loaded its
pinned package and created its opener. The probe applet's creation returned
`6F00`. The host retained `stage: install-01`, `failure: card-status-6f00`, and
stopped. No SELECT of the pool probe, resource query, dummy publication, retry
or automatic cleanup followed; the connection closed.

The control succeeded while the added-allocation profile failed. This narrows
the remaining investigation to that profile's added allocation path. The
generic status does not distinguish exhaustion, fragmentation or another
implementation constraint. The 16 KiB reservation and 128-byte publication
remain unproven. Both protected journals remain retained.

The private package and opener require the separately approved cleanup-only
action; the final applet instance is unconfirmed. Further allocation comparisons
require new pinned artifacts and a reviewed hardware plan.


### Separately approved format-2 cleanup

The operator approved cleanup only after the pool creation refusal. The runner
executed that mode once with the pinned pool manifest. It matched the same CPLC,
verified one factory channel and the exact platform baseline, deleted only the
private probe objects, then verified the three original platform entries. The
journal finished `cleaned`, `factory-blank-ready-for-ccp`; the connection closed.
No additional installation, allocation test, measurement, dummy publication,
key change or retry ran. All prior journals remain retained. The card is blank
and ready for a service-recorded CCP installation.
