<a id="physical-card-end-to-end-run--j3r180-09336320-2026-10-23"></a>

# Physical card end-to-end run: J3R180 09336320, 2026-10-23

Status: **core physical end-to-end path passed on Android and iOS; specific change-amount evidence remains unverified**.
The operator approved the [named-device plan](PHYSICAL-CARD-E2E-PLAN.md),
including normal production app traffic, 64 sats of proposed funding and a
100-sat cumulative funding/fees cap. The actual load was USD 0.05 for 61 sats,
with no fee shown. Four payments consumed all 61 sats; no further funding or
card reset was performed.

| Step | Terminal/network | Bill | Fresh Flash balance |
|---|---|---:|---:|
| Initial load | Flash on SuperMax | n/a | 61 sats |
| First payment | Pixel, online | 8 sats | 53 sats |
| Second payment | Pixel, online | 9 sats | 44 sats |
| Offline acceptance | Pixel, Wi-Fi and mobile data off | 8 sats | 36 sats |
| Final payment | Max, online | 36 sats | Empty |

The independent final USB check confirmed the same installation identity,
zero unspent slots, 13 spent slots, and retained owner/PIN/configuration. Pixel's
offline payment automatically settled and swept after reconnecting. Max's
final payment was reported settled. Evidence distinguishes direct USB reads,
authenticated service observations and the operator's app/receipt reports.

## Initial mobile attempt

The operator reported creating a one-card batch on SuperMax and tapping card
09336320 before the baseline checks. The app displayed:

> This chip has an unresolved attempt. Keep the card aside and ask your
> operator to reconcile its history. Do not start another attempt for it.

Source inspection identifies this as the service's `chip-unresolved` conflict
at binding. `runProvisioningTap` waits for binding acknowledgement before
installation inspection, install intent or card authentication/mutation.
Retain the current batch and phone journal. Replacing them would bypass
the refusal. Installed app version and exact production attempt are pending
verification at this point in the run.

Authenticated production console inspection subsequently found:

- Blocking attempt: `fc65e485-9025-4924-a96e-6fe0c68b58d9`, batch 1,
  operator `production-lead`, `quarantined`, revision 2, exact target CPLC.
- New attempt: `65bfdfd9-60b0-43c2-a95d-06b5012e3bf9`, batch 5,
  operator `dread`, `active`, revision 0, no chip binding.
- Original phone device ID: `13a57a08-01bf-47a6-9d3a-aacfd462b01f`.

Production batch 3's recorded chip is the different card `09336120`; its
record is not authority for resetting or reconciling `09336320`.

## Independent USB checkpoint

After the operator placed the card back on the ACS ACR122U PICC Interface,
the approved read-only preflight ran once, at approximately
2026-10-23T16:16Z, from commit `feca365`:

```json
{
  "authentication_attempted": false,
  "chip_id": "cplc-v1:4790d3213041093363205547",
  "installation": "absent"
}
```

The Python 3.10/pyscard environment made one reader connection and sent
SELECT ISD, GET CPLC and SELECT Cashu applet. Selection returned applet absence,
so no GET_INFO, GET_PUBKEY or tag read followed. No authentication, write,
key rotation or retry occurred.

