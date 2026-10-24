<a id="ops-governance--proposed-pending-foxy-sign-off"></a>

# Ops governance proposal

Status: pending Foxy sign-off. These proposals describe partner custody and
consumer access. [D30](DECISIONS.md#d30) allows the operator release to proceed
separately; partner-facing consumer flows remain gated on agreement.

The service architecture is in [D29](DECISIONS.md#d29), with its
[threat model](OPS-THREAT-MODEL.md) and [deployment plan](OPS-WORKERS-PLAN.md).
The table below records the outstanding partner decisions. Proposed contracts
require implementation and validation before they can be offered as guarantees.

<a id="q1-hosting-and-who-can-see-the-escrow"></a>

## Q1. Hosting and escrow access

Proposed: a lnflash-operated Cloudflare Worker and one SQLite-backed Durable
Object, with one shared derivation root and escrow. Its backups and alerting
are separate from the Forge mint. Independent encrypted exports and a tested
restore are deployment gates.

This custody model gives service runtime and Cloudflare account administrators
technical access to every escrowed manager-key set, including Foxy-issued
cards. Partner-scoped reads and access auditing must be specified and accepted
at sign-off. Current operator reservation checks do not establish that complete
partner-governance contract.

Alternatives are a Foxy-operated service with its own root and escrow, or
per-partner roots within one service. Both require changes to operation,
derivation or recovery that the partners must review.

<a id="q2-foxy-cards-at-rotation-time-service-down-or-relationship-over"></a>

## Q2. Escrow export and service continuity

Proposed: lnflash supplies a partner-filtered escrow export, signed by the
service and encrypted to a Foxy-held public key. The contract specifies the
export cadence and the delivery window after a relationship ends.

The last delivered export covers the sets issued before that snapshot.
Sets issued afterward remain exposed to loss until the next export. Foxy must
accept the cadence and test recovery with its retained decryption authority.
The operator backup format does not implement this proposed partner export.

<a id="q3-what-foxys-security-review-sees"></a>

## Q3. Security review scope

Proposed review materials are the HKDF-SHA256 derivation, source code,
custody agreement, threat model and holder-facing API. [D29](DECISIONS.md#d29)
and `ops/src/keys.ts` describe master-to-card derivation for `enc`, `mac`
and `dek`.

The reviewer examines the derivation and escrow behavior through documents
and code. Live master keys, escrow contents and KMS configuration stay within
the operational custody boundary. Alternatives include a wider infrastructure
audit by Foxy's chosen reviewer or a jointly commissioned independent audit.

<a id="q4-holder-session-vs-operator-session-minting-rights"></a>

## Q4. Holder and operator issuance rights

Proposed: a holder session (`kind='holder'`) may request one key set through
`/keys/issue` for a card it proves it installed. The registry must bind that
card to the holder session. Requests are rate-limited; repeat issuance requires
operator review. The same restrictions apply to Flash and Foxy holder apps.

Operator sessions manage batches, registry records and CAP releases under
their own authorization rules. The consumer proposal requires verified
identity and per-card authorization before holder-session creation or key
issuance can be enabled.

<a id="q5-the-holder-sessions-identity-provider"></a>

## Q5. Holder identity provider

The identity provider is deferred to Phase 5b. It may use Flash accounts,
Foxy accounts or both, subject to agreement. The shape-only holder proof stub
is development-only. Deployed holder access stays disabled until the chosen
identity and per-card authorization path is implemented and reviewed.

## Sign-off status

| Question | lnflash proposal | Foxy answer |
| --- | --- | --- |
| Q1 hosting | lnflash operation, one shared root | pending |
| Q2 continuity | Signed partner export encrypted to Foxy's key | pending |
| Q3 review scope | Derivation, source and agreement within the custody boundary | pending |
| Q4 issuance rights | Holder: one request, proven installation, rate-limited | pending |
| Q5 holder IdP | Deferred to Phase 5b | pending |

Phase 5b requires a recorded Foxy answer for each question.
