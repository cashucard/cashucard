# First provisioning write drill — proposed, not yet authorized

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

The older 2026-10-18 install report used serial `09336320`, not this card.
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
