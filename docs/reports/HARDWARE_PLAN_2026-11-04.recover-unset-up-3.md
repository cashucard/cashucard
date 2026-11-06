# Recovery plan for the installed, unset-up card

- Plan ID: `recover-unset-up-v3`.
- Status: **offline implementation qualified; execution unapproved**.
- `approved: false`; `consumed: false`; hardware commands during preparation: **0**.
- Preparation authorized by the operator on 2026-11-04: "yes I authorize
  preparing a fresh, bounded recovery plan for the stopped card."
- Preparation base: `2c954a97b1beedd443149005639d8321d6e06f8c`, including signed
  identity correction `62cd278`. Implementation: signed `45b449a`; independent
  saved-evidence verification: signed `5472ba9`. The final clean documentation
  commit and runtime hashes are bound in the private preparation campaign.

This plan proposes one future ACS connection to remove only the private test
main instance, opener and package and verify the original factory-key platform
baseline. It grants no hardware permission. The earlier plans remain consumed;
the operator has lifted the restriction on **preparing** a successor, without
authorizing its execution. No fourth recovery session has started.

## Card, reader and retained evidence

The historical label is `09336320`. The independently parsed CPLC identifies
serial **`09336120`**, batch `5547`, and
`cplc-v1:4790d3213041093361205547`. The spare's `...093363205547` identity is
not an alternative. Derive identity through cardkit's `parseCplc` only.

- Reader: exactly `ACS ACR122U PICC Interface`, one exclusive connection.
- Expected public installation key:
  `03d0b08a4f96d57301cedc89435b15a809f18cc9a7abe30614e07e464ca8ce0570`.
- The key was observed in the completed November 2 key-read journal; this is
  historical evidence, not a fresh read or a signed-packet attestation.
- No phone build, phone access, card reset, installation or applet setup is in
  scope. The operator must confirm the same card's custody and absence of
  intervening actions before execution is considered.
- Preserve the phone's `cashucard-private-capacity-install-v1` journal and all
  prior evidence. Nothing existing under `~/.cashucard/` may be edited or deleted.

The [preparation audit](HARDWARE_PLAN_2026-11-04.recover-unset-up-3.audit.json)
pins source hashes, public image context, complete saved registry pages,
runtime candidates and the exact previous journal hashes.

## Three November 3 stops

| Attempt | Journal under `~/.cashucard/recover-unset-up-2026-11-03/` | Recorded result                                       | Cause                                                                                                   |
| ------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1       | `attempt-1-chip-trim/recover.json`                        | `match-chip`, `wrong-chip`, 2 commands                | Wrong identity pin; actual captured identity differs from the spare's.                                  |
| 2       | `recover.json`                                            | `match-chip`, `operation-failed`, 1 command, no reply | Bridge concatenation failed when the trim helper returned bytes instead of a list.                      |
| 3       | `attempt-3-cplc-list/recover.json`                        | `match-chip`, `wrong-chip`, 2 commands                | Launcher pin was corrected, but the flow still selected the spare identity from `pixel-optimized.json`. |

The journal SHA-256 values, independently re-read without modification, are:

1. `c47122e4bbc0f22bfa04c063b637223b789ce1b9823259abe381643ab25a0cb2`
2. `a1e4a267e9747f98b597d513632f52e2c6e84b4fb3e8cae34ca9456a01e7ab03`
3. `bf5034001746c1f828e389425a220e1b4a5368166ca15ec5d925c1eadad2321c`

These are three stopped November 3 continuations, not the entire lifetime
history. The November 2 key read and diagnostic stop, and that plan's recorded
out-of-order placeholder-key invocation, remain part of the history. The saved
diagnostic stop reached 9 commands and `7fff0a0e0a0014001400000000000005`.
None of these records establishes current blank state. The existing handoff
records that no deletion frame had been sent.

## Findings that prohibit another generic retry

The identity correction is necessary but insufficient:

1. `compact_recovery_bridge.py` requires initialized diagnostics ending in
   `400030000205`. Its existing regression deliberately stops after unset-up
   diagnostics ending in `000000000005`; subsequent key/status/delete commands
   are refused. Keep that initialized-recovery policy unchanged.
2. `recover-compact.cjs` accepts `diagnostics(d, 0)` for `installed: true` but
   then requests INS `76` and `7C`. The actual private dispatcher rejects both
   while setup state is zero. An offline JavaCard run reproduced `6985` for
   both commands; the injected fake's successful status response is not evidence
   that a real unset-up applet supports them.
3. The saved November 2 full registry includes **the private package load-file
   record**, in addition to the main/opener application records and all three
   original platform files. The applications-only assumption in the current
   flow is contradicted by that retained evidence.
