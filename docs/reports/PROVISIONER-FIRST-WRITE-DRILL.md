<a id="first-provisioning-write-drill--proposed-not-yet-authorized"></a>

# First provisioning write drill: proposed scope

Historical validation plan from 2026-10-20. Gate values and proposed actions
below describe that stage. Current operator behavior is documented in
[Provisioner screens](../PROVISIONER-APP.md); execution results belong to
the dated hardware reports. Repeating a hardware drill requires its
own approved device/card scope.

ENG-741, 2026-10-20. The six CPLC reads passed; they did not establish that the
card is blank, disposable or on factory manager keys. This document separates
the next read-only preflight from a later, conditional write drill. Both committed
release flags stay false. No step here authorizes itself.

## Named equipment and identity

- Card: `cplc-v1:4790d3213180072976207515`, serial bytes `07297620`.
- Reader for phase A: `ACS ACR122U PICC Interface` on this Mac.
- Writer for phase B: Pixel 8 Pro, ADB `42201FDJG00048`.
- Read-only post-check: Max, iPhone 13 Pro Max, UDID
  `00008110-001E4CC014D8401E`.

The older 2026-10-18 install report covers a different card, serial `09336320`.
Its successful return to factory keys is not key-provenance evidence for this
card. The operator must identify its actual manager-key provenance without
pasting key material into chat. Unknown provenance prevents authentication.

## Phase A: read-only installation preflight (approval requested separately)

Have the operator place the same card on the named USB reader. Open only that
reader and one PC/SC connection. Send only this conditional sequence:

| Order | Command | Response rule |
|---|---|---|
| 1 | SELECT ISD `00A4040008A00000015100000000` | Require `9000` |
| 2 | GET DATA CPLC `80CA9F7F00` | Strict 42-byte `9F7F` TLV; require the exact expected operational identity |
| 3 | SELECT full card applet `00A404000BF04341534855434152440100` | `6A82`: report absent and stop. `9000` with exact `0201`: continue. Anything else: stop |
| 4 | GET_INFO `B001000000` | Require success, exact 30-byte 2.1 framing; record empty/unspent/spent, PIN, owner, record and lock indicators |
| 5 | GET_PUBKEY `B010000021` | Require success and compressed 33-byte framing; record full public installation identity |
| 6 | SELECT tag `00A4040007D276000085010100` | Record present (`9000`) or absent (`6A82`); stop on another status |

Close the connection. No retry, manager authentication, proof signing, PIN
verification, GET_NONCE, key fetch, service login or write command is included.
Do not use cardctl selftest/info: those commands perform a broader sequence.
Use a bounded raw PC/SC transport, without GlobalPlatform tool auto-selection
or implicit login. Inspect the host script's APDU allowlist before execution.
The existing cardkit reader/inspector are the interpretation reference.
The executable allowlist is `tools/cardctl/read_only_preflight.py`; its README
records the exact command for this card and reader.

Record only public identity and state in the hardware report. An absent applet
is not proof of manager keys, free memory, package inventory or universal
blankness. A present applet stops the first-write plan even if empty: the current
screen has no replacement-consent flow. A funded, owned, PIN-set, configured,
locked, malformed or unexpected card is not to be cleared or replaced.

## Phase B prerequisites (no write approval requested until these are complete)

1. Phase A is reviewed. The operator explicitly marks this exact card disposable
   and confirms factory-key provenance. If either is missing, stop; do not trial
   factory, spike or any other keys against it.
2. Review #22's UI integration after its CI passes. #20's boundary hooks and
   #21's read-only evidence are merged. Pin the exact source for the validation
   binary and report its local build delta; no production release gate changes.
3. Prepare an isolated nonproduction Node service on Mac loopback port 8822,
   a private run directory/database and a securely retained master. Bootstrap
   one issued-environment test operator through the existing private credential
   mechanism. Supply only a local test mint in the list; the install flow does
   not contact a mint or configure it on the card. Do not deploy a Worker or
   call a production service as part of this drill.
4. Reverse Pixel port 8821 to Mac port 8822. The current app's service origin
   stays `http://127.0.0.1:8821`; this is the Pixel's USB path to the isolated
   service. Do not change shared service binding to a public/LAN interface.
   Verify sign-in and batch/reservation persistence without arming NFC first.
   Max performs only its offline CPLC probe and needs no service connection.
5. Retain the private service master and escrow before writing any card.
   Manager keys, tokens and credentials must not enter prompts, shell history,
   logs or screenshots. Record nonsecret run/device/batch/attempt IDs only.
6. Only then obtain explicit approval for phase B's exact card and actions below.
   Prepare an isolated Pixel validation binary with both local flags enabled;
   never commit those enabled values or distribute that binary as production.

The service setup and its phone-facing connectivity are preparation tasks, not
completed evidence in this document. If ports are occupied, select a documented
isolated host port and update the USB mapping; do not stop unrelated services.

