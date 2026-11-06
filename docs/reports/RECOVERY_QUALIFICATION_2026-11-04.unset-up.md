# Unset-up recovery: offline qualification

The stopped card's dedicated cleanup path is implemented locally on
`feat/unset-up-recovery`: signed `45b449a` and `5472ba9`. Execution approval remains
false. No card, reader, phone or production service was accessed.

The goal is still card-carried settlement: an offline till prepares payment,
an online phone relays the card's signed packet, and the till independently
recovers its exact proceeds once. The local relay demonstration was completed in
`2c954a9` with the real Flash POS integration. Cleaning this stopped, never-set-up
private image is the next physical dependency, not completion of phone/till
hardware qualification.

## What is now qualified

The [plan](HARDWARE_PLAN_2026-11-04.recover-unset-up-3.md) fixes the parsed
`09336120` identity, observed public key, exact installed objects, original
platform records, one reader, deletion order and a fresh one-shot journal.

The new host reuses the old diagnostic and registry validators unchanged, then
requires the full raw registry set. Its independent Python policy admits only
ordered stages. Two factory cryptogram checks precede their respective
EXTERNAL AUTHENTICATE commands. Only SELECT, CPLC, authentication, bounded
registry reads, private version/diagnostics/key and the three named DELETEs are
admitted. There is no initialized status/scope query, SETUP or signing command.

A private campaign binds a clean commit, tracked execution approval, final plan,
profile and 611 runtime files. Admission is checked again after durable one-shot
consumption and before reader startup. Existing evidence is never edited to make
admission pass. Public intent and reply receipts are synced before continuation;
authentication bodies are omitted. Uncertain startup/closure retains the lock,
and permanent consumption prevents retry even after confirmed closure.

The independent saved-evidence decoder re-reads the newly written journal by
hash, validates all three complete registry snapshots and public identity
receipts, and must agree with the live independent bridge. Blank requires this
check, final chip identity and confirmed reader closure.

## Validation actually run

| Check                                                                                   | Result                              |
| --------------------------------------------------------------------------------------- | ----------------------------------- |
| Full outbox Node suite, Node 22.23.4, optional unset-up JavaCard test enabled           | 205 passed, 0 failed, 0 skipped     |
| Full cardkit SCP02/fake-card suite                                                      | 129 passed, 0 failed, 0 skipped     |
| Python discovery, `tools/outbox-spike/test_*.py`, copied Python 3.15 venv               | 43 passed                           |
| Focused formatted new suites before final full run                                      | 17 passed, 1 optional JavaCard skip |
| Prettier on all new/changed runner CJS and profile/approval JSON; git whitespace checks | Passed                              |

The full Node command was:

```sh
UNSET_SIM_ARTIFACT=/private/tmp/cashucard-relay-artifact-20261103 \
  /opt/homebrew/opt/node@22/bin/node --test 'tools/outbox-spike/*.test.cjs'
```

JDK 17 was first on PATH. The simulator used the existing private conversion and
a cardsim jar copied from the earlier isolated software campaign. The actual
private JavaCard replies are `9000` for SELECT/diagnostics/key and `6985` for the
initialized-only status/scope commands. GlobalPlatform and chip identity remain
synthetic in this test; it proves dispatcher behavior, not silicon state.

The new controller, admission and saved-evidence tests were first run without
their implementations/fixes and failed, then passed. Red logs are retained at
`/private/tmp/unset-up-recovery-red.log`, `/private/tmp/unset-admission-red.log`
and `/private/tmp/unset-evidence-red.log`. Final suite logs are
`/private/tmp/unset-outbox-final.log`, `/private/tmp/unset-cardkit-full.log` and
`/private/tmp/unset-python-full.log`.

Fault tests include a refused status or lost reply at each of the typical 24
command positions; unknown chip/key; wrong factory keys without external auth;
setup states 1/2; extra/retained/omitted packages; paged and incomplete registries;
failed storage; elapsed budget; consumed campaign; dirty source and changed
runtime; policy disagreement; and uncertain startup/closure. Isolated process
tests import only a newly created synthetic PC/SC package, prove admission
refusal before its import, and exercise refusal, disconnect and lost-delete
outcomes without retry. Temporary synthetic files are removed by the tests.

All five historical journal hashes and protected source hashes still match the
unchanged preparation audit. No released applet, tracked CAP, generated phone
asset, original worktree edit or H0 owner fixture was changed. No push or PR was
created.

## Remaining operator input

Confirm custody/unchanged state and availability of the same card, then decide
whether to execute the exact bounded plan. The repository requires a named,
approved plan before device access. Only after explicit execution approval may
the approval JSON become true and a fresh approved campaign be generated. The
existing approval and preparation campaign stay false; no reader operation is
part of preview. Physical behavior, native PC/SC execution and timing remain
unqualified until that single authorized invocation.
