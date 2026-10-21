# Provisioner device validation — proposed owner-run plan

ENG-741, 2026-10-20. This checklist prepares the remaining installation release
gate. It is not a hardware report, authorization to operate a device, or evidence
that the gate has passed. Keep `CARD_INSTALLATION_VALIDATED = false` in committed
code. No personalization or holder readiness is covered.

## Devices and scope to confirm before execution

| Item | Candidate | Required confirmation |
|---|---|---|
| Android | USB-connected Pixel; README identifies Pixel 8 Pro | Operator records actual model, OS and device identifier |
| iOS | USB-connected iPhone | Operator records actual model, OS and device identifier |
| Reader | ACR122U from the prior USB-only report | Record reader identity if a USB baseline is repeated |
| Card A | Previously observed `cplc-v1:4790d3213180072976207515` | Operator confirms physical card, current state and permission for each intended mutation |
| Card B | Not identified | A separate approved disposable card for substitution/distinctness checks |
| Service | Dedicated nonproduction ops instance | Fresh operator/device scope, private recovery backup retained; no production systems |

The earlier USB report establishes only its documented read-only result. It
does not establish phone behavior or authorize installing on Card A. An existing
installation is not a blank test card. If the app reports an existing installation,
stop unless a separately approved plan permits replacement. The real flow now
requires an installation-specific review and a second identity/empty-state
inspection before replacement ([D41](DECISIONS.md#d41)); partial-install repair
is still not implemented. Never erase a card outside its approved scope or
attempt authentication with guessed keys. A different blank
card needs its own recorded identity and approval.

The owner runs native builds, iOS pods/signing and phone actions, as required by
[AGENTS.md](../AGENTS.md). No credential or nonpublic manager key belongs in this
checklist, a screenshot, transcript, shell history or shared test artifact.

## Authorized read-only phone run — 2026-10-20

The operator explicitly instructed the agent to rebuild on the Pixel and Max
and start read-only identity tests. This authorizes the necessary dependency,
native build/signing, install/launch and read-only UI actions on these two
identified phones for this run, overriding the default owner-only build/run
assignment for this bounded task. It does not authorize installation or rotation
APDUs, a bench run, PIN/owner operations, app-data clearing or production access.

| Device | Observed identity | OS |
|---|---|---|
| Pixel 8 Pro | ADB `42201FDJG00048` | Android 17, API 37; patch 2026-10-05 |
| Max, iPhone 13 Pro Max (`iPhone14,3`) | UDID `00008110-001E4CC014D8401E`; CoreDevice `810FE33E-9790-5BD9-AD8D-F985CBF85A23` | iOS 26.5.2, build 23F84 |

Build merged #19, commit `1b54cf93459aeca39870b3030104071481589cff`,
in the isolated phone-validation checkout. Keep the installation gate false.
Use bundled Release on Max and Debug with isolated Metro port 8083 on the Pixel;
existing Metro listeners on other ports are left alone. Preserve existing app
data and the main checkout's uncommitted sign-in edit. The native application
identifier is `com.islandbitcoin.provisioner` on both platforms (the older
README identifier is stale).

For each read, use the explicit Settings identity probe only, through the demo
door so no service login is needed. The operator presents the same physical card
from the USB baseline; expected public identity is
`cplc-v1:4790d3213180072976207515`. Close the NFC session and remove the card
between three deliberate reads per phone. The card APDU allowlist is SELECT ISD
`00A4040008A00000015100000000`, then GET DATA CPLC `80CA9F7F00`.
Record observed outcomes, never infer a pass from a successful build. If the
card does not match the expected identity, stop and reconcile its identity.
This run is now recorded in the
[phone CPLC hardware report](HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md):
three matching reads per phone, without authentication or card writes.

## Preparation checkpoints

1. Review the exact merged app/cardkit/service commits and their CI results.
   Preserve the main checkout's unrelated edits. Install dependencies and run
   the README's software checks. The native build must include AsyncStorage;
   a working Metro bundle does not prove that the module is installed.
2. Provide a read-only phone identity probe that invokes `readChipIdentity`
   through the native NFC adapter, with no service reservation, key fetch,
   authentication or mutation. Settings → Read physical card identity now provides this probe
   ([D37](DECISIONS.md#d37)). It is available through the demo door without a
   service session and clearly labels its physical-card action. Opening it does
   not arm NFC; tap READ PHYSICAL CARD IDENTITY for each deliberate read. Do not use a programming attempt as a read-only probe.
3. The local validation build now has one-shot boundary pause controls
   ([D38](DECISIONS.md#d38)). In an isolated validation worktree only, enable
   `RECOVERY_DRILLS_ENABLED` as well as the separately approved installation
   build gate in `apps/provisioner/src/releaseGates.ts`. Neither change belongs
   in a production commit or distributed binary. The explicit build flag also
   works in the owner-built iOS Release configuration; it does not depend on
   Metro's development mode. After creating/resuming the intended batch, select
   one boundary in the LOCAL VALIDATION BUILD panel before starting the run.
   Only a boundary actually reached in that run provides pause evidence.
   Record the displayed boundary and saved stage, then terminate while paused.
   CONTINUE DRILL releases the waiter; STOP THIS RUN cancels it without clearing
   evidence. Ordinary record retries can resume after stopping. The selected
   pause is memory-only: reopening must use normal recovery, without rearming
   that point. These controls do not pause inside an APDU or prove a torn LOAD
   or lost PUT KEY reply; those checks remain separately planned hardware work.
4. The owner confirms the devices/cards above and approves the bounded actions.
   For installation drills only, use an isolated local validation build with
   the installation gate enabled. Record that source delta and binary build;
   never commit or distribute that enabled build as a production release.
   Read-only identity checks need no installation-gate override.

## Bounded checks after preparation and approval

| Check | Owner action | Required observation |
|---|---|---|
| Native storage | Launch/relaunch with readable storage; separately exercise the controlled unavailable-storage case | Saved work is retained; unavailable storage prevents new requests and NFC |
| Phone CPLC | Three separate read-only taps on each phone for each approved card, closing the NFC session between reads | Exact same ID per card across transports; malformed/missing identity stops; distinct sample IDs |
| Fresh installation | On an approved blank card, create one-device batch and install/rotate once | CPLC bound before authentication, pinned asset, full installation key, observed GP version and service receipt agree |
| Identity after install | Repeat the read-only taps on both phones | CPLC unchanged; no migration of an active batch/journal to the second phone |
| Completed install, lost local result | Pause after complete install but before its result commit; terminate, relaunch and present the same card | Existing new installation is verified/adopted; no DELETE/LOAD recovery sweep |
| Partial installation | Interrupt the approved load at a recorded point | Quarantine/reconciliation, with no automatic repair or sweep |
| Lost rotation result | Interrupt at the approved rotation boundary, then resume the same attempt/card | Same assigned set, offline cryptogram matching, no failed trial authentication or reinstall |
| Durable rotation | Terminate after the rotated commit and resume | Assigned-key confirmation only; no additional PUT KEY |
| Lost record reply | With the frozen record already saved, interrupt only record delivery, then relaunch and reauthenticate | Exact frozen body/attempt retried; no NFC, key lookup, new ordinal or duplicate record |
| Actor/cancel change | Cancel while keys are pending; separately sign out with a session armed | Pending attempt retained; no later NFC arm or subsequent command under the old actor |
| Wrong card | Present approved Card B to Card A's interrupted attempt | Stop before authentication/mutation; original evidence retained |
| Quarantine | Restart while stopped, then explicitly acknowledge its disposition | No automatic advancement; service receipt required; bound chip remains blocked |

Not all interruption rows can be demonstrated on one card in one run. Once an
attempt is recorded or quarantined, do not reset its state, clear app data,
reuse its ordinal or unblock its chip to manufacture another scenario. Plan
separate approved cards/attempts where needed. If a boundary cannot be established,
record it as untested. An authentication refusal stops the drill immediately;
there is no retry matrix on silicon.

## Evidence and release decision

Create `docs/HARDWARE_TEST_REPORT_<YYYY-MM-DD>.<chip>-provisioner-recovery.md`
after the run. Record the device/OS identities, app/cardkit/service commits,
binary configuration, tracked CAP and load-file hashes, public chip/full
installation IDs, observed GP version, attempt IDs and receipt stages. Include
observed durable boundaries, result per row, failures and explicit omissions.
Exclude raw APDUs, tokens, PINs, owner secrets and manager keys.

The release review must cover native persistence under termination, both-phone
identity behavior and all required recovery boundaries. A small sample does not
prove global CPLC uniqueness. Missing devices, unidentified cards or untested
boundaries leave the installation gate closed. Software tests remain evidence
about software only. A passed installation gate still does not authorize holder
handoff: mint/owner/PIN/limit personalization and its interrupted-write recovery
need a separate contract and acceptance evidence.

## Evidence checkpoint after the first Pixel write drill

These observations update coverage; they do not broaden any device/card approval.

| Area | Evidence | Still outstanding |
|---|---|---|
| Original card identity across phones | Three matching CPLC reads per phone, original card ending 7515 | Distinct-card sampling is not a global uniqueness proof |
| Identity after provisioning | Spare ending 5547: pre-write USB ID, bound Pixel ID and one operator-confirmed post-write Max read match | Repeated post-write reads and full iPhone write/recovery |
| Pixel native storage | One-card batch survived restart; three write-drill stages recovered | Controlled unavailable-storage hardware case |
| Pixel empty-app replacement | Approved spare ending 5547, one attempt, new installation and assigned GP version 1, one receipt | Fresh absent-applet card; full iPhone write run |
| Completed install/result loss | `install_intent` after kill, complete new applet adopted | Actual mid-LOAD interruption/partial installation |
| Rotation/result loss | `rotation_intent` after verified rotation, assigned state recovered | Actual lost PUT KEY response; restart from durable `rotated` |
| Frozen record/process loss | `record_pending` before POST, restart with card removed, unchanged record and one receipt | POST committed but HTTP reply lost |
| Escrow recovery | Real completed-run age export restored by existing CLI without original master; control remains paused | Independent custody/off-machine copy; production delivery/restore drill |
| Card substitution and actor changes | Software coverage only | Separately approved hardware wrong-card, cancel/sign-out and quarantine observations |

Detailed evidence:
[Pixel three-boundary report](HARDWARE_TEST_REPORT_2026-10-20.d321-pixel-recovery.md),
[batch persistence](HARDWARE_TEST_REPORT_2026-10-20.pixel-batch-persistence.md),
[local encrypted recovery](RECOVERY_TEST_REPORT_2026-10-20.pixel-escrow.md).
Max's separately approved post-install CPLC check passed by explicit operator
confirmation; see [the post-check report](HARDWARE_TEST_REPORT_2026-10-20.d321-max-postcheck.md).
No full iPhone write or new card mutation is authorized here.
The provisioned spare is now on assigned keys, so it must not be treated as a
factory-key blank for another first-install run. Further write drills need
separately identified cards, provenance, service/batch scope and approval.
