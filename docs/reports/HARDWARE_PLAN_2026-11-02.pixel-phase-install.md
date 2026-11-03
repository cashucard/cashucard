# Hardware plan: install the private applet for the phased recipe

Plan ID: `pixel-phase-install-v1`.
Status: **approved 2026-11-02** (see [Approval](#approval)). The approval covers
steps 1–8 on one phone, one card and one install session. It authorizes no
second phone, no rerun after a consumed attempt, and no command outside this
profile's own set.

## Scope

One phone, one card, one install session. The generated app loads the qualified
private image, creates the opener (`…4D`) then the main instance (`…01`), proves
the card was empty before the load and now holds exactly those two instances,
reads the public key, and stops at `installed-for-phases`. Fixture SETUP, proof
loading, SIGN, retirement, the cleanup DELETE sequence and manager-key rotation
are outside this plan; the phase-zero invocation owns the fixture setup.

The output is the installation receipt that admits the card to phase zero:
`phase-install-receipt.cjs` reads the captured phone journal and the exact APK,
and `run-compact.cjs` re-reads the journal's diagnostics at setup state 0.

## Identities

- Card: `cplc-v1:4790d3213041093363205547`, serial `09336320` (J3R180).
- Reader: **ACS ACR122U PICC Interface**, the named USB reader.
- Phone: the connected Pixel. Record its serial and Android build in the
  hardware report; the run refuses any other CPLC before the first APDU.
- Installer source: `96eb11df58c0969e2d00a1d52a2ca726f8d2d971`.
- Reviewed tree: `b96504ece908ada35fb2f8ef61e00a9facb0d693` plus the phase-install
  work; `lab-build.json` must record that commit, not the pins source.
- Artifact: `/Users/dread/.cashucard/compact-cursors-2026-10-31/image/`.

## Image pins

Identical to the qualified streamed profile, read from `pixel-install.json`.

| Pin               | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Package AID       | `F04341534855434D5054`                                             |
| Manifest SHA-256  | `b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4` |
| CAP SHA-256       | `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27` |
| Load-file SHA-256 | `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048` |
| Load bytes        | 28,067                                                             |
| LOAD blocks       | 114                                                                |

`prepare-pixel.cjs --mode phase-install` refuses any artifact whose hashes or
byte count differ, so a retained directory holding another image stops before
generation.

## Application

| Property            | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Application ID      | `org.cashucard.capacitylab`                                           |
| Label               | Cashu Card Lab                                                        |
| Version code / name | 5 / `0.0.5-lab`                                                       |
| Journal key         | `cashucard-private-capacity-install-v1`                               |
| Permissions         | NFC only; no Internet, no overlay                                     |
| Signer              | published debug keystore; release variants off; developer support off |
| Native patch        | failure classifier retained                                           |
| Fixture             | none bundled                                                          |

Every earlier lab key stays in the same app storage. The install key is new and
unused; a second invocation on this phone is refused by the consumed journal.

## Built APK (step 2 complete)

Built from the reviewed commit `803cc28ee41c048b6fddc7c220a8cab1f1d266a1`,
which `lab-build.json` records as `source`. Preserved, with `lab-build.json` and
the Gradle log, in the private directory
`/Users/dread/.cashucard/pixel-install-2026-11-02/` (mode `0700`, files `0600`).

| Observation       | Result                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| APK SHA-256       | `e41e5845c3ceb0aa77b4848bb113893afdb34cf281262b5d5d626ca937c14875`                                                           |
| APK size          | 39,538,652 bytes                                                                                                             |
| Package / version | `org.cashucard.capacitylab` / 5 / `0.0.5-lab`                                                                                |
| Label             | Cashu Card Lab                                                                                                               |
| Permissions       | `android.permission.NFC`, `android.permission.VIBRATE`, own non-exported receiver permission; no `INTERNET`                  |
| `uses-feature`    | `android.hardware.nfc` required                                                                                              |
| Bundled bundle    | names `cashucard-private-capacity-install-v1`, `pixel-phase-install-v1`, `INSTALL FOR PHASES`; contains no `INTERNET` string |
| Signer            | one V2 signer, CN=Android Debug, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`                  |
| `lab-build.json`  | mode `phase-install`, `installPins` `8a3450ee…8f29e15`, equal to the SHA-256 of the generated `pixel-install.json`           |
| Fixture           | none bundled                                                                                                                 |

Two permissions beyond the plan text are present and are not developer support:
`VIBRATE` is the provisioner's haptic feedback, and the custom receiver
permission is React Native's non-exported dynamic-receiver guard. Release
variants stay off; `debuggable` is the debug build variant. Recorded here
rather than treated as a deviation.

## Device inventory and install (steps 3–4 complete)

```text
$ adb devices -l
List of devices attached
42201FDJG00048         device usb:0-1.4 product:husky model:Pixel_8_Pro device:husky transport_id:6
```

One device, the named Pixel. Android 17 (`ro.build.version.release`), build
`CP3A.261005.005`, fingerprint
`google/husky/husky:17/CP3A.261005.005/2026102101:user/release-keys`, security
patch `2026-10-05`.

The reviewed APK was installed over the retained graded build in
`org.cashucard.capacitylab` (version code 4 / `0.0.4-lab` from 2026-10-31) with
`adb install -r -d`; the app storage holding the earlier journals is unchanged.
After install the package reads version code 5 / `0.0.5-lab`. Launched once with
the card off the reader; the screen renders `Pixel install for phases`, "Card
09336320 only", `Ready for the approved test`, the single `INSTALL FOR PHASES`
action, and the CAP/source fingerprint ending `803cc28ee41c048b6fddc7c220a8cab1f1d266a1`.
No NFC command has been sent.

## Steps and gates

Each step is its own gate. A failure stops the plan; it does not open the next
step, and none of it is retried under this plan.

1. **Generate and build (host only, no device).** Run the local preparation of
   [PIXEL-CONTROL.md](../../tools/outbox-spike/PIXEL-CONTROL.md) with
   `--mode phase-install` into a new private absolute directory. Generation
   requires a clean tree at the reviewed commit.
2. **Inspect the APK.** Before anything touches the phone, confirm in the final
   manifest: application ID `org.cashucard.capacitylab`, version code 5,
   version name `0.0.5-lab`, `android.permission.NFC` present and no
   `android.permission.INTERNET`, release tasks absent, and the merged manifest
   free of the developer-support switch. Record the APK's SHA-256 and preserve
   it with `lab-build.json` and the build logs. `lab-build.json` must name mode
   `phase-install` and carry `installPins` equal to the hash of
   `pixel-install.json`.
3. **Device inventory.** One `adb devices -l`, recorded verbatim. Any device
   other than the named Pixel stops the plan; do not install on a second phone.
4. **Install and launch.** Install the inspected APK, launch it once, and leave
   the card off the reader.
5. **Install session.** Place card `09336320` on the named reader and start the
   single install action. Expect: the CPLC match, ten selections answering
   `6A82`, the factory channel, the platform-only initial registry listing,
   `INSTALL [for load]`, 114 LOAD blocks, opener then main creation, the
   installed listing naming exactly the two instances, `CPROT\x02` on the main
   instance, format-5 diagnostics at setup state 0, and one public-key read —
   138 commands in the offline fixture, terminal `installed-for-phases`.
6. **Export the journal.** Use the app's share action on the public journal;
   that is the only result-export action. It excludes authentication frames,
   challenges and MACs. Store it in a private directory (owner-only, one link).
7. **Write the installation receipt.** `phase-install-receipt.cjs` exposes no
   command line: it is a verifier called by the campaign admission. Author the
   receipt as a private JSON file, then — once the campaign exists — let
   `phase-device.cjs --campaign <path>` admit it (preview mode reads local files
   only). Exact shape:

   ```json
   {
     "format": "compact-phase-install-v1",
     "sourceCommit": "<the 40-hex installer commit>",
     "apk": { "path": "/absolute/private/app-debug.apk", "sha256": "<64-hex>" },
     "journal": {
       "path": "/absolute/private/journal.json",
       "sha256": "<64-hex>"
     }
   }
   ```

   The verifier reads both files itself while scanning for: absolute path, a
   regular single-link file owned by the invoking account, mode `0600` or
   stricter, in a directory that account owns at the same mode — APK ≤ 200 MiB,
   journal ≤ 1 MiB, opened `O_NOFOLLOW`, hashed after an inode/device recheck.
   The journal must satisfy every field in the next section, and the receipt
   must reference the journal by hash before the card is used again. A rejection
   means the run is not admitted: the card is not re-installed and the journal
   is not edited. No host step reconstructs evidence the phone did not journal.
   The campaign that follows must carry exactly the keys `approved`, `artifact`,
   `binding`, `chip`, `format` (`compact-phase-campaign-v1`), `installation`
   (`{path, sha256}` of this receipt), `journal`, `python`, `reader`,
   `sourceCommit`; the admission also requires a clean checkout at that commit,
   the pinned artifact and a matching Python runtime hash.

8. **Stop.** End the device session. Removal from the reader and phone lock are
   the only remaining actions.

## Expected terminal evidence

The journal must carry `plan: pixel-phase-install-v1`,
`status` and `stage` both `installed-for-phases`, no `failure`,
`factoryVersionVerified: 1`, `initialBaselineVerified: true`,
`installedRegistryVerified: true`, no `blankBaselineVerified`, build mode
`phase-install`, the installer source above, the three pins and 114 blocks, and
diagnostics `7fff0a0e0a0014001400000000000005` — format 5, setup state 0, both
free-commit counters at or above 128. The phone app journals no CPLC, so the
card is the campaign's own chip; the app admitted only that chip.

A run that stops earlier is reported with its stage and classified failure and
is **not** retried here.

## Prohibited under this plan

- Clearing or hand-editing the lab journal, reinstalling to bypass a consumed
  attempt, or launching a second install session after a failure.
- Enabling CCP bench tools, changing manager keys, or contacting a mint or
  ops-service.
- Fixture SETUP, proof loading, SIGN, retirement, the DELETE sequence, or any
  command beyond the install profile's own set.
- Host UI automation during card commands.
- Reporting an install as qualified from an offline or simulator run; silicon
  evidence is this run's hardware report.

## Terminal result (step 5)

The install session was started once and reached its terminal state. It stopped;
nothing after this step ran, and the plan ends here.

| Observation        | Value                                             |
| ------------------ | ------------------------------------------------- |
| Rendered result    | `Stopped · keep the card aside`                   |
| Stage              | `installed-load-files-0`                          |
| Commands           | 135                                               |
| Failure            | `registry-baseline`                               |
| Journal key        | `cashucard-private-capacity-install-v1`, consumed |
| Cleanup sent       | none                                              |
| Diagnostics read   | none                                              |
| Card after the run | both install instances present                    |

Reading: the 114 LOAD blocks, the opener install, the main install and both
selectable creations completed — 135 commands is the recorded shape minus the
three that follow creation. The run then stopped in the post-install listing
check, before `installedRegistryVerified` was set, so the receipt verifier
refuses this journal by design and no receipt is written.

The listing check accepts only the platform's three load files, byte for byte,
plus the named private AIDs. The card returned a listing the fixture cannot
produce: its load-file listing always carried the image's own record, so 179
offline tests could not exercise this branch. The fix and its regression are
commit `7c28559`; the offline procedure that produces them is
[`HARDWARE-LOOP.md`](../../HARDWARE-LOOP.md).

This is a fixture fidelity gap, not a proven card fault: the journal's raw
listing bytes are the only way to tell which entry the card actually returned,
and the plan's journal export (step 6) was never reached — the app offers its
public test result, which omits raw listing bytes. Do not re-run this plan; the
card is no longer blank and the attempt is consumed.

## Revocation and evidence

Approval covers one phone, one card and one install session. It expires when the
software is regenerated against a different tree or image, and it is consumed by
the terminal result of step 5. Physical findings belong in a dated hardware
report written after the run, containing: the device serial and build, the APK
SHA-256, `lab-build.json`, the exported journal, the receipt, the command count
and stage, and any stop with its classified cause. The install journal is
preserved as evidence and never overwritten.

## Approval

- `approved: true`
- Approver: repo owner (operator), in session
- Date: 2026-11-02
- Approval scope: steps 1–8 on phone — pending inventory; the phone serial and
  Android build are recorded at step 3 and bound before installation.
