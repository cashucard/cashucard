# The ops service's threat model

What the ops service protects, what it does not, and which weaknesses are
accepted versus unresolved — the same honesty [`SECURITY-MODEL.md`](SECURITY-MODEL.md)
keeps for the card: a threat table, and where something is untested it says so
rather than asserting a property nobody has measured.

Written before the service was built (ENG-740); the rows name their tests where
a claim is enforced by one. The service's shape is [D29](DECISIONS.md#d29):
one service, one SQLite DB, per-card keys derived from a master and escrowed at
issuance, never resident on a phone. Governance — who operates it, what a
partner sees, what happens to their cards at rotation time — is
[`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md), PROPOSED until Foxy signs off.

## What the service is for

Both consumer apps can install cards, and a rotated card-manager key cannot
live on a phone (the phone is the transport, not a vault — D27). So the
per-card key sets must be born somewhere that is neither of the phones that
might install the card, and be there again on the second tap when the first
response was lost. The service issues them, escrows them, and holds the
registries the bench and the daily-limit clock read.

## Threat table

| # | Threat | Protected? | Notes |
|---|---|---|---|
| 1 | Theft of the escrow DB | ❌ **Equals the cards** | Whoever holds an issued per-card `KeySet` (`enc`/`mac`/`dek`, 16 bytes each, `tools/cardkit/gp/scp02.ts:43-48`) can open that card's ISD and reinstall or destroy it — a reader attack, no PIN involved. So the escrow DB is as sensitive as the cards it fronts: theft of the escrow ≈ theft of every card in it. Mitigation: the DB at rest is encrypted with a key-encryption key separate from the `OPS_MASTER_KEY` the service derives with, so a disk image alone does not open it — but a compromised host (both keys in its memory) does, and this row does not claim otherwise. See below. |
| 2 | Confiscated operator phone | **Bounded, stated** | It yields a bearer session token with a 12 h expiry, revocable server-side, and whatever batch context the screens showed. It never yields per-card keys: the phone fetches a set per run and persists nothing — no response the app keeps beyond one run contains a key (`ops/test/sessions-clean.test.ts` pins this over every route the phone can call). A stolen token is revoked, not waited out: `POST /auth/operator/revoke` revokes a principal's live sessions from any other operator token — no possession of the stolen token required — with `GET /auth/operator/sessions` listing what is live first (`ops/test/auth.test.ts` pins the revoke and the holder denial). What is NOT covered: a revoked-but-untokened attacker who recorded the traffic has nothing anyway (TLS at the reverse proxy); a phone compromised live, mid-run, is outside any server's reach; and with a single operator, revocation means their OTHER live token — a one-operator deploy revokes by signing out the stolen phone's own token (`/auth/operator/signout`), which does require the stolen bearer. |
| 3 | Lost holder phone, pre-rotation | ❌ **Open window, stated** | The card is still on the factory keys (`40..4F` ×3, `scp02.ts:59`) and the holder holds nothing — there is nothing to lose. Anyone with the public factory keys could have done this since INSTALL; the holder's loss adds no new capability and no deadline. The window closes at the next tap, which re-claims the card. It is bounded only by the holder's next tap, not by the service, and this row says so rather than promising a remote wipe that does not exist. |
| 4 | Lost holder phone, post-rotation | **Yes — by escrow** | The keys are escrowed server-side keyed to the card's short id; re-authenticating re-issues the same set (HKDF is deterministic, `ops/test/keys.test.ts`). **This deviates from `SECURITY-MODEL` #3's "no backup, no recovery"** — deliberately. That row is about the *holder's value key* and the card's own secp256k1 key (D5): the card's spend key is born on-card and never exported, so no one can back it up. The card-manager keys are a different secret, born off-card, escrowed by design (D29). Read the two rows together as: the *value* is unrecoverable by design; the *manager access* is recoverable by escrow. |
| 5 | Factory-key window on consumer installs | **Bounded by composition, residual stated** | Between INSTALL and rotation the card answers the public `FACTORY_KEYS`, so any reader in range could do what the installer is doing. The window is whatever the install→rotate composition leaves: `rotateKeys` is one INITIALIZE UPDATE plus one PUT KEY (`provision.ts:638-680`), so the window is the install's card-active time plus seconds, not minutes. The 2026-10-18 report's cadence puts a normal run at 9–11 s card-active, and the window adds one handshake and one PUT KEY on top — call it ~12 s of factory-key exposure per consumer install, in the presence of an attacker who is already standing within NFC range of the tap. Accepted: the attacker gets an empty card's manager, and the installer's rotation closes it. |
| 6 | Master key loss | **Existing cards survive; new issuance stops** | Cards hold their own key sets, so losing `OPS_MASTER_KEY` cannot break a card already issued — it only means the service can no longer derive sets for new batches or re-issue a lost response's set. The escrow rows themselves are the recovery for everything already issued (see #7). Runbook: the deploy runbook's backup step covers the escrow; the master is a runtime-injected env secret recorded wherever the operator records such things. |
| 7 | Escrow rows as the backup | **Yes, that is their job** | There is no separate key-backup pipeline to lose: the escrow write and the issuance are the same transaction (`ops/test/db.test.ts` forces a failure between them and proves no row), so "issued but unbacked" is not a state the service can be in. What the escrow does not back up is anything the service has not issued yet. |
| 8 | Service down at rotation time | **Cards fine; Foxy's contract is the question** | A card never talks to the service — rotation uses keys the phone already fetched. Downtime stops new batches and re-issues, not live cards. What a *partner's* holders get when the service (or the relationship) ends is a governance answer, not a technical one: signed escrow export of their parties' key sets, wrapped to Foxy's key — [`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md) Q2, PROPOSED. |
| 9 | Operator privilege abuse | **Bounded by the registry's shape** | An operator can read batches and post registry rows — that is the job. The one-shot, rate-limited holder scope cannot read batches (`ops/test/auth.test.ts`), and cap-release writes are operator-only. What is NOT enforced in v1: per-operator audit of *reads* beyond the sessions table's existence, and a second-operator approval for destructive actions. Accepted for a v1 with a handful of operators. |
| 10 | The BTC tip upstream lies | **Partially — cached, not verified** | The daily-limit clock anchors to headers the service relays from mempool.space (60 s cache, last-good kept for a 503). A hostile upstream can serve an old or wrong 80 bytes; the service validates shape and length only, like `cardctl.py:479-480` does — it does not verify proof-of-work, and says so. The anchor error this can cause is bounded by the same property the card's `SET_OWNER` has always had: the operator chooses to anchor. Self-hosted bitcoind is the later-scale fix, recorded in the plan. |
| 11 | Compromise of the service host | ❌ **Full reach, stated** | Root on the droplet reads the master (memory or env), the KEK, the DB and every session token: it can issue, escrow-read, and re-issue anything. The perimeter is the host's — ufw default-deny, loopback service bind behind a TLS reverse proxy, the forge recipe — not the service's. This row is the honest ceiling for #1, #2 and #9. |
| 12 | Foxy (or any partner) as an insider | **Governance, not code** | What a partner's operators can see, and what their cards' key sets become at relationship end, is the governance doc's agenda — the service builds against lnflash's default answer and marks it pending. Not duplicated here; see [`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md). |

## What at-rest encryption does not cover

Stated plainly because #1 leans on it: encrypting `ops/data/ops.db` at rest with
a key-encryption key that is not `OPS_MASTER_KEY` means a stolen disk, snapshot
or backup file is inert on its own. It does not protect against:

- a compromised running host (both keys resident — #11);
- a backup pipeline that ships the KEK alongside the DB (the runbook keeps them
  apart; this is a procedure, not an enforcement);
- SQLite page-level forensic leakage of anything the service writes *outside*
  the DB file (WAL/journal siblings ship with the same encryption only if the
  backup includes them and the KEK does not).

Nothing here has been tested against a forensic attacker; the encryption choice
is recorded as configuration, not as a measured property.

## What a test pins and what it does not

| Claim | Pinned by |
|---|---|
| Issuance and escrow are one write — no issued-but-unescrowed state | `ops/test/db.test.ts` (forced failure between the two leaves no row) |
| A lost response re-issues byte-identical keys | `ops/test/keys.test.ts` (same master+salt+ordinal → identical sets; distinct ordinals never collide) |
| Registry re-POST is idempotent; a changed body is a 409 | `ops/test/registry.test.ts` |
| Holder scope cannot read batches or write cap-releases; tokens expire and revoke | `ops/test/auth.test.ts` |
| A stolen operator token is revoked by principal, not waited out | `ops/test/auth.test.ts` (revoke-by-principal without the stolen bearer; holder tokens cannot revoke or list) |
| The last-good anchor header survives a restart | `ops/test/anchor.test.ts` (persist-on-fetch, seed-at-boot over a real DB) |
| Tip: 80-byte validation, 60 s cache, 503 carries the last-good header | `ops/test/anchor.test.ts` |
| No per-card key in any response a phone caches beyond one run | `ops/test/sessions-clean.test.ts` |
| The provisioner's outbox re-posts the frozen first body | `apps/provisioner/src/api.test.ts` (a partial field change between retries cannot become a 409) |

Claims about silicon (the ~12 s factory window's real length; how CoreNFC
behaves past 60 s) come from
[`HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md`](HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md)
and are measured, not asserted; claims about the encryption-at-rest posture are
configuration, and the table above is the list of what that does not buy.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md). The escrow DB is fleet-wide card-manager
access — treat any finding touching it as funds-adjacent.
