# Separate-Mac staging recovery — 2026-10-22

The operator authorized SSH access to the second Mac for the recovery check.
This is an actual restore from the protected offline staging copy, beyond the
previous operator-reported drive-unlock check.

## Environment and source

- Separate arm64 Mac, macOS 27.0.1 (26A434), existing Node 22.23.1 and Yarn
  1.22.22. No system Node installation or shell-profile change was needed.
- Fresh, mode-0700 local workspace pinned to merged source
  `8b4a61026abc8ac74037a54991c64e3b69b1e078` (PR #81).
  Locked dependencies installed independently; native SQLite loaded successfully.
- The mounted encrypted APFS drive matched the recorded recovery volume UUID.
  The existing staging identity was a private mode-0600 file. No identity or
  operational key appeared in command arguments, prompts, logs or reports.
- Preserved independently verified Nextcloud ciphertext and manifest were read
  from that drive. Ciphertext size 2,291 bytes and SHA-256
  `f7098790d9f14225cfcfd1f638c4793af9e5a1a6eb29527c66dba4f9cd4c762f`
  matched the manifest before decryption.

## Actual restore and verification

The supported offline CLI used `OPS_RECOVERY_IDENTITY_FILE` to read the identity
from the drive and restored into a fresh mode-0700 temporary directory on that
same encrypted volume. No service master or original service was supplied.
Verification on the second Mac independently decrypted the artifact and compared
all escrow rows with the restored database without printing their contents.

| Check | Observed result |
| --- | --- |
| Restored operator / batch / key-set / card counts | 1 / 1 / 1 / 0 |
| All escrow key rows match the decrypted artifact | Passed |
| Recovery-required fence remains enabled | Passed |
| Restored operator credentials remain disabled | Passed |
| Sessions, companion connections, pairings and copy receipts absent | Passed |
| Temporary plaintext database and its temporary directory removed | Passed |

Verification completed at `2026-10-22T19:10:51.628Z`. A sanitized report was kept
in the protected second-Mac workspace and copied to the original Mac's private
rehearsal evidence directory. Only the ciphertext, identity and existing custody
files remain in their original drive locations; no recovery file was replaced.
The volume was then unmounted; macOS reported that the APFS volume was already
locked when the explicit lock command was attempted.

## Limits

This closes the separate-machine **staging** restore check. It does not establish
production key custody, independent Vaultwarden/MFA recovery, physical storage
placement, whole-Zion monitoring, push delivery, reviewed retention or hosted
cutover/reconciliation. The restored dataset contains no card mappings; no real
card recovery is claimed. No Worker, live database, mint, card, reader or phone
was accessed. No credentials were reset and no recovered service was reopened.
