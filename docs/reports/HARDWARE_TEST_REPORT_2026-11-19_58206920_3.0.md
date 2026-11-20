# Card software 3.0 (merge-3.0 at e2aac64) on the reader's sample card 58206920: the first chip run of 3.0 (2026-11-19/20)

The 3.0 file of the merge: the other maintainer's 3.0 joined with 2.3 and the card23 fixes (D223 to D226 in 3.0's numbering)
and the rotating tag (D222). It was put on the reader's sample card, tried, and taken off again; the card was put back on
190c5ab, fresh and empty.

- **The install was refused once.** The card's applet's create answered `6F00`. The same create, sent again once with nothing
  else changed, was taken at once.
- **Everything after it passed:**
  - the checklist items run on this card in the 2.3 run;
  - D225 and D226;
  - F1, F3 and F5 again;
  - D208;
  - the rotating tag.
- **The chip did nothing the simulator does not**, apart from that refusal at the create.
- **Timing:** each wait, held asking and `AUTH` is 15 to 33 ms shorter than in 2.3 on this card, as the review's count says. A
  payment's signing `SIGN` is 17 to 29 ms longer.

## Environment

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321, ATR historical bytes "J3R310-355".
  - GlobalPlatform 2.3, SCP03 with AES keys.
  - The public default test key, as in the earlier runs on this card. The run's one authentication was a registry listing
    before anything was written.
- **Reader:** ACS ACR39U, contact. Times are the reader's round trip.
- **Tools:**
  - GlobalPlatformPro (`gp.jar`).
  - This branch's `tools/cardctl`, which speaks 3.0 (`SELFTEST_VERSIONS` has (3, 0)).
  - This branch's `tools/cardsim/client.cjs` and `tools/chip`'s ChipBridge.
  - The earlier runs' harness and the run's own scripts, in private copies off the repository. Nothing in the repository was
    changed for the run.
  - A tap is a real reset: pyscard's `reconnect(SCARD_RESET_CARD)`. ChipBridge's `tap` does not reset this card.
- **Mint:** `testnut.cashu.space`, CDK mintd 0.18.1, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.
  Made-up pieces and made-up keysets were used where nothing is posted.
- **Owner keys and limits:** the card set up as cardctl sets one up.
  - cardctl's TEST owner key and a second test key; made-up owner seeds; a made-up refund key; the PIN 1234; the anchor header
    975,859.
  - In the payment cycles: a day's limit of 100,000 and a limit on one payment of 2,000.

## What the card held before

Read with no secure channel first, then the one authenticated listing:

- the 2.3 program 190c5ab: `SELECT` `0203`, package version 2.3, three applets;
- fresh: no PIN, no owner, no record, 0 unspent, 0 spent, balance 0, an empty keyset table;
- the tag read `getfoxy.io/card#new`;
- the card's clock was 1795150491, which the speed study says is block 976,686's time.

## Files sent to the chip

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.0.0.cap` as tracked at e2aac64 | `83051d41b0e17ee97fecdb66c09a81a94feb6c0b5c7d1b01c66cafae6af7e37e` | **41,903 bytes** (175 past a multiple of 256), sha256 `e4b5cff04b01104d6c1dacdb35db6c29e7bac0842915686d1d355199cbb1a250` |
| a rebuild from `git archive e2aac64` (ant, JDK 17, jc305u4), compared only | `86849dbfe334aa722ced64903a5b2650d2cf79ee0b1aaf6e39065544a795fa7b` | the same load file, byte for byte; the two CAPs differ in `META-INF/MANIFEST.MF` alone |
| 190c5ab, put back after the run | `5c4a98e1f7f00758f11e7a7d2db4e17a216626562b48e33e16c40ed7c0dc1708` | 41,205 bytes, sha256 `6f0e3a06…de8d` |

## The install

| Step | Answer |
| --- | --- |
| load and the opener | `9000`, 9 s |
| the card's applet (`INSTALL [for install and make selectable]`, F043415348554341524401) | **`6F00`** (gp: "INSTALL [for install and make selectable] failed: 0x6F00"), about 2 s |
| the tag | created (so for a moment it stood before the card's applet) |
| the registry then | the opener, the tag, package version 3.0; no card's applet; its `SELECT` `6A82` |
| the same create sent again, once, traced | `84E60C00 31 0AF0…01 0BF0…01 01 00 02 C900 00`, answered **`00 9000` in 1.18 s** |
| the tag deleted and made again, so that it follows the card's applet as the steps have it | `9000` |
| then | `SELECT` `0300`; `GET_INFO` `03 00 80 00 00 80 FF 00 04 03 …` fresh; the tag `getfoxy.io/card#new` |

