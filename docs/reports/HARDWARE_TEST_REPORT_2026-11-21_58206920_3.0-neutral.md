# The neutral 3.0 file (9ac55c1) on the reader's sample card 58206920: the install, the tag's address at install, and ten create cycles (2026-11-21)

The 3.0 file of branch `neutral-cashu-card` at 9ac55c1, whose NFC tag takes its address from the install parameters (D227).
It was put on the reader's sample card, tried, and left there, fresh, with the tag at `https://getfoxy.io/card`.

> Later the same day the card was paid from at a test mint, and every money item passed: [Payments at a test mint](#payments-at-a-test-mint-the-same-day-the-same-card), below. The file is on refcheck's PROVEN.

- **Every create was taken at the first try:** the card's applet 13 times of 13, the tag 19 times of 19 with a good address, the load twice of two.
  No `6F00`, no retry, no create that went mute.
- **The tag's install parameters work on the chip as the simulator says:**
  - `gp -d` shows `C9`, the address's length and the address in the tag's `INSTALL`;
  - the capability container gives n + 56;
  - the NDEF file reads the address and `#new`, then, once the card is set up, the address and a code whose M checks out
    under the owner's c;
  - `C9 00`, a short install, an install with no length and a 128-byte address are each `6A80`, with no tag left.
- **Not run:** payments at a mint, change, and so the rest of the 3.0 checklist; a phone's read of the tag (left for the
  keeper).
- **One thing the simulator cannot show:** the card's free transient memory, with everything deleted, is 129 bytes less than
  at the start, and stayed so (below).

## Environment

- **Card:** CPLC ICSerialNumber **58206920**, ICType D321, ATR historical bytes "J3R310-355", the public default test key.
  - The serial was read again (`gp -i`) before every command that changed the card: 51 reads, every one 58206920.
- **Reader:** ACS ACR39U, contact. Times are the reader's round trip, as gp or pyscard report them.
- **Tools:**
  - GlobalPlatformPro v25.10.20 (`gp.jar`).
  - This branch's `tools/cardctl` (selftest, setup) and `tools/maker/maker.py` (`tag-params`).
  - pyscard 2.x, installed into a private virtual environment for the run.
  - The run's own scripts, off the repository. Nothing in the repository was changed for the run.
  - A tap is a real reset: pyscard's `reconnect(SCARD_RESET_CARD)`.
- **Set-up:** cardctl's TEST owner key, a random owner seed held only in the run's memory, the PIN 1234, the mint
  `https://testnut.cashu.space` (no piece was loaded), and the anchor block 976,817 (mainnet, from mempool.space).

## The file sent to the chip

| File | sha256 | Load file |
| --- | --- | --- |
| `applet/target/cashu-javacard-3.0.0.cap` as tracked at 9ac55c1 | `611b3478b82d4c1a3fb41878738087168b41a29c35343aafaa48fa8eeb297af4` | **42,485 bytes** (245 past a multiple of 256), sha256 `d69742d0034f77253882efa1c0f924c0d45bcd067c94cc2a3d05b83b6c834a1e` (refcheck), 173 `LOAD` blocks |

## What the card held before

- A 3.0 package (version 3.0), the opener, the card's applet and the tag; which 3.0 file is not known (the card does not say).
- Fresh: no PIN, no owner, no record, 0 pieces, balance 0.
- The tag read `getfoxy.io/card#new`, with a capability container of n + 56 (`47`): so a file with D227 in it.
- Free memory: 100,644 persistent and 2,213 transient bytes, 4 applications.

## The checklist

