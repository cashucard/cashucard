# Pixel compact capacity load stop and cleanup

## Result

The approved full-slot control on card 09336320 completed private applet
creation and allocation through the Pixel 8 Pro. It confirmed loading synthetic
proof slots 0 through 84, then stopped at `capacity-proof-85` with
`transport-uncertain`. Delivery of that attempted slot remains unknown. The
saved journal records 222 commands and a 55,154-ms connected session.

The approved conditional cleanup subsequently matched the card through the ACS
ACR122U, opened one factory channel, removed only the private main, opener and
package, and verified the exact original three-file blank baseline. The reader
closed without a reported failure and the Pixel lab process was stopped. The
card is blank with factory manager keys unchanged. The named plan is consumed.

This invocation provides partial loading evidence. Output staging, signing,
packet export and scoped retirement were unreached. It establishes neither a
proof-slot capacity limit nor the cause of the failed exchange. Many-small-record
capacity and physical interrupted-write recovery remain open. Assisted
settlement remains disabled in released apps; production firmware, CCP, its
saved work and the ops-service were unchanged.

## Devices and pinned artifacts

| Item | Value |
| --- | --- |
| Local test date | 2026-10-30 (America/Los_Angeles) |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| NFC device | Google Pixel 8 Pro, Android 17 / API 37, Android IsoDep |
| Host | Operator Mac; USB/ADB for installation, UI observation and journal collection |
| ACS role | Identity-only precheck, then the approved conditional cleanup |
| Lab application | `org.cashucard.capacitylab`, separate from CCP and the creation control |
| Reviewed lab source / merge | `7d454b309186c3fa481b48bc2abe128229bd7327` / `dfb0a9664f74278d5bbc609b8c507e95e7b438a9`, #217 |
| Review and CI | Exact-head review; all 22 checks passed |
| APK SHA-256 | `eb02fca4bc145b009d32f41a346c9f141187fbbc51856204c073c2ff1f5cf568` |
| Bundled JavaScript SHA-256 | `21b5ea8eb9405812c06b7331e5b0962603481e186571383abda448cfd854b048` |
| Debug signer SHA-256 | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Private image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d` |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load SHA-256 / size | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` / 26,934 bytes, 110 blocks |
| Image manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Private package / ABI | `F04341534855434D5054` / CPROT/2, format 5 |
| Fixed fixture SHA-256 / size | `15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e` / 58,507 bytes |
| Native timeout / maximum frame | Reported 15,000 ms / 65,279 bytes; outbound frames limited to 261 bytes |

The offline debug APK used bundled JavaScript, disabled developer support and
release variants, and omitted Internet/overlay permission. The image and
allocation layout were unchanged from the previous private controls. Local
hardware-free validation recorded 178 passing tool tests, eight environment
skips, 30 focused cases and 13 cleanup-adapter cases. APK manifest, signer and
bundle inspection preceded device access.

## Execution and observed stop

The ACS precheck sent SELECT ISD and GET DATA CPLC, matched 09336320 and closed.
The exact APK was installed without replacement. Its fresh start action was
armed once, with consumed intent persisted before NFC discovery. The operator
held the card steadily at the Pixel. The controller checked CPLC, object absence,
the factory-version-1 cryptogram and original blank registry before writing.
It loaded all 110 blocks, created opener and main, selected CPROT/2, validated
the public key and diagnostics, allocated the compact pool and DLEQ area, then
started loading the fixed synthetic inputs.

Host UI dumps observed progress and the terminal stopped screen. Their effects
on NFC lifecycle, field continuity and timing were unmeasured. After terminal
stop, only the capacity lab process was force-stopped. Its databases/sidecars
were archived through `run-as`, then the single capacity-journal key was read
from an extracted local copy. The consumed journal was retained.

The final intent was `capacity-proof-85`, header `b0710000`, with a null reply.
The preceding 85 proof stages completed. The controller retained a generic
transport failure, without a native exception category, status word or failed
native-call elapsed measurement. RF loss, timeout, storage exhaustion and other
causes cannot be distinguished by this record. The 120-second host gate and
512-command ceiling were unreached. The run sent neither payment BEGIN nor
SIGN, and produced no payment signature or export packet.

