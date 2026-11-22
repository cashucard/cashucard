# The 3.1 file (330ffa1) on the reader's sample card 58206920: the install, the waits made a rate, the shorter held taps, and payments at a test mint (2026-11-21)

The 3.1 file of branch `wait-per-second` at 330ffa1 (D229 to D233) was put on the reader's sample card in place of the
neutral 3.0 file, timed, paid from at a test mint, and left there fresh, with the tag at `https://getfoxy.io/card`.

- **Every install was taken at the first try:** the load 3 times of 3, the card's applet 15 times of 15, the tag 15 times
  of 15. No `6F00`, no retry. Free memory the same at every reading.
- **D229, the wait a rate:** every payment waited exactly `2 × (N − 1)` "not yet" answers, less one for every two change
  outputs, for N = 1, 2, 3, 4, 6, 13. Each "not yet" took 462 ms (the first of a payment 470 to 484 ms). A payment of two
  limits' worth now signs in 2.0 s from `BEGIN`, where 3.0 took 5.8 s.
- **D230:** a second payment in the same tap waited 2; the history answered at the third asking, the reset by the PIN at
  the fourth after it; a claim on a card that had a PIN when the tap began took four askings.
- **D231 to D233:** the first `SET_CARD` of a set-up life took 1.5 to 1.8 s, a second in the same selection 49 ms; the
  self-tests ran again after both resets. A blank card set up in one tap was claimed at the first asking. A first
  `SET_PIN` stood as the PIN given until a `SELECT`.
- **Money:** 36 pieces loaded in one selection with their DLEQ kept; 17 payments signed, every signature good under
  BIP-340 and taken by testnut; 15 change pieces loaded back with no PIN, each DLEQ good and later spent at testnut;
  `SPEND_ALL_AGAIN` by digest; a withdrawal of all. The file's hash is on refcheck's PROVEN.
