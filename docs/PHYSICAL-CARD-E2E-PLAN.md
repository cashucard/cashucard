<a id="physical-card-end-to-end-plan--09336320"></a>

# Physical card end-to-end plan: 09336320

Status: operator approved on 2026-10-23, including the named devices, normal
production app traffic and the 100-sat funding/fees cap. The production block
was reconciled with separate approval. The core physical run completed using
61 sats and four payments on Pixel and Max, ending with zero unspent slots;
see the [run report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md) for
observed results and the unverified forced-change subcheck. The review video
has not yet been recorded.
The successful USB reset is recorded in the
[reset report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md).

## Devices, accounts and value bound

- One card: `cplc-v1:4790d3213041093363205547`, serial `09336320`.
  At the start it had no Cashu package and verified factory manager keys.
  At the end it was installed, holder-owned, empty of unspent value, and still
  held 13 spent entries. No cleanup/reset is authorized by that final state.
- **SuperMax:** Cashu Provisioner, then Flash as the holder wallet. The holder
  key stays in this wallet; the operator service never owns the card.
- **Pixel:** Flash POS, for the first online and offline merchant tests.
- **Max:** Flash POS, for a final online payment and iOS-terminal coverage.
- **ACS ACR122U PICC Interface:** bounded read-only identity/state checks.
- Use only the operator's own wallet and merchant accounts. No third-party
  recipient, production mint administration, balance override or database edit.
- Proposed funding: **64 sats**, with cumulative new funding and fees capped
  at **100 sats**. Stop before any operation requiring a higher amount.
  During execution, Flash's USD Cash-wallet input produced a reviewed
  **USD 0.05 → 61 sats** quote with no fee shown. That smaller load was used;
  subsequent payments and balance reconciliation use 61 sats, with no increase
  to the total cap or number of permitted payments.

Live app traffic would use `forge.flashapp.me` and the provisioner's configured
production ops-service origin. AGENTS.md prohibits production and device work
by default, so the operator must explicitly approve this narrow exception
before any agent-driven device action or live test traffic. No such exception
is implied by the earlier USB reset approval.

## 0. Baseline and readiness

Record installed app versions and verify that the phones use real NFC, without
a cardsim bridge or a mint/payment stub. Confirm the configured mint, holder
wallet and merchant destinations before funding. Note starting balances and
settlement counts. Stop if unrelated pending payments, unsettled card change,
unknown exposure or another card attempt prevents an isolated test; retain
that state rather than clearing queues or storage.

Readiness checks may enumerate these devices and read their installed app
versions. No native rebuild, app-data wipe or signing change is planned.
Screenshots/evidence are restricted to app versions, card public identifiers,
test balances and receipts. Do not capture PIN, seed or private-key screens,
wallet Keychain data, raw proofs or broad device logs.

## 1. Provisioning on SuperMax

Create/review a one-card batch in the provisioner. Move only card 09336320 from
the USB reader to SuperMax and keep it steady through installation and manager
key rotation. Require 100% and a saved completion receipt. Retain the public
installation record; it must bind the same CPLC to a new applet public key.

An error, ambiguous write or saved-work conflict stops this phase. Do not
create another attempt or reset the card to bypass it.

For the independent post-check, return this card alone to the named USB reader.
Permit SELECT ISD / GET CPLC, SELECT full Cashu applet AID / GET_INFO /
GET_PUBKEY, and SELECT tag, once per approved checkpoint. Verify version 2.1,
the newly recorded public key, empty/unowned state and tag. No GP authentication
or management operation is part of this post-check.

## 2. Holder setup in Flash on SuperMax

Read the card in Flash and select its setup flow. Confirm the intended mint
and wallet-controlled ownership. Require seed-backed owner recovery already
verified by the holder, or stop to review any device-only custody warning.
The holder chooses and confirms the PIN privately; never send it to an agent.

Complete wallet setup, read back the configured state and prove this wallet's
owner authority through its normal flow. Check ownership/PIN status and zero
balance before loading. Do not use a published test owner key or an issuer key.
No wrong-PIN or lockout test is included.

## 3. Load a small amount

Use Flash's normal card top-up against Forge. Review **64 sats** and the actual
fee before confirming; stop if the total funding/fee bound would exceed 100.
Require one paid quote, a completed mint/load, and a fresh card read showing
the expected amount. A paid-but-pending load is reconciled through that same
record; it is never paid again merely because a reply was lost.

## 4. Online payment and change on Pixel

Use the holder's own Flash POS merchant account. Start with an 8-sat partial
bill and review its card plan. Select a small bill/plan that actually exercises
change, within the funded balance and original budget. If the first eligible
bill is exact, it may be followed by another small online bill; at most four
test payments in total are permitted, including the offline and final payment.

The holder enters the known PIN privately. Keep the card through the app's
required taps and change write. Record the payment receipt, card debit,
merchant settlement and returned change. Reconcile the amounts against shown
fees; a success animation alone is insufficient. Stop on ambiguous debit or
owed change before starting another bill.

## 5. Offline acceptance and later settlement on Pixel

Cache current mint keysets through the preceding online operation. Prepare
the next small invoice while online, then disable both Wi-Fi and mobile data
on Pixel, leaving NFC available. Choose an exact eligible bill, initially
8 sats, whose selected inputs need no change. The current POS intentionally
refuses change-bearing or unverifiable offline payments before burning funds;
do not bypass such a refusal or describe offline change as supported.

Complete one eligible offline tap. Verify the card debit and a durable pending
merchant receipt while Pixel is still offline. Restore connectivity and require
that same receipt to settle once, with the merchant's resulting balance and
card balance reconciling. A rate-limited or uncertain result is inspected, not
paid a second time or removed from the queue.

## 6. Final online payment on Max

Once Pixel's settlement and change are resolved, use the holder's own Flash
POS account on Max for the remaining card balance, subject to the same funding
bound and review of actual fees. Verify the iOS NFC path, merchant settlement
and a fresh zero card balance. A merchant ecash/till balance may be retained;
Lightning payout is not assumed merely from mint settlement.

Retain the holder key, installation record and receipts. Any spent-slot cleanup
or issuer reset for the later review video is separately checked after value
and outstanding change are accounted for; do not delete an applet to empty it.

## Pass evidence and boundaries

The run passes when one physical chip has a recorded installation, holder-owned
setup, a reconciled load, an online change-bearing payment, an offline exact
payment that later settles once, and a final reconciled balance. Record actual
versions, identifiers, amounts, fees, receipt states and uncovered behavior in
a hardware report.

No video is required for this test. Foxy ownership/compatibility is a separate
wallet run; this plan does not move an owner key between wallets. No deliberate
NFC tear during a funded write, guessed authentication, payment replay or
service recovery-fence bypass is authorized. On an uncertain card/payment
state, stop that phase and preserve its record before continuing.
