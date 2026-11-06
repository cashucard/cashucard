# Read-only registry inspection after 07297620's uncertain main creation

- Plan ID: `inspect-07297620-v1`; execution approval **true**; unconsumed before this invocation.
- The operator said **"yes"** to preparing a bounded read-only inspection after
  the Pixel stop, then **"approved"** after reviewing this finished plan. This
  authorizes exactly its one named-reader inspection. No earlier execution
  decision is carried forward and no successor action is authorized.
- Card: exactly `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch
  **7515**, with the exact raw CPLC pinned in `inspect-07297620.json`.
- Reader: exactly `ACS ACR122U PICC Interface`, one exclusive connection.
- Phone: no access, app change, NFC session or journal collection in this plan.

## Question and evidence

Did the main instance `F04341534855434D505401` become registered despite the
missing reply to the Pixel's create-01 command? The
[stopped creation report](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-pixel-create-stop.md)
records 114 acknowledged LOAD blocks and an acknowledged opener, followed by
command 124 with no status word. It does not establish main presence or absence.
The preserved journal SHA-256 is
`30f018b5ebb75bceddf607145e6db381c4a4818d3a62c5037fa49b24ffae3986`.

The [audit](HARDWARE_PLAN_2026-11-05.inspect-07297620.audit.json) pins that journal,
archive and review, its build/activation receipts, the successful post-reset
readiness and earlier historical evidence. Preserve all existing files,
consumed markers and app storage. Do not reset or reinstall before inspection.

## Exact command scope

The operator moves this card from the phone to the named reader only after
execution approval. The launcher opens one connection and sends only:

| Stage            | Commands                                                                                                        | Maximum |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------: |
| Initial identity | SELECT ISD, GET DATA CPLC; exact raw and parsed match                                                           |       2 |
| Factory channel  | SELECT ISD, one INITIALIZE UPDATE at version 1, prove public factory cryptogram, then one EXTERNAL AUTHENTICATE |       3 |
| Registries       | Authenticated GET STATUS applications and load-files, each complete within four pages                           |       8 |
| Final identity   | SELECT ISD, GET DATA CPLC; exact match, then close                                                              |       2 |
| Total            | Nominal 9, hard ceiling 15                                                                                      |      15 |

The public factory `40`–`4F` set is the only permitted set. No alternate key,
second authentication attempt, reconnect, reset or retry. Connection and
closure use leave-card disposition. Keep the 120-second transmission gate and
30-second response bound shortened by the remaining budget. A timeout grants
no extra command. Persist public intent before transmit and public reply before
continuation; exclude authentication bodies, challenges/MACs and native error
text. Retain an uncertain-closure lease.

Only ISD SELECT (`00A40400` with its exact AID), CPLC (`80CA9F7F00`), the fixed
factory handshake shapes and wrapped GET STATUS (`84F2`, P1 `40`/`20`, P2
`02`/`03`, selector `4F00`) are admitted in order. The Python policy independently
restricts every APDU and every reply. No private applet SELECT or command is
permitted, even when main is present. This intentionally narrows the optional
public applet checks discussed in the preceding report: registry membership
alone answers this inspection's question without running the uncertain applet.

No INSTALL, LOAD, DELETE, PUT KEY, SETUP, proof, signing, payment, funding,
export or retirement. No production lookup or ops-fence/state change.

## Full registry acceptance and result

Validate complete canonical E3 frames, including every field, without filtering
out the private package. Order and page boundaries may vary; objects and fields
may not. The load-file set must be exactly the following four original frames
plus the pinned private package frame. All are in the fixed profile.

| Original platform AID        | Version |
| ---------------------------- | ------- |
| `A0000001515350`             | 255.255 |
| `A00000016443446F634C697465` | 1.0     |
| `A0000000620204`             | 1.0     |
| `A0000000620202`             | 1.3     |

Require private package `F04341534855434D5054` and opener
`F04341534855434D50544D`, whose creation/load acknowledgements were retained.
The application set may be exactly the opener alone or exactly opener plus main
`F04341534855434D505401`. These are the only two accepted outcomes. Any missing,
additional, duplicate or changed frame, incomplete listing, refused status,
failed proof, persistence failure or uncertain response stops and preserves the
observed public pages. A mismatch is evidence to report, never cleanup authority.

Success is `inspected` / `inspection-verified` with boolean `mainPresent`, both
complete registry kinds, final CPLC, independent replay of saved public receipts
and confirmed native closure. It is not `ready`, `blank`, `installed-unset-up`
or payment qualification. Registry presence establishes neither key availability
nor working diagnostics, setup state, signing, remaining memory or root cause.
Main absence also does not explain the failed creation or authorize another one.

## Fixed implementation, admission and one-use evidence

The new controller/launcher `inspect-07297620.cjs`, profile
`inspect-07297620.json`, transport `inspect-transport.cjs` and independent policy
`inspect_07297620.py` are separate from all consumed readiness/creation tools.
Old Pixel guards, baseline, diagnostics, compact bridge private allowlist,
released applet/CAP, SDK and phone app stay unchanged. The new native policy
imports no PC/SC until its private request, runtime pins, execution approval and
consumption marker pass. Its independent saved-evidence decoder needs no PC/SC.

Before access, record explicit operator execution approval, update only the new
approval state/authorization note, rerun affected checks and sign the clean source.
Prepare a fresh private campaign using the actual Node 22, reviewed venv Python,
SDK, crypto and pyscard/runtime hashes. Admission pins this plan, audit, profile,
source commit and all historical evidence; it rechecks after durable consumption
before lazy native startup. No arbitrary profile, key, journal, reader or retry
flag exists.

The only new journal is
`~/.cashucard/inspect-07297620-2026-11-05/pass-1/inspection.json`, in new private
0700 directories, with 0600 files and distinct `.consumed`, `.request.json` and
lease files. Existing files refuse another invocation; none may be removed or
rewritten to rearm. No evidence file is touched during local preview.

From the isolated worktree use the pinned Node/Python paths:

```text
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/inspect-07297620.cjs --describe --python /Users/dread/Repos/cashu-card-recovery-v3/tools/cardctl/.venv/bin/python
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/inspect-07297620.cjs --campaign <absolute-new-private-campaign.json> --sha256 <actual-file-sha256>
```

The first command describes a host-only campaign. Save the actual JSON privately
without modifying existing files; the second command is local-only preview.
After the recorded approval and refreshed pins, execute the exact preview
arguments once by adding `--execute`. The original preparation preview remains
preserved with `approved: false`; a new approved campaign must be described and
previewed from signed clean source. Device placement alone is never approval.

Qualification includes meaningful missing-implementation red runs, both
membership outcomes through fake-card SCP02, split pages, unexpected/missing
frames, wrong card/keys, persistence/transport/closure failure, independent
receipt replay and a fully synthetic isolated native process. Preparation logs
are `/private/tmp/inspect-07297620-red.log`,
`/private/tmp/inspect-07297620-python-red.log`,
`/private/tmp/inspect-07297620-targeted.log`,
`/private/tmp/inspect-07297620-full.log` and
`/private/tmp/inspect-07297620-python.log`. Tests establish software behavior only.

All **247 Node tests passed with no skips**, including 22 inspection cases, and
all **54 Python policy tests passed**, including four new inspection cases.
The optional existing JavaCard integration ran with
`UNSET_SIM_ARTIFACT=/private/tmp/cashucard-relay-artifact-20261103`; this is a
separate simulator fixture, not a replacement image loaded onto 07297620.
Formatting and whitespace checks passed. An additional failing-before regression
at `/private/tmp/inspect-07297620-expired-red.log` verifies that an expired host
budget refuses before native startup. Both native startup and subsequent sends
recheck the budget. All protected-source and retained-evidence hashes matched.

## Terminal boundary

After this single invocation, preserve and hash the journal and write a hardware
report with identity, runtime/source, registry classification, command count and
closure result. Stop on either success or failure. No automatic follow-up
connection, applet diagnostic, repair, cleanup, install, new plan or retry is
authorized. The next operator decision depends on the actual saved result.
The original goal remains online-phone relay of a retained offline payment and
independent exact-once till recovery; this inspection alone does not achieve it.
