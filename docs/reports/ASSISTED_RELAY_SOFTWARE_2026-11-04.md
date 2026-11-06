# Card-carried relay and merchant recovery

## Result

An online phone process settled the exact payment exported by the private
JavaCard simulator while the till process was absent. After mint restart and a
POS process kill, the real Flash POS recovery adapter restored the original
merchant outputs, verified them, unblinded them and credited its inventory once.
Repeated recovery and a phone/till submission race preserved that result.

This is software evidence. No physical card, reader, phone or production system
was accessed. Released firmware, CAP files, provisioner assets, protocol bytes
and enabled app capabilities remain unchanged. The stopped November 3 hardware
recovery remains stopped with no new plan or approval.

| Case            | Keyset ID bytes | Input fee ppk | Input sats | Merchant sats | Packet bytes |
| --------------- | --------------: | ------------: | ---------: | ------------: | -----------: |
| Fee profile     |              33 |           100 |         12 |            11 |          679 |
| Legacy profile  |               8 |             0 |         12 |            12 |          508 |
| Phone/till race |              33 |           100 |         12 |            11 |          679 |

## Components and trust boundaries

- Card: the existing private format-5 compact engine, converted with the pinned
  JavaCard 3.0.5 SDK and run in jCardSim. The harness uses published test scalar
  3; no production firmware source changed.
- Till: Flash POS `test/card-relay-demo`, commit `54a97e5`, based on the merchant
  output-recovery work at `d2e7e25`. The preparation, signature verification,
  queue, mint SDK, output recovery and inventory implementations are the actual
  application code. A synced private file adapter replaces native secure
  storage only in the opt-in integration test.
- Phone: a separate Node process runs the portable `relay.js` engine. Capture
  uses injected simulator reads. The process receives only the public phone
  folder and an explicit loopback origin. A runtime test also executes the
  engine without Node globals; no native phone adapter or UI was tested.
- Mint: newly created Nutshell 0.20.3 FakeWallet containers on a dedicated Docker
  network, published only on loopback. A unique public test seed and independent
  in-container keyset queries establish that the host endpoints belong to this
  campaign. The legacy keyset survives replacement of the seeding instance.
- Transport: the reserved signed mint `https://cashucard-relay.invalid` maps to
  the explicit local endpoint only in the development adapter. No packet URL is
  fetched, no merchant openings are relayed, and the relay has no destructive
  card API.

## Executed boundaries

1. Real POS preparation saves the exact output requests and merchant openings
   before the driver permits SIGN. The POS process exits before signing.
2. The JavaCard engine loads real local-mint synthetic proofs, signs the exact
   POS outputs and publishes its descriptor. Portable capture saves each page,
   verifies both signatures and matches the retained scope.
3. A fresh POS process verifies and durably attaches the witness. It then exits.
4. The phone submits the exact request. The driver deliberately throws away the
   successful swap response. Restore, complete output/DLEQ verification and all
   original input states establish `outputs-confirmed`.
5. The mint restarts. During till recovery the driver kills the POS process with
   SIGKILL immediately after its inventory replacement is synced. A fresh process
   converges on queue completion without another credit. Two simultaneous
   recovery calls and another process replay retain the same inventory.
6. Phone replay revalidates the result and performs zero further swaps.
7. In a fresh case, both phone and till wait immediately before their swap calls,
   after observing unspent inputs. The driver releases both barriers. They
   converge on the same payment; post-restart recovery credits it once.

The helper's `outputs-confirmed` state is distinct from merchant credit. The
till independently recovers its proceeds and records their disposition.

## Validation

- Full host tools: 278 cases, 270 passed, 8 expected external-service skips.
  The run enables loopback sockets. Signing is disabled through process-local
  Git configuration only for disposable repositories created by CI helper
  tests; the deliverable commits are signed.
- Portable relay/transport: 12 cases passed, including the independent candidate
  vector, a runtime without Node globals, tampering/context refusal, page save
  barriers, partial capture resume, failed storage, response loss, incomplete
  evidence, pending states and cached-verdict revalidation.
- JavaCard conversion/verifier and all 15 compact simulator checks passed.
  Simulator HTTP bridge build/tests also passed (54 cases).
- Cardkit: 129 cases and both TypeScript configurations passed. The new
  independently captured-identity regression fails against the old fake.
- Independent Python policies: 4 compact bridge, 10 recovery bridge and 5 phase
  wire cases passed.
- Flash POS: 80 suites / 1,760 tests passed, 2 suites / 15 opt-in tests skipped.
  The opt-in campaign harness ran separately in fresh processes. The full unit
  run uses the repository's public `.env.example`, unsets inherited mint/reward
  overrides, disables transformation caching and uses force-exit for existing
  open test handles. Earlier environment-dependent failures were resolved
  without application-source changes. Typecheck, changed-file ESLint with zero
  warnings, formatting and diff checks passed.
- Regression red/green: the new engine tests fail before its implementation;
  capture-resume fails against the first non-resuming engine and passes after
  its implementation. The independently captured-identity test fails against
  the old fake and passes with the correction.

## Evidence and remaining work

The completed run is `/private/tmp/cashucard-relay-final-4-20261104/verified.json`.
The [public evidence summary](ASSISTED_RELAY_SOFTWARE_2026-11-04.json) records
actual runtime-source hashes, base commits, per-case results and hashes of the
retained private journals and test logs. The simulator artifact is
`/private/tmp/cashucard-relay-artifact-20261103`. Raw synthetic merchant stores
remain only in the private local campaign directories. The final campaign
removed all Docker resources it created. Earlier provisional local runs are
superseded by this endpoint-bound campaign.

The [run guide](../../tools/assisted-relay/README.md) provides the repeatable
command. No branch was pushed and no PR was opened.

Final descriptor/wire/limit and authorization agreement with Foxy remains open.
Native holder-wallet integration, physical timing/interruption qualification,
reviewed settlement-authorized retirement and release integration remain gated.
The relay currently supports the draft's exact sat, date-zero, no-refund,
no-change profile. Top-up and card cleanup are outside this demonstration.
