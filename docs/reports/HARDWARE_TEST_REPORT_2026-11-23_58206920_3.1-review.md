# Hardware test report: 3.1 with D235 on sample card 58206920 (2026-11-23)

The 3.1 file with the review fixes of D235 (branch `card-3.1-pr`, 63453f2) was put on the reader's sample card, checked for
each fix a reader can see, paid from at a test mint, and left fresh.

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321 (ATR "J3R310-355", a J3R180 keyed for SCP03, D229), the public
  default test key. The serial was read before every step that changed the card: 25 reads by the payment session, plus
  one before the install, each create cycle and each hand step. Every one was 58206920.
- **Reader:** contact. Times are the reader's round trip as gp, pyscard or the bridge report them.
- **Tools:** GlobalPlatformPro v25.10.20; this branch's `tools/cardctl` (setup, selftest, reset, change, info); the earlier
  runs' private payment harness (`money.py`, `p19.cjs`, `p31.cjs`, ChipBridge) pointed at this branch, with the plan of the
  2026-11-21 run.
- **Mint:** testnut, FakeWallet (no real money).

## The file

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.1.0.cap` at 63453f2 | `4ff8d8a20bf1106a3a31db5824a80d8626838d237c974157197d3fac1104845a` | **42,741 bytes** (245 past a multiple of 256), sha256 `b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da` |

The size had never been given to a chip: one 256-byte page above the 42,485 bytes of every earlier 3.x file, at the same
place in its page.

## What the card held before

The 3.1 file of bab8c5a, set up and used since (an owner, a PIN, the mint forge.flashapp.me, 58 spent places, 0 unspent,
balance 0, `cardctl change`: "no change owed"). Nothing of value; the keeper's approval was to install on it.

## Install

| Step | Result |
| --- | --- |
| Delete the tag, the card's applet, the opener, the package | each `9000` |
| Load and the opener | `9000`, about 9 s |
| The card's applet | `9000` at the first try |
| The tag, `https://getfoxy.io/card` | `9000` at the first try |
| `selftest` | 13 of 13 |
| 5 create cycles (delete and create the card's applet and the tag) | applet `9000` 5 of 5 at the first try; tag 5 of 5, 230 ms |

**42,741 bytes installs on this chip.** SIZES has it.

## D235 on the chip

| Fix | Check | Result |
| --- | --- | --- |
| (2) the one-asking claim only for a card that never had a PIN (the review's M7(1)) | set-up on the fresh install, then a reset by the owner, a new tap, and a set-up with an owner | fresh install: `SET_OWNER` `9000` at the first asking (816 ms). After the reset: `6A98` three times (534, 537, 538 ms), `9000` at the fourth (825 ms): 2.43 s. The old file gave `9000` at the first asking there. |
| (1) the self-tests after a reset (the review's H5) | the first `SET_CARD` after the reset | 1,498 ms (self-tests ran); the first set-up's 1,838 ms the same way |
| (4) a SELECT clears what the tap gave (the review's M8) | SELECT, VERIFY_PIN 1234, SELECT the tag, SELECT the card's applet, GET_LOG | `0301 9000`, `9000`, `9000`, `0301 9000`, **`6982`** |
| (3) the hash emptied before each first update (the review's H2) | needs a crafted `LOAD_CHANGE` | not run on the chip; jCardSim covers it (`ReviewFixesTest`) |
| The reset by the PIN, held (the holds' seconds) | needs a card with a PIN and no owner | not run: cardctl sets up a 3.x card only with an owner; jCardSim covers it |

## The money run at testnut

The 2026-11-21 plan, unchanged:

- A first load of 36 pieces, every one read back unspent at the mint.
- Exact payments W0, B103, W2, W4, W6, W10, X1, SA1, SB1, the AGAIN pair and the withdrawal of all, each taken by testnut.
- The waits over the limit were exactly 2 × (N − 1) "not yet" answers: 0, 2, 4, 6, 10 and, for the withdrawal of all, 18. The
  first of a payment took 470 to 481 ms, every later one 462 ms.
- Payments with change: C1 (6 outputs), C2, SA2 and SB2 (4 each). The waits were reduced by one for every two change outputs
  (C1: 5 for N = 4). Every change piece was loaded back by `LOAD_CHANGE` with no PIN, 530 to 546 ms each, with the mint's
  DLEQ, and read `UNSPENT` at the mint. C2's change was spent in X1.
- `SPEND_ALL_AGAIN`: `9000` three times; the two wrong forms (zeros, and A's hash without the PIN) were refused with `6A88`.
- The withdrawal of all: 21 pieces, 957 paid and 3 fee, 11.2 s in one tap.

Free memory, empty, before the reset: apps 4, persistent 72,388, transient 2,084.

## Left

Reset by the owner at the end of the session: no PIN, no record, no owner, a new card key; this file installed, the tag at
`https://getfoxy.io/card`.

The load file's sha256 is on refcheck's PROVEN.

Logs are kept in the run's scratch folder, not in the repository: the payment session (`session-M.log`,
`p31-results.jsonl`, `p19-M.log`, `bridge-M.log`), `guard.log` (every serial read), `install.log`, `setup1.log`,
`setup2.log`, `reset-owner.log` and `select-zero.log`.

## The same file on a J3R452 (ICType D600, serial 36813121), 2026-11-23

The same CAP was put on a second chip, a J3R452 (NXP P71D600, SCP03 i=10 with its supplier's AES keys), in place of an older
1.x install that held nothing of value.

- **Install:** the load (about 18 s), the card's applet and the tag (`https://getfoxy.io/card`) all `9000` at the first try;
  `selftest` 13 of 13; 5 create cycles of the card's applet and the tag, 5 of 5 at the first try (the tag 260 ms).
- **D235:** the first set-up's claim at the first asking (960 ms); after a reset by the owner, `6A98` three times (609 to
  613 ms) and `9000` at the fourth; the first `SET_CARD` after the reset 1,650 ms (the self-tests ran); a SELECT after
  VERIFY_PIN leaves `GET_LOG` answering `6982`.
- **Money at testnut, the same plan:** the first load of 36 read back unspent; every payment taken by testnut; the waits
  over the limit exactly 2 × (N − 1), less one for every two change outputs, as on the J3R180. Each "not yet" took about
  572 ms here against 462 ms on the J3R180: the holds are counted in askings, so their seconds depend on the chip.
  Every change piece loaded back with no PIN, with the mint's DLEQ, and read `UNSPENT`; C2's change was spent in X1; the
  withdrawal of all took 21 pieces.
- **One break, not the card's:** testnut timed out once while SA2's change was being loaded, after 2 of its 4 pieces. The
  card listed exactly the 2 still owed (`GET_CHANGE`: #2 and #3); the run went on from there and loaded them.
- Every one of 27 serial reads was 36813121. Left reset by the owner, this file and the tag installed. Free memory, empty:
  persistent 190,700, transient 2,718.
