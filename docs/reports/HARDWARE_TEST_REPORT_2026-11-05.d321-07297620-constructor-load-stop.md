# Constructor diagnostic v2 stopped during LOAD, before creation

The approved v2 invocation stopped on LOAD block 20, command 28, with fixed
native category `reader-transmit-failed` and PC/SC code `80100016`. Blocks 1–19
were acknowledged. The failing command has no card status word. Neither new
opener nor diagnostic main creation was reached, so there is no constructor
result. No retry, cleanup or follow-up command occurred.

Reader closure was not confirmed by the host's explicit close protocol. The
uncertain-closure lease is retained. This does not establish that a connection
is still open: native code attempts disconnect in its finally path, but the
required close acknowledgement was not obtained. Do not remove/reuse the lease
or consumed journal to retry.

## Bound execution and prerequisites

The operator approved the finished
[v2 plan](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.md). Approval was
recorded and signed at `c6597136784ffb8ebafc2761d9df7de3aaef7230` before access.
All 22 affected Node cases and 65 Python cases passed again. The previous full
qualification passed 291 Node cases without skips and included 71 JVM diagnostic
cases. The default hash used the actual retained byte array with the corrected
buffer normalization; the earlier zero-command host failure did not repeat.

- Card: `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**.
- Reader: exactly `ACS ACR122U PICC Interface`; one exclusive connection with
  leave-card disposition, no reset or reconnect.
- Host: this Mac, Node 22.23.4, reviewed cardctl Python/pyscard runtime.
- Runtime: 645 pinned files; digest
  `23ff6844d44990aa6518656430bbcd07f2bffc99e9693b3a7ce2cc344d844529`.
- Approved campaign SHA-256:
  `ed26b89f0d2538f7e881b70b77821d8bc5e587bdd8dfc7aa01fda9269d002d41`.

The original v1 evidence and unapproved v2 preview remain intact. A new approved
campaign in `preparation-4` passed local preview and was executed exactly once,
after consumption and runtime/artifact/history revalidation. Launcher exit was
1, without stderr or a host process timeout.

Exact initial raw/parsed CPLC matched. One version-1 channel proved the public
factory keys before the sole EXTERNAL AUTHENTICATE. Both complete initial
registries matched the pinned state: only old compact opener
`F04341534855434D50544D` in applications, old package
`F04341534855434D5054` plus all four unchanged platform frames in load-files,
including CardDocLite. Old main and the new diagnostic namespace were absent.
No authentication bodies, challenges or MACs were retained.

## Transfer observation and image

The new target namespace was only `F0434153485543545243`.
INSTALL for load and all first 19 LOAD blocks returned `9000` with permitted
GP acknowledgements. Each block had 247 bytes: 4,693 payload bytes were
acknowledged, not a completed load-file registration or image installation.

Command 28 was block 20 (zero-based P2 `13`), header `84E80013`. Its saved
normalized public intent digest is
`4c594b5e221593f6fda571f34df0100b95c77e214eddf0ca5656b9d697515b2c`.
The saved host await was approximately **5,083.189 ms**, ending with
`reader-transmit-failed` / `80100016`, `sw: null`. This includes bridge/native
error handling and is not isolated chip execution time. No card refusal or
host response-deadline expiry is established by that native error code.

- Image source: `5b301b5df1e31dcf50bf42d1d5e8604541e0ccff`.
- CAP SHA-256:
  `f3cd1dc65e44da93bc7c90c2f7151735610f90599ca2ead5f8d51d03b128e7ba`.
- Load SHA-256:
  `619c41f59e59d31c2d8e5aa46136a2d84ef14c0bf86d945da82b6ad626a94559`,
  20,653 bytes / 84 blocks planned.
- Manifest SHA-256:
  `3004dc15805313049c9331249c4a04640155916df88304948dc2d529ac89e41c`.

The source-bound before/after markers never ran in a diagnostic main: creation
was unreached. Current partial-load/registry state was not inspected afterward
and must not be inferred from the acknowledgements. This run establishes a
failure during transfer before constructor execution, not a constructor fault,
memory limit, faulty card, defective reader or a cause shared by older stops.
The [earlier USB report](HARDWARE_TEST_REPORT_2026-10-28.d321-07297620-compact.md)
also recorded `80100016`, at a different stage; identical codes do not prove
identical causes.

## Evidence and terminal boundary

Private evidence is under
`~/.cashucard/constructor-trace-07297620-2026-11-05/`: `pass-2` retains the
journal/request/marker/closure lease; `preparation-4` retains the approved
campaign, execution intent/output/result and saved offline review.

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `pass-2/diagnostic.json`          | `757325a2687c19768a877ece53fec0de2b4255639df4d58912a8a240bd519f3f` |
| `pass-2/diagnostic.json.consumed` | `2db84404b6a9f4945bbfe0d421ea83c67f2d05205263798a55c4be550493102e` |
| `pass-2/diagnostic.json.lock`     | `8a3e22c8f0c65231bca407d80d8cd893d15979e7732881b45993775f302a5cd1` |
| `preparation-4/result.json`       | `894396bf494762f4b70f30b7c5e88e817e057b4d18eaab266ce52a17ee4fdc67` |
| `preparation-4/saved-review.json` | `a13ccc68bb908d7793d520c77fc9a6000cd7242cfcc48ec52a31afc3936ee57f` |

The final journal is `stopped` / `load-20`, with 28 command intents,
`initialRegistryVerified: true`, `constructorResult: null` and
`readerClosed: false`. No installed-registry, diagnostic or final-identity
verification was reached. The saved review independently replayed the 27
completed public receipts plus the unconfirmed final command intent against
the exact pinned program, verified initial canonical registry frames and
rechecked every prior evidence/protected-source hash. It did not edit any
original journal or access the card. Authentication contents remain excluded.

No diagnostic applet creation, private SELECT/status, DELETE, PUT KEY, SETUP,
proof, funding, signing, payment, export or retirement occurred. Issued commands
did not target the old package/opener for mutation. No phone, production
service or ops state was accessed. No further connection or command followed.

The plan is consumed. Keep the card aside, preserve the uncertain closure lease
and partial-load evidence, and obtain an operator decision before any new
connection, state inspection, reset, cleanup, new plan or transfer. The original
online-phone relay / exact-once till-recovery hardware goal remains incomplete.
