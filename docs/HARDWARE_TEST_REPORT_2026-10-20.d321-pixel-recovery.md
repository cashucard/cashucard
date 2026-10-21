# Pixel replacement and interrupted-install recovery — in progress

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