| # | Item | Result |
| --- | --- | --- |
| 1 | What was on the card, then delete | as above. The tag, the card's applet, the opener and the package deleted, each `9000`. Empty: 174,956 / 3,918 bytes free, as in every earlier run |
| 2 | Load and install | **pass.** The load and the opener: 173 blocks, every one `9000`; the last block `84E880AC 09`, one byte of the file and the MAC; 9.8 s for the whole gp call. The card's applet `9000` at the first try in **1,247 ms**. The tag with `https://example.com/card` (`--allow-example`): `9000` in 242 ms |
| 2 | The tag's `INSTALL` in `gp -d` | **pass.** `84E60C00 45 … 07 D2760000850101 01 00 1A C9 18 68747470733A2F2F6578616D706C652E636F6D2F63617264 00 …`: `C9`, 24, the address. For `https://getfoxy.io/card`: `19 C9 17 …`. For the 127-byte address: `81 81 C9 7F …` |
| 3 | The tag, read as a phone reads it | **pass.** `SELECT` `9000`; CC `000F20003B00340406E104004800FF`, byte 12 = `48` = 16 + 56; the NDEF file `0019`, then `D101155504` and `example.com/card#new`. Exactly the guide's expected bytes |
| 4 | `selftest`, set-up, the coded address | **pass.** `selftest` 13 of 13 on the fresh card (`AUTH` 718 ms). `cardctl setup` in one selection: "c is the owner's … read back from the card (1st owner's c it has taken)". `selftest --pin` 14 of 14 (`AUTH` 490 ms). Six tag reads, each after a reset: `example.com/card#` and 48 hex, NLEN right, read whole (72 bytes in one `READ BINARY`, 36 ms) and in pieces of 59 and 13 (the same bytes), **all six codes different, M right under the owner's c six times of six** |
| 5 | `C9 00` | **pass.** gp's `--params ""` sends `02 C9 00`: **`6A80`** (213 ms). `gp -l`: no tag; `SELECT` of `D2760000850101` `6A82`; the card's applet `SELECT` `0300`, `GET_INFO` `9000` (the set-up card as it was) |
| 5 | Short and inconsistent installs (raw `INSTALL` through the secure channel, `gp -s`) | **pass.** Parameters `C9 40` and 11 bytes (`https://exa`): **`6A80`** (226 ms). Parameters `C9` alone, no length: **`6A80`** (229 ms). Neither left a tag; the card's applet answered after each |
| 6 | The longest address, 127 bytes | **pass.** `https://example.com/` and 107 `a`: `9000` (333 ms). CC byte 12 = 175; three reads after resets, each 175 bytes whole (72 to 74 ms) and in pieces of 59, 59 and 57, the address right and the code new each time |
| 6 | (not asked) 128 bytes | `maker.py check` refuses it ("the most is 127"); sent with gp all the same: **`6A80`** (247 ms), no tag |
| 6 | `https://getfoxy.io/card` | **pass.** `9000` (227 ms). CC byte 12 = 71 = 15 + 56; three reads with codes. After a second set-up (below), six reads: M right under the owner's c six times of six, all six different |
| 7 | Ten cycles of the card's applet and the tag | **pass, 10 of 10 and 10 of 10 at the first try** (below) |
| 8 | Left | the 3.0 file, the card's applet and the tag at `https://getfoxy.io/card`, fresh (below) |
| – | A phone reads the tag and offers the address | **not done:** left for the keeper |

## Ten create cycles (item 7)

Each cycle, one gp call a step, each its own secure session, the serial read before each step that wrote:

1. delete the tag, then the card's applet;
2. free memory;
3. create the card's applet, then free memory;
4. create the tag with `https://getfoxy.io/card`, then free memory;
5. `SELECT` both.

The cycles began on the card set up in item 4, so the first delete removed a set-up card.

| Step | Result (10 cycles) |
| --- | --- |
| delete the tag | `9000` 10 of 10; 118 to 124 ms |
| delete the card's applet | `9000` 10 of 10; 299 to 301 ms (451 ms in the first, the set-up card) |
| create the card's applet | **`9000` at the first try 10 of 10; 1,217 to 1,220 ms** |
| create the tag | **`9000` at the first try 10 of 10; 235 ms every time** |
| `SELECT` | the card's applet `0300 9000` and the tag `9000`, 10 of 10 |

Free memory (persistent / transient bytes), the same at every reading of the ten:

| Point | Free |
| --- | --- |
| the package and the opener, no instance | 134,648 / 3,789 |
| after the card's applet | 100,404 / 2,100 |
| after the tag | 100,104 / 2,084 |

- **No drift over the ten cycles.** The card's applet takes 34,244 persistent and 1,689 transient bytes, as 1ad208d's file did
  in the rate test of 2026-11-20. The tag takes 300 persistent and 16 transient bytes.
