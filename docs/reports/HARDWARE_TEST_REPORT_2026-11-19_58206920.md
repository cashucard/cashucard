# Protocol 2.3 with D219 and D220 on the reader's sample card 58206920: the chip run of card23-fixes (2026-11-19)

The 2.3 file of `card23-fixes` (6864627): [D219](../DECISIONS.md#d219) (a keyset taught and never loaded is kept only where the card's
first set-up entered it or this time in the field taught it; keys already taught are replaced only under the holder's say, `6A9D`) and
[D220](../DECISIONS.md#d220) (a payment that makes the card's own change is refused `6AA0` at its first `SIGN` for more than 32 pieces, a
seventeenth output or an output of 0; the last payment's settlement record let go in the payment's own commit), added to the file of
4d057fb (D215, 40,412 bytes). Its load file, **40,635 bytes, 187 past a multiple of 256**, a size never tried on a chip before, installed
at the first try, twice. The card was set up as cardctl sets one up, 45 real pieces minted at a FakeWallet test mint (fake sats) were
loaded in one selection, paid with change, and the change written back with no PIN. Then D219 and D220 were tried on the chip with
made-up keysets and made-up pieces. **Every check passed. The chip showed nothing the simulator does not.** The card was then put back
on the program it held before the run.

## Environment

- Card: the reader's sample card. CPLC ICSerialNumber **58206920**, ICType D321, fabricated 2022-12-11, batch 4839. ATR
  `3BFA180000910131FE454A33523331302D333535FF`, whose historical bytes read "J3R310-355". GlobalPlatform 2.3, SCP03 with AES-128
  keys, version 1: not the SCP02 J3R180s of the earlier reports (09312320, 09301220). The public default test key, as in the
  runs of 2026-11-18 and 2026-11-19 on this card: one authentication (the registry listing) before anything was written, then the
  installs.
- Reader: ACS ACR39U, contact. Times are the reader's round trip.
- Tools: GlobalPlatformPro (`gp.jar`, Java 25), `tools/cardctl` of this branch (pyscard 2.3.2, Python 3.9), `tools/chip`'s
  ChipBridge (JDK 17) with the night runs' harness, and short scripts of the run's own for D219 and D220.
- Mint: `testnut.cashu.space`, CDK mintd 0.18.1, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.
- Block header: real mainnet header 975,859.
- Owner: cardctl's TEST key, a made-up owner seed, a made-up refund key, the PIN 1234.

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) |
| --- | --- | --- |
| `card23-fixes` at 6864627, built from `git archive` with ant-javacard v26.05.15, JDK 17 and the jc305u4 kit | CAP `54531ff398b1acd26386834ea82d53bda1192e09feb609434dd1363a4c49b4e2` (169,182 bytes) | **40,635 bytes** (187 past a multiple of 256), sha256 `e2aa82444d2751ac8dca0f974cacb199575d335d43e01cb984fd80e02838ab4c`, the builder's hash |
| 190c5ab (the program found on the card), built the same way, put back after the run | CAP `5c4a98e1f7f00758f11e7a7d2db4e17a216626562b48e33e16c40ed7c0dc1708` | 41,205 bytes (245 past), sha256 `6f0e3a06413fb06b421c88062bf7624a167d562fce915571bc8a0af67560de8d` |

The tracked CAP was not touched; the build ran in a copy outside the repository.

## Before anything was written

| Check | Found |
| --- | --- |
| The reader and the card | "ACS ACR39U ICC Reader"; ATR as above |
| The card's identity (`gp --info`, no secure channel) | ICSerialNumber 58206920 (the install script refuses any other serial, and read it again before each install) |
| What it held (`SELECT`, `GET_INFO`, `GET_BALANCE`, no PIN) | `0203`; 2.3, 128 places, 0 unspent, 0 spent, no PIN, no owner, no record; balance 0. The tag read `getfoxy.io/card#new` |
| The registry (the one authentication) | the opener, the card's applet, the tag, package `F0434153485543415244` version 2.3: the program 190c5ab left by the night runs, fresh |

## The first load of 45 pieces (one selection, the 04 form, the mint's proof kept, no teaching in the selection)

