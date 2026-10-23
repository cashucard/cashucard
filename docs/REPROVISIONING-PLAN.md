# Safe reprovisioning gate (#92)

The next mobile release can carry the batch-count and reconciliation fixes.
It must not advertise a reset for a previously provisioned card yet. The
current replacement path knows the factory manager keys but has no contract
for finding the current rotated keys from another service. A failed manager
login can permanently lock a card. Holder setup does not restore factory
manager keys.

The intended operation is **replace the Cashu applet and its card-manager key
assignment**, not a chip-wide factory reset. It changes the applet identity
and erases its owner binding, PIN/configuration and any proofs stored in that
applet. A wallet's display of an empty card is not sufficient evidence that
all owner-bound value has been safely handled.

Before enabling a reset action:

1. Inventory the staging, local and production service origins that have
   issued keys. Define a single authorized lookup for the exact CPLC and
   installed applet identity, backed by escrow records or a reviewed import
   of those records. Missing or ambiguous provenance must stop before SCP02;
   factory keys must never be a fallback guess.
2. Specify a funds-handling procedure for an owned card. A read-only
   inspection should capture identity, applet version and available public
   state. A holder/operator procedure must settle or explicitly account for
   proofs and ownership before applet deletion. If that cannot be proven,
   stop without changing the card.
3. Define an audited reconciliation action for existing active and
   quarantined attempts. It must preserve the old installation history and
   cannot clear a quarantine merely to permit another reservation.
4. Add a reset-intent journal bound to CPLC, old installation ID, key-source
   reference and explicit card-specific consent. Recheck those identities on
   the destructive tap. After interruption, inspect and adopt verified work;
   never replay a DELETE, LOAD or key rotation merely because a reply was
   lost.
5. Prove missing/incorrect provenance, existing value, consent, quarantine
   and interruption boundaries against fake cards and service fixtures.
   Then run a separately approved disposable-card hardware plan before
   enabling the feature in a store build.

The unresolved operator inputs are the authoritative locations of historical
escrow records and the approved procedure for cards that may hold value. These
are release gates for #92, not reasons to block the batch-count and diagnostic
improvements in #89 and #91.

## Three owner-held cards (2026-10-23)

The operator owns the three known programmed cards, their mint and the phones
with owner keys. A complete inventory of all three is not needed to develop
the reset flow. Each destructive attempt still needs its own CPLC, applet
public key, exact escrow row, proof-slot inspection and explicit consent.

The first software slice exposes read-only proof and owner state and a pure
preflight gate. It does not authenticate, delete, rotate keys or clear an
attempt. Next, add a service escrow lookup and durable reset intent, followed
by an interruption-aware cardkit reset operation and phone review. A card
without a 2.1 applet needs a separate reconciliation path; the preflight does
not treat applet absence as an authorized reset. The first physical run needs
an approved plan naming that card and the specific commands.

The second slice adds a metadata-only service lookup for the exact CPLC and
applet public key. An unresolved attempt blocks the lookup even when an older
record exists. The response contains no key bytes and is not a reset permit.
The durable intent, audited reconciliation and card operation remain the next
implementation gates.

The phone now has a separate nonsecret reset journal. Its deletion stage
requires a service intent receipt and survives a lost reply. It is not wired
to a card operation yet; the service intent endpoint, applet/package state
inspection, reconciliation and the destructive operation remain gated.

The service authorization core now persists an exact same-service source,
inspection and consent, fences the chip/device, and retains those rows through
export v5. It has no HTTP reset or key-release route yet. Completion evidence,
cross-origin source import, reconciliation and cardkit execution must be in
place before exposing the feature.

Cardkit now implements the reset against a fake card: exact-chip/public-key
inspection, durable deletion intent, observed registry ownership, ordered
removal, durable rotation intent and confirmed factory keys. Tests cut before
and after each destructive command and simulate failed journal commits. This
has not run on a physical card. Service completion, historical escrow import,
stopped-attempt reconciliation and the phone UI still gate a real reset.

The service now supplies actor/device-scoped reset keys and immutable
completion receipts. Completion closes that key endpoint and releases the
matching reset admission block. Export v6 retains pending and completed work.
For the historical local cards, prefer executing against the original local
escrow and retaining public completion evidence; transferring manager keys to
production is not required merely to return an empty card to factory keys.
Any production quarantine still needs a separate audited reconciliation.

The local recovery runner and restricted PC/SC bridge are prepared for the
named-card drill. Default preview matched card 09336320's exact historical
source without accessing a card or key bytes. Fake integration tests cover a
lost DELETE reply and a lost completion acknowledgement. The physical reset
still requires approval of [its exact plan](OWNED-CARD-RESET-DRILL.md).

The first approved physical reset has now passed on J3R180 card 09336320:
Cashu package absent, factory manager keys verified at version 1, original
escrow/history retained and completion saved. See the
[hardware report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md).
Fresh mobile installation, production quarantine reconciliation if needed,
physical interruption testing and the phone reset UI remain separate work.
