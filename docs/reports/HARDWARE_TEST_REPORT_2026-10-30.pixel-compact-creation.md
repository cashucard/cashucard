# Pixel private compact creation control

## Result

The approved creation-only control completed on card 09336320 through a Pixel
8 Pro. The unchanged private CPROT/2 image loaded through 110 blocks, created its
opener and main instance, answered format-5 diagnostics and returned a valid
compressed public key. A fresh CPLC match and factory channel preceded cleanup.
The exact original three-file blank registry was verified after removing the
private main, opener and package. The phone UI reported completion, the public
journal was collected, and only the lab process was stopped. The conditional
ACS cleanup was unused. The named plan is consumed.

This is one successful independent creation control. It does not identify the
cause of the earlier ACS PC/SC failures. Setup, full-record capacity, many-small
records, signing/export and interrupted writes were outside this invocation.
Further ACS installation attempts remain paused; subsequent Pixel workloads
need their own prepared software and named approved plan.

## Devices and artifacts

| Item | Value |
| --- | --- |
| Local test date | 2026-10-30 (America/Los_Angeles) |
| Card / CPLC | 09336320 / `cplc-v1:4790d3213041093363205547` |
| NFC device | Google Pixel 8 Pro, Android 17 / API 37, Android IsoDep |
| Host | Operator Mac; USB/ADB for installation, lab UI and public journal collection |
| ACS role | Identity-only precheck; no installation or authentication |
| Lab package / signer | `org.cashucard.compactlab` / published Android debug signer |
| Lab source / merge | `a564c8faf18624cff1691c8e00d7a998b0979337` / `b78afdb7f6e58a0d70d2b9c15751fc50c97314ba`, #215 |
| Review and CI | Exact-head review; all 22 checks passed |
| APK SHA-256 | `05a0407e8d65a686c4d7293259c691585efcbe4ab6e164a01e9217c534611623` |
| Private image source | `c23c492eafba998fad14f5ef5a82d6686b67d98d` |
| CAP SHA-256 | `41bfc03d191ab9ee109370b83ddfdfcd3505f2bf24953583ea2c775470059941` |
| Load SHA-256 / size | `cad4d1f3093fc1e694dfe02806e62050211dd9baac9d4b0e11a9336fe7825c64` / 26,934 bytes |
| Image manifest SHA-256 | `b0515dcea92a00cc7a61deae88e1541ae9d68e8c1d9a4557ed64b8554f09da25` |
| Private package / ABI | `F04341534855434D5054` / CPROT/2, format 5 |
| Android response timeout / maximum frame | Reported 15,000 ms / 65,279 bytes; every sent frame limited to 261 bytes |

The lab APK has a separate application ID, bundled JavaScript, disabled
developer support/release variants, and no Internet or overlay permission. The
installed CCP app, its saved work, released firmware and ops-service were
unchanged. The build used JDK 17 and the existing pinned Android toolchain.
Local hardware-free validation recorded 167 passing tool tests, eight expected
environment skips and 19 focused controller/generator cases.

## Precheck and execution

The first ACS connection attempt failed before any APDU. After the operator
requested an identity check, one two-APDU connection identified 07297620 and
stopped without authentication or writes. The operator then requested another
check after swapping the card. SELECT ISD and GET DATA CPLC matched 09336320.
These original identity journals were retained. No further ACS connection was
used by this successful control.

The exact APK was installed without replacement and launched as Cashu Card Lab.
Its initial UI showed a fresh attempt. The start action was armed once, with a
consumed journal saved before NFC discovery. The operator moved the verified
card from the reader to the Pixel and held it still. The controller checked
identity, object absence, factory-version-1 cryptogram and exact blank registry
before the first private write. Both factory channels proved the published keys
before external authentication; there was no alternate-key attempt or rotation.

The collected journal ended `complete` / `blank-verified`, with 143 commands.
The final UI also showed that result. After observing this terminal result, the
lab process was stopped and only its database/sidecars were copied through
`run-as`; the saved public journal was extracted from that consistent local
copy. No journal was erased or rearmed.

## Measurements

Stage timings use the phone's monotonic clock and include journal work within
the timed stage. They are host-observed envelopes, not isolated chip execution
latencies. Connected duration uses the phone's session wall-clock stamps.

| Observation | Result |
| --- | --- |
| Connected session duration | 20,783 ms |
| LOAD blocks / summed stage envelopes | 110 / 12,107.759 ms |
| Final LOAD stage | 1,108.652 ms |
| Opener creation stage | 256.657 ms |
| Main creation stage | 1,366.012 ms |
| Pre-setup diagnostics | `7fff0a0e0a0014001400000000000005` |
| Persistent availability | 32,767, saturated at the signed-short ceiling |
| Transient reset / deselect availability | 2,574 / 2,560 bytes |
| Maximum / unused commit capacity | 5,120 / 5,120 bytes |
| Compact pool / deferred DLEQ allocation | 0 / 0 bytes; setup was not sent |
| Setup state / diagnostic format | 0 / 5 |
| Private compressed public key | `032b04632d9578f0ab34e91b0a24d3f1d90e7da81f223794cddd43fe99303f3cfa` |

After successful creation validation, the controller rematched 09336320 and
opened one fresh factory-version-1 channel. The registry had exactly the private
main/opener/package and the original baseline. It deleted private objects in
that order, then verified only the original load files:

- `A0000001515350` (255.255)
- `A0000000620204` (1.0)
- `A0000000620202` (1.3)

The host independently decoded the final registry TLV frames from the saved
journal and matched all three original bytestrings. The card ended blank with
factory manager keys unchanged. No fallback cleanup, further card read, power-cut
test, fixture setup or signing operation followed.

## Interpretation and remaining work

The same private image that failed at creation on the ACS path completed
creation through Pixel in this invocation. Together with the earlier small
ACS success, this does not isolate a faulty card, reader, driver, field or
runtime condition. The result supports using the independently measured Pixel
path for the next prepared workload while retaining the ACS installation stop.

The [earlier small physical payment](HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md)
remains the signing/export evidence. This creation-only control allocates
neither the 16 KiB compact pool nor the deferred DLEQ area and supplies no new
payment-capacity result. Full-slot/large-packet, many-small-record, and physical
interruption gates remain open. Production authorization, final protocol limits
and integrated wallet/till enablement remain separate release gates. Assisted
settlement remains disabled in the released apps.

## Evidence integrity

Protected evidence is retained under
`pixel-creation-control-2026-10-30`, including the approved plan, exact APK/build
verification, exact-head CI, device details, identity journals, one start intent,
terminal UI dump, original lab database archive, parsed public journal and
completion record. APK and image hashes are above.

| Evidence | SHA-256 |
| --- | --- |
| Approved `plan.md` | `80bb7bbd8259daf5c04293db145e7397f7f0d731f9c216f48fbdd66f1ef74dd7` |
| `pixel-journal.json` | `a745c1f4aad37a084a9e4d56bf3c77ca75656b6daa0020b2c99a2ec641fb47ba` |