The tracked 2.1 CAP SHA-256 is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`;
this checkpoint did not load a CAP or measure prior installed bytes.

## Reconciliation gate

The [successful reset](HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md)
was completed against the original local escrow authority. It did not clear
any target production quarantine. D96 deliberately preserves such blocks;
the service deployed at the initial check had no cross-service reconciliation
action.

Inspect the exact target attempt through authenticated read-only history.
Any reconciliation must preserve its original binding, terminal disposition,
escrow and receipts, and explicitly tie the release to the reviewed local
reset completion. Do not edit/delete old attempts or treat an arbitrary
foreign receipt as automatic authority. A reviewed implementation and a
separately approved target-service action are required before releasing a
production fence.

The D99 implementation adds administrator review, immutable evidence
and a narrowly scoped fence release. The source database's retained `reset_results`
metadata was read privately and matched the prior hardware report's reset ID,
removed installation, factory-key version and completion time. No escrow keys
were read for this comparison.

## Approved service rollout and renewed observation

PR #122 passed all 30 CI checks and merged as
`ddb27190640fc908553097f04845733eb2cc7a60`. The operator separately approved
production deployment and the one-chip reconciliation. Wrangler deployed that
source with the explicit production configuration, Worker version
`229f6a5e-573a-4fa6-a29e-a69e4d855252`, preserving the existing OpsStore/R2
bindings, both origins and `17 3,15 * * *` backup schedule. Both public origins
returned HTTP 200 with the new review action; anonymous installation-history
access returned HTTP 401. The console retains no-store and restrictive CSP.

The rollout applies migrations 9–11 when opening the existing service database.
Recovery exports now require v7-capable tools. Use a compatible forward fix or
the reviewed restore process if recovery is needed; an older binary is not
assumed to understand released admission fences or the new export metadata.

A fresh approved USB preflight at Unix `1792773639` again matched the exact
CPLC and applet absence. It made one connection and the same three read-only
commands, with no authentication, mutation or retry. A public reconciliation
packet was prepared from this observation and the retained original source
completion; no production reconciliation has been submitted at this point.
The service enforces independent-backup freshness before accepting a release.

## Production reconciliation accepted

After the operator signed into the updated console as `production-lead`, the
approved action was submitted once through the console for target attempt
`fc65e485-9025-4924-a96e-6fe0c68b58d9`, revision 2. The packet used the retained
local source completion and the renewed USB observation above. The console
reported success, closed the review dialog and refreshed installation history
from the service. That history showed the original **Quarantined**, revision 2
row with **Reset reconciled** added. Batch 5's
`65bfdfd9-60b0-43c2-a95d-06b5012e3bf9` remained **Active**, revision 0, unbound.

The service's required independent-backup gate precedes this mutation and
accepted the release. A separate backup-status read did not complete through
the browser automation, so no specific last-copy time is claimed here. The
immutable reconciliation packet/receipt are retained by the service; the local
public packet and a console-state observation were also retained. The latter
is UI confirmation. A downloaded server receipt was not captured.

No card command was sent by this action. No historical row or escrow was
deleted, no failed installation was marked successful and no factory-key
authentication was attempted during reconciliation. The operator was then
asked to resume the existing Card 1 in batch 5 on SuperMax, rather than create
a new reservation.

The connected SuperMax was identified as iPhone 17 Pro (`iPhone18,1`), iOS
26.6.2 (`23G90`). Native installed-app enumeration returned no app metadata,
including with all-app enumeration, so the provisioner/Flash app versions
remain unverified; this is not evidence that the apps are absent. Pixel was
not connected over ADB at this checkpoint. Max's merchant test remains later
in the plan. No app build, installation or data wipe was performed by the agent.

## Fresh mobile installation and independent post-check

The operator resumed the existing batch 5 on SuperMax. Their screenshot at
09:55 on October 23 showed **1 rotation record · 0 stops**, Card 1 ending
`11f6`, attempt ending `2e3bf9` and chip ending `63205547`, with installation
and rotation recorded. A refreshed production console independently showed
attempt `65bfdfd9-60b0-43c2-a95d-06b5012e3bf9` as **Recorded**, revision 2,
operator `dread`, bound to full CPLC
`cplc-v1:4790d3213041093363205547` on the original phone device ID.

After the operator put that card alone back on the ACS reader, the approved
read-only post-check ran once at Unix `1792774627`. SELECT and GET_INFO both
validated applet version **2.1**. Its public observations were:

```json
{
  "chip_id": "cplc-v1:4790d3213041093363205547",
  "installation_id": "031b63ab2c73c8825952be146d6a71b6a3c17353276a8fc234d990e0a45a3f11f6",
  "unspent": 0,
  "spent": 0,
  "empty_slots": 128,
  "has_owner": false,
  "pin_state": "none",
  "record_set": false,
  "locked": false,
  "tag_present": true,
  "authentication_attempted": false
}
```

The new applet public key differs from the removed installation and matches
the suffix in the phone's completion screen. The entire public key has not
yet been compared to an exported service completion record. Tag presence here
means SELECT tag succeeded. Its NDEF contents were not independently read.
No GP authentication, manager-key check, card write or retry was performed by
this checkpoint. The app's recorded key rotation is not claimed as a separate
USB authentication test.

The operator was asked to open this card's setup screen in Flash on SuperMax
and report seed-backed versus device-only ownership before committing setup.
No owner key, seed or PIN is requested from the operator or read by the agent.

## Holder setup reported complete

The operator read the new card in Flash on SuperMax and reported the message
that its owner key comes from the wallet's recovery phrase. They then confirmed
both a verified recovery backup and successful setup after the guided private
PIN/owner flow. The agent did not view or collect the phrase, PIN, wallet keys
or Keychain data.

The operator was then asked to read the card again and review a top-up before
paying, under the existing **100-sat cumulative funding/fees cap**. The actual
quote/load differed from the proposed 64 sats as recorded below.

<a id="first-load--61-sats"></a>

## First load: 61 sats

The installed Flash UI accepted the amount through its USD Cash-wallet field.
The operator entered **USD 0.05**; the review showed **61 sats** loaded onto
card `031b63ab…3f11f6`, **Fee: None**, paid from the Cash wallet. The initial
screen quoted five of 128 free card slots. This establishes a sat-denominated
card load funded from USD; it is not a USD-denominated card test. No particular
covering-ladder shape is inferred from the local source checkout.

The lower actual amount replaces the proposed 64-sat funding amount for this
run, within the unchanged 100-sat cumulative funding/fees cap. The operator was
instructed to pay once and preserve the same top-up if payment or loading was
uncertain. They reported **Loaded successfully; balance is 61 sats**. This is
operator-confirmed wallet evidence; no raw proofs, quote secrets or private
wallet history were retrieved. No second funding request was made.

## Pixel online payment baseline

The operator confirmed that Pixel's Flash POS is using their merchant account,
networking is on, no older Cashu settlements are pending, and the prepared
charge is exactly **8 sats**. They were asked to complete that one charge,
follow its private PIN/NFC prompts, then re-read the card in Flash and report
the merchant receipt status, fee/change and remaining card balance. The
fee-free expected balance was 53 sats.

<a id="first-online-payment--8-sats"></a>

## First online payment: 8 sats

The operator reported that the 8-sat payment succeeded on Pixel and that a
fresh read in Flash showed **53 sats**. The observed card debit therefore
equals the bill: **61 − 8 = 53**, with no additional card debit observed.
This confirms the operator-observed payment and card balance; no separate
merchant receipt or mint settlement record has been exported to the agent.

Before the next bill, the operator was asked to check that the first payment
has no pending settlement or change owed. A settled merchant till balance
awaiting Lightning payout is distinguished from an unsettled card payment.
If clear, the next approved online bill is **9 sats**, followed by every
required change-return tap and another fresh card balance. Its expected
remaining balance was 44 sats.

<a id="second-online-payment--9-sats"></a>

## Second online payment: 9 sats

The operator reported that a new 9-sat charge succeeded on Pixel and that
Flash showed **44 sats** after reading the card. Card value reconciles as
**61 − 8 − 9 = 44**. The final balance does not show an additional card debit.
The intended change-bearing bill was completed, but the operator has not
reported an explicit change amount from its receipt; **7 sats is the expected
change; the amount was not separately captured**.

The operator first observed **15 sats in the till / settled at the mint**,
then performed the 9-sat charge. This earlier till snapshot is not compared
to both bills' combined 17 sats. After the second charge, the operator quoted:

> 9 sat settled at the mint; it sweeps to your wallet once the till reaches 10 sat

This is the terminal's report of settled ecash below its payout threshold,
not an unsettled-payment warning. A prior sweep or starting settled balance
has not been independently measured, and no completed Lightning payout is
inferred from this earlier snapshot. A read-only request to Forge's public `/v1/keysets` during this
check listed active sat keyset `0059534ce0bfa19a` with `input_fee_ppk: 0`;
no unexplained till difference is attributed to mint input fees.

The next operation was an 8-sat charge prepared online on Pixel, then completed
with Wi-Fi and mobile data disabled and NFC enabled, as recorded below.

<a id="offline-acceptance--8-sats-on-pixel"></a>

## Offline acceptance: 8 sats on Pixel

Following the instruction to disable both Wi-Fi and mobile data on Pixel
while retaining NFC, the operator reported that the 8-sat charge went through
offline. A fresh Flash read on SuperMax showed **36 sats**, reconciling the
card debit as **44 − 8 = 36**. No new top-up or second charge was requested.

The operator then supplied Pixel's offline queue message:

> 17 sats in the till - 1 tapped payments settle automatically when online.
> 9 sat settled at the mint; it sweeps to your wallet once the till reaches 10 sats

The displayed total reconciles as **9 sats already settled + 8 sats pending**.
This distinguishes offline acceptance from completed mint settlement. It
observes the saved queue through the terminal UI; process-restart durability
was not tested, and no raw signed proofs were extracted.

The operator was next asked to restore connectivity and leave POS open for
automatic settlement of that same record, without another card tap, bill,
manual dismissal or repeated settlement request.

## Automatic reconnect settlement and sweep

The pending message remained longer than the initial one-minute observation.
The operator asked about Settle now versus foregrounding. Before pressing
anything, they reported that the pending message disappeared and the sweep's
transaction appeared in Flash. Therefore this recovery completed automatically,
without a manual settlement trigger, another card tap or a repeated charge.
The exact payout amount/transaction ID has not been exported, so no cumulative
Lightning-payout total is claimed. The terminal's reconnect delay is recorded
as observed behavior; a particular backoff interval or cause is not proven.

<a id="final-online-payment-on-max--36-sats"></a>

## Final online payment on Max: 36 sats

Before the charge, the operator confirmed that Max (iPhone 13 Pro Max) was
online, signed into their merchant account, had no older pending settlements,
and was ready for a 36-sat Cashu card charge. They completed it and reported
**merchant payment status: settled**, with a fresh Flash read showing **empty**.
The four bills reconcile exactly: **8 + 9 + 8 + 36 = 61 sats**. No fifth
payment or second top-up was requested.

## Independent final state and release build

After the operator returned the card to the ACS reader, the final approved
read-only check observed the same CPLC and full applet public key, version
2.1, **0 unspent**, **13 spent**, **115 empty** slots, **owner present**,
**PIN set**, **record set**, **not locked**, and a selectable NFC tag.
No authentication, clearing, reset, manager operation or retry occurred.
The operator confirmed Cashu Provisioner Settings displayed **1.0.0 (6)** on
SuperMax; native app-package enumeration had not provided that metadata.

The card is empty and retains its ownership and installation. Reuse requires the
separate reset flow. The 13 spent entries have not been cleared. Preparing it
for another actual installation requires a separately reviewed settlement
audit/cleanup and reset; the final read-only checkpoint does not authorize those
writes.

## Read-only settlement audit

After PR #125 passed all 30 CI checks and merged as
`1779f5537d4f6166cbe73b05e34922addb615ac4`, the operator separately approved
the [bounded audit plan](SPENT-SETTLEMENT-AUDIT-PLAN.md). It ran once from
that commit against the same card on the ACS ACR122U PICC Interface, with
the Homebrew Python/pyscard environment. At **2026-10-23T20:28:24Z**
(Unix `1792787304`), the summary reported:

- Exact CPLC and full applet public key matched the installation above.
- **0 unspent**, **13 spent**; the mint confirmed all 13 unique derived proof
  identifiers **SPENT** through its read-only `/v1/checkstate` query.
- Retained face value: **61 sats**. Denominations: three each of 1, 2, 4 and
  8 sats, and one 16-sat entry.
- Evidence SHA-256:
  `5b872dd483bce1bd5dabe38e5fa150968f3151a464513ec04d1bf88566cfe35f`.
- **No authentication or writes**. Raw proof fields and derived identifiers
  remained in private pipe/process memory and were not printed or saved.

Only the public summary was retained locally. This establishes the mint's
spent-state responses for the retained entries at that observation time;
it does not export the merchant ledger, prove a particular change plan, or
authorize clearing/resetting the card. The 13 entries remain on the chip.
A later write requires fresh checks and separate device/action approval.

## Not covered

- The intended forced-change subcheck has no explicit receipt/input-plan
  capture. The 9-sat bill and final balances passed, but 7 sats of returned
  change is not independently established. The final spent count alone does
  not prove which intermediate change plan was used.
- Holder recovery was backup-confirmed by the operator. A second-phone
  restore was not performed. The pending queue was observed while offline; it was not tested
  through a process restart.
- No independent mint ledger export, full payout reconciliation, native
  wallet/POS build identification, installed-CAP byte extraction, full service
  completion-record public-key comparison or NDEF-content read was performed.
- Foxy, deliberately interrupted funded writes, wrong-PIN/lockout behavior,
  other cards and the Apple review video are outside this run.
