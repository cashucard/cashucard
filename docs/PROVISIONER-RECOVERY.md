# Provisioner card identity and interrupted install recovery contract

ENG-741, 2026-10-20. This is the implementation contract for the operator app,
cardkit and ops service after [D30](DECISIONS.md#d30). It does not enable consumer
issuance or change the 2.1 applet wire. [D31](DECISIONS.md#d31) records the
decisions. The service reservation endpoints below are implemented; the durable
attempt journal, durable batch coordinator, reservation transport and injected
card orchestration now exist. The real recovery screens and native session
adapter are wired behind a disabled installation gate ([D36](DECISIONS.md#d36)). [D32](DECISIONS.md#d32) records
the HTTP migration and restored-service admission gate.

An interrupted run keeps the same reserved batch and ordinal. Resume identifies
the presented chip, inspects the existing installation, and continues only the
operation whose durable intent permits it. Missing evidence stops the run;
neither a lost reply nor a restarted app authorizes reinstalling a completed card.

## Identity and evidence

| Identifier | Meaning and use | Limits |
|---|---|---|
| `chip_id` | Operational identity before and after applet installation | Public, not proof of ownership or resistance to cloning |
| `installation_id` | Full compressed 33-byte secp256k1 applet public key, lowercase hex | Generated on-card; changes on reinstall; absent on a blank card |
| `display_id` | Last two public-key bytes, lowercase hex | Display only; collisions are allowed |
| `attempt_id` | Random UUID persisted before creating a server reservation | Idempotency and workflow identity, not a credential |
| `device_id` | Random UUID persisted once per app installation | Operational batch binding, not device attestation |

For the J3R180 target, select the ISD and read GET DATA CPLC (`80CA9F7F00`)
before authentication. Require success and a well-formed `9F7F` TLV containing
42 bytes. Interpret fields as opaque bytes, not calendar dates. Define:

```text
chip_id = "cplc-v1:" + lowercase_hex(
  ICFabricator[2] || ICType[2] || ICFabricationDate[2] ||
  ICSerialNumber[4] || ICBatchIdentifier[2]
)
```

The owner's existing [gp-info capture](../tools/cardkit/gp/test/fixtures/gp-info.txt)
contains those fields and yields `cplc-v1:4790d3213041093363205547`. This shows
that this chip exposes the fields without login over the captured reader. It
does not establish fleet uniqueness, cross-phone behavior or stability across
reinstall. Reject malformed responses and zero/all-FF serials; missing CPLC or
an identity mismatch prevents authentication and mutation in the automated loop.
Do not substitute NFC UID or SCP02 diversification data.

A subsequent [USB-reader check](HARDWARE_TEST_REPORT_2026-10-20.d321-cplc.md)
read another card three times across PC/SC reconnections, consistently yielding
`cplc-v1:4790d3213180072976207515`. That provides a second distinct observed
composite and repeat-read evidence on the ACR122U. It does not cover physical
reset, phones or reinstall; those gates remain open.

CPLC is a guard against accidental card substitution. Authorization comes from
the operator session and its permitted reservation. A card cryptogram proves
possession of a candidate manager key set, not globally unique silicon identity;
factory keys are shared. No claim here turns public CPLC into authentication.

The full applet key must have the expected compressed-key encoding and be
validated as a secp256k1 point before registry acceptance. Reading it requires
the complete card applet AID. Cardkit's install result currently returns APDU
metadata, not GET_PUBKEY response bytes; add an explicit read or a typed result.
The load-file hash records the intended pinned artifact, not chip attestation
of its installed code.

Cardkit now exposes `parseCplc(data)` and `readChipIdentity(tx, expectedId?)`
through its public entry point. The reader selects the full ISD AID and issues
GET DATA once. It rejects non-success status, malformed CPLC, unusable serials
or a saved-identity mismatch without authentication or retries. The library
uses its existing SELECT builder, including Le `00`; the separate USB check used
GlobalPlatformPro's raw SELECT without Le. Parser replay and fake transports
validate this implementation. The TypeScript reader now also has
[read-only phone evidence](HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md):
three documented reads on the Pixel 8 Pro and Max (iPhone 13 Pro Max) match the
same card's USB baseline. Identity stability through install/rotation, a distinct
card sample and termination/recovery behavior remain unverified. The gated real
loop uses this reader; installation stays disabled.

## Service reservations and retry identity

Each batch belongs to one operator and one device for this rollout. Enforce
that association on the service, not only in the screen. Device IDs do not
replace operator authentication. Sharing batches or automatic device takeover
is outside this first contract; operator reassignment needs an explicit,
audited reconciliation procedure.

Operator sign-in returns the stable `operator_id` alongside token and key
environment. Never infer that identity from the
typed username. Load pending journals before enabling batch creation, and stop
if loading storage fails rather than generating another device identity.

The following are operator-only service routes. Authenticate before returning
reservation state or keys; enforce ownership on every mutation and key fetch.

| Route | Required behavior |
|---|---|
| `POST /provisioning/batches` | Accept persisted `batch_request_id`, `device_id` and PIN-free batch configuration. Atomically save request identity and create batch plus escrow. Identical retry returns the same batch; changed configuration returns 409. |
| `POST /provisioning/attempts` | Accept persisted `attempt_id`, device, batch and ordinal. Reserve atomically; enforce unique `(batch_id, ordinal)` and one active attempt per device. Identical retry returns the reservation; another attempt cannot claim it. |
| `GET /provisioning/attempts/:attempt_id` | Return the authoritative reservation and recorded outcome after reauthentication. Include a revision for conditional state transitions. |
| `POST /provisioning/attempts/:attempt_id/bind` | Bind validated `chip_id` before mutation. Same binding is idempotent; a different binding or conflicting active use of that chip returns 409. |
| `POST /provisioning/attempts/:attempt_id/record` | Validate the full installation key, chip binding and reserved ordinal; atomically save completion and its immutable receipt. Identical retry returns the stored receipt; changed data returns 409. |
| `POST /provisioning/attempts/:attempt_id/disposition` | Explicitly acknowledge quarantine or abandonment, preserving evidence and consuming the ordinal. Return an immutable disposition receipt; release the device's active reservation so another safe card can be processed. An unresolved chip stays blocked from new attempts. |

For binding, completion and disposition, recognize an identical previously
applied operation and return its saved result before checking the revision.
Require the current revision only for a new transition. Changed retry data is
a conflict. Lost acknowledgements can be recovered by reading the attempt,
never by advancing a locally assumed revision. Repeat an identical batch POST
to recover its lost response; a separate batch lookup route is unnecessary.
The service is authoritative for reservation ownership; the local
journal is authoritative evidence of which destructive operation was started.
A server reservation alone never proves that an APDU reached a card.

Persist a batch request ID and its configuration before POST. Include every
nonsecret setting in its canonical fingerprint: mint, count, PIN policy, limits,
load hash and manager-key environment. Do not persist an actual PIN or a
low-entropy PIN hash in the journal. The new batch contract excludes PIN values;
the existing `pin_batch` request field is not its recovery mechanism.

Allocate ordinals monotonically. An uncertain or quarantined attempt consumes
its ordinal; do not recycle it for another card. After recovery resolves an
attempt, durably acknowledge that outcome before reserving the next ordinal.
Recovering a lost local journal requires explicit operator reconciliation with
server reservations; it must not silently start a fresh device or batch.

`POST /keys/issue` now requires `attempt_id` and `device_id`; optional numeric
batch/ordinal references must match that authorized active reservation. There
is no numeric-only fallback, even for legacy rows. Fetch the same escrow set for
that batch/ordinal into memory before
arming NFC; never enumerate other ordinals to find a matching key.

Legacy `POST /registry/batches` and `POST /registry/cards` return 410. Their GET
routes expose only the signed-in operator's legacy data, with no PIN values.
New full-key installation records live separately and are reached through their
attempt receipts; they are not synthesized into the suffix-only legacy list.
An inaccessible operator/device binding returns 404. No route accepts a body
operator identity as authority.

The completion body is strict: `attempt_id`, `batch_id`, `ordinal`, `chip_id`,
`installation_id`, `display_id`, `load_sha256`, `gp_key_version`, `operator_id`,
`device_id`, `key_env`, `configuration_revision: 1`, `verified_stage: "rotated"`
and `verified_at` (Unix seconds). Completion returns `ready_for_holder: false`:
personalization is not implemented. An installed-only attempt remains active
and can fetch its assigned set for rotation; it cannot be terminally recorded.

Holder-controlled ownership is now selected in
[D44](DECISIONS.md#d44). The [handoff contract](PROVISIONER-HOLDER-HANDOFF.md)
separates the operator installation receipt from wallet-owned personalization.
Ops-service manager-key escrow is not an owner-signing service. Existing
completion bodies and false readiness receipts remain compatible.

## Durable local journal

Use one transactional local store for the active attempt, batch progression and
frozen registry outbox. Await the transaction before sending an APDU or POST
that depends on it. Persist a schema version and these nonsecret fields:

```text
service_origin, operator_id, device_id, batch_request_id, batch_id,
attempt_id, ordinal, reservation_revision, chip_id?, installation_id?,
load_sha256, nonsecret_configuration, stage, started_at,
observed_gp_key_version?, frozen_record?, completion_receipt?, quarantine_reason?,
preinstall_state?, preinstall_installation_id?, replacement_consent?,
installation_verification?, disposition_receipt?
```

An origin includes scheme, host and port. Do not replay a journal against another
service or signed-in operator merely because its numeric batch IDs match.
Changing service or account preserves the pending journal for explicit recovery;
sign-out does not erase it. Bearer tokens, manager keys, PINs, owner private keys
and sensitive APDU transcripts never enter this store, diagnostics or exports.

A failed journal commit sends no dependent destructive APDU. Cardkit's `onEvent`
is synchronous, ignores callback exceptions and is not awaited; it is progress
reporting, not a persistence boundary. Write intent outside `provision()` and
`rotateKeys()`. The storage implementation must demonstrate app-termination
recovery on each phone; local fake-store tests cannot establish power-loss
durability on a device.

`apps/provisioner/src/journal.ts` handles attempt transitions; the schema 2
`provisioningWorkflow.ts` coordinator embeds that journal with the batch request,
pending reservation, stable device UUID and acknowledged history in the same
snapshot. See [D33](DECISIONS.md#d33) and [D34](DECISIONS.md#d34). It persists
creation UUIDs before POST, replays lost responses with the same identity,
retains server revisions and stops when an acknowledged attempt disappears.
It scopes requests to the authenticated operator ID returned by sign-in.

The coordinator's `withAttempt` serializes journal commits with batch operations;
the future NFC caller must verify the card before reporting success and await
intent before card commands. `advance` reconciles the receipt and commits
history/progress together. `closeBatch` only releases local history after a
complete batch is still recognized by the service, retaining device identity.
The schema 2 envelope uses the existing fixed storage key; a standalone schema 1
attempt stops without replacement because its batch evidence is missing.

The real recovery screens use these helpers separately from the legacy outbox.
The injected `provisioningTap.ts` orchestration binds before mutation, adopts only
complete new installations, recovers rotation with the same assigned set and
replays records without NFC. Quarantine disposition intent/receipt handling is
implemented by `acknowledgeQuarantine`; unresolved chip repair, partial-install
repair, phone termination evidence and personalization remain pending.
[D35](DECISIONS.md#d35) records the conservative stop and observed-key-version
rules. The real screen/NFC session adapter remains gated.

## Stages and recovery decisions

Every resumed NFC session reads and matches `chip_id` before authentication.
Where an installation key is saved, read it again and require equality before
rotation or completion. A changed key is a conflict, not permission to overwrite
the saved identity. A retry is a new intentional tap after reauthentication and
inspection; there is no automatic authentication retry loop.

| Durable stage | Action allowed on a normal run | After interruption |
|---|---|---|
| `reserved` | Fetch keys; read and bind chip; persist `install_intent` | Recover reservation, match/bind chip, inspect applet state before choosing an action |
| `install_intent` | Call guarded install with the pinned asset and explicit replacement consent | Compare the observed key with the saved pre-install state. Adopt a new installation only under the rules below; absent, unchanged or partial states need reconciliation. |
| `installed` | Full key and verification evidence are already committed with this stage; next commit `rotation_intent` | Verify the same chip, key and applet state; do not reinstall |
| `rotation_intent` | Call `rotateKeys(factory, assigned)` for the reserved set | Refetch that exact set, verify chip/key, call the same rotation recovery path; never call install |
| `rotated` | Continue the separately specified personalization sequence | Verify active assigned keys and installation identity; uncertain configuration stops before claiming completion |
| `record_pending` | POST the durably frozen complete record | Read any existing receipt or replay exactly the same record; no NFC or mutation is needed just to retry a record |
| `recorded` | Save receipt and batch progression atomically; allow next card | Show the receipt; never repeat installation or consume another ordinal |
| `quarantined` | Show what is known and the operator action needed | Preserve across restart; no authentication or mutation until an explicit resolution |

Before any install intent is saved, inspect the applet and retain the existing
guard against value, owner, PIN or records. Replacement consent applies only to
the inspected installation and attempt. Persist whether the applet was absent
or present, its full pre-install key when present, the guard observations and
that consent separately from the new `installation_id`. Unknown inspection
state cannot enter `install_intent`. A transport failure does not grant
blanket `replace: true` consent on the next tap.

If replacement stopped before DELETE, the original empty applet may still pass
verification. A key equal to `preinstall_installation_id` is not evidence that
replacement happened: perform only the still-authorized replacement after
rechecking its guards, or quarantine. A present applet can be adopted as the
interrupted new installation only if it was previously absent or its key differs
from the inspected prior key, and full installation verification succeeds.
Atomically save the new full key, verification evidence and `installed` stage;
a keyless `installed` journal is invalid.

If `install_intent` resumes with no card applet and only a recoverable partial
load, the next deliberate tap may use the existing guarded clean-and-load path
on the matched chip and same ordinal. If the applet exists but tag/package
verification is incomplete, either finish only the missing non-destructive
steps with a reviewed reconciliation helper or quarantine. Do not sweep a
generated applet key merely to simplify recovery. This helper does not exist
in current cardkit. The first orchestrator conservatively quarantines all absent
or incomplete resumed installs; automatic clean-and-load recovery is not wired.

An intentional reinstall is a new attempt with a new ordinal and installation
history, explicit consent and the normal empty-card guards. Retain the old
installation record. Never repurpose a still-uncertain attempt as a reinstall.

For a lost PUT KEY response, existing cardkit performs one INITIALIZE UPDATE
and checks its cryptogram offline against factory and the assigned set. It
authenticates only a matching set, then either rotates or confirms the assigned
set is already active. Keep that behavior. Wrong keys, authentication refusal
or lock indications latch quarantine across restart; an app restart is not a
reset of a card's authentication counters.

Quarantine remains a durable stop until acknowledged by the operator. Saving
the server disposition receipt and local acknowledgement allows the next card,
but does not clear that chip's unresolved state or reuse its ordinal. The same
card cannot re-enter automatic authentication merely through another batch,
device or app restart. Later repair/reassignment needs explicit reconciliation;
terminal disposition is not permission to erase or finish the quarantined card.

## Completion and registry migration

Make `attempt_id` the completion retry identity and the full applet key unique
for an installation. Store `chip_id` separately so an intentional reinstall can
retain both installation records for the same chip. `display_id` has no unique
constraint. Bind completion to the reserved batch/ordinal and chip; do not
accept an arbitrary installation record merely because the operator supplies
an existing batch ID.

The frozen completion body includes attempt ID, batch/ordinal, chip ID, full
installation key, display suffix, load hash, observed GP key version, operator
and device IDs, configuration revision and explicit verified stage. Define its
timestamp as `verified_at`, when this app most recently established the recorded
state. Do not invent an exact original install time after a lost reply. Persist
this body before its first POST; retry never substitutes a fresh timestamp.
The final ready-for-holder receipt requires personalization evidence from that
separate contract, not an `installed` or `rotated` observation alone.

Preserve existing suffix-only rows as explicitly legacy/unresolved. Never
fabricate missing full keys or merge rows by suffix. Recovery exports must
version and retain reservations, batch request identities, chip bindings, full
installation history and completion receipts, excluding credentials and PINs.
Restore must preserve idempotency so a retry cannot create another batch or
installation after disaster recovery.

Export version 2 preserves those provisioning tables and accepts version 1 as
legacy recovery without inventing reservations. Every restore sets a durable
`recovery_required` gate. Authenticated attempt inspection remains available;
all provisioning mutations and key fetches stop with 409 until reconciliation.
This also prevents an unknown POST from silently becoming a new request after
its original request identity was lost from an older backup. No HTTP unlock is
provided. Reopening admission requires a reviewed operator reconciliation and
client fencing procedure; clearing the database flag alone is not that procedure.

Snapshots must preserve request fingerprints, operator/device scope, attempts,
revisions, terminal dispositions and receipts in the same consistent snapshot
as escrow. If a restored service no longer knows an attempt that the phone
holds, stop for reconciliation. Do not recreate it or issue keys solely because
the numeric batch/ordinal exists. Every fetched set must name the expected
attempt binding. Newer phone evidence is not automatically authoritative over
the service restored from an older backup.

Replace the ambiguous placeholder `key_id: 2` with an explicit observed
`gp_key_version` in the new record. It is the SCP02 key version, not the ordinal,
escrow identity or applet version. Current captures use in-place KVN `01`;
expose the actual handshake/result metadata rather than hardcoding it.

Cardkit now exposes `inspectInstallation(tx)` for typed, read-only 2.1
inspection and `confirmManagerKeys(tx, keys, options)` for assigned-only
confirmation without PUT KEY. Successful rotation/confirmation returns the
key version observed during authentication; the app persists that version
before freezing the record. Parser/model tests do not establish chip behavior.

`provision()` installs applets; it does not configure the mint, owner, PIN or
limits. `rotated` therefore does not mean ready for the holder. Before enabling
the real success panel, define and verify a separate personalization contract,
including recovery if a PIN-setting reply or the phone's in-memory PIN is lost.
No guessed PIN retries, fabricated PIN display or “Done” for an uncertain state.
Until then, installation/rotation may report only their exact completed stage.

## Focused acceptance checks and hardware gate

Reuse cardkit's existing interrupted-rotation matrix and offline key-match
tests. Add orchestration scenarios for these distinct guarantees:

1. Lost batch/reservation acknowledgements and restart recover the same IDs and
   ordinal; changed request data conflicts. Identical bind/record retries return
   their receipts even when their originally submitted revision is now stale.
2. A failed journal commit prevents destructive APDUs. A wrong chip or saved
   installation-key mismatch prevents authentication and mutation.
3. A completed install followed by termination before saving its result resumes
   without DELETE/LOAD. An unsafe partial install quarantines instead of sweeping.
4. Lost PUT KEY response plus process loss refetches the same assigned keys and
   finishes without failed authentication or reinstall.
5. Lost registry acknowledgement replays the frozen row byte-identically; full
   keys with the same suffix remain separate; intentional reinstall keeps history.
6. Persisted state survives sign-out/termination without keys, tokens, PINs or
   sensitive transcripts. Switching service/operator/device never silently replays
   pending work. Unknown personalization cannot produce a success panel.
7. A crash before replacement DELETE never mistakes the untouched original
   applet for the new install. Terminal quarantine permits the next safe card
   only after acknowledgement, without freeing the uncertain chip or ordinal.
8. A restored service missing a newer reservation stops for reconciliation,
   rather than rebuilding identity from numeric batch/ordinal IDs.

Replay the existing owner CPLC capture for parser tests and use synthetic
counterexamples for malformed, zero, duplicate and mismatched identities. Never
modify or generate owner capture fixtures. Service transactions and a fake
transport suffice for these automated checks.

Before enabling automatic physical-card recovery, an operator-approved hardware
plan must name the devices and actions and verify CPLC availability on both
phones, stability before/after the approved install/rotation sequence, and
distinct identities on the approved card sample. Also verify journal behavior
under app termination. Record results and limits in a hardware report; a small
sample is not proof of global uniqueness. No hardware actions are authorized by
this document. Until the device evidence lands, batch creation and physical programming remain
disabled by `apps/provisioner/src/releaseGates.ts`. Frozen-record retries and
explicit stop acknowledgement remain available without NFC. Installation receipts
never certify holder readiness; that requires the separate personalization contract.

The proposed [owner-run device validation checklist](PROVISIONER-DEVICE-VALIDATION.md)
names the candidate devices, preparation gaps, bounded checks and required
evidence. It does not authorize hardware actions or mark any check as passed.
