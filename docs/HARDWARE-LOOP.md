# Hardware loop: turn one silicon observation into a fixed suite, unattended

Plan ID: `hardware-loop-v1`.

A silicon run produces one observation: a stop code, a command count, a stage.
Today that costs two rounds of human input — the operator reports it, an agent
edits the fixture, the operator waits, the operator re-runs. This page is the
procedure that removes the second round. The agent does every step but two
physical ones, and it keeps going until the observation is reproduced offline,
covered by a regression, and the whole suite is green.

Only two things need a human:

1. **The physical run.** Tapping the app and holding the card. Nothing on the
   host can do it.
2. **Handing back the observation.** One line of text, described below, or the
   exported journal if the run reached a result.

Everything else is the agent's job.

## What the operator reports

After a hardware run, send the result line the app renders, verbatim, plus the
run's exported journal when one exists:

```text
Stopped · installed-load-files-0
135 commands
registry-baseline
```

That is enough. Stage names the last step attempted, the count fixes how far the
profile got, and the third line is the classified failure code. No paraphrase:
the exact tokens, because they are lookup keys below.

When the run reaches `installed-for-phases`, the receipt and journal are still
needed, but there is no failure to reproduce — go to the receipt section.

## The loop the agent runs

Each pass is one silicon observation. The agent runs every step without asking,
and only stops to report a finished suite or a blocker it cannot test around.

1. **Read the code path the stage names.** Open the profile in
   `tools/outbox-spike/pixel-control.js`, find the `stop()` or the failed check
   that produced the failure code, and read the exact reads and constants it
   depends on — `verifyRegistry`, `entryAllowed`, `BASELINE`, `registryPages`,
   the pinned values in `pixel-install.json`. The comment beside the code is not
   evidence; the installed SDK and the profile's own arithmetic are.
2. **Ask what the fixture serves at that read.** In
   `tools/outbox-spike/pixel-test-support.cjs`, find the branch that answers the
   same APDU. Decide whether the real card's answer is _representable_ by
   today's fixture:
   - If capability exists but the branch never reaches it, the fixture has a
     bug: fix the branch.
   - If no option can produce the card's answer, add one — a named option with
     a comment saying what silicon showed, not what the spec says it should say.
     Never widen a verifier to accept the observed answer. The stop is the
     product; a test that passes by relaxing a check removes the only evidence
     the hardware produced. When the _verifier_ is the thing at fault, the
     hardware observation is a bug report against it, and the fix is a decision
     worth flagging in the reply, never a silent edit.
3. **Reproduce before fixing anything else.** With the new option switched on,
   assert the exact triple the operator reported: `status`, `failure`, and the
   stage prefix implied by the command count. Also assert what must _not_ have
   happened — no cleanup DELETE, no diagnostics read, no retry, no raw exception
   text, instances left on the card. This is the regression.
4. **Prove the test can fail.** Temporarily flip the assertion or delete the
   option and confirm the new test goes red, then restore. A test written against
   a fixture that cannot fail is not a test. Do this once per new option, in the
   same pass, without leaving a scaffold behind.
5. **Run the full suite.** Green across every file, not just the touched one:

   ```bash
   export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
   env -u MINT_URL -u CARDSIM_URL node --test tools/outbox-spike/*.test.cjs
   ```

   A pre-existing failure is still a failure: fix it or report it, never step
   over it. The run takes about fifty seconds; do not re-run it to "confirm"
   afterwards.

6. **Commit once per observation.** Fixture option, regression, and the code
   fix if any, in one commit whose message leads with the stage and code the
   hardware produced. Do not commit between drafts — iterate on a dirty tree,
   collapse with `git reset --soft` if the history got noisy.
7. **Record the observation.** Append the run to the hardware report for the
   plan that produced it: card, phone build, APK SHA-256, stage, commands, code,
   what the fixture now models, and the commit. The report is what a later pass
   reads instead of guessing.

## Deciding whether to re-run silicon

The loop above is offline and unconditional: every observation gets reproduced
and covered. Whether to spend another physical run is a separate question, and
the agent answers it from the observation itself.

- **The stop was expected and safe** (a pre-flight refusal, a wrong-chip check,
  a gate that fired correctly): no silicon needed. The suite already covers it;
  the fixture was wrong only if its model contradicted the code.
- **The stop was a design fault** (the verifier itself disagrees with a correct
  card, as with `installed-load-files-0`): the fix is code plus a new plan. The
  card is consumed; a re-run needs a new journal key and, if the install already
  completed, a reviewed `recover-compact.cjs` cleanup to blank first.
- **The stop was a physical fault** (no tag, a moved card, a timeout with no
  mutation): the observation is environmental, not a product defect. Record it,
  do not change code, and say plainly that the run needs repeating.

State which of the three it is in the reply. Do not reclassify a
consumer-visible defect as environmental to avoid a plan change.

## Testing around the no-retry rule

An install session can be used once. That is a property of the card, not of the
procedure, so nothing in this loop needs a card: every pass is a fixture run.
Two traps to avoid when writing the pass:

- **The fake card is not the real card.** `FakeCard` cannot open a protected
  channel, so listings served inside it are synthesized by
  `pixel-test-support.cjs` and can silently disagree with silicon. When a
  pattern only passes because of that synthesis, say so in the test comment.
- **Page shape matters.** The profile checks `applications` pages before
  `load-files` pages and concatenates every page of a kind. A replay that feeds
  the verifier the wrong `kind` fails with a misleading code — reproduce by
  driving `runPhaseInstall`, not by hand-assembling pages.

## Receipt runs

When a run reaches `installed-for-phases`, the loop is skipped and the sequence
is mechanical:

1. Export the journal from the app's share action, move it to the private
   directory for that run (`0700` dir, `0600` file, one link), and hash it.
2. Write the receipt with `sourceCommit` set to the commit that will be clean
   when it is verified, `apk` naming the preserved file and its SHA-256, and
   `journal` naming the exported file and its hash.
3. Commit the report and the receipt so the tree is clean at `sourceCommit`;
   campaign admission refuses a dirty tree there.

`phase-install-receipt.cjs` has no CLI. It exports `verifyInstallEvidence` and
`verifyInstallationReceipt`, consumed by `phase-device.cjs`; do not invoke it as
a command.

## What this page is not

It is not approval to touch a card. Every silicon command still needs its own
hardware plan with an `approved: true` header, as in
[`reports/HARDWARE_PLAN_2026-11-02.pixel-phase-install.md`](reports/HARDWARE_PLAN_2026-11-02.pixel-phase-install.md).
This page covers the offline half, which never needs approval because it never
transmits.
