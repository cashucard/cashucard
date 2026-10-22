# Signed release candidate acceptance — 2026-10-22

These are review candidates, not approval for public store publication. Both
artifacts use `com.islandbitcoin.provisioner`, version 1.0.0, build 3, and the
production HTTPS ops-service origin. Neither artifact has been uploaded.
Source: main `1ff98eb978eb587d7703b4dd928259060880005e`, with the service-origin
configuration overridden for the candidate builds only.

## Android

The signed AAB's certificate matches the existing Play upload certificate.
The actual bundle targets SDK 36, is not debuggable, and passes the 16 KB ELF
alignment check for all 24 included 64-bit native libraries. Its only platform
permissions are Internet, NFC, vibration and the app's private receiver permission.
Cleartext traffic uses the target-SDK default of disabled. Both signing
passwords were checked absent from all inflated bundle entries.

AAB SHA-256:
`bdf1c81838666490d1d8c0be0f6eebca959da9ec8210f02096182f99de161022`.

## iOS

A generic-device Release archive and App Store Connect export completed using
Island Bitcoin's distribution identity and the app-specific distribution
profile. The archive passed strict deep signature verification. The actual
archive has team H7UAM79QQP, NFC TAG entitlement and debugging disabled.
Arbitrary network loads are disabled; local networking remains allowed.
The exported IPA's identifier, version, build and bundled production origin
were independently checked.

IPA SHA-256:
`ff15826428b92ed874fe0db4c0121f8d17d613664fa8251e4781b6a4ba297f83`.

## Production recovery acceptance

The independent Nextcloud production copy was downloaded with its manifest.
Its size and SHA-256 matched. The production identity was retrieved from
Vaultwarden into process memory and used to restore into a temporary empty
local database. SQLite integrity passed; the recovery fence was set; the one
operator's credentials were disabled. Sessions, pairings, recovery connections
and copy receipts were absent. The temporary plaintext database and associated
files were removed. No identity file was written to the laptop.

Snapshot: `2026-10-22T21:14:55.704Z-e135fc43-608e-44c9-bd5d-ff285ce21978.age`.
This initial production snapshot contains no batches, issued keys or cards.
It proves the production custody/copy/decryption/fencing path, not recovery of
production card mappings. The separate staging restore covers populated keys.
Both staging and production schedules remain enabled; meridian-jabari's
schedule alone was retired with operator approval.

## Remaining release gates

- Card installation remains disabled (`CARD_INSTALLATION_VALIDATED=false`).
  Recovery drills and bench tools also remain disabled. Existing hardware
  reports must be reconciled with the platform release capability before a
  public provisioning release; these candidates cannot install cards.
- Apple's encryption/export-compliance classification is not declared. The
  app includes SCP02 cryptography as well as platform TLS; classification must
  account for the actual shipped implementation.
- Monitoring that can report loss of Zion from outside Zion remains open.
- Atoll's additional-issuer reply-loss fix still needs its final reviewed
  package build, CI and runtime acceptance; the currently installed package
  already has healthy independent staging and production copy histories.
- Final store declarations, reviewer access/instructions and submission review
  remain necessary. No public submission is authorized by this report.
