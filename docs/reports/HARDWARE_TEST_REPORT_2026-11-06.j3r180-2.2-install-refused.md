# J3R180 refuses applet 2.2's constructor at create (2026-11-06)

ENG-823, under ENG-818. The first 2.2 CAP ([D175](../DECISIONS.md#d175)) loaded on
a J3R180, and the chip then refused to create the card's applet. The load file's
size is not the cause; the constructor's 4,321 extra persistent bytes are
([D176](../DECISIONS.md#d176)).

## Environment

- Card: NXP J3R180, CPLC serial **09336320**, GlobalPlatform factory keys, SCP02.
- Reader: ACS ACR122U.
- Tool: GlobalPlatformPro (`gp`) v25.10.20.
- Time: about 07:12Z.

## What ran

| CAP | `--install` (load and opener) | `--create` card applet `F043415348554341524401` | `--create` tag `D2760000850101` |
| --- | --- | --- | --- |
| 2.2 first build, sha256 `51ddeee44c2fabc369c115d69bd05594478f11867ea75ca1784698222d32ea37`, load file 21,540 B by refcheck's measure | ok: 88 LOAD blocks, 14.68 s, package LOADED, opener SELECTABLE | **`6F00` after 1.76 s** (`INSTALL [for install and make selectable] failed: 0x6F00`) | not reached |
| 2.1 release, sha256 `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` (control, same card, 2 min later) | ok: 82 blocks, 13.79 s | ok, 2.19 s | ok, 1.02 s |

Before the 2.2 attempt, 09336320 held the private compact image (package
`F04341534855434D5054`, opener and main applet instantiated); it was deleted
cleanly. The card ends on 2.1 with all three applets.

## The second card

Card 07297620 gave the same `6F00` (after 1.5 s) for the 2.2 card applet. That
card also refused the compact image's main applet (ENG-817), so its answer is no
evidence about 2.2. It now holds the 2.2 package with the opener and the tag and
no card applet.

## Reading

- **The load file's size installs.** 21,540 bytes loaded, so refcheck's table now
  records it as a size that installs (`tools/refcheck.py`).
- **The constructor's allocation is what was refused.** 2.2's constructor asked
  for 4,321 persistent bytes more than 2.1's. It is the install-time allocation
  limit [D17](../DECISIONS.md#d17) and [D10](../DECISIONS.md#d10) record (+300 B
  installed, +12,288 B refused, the same bytes granted by a command after the
  install), which `docs/HARDWARE_DEPLOYMENT.md` had flagged as unmeasured for 2.2.

## The USB port

On 07297620, three LOAD runs dropped with `SCARD_E_NOT_TRANSACTED`, at blocks 7, 7
and 75. Every card answer before each drop was `9000` and under 140 ms. The drops
stopped once the ACR122U was moved to another USB port. Suspect the host's port
before the card when a LOAD drops like this.

## Not covered

The fixed build (ENG-823: the record's two large arrays reserved at the first
`SET_CARD`; load file 21,631 bytes, CAP sha256
`86839ccf74d9b7a2aa7f7b8d8d47af1e1649ae14f30a4ac135f285e277e1f66d`) has not been
installed yet. Its install result, and whether the first `SET_CARD` is given the
4,285 bytes, are pending on the bench card.
