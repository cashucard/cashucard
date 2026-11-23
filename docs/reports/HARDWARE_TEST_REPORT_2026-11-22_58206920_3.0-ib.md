# The 3.0 file with D228's review fixes (541aaef) on card 58206920 (a J3R180 keyed for SCP03): the install, D228's fixes, the waits, and payments at a test mint (2026-11-22)

The tracked 3.0 file of branch `protocol-2.3` at 541aaef (the merge of 2026-11-19 with the security review's fixes of
[D228](../DECISIONS.md#d228) and the wording of [D229](../DECISIONS.md#d229)) was put on card 58206920 (ATR J3R310-355; a
J3R180 keyed for SCP03 according to the card's supplier, D229) in place of a 3.1 file, timed, paid from at a test mint, and
left there fresh, with the tag at `https://getfoxy.io/card`. This is the run D229 (3) owed before any release wording.

- **Every install was taken at the first try:** the load once of one, the card's applet 13 times of 13, the tag 13 times
  of 13. No `6F00`, no retry. Free memory the same at every reading. `SELECT` answers `03 00`.
- **D228 on the chip:** `GET_INFO` P1 = 4 bytes 55 and 56 read **`F7 03`**, fresh and with the record set (byte 11 `01`,
  the paid list's room reserved), so `77 03` was never seen. The set-up bit is one a unit: made-up keysets taught and loaded
  after the set-up's own were refused `6A9C` at the third, two at the most went in, both counted toward the two unmarked,
  and the holder's next keyset went in with the owner's grant. Both of Island Bitcoin's flows (`VerifyF1Test`,
  `VerifyF1bTest`) passed.
- **The waits are the spec's, to the asking:** `max(0, W − ⌊2 × outputs / 3⌋)`, W = 0 within the limit,
  `10 + 4 × (N − 2)` for N limits' worth, at least 10 for a second payment in the tap. Seventeen payments, from 0 to 42
  "not yet", every one as expected. No floor ([D211](../DECISIONS.md#d211)): a payment within its limit signed at its first
  `SIGN`. Each "not yet" took 473 to 477 ms (the first of a payment 477 to 492 ms).
- **Money:** 36 pieces loaded in one selection with their DLEQ kept (5.09 s); 19 payments signed, every signature good
  under BIP-340 and taken by testnut; 24 change pieces loaded back with no PIN, each DLEQ good and later spent at testnut;
  `SPEND_ALL_AGAIN` by digest; two withdrawals of all. The file's hash is on refcheck's PROVEN.
- **Surprises:** none in the applet. The first load of 36 pieces is again just over the 5 s rule (5.09 s). The waits cost
  more time than a 3.1 file's for the same payments (a second payment within the limit 8 askings, about 4.3 s, against 2), as
  3.0's spec says.

## Environment

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321, ATR historical bytes "J3R310-355", the public default test key.
  - The serial was read with `gp --info` before every command or session that changed the card (51 reads in the run's
    guard log, 48 more by the create cycles), and from the CPLC at every tap (51 taps): every one 58206920.
- **Reader:** ACS ACR39U, contact. Times are the reader's round trip, as gp, pyscard or the bridge report them.
- **Tools:** GlobalPlatformPro v25.10.20; this branch's `tools/cardctl` (setup, selftest, reset, info, card-secret,
  keyset-keys) and `tools/cardsim/client.cjs` through `tools/chip`'s ChipBridge; the earlier runs' harness (`money.py`,
  `mint45.cjs`, `firstload.py`, `p19.cjs`, `p31.cjs`, `fakedrain.cjs`, `rate.py`) in a private copy, pointed at this
  branch, and two scripts of this run: `t30f1.py` (D228's set-up bit, `VerifyF1Test` and `VerifyF1bTest` as the model; the
  3.1 run's `t31f1.py` with the claim sent again while the card answers `6A98`) and `t30held.py` (a set-up with no owner,
  the held history and the reset by the PIN). Nothing in the repository was changed for the run. A tap is a real reset of
  the card by the reader.
- **Set-up:** cardctl's TEST owner key, a random owner seed and refund key held only in the run's memory, the PIN 1234,
  the mint `https://testnut.cashu.space`, the anchor block 976,817.
- **Mint:** testnut, CDK mintd 0.18.1, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.

## The file sent to the chip

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.0.0.cap` as tracked at 541aaef | `0b17e232d394a7ce1885dcc395e38d6830cd4abf5097056052174a3f76b4f4a6` | **42,485 bytes** (245 past a multiple of 256), sha256 `99a66ba7fdc1da0090b5361c98a315cfd591c5c7c43220d25410a04073262536` (refcheck), 173 `LOAD` blocks |

- A CAP built from 541aaef's sources (`ant cap`, JDK 17.0.20.1, `jc305u4_kit`, in a copy of the tree made by `git archive`)
  is the same as the tracked one: `diff -r` of every entry but `MANIFEST.MF` is empty, and refcheck gives the same load file
  size and hash. The rebuilt CAP's own sha256 differs (`9e72b033…`) by its manifest's build time only.
- 245 past is none of the places where this chip refused the card's applet (135, 139, 153, 164, 175, 176 past), and the
  place where the 3.0 and 3.1 files of the same size were created at the first try every time.

## What the card held before

- A 3.1 package (version 3.1), the opener, the card's applet and the tag: `SELECT` `03 01`; the tag read
  `getfoxy.io/card#new`.
- **Fresh, as the brief said:** no PIN, no owner, no record, 0 pieces, 0 spent, balance 0, keyset table 0 entries;
  profiles `F703`.
- Free memory 72,628 persistent and 2,084 transient bytes, 4 applications: the merged 3.1 file's figure after a set-up life.

## 1. The install

| Step | Result |
| --- | --- |
| Delete the tag, the card's applet, the opener, the package | each `9000` (297, 449, 93, 295 ms). Empty: 174,956 / 3,789 bytes free |
| Load and the opener | 173 blocks, every one `9000`; the last `84E880AC 09`; 7.28 s of blocks by gp's times, about 21 s for the whole delete-and-install script. The opener `9000` in 192 ms |
| The card's applet | `9000` at the first try, **1,211 ms** |
| The tag, `https://getfoxy.io/card` | `9000` at the first try, 233 ms |
| `SELECT` | **`03 00 9000`**; `gp -l`: package version 3.0 |
| The tag read as a phone reads it | CC `000F20003B00340406E104004700FF`, byte 12 = 71; the NDEF file `0018`, then `D101145504` and `getfoxy.io/card#new` |
| `selftest` | 13 of 13 (`AUTH` verified under BIP-340 three times) |
| `GET_INFO` P1 = 4 | 59 bytes; bytes 55 and 56 **`F7 03`**; `cardctl info`: "profiles F703" |

Then 12 create cycles (`rate.py`: delete the tag and the card's applet, create both, `SELECT` both, the serial before each
step that wrote, free memory after each):

| Step | Result (12 cycles) |
| --- | --- |
| delete the tag / the card's applet | `9000` 12 of 12; 121 to 122 ms / 298 to 299 ms |
| create the card's applet | **`9000` at the first try 12 of 12, 1,210 to 1,211 ms** |
| create the tag | **`9000` at the first try 12 of 12, 232 to 233 ms** |
| `SELECT` the card's applet / the tag | `03 00 9000` / `9000`, 12 of 12 |

Free memory (persistent / transient), the same at every reading:

| Point | Free |
| --- | --- |
| nothing of the package | 174,956 / 3,789 |
| the package and the opener | 134,644 / 3,789 |
| after the card's applet | 100,400 / 2,100 |
| after the tag | 100,100 / 2,084 |
| after a set-up life (the set-up's storage kept through a reset) | 72,616 / 2,084 |

- **No drift** over the 12 cycles. The card's applet takes 34,244 persistent and 1,689 transient bytes and the tag 300 and
  16, as with 9ac55c1's and the merged 3.1 files. The package is 4 bytes smaller than 9ac55c1's (134,648 free) and 12
  smaller than the merged 3.1 file's (134,656).

## 2. D228, Island Bitcoin's fixes, on the chip

**`GET_INFO` byte 55 bit 3 clear.** Bytes 55 and 56 read `F7 03` fresh (byte 11 `00`), after the first `SET_CARD` with
the paid list's room reserved (byte 11 `01`, `t30held.py`), and fresh again at the end. `77 03` was never seen: this card's
first `SET_CARD` always found the room.

**One set-up bit a unit** (`t30f1.py`, run as `VerifyF1Test` and as `VerifyF1bTest`). One selection of a blank card:
`SET_PIN`, `VERIFY_PIN`, `SET_CARD` (1,829 ms in F1, the first after the install; 1,490 ms in F1b), the claim; then
testnut's `sat` keyset taught (`KEYSET_KEYS`, 32 keys, the ID answered, 1,066 ms) and a made-up piece loaded under it
(`LOAD_PROOF` P1 0 P2 02: a random point, no proof; 32 in F1, 1 in F1b); then six made-up keysets (version 00, one key
each), each taught and, where taken, a made-up piece of 1 loaded under it. `GET_INFO` P1 = 3 bytes 48 and 49 (entries in
use, entries toward the two unmarked) after each step:

| Step | F1 | F1b | Table (in use, unmarked) |
| --- | --- | --- | --- |
| the claim (`SET_OWNER`) | `9000` at the first asking (826 ms) | `9000` at the first asking (832 ms) | 0, 0 |
| testnut's keyset taught and loaded | `9000`, `9000` | `9000`, `9000` | 1, **0** (the set-up's own: the bit) |
| made-up keyset 1 taught, loaded | `9000` (43.7 ms), `9000` | `9000` (43.6 ms), `9000` | 2, **1** (no bit) |
| made-up keyset 2 taught, loaded | `9000`, `9000` | `9000`, `9000` | 3, **2** (no bit) |
| made-up keyset 3 | **`6A9C`** (24.7 ms) | **`6A9C`** (24.8 ms) | 3, 2 |
| made-up keysets 4 to 6 | `6A9C` each | `6A9C` each | 3, 2 |
| three taps, each `VERIFY_PIN` and `CLEAR_SPENT` | `9000`, 0 freed | `9000`, 0 freed | 3, 2 |
| a tap: `VERIFY_PIN`, `ALLOW_LOAD` (the owner's grant), the holder's next keyset taught (52.6 ms), a piece loaded | `9000`, ID answered, `9000` | the same | 4, 2 |

- **Pass, both.** A load under the set-up's keyset frees no bit: the third made-up keyset finds no room, two at the most
  went in, both counted toward the two unmarked, and the holder's next keyset went in with the grant.
- The claim was set at the first asking: the set-up's record was written under its PIN in the same time in the field
  ([D221](../DECISIONS.md#d221)). `t30f1.py` sends it again while the card answers `6A98`; it never did.
- The made-up pieces (four each run) stayed on the card's places, so the owner's reset answered `6A8D` (something unspent),
  as the spec says. `fakedrain.cjs` signed each away in its own tap under the PIN (one random point as the output, never
  posted; no limit set, so no wait; `SIGN` 650 to 663 ms), `CLEAR_SPENT` freed 4, and the owner's reset then answered
  `9000`, twice.

**`chipMul` given up for one signature only:** not reachable on a chip. The path that cleared it runs only when the chip's
product fails its check or the chip refuses the work, which takes an induced fault (a glitch or a laser on the chip) that
this bench cannot make. What the chip can show, and showed: every signature of the run good, 19 payments' (each verified
under BIP-340 and taken by testnut), the 8 made-up pieces' and `AUTH`'s in each `selftest` (6 of 6); and the signing
`SIGN` 683 to 808 ms for 1 to 5 inputs through the whole run, no slower at the end than at the start, where a chip path
turned off would add the bytecode's work to every signature. The fix itself is held by
`SignHardeningTest.oneFaultDoesNotTurnTheChipPathOff` in jCardSim.

## 3. The waits (3.0, D211, the spec's formula)

Set up with a limit on one payment of **100 sats** (and a day of 100,000). Expected: `max(0, W − ⌊2 × outputs / 3⌋)`,
outputs the change outputs, W = 0 for N ≤ 1, `10 + 4 × (N − 2)` for N ≥ 2, N the limits' worth leaving the card (within a
thirty-second over the limit counts as one; a part counts as one), and N at least 2 for a second payment in the tap.

| Payment | Leaving the card | Change outputs | N | Expected | "Not yet" | `BEGIN` to the signature | Contact (tap to signature) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W0 | 80 | 0 | 1 | 0 | **0** | 1,022 ms | 1,621 ms |
| B103 (a thirty-second over) | 103 | 0 | 1 | 0 | **0** | 1,098 ms | 1,691 ms |
| W2 | 160 | 0 | 2 | 10 | **10** | 5,811 ms | 6,455 ms |
| W4 | 256 | 0 | 3 | 14 | **14** | 7,742 ms | 8,467 ms |
| W6 | 384 | 0 | 4 | 18 | **18** | 9,675 ms | 10,414 ms |
| W10 | 576 | 0 | 6 | 26 | **26** | 13,464 ms | 14,165 ms |
| C1 | 401 | 6 | 5 | 22 − 4 = 18 | **18** | 11,121 ms | 11,630 ms |
| C2 | 151 | 4 | 2 | 10 − 2 = 8 | **8** | 5,795 ms | 6,348 ms |
| X1 (after `LOAD_CHANGE`, same tap) | 105 | 0 | 2 | 10 | **10** | 5,772 ms | (below) |
| WALL (the withdrawal of all, 21 pieces) | 960 | 0 | 10 | 42 | **42** | 21,715 ms | 22,736 ms |

**A second payment in one tap** (`waitsFor`'s `second`: N at least 2, so W at least 10; with no limit W = 10):

| Tap | Payment | Leaving | Change outputs | N | Expected | "Not yet" | `BEGIN` to the signature |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SA (limit 100) | SA1, the first | 3 | 0 | 1 | 0 | **0** | 889 ms |
| | **SA2, within the limit** | 98 | **4** | 2 | 10 − 2 = **8** | **8** | 5,656 ms |
| SB (limit 100) | SB1, the first | 3 | 0 | 1 | 0 | **0** | 891 ms |
| | **SB2, five limits' worth** | 497 | **4** | 5 | 22 − 2 = **20** | **20** | 11,519 ms |
| NL (no limit) | N1, the first | 3 | 0 | – | 0 | **0** | 870 ms |
| | **N2, no limit** | 193 | **6** | – | 10 − 4 = **6** | **6** | 5,209 ms |

- **Pass, 17 of 17.** Every payment waited exactly what the spec says. With no limit a first payment waited nothing
  whatever it held: NWALL, 15 pieces (1,083), 0 "not yet", 1,447 ms from `BEGIN`.
- **No floor (D211):** W0, B103, SA1, SB1, N1, NWALL and the two `SPEND_ALL_AGAIN` payments A and B (12 and 48 sats, each
  in its own tap) signed at their first `SIGN`.
- **Time per asking:** the first "not yet" of a payment 477 to 492 ms, every later one 473.2 to 476.5 ms. The signing `SIGN`
  683 to 808 ms for 1 to 5 inputs, 1,044 ms for 15, 1,258 ms for 21.
- The tap SA took 7,339 ms in contact, SB 13,307 ms, NL 6,780 ms. All six swaps taken by testnut, their inputs `SPENT`.
- A 3.1 file of another branch, run on this card on 2026-11-21 with the same payments, waited less (W2 2 askings, SA2 2,
  WALL 18): 3.0's waits are the longer by its own rule, not by a fault.

**The held taps of a card with no owner** (`t30held.py`: a set-up with the PIN and the record, no owner; a new tap):

| Step | Answers | Times |
| --- | --- | --- |
| `GET_LOG` before `VERIFY_PIN` | `6982` | 6.5 ms |
| `VERIFY_PIN` | `9000` | |
| `GET_LOG` held | `6A98` × 6, **`9000` at the seventh** (`HISTORY_ASKINGS`) | 474.0 to 474.3 ms each, 10.4 ms the last: **2,855 ms** |
| `RESET_CARD` P2 `AD`, held | `6A98` × 16, **`9000` at the seventeenth** (`RESET_ASKINGS`) | 484.5 to 484.9 ms each, 232.0 ms the last: **7,987 ms** |
| `GET_INFO` | no PIN, no record, no owner | |

These are D228 (7)'s counts (7 and 17), as cardctl's mock holds them.

## 4. Play money at testnut

| # | Item | Result |
| --- | --- | --- |
| 1 | Set-up | **pass.** `cardctl setup` in one selection with the limits (day 100,000, one payment 100): 3.7 s with the process start; c read back (the 3rd owner's c the card has taken); testnut's keyset taught, 32 keys, the same ID. A second set-up with no limits for N1, N2 and NWALL |
| 2 | First load, one selection | **pass, 5.09 s.** 36 pieces (3,837 fake sats), each DLEQ checked at the mint and kept: balance 3,837. `LOAD_PROOF` 108.8 to 121.1 ms (median 115.1), `AUTH` 490.5 ms, the sealed PIN 132.7 ms (`GET_NONCE` 19.8 ms), `GROUP_KEYS` 76.5 ms and equal to the owner's derivation from c. Read back in a new tap: 36 of 36 rebuilt, their kept DLEQ good under testnut's key, all `UNSPENT`. The second session's 12 pieces: 2.26 s |
| 3 | Payments, exact | **pass.** 14 exact payments (W0 to W10, B103, X1, SA1, SB1, A, B, WALL, N1, NWALL), every signature good under BIP-340 under P + t·G and not under P, every swap taken by testnut, every input `SPENT` |
| 4 | Payments with change | **pass.** C1 (6 change outputs), C2 (4), SA2 (4), SB2 (4), N2 (6) |
| 5 | Change loaded with no PIN | **pass.** C1's 6, SA2's 4, SB2's 4 and N2's 6 in their own taps, C2's 4 at the start of X1's tap: `GET_CHANGE` named the openings, each `LOAD_CHANGE` 512 to 547 ms, the proof kept, its DLEQ good under testnut's key, `UNSPENT` at testnut, no opening left |
| 6 | `LOAD_CHANGE` then a payment in the same tap | **pass.** C2's 4 change pieces loaded with no PIN, then `VERIFY_PIN` and X1 paid all four (105) in the same tap: signed after 10 (its N of 2), testnut took it, the four `SPENT`; 10,938 ms in contact with the run's own `checkstate` calls between loads |
| 7 | The change spent at the mint | **pass.** C1's, SA2's and SB2's 14 change pieces were among WALL's 21 inputs, N2's 6 among NWALL's 15, C2's 4 were X1's: testnut's swaps `200`, all `SPENT` |
| 8 | `SPEND_ALL_AGAIN` by digest | **pass.** A (2 pieces) signed and held back; B (2 pieces) signed and swapped. New tap under the PIN: P1 `01` with A's hash gave **A's signature** (20.5 ms), with B's B's; P1 `00` gave B's (13.8 ms); P1 `01` with zeros `6A88`; without the PIN `6A88`. A posted afterwards: `200`, its inputs `SPENT` |
| 9 | A withdrawal of all | **pass.** WALL, 21 pieces (960, 42 waits), and NWALL, 15 pieces (1,083, no wait): balance 0, 0 unspent, no change owed |
| 10 | Reset by the owner | **pass.** `cardctl reset --owner-key test` after each session (0.8 s with the process start): no PIN, no record, no owner, a new card key |

In all, 19 payments signed and taken, and 27 signatures checked on the card's output (19 payments and the 8 made-up pieces
of section 2), every one good under BIP-340.

## 5. The card at the end

- 541aaef's 3.0 file (package version 3.0): the opener, the card's applet and the tag; `SELECT` **`03 00`**.
- **Fresh:** no PIN, no owner, no record, 0 pieces, 0 spent, balance 0, keyset table 0 entries. `selftest` 13 of 13.
  Profiles `F703`. Reset by the PIN (`t30held.py`), the last thing that changed it.
- The tag reads **`https://getfoxy.io/card#new`** (CC byte 12 = 71, the NDEF file `D101145504` and
  `getfoxy.io/card#new`).
- Free memory 72,616 / 2,084 bytes, 4 applications.
- Read back after the last change: `gp -l`, free memory, the tag, `selftest`, `cardctl info` and `GET_INFO` P1 = 4.

## Surprising, or worth knowing

- **The first load of 36 pieces is 5.09 s**, over the 5 s rule by 0.09 s, as with the 3.0 and 3.1 files before it. 35 fits.
- **3.0's waits are long in the hand:** a second payment within the limit waits 8 askings (about 4.3 s) and a withdrawal of
  960 sats at a limit of 100 waits 42 (about 20 s, 22.7 s in contact). That is the spec.
- **The claim at the first asking** in both of D228's flows: the set-up wrote its record under its PIN in the same time in
  the field (D221), so the held claim of D187 did not come into it.
- **Made-up pieces block the owner's reset** (`6A8D`) until they are signed away, which the PIN alone does in one tap each.
  Not new, and the spec's rule.

## refcheck

- **PROVEN:** `99a66ba7…` added with "real signatures and real change verified on the chip". It did not go on INSTALLED
  first: one run installed it and paid from it. refcheck says of the tracked file: "this exact file has run on a chip".
- **SIZES:** 42,485 was already there (True); its note cites this run.
- The sentences that must repeat refcheck's were changed to it: both install guides (the site's note "On a card."), the
  deployment guide's 3.0 paragraph and its chip run's checklist, the release notes, README, the component releases,
  SECURITY-MODEL, CASHU-CARD-HARDWARE, the provisioner's README and a test comment, and D228 and D229 a line each.
  `refcheck.test.cjs` and `test_spec_consistency.py` pass.
- **The provisioner's `VALIDATED_LOAD_FILE_SHA256S`:** not changed (a change of its own, with the operator's approval).

## Not run

- A phone's read of the tag or a set-up by the phone (left for the keeper).
- The tag's install refusals (`C9 00`, short, 128 bytes) and the coded address after a set-up: 9ac55c1's run did them, and
  D228 did not touch the tag's code.
- A J3R180 keyed for SCP02: none has been given a 3.0 file, and none will be (D229).
- A fault that would make the chip's product fail (the `chipMul` path), a dollar card, the clock and the day's window,
  `LOCK_CARD`, tears, the certificate, `INBOX`, the payment's largest transaction of eight change outputs, the day's 300
  loads.

## Logs

In the run's scratch folder (`chip-30ib`), not kept:

- before: `01-list-before.txt`, `02-mem-before.txt`, `03-info-before.txt`, `04-tag-before.txt`;
- the build: `build.log`, `tracked.cap`, `rb/` and `tr/` (the rebuilt and the tracked CAP, unpacked);
- the install: `20-wipe-load.txt`, `20-load.log`, `21-tag.txt`, `22-selftest.txt`, `23-getinfo4.txt`, `70-rate.jsonl`;
- D228's set-up bit: `t30f1.jsonl`, `fakedrain.log`; the held taps: `t30held.jsonl`;
- the money: `run-M.out`, `run-N.out`, `session-M.log`, `session-N.log`, `p31-results.jsonl`, `p19-*.log`,
  `bridge-*.log`, `state-*.json`, `pieces-*.json`;
- the end: `90-list-final.txt`, `91-mem-final.txt`, `92-tag-final.txt`, `93-selftest-final.txt`, `94-info-final.txt`,
  `95-getinfo4-final.txt`;
- the serial reads: `guard.log`.