| Step | This card, this file | J3R180 09301220, D211 to D214 (2026-11-14, fifth run) |
| --- | ---: | ---: |
| `SELECT` | 17.4 ms | 22.1 ms |
| `GET_INFO` (the read) | 29.4 ms | 42.3 ms |
| `AUTH` | 510.8 ms | 531.7 ms |
| `GET_NONCE` P1 1 (the PIN key) | 20.0 ms | 45.2 ms |
| `VERIFY_PIN` sealed (P1 01) | 132.9 ms | 144.4 ms |
| `GROUP_KEYS` (date 0) | 76.5 ms | 99.9 ms |
| `LOAD_PROOF` #1 | 115.2 ms | 150.5 ms |
| `LOAD_PROOF` #2 to #45 | 5,106.7 ms | 6,770.3 ms |
| `GET_INFO` (the final read) | 29.5 ms | 43.0 ms |
| `GET_BALANCE` | 65.3 ms | 68.9 ms |
| **The whole contact** | **6.22 s** | **8.03 s** |
| One `LOAD_PROOF` (min / median / max) | 108.5 / 116.5 / 125.5 ms | 146.2 / 153.3 / 163.4 ms |

The balance was the 2,555 sats minted, in 45 unspent pieces. Twelve more real pieces loaded alternately: the 04 form 120.7 to
125.1 ms (mean 122.9), the 33-byte form 116.8 to 124.7 ms (mean 120.4). On the same card on 2026-11-18 (the D215 file, the load
split), a `LOAD_PROOF` had a median of 116 ms and 45 pieces took 5.2 s, so D219 and D220 cost nothing measurable in a load.

## Timings against the earlier run