4. The generic flow fetches both registry kinds but verifies only applications.
   That can accept an empty application list while a package remains loaded.
   Its installed deletion list also omits the package. Two instance deletions
   and an applications-only scan cannot prove factory blank.
5. The installed image context is `pixel-install.json`'s streamed image; the
   generic launcher's default optimized-image label is not its provenance.

Do not run `recover-installed.cjs --recover` for this plan. Its launcher still
names the consumed `recover-installed-v1` and cannot provide this plan's closed
unset-up cleanup contract. No readiness/status response may be synthesized,
SETUP sent to make recovery work, or prior journal edited to create admission.

## Qualified offline implementation

The separate host `tools/outbox-spike/recover-unset-up.cjs`, independent
`unset_up_policy.py`, isolated transport and `unset_up_verify.py` now implement
these gates (D166). The tests and their limits are in the
[qualification report](RECOVERY_QUALIFICATION_2026-11-04.unset-up.md). They:

- Bind this plan ID, corrected chip, observed public key, exact saved registry,
  installed-image context, source/runtime hashes and a fresh single-use journal
  before reader enumeration. Preview must import no PC/SC or open a device.
- Reuse the unchanged `diagnostics(d, 0)` validator, requiring pool and DLEQ
  zero, format 5, setup state zero and at least 128 bytes in both commit counters.
  State 1, initialized state 2, partial allocation and malformed replies stop.
- Validate both full registry kinds against exact expected objects and complete
  platform TLVs. Preserve `verifyRegistry`, `entryAllowed`, `BASELINE`,
  `diagnostics` and `compact_bridge.PRIVATE`; no allowlist widening or filtering
  away load-file evidence is permitted.
- Forbid INS `76`, `7C`, export, signing, retirement, SETUP, proof loading,
  installation, key rotation and every production namespace.
- Keep the initialized recovery bridge's unset-up refusal test passing. Test
  the new policy together with real SCP02 fake-card exchanges and the actual
  unset-up JavaCard command behavior. A fake must not invent initialized status.
- Prove wrong chip/key/registry, omitted or additional package, state 1/2,
  journal failure, timeout, altered image/runtime, consumed plan, authentication
  failure, duplicate deletion and uncertain close all stop without a next write.
- Demonstrate complete deletion order, full two-kind blank verification and
  unchanged old-journal hashes. Every new behavior needs a failing-before test.

The final affected suite passed 205 outbox cases, including the actual unset-up
JavaCard reply test; cardkit passed 129 cases and Python policies passed 43.
Fault checks cover every one of the typical 24 command positions. The isolated
process tests use a synthetic PC/SC package. They do not establish physical card
state, native reader behavior or physical timing. Protected source and all five
historical journal hashes remain unchanged.

The launcher pins actual Node/Python binaries, its source and policies, SDK
output, crypto packages, pyscard files, profile, final plan and tracked approval:
611 runtime files in this environment. Preview performs local reads only. The
private preparation campaign and receipt bind the final clean signed HEAD and
exact runtime digest after this plan is committed. That campaign remains
unapproved and cannot be executed.

## Proposed single-connection sequence

Use factory manager-key version 1 and the public `40`–`4F` set only. Prove the
card cryptogram before each EXTERNAL AUTHENTICATE; never try alternate keys or
repeat a failed authentication. Authentication bodies, challenges and MACs must
not enter journals or shell history.

| Stage                              | Permitted commands                                                                                  | Maximum APDUs |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------: |
| Match identity                     | SELECT ISD, GET DATA CPLC; exact parsed chip required                                               |             2 |
| Establish first factory channel    | SELECT ISD, INITIALIZE UPDATE, EXTERNAL AUTHENTICATE                                                |             3 |
| Verify original installed registry | Authenticated applications and load-files; at most 4 pages each                                     |             8 |
| Verify unset-up installation       | SELECT full private main AID, INS `7D`, INS `7A`; exact version/state/key                           |             3 |
| Reconfirm chip                     | SELECT ISD, GET DATA CPLC                                                                           |             2 |
| Establish cleanup channel          | One fresh factory channel after all preceding evidence is durably verified                          |             3 |
| Reconfirm installed registry       | Full applications and load-files again, same exact set                                              |             8 |
| Remove private objects             | Main `F04341534855434D505401`, opener `F04341534855434D50544D`, then package `F04341534855434D5054` |             3 |
| Prove blank                        | Full authenticated applications and load-files, not a filtered application scan                     |             8 |
| Final identity and close           | SELECT ISD, GET DATA CPLC, close the exclusive connection                                           |             2 |
| **Total**                          | **No additional command classes or automatic fallback**                                             |        **42** |

