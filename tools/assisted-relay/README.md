# Relay a card payment through an online phone

This experimental software demonstration connects the private JavaCard outbox,
a portable relay engine and Flash POS's real merchant recovery adapter. The till
saves its private recovery material before signing. A separate phone process
receives only the card's public signed packet, settles that exact payment at a
local FakeWallet mint, and verifies the original outputs. The till subsequently
recovers and credits its proceeds once.

The existing candidate packet and private simulator commands remain unchanged.
This is implementation and conformance evidence for the draft in
[cashucard/nut#6](https://github.com/cashucard/nut/pull/6). Released firmware and
applications do not enable this feature. The demonstration neither opens a
reader nor accesses a phone, card or production service.

## Run the demonstration

Use Node 22, JDK 17, Maven, Ant, Docker and the pinned JavaCard 3.0.5 SDK. Start
from isolated checkouts. Flash POS needs the merchant durability/output-recovery
changes (#96/#97) and this campaign's `cardRelayDemo.test.ts` integration harness
(commit `54a97e5` on `test/card-relay-demo`). Install its locked dependencies.

From this repository, build cardkit and the simulator:

```sh
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:$PATH"
(cd tools/cardkit && yarn install --frozen-lockfile && yarn build)
mvn -B -f tools/cardsim/pom.xml package
python3 tools/outbox-spike/build-compact.py /tmp/relay-compact-artifact
python3 tools/outbox-spike/compile-compact-sim.py /tmp/relay-compact-artifact
node tools/assisted-relay/run-local.cjs \
  --pos /absolute/path/to/flash-pos \
  --artifact /tmp/relay-compact-artifact \
  --output /tmp/new-relay-campaign
```

Artifact and output paths must be new. The runner creates uniquely named,
dedicated Docker services, published only on randomly assigned loopback ports.
It uses Nutshell 0.20.3 and a public, per-campaign test seed. Host keyset responses
must match a separate query inside each newly created container.
The legacy profile is seeded with `VERSION=0.19.2`, then reopened as 0.20.3 on
the same named volume with `CASHU_DIR=/app/data`. The driver checks that the
8-byte keyset survives that replacement.

The signed logical mint is the reserved name
`https://cashucard-relay.invalid`. A development-only adapter maps that exact
test context to the runner's loopback service. It never resolves or fetches the
packet's URL. This explicit mapping is a simulation arrangement, not a
production mint identity or routing contract.

The campaign performs:

1. A payment with a 33-byte keyset and 100-ppk input fees. Two inputs totalling
   12 sats yield 11 merchant sats.
2. The same flow with an 8-byte keyset and zero input fees, yielding 12 sats.
3. A fresh payment where the phone and till both observe unspent inputs and
   wait at a barrier before concurrently submitting the same signed swap.

Each normal flow discards the successful swap response, restarts the mint,
kills the POS process immediately after its synced inventory write, then starts
fresh POS processes for queue completion and repeated recovery. Phone replay
must perform zero additional swaps. The race checks convergence after mint
restart. The phone process receives no merchant folder argument, and the
driver verifies that its journal contains none of the merchant openings.

`verified.json` contains public result summaries and source hashes. Per-case
directories retain the phone's public journal and the till's synthetic private
store, process logs and result files. These use private directories/files. The
runner removes only its own Docker containers, volumes and network, including
on failure; filesystem evidence remains. No manager keys or hardware journals
are involved.

## Portable engine

`relay.js` imports no Node, HTTP, storage or NFC APIs. Its runtime test supplies
no Node globals. Callers inject:

- `crypto.hash(bytes)`: SHA-256 bytes; `crypto.verify(signature, message, key)`:
  BIP-340 verification against the compressed card key; `crypto.point(bytes)`:
  compressed secp256k1 point validation.
- `crypto.proofY(secret)`: compressed Cashu hash-to-curve point, as hex;
  `crypto.dleq(output, signature, amountKey)`: blinded DLEQ verification.
- An approved mint `request(route, body)` implementation, bounded in size/time
  and bound to the caller's configured mint. Packet text never grants network
  authority or supplies credentials.
- `save(snapshot)`: awaited durable storage, held under a single-writer lease.
  The Node demonstration uses the existing synced file-journal adapter.

`decodePacket(bytes, policy, crypto)` verifies the complete candidate envelope,
both signatures, packet identity and the expected mint/card/installation.
The private profile bounds packets to 32 KiB and 128 inputs/outputs; these are
prototype limits. Format-4, date-zero, no-refund, exact sat payments are supported.

`capturePacket({policy, crypto, readScope, readPage, save, journal?})` saves each
read intent and received page before another page. The caller supplies an
owner-authorized transport bound to the expected card. Reusing a partial capture
requires the same retained scope; complete packet signatures and a final scope
read must agree before the state becomes `captured`. Network work follows after
the NFC session closes.

`reconcilePayment({journal, policy, crypto, request, save})` revalidates the
packet, original outputs, input states, amount keys and current fee profile.
It submits at most one exact swap per invocation, after saving its intent.
An unknown response leads to restore and state reconciliation. Complete original
output coverage and valid DLEQ plus all inputs spent permit `outputs-confirmed`.
Pending, partial, inconsistent or invalid observations retain unresolved work.
Even an earlier `outputs-confirmed` claim is reverified on restart.

This helper result establishes recoverable original output issuance. The till
independently unblinds, stores and accounts for its proceeds. Its ledger prevents
recovery from re-crediting already paid or previously recovered outputs. There
is no card retirement, clearing, loading, top-up or deletion API in this engine.

## Verification and remaining gates

```sh
node --test tools/assisted-relay/*.test.cjs
node --test 'tools/**/*.test.cjs'
```

The tests cover independent packet vectors, tampering/context refusal, durable
capture/resume, save failures, lost responses, malformed output evidence,
pending input states, cached-verdict revalidation and loopback-only transport.
The process campaign adds actual POS SDK/accounting and restarted HTTP mints.

Partner agreement on the final descriptor, authorization, limits, compatibility
and wire remains necessary. Holder-wallet screens, native crypto/NFC/storage
adapters and release integration remain separate work. Native phone latency,
physical interruption coverage and the stopped card's recovery require named
operator decisions. The stopped recovery has no new authorization from this
software campaign. Current fee/keyset changes may conservatively block a relay;
authentication-protected mints, dated/refund proofs and change are outside this
initial profile.
