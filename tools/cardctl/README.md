<a id="cardctl-host-side-driver-for-the-cashu-card-applet-protocol-20"></a>

<a id="cardctl--host-side-driver-for-the-cashu-card-applet-protocol-20"></a>

# cardctl: host-side driver for the Cashu card applet, protocol 3.0

A PC/SC command-line tool that speaks protocol 3.0 as
[`spec/APDU.md`](../../spec/APDU.md) has it, over either a contact or a
contactless reader: the reads, `AUTH`, the owner's commands (with a P-256
owner key, `p256.py`), the clock, loads and the PIN.

Before cardctl, applet checks ran only under jCardSim. That simulator cannot
surface EEPROM exhaustion, ECDH output framing differences, or a card whose
`getS` returns short. Those failures require silicon testing.

## Install

```bash
cd tools/cardctl
pip install -r requirements.txt
```

- **macOS:** PC/SC ships with the OS. Do **not** install `pcsc-lite`; it
  conflicts with the built-in daemon.

  ⚠️ **Do not use the system Python** (`/usr/bin/python3`, 3.9). `pip install
  pyscard` appears to succeed there, then fails at import with:

  ```
  ImportError: dynamic module does not define module export function (PyInit__scard)
  ```

  The import error comes from an ABI mismatch in the native `_scard` module.
  Use a Homebrew Python:

  ```bash
  brew install python@3.13          # or any recent 3.x
  python3.13 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  ```

  Verified working on Homebrew Python 3.14.
- **Debian/Ubuntu:** `sudo apt install pcscd libpcsclite-dev` and make sure
  `pcscd` is running.

## Quick start

```bash
python3 cardctl.py readers      # is the reader visible?
python3 cardctl.py selftest     # the one that matters
```

`selftest` is the card-arrival test. It selects the applet, reads `GET_INFO`,
the public key and the record, asks the card to prove itself with `AUTH` over
random bytes of ours, and **verifies each signature against BIP-340**. It then
checks that two `AUTH`s over the *same* bytes use different nonces. Nonce
freshness protects the private key: a nonce that is a pure function of `(d,
msg)` lets a fault injector recover the private key from two signatures.
`AUTH` needs no PIN and leaves proofs unspent.

Illustrative output (detail separators simplified):

```
PASS  SELECT applet: version 3.0
PASS  GET_INFO: v3.0, 128 slots, PIN set, owner yes
PASS  format 4 (SIG_ALL pieces): format 4
PASS  Schnorr capability advertised: caps=0xFF
PASS  keys per load (GET_INFO byte 56 bit 1): profiles FF03
PASS  GET_PUBKEY well-formed: 02a1b2c3d4e5f60718…  (33 bytes)
PASS  AUTH + BIP-340 verify [1/3]
...
All 14 checks passed on physical hardware.
```