The initial and pre-delete snapshots must contain exactly these applications:
main `...505401` and opener `...50544D`, lifecycle 7, zero privileges, loaded
from `F04341534855434D5054` under ISD `A000000151000000`. Load-files must contain
the exact three platform frames in the audit plus the saved private package
frame, lifecycle 1 under the same ISD. Registry ordering/page boundaries may
vary; duplicate, missing, extra or changed records stop.

Each successful DELETE may return an empty body or the GP acknowledgement byte
`00`; any other body stops. The successful status must still be `9000`.

Final applications must be empty, and final load-files must be exactly the
original three platform frames, byte-for-byte. All three private objects must
be absent. An isolated Python decoder re-reads the newly saved journal by hash and verifies
all three complete snapshots, diagnostics, public key and final identity receipts.
Its result and the live independent bridge policy must agree. Set
`blankBaselineVerified` only after those checks, final chip match and confirmed
reader closure; do not use success from two DELETE replies as a substitute.

## Bounds, stop behavior and evidence

- One exclusive connection, no discovery/preflight tap outside this connection,
  no reconnect and no automatic retry. Reader unavailable consumes the one
  invocation and is reported; a new attempt needs a new operator decision.
- Hard ceiling **64 APDUs**, with at most 42 planned; the unused allowance grants
  no additional command type. At most two distinct successful authentication
  phases, three DELETE commands and three registry snapshots.
- Keep the **120-second** gate on further transmissions and **30-second**
  response bound, shortened by the remaining overall budget. Do not increase
  the limits, reset the card or continue after a late/uncertain reply. Report
  uncertain closure separately; a host timeout is not proof of card rollback.
- Before any reader startup, permanently create the new `.consumed` marker and
  acquire the exclusive journal lease. Revalidate all static admission pins after
  consumption and immediately before lazy reader opening. Existing marker,
  journal, request or lock refuses the invocation, including after a clean stop.
- Require intent fsync before transmission and received public evidence fsync
  before continuation. A failed save stops the invocation. Preserve startup,
  command and closure outcomes without raw native exceptions or secret bodies.
- Proposed fresh journal:
  `~/.cashucard/recover-unset-up-2026-11-04/attempt-4/recover.json`.
  Create new operator-owned directories `0700` and file `0600` only after final
  execution approval. Do not reuse, truncate, edit or remove existing evidence
  or a consumed/stale lease to make another invocation possible.
- Any unexpected state or uncertain mutation stops and preserves the card and
  journal. No conditional second connection, package sweep, new install,
  fifth attempt or plan rewrite is pre-authorized.

## Launch form and approval gate

Working tree: `/Users/dread/Repos/cashu-card-recovery-v3`, local branch
`feat/unset-up-recovery`. Fixed Node:
`/opt/homebrew/opt/node@22/bin/node` (22.23.4). Fixed reviewed Python:
`/Users/dread/Repos/cashu-card-recovery-v3/tools/cardctl/.venv/bin/python`
(3.15.0; its resolved executable and pyscard files are hashed).

Preparation records will be new private files under
`~/.cashucard/recover-unset-up-v3-preparation-2026-11-04/qualification-1/`:
`campaign.json`, `runtime.json` and `preview.json`. No execution directory or
consumption marker is created during preparation. The receipt records the exact
absolute argv and campaign digest. Default invocation omits `--execute` and must
return `mode: preview`, `approved: false`, `cardAccessed: false`. An explicit
execution request with that same unapproved campaign must fail before startup.

The execution argv is the same fixed Node and runner with
`--campaign <absolute-new-private-campaign-path> --sha256 <that-file-sha256>
--execute`. Python, chip, key, reader, approval, source, runtime and the exact
journal are validated from the pinned campaign/profile; there is no alternate
journal, key, reader, retry or cleanup switch. The process transport launches
Python with `-I -S -B -u`, then the exact bridge/request/hash/package-directory
arguments. No printf pipeline, shell substitution or secret argument is needed.

**Execution remains unapproved.** Before a future invocation, the operator must:

1. Confirm custody of the same parsed `09336120` card, no intervening changes,
   and its availability in the named ACS reader.
2. Explicitly authorize the single bounded connection and three-object cleanup
   in this exact plan. The present authorization covers preparation only.

After that decision, record approval and this plan's SHA-256 in the tracked
approval JSON and sign the metadata-only commit. Preserve this unapproved
campaign. Create a fresh private approved campaign binding the resulting clean
HEAD and rehashed runtime, then preview it before the single execution. Any
implementation, bounds, evidence or device-state change requires a new decision.
No automatic successor attempt, installation or phone operation is authorized.

Preparation used saved files, simulators and synthetic transports only: no device
was enumerated or opened, no physical APDU was sent and no production system was
accessed. The five historical journals remain intact.
