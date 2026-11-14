# Hardware Deployment Guide

GlobalPlatform packaging and deployment for the Cashu card applet, protocol 2.3
([D18](DECISIONS.md#d18), [D19](DECISIONS.md#d19), [D26](DECISIONS.md#d26),
[D175](DECISIONS.md#d175), D183 to [D198](DECISIONS.md#d198)).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Java | 11+ | `brew install openjdk@17` |
| Apache Ant | 1.10+ | `brew install ant` |
| GlobalPlatformPro (gp) | 20.01.23+ | See below |
| JavaCard SDK | 3.0.5+ (`jc305u4_kit`) | See [Build the .cap file](#build-the-cap-file) |
| Python 3 | 3.9+ | for `tools/stripcap.py` and `tools/refcheck.py`, which the build runs |
| Physical card | NXP JCOP4 SmartMX3 (JavaCard 3.0.5+) whose configuration has `ALG_EC_SVDP_DH_PLAIN_XY` and `ALG_EC_PACE_GM` | **Not** JavaCard 3.0.4; see [Supported targets](#supported-targets) |
| PC/SC reader | Any ISO 7816-4 reader | macOS: built in; do not install `pcsc-lite`, which conflicts with the system daemon. Debian/Ubuntu: `sudo apt install pcscd libpcsclite-dev`, with `pcscd` running ([`tools/cardctl/README.md`](../tools/cardctl/README.md)) |

### Install GlobalPlatformPro

```bash
# Download gp.jar
curl -L https://github.com/martinpaljak/GlobalPlatformPro/releases/latest/download/gp.jar \
     -o /usr/local/bin/gp.jar

# Create wrapper script
cat > /usr/local/bin/gp << 'EOF'
#!/bin/sh
exec java -jar /usr/local/bin/gp.jar "$@"
EOF
chmod +x /usr/local/bin/gp
```

---

## Build the .cap file

Supply the JavaCard SDK yourself and point `jc.sdk` at it. One clone covers
every SDK version:

```bash
# One-time: fetch the JavaCard SDK kits (~200 MB, all versions)
git clone https://github.com/martinpaljak/oracle_javacard_sdks ~/.javacard/sdks
```

```bash
cd cashucard/applet

# Build. jc.sdk defaults to ~/.javacard/sdks/jc305u4_kit; override if you
# cloned elsewhere. It must be a 3.0.5 (or later) kit: see below.
ant cap
ant cap -Djc.sdk=/path/to/jc305u4_kit   # explicit form

# Output: target/cashu-javacard-2.3.0.cap, one file with three applets in it: the opener, the card's, and the NFC tag
ls -lh target/cashu-javacard-2.3.0.cap
```

The build then takes the Descriptor component out (`tools/stripcap.py`: the chip
keeps nothing of it) and checks the load file's size against what the J3R180 has
been seen to install (`tools/refcheck.py`, from
[FOXY-CARD-HARDWARE.md](FOXY-CARD-HARDWARE.md)). The 2.2 build ([D175](DECISIONS.md#d175):
`GET_OUTBOX`) was first **21,540 bytes** by refcheck's measure, and on 2026-11-06 a
J3R180 (09336320) loaded it (88 blocks, 14.68 s, opener selectable), then refused
to create the card's applet, `6F00` after 1.76 s. The cause is inferred, not shown:
its constructor asked for the record's 4,321 bytes of persistent memory, likely more
than the chip gives at install, but the bench did not separate that from the size
window refcheck exists to catch. The
2.1 CAP, re-created on the same card two minutes later, installed all three applets
([D176](DECISIONS.md#d176),
[the report](reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md)).
refcheck's table records 21,540 as a size that failed (the only measurement there is a
refusal). The 2.2 build that followed reserves the
record's two large arrays at the first `SET_CARD` instead (D176): its load file is
**21,631 bytes** (127 past a multiple of 256), sha256 `86839ccf…`. It installed on
the same J3R180 on 2026-11-06, opener first, in the three steps below (the card
applet created in 2.17 s; `cardctl info` says 2.2), and refcheck's table has it as a
size that installs. Its first `SET_CARD` was given the record's 4,285 bytes, and the
assisted settlement ran end to end the same morning: an offline till's 7 sat
payment, the packet read from the card, relayed by the phone, recovered once by the
till ([the end-to-end report](reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-assisted-settlement.md)).
The 2.1 build was 20,068 bytes
by refcheck's measure (100 past a multiple of 256). It installed on a J3R180 with
the opener first, in the three steps below, on 2026-10-14, and refcheck's table has
it as a size that installs ([D26](DECISIONS.md#d26),
[the report](reports/HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md)). The 2.0 build was 20,060 bytes;
v2.0.0-rc.1 (sha256 `59f66673…`) installed on the J3R180 with the opener first, at
20,057 bytes as the install counted the load file, and refcheck's table has it as a
size that installs ([D25](DECISIONS.md#d25)).
The 2.3 build is **36,953 bytes** by refcheck's measure (89 past a multiple of 256;
the Method component 30,069), in 150 blocks of 247 bytes: the load file inside the
tracked CAP (`applet/target/cashu-javacard-2.3.0.cap`), whose own sha256 is not the
CAP's ([Install](#install) gives both). Unpadded (`sizeTheFile` is empty), this
exact file has run on a chip: the bench J3R180 of the run of 2026-11-14 below. It is the source of the run below with [D200](DECISIONS.md#d200) to
[D204](DECISIONS.md#d204) added (a payment's change counted
when it is made, the owner's anchor bringing the clock back on an empty card, a header at
the floor's work beginning and ending no day, with `REFRESH` bringing the clock back,
the card's secret c made from its owner's words at the claim or the hand-over, and a fresh
or newly set-up card held to the same bar, with the owner's back form bringing back the
day of loads, and the first set-up's anchor bringing back any clock on an empty card); refcheck keeps its size as one
that installs and its load file's sha256 on its list of hashes, from that run (the checklist below).

On 2026-11-13 a J3R180 was given earlier 2.3 source padded to three sizes: it
installed the files of 33,647 and 35,213 bytes and refused the card's applet in
the one of 32,777 (`6F00`, twice), so refcheck refuses any build from 32,700 to
32,850. Its constructor asks for 30,056 bytes of persistent memory,
and its first `SET_CARD` reserves 26,619 more: the mint's proofs (12,288), the
record (4,293), the paid list with the signatures it keeps (9,235), the openings'
keys (536) and the keyset table (267) (D176, D183, D184, D191); a certified card reserves
the certificate's 1,027 bytes at its first `CERT_WRITE` (D192). refcheck's table
keeps the sizes and the hash of the files of that day's run (below). A file is released by
a chip run, which installs it first, as the three steps below, and adds its answer to
refcheck's table.
If a later build lands on a size the chip refuses, move it with
`CashuApplet.sizeTheFile` to a size known to install and add the answer to
refcheck's table.

The 2.3 chip run, on 2026-11-13, on the bench J3R180 09312320 (CPLC serial
checked first; the public default GlobalPlatform test key), through
an ACS ACR39U contact reader, times as the reader's round trip. The CAP tracked
then, before D200 (sha256 `b1711046…`, load file 35,466 bytes, `48b8597c…`), loaded in 16 s and the
card's applet was created in 2 s; `SELECT` answered `02 03` and the tag
`getfoxy.io/card`. `cardctl --timing selftest --rounds 10`: 20 of 20, ten `AUTH`
signatures verified under BIP-340 and two compared for a fresh R, `AUTH` 626 ms. `setup` (PIN, record at
`testnut.cashu.space`, the TEST owner key, anchored at a real header): the first
`SET_CARD` answered `9000` in 1,032 ms, so the framing check passed on the chip, and
the claim took its six `SET_OWNER` in 4.1 s. Real signatures: 64 sats of testnut's
fake ecash (a FakeWallet mint, no real money; CDK mintd 0.18.1, a 33-byte
keyset `017bc604…`, input fee 100 ppk) minted as format-4 `SIG_ALL` secrets locked to
the card's key for the date 0 from `GROUP_KEYS`, each DLEQ checked, loaded under the
PIN with the mint's proof (`LOAD_PROOF` P2 02, 226 ms each) and read back with the
proofs checked; `KEYSET_KEYS` taught the keyset (the card worked out its 33-byte ID).
A payment of the pieces of 32 and 16 to a till's 24, a fee of 1 and the card's own
change of 23 (`SPEND_ALL_CHANGE` 449 to 673 ms each) was signed after one "not yet"
(`SPEND_ALL_SIGN` 596 and 845 ms; 3.9 s from `SPEND_ALL_BEGIN`), the signature good
under P + t·G and not under P, and testnut took the swap (`200`, both inputs
`SPENT`). Real change: in a new tap with no PIN, the four openings' keys shown in
the keyset's tree (`KEYSET_KEYS` P1 3, 82 ms) and the mint's answers loaded with
`LOAD_CHANGE` (1.02 to 1.03 s each; the DLEQ kept, each piece `UNSPENT` at testnut);
a later payment of two of those pieces (16 and 4, to a till's 8) was taken by
testnut too (`200`, both `SPENT`), and its own change came back the same way. The
keys `GROUP_KEYS` gives for the dates 0, 1795823776, 1796428800 and 1799000000 are
the ones the owner works out from c (opened by `card-secret` under the TEST owner's
grant). `INBOX` (30 ms) is the owner's SHA-256 of c and the week for the week the card
answered; this card's clock was anchored in the week it was set up (week 2967), so a
real header of the week before (block 975,131) answered `9000` and moved nothing, and
`INBOX` still named week 2967, as no reader's header moves the clock back. The card was then
emptied (its 30 sats paid to testnut, `GET_BALANCE` 0), the package deleted and the
same file installed again (16 s and 2 s), and set up once more (`SET_CARD` 1,040 ms)
anchored at that header of the week before: `INBOX` named week 2966, and after
`SET_HEADER` with the tip's header (59 ms) week 2967, each the owner's SHA-256 of the
new c and the week. After the run a sealed `VERIFY_PIN` (P1 01, 90 bytes; run once)
answered `9000` in 278 ms (the clear one 19 ms; `GET_NONCE` P1 1 43.7 ms), and
`selftest` passed 20 of 20, `AUTH` 626 ms, as before. The signer's temporary key's
kind is not said by the card, so a test-only build, this source with one command
added that answers it (load file 35,509 bytes, sha256 `1bf178bc…`; CAP sha256
`9b197fb3…`; never shipped, its diff kept with the run's records), was installed on
the same card: it answered `01`, the key cleared on deselect, the kind the signer
asks for first, and the install passed with it in RAM. The proven file was
installed again after it. Then, with a refund key: the card set up again with one
(`SET_CARD` 1,214 ms), c sealed to it by `GET_CARD` P1 3 opened with r and checked
against `GROUP_KEYS`; 64 fake sats minted as dated pieces (D 30 days past the card's
clock; `data` P + t·G, `locktime` D, `refund` R + u·G, `sigflag` `SIG_ALL`; each DLEQ
checked) and loaded (`LOAD_PROOF` P1 01 P2 02, 227 to 234 ms), each secret rebuilt
from the card's piece equal to the minted one; a payment of dated pieces signed after
one "not yet" (597 and 699 ms, 4.3 s from `SPEND_ALL_BEGIN`), good under P + t·G for
D and not under P, and taken by testnut (`200`, inputs `SPENT`); its dated change
written back by `LOAD_CHANGE` (1.02 to 1.03 s each, `UNSPENT`) and spent again in a
later swap testnut took; `GROUP_KEYS` for D (161 ms) equal to the owner's t,
P + t·G and R + u·G; `selftest` 20 of 20; the card emptied at the end. Not run:
taking money back after D with the refund key at a mint (it needs a wait past D),
tears, a phone and a production mint ([the hardware
report](reports/HARDWARE_TEST_REPORT_2026-11-13_J3R180_2.3.md)).

The chip run of the tracked file, on 2026-11-14, on the same bench J3R180 09312320
(CPLC serial checked first; the default test key), through the same reader. The CAP
`30c7bb8d…` (load file 36,953 bytes, `f216644a…`) was installed three times, each in
three steps (load 16 to 17 s, card's applet 2 s), `SELECT` `02 03` and the tag
`getfoxy.io/card` each time; the headers were real mainnet headers from
mempool.space (blocks 974,766 to 975,777), the mint `testnut.cashu.space`, the
owner the TEST key and a second test key, and the seeds two made up for the run.
The first `SET_CARD` after an install answered `9000` in 1,221 to 1,223 ms each time
(1,013 ms after a reset), so the framing check passed. The first set-up's anchor
([D204](DECISIONS.md#d204)): on the fresh card, in one selection, `SET_PIN`,
`VERIFY_PIN`, `SET_CARD`, `SET_HEADER` with the tip, then `SET_HEADER` with a header an
hour older answered the older time (75 ms); after a `SELECT` the older header moved
nothing, and after the tip it answered the tip's time. Given the tip first, `setup`
with an anchor 3 h 12 min older went, and `info` said the anchor's time; in the next
tap an older header still moved nothing and the tip moved the clock on. `selftest`
passed 20 of 20, `AUTH` 632 ms. The owner's c ([D202](DECISIONS.md#d202)): `setup`
with `--owner-seed` (`SET_OWNER` P1 01 267 ms, the six askings 679 to 858 ms) said c
was read back, the first owner's c; `card-secret --owner-seed --date` said the
take-back key r + u for D (2026-12-15) is the private key of the card's refund key for
D, and the one-liner from the seed, P and r alone gave the same c and R + u·G. Real
signatures and real change: 64 fake sats as dated pieces of D and 576 undated, each
DLEQ checked and loaded under the PIN (`LOAD_PROOF` 227 to 235 ms); payments with the
card's own change signed (good under P + t·G, not under P) and testnut took each swap;
the change came back by `LOAD_CHANGE` in a new tap with no PIN (1.02 to 1.03 s each,
`UNSPENT`) and two of those pieces were paid again, testnut taking that swap too. The
largest payment, eight change outputs (255 of change), signed with no "not yet"
(`SPEND_ALL_SIGN` 859 ms, not `6A96`), and its eight pieces came back. The day of
loads ([D200](DECISIONS.md#d200)): 268 made-up pieces brought loads left to 2; a
payment with two change outputs signed and left 0, both came back with no PIN, then
`LOAD_PROOF` and `SPEND_ALL_CHANGE` answered `6A8F` (`SPEND_ALL_SIGN` `6985` after it,
the piece still unspent, no change owed), and the same piece paid with no change
signed. The clock set back ([D200](DECISIONS.md#d200)): the reset by the PIN with a
header 8 days older (60 askings, 45 s) left the clock at it and 300 loads left; the
owner's reset with it (`RESET_CARD` 372 ms) and a hand-over to a header 3 h older
(`SET_OWNER` 1,056 ms) did too, and the tip moved the clock on; with a piece on the card
each answered `6A8D` and the clock did not move. `INBOX` named week 2966 and, after the
tip, 2967, each the owner's SHA-256 of c and the week. `REFRESH`
([D201](DECISIONS.md#d201)): with a day's limit of 1,000 and a payment of 8, the plain
form with a header 3 h older moved nothing and named `--back`; the back form (125 ms)
brought the clock and the day's window back to it with the 8 it had counted; `REFRESH`
P1 02 answered `6B00`, and on a card with no owner `refresh --pin` with an older
header moved nothing and named the anchored reset. A hand-over with a second seed
(`SET_OWNER` 1,050 ms) read back the second owner's c, and the first seed's was
refused. In the first set-up of a card with no owner, `SET_OWNER` P1 02, P2 55 (both
forms) answered `6B00`, a claim whose check was another seed's `6A80` and one with no
envelope before it `6985`, the card unchanged. The hardest's bits (`GET_CARD` 40 to
43) stayed those of the tip after `set-card` and after the owner's reset with no
anchor. After the run a sealed `VERIFY_PIN` answered `9000` in 273 ms and `selftest`
passed 21 of 21 with the PIN. Not run: `LOCK_CARD` (the owner's reset of a locked
card), taking money back after D with the refund key, a header far ahead or a weak
clock (no real header makes either), tears, a phone and a production mint ([the
hardware report](reports/HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md)).

> **Three applets, installed in order.** The chip refuses the card's applet as the
> first instantiated from its package (no answer, or `6F00`); it takes it once a
> small applet has been instantiated before it. So the file lists `Opener` first,
> and the install is three commands (below): the opener, the card's applet, and the
> NFC tag, which is `Tag`, listed last and made under the NFC Forum's own name,
> `D2760000850101`, given as the instance AID. Measurements and the rest of what
> the chip has room for: [FOXY-CARD-HARDWARE.md](FOXY-CARD-HARDWARE.md).

> **The mint's proofs are reserved after install.** The 12,288 bytes that hold
> them are not made at install: the chip would refuse the card's applet if its
> constructor asked for them. The first `SET_CARD` reserves them. A card that is
> refused them is set up all the same and works as a card with no room for proofs.
> The assisted-settlement record's 4,293 bytes (the record, 3,692, and the payment
> in hand's outputs and its reader's keyset, 601; 2.2's were 4,285) are reserved the
> same way, after them ([D176](DECISIONS.md#d176)); a card refused those keeps no
> record and answers `GET_OUTBOX` with `6A88`.

> **3.0.5 is a hard floor.** `SchnorrHW` performs the `k·G` scalar multiply with
> `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY`, which was introduced in JavaCard 3.0.5
> and does not exist in 3.0.4. A 3.0.4 kit cannot convert this applet, and a
> 3.0.4 card cannot run it.

> **The chip needs both key agreements.** `SchnorrHW` asks for
> `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY` (signatures, `LOAD_CHANGE`'s r·K, the
> sealed PIN) and `KeyAgreement.ALG_EC_PACE_GM` (the point addition: a change
> output's blinding, the date keys, `LOAD_CHANGE`) in its constructor. A chip whose configuration
> lacks either refuses the card's applet at install. JCOP4 cards are sold in more
> than one configuration, so a J3R180 is not enough by its name: a J3R180 whose
> configuration lacks either algorithm cannot run the card. The bench card of the
> 2.3 chip run has both.

---

## Connect and verify card

```bash
# Insert card into reader, then:
gp --list

# Expected output (fresh card):
# ISD: A000000151000000 (OP_READY)
```

---

## Install

The CAP tracked in this repo is **applet version 2.3**, sha256
`30c7bb8d98274da0953e2e90c93027fa2313391b05a2211a9489a2111dbaed83`
(`applet/target/cashu-javacard-2.3.0.cap`). The load file in it, the bytes a card
is LOADed with (refcheck's measure, 36,953 bytes), has sha256
`f216644a316e4c9de0f8bed2a4f32e90b48fa18624ed95a8f8950503f9464440`: the hash the
provisioner checks before it loads a card, and the build a card's certificate
names ([CERTIFIER.md](CERTIFIER.md)), not the CAP's. A CAP you build yourself hashes
differently even from identical source, because the converter writes a creation
timestamp into `META-INF/MANIFEST.MF`. Every other entry is byte-identical when
built with JDK 17 and the kit CI pins (`jc305u4_kit` at `oracle_javacard_sdks`
commit `6a75ec0d`), and CI checks exactly that on every push. So before
installing your own build, compare every entry except `META-INF/MANIFEST.MF`
against the tracked CAP:

```bash
# From applet/, after `ant cap` has overwritten target/cashu-javacard-2.3.0.cap
git show HEAD:applet/target/cashu-javacard-2.3.0.cap > /tmp/tracked.cap
rm -rf /tmp/cap-tracked /tmp/cap-built
unzip -q /tmp/tracked.cap -d /tmp/cap-tracked
unzip -q target/cashu-javacard-2.3.0.cap -d /tmp/cap-built
diff -r -x MANIFEST.MF /tmp/cap-tracked /tmp/cap-built && echo "same CAP as the tracked one"
```

Any output from `diff` means the two CAPs differ; do not install. After
installing, `SELECT` must answer `02 03` for the card's applet's whole AID (below).

```bash
# Load the file and instantiate the opener (gp installs one applet of a file at a time)...
gp --install target/cashu-javacard-2.3.0.cap --applet F04341534855434152444D
# ...then create the card's applet from the loaded package
gp --create F043415348554341524401 --package F0434153485543415244 --applet F043415348554341524401
# ...then the NFC tag, under the NFC Forum's own name as its instance AID
gp --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454

# Verify installation
gp --list
# Expected (among the rest):
#   APP: F04341534855434152444D (SELECTABLE)   ← the opener
#   APP: F043415348554341524401 (SELECTABLE)   ← the card's applet
#   APP: D2760000850101 (SELECTABLE)           ← the tag

# The tag, read as a phone reads it: its name, the capability container (15 bytes), the NDEF file (2, then 20 bytes)
gp -d -a 00A4040007D2760000850101 -a 00A4000C02E103 -a 00B000000F -a 00A4000C02E104 -a 00B0000002 -a 00B0000214
# Expected: 9000 / 9000 / 000F20003B00340406E104001600FF 9000 / 9000 / 0014 9000 / D101105504 + "getfoxy.io/card" 9000
```

### Setting a card up

A card straight from the install has no PIN, no record and no owner: it holds
nothing and cannot be loaded, and any reader in range can set it up. Set it up
before it leaves your hands. A 2.3 card is set up in one selection, its first
set-up ([D196](DECISIONS.md#d196)): the PIN, the record, the owner (claimed, with
the tip block header as the anchor, [D20](DECISIONS.md#d20)) and the limits, all
sent by one `cardctl setup` while the card stays on the reader. Each cardctl
command selects the card again, which ends the first set-up, so the same steps as
separate commands leave a card with a PIN and nothing else.

```bash
cd tools/cardctl
python3 cardctl.py setup --pin 1234 --mint https://forge.flashapp.me --owner-key <32-byte hex> --anchor <the tip header, 80 bytes hex> --day 50000 --payment 0 --allowance 0 --budget 7
python3 cardctl.py info
python3 cardctl.py selftest --pin 1234
```

- **Checked first.** `setup` checks the PIN, the owner key, the mint (1 to 77
  printable characters), the refund key (`--refund`, a point of the curve), the
  anchor's work and the limits before it writes anything to the card, and refuses
  a card that is not fresh from its install or a reset. A card with a factory
  record (mint `-`) is fresh, and keeps its design.
- **The owner key.** `--owner-key` is the holder's P-256 private key. A bench card
  may be set up under cardctl's TEST key with `--test-owner-key` in its place:
  anyone with this repository holds that key, and can change the card's PIN and
  spend it. A card handed to a person is owned by the holder's phone
  (flash-mobile's "Set up this card").
- **The owner's c** ([D202](DECISIONS.md#d202)). `--owner-seed <the owner's 64-byte
  BIP-39 seed, hex>` gives the card a c made from it and the card's own key (`SET_OWNER`
  P1 = `01` before the claim), then reads c back and finds its n before it says so, so
  that a phone restored from the words has c (a lost card's take-back needs the card's
  key P and the pieces too); without it the card keeps the c it drew.
- **The card's clock** ([D204](DECISIONS.md#d204)). `--anchor` is required: setup sends
  nothing without it. On a 2.3 card the claim's anchor, the first set-up's of an empty
  card, becomes the clock even where the card's clock was later (a header far ahead set
  it), and setup says it brought it back; a card older than 2.3 with such a clock is
  refused, naming `cardctl reset --pin <a PIN> --anchor <the tip header>` on the empty
  card, then setup ([D203](DECISIONS.md#d203)). `card-secret --owner-seed <it>` checks the c the card holds against
  the seed alone, and says which owner's c of the card it is.
- **Dollars.** `--unit usd` sets a dollar card up; its limits are in cents.
- **The anchor.** `python3 cardctl.py tip --url <the ops service>` prints the tip
  header.
- **A set-up that stops.** If `setup` stops after the PIN, it prints what the card
  now holds and the way on:
  - a card claimed (owner yes) is set up but for its limits: send them with
    `set-limit --owner-key <…>`;
  - a card with a PIN and no owner holds nothing, and nothing more can be written
    to it until it is reset by its PIN, `python3 cardctl.py reset --pin 1234`
    (about 45 seconds on the reader), then set up again;
  - a first `SET_CARD` that answers `6F00` is the chip's ECDH framing
    ([ECDH framing probe](#ecdh-framing-probe-at-set_card)).

---

## Test install / select / deselect lifecycle

```bash
# SELECT the card's applet by its whole AID, F0 CASHUCARD 01
gp --apdu 00A404000BF043415348554341524401

# Response: 0203 9000  (applet version 2.3 + SW_OK = applet responding)
# A card that answers 6A82 has no 2.x applet: it is a 0.x or Foxy 1.x card and needs an update.
# Do not SELECT the package AID alone (00A404000AF0434153485543415244): on the chip that
# partial name reaches the opener, instantiated first, which answers 9000 with no version
# and 6D00 to every command after it (D25).

# GET_INFO (INS 0x01)
gp --apdu B0010000

# Response: 02 03 80 00 00 80 FF 00 04 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
#   v2.3 | 128 slots | 0 unspent | 0 spent | 128 empty | caps=FF | PIN none | format 4 | 3 tries | not locked | no record | no limit | no owner | no clock | no window | 0 spent | no change owed
# SW: 9000

# GET_PUBKEY (INS 0x10)
gp --apdu B0100000

# Response: 33-byte compressed secp256k1 public key + SW 9000
```

`cardctl selftest` passes a card answering `02 01`, `02 02` or `02 03`, the versions it
knows, and fails any other, a later 2.x among them (use a cardctl of that version): a card on v2.0.0 is swept and reinstalled ([D26](DECISIONS.md#d26)). cardctl
selects the whole AID first and takes a `9000` without a version as no answer.

**On the chip (ENG-681, 2026-10-13).** v2.0.0-rc.1 installed on the J3R180 in the
order above (the opener, then the card's applet, then the tag), at 20,057 bytes.
`SELECT` of `F0 43 41 53 48 55 43 41 52 44 01` answered `02 00 9000`; `SELECT` of the
package AID `F0 43 41 53 48 55 43 41 52 44` answered `9000` with no body, and the next
command `6D00`: the opener. `cardctl selftest` passed 12 of 12 once it selected the
whole AID first, and `AUTH` took 833 to 854 ms a signature on an ACR122U (0.4 took
814 ms; the constant-time multiply of [D21](DECISIONS.md#d21) costs about 3%).

---

## Reinstall (delete + install)

**A card is reinstalled only when it holds nothing and is owed nothing.** Spend or
move every piece first (`GET_INFO` bytes 3 and 4 both `00`), then bring home any
change the card is owed: on a 2.3 card `GET_INFO` byte 29 is `01` while a payment's
change has not come back to it; on a 2.1 or 2.2 card, whose byte 29 means something
else, `GET_CHANGE` (`B0 19 00 00 00`) answers a count above `00`. The holder's wallet
brings the change home: it reads the opening with `GET_CHANGE`, asks the mint for it
(NUT-09 restore) and writes it back. Deleting the applet before then loses that
change for good, because the opening's secrets never leave the card. The provisioner's
reset, cardkit's `resetOwnedCard` and ops `local-reset` refuse such a card.

```bash
# Check first: GET_INFO, then (2.1 or 2.2 only) GET_CHANGE
gp -d -a 00A404000BF043415348554341524401 -a B0010000 -a B0190000

# Delete the tag, the card's applet, the opener, then the package (that order)
gp --delete D2760000850101           # the tag
gp --delete F043415348554341524401   # the card's applet
gp --delete F04341534855434152444D   # the opener
gp --delete F0434153485543415244     # the package

# Re-install: the opener first, the tag last
gp --install target/cashu-javacard-2.3.0.cap --applet F04341534855434152444D
gp --create F043415348554341524401 --package F0434153485543415244 --applet F043415348554341524401
gp --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454
```

The chip refuses to delete an instance that something still refers to, which is why the
instances go one by one and in this order, and why no static field of the package refers
to an object an applet instance made (`Tag` holds no reference to the card's applet; it
asks for a shareable interface at each selection and keeps nothing of it).

---

## Upgrade from 0.x, and the field-card sweep

There is no in-place upgrade: 2.0 is a new AID and a new wire, and a reinstall
makes a new card key. **Every piece on a card is P2PK-locked to its key, so a
card is swept before it is deleted.** The same holds for an upgrade between 2.x
versions (2.1 or 2.2 to 2.3): a 2.x card is also owed no change before it is
deleted (`GET_INFO` byte 29 on 2.3, `GET_CHANGE` on 2.1 and 2.2, as in
[Reinstall](#reinstall-delete--install)). The v0.2 reinstall on the J3R180 stranded
5 sat this way (see the [hardware test report](reports/HARDWARE_TEST_REPORT_2026-09-22.j3r180.md)).

The 0.x applet is sunset ([D18](DECISIONS.md#d18)). Both apps drop it: a card
on the 0.x AID (`D2 76 00 00 85 01 02`, `SELECT` answers `00 0X`) or on Foxy's
1.x AID shows "This card needs an update", and neither app spends from it or
loads it.

**The one funded field card (operator-run, a release precondition for both
apps):**

1. With the **current** (0.x-speaking) app releases, before the 2.0 apps ship,
   spend the card's whole balance to an account the operator controls (a
   payment at the till, or the holder's withdraw), and check at the mint that
   the swap settled.
2. `python3 tools/cardctl/cardctl.py dump --mint <mint> --out field-card.json`
   (it selects the 0.x applet) as a record of what was on it; every slot should
   now be spent.
3. Delete the 0.x applet (`gp --delete D276000085010201`, then
   `gp --delete D2760000850102`), install 2.0 as above, and set the card up.
4. Record the date, the card's old and new keys and the swept amount here.

| Date | Card | Old key | New key | Swept | By |
|---|---|---|---|---|---|
| (pending) | J3R180 field card | | | | |

For production cards, use a secure messaging channel (SCP02/SCP03) and rotate the
card manager keys: a card left on its factory keys can have the applet deleted,
and the money with it, by anyone with a reader.

---

## Schnorr hardware path (SchnorrHW)

`SchnorrHW.java` implements BIP-340 using only `javacard.security.*`:

| Step | API used |
|------|----------|
| SHA-256 | `MessageDigest.ALG_SHA_256` |
| k·G scalar multiply | `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY` |
| [s]G + H point addition (change blinding, date keys) | `KeyAgreement.ALG_EC_PACE_GM` |
| BIP-340 aux randomness | `RandomData.ALG_SECURE_RANDOM` |
| 256-bit mulModN | Schoolbook 256×256, no secret-dependent branch ([D21](DECISIONS.md#d21)), + DELTA reduction in fixed passes, n taken off by a mask |
| 256-bit addModN | One pass for the sum and its compare with n, then n taken off by a mask: the same work for every input |

DELTA = 2^256 mod n = `0x00...01 45512319 50B75FC4 402DA173 2FC9BEBF`

The signing operation allocates **nothing** at runtime. JavaCard Classic puts
`new` in persistent EEPROM/Flash and never collects it, so an allocation on the
signing path would leak a few hundred bytes per tap until the card ran out of
persistent memory and every payment threw. All scratch is allocated once at
install time as `CLEAR_ON_DESELECT` transient arrays, threaded through the
arithmetic helpers as explicit `(work, workOff)` parameters.

D21 changes the multiply's timing: re-measure `cardctl --timing selftest` (AUTH)
and a payment's `SPEND_ALL_SIGN` on the J3R180 before release. AUTH was measured on
2.0 (ENG-681, above: 833 to 854 ms on an ACR122U, about 3% over 0.4), and on 2.3 at
626 ms (2026-11-13, an ACR39U contact reader, before and after the chip run);
2.3's `SPEND_ALL_SIGN` answered its one "not yet" in 596 ms and the signature in
845 ms (the 2.3 chip run, above). Readers differ: compare like with like.

### ECDH framing probe, at SET_CARD

`ALG_EC_SVDP_DH_PLAIN_XY` output framing is not uniform across implementations:
the applet reads a 65-byte `04 ‖ X ‖ Y`, and some parts return the bare 64-byte
`X ‖ Y` instead. Every key-agreement answer is held to that framing where it is
used (`sign()`, `mul()`, `addTo()`, `addToG()`, `agree()`), and every `SET_CARD`
first asks both of the chip's engines (`SchnorrHW.checkFraming`):

- the key agreement for `[11]G`, 65 bytes `04 ‖ X ‖ Y`, X and Y those of [11]G;
- the point addition for `[13]G + (−[2]G)`, two distinct points added as the
  card adds them, which must also be [11]G, X and Y;
- the key agreement for `[n − 1]([11]G)`, which must be −[11]G;
- the point addition for `[n − 2]([11]G) + [11]G`, with the generator [11]G,
  which must also be −[11]G;
- the key agreement for `[2](−G)`, which must be −[2]G;
- the point addition for `[4](−G) + [2]G`, with the generator −G, which must
  also be −[2]G;
- the key agreement for `[n − 1]([2]G)`, which must be −[2]G;
- G with a scalar of the full width: the key agreement for `[n − 1]G` and the
  point addition for `[n − 2]G + G`, with the generator G, which must both be −G;
- k = SHA-256("BIP0340/aux"), a scalar of 256 bits whose digits nobody chose (the
  signer keeps it as `tagHashAux`): the key agreement for `[k]([2]G)`, then the
  point addition for `[k − 1]([2]G) + [2]G`, with the generator [2]G, and for
  `[2k − 2]G + [2]G`, with the generator G, and the key agreement for `[2k]G`,
  each held to the first (all four are [2k]G);
- the same four with m, BIP-340's tagged hash of nothing under "BIP0340/nonce"
  (SHA-256 of the tag's hash twice, made from the signer's `tagHashNonce`): all
  four are [2m]G. m is the one of twenty fixed hashes tried (the hashes of
  BIP-340's nonce and challenge tags, the tagged hash of nothing under each of
  its three tags, and SHA-256 applied one to five times to each tag's hash) with
  which the scalars, on each path of each engine, use every entry of a 5-bit
  window aligned at bit 0 and of a comb of 5 teeth on the bare scalar.

Each answer is held whole, X and Y. Among these points, Y is odd and even, the
root (x³ + 7)^((p+1)/4) and not, and of X's parity and not (−G, [2]G). The bases
and generators are G and three others. The points added have an odd Y (−[2]G,
[11]G) and an even Y that is the root ([2]G), and one is G. Scalars above n/2
are asked of G and of three other points.

The asks were chosen against a family of wrong engines, enumerated as every
combination of these rules:

- how the engine reads the Y of the base or generator, and of the point it adds:
  its own, p − Y, the even or odd root, the root or p less it, the root with X's
  parity or without it, or its own only where the point is G;
- how it takes the scalar: s, or [n − s] for s above n/2 or below it;
- how it gives the Y of the middle point and of the answer: the same rules, or
  a parity taken from the scalar, its top bit, or a point it was given.

That is 612 key agreements and 44,064 point additions, with one fault or
several at once (two faults can cancel at one point and not at another). Every
member that is wrong at any input answers another point at one of the first
seven, each engine alone and both. The members that pass answer as the true
engine at every input (for example, one that negates the base and the answer).
The applet's tests run the whole family through the check (`SchnorrHWSignTest`).

The last ten reach the way each engine multiplies, on G (the base or generator
of every signature, change blinding and date key) and on another point. A fault
of the multiplication itself is refused where one of the seventeen scalars, on
its path (G, or another point), uses it: a G path that adds n to the scalar and
loses the carry, and an entry stored wrong in a table of fixed windows aligned at
bit 0, or of a comb or a NAF worked on the bare scalar, each of 3 to 5 bits, on
either path and either engine. The applet's tests sweep every entry of those
tables, in those forms, and hold that each is used.

The limit: a fault the seventeen asks do not reach is not refused. That is an
entry none of their scalars uses in a form the sweep does not model: a 5-bit
window aligned from the top or at bits 1 to 4; a 5-bit window or comb worked on
the fixed-length s + n or s + 2n; a table of 6 bits (6 to 16 entries of each go
unused), Booth recoding of 6 or 7 bits, or a NAF of 7 bits; or a scalar blinded
at random, which fixed asks reach only by chance. It is also a case of the addition these points
never meet (a point added to itself), a fault that shows for other scalars only,
an engine outside these models, or one built to answer these points right and
others wrong. `sign()` reads R's parity from the key agreement's Y, and `mul()`
and `addTo()` work on points other than G, so such an engine would cost money.
The chip run's real signatures and real change are the last check (the
checklist below).

The check costs seventeen engine calls at each `SET_CARD`: nine of the key
agreement and eight of the point addition, each followed by the key's wipe.

A chip that frames either otherwise answers `SET_CARD` with `6F00` and is never
set up, so it takes no piece. The probe is not at
install, where the chip takes as little work as it can: if `gp --install`
fails with `6F00`, suspect the size of the load file (above), or a constructor
that asks for more than the chip gives at install ([D17](DECISIONS.md#d17),
[D176](DECISIONS.md#d176)). If the first `SET_CARD` answers `6F00`, suspect the
framing.

### The 2.3 chip run's checklist

The run of 2026-11-13 (above) did each item but the last five, for the file before
D200, with two differences: `INBOX` for last week was read after a reinstall anchored
in that week, as no reader's header moves the clock back; and the sealed `VERIFY_PIN`
ran once, after the run, while `selftest` ran before and after. The run of 2026-11-14
(above) did them all for the tracked file, but the owner's reset of a locked card,
which would lock the bench card for good; `INBOX` for last week was read after a reset
by the PIN anchored in that week. Write the sha256 of every file sent to the chip in the
run's log.

- Install the three applets in order, and add the load file's size to refcheck's
  SIZES only once the card's applet is selected and answers.
- Add the load file's sha256 to refcheck's PROVEN only once the chip run has had
  real signatures and real change verified on the chip (the two items below), and
  write "real signatures and real change verified on the chip" in its entry:
  refcheck refuses to run while an entry does not say so.
- Time the first `SET_CARD` (seventeen engine calls); it answers `9000`, which
  says the chip takes −G, [11]G and [2]G as the generator, and G and [2]G as the
  point added.
- Real signatures: pay a real mint from the card (`SPEND_ALL_SIGN`) and see the
  mint take the swap; check `AUTH`'s signature under the card's key. Each is made
  from a fresh random nonce, which the framing check's scalars are not.
- Real change: take a payment's change back with `LOAD_CHANGE` and see the mint
  take the piece in a later swap; and a date's keys from `GROUP_KEYS` against the
  owner's own derivation from c.
- `INBOX` for last week and this week, a real header of each given first
  (`SET_HEADER`), against the owner's derivation from c for each week.
- `cardctl --timing selftest` (`AUTH`) and a sealed `VERIFY_PIN`, before and
  after, and which kind of temporary key the card got (below).
- The payment's largest transaction: one payment with eight change outputs, signed
  (not `6A96`); in jCardSim it is 17 writes and 138 bytes.
- Change near the day's 300 loads ([D200](DECISIONS.md#d200)): with two loads left
  (`GET_INFO` P1 = `04` bytes 57 and 58), a payment with two change outputs signs and
  leaves none; both come back by `LOAD_CHANGE` with no PIN and count nothing more; a
  `LOAD_PROOF` then answers `6A8F`, and a payment's `SPEND_ALL_CHANGE` answers `6A8F`
  with nothing owed, while a payment with no change signs.
- The empty card's reset setting the clock back ([D200](DECISIONS.md#d200)): after
  the tip's header, empty the card and reset it by the PIN with an older real header
  as the anchor (`cardctl reset --anchor`), and hand an owned card over with one
  (`cardctl set-owner --old-owner-key --anchor`): `info` says the older time, and the
  next tip header moves it on; on a card that holds a piece either answers `6A8D` and
  the clock does not move.
- The owner's reset with an anchor ([D200](DECISIONS.md#d200)): an owned, empty card,
  `cardctl reset --owner-key <the owner key> --anchor <an older real header>` (with
  `--pin` on a locked card): `info` says the older time; on a card that holds a piece
  it answers `6A8D`.
- `REFRESH`'s back form ([D201](DECISIONS.md#d201)): after the tip's header, on an owned
  card with a day's limit, a payment, then `cardctl refresh --owner-key <the owner key>
  --back --header <a real header some hours older>`: `info` says the older time, and the
  day's window (`GET_INFO` bytes 21 to 24, with the PIN) begins at it with what it
  counted (25 to 28), and so does the day of loads (bytes 57 and 58, the loads left,
  unchanged) ([D203](DECISIONS.md#d203)); `cardctl refresh` without `--back` with the same
  header moves nothing, and says so, and on a card with no owner `cardctl refresh --pin <PIN> --header <it>` leaves
  the clock where it is. A weak header cannot be shown on a chip with real headers (no
  real header later than the card's clock carries less than half the hardest's work);
  jCardSim shows it (`WeakClockTest`).
- The owner's c ([D202](DECISIONS.md#d202)): a fresh card set up with `cardctl setup ...
  --refund <R> --owner-seed <a test seed>` (the claim's transaction in jCardSim: 9 writes and
  144 bytes with the anchor at a clock that is not weak, 12 and 156 at its worst, [D204](DECISIONS.md#d204); time
  `SET_OWNER` P1 = `01`); setup says c was read back, the first owner's c; then `cardctl card-secret
  --refund-key <r> --owner-key <the owner key> --owner-seed <the seed> --date <D>` says c
  is the owner's, the first owner's c of the card, and the take-back key r + u for D,
  worked out from the seed alone, is the private key of the card's refund key for D; a
  dated piece of D loaded and paid as above. And a hand-over to a second seed
  (`cardctl set-owner --old-owner-key <old> --owner-key <new> --owner-seed <second seed>`,
  8 writes and 109 bytes in jCardSim with an anchor, 9 and 113 at its worst), which reads c
  back under the new owner's grant and says the card's second owner's c, as `card-secret`
  with the second seed does.
- The hardest kept ([D203](DECISIONS.md#d203)): `GET_CARD` bytes 40 to 43 (`cardctl apdu
  B016000000`) are the same hardest bits before and after `set-card` on an owned card and
  after the owner's reset; `SET_OWNER` with P2 `55` and `REFRESH` with P1 `02` (`cardctl apdu`) answer `6B00`.
- The first set-up's anchor ([D204](DECISIONS.md#d204)): on a fresh or reset card with the
  tip's header given (`cardctl set-header`), `cardctl setup ... --anchor <a real header some
  hours older>`: `info` says the older header's time (the claim's anchor brought the clock
  back; where the clock was more than two hours past the anchor, setup says so); in the next
  tap `cardctl set-header` with a header older still moves nothing, and the tip moves it on.

### The signer's temporary key

The signer asks the chip for its temporary key (the nonce of a signature, a
change output's blinding factor) as a key cleared on deselect
(`TYPE_EC_FP_PRIVATE_TRANSIENT_DESELECT`), built last in its constructor, and
falls back to the persistent kind where the chip throws on that type or its
room. The card does not say which kind it got. On the bench J3R180 (2026-11-13)
a test-only build, this source with one command added that answers it (load file
35,509 bytes, never shipped), said the key in RAM, and
the install passed with it there (an earlier build's install was refused when
its clear-on-deselect memory grew by about 100 bytes; where the whole install
is refused, the key's type is set to the persistent kind in the source). `AUTH`
took 626 ms and a sealed `VERIFY_PIN` 278 ms. Another chip, or another
configuration of this one, may give the persistent kind; nothing but such a
build tells.

---

## Supported targets

| Card | JC API | Notes |
|------|--------|-------|
| NXP JCOP4 SmartMX3 P71 (J3R180) | 3.0.5 | ✅ Primary target, where its configuration has `ALG_EC_SVDP_DH_PLAIN_XY` and `ALG_EC_PACE_GM` (the bench card of the 2.3 chip run does); a J3R180 whose configuration lacks either cannot run the card: the card's applet is refused at install |
| Feitian JavaCard 3.0.4 | 3.0.4 | ❌ No `ALG_EC_SVDP_DH_PLAIN_XY` (3.0.5+ only); the CAP will not convert or load |
| Generic JC 3.0.5+ | 3.0.5 | ⚠️  May work; verify the custom EC-FP curve, `ALG_EC_SVDP_DH_PLAIN_XY` and `ALG_EC_PACE_GM` |
| JavaCard ≤ 3.0.4 | ≤ 3.0.4 | ❌ No ECDH plain-XY |
| JavaCard 2.2.x | 2.2 | ❌ No `int` type; no ECDH plain-XY |

---

## AID reference

Protocol 2.0 ([D19](DECISIONS.md#d19)):

| Element | AID (hex) |
|---------|-----------|
| Package | `F0 43 41 53 48 55 43 41 52 44` |
| Opener (instantiated first, does nothing) | `F0 43 41 53 48 55 43 41 52 44 4D` |
| Card's applet | `F0 43 41 53 48 55 43 41 52 44 01` |
| Tag, class (listed last in the file) | `F0 43 41 53 48 55 43 41 52 44 54` |
| Tag, instance (the NFC Forum's NDEF Tag Application; what a phone selects) | `D2 76 00 00 85 01 01` |
| SELECT (the card's applet, whole: what a reader sends, [D25](DECISIONS.md#d25)) | `00 A4 04 00 0B F0 43 41 53 48 55 43 41 52 44 01` |
| SELECT of the package AID alone (reaches the opener on the chip: `90 00`, no version) | `00 A4 04 00 0A F0 43 41 53 48 55 43 41 52 44` |

Withdrawn, and answered `6A82` by a 2.0 card: the 0.x applet's
`D2 76 00 00 85 01 02` (package) and `D2 76 00 00 85 01 02 01` (applet), and
Foxy's 1.x `F0 46 4F 58 59 43 41 52 44`.
