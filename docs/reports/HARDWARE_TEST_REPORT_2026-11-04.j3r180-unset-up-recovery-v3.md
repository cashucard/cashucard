# Unset-up recovery v3: stopped on a different chip identity

The single authorized invocation stopped at the initial CPLC identity check.
The presented card reports serial **09336320**, batch `5547`, while the approved
plan requires **09336120**, batch `5547`. No authentication or deletion was
attempted. Reader closure was confirmed. This does not establish blank state.

## Authorization and environment

The operator stated `09336120 is on the reader`, then `execution approved`.
Signed approval commit `9233a6f6c6676dfcf75b0bbf0c19585787f00180` records that
decision for `recover-unset-up-v3` and binds the unchanged plan SHA-256:
`ecd9b3c9073a96d61ae045fcb34a1b18cf5f3cf3881c3b62daa2a4e13eb9610c`.
The implementation remains signed `45b449a` plus `5472ba9`.

- Reader: exactly `ACS ACR122U PICC Interface`; one exclusive connection.
- Host: this Mac, Node 22.23.4 and the pinned Python 3.15 venv.
- Runtime: 611 files verified before approval; only the tracked approval record
  changed. Approved runtime SHA-256:
  `188e905fb4b9ba45f25fc6d30778eaf13393251caddafa0f96056b97a4744cc0`.
- Campaign: new private `qualification-2-approved/campaign.json` beneath
  `~/.cashucard/recover-unset-up-v3-preparation-2026-11-04/`, SHA-256
  `94630b62143b8b8f7e6e888f0ca0fe0af2c92246b9bedc0f7e6f5cd53ac590ec`.
- Local-only approved preview passed before execution. No additional discovery,
  preflight connection, reset, reconnect or retry occurred.

The planned historical private image CAP SHA-256 is
`b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`
from `pixel-install.json`. No private applet was selected and no installed CAP
was identified or attested in this invocation. No CAP was loaded or changed.

## Observed commands and result

| Command       | Status | Public response                        |
| ------------- | ------ | -------------------------------------- |
| SELECT ISD    | `9000` | `6f108408a000000151000000a5049f6501ff` |
| GET DATA CPLC | `9000` | 45-byte `9f7f2a` TLV below             |

```text
9f7f2a4790d321470000000000304109336320554700000000000000000432a939333336330000000000000000
```

The unchanged cardkit `parseCplc` independently decodes the saved response as:

- Fabricator `4790`, IC type `d321`, fabrication date `3041`.
- Serial `09336320`, batch `5547`.
- Actual chip ID: `cplc-v1:4790d3213041093363205547`.
- Approved chip ID: `cplc-v1:4790d3213041093361205547`.

The host returned `status: stopped`, `stage: match-chip`, `failure: wrong-chip`,
`commands: 2`, `deleted: []`, `readerClosed: true` and
`blankBaselineVerified: false`. The independent bridge policy was incomplete,
as expected for this identity stop. No INITIALIZE UPDATE, EXTERNAL AUTHENTICATE,
registry query, private command or DELETE was sent. The returned identity alone
does not establish the presented card's installations, balance, ownership or
association with an earlier physical-card label.

## Preserved evidence and next boundary

The fresh journal is
`~/.cashucard/recover-unset-up-2026-11-04/attempt-4/recover.json`, mode `0600`,
SHA-256 `17db6c388dc76d22ee8466eb2b82a3b483f0dcb34728f03fc211d62f8c814b09`.
The permanent `.consumed` marker and pinned `.request.json` are preserved.
The lease was released after confirmed closure. A new private `result.json`
alongside the approved campaign records the decoded result and journal hash.

All five historical journal hashes and protected source hashes still match the
unchanged preparation audit. The original unapproved preparation campaign is
also preserved. No production service or phone was accessed.

The invocation is consumed. The identity pin was not changed and no successor
plan or attempt was started. The operator must resolve which physical card is
intended before another device operation is considered; a further attempt needs
a fresh bounded plan and explicit approval. This report records a successful
identity guard and stop, not successful cleanup or payment qualification.
