# Pixel optimized signing stop

## Result

The approved optimized-image run on 09336320 confirmed all 128 synthetic input
slots and all 128 outputs. It then stopped at `capacity-sign`, command 289,
with `transport-uncertain`. The retained native category is `android-tag-lost`;
the failed JS-to-native call envelope is 15,015.558 ms. Its reply and scope are
absent. Whether the card published a complete record remains unknown.

The operator reported the terminal stop before host UI inspection resumed.
Only the private lab process was stopped and its database/sidecars collected.
Both earlier journals remained byte for byte unchanged. The current card state
is preserved. Cleanup admission rejected the signing-stage uncertainty, as the
approved plan requires. The plan is consumed. Further card access requires a
separate named recovery plan; signing was attempted once.

This run establishes complete staging for this private workload. Full packet
capacity, signature verification, export, retirement and return to blank are
unverified. Production firmware, CCP, ops-service, protocol and release
capability remain unchanged.

## Devices and artifacts

| Item | Value |
| --- | --- |
| Local test date | 2026-10-30 (America/Los_Angeles) |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| NFC device | Pixel 8 Pro, Android 17 / API 37, Android IsoDep |
| ACS role | One SELECT ISD / GET DATA CPLC precheck, then close |
| Lab source / merge | `2deb056f88ca9ac7ace8cbc69f12e63c3a97df0e` / `33ffbb7f67a3f874ff085aa16b3b05d570a01d3e`, #221 |
| Review and CI | Exact-head review; all 22 checks passed |
| APK SHA-256 | `f44b5c981beec73847447d8e1f06e7a0f5d876a9e424fc235f8eb2b9d8e7293a` |
| Bundle SHA-256 | `c5036cd6e25fe03845b5596566365f2167ee022e32fc8fdee295d622c4bb055b` |
| Application | `org.cashucard.capacitylab`, version code 3 / 0.0.3-lab |
| Private image source | `038e298ec7c846cec75e7e40366b1bc4d25a88d6` |
| CAP SHA-256 | `f714eae75a1cc8e6e867279e6e29470d41c5924820c30ca10bcaa9c8db473eb4` |
| Load SHA-256 / size | `f7064a1c65869943c3161030270cfdfea5ec8c87948f132c6043d8944d2d0f98` / 27,343 bytes, 111 blocks |
| Image manifest SHA-256 | `c97412fb1883e5550b080996cf06e7127117932d355c961c7c735516c8213c9c` |
| Fixture SHA-256 | `15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e` |
| Private AID / ABI | `F04341534855434D505401` / CPROT/2, format 5 |
| Observed private public key | `03c1d456043ca7d52155e2f99b5e84af043d63bfa1fe8c346b2ab9d98f32552cda` |

The fixed private image adds page-aware access and scratch-backed duplicate
checks, preserving layout, allocation and publication boundaries. The offline
access profile records its work-count improvement. All phone limits and journal
barriers were retained. The APK retains the same public debug signer, disabled
developer support/release variants and absence of Internet/overlay permission.

## Preparation and execution

The named Pixel and installed version-2 APK/signer matched. Both earlier
journals matched retained evidence and the optimized key was absent. The exact
APK upgraded only the private lab. The operator then paused for possible
concurrent Pixel use. The upgrade had completed; the lab had not been launched
or armed, and no card command had been sent.

After the operator resumed, a targeted check found the lab process idle. Its
installed APK hash still matched. A fresh database archive confirmed both prior
journal values were unchanged and the new key absent. The lab launched, one
ACS identity-only connection matched 09336320 and closed, and the fresh UI's
start was armed once. The operator held the card at the Pixel. Host UI/ADB
observation was withheld during card commands until the terminal report.

The journal confirms image/fixture checks, CPLC, absent conflicting AIDs,
factory-version-1 proof, exact baseline, 111 LOAD blocks, opener/main creation,
diagnostics/key, allocation, 128 input loads, BEGIN and 22 validated output
stages. The final header is `b0740000` with a null reply. The controller sent no
subsequent card command, export, retirement or deletion after that uncertainty.

## Measurements and interpretation

Stage timings are phone monotonic envelopes including work inside the stage.
The failed call measures the JS-to-native await, including bridge/queue time.
Connected duration uses session wall-clock stamps. These observations do not
isolate card execution or identify why Android reported tag loss.