- **Set-up takes no transient memory.** A set-up with the getfoxy address took 27,484 persistent bytes and no transient. With
  the set-up card's applet and tag deleted, the free memory was 134,648 / 3,789 again.

## The 129 transient bytes

- **Before the run**, an empty card had 3,918 transient bytes free. That was also the figure in every earlier run on this card.
- **After the run's refusals and its 127-byte tag**, a card with everything deleted had **3,789 free**, 129 fewer.
  - The figure stayed the same after the card was powered off.
  - It stayed the same after the package was deleted and loaded again.
- **What it is not:**
  - a set-up (measured: none);
  - a refused `C9 00` (measured once on its own: transient unchanged, 180 persistent bytes held until the next delete);
  - the create cycles (no drift).
- **When it went:**
  - 24 bytes between the first example tag's delete and the `C9 00` refusal that came after it;
  - 105 bytes between the 127-byte tag's create and the getfoxy tag's create. The 127-byte tag's delete and the refused
    128-byte install fall in that gap.
- **Inference, not measured:** the card manager keeps a working area in transient memory as long as the largest install
  parameters it has been given, and keeps it for good.
  - The 127-byte address's parameters are 129 bytes (`C9 7F` and the address), exactly the loss.
  - The first tag's create took 26 transient bytes more than every later one, and its parameters were 26 bytes.
  - If this is right, the cost is a one-off, bounded at about 131 bytes. The ten cycles showed no loss with 25-byte
    parameters.
- **What it means:** the card's applet needs 1,689 transient bytes, and 3,789 are free. Nothing here stops an install. A card
  maker that installs only its own address does not reach the 127-byte case.

## The card at the end

- The 3.0 file of 9ac55c1 (package version 3.0): the opener, the card's applet (created at the first try, 1,220 ms) and the
  tag (`https://getfoxy.io/card`, 235 ms).
- Fresh: no PIN, no owner, no record, 0 pieces, balance 0. `selftest` 13 of 13 (`AUTH` 718 ms). The tag reads
  `getfoxy.io/card#new`, CC byte 12 = 71.
- Free memory 100,104 / 2,084 bytes, 4 applications.
- **Not as found:**
  - the file is 9ac55c1's, where the 3.0 file before it is not known;
  - free memory is 100,104 / 2,084, where it was 100,644 / 2,213 (the transient part above; the persistent part is this
    file's size);
  - set up twice during the run, then deleted, as the previous run left the card: fresh, not set up.

## refcheck and the provisioner: not changed

- **PROVEN:** not added. This run had no payment and no change at a mint, and PROVEN wants both.
- **SIZES:** 42,485 was not added, though the chip took that size 13 times of 13.
  - With the size in SIZES and the hash not on PROVEN, refcheck's sentence for the tracked file becomes "... and no card
    has installed it".
  - That sentence would be false for this exact file. The guides, the README and the release notes must carry it word for
    word.
  - 1ad208d's 41,973 went into SIZES only once it was no longer the tracked file, so it never met this case.
  - Adding it waits for a choice: a wording of refcheck's sentence for a file installed but not proven, or the money run that
    puts the hash on PROVEN.
- **The provisioner's `VALIDATED_LOAD_FILE_SHA256S`:** not added. 1ad208d's file was never added there either, and the list
  takes a hash in a change of its own, with the operator's approval, after SIZES and PROVEN.

## What was not run

- Payments at a mint, change written back, and so every money item of the 3.0 checklist.
  - This file's hash is not proven by this run (refcheck's rule: real signatures and real change verified on the chip).
  - `AUTH`'s signatures were verified under BIP-340 (`selftest`).
- A phone's read of the tag.
- The clock items, the holds, `LOCK_CARD`, tears, the certificate, a dollar card.

## Logs

In the run's scratch folder (`chip-neutral`), which is not kept:

- before and the deletes: `00-info.txt`, `01-list-before.txt`, `02-state-before.txt`, `03-info-before.txt`, `10-delete.txt`;
- the install: `20-load.log`, `21-create-cashu.log`, `22-create-tag-example.log`;
- the tag: `30-tag-example.txt`, `31-tag-new-reads.txt`, `41-setup-tag-example.txt`;
- the refusals: `51-tag-c900-gp.log`, `52-after-c900.txt`, `53-tag-short-A.log`, `54-tag-short-B.log`, `62-tag-128.log`;
- the long and getfoxy addresses: `60-tag-127.log`, `61-tag-127-read.txt`, `63-tag-getfoxy.log`, `64-tag-getfoxy-read.txt`,
  `82-setup-getfoxy.txt`;
