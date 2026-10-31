# Private qualification phases

## Current evidence

The [October 31 hardware report](../../docs/reports/HARDWARE_TEST_REPORT_2026-10-31.j3r180-full-capacity-recovery.md)
establishes physical signing, export verification and retirement of the fixed
128-input/128-output packet. The Pixel received a successful SIGN response and
stopped at the 120-second elapsed gate. The approved ACS recovery exported and
verified the committed packet, retired it and returned card 09336320 to blank.

`many-records.cjs` defines the next fixed recipe. The simulator executes it
against the same JavaCard engine. Its phase boundaries and command counts are
offline evidence; physical runtime, interrupted writes and live phase recovery
still require qualification. The recipe currently has no phone or reader
executor. Hardware access requires a new named approved plan.

## Record recipe

The recipe starts with an installed private applet. It uses public synthetic
data from `fixtures/compact-capacity-v1.json`: 46 distinct initial proofs, one
keyset and one input/output per payment. Each canonical packet is 430 bytes and
occupies two of the 90 payload pages. Forty-five records fill the page pool
while 19 header slots remain available.

| Phase | Commands | Checks |
| --- | ---: | --- |
| Prepare fixture | 50 | Set context and keyset, load 46 proofs, check empty record store |
| Capture records 0–14 | 79 | Sign and export 15 records |
| Capture records 15–29 | 79 | Reselect, check state, sign and export 15 more |
| Capture records 30–44 | 79 | Reselect, check state, fill the page pool |
| Refuse and verify full store | 140 | Refuse proof 45 before consumption; compare all 45 scopes and packets |
| Retire, reload and reuse | 13 | Retire record 0, reload proof slot 0 at generation 2, sign record 46, reject the old acknowledgement |
| Verify after reuse | 138 | Compare all 45 current records, including the replacement |
| Retire verified records | 49 | Retire each current scope and confirm reclaimed storage |

Each phase after preparation resets and selects the applet, then checks its
public key and expected status. Captures verify both BIP-340 signatures, exact
canonical bytes and packet identity. Repeated exports must match the retained
scope and packet byte for byte. The replacement has a different packet identity
and generation; the old retirement scope must return `6985` without changing it.

The final status is `[64, 90, 1, 0, 127, 0]`: free headers, free pages, unspent
proofs, spent proofs, empty proof slots and staging state. Proof 45 remains
unspent throughout the refusal/reuse checks. Returning a physical test card to
blank would include separately approved disposal of this synthetic proof and
private-package cleanup.

## Live execution requirements

A live executor must persist admission, per-command intent and received replies,
plus each verified packet, before moving to the next phase. It must bind the
card's CPLC, public key, installation context, image and source fingerprints to
one invocation and preserve earlier phone journals. Each phase keeps the
existing response deadline and 120-second elapsed gate. The counts above provide
a command bound; measured device timings determine whether a phase fits.

An uncertain SIGN requires inspection of the saved intent and committed scope
on the same card. Recovery exports and verifies the existing record before any
retirement. It does not issue another SIGN for that payment. Retirement uses
the exact verified installation, slot, payment ID, generation and packet ID.
The simulator harness executes a command transcript and checks its results
afterward; it cannot serve as this live executor.

## Timing and presentation

The private Pixel controller records the native-call envelope separately from
the persistence envelope. Native time includes the JavaScript/native bridge and
queue. Persistence time includes serialization and the awaited storage callback.
`serializedCodeUnits` measures UTF-16 string length. Stored counters cover
completed saves preceding that snapshot, as marked by the `accounting` field;
the returned state also includes the final completed save.

A successful, exact-length private SIGN reply retains its 45-byte public scope
and native duration before the elapsed gate is checked. That observed scope is
recovery evidence and still requires packet verification. Journal diagnostics
exclude authentication response bodies and arbitrary native error messages.

`lab-journal.js` awaits every storage write. It presents progress once per
running stage and presents every armed/terminal update, preserving the latest
session and export metadata. Rendering is coalesced; durable barriers remain
unchanged. The existing CAP, image pins and timeout values remain unchanged.

## Offline verification

With Node 22, JDK 17 and the cardsim jar built, compile the simulator adapter for
an existing private artifact and run:

```sh
python3 tools/outbox-spike/compile-compact-sim.py /absolute/private-artifact
node tools/outbox-spike/compact-javacard-smoke.cjs /absolute/private-artifact
node --test 'tools/**/*.test.cjs'
```

The simulator suite checks the recipe on the JavaCard engine, including the
capacity refusal, slot reuse and stale acknowledgement. Controller tests check
successful SIGN replies crossing the elapsed gate, separate timing counters,
lagged save accounting and storage-before-presentation behavior.
