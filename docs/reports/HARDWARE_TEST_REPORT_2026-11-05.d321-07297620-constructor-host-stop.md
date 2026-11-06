# Constructor diagnostic stopped on the host before any reader access

The approved first diagnostic invocation stopped at `admission` with **zero
commands and an empty exchange list**. The native bridge was never started and
no reader connection or card operation occurred. The diagnostic image was not
loaded. This was a host defect, not a card or transport result.

## Bound attempt and cause

The operator approved the
[first diagnostic plan](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.md).
Approval/source were signed at `13bafb8d46714bd7398d9670288f1928b0da0538`.
An approved, fresh private campaign passed local preview, runtime/artifact and
historical-evidence checks. The launcher durably consumed the invocation and
saved its request before entering the pure controller. It then failed before
the initial identity step; native startup is lazy inside the first transmit.

The controller passed its `number[]` load to the default Node SHA-256 function,
which accepts byte buffers but rejects that array with `ERR_INVALID_ARG_TYPE`.
The controller caught it as generic `operation-uncertain`. Earlier unit and
synthetic-process fixtures supplied an injected hash function, so the successful
tests missed the real default function's input contract. A valid artifact/local
preview did not exercise this later controller hash call.

The stopped journal remains `stopped` / `admission`, `commands: 0`,
`constructorResult: null`, `failure: operation-uncertain`,
`independentPolicyComplete: false`. Its `readerClosed: true` came from the
no-bridge close callback; it is not an independently observed reader closure.
No reader was opened, so no closure or actual card state was measured.

## Offline correction and regression

The corrected call is `hash(Buffer.from(load))`, preserving the exact load bytes.
The standalone default-path regression failed before this fix. Real-artifact
synthetic process fixtures now leave hashing at its actual default rather than
inject a successful result. The fixed default path passes the complete pinned
image/program with synthetic PC/SC; no physical device is involved.

Post-fix and successor qualification passed all 291 Node cases without skips and
all 65 Python cases, including the 71-case JVM diagnostic run. The default hash
and explicit successor-label regressions failed before their changes; complete
and caught-fault v2 native-process/replay cases now pass. These are software
checks, not a second physical invocation or constructor diagnosis.

The CAP/load/stage map and all APDU bodies, limits, identity, factory key set,
registry expectations and end state are unchanged. The original card firmware,
private compact image, existing package/opener, phone app and older policies
were untouched. The byte-array rejection was reproduced independently from the
retained load and default helper without executing a card-facing path.

The first invocation stays consumed. Its journal, marker, request, original
preview/approved campaign and stdout/result remain intact. A fresh unapproved
[v2 proposal](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.md) has separate
fixed entry points and `pass-2` storage; it does not inherit execution approval.
It admits only the same card/image/program after field equality checks and
requires a new operator execution decision. No automatic retry occurred.

## Immutable evidence

Evidence is under `~/.cashucard/constructor-trace-07297620-2026-11-05/`:

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `pass-1/diagnostic.json`          | `e397f252c9c23499cf2aed0289fcacc655269d9be57a59010def0af3fac151ca` |
| `pass-1/diagnostic.json.consumed` | `2373b674ea665c60d63053190be6f020591f0af734f830340d4e351781f0a009` |
| `preparation-2/result.json`       | `2ca14d5d4f8892efb58b85fc0193080265d37283a1e53869d9884d4595dbc83a` |
| `preparation-2/saved-review.json` | `bf44e945e509de1625f4774746584f5f1faa66d9de0201122c1c8d4c3451eeae` |

The approved campaign hash was
`5f319cd00c2b50a65bfc75ae6adc22fb605c31bcb39ce9934bb8dd06dd99ac9b`;
641-file runtime digest
`d9dab21cb7fc4ff2cde145d2b3a294672f6e1a96aada3b5545bde593e1e71555`.
The offline saved review verifies the zero-command/native-never-started path,
reproduces the host failure and rechecks all old evidence hashes. It does not
change or backfill the original journal. The lease was released without native
startup; consumption remains permanent.

No card status, registry, diagnostic, constructor stage or new hardware evidence
was obtained. No authentication, LOAD, INSTALL, DELETE, SETUP, keys, proofs,
payment, phone, reset or production access occurred. The original goal remains
unachieved on hardware. The next device action requires the fresh named approval.
