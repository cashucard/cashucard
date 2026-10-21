# Holder-controlled ownership and provisioning handoff

ENG-741, 2026-10-20. The operator selected holder-controlled ownership.
This contract separates issuer installation from holder setup. It authorizes
no card operation, deployment, holder-session access or release-gate change.
The wire remains [APDU.md](../spec/APDU.md); no new card command is proposed.

## Authorities

| Authority | Location and role |
| --- | --- |
| Card spending key | Generated and retained inside the chip; never exported. Signs the card's payments. |
| Card-manager keys | Existing ops-service escrow; scoped applet-management access. Not an owner-signing authority. |
| Owner key | Holder wallet controls the P-256 private key and its backup/recovery. Administers PIN, limits and authorized loads. |
| Operator session | Authorizes an issuer batch/attempt, not ownership of the holder's wallet or its funds. |

Neither the provisioner nor ops-service generates, stores, derives or receives
the holder's private owner key. Do not reuse the manager-key master, a temporary
phone key, the operator's personal wallet or the published TEST owner key.
A wallet may follow the existing per-card owner derivation in the protocol;
this repo defines the public integration boundary, not the wallet seed store.

Manager-key custody remains a separate trust risk: replacing an applet can
remove its private spending key and destroy access to funds. Holder ownership
does not remove issuer management authority or make its escrow harmless.
The existing empty-state guard and operator authorization remain mandatory.

## Product completion states

1. **Installed and recorded:** verified applet, full chip/installation binding,
   assigned manager-key state, immutable service receipt. This is the operator
   provisioner's batch-completion event. Existing receipts continue to say
   `ready_for_holder: false`; they do not mean personalized or safe to spend.
2. **Awaiting holder setup:** the intended holder has the physical card and
   opens a compatible wallet. No issuer-generated PIN or temporary issuer
   owner is needed. Installation records can identify the card, but do not
   prove that the person holding it is its rightful recipient.
3. **Holder setup verified:** the holder wallet establishes ownership,
   configuration and PIN state using the sequence below. Payment readiness is
   a separate result; it cannot be derived from an operator installation receipt.

A bulk-installed unowned card can be claimed by the first reader that sets an
owner. The current wire has no claim-token check on initial SET_OWNER. A QR,
service receipt or handoff token cannot enforce that check on the card. Keep
unowned cards under issuer physical control until direct holder setup; do not
claim secure unattended/shipped handoff. If unattended delivery is required,
review an additional protection design rather than silently adopting temporary
issuer ownership or turning on holder key issuance.

## Holder setup boundary

The wallet performs personalization while the card is in the holder's hands.
It needs no manager-key fetch or ops-service holder token for these existing
applet commands. Existing consumer provisioning/key-issuance gates stay closed.

Before mutation, match the full chip/installation identity, supported version,
empty/unlocked state and intended configuration. A present unknown owner,
unexpected PIN, funds, identity mismatch or malformed read-back stops setup.
Select the applet only once for a sequence that depends on transient grants;
reselection/deselect clears PIN verification and owner nonces.

The nonsecret configuration freezes mint/unit, refund public key, card design,
owner public key/reference, anchor-header identity, daily/payment/no-PIN limits
in sats and rollover budget. Validate wire lengths/ranges before any write.
If dollars are offered, freeze the quote source/time, exact conversion and
rounding; do not recalculate a replayed configuration. V1 can offer satoshi
limits first rather than introduce a rate dependency.

| Step | Existing wire operation and evidence | Interruption rule |
| --- | --- | --- |
| PIN setup | Holder chooses/generates a PIN in the wallet; SET_PIN, then VERIFY_PIN for that exact known value. Never send a guessed PIN. | Persist nonsecret intent first. If reply/state or in-memory PIN is lost, stop pending reconciliation; do not fabricate a PIN display or automatically verify a replacement guess. |
| Card record | SET_CARD with exact frozen unit/refund key/mint/design. Compare GET_CARD read-back; PIN authorization must still be live. | Inspect the same installation and compare exact public fields before deciding whether any write is necessary. |
| Owner | SET_OWNER with the holder's public key and approved anchor header. GET_INFO's owner bit alone cannot identify that key. | Retain owner public reference/intention. Prove control with a fresh nonce and an authorized owner command; unknown owner or unavailable signer stops. No replacement using an issuer key. |
| Limits | Fresh GET_NONCE and holder-signed SET_LIMIT, full 13-byte values. Obtain holder-signed ALLOW_LOAD when needed to read the protected payment limit, then inspect extended GET_INFO and GET_CARD. | Exact public read-back plus authorized owner evidence must establish the state. Never infer success solely from an intent or an owner-present bit. |
| Final verification | Recheck installation identity and actual configured state; separately establish the known current PIN state and holder handoff acknowledgement. | Unknown PIN, owner authority, anchor or configuration keeps setup incomplete. Never load funds as a provisioning test. |

