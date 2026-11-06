# Constructor diagnostic ready for a separate execution decision

The source-only continuation produced a new constructor diagnostic, qualified
its exact image and prepared a one-use host/native controller. No card, reader,
phone or production service was accessed during this preparation. The approved
memory-read and earlier inspection journals remain unchanged and consumed.

The [named plan](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.md) requests
one diagnostic installation alongside the existing package/opener on 07297620,
through the ACS reader. Execution approval remains false. It authorizes no
cleanup, retry, payment or automatic successor. The original goal is still
online-phone relay and independent exact-once till recovery; it remains blocked
on physical creation/payment qualification.

## Exact image and meaning of a result

The final artifact was built from signed clean source
`5b301b5df1e31dcf50bf42d1d5e8604541e0ccff`, verified by `git verify-commit`.
JDK 17 and the pinned JavaCard 3.0.5 converter/verifier passed. Converted main
shape is 50 cells / first reference 0 / 50 references. The load is 20,653 bytes
in 84 blocks, in separate namespace `F0434153485543545243`.

- CAP SHA-256:
  `f3cd1dc65e44da93bc7c90c2f7151735610f90599ca2ead5f8d51d03b128e7ba`.
- Load SHA-256:
  `619c41f59e59d31c2d8e5aa46136a2d84ef14c0bf86d945da82b6ad626a94559`.
- Manifest SHA-256:
  `3004dc15805313049c9331249c4a04640155916df88304948dc2d529ac89e41c`.
- Stage map SHA-256:
  `726d0d74a5051c8c43852e0c08b6ffb3200d2669aa94a13706f55897856157ac`.

The new main runs the original ordered constructor statements with stage calls,
catches bounded JavaCard/runtime exceptions and registers a diagnostic instance
even after a caught fault. The only public behavior is `CTRACE`/1 SELECT and a
six-byte read-only status. Selection is safe for partial initialization and no
Shareable interface, setup, signing, key-read, reset or retry command is offered.
All allocation stays inside install. Released sources/CAP/assets, SDK and old
guards are unchanged.

A diagnostic INSTALL acknowledgement is not constructor completion. The result
must classify either completed initialization or a caught exception at a pinned
stage. A mute/VM/superclass/registration failure may still leave no result. The
new image and scalar writes change installation conditions, so even successful
construction does not establish the old image's fit or its earlier failure's
cause. The [design](../../tools/outbox-spike/CONSTRUCTOR-TRACE.md) states these limits.

## Qualification and admission

All 282 Node tests passed without skips, plus 65 Python tests. These include
all 64 injected stage positions, seven exception families, complete construction,
read-only partial-instance reset/reselection, forbidden APDUs, fake SCP02 loading,
full retained/new registries and an isolated synthetic PC/SC process. The 71 JVM
cases are included in the Node suite, not additional hardware runs.

Public intent digests bind the normalized commands without authentication or
C-MAC data. Failed calls retain elapsed time, fixed native failure category and
validated eight-hex PC/SC code, with no invented SW or native exception text.
Regressions failed with those retention changes absent and passed after restore.
Independent replay rejects altered intent digests, registries and constructor
claims. Dirty-source or changed artifact admission fails. No simulator hook or
harness enters converted sources or the CAP.

The plan fixes 100 nominal / 112 maximum APDUs, a 128-command hard ceiling,
120-second gate and 30-second response bound; one proved factory channel only.
Management commands finish before private selection. Full canonical registries
preserve the four platform files, CardDocLite, old package and old opener.
The new namespace is the only load/create target; deletion is never admitted.

Source, SDK, manifest/stage/CAP/load, protected-file and historical-evidence
checks passed. No tracked production CAP was rebuilt or changed. The final
image is under `~/.cashucard/constructor-trace-07297620-2026-11-05/image/`;
simulator fault sources/classes are separate copies alongside it. Private
preparation receipts bind the signed host source and local-only preview without
consuming the future `pass-1/diagnostic.json` invocation. Approval is the
remaining gate before any hardware action.
