# Hardware plan: finish recovering card 09336320 from its stopped install

Plan ID: `recover-unset-up-v1`.
Status: **consumed 2026-11-03 — two reader sessions, both stopped before any
deletion. Superseded by [plan `recover-unset-up-v2`](HARDWARE_PLAN_2026-11-03.recover-unset-up-2.md).**

## Why

Plan `recover-installed-v1` ran both passes on 2026-11-02 and stopped the
second at `read-diagnostics` with `diagnostic-mismatch`. It sent no deletion; the
card still holds the two instance AIDs `…505401` and `…50544D`, and its
installation public key is unchanged.

The stop is not a bad card. The install stopped before `setup-fixture`, so the
private applet was loaded and created but never went through SETUP:
`diagnostics` answers `7FFF0A0E0A0014001400000000000005` — ready state 0, zero
pool bytes, zero DLEQ bytes. `recover-compact.cjs` asked
`diagnostics(diagnostic, 2)`, the state a card reaches **after** SETUP, so a
card whose install stopped earlier could never pass it. The offline fixture
answered a set-up card, which is why no test saw this.

A second defect stops the run before the diagnostics are reached at all: the
reader answers the CPLC GET DATA with **46** bytes — one ISO 7816-4 control byte
ahead of the 45-byte `9F7F` TLV — while the SDK's `parseCplc` takes the TLV. The
first attempt at this plan (`07615b7`-era tree, journal below) stopped at
`match-chip` with `wrong-chip` after two commands because of it. `trim_cplc` in
`compact_recovery_bridge.py` drops that byte after the frame is admitted, only
when the length and tag are exact; nothing else is reshaped, and a regression
drops the rule to "short enough" and fails.

The readiness fix asks for the state the card is actually in, from the one fact
that says which card this is:

```js
diagnostics(diagnostic, installed ? 0 : 2);
```

**No verifier is weakened.** `diagnostics(data, 0)` is the strictest reading
there is — it requires `b[14] === 0`, pool and DLEQ of exactly 0, every
persistent counter ≤ 32767, and `unusedCommit ≤ maxCommit`, and refuses
anything else with the same `diagnostic-mismatch`. It is the call the
installer already makes for itself (`run-compact.cjs`'s `diagnostics-before`),
and the receipt verifier makes it on the install journal
(`phase-install-receipt.cjs`). What it does not check is the 128-byte commit
floor; that floor is what SETUP exists to establish, and a card that never ran
SETUP has nothing to commit into. Deletion does not commit.

The card holds no spendable value: no pool was ever allocated, so no fixture,
no proof and no record exists on it. This plan removes the package and its two
instances and returns the card to its platform baseline.

## Scope

One card (`09336320`, `cplc-v1:4790d3213041093363205547`), one reader
(`ACS ACR122U PICC Interface`), one destructive session.

In scope:

- The `installed` readiness change above, with a regression that drives the
  unset-up reply through the whole flow.
- One reader session through `tools/outbox-spike/recover-installed.cjs
--recover`, with `--expected-key` = the key pass A read on this card,
  `03d0b08a4f96d57301cedc89435b15a809f18cc9a7abe30614e07e464ca8ce0570`.
- A new private journal directory, one journal, the report.

Out of scope — no command in this plan sends any of them:

- LOAD, INSTALL, SETUP, key rotation, PUT KEY, SET DATA, retirement.
- Any change to `verifyRegistry`, `entryAllowed`, `BASELINE`, `diagnostics`, or
  `compact_bridge.PRIVATE`.
- Editing any journal under `~/.cashucard/`, including the two passes of
  `recover-installed-v1` and the install journal.
- A second attempt after any uncertain deletion.

## The expected key, and why it is sounder here than last time

`recoverToBlank` requires `expectedKey` and enforces it twice: the read after
SELECT must equal it (`recovery-key-mismatch`), and the bridge's
`compact_recovery_bridge.py` matches the same reply before it will release any
deletion frame (`cleanup_ready`). The key above was read from this card twice,
identically, on 2026-11-02, and re-read once more on 2026-11-03.

It still cannot be tied to a signed packet — this card has none — so recovery
proves the key is the one the card reports **now**. That limitation was accepted
for `recover-installed-v1` and is unchanged.

## Steps and gates

0. **Drop the CPLC control byte** in the bridge, with the length-and-tag-exact
   regression (done: `07615b7`).
1. **Fix the readiness state.** `diagnostics(diagnostic, installed ? 0 : 2)`,
   with a regression that runs the installed fixture at the unset-up reply and
   asserts the flow reaches the key read instead of stopping at
   `read-diagnostics`. The same test is red against the old line.
2. **Offline rehearsal.** `node --test tools/outbox-spike/*.test.cjs` and the
   three Python suites green on the exact commit that will run, tree clean.
3. **Record the commit and journal path** before the reader opens.
4. **Reader session.** `--recover` with the key above and `installed: true`.
   CPLC must match; the before-recovery listing must verify against the two
   instance AIDs; the applet must report state 0. Then: delete opener, delete
   main, and `registry()` must verify **blank** with `allowed = []`.
5. **Report**: CPLC before and after, the diagnostics reply that admitted the
   card, both deletion replies, the blank listing, and the journal hash.

Each step is a gate. A failure stops the plan and is written into the report with
its classified cause. Nothing is retried.

## Prohibited under this plan

- Re-running the session after a partial, failed or uncertain reply.
- Accepting any diagnostics reply other than exactly-ready-state-0
  (`…00000000000005`) or changing `diagnostics` itself to admit one.
- Deleting with a key other than the one above.
- Editing any existing journal under `~/.cashucard/`.
- Reporting recovery as complete from the offline suite alone.

## Revocation and evidence

Approval covers one card and one destructive session. It expires when the tree
is regenerated with a different commit or the card's CPLC changes. The install
journal and both `recover-installed-v1` passes are preserved as evidence.

## Approval

- `approved: true`
- Approver: repo owner (operator), in session ("you choose")
- Date: 2026-11-03
- Scope: card `09336320` on the ACR122U; the installed readiness change with a
  regression, then one cleanup to the platform baseline. Destructive.
