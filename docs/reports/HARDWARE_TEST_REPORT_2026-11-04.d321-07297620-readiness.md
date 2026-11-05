# 07297620 readiness: factory proof stop

The authorized one-use `readiness-07297620-v1` connection matched the selected
card, then stopped because the card cryptogram did not prove the public factory
key set. EXTERNAL AUTHENTICATE was **not** sent. No registry, installation,
private applet or deletion command followed. Reader closure was confirmed.
Current blank state and usable manager authority remain unverified.

## Bound source and authorization

The operator selected 07297620 for the replacement plan, then said "ok execute".
The [dedicated readiness plan](HARDWARE_PLAN_2026-11-04.readiness-07297620.md)
was signed and committed before access at
`4a4d92e143f22b29bf4f2d965056f69e34706aaa`. No implementation changed after preview.

Host: this Mac, Node 22.23.4, isolated Python 3.15 with reviewed pyscard. Reader:
exactly `ACS ACR122U PICC Interface`, one exclusive connection, leave-card
disposition. Runtime map: 617 files, SHA-256
`5a92999eb505cbbba31a278d59b275ead5eb7745bfe424d165840eec69eee315`.
The private campaign SHA-256 is
`f136426408fa796f05bc09224f3d1070c9803ed270943bdabf5d10f16755a7e6`.
The approved local-only preview passed before the single execution.

Offline qualification: 212 outbox tests and 50 Python tests passed; formatting
and whitespace checks passed. The independent policy and isolated synthetic
PC/SC tests exercised nine-command success and fault stops. These results did
not establish the real card's current manager keys.

## Observed sequence

| Command                          | Status | Result                                                        |
| -------------------------------- | ------ | ------------------------------------------------------------- |
| SELECT ISD                       | `9000` | ISD FCI                                                       |
| GET DATA CPLC                    | `9000` | Exact `cplc-v1:4790d3213180072976207515` match                |
| SELECT ISD                       | `9000` | ISD FCI                                                       |
| INITIALIZE UPDATE, key version 1 | `9000` | Parsed SCP02/version 1 reply; factory cryptogram proof failed |

The host returned `stopped` / `factory-authentication` /
`factory-keys-not-proved`, four commands, no registry pages,
`blankBaselineVerified: false` and `readerClosed: true`. Authentication
response bodies, challenges and cryptograms were deliberately not retained.
No alternate key set, authentication retry, reconnect or reset was attempted.
The card's lock counter was not read; no claim about its value is made.

CPLC matches the identity-only read:

```text
9f7f2a4790d32147000000000031800729762075150000000000000000048c2337323937360000000000000000
```

No CAP was loaded or attested. The adoption plan's streamed candidate remains
only a candidate; its CAP hash is
`b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`.
No phone or production service was accessed.

## Evidence and interpretation

The journal is `~/.cashucard/readiness-07297620-2026-11-04/pass-1/readiness.json`,
SHA-256 `9cbef5cac558c2ce871bfdcc38d76ea33f5b3f6b8af5fb6f002f414b5285b4b1`. The consumed marker, pinned
request and new preparation/result receipt remain private and intact. The lease
was released after confirmed closure. All eleven references in the adoption
and original recovery audits still match, as do protected source hashes.

Offline review confirmed that the SDK copies a Buffer host challenge to plain
bytes before SCP02 calculations. A fresh synthetic run with the production
`crypto.randomBytes` adapter passed. No host fault was established by this
review. The failed real proof does not by itself identify changed keys, key
diversification, or a card/transport cause. Its omitted authentication bodies
cannot be reconstructed from the journal, and no new read was performed.

The invocation is consumed. Do not try another key, skip proof, erase, install
or continue to the phone stage. The operator must clarify this card's manager-key
provenance since the historical factory-key cleanup. A step needing nonpublic
keys belongs to the operator through the existing secure tooling; those keys
must not enter chat, commands or journals. A successor device operation needs
its own named, bounded plan.
