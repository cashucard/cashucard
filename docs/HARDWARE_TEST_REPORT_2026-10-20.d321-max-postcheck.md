# Max read-only identity after Pixel provisioning

ENG-741, 2026-10-20. The operator explicitly approved the Max CPLC-only
post-check on the same spare used in the
[Pixel three-boundary drill](HARDWARE_TEST_REPORT_2026-10-20.d321-pixel-recovery.md).
The operator confirmed the displayed full identity exactly matched
`cplc-v1:4790d3213041093363205547`. This is one operator-confirmed read,
not an independently captured screenshot or transport transcript.

## Device and procedure

- Max: iPhone 13 Pro Max (`iPhone14,3`), UDID
  `00008110-001E4CC014D8401E`. Last recorded OS: iOS 26.5.2, build 23F84.
- Existing app: `com.islandbitcoin.provisioner`, previously installed signed
  Release. Launch through devicectl succeeded; no rebuild/reinstall or data
  clearing occurred for this post-check. Earlier build/UI provenance is in
  [the phone report](HARDWARE_TEST_REPORT_2026-10-20.d321-phone-cplc.md).
  Binary hashes and OS version were not recaptured during this check.
- Card: serial `09336320`, post-provisioning installation
  `036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490`.
  The Pixel evidence supplies this installation identity. CPLC identifies the chip separately.

The operator initially attempted sign-in, then was directed to the offline
demo door: Review in demo mode → Settings → Read physical card identity.
No service login is required by this diagnostic. The operator was instructed
to tap Read, wait for the NFC sheet and hold the same spare at the top edge.
After saying the result was visible, the operator explicitly confirmed the
full expected ID in a separate response. No credentials were requested.

Authorized APDUs only: SELECT ISD `00A4040008A00000015100000000`, then
GET DATA CPLC `80CA9F7F00`. These are the existing reader's command allowlist,
not a captured silicon transcript. No manager authentication, key fetch,
replacement, rotation, PIN/owner/proof operation or batch migration occurred.

## Result and limits

The confirmed Max result equals the spare's pre-write USB identity and the
Pixel's bound identity after installation/rotation. Together these observations
support CPLC stability across this run's applet replacement and manager-key
rotation on this one chip. They do not prove fleet-wide uniqueness, applet/CAP
identity from CPLC alone, repeated post-write iPhone reads or full iPhone
installation/recovery. No new CAP was installed in this check; the Pixel run
used tracked CAP SHA-256
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
The card remains on its assigned manager keys and is not personalized or
ready for a holder. Both committed release gates remain false.
