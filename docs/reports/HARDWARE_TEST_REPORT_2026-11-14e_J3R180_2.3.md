# Protocol 2.3 with D211 to D214 on a J3R180: the tracked file's chip run (2026-11-14, fifth run)

> Note added at the 3.0 merge (2026-11-19): decision numbers here are from before the 3.0 merge. D205 to D215 are now D211 to D221 (D205 to D210 now name the other maintainer's 3.0 decisions, and the links below land on those). The record itself is unchanged.

The tracked 2.3 CAP, with [D211](../DECISIONS.md#d211) (the signature's product made in two shares, so that no operand of the chip's RSA
is a function of the card's key alone), [D212](../DECISIONS.md#d212) (every signature checked on the card against the key before it
leaves, a failing chip path given up and redone by the bytecode), [D213](../DECISIONS.md#d213) (the set-up's known answers made wider:
eight distinct squarings at full width, the field's at the top of its range, and six points off the curve for the key agreement) and
[D214](../DECISIONS.md#d214) (a taught keyset kept by the reclaim until its first piece; a teaching's entry made at its end), added to the
file of the [fourth run](HARDWARE_TEST_REPORT_2026-11-14d_J3R180_2.3.md), installed on the bench J3R180 of the earlier runs at the first
try every time. The card was set up as the app sets one up, the keyset taught at set-up, 45 real pieces minted at a FakeWallet test mint
(fake sats) were loaded in one selection with no teaching in it, and every step was timed. Real signatures were verified under BIP-340 and
taken by the mint, the change was written back with `LOAD_CHANGE` with no PIN, points that are not the curve's were refused with nothing
stored, and the holds were timed again: **every signature now costs 0.27 s more, and the holds are twice the seconds they were**.

## The first load of 45 pieces (one selection, the mint's proof kept, the 04 form, no teaching in the selection)

| Step | This file | The file before (D207 to D210) |
| --- | ---: | ---: |
| `SELECT` | 22.1 ms | 22.1 ms |
| `GET_INFO` (the read) | 42.3 ms | 42.1 ms |
| `AUTH` | 531.7 ms | 263.9 ms |
| `GET_NONCE` P1 1 (the PIN key) | 45.2 ms | 45.0 ms |
| `VERIFY_PIN` sealed (P1 01) | 144.4 ms | 144.3 ms |
| `GROUP_KEYS` (date 0) | 99.9 ms | 100.1 ms |
| `LOAD_PROOF` #1 | 150.5 ms | 155.0 ms |
| `LOAD_PROOF` #2 to #45 | 6,770.3 ms | 6,753.4 ms |
| `GET_INFO` (the final read) | 43.0 ms | 43.0 ms |
| `GET_BALANCE` | 68.9 ms | 69.4 ms |
| **The whole contact** | **8.03 s** | **7.75 s** |
| One `LOAD_PROOF` (min / median / max) | 146.2 / 153.3 / 163.4 ms | 146.0 / 153.8 / 163.4 ms |

The keyset (32 keys, 8 commands) was taught at set-up in 1.53 s (the process start included), the card working out the same ID. Every
load answered its place and `01`; the balance was the 2,555 sats minted and the card held 45 unspent pieces in places 0 to 44. Twelve more
pieces loaded alternately in the two forms on the same card: the 04 form 162.2 to 168.6 ms (mean 164.5), the 33-byte form 152.1 to 158.8 ms
(mean 155.0).

## The commands D211 to D214 changed, on the chip

| Command | Before | This file |
| --- | ---: | ---: |
| first `SET_CARD` | 1,777 ms | 2,033 ms (six more points off the curve asked of the key agreement, eight squarings and the field's answers at the top of the range) |
| `AUTH` / one signature's work | 264 ms | 532 ms |
| `GET_NONCE` P1 1, `VERIFY_PIN` sealed | 45 ms, 144 ms | 45 ms, 144 ms (no signature of the card's in them) |
| `SPEND_ALL_CHANGE`, an output | 226 to 289 ms | 226 to 258 ms |
| `LOAD_CHANGE` | 577 to 587 ms | 576 to 588 ms |
| `SPEND_ALL_SIGN`, nine pieces and five change outputs | 678 ms | 942 ms |
| a payment, `SPEND_ALL_BEGIN` to the signature, five change outputs | 2.23 s | 2.46 s |
| a payment of three pieces, no change: `SIGN` / from `BEGIN` | 446 ms / 706 ms | 705 ms / 962 ms |
| a payment with three change outputs: `SIGN` / from `BEGIN` | 519 ms / | 734 ms / 1.70 s |

Where the 0.27 s a signature goes: two squarings on the RSA engine more (about 24 ms) and the check, three runs of the EC engine
(a key agreement for d·G, one for −e·P, a point addition for s·G − e·P).

## The holds (counts of the card's signing work, D205)

| Hold | Count | Measured | D205's target |
| --- | ---: | ---: | ---: |
| the owner's claim | 4 askings | 572, 576, 576 ms held, 858 ms the claim: 2.6 s | 3 s |
| the history of a card with a PIN, no owner | 7 askings | 6 x 491 ms: 2.95 s | 4 s |
| the reset by the PIN | 7 + 17 askings | 17 x 502 ms: 8.26 s; 11.3 s with the history's | 15 s |
| the wait after a wrong PIN try | 1 and 2 askings | 493 ms an asking | |

An asking is 0.49 to 0.58 s now (0.23 to 0.31 s in the fourth run, where D205's holds were measured at 0.59 to 0.66 s). The counts were
not changed: the project owner has not decided that.

## Environment

- Card: NXP J3R180 (JCOP4), CPLC serial **09301220** (checked by the install script before it sent anything, at every install), the
  public default GlobalPlatform test key, SCP02.
- Reader: ACS ACR39U, contact. Times are the reader's round trip, measured by the driver (pyscard).
- Mint: `testnut.cashu.space`, FakeWallet (no real money); the `sat` keyset `017bc604…`, input fee 100 ppk.
- Block headers: real mainnet headers of blocks 975,830, 975,841 and 975,859 (from mempool.space).
- Owner: cardctl's TEST key; a made-up owner seed; a made-up refund key; the PIN 1234.

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) |
| --- | --- | --- |
| the tracked CAP, `applet/target/cashu-javacard-2.3.0.cap` | `20b6d72633d4ebdc074802d5eec924adcc8dca8421c6ca695060312b59d44a29` | 40,365 bytes (173 past a multiple of 256; 164 blocks of 247, the last 104), sha256 `8aefa0db7ba81c0c9a3832e33e301110d6fa5d52b7a52a1434eda6ac9ee206aa` |

The chip had refused load files 135 and 153 past a multiple of 256 and installed those 175 and 237 past; this one, 173 past, installed at
the first try, so no constant table was padded in. It is 1,022 bytes more than the file of the fourth run.

## Results

| Item | Result |
| --- | --- |
| Install | four times, each in three steps: load 17 to 18 s, the card's applet 1 to 3 s, **created at the first try every time**; `SELECT` `02 03`, the tag `getfoxy.io/card` |
| Set-up | `cardctl setup` (PIN, record with the refund key, the owner claimed with the owner's c, the anchor); c read back and checked against `GROUP_KEYS` |
| The engines' self-tests | the first `SET_CARD` ran them all; the chip held to every one, so the 04 form of `LOAD_PROOF` was taken (the chip refused the six points the set-up asks off the curve) and the padded keys and the squaring key were used (the times above are theirs) |
| A keyset taught at set-up | `KEYSET_KEYS`, no piece on the card: the ID answered; the first load then had no teaching in it |
| The first load | the table above |
| Real signatures | every payment signed at its first `SPEND_ALL_SIGN` (no "not yet"), good under P + t·G and not under P; testnut's swap `200`, the inputs `SPENT`; `AUTH` verified by `selftest` |
| Real change | five change outputs written back by `LOAD_CHANGE` in a new tap with no PIN, each `UNSPENT` at testnut with its proof by testnut's key (the three of a second payment were left owed for the refusals below) |
| Refusals, the 04 form | `6A80`, nothing stored (72 to 88 ms): the 17 points off the curve of the run, among them the four the set-up now asks and the earlier thirteen (an x on no point, the twist point, G with y + 1 and y - 1, G's x with a wrong y, y = 0, x = p, y = p, x = p + 1, `04` and zeros, P-256's G, prefixes `03` and `06`); `6700` for wrong lengths; the unspent count and the balance as before |
| Refusals, `LOAD_CHANGE` | `6A80` (81 to 126 ms; 490 ms for the proof), the opening still owed, for C_ with y + 1, y + 2, x + 1, zeros, prefix `03`, x = p; K with y + 1 and y + 2; the proof's e changed |
| `selftest` | 13 of 13 on physical hardware |
| The holds | the table above |
| Left | installed again from the same file: fresh (no PIN, no owner, no record) |

## Not run

A fault in an engine (a chip cannot be made to fault on request; the simulator's tests fault each of the four squarings, in the input
and the output, and a repeated nonce), the day of loads, dated pieces in the 04 form, a chip whose engines fail their set-up tests (the
simulator refuses the padded keys and runs the fallbacks in every test; a test engine of the tests' own runs the padded paths),
`LOCK_CARD`, tears, the certificate, a dollar card, a phone and a production mint. What the chip's RSA engine leaks about the shares of
the key that it squares ([D211](../DECISIONS.md#d211), [SECURITY-MODEL](../SECURITY-MODEL.md), threat 19) is not measured here.

## Logs

a scratch folder on the bench machine: `install-*.log`, `setup-*.log`, `flow-A.log`, `flow-A*-p19.log`, `refusals-A.log`,
`selftest-A.log`, `setup-timing-B.log`, `reset-pin.log`, `h/item*.log`.
