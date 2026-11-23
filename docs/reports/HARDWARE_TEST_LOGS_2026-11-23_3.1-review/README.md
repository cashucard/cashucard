# Chip run logs: card software 3.1 with D236 (2026-11-23)

The tracked file of branch `card-3.1-pr` (load file sha256 b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da,
42,741 bytes) on three cards, play money at testnut.cashu.space. The summary is
`docs/reports/HARDWARE_TEST_REPORT_2026-11-23_58206920_3.1-review.md` on that branch.

| Folder | Card |
|---|---|
| 58206920-J3R180-SCP03 | sample card 58206920, J3R180 keyed for SCP03 (D229) |
| 36813121-J3R452 | J3R452 (P71D600), SCP03 with its supplier's keys |
| 09334220-J3R180-SCP02 | J3R180 keyed for SCP02, the public default key |

Per folder:
- `install.log`: gp output of the delete, load and creates (58206920 and 09334220: the default key; 36813121: the supplier's
  keys, which gp does not print).
- `guard.log`: every serial read before a step that changed the card.
- `setup1.log`, `setup2.log`: the set-up on the fresh install, and the set-up after a reset by the owner (D236 (2): the claim
  held for four askings), timed per command.
- `select-zero.log`: SELECT, VERIFY_PIN, SELECT the tag, SELECT the applet, GET_LOG (`6982`: D236 (4)).
- `reset-owner.log`, `reset-pin.log` (58206920 only): the reset by the owner, and cardctl refusing the PIN reset on an owned card.
- `run-M.out` / `session-M.log`: the payment session (set-up, first load of 36, payments, change, AGAIN, withdrawal of all,
  reset). On 36813121, `run-M.out` ends at a testnut timeout while SA2's change was loading; `run-M-resume.out` is the
  harness refusing to resume half way, and `run-M-resume2.out` the run going on from the two pieces still owed.
- `p31-results.jsonl`: one line per tap: each payment's slots, price, fee, change outputs, every "not yet" in ms, signing
  times, and the mint's answer; each change load with its slot, amount, time, DLEQ check and state at the mint.
- `p19-M.log`: the exact and AGAIN payments by digest.
- `bridge-M.log`: the APDU bridge's own log.
- `pieces-M-first-full-noteach-timing.json`: the first load's per-piece timing.

Left out: the run's state file and the first load's piece list (they hold the payment keys, blinding factors and proof
secrets of the run: play money, all spent, and the cards reset since).
