# Private optimized signing recovery

The [optimized Pixel run](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-optimized-sign-stop.md)
lost its signing reply after complete synthetic staging. The card and journal
were retained at that stop. Its completed hardware plan excluded cleanup.
The separately approved recovery has since established unpublished staging,
completed conditional private cleanup and verified the original blank baseline;
see the report's recovery follow-up. Both plans are consumed.

`recover-compact.cjs` prepares a closed host flow for the same private image and
fixed 128-input/128-output fixture on 09336320. Importing it opens no device.
An operator-specific launcher must pin the stopped journal, expected public key,
image, runtime and approved plan before opening the named ACS reader.

## Sequence and outcomes

Match CPLC, prove factory-version-1 keys before external authentication and
require exactly the original platform baseline plus private main/opener/package.
Then SELECT the private applet once. This invokes recovery: unpublished staging
can be released, and committed burn bookkeeping can complete. Record this as a
recovery action, with durable intent before the command.

Require CPROT/2, format-5 allocation diagnostics and the saved installation key.
Read status and scope once. Only these branches proceed:

| Observed state | Required evidence and permitted continuation |
| --- | --- |
| 128 unspent proofs, 64 free headers, 90 free pages, empty scope (`6985`) | Save evidence that unpublished staging was released. The fixed synthetic inputs can be discarded through approved private-only cleanup. |
| 128 spent proofs, one committed 45-page record and exact scope 0 / ID 1 / generation 1 | Persist all 91 export pages, reconstruct all 23,163 canonical bytes, verify both signatures in Node and independent Python, and durably save the verified evidence. Retire that exact scope once and require the fully free state. |

After either established branch, match CPLC again, prove one fresh factory
channel, require the exact baseline/private registry, delete private main,
opener and package in order, and verify the original blank baseline. Keep every
registry snapshot, including the pre-delete scan. Any failure stops subsequent
commands; an uncertain retirement or deletion gets no retry.

## Independent reader policy

`compact_recovery_bridge.py` admits only ISD/private selection, CPLC, the fixed
diagnostic/public-key/status/scope reads, exact export pages, one scope-bound
retirement and factory registry/private deletion frames. The protected launcher pins the saved installation public key. The physical
entry accepts a compressed public key from that launcher; its historical default
remains the original optimized attempt's key. It requires every complete page before
retirement and the confirmed free state before deletion; the host adds exact
canonical verification and durable save barriers. SIGN, setup, loading,
installation, key changes and production AIDs are refused.

The host ceiling is 160 commands, with the existing 120-second gate on further
transmissions and 30-second per-response reader bound. Outgoing frames fit 261
bytes, replies fit 258 bytes, and public page evidence is bounded. Authentication
data and raw native messages are excluded from journals. Reader close failures
are reported; the original startup failure is retained if teardown also fails.

## Offline checks

```sh
node --test tools/outbox-spike/recover-compact.test.cjs tools/outbox-spike/recovery-bridge.test.cjs
python3 tools/outbox-spike/test_compact_recovery_bridge.py
```

Tests use the public factory/spike keys and a published BIP-340 test scalar.
They exercise both recovery branches against real SCP02 fake-card computation,
cross-check its complete exchange stream with the independent Python policy,
verify signatures with the separate Python verifier and reject damaged evidence.
Failure cases include wrong chip/key/version/registry/state, missing pages,
failed persistence, independent verification failure, stale scope, deadline and
lost retirement. These commands import no PC/SC library or access hardware.

A named approved plan is required before physical execution. The legacy ACS
installation stop remains in effect. Recovery supplies evidence about the
existing attempt and cannot establish a successful uninterrupted phone signing
or full-run latency result.


## Streamed image profile

The host accepts two closed image names: `optimized` (the historical default)
and `streamed`. The latter selects only `pixel-streamed.json`, with the same
fixed workload and recovery-state predicates. An unknown profile stops before
an APDU. The bridge accepts `--expected-key` for the new attempt's saved public
key; malformed keys are refused before importing PC/SC. The Node bridge
wrapper excludes that argument from other profiles. No private signing or
manager key is accepted.

A streamed-image launcher must bind this public key to the exact phone journal,
reviewed source, image/load/manifest hashes, CPLC, fixture and consumed run. Its
approved plan must name the conditional recovery actions before reader access.
Both branches retain complete export/canonical/signature/durable-save barriers
and the original one-SELECT, one-RETIRE, private-delete and timing/command bounds.
This lets the next named plan cover recovery of its own interrupted signing
attempt while preserving earlier plans and journals.