## Measurements

Stage durations use the phone's monotonic clock and include work inside each
timed stage. They are host-observed envelopes. Connected duration uses the
session wall-clock stamps. Subtracting successful stage durations from the
connected duration also includes untimed host work and failure handling; it
cannot recover the failed native-call latency.

| Observation | Result |
| --- | --- |
| Connected session / recorded commands | 55,154 ms / 222 |
| LOAD stage envelopes, summed | 12,022.098 ms |
| Opener / main creation | 255.963 / 1,337.924 ms |
| Capacity allocation/setup | 558.848 ms |
| Confirmed proof slots / uncertain attempted slot | 85 (indices 0 through 84) / index 85 |
| Successful proof stages, summed | 32,025.018 ms |
| First / last successful proof stage | 246.408 / 507.650 ms |
| Successful proof stage minimum / median / maximum | 246.408 / 370.998 / 507.650 ms |
| All successful stage envelopes, summed | 47,572.529 ms |
| Pre-setup diagnostics | `7fff0a0e0a0014001400000000000005` |
| Post-setup diagnostics | `7fff0a0e0a0014001400400030000205` |
| Persistent availability | 32,767, saturated at the signed-short ceiling |
| Transient reset / deselect availability | 2,574 / 2,560 bytes |
| Maximum / unused commit capacity | 5,120 / 5,120 bytes |
| Post-setup compact pool / DLEQ allocation | 16,384 / 12,288 bytes |
| Setup state / diagnostic format | 0 before setup, 2 afterward / 5 |
| Private public key | `03ccac13764ad692b16bfd3cacd7fcbf8bec4dd213d5d416de80689d1b47f7e010` |

## Conditional cleanup

The retained journal met the reviewed cleanup admission for unsigned synthetic
state: exact card/image/fixture, successful initial factory proof and blank
registry, a pre-sign loading stop, and absence of payment BEGIN, SIGN, scope or
packet evidence. The operator returned 09336320 to the ACS reader. One
cleanup-only connection rematched CPLC, checked production/other-probe absence,
proved the published factory keys before external authentication and required
the original baseline plus only the allowed private objects before deletion.

It removed `F04341534855434D505401`, `F04341534855434D50544D`, then
`F04341534855434D5054`. Final registry frames were independently decoded and
matched byte for byte to the original load files:

- `A0000001515350` (255.255)
- `A0000000620204` (1.0)
- `A0000000620202` (1.3)

The cleanup journal ends `cleaned` / `verify-blank-registry`, with
`blankBaselineVerified: true` and no reported close failure. It retains the
final registry; the pre-delete registry was overwritten by that final scan.
Its inherited `two-input-two-output-v1` workload label is runner metadata. This
cleanup sent no fixture, load, install, setup or signing commands and retried
neither the failed exchange nor the capacity workload.

## Follow-up

Before preparing another physical invocation, improve the isolated lab's bounded
failure evidence to retain a safe native error category and failed-call elapsed
envelope, without raw native messages or authentication material. Preserve the
consumed journal and existing image, timeout and command limits. A subsequent
test needs a reviewed exact APK and named approval. Further ACS installation
attempts remain paused.

The [earlier small physical payment](HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md)
remains the signing/export evidence, and the
[Pixel creation control](HARDWARE_TEST_REPORT_2026-10-30.pixel-compact-creation.md)
remains the completed independent creation result. Full-slot capacity still
requires a complete measured run before choosing protocol limits.

## Evidence integrity

Protected originals are retained under `pixel-capacity-control-2026-10-30`:
approved plan and approval, exact APK/build checks, CI record, device details,
identity journal, start intent, progress/terminal UI dumps, original database
archive, parsed journal, cleanup admission, cleanup journal and completion record.

| Evidence | SHA-256 |
| --- | --- |
| Approved `plan.md` | `68522983646dc9f4745029450c3ab5ccd56136f5636568ba15943ffa574e39b6` |
| `pixel-journal.json` | `8c8b40e3d52ac9a58eced827519bfdd03e9c05aad55e49efaf933fb38e284a60` |
| `cleanup-journal.json` | `67047529b12bb612a13fdc20568b24e75bd37f70c66901a5af0adbfd0d745ffc` |
