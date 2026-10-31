# Pixel capacity deadline stop and blank cleanup

## Result

The approved diagnostic invocation on card 09336320 confirmed all 128 synthetic
input slots and 12 output stages containing 72 outputs. Stage
`capacity-outputs-12` returned status `9000`, then the controller's elapsed gate
stopped the run before its response body was validated. The journal records
278 commands and 120,927 ms connected. Payment signing was unreached.

The already approved conditional ACS cleanup matched the same card, proved the
factory keys, removed only the private main/opener/package and verified the
original three-file blank registry. The card is blank with factory manager
keys unchanged. The reader closed without a reported failure, the Pixel lab
process is stopped, and the plan is consumed.

This is full input-loading and partial output-staging evidence. Full packet
capacity, signing/export, retirement, many-small-record capacity and physical
interrupted-write recovery remain open. Production firmware, CCP, its saved
work and the ops-service were unchanged; assisted settlement remains disabled
in released apps.

## Devices and artifacts

| Item | Value |
| --- | --- |
| Local test date | 2026-10-30 (America/Los_Angeles) |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| NFC device | Pixel 8 Pro, Android 17 / API 37, Android IsoDep |
| Reader | ACS ACR122U PICC Interface, identity-only precheck and conditional cleanup |
| Diagnostic source / merge | `93de38ebe27a761aefd529d9e97a71e99c940b68` / `bed6fd0bcae63da1cef799e043490651d6a60fde`, #219 |
| Review and CI | Exact-head review, all 22 checks passed |
| APK SHA-256 | `644be864b571bea886ac9868609b7793257eb7df8624bd2dbbbbf5cb1475b32a` |
| Bundle SHA-256 | `b518f611edad0713167b7cc291d1dd033fbb385e70833894ba68c43fd928960c` |
| App / version | `org.cashucard.capacitylab` / 0.0.2-lab, code 2 |
| Debug signer SHA-256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Unchanged private image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d` |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load SHA-256 / size | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` / 26,934 bytes, 110 blocks |
| Image manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Fixed fixture SHA-256 | `15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e` |
| Private package / ABI | `F04341534855434D5054` / CPROT/2, format 5 |

The generated offline debug APK retains the original image/layout, workload,
15-second native timeout, 120-second further-transmission gate, 512-command
ceiling and 261-byte outbound frame limit. It changes bounded native failure
evidence and preserves the previous stopped journal under its earlier key.
Local validation recorded 185 passing tool tests, eight environment skips and
37 focused cases, including actual Java classifier execution. APK inspection
confirmed its compiled classifier/call site, same signer, bundled journal keys,
disabled developer support and absence of Internet/overlay permissions.

## Upgrade and execution

The named Pixel and installed version-1 APK/signer matched the prior control.
With the lab stopped, its database/sidecars were archived. The earlier capacity
journal matched the retained evidence and the diagnostic key was absent. The
exact approved APK upgraded only this private lab. Its installed hash matched,
and a second archive confirmed the earlier journal value was preserved byte
for byte while the new key remained absent.

One ACS connection sent SELECT ISD and GET DATA CPLC, matched 09336320 and
closed. The fresh diagnostic UI was inspected, then START CAPACITY TEST was
armed once. The operator moved the card to the Pixel. Host UI inspection and
other ADB commands were withheld until the operator reported the terminal stop.
The result was then checked on the lab screen, only its process was stopped,
and its database/sidecars and public diagnostic journal were saved. The earlier
capacity journal still matched byte for byte.

The controller proved identity, object absence, factory-version-1 keys and the
exact blank baseline before private writes. It loaded/created the same image,
validated diagnostics/key, allocated the 16 KiB pool and 12 KiB DLEQ area, and
confirmed all proof slots 0 through 127. It began the fixed synthetic record
and validated output stages 0 through 11. Stage 12 retained reply status `9000`
before the post-transmission elapsed check stopped execution. Its response
count was unvalidated, so the report counts only the preceding 72 outputs.

The failure is `elapsed-bound`; `failedExchange` is absent. This record reports
a host deadline stop without a failed native call. The newly added native
exception classification was therefore unexercised by this physical invocation.
The cause of the previous transport failure remains unassigned; this run does
not establish a causal effect from changing the observation method.

## Measurements

Stage durations use the phone's monotonic clock and include work inside the
timed stage, including host journal work. They are host-observed envelopes.
Connected duration uses session wall-clock stamps. The unfinished stage's
duration cannot be recovered by subtracting successful stages from the session.

| Observation | Result |
| --- | --- |
| Connected duration / commands | 120,927 ms / 278 |
| LOAD stage envelopes, summed | 12,015.782 ms |
| Opener / main creation | 253.701 / 1,338.143 ms |
| Capacity setup | 563.398 ms |
| Confirmed proof slots / summed stages | 128 / 56,756.529 ms |
| First / last proof stage | 252.393 / 636.932 ms |
| Payment BEGIN stage | 3,157.415 ms |
| Confirmed output stages / outputs | 12 / 72 |
| Confirmed output stage envelopes, summed | 31,345.363 ms |
| First / last confirmed output stage | 1,121.778 / 4,512.907 ms |
| All completed stage envelopes, summed | 106,797.540 ms |
| Pre-setup diagnostics | `7fff0a0e0a0014001400000000000005` |
| Post-setup diagnostics | `7fff0a0e0a0014001400400030000205` |
| Persistent availability | 32,767, saturated at the signed-short ceiling |
| Transient reset / deselect availability | 2,574 / 2,560 bytes |
| Maximum / unused commit capacity | 5,120 / 5,120 bytes |
| Post-setup pool / DLEQ allocation | 16,384 / 12,288 bytes |
| Setup state before / after; diagnostic format | 0 / 2; 5 |
| Private public key | `03621f701b381ba36ca68bff07dd9cf5f4ae318da8067cb4868534f5d8e677c3c3` |

## Cleanup and evidence

The saved pre-sign synthetic state met the existing conditional cleanup
admission. After the operator returned the card, one cleanup-only ACS connection
rematched CPLC, required production/other-probe absence, proved one factory
channel and required the original baseline plus only allowed private objects.
It deleted main, opener and package in that order, then verified the three
original load files: `A0000001515350`, `A0000000620204`, `A0000000620202`.
The host independently decoded and matched every final TLV frame. The cleanup
journal retains the final registry, with the pre-delete scan overwritten by it.
Its inherited `two-input-two-output-v1` label is runner metadata; cleanup sent
no workload, installation, setup, signing, retry or key-change commands.

Protected evidence stays under `pixel-capacity-diagnostics-2026-10-30`, including
the approved plan, CI/merge record, exact APK/build checks, both upgrade archives,
old-journal comparison, identity journal, single start intent, terminal UI,
original result database archive, parsed journal, cleanup review/result and
completion record.

| Evidence | SHA-256 |
| --- | --- |
| Approved `plan.md` | `984d9d8da9a0f1d5ad53df12f34829cf6ace98cfe78c4e4c728e0ae50e86bb68` |
| `pixel-journal.json` | `e753d25a54cc894c7fcfe3cfff8271552fddd3271108afcfb117138e8b1befe0` |
| `cleanup-journal.json` | `46e792be576c81b27619a90c8bcae9ecf34e4bf8ce6d1f6195aedafaad3593e9` |

The unchanged full-slot workload did not fit this invocation's time budget.
Examine staging and host persistence costs offline before preparing another
physical plan. Keep the existing limits and consumed journals. The
[small physical payment](HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md)
remains the signing/export evidence; this larger workload still needs a complete
measured path before choosing production limits. ACS installation attempts
remain paused.
