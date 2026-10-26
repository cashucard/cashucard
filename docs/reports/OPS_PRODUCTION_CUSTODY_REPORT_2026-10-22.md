<a id="production-recovery-custody--2026-10-22"></a>

# Production recovery custody: 2026-10-22

The operator authorized production preparation and supplied the encrypted
recovery drive on the separately accessible Mac. Existing staging files were
preserved. This report covers custody preparation. Production deployment and escrow
restoration are separate operations.

## Recovery identity

The expected encrypted APFS volume was matched by UUID before writing. A new
production age identity was generated on that volume using the locked
`age-encryption` dependency in the independently installed second-Mac workspace.
Its private file and custody files have mode `0600`; the directory has mode
`0700`. The identity was not persisted on the normal laptop.

| Check | Result |
| --- | --- |
| Persisted identity derives its recorded public recipient | Passed |
| Synthetic ciphertext decrypts using the persisted identity | Passed |
| Unrelated identity cannot decrypt the synthetic ciphertext | Passed |
| Separate production Vaultwarden collection saved | Passed |
| Collection's explicit member is the designated operator, with manage permission | Passed; organization administrators retain their platform access |
| Saved secure note retrieved after reload and a fresh operator unlock | Passed |
| Retrieved identity derives the offline copy's recipient; issuer/key ID metadata match | Passed |
| Secure note closed after verification | Passed |
| Recovery volume unmounted and confirmed locked | Passed |

The public issuer UUID and recipient are in the explicit production Wrangler
configuration. The private identity is only in the designated operator's
encrypted offline copy and the restricted organization collection. Secret
contents were handled privately without printing them in commands or reports.

## Android upload signing custody

The operator copied the public **upload** certificate fingerprint from Play
Console. It exactly matches the original local release keystore's certificate:
`D1:C1:DE:8B:70:04:BF:43:14:BB:48:83:B1:7A:13:33:59:73:30:C6:0A:D4:47:E0:42:74:CC:B4:25:3D:1B:5E`.

A private working copy retains the enrolled key and certificate with a new
random password; the original keystore's digest is unchanged. The copy and its
credential file have mode `0600` in a mode-`0700` directory outside checkouts.
Android signing preflight passed using private environment inputs.

Both files were copied onto the encrypted recovery drive and compared by digest
and exact private credential equality without displaying contents. The second
Mac unlocked that copy using its backed-up password and independently exported
only the public certificate, whose SHA-256 again matched Play enrollment. No
private key was exported as plaintext, and no upload key reset occurred.

## Remaining acceptance

No production master, Worker, R2 bucket, operator bootstrap, signed app or store
upload was created during these custody checks. Production still needs a fresh
export, independent destination read-back/receipt and an actual restore from
that artifact. The synthetic challenge proves the identity file works; it is
not a service backup. Independent Vaultwarden/MFA recovery, whole-Zion alerting,
reviewed retention and restore reconciliation remain operational acceptance
items. Offline signing custody does not establish a signed Android candidate
or complete Apple distribution signing.
