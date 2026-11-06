# Readiness check for 07297620

- Plan ID: `readiness-07297620-v1`.
- `approved: true`; initially unconsumed. The operator selected 07297620 for the
  [replacement plan](PLAN_2026-11-04.adopt-07297620.md), then said **"ok execute"**.
  This invocation implements only that plan's readiness stage, not installation
  or cleanup. Later stages retain their prerequisites and separate named plans.
- Device: `cplc-v1:4790d3213180072976207515`, serial `07297620`, batch `7515`,
  currently presented in exactly `ACS ACR122U PICC Interface`.

## One connection and exact sequence

One exclusive connection, leave-card disposition, no reconnect/reset/retry.
Use the qualified Node 22.23.4 and Python 3.15 venv in the isolated worktree
`/Users/dread/Repos/cashu-card-recovery-v3`. The fixed profile is
`tools/outbox-spike/readiness-07297620.json`; it contains the independently read
CPLC and exact four-file baseline from the retained October 28 cleanup.

| Stage           | Commands                                                                                            | Maximum APDUs |
| --------------- | --------------------------------------------------------------------------------------------------- | ------------: |
| Identity        | SELECT ISD, GET DATA CPLC, exact chip match                                                         |             2 |
| Factory channel | SELECT ISD, INITIALIZE UPDATE at version 1, prove the factory cryptogram, one EXTERNAL AUTHENTICATE |             3 |
| Full registry   | Authenticated applications and load-files, at most four pages each                                  |             8 |
| Final identity  | SELECT ISD, GET DATA CPLC, exact match                                                              |             2 |
| Total           | Normally 9; hard ceiling 15                                                                         |            15 |

Fixed commands: ISD SELECT `00a4040008a00000015100000000`, CPLC `80ca9f7f00`,
INITIALIZE UPDATE prefix `8050010008` with one fresh eight-byte challenge and Le,
EXTERNAL AUTHENTICATE prefix `8482010010`, and SCP02-wrapped GET STATUS with
INS `F2`, P1 `40`/`20`, P2 `02`/`03`, body `4f00` and Le. Authentication MACs vary;
no other command form is admitted by the host or independent Python policy.

Use only the published factory `40`–`4F` set at version 1; prove the returned
card cryptogram before external authentication. No alternate keys, retries or
key rotation. No private applet command, DELETE, LOAD, INSTALL, SETUP, signing,
funding or production endpoint is in scope.

Keep a 120-second gate on further transmissions and a 30-second response bound,
shortened by remaining budget. A late or uncertain response stops. No limit
increase or continuation through a failure is authorized.

## Evidence and success condition

Bind the clean signed source commit, this exact plan, profile, original audit,
Node/Python/SDK/crypto/pyscard and both new host/policy files in a private campaign.
Default preview performs local reads only. Verify historical journal hashes and
protected source before admission and again after consumption, before lazy open.
The native Python process verifies pinned files and its consumed marker before
importing PC/SC or enumerating the reader.

Create only new private evidence at
`~/.cashucard/readiness-07297620-2026-11-04/pass-1/readiness.json` (`0600`, parent
`0700`), plus new `.consumed` and `.request.json` files. A durable permanent marker
and exclusive lease precede opening. Sync command intent before transmission and
public reply before continuation; exclude authentication bodies and native text.
Existing journal/marker/request/lock refuses admission. Uncertain closure retains
the lease. Preserve all older evidence and consumed plans.

Both complete registry kinds must match the historical evidence exactly:
applications empty, load-files exactly the four original E3 TLVs. Preserve
`A0000001515350`, `A00000016443446F634C697465`, `A0000000620204` and
`A0000000620202`; ordering and page boundaries may vary, fields may not.
Missing, changed, duplicate or extra objects stop, with no automatic cleanup.
The unchanged `verifyRegistry` validator also checks the complete set using this
card's original baseline; no global allowance or original profile is changed.

An isolated Python decoder must re-read the newly saved journal by hash and
verify complete registry evidence and final identity. Record readiness only
when it and the live independent policy agree, final CPLC matches and closure
is confirmed. No registry, key or current readiness is inferred from identity
alone. A ready result permits preparation of the next stage, not an unplanned
second connection.

## Qualification and launch

The controller was tested against real SCP02 FakeCard exchanges and replayed
through the independent policy. Synthetic faults cover every typical command
position, wrong chip/keys, foreign applications, missing baseline, persistence,
time bounds, policy disagreement and uncertain closure. Five Python cases check
ordered admission, refused writes, status/lost replies, paged framing and close.
An isolated synthetic-PC/SC process test covers full request validation, no
native import before refusal, all nine commands, and confirmed close. A separate
saved-journal decoder test rejects retained objects. Physical state is unknown
until this invocation.

Qualification completed: full outbox suite 212 passed (no skips), Python policy
discovery 50 passed, and targeted formatting/whitespace checks passed. The initial
controller tests failed before implementation; retained red log:
`/private/tmp/readiness-07297620-red.log`. Final logs:
`/private/tmp/readiness-outbox-full.log` and
`/private/tmp/readiness-python-full.log`.

After the full affected suites pass and source is signed/clean, create a fresh
private campaign with the fixed runner's `--describe --python <reviewed-venv>`.
Save the resulting manifest privately and hash its actual bytes. Preview with
`--campaign <absolute-path> --sha256 <digest>`. Execute the same arguments once
with `--execute`; the runner has no alternate reader, key, journal or retry flag.
The actual absolute argv, manifest digest and runtime map are retained in the
new preparation receipt. The old cleanup and switched-card check remain consumed.

On any failure: stop, preserve evidence, report status/command count and closure.
Do not retry this plan or silently expand to deletion, installation or a different
card. On success: preserve a hardware report and continue offline preparation of
the separately scoped phone-creation stage.