Pass `--pin` to check the PIN as well. A 3.0 card answers SELECT with `03 00`. A 0.x or Foxy 1.x card answers a
different AID and needs a balance sweep before its update. The current selftest
requires protocol 2.1 or later; a 2.0 card must be swept and reinstalled under
[D26](../../docs/DECISIONS.md#d26). A card whose PIN is blocked
(`GET_INFO` byte 7 = 2) fails at `PIN state`: no payment signs until the owner's
`change-pin` sets a new PIN, which unblocks it (no PUK on 2.0: [D18](../../docs/DECISIONS.md#d18)).

`info` says the owner, the clock, the limits and the rollover budget
([D20](../../docs/DECISIONS.md#d20)): `rollover budget : 2 of 7 rolls since the
owner's last refresh`. At 7 of 7 the day's window stands until the owner's
`refresh` with the tip header. On a card that SELECT says is 3.0 or later,
cardctl asks `GET_INFO` P1 `04` (59 bytes; P1 `02` of an older card) and `info`
also says the keyset table (kept, entries in use, those without the holder's
mark, the last payment's unit), the rate, the no-PIN window's start, the
profiles the card keeps (bytes 55 and 56, by name) and the pieces it will
still load today. The rate, the last unit, the window's start and the loads
left are zeros to a reader not given the PIN or the owner's grant. `selftest`
prints the same lines, and on a 3.0 card checks that it keeps keys per load
(byte 56 bit 1), which every 3.0 card does.

## The owner key

The owner's commands (`set-owner` on an owned card, `set-card` on an owned card,
`set-limit`, `change-pin`, `refresh`, `lock`, and the owner's grant, `ALLOW_LOAD`,
that `--owner` gives to `load`, `outbox`, `group-keys` and `card-secret`) sign a
proof with `--owner-key`, a 32-byte P-256 private key in hex. Without it,
cardctl signs with its **TEST key** (`p256.TEST_OWNER_PRIVATE`, derived from a
fixed string in `p256.py`) and says so on stderr: anyone with this repository
holds it, so it is for bench cards only. A card handed to a person is owned by
the holder's phone. The commands that give a card its owner, `setup`,
`set-owner` and `set-owner-url`, take no default: their `--owner-key` is the
key the card is given, and they want it, or `--test-owner-key` for a bench card
given the TEST key, and refuse the TEST key's value given as `--owner-key`.

On 3.0 the owner's grant opens no load: every `LOAD_PROOF` wants the PIN given
in the same tap (`--pin`), and `load --owner` without `--pin` is refused before
anything is sent. A 3.0 card with an owner refuses `SET_PIN` (`6A91`): its PIN
is changed by `change-pin` with the owner's proof, so `set-pin --owner` (ADD
PIN) is for cards of 2.2 and earlier only. Claiming a card with no owner
(`set-owner`) wants the PIN in the same tap (`--pin`); the card answers `6A98`,
keep holding, to the first five askings and cardctl asks again until the sixth
sets the owner. An owner is replaced with the old owner's proof
(`--old-owner-key`), and only with nothing unspent and no change owed (`6A8D`).
After such a hand-over a 3.0 card answers `verify-pin` with `6982` until the new
owner's `change-pin`, and a dated load with `6A8E` until the new owner's
`set-card --mint <the mint> --refund <its refund key> --owner-key <the new owner key>`
names its refund key; cardctl says so when it hands a card over.

## Loading the applet

`cardctl` talks to an applet that is already installed. To install it, build the
CAP and use [GlobalPlatformPro](https://github.com/martinpaljak/GlobalPlatformPro):

```bash
cd applet && ant clean cap
# three applets, the opener first: docs/HARDWARE_DEPLOYMENT.md has the commands
```

**The card must be JavaCard 3.0.5 or later.** The applet needs
`KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY`, which does not exist in 3.0.4, and
`KeyAgreement.ALG_EC_PACE_GM`. JCOP4 works where its configuration has both (a
J3R180 whose configuration lacks either cannot run the card); JCOP3 / J3H145 /
Feitian 3.0.4 cannot run this applet at all.

If loading over an ACR122U stalls part-way, suspect the interface before the
CAP: contactless loading is chattier and more fragile than contact. A contact
reader is the more reliable way to install, leaving NFC for tap testing.

## Commands

| Command | What it does |
|---|---|
| `readers` | list PC/SC readers |
| `-t`/`--timing` (any command) | time every APDU to stderr, summary table at exit |
| `selftest [--rounds N] [--pin P]` | full hardware check incl. BIP-340 verification of `AUTH` |
| `info` | version, slots, PIN, owner, record, clock, limits, rollover budget, balance; on 3.0 the keyset table, the rate, the no-PIN window, the profiles and the loads left (`GET_INFO` P1 `04`) |
| `pubkey` | 33-byte compressed public key |
| `balance` | sum of unspent proof amounts |
| `auth` | `AUTH`, then verify the signature |
| `slots [--all]` | per-slot status (128 slots) |
| `proof <slot>` | decode one 82-byte proof slot, with its date |
| `load --keyset ID --amount N [--nonce HEX] [--c HEX] [--date T] [--pin P] [--owner] [--date-keys]` | `LOAD_PROOF`. `ID` is the 16-hex-char NUT-02 keyset id: a version `00` id, or the first 8 bytes of a version `01` id. A 3.0 card loads only under the PIN given in this tap; `--owner` adds the owner's grant, which opens no load on 3.0. `--date-keys` sends P2 `02`, the loader's word that the piece was minted locked to the card's key for its date (below) |
| `clear-spent [--pin P]` | free spent slots |
| `verify-pin PIN` | verify the PIN for this tap; sent again for as long as the card answers `6A98` (a card with no owner serving the wait its wrong tries left: keep holding it). Every command that takes `--pin` does the same |
| `setup --pin P --mint URL (--owner-key K \| --test-owner-key) [--unit sat\|usd] [--refund HEX] [--design XYZ] --anchor HDR [--owner-seed SEED] [--day N [--payment N --allowance N --budget N --rate N --no-pin-window 0\|1]]` | 3.0: a fresh card's first set-up in one selection (D196: every `SELECT` ends it, so separate commands cannot make it): `SET_PIN`, `VERIFY_PIN`, `SET_CARD`, the owner claimed (held for, with the anchor), then the owner's limits. `--anchor`, the tip (`tip` prints one), is required: the claim's anchor, the first set-up's on an empty card, becomes the card's clock even where the clock was later, and its hardest where it is harder ([D204](../../docs/DECISIONS.md#d204)), so a far header a stranger gave the card before is let go; setup without it refuses before anything is sent. With `--owner-seed` (the owner's 64-byte BIP-39 seed, hex) the claim gives the card a c made from it ([D202](../../docs/DECISIONS.md#d202)), s worked out from the card's own key read in this tap, so that a phone restored from the words has c (to take back a lost card's dated pieces it needs the card's key P and the pieces too); setup then reads c back from the card (`GROUP_KEYS` for the date 0) and finds its n before it says c is the owner's, and stops, naming the owner's reset, where no n gives it. **`--owner-key` is required for any card that will hold money**; `--test-owner-key` sets a bench card up under the TEST key, which anyone with this repository holds: they can change its PIN and spend it. Before anything is written it checks the PIN, the key, the mint (1 to 77 printable ASCII characters), the refund key (a point of the curve), the anchor's work (its own, the floor, and a quarter of the hardest header the card has taken), the card's clock (on a card older than 3.0, whose claim moves the clock only forward, a clock more than two hours past the anchor's time was set by a header far ahead: setup refuses the card and names the reset with the tip as its anchor, [D203](../../docs/DECISIONS.md#d203); a 3.0 card's claim brings it back, and setup says so) and the limits, and refuses a card with a PIN, an owner or a holder's record (a factory record is taken, and its design kept unless `--design`, three capital letters or digits, names another). A failure after `SET_PIN` prints the card's state and the way on (below): on 3.0 the reset by the PIN, then `setup` again (with `--design` and the factory record's design, which the reset clears); on a card older than 3.0, which has no reset by the PIN, the claim at a later tap (`set-owner --pin`) |
| `reset --pin P [--anchor HEX] [--yes]` | 3.0 (both forms warn first, `--yes` or not: a reset gives the card a new c, so eCash already swapped to its keys and not yet loaded can never be loaded after it, lost for good undated and the refund key's after its date where dated; load it first, or keep c with r, `card-secret`): the reset by the PIN of an empty card with no owner (`RESET_CARD`): the PIN, a held tap (`GET_LOG` held for, ten askings), then sixty askings, about 45 seconds on the reader, all in one selection. The card is then as from its install, with a new card key and a new c. `--anchor`: a block header that becomes the clock even where it is older (D200), the way back from a clock a header far ahead set; on a fresh card with no PIN (`--anchor` only), `--pin` is set first, for the reset alone, in the same selection ([D203](../../docs/DECISIONS.md#d203)) |
| `reset --owner-key K [--pin P] [--anchor HEX] [--yes]` | 3.0: the owner's reset of an empty card with an owner: the owner's proof over the anchor, or over nothing (D200); a locked card wants `--pin` too |
| `set-pin PIN [--owner]` | set the PIN on a card with no owner; `--owner` (ADD PIN under the grant) is for 2.2 and earlier: a 3.0 card with an owner refuses `SET_PIN`, use `change-pin`. A 3.0 card with no PIN is refused, with nothing sent: alone, its `SET_PIN` would begin a first set-up that the next command ends; use `setup` |
| `change-pin NEW` | the owner sets a new PIN: no old PIN, any state; unblocks a blocked card |
| `set-card --mint URL [--unit sat\|usd] [--refund HEX] [--design XYZ] [--pin P]` | write the record (the owner's proof on an owned card); without `--unit` the record keeps the unit it has, and without `--design` the design it has (`SET_CARD` zeroes a design the record it is sent does not carry) |
| `set-owner (--owner-key K \| --test-owner-key) [--anchor HEADER] [--pin P] [--old-owner-key HEX] [--owner-seed SEED]` | give the card its owner (the public half of `--owner-key`, required: the TEST key only under `--test-owner-key`), anchored at a block header. A claim wants `--pin` (the PIN in the same tap) and is held for (`6A98`, asked six times); `--old-owner-key` replaces an owner, with nothing unspent and no change owed. After a hand-over a 3.0 card answers `verify-pin` `6982` until the new owner's `change-pin`, and a dated load `6A8E` until its `set-card --mint <the mint> --refund <its refund key> --owner-key <the new owner key>`. `--owner-seed` gives the card the new owner's c, made from that seed and the card's own key read in this tap (`SET_OWNER` P1 `01` before the claim or the hand-over, and its check under the proof), then reads c back (`GROUP_KEYS` for the date 0, under the PIN of a claim or the new owner's grant) and finds its n before it says so; where no n gives it, it stops and names the owner's reset |
| `tip [--url URL]` | print the ops service's tip header, 80 bytes hex (ENG-740); this is the value `--anchor` takes |
| `set-owner-url (--owner-key K \| --test-owner-key) [--url URL] [--pin P] [--old-owner-key HEX] [--owner-seed SEED]` | `set-owner` with the anchor fetched from the ops service's tip feed |
| `set-limit --day N [--payment N --allowance N [--budget R]]` | the owner's limits; `--budget` (1–30) is the rollover budget, and needs the two before it; without it the card leaves the budget as it is ([D26](../../docs/DECISIONS.md#d26)) |
| `set-header --header HEX` | `SET_HEADER`: show the card a block header |
| `refresh --header HEX [--back]` | `REFRESH`: the owner's proof over the tip header; the rollover budget is full again, and a weak clock comes back to the header (D201). `--back`: the header and `01` under the proof, which brings back any clock to an older header that is not weak, and the day's window and the day of loads begun after it with it (D203). It says whether the clock moved: where the card's answer is not the header's time, the clock stayed, and it names the way that would move it |
| `refresh --pin P --header HEX` | `REFRESH` P1 01 on a card with no owner: the PIN and a held tap stand for the owner's proof; brings back a weak clock, never another, and says so where the clock stayed: that the header itself is weak to the card, where it is, or else the empty card's anchored reset as the way out |
| `lock --pin P [--yes]` | **irreversibly** disable writes: the PIN and the owner's proof |
| `outbox [--pin P \| --owner] [--file PATH]` | `GET_OUTBOX`: the last payment's settlement packet, both signatures checked. On 3.0 the scope (P1 `00`) wants the PIN or the owner's grant, and the packet (P1 `01`) the grant, or on a card with no owner the PIN in a held tap, which cardctl does not make; the packet's key is checked against `GROUP_KEYS` for the date 0 |
| `group-keys --date N [--pin P \| --owner]` | `GROUP_KEYS` (3.0): the keys of the pieces of date N (0 for undated): t, P + t·G and R + u·G, after the PIN or the owner's grant; P + t·G is checked against `GET_PUBKEY` |
| `card-secret [--refund-key HEX \| --refund-key-file PATH] [--pin P] [--owner-key K] [--show] [--owner-seed SEED [--date D]]` | `GET_CARD` P1 `03` (3.0): the card's secret c, sealed, opened here (below); with `--owner-seed`, c checked against the owner's c worked out from the seed alone, and with `--date` the take-back key of that date |
| `change` | `GET_CHANGE` (3.0): every opening of the card's own change owed (its number, amount, keyset, date, B_ and the mint's key K it is bound to), page by page until a short answer. No PIN |
| `load-change N --k HEX (--signature JSON\|FILE \| --c HEX --e HEX --s HEX)` | `LOAD_CHANGE` (3.0): opening N made into its piece from the mint's answer for its B_: C_ and K as 33 bytes (`02`/`03`) or 65 (`04`), sent in the `04` form, e and s of the mint's proof; or `--signature`, the mint's own answer for it (one entry of its swap's or NUT-09 restore's `signatures`, JSON or a file), and one with no `dleq` is said plainly, naming NUT-09 restore, with nothing sent. The opening is read first: K must be the key it is bound to and the proof must hold for its B_, or nothing is sent. Any reader, no PIN (below) |
| `keyset-keys FILE [--pin P] [--show N [--rebind --owner]] [--input-fee-ppk F]` | `KEYSET_KEYS` (3.0): with `--pin`, teach the card a keyset's keys from the mint's (NUT-01 JSON), the ID the card answers checked against the file's; with `--show N`, show opening N's key to be one of them by its path (no PIN); `--rebind` binds the opening to the file's key for its amount, or moves it to the file's keyset, under the PIN and the owner's grant (below) |
| `cert` | `CERT_READ` (3.0): the certificate's state and, where one is sealed, its container in hex and its SHA-256 |
| `dump --mint URL [--unit U] [--out PATH] [--force] [--unspent-only]` | **0.x cards only**: write the card's slots out as a card file. `--out` refuses to overwrite without `--force` |
| `load-file PATH [--pin P]` | **0.x cards only**: `LOAD_PROOF` every proof in a card file. Refuses a file for another card or too few free slots; re-runnable |
| `apdu <hex>` | send a raw APDU |

Gone with the 0.x wire ([D18](../../docs/DECISIONS.md#d18)): `sign`
(`SIGN_ARBITRARY`, which signed anything and burned nothing), `spend`
(`SPEND_PROOF`; a 2.0 payment is `SPEND_ALL_*` with a mint's outputs, which a
till drives), `clear-pin`, `set-puk` and `unblock-pin`. Their opcodes `43`, `44`,
`45` are `SET_OWNER`, `GET_NONCE` and `ALLOW_LOAD` on 2.0, so they must not come
back; `test_apdu.py` checks the parser refuses them.

**The versions cardctl drives.** A command selects the card and reads its version
first. It drives 2.0, 2.1, 2.2 and 3.0 as each is, and every later minor of 3 (3.1,
3.2, ...) as 3.0: D205's rule is that a reader takes every minor of a major it was
built for, since a minor never changes what a reader of an earlier one sends or is
answered. Any other major is refused. A 2.x above 2.2 was never released: a card
answering `02 03` is a build of 3.0's wire from before its renumbering (D205), which
cardctl's 2.x paths would drive wrongly (`GET_INFO` P1 `02`, `GET_PUBKEY` as the
outbox key, the old set-up clock check). Every command that moves money or sets the
card up refuses such a card after its `SELECT`, saying what it answered and what
cardctl knows; the reads (`info`, `balance`, `slots`, `proof`, `auth`, `change`,
`cert`, `outbox`, `group-keys`, `card-secret`, `verify-pin`) and `apdu` go on, with a
note. `selftest` passes only the versions it knows (2.1, 2.2, 3.0): a 3.1 fails its
`SELECT` check as a version that cardctl does not know, which says the test is not
proven on it, not that the wire differs.

Global flags: `-r/--reader N` to pick a reader, `-v/--verbose` to log every APDU
to stderr. Use `-v` when a command misbehaves, since the raw exchange usually
makes it obvious whether the card rejected the command or never saw it.

## Timing a card

`--timing` goes before the command and times every APDU around the PC/SC
transmit call, so each figure includes the applet's work and the full reader
round trip. Per-APDU lines go to stderr as they happen and a per-command
table (count, min, median, max, total) follows at exit, even when the command
fails partway.

```bash
python3 cardctl.py --timing selftest --rounds 10    # 12 AUTH signatures, 1 table
python3 cardctl.py -t refresh --header <hex>         # GET_NONCE + one ECDSA verify + a header, timed
```

2.0 changed the field multiply ([D21](../../docs/DECISIONS.md#d21)): re-measure
`AUTH` on the J3R180 before a release. On 3.0's source, numbered 2.3 then, it took
626 ms (the median of ten rounds, a J3R180 on an ACR39U contact reader, 2026-11-13);
the 3.0 file itself is not yet measured on a chip.

Compare like with like: a contact reader, the ACR122U over RF and a phone over
NFC all give different numbers for the same card, and the phone adds field
discovery that none of these capture. The median is the figure to quote.

## A warning about `load`

`load` without `--c` puts a placeholder in place of the mint's signature: a
point of the curve made from the nonce (a 3.0 card checks that C is a point,
`6A80`), which no mint signed. That is fine for exercising storage and slot
management, but the placeholder cannot be redeemed at a mint.

A 3.0 card signs only format-4 `SIG_ALL` pieces locked to the card's key for
their date, P + t·G with t = SHA-256(`CashuCard/key` ‖ c ‖ date) mod n (the date
0 for an undated piece), and a dated piece's refund to R + u·G
([Keys per load](../../spec/APDU.md#keys-per-load),
[NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md#card-proofs)). Ecash
locked to the card's main key P alone can never be spent by the card, and an
undated piece has no refund either. `load` writes whatever it is given, so a real
top-up is a wallet's NUT-11 swap to those keys first: `group-keys --date N` gives
them, or c does (`card-secret`). `--date-keys` is the loader's word that this was
done, P2 `02`; without it a 3.0 card answers `6A86` and writes nothing. A card of
2.2 or earlier signs with P alone, so `--date-keys` is refused there before the PIN
is sent.

cardctl has no payment flow: `Card.spend_all_change` (the 45-byte
`SPEND_ALL_CHANGE`) is there for a till built on cardctl's library, and it takes the
mint's `GET /v1/info` (`fetch_mint_info`) as its fourth argument. It asks the card
for change only where that answer says NUT-12 and NUT-09 are supported
(`check_change_mint`): the card loads its change only with the mint's DLEQ proof,
and nobody else can unblind it, so change swapped at a mint that gives none is lost
for good, and NUT-09 restore is the only way back to a swap answer lost on its way.
At any other mint it refuses, with nothing sent, and the till pays the exact amount
with no change output. `change_signature` reads one of the mint's change signatures
and says plainly, naming restore, when it carries no `dleq`.

## A set-up that stops

`setup` checks what it can before the card's `SET_PIN`. Past it, a refusal or a
card taken off the reader leaves the card part set up, and `setup` says what the
card now holds, read in the same selection, and the way on:

- **Owner yes:** the claim went through, and the card is set up but for its
  limits. Send them with `set-limit --owner-key K --day N ...`.
- **A PIN and no owner:** the card holds nothing, and once it leaves the reader
  nothing more can be written to it until it is reset. Reset it by its PIN,
  `reset --pin P` (about 45 seconds on the reader), then run `setup` again.
- **No PIN:** nothing was kept. Run `setup` again.
- **Not read** (the card left the field): put it back and run `info`, then
  follow the line above that fits.

A first `SET_CARD` that answers `6F00` is the chip's ECDH framing check
(docs/HARDWARE_DEPLOYMENT.md): the chip cannot run the card.

## The card's own change (3.0)

A payment can leave change for the card itself: the card makes the blinded
message and keeps the opening, bound to the mint's key K for its amount, and
the change goes back on the card later, from any reader, with no PIN.

1. `change` lists the openings owed (`GET_CHANGE`, 83 bytes each). The holder's
   wallet asks the mint for the signature on each B_ (NUT-09 restore).
2. The card writes change only under a key it has seen to be one of its
   keyset's keys. `keyset-keys FILE --pin P` teaches it the keyset (the PIN
   given in the tap; the owner's grant alone teaches nothing). FILE is the
   mint's `GET /v1/keys` answer for that keyset, `{"id", "unit", "keys": {"1":
   "02..", ...}}`. cardctl works the ID out as NUT-02 does and refuses a file
   whose keys do not hash to its own `id`: a version `00` ID hashes the keys
   alone; a version `01` ID hashes `amount:K` joined by `,`, then the tail
   `|unit:sat` (or `usd`), `|input_fee_ppk:F` where the fee is not 0, and
   `|final_expiry:T` where the keyset has one. The fee is in `GET /v1/keysets`,
   not in `GET /v1/keys`: give it as `input_fee_ppk` in the file or with
   `--input-fee-ppk`. The card checks the same ID before it keeps the keys.
3. `keyset-keys FILE --show N` shows opening N's key to the card: the leaf
   SHA-256(`00` ‖ amount (8) ‖ K), its index and its path in the tree of the
   keyset's keys (padded to a power of two with SHA-256(`02`), nodes
   SHA-256(`01` ‖ left ‖ right)). Any reader, no PIN. An opening a reader bound
   to a key that is not the mint's, or made in a keyset the mint had left, is
   mended with `--rebind --pin P --owner` in a tap that paid nothing; on a card
   with no owner the holder's say is a held tap, which cardctl does not make.
4. `load-change N` with the mint's answer: C_, K, e and s. The card checks K
   against the bound key, the mint's proof against its own B_, takes its
   blinding factor off and writes the piece. cardctl checks the first two
   itself before it asks. The card's words, said by cardctl: `6A9F` the key not
   shown yet (step 3); `6A80` the answer is not the mint's for this opening;
   `6A8F` past the day's 300 pieces, the change stays owed until the card's day
   of loads turns; `6A86` no word on keys per load, which cardctl always gives
   (P2 `02`).

## The card's secret c

`card-secret` asks for c in the form the card's record calls for, right after
`GET_NONCE` P1 `01` (sixteen bytes good once; `6985` with none live):

- **A card with a refund key** (`GET_CARD` bytes 7 to 39 not all zero): c is
  sealed to the refund key R. The card answers K = k·G and c XOR SHA-256(`CashuCard/seal`
  ‖ `01` ‖ x(k·R) ‖ K ‖ the sixteen bytes ‖ `16`); cardctl opens it with the
  refund key's private key r (`--refund-key HEX`, or `--refund-key-file PATH`
  holding it as hex, which keeps it off the command line), since r·K = k·R. The gate: the owner's grant on an owned
  card, or the PIN in this tap on a card with no owner.
- **A card with no refund key**: c is sealed to the card's PIN key (from
  `GET_NONCE` P1 `01`, checked here by the card key's BIP-340 signature over
  SHA-256(`CashuCard/pinkey` ‖ PIN key)). cardctl makes a one-time key E = e·G,
  sends it, and opens c with x(e·PIN key). The gate: the owner's grant on an
  owned card; on a card with no owner, the PIN in the card's first set-up only,
  the selection whose `SET_PIN` gave a new or reset card its PIN. cardctl selects
  the card again at every run, and never sends a `SET_PIN` that would begin a
  first set-up it cannot finish: a card set up by `setup` has an owner, whose
  grant reads c at any tap (`--owner-key K`).

c is then checked: the card's key for the date 0 worked out from it must be the
one `GROUP_KEYS` answers. cardctl prints c only with `--show`. c ties every payment
of the card to it: keep it with the refund key's private key, as secret as that
key, since a refund needs both (r + u).

**The owner's c** ([D202](../../docs/DECISIONS.md#d202)). `setup` and `set-owner` with
`--owner-seed SEED` (the owner's 64-byte BIP-39 seed, hex) give the card a c made from
it: s = HMAC-SHA256(SEED, `CashuCard/c` ‖ `00` ‖ the card key), sealed to the card's
PIN key (`GET_NONCE` P1 `01`, its signature checked) in `SET_OWNER` P1 `01`, then the
claim or the hand-over with SHA-256(`CashuCard/c` ‖ s)'s first sixteen bytes at the end
of its value. The card takes c = SHA-256(`CashuCard/c` ‖ s ‖ n), n the owners' c it has
taken (from 1). `card-secret --owner-seed SEED` opens c as above and checks that some n
gives it, as a phone restored from the words would; with `--date D` and the refund
key, it also checks that r + u for D, u from that c, is the private key of the card's
refund key for D. The vector is `spec/vectors/owner-c.json`; `test_apdu.py` makes it
again with cardctl's own code.

## Card files (0.x cards only)

Card files describe the 0.x applet's pieces (no date, the 0.x secret), so `dump`
and `load-file` select the 0.x AID and refuse any other card
([`spec/CARD-FILE.md`](../../spec/CARD-FILE.md)): they are kept for the sweep of
0.x cards (docs/HARDWARE_DEPLOYMENT.md). They speak the interchange format in
[`spec/CARD-FILE.md`](../../spec/CARD-FILE.md), the intended contract with
cashu-client's `serializeCardFile` / `parseCardFile`. `test_card_file.py` parses
the spec and asserts this driver's parser and writer against the published field
tables, so a rename on this side fails in CI rather than at a card reader.

> `cashucard/client#5` and `cashucard/javacard#19` merged on 2026-08-28. The
> TypeScript parser accepts the `spent` field written by `cardctl dump`.
> `serializeCardFile` writes `spent: false` for proofs headed to a card and
> refuses `spent: true`, because `LOAD_PROOF` carries no spent bit. Use
> `cardctl dump` for full card files that include spent slots.

Four things the format insists on, all because a card file is bearer money:

- **Every slot must include `spent`.** An omitted field leaves proof state
  unknown. Guessing `unspent` can make the card report an already-settled proof
  as available after `load-file`; the mint will still reject it.
- **Unknown fields are refused.** Both document and slot parsers reject them. An
  unrecognised key means the writer added something without bumping `version`;
  dropping it silently is how the two sides drift apart in the first place.
- **Amounts are positive powers of two below 2^32,** enforced by `load` and
  `load-file` alike. A card file's keyset ids are NUT-02 v0 (`00` version byte),
  as the 0.x card's client wants them; `load` on a 2.x card also takes a version
  `01` id, given by the 8 bytes the card keeps of it, and refuses any other
  version.
- **`load-file` is re-runnable.** `LOAD_PROOF` commits one proof at a time with
  no transaction around the file, so a failure part-way through leaves half of
  it on the card. Re-running skips whatever is already there by nonce instead of
  writing duplicates. It checks capacity, amounts and points before the first
  write. A nonce the card has already *spent* is reported as spent.

`dump` validates the document it assembled before writing it, so a mistake like
`dump --mint "$UNSET_VAR"` fails loudly instead of leaving an unloadable backup.
The one exception is a spent slot that fails the slot checks, as a card pulled
mid-`CLEAR_SPENT` can leave one: `dump` skips it with a warning on stderr
(`half-cleared by an interrupted CLEAR_SPENT; run clear-spent`, once the card's
other spent slots have settled) and writes the rest. The slot checks catch a
zeroed amount and a `C` that is no longer a point. A tear that zeroed only
keyset or nonce bytes, or part of `C` whose x still lands on the curve, passes
them, and `dump` writes that slot as spent. An unspent slot that fails still
refuses the whole dump.

## Tests

```bash
python3 test_bip340.py            # verifier: spec vectors, reference round-trip, mutations
python3 test_p256.py              # the owner's ECDSA: RFC 6979 vectors and the card's own (spec/vectors/owner.json)
python3 test_apdu.py              # every command's bytes, against spec/APDU.md
python3 test_spec_consistency.py  # cardctl vs spec/APDU.md and the applet, parsed; the applet vs NUT-CCP's secret
python3 test_card_file.py         # card file read/write, against spec/CARD-FILE.md
python3 test_hwtest_65byte_pubkey.py  # host-side pubkey normalisation used by hwtest_65byte_pubkey.py
python3 test_tip.py               # tip / set-owner-url: the ops service's tip feed, no socket (ENG-740)
```

All seven run without a reader or a card. `test_apdu.py` also holds a small model
of a 3.0 card and its own secp256k1 arithmetic, against which `group-keys`, both
forms of `card-secret`, `change`, `keyset-keys` (the ID and the tree worked out on
their own, and the IDs the applet's suite records), `load-change` (the mint's
proof made and checked, the blinding taken off) and `cert` are run. The BIP-340 tests matter more than they
look: `selftest`'s verdict is only as trustworthy as the verifier behind it, so
that verifier is checked against the specification's own vectors, round-tripped
against an independent reference signer, and mutation-tested to prove it can
say *no*.

`hwtest_65byte_pubkey.py` is the one script here that *does* need a card. It is
the check behind section 8 of
[`docs/reports/HARDWARE_TEST_REPORT_2026-09-01.j3r452.md`](../../docs/reports/HARDWARE_TEST_REPORT_2026-09-01.j3r452.md):
on a card whose `GET_PUBKEY` returns a 65-byte uncompressed point (the applet
before #23) it normalises the key on the host, confirms the point is on
secp256k1, and then runs the same sign/verify and nonce-freshness rounds as
`selftest`. It sends only SELECT, GET_PUBKEY and SIGN_ARBITRARY, so it is a
0.x tool: it selects the 0.x applet and refuses any other card.

```bash
python3 hwtest_65byte_pubkey.py -r 1   # reader index, as for cardctl
```

## Bounded read-only provisioning preflight

For an owned, empty 2.1 card with retained spent entries,
`spent-audit.cjs` defaults to an offline/no-reader preview. Explicit
`--inspect` runs its restricted private Python child, checks the exact CPLC
and applet key, and requires every retained proof to be SPENT at the explicitly
matched HTTPS mint. It prints only counts, denomination totals and an evidence
digest, never raw proof data. It has no PIN, manager login, clear or reset
operation. The named-card approval and invocation are documented in
[`SPENT-SETTLEMENT-AUDIT-PLAN.md`](../../docs/reports/SPENT-SETTLEMENT-AUDIT-PLAN.md).
Its tests need neither PC/SC nor a network:

```bash
node --test tools/cardctl/spent-audit.test.cjs  # from repo root
python3 test_spent_audit.py                  # from tools/cardctl
```

`read_only_preflight.py` checks an exact CPLC identity before inspecting the
2.1 applet's public state. It never authenticates or retries. It stops on an
absent applet, unknown version, malformed response or identity mismatch.
Physical execution requires approval for the named reader/card and the APDU
sequence in [the first-write drill plan](../../docs/reports/PROVISIONER-FIRST-WRITE-DRILL.md).
This is separate from `cardctl info` and `selftest`, which send more commands.

After that approval, run in this directory with the documented Homebrew venv:

```bash
.venv/bin/python read_only_preflight.py --reader 'ACS ACR122U PICC Interface' --expect-chip cplc-v1:4790d3213180072976207515
```

Reader-free regression checks: `python3 test_read_only_preflight.py`.

`reset_bridge.py` is a private transport for the local recovery runner, not a
general cardctl command. It permits only the reset plan's APDUs, never retries,
and imports PC/SC only on explicit execution. Its reader-free checks are
`python3 test_reset_bridge.py`. Physical execution follows the separately
approved [owned-card reset drill](../../docs/reports/OWNED-CARD-RESET-DRILL.md).
