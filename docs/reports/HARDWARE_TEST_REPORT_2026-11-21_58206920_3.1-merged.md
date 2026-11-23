# The merged 3.1 file (bab8c5a) on card 58206920 (a J3R180 keyed for SCP03): the install, the waits, the second payment's least after the change's credit, D228's fixes, and payments at a test mint (2026-11-21)

The tracked 3.1 file of branch `card-3.1-on-ib` at bab8c5a (3.1 on Island Bitcoin's merged #256: D228 theirs, D231 to D235
ours, D232 amended so that a second payment in a tap waits `max(2, W − ⌊outputs / 2⌋)`) was put on card 58206920 (ATR J3R310-355; a J3R180 keyed for SCP03 according to the card's
supplier, D229) in place of 330ffa1's 3.1 file, timed, paid from at a test mint, and left there fresh, with the tag at
`https://getfoxy.io/card`.

- **Every install was taken at the first try:** the load 2 times of 2, the card's applet 14 times of 14, the tag 14 times
  of 14. No `6F00`, no retry. Free memory the same at every reading, and the same as 330ffa1's file.
- **D231, the wait a rate:** every first payment of a tap waited exactly `2 × (N − 1)` "not yet" answers, less one for
  every two change outputs, for N = 1, 2, 3, 4, 5, 6, 10. Each "not yet" took 462 ms (the first of a payment 465 to 481 ms).
