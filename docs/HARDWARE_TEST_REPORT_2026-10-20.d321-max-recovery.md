# Max fresh-card recovery drill — in progress

ENG-741, 2026-10-20. After merging PRs #27–#29 and completing the
[setup checks](HARDWARE_TEST_REPORT_2026-10-20.max-validation-setup.md), the
operator approved the separately presented Max write/recovery scope with
“ok continue.” That scope names disposable test card
`cplc-v1:4790d3213041093361205547`, serial **09336120**, unchanged factory
keys, pinned applet installation, one assigned-key rotation and three planned
process-loss boundaries. No personalization, funds or mint operations.

## Starting evidence

- Max: iPhone 13 Pro Max, UDID `00008110-001E4CC014D8401E`.
- Installed validation build and hashes: setup report above, including #29.
- Device identity: `afb0fc20-c68d-4159-8e7d-7eff4b8bf67b`.
- Dedicated Max service batch 1, count 1, next ordinal 0.
- Native persisted workflow exactly matches the setup checkpoint; no active
  attempt, empty history. Dedicated service has zero provisioning attempts.
- Consistent pre-write database and matching private runtime retained.
- Committed release gates remain false. Other phones/cards are excluded.

## Execution

The operator confirmed `installation-verified-before-save` was armed, then
was instructed to tap Install once and hold the candidate at Max until the
native pause named that boundary and saved `install_intent`. The operator
replied “done”; this does not independently establish the sheet message.

A scoped native AsyncStorage copy instead found:

- Attempt `8c3f8148-e23c-419f-accf-66b9721ab39b`, ordinal 0, revision 1.
- Bound chip `cplc-v1:4790d3213041093361205547`, the approved candidate.
- Stage `quarantined`, reason `unsafe-partial-install`.
- Preinstall inspection `absent`, installation ID null, replacement consent false.
- No saved installation ID, rotation evidence or frozen record.
- Dedicated service contains one attempt. A consistent private database backup
  and native journal copy were retained at this stop.

Stopped the drill without restarting, clearing the journal or issuing another
card command; instructed operator to remove the card and not retry. Requested
the observed screen message and whether Install was tapped once. The actual
physical installation state and command history are not established by this
journal. No successful installation, rotation or recovery result is claimed.
Further card inspection or repair needs a separately scoped plan.


## Approved read-only USB follow-up

Operator approved continuing with the proposed read-only inspection, then
confirmed card 09336120 was on the ACS ACR122U PICC Interface. Ran the existing
bounded preflight once from this checkout using its Homebrew-backed cardctl
venv and the full expected CPLC. One PC/SC connection selected ISD, read CPLC,
and selected the full Cashu applet AID; result was `installation: absent`,
`authentication_attempted: false`. No later state/key/tag read was sent because
the applet was absent. No authentication, mutation or retry occurred. An initial
host invocation used a nonexistent venv path and exited before Python or any
reader access; the corrected invocation made the single connection above.

This is evidence of no selectable Cashu applet, not a package inventory or a
proof that no earlier installation command ran. It cannot establish key state.
The quarantine guard deliberately rejects an absent/partial applet after a
saved install intent; it does not authorize another install or sweep.

All 15 reader-free provisioning-tap tests passed during diagnosis, including
fresh install, saved-boundary recovery and safe stopping. This does not explain
the physical failure. No native command trace was captured. The stopped journal
remains unchanged and no automatic card repair is planned.
