# Switched-card identity check: serial 07297620

The operator said "i switched cards, check again". The separate read-only
[identity plan](HARDWARE_PLAN_2026-11-04.switched-card-identity.md) was executed
once from signed source `7764d403ff9e6c029fbbc0392f95a43be2ca2494`. The returned identity is
**07297620**, batch **7515**, not recovery target **09336120**, batch **5547**.

Exactly two APDUs were sent on one exclusive connection to
`ACS ACR122U PICC Interface`: SELECT ISD
`00a4040008a00000015100000000`, then GET DATA CPLC `80ca9f7f00`.
Both returned `9000`. Reader closure was confirmed. No authentication, private
applet command, registry query, deletion, reset, reconnect or retry occurred.

The unchanged cardkit `parseCplc` decoded the saved 45-byte TLV as
`cplc-v1:4790d3213180072976207515`. Fabricator `4790`, type `d321`, fabrication
date `3180`. Raw public CPLC:

```text
9f7f2a4790d32147000000000031800729762075150000000000000000048c2337323937360000000000000000
```

Node 22.23.4 supervised isolated Python 3.15 with a 35-second process bound.
The prior 611-file runtime hash was verified unchanged before access. The new
identity tool was separately pinned by the plan and tested offline for its exact
sequence and status/transport/storage/closure faults (two tests passed). No CAP
was loaded or attested; the current applet, balance and installed image remain
unexamined. No phone or production system was accessed.

New private evidence is under
`~/.cashucard/switched-card-identity-2026-11-04/`: admission, consumed marker,
separate intent/reply files, final result and the SDK-decoded receipt. Final raw
result SHA-256: `8134baa6524dc6435d4f410b62b0baa869fd061e0fe9f0a1da4444e95a1a2c71`. All six earlier recovery journal hashes
(five historical plus the v3 stop) remain unchanged.

The identity-check invocation is consumed. Cleanup was not resumed, no identity
pin changed, and the previous `recover-unset-up-v3` remains consumed. The
operator must resolve the target card before a fresh cleanup is considered.