- the cycles and memory: `70-rate.jsonl`, `71-tag-mem.txt`, `80-reload.txt`, `81-leak-c900.txt`, `83-after-setup-delete.txt`;
- the end: `90-final.txt`, `91-selftest-final.txt`, `92-info-final.txt`;
- the serial reads: `guard.log`.

## Payments at a test mint (the same day, the same card)

A second run on the same card and the same file, on the keeper's yes in chat: set up, load from a test mint, pay, check the
change, check the mint's signatures. **Every item passed.** The file's hash moved from refcheck's INSTALLED to PROVEN.

- **Mint:** `testnut.cashu.space`, CDK mintd 0.18.1, FakeWallet (no real money). Keyset `sat` `017bc604…`, input fee 100 ppk.
- **Card:** ICSerialNumber **58206920**, read again with `gp -i` before every command that changed the card: 14 reads, every
  one 58206920.
- **Owner and keys:** cardctl's TEST owner key; a random owner seed and a random refund key, made by the run and held only
  in its memory (never written or printed); the PIN 1234; the anchor block 976,817.
- **Tools:** this branch's `tools/cardctl` (setup, card-secret, keyset-keys, selftest, reset) and `tools/cardsim/client.cjs`
  and `cashu-crypto.cjs`, driven through `tools/chip`'s ChipBridge; the earlier runs' harness (`p19.cjs`, `mint45.cjs`,
  `firstload.py`) in a private copy, pointed at this branch. A tap is a real reset of the card by the reader.

| # | Item | Result |
| --- | --- | --- |
| 1 | Set-up | **pass.** `cardctl setup` in one selection (PIN, record with the refund key, the owner claimed with the owner's c, the anchor): 4.0 s with the process start. c read back with `card-secret` and checked against `GROUP_KEYS` for the date 0: the 1st owner's c the card has taken. Testnut's keyset taught (`keyset-keys`, 32 keys): the card worked out the same ID, 1.2 s |
| 2 | Pieces minted | **pass.** 518 fake sats as 12 pieces (1 to 256), locked to the card's key for the date 0 as the owner works it out from c; each signature's DLEQ checked, blind and unblinded |
| 3 | First load, one selection | **pass.** 12 pieces in the 04 form, the mint's proof kept: balance 518, 12 unspent. The whole contact **2,262 ms** (below) |
| 4 | A payment that needs change | **pass.** 9 pieces (511) for 100 to the till as 3 outputs, fee 1, change 410 as 5 outputs: signed at the first `SPEND_ALL_SIGN`, 2,498 ms from `BEGIN`. Good under BIP-340 under P + t·G, not under P. Testnut's swap `200`, 8 signatures; the 9 inputs `SPENT` |
| 5 | The change back on the card | **pass.** A new tap, no PIN: `GET_CHANGE` named the 5 openings (256, 128, 16, 8, 2); each `LOAD_CHANGE` took testnut's answer, into slots 12 to 16, the proof kept. Each piece's kept DLEQ checks under testnut's key; each `UNSPENT` at testnut. Balance 417, no opening left |
| 6 | The change spent | **pass.** The 5 change pieces (410) paid out in one payment at the end: signed at the first `SIGN` (806 ms), testnut's swap `200`, all 5 `SPENT`. So testnut took the change in a later swap |
| 7 | `SPEND_ALL_AGAIN` by digest | **pass.** Payment A (2 pieces) signed and its swap held back, as if its answer was lost; then payment B (1 piece) signed and swapped. In a new tap under the PIN: P1 `01` with A's message hash gave **A's signature** (20.6 ms); with B's hash, B's; P1 `00` gave **B's** (the last), not A's. P1 `01` with 32 zeros: `6A88`. P1 `01` with A's hash without the PIN: `6A88`. A's swap posted afterwards with the signature: `200`, its inputs `SPENT` |
| 8 | `AUTH` | **pass.** `selftest --pin` on the set-up card: 14 of 14, AUTH verified under BIP-340 three times |
| 9 | Left | **reset by the owner** (`cardctl reset --owner-key test`, 0.6 s) once the card was empty: fresh, no PIN, no record, no owner, a new card key, 0 pieces. The tag stays installed at `https://getfoxy.io/card` |

### Timings (reader round trips)

First load, 12 pieces in one selection:

| Step | ms |
| --- | ---: |
| `SELECT` | 10.3 |
| `GET_INFO` (the read) | 29.4 |
| `AUTH` | 490.0 |
| `GET_NONCE` P1 1 (the PIN key) | 19.8 |
| `VERIFY_PIN` sealed | 132.6 |
| `GROUP_KEYS` (date 0) | 76.4 |
| `LOAD_PROOF` x 12 | 1,337.3 (min 108.2, median 111.7, max 113.8) |
| `GET_INFO`, `GET_BALANCE` | 30.0, 30.1 |
| **The whole contact** | **2,261.8** |

Payments:

| Payment | `BEGIN` | `OUTPUTS` | `CHANGE` (each) | `SIGN` | `BEGIN` to the signature |
| --- | ---: | ---: | ---: | ---: | ---: |
| 9 pieces, 3 till outputs, 5 change outputs | 175.2 | 74.9 | 209.2 to 329.2 (median 244.8) | 952.1 | 2,498 |
| 2 pieces, 1 output (A) | 110.0 | 31.7 | | 682.2 | 874 |
| 1 piece, 2 outputs (B) | 100.4 | 55.0 | | 674.9 | 882 |
| 5 pieces, 5 outputs (the change spent) | 139.3 | 118.6 | | 805.9 | 1,114 |

`LOAD_CHANGE`: 512.4 to 521.4 ms (median 519.5, n = 5), each after a `KEYSET_KEYS` show of 53 to 55 ms. `SPEND_ALL_AGAIN`:
14 to 21 ms. `VERIFY_PIN` (plain) 16 ms. These are the 3.0 run of 2026-11-19's figures to within a few ms (`LOAD_CHANGE`
530 to 556 ms there).

