# Public memory snapshot of 07297620 after uncertain creation

- Plan ID `memory-07297620-v1`; execution approval **false**, unconsumed.
- The operator's **"ok continue"** authorizes offline investigation/preparation
  after the completed registry inspection. Device execution of this new named
  plan remains a separate final decision; no consumed approval is reused.
- Card exactly `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch
  **7515**; exact raw CPLC is fixed in `memory-07297620.json`.
- Reader exactly `ACS ACR122U PICC Interface`; one exclusive connection using
  leave-card disposition. No phone access.

## Purpose and fixed commands

The main instance is absent, while the private package/opener and all four
original platform frames were verified by the consumed
[registry inspection](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-registry-inspection.md).
The [offline analysis](ANALYSIS_2026-11-05.07297620-main-creation.md) found unchanged
constructor/field/signer sources and expected converted class shape. Read the
current public ISD memory counters before considering any constructor experiment.
The older October 28 snapshot is not current resource evidence.

| Order | Exact action                                                       | APDUs |
| ----- | ------------------------------------------------------------------ | ----: |
| 1     | SELECT ISD, `00A4040008A00000015100000000`                         |     1 |
| 2     | GET DATA CPLC, `80CA9F7F00`; require exact raw and parsed identity |     1 |
| 3     | GET DATA public ISD memory, `80CAFF2100`, once                     |     1 |
| 4     | SELECT ISD, same exact frame                                       |     1 |
| 5     | GET DATA CPLC, same exact frame and identity; then close           |     1 |
| Total | Nominal and hard maximum                                           |     5 |

No authentication, key proof/guess, registry query, private applet SELECT or
command, INSTALL, LOAD, DELETE, PUT KEY, SETUP, funding, proof, signing, payment,
export or retirement. No reset, retry, reconnect, cleanup, phone or production
access. Do not change, remove or reinstall the retained package/opener.

Each response must be `9000`. FF21 must have exactly the observed 19-byte
`FF21 10 81 02 <2> 82 04 <4> 83 04 <4>` structure; retain raw bytes and decode
unsigned tag-81, persistent and volatile counters. Tag 81 is recorded without
interpreting its meaning. No new memory tag or alternate command follows an
unsupported/malformed/refused response. The host and independent Python policy
both require exact command order, raw CPLC and framing. Any mismatch, failed
persistence, late/uncertain response or closure failure stops and preserves data.

The transmission gate remains 120 seconds and each response wait is bounded by
30 seconds or the remaining budget. Recheck the budget before native startup
and sends. Persist public intent before each transmit and public reply before
continuing. Raw native exception text is excluded. There are no secret-bearing
commands. A transport failure is not represented as a card status.

## Admission and immutable evidence

The new fixed host/controller `memory-07297620.cjs`, profile
`memory-07297620.json`, transport `memory-transport.cjs` and independent native
policy/decoder `memory_07297620.py` leave every consumed tool and guard unchanged.
The [audit](HARDWARE_PLAN_2026-11-05.memory-07297620.audit.json) pins old protected
sources, historical journals, current registry evidence and the offline analysis.
No PC/SC import/enumeration occurs until approval, runtime pins and the synced
one-use marker pass. Saved-evidence verification is hardware-free.

After explicit approval, record only the new plan's authorization state, rerun
affected checks, sign clean source and prepare fresh private campaign/runtime
pins. Preserve the unapproved preparation and create a new approved preview.
Admission checks source, plan, profile, audit, actual Node/Python/SDK/pyscard and
historical evidence before consumption and again before lazy open.

Use only `~/.cashucard/memory-07297620-2026-11-05/pass-1/memory.json`, with new
0700 directories and 0600 files. A `.consumed` marker, request and uncertain
closure lease belong only to this invocation; existing files refuse re-entry.
Never rewrite/delete them to retry or reuse an older journal. Persist and hash
all execution evidence and confirm native closure before reporting success.

```text
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/memory-07297620.cjs --describe --python /Users/dread/Repos/cashu-card-recovery-v3/tools/cardctl/.venv/bin/python
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/memory-07297620.cjs --campaign <absolute-new-private-campaign.json> --sha256 <actual-sha256>
```

Describe/save/preview perform local reads only and do not consume the attempt.
After recorded approval and refreshed pins, append `--execute` to the exact
preview arguments once. The current false approval rejects execution before
reading a campaign or starting the native child. No reader/key/journal override
or retry switch exists.

## Qualification and terminal boundary

Regressions cover five exact reads, no auth/private/write frame at every native
stage, wrong identity, malformed counters, refusal, storage/transport/closure
failure, changed saved claims and independent public receipt replay. A synthetic
isolated PC/SC process proves request admission and closure without hardware.
Missing-implementation and bounded-format regressions failed before their
implementations; logs are `/private/tmp/memory-07297620-red.log` and
`/private/tmp/memory-07297620-format-red.log`. Full tool and Python logs are
`/private/tmp/memory-07297620-full.log` and
`/private/tmp/memory-07297620-python.log`. These are software checks, not silicon
resource measurements.

All 261 Node tests passed with no skips, including 14 new snapshot cases; all
58 Python policy tests passed, including four new snapshot cases. The existing
optional JavaCard integration used its separate retained local simulator fixture
at `/private/tmp/cashucard-relay-artifact-20261103`, not a new card image.
The separate offline audit passed all 22 `SchnorrHWMathTest` cases. Formatting,
whitespace, protected-source hashes, historical evidence and the pinned verifier
jar were checked. No hardware was accessed by this preparation.

Success is `measured` / `memory-verified`, with raw FF21 and identity receipts,
independently decoded counters, final identity, saved-evidence verification and
confirmed closure. It is not creation, allocation, installation qualification,
capacity certification or a root-cause finding. No largest array/transaction
budget is inferred from availability counters.

Stop after success or failure, retain the journal and report comparison with the
historical snapshot and its limits. No new plan, further connection, constructor
retry, padding change, diagnostic installation, reset or cleanup is authorized
by this result. The original goal remains online-phone relay followed by
independent exact-once till recovery.
