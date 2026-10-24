# Independent encrypted backup copy runner

Copy orchestration for [the recovery plan](../../docs/OPS-RECOVERY-PLAN.md), used
by [Atoll Recovery for StartOS](https://github.com/islandbitcoin/atoll-recovery-startos).
It reads encrypted exports through a paired backup-only issuer reader or scoped
R2 access, and uses rclone for Nextcloud WebDAV writes. It never decrypts an
export or needs an age private identity. The package adds browser setup and the
separate notification watcher below; neither component enforces issuance.
See the [staging report](../../docs/OPS_STAGING_REPORT_2026-10-21.md) for observed
Zion behavior and remaining recovery gates.

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

In advanced direct-R2 mode, the runner's private JSON config names the rclone
configuration and scoped remote directories, for example:

```json
{
  "rclone_config": "/data/private/rclone.conf",
  "source": "r2:dedicated-bucket/escrow",
  "destination": "nextcloud:cashu-ops-backups"
}
```

The JSON values are examples. Obtain the exact WebDAV endpoint from Nextcloud
before any remote plan. Rclone obscured passwords are
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

Checksums verify copied bytes. Validate the age recipient and authenticated
restore through a separate drill from the independent copy with designated
recovery operators. The service master and recovery private identity are not
recovered from this runner's state or copy manifests.

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

## Atoll Recovery notifications

`alerts.py` watches the copy state independently. Configure it with a private
0600 JSON file containing `webhook_url` (HTTPS) and `generation` (a new opaque
identifier whenever notification routing is reconfigured). It needs no recovery
identity or issued keys. The StartOS package supplies its private configuration.
An optional `label` identifies a backup source in notification text. It accepts
1–64 ASCII letters, digits, spaces, dots, underscores or hyphens, beginning with
a letter or digit. Invalid or absent labels retain the original generic text.
Each source/destination needs separate copy and notification state; notification
routing may be shared, but delivery evidence must not cross between issuers.

```sh
python3 tools/backup-copy/alerts.py --config /data/private/alerts.json --copy-state /data/state/copy.json --state /data/state/alerts.json
python3 tools/backup-copy/alerts.py --health --config /data/private/alerts.json --copy-state /data/state/copy.json --state /data/state/alerts.json
```

A receiver must accept a JSON POST with `event`, `status`, `source_age_seconds`
and `text`, returning HTTP 2xx only when accepted. This generic webhook contract
leaves provider-specific native integrations to the receiving service.
No credentials, snapshot identities or remote paths enter the payload. The URL
can contain a secret route token and remains private. TLS verification stays on;
redirects are rejected and each request has a bounded timeout.

The watcher checks each minute, sends initial confirmation and health changes,
reminds hourly during failure/warning and daily while healthy. A failed delivery
does not advance confirmation and is retried after five minutes. Delivery health
fails when the watcher stops checking for three minutes, the latest send failed,
or accepted evidence is over 25 hours old. Reconfiguring its generation makes
previous route evidence inapplicable. These rules measure receiver acceptance.
Confirm human visibility separately. Host shutdown disables both local processes;
use an independently hosted monitor for whole-host failure. Notifications do not
automatically stop issuance, decrypt snapshots, or establish recovery readiness.

Run `python3 tools/backup-copy/test_alerts.py` for four focused checks: transition
and reminder deduplication, failed-delivery acknowledgement/backoff, destination
generation changes, and a real loopback HTTP receiver including redirect rejection.

## Paired issuer source and browser-authorized Nextcloud

In paired mode the private copy configuration uses `source_kind: "issuer"`,
`source: "issuer:UUID"`, `issuer_id`, `issuer_origin` (HTTPS origin only), and
`issuer_secret` (the companion's privately generated credential). The destination
continues to use the dedicated Nextcloud rclone remote and the same immutable
copy/read-back contract. Issuer downloads follow no redirects and enforce bounded
pagination, identity and artifact size. Failed source access preserves receipts.

`connect.py` is a private stdin/stdout helper for StartOS actions: `pair-issuer`,
`nextcloud-start` and `nextcloud-finish`. Its successful output can contain an app
password and must never become ordinary logs or action results. Completed browser
authorization is journaled with `--result-file` before configuration is changed;
keep that record private and remove it only after the credentials are committed.
Authorize the browser flow with a dedicated non-admin account. Revoke any admin
credentials authorized by mistake.

Run `python3 tools/backup-copy/test_issuer.py` for focused source-scope,
pagination/identity, pairing/authorization and admin-rejection checks.

### NTFY delivery

A private alert config can select `provider: "ntfy"`, with `webhook_url` set to
the server's HTTPS origin, `topic` set to one literal topic, and `token` holding
a dedicated write-only publisher token. Never use an admin token or put a token
in the URL. Atoll's StartOS connection action obtains its own publisher through
the existing NTFY package rather than requesting copied credentials.

The sender maps recovery health to a titled NTFY message, uses Bearer auth,
rejects redirects and validates a bounded message receipt for the same topic.
Five focused alert tests include real loopback authorization/payload inspection,
wrong-topic receipt rejection and redirects. Receipt acceptance still does not
prove browser/mobile delivery, human acknowledgement or whole-host monitoring.


### Opt-in issuer copy receipts

The private issuer-source configuration may explicitly set `"attest_copies": true`
after a recovery administrator grants this connection the separate attestation
capability. The default is false; pairing and upgrades do not grant authority.
No R2 credential or recovery identity is needed. An unsupported/unauthorized
issuer fails the cycle when this option is enabled; it does not silently fall
back to reporting success without evidence.

After both destination read-backs pass, the runner fetches issuer-owned source
metadata, checks its name/issuer, exact ciphertext hash/length and snapshot time,
and submits the bounded authenticated receipt. Failed delivery is retried on the
next cycle by repeating immutable copy and read-back. The stable destination
manifest is preserved for existing exports. Local health uses the exact snapshot
time after accepted attestation, including when it predates the filename time;
legacy/direct-R2 mode retains its existing filename-based local health behavior.
Only the issuer's separately enabled policy enforces issuance. This source
change leaves installed StartOS packages and deployment policy unchanged.
Update package configuration and complete a staging drill before enabling the
policy on a deployment.

Older archived exports without issuer-bound metadata are copied and verified
locally. The runner does not submit them as fresh evidence. An ineligible newest
export fails health. Ineligible historical archives leave a newer eligible
snapshot's successful destination read-back and receipt intact.
Authorization failures and unsupported issuer endpoints still fail the cycle.
