# Independent encrypted backup copy runner

Host-only orchestration for [the recovery plan](../../docs/OPS-RECOVERY-PLAN.md).
It uses rclone for scoped R2 reads and Nextcloud WebDAV writes. It never decrypts
an export or needs an age private identity. It is not yet a built StartOS package,
a production issuance gate, an alert-delivery system or a tested Zion deployment.

Requires Python 3.9+ on Linux/macOS and rclone 1.75.2 (the locally validated
version). Source names must match the Worker's timestamp/UUID `.age` naming
contract under its `escrow/` prefix. Source timestamps are trusted service
metadata; this is not an independent attestation against a compromised exporter.
Destination filenames replace timestamp colons with hyphens for portable
[Nextcloud filenames](https://docs.nextcloud.com/server/stable/admin_manual/configuration_files/windows_compatible_filenames.html);
the manifest retains the exact source name and destination name.
Only such files are copied; no deletion or pruning command exists.

Configure rclone privately using its documented
[R2](https://developers.cloudflare.com/r2/examples/rclone/) and
[Nextcloud](https://rclone.org/webdav/) settings. Use bucket-scoped R2 read/list
access and an isolated Nextcloud account with a revocable app password. Never
put the recovery identity in either configuration, prompts or shell history.
No configuration or credential belongs in git. Use a private directory (0700)
and regular configuration files (0600), with access restricted to the service
user. The rclone config must be self-contained; no interactive auth is supported.

The runner's separate JSON config contains only the private rclone config path
and scoped remote directories, for example:

```json
{
  "rclone_config": "/data/private/rclone.conf",
  "source": "r2:dedicated-bucket/escrow",
  "destination": "nextcloud:cashu-ops-backups"
}
```

These are examples, not discovered Zion endpoints. Obtain the exact WebDAV
endpoint from Nextcloud before any remote plan. Rclone obscured passwords are
not a substitute for filesystem protection. Its child output is captured and
never printed; provider errors can contain sensitive URLs.

```sh
python3 tools/backup-copy/copy.py --config /data/private/copy.json --state /data/state/copy.json
python3 tools/backup-copy/copy.py --health --state /data/state/copy.json
```

The loop waits 15 minutes after each cycle; `--once` runs a single cycle. One
writer is locked per state path. Use a dedicated state directory for each
source/destination pair; changing remote endpoints requires a reviewed state
migration or a new state directory so old copy receipts are not reused. Health reads an atomically replaced private
state file and emits only status/source age. It fails if a cycle failed, no copy
has succeeded, the runner has not checked for 30 minutes, or the newest verified
source is at least 24 hours old. At 18 hours it reports warning (nonzero exit).
No health result automatically stops issuance yet; that separate integration
and alert routing remain required.

Each cycle processes the newest export plus up to seven missing older exports.
It downloads to a private temporary directory, hashes the bytes, uploads with
`--immutable --size-only`, then forcibly downloads and hashes the destination.
Size-only upload comparison allows harmless mtime differences across backends;
read-back verification is mandatory and catches same-size corruption. A stable
JSON manifest is uploaded additively and read back too. Already verified source
bytes may not change. The newest export is rechecked every cycle. Disappearance
of the newest verified source fails health; no upstream deletion is propagated.
Files larger than 256 MiB or future-dated beyond five minutes fail the cycle.

Successful artifacts retain their source time and verification time. Failed
transfers never certify an unverified artifact; a failed cycle remains unhealthy
while preserving earlier verified evidence. Routine retries do not overwrite
conflicting objects, remove prior snapshots or reset old-source freshness. An
operator must investigate an immutable conflict; do not delete copies or state
just to turn health green. State/config corruption causes a generic failed exit.

Checksums prove copy integrity, not age recipient correctness or authenticated
restore. Complete a separate age decryption/restore drill from the independent
copy with designated recovery operators. The service master and recovery private
identity are not recovered from this runner's state or copy manifests.

## Local validation

```sh
python3 tools/backup-copy/test_copy.py
```

Four focused tests cover interruption, corruption, retained evidence, retries,
source-time freshness and rejected names. If `rclone` is on PATH, a fifth test
starts a temporary **loopback-only** WebDAV fixture, copies twice, then corrupts
the destination while preserving its size/mtime and verifies failure. It touches
no R2 bucket, Nextcloud instance, server, card or phone. CI pins the rclone archive
checksum and runs that compatibility check. Generic local WebDAV evidence does
not prove a specific Nextcloud configuration, R2 credentials, StartOS compatibility
or production recovery readiness.
