# Hardware plan: read the installed card's registry, then fix recovery

Plan ID: `registry-readout-v1`.
Status: **approved 2026-11-02** (see [Approval](#approval)).

## Why

The phased install stopped at `installed-load-files-0` with `registry-baseline`
after creating both instances (135 commands). The verifier accepts only the
platform's three load files plus the named AIDs, so the card returned an entry
neither the fixture nor the verifier expects. The install journal records the
stage and status but **not the listing bytes** — `pixel-control.js`'s install
profile calls `verifyRegistry` with `registryPages` directly and never reaches
the `registry()` wrapper that writes `state.registry`. The offending entry is
therefore unknown, and recovery cannot be made correct until it is read.

The second half of this plan fixes the recovery pre-check that was proven wrong
on this card before any silicon: `recover-compact.cjs` reads only the
`applications` listing and compares against `PRIVATE` (`…01`, `…4D`, package),
which stops at `registry-private-set` on the installed shape (reproduced offline
on the fixture's installed registry). With the real listing in hand the fix is
checkable rather than a guess.

## Scope

Steps 1–8, one phone (irrelevant here), one card, one reader session.

In scope:

- A read-only PC/SC session against card `09336320` on the ACS ACR122U: the
  chip identity read, FILTER, GET DATA, SELECT of the ISD, and the registry
  listing pages for both kinds — read from the **plain** transport first, where
  no key is needed.
- Journaling the registry pages and every raw reply in the CLI's own output.
- Fixing the install profile to persist its registry pages, with a regression.
- Fixing the recovery pre-check against the captured listing, with a regression.

Out of scope — no command in this plan sends any of them:

- Any mutation: LOAD, INSTALL, DELETE, PUT KEY, SET STATUS, SCP02 rotation.
- Any insecure-channel open or EXTERNAL AUTHENTICATE. If the plain listing
  turns out to be insufficient, the plan stops and a new plan decides the
  keyed path; it is not improvised here.
- The recovery run itself, which needs its own plan because it deletes.

## Read-only command set

Exact APDUs, in order, and nothing else:

| #   | Command                                  | Why                                                           |
| --- | ---------------------------------------- | ------------------------------------------------------------- |
| 1   | `80 CA 9F 7F 00`                         | CPLC, binds the session to `cplc-v1:4790d3213041093363205547` |
| 2   | `80 CA 00 E2 00`                         | GET DATA: card production/status, free space                  |
| 3   | `00 A4 04 00 07 A0 00 00 01 51 00 00 00` | SELECT ISD                                                    |
| 4   | `80 F2 20 02 02 4F 00` + Le `00`         | GET STATUS, load files, page 0                                |
| 5   | `80 F2 20 03 02 4F 00` + Le `00`         | page 1, if page 0 answered `6310`                             |
| 6   | `80 F2 40 02 02 4F 00` + Le `00`         | GET STATUS, applications, page 0                              |
| 7   | `80 F2 40 03 02 4F 00` + Le `00`         | page 1, if page 0 answered `6310`                             |

The filter is the two bytes `4F 00` with no AID (`Lc 02`); a continuation page sets
`P2 03` (`more`) and is otherwise identical. That is `sdk.registryCommand`
verbatim, not invented. A card answering `6A88` to either listing
means "nothing of that kind" and is recorded, not retried.

The session aborts on any reply the table does not anticipate. Every reply is
written to the output file before the next command is sent.

## Cannot mutate, checked in code

The CLI's transmit path is a single function with an allowlist of the four
hooks above; an APDU outside it throws before `connection.transmit`. The
connection is opened without any secure-channel state, so no wrapped frame can
be constructed. There is no key material in the program at all.

## Steps and gates

1. **Create the reader environment**: `tools/cardctl/.venv` in this repo,
   `pip install -r tools/cardctl/requirements.txt`, and prove `readers` lists
   the ACR122U. A venv that cannot import `smartcard` stops the plan.
2. **Write the CLI** `tools/cardctl/read_registry.py`, with a dry-run mode that
   prints the exact APDU list without a reader attached, and a unit test over
   the allowlist.
3. **Offline proof**: dry-run output equals the table above, byte for byte;
   an allowlist violation raises.
4. **Seat the card** on the ACR122U and confirm the CPLC matches
   `cplc-v1:4790d3213041093363205547`. A mismatch stops the plan.
5. **One read session.** All seven commands, one pass, no retry. Save the raw
   transcript to a private directory (`0700` dir, `0600` file), hash it.
6. **Journal the install profile's registry pages** — code and regression only,
   no silicon. The regression asserts the pages survive a stop at the installed
   listing.
7. **Fix the recovery pre-check** against the listing step 5 captured: make the
   read cover the kind the card actually answers with, and assert the installed
   shape verifies while a foreign entry still fails. If the captured listing
   cannot be read as instances at all, the fix is to stop the plan and file the
   finding, not to widen the verifier.
8. **Report and commit**: the dated report with the transcript, the hash, the
   CPLC, the observed entries, the two commits, and what remains unknown.

Each step is a gate. A failure stops the plan and is written into the report
with its classified cause; nothing is retried.

## Prohibited under this plan

- Re-running the read session after a partial or failed pass.
- Opening a secure channel, or any keyed GET STATUS.
- Any of: LOAD, INSTALL, DELETE, PUT KEY, SET STATUS, key rotation.
- Clearing or editing any lab journal, including the install journal that
  already holds the consumed attempt.
- Weakening `verifyRegistry`, `entryAllowed`, or `BASELINE` to make an observed
  listing pass. The verifier is the finding; a fix is a decision in the report.
- Reporting recovery as fixed from the offline suite alone.

## Revocation and evidence

Approval covers one card, one read session, one pass. It expires when the
software is regenerated against a different tree. The transcript is preserved
and never overwritten; old journal fingerprints are never rewritten.

## Outcome: the plain read stops at 6982

Two passes, both with the CPLC gate passing (`cplc-v1:4790d3213041093363205547`):

| Read                   | Reply                                                    |
| ---------------------- | -------------------------------------------------------- |
| CPLC `80 CA 9F 7F`     | `9000`, the pinned chip                                  |
| GET DATA `80 CA 00 E2` | `6A88` — no such object on this card                     |
| SELECT ISD             | `9000` → `6F 10 84 08 A000000151000000 A5 04 9F65 01 FF` |
| GET STATUS load files  | `6982` — security status not satisfied                   |

`6982` is the finding: a registry that holds a package is only listed inside
an authenticated channel. The plan's read-only command set has no
INITIALIZE UPDATE, so it cannot finish, and it stopped there as designed.
Transcript: `/Users/dread/.cashucard/registry-readout-2026-11-02/readout.json`
(private, `0600`).

The operator approved the keyed read a later plan would have needed, then
ordered **recovery first**, accepting that the card's listing is lost with the
deletion. The keyed read is therefore not run; the listing stays unknown, and
the recovery fix is made against the offline evidence that the install profile
already passes `INSTALL_PRIVATE` (`pixel-control.js`) while `recover-compact.cjs`
passed `PRIVATE`.

Two defects in the readout CLI itself, both fixed before the second pass and
neither hidden by editing around the failure: the CPLC variable was unbound
when a read stopped early, and an escaping exception lost the transcript
entirely.

## Approval

- `approved: true`
- Approver: repo owner (operator), in session
- Date: 2026-11-02
- Scope: steps 1–8, card `09336320` on the ACR122U, read-only APDU set above,
  plus the offline journaling and recovery-pre-check fixes. No mutation.
