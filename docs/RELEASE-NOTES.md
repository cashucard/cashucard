# Release notes

One entry per component release, newest first, as
[component releases](COMPONENT-RELEASES.md) asks: the manifest and these notes move
in the reviewed pull request, and the tag follows the merge. A GitHub release lists
the merged pull requests besides.

## `firmware-v3.1.0`: Cashu Card protocol 3.1 (not yet tagged)

The tracked CAP is `applet/target/cashu-javacard-3.1.0.cap`, sha256
`7a070ada1f2f50d2ee78f9393d48c7f99e3b31ed5807f21b3c5481d673127d0d`, its load file sha256
`9ed123597844573aae7fdb35af1b015a90b00b042acd7a66b95892b8688a7a8b`. `SELECT` and `GET_INFO` answer `03 01`, and
`GET_INFO` P1 = 4 bytes 55 and 56 `F7 03` as 3.0's ([D228](DECISIONS.md#d228)). It is
the 3.0 file below, with the security review's fixes of [D228](DECISIONS.md#d228), and with [D229](DECISIONS.md#d229)
(the limit on one payment a rate: two askings for every limit's worth past the first, with no larger first step; the
change's credit one for every two outputs) and [D230](DECISIONS.md#d230) (the second payment in a tap two askings at the
least, counted after the change's credit; the held history three, the reset by the PIN four), [D231](DECISIONS.md#d231)
(the set-up's self-tests once a set-up life (until a reset); with D228, `chipMulInit` there is the one writer of the chip
path's verdict), [D232](DECISIONS.md#d232) (the one-asking claim a blank card's alone) and
[D233](DECISIONS.md#d233) (a card's first PIN stands as given for the selection that set it). This exact file has run
only in a simulator so far, and no card has installed it. 330ffa1's file, from before the merge onto D228 (load file
`4014e7f1…`), was installed on the J3R310-355 sample card 58206920 and paid from at a test mint, testnut, on 2026-11-21
([the report](reports/HARDWARE_TEST_REPORT_2026-11-21_58206920_3.1.md)).

## `firmware-v3.0.0`: Cashu Card protocol 3.0 (not yet tagged)

The CAP was `applet/target/cashu-javacard-3.0.0.cap`, sha256
`0b17e232d394a7ce1885dcc395e38d6830cd4abf5097056052174a3f76b4f4a6`. Its load file,
the bytes a card is LOADed with, is 42,485 bytes by `tools/refcheck.py`'s measure,
sha256 `99a66ba7fdc1da0090b5361c98a315cfd591c5c7c43220d25410a04073262536`. `SELECT`
and `GET_INFO` answer `03 00`. The core is revision `03` of
[NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md). The decisions are
[D183](DECISIONS.md#d183) to [D228](DECISIONS.md#d228) (numbered 3.0 by
[D205](DECISIONS.md#d205); the decisions this repo's 2.3 files carried as D205 to D215 are D211 to D221
since the merge), and the wire is in [`spec/APDU.md`](../spec/APDU.md).

### On a chip

That file has run only in a simulator, and no card has installed it. Its source is
the merge of 2026-11-19: the 2.3 file of 2026-11-15 below (40,412 bytes, load file `05c9b847…`) with the version
moved from 2.3 to 3.0 ([D205](DECISIONS.md#d205)), the other maintainer's [D206](DECISIONS.md#d206) to
[D210](DECISIONS.md#d210) (each signature checked before it leaves, joined with [D218](DECISIONS.md#d218)'s chip
path; the no-PIN allowance armed by the owner's proof or a held tap and not by the PIN alone; `GET_INFO`'s paid-list
bit; `ALLOW_LOAD`'s length checked first), the rotating tag ([D222](DECISIONS.md#d222)) and the till keysets and
settlement record fixes ([D223](DECISIONS.md#d223) to [D226](DECISIONS.md#d226)), and the tag's address given by
whoever installs the card ([D227](DECISIONS.md#d227)): an install of the tag must now carry the card maker's address
in its install parameters, and one without is refused; and the security review's fixes of 2026-11-21
([D228](DECISIONS.md#d228)): one set-up bit a unit, the chip's path given up for one signature only, and `GET_INFO`
byte 55 bit 3 clear. Its run is to come, on a J3R180, its size first
([the checklist](HARDWARE_DEPLOYMENT.md#the-30-chip-runs-checklist)); no J3R180 has been given a 3.0 file.

The file before it (9ac55c1, load file `d69742d0…`, the tag's address at install and nothing of D228) went to the
J3R310-355 sample card 58206920 (ATR; ICType D321, SCP03) on 2026-11-21: 13 installs of 13 at the first try, its tag
taking the address at install, and a payment at a test mint (testnut) with real signatures and real change verified on
the chip ([the report](reports/HARDWARE_TEST_REPORT_2026-11-21_58206920_3.0-neutral.md)).

The last 2.3 file (answering `02 03`, 40,412 bytes, load file `05c9b847…`) ran on a chip on 2026-11-15: it is the file below (40,365 bytes, `8aefa0db…`) with [D221](DECISIONS.md#d221) added (the
claim right after the set-up's record is one asking; 47 bytes more, 220 past a multiple of 256). The bench J3R180 09301220
installed it three times in three steps (17 to 18 s to load, 2 s for the card's applet) and, at the testnut test mint with fake sats,
passed `cardctl selftest` 13 of 13, claimed the card at the set-up's first asking, and signed a 9-piece payment with change
(`tools/refcheck.py` keeps its size and its load file's sha256).

The file before it ran on a chip on 2026-11-14
([the checklist](HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist),
[its report](reports/HARDWARE_TEST_REPORT_2026-11-14e_J3R180_2.3.md)): it is the file before it (39,343 bytes, `c79b30a7…`) with
[D217](DECISIONS.md#d217) to [D220](DECISIONS.md#d220) added (the signature's product in two shares, so that no operand of the chip's RSA is a
function of the key alone; every signature checked on the card against the key before it leaves, a failing chip path redone by the bytecode;
the set-up's known answers made wider; a taught keyset kept until its first piece, a teaching's entry made at its end; 1,022 bytes more,
173 past a multiple of 256). The bench J3R180 09301220 installed it each time at the first try (17 to 18 s to load, 1 to 3 s for the card's
applet) and, at the testnut test mint with fake sats:

- took a first load of 45 real pieces in one selection with no teaching in it in 8.03 s (7.75 s on the file before), `AUTH` 532 ms (264):
  **every signature costs 0.27 s more**; a payment with five change outputs was signed 2.46 s after it began (2.23 s), a payment of three
  pieces with no change 0.96 s (0.71 s); every signature verified under BIP-340 and every swap taken, the change spent again;
- passed the set-up's known answers on the chip (the first `SET_CARD` 2.03 s, 1.78 s before), refused 17 bad points in the 04 form, the
  four of the set-up's new points among them, and a changed C_, K or proof at `LOAD_CHANGE`, each `6A80` with nothing stored; passed
  `cardctl selftest` 13 of 13;
- held the card longer in seconds, **at the same counts**: an asking is 0.49 to 0.58 s now (0.23 to 0.31 s before it), so the claim takes
  2.6 s (D211's target 3 s), the history 3.0 s (4 s) and the reset by the PIN 8.3 s, 11.3 s with the history's (15 s).

The file before D217 ran on a chip the same day: it is the file before D213 with
[D213](DECISIONS.md#d213) to [D216](DECISIONS.md#d216) added (a keyset taught at set-up; the field's arithmetic on the chip's RSA
with p padded to 64 bytes for the modulus; `LOAD_CHANGE`'s points held to the curve by the chip's key agreement; the signature's
e·d mod n on the chip's RSA with n padded, two squarings). The bench J3R180 09301220 installed it each time at the first try (17 s
to load, 2 s for the card's applet) and, at the testnut test mint with fake sats:

- took a first load of 45 real pieces in one selection with no teaching in it in 7.75 s (8.22 s on the file before, and 9.50 s
  with the teaching), the keyset having been taught at set-up (1.5 s);
- signed a payment with five change outputs at its first `SPEND_ALL_SIGN` 2.23 s after `SPEND_ALL_BEGIN` (3.96 s before), a change
  output made in 226 to 287 ms (443 to 676) and written back by `LOAD_CHANGE` in 577 to 587 ms (1,033 to 1,043), `AUTH` 264 ms
  (626) and a sealed `VERIFY_PIN` 144 ms (278); every signature verified under BIP-340 and every swap taken, the change
  spent again;
- refused 13 bad points in the 04 form, a twist point among them, and a changed C_, K or proof at `LOAD_CHANGE`, each `6A80`
  with nothing stored, the right answer then loading; passed `cardctl selftest` 20 of 20;
- ran the holds shorter in seconds: an asking was 0.23 to 0.31 s then (0.59 to 0.66 s before), so the claim (1.8 s), the history
  (1.4 s) and the reset by the PIN (about 6 s) are about 40 percent of the time D211 chose, at the same counts.

The file before D213 (37,269 bytes, `fe156f4f…`, D183 to D204, D211 to D212) ran on a chip the same day
([its report](reports/HARDWARE_TEST_REPORT_2026-11-14c_J3R180_2.3.md)): it is the file before D212 with
[D212](DECISIONS.md#d212) added (`LOAD_PROOF`'s 04 form: each piece's C sent whole, `04` ‖ x ‖ y, and held to the curve by
the chip's key agreement in place of the card's own square-root test). The bench J3R180 09301220 installed it five times,
each in three steps (16 to 17 s to load, 2 to 3 s for the card's applet, created at the first try every time), and, at a
FakeWallet test mint with fake sats:

- loaded a piece with its proof kept in 146 to 160 ms in the 04 form (P2 `0A`), against 226 to 240 ms in the 33-byte form
  (P2 `02`) on the same file;
- took a first load of 45 real pieces in one selection, as the app makes one (the read, `AUTH`, the sealed PIN, the date's
  keys, 45 `LOAD_PROOF`s with their proofs, the final read): 8.22 s in all in the 04 form and 11.82 s in the 33-byte form,
  9.50 s and 13.14 s with the keyset's keys taught in the same selection after the first piece (1.31 s);
- paid pieces loaded in either form at their first `SPEND_ALL_SIGN`, the mint taking every swap, wrote the change back with
  `LOAD_CHANGE` with no PIN and spent it again;
- refused ten points that are not the curve's in the 04 form with `6A80` (71 to 84 ms) and wrong lengths with `6700`,
  storing nothing;
- passed `cardctl selftest` 21 of 21.

Not covered by that run: the day of loads, dated pieces in the 04 form, a chip whose key agreement fails the set-up's test
(the simulator's tests cover both outcomes), `LOCK_CARD`, tears, the certificate, a dollar card, a production mint and a
phone.

The file before D212 (36,950 bytes, load file sha256 `075448e4…`, D183 to D204 and D211) ran on a chip on 2026-11-14
([its report](reports/HARDWARE_TEST_REPORT_2026-11-14b_J3R180_2.3.md)): it is the file before D211 with
[D211](DECISIONS.md#d211) added (no payment floor, shorter holds). A second bench J3R180 (not the card of the run
below) installed it twice, each in three steps (16 to 17 s to load, 2 s for the card's applet, created at the first
try), and, at a FakeWallet test mint with fake sats:

- passed `cardctl selftest` 20 of 20 (`AUTH` 631 ms);
- answered its first `SET_CARD` with `9000` (1.21 s);
- signed a plain payment at its first `SPEND_ALL_SIGN`, with no "not yet" (889 ms for the signature, 4.1 s from
  `SPEND_ALL_BEGIN` with five change outputs, 5.2 s with eight), the mint taking each swap, and paid on with the change
  loaded back with no PIN; a payment over the limit on one payment still waited (10 "not yet" for 150 with a limit of
  100, 14 for 250), and so did a second payment in a time in the field;
- held as D211 says: the owner's claim answered at the 4th asking (2.9 s), the history of a card with a PIN and no
  owner at the 7th (3.6 s), and the reset by the PIN at the 17th after the history's 7 (24 askings, 14.8 s in all);
- refused `LOAD_PROOF` with P2 `04`, `06` or `07` (`6B00`), and loaded a piece in 226 to 235 ms;
- kept what the run of the file before D211 showed of the clock, the owner's c and the refusals.

Not covered by that run: the day of loads (not rerun, the code unchanged), `LOCK_CARD`, a dated piece taken back after
its date by the refund key, a header far ahead or a weak clock, tears, the certificate, a dollar card, a production mint
and a phone.

The file before D211 (36,953 bytes, load file sha256 `f216644a…`, D183 to D204) ran on a chip on 2026-11-14
([the checklist](HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist),
[its report](reports/HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md)): the bench J3R180
installed it three times in three steps (16 to 17 s to load, 2 s for the card's applet)
and, at a FakeWallet test mint with fake sats:

- passed `cardctl selftest` 20 of 20 (`AUTH` 632 ms), and 21 of 21 with the PIN after;
- answered its first `SET_CARD` after each install with `9000` (1.22 s);
- took the first set-up's anchor ([D204](DECISIONS.md#d204)): an older header in the
  set-up's own selection, or a claim's anchor older than the clock, brought the clock
  back, and after a `SELECT` an older header moved nothing;
- read back the owner's c from a test seed at the claim and a second seed's at a
  hand-over ([D202](DECISIONS.md#d202)), the take-back key for a date matching the
  card's refund key for it;
- paid dated and undated pieces with its own change, the mint taking every swap, wrote
  the change back with `LOAD_CHANGE` with no PIN and paid it again; a payment with eight
  change outputs signed;
- kept the day of loads ([D200](DECISIONS.md#d200)): at none left, a load and a change
  output answered `6A8F`, and a payment with no change signed;
- brought its clock back to older real headers by the reset by the PIN, the owner's
  reset, a hand-over and `REFRESH`'s back form ([D201](DECISIONS.md#d201)), each
  refused with `6A8D` while a piece was on the card where it asks for an empty card.

Not covered by that run: `LOCK_CARD`, a dated piece taken back after its date by the
refund key, a header far ahead or a weak clock, tears, the certificate, a full paid
list, the PIN's waits, a dollar card, a production mint and a phone.

On 2026-11-13 a
J3R180 (the bench card the [deployment guide](HARDWARE_DEPLOYMENT.md) names) installed
the file before D200, numbered 2.3 then and answering `02 03` (35,466 bytes, load file
sha256 `48b8597c…`, which refcheck keeps as proven), in three steps (16 s to load, 2 s for the card's applet) and, at a
FakeWallet test mint with fake sats:

- passed `cardctl selftest` 20 of 20 (`AUTH` 626 ms through a contact reader);
- was set up in one selection; its first `SET_CARD` passed the chip framing check
  (1.03 s) and the claim's six askings took 4.1 s;
- loaded pieces under the PIN with the mint's proof (about 226 ms each);
- paid with the card's own change: one "not yet", the signature 3.9 s after
  `SPEND_ALL_BEGIN`, good under the date key and not under the card key, and the
  mint took the swap;
- wrote its change back with `LOAD_CHANGE` (about 1.03 s a piece) in a later tap with
  no PIN, then paid two of those pieces, and the mint took that swap too;
- set up with a refund key, gave c sealed to it, loaded dated pieces (`locktime` D,
  `refund` R + u·G), paid them under the key of D (4.3 s from `SPEND_ALL_BEGIN`) and
  took their dated change back, each swap taken by the mint.

The [hardware report](reports/HARDWARE_TEST_REPORT_2026-11-13_J3R180_2.3.md) has the
run. Not covered there: a dated piece taken back after its date by the refund key,
tears, the certificate, a full paid list, the reset by the PIN, the PIN's waits, a
hand-over, the owner's c given at a claim or a hand-over, a dollar card, a production
mint and a phone. The
chip needs `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY` and `KeyAgreement.ALG_EC_PACE_GM`:
a J3R180 whose configuration lacks either cannot run the card.

### What a holder notices

- **A payment, an `AUTH`, a first load and a change come back faster** ([D213](DECISIONS.md#d213) to
  [D216](DECISIONS.md#d216)): a payment with five change outputs is signed 2.2 s after it begins where it took 4.0 s; the
  change is written back in 0.58 s a piece where it took 1.04 s; a first load of 45 pieces is 7.8 s; the card's first set-up is
  0.6 s longer (it tests its engines then). The keyset's keys are taught at set-up, so a first load has no teaching in it.
  **The holds are shorter in seconds than D211 measured them** (they are counts of the card's signing work, which is faster than it was
  then): the owner's claim holds the card about 2.6 s, a history 3.0 s and a reset by the PIN about 8.3 s (11.3 s with the history's),
  until the counts are raised; the file before D217 held them 1.8 s, 1.4 s and about 6 s, before every signature was checked.
- **A signature takes 0.27 s longer, and is never a bad one** ([D217](DECISIONS.md#d217), [D218](DECISIONS.md#d218)): the card checks every
  signature against its key before it leaves, and makes the signature again by the slower route where the chip's engine gave a wrong
  answer; a payment, an `AUTH` and a held asking take that long more, so the holds and waits are longer in seconds at the same counts.
  A card taught keysets before any piece keeps them until the first piece is loaded under each ([D220](DECISIONS.md#d220)).
- **A first load is about a third quicker** ([D212](DECISIONS.md#d212)): a reader that sends each piece's C whole (`LOAD_PROOF`
  P2 bit 3) has it checked by the chip's key agreement, about 80 ms a piece less on a J3R180 (152 against 233 ms with the
  proof kept); 45 pieces in one selection take 8.2 s where they took 11.8. A card whose chip's agreement does not hold to the
  curve at its set-up answers that form `6B00`, and the reader sends the 33-byte form, which is checked as before.
- **A payment within its limit is signed at its first `SIGN`**: no floor, so no wait added
  for the card's own change either ([D211](DECISIONS.md#d211), which took away
  [D188](DECISIONS.md#d188)'s floor on the project owner's word). A payment over the limit on one
  payment, and a second payment in a time in the field, wait as 2.2's did. A brush of a tap
  within the limit is no longer slowed: the limits hold.
- **Loading is faster with the piece's y**: a loader that sends each piece's C's y
  (`LOAD_PROOF` P2 bit 2) saves about 108 ms a piece on a J3R180; the old form still works
  ([D211](DECISIONS.md#d211)).
- **A top-up always asks for the PIN.** A card with no PIN holds nothing and pays
  nothing (`6A97`), and the owner's phone loads under the PIN too
  ([D185](DECISIONS.md#d185)).
- **The card's change comes back later, from any reader, with no PIN**, by
  `LOAD_CHANGE`. Until then the card says change is owed, and moving to another
  mint, a reset, and on a card with no owner a new PIN or new limits wait for it
  ([D183](DECISIONS.md#d183)).
- **Change is made only in a keyset the holder's phone has taught the card**, under
  the PIN. After a mint moves to new keys, a till pays exactly until the holder's
  phone teaches the new keyset ([D190](DECISIONS.md#d190)).
- **The no-PIN allowance counts whole pieces** and renews only when the owner's
  phone gives its proof or, on a card with no owner, in a held tap under the PIN. The
  PIN alone renews nothing, so a PIN typed at a till, for a payment or a top-up, opens
  no allowance for whoever taps next; a wallet that wants the allowance back at a
  top-up sends the owner's proof in that tap ([D186](DECISIONS.md#d186),
  [D208](DECISIONS.md#d208)).
- **Set-up finishes in one tap, and its claim waits no longer than its record**: right
  after `SET_CARD` under the PIN in the same tap, the owner is claimed at the first
  asking, `SET_CARD`'s own seconds on the chip being the hold; otherwise by four
  askings, about 2.6 seconds on a J3R180 ([D187](DECISIONS.md#d187),
  [D211](DECISIONS.md#d211), [D221](DECISIONS.md#d221)).
- **A card with no phone owner is a simple card**: its limits, mint and unit are set
  once, at its first set-up. Its PIN never blocks: each wrong try makes the next wait
  twice as long, and an empty card whose PIN was forgotten takes a new one. It is
  reset by its PIN in a held tap: the history's seven askings (about 3 seconds), then the
  reset's seventeen (24 askings, about 11 seconds in all) on a J3R180 ([D189](DECISIONS.md#d189),
  [D195](DECISIONS.md#d195), [D196](DECISIONS.md#d196)).
- **A card loads at most 300 pieces a day**, change included, and refuses a piece
  above the day's limit ([D195](DECISIONS.md#d195), [D196](DECISIONS.md#d196)). A
  payment's change counts when the payment is signed, so the change always comes back;
  a payment whose change the day has no room for is refused before it is signed, and
  the same payment with no change goes ([D200](DECISIONS.md#d200)).
- **A clock moved far ahead**: one block header made far in the future at the floor's
  work is weak, and begins and ends no day, so it freezes no limit and gives no one a
  day; `REFRESH` with a real header, the owner's or the holder's by the PIN, brings the
  clock back ([D201](DECISIONS.md#d201)). A card that has taken no header yet holds a
  header to twice the floor's work, a weak header is never the hardest, and `SET_CARD`
  and a reset keep the hardest, so a fresh, newly set-up or reset card is held to the
  same bar ([D203](DECISIONS.md#d203)). One with at least half the work of the hardest
  header the card has taken the owner's `REFRESH` back form brings back, the day's limit
  and the day of loads with it ([D203](DECISIONS.md#d203)); on a card with no owner and a
  day's limit it still holds what that day has not left. An empty card's reset or
  hand-over with a real header as the anchor sets any clock back, and begins the day of
  loads again ([D200](DECISIONS.md#d200)). Every set-up gives the card the tip, and in a
  first set-up of an empty card that tip is the clock even where the clock was later, and
  the hardest where it is harder: a stranger's far header before the set-up is let go,
  and a card set up so holds a far header to half the tip's work ([D204](DECISIONS.md#d204)).
- **Dollars and sats on one card**, counted against the limits at one rate the
  owner's phone writes ([D184](DECISIONS.md#d184)).
- **Privacy**: every top-up is locked to a key of its own date, so the mint links
  the spends of one week's money and no more ([D197](DECISIONS.md#d197)); the
  history and spent pieces need the PIN ([D198](DECISIONS.md#d198)); a hand-over
  wipes the history and asks for a new PIN ([D197](DECISIONS.md#d197)).
- **A card's secret c comes back to a phone restored from the words**: the owner's
  phone gives the card a c made from its words when it claims the card or takes it
  over, so the words give c back with no card; to take back a lost card's dated money
  the phone also needs the card's key P and the pieces themselves, which the words do
  not give. A card with no owner, and a reset, draw their own c. The words, if they
  leak, give c too ([D202](DECISIONS.md#d202)).
- **A certificate** can say who made a card; a certified card keeps its key
  through a reset ([D192](DECISIONS.md#d192), [`CERTIFIER.md`](CERTIFIER.md)).
  Whoever holds a card that has never had a PIN can write one, so the holder's wallet
  says so where it finds one it does not believe ([D209](DECISIONS.md#d209)).
- **Money can wait for a card** under its inbox name until a till with the holder's
  PIN loads it ([D199](DECISIONS.md#d199)).

### What a wallet or till author needs

- **New commands:** `1C` `CERT_READ`, `1D` `GROUP_KEYS`, `1E` `INBOX`, `27`
  `LOAD_CHANGE`, `38` `KEYSET_KEYS`, `54` `CERT_WRITE`. `2E` and `2F` stay
  unassigned.
- **Changed forms:** `SPEND_ALL_BEGIN` needs P1 bit 1 and `LOAD_PROOF` and
  `LOAD_CHANGE` P2 bit 1 (keys per load; `6A86` without); `SPEND_ALL_CHANGE` is 45
  bytes (amount, the mint's key K, the keyset); `GET_CHANGE` rows are 83 bytes and
  carry no blinding factor; `SET_LIMIT` and `SET_LIMIT_PIN` take 4, 8, 12, 13, 17 or
  18 bytes (budget, then rate, then the window switch); `GET_INFO` P1 = 3 answers 51
  bytes and P1 = 4 59 bytes (profiles `F7 03`, or `77 03` on a card refused its paid
  list, then the loads left today; byte 55 bit 3, the wait on every payment, is clear,
  [D228](DECISIONS.md#d228)); new
  `GET_CARD` P1 = 2 and 3, `GET_BALANCE` P1 = 1, `GET_LOG` P1 = 2 and 3,
  `RESET_CARD` P1 = 1, `REFRESH` P1 = 1, `SPEND_ALL_AGAIN` by hash for the last 16
  payments; `RESET_CARD` P1 = 0 takes an anchor header, and a hand-over's anchor sets
  the clock back on an empty card ([D200](DECISIONS.md#d200)); in a first set-up of an
  empty card the claim's anchor and `SET_HEADER` set it back too, and a wallet MUST give
  the tip so before any load ([D204](DECISIONS.md#d204)); `REFRESH` brings back a
  clock a weak header set, and its owner's back form (the header, then `01`, under the
  proof) any clock ([D201](DECISIONS.md#d201)); `SET_OWNER` P1 = `01` gives the card the
  owner's c, sealed to its PIN key, and the claim or hand-over after it ends with its
  check, 16 bytes ([D202](DECISIONS.md#d202)); `REFRESH` with a P1 other than `00` and
  `01`, and `SET_OWNER` with a P2 other than `00`, are `6B00` ([D203](DECISIONS.md#d203)).
- **Pickup proofs (D199):** byte for byte, `k ‖ nonces ‖ rand16 ‖ AUTH(m)`, m the first
  16 bytes of SHA-256("CashuCard/pickup" ‖ nonces ‖ rand16) (`spec/vectors/pickup.json`);
  one shows that the card was at a tap, never that anything loaded. A day after D the
  owner may take back every piece of that date, picked up or not, once it has read the
  card ([D203](DECISIONS.md#d203)).
- **The owner's c (D202):** s = HMAC-SHA256(the 64-byte BIP-39 seed, "CashuCard/c" ‖ 00 ‖
  P); c = SHA-256("CashuCard/c" ‖ s ‖ n), n the card's own count of the owners' c it has
  taken (`spec/vectors/owner-c.json`). After the claim or the hand-over the phone reads c
  and finds its n, s worked out from the card's own key; with none (another party's
  envelope, a reader in the claim's tap or the last owner at a hand-over), it locks no
  dated money to the card. A restored phone needs P and the pieces as well as the words.
- **Change and the day's loads (D200):** `SPEND_ALL_CHANGE` and the last
  `SPEND_ALL_SIGN` answer `6A8F` for change past the day's 300 loads; `LOAD_CHANGE` is
  never refused for them. A reader makes no more change outputs than `GET_INFO` P1 = 4
  bytes 57 and 58 allow.
- **The card's change only at a mint that proves its signatures (D206):** a reader
  sends `SPEND_ALL_CHANGE` only for a mint whose info lists NUT-12 and NUT-09; at any
  other it names outputs for the whole of the pieces, or does not pay. A change
  signature with no `dleq` is asked for again by B_ (NUT-09) before it is called lost.
- **Before a swap (D210):** the card is not locked, its record is a holder's, and
  `GET_INFO` P1 = 4 byte 55 bit 7 is set (a card refused its paid list takes no piece,
  `6A84`); in the tap that loads, the date's keys are compared with `GROUP_KEYS` again
  before the first `LOAD_PROOF`. An `ALLOW_LOAD` with bytes after its proof answers
  `6700` before the proof is read.
- **Certificates (D209):** a wallet that sets a card up reads `CERT_READ` P1 = `FF`
  before the first `SET_PIN`, and tells the holder of a sealed certificate it does not
  believe that the card keeps one key for its life.
- **New status words:** `6A97` no PIN, `6A98` keep holding (send the same command
  again), `6A99` no rate, `6A9A` two units, `6A9B` the other unit, `6A9C` no room in
  the keyset table, `6A9D` the holder's say needed, `6A9E` limit reached (enter the
  PIN), `6A9F` keys not shown; `6200` from `ALLOW_LOAD` (the grant given, no load
  opened); `63CX` on a card with no owner counts wrong tries in a row.
- **A 2.2 reader** that holds to the major, as flash-pos, flash-mobile and cardctl
  do, refuses a 3.0 card at `SELECT` and sends nothing after it
  ([D205](DECISIONS.md#d205)). One that goes on can read a 3.0 card and cannot pay
  from it, load it, finish its change or set it up, and stops before burning
  anything, but a 2.2 loader swaps a top-up before the card refuses it:
  [What a 2.2 reader sees](../spec/APDU.md#what-a-22-reader-sees). flash-pos and
  flash-mobile move to 3.0 before a 3.0 card is handed out; the cardsim contract
  they pin by `CASHU_JAVACARD_REF` is 3.0's
  ([`tools/cardsim/README.md`](../tools/cardsim/README.md#what-changed-for-30)).
- **Rules a reader keeps:** leave a dated piece whose date is less than a day after
  your own time out of every payment, online or not, and, online, ask the mint the state of every input before
  `SPEND_ALL_SIGN`; never give a card a block header more than two hours ahead of
  your own clock ([SET_HEADER](../spec/APDU.md#set_header-0x36)); file inbox money
  only for a card with an owner and a refund key, dated 14 days from the filing, and
  at pickup check each piece's mint, keyset, secret, DLEQ proof and date before
  loading it ([INBOX](../spec/APDU.md#inbox-0x1e)).
- **Memory:** the constructor asks for 30,056 bytes of persistent memory; the first
  `SET_CARD` reserves 26,619 more (the proofs, the settlement record, the paid list
  with its kept signatures, the openings' keys, the keyset table), and a certified
  card 1,027 at its first `CERT_WRITE`.

### The signer

`SchnorrHW` changes without a wire change: the temporary key (a signature's nonce,
a change output's blinding factor) is asked for in RAM first and put back to a public
number after every use, in it and in both key agreements; the signer's scratch and
the PIN commands' buffers are zeroed; a point from outside is checked to be on the
curve before the chip sees it; the reductions on the signing path run the same
instructions for every value ([D21](DECISIONS.md#d21),
[`SECURITY-MODEL.md`](SECURITY-MODEL.md) item 5); and every `SET_CARD` first checks
both chip engines at seventeen points, so a chip that frames or computes them
otherwise is never set up ([ECDH framing probe](HARDWARE_DEPLOYMENT.md#ecdh-framing-probe-at-set_card)).
Every signature that leaves the card (`AUTH`, a payment's, the settlement record's,
the PIN key's) is verified on the card under its key before it is given; one that
fails is not given (`6F00`), and a payment so refused burns and counts nothing
([D207](DECISIONS.md#d207)). The waits keep their length.

### Moving from 2.2

There is no upgrade in place. Spend or move every piece, bring home any change owed
(`GET_CHANGE` on a 2.2 card), delete the package and install 3.0: the card gets a
new key ([Reinstall](HARDWARE_DEPLOYMENT.md#reinstall-delete--install)). Readers and
wallets move to the 3.0 wire before a 3.0 card is handed out.

### Host components in the same change

- **cardkit 0.3.0** reads and installs the 3.0 card, and refuses to reset or clean
  up one that is owed change ([`tools/cardkit/README.md`](../tools/cardkit/README.md)).
- **cardctl** speaks 3.0 (`setup`, `reset`, `change`, `load-change`, `keyset-keys`,
  `group-keys`, `card-secret`, `cert`) and `selftest` takes 2.1 and later.
- **The provisioner** carries the 3.0 load file and keeps installation switched off
  for it until the operator approves it (`src/releaseGates.ts`). That gate holds back
  only what loads the file: an owned-card reset, which loads nothing, is not held to it.
- **ops** `local-reset` refuses a card owed change.

## `cardkit-v0.3.0`: protocol 3.0, change owed, and SCP03 (not yet tagged)

`tools/cardkit/package.json` moves to 0.3.0, a minor release for changes that are not
compatible ([`tools/cardkit/README.md`](../tools/cardkit/README.md) has the migration):

- **Protocol 3.0.** `CARD_VERSION` is `[3, 0]`; the kit reads and installs the 3.0
  card and knows 2.1, 2.2 and 3.0 (`CARD_VERSIONS`). It refuses 2.2's owner commands
  on a 3.0 card.
- **Change owed.** A card owed its own change is not empty: every reset and every
  "empty" test holds to it (`changeOwed`, `readChangeOwed`, `GET_CHANGE`), the
  probe never sweeps such a card, and the settled-entry cleanup stops on it
  (`card-not-empty`), reading the change owed from the card, never from a saved review.
- **SCP03 beside SCP02** ([D181](DECISIONS.md#d181), [D182](DECISIONS.md#d182)):
  `openSession` opens either; `putKeys` takes the session.
- **The outbox-spike runners** (`tools/outbox-spike/run-compact.cjs`,
  `run-probe.cjs`) keep requiring the reviewed 0.2.0 and refuse 0.3.0 until they are
  reviewed against it.
