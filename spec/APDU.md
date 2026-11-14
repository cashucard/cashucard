<a id="apdu-command-reference--cashu-card-protocol-23"></a>
<a id="apdu-command-reference--cashu-card-protocol-22"></a>
<a id="apdu-command-reference--cashu-card-protocol-21"></a>

# APDU Command Reference: Cashu card protocol 2.3

The wire of the shared Cashu card protocol, version 2.3: the applet in this
repository (`applet/src/main/java/me/flashapp/cashu/CashuApplet.java`), which is
the Foxy wallet project's software 1.20 with a neutral identity and the fixes in
[`docs/DECISIONS.md`](../docs/DECISIONS.md) D18 to D26, the settlement record of
D175 and D176 (2.2), and the decisions of 2.3, D183 to D198. Version 2.x is not
compatible with the 0.x applet that this file used to describe, nor with Foxy's
1.x: it has an AID of its own, so that neither can be mistaken for it.

**What 2.3 changes.** The card finishes its own change: `GET_CHANGE` answers
83-byte openings bound to the mint's key, with no blinding factor in them;
`SPEND_ALL_CHANGE` names the mint's key and the change's keyset (45 bytes); the new `LOAD_CHANGE` (`27`) takes the mint's answer, checks its DLEQ
proof on the card and unblinds it; and `RESET_CARD` has a form that gives up one
opening ([D183](../docs/DECISIONS.md#d183)). Units are named in the core, `00`
sat and `01` usd, and one card can hold both at its mint (format `05`,
[D184](../docs/DECISIONS.md#d184)). The profiles of 2.3 are listed in
[Profiles of 2.3](#profiles-of-23): a PIN before any money, a tighter no-PIN
allowance, an owner claimed slowly, a wait on every payment, two units on one
card, a holder with no phone, keyset keys, the paid list and the certificate.
`SET_LIMIT` has one layout, 18 bytes, carrying the rollover budget, the rate and
the no-PIN window's switch. Every piece is locked to the card's key for its date
and a payment is signed with that key ([Keys per load](#keys-per-load),
[D197](../docs/DECISIONS.md#d197)), and a card's history (its spent places, its
clock's last header, its rolls and arming, its no-PIN window's start and its last
payment's scope) is said only to a reader with the PIN or the owner's grant
([D198](../docs/DECISIONS.md#d198)). [What a 2.2 reader sees](#what-a-22-reader-sees) says what an older reader
meets on a 2.3 card.

The protocol's core is [NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md), the draft NUT in
[cashucard/nut](https://github.com/cashucard/nut): selecting the card, card proofs,
units, reading, paying, the card's own change and loading. This file is the
reference implementation's command reference. It gives every command byte for
byte, and it specifies the profiles NUT-CCP leaves to implementations: the owner
([The owner's proof](#the-owners-proof)), the clock and the limits
([The clock and the limits](#the-clock-and-the-limits)), the NFC tag
([The NFC tag application](#the-nfc-tag-application)) and those of 2.3
([Profiles of 2.3](#profiles-of-23)). The certificate's format is NUT-CCP's
[certificate profile](https://github.com/cashucard/nut/blob/main/profiles/certificate.md);
this file gives the card's two commands for it.

Class `B0` for every applet command. Numbers are big-endian unless a row says
otherwise (a block header's own fields are little-endian, as the network carries
them). `cardctl.py` (`tools/cardctl`) drives the commands it names below, and
`test_spec_consistency.py` holds this file, `cardctl.py` and the applet to each
other on every push. The design and the reasons for it are in
[`docs/FOXY-CARD-SPEC.md`](../docs/FOXY-CARD-SPEC.md) section 5 and
[`docs/FOXY-CARD-DAILY-LIMIT.md`](../docs/FOXY-CARD-DAILY-LIMIT.md); where they
and this file differ, this file is the protocol 2.3 command reference.

**Two words.** *This tap* is from a `SELECT` of the card's applet until the next
one or until the card leaves the field: what is given in it (the PIN, the owner's
grant) is gone with it. *This time in the field* is from the card's power-up until
it leaves the field, and outlasts a `SELECT`: whether a payment was signed in it,
an owner claimed, or a history read ([Session State](#session-state-transient)).

---

## SELECT APPLICATION

| Field | Value |
|---|---|
| CLA | `00` |
| INS | `A4` |
| P1 | `04` (select by name) |
| P2 | `00` |
| Lc | `0B` |
| Data | `F0 43 41 53 48 55 43 41 52 44 01` (the card's applet: the package AID, "CASHUCARD" after the proprietary RID byte `F0`, and `01`) |
| Le | `00` |

**Response:** 2 bytes, the applet version: `02 03`. A reader takes any `02 xx`
as the shared protocol; `02 00` is the v2.0.0 release, whose rollover rules D26
replaced, `02 01` is 2.1, which has no `GET_OUTBOX` (it answers `6D00`), and
`02 02` is 2.2, whose change a reader finishes itself from the blinding factor
`GET_CHANGE` gives (80-byte openings) and which has no `LOAD_CHANGE` (`6D00`). A
reader sends `LOAD_CHANGE` and reads 83-byte openings only from a card that
answers `02 03` or later.

A reader selects the applet's whole AID ([D25](../docs/DECISIONS.md#d25)). The
package AID `F0 43 41 53 48 55 43 41 52 44` begins two instance AIDs, the
opener's (`F0 43 41 53 48 55 43 41 52 44 4D`) and the card's applet's (`…44 01`),
and the NFC tag's class AID (`F0 43 41 53 48 55 43 41 52 44 54`; the tag is
instantiated under the NFC Forum's own `D2 76 00 00 85 01 01`). On a chip, a SELECT by that partial name
reaches the first instance made whose AID begins with it, and the opener is made
first ([`HARDWARE_DEPLOYMENT.md`](../docs/HARDWARE_DEPLOYMENT.md)): it answers
`90 00` with no version, and `6D 00` to every command after. A reader that has
only the package AID to go on, or that gets `6A82` to the whole AID, may try it,
but takes a `90 00` without the two version bytes as no answer from the card's
applet.

A card that answers `6A82` (the card's runtime: no such application) to this
name is not a 2.0 card. The 0.x applet answered `D2 76 00 00 85 01 02` and Foxy's
1.x `F0 46 4F 58 59 43 41 52 44`; both are "this card needs an update", and an
app spends nothing from such a card.

---

## Commands, by INS

| INS | Command | Needs | Section |
|---|---|---|---|
| `01` | GET_INFO | nothing | [GET_INFO](#get_info-0x01) |
| `10` | GET_PUBKEY | nothing | [GET_PUBKEY](#get_pubkey-0x10) |
| `11` | GET_BALANCE | nothing | [GET_BALANCE](#get_balance-0x11) |
| `12` | GET_PROOF_COUNT | nothing | [GET_PROOF_COUNT](#get_proof_count-0x12) |
| `13` | GET_PROOF | nothing | [GET_PROOF](#get_proof-0x13) |
| `14` | GET_SLOT_STATUS | nothing | [GET_SLOT_STATUS](#get_slot_status-0x14) |
| `15` | AUTH | nothing | [AUTH](#auth-0x15) |
| `16` | GET_CARD | nothing; P1 = 3 (c, sealed): the owner's grant, or with no owner the PIN (with no refund key, in the first set-up only) | [GET_CARD](#get_card-0x16) |
| `17` | GET_PIECES | nothing | [GET_PIECES](#get_pieces-0x17) |
| `18` | GET_LOG | owned: the log, the PIN or the owner's grant; the receipts, the grant; with no owner, the PIN and a held tap | [GET_LOG](#get_log-0x18) |
| `19` | GET_CHANGE | nothing | [GET_CHANGE](#get_change-0x19) |
| `1A` | GET_DLEQ | nothing | [GET_DLEQ](#get_dleq-0x1a) |
| `1B` | GET_OUTBOX | the PIN, the owner's grant or the paying tap; P1 = 1 the holder's say or the paying tap | [GET_OUTBOX](#get_outbox-0x1b) |
| `1C` | CERT_READ | nothing | [CERT_READ](#cert_read-0x1c) |
| `1D` | GROUP_KEYS | the PIN given in this tap, or the owner's grant | [GROUP_KEYS](#group_keys-0x1d) |
| `1E` | INBOX | nothing (a holder's record, a clock, not locked) | [INBOX](#inbox-0x1e) |
| `22` | SPEND_ALL_BEGIN | a PIN set | [SPEND_ALL_BEGIN](#spend_all_begin-0x22) |
| `23` | SPEND_ALL_OUTPUTS | a payment begun | [SPEND_ALL_OUTPUTS](#spend_all_outputs-0x23) |
| `24` | SPEND_ALL_SIGN | the PIN, or the no-PIN allowance | [SPEND_ALL_SIGN](#spend_all_sign-0x24) |
| `25` | SPEND_ALL_AGAIN | the PIN, unless the last signature needed none | [SPEND_ALL_AGAIN](#spend_all_again-0x25) |
| `26` | SPEND_ALL_CHANGE | a payment begun, its outputs given | [SPEND_ALL_CHANGE](#spend_all_change-0x26) |
| `27` | LOAD_CHANGE | a PIN set; then any reader, under the bound key | [LOAD_CHANGE](#load_change-0x27) |
| `30` | LOAD_PROOF | a record; the PIN given in this tap | [LOAD_PROOF](#load_proof-0x30) |
| `31` | CLEAR_SPENT | the PIN given in this tap | [CLEAR_SPENT](#clear_spent-0x31) |
| `32` | SET_CARD | no owner: the PIN, if one is set, in the first set-up; owned: the owner's proof | [SET_CARD](#set_card-0x32) |
| `33` | SET_LIMIT_PIN | no owner, nothing unspent or owed, the PIN, in the first set-up | [SET_LIMIT_PIN](#set_limit_pin-0x33) |
| `34` | SET_LIMIT | the owner's proof | [SET_LIMIT](#set_limit-0x34) |
| `36` | SET_HEADER | nothing | [SET_HEADER](#set_header-0x36) |
| `37` | TELL_TIME | nothing | [TELL_TIME](#tell_time-0x37) |
| `38` | KEYSET_KEYS | teach (P1 0 to 2): the PIN given in this tap; show (P1 3): nothing; another key than the opening's: the PIN and the holder's say | [KEYSET_KEYS](#keyset_keys-0x38) |
| `40` | VERIFY_PIN | nothing | [VERIFY_PIN](#verify_pin-0x40) |
| `41` | SET_PIN | no owner, nothing unspent or owed | [SET_PIN](#set_pin-0x41) |
| `42` | CHANGE_PIN | the owner's proof | [CHANGE_PIN](#change_pin-0x42) |
| `43` | SET_OWNER | no owner: the claim, under the PIN; owned: the old owner's proof | [SET_OWNER](#set_owner-0x43) |
| `44` | GET_NONCE | an owner (P1 = 0) | [GET_NONCE](#get_nonce-0x44) |
| `45` | ALLOW_LOAD | the owner's proof | [ALLOW_LOAD](#allow_load-0x45) |
| `50` | LOCK_CARD | the PIN and the owner's proof | [LOCK_CARD](#lock_card-0x50) |
| `51` | RESET_CARD | the owner's proof; one opening given up: the proof, or with no owner the PIN and a held tap | [RESET_CARD](#reset_card-0x51) |
| `52` | SET_TAG | the owner's proof | [SET_TAG](#set_tag-0x52) |
| `53` | REFRESH | the owner's proof; with no owner, the PIN and a held tap | [REFRESH](#refresh-0x53) |
| `54` | CERT_WRITE | a card that has never had a PIN, with no owner, holding nothing | [CERT_WRITE](#cert_write-0x54) |

Not assigned, and answered `6D00`: `20` (0.x's `SPEND_PROOF`, gone with format 4),
`21` (0.x's `SIGN_ARBITRARY`, removed: it signed anything and burned nothing),
`35` (Foxy's `SET_TIME`, gone in 1.15). `2E` and `2F` are kept for a later
profile and answered `6D00`. Foxy's 1.x had `LOAD_CHANGE` at `53`, which is
`REFRESH` here; 2.3's `LOAD_CHANGE` is `27`
([D193](../docs/DECISIONS.md#d193)). The 0.x `CLEAR_PIN`, `SET_PUK` and
`UNBLOCK_PIN` were `43`, `44` and `45`, which are `SET_OWNER`, `GET_NONCE` and
`ALLOW_LOAD` here; a 0.x reader's bytes there change nothing a PIN could gain
(D18).

A card with **no PIN** takes and pays nothing: it answers `6A97` to `LOAD_PROOF`,
`CLEAR_SPENT`, `LOAD_CHANGE`, `KEYSET_KEYS`, every payment command (`22` to
`26`), an owner's claim and the let-go form of `RESET_CARD`
([PIN before money](#pin-before-money)).

---

## The owner's proof

A card with an owner holds a NIST P-256 public key (`SET_OWNER`). The owner's
commands carry an ECDSA signature (P-256, SHA-256, DER) by the owner's private key
over

    label (ASCII) ‖ nonce (16) ‖ value

where the nonce is the last `GET_NONCE` answer in this tap (one try per nonce,
right or wrong) and the value is exactly the bytes after the proof. The data of an
owner's command is `proof length (1) ‖ proof (DER, at most 72) ‖ value`.

| Command | Label | Value |
|---|---|---|
| `CHANGE_PIN` | `CashuCard/change-pin` | the new PIN's bytes |
| `SET_LIMIT` | `CashuCard/set-limit` | 4, 8, 12, 13, 17 or 18 bytes: see [SET_LIMIT](#set_limit-0x34) |
| `SET_OWNER` (on an owned card) | `CashuCard/set-owner` | the new owner key (65), the anchor header (80) if sent, and the check of the next owner's c (16) if sent |
| `SET_CARD` (on an owned card) | `CashuCard/set-card` | the record as sent |
| `ALLOW_LOAD` | `CashuCard/load` | nothing |
| `LOCK_CARD` | `CashuCard/lock` | nothing |
| `RESET_CARD` | `CashuCard/reset` | nothing, or the anchor header (80) if sent; in the let-go form (P1 = 1), the opening's number (1) |
| `SET_TAG` | `CashuCard/tag` | one byte: `00` on, `01` off |
| `REFRESH` | `CashuCard/refresh` | the block header (80); in the back form, the header and `01` (81) |

A missing, wrong or used proof is `6A91`; it costs no PIN try, changes nothing
and does not end the PIN session. A card with no owner answers `6A90`. A good
proof also arms the no-PIN allowance and ends the no-PIN window, whatever the
command and even where the command is then refused for something else
([The clock and the limits](#the-clock-and-the-limits)).

The card hashes these tags too: `CashuCard/auth` ([AUTH](#auth-0x15)),
`CashuCard/seal` and `CashuCard/pinkey` (the sealed PIN, [VERIFY_PIN](#verify_pin-0x40)),
`CashuCard/c` (the owner's c, [SET_OWNER](#set_owner-0x43)),
`CashuCard/assisted-settlement/v1` ([GET_OUTBOX](#get_outbox-0x1b)), and
`CashuCard/cert-leaf/1` (the leaf of its own key in a certificate's tree,
[CERT_WRITE](#cert_write-0x54)).
A phone derives a card's owner key as
`HMAC-SHA256(seed, "CashuCard/owner" ‖ 0x00 ‖ card key (33))` mod n
(`FOXY-CARD-SPEC.md` 5.6, with the 2.0 label), made again with a counter byte
appended while the result is 0; the card never sees it. Restoring the seed
restores ownership of every card. [`vectors/owner.json`](vectors/owner.json) has
proofs for every label. The phone derives the owner's s for a card the same way, as
`HMAC-SHA256(seed, "CashuCard/c" ‖ 0x00 ‖ card key (33))` (32 bytes, no reduction),
and gives it to the card with the claim or the hand-over, from which the card makes
its c ([SET_OWNER](#set_owner-0x43), [D202](../docs/DECISIONS.md#d202)): restoring
the seed restores the c of every card that took it. The words alone are not enough to
take back a lost card's dated money: the phone also needs the card's key P (s is
worked out from it, and every date's keys with it) and the pieces themselves (their
secrets and the mint's signatures), which no seed path gives; a wallet keeps both
where its restore reaches them. [`vectors/owner-c.json`](vectors/owner-c.json) has s
and c, with BIP-39's test words.

A card is set up in one tap, owner last ([Personalisation](#personalisation)):
`SET_PIN`, `VERIFY_PIN`, `SET_CARD` (the mint), then the owner's claim
(`SET_OWNER` P1 = `01` with the owner's c, then `SET_OWNER`, six askings, carrying
the tip block header as its anchor and the c's check). A card
with no PIN takes nothing, and an owner is claimed only under the PIN.

---

<a id="category-0x0x--0x1x--read-no-authentication-required"></a>

## Category 0x0x / 0x1x: Read (no authentication required)

### GET_INFO (0x01)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `01` |
| P1 | `00`, `01`, `02`, `03` or `04` |
| P2 | `00` |
| Lc | absent |
| Le | `00` |

**Response:** 30 bytes with P1 = `00` (any P1 but 1 to 4), 42 with P1 = `01`, 43 with P1 = `02`, 51 with P1 = `03`, 59 with P1 = `04`. Each longer form is the one before it and more. Amounts are in the card's unit (`GET_CARD` byte 2: sats, or cents on a usd card). It refuses nothing.

What is history is said to a reader that has given the PIN (set, not blocked) or the
owner's grant in this tap. To anyone else bytes 21 to 28 (the day's window and what
it signed for), byte 50 (the last unit), 51 to 54 (the no-PIN window's start) and 57
and 58 (the loads left today) are zeros. A till needs none of them to pay: the counts of places (3 to 5, spent among
them: a wallet frees spent places by byte 4, [D196](../docs/DECISIONS.md#d196)), the
PIN's state and tries, the daily limit, the change owed, the allowance and what is
counted against it are said to anyone. The same rule holds across the card
([D198](../docs/DECISIONS.md#d198)): a spent place is not listed and is answered as
an empty one (`GET_PROOF`, `GET_PIECES`), `GET_CARD` says zeros for the last
header's hash, the rolls, the arming and the no-PIN window's start, and the last
payment's scope (`GET_OUTBOX` P1 = 0) is the paying reader's, the PIN's or the
grant's. What a stranger can still learn of the card's past: how many places are
spent and which (`GET_INFO` 4, `GET_SLOT_STATUS`, `GET_PROOF_COUNT`: a wallet frees
places by them), the openings of change owed (`GET_CHANGE`: any reader may write
them back), the keyset table (`GET_CARD` P1 = 2), the clock, the allowance and what
is counted against it, the loads left today where fewer than 8 are left (a payment's
change outputs, each asked before the PIN, are refused `6A8F` past them, and the
payment given up owes nothing: eight or more left reads only as eight or more,
[SPEND_ALL_CHANGE](#spend_all_change-0x26)), the unspent pieces, and the card's key, which stays the
same across payments and, on a certified card, across holders. With the mint's
records, a stranger holding the card can also tie the card to some of its swaps,
because a till needs these answers before it has the PIN: the keys of every date
with a piece on the card (`SPEND_ALL_BEGIN` answers a date's t and R + u·G for any
unspent place, and gives the payment up unsigned), and so every spend of those
dates; the swap that made each piece still on the card (`GET_DLEQ` gives its
blinding factor r, and C + r·K is the blind signature the mint issued); and the
card's last no-PIN payments (`SPEND_ALL_AGAIN` P1 = 1 answers `9000` for those
hashes). This is the limit of the card's privacy against someone holding it
([Keys per load](#keys-per-load)). The installation is in the payment's packet
(`GET_OUTBOX` P1 = 1), which a stranger is not given.

| Byte | Field | Meaning |
|---|---|---|
| 0 | version major | `02` |
| 1 | version minor | `03` |
| 2 | max slots | 128 (`0x80`) |
| 3 | unspent | slots holding an unspent piece |
| 4 | spent | slots spent and not yet freed |
| 5 | empty | free slots |
| 6 | capabilities | `FF` |
| 7 | PIN state | 0 none, 1 set, 2 blocked (a card with no owner is never blocked by wrong tries) |
| 8 | format | `04` (SIG_ALL pieces); `05` when the keyset table holds a keyset of the other unit than the card's ([Two units on one card](#two-units-on-one-card)) |
| 9 | tries left | 0 to 3 on a card with an owner; on one with none the chip's counter (2 or 3), filled again before each try: its wait is said by `63CX` and `6A98` ([VERIFY_PIN](#verify_pin-0x40)) |
| 10 | locked | 1 after `LOCK_CARD` |
| 11 | record set | 1 after `SET_CARD` (a factory record too, [A holder with no phone](#a-holder-with-no-phone)) |
| 12–15 | daily limit | 0 is none |
| 16 | has owner | 1 after `SET_OWNER` |
| 17–20 | now | the card's clock: the newest block header's time, seconds; 0 before any |
| 21–24 | window start | when the day's window began |
| 25–28 | spent today | what has left the card in the day's window |
| 29 | change owed | `01` while an opening of the card's own change is owed ([GET_CHANGE](#get_change-0x19)), `00` otherwise; said to anyone |
| 30–33 | payment limit | P1 ≥ 1: the limit on one payment, said only with the owner's grant in this tap or, on a card with no owner, to the PIN in a held tap; zeros otherwise |
| 34–37 | no-PIN allowance | P1 ≥ 1: what the card signs for without its PIN in its no-PIN window |
| 38–41 | no-PIN spent | P1 ≥ 1: what has been signed for without the PIN in the no-PIN window that runs; zeros where none runs |
| 42 | tag off | P1 ≥ 2: `00` the NFC tag is on, `01` off |
| 43 | keyset table | P1 ≥ 3: `01` when the card keeps its keyset table, `00` before its first `SET_CARD` or where it was refused the room |
| 44–47 | rate | P1 ≥ 3: sats to the dollar, `0` none; said as the payment limit is, zeros otherwise |
| 48 | entries | P1 ≥ 3: entries of the keyset table in use |
| 49 | unmarked | P1 ≥ 3: entries in use without the holder's mark |
| 50 | last unit | P1 ≥ 3: the last payment's unit: `80` the card's, `A0` the other, `00` none |
| 51–54 | no-PIN window | P1 = 4: when the no-PIN window that runs began, by the card's clock; zeros where none runs |
| 55–56 | profiles | P1 = 4: the profiles the card keeps, one bit each (below) |
| 57–58 | loads left | P1 = 4: the pieces the card will still load today, of 300 ([The paid list](#the-paid-list)): 300 less the day's count, or 300 where a day has passed since the day of loads began; zeros to a reader not told the history, which MUST NOT read them as a number (they do not say that none are left) |

Capability bits (byte 6), all set since 2.0: bit 0 secp256k1 key made on the card,
bit 1 BIP-340 signing, bit 2 a PIN, bit 3 the limit on one payment waits and does
not refuse, bit 4 several pieces to a `LOAD_PROOF` and `GET_PIECES` by name, bit 5
128 places, bit 6 a payment's places burned outside its transaction, bit 7 the PIN
taken sealed.

Profile bits (bytes 55 and 56, P1 = 4). Byte 55: bit 0 [PIN before money](#pin-before-money),
bit 1 the no-PIN window ([The clock and the limits](#the-clock-and-the-limits)),
bit 2 [the owner claimed slowly](#the-owner-claimed-slowly), bit 3 the wait on every
payment ([The clock and the limits](#the-clock-and-the-limits)), bit 4
[two units on one card](#two-units-on-one-card), bit 5
[a holder with no phone](#a-holder-with-no-phone), bit 6
[keyset keys](#keyset-keys), bit 7 [the paid list](#the-paid-list). Byte 56: bit 0
[the certificate](#the-certificate), bit 1 [keys per load](#keys-per-load); bits 2
to 7 are `0`. A 2.3 card from this repository answers `FF 03`. A card that answers less than 57 bytes to P1 = 4 keeps
none of them.

### GET_PUBKEY (0x10)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `10` |
| P1 | `00` |
| P2 | `00` |
| Le | `21` |

**Response:** the card's secp256k1 public key P, 33 bytes compressed. Every piece on
the card is locked (NUT-11) to the card's key for its date, P + t·G
([Keys per load](#keys-per-load)), never to P itself; a certificate and `AUTH` are
over P.

### GET_BALANCE (0x11)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `11` |
| P1 | `00`; `01` each unit |
| P2 | `00` |
| Le | `04`; `00` with P1 = 1 |

**Response:** P1 = `00` (any P1 but 1): 4 bytes, the sum of the unspent pieces of
the card's unit (`GET_CARD` byte 2), as it was before 2.3 on a card of one unit.
P1 = `01`: how many units the card holds (1: 0, 1 or 2), then for each, in the
order of their codes, its code (1: `00` sat, `01` usd), its pieces (1) and their
sum (4): 13 bytes at the most. A piece whose keyset is in no entry of the keyset
table is in no sum. A sum past four bytes wraps.

### GET_PROOF_COUNT (0x12)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `12` |
| P1 | `00` |
| P2 | `00` |
| Le | `01` |

**Response:** 1 byte, the number of slots that are not empty (unspent or spent).

### GET_PROOF (0x13)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `13` |
| P1 | slot (0–127) |
| P2 | `00` |
| Le | `52` |

**Response:** 82 bytes, the slot as the [Proof Slot Layout](#proof-slot-layout)
has it.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | Status: `00` empty, `01` unspent, `02` spent |
| 1 | 8 | Keyset ID: the NUT-02 id's first 8 bytes, raw (not ASCII) |
| 9 | 4 | Amount: uint32, big-endian |
| 13 | 32 | Nonce: the NUT-10 P2PK secret's nonce, raw (the card rebuilds the secret from it) |
| 45 | 33 | C: the mint's unblinded signature, a compressed point |
| 78 | 4 | Date: the piece's locktime, seconds; 0 for none |

`6A83` for a slot out of range; `6A88` for an empty slot, and for a spent one to a
reader that has given neither the PIN nor the owner's grant in this tap (a spent
piece is history: a till pays with the unspent ones). A spent slot whose
`CLEAR_SPENT` was cut short still answers the PIN or the grant, with some fields
zeroed: its bytes are not a proof.

### GET_SLOT_STATUS (0x14)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `14` |
| P1 | `00` |
| P2 | `00` |
| Le | `80` |

**Response:** 128 bytes, one status byte per slot.

### AUTH (0x15)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `15` |
| P1 | `00` |
| P2 | `00` |
| Lc | `10` |
| Data | 16 random bytes of the reader's |
| Le | `50` |

**Response:** 80 bytes: 16 random bytes of the card's, then a BIP-340 signature
(64) by the card key over

    SHA-256( T ‖ T ‖ reader (16) ‖ card (16) ‖ card key (33, compressed) ),  T = SHA-256("CashuCard/auth")

It proves the reader holds the card that has that key. No PIN, and nothing is
burned: the message is 129 bytes behind a tag, and no piece's secret (text
beginning `["P2PK"`) hashes to it. `6700` for any length but 16.

### GET_CARD (0x16)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `16` |
| P1 | `00`; `02` the keyset table; `03` the card's secret c, sealed |
| P2 | `00` |
| Lc | none; with P1 = `03` on a card with no refund key, `41` (65) |
| Data | none; with P1 = `03` on a card with no refund key, the reader's key for this one message, E (65, `04 ‖ X ‖ Y`) |
| Le | `00` |

**Response, P1 = `00`** (any P1 but 2 and 3): 109 bytes and the mint. To a reader
that has given neither the PIN nor the owner's grant in this tap, bytes 44 to 76 (the
last header's hash and the rolls), 78 (the arming) and 83 to 86 (the no-PIN window's
start) are zeros: they are the card's history ([D198](../docs/DECISIONS.md#d198)). The
length is the same.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | format, `04` or `05`, as `GET_INFO` byte 8 |
| 1 | 1 | record set |
| 2 | 1 | unit: `00` sat, `01` usd (amounts and limits in cents) |
| 3 | 4 | daily limit, in the card's unit |
| 7 | 33 | refund key, or zeros |
| 40 | 4 | the hardest header's `bits`, little-endian, as a header carries it; zeros until the card takes a header that is not weak; `SET_CARD`, a reset and a hand-over keep them ([D203](../docs/DECISIONS.md#d203)) |
| 44 | 32 | the hash of the last header taken, as Bitcoin shows a block hash |
| 76 | 1 | rolls: how often the day's window has rolled since the owner's last `REFRESH` |
| 77 | 1 | rollover budget: 1 to 30; `00` is the default, 7 |
| 78 | 1 | allowance armed: 1 when the next payment with no PIN may begin a new no-PIN window ([The clock and the limits](#the-clock-and-the-limits)) |
| 79 | 4 | zeros: the rate is kept here and answered as zeros (`GET_INFO` P1 = 3 says it to the holder) |
| 83 | 4 | the no-PIN window's start, as `GET_INFO` bytes 51 to 54; zeros where none runs, and to a reader not told it |
| 87 | 1 | no-PIN window switch: `00` the window of 24 hours, `01` none ([SET_LIMIT](#set_limit-0x34)'s eighteenth byte) |
| 88 | 17 | zeros |
| 105 | 1 | mint length |
| 106 | n | mint, as text (at most 77); `-` alone is a factory record |
| 106 + n | 3 | the card's design, three characters, or zeros |

These offsets are settled for 2.x: the card's record keeps, after the last
header's hash, the rolls, the budget and the arming (D20), the rate and the
no-PIN window's start and its switch (2.3), and 17 bytes nothing uses.

**Response, P1 = `02`:** the keyset table: a count (1), then each entry in use as
kept, in the table's order: the keyset's 8 bytes and its state (1)
([Two units on one card](#two-units-on-one-card)), 55 bytes at the most; `00`
alone on a card with no table. No PIN, any state.

**Response, P1 = `03`:** the card's secret c ([Keys per load](#keys-per-load)),
sealed, never in the clear, after `GET_NONCE` P1 = `01`, whose sixteen bytes it uses
up. Its form is the card's, by its record:

- **A card with a refund key R** (`GET_CARD` bytes 7 to 39 not zero): no data is
  read (send none). The card draws a fresh k and answers 97 bytes: K = k·G (65,
  `04 ‖ X ‖ Y`), then c XOR block 1 of the seal's sum, SHA-256(`CashuCard/seal` ‖ `01`
  ‖ the x of k·R (32) ‖ K (65) ‖ the sixteen bytes ‖ `16`). Only the holder of the
  refund key's private key r opens it: r·K = k·R. It is given at any tap to the
  holder's say: the owner's grant on an owned card, or on a card with no owner the
  PIN given in this tap. A phone restored from its words, or one that missed the
  set-up tap, reads c again so, as long as it has r; one whose card is lost works c
  out from its words, where the card took the owner's c ([SET_OWNER](#set_owner-0x43)).
- **A card with no refund key:** sealed as a PIN is ([VERIFY_PIN](#verify_pin-0x40)):
  `GET_NONCE` P1 = `01` gives the PIN key, checked by the card key's signature over
  it; the reader sends its key for this one message E (65), and the answer is 32
  bytes, c XOR block 1 of SHA-256(`CashuCard/seal` ‖ `01` ‖ the x E and the PIN key
  share (32) ‖ E (65) ‖ the sixteen bytes ‖ `16`), which the reader works out with
  its private half of E. It is given to the owner's grant in this tap, or on a card
  with no owner to the PIN given in its first set-up ([SET_PIN](#set_pin-0x41)) and in
  no later tap: such a card never gives c again until a reset. An owned card is in
  this form from a hand-over ([SET_OWNER](#set_owner-0x43)) until the new owner's
  `SET_CARD` names a refund key.

In order: `6982` without the holder's say as above; `6700` (no refund key) for data
not 65 bytes; `6985` with no sixteen bytes live; `6A80` (no refund key) for an E that
is not a point of the curve. The sixteen bytes are used up by an answer, by `6985`
and by `6A80`; `6982` and `6700` come before the card looks at them and leave them
live. What others get: a listener on the air gets K (or E) and c XOR a block it
cannot work out, which says nothing of c; a relay in the tap after the holder's PIN
or grant can ask its own `GET_NONCE` and `GET_CARD` P1 = 3, and gets one more sealed
answer it cannot open, unless it holds r (a card with a refund key) or ran the first
set-up itself (a card with none: whoever the PIN is typed into in that set-up can
read c). With c the holder's phone works out every date's keys, locks its loads to
them and refunds with them: it keeps c with r, since a refund needs both (r + u). A
`RESET_CARD` draws a new c; `SET_OWNER` takes the owner's c where it brings one
([D202](../docs/DECISIONS.md#d202)), and otherwise keeps the card's at a claim and
draws a new one when it replaces an owner: the phone reads c after any of them, and
checks the owner's c it gave.

### GET_PIECES (0x17)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `17` |
| P1 | the first slot to report (0–127) |
| P2 | `00` pages; `02` named slots; `03` the short listing |
| Le | `00` |

**Response.** P2 = `00`: one page, at most 255 bytes: the first slot the page does
not cover (1; 128 is the end), then for each slot in range that is not empty a tag
(1: the slot, with `0x80` where it is spent) and, for an unspent slot, its 81 bytes
after the status. A spent slot is listed only to a reader that has given the PIN or
the owner's grant in this tap; to any other it is not listed, as an empty one is not
([D198](../docs/DECISIONS.md#d198)). P2 = `02` with one to three slot numbers as
data: each slot whole (82), in the order asked; a spent slot, to a reader with
neither the PIN nor the grant, as an empty one (82 zeros), as `GET_PROOF` answers
it `6A88`; `6700` for no slot named or more than three, `6A83` for a slot past 127.

P2 = `03`, the short listing, for choosing pieces, at most 255 bytes, byte for byte:

| Bytes | Field |
|---|---|
| 1 | `next`: the first slot this answer does not cover; 128 (`80`) at the end |
| | then, for each unspent slot from P1 up to `next`, in order: |
| 1 | the tag: the slot's number, with `0x80` set where the keyset and the date follow |
| 8, 4 | the keyset and the date (big-endian), only where the tag has `0x80`: in the first entry of every answer, and in a later one only where they are not those of the entry before it |
| 1 | the size k: the slot is worth 2^k (`00` for 1, `03` for 8, `0A` for 1,024), or `FF` for any other amount, which follows |
| 4 | the amount (big-endian), only after `FF` |

Spent and empty slots have no entry (`GET_INFO` counts them). A reader that gets a
`next` under 128 asks again with P1 = `next`, and has the whole card when `next`
is 128. For example, slots 0, 1 and 2 holding 1, 8 and 3 of the keyset
`00c94d2f98795f16`, undated, answer `80` ‖ `80 00c94d2f98795f16 00000000 00` ‖
`01 03` ‖ `02 FF 00000003`. `FOXY-CARD-DAILY-LIMIT.md` 6d and 8.1 have the other
forms byte for byte. `6A83` for a P1 of 128 or more; `6A86` for another P2.

### GET_LOG (0x18)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `18` |
| P1 | `00` the log; `01` the receipts; `02` and `03` the same with their units |
| P2 | with P1 = 1 or 3, how many receipts back to begin |
| Le | `00` |

**Response.** P1 = `00`: 16 bytes of counts (taps, value signed for in the card's
unit, refusals, tampers), then up to eight tap entries of 20 bytes, newest first:
the clock (4), value signed for (4), pieces signed (1), refused (1), flags (1),
pieces put on (1), value put on (4), the time the reader told (`TELL_TIME`, 4). P1 = `01`:
the count of payments (4), then up to three receipts of 77 bytes, newest first:
the clock (4), the time told (4), the amount (4), the SHA-256 of the message
signed (32), the first output's blinded message (33). P1 = `02` is P1 = `00`'s
with the other unit's count of what was signed for, ever (4), after the four
counts, 180 bytes at the most. P1 = `03` is P1 = `01`'s with each receipt followed
by its payment's unit (`80` the card's, `A0` the other, `00` a receipt made
before the card kept its table), 78 bytes a receipt.

An entry is of one unit: a tap whose payment or load is of another unit than its
entry begins a new entry. Flags: bit 0 a run of refusals (three refusals over a
limit inside ten seconds of the card's clock; the clock moves only with block
headers, so refusals at taps with no header between them count as one run, and a
reader that moves the clock between its refusals is not marked: the mark is a note
for the holder and refuses nothing), bit 1 a payment waited
past the floor, bit 3 a payment signed with no PIN, bit 4 an opening of change
given up ([RESET_CARD](#reset_card-0x51)), bit 5 the other unit.

**Who reads it.** On a card with an owner: the log to the PIN given in this tap or
the owner's grant, the receipts to the grant alone (`6982` otherwise). On a card
with a PIN and no owner: both to the PIN given in this tap, held for
([A holder with no phone](#a-holder-with-no-phone)): `6985` in a time in the field
in which a payment was signed, before any asking is counted; `6A98`, keep holding,
to each of the first nine askings in a row; the history at the tenth, and open to
the PIN for the rest of that time in the field. On a card with no PIN, anyone: its
log is empty. `6A86` for a P1 over 3, which neither counts nor ends the count.

### GET_CHANGE (0x19)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `19` |
| P1 | page, from 0 |
| P2 | `00` |
| Le | `00` |

**Response:** a count (1), then up to three openings of 83 bytes, each the change
output of a payment the card made for itself (`SPEND_ALL_CHANGE`), signed for and
not yet back on the card (owed):

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | the opening's number, 0 to 7: `LOAD_CHANGE`'s P1 |
| 1 | 4 | amount |
| 5 | 8 | keyset |
| 13 | 4 | date, or 0 |
| 17 | 33 | the blinded message B_, compressed |
| 50 | 33 | K, the mint's key the opening is bound to, compressed |

Never the nonce or the blinding factor: only the card finishes its change
([LOAD_CHANGE](#load_change-0x27)). An opening whose piece is on the card already
is let go first. No PIN; it refuses nothing. A phone that missed the mint's answer
asks the mint for it by B_ (NUT-09 restore). 2.2 and earlier answered 80-byte
openings (the amount, the keyset, the date, the nonce and r).

### GET_DLEQ (0x1A)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `1A` |
| P1 | a slot (0–127) |
| P2 | a second slot, or `FF` |
| Le | `00` |

**Response:** for each slot asked, in order: `01` and the 96 bytes `e ‖ s ‖ r` of
the mint's NUT-12 proof kept with an unspent piece, or `00` (empty, spent, loaded
without one, or no room for proofs). At most 194 bytes. `6A83` for a slot out of
range. The card checks nothing here: the phone checks the proof with the mint's
keys. A piece of the card's own change, written by `LOAD_CHANGE`, has the proof
the card checked kept with it, its own blinding factor as `r`. Any reader holding the
card reads r, and C + r·K is the blind signature the mint issued: with the mint's
records it ties the swap that made the piece (the payment, for change; the holder's
top-up, for a load with its proof) to the card, for as long as the piece is on it
([Keys per load](#keys-per-load)).

### GET_OUTBOX (0x1B)

The record of the card's last SIG_ALL payment, as an assisted-settlement packet
(2.2, [D175](../docs/DECISIONS.md#d175)): everything a relay needs to submit that
payment's swap to the mint, and to restore its outputs, with nothing secret in
it. The packet format and the relay are the draft in
[cashucard/nut#6](https://github.com/cashucard/nut/pull/6); this section is the
card's side of it. Both are answered in the time in the field that signed the
payment, where the till that took it reads them. Otherwise the scope (P1 = `00`)
is answered to a reader that has given the PIN or the owner's grant in this tap
([D198](../docs/DECISIONS.md#d198)), and the packet itself (P1 = `01`) to the
holder's say (the owner's grant in this tap, or on a card with no owner the PIN in a
held tap, [A holder with no phone](#a-holder-with-no-phone)); to anyone else `6982`,
whether or not a record is kept, so that a reader not told cannot learn that one is. It says
only what the till that took the payment holds, and nothing in it can spend; but
to a stranger it would say where the card's holder last paid.
The record's room is reserved at the card's first `SET_CARD`, not at install
([D176](../docs/DECISIONS.md#d176)): a card not yet set up, or one that could not
reserve it, keeps no record and answers `6A88` (to a reader told; `6982` to anyone
else, as above), until a later `SET_CARD` reserves it.

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `1B` |
| P1 | `00` the scope; `01` a page |
| P2 | `00` |
| Lc | P1 = `00`: none. P1 = `01`: `03` |
| Data | P1 = `01`: the offset (2, big-endian) and a count (1, `01`–`FF`) |
| Le | `00` |

**Response, P1 = `00`:** the scope, 45 bytes: the index (1, `00`), the payment
id (8), the generation (4) and the SHA-256 of the packet's body (32). A relay
reads it before and after the pages and keeps the packet only if the two agree.

**Response, P1 = `01`:** `min(count, total - offset)` bytes of the packet (body
‖ descriptor) from the offset, where total is the body's length and 64. A relay
asks at offsets 0, 255, 510, … with a count of 255, and stops at the first page
shorter than 255 (or at `6A83`, when the packet is a whole number of pages). A
relay that decodes the packet as it reads stops as soon as the packet verifies,
and so never asks at an offset equal to total. A reader that does not decode
takes `6A83` at a whole-page offset, after a full page of 255 bytes, as the end
of the packet, never as a partial packet.

**The packet**, in this order (all numbers big-endian):

| Bytes | Field | From |
|---|---|---|
| 7 | `CCP-AS` and `01`, the format | |
| 33 | the payment's key, compressed: the card's key for the date 0, P + t·G ([Keys per load](#keys-per-load)); the packet's pieces are undated | `GROUP_KEYS` for the date 0 |
| 32 | the installation | 32 random bytes drawn when the applet is installed; kept through `RESET_CARD` |
| 8 | the payment id | 4 zero bytes and the receipt count (`GET_LOG` P1 = `01`), which this payment stepped |
| 1 | the index | `00` |
| 4 | the generation | 1 at install, one more at each `RESET_CARD` |
| 1 | the profile | `01` |
| 2 | the mint's length | the card record (`SET_CARD`) |
| n | the mint | the card record: `https://`, at most 77 bytes |
| 1 | the unit | the payment's: `00` sat, `01` usd |
| 1 | the inputs | how many, 1 to 32 |
| 83 each | an input | the place (1), the generation (4), the amount (4), `08`, the keyset (8), the nonce (32), C (33) |
| 1 | the outputs | how many, 1 to 16 |
| 46 each | an output | the amount (4), `08`, the keyset (8), B_ (33) |
| 64 | the witness | the payment's signature, as `SPEND_ALL_SIGN` gave it (and `SPEND_ALL_AGAIN` gives it again) |
| 64 | the descriptor | the BIP-340 signature of the key the packet names (the card's key for the date 0) over SHA-256(tag ‖ tag ‖ body), tag = SHA-256(`CashuCard/assisted-settlement/v1`) |

The installation is the 32 bytes at offset 40 of the first page (after the
format, 7, and the payment's key, 33). It is public, it is kept through `RESET_CARD`,
and no command returns it on its own: a relay reads it here and checks it
against the installation it expects for the card before it trusts the packet.

The body is everything before the descriptor. The inputs are in the order
`SPEND_ALL_BEGIN` named them; the outputs are the till's (`SPEND_ALL_OUTPUTS`)
and then the card's change (`SPEND_ALL_CHANGE`), in the order the message hashed
them. Each input's secret is the undated card proof secret (NUT-CCP), rebuilt from
its nonce and the key the packet names; the witness verifies over the NUT-11 SIG_ALL message
of those inputs and outputs. The reader's outputs carry the keyset
`SPEND_ALL_OUTPUTS` P1 = `01` named (2.3), or, where it named none, the first
input's 8-byte keyset as in 2.2: a reader that blinds an output for another keyset
and names none gets a packet the mint refuses. The card's own change carries its
opening's keyset, the one `SPEND_ALL_CHANGE` named. A mint that serves v2 keyset ids knows each keyset only by its 33-byte
id, so a relay sends the full id that the packet's 8 bytes begin, from the
mint's `/v1/keysets`, for the inputs and the outputs alike, and refuses a prefix
that begins more than one id there. The id names the same keyset, and the NUT-11
SIG_ALL message carries no keyset id, so the witness verifies either way.
Each input's generation is the card's. The payment id is unique only together
with the generation, since `RESET_CARD`, and `SET_PIN` replacing a forgotten PIN,
set the receipt count back to 0; each steps the generation first.

**When.** The record is written by `SPEND_ALL_SIGN`, after the payment's receipt,
for the payment that was signed. The old record is let go first, so that a
payment that leaves no record leaves none of the one before it either. A payment
refused or given up (any other command between its steps, `GET_OUTBOX` included)
writes nothing, and the record of the last payment stays as it was. The record goes
at `RESET_CARD`, at `SET_PIN` replacing a forgotten PIN, and when `SET_OWNER`
replaces an owner. No record is
left (`6A88`) for a payment of more than 32 pieces or more than 16 outputs, for
one with no outputs or an output of 0, for dated pieces (the packet has no field
for a locktime or a refund key), for a mint that does not begin with `https://`,
once the receipt count or the generation has reached `FFFFFFFF`, and for a payment
whose receipt the chip's transaction could not hold ([SPEND_ALL_SIGN](#spend_all_sign-0x24)),
since that payment did not step the receipt count. The payment is made and
answered in all of these as it would be without the record.

**Tears.** The record's status goes to 0 before the body is written and to 1, with
the body's length, in one transaction after it: a card pulled away in between has
no record, and never a mix of two. The descriptor is made at the first read of
either form, kept, and marked in a transaction of one byte; a read after a tear
signs it again. A tear between the receipt and the record leaves the payment made
with no record.

**Capacity and timing.** 3,688 bytes at the most (a 77-byte mint, 32 inputs and
16 outputs), in 15 pages; 494 for two inputs and two outputs with the mint
`https://mint.test`. The card keeps 4,329 bytes of persistent memory for it: the
installation (32) and the generation (4) from install, and the record (3,692) and
the outputs of the payment in hand and the keyset its reader named (601) from the first `SET_CARD`. `SPEND_ALL_SIGN` writes about 500 bytes
more for a payment of two pieces and two outputs, and 3.6 KB at the most; the
first read signs once (about as long as `AUTH`), and every later read only copies.

In this order: `6A86` for a P1 other than `00` or `01`, or a P2 other than `00`;
`6982` for P1 = `00` outside the time in the field that signed the payment and
without the PIN or the owner's grant, and for P1 = `01` outside it and without the
holder's say, asked before the record is looked at; `6A88` with no record; `6700` for data of any length but 3 with P1 = `01`, or a count of 0;
`6A83` for an offset at or past the packet's end. P1 = `00` receives nothing.

### CERT_READ (0x1C)

The certificate an issuer wrote for the card key ([The certificate](#the-certificate),
[D192](../docs/DECISIONS.md#d192)). Public: no PIN, any state.

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `1C` |
| P1 | `00`–`03` a page; `FF` the state |
| P2 | `00` |
| Le | `00` |

**Response, P1 = `FF`:** 4 bytes: `01` when a certificate is sealed, `00`
otherwise; the container's version (`01`), or `00`; the container's length (2).

**Response, P1 = `00` to `03`:** 256 bytes of the container from offset P1 × 256,
fewer for the last page. In order: `6A86` for another P1 or a P2 other than `00`;
`6A88` with no certificate sealed (the bytes of a write not yet sealed are never
served); `6A83` for a page at or past the container's end.

### GROUP_KEYS (0x1D)

The keys of one date's pieces ([Keys per load](#keys-per-load),
[D197](../docs/DECISIONS.md#d197)): what a loader that does not hold c locks a
load's pieces to. To a reader with the PIN given in this tap, or the owner's grant
(`6982` otherwise): a loader has the PIN in its tap ([PIN before money](#pin-before-money)),
and a till has its payment's t from `SPEND_ALL_BEGIN` and needs no other date's; the
keys of a date, held against the mint's list of the swaps it saw, would tie those
swaps to the card. It writes nothing of the card's state (the chip's key object
for the point addition is set, as at every payment), and a payment begun is given
up by it, as by any command between a payment's steps. A till still learns the keys
of every date with a piece on the card through `SPEND_ALL_BEGIN`, PIN or not
([Keys per load](#keys-per-load)).

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `1D` |
| P1 | `00` |
| P2 | `00` |
| Lc | `04` |
| Data | the date (4): a piece's locktime, seconds; `00000000` for an undated piece |
| Le | `62` |

**Response:** 98 bytes: t (32), the tweak; the card's key for the date, P + t·G
(33, compressed); the refund key for the date, R + u·G (33, compressed), or 33 zeros
on a card with no refund key and for the date 0 (an undated piece names no refund
key). In order: `6982`; `6700` for any length but 4. About two point additions of
the chip's (some 0.2 s).

A wallet that loads a card it set up checks, before each top-up, that `GROUP_KEYS`
of the date it is about to use answers the P + t·G and R + u·G it works out itself
from the P, R and c it keeps: a card reset and set up again since (with a new c, and
perhaps another refund key) answers other keys.

### INBOX (0x1E)

Where money waits for the card ([D199](../docs/DECISIONS.md#d199)): a name that the
owner works out from c and that a till reads from the card, so that a till can find
what was sent to the card before the holder gives it the PIN. To anyone, with no PIN
and no grant, on a card that is not locked. The week is the card's own clock's: W =
floor(time / 604800), the time of the last block header the card took
([The clock and the limits](#the-clock-and-the-limits)). The command's data is not
read, and no week is asked for.

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `1E` |
| P1 | `00` |
| P2 | `00` |
| Data | none |
| Le | `24` |

**Response:** 36 bytes: SHA-256("CashuCard/inbox" ‖ c ‖ W) (32), then W (4,
big-endian). In order: `6B00` for a P1 or P2 other than `00`; `6986` on a locked card
(as every command a lock stops: the lock is the owner's word that the card is out of
the holder's hands, and a locked card takes no load, so nothing that waits could go
onto it); `6A8C` on a card with no holder's record (out of its packet, after a reset,
or with a factory record: no holder has its c, and it takes no piece); `6985` on a
card whose clock has taken no header. It answers whatever else the record holds: a
card with no refund key, and a card with no owner, answer it too (who may file for
them is below). It writes nothing, counts nothing and answers nothing else of c and
no history; a payment begun is given up by it, as by any
command between a payment's steps. The week is worked out by the same steps for every
time.

**The newest header last, each week's on the way.** The card answers the week of its
own clock, which is the time of the last header any reader gave it, and no reader's
header moves the clock back. A till (or a phone) that looks for waiting money reads `INBOX` for
every week from the later of the card's own week (`INBOX` before any header) and the
week two weeks before now, up to this week: it gives the card a real header of each
week in order (`SET_HEADER`) and reads `INBOX` after each, so that money filed in the
week before, or at a week's edge (a block's time runs up to about two hours ahead of
a clock, and an hour or more behind), is found; and last it gives the card the newest
header it has. Two weeks cover the 14-day hold with pickup closing at day 7 (below).

**Which weeks a holder can read.** Anyone holding the card can move its clock forward
with real block headers, which are free, so a holder can read the name of every week
from the card's last header up to now, one header at a time. Never a week ahead of
real time: the network takes no block whose time is more than about two hours ahead,
so no real header carries a later week. The one exception is a header made for a time
far ahead at the floor's work, a quarter of a block's, which moves the clock there
until it is brought back (below). The clock moves back only as
[SET_HEADER](#set_header-0x36) lists: from a weak clock, to an older header that is
not weak (the owner's `REFRESH` or the holder's); to any older header that is not
weak, in the owner's back form of `REFRESH`; to the anchor of an empty card's reset
or hand-over; and to the first set-up's anchor of an empty card, a claim's or
`SET_HEADER`'s ([D200](../docs/DECISIONS.md#d200), [D201](../docs/DECISIONS.md#d201),
[D204](../docs/DECISIONS.md#d204)).
A hand-over and a reset give the card a new c (the next owner's, or one drawn), and the
names change with it.

**What waits under the name MUST be locked to the card, dated, with its refund
key.** The name is only an address: whoever has it can find what waits, so knowing it
must never be enough to take it, and money the card never collects must come back to
the owner. Ecash that waits under a card's name MUST be:

- dated, never undated (never the date 0), and locked (NUT-11) to the card's key for
  its date D, P + t·G, with the card's refund key for D, R + u·G, which the owner
  works out from P, R and c ([Keys per load](#keys-per-load)); never to P alone, and
  never to a key the keeper of the name or a till holds;
- of a date D 14 days after the time it is filed (the card's usual date), never
  less. The owner's phone gives no later date, and D is never moved at pickup:
  pickup stays open until 7 days before D, and a till reads back only two weeks.
  A filing's D is its own: never the date the owner's wallet shares among the
  week's top-ups ([Keys per load](#keys-per-load)), which lies further ahead;
- the card's exact proof secret (NUT-CCP's
  [card proofs](https://github.com/cashucard/nut/blob/main/CCP.md#card-proofs)): the
  serialization, the tags and their order (`locktime`, `refund`, then `sigflag`
  `SIG_ALL`) as the card rebuilds them from the nonce, the date and the date's keys.

Only the card's owner's phone, which keeps c and the refund key's r, files under the
name. A till never files, and nor does anyone else who has the name. The owner files
each piece under the name of every week its pickup window touches, the week it files
it in and the week of its day 7, 7 days before D (two at most), so that a reader that moved the card's
clock on without reading `INBOX` hides nothing; a piece found under two names is
loaded once (the card refuses a nonce it holds, `6A94`).

**Which cards.** The card answers `INBOX` whatever its record holds. A phone MUST NOT
file for a card with no owner (`GET_INFO` byte 16 is `00`: no one keeps c and r for
it) or with no refund key (`GET_CARD` bytes 7 to 39 are zeros), and reads both before
it files. A card with no refund key takes only undated pieces (`6A8E`), and an
undated piece filed for it would be lost if the card were lost, reset or handed over
before a till picked it up. The holder of either loads in person.

**At pickup.** A till finds what waits, and the money goes onto the card only by a load
with the PIN (`LOAD_PROOF`), as any load. Before it gives `LOAD_PROOF`'s P2 bit 1 (its
word that it locked the pieces to the card's keys: here it did not lock them, so it
checks them), a till or phone MUST, for each waiting piece:

- read the keys of the piece's date from the card (`GROUP_KEYS`, under the PIN given in
  the tap), rebuild the piece's secret from them and the piece's nonce, and check that
  it equals the filed secret byte for byte;
- check that the piece's keyset is a keyset of the mint `GET_CARD` names, in the
  card's unit, as that mint publishes its keysets (NUT-02), and that the piece's DLEQ
  proof (NUT-12) verifies under that mint's key for the keyset and the amount: never
  under a key the filed token, the keeper or another mint names. `LOAD_PROOF` keeps
  8 bytes of the keyset and checks no mint's proof, and under the PIN it gives a new
  keyset a free entry of the keyset table: a piece of another mint would load, show
  in the balance, and burn the real pieces paid with it when the mint refuses the
  swap;
- check, by its own time, that at least 7 days are left before D: pickup closes 7
  days before the date, so that the holder's wallet can move the pieces to a new date
  before the refund opens ([Keys per load](#keys-per-load));
- where it is online, ask that mint the piece's state (NUT-07), and refuse a piece
  the mint does not answer `UNSPENT` for;
- run a loader's checks ([Keys per load](#keys-per-load), "Swap no more than the
  card will take" and "Check that the card will take this mint's pieces"): no more
  pieces than the card's free places less up to 8 left free for its change, and
  than it will still load today (`GET_INFO` P1 = `04` bytes 57 and 58, of 300); no
  piece above the day's limit; and room in the keyset table for the keyset;

and refuse the piece otherwise: it loads nothing of it, and the piece stays where it
waits, for a later pickup or until it comes back to the owner after D. A keeper that
hands out such ecash to anyone who names the inbox hands out nothing anyone else can
spend.

**What the owner is told.** At the mint a piece on the card and a piece still waiting
both read `UNSPENT`. So a till that loads waiting pieces SHOULD leave the owner a
pickup proof where it found them, at a random moment 20 seconds to 5 minutes after the
tap (so its time does not mark the tap). Byte for byte:

    m      = SHA-256("CashuCard/pickup" ‖ n1 ‖ … ‖ nk ‖ rand16)[0..15]
    AUTH   = the card's AUTH answer (80 bytes) to m, in the tap that loaded them
    proof  = k (1) ‖ n1 ‖ … ‖ nk (32 each, in the order loaded) ‖ rand16 (16) ‖ AUTH (80)

where n1 … nk are the loaded pieces' nonces (32 bytes each, as in their secrets) and
rand16 16 random bytes of the till's. The owner rebuilds m, checks AUTH's signature
under P ([AUTH](#auth-0x15)) and that its 16 reader bytes are m
([spec/vectors/pickup.json](vectors/pickup.json)). It shows only that the card was in
the till's field at a tap after the till had chosen those nonces: `AUTH` answers any
reader, with no PIN, over any 16 bytes, so a pickup proof never shows that anything
was loaded. The owner learns what is on the card from the card (`GET_PROOF` lists the
nonces), and the proof only tells its phone where to look.

**After pickup, and after D.** A picked-up piece reaches the card with 7 to 14 days
left before D, and the card does not read dates. The owner's phone moves picked-up
pieces to a new date at its next tap with the card, ending the move before D less a
day ("Before D", [Keys per load](#keys-per-load)); the pieces are not given a new date at pickup. Every reader,
online or not, leaves out of a payment a dated piece whose D is less than a day after
its own time, so from a day before D by any reader's clock the card pays no piece of
that date. The owner keeps a day's margin on its side too: a day after D (D + 86,400
by the network's tip its phone has checked, never by its own clock alone) the owner
MAY take back by the refund key every piece of that date, picked up or not, once its
phone has read the card at a tap after that (and shown its holder which of them were
on it), or at once where the card is lost. The two days cover a reader's clock slow
and the owner's fast ([D203](../docs/DECISIONS.md#d203)): a piece taken back that a
reader still pays makes the mint refuse the whole payment, after the card has burned
every piece in it. A piece taken back while it is on the card is one the card
still shows and no reader pays: an online reader finds it `SPENT` at the mint
(NUT-07). The owner's phone frees its place at its next tap, by a payment of that
piece which it does not take to the mint.

**What is lost, and what is not.** A card lost, broken, reset or handed over before a
till picks up what waits for it strands nothing. The pieces stay locked to the card's
date key: after a reset or a hand-over (each gives the card a new c) no card signs with it
again, and a lost card signs for them only once they are loaded onto it with its PIN.
So no one else can take them before D: not the keeper, not a till. After D
they come back to the refund key, which the owner spends with r + u, u worked out from
the c the pieces were filed under; so the owner keeps that c with r until every piece
filed under it is picked up or taken back. The same holds for a piece no till picks
up before its pickup closes. What the owner loses is the time until D, not the money.

**What it tells.** To whoever holds the card: the name of the week of the card's
clock, so whether money waits for the card that week and how much, and, by walking
the clock, the same of each week since the card's last header. To whoever keeps what
waits under a name: that the card was sent something that week, and, from any till
that shows it the name, that the name is the card's, tied to the card's key P, which
any reader reads (`GET_PUBKEY`). Nothing of the history, and nothing from which c, a
date's keys or a week's name the card has not answered could be worked out.

**A header far ahead.** A header with a time far in the future moves the clock there:
from then on the card answers that week, and tills find nothing under its names
([D199](../docs/DECISIONS.md#d199)), until the clock is brought back: by `REFRESH` where
the header was weak, by the owner's back form of `REFRESH` where it was not, or by the
anchor of an empty card's reset or hand-over ([A header far ahead](#set_header-0x36)).
Nothing waiting is lost by it: no till picks it up, and it comes back to the owner by
the refund key after D, as above. The owner reads the card's week back (W, the
answer's last four bytes) at its own tap.

---

<a id="category-0x2x--spend-one-signature-for-a-payment-nut-11-sig_all"></a>

## Category 0x2x: Spend (one signature for a payment: NUT-11 SIG_ALL)

A payment is `SPEND_ALL_BEGIN`, the swap's outputs (`SPEND_ALL_OUTPUTS`), the
card's own change (`SPEND_ALL_CHANGE`, any number up to the openings free), then
`SPEND_ALL_SIGN`. Any other command in between gives the payment up. The one
signature is over the NUT-11 `SIG_ALL` message: every piece's secret and `C`,
then every output's amount and blinded message, in order. Every piece on a 2.0
card is a format-4 P2PK secret locked to the card's key for its date with
`["sigflag","SIG_ALL"]` (NUT-CCP's [card proof](https://github.com/cashucard/nut/blob/main/CCP.md#card-proofs) secret; on 2.3 the key and the
refund key are those of the piece's date, [Keys per load](#keys-per-load)), and a
payment is of one date, so every input has the same key and the mint takes this one
signature, by that key, for all of them. The card's change comes back later, by any reader, with `LOAD_CHANGE`.

Every command `22` to `26` answers `6A97` on a card with no PIN, and `6985` in a
time in the field in which an owner was claimed or a card with no owner's history
was read, before anything else ([PIN before money](#pin-before-money),
[The owner claimed slowly](#the-owner-claimed-slowly),
[A holder with no phone](#a-holder-with-no-phone)).

### SPEND_ALL_BEGIN (0x22)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `22` |
| P1 | `02`, or `03` from a reader that reads units: bit 1 (`02`), the reader builds the secrets with the keys per load, on every payment; bit 0 (`01`), it reads units |
| P2 | `00` |
| Lc | the number of slots, 1–128 |
| Data | the slots, a byte each, in the order their pieces go into the message |
| Le | `45` |

**Response:** 69 bytes: what the pieces are worth together (4); t, the tweak of the
payment's date (32); and the refund key for that date, R + u·G (33, compressed;
zeros on a card with no refund key, and for an undated payment, whose secrets name
no refund key) ([Keys per load](#keys-per-load)). A reader works out the card's key
for the payment, P + t·G, from the key it read (`GET_PUBKEY`, checked against a
certificate where it wants one), and builds each piece's secret with it and, for a
dated piece, R + u·G. In order: `6A97`,
`6985` as above; `6A86` where P1 has not bit 1 (`02`), before a place is read and
with nothing written: a reader that does not say it builds the secrets with the keys
per load would build them with the card key, which no piece is locked to, so the card
burns no piece for a swap no mint takes (the other bits of P1 are not read); `6700` for none; `6A96` for more than 128; for each slot `6A83`,
`6A88`, `6985` out of range, empty or spent, `6A80` named twice or of another date
than the first, then `6A9A` where its keyset is of another unit than
the first slot's or in no entry of the keyset table (nothing hashed, no payment
begun), and `6A9B` where the first slot's unit is the other unit than the card's
and P1 has not bit 0 (`01`): a payment in the card's other unit is begun only for a reader
that says it reads units, so that software that reads none never pays cents as
sats; then, for a sum that wraps past four bytes only, `6A94` with a PIN set
and not given, or `6A8F` where a daily limit is set. Any opening of change drafted
for a payment never signed is let go. Two keysets of one unit pay together; the
card never chooses a unit: the payment's is the one of the places named.

`SPEND_ALL_BEGIN` answers before any PIN or allowance is asked (those are
`SPEND_ALL_SIGN`'s), because a till needs t to check the pieces' proofs before it
asks for the PIN. So any reader holding the card learns, for each date with a piece
on the card, that date's t and R + u·G, and so the card's key for that date, with no
PIN and no grant, and gives the payment up unsigned: nothing is burned or written.
With the mint's records it ties every spend of those dates to the card.

The PIN goes before `SPEND_ALL_BEGIN`. Any other command between `SPEND_ALL_BEGIN`
and `SPEND_ALL_SIGN`, `VERIFY_PIN` among them, gives the payment up: a till that
checks the proofs first and then asks the holder for the PIN sends `VERIFY_PIN` and
begins the payment again (the same places answer the same t). A `SPEND_ALL_SIGN`
after a payment was given up answers `6985`, no payment begun, and nothing is spent;
it is not the `6985` of a spent place.

### SPEND_ALL_OUTPUTS (0x23)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `23` |
| P1 | `00`, or `01`: the keyset the outputs are in comes first |
| P2 | `00` |
| Lc | a multiple of 37, and 8 more with P1 = `01` |
| Data | [with P1 = `01`: the keyset (8)] ‖ for each output: amount (4) ‖ blinded message B_ (33) |

Hashed into the message as they come (the amount in decimal, then B_ in hex). The
keyset of P1 = `01` is not in the message (NUT-11's `SIG_ALL` names no output's
keyset): it goes into the payment's record ([GET_OUTBOX](#get_outbox-0x1b)) as the
keyset of every output of the reader's, where 2.2 put the first slot's. A reader
names the keyset it posts its outputs under, the mint's active one. The outputs and
the card's own change together never come to more than the pieces: an output that
would take them past is `6A80`, among the waits of `SIGN` as before them, and the
payment is given up.

**Fees.** The card does not know the mint's fees and checks none. At a keyset with an
input fee ([NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md)
`input_fee_ppk`), the mint takes the swap only when the outputs and the change come
to the pieces' total less the fee, ceil(the sum of each input's `input_fee_ppk` /
1000): the reader works the fee out from the mint's keysets and makes them come to
exactly that. The card burns the pieces when it signs, whatever the outputs come to,
and a swap the mint refuses for its amounts cannot be undone on the card: an undated
piece so burned is lost, since only the card could sign for it, a dated one comes
back to the refund key after its date, and the payment's change stays owed until
the holder lets it go ([RESET_CARD](#reset_card-0x51)). `6985` with no payment begun; `6985` after the card's own
change (`SPEND_ALL_CHANGE`: the reader's outputs come first), the payment given up;
`6700` for a length not a multiple of 37 (after the keyset), and the payment is
dropped.

### SPEND_ALL_CHANGE (0x26)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `26` |
| P1 | `00` |
| P2 | `00` |
| Lc | `2D` (45) |
| Data | the change amount (4) ‖ K, the mint's key for that amount (33, compressed) ‖ the keyset the change is signed in (8) |
| Le | `21` |

**Response:** 33 bytes, the blinded message of a change output the card makes for
itself: a fresh nonce, the secret in the card's own form (its key, the payment's
date and refund key, `SIG_ALL`), hashed to the curve as NUT-00 says and blinded
with a fresh r. The card keeps the opening (the amount, the keyset, the date, the
nonce, r, B_) and binds it to K ([GET_CHANGE](#get_change-0x19),
[LOAD_CHANGE](#load_change-0x27)). The keyset is the one named, which the mint
signs the change in: one the card holds in its keyset table (a piece of it, or an
opening that names it, keeps it there) and whose keys it has been taught
([KEYSET_KEYS](#keyset_keys-0x38)), of the payment's unit. Nothing is entered in
the table here. A reader names the mint's active keyset of the unit and posts the
change output under it; NUT-02's outputs must be in an active keyset, and the
`SIG_ALL` message does not name an output's keyset, so the card cannot hold the
swap to it. Where the mint signs the change in another keyset of the unit after
all, the holder moves the opening there ([KEYSET_KEYS](#keyset_keys-0x38) P1 = 3).

A payment makes up to eight change outputs, one `SPEND_ALL_CHANGE` each, as many as
the card has openings free: eight in all, those still owed by earlier payments among
them ([D195](../docs/DECISIONS.md#d195)). Each is a hash to the curve and a blinding,
about two thirds of a signature's work on the chip, which the floor counts
([The clock and the limits](#the-clock-and-the-limits)). A reader may make fewer, four
say, and take the rest of the change in a later payment.

The day's limit counts the pieces whole, this change with them, until the change
is back on the card ([LOAD_CHANGE](#load_change-0x27)); the no-PIN allowance counts
the whole of the pieces; the wait is held to what leaves the card, the pieces less
this change ([The clock and the limits](#the-clock-and-the-limits)). In order:
`6A97`, `6985` as `SPEND_ALL_BEGIN`; `6985` with no payment begun; `6700` for any
length but 45; `6A80` for an amount of 0, for change that with the outputs and the
change before it would come to more than the pieces, or for a K that is not a
compressed point of the curve (`02` or `03`, and an x under p that has a point);
`6A84` with no opening free, or on a card that has no keyset table or no room for
the openings' keys; `6A9F` for a keyset in no entry of the table or whose keys the
card has not been taught; `6A9B` for one of the other unit than the payment's;
`6A8F` for change the day of loads has no room for, with the change before it in
this payment (300 pieces a day, [The paid list](#the-paid-list)): change is counted
when the payment is signed and its `LOAD_CHANGE` is never refused for the count
([D200](../docs/DECISIONS.md#d200)), so the card makes none it could not take back;
`6F00` if the chip's arithmetic fails. Every refusal but the first three gives the
payment up. A reader that meets `6A8F` here begins the payment again with pieces that
need no change, or no more change outputs than the card made before the refusal; or
the holder pays after the day of loads has turned. The `6A8F` comes before any PIN is
asked, so it tells a stranger how many loads are left today where fewer than 8 are
([D198](../docs/DECISIONS.md#d198)); `GET_INFO` tells it nothing more. 2.2 took the amount alone (4 bytes) and 2.3's first form 37 bytes with
no keyset; a 2.3 card answers both `6700`.

### SPEND_ALL_SIGN (0x24)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `24` |
| P1 | `00` |
| P2 | `00` |
| Le | `40` |

**Response:** the 64-byte BIP-340 signature over the whole payment; every slot named
is burned, the counts charged, the openings of change made owed and the log
written in the same commit. Until the payment has waited, the card answers `00 01`
("not yet") and the reader sends `SIGN` again: every payment waits a floor, and
one over the limit on one payment, or a second payment in a time in the field,
waits longer ([The clock and the limits](#the-clock-and-the-limits)). The wait is
the card's own work and burns nothing, and the card never says how many answers
are to come.

At the first `SIGN`, in order: `6A97`, `6985` as `SPEND_ALL_BEGIN`; `6985` with no
payment begun; `6A99` for a payment in the other unit than the card's, on a card
with any limit set and no rate (the payment given up, nothing written); `6A94`
with a PIN set and not given in this tap, and an allowance of 0 or a blocked PIN
(the payment given up, nothing written in the log); `6A9E` with a PIN set and not
given, where the no-PIN window's count and the whole of this payment's pieces
would pass the allowance (the payment given up, and the refusal written in the
log); `6A8F` where the day's count and the whole of this payment's pieces, its
change with them, would pass the day's limit (given up, written in the log). At
the last, `6A8F` where the day of loads has no room for the payment's change, which
`SPEND_ALL_CHANGE` refuses first (given up, nothing written); `6A96` if the commit
cannot hold it, with nothing changed. The change the payment makes is counted in the
day of loads in the commit, with the openings it makes owed
([D200](../docs/DECISIONS.md#d200)): a day over begins again at `now`, as at a load;
a payment with no change leaves the day of loads as it is. A payment in the other
unit is turned into the card's unit at the rate for every limit, rounded up.

The commit keeps, beside the signature, what left the card and the hash of the
message signed ([D196](../docs/DECISIONS.md#d196)). The payment's receipt and the
signature kept for `SPEND_ALL_AGAIN` P1 = `01` are written from them after the
places are marked, in the transaction that ends the payment's note, before the
answer; a card that leaves the field after the commit has them written by its next
command, before anything reads a place. Such a receipt has zeros where the till's
output and the time the terminal told were. A receipt the chip's transaction cannot
hold is given up, and the note that it is owed taken down alone: the payment stands
(its pieces spent and on the paid list), the till has its signature in the answer,
or from `SPEND_ALL_AGAIN` P1 = `00` while no later payment is signed, and that one
payment has no receipt, no kept signature (`SPEND_ALL_AGAIN` P1 = `01` answers
`6A88` for its hash) and no settlement record (`GET_OUTBOX` answers `6A88` until a
later payment's): the record's payment id is the receipt count, which that payment
did not step. The card works on.

### SPEND_ALL_AGAIN (0x25)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `25` |
| P1 | `00`, or `01` |
| P2 | `00` |
| Lc | none, or `20` with P1 = `01` |
| Data | with P1 = `01`: SHA-256 of the payment's `SIG_ALL` message (32) |
| Le | `40` |

**Response:** the last signature `SPEND_ALL_SIGN` gave, again, for an answer lost
on the air. With P1 = `01`, the signature of the payment whose message hashes to
the 32 bytes given: the card keeps one beside each of the sixteen receipts it
keeps (the same SHA-256 is the receipt's, [GET_LOG](#get_log-0x18)), so a till
whose answer was lost and a later payment made somewhere else still gets its own,
and asks for it by the one thing it holds, its swap. The PIN given in this tap,
unless that signature was given with no PIN (`6982`). With P1 = `01` and the PIN not
given in this tap (on a card that has one), the card looks only among the signatures
given with no PIN, and answers `6A88` for every other hash, the card's own payments
under the PIN and 32 zeros among them: a reader without the PIN, holding a list of
swaps, learns of none paid under the PIN that it is the card's
([D198](../docs/DECISIONS.md#d198)); a till whose payment was under the PIN asks for
it again with the PIN. It does learn the card's no-PIN payments among the last
sixteen: each of their hashes answers `9000`, so a stranger holding the card picks
them out of the mint's list. In order: `6A97`, `6985` as `SPEND_ALL_BEGIN`; then
with P1 = `00`, `6982` for the PIN not given where the last signature wants it (a
card with a PIN set that has never signed among them), then `6A88` if the card has
never signed (with the PIN given, or no PIN set); with P1 = `01`, `6700` for data
not 32 bytes, then `6A88` where no kept receipt the reader may ask for has that
message. A signature goes with
its receipt: the seventeenth payment back has none, and `RESET_CARD` and a
forgotten PIN replaced ([SET_PIN](#set_pin-0x41)) let them all go. A payment is
kept from its commit ([SPEND_ALL_SIGN](#spend_all_sign-0x24)), so P1 = `01` finds it
after any pull. **A till asks at once:** any sixteen payments after its own push
its signature out of the ring, a stranger's under the no-PIN allowance among them.

### LOAD_CHANGE (0x27)

One opening of the card's own change made into the piece it was for
([D183](../docs/DECISIONS.md#d183); NUT-CCP's
[LOAD_CHANGE](https://github.com/cashucard/nut/blob/main/CCP.md#load_change)).
The data is the mint's answer for the opening's B_.

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `27` |
| P1 | the opening's number (0–7), as `GET_CHANGE` gives it |
| P2 | `02`: bit 1, the reader's word on keys per load, as `LOAD_PROOF` takes it; the other bits are not read |
| Lc | `C2` (194) |
| Data | C_ (65, `04 ‖ x ‖ y`) ‖ K, the mint's key for the opening's amount (65, the same form) ‖ e (32) ‖ s (32) |
| Le | `53` |

**Response:** 83 bytes: the slot the piece went into (1), `01` where the mint's
proof was kept with it or `00` where the card has no room for proofs (1), and the
piece as `GET_PROOF` gives it after its status byte (81).

The card checks K against the key the opening is bound to (its x and its y's
parity) before any arithmetic; checks that C_ and K are points on the curve;
checks the mint's NUT-12 proof against K and its own B_ (`R1 = s·G − e·K`,
`R2 = s·B_ − e·C_`, and e the SHA-256 of R1, R2, K and C_, each uncompressed, as
lowercase hex text); takes off its own blinding factor (`C = C_ − r·K`); and writes
the piece as `LOAD_PROOF` writes one (the opening's keyset, amount, nonce and date,
and that C), with e, s and r kept as its proof. Its status byte, the opening let go
and the day's count given back are one transaction ([D196](../docs/DECISIONS.md#d196));
then the log has the piece put on. Nothing is written before the piece. The day's
count gives the change back (it was counted with the payment's pieces at `SIGN`), to
no less than nothing, only where the day's window that counted it is the one that
runs: change from an earlier day, or made before a day's limit was set or changed,
gives nothing back. Change of the other unit than the card's stays counted until
the day ends. The card's own change is never refused for the day's limit: it is of
a payment whose pieces the day held whole. Nor for the day's 300 pieces: the
payment counted it in the day of loads when it was signed
([D200](../docs/DECISIONS.md#d200)), and it counts nothing more here.

**Who may:** any reader, with no PIN, in any tap, on a locked card and on a card
whose PIN is blocked as well, under the bound key: receiving what it is owed
changes no setting. No tap is the tap after a payment: the change of an earlier
payment goes on as well as the last's. With the keyset keys profile, the bound key
must first be shown to be one of its keyset's keys
([KEYSET_KEYS](#keyset_keys-0x38) P1 = 3); a holder who must bind an opening to
another key does it there.

In order: `6A97` with no PIN set; `6A86` without P2 bit 1, before anything is read;
`6A83` for a P1 past 7; `6A88` for an opening
not owed; `6A94` for one whose piece is on the card already (the opening is let
go); `6A84` with no slot free; `6700` for any length but 194; `6A9F` where the
opening's key has not been shown to be one of its keyset's keys; `6A80` for a K
not in the `04` form or not the bound key, a point not on the curve, or a proof
that does not hold.

The card cannot tell by itself that K is the mint's key. An opening bound to a key
that is not the mint's stays owed; the holder binds it to the mint's key
([KEYSET_KEYS](#keyset_keys-0x38)) or gives it up ([RESET_CARD](#reset_card-0x51)
P1 = 1).

---

<a id="category-0x3x--write"></a>

## Category 0x3x: Write

Every command here that writes answers `6986` on a locked card, but for
`SET_HEADER`, `TELL_TIME` and `KEYSET_KEYS`: a locked card still takes headers,
and still learns the keys its own change comes back under.

### LOAD_PROOF (0x30)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `30` |
| P1 | `00`; `01` with the mint's proof |
| P2 | `02`; `03` with the pieces' unit first: bit 1, the reader's word on keys per load; bit 0, the unit first |
| Lc | `51` (81), or 162 or 243 for two or three pieces; `B1` (177) with P1 = 1; one more with P2 bit 0 |
| Data | with P2 bit 0, the unit (1), then: for each piece: keyset_id (8) ‖ amount (4) ‖ nonce (32) ‖ C (33) ‖ date (4); with P1 = 1, one piece then e ‖ s ‖ r (96) |
| Le | `01` per piece; `02` with P1 = 1 |

| Field | Size | |
|---|---|---|
| keyset_id | 8 | the NUT-02 id's first 8 bytes, raw |
| amount | 4 | uint32 |
| nonce | 32 | the P2PK secret's nonce |
| C | 33 | compressed point |
| date | 4 | locktime, seconds, or 0 |

**Response:** the slot of each piece stored; with P1 = 1, the slot and `01` where
the proof was kept (`00` with no room for proofs).

**P2 bit 1 (`02`), the reader's word on keys per load** ([D197](../docs/DECISIONS.md#d197)):
the loader says each piece is locked to the card's keys for its date, P + t·G and
R + u·G ([Keys per load](#keys-per-load)), the only keys the card signs with. Without
it the card answers `6A86` before the data is read, with nothing written: a loader
that locked a piece to the card key alone would leave a piece no payment could spend
(and an undated one with no refund either). The card cannot check the lock itself;
the word is what it can check.

Needs a PIN set and given in this tap, on a card with an owner or none ([PIN
before money](#pin-before-money)); nothing else opens it: not the owner's grant
and not the tap after a payment (the card's own change comes back by
`LOAD_CHANGE`). In order: `6986` locked; `6A97` with no PIN; `6982` with the PIN
not given in this tap; `6A8C` with no record, or a factory record; `6A84` with no
slot free; `6B00` for a P2 with a bit other than its two; `6A86` without P2 bit 1;
`6700` for a bad length; `6A80` for
a unit over `01`, and `6A9C` for a label of the other unit on a card with no
keyset table; `6A99` once, for pieces of the other unit than the card's on a card
with a limit set and no rate; then for each piece: `6A84` no slot left or no paid
list ([The paid list](#the-paid-list)), `6A8E` a dated piece on a card with no
refund key, `6A80` a C that is not a point of the curve (`02` or `03` and an x under p for which x^3 + 7 is a square, checked by the card itself), an amount of 0 or a proof of 96 zeros,
`6A9B` a keyset in the table as the other unit, `6A9D` a new keyset of the other
unit that is not the last payment's, without the holder's say in this tap, `6A9C`
no entry free for a new keyset, `6A94` a nonce already in any slot, spent or
not, or on the paid list ([The paid list](#the-paid-list)), `6A8F` a piece above
the day's limit where one is set ([D196](../docs/DECISIONS.md#d196): the day holds
a payment's pieces whole, so such a piece could never be paid; its amount in the
card's unit, a piece of the other unit turned at the rate and rounded up), and last
`6A8F`, past the day's 300 pieces ([The paid list](#the-paid-list)), before
anything is written. A piece above the limit on one payment goes on: it is paid
with the wait. A wallet splits a top-up into pieces no larger than the day's limit,
or the card's owner lifts the limit first. Several pieces are taken in order, each as one alone would
be: if a later one cannot be stored the answer is the slots of those before it.
The status byte is written last ([D14](../docs/DECISIONS.md#d14)). With P2 bit 0 clear
the pieces are of the card's unit.

`6A8F` at a load means one of two things, which the reader tells apart by the piece:
a piece above the day's limit (it is never taken; the holder's wallet splits pieces
to no more than the day's limit before it swaps them, since a piece already locked to
the card cannot be split by anyone but the mint), or the day's 300 pieces used, the
change of the day's payments among them (it is taken tomorrow). A loader that holds only the PIN on a card with an owner cannot read
the rate (`GET_INFO` P1 = 3, the holder's), so it cannot size pieces of the other
unit against the limit: it loads the card's unit.

### CLEAR_SPENT (0x31)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `31` |
| P1 | `00` |
| P2 | `00` |
| Le | `01` |

**Response:** 1 byte, the number of slots freed. Every spent slot's data is zeroed,
then its status byte set empty, slot by slot ([D14](../docs/DECISIONS.md#d14)). A
card pulled away part way leaves a slot spent with any part of its data zeroed:
`GET_PROOF` still answers it, and its bytes are not a proof. Only the zeroed bytes
set such a slot apart, so a reader that uses a spent slot's data checks it first.
`cardctl dump` (0.x cards) skips a spent slot that fails the card file's slot
checks ([`CARD-FILE.md`](CARD-FILE.md#slot)). The slot checks catch a zeroed
amount and a `C` that is no longer a point. A tear that zeroed only keyset or
nonce bytes, or part of `C` whose x still lands on the curve, passes them, and
`dump` writes that slot as spent. The PIN given in this tap (`6982`); `6A97` on a card with no PIN; `6986`
locked. The paid list is kept ([The paid list](#the-paid-list)), and after the
places are freed the keyset table is reclaimed
([Two units on one card](#two-units-on-one-card)).

**Reader settlement precondition:** this command clears every retained spent
slot. Before sending it, the reader MUST reconstruct every retained spent proof
and obtain a NUT-07 `SPENT` result for each one from its mint. Card-local spent
status records consumption on the card; a merchant may still hold an offline
payment awaiting settlement. `UNSPENT`, `PENDING`, unavailable state, incomplete
coverage or an unreconstructable proof blocks clearing. An empty card balance
or local settlement queue does not satisfy this precondition.

Bind the checked snapshot to the same authenticated card and revalidate it
before clearing. Preserve the verified scope across an interrupted clear: a
partly zeroed slot alone supplies no settlement evidence. Merchant output and
change-recovery records have their own retention requirements. See the shared
[CCP reader contract](https://github.com/cashucard/nut/blob/main/CCP.md).

### SET_CARD (0x32)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `32` |
| P1 | `00` |
| P2 | `00` |
| Data | on an owned card: proof length (1) ‖ proof; then unit (1) ‖ refund key (33) ‖ 65 bytes not read ‖ mint length (1) ‖ mint ‖ [design (3)] |

Writes the record. Card with no owner: before its first PIN by whoever holds it (it
takes and pays nothing), and then only in its **first set-up** ([SET_PIN](#set_pin-0x41),
[D196](../docs/DECISIONS.md#d196)) under the PIN given in this tap; after it the record
is fixed (`6A91`) until a reset. Owned card: the owner's proof over the record. Only
with nothing unspent and no change owed (`6A8D`). In order: `6986` locked; with no
owner `6982` (a PIN set and not given) and `6A91` (a PIN set and no first set-up);
`6F00` for a chip whose key agreement or point addition frames its answer otherwise
than the card reads it, or answers another point at one of the check's seventeen asks
(the framing check, at every `SET_CARD`, before the data is read, X and Y of each: the
key agreement's [11]G = [11]G, [n − 1]([11]G) = −[11]G, [2](−G) = −[2]G and
[n − 1]([2]G) = −[2]G; the point addition's [13]G + (−[2]G) = [11]G with the generator
G, [n − 2]([11]G) + [11]G = −[11]G with the generator [11]G, and [4](−G) + [2]G = −[2]G
with the generator −G; G with a scalar of the full width, [n − 1]G = −G by the key
agreement and [n − 2]G + G = −G by the point addition with the generator G; and, with
k = SHA-256("BIP0340/aux"), the key agreement's [k]([2]G), the point addition's
[k − 1]([2]G) + [2]G with the generator [2]G and [2k − 2]G + [2]G with the generator G,
and the key agreement's [2k]G, each held to the first, and the same four with m, the
BIP-340 tagged hash of nothing under "BIP0340/nonce". The first seven refuse every
engine of a family of wrong ones, each part read or given by its own Y, p − Y, the even
or odd root, the root (x³ + 7)^((p+1)/4) or p less it, the root with X's parity or not,
a scalar above or below n/2 worked as [n − s], one fault or several at once, that is
wrong at any input; the last ten refuse a fault of the multiplication itself where one
of the scalars, on G or on another point, uses it, as a table entry stored wrong: they
use every entry of a table of 3 to 5 bits for windows aligned at bit 0 and for combs
and NAFs on the bare scalar, and not every entry of a 5-bit window aligned elsewhere,
of a 5-bit window or comb on the fixed-length s + n or s + 2n, of a 6-bit table, of
Booth recoding of 6 or 7 bits or of a 7-bit NAF, nor of a scalar blinded at random. A
fault these asks do not reach, an engine outside these models, or one right at these
points and wrong elsewhere, is not refused: the chip run's real signatures and change
are the last check); owned `6A91` (no good proof); `6A8D`; `6700` for data too short to name a mint;
`6A80` for a factory record (a mint of `-` alone) on a card that has had a PIN or
holds a record of a holder's, an owned card among them; `6700` for a length that is
not the mint's with or without a design; `6A80` for a design not of three capital
letters or digits (or three zeros); `6A80` for a unit other than `00` and `01`;
`6A99` for a new unit on a card with a holder's record, a limit set and no rate;
`6A80` for a bad refund key (not `02` or `03` with an x of a point of the curve,
under p, or 33 zeros); last, `6A96` where the chip's transaction cannot hold the
record, with nothing of it written. The refund key's y, the root of x^3 + 7 of its parity, is worked out once and kept with c
in the record's transaction ([Keys per load](#keys-per-load)). On a card that holds a
record of a holder's, a new unit turns the daily limit and the day's count, the
limit on one payment, the no-PIN allowance and its count into it at the rate, each
rounded up (0, no limit, stays 0): 100,000 sats a day are 100 cents at 100,000 sats
to the dollar, not 100,000 cents; a card with no limit changes unit with nothing to
turn. On a card with no record of a holder's (new, reset, or with a factory record)
nothing is turned and no rate is asked for: limits set before the first holder's
record (`SET_LIMIT_PIN` before `SET_CARD`, as a simple card is set up) are in the
unit that record names, so a usd card's are sent in cents. Never touches the rate, the clock's time, whether
it is weak, or the hardest header's bits (`GET_CARD` 40 to 43), which nothing lowers
([D203](../docs/DECISIONS.md#d203)). The first `SET_CARD` that goes through reserves,
once and outside any transaction, the paid list (and beside it the signatures kept
for `SPEND_ALL_AGAIN`), the store of the mints' proofs, the settlement record
(D176), the keyset table and then the openings' keys; after every check it lets go
any opening drafted for a payment never signed and frees every entry of the table
(the card being empty and owed nothing). A mint of `-` alone is a factory record: an
issuer writes it to a new card, before any PIN, to carry the card's design.

### SET_LIMIT_PIN (0x33)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `33` |
| P1 | `00` |
| P2 | `00` |
| Data | the value, as [SET_LIMIT](#set_limit-0x34)'s: 4, 8, 12, 13, 17 or 18 bytes |

The PIN form, for a card with no owner, in its **first set-up** alone
([SET_PIN](#set_pin-0x41), [D196](../docs/DECISIONS.md#d196)): the PIN given in this
tap and nothing unspent and no change owed. The value means what `SET_LIMIT`'s
means, field for field, and a value that carries the allowance ends the no-PIN
window and arms the allowance. In order: `6986` locked; `6982` with the PIN not
given; `6A91` on an owned card, or on a card with no owner past its first set-up
(its numbers are set once: limits, allowance, budget, rate and window switch, with
the mint and the unit of its record; a holder who wants others empties the card,
resets it by the PIN and sets it up again, [RESET_CARD](#reset_card-0x51)); `6A8D`
with anything unspent or owed; `6700` for another length; `6A80` for a budget
outside 1 to 30 or a no-PIN window switch other than `00` or `01`. 2.2 took 4 or 8
bytes with the same meaning. On a card with no owner this form alone sets the no-PIN
window's switch (byte 17).

### SET_LIMIT (0x34)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `34` |
| P1 | `00` |
| P2 | `00` |
| Data | proof length (1) ‖ proof ‖ value |

The owner's form; no PIN, any funds. One layout, the same in the PIN form
([D184](../docs/DECISIONS.md#d184)); every figure is in the card's unit (sats, or
cents on a usd card). The value:

| Bytes | Field | |
|---|---|---|
| 0–3 | daily limit | 0 is none. A new number begins a window at `now`; the same number again, in any form, leaves the window and its count as they are |
| 4–7 | payment limit | (8 bytes or more) a payment over it waits, by the card's own work, for every limit's worth past the first |
| 8–11 | no-PIN allowance | (12 bytes or more) what is signed for without the PIN in the no-PIN window; a new number counts from nothing |
| 12 | rollover budget | (13 bytes or more) 1 to 30: how often the window may roll between the owner's `REFRESH`es; `6A80` outside that. Absent, the budget is left as it is (D26). A budget under the rolls already spent stops the day until `REFRESH` |
| 13–16 | rate | (17 bytes or more) sats to the dollar, `0` none: how a payment in the other unit is counted ([Two units on one card](#two-units-on-one-card)). Absent, the rate is left as it is. A rate alone changed begins no window and keeps every count |
| 17 | no-PIN window | (18 bytes) `00`: the no-PIN window of 24 hours, an arming bringing the allowance back no sooner than 24 hours after the window that runs began; `01`: none, an arming bringing it back at the next payment with no PIN ([The clock and the limits](#the-clock-and-the-limits)). `6A80` for any other value. Absent, the switch is left as it is; a new card's, and a card's after `RESET_CARD`, is `00`. `SET_CARD` never touches it |

A field absent leaves what it sets as it is. In order: `6986` locked; `6A90` with no
owner; `6A91` with no good proof; `6700`
for a length other than 4, 8, 12, 13, 17 or 18; `6985` for an allowance other than 0
on a card with no PIN (there is nothing for it to stand in front of); `6A80` for a
budget outside 1 to 30 or a switch other than `00` or `01`, with nothing written;
`6A99`, with nothing written, for a value that would leave a limit set and no rate
on a card that holds pieces of the other unit (format `05`): no payment could take
them off until a rate came, so the owner sends the rate with the limit. A
2.2 wallet's 4, 8, 12 and 13 bytes mean on a 2.3 card what they meant on 2.2, but
for the allowance's: since 2.3 ([D186](../docs/DECISIONS.md#d186)) it comes back at an
arming and not each day, and a wallet that sends the limits again (on every sync,
say) arms it and ends the no-PIN window it does; and the same day's number sent again
no longer begins a new day. Only the owner's proof
writes the switch on an owned card, and the PIN on a card with no owner
([SET_LIMIT_PIN](#set_limit_pin-0x33)); a reader that holds only the PIN cannot.

A load is held to the day's limit when it is loaded (`LOAD_PROOF`); the card checks
nothing on the card when the limit changes. An owner who lowers the day's limit, or
the rate, below a piece already on the card leaves that piece waiting until the
limit is raised again: nothing is lost, but it cannot be paid meanwhile. The owner's
wallet warns before it lowers a limit below a piece on the card.

### SET_HEADER (0x36)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `36` |
| P1 | `00` |
| P2 | `00` |
| Lc | `50` |
| Data | a Bitcoin block header, 80 bytes, as the network carries it |
| Le | `04` |

**Response:** the card's `now`, 4 bytes. No PIN, no owner, any state. The card
hashes the header twice with SHA-256; the hash, read little-endian, must be at or
under the target its own `bits` name, and that target at or under the floor built
into the applet (`bits` `0x17087BC0`, a quarter of the network's work at height
971,100: D24) and, once a header has been taken, at or under four times the target
of the hardest taken (`6A93` otherwise; `6A80` for `bits` no header could carry; `6700` for any
length but 80). A later time moves `now` forward; an older header changes
nothing, but in a card's first set-up (below). A no-PIN window begun before the card had taken any header begins at the
first header it takes.

**The first set-up's anchor ([D204](../docs/DECISIONS.md#d204)).** In a card's first set-up
(the selection of the `SET_PIN` that gives a card with no PIN its PIN), while the card holds
nothing (no unspent piece, no change owed), the header `SET_HEADER` takes, and a claim's anchor
([SET_OWNER](#set_owner-0x43)), is an anchor as the empty card's reset's is: it becomes the clock
even where the clock is later, and the hardest where it is harder, and the day's limit's window
and the day of loads, where they began after it, begin again at it with what they counted. So
the tip a wallet sets a card up with is its clock and its hardest before it holds anything,
whatever header a stranger gave it before.

**A header far ahead.** A header whose time is far in the future moves `now` there,
as any later header does, and no real header moves it on. What follows depends on its
work ([D201](../docs/DECISIONS.md#d201)).

- **Weak: at the floor's work, it begins and ends no day.** A header is weak when it
  carries less than half the work of the hardest the card has taken (its target over
  twice that one's), or, on a card that has taken none yet, less than twice the floor's
  work (its target over half the floor's: half the work of the network's own when the
  floor was set, [D203](../docs/DECISIONS.md#d203)). A weak header is never the hardest.
  One at the floor's work, a quarter of a block's, is weak to every card, a fresh one too,
  and the network's own are not (its difficulty
  has never fallen by half). `SET_CARD`, a reset and a hand-over keep the hardest. At a clock a weak header set, no day the card counts ends
  (the day's limit's window, the no-PIN window, the day of loads) and none begins at
  it: each goes on counting where it was. So such a header gives no one a day and freezes none; until the clock is
  brought back, a day at its limit stays at it.
- **`REFRESH` brings a weak clock back.** An older header that is not weak, in the
  owner's `REFRESH` or in the holder's (P1 = `01`, the PIN in a held tap), becomes the
  clock ([REFRESH](#refresh-0x53)); the days end by it as before.
  A wallet that finds the card's clock later than the newest header it has sends it.
- **Not weak: a far header with the network's work.** To the card that is the
  network's newest block: a day that is over by it begins again at it, and ends only
  when `now` passes it by a day (never, for a time at or after `FFFEAE80`: a day past
  it no longer fits four bytes, and a day that cannot end is not read as over). On a
  card with an owner, the owner brings it back with `REFRESH`'s back form (the header,
  then `01`, under the proof): the clock goes back to an older header that is not weak,
  and the day's limit's window and the day of loads, where they began after it, begin
  again at it with what they counted; or, where the card is not locked, the owner sets the day's limit to 0 or
  a new number, which begins a new day ([SET_LIMIT](#set_limit-0x34)). A card with no
  owner has no such way: its money above what that day has left stays on the card. A
  card is emptied, too, through the reset or hand-over below.
- **Owed change is never stranded.** A payment's change is counted in the day of
  loads when the payment is signed, and `LOAD_CHANGE` is never refused for the count;
  change the day has no room for is refused before it is made
  ([SPEND_ALL_CHANGE](#spend_all_change-0x26)), so none is owed that cannot be loaded.
  A payment with no change still goes.
- **The empty card's anchor.** The owner's reset or hand-over, or the holder's reset by
  the PIN, of an empty card takes a real header as the anchor ([RESET_CARD](#reset_card-0x51),
  [SET_OWNER](#set_owner-0x43)); that anchor becomes the clock even where it is older,
  and the day of loads begins again ([D200](../docs/DECISIONS.md#d200)). So does the first
  set-up's anchor, above ([D204](../docs/DECISIONS.md#d204)), the day of loads begun after
  it beginning again at it. Besides these anchors, only the owner's back form moves the
  day of loads.
- **What remains.** A weak header pauses a card's days until the `REFRESH`. A far
  header that is not weak costs at least half the work of the hardest header the card
  has taken: on a card set up by the text, the tip it was set up with or a later one
  (the keeper's choice: [D201](../docs/DECISIONS.md#d201)); on a card that has taken
  none, twice the floor's (one header serves every such card), a bar fixed when the floor
  was set that falls against the network as its difficulty rises, and that the first
  set-up's anchor lets go ([D204](../docs/DECISIONS.md#d204)). On a card with no owner
  such a header stops the card's loads until the empty card's anchored reset, and holds
  the money above what its day has left.
- **At set-up.** A wallet that sets a card up **MUST** give it, in its first set-up and
  before any load, the newest header of the best chain it has checked: as the claim's
  anchor on a card with an owner, with `SET_HEADER` on one with none
  ([Personalisation](#personalisation), [D204](../docs/DECISIONS.md#d204)). That
  first set-up's anchor brings back a clock a header far ahead set, weak or not, and is
  the card's hardest where it is harder, so no reset comes first. A card set up without
  it keeps whatever clock and hardest a stranger's header gave it.

A reader MUST NOT give a card a header whose time is more than two hours ahead of
its own clock (the network's own rule), and SHOULD give only headers of the best
chain it has checked itself, never one handed to it; a reader told the loads left
(`GET_INFO` P1 = `04` bytes 57 and 58) makes no more change outputs in a payment
than they allow, since the card refuses the rest (`6A8F`), and a reader not told them
reads nothing from their zeros. These bind honest readers only: `SET_HEADER` is open to
anyone holding the card ([D199](../docs/DECISIONS.md#d199)).

### TELL_TIME (0x37)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `37` |
| P1 | `00` |
| P2 | `00` |
| Lc | `04` |
| Data | the terminal's clock, seconds |

A note for the receipts and the log of this tap; trusted for nothing.

### KEYSET_KEYS (0x38)

The card learns a keyset's keys, checks them against the keyset's ID, and keeps a
hash tree of them, so that it writes a change piece only under a key it has seen
to be one of them ([Keyset keys](#keyset-keys), [D190](../docs/DECISIONS.md#d190)).

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `38` |
| P1 | `00` begin; `01` keys; `02` finish; `03` show an opening's key |
| P2 | `00` |
| Data | P1 = 0: the keyset (8) ‖ the tail; P1 = 1: one to six keys of 41 bytes, amount (8) ‖ K (33, compressed); P1 = 2: none; P1 = 3: the opening (1) ‖ the leaf's index (1) ‖ the depth (1) ‖ the path (32 × depth) ‖ [another key (33) ‖ [another keyset (8)]] |
| Le | `00` with P1 = 2 |

**P1 = `00` to `02`: teach.** Under the PIN given in this tap, and nothing else:
the owner's grant alone does not teach, because a keyset taught is a key the card
will write change under. P1 = 0 begins: the keyset must be in an entry of the
keyset table (`6A88` otherwise); the tail is the bytes NUT-02 hashes after the
keys for the ID's version (none for version `00`), at most 64. A version `01`
tail names the unit first, `|unit:sat` or `|unit:usd` followed by the end or `|`,
and it must be the entry's (`6A80` otherwise). A version `00` ID hashes the keys
alone and binds no amount, so the card holds the n-th key's amount, from 0, to
2^n (`6A80` otherwise). P1 = 1, sent as often as needed, gives
the keyset's keys in increasing order of amount, every key the mint lists for the
keyset, 64 at the most: the card hashes them into the keyset's ID as NUT-02 says,
and into a tree whose leaves are `SHA-256(0x00 ‖ amount (8) ‖ K)`, in the order
given. P1 = 2 finishes: the card ends the ID, and keeps the tree's top (padded to
the next power of two with `SHA-256(0x02)`, nodes `SHA-256(0x01 ‖ left ‖ right)`)
in the keyset's entry only where the ID's first 8 bytes are the keyset's; it
answers the ID it worked out (8 or 33 bytes). Any other command between gives the
teaching up. A keyset taught again has its top replaced.

**P1 = `03`: show an opening's key.** The path of a leaf in the keyset's tree, from
the leaf's sibling up; bit i of the index, from the lowest, is 1 where the node at
height i is a right child; a depth of 0 to 6. Without another key, the leaf is the
opening's amount and the key it is bound to, and any reader may send it, with no
PIN: it is a proof the card checks. With another key, the opening is bound to that
key, and shown, under the PIN given in this tap, with no payment signed in this
time in the field and the holder's say in this tap (the owner's grant; on a card
with no owner, a held tap): this is how a holder mends an opening a reader bound to
a key that is not the mint's. With another key and a keyset after it, the path is
folded to that keyset's top, and the opening moves to it as well: a keyset of the
opening's unit whose keys the card was taught. This is how a holder takes back
change the mint signed in another keyset than the one the opening was made for
(the mint had moved on when the swap was posted). The card folds the leaf up the
path, and where it reaches the keyset's top marks the opening's key shown; with
another key, the key, the keyset and the mark are written in one transaction.

In order: `6A97` with no PIN set; `6A86` for another P1; teaching, `6982` without the PIN given in this tap, `6985` for P1 = 1 or 2 with no teaching
begun; at P1 = 0, `6700` for fewer than 8 bytes or more than a keyset and its
longest tail, `6A88` for a keyset in no entry, `6A80` for an ID version other than
`00` and `01`, `6700` for a tail after a keyset of version `00`, `6A80` for a
version `01` tail whose unit is not the entry's; at P1 = 1, `6700` for a bad length,
`6A80` for keys out of order (an
amount of 0 among them), a version `00` key whose amount is not 2^n, more than 64,
or (P1 = 2) no keys or an ID whose first 8 bytes are not the keyset's; a refusal at
P1 = 1 or 2 gives the teaching up; showing, `6700` for less than three bytes,
`6A83` for an opening past 7, `6A88` for one not owed, `6700` for a bad length or
a depth over 6, `6A9F` for a keyset (the opening's, or the one named) whose keys
the card has not learned, `6A9B` for a keyset named of the other unit than the
opening's, and with another key `6982` without the PIN or the holder's say and
`6985` in a time in the field that paid, then `6A80` for a path that does not reach
the top.

---

<a id="category-0x4x--authentication"></a>

## Category 0x4x: Authentication

### VERIFY_PIN (0x40)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `40` |
| P1 | `00`; `01` sealed |
| P2 | `00` |
| Data | the PIN, 4–8 bytes; with P1 = 1, the PIN sealed (`FOXY-CARD-DAILY-LIMIT.md` 6e, under `CashuCard/seal` and `CashuCard/pinkey`) |

Success opens the PIN's commands for this tap. It arms the no-PIN allowance only
where no payment is then signed in this time in the field: a payment's commit
takes back an arming this `VERIFY_PIN` gave earlier in the same time in the field,
and never one the allowance already had from an earlier time in the field
([The clock and the limits](#the-clock-and-the-limits)). It ends no no-PIN window.
Wrong, on a card with an owner: `63CX` with X tries left; the try that exhausts
the counter blocks the card (`6983`), and so does every `VERIFY_PIN` after it.
`6984` with no PIN set. `6982`, before the PIN is looked at and costing no try,
after an owner was replaced ([SET_OWNER](#set_owner-0x43)), until the new owner's
`CHANGE_PIN`: a hand-over asks for a new PIN. **A card whose PIN state is 2 answers `6983` before it
checks the PIN, whatever its counter** (in order: `6A86` for a P1 other than `00` or
`01`, `6984`, the hand-over's `6982`, then `6983`) ([D22](../docs/DECISIONS.md#d22)): the state
byte is the PIN's commit. And a PIN whose tries are all gone is blocked everywhere:
a card that finds its counter at 0 under a state of 1 (a last wrong try torn before
the state byte was written) writes 2 before its next command reads the state. The
owner's `CHANGE_PIN` unblocks it, on a locked card too. Sealed: before the
agreement the card checks itself that the reader's point is on the curve (an
envelope whose point is not one does not open, and costs a try).

**On a card with no owner the PIN never blocks**
([D195](../docs/DECISIONS.md#d195)). A wrong PIN answers `63CX`, X the wrong tries in
a row (`F` for fifteen or more), and makes the next `VERIFY_PIN` wait: after the
w-th wrong try in a row the next try owes 2^(w−1) askings (1, 2, 4, 8, 16, 32 ...;
at most 16,384, about three hours, from the fifteenth on). Each asking owed is
answered `6A98`, keep holding, with no data, after a signature's work of the card's
own (about 0.7 s on a chip). The wait is served in stretches of 16 askings: the
asking after a stretch writes what is still owed, less the stretch, and answers
`6A98` again while anything is owed, so that a long wait is served over as many
taps as it takes, and a card taken out of the field loses at most the stretch it
was in. The asking after the wait is the try: the card counts it as wrong and
writes the next try's wait before it compares the PIN (as the chip takes a try
before it compares), and a right PIN sets the count and the wait to nothing. Any
other command, a `SELECT` among them, begins the stretch under way again. The wait
comes before a sealed `VERIFY_PIN`'s envelope is opened: the same envelope is sent
through the wait, and its nonce stays live. `GET_INFO` byte 9 on such a card is the
chip's counter, which the card fills again before each try; the wait is said by
`63CX` and `6A98` alone. After three wrong tries in a row (`63C3` or more) `SET_PIN`
replaces the PIN (a forgotten PIN) with nothing unspent or owed, as it replaced a
blocked one, with no PIN asked; the history goes with it and no first set-up begins
([SET_PIN](#set_pin-0x41)). `6A98` is never a refusal: a reader sends the same
`VERIFY_PIN` again for as long as the card answers it, and tells the holder to keep
holding.

### SET_PIN (0x41)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `41` |
| P1 | `00`; `01` sealed |
| P2 | `00` |
| Data | the PIN, 4–8 bytes |

Sets or replaces the PIN, gives back the tries and unblocks, on a card with no
owner and nothing unspent or owed; the PIN's wait ([VERIFY_PIN](#verify_pin-0x40))
goes with the PIN it replaces. A card with no PIN (new, or reset) takes one from
anyone. A card with a PIN keeps it: a new one wants the PIN it has, given in this
tap, and on a used card a held tap ([A holder with no phone](#a-holder-with-no-phone)),
unless the PIN is blocked or has three or more wrong tries in a row (a forgotten
PIN), which is replaced with no PIN asked. A forgotten PIN replaced takes the history
with it: the log, the receipts, the last signature, the signatures kept for
`SPEND_ALL_AGAIN`, the last payment's packet (`GET_OUTBOX`), the other unit's count
of what was signed for, the receipts' units and the last payment's unit; the
packet's generation is stepped first, as `RESET_CARD` steps it, so the receipt
count beginning again never gives a later packet an earlier one's payment id and
generation; the numbers, the record and the keyset table stay. The
history goes after the new PIN's commit, which notes it owed: a card pulled away
before that commit keeps its PIN and all its history, and one pulled away after it
has the new PIN, and its history is taken down at its next command, before anything
reads it.

**The first set-up** ([D196](../docs/DECISIONS.md#d196)). The `SET_PIN` that gives a PIN
to a card with none (the PIN state 0: a card that never had one, or one just reset,
which `RESET_CARD` alone makes) begins the card's first set-up, and nothing else
begins one: not a PIN replaced under itself, not a forgotten PIN replaced, not a
factory record. It is a mark in lasting memory that every selection of the applet
ends (a `SELECT`, or the chip's own at power-up): a reader that turns its field off
and on ends it, and only a reset can begin another. In it, on a card with no owner,
[SET_LIMIT_PIN](#set_limit_pin-0x33) and [SET_CARD](#set_card-0x32) go through as
often as they are sent, and an owner is claimed ([SET_OWNER](#set_owner-0x43)); after
it, none of them. A set-up cut short is finished after a reset.

The first `SET_PIN` marks the card as having had a PIN, for good
([CERT_WRITE](#cert_write-0x54); a factory record goes on no such card). In order:
`6A86` for another P1; `6986` locked; `6A91` on an owned card (the owner uses
`CHANGE_PIN`; no card has an owner and no PIN); on a card with a PIN, not blocked and
with fewer than three wrong tries in a row, `6982` with its PIN not given; `6A8D`
with anything unspent or owed; on such a card, used, `6985` in a time in the field
in which a payment was signed and `6982` with no hold; the sealed form's words
(`6985` with no nonce; `6700` for an envelope that does not open, the same word as
one that opens to the wrong length, so that the answer says nothing of the PIN
key); `6700` for a PIN of another length.

### CHANGE_PIN (0x42)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `42` |
| P1 | `00`; `01` sealed |
| P2 | `00` |
| Data | proof length (1) ‖ proof ‖ the new PIN (4–8) |

The owner's proof over the new PIN; no old PIN, no session, any PIN state, any
funds. Sets the PIN, refills the tries, unblocks, and ends any verified session.
The PIN is written, then the PIN state, in one transaction: the state byte is the
commit, so a card torn between them is still blocked and the owner sends it again
(D22). A locked card takes it only where its PIN is blocked: the one way back to
what is on it, under its owner's proof; the card stays locked. `6986` locked with
a PIN that is not blocked; `6A90`, `6A91`; `6700` for a PIN of another length.
Sealed: `6985` with no nonce; `6A91` for an envelope that does not open, the same
word as one that opens to a proof that is not the owner's.

### SET_OWNER (0x43)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `43` |
| P1 | `00`; `01` the owner's c, sealed |
| P2 | `00`; any other `6B00` |
| Data | on an owned card: proof length (1) ‖ proof; then the owner's P-256 key (65, `04 ‖ X ‖ Y`) ‖ [an anchor header (80)] ‖ [the check of the owner's c (16)]; with P1 = `01`, E (65) ‖ s sealed (32) ‖ the tag (16) |

**On an owned card**, with the old owner's proof, nothing unspent and no change
owed (`6A8D`), the owner is replaced at once, and the card takes the next owner's c
(below) or, given none, draws a new one, in the same transaction
([Keys per load](#keys-per-load)): the next owner's date keys are not the last
owner's, and neither can work out the other's.

**The owner's c ([D202](../docs/DECISIONS.md#d202)).** A claim or a hand-over may give
the card the new owner's c, made from the owner's words, so that a phone restored
from them has c with no card. It is not all a lost card's take-back needs: the phone
also needs the card's key P and the pieces (their secrets and the mint's
signatures), which it keeps where its restore reaches them:

- **s.** The new owner's phone works out s = HMAC-SHA256(the 64-byte BIP-39 seed,
  `CashuCard/c` ‖ `00` ‖ the card's key P (33)) ([The owner's proof](#the-owners-proof)).
- **`SET_OWNER` P1 = `01`**, just before the claim or the hand-over, gives the card s
  sealed to its PIN key Q (`GET_NONCE` P1 = `01`, whose signature by the card key the
  phone checks first): E = e·G (65, for this one message), s XOR block 1, and the
  tag, block 0's first sixteen bytes, block i = SHA-256(`CashuCard/c` ‖ i (one byte) ‖
  the x of e·Q ‖ E [‖ the 32 sealed bytes, for block 0]). The card's sixteen bytes are not in it: the next
  owner's phone makes it where it is (a hand-over is the last owner's tap; the next
  owner gives its key, the envelope and the check to the last owner's phone), and a
  replayed envelope gives no more than the same s. The card opens it and keeps s in
  working memory for the `SET_OWNER` that comes next; any other command (a `SELECT`
  among them) lets it go: on a hand-over the last owner's phone asks `GET_NONCE`
  P1 = `01` before the envelope, and its sixteen bytes serve the proof. Nothing is
  written, and a claim's askings begin again. In
  order: `6986` locked; `6B00` for a P2 other than `00`; `6700` for data other than
  113 bytes; `6A80` for an envelope that does not open (E no point of the curve, or
  the tag not block 0's), keeping nothing.
- **The check.** The claim or the hand-over then ends its value with the first sixteen
  bytes of SHA-256(`CashuCard/c` ‖ s), under the last owner's proof on a hand-over and
  the same at every asking of a claim: `6985` where no s is kept, `6A80` where the
  check is not the kept s's, both before anything is counted.
- **c.** c = SHA-256(`CashuCard/c` ‖ s ‖ n), n the number of owners' c the card has
  taken, this one with them (four bytes, big-endian, from 1). The card keeps n in
  lasting memory that nothing clears, and writes c and n in the command's transaction.
  So no c the card takes is one it has had, for the same owner neither, and a replayed
  claim or hand-over never sets an old c.
- **The owner's phone checks** c after the claim or the hand-over (`GET_CARD` P1 = `03`
  under its grant) for an n from 1 up, and so learns n. It works s out from the
  card's own key, `GET_PUBKEY` in its first tap with the card (with the certificate,
  where the card has one), never from a P it was handed: a hand-over's envelope made
  away from the card is made from the P the last owner gave. A c that no n gives was
  not made from its s: a reader in the claim's tap (which can claim the card for itself
  with the PIN), or at a hand-over the last owner's phone (which signs the check, and
  so can send an envelope of its own and the check of it), gave the card a c of its
  own, and with it every date's keys and inbox name. The phone **MUST NOT** lock dated
  money to that card's keys or file for it; it resets the card, which it owns, and
  claims it again.
- Without the check, a claim keeps the card's c and a hand-over draws one, as before.
  A card with no owner keeps the c it drew; [RESET_CARD](#reset_card-0x51) draws one.

**A hand-over clears what was the last owner's, and asks for a new PIN.**

- **The card keeps** its key and its settings: the mint, the unit, the limits, the
  rate, the allowance, the rollover budget and the design, and its clock (the time
  and the hardest header's bits), so a later header is taken and an older one moves
  nothing, as before; but the hand-over's own anchor sets the clock even where it is
  older (below).
- **It loses, as at a reset:**
  - the log, the receipts, the last signature and the signatures kept with the
    receipts;
  - the last payment's settlement record ([GET_OUTBOX](#get_outbox-0x1b) answers
    `6A88` until the next payment); the record's generation steps;
  - the keyset table's history (the last payment's unit, the other unit's count, the
    receipts' units), and every keyset entry nothing on the card names;
  - the spent places, the mint's proofs kept with them, the staged outputs and the
    openings;
  - the paid list: its rows are of pieces locked to the last c's keys, which the
    card never signs for again;
  - the day's counts: the day's window and what it signed for, the no-PIN window's
    start and count, and the day of loads and its count;
  - the last header's hash, the rolls and the arming (`GET_CARD` bytes 44 to 76, 76
    and 78 read zeros): the rolls begin again as at a `REFRESH`, and the no-PIN
    allowance waits for the new owner's arming (its PIN or its proof).
- **It loses the record's refund key.** Until the new owner names its own with
  [SET_CARD](#set_card-0x32) (its proof, on an empty card):
  - `GET_CARD` P1 = 3 seals c to the PIN key, as on a card with no refund key, to the
    new owner's grant;
  - a dated piece is refused (`6A8E`), with nothing written;
  - an undated piece loads and pays as on any card with no refund key: its keys name
    no refund key. A `SET_CARD` after it waits for an empty card (`6A8D`).
- **The PIN, which the last owner knows, is not taken.** `VERIFY_PIN` answers
  `6982`, costing no try, in that tap and every later one, through power cuts and
  `SELECT`s, until the new owner sets a PIN of its own with `CHANGE_PIN` (its proof
  over the new PIN). Until then nothing the PIN alone opens is open:
  - the history (`GET_LOG`, a spent place) and the scope (`GET_OUTBOX` P1 = 0);
  - the date keys (`GROUP_KEYS`), and teaching a keyset (`KEYSET_KEYS`);
  - a payment over the allowance, a load, `CLEAR_SPENT` and `LOCK_CARD`.

  `GET_INFO` byte 7 still says a PIN is set.
- The PIN and the owner's grant given in the tap end with the replacement.
- **The new owner's phone:** `CHANGE_PIN`; then, before its first load, `SET_CARD`
  with its own refund key (a wallet that loads only undated pieces may leave it
  out); then reads c ([GET_CARD](#get_card-0x16) P1 = 3, under its grant). A wallet
  that swapped ecash to the last owner's date keys and has not loaded it refunds it
  (dated) or loses it (undated), as after a reset.

**On a card with no owner it is a claim**
([The owner claimed slowly](#the-owner-claimed-slowly)): the PIN set and given in
this tap, a record of the holder's (not a factory record), the card's first set-up
([SET_PIN](#set_pin-0x41): a card set up with no owner is never claimed,
[D196](../docs/DECISIONS.md#d196)), no payment signed in this time in the field, and
an empty card, as on 2.2: nothing unspent and no change owed. The same data is asked for six times in a row;
each of the first five is answered `6A98`, keep holding, with no data, after a
signature's work of the card's own, thrown away; the sixth sets the owner and
answers `9000`. Other data, or any other command between (a `SELECT` among them),
begins the count again; a `SET_OWNER` refused for its own data neither counts nor
ends it. After a claim, no payment is signed in that time in the field.

**The anchor (2.0, D20):** a block header after the key is held to `SET_HEADER`'s
checks before anything is counted or written (`6A93` refuses the owner too) and
taken in the same transaction as the key, with the rollover count at 0. A card
set up with one never runs at `now = 0`. A claim's anchor is the first set-up's
anchor of an empty card ([D204](../docs/DECISIONS.md#d204)): it becomes the clock even
where the clock is later, and the hardest where it is harder, and the day's limit's
window and the day of loads begun after it begin again at it. A hand-over's, on a card that is empty (`6A8D`
otherwise), becomes the clock even where it is older than the card's
([D200](../docs/DECISIONS.md#d200)): an owner brings back a clock moved far ahead by
one header ([A header far ahead](#set_header-0x36)), and the day of loads, cleared
with the rest, begins again at the next load.

One transaction: the owner's flag, c (the owner's, with n, or on a replacement a
new one drawn), the settlement record let go and the history and the new PIN marked
owed on a replacement, the anchor (on a replacement the clock, whether it is weak and
the hardest bits alone: what else it would write, the hand-over clears), and the key
last (9 writes and 113 bytes at the most for a hand-over, at a weak clock with a day's window begun with no clock, an anchor harder than the hardest and the owner's c; a claim at its worst, with a far clock, the day's window and the day of loads begun at it and a no-PIN window begun with no clock, 12 and 156, [D204](../docs/DECISIONS.md#d204)). What a hand-over loses (the
list above) is cleared after it, and again by the next command if the card left the
field first, before anything reads it. One the chip's transaction cannot hold is `6A96`, with nothing written: the
card is as it was, and a claim is asked again from its first asking.

In order: `6986` locked; `6B00` for a P2 other than `00`, or a P1 other than `00` and `01` (P1 = `01` as above);
owned, `6A91` with no good proof; a claim, `6A97` with no
PIN, `6982` with the PIN not given, `6A8C` with no record of the holder's, `6A91`
past the card's first set-up, `6985` in a time in the field in which a
payment was signed; `6A8D` with anything unspent or any change owed;
`6700` for a length other than 65, 145, 81 or 161 after the proof; `6A80` for a key
not beginning `04`; the anchor's `6A93`, `6A80`; the owner's c's `6985` and `6A80`;
the askings (`6A98`); `6A80` for a key that is not a point of P-256 (x or y not under
its p, or off the curve), which the card checks itself, before the key is written;
last, `6A96`.

### GET_NONCE (0x44)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `44` |
| P1 | `00`; `01` the PIN key |
| P2 | `00` |
| Le | `10`; `71` with P1 = 1 |

**Response:** 16 fresh random bytes for one owner's proof (`6A90` with no owner).
With P1 = 1, on any card: the 16 bytes, the PIN key (33, compressed) and the card
key's BIP-340 signature over `SHA-256("CashuCard/pinkey" ‖ PIN key)` (64), 113 in
all, for sealing a PIN.

### ALLOW_LOAD (0x45)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `45` |
| P1 | `00` |
| P2 | `00` |
| Data | proof length (1) ‖ proof |

The owner's proof over `CashuCard/load`: the **owner's grant** for the rest of this
tap. It opens no load and signs nothing: under it the log and the receipts are
read, `GET_INFO` says the limit on one payment and the rate, a second payment in
the time in the field waits the floor alone, a new
keyset of either unit is entered with the holder's mark, `GET_OUTBOX`'s packet and
spent slots are read, and with the PIN an opening is bound to another key or
keyset. It teaches no keyset. Like every good proof it ends the no-PIN window.

**Response:** no data, and **`6200`** where the grant is given (ISO 7816-4: a
warning, the state of lasting memory unchanged; the grant lasts for the tap and no
longer). Not `9000`: 2.2's grant opened `LOAD_PROOF` and `CLEAR_SPENT` with no PIN,
and a 2.2 wallet that reads `9000` here swaps an owner's top-up to the card key
before it loads; on 2.3 the load is then refused (`6982`) and the swapped proofs,
locked to the card, could not be put on it. A wallet of 2.3 reads `6200` as the
grant given. In order: `6986` locked; `6A90` with no owner; `6A91` with no good
proof; `6700` for bytes after the proof.

---

<a id="category-0x5x--admin"></a>

## Category 0x5x: Admin

### LOCK_CARD (0x50)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `50` |
| P1 | `00` |
| P2 | `DE` (the confirmation byte) |
| Data | proof length (1) ‖ proof |

For good: no more loads, clears, records, limits, PINs or owners. A locked card
still pays, under its PIN and its allowance, and still takes its own change
(`LOAD_CHANGE`): receiving what it is owed changes no setting. A PIN set and
verified, and the owner's proof over `CashuCard/lock`. In order: `6982` without the
PIN; `6B00` for another P2; `6985` already locked; `6A90` with no owner; `6A91` with
no good proof; `6700` for bytes after the proof.

### RESET_CARD (0x51)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `51` |
| P1 | `00` the card; `01` one opening |
| P2 | `AD` (the confirmation byte); with P1 = 1, the opening's number (0–7) |
| Data | P1 = 0: proof length (1) ‖ proof ‖ [an anchor header (80)]; on a card with no owner, none or the anchor alone. P1 = 1: proof length (1) ‖ proof ‖ the number (1); on a card with no owner, the number alone |

**P1 = `00`:** the owner's proof over `CashuCard/reset` (and the anchor, where one
comes), on a card with nothing unspent and no change owed: the card as out of its
packet, keeping its clock's time, whether it is weak and the hardest header's bits, as
a hand-over keeps them (the last header's hash goes, as at a hand-over,
[D203](../docs/DECISIONS.md#d203)). No
PIN, no owner, not locked, no record, no limits, no rate, no log or receipts, no
openings, every entry of the keyset table free, the NFC tag on, a new PIN key.
**The card key:** a card whose certificate is sealed keeps its card key, its
certificate and its paid list ([The certificate](#the-certificate),
[D192](../docs/DECISIONS.md#d192)); any other card makes a new card key and starts
an empty paid list. Every card draws a new secret c, written in the reset's last
transaction ([Keys per load](#keys-per-load)): the next holder's keys are not the
last's. It is never the owner's: the reset ends the ownership, and the next claim
brings the next owner's c; the count of the owners' c the card has taken stays
([D202](../docs/DECISIONS.md#d202)). A locked card also wants the PIN in this tap (`6982`). The day of loads
begins again, in the reset's last transaction with the new c: no piece loaded
before it is one the card signs for again ([D200](../docs/DECISIONS.md#d200)).

**The anchor ([D200](../docs/DECISIONS.md#d200)):** a block header (80 bytes) after
the proof, under it, held to `SET_HEADER`'s checks before anything is written
(`6A93`, `6A80`), becomes the clock even where it is older than the card's, with its
difficulty as the hardest taken where it is harder than the one the card keeps, and its hash, in a transaction of its own after the
record is cleared. It is how an owner brings back a clock moved far ahead by one
header ([A header far ahead](#set_header-0x36)): the card is empty, so nothing it
holds is counted by the days the far clock began. To empty a card whose day's limit
the far clock holds, the owner first brings the clock back with `REFRESH`'s back form,
or sets the day's limit to 0 or a new number, which begins a new day. Without an
anchor the clock keeps its time, and whether it is weak. In order: `6B00`, `6A91`, `6700` (anything after the proof but nothing or
80 bytes), `6982`, `6A8D`, the anchor's `6A93` and `6A80`.

**P1 = `00` on a card with no owner: the reset by the PIN**
([D196](../docs/DECISIONS.md#d196)), the way back for a holder with no phone, whose
card's numbers are set once: the PIN given in this tap, a held tap ([A holder with no
phone](#a-holder-with-no-phone)), no data, and nothing unspent or owed; then the same
command sixty times in a row, each of the first fifty-nine answered `6A98`, keep
holding, with no data, after a signature's work of the card's own (about 45
seconds on a chip, with the history's held tap before it); any other command between, a `SELECT` among them, begins the
count again. The sixtieth resets the card as the owner's reset does, and the holder
sets it up again in a new first set-up ([SET_PIN](#set_pin-0x41)), with a phone that
claims it or by the PIN alone. The reset takes the hold and the arming with the PIN:
a new PIN given in the same selection has no held tap until it holds for one.

**The risk accepted.** Anyone who has the PIN and holds an empty card with no owner
for about 45 seconds (the history's nine askings and the reset's sixty) can reset it
and set it up again in the same selection: with the holder's PIN and mint, and its
own numbers, its own refund key or itself as owner. The holder's next top-up is then
under those. No till takes that long. The holder's phone, or a guest wallet that knows
the card, compares `GROUP_KEYS` for the date of the next load with the P + t·G and
R + u·G it works out from the P, R and c it keeps, before the top-up
([Keys per load](#keys-per-load)); a card reset since answers other keys (a new c).
The data is nothing, or an anchor (80 bytes) as the owner's reset takes it, the same
at every asking. In order: `6B00`; `6A97` with no PIN; `6982` with the
PIN not given; `6985` in a time in the field that paid; `6982` with no hold; `6700`
for data other than nothing or 80 bytes; `6A8D`; the anchor's `6A93` and `6A80`; the
askings (`6A98`).

**P1 = `01`, the let-go form:** one owed opening given up, its piece never loaded,
and nothing else reset: for an opening nothing can load. The card cannot tell such
an opening from one whose piece is still to come, so giving it up is the owner's
choice (the proof over `CashuCard/reset` and the number; on a locked card the PIN
as well) or, on a card with no owner, the holder's, under the PIN given in this
tap and a held tap. The money of that opening is gone. The tap is written in the
log, its entry with bit 4 of its flags. In order: `6A83` for a number past 7,
before anything else; owned, `6A91` and `6982` on a locked card without the PIN;
no owner, `6A97` with no PIN, `6982` with the PIN not given, `6985` in a time in
the field that paid, `6982` with no hold; `6700` for anything but the number after
the proof (or but the number); `6B00` for a number that is not P2; `6A88` for an
opening not owed; `6A94` for one whose piece is on the card already, which is let
go with nothing written in the log.

### SET_TAG (0x52)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `52` |
| P1 | `00` on; `01` off |
| P2 | `00` |
| Data | proof length (1) ‖ proof ‖ the byte P1 says |

The owner's proof over `CashuCard/tag` and the byte. Switches the card's NFC tag.
`6B00`, `6986` locked, `6A90`, `6A91`, `6700`.

### REFRESH (0x53)

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `53` |
| P1 | `00`; `01` on a card with no owner; any other `6B00` |
| P2 | `00` |
| Lc | proof length + 81, or + 82 in the back form; 80 with P1 = 1 |
| Data | proof length (1) ‖ proof ‖ a Bitcoin block header (80) ‖ in the back form `01`; with P1 = 1, the header alone |
| Le | `04` |

**Response:** the card's `now`, 4 bytes. 2.0 ([D20](../docs/DECISIONS.md#d20)): the
owner's proof over `CashuCard/refresh` and the bytes after it. The header is held to
everything `SET_HEADER` holds one to and taken as it takes one; then the rollover
count goes to 0, in the same transaction. No PIN; any funds; a locked card too.
`6B00` for a P1 other than `00` and `01`, before anything is read; `6A90`, `6A91`,
`6A93`, `6A80`; `6700` for a header of another length, or a byte after it other than
`01`. The answer is the clock: a wallet compares it with the header's time, since an
older header the card does not take is answered `9000` with the clock as it was.

An older header moves nothing, but in two cases ([D201](../docs/DECISIONS.md#d201),
[A header far ahead](#set_header-0x36)):

- **A weak clock comes back.** Where the clock was set by a weak header (one with less
  than half the work of the hardest the card has taken), an older header that is not
  weak becomes the clock, with its hash, and its bits where they are the hardest. The
  days the card counts are where they were and end by the clock as before: nothing is
  given.
- **The owner's back form** (the header, then `01`, both under the proof): the clock
  goes back to an older header that is not weak, whatever the clock, and the day's
  limit's window and the day of loads, where they began after the header, begin again
  at it, keeping what they counted (the day of loads its count and the change it
  counted, [D203](../docs/DECISIONS.md#d203)). A day begun under a far clock so ends a
  day after the owner's header. The no-PIN window the owner's proof ends anyway. A weak
  header in it moves nothing.

**P1 = `01` (2.3):** on a card with no owner, which has no proof to give, the PIN
given in this tap and a held tap stand for it ([A holder with no
phone](#a-holder-with-no-phone)): `6A91` on an owned card, `6A97` with no PIN, `6982`
with the PIN not given or no hold, `6985` in a time in the field that paid; no back
form (`6700`). The holder brings back a weak clock, never another: a reader given the
PIN would otherwise walk the day back for a new one at every tap
([D20](../docs/DECISIONS.md#d20)).

### CERT_WRITE (0x54)

The issuer writes the certificate's container in pieces, then seals it
([The certificate](#the-certificate), [D192](../docs/DECISIONS.md#d192)).

| Field | Value |
|---|---|
| CLA | `B0` |
| INS | `54` |
| P1 | `00` write; `01` seal |
| P2 | `00` |
| Data | P1 = 0: the offset (2) ‖ 1 to 240 bytes; P1 = 1: the container's length (2) ‖ SHA-256 of the container (32) |

Only on a card that has never had a PIN (a mark the first `SET_PIN` sets and
nothing clears), with no owner, nothing unspent or owed, and no certificate
sealed. The first write reserves the store, once: 1,024 bytes for the container
and three for its seal (the seal's byte and the length). Writes go outside any
transaction and count for nothing until the seal: a write torn off is written
again, and bytes never sealed are never served.

The seal holds the container to its form (NUT-CCP's
[certificate profile](https://github.com/cashucard/nut/blob/main/profiles/certificate.md))
and to this card:

- its SHA-256 over the length given is the one the writer sends: bytes another
  reader wrote between the writer's writes and the seal, or a page that went
  wrong on the air, are never sealed;
- `CCP-CERT`, the version `01`, and the form `01` or `02`;
- form `01`: the 33 bytes are the card key;
- form `02`: the index (2), the depth (1, at most 16), the path (32 bytes a node)
  and the top (32). The leaf `SHA-256(0x00 ‖ "CashuCard/cert-leaf/1" ‖ card key)`
  is folded up the path, `node = SHA-256(0x01 ‖ left ‖ right)`, the node at height
  `i` being the right one where bit `i` of the index is `1`; the index has no bit
  set at or past the depth; the fold ends at the top;
- then the statement, the signature and the chain, each its length (2) and its
  bytes, the chain ending at the length given. Any of the three may be empty.

Then the length and the seal's byte are written in one transaction. A sealed
certificate is never written again, and is kept, with the card key, through
`RESET_CARD`. The card reads neither the statement nor the signature, and checks
no signature: whether a reader trusts a key or a top is the reader's
certificate profile, outside this command set. A container with a path of 16
nodes, the longest statement the profile allows and a 65-byte signature is 890
bytes, which leaves 134 for the chain.

In order: `6A86` for another P1 or P2; `6985` with a certificate sealed, or on a
card that has had a PIN; `6A91` on an owned card; `6A8D` with anything unspent or
owed; `6700` for a write of no byte or more than 240, or a seal's data of other
than 34 bytes; `6A83` for bytes past 1,024 (or a length over it at the seal);
`6A84` where the card cannot reserve the store; `6A80` at the seal for a container
whose hash is not the one given, that is not well formed, or that does not name the
card key.

---

## The NFC tag application

A third applet of the package, instantiated under the NFC Forum's
`D2 76 00 00 85 01 01`: a read-only NFC Forum Type 4 Tag carrying one web address,
the same on every card (`FOXY-CARD-SPEC.md` 5.8). It answers its own `SELECT`,
`SELECT` of files `E103` and `E104` and `READ BINARY`, and nothing else. It finds
the card's applet by the AID `F0 43 41 53 48 55 43 41 52 44 01` to ask whether the
owner has switched it off.

---

## The clock and the limits

The card's clock (`now`) is the time in the newest block header it has taken
([SET_HEADER](#set_header-0x36), [REFRESH](#refresh-0x53), the anchored
[SET_OWNER](#set_owner-0x43)), and it only moves forward, but to the anchor of the
owner's reset or hand-over of an empty card, and to the first set-up's anchor of an
empty card, which it takes even where they are older ([D200](../docs/DECISIONS.md#d200),
[D204](../docs/DECISIONS.md#d204)), and in `REFRESH`: back from a weak clock, and, in
the owner's back form, back from any ([D201](../docs/DECISIONS.md#d201),
[A header far ahead](#set_header-0x36)). At a clock a weak header set, no day the card
counts ends, and none begins at it. Each header carries at
least a quarter of a block's work ([SET_HEADER](#set_header-0x36)), so a forger
spends that much for every day it buys. Three limits, all the
owner's ([SET_LIMIT](#set_limit-0x34)) or, on a card with no owner, the PIN's
([SET_LIMIT_PIN](#set_limit_pin-0x33)), all off on a new card, all in the card's
unit:

- **The daily limit** bounds what the card signs for in the day's window: 86,400
  seconds from the window's start. A payment counts its pieces whole, its own
  change with them, and the change is given back to the day when `LOAD_CHANGE`
  writes it back on the card (2.3): a reader that has the PIN and asks for nearly
  all of a large piece as change, and never hands back the mint's answer, cannot
  strand more than a day's worth. A payment that would take the window past the
  limit is `6A8F`, with nothing signed or burned.
- **The limit on one payment** makes a larger payment wait, by the card's own work.
- **The no-PIN allowance**, on a card with a PIN, is what it signs for without the
  PIN in its no-PIN window. Over it, `6A9E`, and the PIN is asked for the whole
  payment.

**What bounds a walked clock (2.0, D20).** A payment that finds the day over begins
a new window, and that is a roll, only while the rolls since the owner's last
`REFRESH` (or anchored `SET_OWNER`) are fewer than the rollover budget (default 7,
1 to 30, `SET_LIMIT`'s thirteenth byte). Past it the window stays where it is, and
what was signed for in it still counts, until the owner's phone sends `REFRESH`
(on a card with no owner, `REFRESH` P1 = 1 under the PIN in a held tap). The first
window a card begins (its start still 0) is not a roll. `GET_CARD` bytes 76 to 78
say the rolls, the budget and the arming.

**Only a payment that moves value rolls (2.1, D26).** A roll is spent only by a
`SPEND_ALL_SIGN` that is signed and commits with something leaving the card for
good: the pieces less the card's own change (`SPEND_ALL_CHANGE`) above 0. A payment
whose change is the whole of its pieces is signed, as ever, and counted in the window as it stands (since 2.3 its pieces
whole, until its change is back): it begins no day, first or later, and spends no
roll.
No other command spends one: a header (`SET_HEADER`, `REFRESH`, the anchor),
`TELL_TIME`, a read, a PIN, an owner's grant, or a payment refused (`6A94`, `6A9E`,
`6A8F`, `6A99`, or given up before its signature). A window also begins, as in
2.0, at the first header after a limit set with no clock and at a `SET_LIMIT` that
changes the day's number (the same number sent again, in any form, begins none);
neither is a roll. The roll, the day's count and the
payment's burn are one transaction.

**The no-PIN window (2.3, [D186](../docs/DECISIONS.md#d186)).** The allowance has a
window of its own. Only payments signed with no PIN count against it, each as the
**whole of its pieces**, the card's own change included: change is the card's only
once a reader has taken the swap to the mint and written it back, so a reader with
no PIN that names a large piece and takes nearly all of it as change has put the
whole piece out of the card's reach. The window begins at the first payment with
no PIN while none runs, at `now` (a window begun before the card has taken any
header begins at the first header it takes); `GET_INFO` P1 = 4 bytes 51 to 54 and
`GET_CARD` bytes 83 to 86 say when. It ends:

- at the owner's next good proof, whatever the command, and even where the command
  is then refused for something else, and at a `SET_LIMIT_PIN` that carries the
  allowance: the count goes to 0 and no window runs;
- or at a payment with no PIN that finds the allowance **armed** and, with the
  window of 24 hours (`GET_CARD` byte 87 `00`, the default), `now` 86,400 seconds
  or more past the window's start; with no window (`01`) the arming alone does it.
  The count goes to 0 and the payment begins a new window.

The clock alone never brings the allowance back. The payment with no PIN that
begins a window, whether one ran before it or not, spends the arming: one allowance
for each arming. The allowance is armed by an owner's good proof, by a
`SET_LIMIT_PIN` that carries it, or by a `VERIFY_PIN` in a time in the field in
which no payment has been or is then signed: a payment's commit takes back an
arming a `VERIFY_PIN` gave earlier in the same time in the field, and leaves one
from an earlier time in the field as it is. So a PIN typed for a payment at a reader opens no allowance for whoever taps
the card next, and a holder's own phone that takes the PIN in a tap that pays
nothing (a top-up, a look at the history) arms it. `GET_CARD` byte 78 says whether
it is armed. A payment with no PIN that the window's count and its whole pieces
would take past the allowance is `6A9E`, "limit reached, enter the PIN": given up,
and written in the log as a refusal over a limit; with the PIN the same payment
goes through. An allowance of 0, or a blocked PIN, is `6A94`, with nothing written.
A payment with the PIN neither counts nor begins a window. `GET_INFO` bytes 38 to
41 are the count of the window that runs, zeros where none does.

**Every payment waits (2.3, [D188](../docs/DECISIONS.md#d188)).** A payment is at
least `WAIT_FLOOR_SIGNS` (4) signatures of the card's work from `SPEND_ALL_BEGIN`
to its signature, its own among them, within its limit or not, so that no payment
is had in a brush of a tap. The waits for a payment over the limit on one payment
and for a second payment in a time in the field are 2.2's and come on top of the
floor:

    waits = max(0, (WAIT_FLOOR_SIGNS − 1) + W − ⌊2 × outputs / 3⌋)

with W 2.2's wait (0 within the limit; `WAIT_OVER_SIGNS` + `WAIT_MORE_SIGNS` ×
(N − 2) for N limits' worth leaving the card; `WAIT_OVER_SIGNS` for a second
payment in the time in the field, unless the owner's grant is in the tap) and
outputs the change outputs the card made in this payment (each about two thirds of
a signature's work). Each wait is one `SPEND_ALL_SIGN` answered `00 01`. On a
slower chip the floor is about three seconds: on a J3R180 (2026-11-13) a payment
whose four change outputs took two of its three waits off answered one "not yet"
and was signed 3.9 s after its `SPEND_ALL_BEGIN`.

**Two units ([Two units on one card](#two-units-on-one-card)).** A payment in the
other unit than the card's is counted in the card's unit at the rate (sats to the
dollar): sats as `ceil(sats × 100 / rate)` cents on a usd card, cents as
`ceil(cents × rate / 100)` sats on a sat card, a result past four bytes taken as
over every limit, at the first `SIGN` and again at the last. With any limit set
and no rate, such a payment is `6A99`, and pieces of the other unit are refused
`6A99` at `LOAD_PROOF`, so that no card holds pieces no payment could take off.

What a card risks follows from these limits. A reader handed the PIN takes at
most the daily limit in each window, for as many windows as the rollover budget
allows between the owner's refreshes, at the pace the waits allow, and it can
change nothing of the owner's: the PIN, the limits, the record or the owner. A
lost card is lost money up to its limits for whoever learns its PIN, and up to its
no-PIN allowance, once per arming, for anyone.

---

<a id="profiles-of-23"></a>

## Profiles of 2.3

NUT-CCP leaves these to implementations. A card says which it keeps in `GET_INFO`
P1 = 4, bytes 55 and 56. The card in this repository keeps all of them. The wait
on every payment and the no-PIN window are in
[The clock and the limits](#the-clock-and-the-limits).

### PIN before money

[D185](../docs/DECISIONS.md#d185). A card is given its PIN before anything goes on
it or leaves it.

- A card with no PIN refuses `LOAD_PROOF`, `CLEAR_SPENT`, `LOAD_CHANGE`,
  `KEYSET_KEYS`, every payment command (`22` to `26`), an owner's claim and the
  let-go form of `RESET_CARD` with `6A97`, a word nothing else answers. `SET_PIN`
  stays open on a card with no owner and nothing on it.
- Every `LOAD_PROOF` and `CLEAR_SPENT` wants the PIN given in this tap. The
  owner's grant opens no load, and no tap is the tap after a payment: the card's
  own change comes back by `LOAD_CHANGE`, which wants nothing.
- While change is owed, `SET_CARD`, `RESET_CARD` (P1 = 0), and on a card with no
  owner `SET_PIN` and `SET_LIMIT_PIN`, answer `6A8D`: the mint, the unit and the
  refund key stay as the change's secret was built with them.
- A load above the day's limit is refused (`6A8F`, [D196](../docs/DECISIONS.md#d196)):
  no piece goes on that no payment could take off.
- No card has an owner and no PIN: an owner is claimed only under the PIN, and
  `SET_PIN` on an owned card is `6A91`. A blocked PIN is unblocked by the owner's
  `CHANGE_PIN`. A card with no owner never blocks: each wrong try makes the next
  wait twice as long ([VERIFY_PIN](#verify_pin-0x40)), and after three in a row
  `SET_PIN` replaces the PIN with nothing owed, its numbers kept and its history
  gone.

### The owner claimed slowly

[D187](../docs/DECISIONS.md#d187). `SET_OWNER` on a card with no owner is a claim:
the PIN set and given in this tap, in the card's first set-up alone (`6A91` after it,
[D196](../docs/DECISIONS.md#d196)), never in a time in the field in which a payment
was signed, only on an empty card (nothing unspent and no change owed, `6A8D`, as
on 2.2), the same data asked six times in a row, the first five answered `6A98`
after a signature's work each (some three seconds in all on a chip; the six took 4.1 s on a J3R180). After a claim, no payment command
is taken for the rest of that time in the field (`6985`). A phone sends
`SET_OWNER` again for as long as the card answers `6A98`, and tells the holder to
keep holding the card; a phone that asks once never takes `6A98` for done. A claim
may give the card the owner's c, made from its words (`SET_OWNER` P1 = `01` just
before it, and the check at the end of the data, [SET_OWNER](#set_owner-0x43),
[D202](../docs/DECISIONS.md#d202)).

A claim moves no money: a card is claimed empty, in the set-up that its first PIN
or a reset begins. A holder with no phone who later wants a phone as the card's
owner does it in four steps: the money moved to the phone (paid to it under the PIN,
within the limits), the empty card reset by the PIN ([RESET_CARD](#reset_card-0x51),
about 45 seconds of holding), set up again with the phone, which claims it in that
first set-up, and the money loaded again under the PIN.

### Two units on one card

[D184](../docs/DECISIONS.md#d184). A card holds `sat` and `usd` pieces at its one
mint, told apart by keyset.

- **The keyset table.** The first `SET_CARD` that goes through reserves it, once,
  outside any transaction: six entries, each the keyset's 8 bytes, a state byte
  and, for [keyset keys](#keyset-keys), the top of a tree of its keys (32); then
  the last payment's unit (1), the other unit's count of what was signed for, ever
  (4), and the receipts' units (16): 267 bytes. A card refused the room is a card
  of one unit: a load labelled the other unit is `6A9C`. Every use of the table is
  safe while it is not there.
- **The state byte.** `00` free; `40` in use; `80` added for the holder's mark (the
  entry made with the holder's say in the tap); bit 0 the unit (`0` sat, `1` usd);
  bit 1 the keys known (a top kept). The keyset's 8 bytes are written, then the
  state byte, the entry's commit.
- **Every piece is of one unit.** `LOAD_PROOF` P2 = 1 names the pieces' unit; P2 = 0
  means the card's. A keyset in an entry of the other unit is `6A9B`. A keyset in no
  entry is entered: under the PIN alone as the card's unit or the last payment's,
  and as either unit with the holder's say in the tap (the owner's grant; with no
  owner, a held tap), which marks it (`6A9D` otherwise). At most two live entries
  lack the mark; a new keyset with no entry free, or that would be a third without
  the mark, runs the reclaim and looks again (`6A9C` if it still finds none).
  `LOAD_CHANGE` enters nothing: change is in its opening's keyset.
- **The reclaim** lets go every entry that no unspent place and no opening, drafted
  or owed, names, one byte written for each, outside any transaction. It runs at
  `CLEAR_SPENT`, at a load that finds the table full, and at `SET_CARD`. A live
  entry is never freed or changed in place, so no command moves a piece from one
  unit to the other.
- **One unit a payment.** `SPEND_ALL_BEGIN` refuses places of both units, or a place
  whose keyset is in no entry, with `6A9A`.
- **Limits** are in the card's unit, the other unit counted at the rate (`SET_LIMIT`
  bytes 13 to 16) as [The clock and the limits](#the-clock-and-the-limits) says.
- **What the card says.** `GET_INFO` byte 8 and `GET_CARD` byte 0 are `05` where an
  entry in use is of the other unit, `04` otherwise, worked out at each asking, so
  that a phone that knows only format 4 refuses a card of both units and never reads
  cents as sats. `GET_INFO` P1 = 3, `GET_CARD` P1 = 2, `GET_BALANCE` P1 = 1 and
  `GET_LOG` P1 = 2 and 3 say the rest. Nothing on the card adds the two units.
- `RESET_CARD` frees every entry; `SET_CARD` on an empty card owed nothing frees
  every entry and forgets the last payment's unit.

### A holder with no phone

[D189](../docs/DECISIONS.md#d189). A card with a PIN and no owner is the card of a
holder with no phone of their own. A phone that sends it money sets it up and loads
it under the holder's PIN, and does not become its owner; the holder reads the
history on another phone as a guest.

1. `SET_CARD`, `LOAD_PROOF` and `CLEAR_SPENT` go through on such a card with the PIN
   given in this tap (`6982` without it). `LOAD_PROOF` does not ask for an owner.
2. **A simple card** ([D196](../docs/DECISIONS.md#d196)). The holder's numbers (limits,
   allowance, window switch, budget, rate) are set by `SET_LIMIT_PIN` under the PIN, and
   the record (mint, unit, refund key) by `SET_CARD`, in the card's first set-up
   ([SET_PIN](#set_pin-0x41)) and never after (`6A91`). A load above the day's limit is
   refused, so no piece on the card is one no payment could take. Other numbers, or an
   owner, come by a reset (item 8). The numbers are set **before** the record: a set-up
   cut between the two leaves a card with no record, which takes nothing (`6A8C`) until
   it is set up again; the other order would leave a card that loads with no limits.
   Numbers sent before the card's first holder's record are in the unit that record
   names (cents on a usd card): `SET_CARD` turns nothing on a card with no record of a
   holder's ([SET_CARD](#set_card-0x32)). Then, in the same set-up, `SET_HEADER` with a
   recent block header gives the card its clock (a card with none runs at `now = 0`:
   its first day of loads on trust, and 300 loads in all until its first header). The
   phone then reads `GET_INFO` P1 = `04` and `GET_CARD` back, before the first load, to
   see the numbers and the record are the ones it sent.
3. **The held tap.** `GET_LOG` wants the PIN given in this tap, and is refused
   (`6985`) in a time in the field in which a payment was signed. Each of the first
   nine askings in a row is answered `6A98`, keep holding, after a signature's work
   of the card's own, thrown away; the tenth answers (some five seconds on a chip).
   The log and the receipts count as one hold. Any other command, a `SELECT` among
   them, begins the count again. Once answered, the history is open to the PIN for
   the rest of that time in the field, which is then a **held tap**: no payment
   command is taken in it (`6985`). The balance and the pieces are never held for.
4. **The holder's say.** On a card with no owner a held tap stands where the owner's
   grant stands on an owned one: to mark a new keyset, to bind an opening to another
   key, to give an opening up, to send `REFRESH` P1 = 1, to change a used card's PIN,
   and to reset an empty card.
5. **A used card's PIN is changed only after a hold.** On a card with no owner whose log
   has taps in it, `SET_PIN` under the PIN wants a held tap: `6985` in a tap that
   paid, `6982` with no hold. `SET_CARD` and `SET_LIMIT_PIN` write nothing after the
   first set-up, held or not.
6. **The card keeps its PIN, and the PIN never blocks.** A card with a PIN takes a new
   PIN only under the PIN it has (and a hold, once used). A wrong try makes the next wait twice as long
   ([VERIFY_PIN](#verify_pin-0x40)), and nobody strands the money by guessing: the
   holder's right PIN, after the wait, opens it. After three wrong tries in a row (a
   forgotten PIN) the PIN is replaced with nothing owed, and the history goes with it
   (the log, the receipts, the kept signatures, the last packet, the other unit's
   count and the receipts' units); the numbers stay, and no first set-up begins.
7. **A factory record.** An issuer may write a record whose mint is `-` alone, to
   carry the card's design to a new card before a holder sets it up, and only to a
   card that has never had a PIN. It counts as no record: `LOAD_PROOF` answers `6A8C`.
   Whoever gives a card its first PIN sets it up: a card that reaches its holder set up
   by someone else answers the holder's `SET_PIN` with `6982`, and the holder resets it
   (three wrong tries, `SET_PIN`, then the reset of item 8) unless it was claimed.
8. **Other numbers, or an owner, later.** The holder empties the card, resets it by
   the PIN in a held tap ([RESET_CARD](#reset_card-0x51): sixty askings, about 45
   seconds), and sets it up again: with a phone, which claims it in that first set-up
   ([The owner claimed slowly](#the-owner-claimed-slowly)), or by the PIN alone. The
   reset is slow so that no till can do it while it takes a payment; anyone with the
   PIN who holds the empty card for about 45 seconds can, and can set it up again with
   numbers, a refund key or an owner of its own (the risk accepted in
   [RESET_CARD](#reset_card-0x51)). A guest wallet that does not know the card cannot
   tell; the holder's own phone checks `GROUP_KEYS` before a top-up
   ([Keys per load](#keys-per-load)).
9. **The guest sees the limit on one payment.** `GET_INFO` bytes 30 to 33 and the
   rate (44 to 47) are told to the PIN in a held tap on a card with no owner.

### Keyset keys

[D190](../docs/DECISIONS.md#d190). The card holds the keys it writes change under
to their keyset's ID.

- `KEYSET_KEYS` P1 = 0 to 2 teaches the card a keyset's keys, under the PIN given in
  the tap (the owner's grant alone does not teach). The card works out the keyset's
  ID from them as NUT-02 says and keeps the top of a tree of the keys only where the
  ID's first 8 bytes are the keyset's; a version 01 ID's unit must be its entry's,
  and a version 00 ID, which hashes the keys alone, has its n-th key held to the
  amount 2^n. A reader with no PIN cannot teach it, and keys that do not hash to the
  keyset's ID are never kept.
- A change output is made only in a keyset the card holds (in its table) and was
  taught (`SPEND_ALL_CHANGE`, `6A9F` otherwise): a reader with no PIN writes nothing
  in the table.
- An opening's key is shown to be one of its keyset's keys by its path in the tree
  (`KEYSET_KEYS` P1 = 3, any reader). `LOAD_CHANGE` writes nothing under a key not
  shown (`6A9F`).
- A holder mends an opening a reader bound to a key that is not the mint's by
  binding it to the mint's key with its path, under the PIN, in a tap that paid
  nothing, with the holder's say (`KEYSET_KEYS` P1 = 3 with another key); and moves
  an opening to another taught keyset of its unit, where the mint signed its change
  (`KEYSET_KEYS` P1 = 3 with another key and that keyset).
- **The bound.** The card cannot tell a mint's keyset from keys a holder made up:
  any 8 bytes can name an entry (a piece of them, loaded under the PIN), and keys
  whose ID begins with them are found with no search. What keeps a reader from
  teaching keys of its own is the PIN alone. A reader that has the PIN can already
  pay up to the card's limits.
- The holder's phone teaches the mint's active keyset whenever it loads a piece of
  it, or no change is made in it: a till pays exactly, or not at all, until then. A
  keyset of more than 64 keys is not taught (`6A80`).

### The paid list

[D191](../docs/DECISIONS.md#d191). The card keeps the first 8 bytes of the nonce of
each of the last 1,024 pieces it has signed for, and `LOAD_PROOF` refuses a piece
whose nonce begins with one of them (`6A94`), so that a piece the card has signed
for is not loaded again and signed a second time.

- Reserved at the first `SET_CARD`: 8,192 bytes (1,024 rows of 8), its next row (2)
  and a byte that says the ring has gone round (1). A card that could not reserve it
  takes no piece: `LOAD_PROOF` and `LOAD_CHANGE` answer `6A84`.
- The ring fills from its first row. The rows in use are those before the next row
  until the ring has gone round, and every row after; a row not in use is not read.
- Written for every place a payment burns, after the payment's commit, as the burn
  is: rows written twice are the same rows, so a tear is finished by the next
  command. The next row moves on in the payment's transaction.
- Kept through `CLEAR_SPENT`, and through `RESET_CARD` where the card keeps its key.
  A card that makes a new key starts an empty list: its next row and the round go
  back to 0 once the new key is made.
- **The bound.** A piece signed for more than 1,024 pieces ago can be loaded and
  signed again. **A card loads at most 300 pieces a day by its own clock**
  ([D195](../docs/DECISIONS.md#d195)): `LOAD_PROOF`'s, and the change of the payments
  it signs, counted at the signature ([D200](../docs/DECISIONS.md#d200)), so the
  holder (the PIN) can push 1,024 pieces through the list in no less than a little
  over three days of the card's clock (four days of loads), where it had taken
  minutes: `LOAD_PROOF` checks no mint's proof, and a mint's proof would not help,
  since the holder can teach keys of its own. A load past the day's 300 is `6A8F`,
  with nothing written. A day of loads begins at the first load a day or more (by
  the card's `now`) after the last began; a card that has taken no header loads 300
  pieces and then nothing until its first header. The count and its day are in
  lasting memory, written in one atomic copy before the piece (and in the payment's
  commit for its change); `RESET_CARD` begins them again with its new c, since no
  piece loaded before it is one the card signs for again, and a hand-over does the
  same. The days are the card's clock's, which a reader moves only to the
  real chain's tip: a card whose clock has fallen days behind lets the days it
  missed be loaded at once, so a reader that takes a payment offline sends the
  card a recent header first. The paid list stops a reader that has the PIN for
  one tap, and a holder's mistake; it slows, and does not stop, a holder who means
  to pay one piece to two offline readers. A reader that takes a payment
  offline still checks each piece's DLEQ proof and posts the swap first (NUT-CCP,
  [Accepting a payment offline](https://github.com/cashucard/nut/blob/main/CCP.md#accepting-a-payment-offline)).
- After the list, the signature of each payment whose receipt the card keeps
  (16 × 65 bytes), for `SPEND_ALL_AGAIN` P1 = `01`: a payment whose answer was lost is
  signed again for its own outputs only, never a second time for others.

### Keys per load

[D197](../docs/DECISIONS.md#d197). Every piece is locked to the card's key for its
date, and a payment, which is of one date, is signed with that key. Keys per load
is part of the 2.3 card format, not a profile a card may leave out: every 2.3 card
keeps it (`GET_INFO` P1 = `04` byte 56 bit 1), and a reader of 2.3 cards loads and
pays only this way. The mint sees one key for the pieces of one date, and no key
that ties two dates, or a date to the card.

- The card keeps a secret c (32 bytes), drawn at install, at every `RESET_CARD` and
  when `SET_OWNER` replaces an owner; or the owner's, made from its words and taken at
  the claim or the hand-over ([SET_OWNER](#set_owner-0x43), [D202](../docs/DECISIONS.md#d202)).
- For a date D (the four bytes every piece carries; `00000000` for an undated
  piece): t = SHA-256(`CashuCard/key` ‖ c ‖ D) mod n, and the card's key for D is
  P + t·G; u = SHA-256(`CashuCard/refund-key` ‖ c ‖ D) mod n, and the refund key for
  D is R + u·G (where the record has a refund key R).
- A piece of date D is the card proof secret of NUT-CCP with `data` P + t·G and, for
  a dated piece, `["refund", R + u·G]`. The card signs a payment of date D with
  d + t mod n. Its own change is of the payment's date, so under the same keys.
- **Never lock ecash to the card's key P itself.** A sender, a wallet or a tool
  **MUST NOT** lock ecash to P, the key `GET_PUBKEY` answers (and a certificate
  names): a 2.3 card signs a payment only with d + t, never with d alone, so ecash
  locked to P can never be spent by the card. Undated, it is lost; dated, it comes
  back to the refund key only after its date. A 2.2 wallet, which swaps to P and only
  then meets `6A86` at `LOAD_PROOF`, loses an undated top-up so: a 2.3 card is
  loaded by a 2.3 wallet. P is for checking the card (`AUTH`, the certificate), not
  for locking money.
- Who works the keys out: the holder's phone, from c (its own, from its words, where
  the card took the owner's c; or `GET_CARD` P1 = 3, sealed: on a
  card with a refund key, to the refund key, at any tap under the owner's grant, or
  on a card with no owner the PIN given in this tap; on one with none, to the owner's
  grant, or on a card with no owner in its first set-up only), for every date it
  loads or refunds; any other loader asks the
  card (`GROUP_KEYS`, under the PIN it loads with); a till takes t and R + u·G from
  `SPEND_ALL_BEGIN`, and says it builds the secrets with them (P1 bit 1, `02`; `6A86`
  without it, with nothing burned). A loader says it locked the pieces to them
  (`LOAD_PROOF` and `LOAD_CHANGE` P2 bit 1, `02`; `6A86` without it, with nothing
  written). The refund key for D is spent with r + u mod n, where r is the refund
  key's private key: a wallet keeps c with r, since a refund needs both.
- **The load date.** D is the pieces' NUT-11 locktime: the time from which the refund
  key can spend them. A wallet picks D in the future, at the refund date it wants
  (never the time of the load, which would open the refund at once: the holder's
  phone could then spend pieces still on the card, and a till paid by the card
  offline would lose). Top-ups share one date for 7 days: a wallet reuses the date it
  used for the first load of the week for every load within 7 days of that load, and
  takes a new date after that; so D is at least 8 days and the time to move ahead
  at its first use (the week of loads, the readers' day below, and the time the
  wallet takes to move the pieces; for example 30 days), never a date that falls while
  that week's loads are still made, nor before the wallet expects to move the pieces
  (below). A payment is of one date, so pieces of one
  date pay together; the mint can tie the spends of one week's loads to each other,
  and never across weeks or to the card.
- **Before D.** The card does not read dates: its change keeps the payment's date,
  and a piece stays payable after its date. The holder's wallet moves the pieces of a
  date to a new date (it pays them to itself and loads the swap's outputs under the
  new date) so that the move ends before D less a day (the readers' margin below),
  starting it at least the time the move takes before that: from D less a day every
  honest reader, the holder's own wallet among them, leaves those pieces out of a
  payment, the move's too, and they wait on the card until the owner takes them back
  a day after D. A reader,
  online or not, **MUST** leave out of a payment a dated piece whose locktime is less
  than a day after its own time (or will pass before it can swap): the refund key may
  spend it from D, and the reader's clock and the owner's differ
  ([INBOX](#inbox-0x1e), [D203](../docs/DECISIONS.md#d203)), and
  the mint would refuse the swap after the card spent every piece of the payment. An
  online reader **SHOULD**, before `SPEND_ALL_SIGN`, check that every input's keyset
  is a keyset of the mint `GET_CARD` names, in the card's unit, and ask that mint
  every input's state (NUT-07), and give the payment up for a piece the mint does
  not answer `UNSPENT` for, so that one bad piece never burns good ones. A piece
  filed for the card's inbox is dated on its own, 14 days from its filing
  ([INBOX](#inbox-0x1e)).
- **Undated pieces** are all of the date 0, one group for the card's life (until a
  reset or an owner replaced): the mint ties every undated spend to one key, as before
  2.3. A card with no refund key takes only undated pieces (`6A8E`), so it gains
  nothing from keys per load; the gain is a wallet's that loads dated pieces.
- **Swap no more than the card will take.** A wallet swaps for at most the card's free
  places (`GET_INFO` byte 5), less up to 8 left free for the change of the payments to
  come (change that finds no free place stays owed, `LOAD_CHANGE` `6A84`, until a
  place is freed), and the pieces it will still load today (`GET_INFO` P1 = `04`
  bytes 57 and 58, of 300), and prefers dated pieces: an undated top-up swapped past
  what the card takes waits in the phone, locked to the card's keys, and is lost if
  the card is reset or lost first.
- **Check that the card will take this mint's pieces**, before swapping:
  - the keyset table: `GET_INFO` P1 = `03` byte 43 (the table kept), byte 48 (entries
    in use, of 6) and byte 49 (entries without the holder's mark, of 2), and the
    entries themselves (`GET_CARD` P1 = 2). A keyset already in an entry of the
    pieces' unit is taken. A new keyset needs a free entry, and under the PIN alone
    it must not be a third without the mark: otherwise the load is `6A9C`, and stays
    so while older keysets still hold pieces or openings, since the reclaim frees only
    entries nothing names. A wallet that finds no room swaps into a keyset the card
    has, or asks for the holder's say, or waits until the older pieces are paid;
  - the unit: `GET_CARD` byte 2. Pieces of the other unit need the holder's say in
    the tap for a new keyset (`6A9D`), and on a card with a limit set a rate
    (`GET_INFO` P1 = `03` bytes 44 to 47, said to the holder's say alone; `6A99` with
    none): a loader that cannot read the rate loads only the card's unit on a card
    with a limit;
  - the refund key, for dated pieces: a card with none takes only undated pieces
    (`6A8E`).
- **Before a top-up**, a wallet that keeps P, R and c compares `GROUP_KEYS` for the
  date it is about to load with the keys it works out itself. A card reset since (by
  its owner, or by the PIN on a card with no owner), or whose owner was replaced, has
  a new c and answers other keys; the generation (`GET_OUTBOX`) cannot show this to a
  reader without the PIN, and says nothing on a card with no record.
- **What a reader holding the card learns** (with no PIN and no grant), and so, with
  the mint's records, what it ties to the card: the keys of every date with a piece on
  the card (`SPEND_ALL_BEGIN` answers t and R + u·G before any PIN, because a till
  needs t to check the pieces' proofs), and so every spend of those dates, a week's
  loads already spent among them, and every undated spend; the swap that made each
  piece still on the card (`GET_DLEQ` gives its r, and C + r·K is the blind signature
  the mint issued: for change, the payment that made it; for a load with its proof,
  the holder's top-up); and the card's no-PIN payments among the last sixteen
  (`SPEND_ALL_AGAIN` P1 = `01` answers `9000` for their hashes). This is the honest
  limit of the card's privacy against someone holding it. A reader given the PIN
  learns as much, and every date's keys (`GROUP_KEYS`). A listener on the air learns
  what the reader it listens to is told.
- Nothing about a mint changes: the secrets are ordinary NUT-11 P2PK, every input of
  a swap has the same key and tags (NUT-11 `SIG_ALL`), and the mint checks the
  signature against `data`.

### The certificate

[D192](../docs/DECISIONS.md#d192). An issuer's certificate for the card key, in
NUT-CCP's
[certificate profile](https://github.com/cashucard/nut/blob/main/profiles/certificate.md)
format: written by [CERT_WRITE](#cert_write-0x54) on a card that has never had a
PIN, sealed once it names the card's own key and its SHA-256 is the one its writer sends,
read by anyone with [CERT_READ](#cert_read-0x1c), and kept with the card key through
`RESET_CARD`. Linking, plainly: a certified card keeps one key across its holders, so
anyone the card pays, and anyone who reads it (`GET_PUBKEY`, `AUTH`, the
certificate), can tell it is the same card under every holder; and every card, certified
or not, keeps its installation (`GET_OUTBOX` P1 = `00`'s scope names it through the
payment id's generation, and the packet holds it) across a reset. Ecash locked to a
certified card's keys for a date before a hand-over is not the next holder's to pay:
the reset draws a new c, so the card builds other keys for that date, and could never
spend it. It is the old holder's to refund (r + u of the old c, after its date), and
an undated one is lost: the holder refunds or loads what is owed before a hand-over.
A sender who is not the holder has no way to lock ecash to the card: the date keys
come from c or from `GROUP_KEYS`, which are the holder's (the PIN or the grant), and
the certificate's key P is never one to lock to ([Keys per load](#keys-per-load)). A
gift goes to the holder's wallet, which loads it.

A payment is signed by the card's key for its date, P + t·G, not by P
([Keys per load](#keys-per-load)): a reader that checks the certificate checks it
over P (`GET_PUBKEY`, `AUTH`), then checks that the payment's key is P + t·G with
the t `SPEND_ALL_BEGIN` answered. A known tweak takes nothing from the key: anyone
can work out P + t·G, only the card can sign for it.

The card stores the container and checks only that it names the card's own key.
Who vouches for a card, and how a reader decides whether to believe them, is the
certificate profile's and the reader's: the card has no part in it.

---

## Error Code Summary

| SW | Meaning |
|---|---|
| 9000 | Success |
| 6200 | `ALLOW_LOAD`: the owner's grant given for this tap, no load opened by it (a warning: lasting memory unchanged) |
| 6700 | Wrong length |
| 6982 | Security status not satisfied: the PIN (or a grant, or a held tap) needed and not given in this tap; the last payment's record or its scope (`GET_OUTBOX`), c (`GET_CARD` P1 = `03`) or a date's keys (`GROUP_KEYS`) asked by a reader not given them |
| 6983 | PIN blocked (a card with an owner): the counter spent, or the PIN state 2 |
| 6984 | PIN not set |
| 6985 | Conditions not satisfied: already spent, no payment begun, already locked; a clock that has taken no header (`INBOX`); outputs after the card's own change (`SPEND_ALL_OUTPUTS`); no sixteen bytes live (a sealed command, `GET_CARD` P1 = `03`); no owner's c kept for a claim or hand-over that gives its check (`SET_OWNER`); a teaching not begun (`KEYSET_KEYS` P1 = 1 or 2); an allowance on a card with no PIN (`SET_LIMIT`); a payment in a time in the field that claimed an owner or read a history, and a claim, a history, a rewrite or another key in one that paid; a certificate sealed, or a card that has had a PIN (`CERT_WRITE`) |
| 6986 | Card locked |
| 6A80 | Wrong data: not a point, a bad refund key or unit, a factory record on a card that has had a PIN or holds a holder's record, bits no header could carry, a budget outside 1–30, a key not bound, a proof that does not hold, a path that does not reach the top, an owner's c that does not open or a check that is not its (`SET_OWNER`), a certificate that does not name the card or is not the one hashed, outputs and change past the pieces, a keyset's unit or amounts not its ID's |
| 6A82 | Not found (the card's runtime): no applet of this name (an earlier 0.x or 1.x applet is one possible cause) |
| 6A83 | Slot or opening out of range, or an offset at or past the end (`GET_OUTBOX`, `CERT_READ`, `CERT_WRITE`) |
| 6A84 | No space: no slot, no change opening, no keyset table to make change in, or no room the card could reserve |
| 6A86 | Incorrect P1 or P2; a payment begun without P1 bit 1, or a load (`LOAD_PROOF`, `LOAD_CHANGE`) without P2 bit 1: no word on keys per load |
| 6A88 | Slot empty (a spent slot, to a reader with neither the PIN nor the grant), no signature to give again (none kept for that message), no payment record (`GET_OUTBOX`), an opening not owed, a keyset in no entry (`KEYSET_KEYS`), no certificate (`CERT_READ`) |
| 6A8C | No card record, or a factory record (a load, a claim, and `INBOX`) |
| 6A8D | Card in use: something unspent, or change owed, where only an empty card may be changed |
| 6A8E | A dated piece on a card with no refund key |
| 6A8F | Over the day's limit: a payment, or a piece loaded (`LOAD_PROOF`); a load past the day's 300 pieces (`LOAD_PROOF`), or change a payment would make past them (`SPEND_ALL_CHANGE`, `SPEND_ALL_SIGN`) |
| 6A90 | No owner |
| 6A91 | The owner's proof missing, wrong or used, or a command not open to an owned card; on a card with no owner past its first set-up, a record (`SET_CARD`), a number (`SET_LIMIT_PIN`) or a claim (`SET_OWNER`), which are set once |
| 6A93 | Too little work in a block header |
| 6A94 | A piece already on the card or on the paid list (`LOAD_PROOF`), or an opening's piece already on it; the PIN needed for this payment (`SPEND_ALL_SIGN`: an allowance of 0 or a blocked PIN) |
| 6A96 | Too many places for one signature; a payment's, a record's (`SET_CARD`) or an owner's (`SET_OWNER`) transaction the chip cannot hold, nothing written |
| 6A97 | No PIN: the card takes and pays nothing until it is given one |
| 6A98 | Keep holding: a held count not yet through (an owner's claim, a history, a reset by the PIN, the PIN's wait on a card with no owner); send the same command again |
| 6A99 | No rate: a payment or a load of the other unit, or a new unit (`SET_CARD`, on a card with a holder's record), on a card with a limit set and no rate |
| 6A9A | Two units in one payment, or a place whose keyset is in no entry |
| 6A9B | The other unit: a keyset in the table as the other unit than the command names; a payment in the other unit than the card's begun without P1 bit 0 (`01`) |
| 6A9C | No room in the keyset table, or a label of the other unit on a card with no table |
| 6A9D | Not this tap's to start: a new keyset of the other unit without the holder's say |
| 6A9E | Limit reached, enter the PIN: a payment with no PIN past what the no-PIN window has left |
| 6A9F | Keys not shown: the keyset's keys not taught to the card (change is made only in a taught keyset), or the opening's key not shown to be one of them |
| 6B00 | Wrong P1/P2: a missing confirmation byte (`LOCK_CARD`, `RESET_CARD`), a number that is not P2 (`RESET_CARD` P1 = 1), a load's P2 with a bit past bit 1 (`LOAD_PROOF`), a tag switch other than `00` or `01` or a byte that is not P1 (`SET_TAG`), a P1 or P2 other than `00` (`INBOX`), a P1 other than `00` or `01` or a P2 other than `00` (`SET_OWNER`), a P1 other than `00` or `01` (`REFRESH`) |
| 6D00 | Instruction not supported |
| 6E00 | Class not supported |
| 6F00 | Signing failed |
| 63CX | Wrong PIN: X tries left on a card with an owner; X wrong tries in a row on a card with none (`F` for fifteen or more), the next try waiting |

---

## Proof Slot Layout

```
Offset  Size  Field
──────  ────  ─────────────────────────────────────────
0       1     status      (00 empty, 01 unspent, 02 spent; written last)
1       8     keyset_id   (raw, the NUT-02 id's first 8 bytes)
9       4     amount      (uint32, big-endian)
13      32    nonce       (raw; the card rebuilds the P2PK secret from it)
45      33    C           (compressed point)
78      4     date        (locktime, seconds; 0 for none)
──────  ────
Total:  82 bytes per slot × 128 slots
```

The secret the card rebuilds, and signs the hash of within the `SIG_ALL` message,
is NUT-CCP's format-4 [card proof secret](https://github.com/cashucard/nut/blob/main/CCP.md#card-proofs). A piece loaded with the mint's proof also
has 96 bytes (`e ‖ s ‖ r`) beside its slot ([GET_DLEQ](#get_dleq-0x1a)).

---

## Session State (Transient)

Gone with the tap (`CLEAR_ON_DESELECT`): the PIN verified, the owner's nonce and
whether it is live, the owner's grant, a payment begun and its places, sum and
change, a teaching of keyset keys begun, and the count of a held tap (a claim's
askings, a history's, a reset's by the PIN, or the askings of a stretch of the PIN's
wait). Gone with the power, kept through a `SELECT` (this time
in the field): the time the reader told, whether a payment was signed in it,
whether an owner was claimed in it, whether a history was read in it (a held tap),
and whether a `VERIFY_PIN` in it armed the allowance. Kept in lasting memory, though
they read like a tap's: the PIN's wrong tries in a row and the askings owed
([VERIFY_PIN](#verify_pin-0x40)), and the first set-up's mark, which every selection
ends ([SET_PIN](#set_pin-0x41)).

---

## Personalisation

A 2.3 card is set up in one tap, its first set-up ([SET_PIN](#set_pin-0x41)), owner
last. A set-up cut short is finished only after a reset (by the owner's proof where
the claim went through, by the PIN where it did not, [RESET_CARD](#reset_card-0x51)).
Every set-up gives the card the tip the wallet has checked before any load: the claim's
anchor in step 3, or `SET_HEADER` on a card with no owner (below). In a first set-up
of an empty card that header is the clock even where the card's clock was later, and
its hardest where it is harder ([A header far ahead](#set_header-0x36), At set-up;
[D204](../docs/DECISIONS.md#d204)), so a clock a stranger's header set is let go.

1. `SET_PIN`, `VERIFY_PIN`: a card with no PIN takes nothing.
2. `SET_CARD`: unit, refund key, mint.
3. `GET_NONCE` P1 = `01` (the PIN key, its signature checked), `SET_OWNER` P1 = `01`
   with the owner's c sealed to it, then `SET_OWNER` with the tip header as its anchor
   and the c's check, sent until the card stops answering `6A98` (six askings).
4. `GET_NONCE`, `SET_LIMIT` (18 bytes, with the rollover budget, the rate and the
   no-PIN window's switch), if the holder wants limits. A wallet that wants the
   no-PIN allowance to come back only when the holder's phone or PIN is seen, never
   after a time, writes `01` at byte 17.

Then the owner's phone reads c (`GET_CARD` P1 = 3, under its grant), checks it is the
owner's c of its s, s worked out from the card's own `GET_PUBKEY` in this tap
([SET_OWNER](#set_owner-0x43)), and keeps c with the refund key's private key r, and
the card's key P with them (a phone restored from the words needs P as well as c to
take back a lost card's dated pieces, [D202](../docs/DECISIONS.md#d202)); and it reads
`GET_INFO` P1 = `04` and `GET_CARD` back before the first load.

A card for a holder with no phone sets its numbers with `SET_LIMIT_PIN` after step
1 and before step 2 (in the unit the record of step 2 names: cents on a usd card),
then `SET_HEADER` with the tip (the first set-up's anchor, which it **MUST** give), and stops there: a set-up cut between the numbers
and the record leaves no record, and a card with no record takes nothing. Whoever
holds the refund key's r (the wallet that set the card up, or the holder's own
wallet on another phone) reads c with the PIN at any later tap; on a card with no
refund key, c is given only in this first set-up, to the reader the PIN is typed
into. The wallet reads `GET_INFO` P1 = `04` and `GET_CARD` back before the first
load. An issuer that certifies its cards writes and seals the
certificate (`CERT_WRITE`) before any PIN, and may write a factory record
(`SET_CARD` with the mint `-`) to carry the card's design.

---

## Provisioning Flow (Top-Up)

The owner's phone, or for a holder with no phone any phone with the holder's PIN:
`VERIFY_PIN`, `GET_INFO` P1 = `04` (the free places, less up to 8 for change, and the
loads left today: swap for no more; the keyset table, the rate, and with `GET_CARD`
the unit and the refund key: swap only for pieces the card will take, as
[Keys per load](#keys-per-load) lists), then `LOAD_PROOF` (P2 = `02`, the word on keys per load; P1 = 1 with the
mint's proof; P2 = `03` with the unit) for format-4 pieces locked to the card's key for
their date, never to the card's key P (one date, at least 8 days and the time to move
ahead, for every load within 7 days; the keys worked out
from c, `GET_CARD` P1 = 3, or asked for, `GROUP_KEYS`, and checked against `GROUP_KEYS`
before the top-up, [Keys per load](#keys-per-load)), three to a command without proofs or one with; `KEYSET_KEYS` to teach the pieces' keyset where the card does
not know its keys. `CLEAR_SPENT` only once every spent piece is shown spent at the
mint (NUT-CCP). When online, `REFRESH` with the tip.

---

## Payment Flow (Offline Spend)

A reader: `SET_HEADER` with the tip when it has one; `GET_INFO` (P1 = 4: the
no-PIN allowance, its window and the profiles), `GET_PIECES` (P2 = 3), `AUTH`;
`SPEND_ALL_BEGIN` (P1 = `02`, or `03` where the reader reads units; its answer's t
gives the payment's key, P + t·G, and the refund key for the date), `SPEND_ALL_OUTPUTS`, `SPEND_ALL_CHANGE` (amount and the mint's
key), `SPEND_ALL_SIGN` until it answers the signature (`VERIFY_PIN` goes before
`SPEND_ALL_BEGIN`, unless the allowance covers the payment: any command between the
payment's steps gives it up); the outputs and the change come to the pieces less
the mint's input fee, if its keyset has one; swap at the mint; then, in the same tap
or any later one, `GET_CHANGE`, `KEYSET_KEYS` P1 = 3 for each opening's key, and
`LOAD_CHANGE` (P2 = `02`) for each, with the mint's `C_`, `K`, `e` and `s`. No PIN is
needed for the change. A payment is of one date: a till charging more than the pieces
of one date hold pays date by date, in two or more payments. A till, online or not,
leaves out of the payment a dated piece whose locktime is less than a day after its
own time, and an online till
asks the mint the state of every input (NUT-07) before `SPEND_ALL_SIGN`.

---

## What a 2.2 reader sees

A reader of 2.2 checks the major version and takes `02 03` as a card it knows. What
it meets ([D193](../docs/DECISIONS.md#d193)):

| Where | A 2.2 reader expects | A 2.3 card does | So |
|---|---|---|---|
| `GET_INFO` P1 0, 1, 2 | 30, 42, 43 bytes | the same sizes (P1 = 3 is 51, P1 = 4 is 59) | reads as before |
| `GET_INFO` byte 29 | 1: this tap may load change with no PIN | 1: change is owed | a reader that loads on it is refused (`6982`) and writes nothing |
| `GET_INFO` 38–41 | no-PIN spent in the day's window | the no-PIN window's count | the same use |
| `GET_CARD` byte 0, `GET_INFO` byte 8 | `04` | `04`, or `05` on a card of two units | a reader that checks the format refuses a card of two units; the format does not say keys per load (a 2.2 reader of `04` is stopped at `SPEND_ALL_BEGIN` and `LOAD_PROOF`, after a top-up's swap) |
| `GET_CHANGE` | 80-byte openings with r | 83-byte openings, no r | a reader cannot finish the change; a piece it makes from them is not a proof, and `LOAD_PROOF` without the PIN writes nothing |
| `SPEND_ALL_CHANGE` | 4 bytes | `6700`, the payment given up | a reader pays with no card change, or not at all |
| `SPEND_ALL_BEGIN` of a piece of the other unit | (none: 2.2 has one unit) | `6A86`, as every `SPEND_ALL_BEGIN` with P1 = `00` (below); `6A9B` to a reader of 2.3 that sends `02` | a reader that reads no unit never pays cents as sats |
| `SPEND_ALL_OUTPUTS` | any amounts | `6A80` for outputs past the pieces, the payment given up | a swap no mint takes is never signed |
| `GET_OUTBOX` P1 = `01` | public | the paying tap's, or the holder's say (`6982`) | a till reads its own payment's packet in the tap that took it |
| `GET_OUTBOX` P1 = `00` | public | the paying tap's, the PIN's or the grant's (`6982`) | a till reads its own payment's scope in the tap that took it |
| `GET_OUTBOX` packet's key | the card key | the card's key for the date 0, which the descriptor is by | a 2.2 relay that checks the key against `GET_PUBKEY` refuses the packet; one that checks the descriptor by the key the packet names takes it |
| `GET_PROOF` of a spent slot | the slot | `6A88` with neither the PIN nor the grant | a reader that reads spent slots needs the PIN |
| `GET_PIECES` P2 = `00`, `02` and a spent slot | listed; whole | not listed; 82 zeros, with neither the PIN nor the grant | a reader that reads spent slots needs the PIN |
| `GET_CARD` 44–76, 78, 83–86 | the last header's hash, the rolls, the arming, the window's start | zeros with neither the PIN nor the grant | a reader that shows them needs the PIN |
| `SPEND_ALL_BEGIN` | P1 = `00`; 4 bytes | `6A86` (P1 has not bit 1), before a place is read: no payment begun, nothing written, nothing burned | a 2.2 reader would build every secret with the card key, which no piece is locked to, and the mint would refuse the swap: the card refuses it first, and the pieces stay on the card. A 2.2 reader does not pay a 2.3 card |
| `SPEND_ALL_SIGN` | `00 01` only over the limit | `00 01` on every payment (the floor) | NUT-CCP's loop already sends it again |
| `LOAD_PROOF`, `CLEAR_SPENT` | the grant, the tap after a payment, or no PIN | the PIN given in this tap; `6A97` on a card with none | a top-up asks the holder's PIN |
| `LOAD_PROOF` | P2 = `00` or `01`, pieces locked to the card key | `6A86` (P2 has not bit 1), before the data is read, nothing written | a 2.2 loader swaps to the card key P first (NUT-CCP), and the card, which never signs with P alone, refuses the pieces: an undated top-up so swapped is lost, a dated one comes back to the refund key after its date. A 2.2 loader does not load a 2.3 card, and a 2.3 wallet checks the version before it swaps |
| `LOAD_CHANGE` | (none: 2.2 has no such command) | `6A86` without P2 bit 1 | never sent by a 2.2 reader |
| `INBOX` | (none: `6D00`) | this week's inbox, to anyone | never sent by a 2.2 reader; a 2.3 reader that meets `6D00` reads no inbox |
| `GROUP_KEYS`, `GET_CARD` P1 = `03` | (none) | the PIN or the grant; c sealed (to the refund key, or on a card with none to the PIN key and, with no owner, in its first set-up only) | never sent by a 2.2 reader; a 2.2 card ignores P1 and answers `GET_CARD` P1 = `03` with its record, so a 2.3 wallet checks `GET_INFO` P1 = `04` byte 56 bit 1 and the answer's length before it takes c |
| `SPEND_ALL_AGAIN` P1 = `01` with no PIN | the signature, or `6982` | the signature of a no-PIN payment; `6A88` for any other hash | a till asks for a payment under the PIN with the PIN |
| `SET_OWNER` on an open card | at once, `9000`, on an empty card | `6A97`, `6982`, or `6A98` five times; `6A8D` with anything unspent or owed, as 2.2; `6A91` past the first set-up | a set-up that asks once fails, with nothing written |
| `SET_OWNER` on an owned card | the new owner, nothing unspent | the same, no change owed too (`6A8D`), and a new c (drawn, or the next owner's after `SET_OWNER` P1 = `01`) | a 2.2 wallet replaces an owner as before, and the card draws c |
| `SET_LIMIT` 4, 8, 12, 13 bytes | as 2.2 | the same meaning | unchanged |
| `SET_LIMIT_PIN` 4, 8 | any value | the same meaning in the card's first set-up; after it `6A91` | a 2.2 wallet that sets a card with no owner's limits later is refused, with nothing written |
| `SET_CARD`, `SET_PIN` on a card with no owner | any time, no PIN asked on a card not set up | `SET_CARD` in the first set-up alone (`6A91`); `SET_PIN` under the PIN the card has (`6982`); a factory record only before a first PIN (`6A80`) | a 2.2 wallet that rewrites a set-up card is refused, with nothing written |
| `LOAD_PROOF` of a piece above the day's limit | `9000` | `6A8F` | a 2.2 wallet that sends a piece above the day's limit is refused, with nothing written |
| `GET_INFO` bytes 3–5 | the counts of places | the same, to anyone | unchanged |
| `RESET_CARD` on a card with no owner | `6A90` | the reset by the PIN: `6A97`, `6982`, `6985`, `6A98` | never sent by a 2.2 reader to a card with no owner |
| `VERIFY_PIN` wrong on a card with no owner | `63C2`, `63C1`, `6983` | `63C1`, `63C2` ... and `6A98` before each next try | a 2.2 reader that stops at `6A98` takes it as a refusal; nothing is blocked |
| `ALLOW_LOAD` | opens loads, `9000` | opens none, `6200` | a 2.2 wallet that waits for `9000` before it swaps a top-up stops before swapping |
| `VERIFY_PIN` | arms the allowance | arms it only in a time in the field that signs no payment | a reader's PIN for a payment opens no allowance after it |
| `RESET_CARD` | a new card key | a new key, or the same one on a certified card | unchanged for a reader that reads the key after |
| new words | | `6A97`–`6A9F`, and `6200` | taken as refusals (NUT-CCP) |
| new commands | | `1C`, `1D`, `1E`, `27`, `38`, `54` | never sent by a 2.2 reader |

A 2.2 reader can read a 2.3 card, but it cannot pay from it: its secrets would name the
card key, and the card's pieces are locked to the card's key for their date
([Keys per load](#keys-per-load)), so `SPEND_ALL_BEGIN` without P1 bit 1 is refused
(`6A86`) before anything is burned. Nor can it load one: `LOAD_PROOF` without P2 bit 1
is refused (`6A86`) before the data is read. It cannot finish a 2.3 card's change or
set a card up. `cardctl selftest` takes 2.1 and later.
