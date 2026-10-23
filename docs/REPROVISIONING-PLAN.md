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
