# Fresh diagnostic invocation after the zero-command host stop

- Plan ID `constructor-trace-07297620-v2`; execution approval **false**;
  unconsumed. This is a concrete successor proposal for operator review, not
  automatic retry authority from the failed first invocation.
- Exact card `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**;
  exact reader `ACS ACR122U PICC Interface`, one exclusive leave-card connection.
- The [first attempt](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-constructor-host-stop.md)
  consumed its journal but sent zero commands and never started a native bridge.
  Its files stay intact. No installation or card fault was observed.

## Same physical scope, corrected host hashing

The only behavior correction is converting the load to a byte buffer before
calling the default SHA-256 function. Regression tests cover the actual default
path; real-artifact synthetic native-process cases no longer inject a substitute
hash. The original exact CAP/load/stages and all card-side work remain unchanged.

The [original fully specified scope](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.md)
and [diagnostic design](../../tools/outbox-spike/CONSTRUCTOR-TRACE.md) apply to this
new invocation, with **v2's approval and paths only**. In particular:

- Keep the old private compact package/opener and all four platform frames,
  including CardDocLite, unchanged; require old main absent in the complete
  initial applications registry. Unknown or changed objects stop before writes.
- Add only new diagnostic package `F0434153485543545243`, opener `...4D` and
  diagnostic main `...01`, zero privileges and fixed parameters. No tag creation.
- One proved version-1 channel using public factory `40`–`4F` keys. No alternate
  key, second channel, reconnect, reset or command retry.
- Exact 84 LOAD blocks, then new opener/main creation, complete installed
  registries, exact diagnostic SELECT/status and final exact CPLC.
- No deletion/cleanup, key change, SETUP, key read, proof, signing, payment,
  funding, export, retirement, phone or production access.
- Stop immediately on any failed, late, uncertain or unsaved reply. No automatic
  post-failure registry/diagnostic/cleanup connection. Preserve any new objects
  that may exist; an unconfirmed INSTALL is inconclusive.

| Stage                                                | Nominal / maximum APDUs |
| ---------------------------------------------------- | ----------------------: |
| Initial identity                                     |                   2 / 2 |
| One proved factory channel                           |                   3 / 3 |
| Complete initial registries                          |                   2 / 8 |
| INSTALL for load plus 84 blocks                      |                 85 / 85 |
| New opener and diagnostic main creation              |                   2 / 2 |
| Complete installed registries                        |                   2 / 8 |
| Exact diagnostic SELECT and one six-byte status read |                   2 / 2 |
| Final identity and closure                           |                   2 / 2 |
| Total                                                |               100 / 112 |

Keep the 128-command ceiling, 120-second transmission gate and 30-second response
bound shortened by remaining budget. Finish all management work on the ISD before
selecting the diagnostic. Every host secured APDU is matched to its prebuilt
bytes; native policy independently matches fixed public bodies/order. Public
intent digests exclude C-MACs, and authentication bodies/digests are never saved.
Retain failed-call time and only fixed native category/validated eight-hex PC/SC
code. No raw exception text or invented card SW.

## Unchanged image and result meaning

- Image source `5b301b5df1e31dcf50bf42d1d5e8604541e0ccff`, signed clean build.
- Manifest SHA-256 `3004dc15805313049c9331249c4a04640155916df88304948dc2d529ac89e41c`.
- CAP SHA-256 `f3cd1dc65e44da93bc7c90c2f7151735610f90599ca2ead5f8d51d03b128e7ba`.
- Load SHA-256 `619c41f59e59d31c2d8e5aa46136a2d84ef14c0bf86d945da82b6ad626a94559`,
  20,653 bytes / 84 blocks.
- Stage-map SHA-256 `726d0d74a5051c8c43852e0c08b6ffb3200d2669aa94a13706f55897856157ac`,
  64 stages, terminal stage 48.

A confirmed diagnostic registration may contain a caught constructor fault; it
is not constructor completion or a Cashu installation. Accept only a valid
source-bound caught-fault result or completion at stage 48. The partial instance
has safe read-only selection/status and no Shareable/payment interface.
All allocations remain at install time. A mute/VM/superclass/registration error
may still produce no usable diagnostic. Changed code layout/writes/memory mean
neither outcome establishes the old image's failure cause or silicon fit.

## Fixed successor, admission and evidence

The dedicated v2 profile, `constructor-diagnostic-07297620-v2.cjs`,
`constructor-diagnostic-v2-transport.cjs` and
`constructor_diagnostic_07297620_v2.py` have fixed labels and paths. All device,
image and registry fields must equal v1; only plan ID, approval and audit digest
may differ. Unknown plan labels are refused before transmit. The original
launcher still targets its permanently consumed `pass-1` journal.

The [new audit](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.audit.json)
pins all historical evidence, the first zero-command journal/review and the
unchanged artifact/protected sources. Require explicit v2 approval, affected
checks, signed clean source, a fresh private campaign with actual runtime/SDK/
crypto/pyscard/artifact pins, local preview and revalidation after consumption
before lazy native open. Request approval, file pins and marker pass before
PC/SC import/enumeration. Saved public evidence is independently replayed.

Only new journal
`~/.cashucard/constructor-trace-07297620-2026-11-05/pass-2/diagnostic.json`, in new
0700 directories with 0600 files and its own consumed marker/request/closure
lease, is admitted. Do not move, truncate, edit or remove any earlier evidence.
No journal, reader, key, package, artifact or retry override exists.

```text
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/constructor-diagnostic-07297620-v2.cjs --describe --python /Users/dread/Repos/cashu-card-recovery-v3/tools/cardctl/.venv/bin/python
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/constructor-diagnostic-07297620-v2.cjs --campaign <absolute-new-private-campaign.json> --sha256 <actual-sha256>
```

Describe/save/preview are local-only and do not consume the attempt. False v2
approval blocks execution. After recorded approval and refreshed signed pins,
append `--execute` to the same approved preview arguments once. Preserve the
unapproved preparation and create new approved receipts.

Qualification covers default hashing of real load bytes, the v2 label, distinct
journal/entry/transport, unchanged image/body constraints, the isolated v2 native
process and decoder, caught faults, intent/report tampering, missing replies,
native PC/SC evidence, closure and unknown labels. New regressions failed before
implementation. No physical device was used. The previous full suite and JVM
stage/fault coverage remain; fresh full results/logs are recorded with this plan.

Final qualification passed **291 Node tests with no skips** and **65 Python
tests**, including the 71-case JVM diagnostic run and five isolated v2 process
cases. The actual retained image now uses the controller's real default hash in
those process cases. Default-hash and v2-label regressions failed before their
changes. Protected-source/history hashes, formatting, whitespace and local links
passed. Logs: `/private/tmp/constructor-diagnostic-default-hash-red.log`,
`/private/tmp/constructor-diagnostic-v2-red.log`,
`/private/tmp/constructor-diagnostic-v2-full.log` and
`/private/tmp/constructor-diagnostic-v2-python.log`.

## Stop after this invocation

Require complete registries, classified result, final identity, independent saved
replay and confirmed closure before `diagnostic-recorded` / `diagnostic-verified`.
Retain new objects and journal on success or failure. Report actual source/image,
result, commands, closure and exclusions. Do not use INSTALL success alone as
initialization or payment qualification.

No cleanup, second image, retry, new plan, extra connection or payment follows
without a new operator decision. The original acceptance condition remains
online-phone relay and independent exact-once till recovery.
