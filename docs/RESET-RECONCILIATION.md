# Reconcile a completed reset at another service

A successful reset at its original escrow custodian does not clear a different
service's earlier quarantine. This action releases one terminal attempt's
chip admission block while preserving its original state, revision, binding,
disposition, receipts and escrow. It does not reset a card or import keys.

Only a deployment-designated administrator may use this action. A foreign JSON
receipt is unsigned: the administrator must check the source's actual retained
completion against the reviewed reset run. Do not rely on a packet supplied by
an unknown party. Applet absence alone does not prove factory manager keys.

## Procedure

1. Retain the original phone's saved work. Read the target service's history
   and identify the exact bound, quarantined/abandoned attempt and revision.
   Active attempts and installed cards without a completed reset need a
   different recovery procedure.
2. Verify the source's public reset completion and receipt against its retained
   records, including full CPLC, removed applet public key, source attempt,
   reset ID, factory-key verification/version and times. Never transfer escrow
   keys, an unredacted database, wallet secrets or backup decryption material.
3. Under the named-device plan, independently read the same chip's CPLC and
   verify applet absence. Record the observation time. The action requires
   this observation within 15 minutes. Check for intervening work; do not
   overwrite newer installation or reset history.
4. Review the current independent-backup status. The service refuses a release
   when its configured independent copy is stale or it is fenced after restore.
   Before deploying this revision, retain a known-good recovery point and use
   restore tools that understand export v7. Migration 11 preserves old rows
   and adds the audit table and a scoped admission-fence flag; deployments from
   the prior production revision also apply migrations 9 and 10.
5. In Installations, open that attempt and choose **Review completed reset**.
   Supply the public packet below, verify the chip/attempt shown, and explicitly
   confirm review. The service records actor, evidence, packet hash and time.
   It rejects stale or changed targets, future/expired observations, a pending
   reset, newer target bindings/installations and reuse of the same source
   reset for another attempt. No request sends a card command.
6. Retain the returned receipt. The original state still appears, with **Reset
   reconciled**. Resume only an existing unbound reservation on the original
   phone, after its saved-work check succeeds. Do not create a replacement
   batch or clear a phone journal to bypass uncertainty.

The HTTP operation is
`POST /admin/provisioning/attempts/:attempt_id/reconcile-reset`, using the
administrator's normal session. An identical packet returns its original
receipt; a changed packet cannot overwrite it. If a response is lost, retry
that exact packet before making a new observation or changing the evidence.
Restore fencing still takes precedence over a replay.

## Public evidence packet

```json
{
  "revision": 2,
  "chip_id": "cplc-v1:4790d3213041093363205547",
  "source_origin": "http://127.0.0.1:8821",
  "completion": {
    "reset_id": "a87bce68-10b5-4498-be7a-626f895de90e",
    "source_attempt_id": "ac3575ad-6be4-4595-b213-97f89afabda6",
    "chip_id": "cplc-v1:4790d3213041093363205547",
    "removed_installation_id": "036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490",
    "gp_key_version": 1,
    "manager_keys": "factory",
    "cashu_package": "absent",
    "verified_at": 1792768691
  },
  "receipt": {
    "reset_id": "a87bce68-10b5-4498-be7a-626f895de90e",
    "chip_id": "cplc-v1:4790d3213041093363205547",
    "removed_installation_id": "036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490",
    "operator_id": 1,
    "device_id": "c63b8c38-0a59-43f8-b17b-a03cefa48912",
    "completed_at": 1792768691,
    "manager_keys": "factory",
    "cashu_package": "absent"
  },
  "observed_absent_at": 0,
  "evidence_ref": "docs/reports/HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md",
  "reviewed": true
}
```

This example contains public evidence for the approved card 09336320. Its
observation time is deliberately zero and cannot authorize a release: replace
it only with a real observation under the approved plan. The target production
attempt is `fc65e485-9025-4924-a96e-6fe0c68b58d9`, revision 2. It has not been
reconciled by preparing this document.

Export v7 validates the relationship between each released flag and its audit
row and rejects missing or changed evidence. Legacy v1–v6 exports remain
readable; they never invent a release. Restored services stay globally fenced.
