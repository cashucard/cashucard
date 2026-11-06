# Hardware plan: recover card 09336320 to factory blank

Plan ID: `recover-installed-v1`.
Status: **approved 2026-11-02** (see [Approval](#approval)).

## Why

The phased install on card `09336320` stopped at `installed-load-files-0` with
`registry-baseline` after creating both instances of the private package
(`…505401` opener, `…50544D` main) in 135 commands. The card is left holding a
private package and its two instances, and the install journal
`cashucard-private-capacity-install-v1` is preserved on the phone as evidence of
that stop.

The operator ordered **recovery first**: the listing the stop was decided by is
not needed to delete, and the reader-side read cannot produce it anyway (the
plain channel answers `6982`, and this plan opens no authenticated listing read
of its own before deletion). Recovery therefore ends by destroying the unknown
record along with the package.

### The key is established on the card, not from a journal

`recoverToBlank` requires `expectedKey` — the saved installation public key —
and refuses to start without it (`recovery-key-invalid`). The install stopped
**before** its own `read-public-key` step, so no journal holds that key for this
card.

The operator accepts, for this card only, that the key is **observed on the
card** instead:

1. One read-only session, no keys, no authentication: match the chip, SELECT the
   package, read the applet's public key (INS `7A`). The SELECT itself runs the
   applet's entry and might release unpublished staging.
2. That read session never proceeds past the key: it does not authenticate, does
   not read state, does not delete. Its only purpose is to pin the key.
3. The destructive invocation then takes that exact key as `expectedKey` and
   still enforces it twice: `read-public-key` after SELECT must equal it, and
   the applet's protocol traps a refusal by its very design. A key that changes
   between the two sessions (because SELECT did something unexpected) makes the
   second run stop with `recovery-key-mismatch` before any deletion.

This does not verify the key against a packet, because this card has none signed.
It means recovery can no longer prove that the key is the one that signed a
packet — only that it is the key the card reports now. Recorded as a limitation
in the report, not glossed.

## Preconditions: the launcher is missing, and two runners cannot do this

Two gates were found while preparing this plan. Both are code defects, not
package facts, and **the destructive run does not start until both are closed and
green**:

1. **`run-compact.cjs` cannot verify the installed shape at all.** Its
   `verifyRegistry` (line 148) requires every non-baseline entry to be one of
   `AIDS = [PACKAGE+"01", PACKAGE+"4D", PACKAGE]` **and** to sit in the listing
   kind `aid === PACKAGE ? "load-files" : "applications"`. The installed card
   lists `…505401` and `…50544D` under `applications` (92 bytes, observed) and
   the package record **not at all**. So `registry(AIDS)` in its cleanup branch
   — and the `require-absent` loop before it — cannot pass on this card; the
   run would stop with `registry-objects` before any delete. This is a different
   defect from the one already fixed in `recover-compact.cjs`, and it lives in a
   different runner.
2. **`run-compact.cjs` refuses the image this card holds.** `compactArtifact`
   requires `kind === "compact-javacard-prototype"`, `probeFormat === 5`,
   `poolBytes === 16384` and a generated-source name set. The card was installed
   by the **phase** profile (`pixel-phase-install-v1`), from a different
   manifest. Widening `compactArtifact` to accept that manifest would also widen
   what an execution run may install — not acceptable.

Both together mean the correct vehicle is **not** `run-compact.cjs`'s cleanup
branch. `recover-compact.cjs` already has the right policy (installed allowance,
`applications`-only pre-check, fresh channel, delete then verify blank) and its
`installed` path is covered offline. What it lacks is a reader-facing launcher:
`recoverToBlank` takes an injected `tx` and opens nothing. Step 1 therefore
builds that launcher over `compact_recovery_bridge.py` — the independent policy
— rather than teaching a second runner the installed shape. If the launcher
needs more than pinning (chip, key, bridge hashes, plan id, journal), the plan
stops and the finding is reported.

The launcher's delete frames must reach the bridge as `` `84 e4` `` secure
frames; the bridge admits both installed AIDs with distinct count keys
(`84e400004f0bf04341534855434d50544d`, `84e400004f0bf04341534855434d505401`),
verified in the session that wrote this plan.

An image mismatch discovered at the reader (`gp-install` refuses a LOAD whose
hash is pinned elsewhere) is a stop, never a reason to delete with a different
image.

`recover-compact.cjs` deletes by AID and never loads an image, so no artifact
gate stands between this plan and the card: the deletion is addressed to AIDs
that already exist. The image gate above is why the *other* runner is not used,
not a condition on the delete itself.

## Scope

One card (`09336320`, `cplc-v1:4790d3213041093363205547`), one reader
(`ACS ACR122U PICC Interface`), one key-read session and one destructive session.

In scope:

- Reader pass A: CPLC, SELECT the package, read the public key. Nothing else.
- Reader pass B: the reviewed cleanup to blank, under
  `tools/outbox-spike/compact_recovery_bridge.py`'s policy — authenticate with
  the factory keys, verify the installed listing, delete opener and main, then
  verify the original platform baseline and nothing else.
- Journals for both passes in a fresh private directory.

Out of scope — no command in this plan sends any of them:

- LOAD, INSTALL, key rotation, PUT KEY, SET STATUS, SET DATA on any applet.
- Reading the deleted registry back afterwards; the record is gone by design.
- Any change to `verifyRegistry`, `entryAllowed` or `BASELINE`, and any widening
  of `compact_bridge.PRIVATE` to make a frame pass.
- Clearing or editing any existing lab journal, including the install journal.
- A second recovery attempt after any uncertain deletion.

## Steps and gates

1. **Build the launcher, offline.** Pin the chip, plan id, image/runtime
   fingerprint, journal path and the bridge hashes; open
   `compact_recovery_bridge.py` with `--expected-key`; hand `tx` to
   `recoverToBlank({…, installed: true})`. Its regression drives the fixture
   card through the same `tx` shape the bridge admits. If this is more than
   pinning and wiring, the plan stops and the finding is reported.
2. **Offline rehearsal.** `node --test tools/outbox-spike/*.test.cjs` and
   `python3 tools/outbox-spike/test_compact_recovery_bridge.py` green on the
   exact commit that will run. The recovery flow is exercised against the
   fixture's installed card, including two distinct deletion count keys and a
   blank `verifyRegistry(…, [])`.
3. **Record the commit and hashes** in the run report before the reader opens:
   source commit, runner fingerprint, bridge hashes, the private disk image
   manifest and its sha256.
4. **Reader pass A — read the key.** Match CPLC. A mismatch stops. SELECT the
   package, require `CPROT\x02`, read INS `7A`, save the compressed key (33
   bytes, `02`/`03` prefix) to the private journal, close the reader cleanly.
   No authentication, no state read, no deletion.
5. **Reader pass B — cleanup to blank.** A new private journal path and a new
   bridge process. `--expected-key` is the 33-byte key pass A read. CPLC must
   match again. Factory keys must be proved. The installed listing must verify
   against the two instance AIDs before any delete. Delete opener then main, one
   fresh channel, no retry. Then `registry()` must verify **blank** with
   `allowed = []`.
6. **Report**: CPLC before and after, both journals' hashes, the deleted AIDs
   with their replies, the blank listing, the key read in pass A and the reason
   it cannot be tied to a signed packet, and the two precondition fixes. Commit
   once, tree clean.

Each step is a gate. A failure stops the plan and is written into the report with
its classified cause. Nothing is retried.

## Prohibited under this plan

- Re-running either reader pass after a partial, failed or uncertain reply.
- Deleting with a key other than pass A's, or with a listing that has not been
  verified against the installed shape.
- Editing any journal under `~/.cashucard/` other than creating the new
  directory for this plan.
- Weakening the verifier or the bridge policy to make the card pass.
- Reporting recovery as complete from the offline suite alone.

## Revocation and evidence

Approval covers one card, one key-read session and one destructive session, in
that order. It expires when the tree is regenerated with a different commit. The
install journal is preserved untouched as the evidence of the stop this plan
cleans up.

## Approval

- `approved: true` (consumed 2026-11-02: pass A and pass B both ran; see
  [Outcome](#outcome-pass-a-read-the-key-pass-b-stopped-at-read-diagnostics))
- Approver: repo owner (operator), in session
- Date: 2026-11-02
- Scope: card `09336320` on the ACR122U; one read-only key read, then one
  cleanup to factory blank, after the two precondition fixes have a regression
  each. Destructive.

## Outcome: pass A read the key, pass B stopped at `read-diagnostics`

**Card untouched: no deletion frame was sent.** The card still holds both
instances and the platform baseline; the install journal is untouched.

- **Pass A (read-only) completed.** The card answers CPLC **only from the ISD
  applet** — on a fresh connection with no applet selected the same
  `80 CA 9F 7F 00` is `6A86`, four times out of four, and `9000` four times out
  of four after `00 A4 04 00 08 A0 00 00 01 51 00 00 00 00`. The first two
  attempts failed on that order and the policy only admitted three frames;
  the pass now opens with the ISD select. Key read twice, identical:
  `03d0b08a4f96d57301cedc89435b15a809f18cc9a7abe30614e07e464ca8ce0570`.
- **Pass B stopped at `read-diagnostics`** with `diagnostic-mismatch`, stage
  recorded, **9 commands**, after `select-and-recover` (which answered
  `CPROT\x02`) and `read-diagnostics` (`7FFF0A0E0A0014001400000000000005`,
  `9000`).
- **Cause: this card is not the running applet the flow expects.** The
  diagnostics say the private applet has **zero** allocated pool and DLEQ
  storage — it was installed and selected but never set up. `recover-compact.cjs`
  calls `diagnostics(diagnostic, 2)` (ready state 2 = initialised, 16384 pool /
  12288 DLEQ) and refuses anything else. The offline fixture answered
  `7FFF0A0E0A0014001400400030000205`, i.e. a **initialised** applet; the live
  card answers `…00000000000005`. So the fixture modelled a card that had been
  set up, and this card never was.
- **The correct vehicle is still `recover-compact.cjs`** (its installed
  allowance and `applications`-only pre-check both verified live: the
  `before-recovery` listing passed). What is wrong is its diagnostics gate for
  an installed-but-uninitialised applet. Relaxing `diagnostics(d, 2)` to accept
  state 0 is a change to a verifier, which this plan prohibits making to pass a
  card — so it is reported, not patched here.
- **Two launcher defects found only by running it live**, both fixed with a
  regression: the hand-sliced CPLC identity disagreed with the SDK's
  (`cplc-v1:003041093363205547000000` vs `cplc-v1:4790d3213041093363205547`) and
  is now `parseCplc`; and the flow's own stamped plan name is now pinned
  (`compact-optimized-sign-recovery-v1`), since the launcher's `plan` id is not
  the flow's.
- **A `--recover` run ran before pass A, against a placeholder key.** It was
  meant as a no-card smoke test; a card was on the reader, so it read the real
  card and stopped at the same `read-diagnostics` gate, having sent no
  deletion. It broke this plan's order (pass A first), and is recorded rather
  than omitted so the journal history stays honest.
- Journals: `~/.cashucard/recover-installed-2026-11-02/pass-a.json`
  (`d6dd402e…16d208`), `pass-b.json` (`146c19cc…1448f24`).

**Next step needs a decision, not a retry:** whether `recover-compact.cjs`
should accept ready state 0 for `installed: true` (an installed-but-unset-up
applet has nothing to recover and nothing to sign), under a new plan.
