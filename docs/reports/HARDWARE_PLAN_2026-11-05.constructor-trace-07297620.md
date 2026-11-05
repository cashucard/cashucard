# One catchable-constructor diagnostic on 07297620

- Plan ID `constructor-trace-07297620-v1`; execution approval **false**,
  unconsumed. The operator's **"ok continue"** authorizes this offline
  preparation after the completed memory read, not a new installation.
- Card exactly `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch
  **7515**, exact raw CPLC fixed in `constructor-trace-07297620.json`.
- Reader exactly `ACS ACR122U PICC Interface`; one exclusive connection,
  leave-card disposition, no reset/reconnect/retry. No phone access.
- Proposed end state: the old package/opener remain; the new diagnostic package,
  opener and diagnostic main remain installed if their acknowledgements and
  complete registry are verified. No cleanup is included, even after a fault.

## Question, limits and preserved state

The [memory read](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-memory.md) reports
92,696 persistent and 3,750 volatile bytes. The preceding
[registry inspection](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-registry-inspection.md)
found old package/opener present, main absent and all four platform files intact.
The [offline audit](ANALYSIS_2026-11-05.07297620-main-creation.md) found no increased
constructor array budget or changed field/signer source. The cause remains unknown.

This experiment asks whether the original initialization operations complete,
or throw a catchable API/runtime exception, in a **new instrumented image**.
It preserves original ordered statements and the converted 50-reference field
shape, adding source-bound markers and bounded catches. A caught exception
permits registration of a diagnostic instance with partial initialization;
selection and its sole status read are safe with unset fields.

A GP INSTALL acknowledgement therefore means diagnostic registration, not
constructor completion. The six-byte status must be independently decoded. No
payment, setup, key-read, ownership, retry or reset API is exposed. All original
allocations remain inside installation; the status handler allocates nothing.
The new helper uses primitive static state and adds no transient array.

Instrumentation changes image layout, scalar writes and install-time work;
coexistence also changes available memory and placement. A completed diagnostic
constructor does not prove the original image fits or identify its earlier
failure. A recorded fault localizes only this image's recorded boundary. A mute
card, VM/superclass/registration failure, or failure recording a fault can still
leave no diagnostic. No post-failure opener breadcrumb is accepted as reliable
progress. See the [design and API basis](../../tools/outbox-spike/CONSTRUCTOR-TRACE.md).

This is a separately proposed diagnostic use of the ACS installation path. It
does not resume general installation campaigns or reuse any consumed approval.
It never recreates the old main, modifies its CAP, or changes a platform object.

## Exact image and source

The final artifact was converted from signed clean source
`5b301b5df1e31dcf50bf42d1d5e8604541e0ccff`, with JDK 17 and the pinned
JavaCard 3.0.5 SDK. It is under
`~/.cashucard/constructor-trace-07297620-2026-11-05/image/`.

| Binding                      | Value                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| New package                  | `F0434153485543545243`                                             |
| New opener / diagnostic main | package + `4D` / `01`                                              |
| Manifest SHA-256             | `3004dc15805313049c9331249c4a04640155916df88304948dc2d529ac89e41c` |
| CAP SHA-256                  | `f3cd1dc65e44da93bc7c90c2f7151735610f90599ca2ead5f8d51d03b128e7ba` |
| Load SHA-256                 | `619c41f59e59d31c2d8e5aa46136a2d84ef14c0bf86d945da82b6ad626a94559` |
| Load bytes / short blocks    | 20,653 / 84                                                        |
| Stage-map SHA-256            | `726d0d74a5051c8c43852e0c08b6ffb3200d2669aa94a13706f55897856157ac` |
| Stage count / terminal stage | 64 / 48 (`schnorrHW.init();`)                                      |
| Converted class shape        | 50 cells, first reference 0, 50 references                         |
| SELECT data                  | `43545241434501` (`CTRACE`/1)                                      |
| Only private read            | `B07D000000`, exactly six bytes                                    |

Dirty-source development artifacts, swapped images, changed generated sources,
CAP/load/stage bytes or profile fields are refused. No production CAP/assets
were rebuilt. Host-only simulator fault hooks and harnesses are absent from
converted sources/CAP; the compiled simulator copies remain separate.

## One connection and fixed commands

| Stage                | Allowed work                                                                                                 | Nominal / maximum APDUs |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------: |
| Identity             | SELECT ISD, CPLC; exact raw and parsed match                                                                 |                   2 / 2 |
| Factory channel      | SELECT ISD, one version-1 INITIALIZE UPDATE, prove public factory cryptogram, then one EXTERNAL AUTHENTICATE |                   3 / 3 |
| Initial registries   | Complete applications/load-files, require the exact retained state                                           |                   2 / 8 |
| Diagnostic load      | INSTALL for load for the new package only; exact 84 pinned LOAD blocks                                       |                 85 / 85 |
| Diagnostic creation  | New opener, then new diagnostic main, once each, zero privileges and fixed parameters                        |                   2 / 2 |
| Installed registries | Complete applications/load-files with exactly the expected added diagnostic objects                          |                   2 / 8 |
| Diagnostic read      | Full new main SELECT, then one `B07D000000`; decode bounded result                                           |                   2 / 2 |
| Final identity       | SELECT ISD, CPLC; exact match, then close                                                                    |                   2 / 2 |
| Total                | No other command classes                                                                                     |               100 / 112 |

The hard ceiling is **128 commands**, with the unchanged **120-second**
transmission gate and **30-second** response wait shortened by remaining budget.
Recheck before native startup and every send. Use only public factory `40`–`4F`
keys at version 1, with one proof and one authentication. No key alternative,
second channel, retry or raised deadline is allowed.

Keep the ISD selected through all management work: no opener selection/read
occurs between the two creations. Only after both complete registries verify
may the new main be selected. This avoids invalidating the one secure channel.
Every secured APDU is prebuilt and matched exactly in the host; the independent
native policy matches its public body, order and bounds against the pinned load.

Both registry kinds are complete within four pages each. Compare full canonical
E3 frames, all fields, without filtering any package. Initial applications must
contain exactly old opener `F04341534855434D50544D`; old main must be absent.
Load files must be exactly old package `F04341534855434D5054` plus the original
four platform frames, including CardDocLite. Installed state adds exactly the
new package and two new instances. Unknown, missing, duplicated or changed
objects stop. No DELETE is ever admitted.

Persist public command intent before transmission and each public reply before
continuing. Intent digests bind plaintext commands, excluding C-MACs. No
challenge, authentication body/digest, raw MAC, key, PIN or native exception
text is journaled. Preserve failed-call elapsed time, fixed transport category
and only validated eight-hex PC/SC code where provided. A lost reply is never
reported as a card status. Any refused/late/uncertain response stops immediately,
including at LOAD or creation, with no automatic registry/read/cleanup follow-up.

Management success requires `9000` with empty body or `00` only. Diagnostic
SELECT must match exactly. The status must be either constructor-complete at
manifest terminal stage 48 with zero error, or caught-constructor-fault at a
valid source-bound stage with a bounded family/public reason. Fresh/in-progress,
unknown or inconsistent diagnostic values stop. No constructor phase is retried.

## Admission, one-use journal and checks

The fixed controller is `constructor-diagnostic-07297620.cjs`, with its own
profile, `constructor-diagnostic-transport.cjs` and independent
`constructor_diagnostic_07297620.py`. No older guard, dispatcher, baseline,
profile, consumed journal or phone app changes. The
[audit](HARDWARE_PLAN_2026-11-05.constructor-trace-07297620.audit.json) pins the
protected sources, prior evidence and exact new artifact. Independent native
request approval, source/runtime/artifact/marker validation all precede PC/SC
import/enumeration. Saved public receipt replay is hardware-free and binds the
plain command intent digests, load program, full registries and decoded result.

After explicit execution approval, record only the new plan/profile/audit
approval state, rerun affected checks and sign clean source. Pin actual Node,
Python, SDK, crypto, pyscard, entry points and artifact files in a new private
campaign. Revalidate admission after durable consumption before lazy opening.
Preserve the initial unapproved preview and create a new approved preview.

Use only
`~/.cashucard/constructor-trace-07297620-2026-11-05/pass-1/diagnostic.json`, new
0700 directories and 0600 files, with its distinct consumed marker/request and
uncertain-closure lease. Existing files refuse another invocation. No file is
removed or rewritten to rearm. Uncertain closure retains the lease.

```text
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/constructor-diagnostic-07297620.cjs --describe --python /Users/dread/Repos/cashu-card-recovery-v3/tools/cardctl/.venv/bin/python
/opt/homebrew/opt/node@22/bin/node tools/outbox-spike/constructor-diagnostic-07297620.cjs --campaign <absolute-new-private-campaign.json> --sha256 <actual-sha256>
```

Describe/save/preview are local-only and do not consume the attempt. After
approval and refreshed pins, execute the exact preview arguments once with
`--execute`. False approval rejects before campaign access/native startup.
There is no reader, image, package, key, journal or retry override.

Missing-implementation and command-intent regressions failed before the new
behavior. Generation checks preserve original ordered statements and field
shape, with no APDU allocation. The converter/verifier passes; 71 simulator
cases cover all stage positions, seven fault families and retained partial
reads. Host fake-SCP02 and independent native-process tests cover complete/fault
outcomes, exact loading, full old/new registries, wrong card/key/image, malformed
reports, refused frames, persistence/transport/closure failure and forged saved
claims. A PC/SC error test retains bounded code and timing without raw text/SW.
These checks establish software behavior, never silicon fit or rollback behavior.

Final local qualification passed **282 Node tests with no skips** and **65
Python cases**, including 18 host/native diagnostic cases and four independent
native-policy cases. The Node suite includes the 71-case JVM diagnostic run
using the final artifact's separate simulator copies, plus the existing optional
JavaCard integration with its own retained fixture. Formatting, whitespace,
signed image-source verification, protected sources and historical evidence
hashes passed. Full logs: `/private/tmp/constructor-diagnostic-full.log` and
`/private/tmp/constructor-diagnostic-python.log`. The transport-code and
failed-duration regressions were also run with each retention change omitted:
both failed, then passed with the changes restored. Red logs:
`/private/tmp/constructor-diagnostic-pcsc-red.log`,
`/private/tmp/constructor-diagnostic-elapsed-red.log` and
`/private/tmp/constructor-diagnostic-intent-red.log`.

## Terminal boundary

Success is `diagnostic-recorded` / `diagnostic-verified` with classified
`constructorResult`, complete installed registry, final identity, independent
saved replay and confirmed closure. It is not a Cashu installation, creation
qualification or payment result. Preserve and report exact software/runtime,
result, command count, public evidence and exclusions.

Stop after success or failure. No cleanup, old/new main recreation, second
image, reset, extra connection, new plan or payment is authorized by this result.
The original acceptance condition remains online-phone relay and independent
exact-once till recovery; the diagnostic is only a step toward resolving its
current hardware blocker.
