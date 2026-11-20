# Hardware Deployment Guide

GlobalPlatform packaging and deployment for the Cashu card applet, protocol 3.0
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

# Output: target/cashu-javacard-3.0.0.cap, one file with three applets in it: the opener, the card's, and the NFC tag
ls -lh target/cashu-javacard-3.0.0.cap
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
The 3.0 build is **41,887 bytes** by refcheck's measure (159 past a multiple of 256;
the Method component 34,193), in 170 blocks of 247 bytes, the last 144: the load file
inside the tracked CAP (`applet/target/cashu-javacard-3.0.0.cap`), whose own sha256 is
not the CAP's ([Install](#install) gives both). Unpadded (`sizeTheFile` is empty), this
exact file has run only in a simulator so far, and no card has installed it or a file of its size. Its source is
the merge of 2026-11-19: the 2.3 file of 2026-11-15 below (40,412 bytes, load file `05c9b847…`) with the version
moved from 2.3 to 3.0 ([D205](DECISIONS.md#d205)), the other maintainer's [D206](DECISIONS.md#d206) to
[D210](DECISIONS.md#d210) (each signature checked before it leaves, joined with [D218](DECISIONS.md#d218)'s chip
path; the no-PIN allowance armed by the owner's proof or a held tap and not by the PIN alone; `GET_INFO`'s paid-list
bit; `ALLOW_LOAD`'s length checked first), the rotating tag ([D222](DECISIONS.md#d222)) and the till keysets and
settlement record fixes ([D223](DECISIONS.md#d223) to [D226](DECISIONS.md#d226)). Its own run, as the checklist below, is still to come, its size
first; if the chip refuses its size, it is moved with `sizeTheFile` (below). The other maintainer's 3.0 file before
the merge (37,413 bytes, 37 past) was never given to a chip either.

On 2026-11-13 a J3R180 was given earlier source, numbered 2.3 then, padded to three
sizes: it installed the files of 33,647 and 35,213 bytes and refused the card's applet in
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

The last 2.3 file, answering `02 03`, was **40,412 bytes** by refcheck's measure (220 past a multiple of 256;
the Method component 32,960), in 164 blocks of 247 bytes, the last 151: the load file inside the
CAP tracked then (`applet/target/cashu-javacard-2.3.0.cap`). Unpadded, that
exact file ran on the bench J3R180 (09301220) on 2026-11-15, three installs in three steps (load 17 to 18 s, the
card's applet 2 s), `selftest` 13 of 13, the set-up's claim at the first asking and a 9-piece payment with change at the test mint
(refcheck keeps its size and its load file's sha256). It is the file of the run of 2026-11-14 below (40,365 bytes, load file
`8aefa0db…`, the fifth run of that day, which installed it at the first try every time) with [D221](DECISIONS.md#d221) added (the claim
right after the set-up's record is one asking; 47 bytes more). That file was the file of the fourth run of that day
(39,343 bytes, load file sha256 `c79b30a7...`, [D213](DECISIONS.md#d213) to [D216](DECISIONS.md#d216), whose size and hash refcheck also keeps) with
[D217](DECISIONS.md#d217) to [D220](DECISIONS.md#d220) added (1,022 bytes more): the signature's product in two shares, every signature checked on
the card, the set-up's known answers made wider, and a taught keyset kept until its first piece. The fourth run's file was itself the file of the third run of that day
(37,269 bytes, load file sha256 `fe156f4f…`, [D200](DECISIONS.md#d200) to [D212](DECISIONS.md#d212), whose size and hash
refcheck keeps on its lists, as it keeps those of the earlier runs' files, 36,950 bytes `075448e4…` and 36,953 bytes `f216644a…`) with
[D213](DECISIONS.md#d213) to [D216](DECISIONS.md#d216) added: a keyset taught at set-up, the field's arithmetic on the chip's RSA with p
padded to 64 bytes for the modulus, `LOAD_CHANGE`'s points held to the curve by the chip's key agreement, and the signature's e·d
mod n on the chip's RSA with n padded (2,074 bytes more). The size was tried with care: a study build of the same source
had been refused at the card's applet's create (`6F00`) at 38,791 and 38,809 bytes (135 and 153 past a multiple of 256) and installed at
38,893 (237 past); the fourth run's file, at 175 past, was created at the first try, and so was this one, at 173 past (the chip had refused 135 and 153 past and installed 175 and 237 past); refcheck keeps all five sizes.
refcheck keeps its size as one that installs and its load file's sha256 on its list of hashes, from the fifth run (the checklist below).

The chip run of 2026-11-13, of the source then numbered 2.3, on the bench J3R180
09312320 (CPLC serial checked first; the public default GlobalPlatform test key), through
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

The chip run of the file before D221 (40,365 bytes, load file `8aefa0db…`, with [D217](DECISIONS.md#d217) to [D220](DECISIONS.md#d220)),
on 2026-11-14 (03:00 to 03:30 UTC on the 15th), a fifth time that day, on the bench
J3R180 of the earlier runs, CPLC serial 09301220 (checked by the install script before anything was sent; the public default test key),
through the same reader. The CAP `20b6d726…` was installed four times in three steps (load 17 to 18 s, the card's applet 1 to 3 s, created
at the first try every time); `SELECT` `02 03`, the tag `getfoxy.io/card`. The mint `testnut.cashu.space` (fake sats), real mainnet headers
(blocks 975,830, 975,841 and 975,859), the TEST owner key, a made-up seed and a test refund key. Set-up as the app does it (`cardctl setup`): the
first `SET_CARD` answered `9000` in 2,033 ms (1,777 ms before: the set-up now asks the chip for six more points off the curve and eight
squarings instead of six), the owner's claim at the 4th asking (572, 576, 576 and 858 ms: 2.6 s in all). The keyset's 32 keys were taught at
set-up, with no piece on the card (1.53 s with the process start). 45 real pieces (2,555 fake sats) were then loaded in one selection with no
teaching in it (the 04 form, proof kept):

| Step | ms |
|---|---:|
| SELECT | 22 |
| GET_INFO (the read) | 42 |
| AUTH | 532 (264 before D217 and D218) |
| GET_NONCE P1 1 (PIN key) | 45 |
| VERIFY_PIN sealed | 144 |
| GROUP_KEYS (date 0) | 100 |
| LOAD_PROOF #1 | 151 |
| LOAD_PROOF #2 to #45 | 6,770 |
| GET_INFO (the final read) | 43 |
| GET_BALANCE | 69 |
| **The whole contact** | **8.03 s** (7.75 s on the file before) |

A piece took 146 to 163 ms (median 153); one card, alternately: the 04 form 164.5 ms and the 33-byte form 155.0 ms. Real signatures and real
change: a payment of nine pieces with five change outputs: `SPEND_ALL_BEGIN` 196 ms, `SPEND_ALL_CHANGE` 226 to 258 ms an output,
`SPEND_ALL_SIGN` 942 ms at its first send (no "not yet"; 2.46 s from `BEGIN`; 678 ms and 2.23 s on the file before; good under P + t·G
and not under P); a payment of three pieces with no change signed in 705 ms (446 before; 962 ms from `BEGIN`, 706 before); one with three change
outputs 734 ms; testnut took every swap (`200`, every input `SPENT`); the change came back by `LOAD_CHANGE` with no PIN in 576 to 588 ms a
piece (as before), each `UNSPENT` with its proof by testnut's key. A signature costs **0.27 s more** than on the file before: the two extra
squarings (about 24 ms) and the three runs of the EC engine that check it. Refusals, nothing stored: 17 bad points in the 04 form
`6A80` (72 to 88 ms: the four new ones of the set-up, x = 5 with no root, the twist point of y² = −(x³ + 7), G's x with G's y and its top bit
flipped, G's x with y = p − 1, and the 13 of the run before), wrong lengths `6700`; `LOAD_CHANGE` with C_ changed (y + 1, y + 2, x + 1,
zeros, prefix 03, x = p), K changed (y + 1, y + 2) or the proof's e changed, each `6A80` (81 to 126 ms, 490 ms for the proof), the opening
still owed. `selftest` passed 13 of 13 on physical hardware. The card with a PIN and no owner: the history's hold (6 held askings of 491 ms,
the log at the 7th, 2.95 s in all), the reset by the PIN in 11.3 s (the history's 7 askings and 17 of `RESET_CARD` at 502 ms: 8.26 s), the wait
after wrong tries 493 ms an asking. **The holds and waits are counts of the card's signing work (D211) and that work is now twice what
it was in the fourth run: an asking is 0.49 to 0.58 s (0.23 to 0.31 s in the fourth run, 0.59 to 0.66 s in the run of D211), so the claim
is 2.6 s (target 3 s), the history 3.0 s (4 s) and the reset by the PIN 8.3 s, 11.3 s with the history's (15 s).** The counts were not
changed: it is the project owner's to say. Not run: `LOCK_CARD`, the day of loads, dated pieces in the 04 form, tears, a fault in an engine
(no chip can be made to: the simulator's tests fault each squaring), a chip whose engines fail their set-up tests (the simulator, which
refuses the padded keys, runs the fallbacks in every test, and a test engine of the tests' own runs the padded paths), a phone and a
production mint ([the hardware report](reports/HARDWARE_TEST_REPORT_2026-11-14e_J3R180_2.3.md)). The card was then installed again from
the same file and left fresh (no PIN, no owner).

The chip run of the file before D217 (39,343 bytes, load file `c79b30a7…`, with [D213](DECISIONS.md#d213) to [D216](DECISIONS.md#d216)),
on 2026-11-14 (01:30 to 01:45 UTC on the 15th), a fourth time that day, on the bench J3R180 of the second and third runs, CPLC
serial 09301220 (checked by the install script before anything was sent; the public default test key), through the same
reader. The CAP `b304d938…` was installed four times in three steps (load 17 s, the card's applet 2 s, created at the first try
every time); `SELECT` `02 03`, the tag `getfoxy.io/card`. The mint `testnut.cashu.space` (fake sats), real mainnet headers
(blocks 975,830, 975,841 and 975,859), the TEST owner key, a made-up seed and a test refund key. Set-up as the app does it
(`cardctl setup`): the first `SET_CARD` answered `9000` in 1,777 ms (it was about 1.0 to 1.2 s: the set-up now runs the
self-tests of the padded keys and of the squaring, and makes their keys), the owner's claim at the 4th
asking (305, 309, 308 and 859 ms: 1.8 s in all, where D211's holds were measured at 2.9 s). The keyset's 32 keys were taught
at set-up, with no piece on the card ([D213](DECISIONS.md#d213): 1.53 s with the process start), the card working out the
keyset's ID. 45 real pieces (2,555 fake sats) were then loaded in one selection with no teaching in it (the 04 form, proof kept):

| Step | ms |
|---|---:|
| SELECT | 22 |
| GET_INFO (the read) | 42 |
| AUTH | 264 (626 before D216) |
| GET_NONCE P1 1 (PIN key) | 45 |
| VERIFY_PIN sealed | 144 (278 before) |
| GROUP_KEYS (date 0) | 100 |
| LOAD_PROOF #1 | 155 |
| LOAD_PROOF #2 to #45 | 6,753 |
| GET_INFO (the final read) | 43 |
| GET_BALANCE | 69 |
| **The whole contact** | **7.75 s** (8.22 s without teaching, 9.50 s with it, on the D212 file) |

A piece took 146 to 163 ms (median 154); one card, alternately: the 04 form 166 ms and the 33-byte form 157 ms (the 33-byte form's
curve test fell from 116 ms to 27 with D214, so the 04 form is no longer the quicker). Real signatures and real change: a payment
of nine pieces with five change outputs: `SPEND_ALL_BEGIN` 193 ms, `SPEND_ALL_CHANGE` 226 to 287 ms an output (443 to 676 before D214),
`SPEND_ALL_SIGN` 678 ms at its first send (no "not yet"; 2.23 s from `BEGIN`, where it was 3.96 s; good under P + t·G and not under P);
a payment of three pieces with no change signed in 446 ms (706 ms from `BEGIN`); one with three change outputs 519 ms; testnut took every
swap (`200`, every input `SPENT`); the change came back by `LOAD_CHANGE` with no PIN in 577 to 587 ms a piece (1,033 to 1,043 before),
each `UNSPENT` with its proof by testnut's key, and was spent again in a swap testnut took. Refusals, nothing stored: 13 bad points in
the 04 form `6A80` (76 to 86 ms: no-curve x, a point of the twist, G with y + 1 and y - 1, a wrong y, y = 0, x = p, y = p, x = p + 1, zeros,
P-256's G, prefixes 03 and 06), wrong lengths `6700`; `LOAD_CHANGE` with C_ changed (y + 1, y + 2, x + 1, zeros, prefix 03, x = p), K
changed (y + 1, y + 2) or the proof's e changed, each `6A80` (86 to 131 ms, 501 ms for the proof), the opening still owed, and the
right answer then written back. `selftest` passed 20 of 20, `AUTH` 264 ms. The card with a PIN and no owner: the history's hold
(6 held askings of 229 ms, the log at the 7th, 1.4 s in all, where it was measured at 2.4 to 3.6 s), the reset by the PIN in about 6 s
(the history's 7 askings and 17 of `RESET_CARD` at 292 ms, where the target was 15 s in all), the wait after wrong tries 231 ms an asking;
the first set-up's `SET_HEADER` (a later tip, then an older header, the clock going back, nothing moved after a `SELECT`) and the claim
checks (`6B00`, `6985`, `6A80` as expected; `INBOX`) as before. **The holds and waits are counts of the card's signing work (D211) and
that work was then about 2.5 times quicker: an asking was 0.23 to 0.31 s where D211's holds were measured at 0.59 to 0.66 s, so the claim,
the history and the reset by the PIN are about 40 percent of the time the project owner chose (3 s, 4 s, 15 s). At the same targets the
counts would be about 11 for the claim (4 now), 17 for the history (7) and 38 for the reset (17), 55 in all with the history's, in a count
held in six bits (63 at the most).** The counts were not changed: it is the project owner's to say. Not run: `LOCK_CARD`, the day of loads, dated pieces in the 04 form, tears, a
chip whose engines fail their set-up tests (the simulator, which refuses the padded keys, runs the fallbacks in every test, and a test
engine of the tests' own runs the padded paths), a phone and a production mint ([the hardware
report](reports/HARDWARE_TEST_REPORT_2026-11-14d_J3R180_2.3.md)). The card was then installed again from the same file and left fresh (no PIN, no owner).

The chip run of the file before D213 (37,269 bytes, load file `fe156f4f…`, with [D212](DECISIONS.md#d212): `LOAD_PROOF`'s 04 form,
C held to the curve by the chip's key agreement), on 2026-11-14 (23:51 to 00:05 UTC), a third time that day, on the bench
J3R180 of the second run, CPLC serial 09301220 (checked by the install script before anything was sent; the public default
test key), through the same reader. The CAP `55614a2f…` was installed five times in three steps (load 16 to 17 s, the card's
applet 2 to 3 s, created at the first try every time); `SELECT` `02 03`, the tag `getfoxy.io/card`. The mint
`testnut.cashu.space`, the real mainnet header of block 975,859 as each set-up's anchor, the TEST owner key, a made-up seed
and a test refund key. Each run set the card up as the app does (`cardctl setup`: PIN, record with the refund key, the owner
claimed with the owner's c, anchored at the tip), minted 45 real pieces at testnut for the card's key of date 0 (1 to 256
sats, 2,555 in all, each mint's proof checked), and loaded all 45 in one selection as a first load does: `GET_INFO`, `AUTH`,
the sealed PIN (`GET_NONCE` P1 1 and `VERIFY_PIN` P1 01), `GROUP_KEYS` (the date's key, the one the pieces were locked to),
45 `LOAD_PROOF`s with the mint's proof kept (P1 1), the keyset's 32 keys taught after the first piece where asked
(`KEYSET_KEYS`, 8 commands: the card has no entry for a keyset before its first piece), then `GET_INFO` and `GET_BALANCE`.
In the 04 form (P2 `0A`) a piece took 146 to 160 ms (mean 152 to 153 ms) and the whole contact 9.50 s with the teaching
(1.31 s of it) and 8.22 s without; in the 33-byte form (P2 `02`) 226 to 240 ms (mean 233 ms) and 13.14 s with the teaching
and 11.82 s without. On one card, alternately, slots 50 to 61: 161 to 164 ms against 241 to 247 ms. Every load answered its
place and `01` (the proof kept), and the balance and the unspent count were the minted ones. Real signatures and real
change: pieces loaded in the 04 form paid at their first `SPEND_ALL_SIGN` (no "not yet"; 815 to 841 ms; good under P + t·G
and not under P), testnut took each swap (`200`, the inputs `SPENT`), the change of a payment of 100 from 256 (five outputs)
came back by `LOAD_CHANGE` with no PIN (each `UNSPENT`, its proof by testnut's key) and two of those pieces were spent again
in a swap testnut took; pieces loaded in the 33-byte form paid the same way. In the 04 form ten bad points answered `6A80`
(71 to 84 ms) and stored nothing (no-curve x, G with y + 1, a wrong y, x = p, y = p, x = p + 1, 04 and zeros, P-256's G,
prefixes 03 and 06), and wrong lengths `6700`. `selftest` passed 21 of 21. Not run: `LOCK_CARD`, the day of loads, dated
pieces in the 04 form, tears, a chip whose key agreement fails the set-up's test (the simulator's tests cover both outcomes),
a phone and a production mint ([the hardware report](reports/HARDWARE_TEST_REPORT_2026-11-14c_J3R180_2.3.md)). The card
was then installed again from the same file and left fresh (no PIN, no owner).

The chip run of the file before D212 (36,950 bytes, load file `075448e4…`, with [D211](DECISIONS.md#d211): no payment floor and
shorter holds), on 2026-11-14, a second time that day, on a second bench J3R180, CPLC serial 09301220 (checked by the
install script before anything was sent; the public default test key), through the same reader. The CAP `01edad4c…` was
installed twice in three steps (load 16 to 17 s, the card's applet 2 s, created at the first try both times; a first build
of D211 with the loader's y, 37,573 bytes, had been refused at that create with `6F00` and is not this file); `SELECT`
`02 03`, the tag `getfoxy.io/card`. Real mainnet headers from mempool.space (blocks 975,750 to 975,841), the mint
`testnut.cashu.space`, the TEST owner key, a second test key and two made-up seeds. The first `SET_CARD` answered `9000`
in 1,208 ms (1,008 ms in a later set-up); `selftest` passed 20 of 20, `AUTH` 631 ms. The owner's claim with the owner's c
answered `9000` at the 4th `SET_OWNER` (678, 681, 681 and 859 ms: 2.9 s in all), and c was read back. Real signatures and
real change: 64, 32 and 16 fake sats minted and loaded under the PIN (`LOAD_PROOF` 226 to 235 ms a piece, the plain form;
P2 `04`, `06` and `07` answered `6B00` and stored nothing), a payment of the three to a till's 50 with five change outputs
signed at its first `SPEND_ALL_SIGN` with no "not yet" (889 ms for the signature, 4.1 s from `SPEND_ALL_BEGIN`; good under
P + t·G and not under P), and testnut took the swap (`200`, the three inputs `SPENT`); the change came back by `LOAD_CHANGE`
in a new tap with no PIN (1.02 s each, `UNSPENT`). The largest payment, eight change outputs (510 of change), signed with no
"not yet" (853 ms, 5.2 s from `SPEND_ALL_BEGIN`, not `6A96`), and its eight pieces came back. Dated pieces (D 2026-12-15, 72 sats)
were loaded, paid to a till's 40 with five change outputs (no "not yet", 699 ms) and taken by testnut, the change loaded
back. With a limit on one payment of 100 and a day's limit of 5,000: a payment of 48 signed at once (1.35 s from
`SPEND_ALL_BEGIN`); a payment of 150 answered 10 "not yet" (7.2 s), one of 250 answered 14 (9.7 s); a second payment in the
same time in the field answered 10 (7.4 s) and the first of a new tap none (1.2 s); a payment of 447 answered 22 (14.6 s).
The holds (a held asking measured 0.59 to 0.66 s): the claim at the 4th asking, 2.9 s; the history of a card with a PIN and
no owner `6A98` six times and the log at the 7th, 3.6 s; the reset by the PIN with the tip as its anchor, the history's 7
askings and then `6A98` sixteen times and the reset at the 17th, 24 askings and 14.8 s in all (10.8 s for the reset's 17).
The PIN's wait after wrong tries was as before (one held asking after one wrong try, two after the second). The clock and the
owner: the first set-up's anchor (an older header in the set-up's own selection answered the older time in 75 ms; after a
`SELECT` it moved nothing, and the tip moved it on), a claim's anchor 7.1 h older than a clock the tip had set brought it
back, a hand-over to a second seed's owner read back the second c (1,236 ms), the owner's reset with an anchor 7.1 h older
(`RESET_CARD` 374 ms) and `REFRESH`'s back form worked, and with pieces on the card the hand-over and the owner's reset with an
older anchor each answered `6A8D`; `REFRESH` P1 02, `SET_OWNER` P1 02 and P2 55 answered `6B00`, a claim with another seed's
check `6A80`, one with no envelope before it `6985`; `INBOX` answered week 2967; the hardest's bits stayed `73160217`; a
sealed `VERIFY_PIN` answered `9000` in 278 ms. The day of loads was not run again (its code is as in the file before D211).
Not run: `LOCK_CARD`, taking money back after D with the refund key, a header far ahead or a weak clock, tears, a phone and a
production mint ([the hardware report](reports/HARDWARE_TEST_REPORT_2026-11-14b_J3R180_2.3.md)). The card was then installed
again from the same file and left fresh (no PIN, no owner).

The chip run of the file before D211 (36,953 bytes, load file `f216644a…`, the source with D200 to D204, then numbered 2.3), on 2026-11-14, on the same bench J3R180 09312320
(CPLC serial checked first; the default test key), through the same reader. The CAP
`30c7bb8d…` (load file 36,953 bytes, `f216644a…`, the file before D211) was installed three times, each in
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
hardware report](reports/HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md)). The tracked
file is that day's source with the version moved to 3.0 ([D205](DECISIONS.md#d205)) and
D206 to D210 added. This exact file has run only in a simulator so far, and no card has
installed it or a file of its size; the run is to be repeated on it.

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
> chip runs of 2026-11-13 and 2026-11-14 has both.

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

The CAP tracked in this repo is **applet version 3.0**, sha256
`43a3569dd6c98db28a8f89f504bfe94a70787f65dd9c7ed6597f9a17b7133d38`
(`applet/target/cashu-javacard-3.0.0.cap`). The load file in it, the bytes a card
is LOADed with (refcheck's measure, 41,887 bytes), has sha256
`71642e44ba2499fc5e84fd1348bd3e80cecc07c9a0f9b6a2adfdfe054496812b`: the hash the
provisioner checks before it loads a card, and the build a card's certificate
names ([CERTIFIER.md](CERTIFIER.md)), not the CAP's. A CAP you build yourself hashes
differently even from identical source, because the converter writes a creation
timestamp into `META-INF/MANIFEST.MF`. Every other entry is byte-identical when
built with JDK 17 and the kit CI pins (`jc305u4_kit` at `oracle_javacard_sdks`
commit `6a75ec0d`), and CI checks exactly that on every push. So before
installing your own build, compare every entry except `META-INF/MANIFEST.MF`
against the tracked CAP:

```bash
# From applet/, after `ant cap` has overwritten target/cashu-javacard-3.0.0.cap
git show HEAD:applet/target/cashu-javacard-3.0.0.cap > /tmp/tracked.cap
rm -rf /tmp/cap-tracked /tmp/cap-built
unzip -q /tmp/tracked.cap -d /tmp/cap-tracked
unzip -q target/cashu-javacard-3.0.0.cap -d /tmp/cap-built
diff -r -x MANIFEST.MF /tmp/cap-tracked /tmp/cap-built && echo "same CAP as the tracked one"
```

Any output from `diff` means the two CAPs differ; do not install. After
installing, `SELECT` must answer `03 00` for the card's applet's whole AID (below).

```bash
# Load the file and instantiate the opener (gp installs one applet of a file at a time)...
gp --install target/cashu-javacard-3.0.0.cap --applet F04341534855434152444D
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
before it leaves your hands. A 3.0 card is set up in one selection, its first
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
  nothing without it. On a 3.0 card the claim's anchor, the first set-up's of an empty
  card, becomes the clock even where the card's clock was later (a header far ahead set
  it), and setup says it brought it back; a card older than 3.0 with such a clock is
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
    (about 11 seconds on the reader), then set up again;
  - a first `SET_CARD` that answers `6F00` is the chip's ECDH framing
    ([ECDH framing probe](#ecdh-framing-probe-at-set_card)).

---

## Test install / select / deselect lifecycle

```bash
# SELECT the card's applet by its whole AID, F0 CASHUCARD 01
gp --apdu 00A404000BF043415348554341524401

# Response: 0300 9000  (applet version 3.0 + SW_OK = applet responding)
# A card that answers 6A82 has no 2.x applet: it is a 0.x or Foxy 1.x card and needs an update.
# Do not SELECT the package AID alone (00A404000AF0434153485543415244): on the chip that
# partial name reaches the opener, instantiated first, which answers 9000 with no version
# and 6D00 to every command after it (D25).

# GET_INFO (INS 0x01)
gp --apdu B0010000

# Response: 03 00 80 00 00 80 FF 00 04 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
#   v3.0 | 128 slots | 0 unspent | 0 spent | 128 empty | caps=FF | PIN none | format 4 | 3 tries | not locked | no record | no limit | no owner | no clock | no window | 0 spent | no change owed
# SW: 9000

# GET_PUBKEY (INS 0x10)
gp --apdu B0100000

# Response: 33-byte compressed secp256k1 public key + SW 9000
```

`cardctl selftest` passes a card answering `02 01`, `02 02` or `03 00`, the versions it
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
change the card is owed: on a 3.0 card `GET_INFO` byte 29 is `01` while a payment's
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
gp --install target/cashu-javacard-3.0.0.cap --applet F04341534855434152444D
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
versions (2.1 or 2.2 to 3.0): a 2.x card is also owed no change before it is
deleted (`GET_INFO` byte 29 on 3.0, `GET_CHANGE` on 2.1 and 2.2, as in
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
2.0 (ENG-681, above: 833 to 854 ms on an ACR122U, about 3% over 0.4), and on the
source of 3.0, then numbered 2.3, at 626 ms (2026-11-13, an ACR39U contact reader,
before and after the chip run) and 632 ms (2026-11-14); its `SPEND_ALL_SIGN` answered
its one "not yet" in 596 ms and the signature in 845 ms (the chip run of 2026-11-13,
above). Readers differ: compare like with like.

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

<a id="the-23-chip-runs-checklist"></a>

### The 3.0 chip run's checklist

The run of 2026-11-13 (above) did each item but the last five, for the file before
D200, with two differences: `INBOX` for last week was read after a reinstall anchored
in that week, as no reader's header moves the clock back; and the sealed `VERIFY_PIN`
ran once, after the run, while `selftest` ran before and after. The run of 2026-11-14
(above) did them all for the file before D211, numbered 2.3 then (`f216644a…`), but the owner's
reset of a locked card, which would lock the bench card for good; `INBOX` for last week
was read after a reset by the PIN anchored in that week. The run on the 3.0 file of the merge
is to do them all again, and the size first. Write the sha256 of every file sent to the chip in the
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
The run of the tracked file with D211 (above) did every item below for it but the day of loads and the owner's reset of a
locked card.

- No payment floor ([D211](DECISIONS.md#d211)): a payment within its limit, the first of its
  time in the field, is signed at its first `SPEND_ALL_SIGN` (time `SPEND_ALL_BEGIN` to the
  signature); one over the limit on one payment still waits, and so does a second payment in
  a time in the field.
- The holds ([D211](DECISIONS.md#d211)), measured at about 0.6 s an asking (0.59 to 0.66 s; 0.49 to 0.58 s on the file of D217 to D220, which checks every
  signature): the owner's claim answers `9000` at the 4th asking (about 2.6 s), the history of a card with no owner at the
  7th (about 3 s), the reset by the PIN at the 17th (24 askings and about 11 s in all with the history's 7).
- `LOAD_PROOF` takes P2 `02`, `03`, `0A` and `0B` only: a P2 with bit 2 (the loader's y, tried and taken out, [D211](DECISIONS.md#d211)) is `6B00`.

The run of the tracked file with D212 (above) did every item below.

- `LOAD_PROOF`'s 04 form ([D212](DECISIONS.md#d212)): on a card set up as the app sets one up, real pieces loaded with P2
  `0A` and the mint's proof kept answer their place and `01`, and pay at a mint; the same pieces in the 33-byte form (P2
  `02`) too; time one piece in each form, and a first load of 45 pieces in one selection in each form.
- Bad points in the 04 form (a point off the curve, the twist, x or y of p or more, a wrong prefix) answer `6A80`, and wrong
  lengths `6700`, with nothing stored (`info`'s unspent count and the balance as before).

The run of the tracked file with D213 to D216 (above) did every item above and these:

- A keyset taught at set-up ([D213](DECISIONS.md#d213)): `KEYSET_KEYS` for the testnut keyset on a card with no piece on it answers
  the ID the card works out; a first load of 45 pieces then has no teaching in it (7.75 s).
- The padded keys and the squaring key ([D214](DECISIONS.md#d214), [D216](DECISIONS.md#d216)): the first `SET_CARD` makes them and holds
  them to their known answers (1.78 s in all); the change's points are right (every `LOAD_CHANGE` is `UNSPENT` with its proof by
  testnut's key), and every signature verifies under BIP-340 (payments, `AUTH`, `selftest`).
- `LOAD_CHANGE`'s points ([D215](DECISIONS.md#d215)): C_ or K changed, or the proof, answers `6A80` with the opening still owed,
  and the right answer is then written back; a twist point in the 04 form of `LOAD_PROOF` answers `6A80`.
- The holds are timed: an asking is 0.23 to 0.31 s (0.49 to 0.58 s after D217 and D218), so the claim, the history and the reset by the PIN took about 40 percent of the
  time chosen in D211 at the same counts (about 85 to 95 percent after D217 and D218).

The run of the tracked file with D217 to D220 (above) did every item above and these:

- The signature's two shares and its check ([D217](DECISIONS.md#d217), [D218](DECISIONS.md#d218)): every signature the card made (payments with and
  without change, `AUTH`, `selftest`, the held askings) verified under BIP-340 and under the key, at 0.27 s more a signature than before (`AUTH`
  532 ms, 264 before); testnut took every swap. A fault cannot be made on a chip; the simulator's tests fault each squaring.
- The set-up's known answers ([D219](DECISIONS.md#d219)): the first `SET_CARD` ran them all (2.03 s, 1.78 before) and the chip held to every one: the
  04 form of `LOAD_PROOF` was taken (`curveByAgreement` true: the chip refused the six points off the curve), `fieldP` and `chipMul` true (the
  load, change and signing times are those of the engines' paths). The set-up's six points were also sent as pieces in the 04 form: each `6A80`.
- A keyset taught and kept ([D220](DECISIONS.md#d220)): taught at set-up with no piece on the card (1.53 s), 45 pieces loaded with no teaching in the tap.

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
| NXP JCOP4 SmartMX3 P71 (J3R180) | 3.0.5 | ✅ Primary target, where its configuration has `ALG_EC_SVDP_DH_PLAIN_XY` and `ALG_EC_PACE_GM` (the bench card of the chip runs of 2026-11-13 and 2026-11-14 does); a J3R180 whose configuration lacks either cannot run the card: the card's applet is refused at install |
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