### refcheck

- **PROVEN:** `d69742d0…` added, with "real signatures and real change verified on the chip"; taken off INSTALLED, which
  is now empty. refcheck says of the tracked file: "this exact file has run on a chip".
- **SIZES:** 42,485 was already there (True).
- The guides, README, the release notes, COMPONENT-RELEASES, SECURITY-MODEL, CASHU-CARD-HARDWARE and D227 say so; the
  checklist's money items are ticked.
- **The provisioner's `VALIDATED_LOAD_FILE_SHA256S`:** not changed. It takes a hash in a change of its own, with the
  operator's approval.

### Not run in this part

The rest of the checklist: `INBOX`, the largest payment of eight change outputs, the day's 300 loads, the clock and the
resets with an anchor, the holds, `LOCK_CARD`, tears, the certificate, a dollar card. No phone and no production mint was
used.

### Logs

In the run's scratch folder (`chip-money`), not kept: `session-M.log` (every command, its status and time), `p19-M.log`,
`state-M.json` (the play-money pieces and the payments), `bridge-M.log`, `guard.log`.

## More play-money tests (the same night, the same card)

On the keeper's yes, five more tests on the same card, the same file and the same mint (testnut, play money). Each
began with a fresh set-up and ended with the card emptied at testnut and reset by its owner. The serial was read with
`gp -i` before every step that changed the card and every endurance round (62 reads in all, every one 58206920), and
from the CPLC at every tap.

### Results

| # | Test | Result |
| --- | --- | --- |
| 1 | A first load within 5 s | **pass at 9, 12, 20 and 30 pieces** (1.92, 2.26, 3.17 to 3.19, 4.33 s). The limit is about 35 pieces (below) |
| 2 | A full card | **pass.** 128 places filled (30 in the first load, then 98), and the 129th piece refused with `6A84` and nothing stored. Then 86 rounds on the full card, every one right. Free memory the same throughout |
| 3 | The wait over the limit | **pass.** Every wait was the spec's count to the answer (table below). A payment within the limit signed at its first `SIGN`, so there is no floor in this branch |
| 4 | `SPEND_ALL_AGAIN` by digest after another payment | **pass**, in the money run above (item 7) |
| 5 | A retired keyset | **not run.** It needs a mint whose keysets we can rotate. testnut's keysets cannot be rotated from here. A local nutshell needs Docker started and its image downloaded, and nothing on this machine had a download approved. Skipped |
| 6 | Endurance | **pass: 226 pay-and-refill rounds** (86 on a full card, then 140 on a card of 20 pieces), every one right. The card's limit of 300 pieces a day ended each run, as designed. The `LOAD_PROOF` and `LOAD_CHANGE` times rise slowly with the day's loads (below) |

