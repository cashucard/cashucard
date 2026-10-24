# Mobile reset and reuse — J3R180 09336320, 2026-10-23

Status: **on-phone cleanup, reset, fresh installation and independent USB
post-check passed**. This run validates the
mobile lifecycle added for [issue #92](https://github.com/lnflash/cashu-card/issues/92),
under the operator-approved [device/card plan](OWNED-CARD-MOBILE-RESET.md).

## Environment and identities

- SuperMax: iPhone 17 Pro (`iPhone18,1`), iOS 26.6.2 (`23G90`), CoreDevice
  `FCA5FD0D-FFE0-551B-A6F4-D7BC44EC956D`.
- Cashu Provisioner **1.0.0 (7)**, local Apple Development-signed Release build,
  not an App Store distribution artifact. Final installed source corresponds to
  merged commit `860eba49a16dcb36b5cff651e18d13a98c90f405` (#137), compiled from
  `ccfca31717c2e0b3a368872834cbe3321a380db0` with an identical app/cardkit tree.
  Cleanup ran before the keyboard and safe-exit follow-ups; reset and fresh
  installation ran after them. Updates preserved app data and API origin.
- API: `https://cashu-card-ops.old-cell-30e7.workers.dev`, operator `dread`
  (ID 2), scope `issued`, device `13a57a08-01bf-47a6-9d3a-aacfd462b01f`.
  Production Worker version `e3591bcb-2492-404c-aaae-40ee2a22a3d0`, service source
  `4dc623930d2a21f5527993f8fbcfd1d519dc0a19`.
- Chip: **cplc-v1:4790d3213041093363205547**, serial **09336320**.
- Old installation: batch 5, attempt `65bfdfd9-60b0-43c2-a95d-06b5012e3bf9`,
  public key `031b63ab2c73c8825952be146d6a71b6a3c17353276a8fc234d990e0a45a3f11f6`.
- New installation: batch **6**, attempt
  **ba9aa33e-78a4-4d5d-913a-3e16a540aa6a**, public key
  **0211f04ddf909750ff73bb7e4d9e7b68c2a2e860e05c6f39b95b8edc1ea24872fe**.
- Unchanged tracked protocol 2.1 CAP:
  `applet/target/cashu-javacard-2.1.0.cap`, SHA-256
  `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
  The exported load-file SHA-256 is
  `fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee`.
  These identify pinned inputs; installed CAP bytes were not extracted.

## Physical sequence and evidence

1. The read-only reset review matched the full chip identity, old card-key
   ending `5a3f11f6`, **0 unspent and 13 retained spent entries**, and the recorded
   Forge mint. A user-supplied screenshot captured that review. The preceding
   [build 6 end-to-end run](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
   had consumed the card's 61 sats and completed the reported settlements.
2. The operator completed card-specific consent and entered the PIN privately.
   The mobile flow requires fresh mint confirmation of every retained entry as
   SPENT before sealed PIN verification and cleanup. The resulting screenshot
   showed the same chip and old key at **0 unspent / 0 retained spent**, with
   **Ready to reset this card**. This is app-reported physical cleanup and
   read-back; raw proof material and the PIN were not collected.
3. The PIN field had been covered by the keyboard. #136 added native keyboard
   scrolling and a dismissal-only Done action. On resuming after sign-in, the
   operator also found no obvious exit from the saved reset. #137 added safe
   exits and cancellation guards throughout the app. Both passed all 30 CI
   checks before merge. The operator confirmed **Exit works; same saved card
   at 0 / 0** after the update. Cleanup was not repeated just to test layout.
4. The operator performed the separate approved reset tap and reported
   **Reset complete**. The application's completion path verifies factory-key
   recovery and known-package absence, then records service completion. This
   report does not claim a separate USB manager-key authentication or a captured
   command transcript. No app storage was erased to bypass saved history.
5. The operator created a one-card Forge batch and performed a fresh installation
   on the same chip, stopping before holder setup or funding. Their completion
   screenshot showed **1 of 1 attempts finished**, **1 installed · 0 stopped**,
   card ending **72fe**, attempt ending **40aa6a**, chip ending **63205547**.
6. Both supplied public exports agree. The support export identifies the full
   new chip/key/attempt above with `stage: recorded`,
   `completion_acknowledged: true`, `record_pending: false`, no quarantine reason,
   no active attempt and no failure. `ready_for_payments: false` correctly
   separates installation from holder-wallet setup. The full new public key
   differs from the old one.

The exports are phone-produced public evidence of the service acknowledgement,
not a separately downloaded server receipt. Screenshots and exports were retained
locally in the protected validation directory; no private keys, PINs, passwords, proof
secrets or authentication transcripts are included in this report.

## Independent USB post-check

At **2026-10-24T00:16:32Z** (October 23, 17:16 Pacific), one connection to the
**ACS ACR122U PICC Interface** sent exactly six commands: SELECT ISD, GET CPLC,
SELECT full Cashu applet AID, GET_INFO (30-byte form), GET_PUBKEY and SELECT tag.
Full CPLC matched before applet inspection. The complete public key matched the
acknowledged batch 6 export above and differed from the removed installation.

| Observation | Result |
| --- | --- |
| SELECT and GET_INFO version | 2.1 |
| Proof slots | 0 unspent, 0 spent, 128 empty |
| Owner / PIN / card record | None / none / unset |
| Locked | No |
| NFC tag | SELECT succeeded |
| Authentication / writes / retries | None / none / none |

Before this successful invocation, two reader-discovery attempts found no PC/SC
reader and made **zero connections and zero card commands**. The operator
reconnected the reader and requested another invocation. Those readiness stops
were not authentication failures or automatic card-command retries.

The check independently confirms the installed public identity and fresh state.
It does not authenticate manager keys, extract CAP bytes or read NDEF contents.
Only its public summary was retained; no APDU transcript or proof material was
captured. The card remains awaiting holder-wallet setup before funding/spending.

## Coverage limits

- This successful path used the original production operator/service escrow.
  It does not make foreign or missing escrow eligible; cross-service historical
  reconciliation remains an explicit administrator procedure.
- There was no deliberate tear during destructive reset/rotation, wrong-PIN
  test, uncertain-value override or operation on another card. Software
  interruption regressions are not claimed as physical tear evidence.
- The PIN keyboard change was built and regression-tested, but PIN entry was
  not repeated physically after cleanup because no spent entries remained.
- The fresh card was not personalized, loaded or spent in this run. The earlier
  build 6 end-to-end evidence remains separate. No Apple review video or store
  upload was produced by this drill.
