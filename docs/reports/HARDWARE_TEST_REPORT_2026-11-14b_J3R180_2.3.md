# Protocol 2.3 with D205 on a J3R180: the tracked file's chip run (2026-11-14, second run)

The tracked 2.3 CAP, with [D205](../DECISIONS.md#d205) (no payment floor, shorter holds),
installed on a second bench J3R180 at the first try and, at a FakeWallet test mint (fake sats),
paid with real signatures under the card's date keys, wrote its own change back with
`LOAD_CHANGE` in a later tap with no PIN, and paid again; each swap was taken by the mint. The
run timed the holds and the payment waits, and went through the clock and the refusals of
[`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist). The run's
paragraph is in that file; the first run of the day, on the file before D205, is
[its own report](HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md).

A first build of D205 added a loader's y at `LOAD_PROOF` (P2 bit 2). On this card its applet was
refused at the first create (`6F00`, twice, 37,573 bytes), and a piece with y took 310.8 ms against
204.6 ms without it. The y was taken out; this is the file without it.

## Environment

- Card: NXP J3R180 (JCOP4), CPLC serial **09301220** (checked by the install script before it sent
  anything), the public default GlobalPlatform test key, SCP02.
- Reader: ACS ACR39U, contact. Times are the reader's round trip.
- Mint: `testnut.cashu.space`, FakeWallet (no real money); the `sat` keyset `017bc604…`, input fee 100 ppk.
- Block headers: real mainnet headers from mempool.space, blocks 975,750 to 975,841 (tip 975,841,
  2026-11-14 20:30 UTC).
- Owners: cardctl's TEST key and a second test key; two made-up owner seeds; a made-up refund key.

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) |
| --- | --- | --- |
| the tracked CAP, `applet/target/cashu-javacard-2.3.0.cap` | `01edad4cf1b815dae47510780db10658a4dfb56373ffb5ec2d513a56d4dd8b39` | 36,950 bytes, sha256 `075448e44e080d05e7dde270ec246e469796083ce7f70cf94c70fc19054d012a` |

Installed twice, three steps each (opener first, the card's applet, the tag): load 16 to 17 s, the
card's applet 2 s, created at the first try both times; `SELECT` `02 03`, the tag `getfoxy.io/card`.

## What ran

| Step | Result |
| --- | --- |
| The first `SET_CARD` | `9000` in 1,208 ms (1,008 ms in a later set-up) |
| `cardctl --timing selftest --rounds 10` | 20 of 20; `AUTH` 631 ms |
| `setup` with the owner's seed, anchored at the tip | the claim answered `9000` at the 4th `SET_OWNER` (678, 681, 681 and 859 ms: 2.9 s; the three held askings 2.04 s); c read back, the first owner's c |
| `card-secret --owner-seed --date D` | c is the owner's; r + u for D is the private key of the card's refund key for D |
| Loads: 64, 32 and 16 fake sats, each DLEQ checked | `LOAD_PROOF` 226 to 235 ms a piece (plain form, P2 02) |
| `LOAD_PROOF` with P2 04, 06, 07 | `6B00` each, nothing stored |
| A payment of the three to a till's 50, fee 1, five change outputs | no "not yet"; `SPEND_ALL_SIGN` 889 ms; 4.1 s from `SPEND_ALL_BEGIN`; good under P + t·G, not under P; the mint answered `200`, inputs `SPENT` |
| The change in a new tap with no PIN | `LOAD_CHANGE` ×5, 1.02 s each, `UNSPENT`, DLEQ by testnut's key |
| The biggest payment: 512 to a till's 1, eight change outputs (510) | `SPEND_ALL_SIGN` signed at once (853 ms), not `6A96`; 5.2 s from `SPEND_ALL_BEGIN`; the mint took it; the eight pieces came back |
| Dated pieces (D 2026-12-15), 64 + 8 to a till's 40 | `GROUP_KEYS` for D equal to the owner's; no "not yet" (699 ms); the mint took the swap; the five change pieces came back dated |
| Limit on one payment 100, day's limit 5,000: a payment of 48 | no "not yet"; 1.35 s from `SPEND_ALL_BEGIN` |
| A payment of 150 | 10 "not yet", 7.2 s from `SPEND_ALL_BEGIN` |
| A payment of 250 | 14 "not yet", 9.7 s |
| A second payment in the same time in the field (63) / the first of a new tap | 10 "not yet" (7.4 s) / none (1.2 s) |
| A payment of 447 | 22 "not yet", 14.6 s |
| The history of a card with a PIN and no owner | `6A98` ×6, the log at the 7th asking; 3.6 s (a held asking 597 ms) |
| The reset by the PIN with the tip as its anchor | the history's 7 askings (3.6 s), then `6A98` ×16 and the reset at the 17th (10.8 s); 24 askings, 14.8 s wall; the clock at the anchor |
| The PIN's wait after wrong tries | one held asking after one wrong try; two after the second in a row (unchanged) |
| The first set-up's anchor (D204) | the second `SET_HEADER` answered the older time (75 ms); after a `SELECT` it moved nothing; the tip moved it on |
| Set-up on a clock ahead | `setup` anchored 7.1 h older than a clock the tip had set went, said the claim's anchor brought the clock back; `SET_CARD` 1,008 ms, claim 2.9 s |
| A hand-over with a second seed and the tip, after a payment drained the card (447, 22 "not yet") | `SET_OWNER` 1,236 ms; c read back, the second owner's c |
| The owner's reset with an anchor 7.1 h older, on the emptied card | `RESET_CARD` 374 ms; the clock at the anchor |
| An owned card holding pieces | the hand-over and the owner's reset with an older anchor each answered `6A8D`; the clock did not move |
| `REFRESH` | P1 02 `6B00` (as `SET_OWNER` P1 02 and P2 55); the plain form with an older header moved nothing and named `--back`; the back form moved it; the tip moved it on |
| Refusals in the first set-up of a card with no owner | `SET_OWNER` P1 02 and P2 55 `6B00`; a good envelope then the claim `6985`; a claim with no envelope `6985`; a claim with another seed's check `6A80`; `INBOX` week 2967 |
| The hardest's bits, `GET_CARD` 40 to 43 | `73160217` |
| A sealed `VERIFY_PIN` (P1 01, 90 bytes) | `9000` in 278 ms (clear 19 ms) |
| After the run | the card installed again from the same file and left fresh: no PIN, no owner |

## Not covered

- The day of loads (D200): not run again; its code is unchanged since the first run of the day.
- `LOCK_CARD`, and so the owner's reset of a locked card.
- Money taken back after its date D by the refund key, at a mint.
- A header far ahead and a weak clock: no real header makes either.
- Tears, the certificate, a full paid list, a dollar card, the first load's 5-second budget.
- A phone, and a production mint.
- Other chips and configurations.
