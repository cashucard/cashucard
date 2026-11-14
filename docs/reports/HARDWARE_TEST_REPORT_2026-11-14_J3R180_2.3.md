# Protocol 2.3 with D200 to D204 on a J3R180: the tracked file's chip run (2026-11-14)

The tracked 2.3 CAP, with [D200](../DECISIONS.md#d200) to [D204](../DECISIONS.md#d204),
installed on the bench J3R180 and, at a FakeWallet test mint (fake sats), paid with
real signatures under the card's date keys, wrote its own change back with
`LOAD_CHANGE` in a later tap with no PIN, and paid that change again; each swap was
taken by the mint. The run then went through the clock (the first set-up's anchor,
the resets, the hand-over and `REFRESH`'s back form), the day of loads, the owner's c
and the refusals of the checklist
([`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist)). The
run's paragraph is in [`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md); the run of
the file before D200 is [the report of 2026-11-13](HARDWARE_TEST_REPORT_2026-11-13_J3R180_2.3.md).

## Environment

- Card: NXP J3R180 (JCOP4), CPLC serial **09312320** (read first), the public default
  GlobalPlatform test key, SCP02.
- Reader: ACS ACR39U, contact. Times are the reader's round trip.
- Tools: GlobalPlatformPro (`gp`), `tools/cardctl` (`--timing`), the card's own
  commands from `cardctl`'s `Card` in a script where one selection had to hold several,
  and `tools/chip`'s bridge for the payment steps.
- Mint: `testnut.cashu.space`, CDK mintd 0.18.1, FakeWallet (no real money); the
  `sat` keyset `017bc604…` (33-byte ID), input fee 100 ppk.
- Block headers: real mainnet headers from mempool.space: 974,766 (2026-11-06,
  week 2966, bits `1701e5ac`), 975,746, 975,750, 975,768, 975,774, 975,776 and 975,777
  (2026-11-14, week 2967, bits `17021673`).
- Owners: cardctl's TEST key and a second test key made for the run; owner seeds: two
  64-byte seeds made up for the run; a refund key made for the run.

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) | Sent |
| --- | --- | --- | --- |
| `applet/target/cashu-javacard-2.3.0.cap`, the CAP tracked on 2026-11-14 | `30c7bb8d98274da0953e2e90c93027fa2313391b05a2211a9489a2111dbaed83` | 36,953 bytes, sha256 `f216644a316e4c9de0f8bed2a4f32e90b48fa18624ed95a8f8950503f9464440` | three installs: before the first set-up's anchor, before the set-up on a clock ahead, and before the rest of the run |

Each install was three steps, the opener first, then the card's applet, then the tag:
the load in 16 to 17 s and the card's applet in 2 s each time.

## What ran

| Step | Result |
| --- | --- |
| Install, three steps, three times | `SELECT` `02 03`; `GET_INFO` answered; the tag reads `getfoxy.io/card` |
| The first `SET_CARD` after each install | `9000` in 1,221 to 1,223 ms (1,013 ms on a card reset by the PIN), so the framing check's seventeen engine calls passed |
| The first set-up's anchor (D204), one selection on the fresh card: `SET_PIN`, `VERIFY_PIN`, `SET_CARD`, `SET_HEADER` with the tip, `SET_HEADER` with a header an hour older | the second `SET_HEADER` answered the older time (75 ms); after a `SELECT` the older header answered the same time, the tip moved the clock on, and the older header after it answered the tip's time |
| Set-up on a clock ahead (D204): the tip given, then `setup` anchored 3 h 12 min older | setup went (claim's six `SET_OWNER` 676 to 856 ms) and said the anchor brought the clock back; `info` said the anchor's time; in the next tap an older header still moved nothing, the tip moved it on |
| `cardctl --timing selftest --rounds 10` | 20 of 20; `AUTH` 632 ms |
| `setup` with the owner's seed (D202), anchored at the tip | `GET_NONCE` P1 1 641 ms, `SET_OWNER` P1 01 267 ms, the six askings 679 to 858 ms; c read back, the first owner's c |
| `card-secret --owner-seed --date D` (D 2026-12-15) | c is the owner's; r + u for D is the private key of the card's refund key for D; the one-liner from the seed, P and r alone gives the same c and R + u·G as `GROUP_KEYS` |
| Dated loads: 64 sats as 32+16+8+4+4 of D, each DLEQ checked | `LOAD_PROOF` P1 01 P2 02, 227 to 235 ms; each secret rebuilt from the card's piece equals the minted one; `KEYSET_KEYS` worked out the 33-byte ID |
| A payment of dated pieces: 32 + 16 to a till's 24, fee 1, change 23 | `SPEND_ALL_BEGIN` 204 ms; `SPEND_ALL_CHANGE` ×4 465 to 583 ms; one "not yet" (602 ms) then the signature (702 ms); good under P + t·G for D, not under P; the mint answered `200`, both inputs `SPENT` |
| The dated change, in a new tap with no PIN | `LOAD_CHANGE` ×4, 1.02 to 1.03 s; each dated D, its proof kept, `UNSPENT` |
| Undated loads: 576 sats as 512+32+16+8+4+4 | as above, each DLEQ checked |
| An undated payment with change, its change loaded with no PIN, two of those pieces paid again | each signed after one "not yet", good under P + t·G, not under P; the mint answered `200` each time; the change came back `UNSPENT` |
| The biggest payment: 512 to a till's 256, fee 1, eight change outputs (255) | `SPEND_ALL_CHANGE` ×8, 445 to 674 ms; `SPEND_ALL_SIGN` signed at once (859 ms), not `6A96`; the mint took it; the eight pieces came back with no PIN |
| An owned card holding pieces | a hand-over and the owner's reset, each with an older anchor, answered `6A8D`; the clock did not move |
| `REFRESH` (D201): a day's limit of 1,000, the tip, a payment of 8 | the window began at the clock the limit was set at; the plain form with a header 3 h older moved nothing and named `--back`; the back form (`REFRESH` 125 ms) brought the clock and the window (`GET_INFO` 21 to 24) back to it, 25 to 28 still 8, loads left unchanged; the tip moved the clock on |
| `REFRESH` P1 02; the plain and back forms with a header an hour older | `6B00`; "did not move" naming `--back`; the back form printed the header's time |
| The day of loads (D200): 268 made-up pieces, 16 to a payment | loads left 2; a payment with two change outputs signed and left 0; both openings loaded with no PIN, 0 still; `LOAD_PROOF` `6A8F`; a payment's `SPEND_ALL_CHANGE` `6A8F`, its `SPEND_ALL_SIGN` `6985`, the piece unspent, no change owed; the same piece with no change signed and the mint took it |
| The hardest's bits (D203), `GET_CARD` 40 to 43 | `73160217` after the set-up, after `set-card` on the emptied owned card, and after the owner's reset with no anchor |
| A hand-over with a second seed, anchored at the tip | `SET_OWNER` 1,050 ms; c read back, the second owner's c; `card-secret` with the second seed says so, with the first says c is not the owner's |
| A hand-over with no owner's c to a header 3 h older | `SET_OWNER` 1,056 ms; `info` said the older time; the tip moved it on |
| A card with no owner: `refresh --pin` with a header an hour older | the clock did not move; cardctl named the anchored reset |
| The reset by the PIN with a header 8 days older | 60 askings, 45 s; the clock at the header; loads left 300 after the next set-up; that set-up loaded |
| The same card holding a piece | the reset by the PIN answered `6A8D`; the clock did not move |
| Refusals in the first set-up of a card with no owner | `SET_OWNER` P1 02 and P1 00 P2 55 `6B00`; P1 01 P2 55 with a good envelope `6B00`, then the claim with its check `6985`; a claim with a check and no envelope `6985`; a claim whose check is another seed's `6A80`; no owner and the same clock after each |
| `INBOX` | week 2966 at the clock of the 8-days-older header, week 2967 after the tip; each the owner's SHA-256 of c (read under the refund key) and the week |
| The owner's reset with a header 8 days older, on an empty owned card after the tip | `RESET_CARD` 372 ms; `info` said the older time; no PIN, no owner, no record |
| After the run | a sealed `VERIFY_PIN` (P1 01, 90 bytes) `9000` in 273 ms (clear 19 ms); `selftest --pin` 21 of 21, `AUTH` 632 ms |

## Not covered

- `LOCK_CARD`, and so the owner's reset of a locked card: it would lock the bench card
  for good. cardctl's refusal to send it without the PIN is in its tests.
- Money taken back after its date D by the refund key, r + u, at a mint: it needs a
  wait past D.
- A header far ahead and a weak clock: no real header makes either.
- Tears, the certificate, a full paid list, the PIN's waits, a dollar card or a card of
  two units, and the first load's 5-second budget.
- A phone, and a production mint.
- Other chips and configurations: the applet needs `ALG_EC_SVDP_DH_PLAIN_XY` and
  `ALG_EC_PACE_GM`, and a J3R180 in another configuration has not been checked.
