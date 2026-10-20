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
stop; replacement-consent UI and partial-install repair are not implemented.
Never erase it or attempt authentication with guessed keys. A different blank
card needs its own recorded identity and approval.

The owner runs native builds, iOS pods/signing and phone actions, as required by
[AGENTS.md](../AGENTS.md). No credential or nonpublic manager key belongs in this
checklist, a screenshot, transcript, shell history or shared test artifact.

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
