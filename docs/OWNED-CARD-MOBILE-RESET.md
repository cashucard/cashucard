# Mobile reset and reuse — issue #92

The implementation adds Settings → Reset a card. It uses the existing reset
authorization/completion APIs and cardkit engine, plus a fresh settlement check
when an empty card retains spent entries. This is applet removal and manager-key
recovery, followed by a normal fresh installation; it is not a chip-wide reset.

## Operator flow

1. Finish and close the current batch. Sign in with the operator account that
   installed the card, against the same original service.
2. Open Reset a card and choose Check card. This tap reads public identity and
   state only. The service checks recorded identity, escrow and actor eligibility.
3. Recover all remaining value in the holder wallet, finish pending merchant
   payments/change, and explicitly confirm erasure for the reviewed card.
4. If spent entries remain, enter the current card PIN privately on the phone.
   The next tap checks every retained entry at the recorded mint before one
   sealed PIN verification and CLEAR_SPENT. No entries are cleared on pending,
   unknown, malformed or mismatched evidence. Inspect the resulting zero-slot
   state before the next step. A failed PIN is never automatically retried.
5. Choose Reset this card and hold that same card still. The service authorizes
   the exact source; the app saves reset progress before deleting known Cashu
   objects and restoring/verifying factory manager keys. It retains the service
   completion receipt. Network-only completion retry needs no card or keys.
6. Set up a new batch and install this card normally. Its new applet key is a
   new installation identity. Set it up again in its holder wallet before use.

Missing or foreign provenance, an unresolved history, other operator, restore
fence or stale required independent backup stops the flow. Do not change the
API origin, erase app storage or guess manager keys to get past it. Follow
[reset reconciliation](RESET-RECONCILIATION.md) for a historical foreign reset.
Malformed remnants after interrupted cleanup require administrator review.

## Approved hardware validation — completed on phone

- Phone: **SuperMax, iPhone 17 Pro (`iPhone18,1`)**, CoreDevice
  `FCA5FD0D-FFE0-551B-A6F4-D7BC44EC956D`. Install the reviewed candidate
  preserving its existing app data and production API/issuer scope.
- Card: only **cplc-v1:4790d3213041093363205547**, serial **09336320**,
  current key
  `031b63ab2c73c8825952be146d6a71b6a3c17353276a8fc234d990e0a45a3f11f6`.
- Source: production batch 5, attempt
  `65bfdfd9-60b0-43c2-a95d-06b5012e3bf9`, original operator `dread`.
  The earlier read-only audit found all 13 entries SPENT, totaling 61 sats;
  this run must obtain fresh evidence and require zero unspent again.
- Service work: reviewed ops rollout for eligibility metadata, then normal
  actor/device-scoped reset requests, keys held only in the running call,
  immutable completion and the subsequent fresh batch/record.
- First read tap: check full chip/key, version 2.1, zero unspent, expected
  13 spent, intact owner/PIN/record/tag and unlocked state; otherwise stop.
- Cleanup tap: the operator enters the PIN privately. Only read/settlement
  query, the signed PIN-key/nonce read, one sealed VERIFY_PIN, one CLEAR_SPENT
  and read-back are allowed. Verify same chip/key/record, zero proof slots,
  owner/PIN unchanged. Stop on any refusal or uncertainty; no automatic retry.
- Reset tap: use only exact source escrow under the service intent; save
  deletion/rotation intents; allow only Cashu tag/card/opener/package deletion
  in the established order, bounded registry reads, source/factory cryptogram
  checks, factory-key restoration, identity/absence verification and completion.
  No authentication guesses or extra APDUs outside that engine.
- Fresh installation: one-card batch, pinned 2.1 CAP, assigned-key rotation,
  exact service acknowledgement and read-only state check. No funding, payment,
  holder-key extraction, deliberate tear, wrong PIN or other card in this drill.
- Optional independent post-check: the **ACS ACR122U PICC Interface** on this
  Mac may read CPLC, SELECT Cashu, GET_INFO, GET_PUBKEY and tag selection only,
  once after installation; no USB authentication or writes.

The operator approved this service/device/card plan on 2026-10-23. SuperMax
completed inspection, fresh settlement/PIN cleanup (13 spent entries to zero),
the separate reset, and a one-card fresh installation. The new installation is
batch 6, attempt `ba9aa33e-78a4-4d5d-913a-3e16a540aa6a`, public-key ending
`72fe`, with service completion acknowledged and no pending record. The operator
also verified that Stop for now preserves the same saved zero-slot reset review
across navigation after the keyboard and safe-exit updates.

See the [dated hardware report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
for evidence, source versions and coverage limits. The optional independent USB
post-check awaits card placement. No holder setup or funding followed the fresh
installation in this drill.
