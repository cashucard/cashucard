# The neutral 3.0 file (9ac55c1) on the reader's sample card 58206920: the install, the tag's address at install, and ten create cycles (2026-11-21)

The 3.0 file of branch `neutral-cashu-card` at 9ac55c1, whose NFC tag takes its address from the install parameters (D227).
It was put on the reader's sample card, tried, and left there, fresh, with the tag at `https://getfoxy.io/card`.

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