## Proposed phase B: one Pixel-owned attempt with three process losses

Reserve one card in one one-device batch. Keep the same device ID, attempt ID,
ordinal, service database and master throughout. The tracked CAP SHA-256 is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`;
the load-file SHA-256 is
`fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee`.

1. Select `installation-verified-before-save`, then begin the approved install.
   Match CPLC and bind before authentication. Permit the normal guarded Cashu
   cleanup/load/install only if the card applet is absent. Cleanup is limited
   to tag `D2760000850101`, card `F043415348554341524401`, opener
   `F04341534855434152444D`, and package `F0434153485543415244`, in that order.
   Never delete the ISD or another package. Install opener first, card then tag.
   At the pause, verify saved stage `install_intent` and terminate the app.
2. Relaunch and sign into the same service/operator. Select
   `rotation-verified-before-save` before continuing with the same card.
   Adopt the verified new installation; no second DELETE/LOAD is allowed.
   Permit one assigned-set PUT KEY and successful assigned authentication.
   At the pause, verify saved stage `rotation_intent` and terminate again.
3. Relaunch and sign into the same scope. Select
   `record-frozen-session-closed` before continuing. Recover with the same
   assigned set through offline cryptogram matching; no failed trial login,
   reinstallation or second PUT KEY. At the pause, verify `record_pending`
   and that the NFC session is closed, then terminate without Continue/Stop.
4. Relaunch and reauthenticate. Let frozen-record recovery finish without a tap
   or key fetch. Verify the same attempt, full key and ordinal, one receipt,
   observed GP version, and `ready_for_holder: false`.
5. Use Max's offline probe to read CPLC after installation/rotation and compare
   with the original identity. Do not move the Pixel's active batch to Max.

Stop immediately on an identity mismatch, authentication refusal, missing
storage/service evidence, partial installation or unexpected stage. Do not retry
login, clear app data, delete an attempt, create a replacement ordinal, sweep,
unblock a chip or rotate keys back to factory to make the scenario pass.

The end state is an installed card on its assigned manager keys, with keys
recoverable from the retained private service state. It is not a return-to-factory
procedure and does not personalize mint, owner, PIN, limits or holder readiness.
Mid-LOAD tears, actual lost PUT KEY replies, wrong-card substitution and a full
second-phone write run remain separate drills requiring their own approved
cards/actions. One composite successful run is not the full release gate.

## Evidence

Record the approved scope, operator confirmations, exact source/build hashes,
public chip/full installation IDs, private-state retention location (never its
contents), batch/attempt IDs, reached boundaries and actual saved stages, each
relaunch outcome, final receipt and omitted scenarios in a new hardware report.
Keep the original read-only report unchanged as evidence for its original run.

## Candidate update after USB preflight (proposed replacement variant)

The original card returned an unexpected applet version. A second card returned
2.1 and passed all public-state reads: chip
`cplc-v1:4790d3213041093363205547`, installation
`0366bf811cadfcfc00e5f251017d1dc690a93a6a4a9d39ed114b96d33fb59d9941`.
It reports zero proofs, 128 empty slots, no PIN/owner/configuration record,
unlocked, tag present. See the USB preflight hardware report. The operator
confirmed it is a test card, replacement is permitted, and its manager keys
have not changed since the earlier report's return to factory keys. This
confirms provenance without trying any keys.

For a later approved replacement variant, this exact chip and old installation
replace phase B's original card and absent-applet precondition. All other
service, source, retained-key, device and recovery prerequisites still apply.
Before the first mutation, the Pixel must inspect the card, close NFC and show
the new replacement review. The operator explicitly confirms that full old
installation identity and retaps the same card. Recheck chip, old installation
key and complete empty state before the existing guarded cleanup/install.
The three subsequent pause/restart boundaries are unchanged; do not replace
the newly installed applet on recovery. Max's eventual CPLC post-check would
compare against this replacement card's identity.

The software confirmation flow is implemented separately from PR #23. It is
not yet native/hardware validated, and both committed release gates remain
false. Neither this addendum nor the operator's disposability confirmation
authorizes starting phase B before its prerequisites and execution approval.

## Local service preparation checkpoint

Prepared from source `2a68a3f` on this Mac, separately from any phone/card
action. A Node service listens only on `127.0.0.1:8822`; its mint list is only
`http://127.0.0.1:3338`. Host-side issued-operator sign-in, authenticated mint
list retrieval and sign-out passed. No mint was contacted, and no batch, card
reservation, card key retrieval or card mutation was requested.

Private run directory: `/Users/dread/Library/Application
Support/cashu-card/eng-741-2026-10-20`. It has mode 0700; `ops.db`,
`private-runtime.json` and `operator-login.txt` have mode 0600. The runtime file
retains the generated derivation master and operator credential; the separate
login file contains only the local operator login, never the derivation master.
Do not paste either file into chat or logs. The local launcher preserves these
files across restarts. The database is the local escrow store; no independently
encrypted export or restore drill has been performed. This retention supports
the local test. Production disaster recovery requires its own verified export
and restore.

