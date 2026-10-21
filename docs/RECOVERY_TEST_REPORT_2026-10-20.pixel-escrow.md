# Local encrypted escrow recovery — completed Pixel drill

ENG-741, 2026-10-20. Software-only follow-up to the merged
[Pixel hardware report](HARDWARE_TEST_REPORT_2026-10-20.d321-pixel-recovery.md).
Source: `be72b72c519ef3caa502d4051ac1319c33fdb36f`, Node 22.23.3,
macOS, existing ops dependencies. No card, reader or phone action is part of
this recovery check. No production system or mint was contacted.

## What ran

Used the retained `completed-pixel-drill.db` snapshot, rather than the live
service database. Generated a fresh age identity inside a protected local
subdirectory and wrote it directly to a mode-0600 file without printing it.
The existing `exportEscrowSql` produced a version-2 age-encrypted artifact
from the real completed batch/attempt/record/escrow data.

Invoked the existing CLI through Node:
`node --import tsx src/recover.ts <encrypted-artifact>`, with a fresh destination
and the age identity injected through the child process environment.
`OPS_MASTER_KEY` was explicitly absent from that environment. No private
identity or key value passed through prompts, command text, output or history.

Compared restored escrow rows and batch/reservation/record tables in memory
without printing keys. Checked the recovery control, operator credential state
and session count. The recovered database was never served or unlocked.

## Observed result

- Recovery CLI exited successfully without the original derivation master.
- Escrow key rows exactly matched the source snapshot in memory.
- Batch, provisioning batch, attempt and record tables matched the source.
- The one recorded installation and receipt from the Pixel drill survived.
- `recovery_required = 1`: provisioning remains paused after restore.
- No sessions restored; all operator password hashes are recovery-disabled.
- Restored HTTP service not started; original local service left unchanged.

Encrypted artifact SHA-256:
`f36f55f803a4f8829f97d3217bd08015be0539d4ee17e837eaae8d4eff839563`.

The artifact, private age identity, fresh restored database and nonsecret result
summary are retained under the original protected local run directory's
`offline-recovery-check/` subdirectory. Directory mode 0700; created files
mode 0600. No encrypted artifact, identity, database or manager key is committed
to this repository.

## Limits

This establishes local artifact/CLI restore compatibility for the completed
Pixel run. Both artifact and identity remain on the same Mac; this does not
prove off-machine custody, loss-of-account recovery, scheduled Cloudflare/R2
backup delivery or production disaster recovery. An independent encrypted copy
and independently recoverable age identity remain operator custody work.
No recovered key was tried against a card, no original key set was changed,
and no provisioning recovery lock was cleared. Release gates remain false.