| Step | This card, this file | J3R180, 2026-11-14 fifth run |
| --- | ---: | ---: |
| install: load and opener / card's applet / tag | 9 to 10 s / 2 to 3 s / 0 to 1 s (three installs) | 17 to 18 s / 1 to 3 s |
| first `SET_CARD` | 1,991 ms | 2,033 ms |
| `cardctl setup` (PIN, record, header, the owner's claim, c read back) | 4.11 s | (3.44 s on 2026-11-15 with D215) |
| `SET_OWNER`, the claim at the first asking (D215) | 826 ms | 858 ms |
| the keyset taught (`cardctl keyset-keys`, the process included) | 1.26 s | 1.53 s |
| `AUTH` (`selftest`; fresh card / after set-up) | 738 / 511 ms | 532 ms |
| a payment of 9 pieces, 3 till outputs, 5 change outputs: `SIGN` / `BEGIN` to the signature | 930 ms / 2.60 s | 942 ms / 2.46 s |
| `SPEND_ALL_CHANGE`, one output | 213 to 365 ms | 226 to 258 ms |
| a payment of 3 pieces, 6 change outputs: `SIGN` / `BEGIN` to the signature | 793 ms / 2.42 s | |
| a payment of 1 piece, no change: `SIGN` / from `BEGIN` | 638 ms / 836 ms | (3 pieces: 705 / 962 ms) |
| 6 pieces, 16 outputs with the card's change: `SIGN` | 934 ms | |
| 28 pieces, 8 outputs, no change, the record written: `SIGN` | 1,357 ms | |
| 33 pieces, no change, no record (D220): `SIGN` | 761 ms | |
| 32 pieces with the card's change: the last `SIGN` (after 10 "not yet", see below) | 1,478 ms | |
| `LOAD_CHANGE` | 529 to 540 ms | 576 to 588 ms |
| `VERIFY_PIN` sealed / `GET_NONCE` P1 1 | 133 ms / 20 ms | 144 ms / 45 ms |

### The holds (counts of the card's signing work, D205): unchanged in seconds

| Hold | Count | This card | J3R180, 2026-11-14 fifth run |
| --- | ---: | ---: | ---: |
| the owner's claim right after the set-up's record (D215) | 1 asking | 826 ms | 858 ms (the claim) |
| the history of a card with a PIN, no owner | 7 askings | 6 x 495 ms (494 to 495), `9000` at the 7th: 2.98 s | 6 x 491 ms: 2.95 s |
| the reset by the PIN, after the history's 7 | 17 askings | 16 x 505 ms, `9000` at the 17th: 8.32 s; 11.3 s with the history's | 17 x 502 ms: 8.26 s; 11.3 s |

An asking is 0.49 to 0.51 s on this card, the same as on the J3R180 with D211 to D214. The held-tap counts need no change for this
chip.

## D219 and D220 on the chip

| Fix | What was sent | Answer |
| --- | --- | --- |
| **F1**, an owned card, the red team's order | a till's tap, the PIN alone: made-up keysets `junk1` to `junk3` (one key each) beside the testnut entry (loaded, unmarked) | `9000`, `6A9C`, `6A9C`: two unmarked at most; `CLEAR_SPENT` in the till's tap kept `junk1` (taught this time in the field) |
| | the holder's next tap, the PIN alone: `CLEAR_SPENT`, then the mint's "new keyset" B (six made-up keys) taught and a made-up piece loaded | the reclaim let `junk1` go (`GET_CARD` P1 2: one entry); B taught `9000`, loaded `9000` (`6A9C` before D219) |
| **F1**, the proof's order (no reclaim between) | a till's tap: `junk4` beside testnut (two unmarked); the holder's next tap, the PIN alone: a made-up piece of a new keyset C loaded straight, with no teaching | `junk4` `9000`; the load of C `9000`, and `junk4` gone from the table (`6A9C` before D219) |
| | the same with B still holding a piece (two live unmarked entries, each holding money) | `junk4` `6A9C`, C `6A9C`: the cap of two, as the spec says while older keysets hold pieces (not a fault) |
| **F1**, the set-up's entry (a card with no owner) | one selection: `SET_PIN`, `VERIFY_PIN`, `SET_CARD`, `SET_HEADER`, testnut taught | taught `9000`; `GET_INFO` P1 4 byte 48 = 1, **byte 49 = 0** (the set-up's entry not counted) |
| | a till's tap, the PIN alone: `junk11` to `junk13` | `9000`, `9000`, `6A9C`: two beside the set-up's entry |
| | three later taps, each with `CLEAR_SPENT` | the till's two gone; the set-up's testnut entry kept, never loaded (state `42`: in use, keys known) |
| **F3** | testnut, taught and loaded, taught again with its own keys, the PIN alone | `9000`, the same ID (the top kept) |
| | other keys under testnut's 8 bytes (their own ID is not testnut's) | `6A80` at the finish; testnut taught again after it `9000` |
| **F5**, 33 pieces with the card's change | 33 pieces, 4 till outputs, 1 change output | `SIGN` `6AA0` in 8.5 ms |
| **F5**, a 17th output | 6 pieces, 16 till outputs, 1 change output | `6AA0` in 8.6 ms |
| **F5**, an output of 0 | 3 pieces, till outputs 0 and 2, 1 change output | `6AA0` in 8.9 ms |
| | after each of the three | `GET_INFO`: unspent and spent counts as before, no change owed; `GET_CHANGE`: no opening; `GET_OUTBOX`'s scope byte for byte as before; `SPEND_ALL_AGAIN` the signature of the payment before (nothing signed); the named pieces `UNSPENT` at testnut |
| F5, the edges that sign | 6 pieces, 16 outputs with the change; 32 pieces with the change | both signed, good under P + t·G; testnut's swap `200`, every input `SPENT`; each change written back with no PIN, `UNSPENT` with its proof by testnut's key; `GET_OUTBOX` a new record each time |
| **F2** (its part a chip can show) | a record in place, then 33 made-up pieces paid with no change (a payment that leaves no record, D220) | signed (761 ms); `GET_OUTBOX` then `6A88`: the earlier payment's record let go |

What no chip run can show: **F2's tear**, a card pulled between the payment's commit and the record. The reader finishes every command
whole, and no software here can cut power in the middle of one. **F3's `6A9D`** needs other keys whose ID shares the keyset's first 8
bytes (a 56-bit match). **F1 on a card with no owner and a held tap** (a till filling five marked entries) was not tried. Those are in
jCardSim only: ChangeRecordTest, TillKeysetsTest, and the red team's RT23TearTest and RT23TableTest.

## The rest of the checklist