The Pixel USB mapping, phone-side sign-in, one-card batch/reservation
persistence, validation binary and native replacement review remain pending.
Proposed preparation-only phone scope: Pixel ADB `42201FDJG00048`, inspect its
reverse-port mappings, add `tcp:8821` to host `tcp:8822` only if not occupied by
another mapping, and open the existing provisioner for operator-entered local
login. Keep both release flags false. Stop before NFC, batch creation or card
installation. This phone scope requires operator approval under AGENTS.md;
it is separate from subsequent card-write approval.

## Pixel sign-in checkpoint and proposed validation setup

The operator approved connecting the Pixel provisioner. Its reverse-port list
was empty; added and verified Pixel `tcp:8821` -> Mac `tcp:8822`. Opened the
existing app, disabled demo mode, and reached sign-in. The operator entered
the private local credential and confirmed sign-in succeeded, then confirmed
the Card installation screen displays the installation-paused gate. This
phone observation is operator-reported; no password was captured. No native
rebuild/reinstall, NFC, batch/reservation or card write occurred. A host-side
DB check before sign-in found one operator and zero batches, issued-key rows
or provisioning attempts.

The next proposed scope is **validation setup only**, on Pixel ADB
`42201FDJG00048`. After explicit approval:

1. Prepare an isolated local validation source/binary from the reviewed PR #24
   code, with both release flags true only in that isolated local build. Record
   source and artifact hashes; keep committed release flags false.
2. Build/install/launch that validation app on the Pixel without clearing app
   data. Preserve its app identity, journal and local service database/master.
3. Reestablish only the documented service/Metro USB mappings as needed. Let
   the operator sign into the same local issued account privately.
4. Create one batch with count 1 and the local test-mint URL, installation only.
   Verify that batch survives an app restart. Do not tap Install/Continue,
   reserve another ordinal, arm NFC, authenticate or touch the card.
5. Stop with batch/source/build evidence for review. Request the separate
   bounded replacement/install/rotation/restart drill approval only then.

This resolves the setup ordering: a real batch cannot be created through the
committed app while its installation gate is false. Batch persistence is checked
in a separately approved validation setup, before requesting any card mutation.
No NFC reservation is needed to validate batch persistence; the drill itself
will reserve its sole attempt when programming is explicitly approved.

## Ready-for-approval execution scope after validation setup

The separately approved setup passed: isolated validation build installed on
Pixel `42201FDJG00048`, operator sign-in, count-1 batch creation and exact
workflow persistence across forced app stop/relaunch/reauthentication. See
`HARDWARE_TEST_REPORT_2026-10-20.pixel-batch-persistence.md` for artifact and
local gate-delta hashes. Source is
`a8cee93998dfff4f6254c65217ee78ec0e03d91d`; the sole local source delta enables
the two validation flags. Review source remains gated off.

Use existing batch **1**, operator **1**, issued environment, device
`4794470b-dfef-447e-bbd8-7ebadcd9f41d`, request
`849592a9-a1fb-40e1-8fe0-24eea8747b30`. Active attempt is null, ordinal is 0;
reserve only its first/sole attempt when the drill begins. Retained private
service state and a consistent pre-write snapshot/master are present; local
snapshot integrity and metadata checks passed. This is not independent DR.

Requested write scope is the replacement variant above on card
`cplc-v1:4790d3213041093363205547`, old installation
`0366bf811cadfcfc00e5f251017d1dc690a93a6a4a9d39ed114b96d33fb59d9941`,
using Pixel only. After approval, arm `installation-verified-before-save`,
inspect the card, close NFC, review/confirm this exact old installation and
retap. Permit the guarded known-AID cleanup/install using the provenance-known
factory set, then the three specified process-loss boundaries and recovery
with the same attempt. Permit one assigned-set PUT KEY plus its successful
confirmation and the planned recovery authentication; never trial another key
set or retry after an authentication failure. Preserve escrow and installed
assigned keys at the end; no factory reset, mint/owner/PIN personalization,
proof operations or production access. A version/state/identity/storage/auth
error stops the drill. No new ordinal, recovery sweep or second installation.

Max's optional final CPLC-only comparison stays a separately coordinated
post-check; the requested Pixel write approval does not move its batch or
authorize Max writes. Card replacement consent and provenance were confirmed
by the operator, but this complete drill still awaits explicit execution
approval. The successful setup did not touch a card.

### Pause arming for the replacement review

The first read-only tap returns for replacement review and ends that program
invocation. Its unvisited drill target is intentionally cleared at operation
end. Therefore **after the review appears and before pressing Replace**, arm
`installation-verified-before-save` again and verify the panel shows that exact
target. Only then confirm replacement and retap the same card. Do not assume
a target armed before the read-only inspection survives to the write tap.