### 1. A first load within 5 s

**What counts as contact.** The tooling's `firstload.py` times one selection, from `SELECT`'s send to the last answer.
The app sends the same commands in the same order:

1. `SELECT`;
2. `GET_INFO`;
3. `AUTH`;
4. the sealed PIN (`GET_NONCE` P1 1, then `VERIFY_PIN` P1 01);
5. `GROUP_KEYS`;
6. one `LOAD_PROOF` a piece, in the 04 form, with the mint's proof kept;
7. `GET_INFO` and `GET_BALANCE`.

Not counted: the minting at the mint (before the tap), the keyset's teaching (done at set-up), and the process start.

| Pieces | The whole contact | One `LOAD_PROOF` (median) | Under 5 s |
| ---: | ---: | ---: | --- |
| 9 | 1,917 ms | 111.8 ms | yes |
| 12 | 2,262 ms | 111.7 ms | yes |
| 20 | 3,168 and 3,192 ms | 112.4 ms | yes |
| 30 | 4,331 ms | 113.2 ms | yes |

Everything but the loads takes about 0.92 s, of which `AUTH` is 0.48 to 0.49 s. Each piece adds about 0.113 s. So a first
load of about 35 pieces is the most that fits in 5 s on this chip.

### 2. A full card

- **Filled.** 30 pieces of 8 sats in the first load, then 98 in one more tap under the PIN. Each was read back, and its
  kept DLEQ checked under testnut's key. `GET_INFO`: 128 unspent, 0 empty.
- **The 129th piece:** `LOAD_PROOF` `6A84` in 31 ms, nothing stored. Still 128 unspent and balance 1,024.
- **A round**, three taps:
  1. Under the PIN: pay two pieces (16 sats) for 7 to the till, a fee of 1 and 8 of change; `SPEND_ALL_SIGN`;
     `CLEAR_SPENT`. Then testnut's swap.
  2. No PIN: `LOAD_CHANGE` of the change into a freed place.
  3. Under the PIN: one new piece from testnut, loaded with `LOAD_PROOF`.
- **Every round, checked:**
  - the signature good under BIP-340;
  - no wait;
  - two places freed;
  - the change's DLEQ good under testnut's key;
  - the two inputs `SPENT` and the change `UNSPENT` at testnut;
  - after the round: 128 unspent and balance 1,024.
- **No piece lost**, in 86 rounds on the full card.
- **Free memory**, persistent / transient bytes:
  - 72,620 / 2,084 at every reading: after the set-up, after the first load, full, after 5 rounds and after 86.
  - The same after each owner's reset and the next set-up.
  - Setting a card up again takes nothing more: the set-up's 27,484 bytes are kept through a reset and used again.

### 3. The wait over the limit