- **Surprises:** the first load of 36 pieces took 5.08 s, just over the 5 s rule (35 is the most, as the 3.0 run found);
  a second payment with four or more change outputs waits nothing (the spec's formula, below); a payment's change is
  refused `6A84` while an earlier payment's change openings fill the card's eight.

## Environment

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321, ATR historical bytes "J3R310-355", the public default test key.
  - The serial was read with `gp --info` before every command or session that changed the card (53 reads logged by the
    session scripts, 36 more by the create cycles), and from the CPLC at every tap: every one 58206920.
- **Reader:** ACS ACR39U, contact. Times are the reader's round trip, as gp, pyscard or the bridge report them.
- **Tools:** GlobalPlatformPro v25.10.20; this branch's `tools/cardctl` (setup, selftest, reset, keyset-keys) and
  `tools/cardsim/client.cjs` through `tools/chip`'s ChipBridge; the earlier runs' harness (`money.py`, `mint45.cjs`,
  `firstload.py`, `p19.cjs`) in a private copy, and two scripts of this run (`t31set.py` for the set-up and held-tap
  items, `p31.cjs` for the payments). A tap is a real reset of the card by the reader.
- **Set-up:** cardctl's TEST owner key, a random owner seed and refund key held only in the run's memory, the PIN 1234,
  the mint `https://testnut.cashu.space`, the anchor block 976,817.
- **Mint:** testnut, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.

## The file sent to the chip

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.1.0.cap` as tracked at 330ffa1 | `297e646c7af3745d877bbef01719411625bffbd4ea87e0238c2b7850b54d0d37` | **42,485 bytes** (245 past a multiple of 256), sha256 `4014e7f17c65bd2a420157852c5a262ba68062ed4ff3ff7122ac21f34d4a1a19` (refcheck), 173 `LOAD` blocks |

- A CAP built from 330ffa1's sources (`ant cap`, JDK 17, in a copy of the tree) is the same as the tracked one: `diff -r`
  of every entry but `MANIFEST.MF` is empty, and refcheck gives the same load file size and hash.
- 245 past is the place of the proven 3.0 file, not one of the refused places (135, 139, 153, 164, 175 or 176 past).

## What the card held before

- The 3.0 package (version 3.0), the opener, the card's applet and the tag at `getfoxy.io/card`, which read a coded
  address (a set-up card).
- **Not fresh, as the brief expected, but empty:** PIN set, an owner, the record's mint `https://forge.flashapp.me`,
  42 spent places, 0 unspent, balance 0, no change owed (`GET_INFO` byte 29 `00`, `cardctl change`: "no change owed").
  It had been set up and used since the last run. Nothing of value was on it, and the keeper's approval was to wipe it.
- Free memory: 72,620 persistent and 2,084 transient bytes, 4 applications.

## 1. The install

| Step | Result |
| --- | --- |
| Delete the tag, the card's applet, the opener, the package | each `9000` (297, 448, 94, 295 ms). Empty: 174,956 / 3,789 bytes free |
| Load and the opener | 173 blocks, every one `9000`; the last `84E880AC 09`; 8.53 to 8.57 s of blocks, about 20 s for the whole delete-and-install script. The opener `9000` in 192 to 193 ms |
| The card's applet | `9000` at the first try, **1,222 ms** |
| The tag, `https://getfoxy.io/card` | `9000` at the first try, 234 to 236 ms |
| `SELECT` | `03 01 9000`; `gp -l`: package version 3.1 |
| The tag read as a phone reads it | CC byte 12 = 71; `getfoxy.io/card#new` |
| `selftest` | 13 of 13 |

Then 12 create cycles (delete the tag and the card's applet, create both, `SELECT` both, the serial before each step),
and two more whole deletes and loads:

| Step | Result |
| --- | --- |
| delete the tag / the card's applet | `9000` 12 of 12; 121 to 122 ms / 299 to 301 ms |
| create the card's applet | **`9000` at the first try 12 of 12, 1,221 to 1,224 ms** |
| create the tag | **`9000` at the first try 12 of 12, 234 to 236 ms** |
| the whole load, twice more | 173 of 173 blocks each, the opener, the card's applet (1,222 ms) and the tag, all at the first try |

Free memory (persistent / transient), the same at every reading:

| Point | Free |
| --- | --- |
| nothing of the package | 174,956 / 3,789 |
| the package and the opener | 134,656 / 3,789 |
| after the card's applet | 100,412 / 2,100 |
| after the tag | 100,112 / 2,084 |

- **No drift.** The card's applet takes 34,244 persistent and 1,689 transient bytes, as 3.0's did. The package is 8 bytes
  larger in persistent memory than 3.0's (134,656 against 134,648).
- The 129 transient bytes the 3.0 run saw go are still gone (3,789 with everything deleted).

## 2. D229: the wait over the limit

Set up with a limit on one payment of **100 sats** (and a day of 100,000). Expected waits:
`max(0, 2 × (N − 1) − ⌊change outputs / 2⌋)`, N the limits' worth leaving the card (within a thirty-second over the limit
counts as one; a part counts as one). Each payment was the first in its tap.

| Payment | Leaving the card | Change outputs | N | Expected | "Not yet" | `BEGIN` to the signature | Contact (tap to signature) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W0 | 80 | 0 | 1 | 0 | **0** | 1,026 ms | 1,583 ms |
| B103 (a thirty-second over: 103 ≤ 103.125) | 103 | 0 | 1 | 0 | **0** | 1,093 ms | 1,694 ms |
| W2 | 160 | 0 | 2 | 2 | **2** | 1,985 ms | 2,633 ms |
| W4 | 256 | 0 | 3 | 4 | **4** | 2,953 ms | 3,678 ms |
| W6 | 384 | 0 | 4 | 6 | **6** | 3,916 ms | 4,661 ms |
| W10 | 576 | 0 | 6 | 10 | **10** | 5,765 ms | 6,465 ms |
| C1 | 401 | 6 | 5 | 8 − 3 = 5 | **5** | 4,780 ms | 5,285 ms |
| C2 | 151 | 4 | 2 | 2 − 2 = 0 | **0** | 2,025 ms | 2,568 ms |
| X1 (after `LOAD_CHANGE`, same tap) | 105 | 0 | 2 | 2 | **2** | 1,954 ms | (below) |
| WALL (the withdrawal of all, 13 pieces) | 1,287 | 0 | 13 | 24 | **24** | 12,485 ms | 13,196 ms |
| WALL2 (the last change, 5 pieces) | 155 | 0 | 2 | 2 | **2** | 2,009 ms | 2,611 ms |

- **Time per asking:** the first "not yet" of a payment 470 to 484 ms, every later one 461.9 to 462.6 ms. The signing
  `SIGN` 692 to 808 ms (1,006 ms for 13 inputs).
- **A limit's worth past the first costs 0.92 s** (two askings), with no larger first step.
- **Against 3.0** (its report, a limit of 200, the same chip): N = 2 waited 10 askings, 4.73 s, and signed 5.8 s from
  `BEGIN`; now 2 askings, 0.92 s, 2.0 s. N = 4: 9.7 s then, 3.9 s now. N = 6: 13.6 s then, 5.8 s now.
- **Change credit, one wait for every two outputs:** C1's six outputs took 3 off, C2's four took 2 (to 0). Each change
  output was 0.20 to 0.33 s of `SPEND_ALL_CHANGE`.

## 3. D230: the second payment, the held history, the reset by the PIN

**A second payment in one tap** (one tap under the PIN, four payments, the limit of 100):

| Payment | Leaving | Change outputs | Expected | "Not yet" | `BEGIN` to the signature |
| --- | ---: | ---: | ---: | ---: | ---: |
| S1, the first | 3 | 0 | 0 | **0** | 889 ms |
| S2, the second | 12 | 0 | 2 | **2** | 1,873 ms |
| S3, the third | 101 | 5 | 2 − 2 = 0 | **0** | 2,113 ms |
| S4, the fourth | 3 | 0 | 2 | **2** | 1,813 ms |

The whole tap, four payments: 8,168 ms. All four swaps taken by testnut, their inputs `SPENT`.

**The held tap and the reset by the PIN** (a card with a PIN, a record and no owner; a new tap):

| Step | Answers | Times |
| --- | --- | --- |
| `GET_LOG` before `VERIFY_PIN` | `6982` | 6.5 ms |
| `VERIFY_PIN` | `9000` | 21.8 ms |
| `GET_LOG` held | `6A98`, `6A98`, **`9000` at the third** | 462.6, 462.5, 10.4 ms: **936 ms** |
| `RESET_CARD` P2 `AD`, held | `6A98` × 3, **`9000` at the fourth** | 473.1, 473.0, 473.1, 236.6 ms: **1,656 ms** |
| `GET_INFO` | no PIN, no record, no owner | |

The history's hold and the reset together: 7 askings, **2.6 s**, where 3.0 asked 24 (about 11 s).

**A claim on a card that had a PIN at the tap's first command** (D232): in the same tap, after the reset, `SET_PIN`,
`SET_CARD` and the claim with the owner's c: `SET_OWNER` answered `6A98` three times and set the owner at the
**fourth** (539.8, 543.2, 542.8, 835.3 ms: 2,461 ms).

## 4. D231 to D233: the set-up

| Item | Result |
| --- | --- |
| D231: the first `SET_CARD` after the install | `9000` in **1,831 ms** (the self-tests) |
| D231: a second `SET_CARD` in the same selection | `9000` in **48.6 ms** (self-tests skipped) |
| D231: the first `SET_CARD` after the owner's reset | `9000` in **1,493 ms** (self-tests again) |
| D231: the first `SET_CARD` after a `RESET_CARD` by the PIN | `9000` in **1,494 ms** (self-tests again) |
| D232: a blank card set up and claimed in one tap | `SET_OWNER` `9000` at the **first** asking (826 ms). The money session's `cardctl setup` did the same: no "keep holding" note |
| D233: `SET_CARD` after a first `SET_PIN`, no `VERIFY_PIN` | `9000` |
| D233: `GROUP_KEYS` after the first `SET_PIN`, no `VERIFY_PIN` | `9000` (76.5 ms) |
| D233: `GROUP_KEYS` after a `SELECT` in the same power-up | **`6982`** |
| D233: `GROUP_KEYS` in a new tap / after `VERIFY_PIN` | `6982` / `9000` |

- `SET_PIN` 24 ms. The owner's reset 337 to 342 ms.
- The first `SET_CARD` after the install is 0.34 s slower than after a reset. Not measured why; the chip may make its
  RSA keys the first time and keep them (the source says the keys the self-tests make stay made).

## 5. Play money at testnut

| # | Item | Result |
| --- | --- | --- |
| 1 | Set-up | **pass.** `cardctl setup` in one selection with the limits (day 100,000, one payment 100): 3.7 s with the process start; c read back (the 3rd owner's c it has taken); testnut's keyset taught, 32 keys, the same ID |
| 2 | First load, one selection | **pass, 5.08 s.** 36 pieces (3,837 fake sats: 1 to 128 three times, and twelve of 256), each DLEQ checked at the mint and kept: balance 3,837. Read back in a new tap: 36 of 36 rebuilt, their kept DLEQ good under testnut's key, all `UNSPENT` |
| 3 | Payments, exact | **pass.** 14 exact payments (above), every signature good under BIP-340 under P + t·G and not under P, every swap taken by testnut, every input `SPENT` |
| 4 | Payments with change | **pass.** C1 (6 change outputs), C2 (4), S3 (5) |
| 5 | Change loaded with no PIN | **pass.** C1's 6 and S3's 5 in their own taps: `GET_CHANGE` named the openings, each `LOAD_CHANGE` 529 to 550 ms, the proof kept, its DLEQ good under testnut's key, `UNSPENT` at testnut, no opening left |
| 6 | `LOAD_CHANGE` then a payment in the same tap | **pass.** C2's 4 change pieces loaded with no PIN, then `VERIFY_PIN` and X1 paid all four (105) in the same tap: signed after 2 (its N), testnut took it, the four `SPENT` |
| 7 | The change spent at the mint | **pass.** C1's six change pieces were among WALL's 13 inputs and S3's five were WALL2: testnut's swaps `200`, all `SPENT`. So testnut took the card's change in later swaps |
| 8 | `SPEND_ALL_AGAIN` by digest | **pass.** A (2 pieces) signed and held back; B (2 pieces) signed and swapped. New tap under the PIN: P1 `01` with A's hash gave **A's signature** (20.7 ms), with B's B's; P1 `00` gave B's; P1 `01` with zeros `6A88`; without the PIN `6A88`. A posted afterwards: `200` |
| 9 | A withdrawal of all | **pass.** WALL, 13 pieces (1,287), then WALL2 for the last change: balance 0, 0 unspent, no change owed |
| 10 | Reset by the owner | **pass.** `cardctl reset --owner-key test`: no PIN, no record, no owner, a new card key |

`LOAD_PROOF` in the first load: 108.9 to 122.4 ms (median 115.2). `AUTH` 478.6 ms, the sealed PIN 132.7 ms. Everything but
the loads took 0.94 s, so 35 pieces is the most a first load fits in 5 s on this chip, as with 3.0.

Contact times of the change taps include the run's own `checkstate` calls to testnut between loads (C1's change: 6.9 s
for six; the change then X1: 7.0 s): they are not the card's.

## 6. The card at the end

- The 3.1 file of 330ffa1 (package version 3.1): the opener, the card's applet and the tag, `SELECT` `03 01`.
- **Fresh:** no PIN, no owner, no record, 0 pieces, 0 spent, balance 0. `selftest` 13 of 13.
- The tag reads `https://getfoxy.io/card#new`.
- Free memory 72,628 / 2,084 bytes, 4 applications (the set-up's storage kept through the reset, as with 3.0).
- Ready for the keeper to set up on the phone.

## Surprising, or worth knowing

- **The card was not fresh before the run** (above): set up, owned, at forge.flashapp.me, 42 places spent, empty, owed
  nothing. It was wiped as approved; nothing on it had value.
- **The first load of 36 pieces is 5.08 s**, over the 5 s rule by 0.08 s. 35 fits.
- **A second payment with change can wait nothing.** The floor of 2 for a second payment is taken before the change's
  credit, so S3 (the third payment of its tap, 5 change outputs) waited 0. This is the spec's formula
  (`max(0, W − ⌊outputs / 2⌋)`, W at least 2), and each change output costs the card 0.20 to 0.33 s of its own, so the
  payment still took 2.1 s. The brief's "a second payment waits ≥ 2" holds only without change.
- **A payment's change needs free openings.** C2, made while C1's six change openings were still owed, was refused
  `6A84` at its `SPEND_ALL_CHANGE` (six owed and four more is over the card's eight); nothing was signed. After C1's
  change was loaded, C2 went through. Not new in 3.1.
- **Every "not yet" is 462 ms** on this chip, where the spec says about 473.6 ms: a limit's worth past the first is
  0.92 s, so a card pays about 8% faster than L a second over a long run (the spec accepted about 5%).

## refcheck

- **PROVEN:** `4014e7f1…` added with "real signatures and real change verified on the chip". It did not go on INSTALLED
  first: one run installed it and paid from it. refcheck says of the tracked file: "this exact file has run on a chip".
- **SIZES:** 42,485 was already there (True); its note cites this run.
- The sentences that must repeat refcheck's were changed to it: both install guides (the site's note "On a card."), the
  deployment guide's 3.1 paragraph, and the release notes. `refcheck.test.cjs` and `test_spec_consistency.py` pass.
- **The provisioner's `VALIDATED_LOAD_FILE_SHA256S`:** not changed (a change of its own, with the operator's approval).

## Not run

- A phone's read of the tag or a set-up by the phone (left for the keeper).
- A dollar card, the clock and the day's window, `LOCK_CARD`, tears, the certificate, `INBOX`.

## Logs

In the run's scratch folder (`chip-31`), not kept:

- before: `01-list-before.txt`, `02-mem-before.txt`, `03-info-before.txt`, `04-tag-before.txt`;
- the install: `20-wipe-load.txt`, `20-load.log`, `21-tag.txt`, `22-selftest.txt`, `22-`/`23-wipe-load.txt` and their
  load logs, `70-rate.jsonl`;
- the set-up and held taps: `t31set.jsonl`;
- the money: `session-M.log`, `session-M3.log`, `session-M5.log`, `p31-results.jsonl`, `p19-*.log`, `bridge-*.log`,
  `state-*.json`, `pieces-M-first.json`;
- the end: `90-list-final.txt`, `91-mem-final.txt`, `92-tag-final.txt`, `93-selftest-final.txt`;
- the serial reads: `guard.log`.
