# 07297620 post-reset readiness: exact blank baseline verified

After the operator reported a card reset and returned it to the reader, the
fresh `readiness-07297620-v2` invocation completed successfully. It proved
the public factory manager keys at version 1, verified empty applications and
all four original load files, rematched CPLC and confirmed reader closure.
This supplies readiness evidence, not a private installation or payment result.

## Bound execution

The [post-reset plan](HARDWARE_PLAN_2026-11-05.readiness-07297620-2.md),
profile and implementation were signed before access at
`a51ea4a58a956932697554fbaf83994c04038965`. The operator's reset report
followed standing execution approval of the selected-card replacement plan.
The reset itself was not performed or observed by this agent. The successful
proof establishes current keys for this session, not the earlier failure's cause.

- Card: `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**.
- Reader: exactly `ACS ACR122U PICC Interface`; one exclusive connection.
- Host: this Mac, Node 22.23.4, isolated Python 3.15 and pinned pyscard/SDK.
- Runtime: 620 files; SHA-256
  `09de72fe5efee227e126449778bcf5c41ad9cd25f2b5cabd35328ca9d7ea9c73`.
- Plan SHA-256:
  `5fba6b779a69045a953e8b3e2322964b0dd0da500b9ff39443c0efc8ecb10273`.
- Private campaign SHA-256:
  `0ac4f342e3ce13f2930697ee96f26cfc685b415b77ac531d7ba5d6652c98cfe6`.
- Qualification: 216 outbox tests, 50 Python policy tests and formatting checks
  passed; the new regression failed before the successor implementation.

## Observed result

Exactly nine commands were sent: SELECT ISD/CPLC, SELECT ISD/INITIALIZE
UPDATE/EXTERNAL AUTHENTICATE, GET STATUS applications/load-files, then SELECT
ISD/CPLC again. One card cryptogram proof preceded the only external
authentication. All replies were `9000` except the expected empty-application
`6a88`. No alternate key, reset, retry or reconnect occurred. Authentication
bodies, challenges and MACs are excluded from evidence.

| Original load-file AID       | Version |
| ---------------------------- | ------- |
| `A0000001515350`             | 255.255 |
| `A00000016443446F634C697465` | 1.0     |
| `A0000000620204`             | 1.0     |
| `A0000000620202`             | 1.3     |

Every full E3 frame matched the card-specific historical baseline, preserving
CardDocLite. The host, live independent Python policy and isolated saved-journal
decoder agreed. The final journal records `ready` / `ready-verified`,
`blankBaselineVerified: true`, `savedEvidenceVerified: true`,
`independentPolicyComplete: true` and `readerClosed: true`.

The preserved final CPLC is:

```text
9f7f2a4790d32147000000000031800729762075150000000000000000048c2337323937360000000000000000
```

No LOAD, INSTALL, DELETE, key rotation, private applet command, signing or proof
operation was sent. No phone or production service was accessed by this
invocation, and no ops reconciliation state was changed. No CAP was loaded or
attested; the proposed streamed image remains only a candidate for this card.

## Evidence and next boundary

New private evidence is under
`~/.cashucard/readiness-07297620-2026-11-05/`. The final journal is
`pass-2/readiness.json`, SHA-256 `c45962384f33478f1022ece106471e46e5966f8989e8a686504f2a3b5659c29d`. Its consumed
marker and pinned request remain in place, and a new `preparation-v2/result.json`
records the outcome. The lease was released after confirmed closure. All
historical evidence referenced by the new audit remains preserved.

The plan is consumed. Readiness permits preparing the separately scoped phone
creation control on this exact card; it does not authorize another reader
connection, an implicit install, or clearing any production provisioning fence.
The phone/runtime, new card-specific controller and explicit creation/end-state
plan must be pinned and qualified before that stage. The original goal remains
card-to-online-phone relay followed by independent exact-once till recovery.
