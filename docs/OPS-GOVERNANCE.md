# Ops governance — PROPOSED, pending Foxy sign-off

The partner conversation's agenda: the questions Foxy's review of the ops
service will ask, with lnflash's proposed answer for each. Nothing here is
agreed until Foxy agrees to it; **the service builds against the proposals
below and this document is marked pending until the sign-off lands** —
ENG-740 does not close with the sign-off outstanding, and Phase 5b (the
holder-facing consumer flows, where Foxy's holders meet the service) is
gated on it.

The security context is [`OPS-THREAT-MODEL.md`](OPS-THREAT-MODEL.md); the
service's shape is [D29](DECISIONS.md#d29). This document holds the decisions
that are a partner's to share in, not the service's to make alone.

## Q1. Hosting and who can see the escrow

**Proposed: lnflash alone, one shared root.** The deployment target is a
lnflash-operated Cloudflare Worker and one SQLite-backed Durable Object
([D30](DECISIONS.md#d30)), isolated from the forge mint with its own backups
and alerting. This replaces the dedicated-droplet proposal and remains pending
Foxy sign-off. Cloudflare account administrators and a compromised service
runtime are within the escrow's trust boundary; independent encrypted exports
and a tested restore are deployment gates in
[`OPS-WORKERS-PLAN.md`](OPS-WORKERS-PLAN.md).
Foxy's card-manager keys live in the same escrow
as Flash's, under the same master.

What this asks Foxy to accept: lnflash's operators can, technically, read the
key sets of Foxy-issued cards. The control offered in return is the governance
one — escrow reads are per-batch, scoped by the batch's ownership recorded at
issuance, and the audit of who read what is a deliverable of the sign-off, not
a promise made here.

**Alternatives on the table:** a Foxy-run mirror of the service (two masters,
two escrows, the registry split by owner — more perimeter, more drift);
per-partner master keys under one service (derivation becomes per-tenant, the
D29 scheme changes before Foxy's review has seen it).

## Q2. Foxy cards at rotation time: service down, or relationship over

**Proposed: signed escrow export, wrapped to Foxy's key, contractually
deliverable.** At any time — announced or not — lnflash delivers an export of
every key set whose batch Foxy owns: each set signed by the service's export
key and encrypted to a public key Foxy holds, so the export is useless to
anyone but Foxy and provably came from the service.

The contract clause this proposal pairs with: the export is deliverable within
a stated window of a relationship's end, and while the relationship stands
Foxy may request a current export on a stated cadence, so "the service is
down" never means "Foxy's holders cannot re-claim a card" — the last export
already holds every set issued before it.

What this does not cover: sets issued after the last export and before a
service outage. The window is the export cadence, and the cadence is Foxy's
to set.

## Q3. What Foxy's security review sees

**Proposed: the derivation spec and this document — never KMS access.** The
review scope is the HKDF-SHA256 derivation (master → per-card `enc`/`mac`/
`dek`, the scheme D29 records and `ops/src/keys.ts` implements), the threat
model's honest rows, and the API surface the holder apps touch. No access to
the master, the KMS seam's configuration, or the escrow DB itself.

The reasoning: what Foxy needs to assure itself of is that the keys its cards
get are derived the way the spec says and escrowed the way the contract says —
arithmetic and behaviour, both inspectable in documents and code. Giving a
reviewer KMS access widens the perimeter (#11 of the threat table) for a
assurance the documents already carry.

**Alternatives on the table:** a full source-and-infra audit by Foxy's
reviewer of their choice (bigger ask, slower); a third-party audit paid
jointly (the honest choice once real money is fleet-wide, but not before).

## Q4. Holder-session vs operator-session minting rights

**Proposed: the holder mints key sets only for cards it proves it installed,
one-shot per card, rate-limited; the operator does everything else.** A
holder-session token (`kind='holder'`) can call `/keys/issue` for a short id
only where the registry shows that short id was installed by that holder's
session, and only once — a second call is refused, because the set is already
on the phone that installed the card and a re-issue is an operator question.
Rate limits bound the damage of a stolen holder token to a stream of one-shot
requests, not a bulk read.

The operator session reads batches, posts registries, creates batches, writes
cap releases — everything except the one holder path.

What this asks Foxy to accept: a Foxy holder app gets the same narrow path
Flash's does, and nothing wider. The IdP behind the holder session is Q5.

## Q5. The holder session's identity provider

**Proposed: deferred — holder access disabled until Phase 5b.** The IdP may
be Flash account, Foxy's own, or both, subject to sign-off. The shape-only
holder proof stub is development-only: deployed holder-session creation and
holder key issuance stay disabled until verified identity and per-card
authorization exist. The operator release does not depend on choosing the
consumer IdP; Phase 5b does.

## Sign-off status

| Question | lnflash proposal | Foxy answer |
|---|---|---|
| Q1 hosting | lnflash alone, one shared root | pending |
| Q2 rotation-time | signed export, wrapped to Foxy's key | pending |
| Q3 review scope | derivation spec + this doc, no KMS | pending |
| Q4 minting rights | holder: one-shot, proved install, rate-limited | pending |
| Q5 holder IdP | deferred to Phase 5b | pending |

Phase 5b does not start until this table has a Foxy column.
