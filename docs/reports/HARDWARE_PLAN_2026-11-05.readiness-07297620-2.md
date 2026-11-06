# Post-reset readiness check for 07297620

- Plan ID: `readiness-07297620-v2`; `approved: true`; initially unconsumed.
- Authorization: the operator previously selected 07297620 and said "ok execute"
  for the replacement plan. After the factory-proof stop, the operator reported:
  **"ok i reset the card, and put it back on the reader."** This authorizes a
  fresh bounded readiness check after that external state change. It does not
  authorize a key guess, unplanned write or reuse of the consumed invocation.
- Device: exactly `cplc-v1:4790d3213180072976207515`, serial `07297620`, batch
  `7515`, on exactly `ACS ACR122U PICC Interface`.

## Prior stop and new premise

The first readiness invocation is consumed. It matched this CPLC, selected the
ISD again and received `9000` to INITIALIZE UPDATE at version 1. The factory
cryptogram did not verify. It stopped after four commands, before EXTERNAL
AUTHENTICATE or registry access, and confirmed reader closure. Its journal hash
remains `9cbef5cac558c2ce871bfdcc38d76ea33f5b3f6b8af5fb6f002f414b5285b4b1`.
No alternate key or automatic retry followed.

The operator now reports a reset. Its method, resulting manager keys, applet
state and ops reconciliation were not observed by this agent. None is assumed.
This fresh invocation verifies the expected state rather than bypassing the
failed proof. The [new audit](HARDWARE_PLAN_2026-11-05.readiness-07297620-2.audit.json)
pins the historical evidence plus the first readiness stop and result receipt.
Keep all prior plans, journals, markers and original card profiles intact.

## Exact single-connection scope

Use the same nine-command nominal sequence and hard 15-APDU ceiling:

| Stage               | Commands                                                                                               | Maximum APDUs |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------: |
| Initial identity    | SELECT ISD, GET DATA CPLC; exact match                                                                 |             2 |
| One factory channel | SELECT ISD, INITIALIZE UPDATE at version 1, verify factory cryptogram, only then EXTERNAL AUTHENTICATE |             3 |
| Complete registry   | Authenticated applications and load-files; at most four pages each                                     |             8 |
| Final identity      | SELECT ISD, GET DATA CPLC; exact match, then close                                                     |             2 |
| Total               | Nominal 9, hard ceiling 15                                                                             |            15 |

Factory public `40`–`4F` set only, no alternate key set. No private applet command,
DELETE, LOAD, INSTALL, key rotation, SETUP, signing or funding. Do not read secret
key material. No production request or ops change belongs to this check.

One exclusive connection with leave-card disposition; no reset, reconnect or
retry. Keep the 120-second transmission gate, 30-second response bound shortened
by remaining budget, and existing stop behavior. A refused status, failed proof,
incomplete/changed registry, persistence failure or uncertain transport stops.
Another failure grants no successor attempt or plan rewrite automatically.

Success requires empty applications and the exact four baseline load-file E3
frames, including CardDocLite. Order/page boundaries may vary; no fields, objects
or baseline entries may. The unchanged full-registry validator remains in use.
Final CPLC, independent decoding of the synced journal, live independent policy
completion and confirmed closure are all required before readiness is recorded.
Identity or the operator's reset report alone cannot establish blank state.

## New admission, source and evidence

The successor has its own fixed profile, launcher and Python entry point:
`readiness-07297620-v2.json`, `readiness-07297620-v2.cjs` and
`readiness_07297620_v2.py`. The shared controller and transport admit only the
explicit v1/v2 labels. Card identity, four-file baseline, APDU predicates and
bounds remain fixed. The v2 Python entry validates equality with the original
card/baseline profile before activating its new label and journal path. The old
launcher still targets its consumed journal and cannot become this invocation.

Offline qualification passed 216 outbox cases (no skips), 50 Python policy
cases, and formatting/whitespace checks. The new successor tests first failed
before implementation; `/private/tmp/readiness-07297620-v2-red.log` retains that
result. Full logs: `/private/tmp/readiness-07297620-v2-full.log` and
`/private/tmp/readiness-07297620-v2-python.log`. The v2 isolated process completes
the exact sequence, closes and verifies saved evidence using synthetic PC/SC
only. No physical state is established by those tests.

Before access, sign the source and require a clean worktree. Pin this plan, new audit, both profile/entry files,
shared controller/policy/transport, actual Node/Python binaries, SDK, crypto and
pyscard in a fresh private campaign. Recheck the complete admission after durable
consumption and before lazy open. Native admission checks its pinned files and
consumed marker before PC/SC import/enumeration.

Use only a new journal:
`~/.cashucard/readiness-07297620-2026-11-05/pass-2/readiness.json`, mode `0600` in
new private `0700` directories, with new `.consumed` and `.request.json` files.
Never truncate, edit, remove or reuse prior evidence. Persist intent before every
transmit and public reply before continuing. Exclude authentication response
bodies, challenges/MACs and raw native exceptions. Retain a lease on uncertain
closure. Permanent consumption prevents another invocation even after clean
closure or a failed save.

Prepare the campaign using the successor runner's `--describe --python` command,
save it privately and hash its actual bytes. Default `--campaign <absolute-path>
--sha256 <digest>` is local-only preview. Execute the exact same arguments once
with `--execute`. The private receipt records the absolute argv, source commit,
full runtime map and campaign hash. There is no alternate journal, key or reader
flag and no retry switch.

On success, preserve a hardware report and continue preparation of the separately
scoped phone-creation stage. No automatic installation, erasure or ops-fence
release is authorized by this readiness connection. On failure, stop, retain and
report the result, command count and closure; do not open another connection.