The set-up gave a limit on one payment of 200 sats (and a day of 100,000). The spec (`spec/APDU.md`, "The clock and the
limits") counts the waits as `max(0, W − ⌊2 × change outputs / 3⌋)`:

- W is 0 within the limit;
- for N limits' worth leaving the card, W is `WAIT_OVER_SIGNS` + `WAIT_MORE_SIGNS` × (N − 2), that is 10 + 4 × (N − 2).

| Payment (leaving the card, change) | N | Spec's waits | "Not yet" answers | Wait (ms) | From `BEGIN` to the signature |
| --- | ---: | ---: | ---: | ---: | ---: |
| 128 (127 + fee), no change | 1 | 0 | **0** | 0 | 1,089 ms |
| 256, no change | 2 | 10 | **10** | 4,730 | 5,825 ms |
| 768, no change | 4 | 18 | **18** | 8,520 | 9,730 ms |
| 1,024, no change | 6 | 26 | **26** | 12,330 | 13,561 ms |
| 301 (300 + fee), 5 change outputs | 2 | 10 − 3 = 7 | **7** | 3,320 | 5,555 ms |
| 211 (the change spent), no change | 2 | 10 | **10** | 4,730 | 5,832 ms |

- **Each "not yet" took 473.2 to 474.6 ms** (median 473.6). The chosen wait is that many answers of the card's own work.
- **A payment over the limit costs:** about 4.7 s for the first 200 sats past the limit, then about 1.9 s for each further
  200 sats.
- **The first `SIGN`** of a payment that waits took 712 to 803 ms, and gives the first "not yet".
- **No floor (M1):** the payment within the limit signed at its first `SIGN` (755 ms), as did every payment and round
  of tests 2 and 6 (no limit set there).

### 6. Endurance

| Run | Rounds | Wall time | Failures | Ended by |
| --- | ---: | --- | ---: | --- |
| full card, 128 places | 86 (5 + 81) | 10 min | 0 | round 87's `SPEND_ALL_CHANGE` `6A8F` ("past the day's 300 pieces"): nothing signed, nothing owed |
| 20 places | 140 | 16 min | 0 | the planned 140, ending at exactly 300 loads (`GET_INFO`: 0 left) |

- **Why the runs stop:** each round loads two pieces (the change and the new piece), and the card takes at most 300 pieces
  a day. So a card can make about 140 pay-and-refill rounds a day.
  - The card's clock cannot be moved a day on with a real block header tonight.
  - The owner's reset gives the count back: 300 again after each reset.
  - So the 226 rounds are two runs of one "day" each, not one run of 45 minutes.

Times per round, the full card's run (86 rounds; the median of the first ten, then of the last ten):

| Step | min / median / max | First 10 → last 10 |
| --- | --- | --- |
| `SPEND_ALL_SIGN` (2 pieces, 1 output, 1 change) | 695 / 698 / 731 ms | 701 → 698 |
| The paying tap (to `CLEAR_SPENT`) | 1,581 / 1,604 / 1,803 ms | 1,626 → 1,607 |
| `LOAD_CHANGE` | 543 / 557 / 571 ms | **545 → 570** |
| `LOAD_PROOF` | 125 / 136 / 159 ms | **126 → 146** |

The 20-place run (140 rounds):

| Step | min / median / max | First 10 → last 10 |
| --- | --- | --- |
| `SPEND_ALL_SIGN` | 684 / 687 / 706 ms | 690 → 687 |
| `LOAD_CHANGE` | 513 / 534 / 555 ms | **516 → 549** |
| `LOAD_PROOF` | 110 / 129 / 316 ms | **112 → 145** |

- **The signature does not drift.** Its time is flat in both runs.
- **The loads drift, with the day's loads.** Each load is about 0.12 ms slower than the one before, and the drift is
  linear:
  - `LOAD_PROOF` went from 126 to 146 ms in steps of about 2.7 ms every 10 rounds;
  - the 98-piece fill showed the same slope (117 to 139 ms).
- **It starts again after a reset.** The run after the reset began at 111 ms. So it follows the loads since the card was
  set up or reset, not the place loaded into (both runs used places 0 and 1).
- **How much it can cost:** the 300 loads of a day bound it at about +35 ms a load. Inference, not measured: the card
  checks a new piece against a list that grows with the day's loads.
- **Other failures:** none. One `LOAD_PROOF` of 316 ms, and one testnut mint of 12.8 s; neither recurred.

### The card at the end

- Reset by its owner after the last run: fresh, no PIN, no record, no owner, 0 pieces.
- `selftest` 13 of 13.
- The tag reads `https://getfoxy.io/card#new`.
- `gp -l`: the opener, the card's applet and the tag, and the package.
- Free memory 72,620 / 2,084 bytes. The set-up's storage is kept, as after the first set-up of this file.

### Logs

In the run's scratch folder (`chip-money`), not kept:

- `session-F.log`, `session-W.log`, `session-E3.log`;
- `rounds-F2.jsonl`, `rounds-F6.jsonl`, `rounds-E3.jsonl` (one line a round);
- `p19-*.log`, `bridge-*.log`;
- `guard.log`.
