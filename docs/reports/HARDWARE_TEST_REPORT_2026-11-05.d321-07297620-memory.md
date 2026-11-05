# 07297620 public memory snapshot after the creation stop

The approved five-command snapshot completed, independently verified saved
public counters and confirmed reader closure. The ISD reports 92,696 persistent
bytes and 3,750 volatile bytes available. This supplies current resource evidence;
it does not identify why the private main instance failed to register.

## Bound execution

The operator answered **"yes"** to the finished
[five-command plan](HARDWARE_PLAN_2026-11-05.memory-07297620.md). Approval was
recorded and signed at `e3b4164fdf0811704dbace272fd07a5975bc73d3` before access.
Only this new plan's approval state/audit changed; device, frames, limits and
implementation were unchanged. All 14 affected Node cases and all 58 Python
policy cases passed again, along with formatting and whitespace checks.

- Card: `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**.
- Reader: exactly `ACS ACR122U PICC Interface`, one exclusive connection with
  leave-card disposition, no reset, reconnect or retry.
- Host: this Mac, Node 22.23.4, reviewed cardctl venv Python/pyscard.
- Runtime: 624 pinned files, digest
  `75b4f5881eebfe7e69375f224516e455edf179db8b96863cff515f7d7c78e698`.
- Approved campaign SHA-256:
  `84bf38d576370a844920137cc4fd2a16d5c8644b489fde2416391bb11098c83e`.

The original unapproved preparation remains intact. A new approved campaign
was described and previewed from clean signed source, then executed once with
the same arguments plus `--execute`. Consumption and complete runtime/evidence
revalidation preceded native access. The launcher exited 0, without stderr or
a host timeout.

Exactly five commands ran: SELECT ISD, CPLC, GET DATA FF21, SELECT ISD, CPLC.
Every status was `9000`, and both raw CPLC replies matched the fixed 45-byte
identity. FF21 had the exact expected 19-byte structure:

```text
ff211081020002820400016a18830400000ea6
```

## Counter comparison and limits

| Public counter             | October 28, after cleanup | November 5, this snapshot |    Difference |
| -------------------------- | ------------------------: | ------------------------: | ------------: |
| Persistent bytes available |                   119,940 |                    92,696 |       -27,244 |
| Volatile bytes available   |                     3,750 |                     3,750 |             0 |
| Tag 81, uninterpreted      |                         1 |                         2 | Recorded only |

The historical values are from the
[earlier card-specific report](HARDWARE_TEST_REPORT_2026-10-28.d321-07297620-compact.md).
The snapshots straddle a reported reset and different installed states. Do not
attribute the persistent delta to a particular allocation or treat tag 81 as a
diagnosis. Reported availability establishes neither the largest contiguous
allocation nor installation transaction headroom, key/engine costs or image
layout suitability. Unchanged volatile availability alone does not prove that
all constructor transient allocations would succeed.

The [preceding registry inspection](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-registry-inspection.md)
found private package and opener present, main absent, and all four original
platform frames intact. This snapshot did not re-read those registries or run
the private applet. It makes no new installation, setup, signing or payment
claim. The [offline constructor audit](ANALYSIS_2026-11-05.07297620-main-creation.md)
and these counters leave the creation failure's cause unresolved.

## Evidence and terminal boundary

New private evidence is under
`~/.cashucard/memory-07297620-2026-11-05/`, with the original preparation in
`preparation-1`, approved execution receipts/review in `preparation-2`, and
the consumed journal/request in `pass-1`.

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `pass-1/memory.json`              | `4a3cbe37b9ce69124f56e193206e979ace7bbb03070f894ccba16e9bb9306724` |
| `pass-1/memory.json.consumed`     | `0aec0d68019c1ad4c60d34ab525014deac97e4d17fc8469df182c4668bd76ee9` |
| `preparation-2/result.json`       | `7c0bc66c07177bf893feb33dc00914c3be7eb491dc3e20517b2ee4264177e8d7` |
| `preparation-2/saved-review.json` | `81be93e1a04581a432f9c914c3f78bcc82a11c6fa6f62451dc8d573269d94cb9` |

The final journal is `measured` / `memory-verified`, with `memoryVerified`,
`finalIdentityVerified`, `savedEvidenceVerified`, `independentPolicyComplete`
and `readerClosed` all true. A further offline review checked terminal fields,
independently replayed the five public receipts and decoded raw FF21, and
rechecked all historical evidence/protected-source hashes. Replay used an
in-memory preterminal status view required by the existing live verifier;
the terminal journal bytes were not changed. The closure lease was released.

No authentication or secret-bearing command, private applet SELECT/command,
registry query, INSTALL, LOAD, DELETE, key change, SETUP, proof, funding,
signing, payment, export or retirement occurred. No CAP was loaded or attested.
The retained candidate's CAP hash remains documented in the preceding creation
report; it is not established by this memory read. No phone or production
service was accessed. No further card command or connection followed.

The plan is consumed. Preserve the retained package/opener and evidence. This
result authorizes no constructor retry, padding change, diagnostic installation,
cleanup, new plan or successor device access. Hardware creation/payment
qualification remains incomplete; the original goal remains online-phone
relay followed by independent exact-once till recovery.