A signer interface accepts only a named command purpose, exact public operation
context and fresh card nonce; it returns the proof. Private owner material stays
inside the wallet. Do not persist replayable raw signatures or PIN-bearing
payloads as ordinary diagnostics. Owner-authorized PIN repair is distinct from
issuer recovery and requires the holder's explicit approval.

The exact safe recovery for a lost PIN-setting response is a mandatory next
implementation slice. Existing wire may permit resetting an unowned empty
card, or CHANGE_PIN once the expected owner is proved; neither is authorized
as an automatic workaround by this contract. Keep it incomplete until the
state, authority and explicit recovery action are established and tested.

## Persistence and service evidence

Keep the existing installation journal/receipt immutable. Holder setup uses a
separate wallet-owned durable record bound to full chip and installation IDs
and a canonical nonsecret configuration identity. Save intent before mutation,
observation after read-back and an exact frozen completion body before delivery.
No PIN, low-entropy PIN hash, wallet seed, owner private key or manager key goes
in ordinary journals, records or recovery exports.

A future holder-completion API must authenticate the holder's authority for
that installation and fence replays/configuration changes. Card AUTH proves
possession of the spending key, not correct mint/PIN/owner configuration or the
human's ownership. The current wire does not sign a full configuration
attestation; document any trusted-wallet assertions rather than describing them
as cryptographically verified card configuration. No server boolean can fill
missing card evidence. That API is not required for issuer installation v1 and
must not reuse the disabled shape-only holder-session path.

## Next implementation slices

1. Update the real operator flow to describe installed cards as awaiting holder
   setup. Preserve false holder-readiness receipts and existing API compatibility.
2. Remove misleading issuer PIN/limit promises from the real setup UX; retain
   historical batch fields for recovery compatibility until explicitly migrated.
   Demo design changes are separate from evidence for real behavior.
3. Public card-configuration value codecs and bounded GET_CARD read-back are
   implemented in `tools/cardkit/gp/configuration.ts` (D45), with synthetic wire
   tests. No signing, secret handling, mutations or readiness assertion are
   included. Wallet orchestration and read-back of protected limits remain next.
4. Define the injected holder-signer and unknown-PIN recovery behavior, then
   implement wallet setup orchestration with narrow fake-transport regressions.
5. Review a holder integration with the wallet owners. Keep production deployment
   and physical enablement separately reviewed; unavailable Max hardware does
   not prevent these software slices.


## Implemented signing boundary and remaining PIN work

`tools/cardkit/gp/holderCommands.ts` implements the injected public owner-command
boundary in D46. It matches full identity, requires durable intent before nonce
and signing, supplies immutable public context/message, and sends at most one
owner write. The wallet adapter remains responsible for key custody and explicit
operation approval. Synthetic transport tests and existing public P-256 vectors
exercise the boundary; no real wallet or physical card integration is claimed.

The initial SET_OWNER, PIN setup/change, anchor acquisition and completion
orchestration are not exposed through this helper. PIN recovery must implement
these separate outcomes before any of those paths can certify readiness:

| Observed state after interruption | Permitted continuation |
| --- | --- |
| Current PIN known only in the same live wallet session | No automatic VERIFY retry after an uncertain verify reply. Establish authoritative state and explicit holder action; wrong/blocked status stops. |
| PIN lost from memory, card still unowned and empty | Stop with unknown PIN. Offer a separately approved reset only after exact identity, owned-state and empty-state checks; never try guessed old values. |
| PIN lost, expected owner authority can be proved | Explicit holder-authorized CHANGE_PIN with a new known value is the recovery candidate; fresh intent/nonce and read-back are required. Do not require guessing the old PIN. |
| Owner unknown or signer unavailable | Stop and retain evidence; neither ops-service nor a temporary issuer key may take ownership to bypass it. |
| Identity, funds, lock or record differs from saved context | Stop before mutation and retain the original setup record. |

These are recovery requirements, not implemented reset commands or hardware
authorization. A reply lost after a write remains an uncertain write; the next
layer must reconcile before another operation. No ordinary journal stores the
PIN or a reusable PIN-derived hash. A background service retry cannot authorize
a new PIN attempt or replace holder acknowledgement.