The refusal came at the first create on a freshly loaded package, and the second create of the same applet worked with nothing
changed in between. That makes it the J3R180's `6F00` at the create (the 2.2 file of 2026-11-06, the study builds at 135 and 153
past 256) seen as **not deterministic** on this chip at 175 past. Whether it was memory or size cannot be told from one refusal.
The 2.3 file of the same evening (40,635 bytes, 187 past) and 190c5ab (41,205 bytes, 245 past) were each created at the first
try on this card, three times each. The 190c5ab install at the end of this run was created at the first try too.

## The checklist

| Item | Result |
| --- | --- |
| `selftest` | 13 of 13 on the fresh 3.0 card (`SELECT applet — version 3.0`); 14 of 14 with the PIN after the money items |
| The first `SET_CARD` | 2,003 ms after the install; 1,544 ms after each owner's reset (four times) |
| Set-up | cardctl's set-up in one selection, five times. Each time c was read back and checked against `GROUP_KEYS`: the 1st to the 6th owner's c this card has taken |
| A keyset taught at set-up | in the set-up's own selection: the card worked out testnut's ID; 1,066 ms (8 commands), five times |
| First load, 45 real pieces in one selection, the 04 form, the mint's proof kept, no teaching | five times; the balance the 2,555 sats minted each time |
| Real signatures | every payment's signature good under BIP-340 under P + t·G and not under P (`AUTH` too, in `selftest`). Testnut took every swap that was posted, inputs `SPENT` |
| Real change | every change output written back with `LOAD_CHANGE` in a new tap with no PIN, `UNSPENT` at testnut with its proof (DLEQ) by testnut's key: 2 outputs in each of the five cycles, 1 from D225's waiting payment, 2 from the refusal payment |
| Refusals, `LOAD_CHANGE` | C_ y + 1, y + 2, x + 1, zeros, prefix `03`, x = p; K y + 1, y + 2: `6A80` in 51 to 96 ms. The proof's e changed: `6A80`, 460 ms. Both openings still owed after, then written back right |
| Refusals, the 04 form of `LOAD_PROOF` | 17 points off the curve `6A80`; wrong lengths `6700`; nothing stored (29 unspent, balance 628, before and after). Twelve real pieces in alternate forms: 04 form 140.6 to 145.6 ms, 33-byte form 138.5 to 144.1 ms |
| Sealed `VERIFY_PIN` | `GET_NONCE` P1 1 19.9 ms (the PIN key signed by the card's key, checked); `VERIFY_PIN` P1 01 `9000` in 127 ms; `GROUP_KEYS` opened by it |
| No payment floor | a payment within its limit, the first of its time in the field, signed at its first `SIGN`, five times out of five |
| Over the limit, and a second payment in a time in the field | both waited: 10 "not yet" each, five times out of five (below) |
| The holds | the history at the 7th asking (ten times); the reset by the PIN at the 17th after the history's 7 (five times); the owner's claim at the first asking right after the set-up's record (five times) |
| Hand-over | `cardctl set-owner` to a second key and seed: c read back, the 2nd owner's c; that owner's reset then `9000` |
| Left | 190c5ab put back, first try: `SELECT` `0203`, fresh and empty, `selftest` 13 of 13, the tag `getfoxy.io/card#new`, the registry as before (package 2.3) |

Not run: the clock items of D200 to D204 (the anchored resets, the back form of `REFRESH`, `INBOX` by week, the hardest's bits),
the day of loads near 300, dated pieces, the largest payment of eight change outputs, `LOCK_CARD`, tears, the certificate, a
dollar card, a phone and a production mint.

## The round-two and round-three fixes on the chip (D225, D226)

| Check | What was sent | Answer |
| --- | --- | --- |
| D225: the card's change after the first `SIGN` | a second payment in the time in the field (it waits); after the first `SIGN`'s "not yet", `SPEND_ALL_CHANGE` | **`6985`** in 10.8 ms. The next `SIGN` `6985`: the payment given up. Unspent and spent as before, no change owed, no opening |
| D225: an output after the first `SIGN` | as above, `SPEND_ALL_OUTPUTS` after the first "not yet" | **`6985`** in 10.9 ms; the next `SIGN` `6985`; nothing burned, nothing owed |
| D225: an honest waiting payment | the second payment with its change named before the first `SIGN` | signed after 10 "not yet" (5.46 s): change owed 1, a new record (`GET_OUTBOX`). Testnut took it; the change written back with no PIN |
| D225: `6AA0` at the signing `SIGN` | | not reachable on a chip: rule (1) leaves no shape to change. In the simulator only (`ShapeAfterSignTest`, by setting the stage) |
| D226: made-up keysets in the set-up's selection | `cardctl setup`, testnut taught, then six made-up keysets, all in the one selection | `9000`, `9000`, then `6A9C` x4: **two** in. `GET_INFO` byte 49 = 2 (the two count), byte 48 = 3 |
| | the next tap with the PIN and `CLEAR_SPENT`; and the tap after | both made-up keysets gone. Testnut's set-up entry stays, never loaded, not counted (byte 49 = 0) |
| D226: a hand-over lets the set-up entry go | `cardctl set-owner` (the old owner's key, a new key and seed) on the card whose testnut entry waited for its first piece | `GET_CARD` P1 2 after it: **0 entries** (one before) |

## F1, F3 and F5 again, and F2's part a chip can show

All as in the 2.3 run of the same evening, with the same answers:

- **F1, the red team's order:** a till's tap planted one keyset beside the loaded testnut entry, and the next was `6A9C`. Its
  own tap's reclaim kept it. The holder's next tap's reclaim let it go, and the new keyset B was taught `9000` and loaded `9000`.
- **F1, the proof's order:** B's piece was paid away. The till planted `junk4` (`9000`). The holder's straight load of a new
  keyset C, with the PIN alone, was `9000` and let `junk4` go. With B still holding a piece both were `6A9C`, which is the cap of
  two.
- **F3:** testnut taught again with its own keys: `9000`, the same ID. Other keys under its 8 bytes: `6A80` at the finish.
- **F5:** each refused **`6AA0`** at the first `SIGN`, in 8.6 to 8.8 ms:
  - 33 made-up pieces with the card's change;
  - 16 till outputs and the change (17 outputs);
  - an output of 0.

  After each:
  - the counts were as before, nothing was owed, and no opening was drafted;
  - the scope of `GET_OUTBOX` was byte for byte as before;
  - `SPEND_ALL_AGAIN` still gave the earlier signature;
  - the real pieces named were `UNSPENT` at testnut.
- **F2:** 33 pieces with no change signed in 785 ms, and `GET_OUTBOX` then answered `6A88`: the earlier record was let go. A tear
  is in the simulator only.

## The signer on the chip

- Every signature checked out under its key. Each payment verified under BIP-340 under P + t·G, and not under P; `AUTH` under
  P (`selftest` 13 and 14 of 14). The card checks each signature itself before it leaves (D207 and D218), and none was refused.
- **The chip path, not the bytecode product, was in use after set-up.** The card exposes no status for it (`chipMul` and
  `fieldP` are internal), so this is told by time:
  - on the fresh card, before any `SET_CARD` (`chipMul` still false), `AUTH` took 707 ms (median of 5);
  - after the set-up it took 490 ms, in every one of the five cycles, in `selftest` (490.0 to 490.6 ms) and in `cardctl auth`
    (490.0 ms x 3);
  - the review's figure for the bytecode product after a failure is about 0.4 s more a signature. 490 ms is 2.3's chip-path
    time less the one point operation the review counted (2.3: 505 to 511 ms on this card).
- The open item C1 (one chip-path failure leaves the bytecode on until the next `SET_CARD`) was not seen: no signature here took
  the longer time.

## The other maintainer's parts (D208, D211's shorter history)

- **D208, the PIN alone arms nothing:**
  - Set-up was a card with no owner, `SET_LIMIT_PIN` in its first set-up: day 100,000, payment 2,000, allowance 500, no 24-hour
    window. The allowance was armed (`GET_CARD` byte 78 = 1, read with the PIN).
  - A no-PIN payment of 256 signed. A second no-PIN payment of 256 was **`6A9E`**: the allowance was used up.
  - A tap with `VERIFY_PIN` and nothing else: byte 78 = **0**. A no-PIN payment in the next tap was still **`6A9E`**. Under 2.3
    the PIN would have armed it here.
  - A held tap (the PIN and the history held to its 7th asking, no payment): byte 78 = **1**. The no-PIN payment in the next
    tap **signed** (746 ms).
- **D211, the shorter history:** `9000` at the **7th** asking, 6 held: 2.78 to 2.85 s, ten times.

Read without the PIN, byte 78 says 0 whatever it holds (zeros to a reader with neither the PIN nor the grant). Every reading
above was made with the PIN.

## The rotating tag (D222) on the chip

- Six reads of the tag of the set-up card, each after a reset. Each was `https://getfoxy.io/card#` plus 48 lowercase hex
  characters (NLEN 69), **all six different**.
- In each, M (the last 8 bytes) was HMAC-SHA256 under K = SHA-256(`CashuCard/tag-address` ‖ c) of R, with the owner's c: true
  six times out of six. A whole tag read takes 91 ms.
- A new or reset card's tag read `#new`.
- **A tag read in the middle of a payment:**
  - A payment was begun under the PIN, the outputs sent, then the tag selected and read whole (its code rotated). Then the card's
    applet was selected again (`0300`).
  - `SPEND_ALL_SIGN` answered **`6985`**: the payment was given up.
  - The counts were as before (29 unspent, 66 spent), no change was owed, and the pieces were `UNSPENT` at testnut.
  - The same two pieces were then paid in a new tap and signed at once; testnut took the swap.

## Timings: the wait the card chooses and its work, five times each

Each "not yet" is the chosen wait; every other command of the payment is work. Reader round trips.

| Payment | "not yet" (count; ms each) | Chosen wait | Work (median of 5, range) | Work per command (median) |
| --- | --- | ---: | ---: | --- |
| within the limit: 9 pieces, 7 till outputs, 1 change output, the first of its time in the field | 0, 0, 0, 0, 0 | 0 | **1,525 ms** (1,509 to 1,532) | `BEGIN` 175; `OUTPUTS` 86 x2; `CHANGE` 241; `SIGN` 939 |
| a second payment in one time in the field: 2 pieces, 1 output | 10, 10, 10, 10, 10; 462 to 482 ms, median **462** | **4,630 ms** | **823 ms** (823 to 835) | `BEGIN` 110; `OUTPUTS` 32; `SIGN` 681 |
| over the limit: 17 pieces, 2,158 leaving against 2,000, 6 till outputs, 1 change output | 10, 10, 10, 10, 10; 462 to 484 ms, median **463** | **4,632 ms** | **1,750 ms** (1,728 to 1,770) | `BEGIN` 255; `OUTPUTS` 140; `CHANGE` 220; `SIGN` 1,119 |

**First load, 45 pieces in one selection** (five times; no chosen wait):

| Step | 3.0, median of 5 |
| --- | ---: |
| `AUTH` | 490.1 ms |
| `VERIFY_PIN` sealed / `GROUP_KEYS` | 127 to 133 ms / 76.5 ms |
| one `LOAD_PROOF` (min / median / max) | 108.8 / 116.4 / 125.8 ms |
| `LOAD_PROOF` #2 to #45 | 5,124 to 5,126 ms |
| the whole contact | **6.20 s** (6.19 to 6.21) |

**Set-up** (cardctl's set-up in one selection, then the keyset taught in it; five times):

| Step | 3.0 | Kind |
| --- | ---: | --- |
| `SET_CARD` (the record and the engines' self-tests) | 1,544 ms (2,003 after the install) | work |
| `GET_NONCE` P1 1 (the PIN key made and signed) | 481 to 492 ms | work |
| `SET_OWNER` P1 01 | 118 to 124 ms | work |
| the claim, `SET_OWNER` at its one asking (D221) | 833 ms | the hold, one asking |
| `SET_PIN`, `VERIFY_PIN`, `GROUP_KEYS`, reads | 24, 22, 76, about 105 ms | work |
| the keyset taught (8 commands) | 1,066 ms | work |
| **in all** | **4.55 s** (3.49 s of set-up and 1.07 s of teaching; 5.00 s the first time, after the install) | |

**The holds:** the history 6 x 462 to 463 ms, 2.79 s in all. The reset by the PIN 16 x 473 to 485 ms then `9000` at the 17th,
7.80 to 7.98 s; 10.6 to 10.8 s with the history's.

## 3.0 against 2.3 on the same card

Sources for 2.3: the speed study of the same night (`speed-study-2026-11-19`, 190c5ab) and the card23-fixes run on this card
the same evening (40,635 bytes).

| Measure | 2.3 | 3.0 | Difference |
| --- | ---: | ---: | ---: |
| each "not yet" (a wait's signature) | 488 ms (study, n = 108); 495 ms (2.3 run, n = 30) | 462 ms (n = 100) | **−26 to −33 ms** |
| a held asking, the history | 495 ms (2.3 run) | 462 to 463 ms | **−32 ms** |
| a held asking, the reset by the PIN | 505 ms (2.3 run) | 473 to 485 ms | −20 to −32 ms |
| `AUTH` after set-up | 505 ms (study); 511 ms (2.3 run) | 490 ms | **−15 to −21 ms** |
| `AUTH` on a fresh card | 738 ms (2.3 run) | 707 ms | −31 ms |
| `GET_NONCE` P1 1 at set-up | 507 ms (study) | 481 to 492 ms | −15 to −26 ms |
| a signing `SIGN`: 1 piece, 5 outputs, no change | 691 ms (2.3 run) | 720 ms | **+29 ms** |
| a signing `SIGN`: 2 pieces, 1 output, no change | 657 to 667 ms (the night run, 190c5ab) | 681 to 684 ms | **+17 to +27 ms** |
| a signing `SIGN`: 33 pieces, 4 outputs, no change, no record | 761 ms | 785 ms | +24 ms |
| `LOAD_PROOF` a piece, first load | 116.5 ms (2.3 run); 109 ms (study, the app's own load) | 116.4 ms | none |
| first load of 45 | 6.22 s | 6.20 s | none |
| `SET_CARD` / the keyset taught / the claim | 1,537 / 1,071 / 823 ms (study) | 1,544 / 1,066 / 833 ms | about none |
| `LOAD_CHANGE` | 529 to 540 ms (2.3 run) | 530 to 556 ms (n = 13) | about none |

- **The review's count holds on the chip.** One fewer point operation in each wait, held asking and `AUTH` shows as 15 to 33 ms
  less each, about 5 to 7 percent.
- **The payment's own signature costs a little more, not the same.** The signing `SIGN` is 17 to 29 ms longer in 3.0 for the
  same shape. The review counted the same point operations there, plus one byte more in the commit (D224).
  - The extra is consistent with D225's checks at the signing `SIGN` and the shape's fixing, but that was not measured apart.
- **For the keeper's flows:** the wait of a second payment or of one over the limit is 10 askings either way, so it is about
  0.3 s shorter in 3.0 (4.63 s against about 4.9 s). A payment within the limit is about 20 to 30 ms longer.
- The 2.3 formula from the study (`SIGN` 573 ms + 5.7 ms a piece) is for that study's shapes. On this card, `SIGN` also grows with
  the outputs and the card's change (939 ms for 9 pieces, 7 outputs and 1 change output; 1,119 ms for 17 pieces, 6 outputs and
  1 change).

## What the chip did that the simulator does not

- **The `6F00` at the first create of the card's applet**, then the same create taken. The simulator has no such limit.
- **The alternate-form loads in the refusals' tap took 139 to 146 ms a piece**, against 116 ms in a first load on the same card
  the same night, and 117 to 125 ms for the same script on 2.3 earlier that evening. Those loads went into places past 80 on a
  card with 66 places spent; the 2.3 run's went into places 17 to 28. The bad-change refusals were about 15 ms slower each in the
  same state.
  - Inference, not measured: the card's work per load grows with the places in use, likely the scan for a piece already held.
- Neither touches money or the fixes.

## The card at the end

190c5ab was put back at the first try: load 9 s, the card's applet 1 s, the tag 1 s. The card answers `SELECT` `0203`:

- fresh and empty: no PIN, no owner, no record, 0 unspent, 0 spent, balance 0;
- `selftest` 13 of 13; the tag `getfoxy.io/card#new`;
- the registry: the opener, the card's applet, the tag, package 2.3;
- the install script read serial 58206920 and an empty card before it.

**Not as found:** a fresh install has no clock, where the card had the speed study's 976,686 time.

## What ran where

- **On the chip:** everything in the tables above.
- **In the simulator only:**
  - F2's tear;
  - F3's `6A9D` (a 56-bit match);
  - D225's second line (`6AA0` at the signing `SIGN`);
  - D226's relay that teaches first, and a card with no owner teaching both units under a held tap;
  - F1 with a held tap on a card with no owner filling five marked entries;
  - the C1 slowdown after a chip-path fault.
- **Not run at all:** the items listed under the checklist.

## Logs

On the bench machine's backup drive, `chiprun-merge30`:

- the install and the registry: `install-merge30.log`, `create-retry.log`, `registry-*.log`;
- set-ups and D226: `phaseA.log`;
- the five cycles: `setup-C*.log`, `firstload-C*.log`, `h/f5-C*-{within,second,over}.log`, `h/chg-C*.log`;
- D225: `h/d225-C1.log`; F5 and F2: `h/f5-R*.log` and `h/f5-N33.log`; F1 and F3: `f1.log` and `f1b.log`;
- refusals: `refusals-C1.log` and `h/bad-P2.log`;
- the tag: `tag30.log` and `h/f5-MID*.log`;
- D208 and the holds: `phaseC*.log`;
- `sealed-pin.log`, `selftest-*.log`, `install-restore.log`.

## The install rate test (2026-11-20), stopped at its second file by a create that went mute

The keeper approved about 120 install cycles on the same card, to measure how often the card's applet is refused at its first
create. The plan was three files interleaved A, B, C for 30 rounds, then 30 creates and deletes of file A's instance alone.

| File | What it is | Load file |
| --- | --- | --- |
| A | merge-3.0 at 1ad208d, padded to 190c5ab's place | 41,973 bytes, 245 past a multiple of 256, sha256 `2b9c6b02…fcab`. The rebuild from `git archive 1ad208d` gives the same hash; the tracked CAP was sent |
| B | merge-3.0 at e2aac64, the file of the run above | 41,903 bytes, 175 past, sha256 `e4b5cff0…a250` |
| C | 190c5ab | 41,205 bytes, 245 past, sha256 `6f0e3a06…de8d` |

**How each cycle was run:** one GlobalPlatformPro call a step, each its own secure session with the default test key, and
every command's status word and time logged.

1. The serial, read again (58206920), and the card's emptiness.
2. Delete everything.
3. Free memory (`GET DATA` FF21, with no secure channel).
4. Load with the opener.
5. Create the card's applet; free memory.
6. Create the tag; free memory.
7. `SELECT` and `GET_INFO`.

**What happened:**

| Cycle | Create of the card's applet | Then |
| --- | --- | --- |
| round 1, A (245 past) | **`9000` at the first try**, 1,244 ms | the tag `9000` (215 ms); `SELECT` `0300`, `GET_INFO` `9000` |
| round 1, B (175 past) | **`6F00` at the first try**, 1,266 ms | `GET STATUS`: no instance of the card's applet, the opener alone |
| round 1, B, the one retry in a fresh secure session | **no answer**: the reader gave up after **8.36 s** (`SCARD_E_NOT_TRANSACTED`) | **STOP**, as the rules say for a create that goes mute |

**After the stop:**

- The card answered at once: the reader saw the ATR again, the CPLC read 58206920, and the card manager answered `SELECT` and
  `GET DATA` FF21.
- There was no instance of the card's applet (`6A82`); the package and the opener were still loaded.
- Nothing more of the test was run. The card was then put back on C (below).

**B's first create on this card has now been refused twice out of two** (this test, and the run above). Its retry was taken the
first time (1.18 s) and went mute the second. A was created at its first try (once out of once). C was created at its first try
on this card every time: three times on 2026-11-19 and once more here.

### What the free memory says

| Point | Free persistent (82) | Free transient (83) | Applications (81) |
| --- | ---: | ---: | ---: |
| an empty card (the card manager alone), before every load, four times | 174,956 | 3,918 | 1 |
| A: after the card's applet / after the tag | 100,912 / 100,644 | 2,229 / 2,213 | 3 / 4 |
| B: after the refused create | 135,044 | **3,918** | 2 |
| B: after the retry that went mute | 135,168 | 3,918 | 2 |
| C: after the card's applet / after the tag | 101,612 / 101,344 | 2,229 / 2,213 | 3 / 4 |

- **A refused create gave all the transient memory back** (3,918, as with no applet). The persistent memory it left, 135,044,
  is what the loaded package and its opener take. That is the same as A's state after its load: A's create was taken from about
  that much and used about 34,000 of it. The refusal left nothing behind that can be seen.
- **The card was not short of memory.** About 135,000 bytes were free at B's refused create, and A's create needs about 34,000
  persistent and 1,700 transient.
- After the mute retry, 124 bytes more were free than after the refused create, and still nothing was created. That is not
  explained.
- **No drift:** an empty card read 174,956 / 3,918 every time; a card on C with its tag read 101,344 at the start of the test and
  101,344 at the end.

### Conclusion

- **The test was stopped by its own rule at its fourth cycle,** so it gives no rate.
- **What it does show is narrow but plain:**
  - On this chip, B's file (175 past) was refused at its first create in both cycles tried. Its retries were taken once and
    went mute once.
  - A (the same software padded to 245 past) and C (245 past) were taken at their first create in every cycle tried: A once, C
    four times on this card.
  - Memory is not the cause: there was room, and the refusal returned everything.
- **This is consistent with the reviewer's reading,** that the card manager reacts to the load file's size or place, but it
  rests on very few cycles.
  - B failing 2 of 2 says the refusal is not rare for B. With 2 trials it bounds nothing else.
  - A's single success bounds A's refusal rate at almost nothing. One success rules out only a rate near 100 percent; at 95
    percent confidence it says only that the rate is below about 95 percent.
- **The mute retry is new and is the more serious finding.** A create that gets no answer leaves the reader and the phone not
  knowing what happened. Here the card was left whole, with no instance.
- **Before the rate test is run again,** decide whether B is dropped from it. A and C alone keep any create away from the place
  that went mute.
- **The card's behaviour did not change over the run**, as far as these cycles show: the same memory figures, the same create
  times (1.21 to 1.27 s), and the same answers to `SELECT` and the card manager after the stop.

### Also written to the card, outside the test's cycles

- Before the test, while checking how gp deletes, I deleted the tag and the card's applet of the card's 190c5ab. The card was
  empty, and every cycle begins by deleting everything.
- A trial of round 1 stopped at file A's load. My log counted `GET STATUS`'s `6A88` (an empty listing) as a failure; it was not
  the card's. It was corrected and round 1 run again.

### The card at the end

- C (190c5ab) loaded and created at the first try: card's applet 1,215 ms, tag 210 ms.
- `SELECT` `0203`, fresh and empty (0 unspent, balance 0, no PIN, no owner), `selftest` 13 of 13, the tag
  `getfoxy.io/card#new`.
- The registry: the opener, the card's applet, the tag, package 2.3.
- Free persistent memory as at the start (101,344).

Logs: `rate.jsonl` and `rate-trial.jsonl` in the backup drive's `chiprun-rate` folder, with the driver `rate.py`.

### The rate test run again with A and C only (2026-11-20): 60 of 60 first-try creates, 30 of 30 instance creates

File B (175 past) is finished and was not sent again; its CAP was renamed in the run's folder so the driver could not reach it.
The same card, the same driver, the same stop rules, and nothing sent to the card outside the planned cycles.

**The rounds:** 30, interleaved A, C, A, C ….

- **Each cycle:**
  1. the serial read again (58206920) and the card checked empty;
  2. delete everything, then read free memory;
  3. load with the opener;
  4. create the card's applet, then read free memory;
  5. create the tag, then read free memory;
  6. `SELECT` and `GET_INFO`.
- Every gp call was a fresh secure session with the default test key. No authentication failed.

| File | Card's applet: first-try `9000` | Its create (min / median / max) | Tag create | Load (170 / 167 blocks) | `SELECT` |
| --- | ---: | ---: | ---: | ---: | --- |
| A, 1ad208d, 41,973 bytes, 245 past | **30 of 30** | 1,243 / 1,244 / 1,246 ms | 214 to 216 ms | 8.37 to 8.57 s | `0300 9000`, 30 of 30 |
| C, 190c5ab, 41,205 bytes, 245 past | **30 of 30** | 1,214 / 1,215 / 1,216 ms | 209 to 210 ms | 8.24 to 8.43 s | `0203 9000`, 30 of 30 |

No `6F00` and no retry. No create took longer than 1,246 ms.

**A's instance alone:** the package and its opener were loaded once, then the card's applet was created and deleted 30 times.

- Creates: **30 of 30** `9000` at the first try, 1,243 to 1,244 ms, each followed by `SELECT` `0300` and `GET_INFO` `9000`.
- Deletes: 30 of 30 `9000`.

**Free memory, the same at every reading:**

| Point | A | C |
| --- | --- | --- |
| an empty card, before each load (30 + 30 + 1) | 174,956 / 3,918 | 174,956 / 3,918 |
| after the card's applet | 100,912 / 2,229 (30 of 30) | 101,612 / 2,229 (30 of 30) |
| after the tag | 100,644 / 2,213 (30 of 30) | 101,344 / 2,213 (30 of 30) |
| package and opener loaded, no instance (the instance test: at its start and after each of 30 deletes) | 135,156 / 3,918 | |

(Persistent / transient bytes.)

- Not one byte of drift over 60 full cycles and 30 instance cycles.
- An instance's delete gives back exactly what its create took: 34,244 persistent and 1,689 transient bytes.
- On B's refused create, earlier: B's package is 70 bytes smaller than A's, so it would leave about 135,226 bytes free with no
  instance. The refused create left 135,044, and 135,168 after the mute retry.
  - That suggests the refusal kept about 180 bytes of persistent memory, and the retry gave some of it back.
  - B was never read straight after its load, so this is an inference, not a measurement.
  - The transient memory was all given back.

**Conclusion:**

- With 30 of 30 first-try creates, the true first-create failure rate is below about 10 percent at 95 percent confidence, for
  each of A and C. Taken together, 60 of 60 bounds it below about 5 percent.
- A's instance alone was 30 of 30, below about 10 percent at 95 percent.
- B, the same software at 175 past, failed its first create 2 of 2 times on this card, and its retry went mute once.
- This is strong evidence that the refusals belonged to B's place (175 past a multiple of 256) on this chip and not to 3.0's
  code. It does not prove that 245 past never fails.
- **The card's behaviour did not change over the run:** the same create times to the millisecond, the same memory figures, the
  same answers.

**The card at the end:**

- 190c5ab loaded and created at the first try: card's applet 1,215 ms, tag 210 ms.
- `SELECT` `0203`, fresh and empty (0 unspent, balance 0, no PIN, no owner), `selftest` 13 of 13, the tag
  `getfoxy.io/card#new`.
- The registry: the opener, the card's applet, the tag, package 2.3.
- The install script read serial 58206920 before each install.

Logs: `rate2.jsonl` (the rounds), `rate3.jsonl` (the instance test) and `rate-restore2.jsonl`, in the backup drive's
`chiprun-rate` folder.
