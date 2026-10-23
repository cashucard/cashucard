# Physical card end-to-end run — J3R180 09336320, 2026-10-23

Status: **reconciliation passed; fresh installation and funded end-to-end run pending**.
The operator approved the [named-device plan](PHYSICAL-CARD-E2E-PLAN.md),
including normal production app traffic, 64 sats of proposed funding and a
100-sat cumulative funding/fees cap. No funds have moved in this run.

## Initial mobile attempt

The operator reported creating a one-card batch on SuperMax and tapping card
09336320 before the baseline checks. The app displayed:

> This chip has an unresolved attempt. Keep the card aside and ask your
> operator to reconcile its history. Do not start another attempt for it.

Source inspection identifies this as the service's `chip-unresolved` conflict
at binding. `runProvisioningTap` waits for binding acknowledgement before
installation inspection, install intent or card authentication/mutation.
The current batch and phone journal must be retained, not replaced to bypass
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
the deployed service has no cross-service reconciliation action yet.

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
is UI confirmation, not a downloaded server receipt.

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

## Not covered

Fresh provisioning, holder setup/recovery, funding, online payment/change,
offline acceptance/settlement, final balance, Max terminal coverage and the
Apple review video have not run. Applet absence alone is not a fresh
verification of factory manager keys; that evidence remains the prior reset
completion.
