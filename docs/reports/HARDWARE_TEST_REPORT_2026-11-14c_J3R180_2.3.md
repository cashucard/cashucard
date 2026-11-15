# Protocol 2.3 with D206 on a J3R180: the tracked file's chip run (2026-11-14, third run)

The tracked 2.3 CAP, with [D206](../DECISIONS.md#d206) (`LOAD_PROOF`'s 04 form: each piece's C sent whole,
`04` ‖ x ‖ y, and held to the curve by the chip's key agreement in place of the card's square-root test), installed
on the bench J3R180 of the second run at the first try, five times. On each of four fresh set-ups made as the app
makes one, 45 real pieces minted at a FakeWallet test mint (fake sats) were loaded in one selection, as a first load
does, in the 04 form and in the 33-byte form, with and without the keyset's keys taught in the same selection, and
every step was timed. Pieces loaded either way were paid with real signatures under the card's date keys, the change
was written back with `LOAD_CHANGE` with no PIN and spent again, and each swap was taken by the mint. Points that are
not the curve's were refused in the 04 form with nothing stored. The run's paragraph is in
[`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist); the second run of the day, on the
file before D206, is [its own report](HARDWARE_TEST_REPORT_2026-11-14b_J3R180_2.3.md), and the study that showed what
the chip's key agreement checks is in D206.

## The first load of 45 pieces (one selection, the mint's proof kept with each piece)

| Step | 04 form, keys taught | 04 form, keys not taught | 33-byte form, keys taught | 33-byte form, keys not taught |
| --- | ---: | ---: | ---: | ---: |
| `SELECT` | 22.2 ms | 22.0 ms | 22.1 ms | 22.0 ms |
| `GET_INFO` (the read) | 42.1 ms | 42.0 ms | 42.2 ms | 42.0 ms |
| `AUTH` | 631.8 ms | 626.0 ms | 631.9 ms | 626.0 ms |
| `GET_NONCE` P1 1 (the PIN key) | 43.9 ms | 43.8 ms | 44.4 ms | 44.5 ms |
| `VERIFY_PIN` sealed (P1 01) | 271.6 ms | 271.5 ms | 272.0 ms | 277.7 ms |
| `GROUP_KEYS` (date 0) | 99.2 ms | 99.6 ms | 99.6 ms | 100.4 ms |
| `LOAD_PROOF` #1 | 153.3 ms | 154.2 ms | 233.7 ms | 234.6 ms |
| `KEYSET_KEYS` (32 keys, 8 commands) | 1,314.9 ms | | 1,316.9 ms | |
| `LOAD_PROOF` #2 to #45 | 6,706.1 ms | 6,732.1 ms | 10,252.0 ms | 10,247.1 ms |
| `GET_INFO` (the final read) | 42.4 ms | 42.4 ms | 43.1 ms | 42.9 ms |
| `GET_BALANCE` | 68.6 ms | 68.6 ms | 69.0 ms | 69.1 ms |
| **The whole contact** | **9.50 s** | **8.22 s** | **13.14 s** | **11.82 s** |
| All 45 `LOAD_PROOF`s | 6.86 s | 6.89 s | 10.49 s | 10.48 s |
| One `LOAD_PROOF` (min / median / max) | 145.6 / 152.8 / 159.1 ms | 146.4 / 153.1 / 159.6 ms | 226.2 / 233.0 / 239.5 ms | 226.3 / 233.1 / 239.5 ms |

The whole contact is from `SELECT`'s send to the last answer. Each column is a fresh install and a fresh set-up. The
keys are taught after the first piece: the card has no entry in its keyset table for a keyset before a piece of it is
on the card, and `KEYSET_KEYS` answers `6A88` for a keyset in no entry, so a set-up cannot teach the mint's keys before
the first load. Every load answered its place and `01` (the proof kept); after each run the balance was the 2,555 sats
minted and the card held 45 unspent pieces in places 0 to 44.

One piece in each form on the same card, alternately, places 50 to 61 (the scan for a free place and for the nonce
grows with the places in use): the 04 form 161.3 to 164.4 ms (mean 162.7, six pieces), the 33-byte form 240.6 to
246.9 ms (mean 242.7, six pieces).

## Environment

- Card: NXP J3R180 (JCOP4), CPLC serial **09301220** (checked by the install script before it sent
  anything, at every install), the public default GlobalPlatform test key, SCP02.
- Reader: ACS ACR39U, contact. Times are the reader's round trip, measured by the driver (pyscard).
- Mint: `testnut.cashu.space`, FakeWallet (no real money); the `sat` keyset `017bc604…`, input fee 100 ppk.
- Block header: the real mainnet header of block 975,859 (from mempool.space), each set-up's anchor.
- Owner: cardctl's TEST key; a made-up owner seed; a made-up refund key; the PIN 1234.
- Pieces: 45 a run, 1, 2, 4, …, 256 sats five times over (2,555 sats), undated, locked to the card's key for date 0
  (P + t·G, worked out from the card's c as the owner's phone works it out), each mint's proof checked (blind and unblinded).

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) |
| --- | --- | --- |
| the tracked CAP, `applet/target/cashu-javacard-2.3.0.cap` | `55614a2f29e4f5dabc1df1a8926fbfef39ceb715ec782aa5c8f8961546b82b58` | 37,269 bytes, sha256 `fe156f4f505ccaecefe16aaeee4e270a76909d6373bf78cfd2ff9fd6c28a97e6` |

## Results

| Item | Result |
| --- | --- |
| Install | Five times, each in three steps: load 16 to 17 s, the card's applet 2 to 3 s, **created at the first try every time** (never `6F00`); `SELECT` `02 03`, the tag `getfoxy.io/card` |
| Set-up | `cardctl setup` four times (PIN, record with the refund key, the owner claimed with the owner's c, the anchor); c read back and checked against `GROUP_KEYS` |
| The first load, both forms | the table above |
| One piece in each form | the 04 form 146 to 164 ms, the 33-byte form 226 to 247 ms, the proof kept |
| Real signatures | pieces loaded in the 04 form paid at the first `SPEND_ALL_SIGN` (no "not yet", 815 to 841 ms, 1.07 to 4.23 s from `SPEND_ALL_BEGIN`), good under P + t·G and not under P; testnut's swap `200`, the inputs `SPENT`; pieces loaded in the 33-byte form the same (854 ms) |
| Real change | a payment of 100 from a 256-sat piece loaded in the 04 form: five change outputs, written back by `LOAD_CHANGE` in a new tap with no PIN, each `UNSPENT` at testnut and its proof checked by testnut's key; two of them spent again in a swap testnut took (`SPENT`) |
| Refusals, the 04 form | `6A80` with nothing stored for: an x on no point, G with y + 1, G's x with a wrong y, x = p, y = p, x = p + 1 (the point of x = 1 wrapped), `04` and 64 zeros, P-256's generator, G with prefix `03`, G with prefix `06` (71 to 84 ms each); `6700` for 112 bytes and a proof, a 33-byte C with P2 `0A`, and a 66-byte C; the unspent count and the balance as before |
| `selftest` | 21 of 21 (`AUTH` and BIP-340 ten rounds, with the PIN) |
| Left | installed again from the same file: fresh (no PIN, no owner, no record) |

## Not run

The day of loads, dated pieces in the 04 form, the set-up's test of the agreement failing (a J3R180's agreement holds to
the curve; the applet's tests cover both outcomes with an agreement that takes every point and one that refuses every
point), `LOCK_CARD`, tears, the certificate, a dollar card, a phone and a production mint.

## Logs

a scratch folder on the bench machine: `install-1.log`, `install-B.log`, `install-C.log`,
`install-D.log`, `install-final-fresh.log`, `run{A,B,C,D}-setup.log`, `run{A,B,C,D}-mint.log`,
`run{A,B,C,D}-firstload.log` and `run*-pieces-*-timing.json`, `runA-alt-and-refusals.log`, `runA-selftest.log`,
`money-*.log`, `chip-bridge-*.log`.
