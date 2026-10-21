# Pixel replacement and interrupted-install recovery — three boundaries passed

ENG-741, 2026-10-20. The operator explicitly approved the bounded Pixel
write/recovery drill and requested merging #22, #23 and #24 first.
All three were merged after their final checks passed.

## Scope and baseline

- Pixel 8 Pro: ADB `42201FDJG00048`, app `com.islandbitcoin.provisioner`.
- Approved test card: `cplc-v1:4790d3213041093363205547`, serial `09336320`.
- Old public installation key:
  `0366bf811cadfcfc00e5f251017d1dc690a93a6a4a9d39ed114b96d33fb59d9941`.
- Operator confirmed replacement is permitted and keys have not changed since
  the earlier report's return to factory keys. No key trials are permitted.
- Merged main: `73c03eec88910aa634605365826c154e1f23e41c`.
  The isolated validation checkout moved to this commit, preserving only its
  local two-gate enablement. App/cardkit/ops trees exactly match the installed
  build's original source `a8cee93998dfff4f6254c65217ee78ec0e03d91d`; no
  native reinstall was needed. Build and bundle hashes are in the Pixel batch
  persistence report. Committed gates remain false.
- CAP SHA-256:
  `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
- Load-file SHA-256:
  `fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee`.
- Isolated local service only: Pixel loopback 8821 via USB to Mac loopback
  8822. Retained mode-0600 database/master and consistent pre-write snapshot
  are documented in the setup report. No mint or production access.

## Initial reservation and inspection

Batch 1, count 1; device `4794470b-dfef-447e-bbd8-7ebadcd9f41d`;
operator 1, issued environment. Armed `installation-verified-before-save`,
then tapped Install next card once. Service created the sole attempt:
`ac3575ad-6be4-4595-b213-97f89afabda6`, ordinal 0, revision 0,
active, chip not yet bound. The Pixel is waiting for the operator's inspection
tap. No card result, binding, authentication or mutation is claimed yet.

The read-only review is expected to end this invocation and clear its unvisited
pause. Before confirming replacement, rearm the installation pause and verify
the review's full chip/old installation identities. Do not infer mutation
approval from a mismatching or incomplete inspection.

## USB interruption before inspection evidence

While waiting for the operator to present the card, the Pixel disappeared
from ADB. No further device command succeeded. A host-side read of the sole
reservation still found revision 0, chip null, active. No service binding
or completed card inspection is established. The operator was asked to
reconnect USB and keep the card away while the same attempt is reconciled.
Do not count this interruption as any of the planned post-write boundaries;
no replacement was confirmed and no write result is claimed.

## Inspection completed and first planned boundary reached

USB returned with reverse mappings absent. Restored only 8821 -> 8822 and
8085 -> 8085. The operator confirmed the inspection tap and then USB
reconnection/card removal. The app reached replacement review displaying the
exact approved chip and full old installation key. Service state was the same
sole attempt, bound to that chip, revision 1. A private AsyncStorage copy
confirmed `reserved`, null current installation/preinstall. Retained a new
consistent service snapshot `before-replacement.db` in the private run
directory before mutation.

Rearmed `installation-verified-before-save` after the read-only invocation
cleared its original target. Verified the target in the panel, then pressed
Replace this installation. The operator held the same spare steadily at the
Pixel with USB connected. The durable journal advanced to `install_intent`
with preinstall key
`0366bf811cadfcfc00e5f251017d1dc690a93a6a4a9d39ed114b96d33fb59d9941`,
`replacement_consent: true`, inspection `empty-2.1-with-tag`, and the same
chip/attempt identity. No GP key version or current installation was saved.

After installation, the UI showed phase Done. Scrolling to the drill panel
confirmed the exact pause `installation-verified-before-save` and saved stage
`install_intent`. Forced app stop without Continue/Stop, then relaunched.
This is the first planned process-loss boundary. The checkpoint is reached
only after successful installation and complete inspection, before saving
`installed` or initiating key rotation. Manager keys have not yet been rotated
by this flow. No raw GP transcript or direct pre-kill new-key capture was made.

The operator was asked to lift the card and reauthenticate. Adoption of the
new installation, key rotation, remaining process losses and final record are
still pending; this is not a completed recovery pass.

## Second planned boundary: rotation verified before journal save

After operator reauthentication, the same interrupted-install attempt was
visible. USB mappings remained intact. Armed and verified
`rotation-verified-before-save`, then selected Continue with the same card.
The operator held the same spare steadily against the Pixel.

The UI reached exactly `rotation-verified-before-save`, saved stage
`rotation_intent`. A private AsyncStorage copy confirmed:

- Same attempt `ac3575ad-6be4-4595-b213-97f89afabda6` and chip ending 5547.
- Stage `rotation_intent`; saved GP key version still null.
- New full installation key:
  `036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490`.

The new key differs from the preinstall key, and the install-intent recovery
path adopted a complete installation before advancing to rotation. That code
path contains no DELETE/LOAD; no raw transport capture was taken to count
commands independently. The rotation checkpoint follows successful assigned
key rotation and confirmation, before saving `rotated`. Forced app stop at
this pause without Continue/Stop, then relaunched and requested operator
reauthentication. The card is now on the escrowed assigned keys; do not try
factory keys or reset it.

Assigned-state recovery after this process loss and record freezing/posting
remain pending. No second card, ordinal or batch was created.

## Third planned boundary: frozen record after NFC closure

After operator reauthentication, armed and verified
`record-frozen-session-closed`, then continued the same saved rotation-intent
attempt. The operator presented the same spare with USB connected. The UI
reached exactly `record-frozen-session-closed`, saved stage `record_pending`.
The NFC Cancel control was absent. This checkpoint is outside the withCard
call, after its session cleanup; no direct RF trace was captured.

Private AsyncStorage evidence confirms the same chip, attempt and new full
installation key, installation_verified true, observed GP key version **1**,
and a serialized frozen record with verified_stage rotated. The frozen record
retains batch 1, ordinal 0, operator 1, issued environment, the same device
and load hash, configuration revision 1, verified_at 1792547316.
The server still had one active revision-1 attempt and **zero installation
records** at this pause.

This exercises recovery when rotation succeeded on card but its durable
completion was lost. The code selects candidate session keys by cryptogram
matching before EXTERNAL AUTHENTICATE, avoiding a failed trial login and a
second PUT KEY. No raw APDU capture was taken to independently count
authentications or PUT KEY commands; successful recovery and the same
installation key are directly observed.

Forced app stop at the frozen/session-closed boundary, without Continue/Stop,
then relaunched. Requested operator sign-in with the card removed for final
record-only recovery. Successful POST/receipt and batch acknowledgement are
still pending.

## Final record-only recovery and result

With the card removed, the operator signed in after the third planned process
loss. No further card-control tap was issued. The UI restored
`1 of 1 attempts acknowledged`, `1 rotation records · 0 stops`, and
`Installation and rotation recorded. Not ready for a holder.` A screenshot
is retained at
[the final Pixel screen](hardware/2026-10-20/pixel-recovery-recorded.png).

A final private AsyncStorage copy confirms active null, batch 1 next ordinal
1, and exactly one recorded history entry for the original attempt. Its
frozen_record string is byte-identical to the pre-kill saved string. The local
service contains exactly one attempt and one installation record. Parsed
service body equals the frozen record; service receipt equals the phone's
stored receipt. This verifies persisted contents, not a captured HTTP wire
transcript. The receipt is:

- Attempt `ac3575ad-6be4-4595-b213-97f89afabda6`, revision 2.
- Installation
  `036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490`.
- verified_stage rotated, recorded_at 1792547393.
- **ready_for_holder false**.

The application resumed the record-only path without another operator NFC
tap. That source path posts the frozen record before the key-fetch/NFC path;
no independent HTTP endpoint counter or RF trace was captured.
A consistent completed service snapshot and matching private runtime were
retained as `completed-pixel-drill.db` and
`completed-pixel-drill-runtime.json` in the protected local run directory.
These contain sensitive recovery material and are not repository artifacts.
No close-batch action was taken; the acknowledged batch remains visible.

| Planned process loss | Observed pause | Durable stage at kill | Later outcome |
|---|---|---|---|
| Installation completed before journal completion | installation-verified-before-save | install_intent | Complete new installation adopted; advanced to rotation |
| Rotation verified before journal completion | rotation-verified-before-save | rotation_intent | Assigned-key state recovered; same installation retained |
| Record frozen after NFC closure, before POST | record-frozen-session-closed | record_pending | Same frozen record posted; one matching receipt; ordinal acknowledged |

All three planned boundaries passed on this Pixel/card/local-service run.
The card ends with the 2.1 applet installed and assigned manager keys, not
factory keys. No factory reset, extra installation/ordinal, mint access, owner,
PIN, holder personalization or proof operation was requested. Keys are retained
in the local escrow/database/master state; they are not printed here.

## Limits and remaining work

This is one composite successful run, not a full release validation. The
initial USB interruption occurred before the first recorded binding and is
not counted as a planned post-write boundary. No actual mid-LOAD tear, lost
PUT KEY reply, wrong-card substitution, failed authentication or permanent
lock scenario was injected. No raw APDU transcript was captured, so precise
command counts/no-replay claims rely on the tested source paths plus observed
state, not an independent transport trace.

Max's optional post-install CPLC comparison and full iPhone write/recovery
drills were not run. No Worker deployment or production service/mint was
accessed. Local retained snapshots are not independently encrypted/offsite
escrow or a demonstrated disaster restore. No distributed release gate is
enabled by this report; both committed flags remain false. The isolated Pixel
validation build and its Metro source retain the two approved local gates.
