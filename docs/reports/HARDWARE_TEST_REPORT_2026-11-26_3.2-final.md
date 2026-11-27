# Hardware test report: the 3.2 final file on three cards (2026-11-26)

The 3.2 file with the speed work (D245 to D257) and the wait counts of D258 (branch `card-3.2-waits`, 70bff21) was put on three
cards and run through the whole chip run: the install and creates, the room and the fast field, the sealed PIN checks, the
engine probe (test-only, deleted after), the moneyless checks, the settlement record, a play-money session in both load forms,
and the paid list. Play money only (testnut and made-up pieces). Each card's serial was checked before every change.

## The file

| File | sha256 | Load file | Kept by the chip (D256) |
| --- | --- | --- | --- |
| `19-final-waits2.cap` (70bff21) | `a94f6acd705b89fa241714eb35406b2531174899a84c199bf78e4abd0493e45b` | **44,881 bytes** (81 past), sha256 `c525db93b62b963504c574f9147f4b1a5437c30a436e58b5c495f8247a79f3c9` | 40,580 bytes, 132 past |

## The cards

| Card | Chip | Lock | Created at the first try | Free before / after the set-up | GET_INFO byte 56 | SET_CARD |
| --- | --- | --- | --- | --- | --- | --- |
| 57723320 (CardLogix) | J3R180 | SCP03 | 4 of 4 | 97,884 / 69,844 | 07 | 2,111 ms |
| 09344120 (fresh, another seller) | NXP P71D321, J3R180 class, made 2023-02-10 | SCP02 | 4 of 4 | 87,088 / 59,048 | 07 | 2,123 ms |
| 36813121 | J3R452, JCOP 4.5, NXP P71D600, made 2025-12-05 | SCP03 | 4 of 4 (five with the last put-back) | 216,200 / 188,136 | 07 | 2,300 ms |

On each card: 10 of 10 sealed PIN checks answered 9000 with the tries full; the engine probe right in every case; 23 of 23
moneyless checks; the settlement record passed; play money in both load forms ended with the books at 0; the paid list (266
loads) passed. The same test payments waited 57 times, as on 3.1. Each card was left with the file freshly installed, not set up.

## Medians, thousandths of a second (3.1 against 3.2)

| | J3R452 3.1 | J3R452 3.2 | J3R180 (SCP02) 3.1 | fresh J3R180 3.2 | J3R180 (SCP03) 3.1 | 57723320 3.2 |
|---|---|---|---|---|---|---|
| AUTH (one signature) | 543 | 442 | 511 | 396 | 479 | 387 |
| A wait's signature | 569 | 457 | 477 | 354 | 462 | 362 |
| A payment's last SIGN | 978 | 690 | 784 | 498 | 756 | 480 |
| A change output made | 332 | 296 | 234 | 203 | 287 | 209 |
| A change piece written back | 903 | 763 | 586 | 468 | 537 | 418 |
| A piece loaded (long form) | 156 | 139 | 153 | 136 | 115 | 99 |
| First load, 36 pieces | 6,727 | 6,010 | 6,555 | 5,838 | 5,084 | 4,397 |
| SPEND_ALL_BEGIN / OUTPUTS | 208 / 222 | 203 / 183 | 127 / 111 | 124 / 81 | 110 / 88 | 105 / 55 |
| Exact payment, whole contact | 2,616 | 2,301 | 1,821 | 1,511 | 1,617 | 1,343 |

Only the J3R452 pair is the same card; the 3.1 columns for the J3R180s are other cards of the same kind (09334220 and 58206920,
2026-11-23). 3.2 is faster than 3.1 on every line on every chip. The fresh J3R180's slower desk figures grow with the bytes a
command carries (its contact link at TA1 = 13, about 43,000 baud): the wire to the desk reader, not the applet.

The J3R452's sealed VERIFY_PIN on a set-up card, like for like: 222.6 on 3.1 and 203.9 on 3.2 (GET_NONCE P1 = 1: 144.5 and
144.1; plain VERIFY_PIN 31.4 and 31.3).

## Two things seen on the J3R452

- The file from before the speed work (00-base-3b9b5a4.cap, its kept package 245 past) could not be created there: `INSTALL`
  answered 6F00 at the first try, and at the second the card stopped answering for a few seconds. D256's rule (where the kept
  package ends) seen on a second chip. The final file went back on and was created at the first try.
- The review's L1 (D259) does not arise on this chip: `SET_CARD` passed and byte 56 was 07.
