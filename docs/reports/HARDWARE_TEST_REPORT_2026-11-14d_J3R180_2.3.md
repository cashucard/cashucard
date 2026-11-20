# Protocol 2.3 with D207 to D210 on a J3R180: the tracked file's chip run (2026-11-14, fourth run)

> Note added at the 3.0 merge (2026-11-19): decision numbers here are from before the 3.0 merge. D205 to D215 are now D211 to D221 (D205 to D210 now name the other maintainer's 3.0 decisions, and the links below land on those). The record itself is unchanged.

The tracked 2.3 CAP, with [D207](../DECISIONS.md#d207) (a keyset's keys taught at set-up, before its first piece),
[D208](../DECISIONS.md#d208) (the field's arithmetic on the chip's RSA with p padded to 64 bytes for the modulus),
[D209](../DECISIONS.md#d209) (`LOAD_CHANGE`'s points held to the curve by the chip's key agreement) and
[D210](../DECISIONS.md#d210) (the signature's e·d mod n by two squarings on the chip's RSA with n padded), installed on the bench
J3R180 of the second and third runs at the first try every time. The card was set up as the app sets one up, the keyset taught at
set-up, 45 real pieces minted at a FakeWallet test mint (fake sats) were loaded in one selection with no teaching in it, and every
step was timed. Real signatures were verified under BIP-340 and taken by the mint, the change was written back with `LOAD_CHANGE`
with no PIN and spent again, points that are not the curve's were refused with nothing stored, and the holds were timed. The run's
paragraph is in [`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist); the third run of the day, on the
file before D207, is [its own report](HARDWARE_TEST_REPORT_2026-11-14c_J3R180_2.3.md).

## The first load of 45 pieces (one selection, the mint's proof kept, the 04 form, no teaching in the selection)

| Step | This file | The file before (D206, keys not taught in the selection) |
| --- | ---: | ---: |
| `SELECT` | 22.1 ms | 22.0 ms |
| `GET_INFO` (the read) | 42.1 ms | 42.0 ms |
| `AUTH` | 263.9 ms | 626.0 ms |
| `GET_NONCE` P1 1 (the PIN key) | 45.0 ms | 43.8 ms |
| `VERIFY_PIN` sealed (P1 01) | 144.3 ms | 271.5 ms |
| `GROUP_KEYS` (date 0) | 100.1 ms | 99.6 ms |
| `LOAD_PROOF` #1 | 155.0 ms | 154.2 ms |
| `LOAD_PROOF` #2 to #45 | 6,753.4 ms | 6,732.1 ms |
| `GET_INFO` (the final read) | 43.0 ms | 42.4 ms |
| `GET_BALANCE` | 69.4 ms | 68.6 ms |
| **The whole contact** | **7.75 s** | **8.22 s** (9.50 s with the teaching) |
| One `LOAD_PROOF` (min / median / max) | 146.0 / 153.8 / 163.4 ms | 146.4 / 153.1 / 159.6 ms |

The keyset (32 keys, 8 commands) was taught at set-up in 1.53 s (the process start included), the card working out the same ID.
Every load answered its place and `01`; the balance was the 2,555 sats minted and the card held 45 unspent pieces in places 0 to 44.
Twelve more pieces loaded alternately in the two forms on the same card: the 04 form 164.0 to 169.8 ms (mean 166.2), the 33-byte
form 154.9 to 159.3 ms (mean 156.9; it was 241 to 247 ms before D208 took the curve test of a compressed point from 116 ms to 27).

## The commands D207 to D210 changed, on the chip

| Command | Before | This file |
| --- | ---: | ---: |
| first `SET_CARD` | 1.0 to 1.2 s | 1,777 ms (it makes the padded keys and the squaring key and runs their known answers) |
| `AUTH` / one signature's work | 626 ms | 264 ms |
| `VERIFY_PIN` sealed | 278 ms | 144 ms |
| `SPEND_ALL_CHANGE`, an output | 443 to 676 ms | 226 to 289 ms |
| `LOAD_CHANGE` | 1,033 to 1,043 ms | 577 to 587 ms |
| `SPEND_ALL_SIGN`, nine pieces and five change outputs | 1,043 ms | 678 ms |
| a payment, `SPEND_ALL_BEGIN` to the signature, five change outputs | 3.96 s | 2.23 s |
| a payment of three pieces, no change: `SIGN` / from `BEGIN` | | 446 ms / 706 ms |
| a payment with three change outputs: `SIGN` | | 519 ms |
| a payment of loaded change pieces: `SIGN` | | 517 ms |

## The holds (counts of the card's signing work, D205)

| Hold | Count | Measured | D205's target |
| --- | ---: | ---: | ---: |
| the owner's claim | 4 askings | 305, 309, 308 ms held, 859 ms the claim: 1.8 s | 3 s |
| the history of a card with a PIN, no owner | 7 askings | 6 x 229 ms: 1.4 s | 4 s |
| the reset by the PIN | 7 + 17 askings | about 6 s (17 x 292 ms for the reset's) | 15 s |
| the wait after a wrong PIN try | 1 and 2 askings | 231 ms an asking | |

An asking is 0.23 to 0.31 s where D205's holds were measured at 0.59 to 0.66 s. At the same targets the counts would be about 11 (the
claim), 17 (the history) and 38 (the reset), in a count held in six bits (63 at the most). They were not changed.

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
| the tracked CAP, `applet/target/cashu-javacard-2.3.0.cap` | `b304d938b49e6b965c8326f82ae70da91da7df54337d73317d9ee3b594e07d71` | 39,343 bytes (175 past a multiple of 256), sha256 `c79b30a7cf54ce6a97ca5a9f4fba72744618fbe6b42fd03d00b48aa5d508da00` |

## Results

| Item | Result |
| --- | --- |
| Install | four times, each in three steps: load 17 s, the card's applet 2 s, **created at the first try every time**; `SELECT` `02 03`, the tag `getfoxy.io/card` |
| Set-up | `cardctl setup` (PIN, record with the refund key, the owner claimed with the owner's c, the anchor); c read back and checked against `GROUP_KEYS` |
| A keyset taught at set-up | `KEYSET_KEYS`, no piece on the card: the ID answered; the first load then had no teaching in it |
| The first load | the table above |
| Real signatures | every payment signed at its first `SPEND_ALL_SIGN` (no "not yet"), good under P + t·G and not under P; testnut's swap `200`, the inputs `SPENT`; `AUTH` verified by `selftest` ten times |
| Real change | five, three, three, six and six change outputs written back by `LOAD_CHANGE` in new taps with no PIN, each `UNSPENT` at testnut with its proof by testnut's key; five of them (with other pieces) spent again in a swap testnut took |
| Refusals, the 04 form | `6A80`, nothing stored (76 to 86 ms): an x on no point, a point of the twist, G with y + 1, G with y - 1, G's x with a wrong y, y = 0, x = p, y = p, x = p + 1, `04` and zeros, P-256's G, prefixes `03` and `06`; `6700` for wrong lengths; the unspent count and the balance as before |
| Refusals, `LOAD_CHANGE` | `6A80` (86 to 131 ms; 501 ms for the proof), the opening still owed, for C_ with y + 1, y + 2, x + 1, zeros, prefix `03`, x = p; K with y + 1 and y + 2; the proof's e changed; the right answer then written back |
| `selftest` | 20 of 20 |
| The clock items | the first set-up's `SET_HEADER` (a later tip then an older header: the clock went back; nothing moved after a `SELECT`; the tip moved it on) as expected; the claim checks (`6B00`, `6985`, `6A80`) and `INBOX` as expected; the PIN's wait after wrong tries as before in count |
| Left | installed again from the same file: fresh (no PIN, no owner, no record) |

## Not run

The day of loads, dated pieces in the 04 form, a chip whose engines fail their set-up tests (the simulator refuses the padded keys and
runs the fallbacks in every test; a test engine of the tests' own runs the padded paths), `LOCK_CARD`, tears, the certificate, a dollar
card, a phone and a production mint. The signing step now passes a masked form of the key through the chip's RSA engine
([D210](../DECISIONS.md#d210), [SECURITY-MODEL](../SECURITY-MODEL.md), threat 19): nothing here measures what that leaks.

## Logs

a scratch folder on the bench machine: `install-*.log`, `setup-*.log`, `flow-A.log`, `flow-A*-p19.log`, `refusals-A.log`,
`selftest-A.log`, `setup-timing-B.log`, `reset-pin.log`, `h/item*.log`.
