# Physical card end-to-end run — J3R180 09336320, 2026-10-23

Status: **blocked before installation; not an end-to-end pass**.
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

The prepared D99 implementation adds administrator review, immutable evidence
and a narrowly scoped fence release. It is not deployed and no production
history has been changed. The source database's retained `reset_results`
metadata was read privately and matched the prior hardware report's reset ID,
removed installation, factory-key version and completion time. No escrow keys
were read for this comparison.

## Not covered

Fresh provisioning, holder setup/recovery, funding, online payment/change,
offline acceptance/settlement, final balance, Max terminal coverage and the
Apple review video have not run. Applet absence alone is not a fresh
verification of factory manager keys; that evidence remains the prior reset
completion.
