# Production service preparation and deployment — 2026-10-22

The operator authorized production deployment and release preparation. The
explicit production configuration and custody evidence passed CI in PR #84,
merged as `68e29f426fe4b40eacb8018a0d3412af2b64555a` before deployment.
No phone, card, reader or mint command was used.

## Deployed service and initial checks

- Worker: `cashu-card-ops`, origin
  `https://cashu-card-ops.old-cell-30e7.workers.dev`.
- Dedicated backup bucket `cashu-card-ops-backups` created through the
  authenticated dashboard. A rejected API mutation was followed by an exact
  absence check before using the dashboard; no duplicate bucket was created.
- Initial deployed version `1c89fcdc-90f1-4ceb-987b-2bade2628ece`; subsequent
  secret injection/removal creates later platform versions. Source and public
  bindings are from the reviewed production configuration.
- Fresh production master and bootstrap credentials were generated privately,
  stored in the restricted production Vaultwarden collection, and injected
  without secret contents in arguments, logs or reports. The age identity is
  not a Worker binding. No staging secret was reused.
- Operator sign-in passed at `2026-10-22T20:23:52.351348+00:00`. The registry
  contains no batches. Required independent-copy health returned 503/stale.
  A validly shaped reservation probe against a nonexistent batch returned
  `503 independent-backup-stale`, creating no batch, attempt or card key.
- Validation session signed out. The one-shot setup secret was removed, and
  a subsequent secret-name-only inventory confirmed it absent while the master
  remained present.

## Final cron allocation

The initial approved staging-to-production slot transfer was reversed when the
operator chose to retain staging. They then explicitly selected
`meridian-jabari` to free the production slot. Its daily trigger was removed;
the Worker and its data were not deleted. Other applications' schedules were
unchanged. Exact schedule read-back confirmed:

| Worker | Final schedule (UTC) |
| --- | --- |
| Cashu staging | `17 3 * * *` |
| Cashu production | `17 3,15 * * *` |
| meridian-jabari | None |

The staging recovery connection, configuration, bucket and previous Nextcloud
artifacts remain intact. A dual-issuer Atoll capability is being prepared under
D73; no existing verified source was retargeted or history cleared.

## Apple signing preparation

Apple issued distribution certificate `3KGAHN9LRL`, expiring October 22, 2027,
for team `H7UAM79QQP`. Its public key matches the locally prepared encrypted
private key. Native Security framework import succeeded, and Keychain lists
the identity as valid for code signing. Public certificate SHA-256:
`4A:B2:85:5C:0C:16:73:1E:E5:A5:2F:0D:63:43:FF:DE:F7:32:E4:D9:3F:F8:48:24:47:93:CD:1B:42:7D:EF:D0`.

The encrypted PKCS12 bundle and its password are backed up in the restricted
production collection, with saved-view comparison. No existing team certificate
was revoked. This does not establish a provisioner distribution profile, NFC
entitlement approval, a signed archive or a store upload.

## Still closed

Production has no accepted independent-copy receipt. Its first actual encrypted
export, independent destination verification, receipt authorization and restore
remain pending. Alerting outside Zion and reviewed reconciliation also remain
open. The deployed service is not a completed store release; physical feature
gates remain unchanged and no store submission occurred.