| Item | Result |
| --- | --- |
| Install | twice, three steps each (the opener, the card's applet, the tag), **created at the first try both times**; `SELECT` `0203`; `GET_INFO` fresh |
| `selftest` | 13 of 13 on the fresh card; 14 of 14 with the PIN after the money items (`AUTH` 511 ms) |
| Set-up | `cardctl setup` with the PIN, the record and refund key, the anchor, the TEST owner and the owner's seed: c read back, the 1st owner's c, checked against `GROUP_KEYS` |
| A keyset taught | testnut taught after set-up: the card worked out the same ID; the first load then had no teaching in it |
| Real signatures | every payment signed, BIP-340 good under P + t·G and not under P; testnut took every swap that was posted, inputs `SPENT` |
| Real change | 13 change outputs written back by `LOAD_CHANGE` in a new tap with no PIN, each `UNSPENT` at testnut with its proof by testnut's key (DLEQ checked) |
| Refusals, the 04 form of `LOAD_PROOF` | 17 points off the curve (the set-up's four, x on no point, the twist, G with y + 1 and y − 1, G's x with a wrong y, y = 0, x = p, y = p, x = p + 1, `04` and zeros, P-256's G, prefixes `03` and `06`): `6A80` in 30 to 47 ms; wrong lengths `6700`; nothing stored (unspent 28, balance 3,536, before and after) |
| Refusals, `LOAD_CHANGE` | C_ with y + 1, y + 2, x + 1, zeros, prefix `03`, x = p; K with y + 1 and y + 2: `6A80` in 36 to 81 ms; the proof's e changed `6A80` in 446 ms; all six openings still owed, then written back right |
| Sealed `VERIFY_PIN` | `GET_NONCE` P1 1 (the PIN key signed by the card's key, checked), `VERIFY_PIN` P1 01 `9000` in 133 ms, `GROUP_KEYS` opened by it |
| Holds | the table above |
| Left | 190c5ab put back (load file `6f0e3a06…`): fresh, `selftest` 13 of 13, the tag reads `getfoxy.io/card#new`, the registry as before the run |

Not run: the clock items of D200 to D204 (the anchored resets, the hand-over, `REFRESH`'s back form, `INBOX`, the hardest's bits), the
day of loads, the wait after a wrong PIN (no wrong PIN was sent), dated pieces, `LOCK_CARD`, tears, the certificate, a dollar card, a
phone and a production mint. None of them is touched by D219 or D220.

## Something about the tools: ChipBridge's tap did not reset this card

ChipBridge's `tap` (`disconnect(true)`, then `connect`) did not reset the card on this Mac this evening. A payment after a payment, with
bridge taps between, was treated as a second payment in one time in the field, and waited the 10 "not yet" of D205: the 32-piece edge
payment, and two 1-piece payments in a row (5.6 s each from the first `SIGN`). A reset made through pyscard
(`reconnect(disposition=SCARD_RESET_CARD)`) cleared it, and the next payment signed at once (638 ms). The card was right each time: those
payments were seconds apart with no reset between. Every check above that needs a new time in the field (all of D219's) used the
pyscard reset, and each was shown to have taken effect. The night runs' payments in one bridge process signed with no wait, so
something has changed since, whether on the reader's side or the system's. Before the bridge's taps are trusted again, check them with a
second payment.

## Against the earlier runs

- Against the J3R180 09301220 with D211 to D214 (2026-11-14, fifth run): this card loads about 25 percent faster (`LOAD_PROOF` 116 ms
  median against 153, a 45-piece first load in 6.2 s against 8.0). It signs in about the same time (`AUTH` 511 ms against 532, an
  asking 0.49 to 0.51 s against 0.49 to 0.58), and installs in half the time. The holds measure the same in seconds.
- Against this card's own runs of 2026-11-18 and 2026-11-19 (D215; the load split; the tag, outbox-lean and privacy trials): the same
  load times (116 ms a piece, 45 pieces in 5.1 s of loads), the same set-up (4.11 s against 4.13 s). The 6AA0 check adds nothing that
  can be measured to a payment that signs.

## Logs

The run's folder on the bench machine's backup drive (`chiprun-card23fix`): `info-before.log`, `state-before.log`, `tag-before.log`,
`registry-before.log`, `install-*.log`, `selftest-*.log`, `setup-F.log`, `flow-F.log`, `refusals-F.log`, `sealed-pin-F.log`, `f1.log`,
`f1b.log`, `f1c.log`, `fake33.log`, `h/f5-*.log` (F5, F2 and the payments), `h/pay-P2.log`, `h/bad-P2.log`, `h/change-P2.log`,
`registry-after.log`.