| Observation | Result |
| --- | --- |
| Connected session / journaled commands | 130,430 ms / 289 |
| LOAD stage envelopes, summed | 12,145.989 ms |
| Confirmed input slots / summed envelopes | 128 / 56,749.285 ms |
| Confirmed output stages / outputs | 22 / 128 |
| Output stage envelopes, summed | 30,502.734 ms |
| First / last output stage | 708.023 / 1,708.913 ms |
| Completed stage envelopes, summed | 105,672.515 ms |
| Failed signing-call envelope | 15,015.558 ms |
| Reported native timeout / frame capacity | 15,000 ms / 65,279 bytes |
| Pre-setup diagnostics | `7fff0a0e0a0014001400000000000005` |
| Post-setup diagnostics | `7fff0a0e0a0014001400400030000205` |

The controller checks the 120-second gate before each transmission. It admits
a call before the gate, then awaits its reply or failure; the gate does not
terminate a native call already in flight. This session ended after the gate
while handling the failed signing call and teardown, with further transmission
blocked. The 15,015.558-ms envelope is consistent with the reported native
timeout but does not prove timeout caused tag loss. The card may have stopped
before publication or completed publication without a delivered reply.

## Recovery boundary and evidence

Recovery must inspect the existing state without another signing request.
SELECT of this private applet invokes recovery: it can release unpublished
staging or complete bookkeeping for a committed record. It is therefore an
explicit recovery action. A committed packet needs exact canonical export and
both independent signature checks before scoped retirement. An absent scope
with all 128 proofs unspent can establish the unpublished branch. Unknown
state or incomplete evidence preserves the card for review.

Protected originals stay under `pixel-optimized-capacity-2026-10-30`, including
approval, exact CI/build pins, both upgrade/resume archives and comparisons,
identity journal, single start intent, terminal UI, original result database,
parsed journal, timing analysis and the consumed-plan record.

| Evidence | SHA-256 |
| --- | --- |
| Approved `plan.md` | `f02dc8951010ba8b57cfa0081f2197b6a0f3bebac7cb1c9c0e613f164aa20bc1` |
| `pixel-journal.json` | `976c2dbeb23cc0bc621d1393e331d8771543fe3a2a3f8860cec812c3aacf2132` |


## Approved recovery and final blank state

The operator approved the separately pinned recovery-only plan. The existing
private image was left in place until one exclusive ACS ACR122U connection
matched 09336320, proved factory-version-1 keys and required the exact original
platform baseline plus private main/opener/package. The private SELECT invoked
recovery once. Diagnostics and public key matched the saved installation.

Recovered status was `[64,90,128,0,0,0]`: all 128 synthetic proofs unspent,
64 headers and 90 pages free. Scope index 0 returned `6985` with no body. This
establishes the unpublished-staging branch after recovery. A committed packet
was absent; no packet export, signature verification or RETIRE was performed.
The observation does not locate the interruption within signing or identify
why Android reported tag loss. Full-size physical signing remains unproven.

The approved conditional cleanup then matched CPLC again, proved a fresh
factory channel, required the same exact registry and deleted only private
main, opener and package in that order. Final registry reported no applications
and exactly the original three platform load-file records. A separate host
TLV decoder confirmed those saved records without further hardware access.
The reader closed successfully. Card 09336320 is verified blank; manager keys
were unchanged. The invocation completed 24 commands and its plan is consumed.

| Recovery evidence | Value |
| --- | --- |
| Host source / merged PR | `0ea4fb681cc98674886510c5b00c24553a750398` / [#223](https://github.com/cashucard/cashucard/pull/223), merge `651108f13d7e5a31227cfd203c7ec61094dd22a3` |
| Review / CI | Exact-head review; all 22 checks passed |
| Approved recovery-plan SHA-256 | `5b8f2e055a02107530e1c762a7feccd3909f2abc2ac8f03428ec80b89b8c5bb5` |
| Recovery-journal SHA-256 | `95b57b17d323fe6f074eea16858ca496d71327ba480d5128b021df0d40a30b3a` |
| Private SELECT/recovery envelope | 204.737 ms |
| Recovered diagnostics | `7fff0a0e0a0014001400400030000205` |
| Final applications / load-file replies | `6a88` with no body / `9000` with exact original baseline |

Protected evidence is under `compact-sign-recovery-2026-10-30`, including
approval/pins, one-shot lock, all three registry snapshots, recovery journal,
close result and independent saved-evidence check. The original Pixel journal
retains its recorded hash. Further work on full-size signing begins with
offline analysis; a fresh physical invocation requires its own reviewed plan.
