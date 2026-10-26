<a id="the-ops-services-threat-model"></a>

# Ops-service threat model

Threats, controls and residual risks for the ops-service. The table distinguishes
implemented operator behavior from the proposed consumer flows. The card
threat analysis is in [SECURITY-MODEL.md](SECURITY-MODEL.md).

Written before the service was built (ENG-740); the rows name their tests where
a claim is enforced by one. The service's shape is [D29](DECISIONS.md#d29):
one service, one SQLite DB, per-card keys derived from a master and escrowed at
issuance. Phone recovery journals retain public workflow evidence; manager keys
are held in memory for the active operation. Partner operation, access and
rotation-time custody are described in
[`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md), PROPOSED until Foxy signs off.

<a id="what-the-service-is-for"></a>

## Service responsibilities

The service issues and escrows manager keys so an authorized installation or
recovery can retrieve its assigned set after a lost response. The provisioner
uses those keys through its NFC transport. Durable key custody belongs to the
service and its protected recovery copies ([D29](DECISIONS.md#d29)). Consumer
issuance remains gated on verified identity and per-card authorization.

## Threat table

| # | Threat | Protected? | Notes |
|---|---|---|---|
| 1 | Theft of the escrow DB | ❌ **Equals manager access to the cards** | Escrow rows contain plaintext manager key sets. A database export or runtime compromise can expose them. Cloudflare storage encryption protects its storage media under the platform trust boundary; this implementation does not add a separately held application KEK. Independent backup artifacts are age-encrypted to an operator-held recipient. |
| 2 | Confiscated operator phone | **Bounded, stated** | A live bearer token grants operator access until its 12 h expiry or revocation. Tokens are stored hashed on the service. Another operator session can revoke a principal through `/auth/operator/revoke`; deployment-controlled credential recovery also revokes that principal’s sessions without the stolen bearer. A compromised phone during a run can observe that run’s keys. Durable app recovery stores scoped intents and frozen completion records; it excludes credentials and manager keys. See PROVISIONER-RECOVERY.md. |
| 3 | Lost holder phone, pre-rotation | ❌ **Open window, stated** | The card is still on the factory keys (`40..4F` ×3, `scp02.ts:59`) and the card is still empty. Anyone with the public factory keys could have done this since INSTALL; the holder's loss adds no new capability and no deadline. The window closes at the next tap, which re-claims the card. It remains open until a successful rotation tap; the service cannot remotely close it. |
| 4 | Lost holder phone, post-rotation | **Consumer recovery gated** | Existing escrow rows retain per-card manager keys, separate from the on-card spending key. Holder sessions and legacy holder tokens are disabled until identity and per-card authorization exist. Operator reissue reads the same escrowed set. Consumer recovery is not shipped by this port. |
| 5 | Factory-key window on consumer installs | **Bounded by composition, residual stated** | Between INSTALL and rotation the card answers the public `FACTORY_KEYS`, so any reader in range could do what the installer is doing. The window is whatever the install→rotate composition leaves: `rotateKeys` is one INITIALIZE UPDATE plus one PUT KEY (`provision.ts:638-680`), so the window is the install's card-active time plus the rotation handshake. The 2026-10-18 report's cadence puts a normal run at 9–11 s card-active, and the window adds one handshake and one PUT KEY on top; call it ~12 s of factory-key exposure per consumer install, in the presence of an attacker who is already standing within NFC range of the tap. Accepted: the attacker gets an empty card's manager, and the installer's rotation closes it. |
| 6 | Master key loss | **Existing escrow survives** | Existing sets are read from escrow rather than re-derived. A complete encrypted export restores keys and card mappings without the original master. Restored operators are disabled until explicit credential recovery. Runtime startup still requires a configured master; a replacement master may create future batches without changing old escrow rows. Loss of both escrow and a usable export remains unrecoverable. |
| 7 | Escrow and backup durability | **Atomic locally, independent recovery required** | Batch creation and its full key range commit together. Cloudflare PITR shares the account failure boundary. Nightly encrypted exports include keys, card mappings, batch metadata and CAP releases. A restore drill covers the artifact written to local R2 by the scheduled Worker. Copying artifacts outside the account and protecting the recipient identity remain deployment procedures. |
| 8 | Service down at rotation time | **Existing cards operate; provisioning pauses** | The card does not contact this service. Downtime stops new batches and key retrieval, including interrupted-install recovery that needs keys refetched. Operator backups do not implement the signed, partner-filtered export contract in OPS-GOVERNANCE Q2; that contract and Phase 5b remain gated. |
| 9 | Operator privilege abuse and login flooding | **Residual privilege stated** | HTTP key retrieval requires an active reservation owned by the operator and device. Administrative database access still exposes all escrowed sets; read auditing, per-partner isolation and second-operator approval are not implemented. Holder access is disabled. A persisted service-wide budget allows 10 sign-in attempts per 60 seconds, reserved before verification, including successful attempts and unknown names. This bounds password work but permits an attacker to exhaust the shared login budget temporarily; existing sessions remain usable. |
| 10 | The BTC tip upstream lies | **Shape validation and caching only** | The daily-limit clock anchors to headers the service relays from mempool.space (60 s cache, last-good kept for a 503). A hostile upstream can serve an old or wrong 80 bytes; the service validates shape and length only, like `cardctl.py:479-480` does; it does not verify proof-of-work, and says so. The anchor error this can cause is bounded by the same property the card's `SET_OWNER` has always had: the operator chooses to anchor. Self-hosted bitcoind is the later-scale fix, recorded in the plan. |
| 11 | Cloudflare account or service runtime compromise | ❌ **Full reach, stated** | Account administrators can change code/secrets and read storage through deployed code. A compromised runtime can read the master and escrow. Wrangler runtime secrets are not an HSM boundary. Independent encrypted backup recovery requires an artifact and recipient identity outside that account. No independent application KEK or external KMS is implemented. |
| 12 | Partner access and custody | **Governance pending** | One shared root and escrow remain the proposal. Partner-scoped issuance, filtered signed exports and an agreed custody boundary must precede consumer rollout. This engineering amendment does not substitute for Foxy sign-off. |

## Encryption and recovery boundaries

The live SQL database holds plaintext manager keys at the application layer.
Do not describe Cloudflare storage encryption as an independently controlled
KEK. Account or running-service compromise defeats that boundary.

Age encryption protects exported artifacts only while the recipient identity
remains separate. R2 in the same account is the first backup destination, not
independent disaster recovery. The operator must copy and verify a recent
artifact outside the account, configure failed-cron and stale-backup alerts,
and accept the interval of new cards not yet present in that independent copy.
`GET /ops/backup-status` requires an operator session and returns 503 when
backup configuration is missing or the last successful export is over 26 hours
old (or absent). Cron failures do not update the success timestamp.

The complete local procedure is in [`ops/README.md`](../ops/README.md).
Production backup configuration, independent copies and hardware behavior have
not been validated by the local tests.

<a id="what-a-test-pins-and-what-it-does-not"></a>

## Verification coverage

| Claim | Pinned by |
|---|---|
| Issuance and escrow are one write; no issued-but-unescrowed state | `ops/test/db.test.ts` (forced failure between the two leaves no row) |
| A lost response re-issues byte-identical keys | `ops/test/keys.test.ts` (same master+salt+ordinal → identical sets; distinct ordinals never collide) |
| Registry re-POST is idempotent; a changed body is a 409 | `ops/test/registry.test.ts` |
| Holder session minting and legacy holder tokens cannot reach keys; operator tokens expire and revoke | `ops/test/auth.test.ts`, `ops/test/auth-boundary.test.ts` |
| Principal revocation invalidates a stolen operator token | `ops/test/auth.test.ts` (revoke-by-principal without the stolen bearer; holder tokens cannot revoke or list) |
| The Node last-good anchor header survives a restart | `ops/test/db.test.ts` (write through one OpsDb's `tipStore()`, seed a fresh AnchorFeed from the same store over the same DB file, dead fetcher past the cache window answers the stale header) and `ops/test/anchor.test.ts` (persist-on-fetch, seed-at-boot over an injected store) |
| Tip: 80-byte validation, 60 s cache, 503 carries the last-good header | `ops/test/anchor.test.ts` |
| No per-card key in any response a phone caches beyond one run | `ops/test/sessions-clean.test.ts` |
| The provisioner's outbox re-posts the frozen first body | `apps/provisioner/src/api.test.ts` (a partial field change between retries cannot become a 409) |

Claims about silicon (the ~12 s factory window's real length; how CoreNFC
behaves past 60 s) come from
[`HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md`](reports/HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md)
and apply to that measured run. Encryption-at-rest and recovery coverage are
described in the preceding section.

Additional Workers checks cover BLOB restoration after actual object eviction,
PBKDF2 verification, constructor bootstrap, and scheduled R2 artifact recovery
(`ops/test/workers/`). Recovery validation and atomic rollback are covered by
`ops/test/export.test.ts`.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md). The escrow DB is fleet-wide card-manager
access. Treat findings involving it as potential access to every managed card.