- **D232 as amended, the second payment's least after the change's credit:** within the limit with 4 change outputs, **2**
  (330ffa1's file waited 0 for such a payment); with no limit and 6 change outputs, **2**; five limits' worth with 4 change
  outputs, **6**. The held history answered at the third asking, the reset by the PIN at the fourth.
- **D228 on the chip:** `GET_INFO` P1 = 4 bytes 55 and 56 read **`F7 03`** (330ffa1's file read `FF 03` before the wipe);
  the set-up bit one a unit: a relay's made-up keysets taught and loaded after the set-up's own were refused `6A9C` at the
  third, two at the most went in, and the holder's next keyset went in with the owner's grant.
- **Money:** 36 pieces loaded in one selection with their DLEQ kept (5.08 s); 19 payments signed, every signature good
  under BIP-340 and taken by testnut; 24 change pieces loaded back with no PIN, each DLEQ good and later spent at testnut;
  `SPEND_ALL_AGAIN` by digest; two withdrawals of all. The file's hash is on refcheck's PROVEN.
- **Surprises:** none in the applet. The first load of 36 pieces is again just over the 5 s rule (5.08 s). Pieces loaded
  with no proof under made-up keysets keep a card from its owner's reset (`6A8D`) until they are signed away, as the spec
  says; the run signed them away (below).

## Environment

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321, ATR historical bytes "J3R310-355", the public default test key.
  - The serial was read with `gp --info` before every command or session that changed the card (65 reads in the run's
    guard log, 48 more by the create cycles), and from the CPLC at every tap: every one 58206920.
- **Reader:** ACS ACR39U, contact. Times are the reader's round trip, as gp, pyscard or the bridge report them.
- **Tools:** GlobalPlatformPro v25.10.20; this branch's `tools/cardctl` (setup, selftest, reset, info) and
  `tools/cardsim/client.cjs` through `tools/chip`'s ChipBridge; the earlier runs' harness (`money.py`, `mint45.cjs`,
  `firstload.py`, `p19.cjs`, `p31.cjs`, `t31set.py`) in a private copy, and two scripts of this run: `t31f1.py` (D228's
  set-up bit, Island Bitcoin's `VerifyF1Test` and `VerifyF1bTest` as the model) and `fakedrain.cjs` (signs away the made-up
  pieces of `t31f1.py`; never posted). A tap is a real reset of the card by the reader.
- **Set-up:** cardctl's TEST owner key, a random owner seed and refund key held only in the run's memory, the PIN 1234,
  the mint `https://testnut.cashu.space`, the anchor block 976,817.
- **Mint:** testnut, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.

## The file sent to the chip

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.1.0.cap` as tracked at bab8c5a | `7a070ada1f2f50d2ee78f9393d48c7f99e3b31ed5807f21b3c5481d673127d0d` | **42,485 bytes** (245 past a multiple of 256), sha256 `9ed123597844573aae7fdb35af1b015a90b00b042acd7a66b95892b8688a7a8b` (refcheck), 173 `LOAD` blocks |

- A CAP built from bab8c5a's sources (`ant cap`, JDK 17, `jc305u4_kit`, in a copy of the tree made by `git archive`) is the
  same as the tracked one: `diff -r` of every entry but `MANIFEST.MF` is empty, and refcheck gives the same load file size
  and hash.

## What the card held before

- 330ffa1's 3.1 package (version 3.1), the opener, the card's applet and the tag; the tag read `getfoxy.io/card#new`.
- **Fresh, as the brief said:** no PIN, no owner, no record, 0 pieces, 0 spent, balance 0; `GET_INFO` P1 = 4 profiles
  `FF03` (byte 55 bit 3 set, as 330ffa1's file had it before D228).
- Free memory 72,628 persistent and 2,084 transient bytes, 4 applications.

## 1. The install

| Step | Result |
| --- | --- |
| Delete the tag, the card's applet, the opener, the package | each `9000` (297, 449, 94, 295 ms). Empty: 174,956 / 3,789 bytes free |
| Load and the opener | 173 blocks, every one `9000`; the last `84E880AC 09`; 7.27 to 7.30 s of blocks by gp's times, about 21 s for the whole delete-and-install script. The opener `9000` in 193 ms |
| The card's applet | `9000` at the first try, **1,221 to 1,222 ms** |
| The tag, `https://getfoxy.io/card` | `9000` at the first try, 234 to 235 ms |
| `SELECT` | `03 01 9000`; `gp -l`: package version 3.1 |
| The tag read as a phone reads it | CC byte 12 = 71; `getfoxy.io/card#new` |
| `selftest` | 13 of 13 |
| `GET_INFO` P1 = 4 | 59 bytes; bytes 55 and 56 **`F7 03`** fresh (byte 11 `00`) and after the first `SET_CARD` (byte 11 `01`, the paid list reserved); `cardctl info`: "profiles F703" |

Then 12 create cycles (delete the tag and the card's applet, create both, `SELECT` both, the serial before each step),
and a second whole delete and load:

| Step | Result |
| --- | --- |
| delete the tag / the card's applet | `9000` 12 of 12; 121 ms / 299 to 300 ms |
| create the card's applet | **`9000` at the first try 12 of 12, 1,221 to 1,224 ms** |
| create the tag | **`9000` at the first try 12 of 12, 234 to 236 ms** |
| `SELECT` the card's applet | `03 01 9000` 12 of 12 |
| the whole load, once more | 173 of 173 blocks, the opener, the card's applet (1,221 ms) and the tag (234 ms), all at the first try; `selftest` 13 of 13 |

Free memory (persistent / transient), the same at every reading:

| Point | Free |
| --- | --- |
| nothing of the package | 174,956 / 3,789 |
| the package and the opener | 134,656 / 3,789 |
| after the card's applet | 100,412 / 2,100 |
| after the tag | 100,112 / 2,084 |
| after a set-up life (the set-up's storage kept through a reset) | 72,628 / 2,084 |

- **No drift.** The same figures as 330ffa1's file at every point: D228's fixes and D232's amendment cost no memory.

## 2. D231: the wait over the limit

Set up with a limit on one payment of **100 sats** (and a day of 100,000). Expected for the first payment of a tap:
`max(0, 2 × (N − 1) − ⌊change outputs / 2⌋)`, N the limits' worth leaving the card (within a thirty-second over the limit
counts as one; a part counts as one).

| Payment | Leaving the card | Change outputs | N | Expected | "Not yet" | `BEGIN` to the signature | Contact (tap to signature) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W0 | 80 | 0 | 1 | 0 | **0** | 1,012 ms | 1,580 ms |
| B103 (a thirty-second over) | 103 | 0 | 1 | 0 | **0** | 1,082 ms | 1,679 ms |
| W2 | 160 | 0 | 2 | 2 | **2** | 1,975 ms | 2,617 ms |
| W4 | 256 | 0 | 3 | 4 | **4** | 2,943 ms | 3,669 ms |
| W6 | 384 | 0 | 4 | 6 | **6** | 3,908 ms | 4,642 ms |
| W10 | 576 | 0 | 6 | 10 | **10** | 5,758 ms | 6,470 ms |
| C1 | 401 | 6 | 5 | 8 − 3 = 5 | **5** | 4,759 ms | 5,281 ms |
| C2 | 151 | 4 | 2 | 2 − 2 = 0 | **0** | 1,888 ms | 2,433 ms |
| X1 (after `LOAD_CHANGE`, same tap) | 105 | 0 | 2 | 2 | **2** | 1,944 ms | (below) |
| WALL (the withdrawal of all, 21 pieces) | 960 | 0 | 10 | 18 | **18** | 10,130 ms | 11,184 ms |

- **Time per asking:** the first "not yet" of a payment 465 to 481 ms, every later one 461.8 to 463.0 ms. The signing
  `SIGN` 689 to 797 ms for 1 to 5 inputs, 1,247 ms for 21.
- C2 was made after C1's six change pieces were loaded: no `6A84` this time (the earlier run's C2 came while C1's six
  openings were owed).

## 3. D232 as amended: the second payment, the held history, the reset by the PIN

**The new rule, a second payment in one tap waits `max(2, W − ⌊outputs / 2⌋)`**, W its own wait (at least 2):

| Tap | Payment | Leaving | Change outputs | N | Expected | "Not yet" | `BEGIN` to the signature |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SA (limit 100) | SA1, the first | 3 | 0 | 1 | 0 | **0** | 880 ms |
| | **SA2, within the limit** | 98 | **4** | 1 | max(2, 2 − 2) = **2** | **2** | 2,879 ms |
| SB (limit 100) | SB1, the first | 3 | 0 | 1 | 0 | **0** | 880 ms |
| | **SB2, five limits' worth** | 497 | **4** | 5 | max(2, 8 − 2) = **6** | **6** | 4,778 ms |
| NL (no limit) | N1, the first | 3 | 0 | – | 0 | **0** | 859 ms |
| | **N2, no limit** | 193 | **6** | – | max(2, 2 − 3) = **2** | **2** | 3,267 ms |

- Against 330ffa1's file: its S3 (a second payment, five change outputs) waited 0; SA2 and N2 are that case and waited 2.
- The tap SA took 4,563 ms in contact, SB 6,559 ms, NL 4,845 ms. All six swaps taken by testnut, their inputs `SPENT`.
- With no limit a first payment waited nothing whatever it held: NWALL, 15 pieces (1,083), 0, 1,436 ms from `BEGIN`.

**The held tap and the reset by the PIN** (a card with a PIN, a record and no owner; a new tap):

| Step | Answers | Times |
| --- | --- | --- |
| `GET_LOG` before `VERIFY_PIN` | `6982` | 6.5 ms |
| `VERIFY_PIN` | `9000` | 21.8 ms |
| `GET_LOG` held | `6A98`, `6A98`, **`9000` at the third** | 462.6, 463.0, 11.0 ms: **937 ms** |
| `RESET_CARD` P2 `AD`, held | `6A98` × 3, **`9000` at the fourth** | 473.1, 473.0, 473.2, 236.5 ms: **1,656 ms** |
| `GET_INFO` | no PIN, no record, no owner | |

**A claim on a card that had a PIN at the tap's first command** (D234): in the same tap, after the reset, `SET_PIN`,
`SET_CARD` and the claim: `SET_OWNER` answered `6A98` three times and set the owner at the **fourth** (528.5, 532.1, 532.1,
837.0 ms: 2,430 ms).

## 4. D233 to D235: the set-up

| Item | Result |
| --- | --- |
| D233: the first `SET_CARD` after the install | `9000` in **1,820 ms** (the self-tests) |
| D233: a second `SET_CARD` in the same selection | `9000` in **48.4 ms** (self-tests skipped) |
| D233: the first `SET_CARD` after the owner's reset | `9000` in **1,494 ms** (three times: 1,493.3 to 1,493.9) |
| D233: the first `SET_CARD` after a `RESET_CARD` by the PIN | `9000` in **1,494 ms** (self-tests again) |
| D234: a blank card set up and claimed in one tap | `SET_OWNER` `9000` at the **first** asking (828 to 834 ms) |
| D235: `SET_CARD` after a first `SET_PIN`, no `VERIFY_PIN` | `9000` |
| D235: `GROUP_KEYS` after the first `SET_PIN`, no `VERIFY_PIN` | `9000` (76.3 ms) |
| D235: `GROUP_KEYS` after a `SELECT` in the same power-up | **`6982`** |
| D235: `GROUP_KEYS` in a new tap / after `VERIFY_PIN` | `6982` / `9000` |

- `SET_PIN` 24 ms. The owner's reset 336 to 337 ms.

## 5. D228, Island Bitcoin's fixes, on the chip

**`GET_INFO` byte 55 bit 3 clear:** `F7 03` (section 1). The paid list's room was reserved, so `77 03` was never seen.

**One set-up bit a unit** (`t31f1.py`, the model `VerifyF1Test` / `VerifyF1bTest`, run as each). One selection of a blank
card: `SET_PIN`, `VERIFY_PIN`, `SET_CARD`, the claim (first asking); then testnut's `sat` keyset taught (`KEYSET_KEYS`,
32 keys, the ID answered, 1,066 ms) and a made-up piece loaded under it (`LOAD_PROOF` P1 0 P2 02: a random point, no
proof; 32 in F1, 1 in F1b); then six made-up keysets (version 00, one key each), each taught and, where taken, a made-up
piece of 1 loaded under it. `GET_INFO` P1 = 3 bytes 48 and 49 (entries in use, entries toward the two unmarked) after
each step:

| Step | F1 | F1b | Table (in use, unmarked) |
| --- | --- | --- | --- |
| testnut's keyset taught and loaded | `9000`, `9000` | `9000`, `9000` | 1, **0** (the set-up's own: the bit) |
| made-up keyset 1 taught, loaded | `9000`, `9000` | `9000`, `9000` | 2, **1** (no bit) |
| made-up keyset 2 taught, loaded | `9000`, `9000` | `9000`, `9000` | 3, **2** (no bit) |
| made-up keyset 3 | **`6A9C`** | **`6A9C`** | 3, 2 |
| made-up keysets 4 to 6 | `6A9C` each | `6A9C` each | 3, 2 |
| three taps, each `VERIFY_PIN` and `CLEAR_SPENT` | `9000`, 0 freed | `9000`, 0 freed | 3, 2 |
| a tap: `VERIFY_PIN`, `ALLOW_LOAD` (the owner's grant), the holder's next keyset taught, a piece loaded | `9000`, ID answered, `9000` | the same | 4, 2 |

- **Pass.** A load under the set-up's keyset frees no bit: the third made-up keyset finds no room, two at the most went
  in, both counted toward the two unmarked, and the holder's next keyset went in with the grant. Under D226 the made-up
  keysets taught after a load would each have taken the bit and counted toward nothing.
- The made-up pieces (four each run) stayed on the card's places, so the owner's reset answered `6A8D` (something
  unspent). `fakedrain.cjs` signed each away in its own tap under the PIN (one random point as the output, never posted;
  no wait, as no limit was set), `CLEAR_SPENT` freed 4, and the owner's reset then answered `9000`.

**`chipMul` never turned off by a signature:** not reachable on a chip. The path that cleared it runs only when the chip's
product fails its check or the chip refuses the work, which takes a fault the run cannot make. What the run saw: 19
payments' signatures and the 8 of the made-up pieces, `AUTH` in each `selftest`, every one good, and the signing `SIGN`
689 to 797 ms for 1 to 5 inputs through the whole run, no slower at the end than at the start. The fix itself is held by
`SignHardeningTest.oneFaultDoesNotTurnTheChipPathOff` in jCardSim.

## 6. Play money at testnut

| # | Item | Result |
| --- | --- | --- |
| 1 | Set-up | **pass.** `cardctl setup` in one selection with the limits (day 100,000, one payment 100); c read back (the 5th owner's c the card has taken); testnut's keyset taught, 32 keys, the same ID. A second set-up with no limits for N1 and N2 (the 6th) |
| 2 | First load, one selection | **pass, 5.08 s.** 36 pieces (3,837 fake sats), each DLEQ checked at the mint and kept: balance 3,837. `LOAD_PROOF` 108.7 to 122.4 ms (median 115.2), `AUTH` 478.6 ms, the sealed PIN 132.7 ms, `GROUP_KEYS` 76.4 ms and equal to the owner's derivation from c. Read back in a new tap: 36 of 36 rebuilt, their kept DLEQ good under testnut's key, all `UNSPENT`. The second session's 12 pieces: 2.24 s |
| 3 | Payments, exact | **pass.** 14 exact payments (W0 to W10, X1, SA1, SB1, A, B, WALL, N1, NWALL), every signature good under BIP-340 under P + t·G and not under P, every swap taken by testnut, every input `SPENT` |
| 4 | Payments with change | **pass.** C1 (6 change outputs), C2 (4), SA2 (4), SB2 (4), N2 (6) |
| 5 | Change loaded with no PIN | **pass.** C1's 6, SA2's 4, SB2's 4 and N2's 6 in their own taps: `GET_CHANGE` named the openings, each `LOAD_CHANGE` 513 to 547 ms, the proof kept, its DLEQ good under testnut's key, `UNSPENT` at testnut, no opening left |
| 6 | `LOAD_CHANGE` then a payment in the same tap | **pass.** C2's 4 change pieces loaded with no PIN, then `VERIFY_PIN` and X1 paid all four (105) in the same tap: signed after 2 (its N), testnut took it, the four `SPENT`; 6,983 ms in contact with the run's own `checkstate` calls between loads |
| 7 | The change spent at the mint | **pass.** C1's, SA2's and SB2's 14 change pieces were among WALL's 21 inputs, N2's 6 among NWALL's 15: testnut's swaps `200`, all `SPENT` |
| 8 | `SPEND_ALL_AGAIN` by digest | **pass.** A (2 pieces) signed and held back; B (2 pieces) signed and swapped. New tap under the PIN: P1 `01` with A's hash gave **A's signature** (20.4 ms), with B's B's; P1 `00` gave B's; P1 `01` with zeros `6A88`; without the PIN `6A88`. A posted afterwards: `200`, its inputs `SPENT` |
| 9 | A withdrawal of all | **pass.** WALL, 21 pieces (960), and NWALL, 15 pieces (1,083): balance 0, 0 unspent, no change owed |
| 10 | Reset by the owner | **pass.** `cardctl reset --owner-key test` after each session: no PIN, no record, no owner, a new card key |

## 7. The card at the end

- bab8c5a's 3.1 file (package version 3.1): the opener, the card's applet and the tag, `SELECT` `03 01`.
- **Fresh:** no PIN, no owner, no record, 0 pieces, 0 spent, balance 0, keyset table 0 entries. `selftest` 13 of 13.
  Profiles `F703`.
- The tag reads `https://getfoxy.io/card#new`.
- Free memory 72,628 / 2,084 bytes, 4 applications.
- Ready for the keeper to set up on the phone.

## Surprising, or worth knowing

- **The first load of 36 pieces is 5.08 s**, over the 5 s rule by 0.08 s, as with 330ffa1's file. 35 fits.
- **Made-up pieces block the owner's reset.** A relay's pieces loaded with no proof count as unspent; the card takes no
  reset (`6A8D`) until they are signed away, which the PIN alone does in one tap each. Not new in 3.1, and the spec's rule.
- **`ALLOW_LOAD` answered as cardctl takes it:** `allow_load` treats `6200` as the grant given, so the run's log shows no
  warning word; the keyset that followed went in.
- **No limit, no second-payment floor on a first payment:** NWALL, 15 pieces, waited nothing.

## refcheck

- **PROVEN:** `9ed12359…` added with "real signatures and real change verified on the chip". It did not go on INSTALLED
  first: one run installed it and paid from it. refcheck says of the tracked file: "this exact file has run on a chip".
- **SIZES:** 42,485 was already there (True); its note cites this run.
- The sentences that must repeat refcheck's were changed to it: both install guides (the site's note "On a card."), the
  deployment guide's 3.1 paragraph and its chip run's checklist, the release notes, README and the component releases.
  `refcheck.test.cjs` and `test_spec_consistency.py` pass.
- **The provisioner's `VALIDATED_LOAD_FILE_SHA256S`:** not changed (a change of its own, with the operator's approval).

## Not run

- A phone's read of the tag or a set-up by the phone (left for the keeper).
- A J3R180 keyed for SCP02: none has been given a 3.x file, and none will be (D229).
- A fault that would make the chip's product fail (the `chipMul` path), a dollar card, the clock and the day's window,
  `LOCK_CARD`, tears, the certificate, `INBOX`.

## Logs

In the run's scratch folder (`chip-31m`), not kept:

- before: `01-list-before.txt`, `02-mem-before.txt`, `03-info-before.txt`, `04-tag-before.txt`;
- the install: `20-wipe-load.txt`, `20-load.log`, `21-tag.txt`, `22-selftest.txt`, `22-wipe-load.txt`, `22-load.log`,
  `70-rate.jsonl`;
- the set-up and held taps: `t31set.jsonl`; D228's set-up bit: `t31f1.jsonl`, `fakedrain.log`;
- the money: `run-M.out`, `run-M2.out`, `run-N.out`, `session-M.log`, `session-N.log`, `p31-results.jsonl`, `p19-*.log`,
  `bridge-*.log`, `state-*.json`, `pieces-*.json`;
- the end: `90-list-final.txt`, `91-mem-final.txt`, `92-tag-final.txt`, `93-selftest-final.txt`, `94-info-final.txt`;
- the serial reads: `guard.log`.
