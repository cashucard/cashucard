#!/usr/bin/env python3
"""
cardctl — host-side PC/SC driver for the Cashu card applet, protocol 2.0.

Speaks spec/APDU.md over either interface: a contact reader (ACR39U and
friends) or a contactless one (ACR122U). PC/SC hides the difference, so the
same commands work for both — which matters, because CAP loading over
contactless is the flaky path and you will want to know quickly whether a
failure is the card or the interface.

The command that earns this tool its keep is `selftest`: it selects the applet,
reads the card's public key, asks the card to prove itself with AUTH, and
verifies those BIP-340 signatures here. jCardSim cannot surface EEPROM
exhaustion, ECDH output framing, or a card whose getS returns short;
`selftest` is the evidence from silicon.

A 2.0 card has an owner (a P-256 key) whose proofs administer it: set-owner,
set-limit, change-pin, refresh, the owner's grant (ALLOW_LOAD: on 3.0 it opens
no load; a load wants the PIN) and lock sign them with `--owner-key`, a
32-byte private key in hex, or, by default, the fixed TEST key in p256.py,
which anyone with this repository holds. Use the test key on bench cards only.
The key a card is given (setup, set-owner, set-owner-url) has no default:
`--owner-key`, or the TEST key under `--test-owner-key` alone.

Protocol 3.0 locks every piece to the card's key for its date, P + t*G
(spec/APDU.md, Keys per load): `group-keys` reads a date's keys, `card-secret`
opens the card's secret c, and `load --date-keys` is the loader's word that a
piece was minted to them. The card finishes its own change: `change` lists the
openings owed, `keyset-keys` teaches the card the mint's keys and shows an
opening's key to be one of them, and `load-change` gives it the mint's answer.
`cert` reads the certificate.

    python3 cardctl.py readers
    python3 cardctl.py selftest
    python3 cardctl.py info
    python3 cardctl.py setup --pin <PIN> --mint <URL> --owner-key <32-byte key hex> --anchor <80-byte header hex>

`dump` and `load-file` are the 0.x card file tools (spec/CARD-FILE.md): they
select the 0.x AID and refuse any other card.

Requires: pip install -r requirements.txt   (pyscard)
"""

import argparse
import binascii
import json
import hashlib
import hmac
import os
import secrets
import statistics
import sys
import time
from typing import List, Optional, Tuple

import bip340
import p256

# ── Applet identity ───────────────────────────────────────────────────────────
# Protocol 2.0 (DECISIONS D19): the 10-byte package AID, "CASHUCARD" after the
# proprietary RID byte F0, and the card's applet under it and 01. A reader
# selects the applet's whole AID (D25). On a chip a SELECT by the package AID
# alone is a partial name, and the chip gives it to the first instance whose
# AID begins with it: the opener (…44 4D), instantiated first, which answers
# 9000 with no version and 6D00 to everything after. The package AID is only
# the fallback, and a 9000 to it without a version is not the card's applet.
PACKAGE_AID = bytes.fromhex("F0434153485543415244")
APPLET_AID = PACKAGE_AID + b"\x01"
SELECT_AIDS = (APPLET_AID, PACKAGE_AID)

# The 0.x applet's AID, under the NFC Forum's RID. Only the 0.x card file
# tools (`dump`, `load-file`) select it; every other command speaks 2.0.
LEGACY_PACKAGE_AID = bytes.fromhex("D2760000850102")
LEGACY_APPLET_AID = LEGACY_PACKAGE_AID + b"\x01"

CLA = 0xB0

INS_GET_INFO = 0x01
INS_GET_PUBKEY = 0x10
INS_GET_BALANCE = 0x11
INS_GET_PROOF_COUNT = 0x12
INS_GET_PROOF = 0x13
INS_GET_SLOT_STATUS = 0x14
INS_AUTH = 0x15
INS_GET_CARD = 0x16
INS_GET_PIECES = 0x17
INS_GET_LOG = 0x18
INS_GET_CHANGE = 0x19
INS_GET_DLEQ = 0x1A
INS_GET_OUTBOX = 0x1B
INS_CERT_READ = 0x1C
INS_GROUP_KEYS = 0x1D   # 3.0 (D197): a date's keys, t, P + t*G and R + u*G
INS_INBOX = 0x1E        # 3.0 (D199): this week's inbox, SHA-256("CashuCard/inbox" || c || W) and W, to anyone
INS_SPEND_ALL_BEGIN = 0x22
INS_SPEND_ALL_OUTPUTS = 0x23
INS_SPEND_ALL_SIGN = 0x24
INS_SPEND_ALL_AGAIN = 0x25
INS_SPEND_ALL_CHANGE = 0x26
INS_LOAD_CHANGE = 0x27
INS_LOAD_PROOF = 0x30
# LOAD_PROOF and LOAD_CHANGE P2 bit 1 (protocol 3.0): the loader's word that each piece is locked to the card's key
# for its date, P + t*G (Keys per load). Sent only when the user says so (`load --date-keys`).
LOAD_DATE_KEYS = 0x02
INS_CLEAR_SPENT = 0x31
INS_SET_CARD = 0x32
INS_SET_LIMIT_PIN = 0x33
INS_SET_LIMIT = 0x34
INS_SET_HEADER = 0x36
INS_TELL_TIME = 0x37
INS_KEYSET_KEYS = 0x38
INS_VERIFY_PIN = 0x40
INS_SET_PIN = 0x41
INS_CHANGE_PIN = 0x42
INS_SET_OWNER = 0x43
INS_GET_NONCE = 0x44
INS_ALLOW_LOAD = 0x45
INS_LOCK_CARD = 0x50
INS_RESET_CARD = 0x51
INS_SET_TAG = 0x52
INS_REFRESH = 0x53
INS_CERT_WRITE = 0x54

# GET_INFO byte 6 (spec/APDU.md, GET_INFO): every bit is set on 2.0.
CAP_SECP256K1_NATIVE = 0x01
CAP_SCHNORR = 0x02
CAP_PIN = 0x04
CAP_PAYMENT_LIMIT_WAITS = 0x08
CAP_PIECES_BY_NAME = 0x10
CAP_128_PLACES = 0x20
CAP_BURN_OUTSIDE_TRANSACTION = 0x40
CAP_SEALED_PIN = 0x80

PIN_STATE_NAMES = {0: "none", 1: "set", 2: "blocked"}

# The lowest applet version selftest passes: the shared protocol (D18) as 2.1
# has it (D26: a payment of nothing spends no roll, and SET_LIMIT without the
# budget's byte leaves the budget). A 2.0 card is swept and reinstalled. A 0.x
# or Foxy 1.x card does not answer the shared AID (D19) at all. 2.2 (D175) only
# adds a read, GET_OUTBOX, so a 2.1 card in the field still passes: nothing about
# it calls for a sweep. 3.0 is a new major (a 2.2 reader cannot read it), and
# moves no floor: 2.1 and 2.2 cards stay what they are.
SELFTEST_MIN_VERSION = (2, 1)
# The versions selftest knows, and so passes: a later minor of a major it knows,
# or a later major, is not passed on trust.
SELFTEST_VERSIONS = ((2, 1), (2, 2), (3, 0))
# The majors cardctl speaks outside the card file tools: those of SELFTEST_VERSIONS.
PROTOCOL_MAJORS = tuple(sorted({v[0] for v in SELFTEST_VERSIONS}))

# GET_OUTBOX (2.2, spec/APDU.md, D175): the scope's length, one page's most, the
# descriptor's tag, and the packet's magic and format.
OUTBOX_SCOPE_LEN = 45
OUTBOX_PAGE = 255
OUTBOX_TAG = "CashuCard/assisted-settlement/v1"
OUTBOX_MAGIC = b"CCP-AS\x01"
FORMAT = 4
FORMAT_TWO_UNITS = 5  # 3.0: GET_INFO byte 8 and GET_CARD byte 0 where the keyset table holds the other unit

LOCK_CONFIRM_BYTE = 0xDE

# GET_INFO (spec/APDU.md, GET_INFO): the form cardctl asks for, P1 = 4 (59 bytes) from a card SELECT says is 3.0 or
# later and P1 = 2 (43 bytes) from an older one; and the profile bits of bytes 55 and 56, P1 = 4.
INFO_P1_LONG = 0x02
INFO_P1_LONGEST = 0x04
PROFILE_NAMES = (
    (55, 0, "PIN before money"), (55, 1, "the no-PIN window"), (55, 2, "the owner claimed slowly"),
    (55, 3, "the wait on every payment"), (55, 4, "two units on one card"), (55, 5, "a holder with no phone"),
    (55, 6, "keyset keys"), (55, 7, "the paid list"), (56, 0, "the certificate"), (56, 1, "keys per load"),
)
LAST_UNIT_NAMES = {0x00: "none", 0x80: "the card's", 0xA0: "the other"}

# The card's own change (3.0): GET_CHANGE answers a count and up to three openings of 83 bytes (number 1, amount 4,
# keyset 8, date 4, B_ 33, K 33); LOAD_CHANGE takes C_ (65) || K (65) || e (32) || s (32) for one of the eight
# openings, P2 02 (the word on keys per load), and answers the slot, the kept-proof byte and the piece (81);
# SPEND_ALL_CHANGE takes the amount (4) || K (33) || the keyset (8) and answers the change output's B_ (33).
CHANGE_ROW_LEN = 83
CHANGE_PAGE = 3
CHANGE_MOST = 8
LOAD_CHANGE_LEN = 194
LOAD_CHANGE_ANSWER_LEN = 83
SPEND_ALL_CHANGE_LEN = 45
# KEYSET_KEYS (3.0): a key on the wire is amount (8) || K (33), one to six to a command, 64 to a keyset; a tail of
# at most 64 bytes; a path of at most 6 nodes. The tree: leaves SHA-256(00 || amount || K), padded to a power of two
# with SHA-256(02), nodes SHA-256(01 || left || right).
KEYSET_KEY_WIRE = 41
KEYSET_KEYS_PER_COMMAND = 6
KEYSET_KEYS_MOST = 64
KEYSET_TAIL_MOST = 64
KEYSET_PATH_MOST = 6
KEYSET_UNITS = ("sat", "usd")
# CERT_READ (3.0): P1 FF the state (4 bytes), P1 00 to 03 pages of 256.
CERT_STATE = 0xFF
CERT_PAGE = 256
CERT_PAGES = 4

# Keys per load (spec/APDU.md, Keys per load): t = SHA-256(LABEL_KEY || c || date (4)) mod n, the card's key for the
# date P + t*G; u, the same with LABEL_REFUND_KEY, the refund key for the date R + u*G.
LABEL_KEY = "CashuCard/key"
LABEL_REFUND_KEY = "CashuCard/refund-key"
GROUP_KEYS_LEN = 98          # t (32), P + t*G (33), R + u*G (33)
CARD_SECRET_LEN = 32         # c
EC_POINT_LEN = 65            # 04 || x || y
# The seal (GET_CARD P1 = 3, the PIN): block i = SHA-256(SEAL_LABEL || i || x || the key in E's place (65) || nonce
# (16) || INS); GET_NONCE P1 = 1 answers the nonce, the PIN key (33) and the card key's BIP-340 signature over
# SHA-256(PINKEY_LABEL || PIN key).
SEAL_LABEL = "CashuCard/seal"
PINKEY_LABEL = "CashuCard/pinkey"
# The owner's c (3.0, D202): s = HMAC-SHA256(the 64-byte BIP-39 seed, LABEL_C || 00 || P (33)); SET_OWNER P1 = 1 gives
# the card s sealed to its PIN key Q (GET_NONCE P1 = 1, signed by P), E (65) || s XOR block 1 || block 0's first 16,
# block i = SHA-256(LABEL_C || i || x(e*Q) || E [|| the sealed bytes]); SET_OWNER's value ends with SHA-256(LABEL_C ||
# s)'s first 16; c = SHA-256(LABEL_C || s || n (4)), n the owners' c the card has taken, this one with them.
LABEL_C = "CashuCard/c"
OWNER_C_ENVELOPE_LEN = 113
OWNER_C_CHECK_LEN = 16
BIP39_SEED_LEN = 64
PIN_KEY_ANSWER_LEN = 113
# VERIFY_PIN on a card with no owner answers 6A98, keep holding, while it serves the wait its wrong tries left: at
# most 16,384 askings, in stretches of 16 with one asking more at the end of each, then the try.
PIN_WAIT_MOST = 16384 + 16384 // 16 + 2
# SET_OWNER on a card with no owner (a claim): six askings, the first five answered 6A98.
CLAIM_MOST = 10

# The owner's proof labels (spec/APDU.md, "The owner's proof"; DECISIONS D19).
LABEL_CHANGE_PIN = "CashuCard/change-pin"
LABEL_SET_LIMIT = "CashuCard/set-limit"
LABEL_SET_OWNER = "CashuCard/set-owner"
LABEL_SET_CARD = "CashuCard/set-card"
LABEL_LOAD = "CashuCard/load"
LABEL_LOCK = "CashuCard/lock"
LABEL_RESET = "CashuCard/reset"
LABEL_TAG = "CashuCard/tag"
LABEL_REFRESH = "CashuCard/refresh"
AUTH_TAG = "CashuCard/auth"

HEADER_LEN = 80
OWNER_KEY_LEN = 65
AUTH_NONCE_LEN = 16
# SET_HEADER's floor (spec/APDU.md, SET_HEADER; the applet's FLOOR_BITS): bits 0x17087BC0, a quarter of the network's
# work at height 971,100. A header is also held to its own bits and to four times the target of the hardest the card
# has taken (GET_CARD bytes 40 to 43).
FLOOR_BITS = 0x17087BC0
# The network takes no block whose time is more than two hours ahead: a card's clock that far past the tip a wallet has
# checked was set by a header far ahead (spec/APDU.md, A header far ahead, At set-up; D203).
CLOCK_AHEAD_MOST = 7200
# A day's margin around a dated piece's D (D203): readers leave out pieces within a day before it, and the owner takes
# a piece back only a day after it.
DATE_MARGIN = 86400


def take_back_line(date: int, refund_hex: str) -> str:
    """What card-secret --date says of a date's take-back key and its two margins (D203): readers leave the date's
    pieces out from a day before it by their own clocks, so the holder's move ends before then; the owner takes back
    only a day after it, by the network's tip, before which only a reader two days slow or more could still pay one."""
    return (f"take-back : r + u for {date}, from the restored c, is the private key of the card's refund key for that "
            f"date ({refund_hex}); take back no piece of it before {date + DATE_MARGIN} (a day after its date) by the "
            "network's tip: before then a reader whose clock is two days slow may still pay it. Readers leave its "
            f"pieces out from {date - DATE_MARGIN} (a day before its date) by their own clocks: a move of them to a "
            "new date ends before then")


# The record (spec/APDU.md, SET_CARD): the unit's byte, a mint of 1 to 77 characters, and the factory record's mint.
UNITS = {"sat": 0x00, "usd": 0x01}
MINT_MOST = 77
FACTORY_MINT = "-"
# The reset by the PIN on a card with no owner (spec/APDU.md, RESET_CARD and A holder with no phone): a held tap
# (GET_LOG answered at the tenth asking in a row), then RESET_CARD P2 AD with no data, reset at the sixtieth asking.
LOG_HOLD_MOST = 10
RESET_MOST = 60
RESET_CONFIRM_BYTE = 0xAD
ROLL_BUDGET_DEFAULT = 7
ROLL_BUDGET_MOST = 30

PROOF_SIZE = 82
LEGACY_PROOF_SIZE = 78
# Slot count the applet allocates (CashuApplet.MAX_PROOFS). GET_SLOT_STATUS
# returns one byte per slot, so this is also that command's Le.
MAX_PROOFS = 128
LEGACY_MAX_PROOFS = 32
STATUS_NAMES = {0x00: "empty", 0x01: "unspent", 0x02: "spent"}

PIN_MIN_LEN = 4
PIN_MAX_LEN = 8

# The card's amount field is a 4-byte unsigned integer (spec/APDU.md,
# LOAD_PROOF). Anything at or above this bound makes `amount.to_bytes(4, "big")`
# raise a bare OverflowError — and on the file path that happens mid-load, after
# earlier proofs are already committed. Bound it before the first write.
MAX_SLOT_AMOUNT = 2 ** 32

SW_MEANINGS = {
    0x9000: "success",
    0x6200: "ALLOW_LOAD: the owner's grant given for this tap (3.0: a warning; it opens no load)",
    0x6700: "wrong length",
    0x6982: "security condition not satisfied (the PIN, or the owner's grant, not given in this tap)",
    0x6983: "PIN blocked — the owner's change-pin unblocks it",
    0x6984: "PIN not set",
    0x6985: "conditions not satisfied (already spent / no payment begun / already locked / an allowance on a card with no PIN)",
    0x6986: "card locked by LOCK_CARD — writes disabled",
    0x6A80: "wrong data (not a point, a bad refund key, bits no header carries, a budget outside 1-30)",
    0x6A82: "not found — no 2.0 applet on this card (a 0.x or 1.x card needs an update)",
    0x6A83: "slot index out of range",
    0x6A84: "no space — all slots occupied",
    0x6A86: "incorrect P1/P2 (LOAD_PROOF on 3.0: no word that the pieces are locked to the card's key for their date: load --date-keys)",
    0x6A88: "slot is empty",
    0x6A8C: "no card record — run set-card first",
    0x6A8D: "card in use — something unspent where only an empty card may be changed",
    0x6A8E: "a dated piece on a card with no refund key",
    0x6A8F: "over the day's limit (a payment, or a piece loaded), or past the day's 300 loads",
    0x6A90: "no owner — run set-owner first",
    0x6A91: "the owner's proof is missing or not the owner's (wrong --owner-key?), or not open to an owned card; a card with no owner past its first set-up (reset it to change it)",
    0x6A93: "too little work in the block header",
    0x6A94: "already on the card (LOAD_PROOF) / the PIN needed for this payment (SPEND_ALL_SIGN)",
    0x6A96: "too many places for one signature",
    0x6A97: "no PIN — the card takes and pays nothing until it is given one (a 3.0 card: run setup)",
    0x6A98: "keep holding — the card counts this tap; ask again",
    0x6A99: "no rate — a payment or a load of the other unit on a card with a limit and no rate",
    0x6A9A: "two units in one payment, or a place whose keyset is in no entry",
    0x6A9B: "the other unit — the keyset is in the table as the other unit than the command names",
    0x6A9C: "no room in the keyset table, or a label of the other unit on a card with no table",
    0x6A9D: "not this tap's to start — a new keyset of the other unit without the holder's say",
    0x6A9E: "limit reached, enter the PIN — past what the no-PIN window has left",
    0x6A9F: "keys not shown — the keyset's keys not taught to the card, or the opening's key not shown to be one of them",
    0x6B00: "wrong P1/P2",
    0x6D00: "instruction not supported",
    0x6E00: "class not supported",
    0x6F00: "signing failed (hardware error)",
}


# What a status word means to one command, where it says more than SW_MEANINGS: keyed by the command's name, the
# context's first word.
SW_COMMAND_MEANINGS = {
    "LOAD_CHANGE": {
        0x6A80: "the mint's answer refused: K is not in the 04 form or not the key the opening is bound to, C_ or K "
                "is not a point of the curve, or the mint's proof (e, s) does not hold for the opening's B_",
        0x6A83: "no opening past 7",
        0x6A84: "no slot free for the piece",
        0x6A86: "no word on keys per load (P2 bit 1, 02)",
        0x6A88: "that opening is not owed",
        0x6A94: "the opening's piece is on the card already: the opening is let go",
        0x6A9F: "the opening's key has not been shown to be one of its keyset's keys (KEYSET_KEYS P1 3: "
                "keyset-keys FILE --show N)",
    },
    "KEYSET_KEYS": {
        0x6982: "the PIN not given in this tap (teaching), or the PIN or the holder's say (binding another key)",
        0x6985: "no teaching begun (P1 1 or 2), or a payment signed in this time in the field (binding another key)",
        0x6A80: "keys refused: an ID version not 00 or 01, a tail whose unit is not the entry's, keys out of order, "
                "a version 00 amount not 2^n, more than 64, or keys that do not hash to the keyset's ID; showing: "
                "a path that does not reach the keyset's top",
        0x6A83: "no opening past 7",
        0x6A88: "a keyset in no entry of the card's keyset table (teaching), or an opening not owed (showing)",
        0x6A9B: "the keyset named is of the other unit than the opening's",
        0x6A9F: "the keyset's keys have not been taught to the card",
    },
    "SPEND_ALL_CHANGE": {
        0x6985: "no payment begun",
        0x6A80: "an amount of 0, change that with the outputs would come to more than the pieces, or a K that is not "
                "a compressed point of the curve",
        0x6A84: "no opening free, or a card with no keyset table or no room for the openings' keys",
        0x6A8F: "change past the day's 300 loads, with the change before it (it is counted when the payment is "
                "signed): the payment given up; pay with no change, or after the day of loads turns",
        0x6A9B: "a keyset of the other unit than the payment's",
        0x6A9F: "a keyset in no entry of the table, or whose keys the card has not been taught",
    },
    "RESET_CARD": {0x6B00: "wrong P1/P2: a P1 other than 00 (the reset) and 01 (the let-go form), or a P2 other than "
                           "the confirming byte AD"},
    "LOCK_CARD": {0x6B00: "wrong P2: not the confirming byte DE"},
    "REFRESH": {0x6B00: "wrong P1: neither 00 (the owner's) nor 01 (the holder's)"},
    "SET_OWNER": {0x6B00: "wrong P1/P2: a P2 other than 00, or a P1 other than 00 and 01 (the owner's c)"},
    "CERT_READ": {
        0x6A83: "a page at or past the container's end",
        0x6A86: "a P1 other than 00 to 03 or FF",
        0x6A88: "no certificate sealed",
    },
}


def describe_sw(sw: int, context: str = "") -> str:
    command = context.split()[0] if context else ""
    if sw in SW_COMMAND_MEANINGS.get(command, {}):
        return SW_COMMAND_MEANINGS[command][sw]
    if sw in SW_MEANINGS:
        return SW_MEANINGS[sw]
    if (sw & 0xFFF0) == 0x63C0:
        return f"wrong PIN — {sw & 0x0F} retries remaining"
    return "unknown status word"


class CardError(Exception):
    def __init__(self, sw: int, context: str = ""):
        self.sw = sw
        where = f" during {context}" if context else ""
        super().__init__(f"card returned {sw:04X}{where}: {describe_sw(sw, context)}")


# ── APDU timing ───────────────────────────────────────────────────────────────
# One (context, milliseconds) row per APDU, measured around the PC/SC transmit
# call — so the figure is the full reader round trip the card sees, not just
# the applet's own work. `--timing` prints each row as it happens and a
# per-command summary at exit. Always collected; printing is what the flag
# gates, and collecting a float per APDU costs nothing against a 60 ms tap.
TIMING_ENABLED = False
TIMINGS: List[Tuple[str, float]] = []


def record_timing(context: str, ms: float) -> None:
    TIMINGS.append((context, ms))
    if TIMING_ENABLED:
        print(f"  ⏱ {context:<16} {ms:8.1f} ms", file=sys.stderr)


def summarize_timings(rows: List[Tuple[str, float]]) -> str:
    """
    Per-command table in first-seen order, then the whole session.

    Median rather than mean: a single retried or torn APDU should not drag
    the figure for every other command of its kind with it.
    """
    if not rows:
        return "no APDUs sent"
    by_ctx: dict = {}
    for ctx, ms in rows:
        by_ctx.setdefault(ctx, []).append(ms)
    width = max(len(ctx) for ctx in by_ctx)
    lines = [f"{'command':<{width}}  {'n':>3}  {'min':>8}  {'median':>8}  {'max':>8}  {'total':>9}"]
    for ctx, xs in by_ctx.items():
        lines.append(
            f"{ctx:<{width}}  {len(xs):>3}  {min(xs):8.1f}  {statistics.median(xs):8.1f}"
            f"  {max(xs):8.1f}  {sum(xs):9.1f}"
        )
    total = sum(ms for _, ms in rows)
    lines.append(f"{len(rows)} APDU(s), {total:.1f} ms on the wire (all figures ms)")
    return "\n".join(lines)


def _hex(b: bytes) -> str:
    return binascii.hexlify(b).decode()


def validate_slot_amount(value, where: str = "") -> int:
    """
    A Cashu denomination that the card's 4-byte field can hold.

    Two rules, both of which cost nothing here and cost a burned slot anywhere
    else:

    * **A positive power of two.** A mint keyset has no key for amount 3, so a
      proof carrying one is rejected on redemption — after the slot is gone.
      This is the same rule cashu-client's `requireAmount` enforces on the other
      side of the card file; a value it refuses is a value this tool must never
      write, or the two halves disagree about what a valid proof is.
    * **Below `2**32`.** The APDU field is a 4-byte unsigned integer, so
      anything larger makes `amount.to_bytes(4, "big")` raise a bare
      OverflowError part-way through a load, after earlier proofs have already
      committed.

    Lives here rather than in the file parser because both entry points to
    LOAD_PROOF — `cardctl load` and `cardctl load-file` — must agree on what a
    valid amount is. They did not, and `load --amount 5` wrote a proof that the
    file format then refused to carry back off the card.
    """
    if not isinstance(value, int) or isinstance(value, bool):
        # Reported before the range check so a string "8" out of an untyped
        # reader bridge does not render as `got 8` — a message that looks like a
        # valid value and hides the type error.
        raise SystemExit(
            f"{where}amount must be a positive integer, got "
            f"{type(value).__name__} {value!r}"
        )
    if not 0 < value < MAX_SLOT_AMOUNT:
        raise SystemExit(
            f"{where}amount must be a positive integer below 2**32 "
            f"(the card's amount field is a 4-byte uint), got {value!r}"
        )
    if value & (value - 1) != 0:
        raise SystemExit(
            f"{where}amount must be a positive power of two — a mint keyset has "
            f"no key for other denominations, so the proof is rejected on "
            f"redemption after the slot is already burned. Got {value!r}."
        )
    return value


# ── PC/SC transport ───────────────────────────────────────────────────────────
def _load_pyscard():
    try:
        from smartcard.System import readers  # noqa
        from smartcard.util import toHexString  # noqa
        return readers
    except ImportError:
        sys.exit(
            "pyscard is not installed.\n"
            "  pip install -r requirements.txt\n"
            "On macOS PC/SC ships with the OS — do NOT install pcsc-lite.\n"
            "On Debian/Ubuntu you also need: sudo apt install pcscd libpcsclite-dev"
        )



class Card:
    """A connected card with the Cashu applet selected."""

    # The 0.x applet's encodings, for the card file tools only (select(legacy=True)).
    legacy = False
    # The version SELECT answered (2 bytes); empty before a SELECT.
    version = b""

    def __init__(self, reader_index: int = 0, verbose: bool = False):
        readers_fn = _load_pyscard()
        available = readers_fn()
        if not available:
            sys.exit(
                "No PC/SC readers found.\n"
                "  - Is the reader plugged in?\n"
                "  - Linux: is pcscd running? (sudo systemctl start pcscd)\n"
                "  - macOS: the daemon is built in; try replugging the reader."
            )
        if reader_index >= len(available):
            sys.exit(f"Reader index {reader_index} out of range ({len(available)} found)")
        self.reader = available[reader_index]
        self.verbose = verbose
        try:
            self.connection = self.reader.createConnection()
            self.connection.connect()
        except Exception as exc:  # noqa: BLE001 — surface the driver's own words
            sys.exit(f"Could not connect to a card on {self.reader}: {exc}\nIs a card on the reader?")

    # ── raw APDU ──────────────────────────────────────────────────────────────
    def transmit(self, apdu: bytes, context: str = "") -> bytes:
        if self.verbose:
            print(f"  > {_hex(apdu)}", file=sys.stderr)
        started = time.perf_counter()
        data, sw1, sw2 = self.connection.transmit(list(apdu))
        record_timing(context or "APDU", (time.perf_counter() - started) * 1000.0)
        sw = (sw1 << 8) | sw2
        body = bytes(data)
        if self.verbose:
            print(f"  < {_hex(body)} {sw:04X}", file=sys.stderr)
        if sw != 0x9000:
            raise CardError(sw, context)
        return body

    def send(self, ins: int, p1: int = 0, p2: int = 0,
             data: bytes = b"", le: Optional[int] = None, context: str = "") -> bytes:
        apdu = bytes([CLA, ins, p1, p2])
        if data:
            apdu += bytes([len(data)]) + data
        if le is not None:
            apdu += bytes([le])
        return self.transmit(apdu, context or f"INS {ins:02X}")

    def held(self, ins: int, p1: int = 0, p2: int = 0, data: bytes = b"", le: Optional[int] = None,
             context: str = "", most: int = 10, note: str = "") -> bytes:
        """A command the card holds for (3.0: an owner's claim, D187; a history of a card with no owner, D189; a
        VERIFY_PIN serving the wait of wrong tries, D195): the same command sent again for as long as the card answers
        6A98, keep holding, and no more than `most` times. `note` goes to stderr once, at the first 6A98."""
        for _ in range(most - 1):
            try:
                return self.send(ins, p1, p2, data, le, context)
            except CardError as exc:
                if exc.sw != 0x6A98:
                    raise
                if note:
                    print(f"note: {note}", file=sys.stderr)
                    note = ""
        return self.send(ins, p1, p2, data, le, context)

    def at_least(self, major: int, minor: int) -> bool:
        """Whether the version SELECT answered is major.minor or later (False before a SELECT)."""
        return len(self.version) >= 2 and tuple(self.version[:2]) >= (major, minor)

    # ── selection ─────────────────────────────────────────────────────────────
    def select(self, legacy: bool = False) -> bytes:
        """SELECT by AID. Returns the 2-byte applet version.

        2.0 selects the applet's whole AID first (D25). An answer of 9000
        with no version is some other applet of the package (the opener, on
        a chip that gave it a partial name) and counts as no answer: the next
        AID is tried, as after an error.
        """
        self.legacy = legacy
        aids = (LEGACY_PACKAGE_AID, LEGACY_APPLET_AID) if legacy else SELECT_AIDS
        last: object = None
        for aid in aids:
            apdu = bytes([0x00, 0xA4, 0x04, 0x00, len(aid)]) + aid
            try:
                version = self.transmit(apdu, "SELECT")
            except CardError as exc:
                last = exc
                continue
            if len(version) >= 2:
                self.version = bytes(version[:2])
                return version
            last = f"SELECT {_hex(aid)} answered 9000 with no version (not the card's applet)"
        if legacy:
            raise SystemExit(f"SELECT of the 0.x applet failed: {last}\n"
                             "This card has no 0.x applet; card files are 0.x-only (spec/CARD-FILE.md).")
        raise SystemExit(
            f"SELECT failed: {last}\n"
            "No 2.0 applet answers on this card. A card on the 0.x or Foxy 1.x applet needs an\n"
            "update (sweep it first, then reinstall: docs/HARDWARE_DEPLOYMENT.md):\n"
            "  applet/target/cashu-javacard-3.0.0.cap"
        )

    # ── read commands ─────────────────────────────────────────────────────────
    def get_info(self) -> dict:
        """GET_INFO, the longest form the card speaks: P1 = 4 (59 bytes) on a card SELECT says is 3.0 or later, P1 = 2
        (43 bytes) on an older 2.x; the 0.x answer (8 or 9 bytes) in legacy mode."""
        if self.legacy:
            b = self.send(INS_GET_INFO, le=0x00, context="GET_INFO")
            if len(b) < 8:
                raise SystemExit(f"GET_INFO returned {len(b)} bytes, expected 8 or 9: {_hex(b)}")
            return {"version": f"{b[0]}.{b[1]}", "max_slots": b[2], "unspent": b[3], "spent": b[4],
                    "empty": b[5], "caps_raw": b[6], "pin_state": PIN_STATE_NAMES.get(b[7], f"unknown({b[7]})")}
        p1 = INFO_P1_LONGEST if self.at_least(3, 0) else INFO_P1_LONG
        b = self.send(INS_GET_INFO, p1=p1, le=0x00, context="GET_INFO")
        if len(b) < 30:
            raise SystemExit(f"GET_INFO returned {len(b)} bytes, expected {59 if p1 == INFO_P1_LONGEST else 43}: "
                             f"{_hex(b)}")
        return decode_info(b)

    def get_pubkey(self, raw: bool = False) -> bytes:
        """The card's secp256k1 public key, normalised to 33-byte compressed.

        spec/APDU.md fixes the wire format at 33 bytes; an applet that answered
        ECPublicKey.getW()'s 65-byte point is compressed here, at the single
        ingress, so every consumer sees the same 33-byte key. `raw=True` returns
        the bytes as the card sent them, for `selftest` to report the encoding.
        """
        pk = self.send(INS_GET_PUBKEY, le=0x21, context="GET_PUBKEY")
        if raw:
            return pk
        try:
            return bip340.compress(pk)
        except ValueError as exc:
            raise SystemExit(f"GET_PUBKEY: {exc}")

    def get_balance(self) -> int:
        return int.from_bytes(self.send(INS_GET_BALANCE, le=0x04, context="GET_BALANCE"), "big")

    def get_proof_count(self) -> int:
        return self.send(INS_GET_PROOF_COUNT, le=0x01, context="GET_PROOF_COUNT")[0]

    def get_slot_status(self) -> bytes:
        return self.send(INS_GET_SLOT_STATUS, le=(LEGACY_MAX_PROOFS if self.legacy else MAX_PROOFS),
                         context="GET_SLOT_STATUS")

    def get_proof(self, slot: int) -> dict:
        size = LEGACY_PROOF_SIZE if self.legacy else PROOF_SIZE
        b = self.send(INS_GET_PROOF, p1=slot, le=size, context=f"GET_PROOF slot {slot}")
        proof = {
            "slot": slot,
            "status": STATUS_NAMES.get(b[0], f"unknown({b[0]})"),
            # Raw bytes -> hex gives the full 16-char NUT-02 id. Decoding these
            # as ASCII would yield only 8 hex chars: half an id, matching no
            # keyset at the mint.
            "keyset_id": b[1:9].hex(),
            "amount": int.from_bytes(b[9:13], "big"),
            # The 32 bytes are the P2PK *nonce*, not the secret string.
            "nonce": b[13:45],
            "c": b[45:78],
        }
        if not self.legacy:
            proof["date"] = int.from_bytes(b[78:82], "big")
        return proof

    def get_card(self) -> dict:
        """GET_CARD: the record, the clock's proof and (2.0, D20) the rollover bytes."""
        return decode_card(self.send(INS_GET_CARD, le=0x00, context="GET_CARD"))

    def get_card_secret(self, e_pub: Optional[bytes] = None) -> bytes:
        """
        GET_CARD P1 = 3 (3.0): the card's secret c, sealed, right after GET_NONCE P1 = 1 (`get_pin_key`), whose sixteen
        bytes it uses up. With `e_pub` None (a card with a refund key): no data; the answer is K = k*G (65) and c XOR
        block 1 of the seal over x(k*R), 97 bytes. With `e_pub`, the reader's one-time key E (65, 04 || x || y; a card
        with no refund key): the answer is c XOR block 1 of the seal over x(e*PIN key), 32 bytes. Opened by
        `open_card_secret`.
        """
        if e_pub is None:
            b = self.send(INS_GET_CARD, p1=0x03, le=0x00, context="GET_CARD c")
            want = EC_POINT_LEN + CARD_SECRET_LEN
        else:
            if len(e_pub) != EC_POINT_LEN or e_pub[0] != 0x04:
                raise SystemExit("E is 65 bytes beginning 04")
            b = self.send(INS_GET_CARD, p1=0x03, data=e_pub, le=0x00, context="GET_CARD c")
            want = CARD_SECRET_LEN
        if len(b) != want:
            raise SystemExit(f"GET_CARD P1 = 3 returned {len(b)} bytes, expected {want}")
        return b

    def group_keys(self, date: int) -> dict:
        """GROUP_KEYS (1D, 3.0): a date's keys, t (32), P + t*G (33) and R + u*G (33, zeros with no refund key and for
        the date 0). Wants the PIN given in this tap or the owner's grant (6982 otherwise)."""
        if not 0 <= date < 2 ** 32:
            raise SystemExit(f"the date must fit four bytes, got {date}")
        b = self.send(INS_GROUP_KEYS, data=date.to_bytes(4, "big"), le=GROUP_KEYS_LEN, context="GROUP_KEYS")
        if len(b) != GROUP_KEYS_LEN:
            raise SystemExit(f"GROUP_KEYS returned {len(b)} bytes, expected {GROUP_KEYS_LEN}")
        return {"t": b[:32], "key": b[32:65], "refund": b[65:98]}

    def _the_card_finishes_its_change(self, what: str) -> None:
        """A card SELECT says is 2.2 or earlier answers 80-byte openings and has no LOAD_CHANGE: refused here, before
        anything is sent. (Before a SELECT, nothing is known and nothing is refused.)"""
        if self.version and not self.at_least(3, 0):
            raise SystemExit(f"{what}: this card answers version {_version_text(self.version)}; the card's own change "
                             "is read and loaded this way from 3.0 on (a 2.2 card answers 80-byte openings, which a "
                             "reader finishes itself)")

    def get_change(self, page: int = 0) -> List[dict]:
        """GET_CHANGE (19) P1 = page: up to three openings of the card's own change owed, 83 bytes each
        (`decode_change`). No PIN."""
        if not 0 <= page <= 0xFF:
            raise SystemExit(f"a GET_CHANGE page is 0 to 255, got {page}")
        self._the_card_finishes_its_change("GET_CHANGE")
        return decode_change(self.send(INS_GET_CHANGE, p1=page, le=0x00, context=f"GET_CHANGE page {page}"))

    def owed_change(self) -> List[dict]:
        """Every opening owed: GET_CHANGE pages from 0 until one answers fewer than three. An opening seen twice (the
        card lets one go between pages) is listed once."""
        rows: List[dict] = []
        for page in range(CHANGE_MOST // CHANGE_PAGE + 1):
            got = self.get_change(page)
            rows += [r for r in got if r["number"] not in {s["number"] for s in rows}]
            if len(got) < CHANGE_PAGE:
                break
        return rows

    def cert_read(self) -> dict:
        """CERT_READ (1C): the state (P1 FF: sealed, version, length), then pages P1 00 to 03 of 256 until the
        container's length. Public. `container` is empty when none is sealed."""
        state = self.send(INS_CERT_READ, p1=CERT_STATE, le=0x00, context="CERT_READ state")
        if len(state) != 4:
            raise SystemExit(f"CERT_READ P1 FF returned {len(state)} bytes, expected 4: {_hex(state)}")
        out = {"sealed": state[0] == 1, "version": state[1], "length": int.from_bytes(state[2:4], "big"),
               "container": b""}
        if not out["sealed"]:
            return out
        if not 0 < out["length"] <= CERT_PAGE * CERT_PAGES:
            raise SystemExit(f"CERT_READ: a sealed container of {out['length']} bytes; a card keeps 1 to "
                             f"{CERT_PAGE * CERT_PAGES}")
        container = b""
        for page in range((out["length"] + CERT_PAGE - 1) // CERT_PAGE):
            b = self.send(INS_CERT_READ, p1=page, le=0x00, context=f"CERT_READ page {page}")
            want = min(CERT_PAGE, out["length"] - page * CERT_PAGE)
            if len(b) != want:
                raise SystemExit(f"CERT_READ page {page} returned {len(b)} bytes, expected {want}")
            container += b
        out["container"] = container
        return out

    def auth(self, reader_nonce: bytes) -> Tuple[bytes, bytes]:
        """AUTH: the card's 16 bytes and its BIP-340 signature over the tagged hash (spec/APDU.md, AUTH)."""
        if len(reader_nonce) != AUTH_NONCE_LEN:
            raise SystemExit(f"AUTH takes {AUTH_NONCE_LEN} bytes of the reader's, got {len(reader_nonce)}")
        b = self.send(INS_AUTH, data=reader_nonce, le=0x50, context="AUTH")
        if len(b) != AUTH_NONCE_LEN + 64:
            raise SystemExit(f"AUTH returned {len(b)} bytes, expected 80: {_hex(b)}")
        return b[:AUTH_NONCE_LEN], b[AUTH_NONCE_LEN:]

    def get_outbox_scope(self) -> bytes:
        """GET_OUTBOX P1 = 0: the scope of the last payment's packet (45 bytes). 6A88 with no record."""
        b = self.send(INS_GET_OUTBOX, p1=0, le=0x00, context="GET_OUTBOX scope")
        if len(b) != OUTBOX_SCOPE_LEN:
            raise SystemExit(f"GET_OUTBOX returned a scope of {len(b)} bytes, expected {OUTBOX_SCOPE_LEN}")
        return b

    def get_outbox_page(self, offset: int, count: int = OUTBOX_PAGE) -> bytes:
        """GET_OUTBOX P1 = 1: `count` bytes of the packet from `offset`, or as many as are left."""
        if not 0 <= offset <= 0xFFFF or not 1 <= count <= OUTBOX_PAGE:
            raise ValueError(f"offset 0..65535 and count 1..{OUTBOX_PAGE}, got {offset} and {count}")
        return self.send(INS_GET_OUTBOX, p1=1, data=offset.to_bytes(2, "big") + bytes([count]), le=0x00,
                         context=f"GET_OUTBOX page at {offset}")

    def get_outbox(self) -> Tuple[bytes, bytes]:
        """
        The last payment's packet (body || descriptor) and its scope: the scope, pages
        of 255 until one comes back short (or 6A83 past a whole number of pages), and
        the scope again, which must be the same: a packet read across a new payment is
        refused, never mixed. Public: no PIN.
        """
        before = self.get_outbox_scope()
        packet = b""
        for offset in range(0, 0x10000, OUTBOX_PAGE):
            try:
                page = self.get_outbox_page(offset)
            except CardError as exc:
                if exc.sw == 0x6A83 and offset > 0:
                    break
                raise
            packet += page
            if len(page) < OUTBOX_PAGE:
                break
        if self.get_outbox_scope() != before:
            raise SystemExit("GET_OUTBOX: the record changed while it was read")
        return packet, before

    def get_nonce(self) -> bytes:
        b = self.send(INS_GET_NONCE, le=0x10, context="GET_NONCE")
        if len(b) != 16:
            raise SystemExit(f"GET_NONCE returned {len(b)} bytes, expected 16")
        return b

    def get_pin_key(self) -> Tuple[bytes, bytes, bytes]:
        """GET_NONCE P1 = 1, on any card: sixteen bytes good once, the PIN key (33, compressed) and the card key's
        BIP-340 signature over SHA-256("CashuCard/pinkey" || PIN key) (64). Check the signature with `pin_key_signed`."""
        b = self.send(INS_GET_NONCE, p1=0x01, le=PIN_KEY_ANSWER_LEN, context="GET_NONCE PIN key")
        if len(b) != PIN_KEY_ANSWER_LEN:
            raise SystemExit(f"GET_NONCE P1 = 1 returned {len(b)} bytes, expected {PIN_KEY_ANSWER_LEN}")
        return b[:16], b[16:49], b[49:113]

    # ── the owner's commands ──────────────────────────────────────────────────
    def owner_command(self, ins: int, label: str, value: bytes, owner: int,
                      p1: int = 0, p2: int = 0, le: Optional[int] = None, context: str = "") -> bytes:
        """GET_NONCE, then the command with the owner's proof over label || nonce || value."""
        nonce = self.get_nonce()
        proof = p256.owner_proof(owner, label, nonce, value)
        return self.send(ins, p1=p1, p2=p2, data=p256.owner_data(proof, value), le=le, context=context)

    def stage_owner_c(self, s: bytes, pin_key: bytes) -> None:
        """SET_OWNER P1 = 1 (3.0, D202): the owner's s, sealed to the card's PIN key, kept by the card for the
        SET_OWNER that comes next (any other command between lets it go)."""
        self.send(INS_SET_OWNER, p1=1, data=owner_c_envelope(s, pin_key), context="SET_OWNER P1 1 (the owner's c)")

    def _signed_pin_key(self) -> Tuple[bytes, bytes]:
        """GET_NONCE P1 = 1, its PIN key held to the card key's signature: (the sixteen bytes, the PIN key)."""
        card_key = self.get_pubkey()
        nonce, pin_key, sig = self.get_pin_key()
        if not pin_key_signed(card_key, pin_key, sig):
            raise SystemExit("GET_NONCE P1 = 1: the PIN key is not signed by the card key; the owner's c was not sent")
        return nonce, pin_key

    def set_owner(self, owner_pub: bytes, anchor: Optional[bytes] = None, old_owner: Optional[int] = None,
                  s: Optional[bytes] = None) -> None:
        """SET_OWNER: the key, and the anchor header after it (D20); the old owner's proof on an owned card. With `s`
        (3.0, D202), the owner's c: its envelope first (SET_OWNER P1 = 1, after the nonce on a hand-over), and its
        check at the end of the value, under the proof."""
        if len(owner_pub) != OWNER_KEY_LEN or owner_pub[0] != 0x04:
            raise SystemExit("an owner key is 65 bytes beginning 04")
        if anchor is not None and len(anchor) != HEADER_LEN:
            raise SystemExit(f"the anchor is a block header, {HEADER_LEN} bytes; got {len(anchor)}")
        value = owner_pub + (anchor or b"") + (owner_c_check(s) if s is not None else b"")
        if old_owner is None:
            # 3.0 (D187): a claim wants the PIN given in this tap and is held for; the card answers 6A98, keep holding,
            # to the first five askings
            if s is not None:
                # the PIN key, then the envelope: a command between the envelope and SET_OWNER lets it go
                self.stage_owner_c(s, self._signed_pin_key()[1])
            self.held(INS_SET_OWNER, data=value, context="SET_OWNER", most=CLAIM_MOST,
                      note="the card counts the claim: keep holding it on the reader")
        elif s is None:
            self.owner_command(INS_SET_OWNER, LABEL_SET_OWNER, value, old_owner, context="SET_OWNER")
        else:
            # one GET_NONCE P1 = 1: the PIN key the envelope is sealed to, and the sixteen bytes the proof is over
            nonce, pin_key = self._signed_pin_key()
            self.stage_owner_c(s, pin_key)
            proof = p256.owner_proof(old_owner, LABEL_SET_OWNER, nonce, value)
            self.send(INS_SET_OWNER, data=p256.owner_data(proof, value), context="SET_OWNER")

    def set_card(self, mint: str, refund: bytes = bytes(33), unit: int = 0, owner: Optional[int] = None,
                 design: bytes = b"") -> None:
        """SET_CARD: unit, refund key, 65 bytes the card does not read, the mint, and the card's design (3) if any."""
        m = check_mint(mint, factory=True)
        if len(refund) != 33:
            raise SystemExit("a refund key is 33 bytes (or 33 zeros for none)")
        if design and len(design) != 3:
            raise SystemExit("a design is three characters")
        record = bytes([unit]) + refund + bytes(65) + bytes([len(m)]) + m + design
        if owner is None:
            self.send(INS_SET_CARD, data=record, context="SET_CARD")
        else:
            self.owner_command(INS_SET_CARD, LABEL_SET_CARD, record, owner, context="SET_CARD")

    def set_limit(self, owner: int, day: int, payment: Optional[int] = None,
                  allowance: Optional[int] = None, budget: Optional[int] = None, rate: Optional[int] = None,
                  no_pin_window: Optional[int] = None) -> None:
        """SET_LIMIT (34): 4, 8, 12, 13, 17 or 18 bytes; each longer form needs every field before it."""
        value = limit_value(day, payment, allowance, budget, rate, no_pin_window)
        self.owner_command(INS_SET_LIMIT, LABEL_SET_LIMIT, value, owner, context="SET_LIMIT")

    def change_pin(self, owner: int, new_pin: bytes) -> None:
        """CHANGE_PIN: the owner's proof over the new PIN. No old PIN; unblocks a blocked card."""
        check_pin(new_pin)
        self.owner_command(INS_CHANGE_PIN, LABEL_CHANGE_PIN, new_pin, owner, context="CHANGE_PIN")

    def allow_load(self, owner: int) -> None:
        """ALLOW_LOAD, the owner's grant for this tap. A 3.0 card answers 6200 where the grant is given (a warning: it
        opens no load), a card of 2.2 or earlier 9000; both are the grant given."""
        try:
            self.owner_command(INS_ALLOW_LOAD, LABEL_LOAD, b"", owner, context="ALLOW_LOAD")
        except CardError as exc:
            if exc.sw != 0x6200:
                raise

    def refresh(self, owner: int, header: bytes, back: bool = False) -> int:
        """REFRESH (53, D20): the owner's proof over the tip header; the rollover budget is full again. An older header
        that is not weak brings back a weak clock (D201). With `back` (D201), the header and the byte 01, both under the
        proof: the clock goes back to the header (older, and not weak) whatever the clock, and the day's window and the
        day of loads begun after it begin again at it, keeping what they counted (D203); the owner's proof has ended the
        no-PIN window. Answers the clock, which an older header the card does not take leaves as it was."""
        if len(header) != HEADER_LEN:
            raise SystemExit(f"a block header is {HEADER_LEN} bytes; got {len(header)}")
        value = header + (b"\x01" if back else b"")
        b = self.owner_command(INS_REFRESH, LABEL_REFRESH, value, owner, le=0x04, context="REFRESH")
        return int.from_bytes(b, "big")

    def refresh_by_pin(self, header: bytes) -> int:
        """REFRESH P1 = 01 (D189) on a card with no owner: the PIN given and a held tap in this selection stand for the
        owner's proof, and the header comes alone. The rollover budget is full again, and an older header that is not
        weak brings back a weak clock (D201); a clock that is not weak never goes back. Answers the clock."""
        if len(header) != HEADER_LEN:
            raise SystemExit(f"a block header is {HEADER_LEN} bytes; got {len(header)}")
        b = self.send(INS_REFRESH, p1=0x01, data=header, le=0x04, context="REFRESH")
        return int.from_bytes(b, "big")

    def reset_by_owner(self, owner: int, anchor: Optional[bytes] = None) -> None:
        """RESET_CARD P1 = 0, P2 = AD, on a card with an owner: the owner's proof over the reset's value, nothing or an
        anchor (D200: a block header, 80 bytes, which becomes the card's clock even where it is older than the card's).
        Only an empty card that is owed nothing (6A8D); a locked card wants the PIN given in this tap as well (6982)."""
        if anchor is not None and len(anchor) != HEADER_LEN:
            raise SystemExit(f"the anchor is a block header, {HEADER_LEN} bytes; got {len(anchor)}")
        self.owner_command(INS_RESET_CARD, LABEL_RESET, anchor or b"", owner, p2=RESET_CONFIRM_BYTE, context="RESET_CARD")

    def lock_card(self, owner: int) -> None:
        self.owner_command(INS_LOCK_CARD, LABEL_LOCK, b"", owner, p2=LOCK_CONFIRM_BYTE, context="LOCK_CARD")

    def hold_history(self) -> bytes:
        """GET_LOG P1 = 0, held for: on a card with no owner the log answers the PIN at the tenth asking in a row (the
        first nine 6A98, keep holding), and the rest of this time in the field is a held tap (spec/APDU.md, A holder
        with no phone). Wants the PIN given in this tap."""
        return self.held(INS_GET_LOG, le=0x00, context="GET_LOG", most=LOG_HOLD_MOST,
                         note="the card counts the hold: keep holding it on the reader")

    def reset_by_pin(self, anchor: Optional[bytes] = None) -> None:
        """RESET_CARD P1 = 0, P2 = AD, on a card with no owner (D196): the PIN given and a held tap in this selection,
        nothing unspent or owed; the card resets at the sixtieth asking in a row (about 45 seconds on a chip). The card
        is then as from its install: no PIN, no record, no owner, a new card key and c. No data, or `anchor` (D200): a
        block header (80 bytes), the data of every asking, which becomes the card's clock even where it is older than
        the card's (the card is empty), the way back from a clock moved far ahead by one header."""
        if anchor is not None and len(anchor) != HEADER_LEN:
            raise SystemExit(f"the anchor is a block header, {HEADER_LEN} bytes; got {len(anchor)}")
        self.held(INS_RESET_CARD, p2=RESET_CONFIRM_BYTE, data=anchor or b"", context="RESET_CARD", most=RESET_MOST,
                  note="the card counts the reset: keep holding it on the reader (about 45 seconds)")

    # ── the clock ─────────────────────────────────────────────────────────────
    def set_header(self, header: bytes) -> int:
        if len(header) != HEADER_LEN:
            raise SystemExit(f"a block header is {HEADER_LEN} bytes; got {len(header)}")
        return int.from_bytes(self.send(INS_SET_HEADER, data=header, le=0x04, context="SET_HEADER"), "big")

    # ── write commands ────────────────────────────────────────────────────────
    def load_proof(self, keyset_id: bytes, amount: int, nonce: bytes, c: bytes, date: int = 0,
                   date_keys: bool = False) -> int:
        if len(keyset_id) != 8:
            raise SystemExit(f"keyset_id must be 8 raw bytes, got {len(keyset_id)}")
        # Every caller goes through here, so this is the one place that cannot be
        # bypassed. `cardctl load --amount 4294967296` used to reach
        # `amount.to_bytes(4, "big")` and die on a bare OverflowError traceback;
        # `--amount 0` used to burn a slot on a worthless proof.
        validate_slot_amount(amount)
        if len(nonce) != 32:
            raise SystemExit(f"nonce must be 32 bytes, got {len(nonce)}")
        if len(c) != 33:
            raise SystemExit(f"C must be 33 bytes, got {len(c)}")
        payload = keyset_id + amount.to_bytes(4, "big") + nonce + c
        if not self.legacy:
            if not 0 <= date < 2 ** 32:
                raise SystemExit(f"date must fit four bytes, got {date}")
            payload += date.to_bytes(4, "big")
        elif date:
            raise SystemExit("a 0.x card has no date in its slot")
        # P2 bit 1 (02), `date_keys`: the loader's word that the piece was minted locked to the card's key for its
        # date, P + t*G (and R + u*G), never to the card's main key P (protocol 3.0, Keys per load). Sent only when the
        # caller says so; a 3.0 card answers 6A86 to a load without it and writes nothing. A 0.x card takes P2 00.
        if date_keys and self.legacy:
            raise SystemExit("a 0.x card has no keys per date")
        return self.send(INS_LOAD_PROOF, p2=LOAD_DATE_KEYS if date_keys else 0, data=payload, le=0x01,
                         context="LOAD_PROOF")[0]

    def clear_spent(self) -> int:
        return self.send(INS_CLEAR_SPENT, le=0x01, context="CLEAR_SPENT")[0]

    # ── the card's own change (3.0) ───────────────────────────────────────────
    def load_change(self, k: int, c_blind65: bytes, k65: bytes, e: bytes, s: bytes) -> dict:
        """
        LOAD_CHANGE (27): opening `k` (0 to 7) made into its piece from the mint's answer for its B_: C_ and K (65
        bytes each, 04 || x || y, points of the curve), e and s (32 each). P2 02, the word on keys per load. Answers
        the slot, whether the mint's proof was kept with the piece, and the piece as GET_PROOF gives it after its
        status byte. Any reader, no PIN.
        """
        if not 0 <= k < CHANGE_MOST:
            raise SystemExit(f"an opening is 0 to {CHANGE_MOST - 1}, got {k}")
        for value, what in ((c_blind65, "C_"), (k65, "K")):
            if len(value) != EC_POINT_LEN or value[0] != 0x04:
                raise SystemExit(f"{what} is 65 bytes beginning 04")
            point_from_bytes(value, what)
        for value, what in ((e, "e"), (s, "s")):
            if len(value) != 32:
                raise SystemExit(f"{what} is 32 bytes, got {len(value)}")
        self._the_card_finishes_its_change("LOAD_CHANGE")
        b = self.send(INS_LOAD_CHANGE, p1=k, p2=LOAD_DATE_KEYS, data=c_blind65 + k65 + e + s,
                      le=LOAD_CHANGE_ANSWER_LEN, context=f"LOAD_CHANGE opening {k}")
        if len(b) != LOAD_CHANGE_ANSWER_LEN:
            raise SystemExit(f"LOAD_CHANGE returned {len(b)} bytes, expected {LOAD_CHANGE_ANSWER_LEN}")
        return {"slot": b[0], "proof_kept": b[1] == 1, "piece": decode_piece(b[2:])}

    def spend_all_change(self, amount: int, k33: bytes, keyset8: bytes) -> bytes:
        """SPEND_ALL_CHANGE (26), in a payment begun: a change output of `amount` for the card itself, bound to the
        mint's key K for that amount (33, compressed) and made in `keyset8`. Answers the output's B_ (33)."""
        if not 0 < amount < 2 ** 32:
            raise SystemExit(f"the change is 1 to 2^32 - 1, got {amount}")
        if len(k33) != 33 or k33[0] not in (0x02, 0x03):
            raise SystemExit("K is 33 bytes beginning 02 or 03")
        point_from_bytes(k33, "K")
        if len(keyset8) != 8:
            raise SystemExit(f"a keyset is 8 bytes, got {len(keyset8)}")
        b = self.send(INS_SPEND_ALL_CHANGE, data=amount.to_bytes(4, "big") + k33 + keyset8, le=0x21,
                      context="SPEND_ALL_CHANGE")
        if len(b) != 33:
            raise SystemExit(f"SPEND_ALL_CHANGE returned {len(b)} bytes, expected 33")
        return b

    # ── a keyset's keys (3.0) ─────────────────────────────────────────────────
    def keyset_keys_begin(self, keyset8: bytes, tail: bytes = b"") -> None:
        """KEYSET_KEYS P1 0, under the PIN given in this tap: the keyset (an entry of the card's table) and the tail
        NUT-02 hashes after its keys: none for a version 00 ID; for version 01 `|unit:sat` or `|unit:usd` first, then
        the end or `|`, 64 bytes at most."""
        if len(keyset8) != 8:
            raise SystemExit(f"a keyset is 8 bytes, got {len(keyset8)}")
        check_keyset_tail(keyset8[0], tail)
        self.send(INS_KEYSET_KEYS, p1=0x00, data=keyset8 + tail, context="KEYSET_KEYS begin")

    def keyset_keys_keys(self, keys: List[Tuple[int, bytes]]) -> None:
        """KEYSET_KEYS P1 1: one to six keys, amount (8) || K (33, compressed), in increasing order of amount."""
        if not 1 <= len(keys) <= KEYSET_KEYS_PER_COMMAND:
            raise SystemExit(f"one to {KEYSET_KEYS_PER_COMMAND} keys to a command, got {len(keys)}")
        self.send(INS_KEYSET_KEYS, p1=0x01, data=b"".join(keyset_key_wire(a, k) for a, k in keys),
                  context="KEYSET_KEYS keys")

    def keyset_keys_finish(self) -> bytes:
        """KEYSET_KEYS P1 2: the card ends the ID and keeps the tree's top where the ID is the keyset's. Answers the
        ID it worked out, 8 bytes (version 00) or 33 (version 01)."""
        b = self.send(INS_KEYSET_KEYS, p1=0x02, le=0x00, context="KEYSET_KEYS finish")
        if len(b) not in (8, 33):
            raise SystemExit(f"KEYSET_KEYS P1 2 returned {len(b)} bytes, expected 8 or 33")
        return b

    def keyset_keys_show(self, opening: int, index: int, path: List[bytes], other_key: Optional[bytes] = None,
                         other_keyset: Optional[bytes] = None) -> None:
        """KEYSET_KEYS P1 3: opening `opening`'s key shown to be its keyset's, by the leaf's index and its path (the
        leaf's sibling first, 0 to 6 nodes). With `other_key` (33) the opening is bound to that key, and with
        `other_keyset` (8) moved to that keyset as well: under the PIN and the holder's say, in a tap that paid
        nothing. Any reader may show the key an opening is bound to."""
        if not 0 <= opening < CHANGE_MOST:
            raise SystemExit(f"an opening is 0 to {CHANGE_MOST - 1}, got {opening}")
        if len(path) > KEYSET_PATH_MOST or any(len(node) != 32 for node in path):
            raise SystemExit(f"a path is 0 to {KEYSET_PATH_MOST} nodes of 32 bytes")
        if not 0 <= index < (1 << len(path)):
            raise SystemExit(f"a leaf's index under a path of {len(path)} is 0 to {(1 << len(path)) - 1}, got {index}")
        data = bytes([opening, index, len(path)]) + b"".join(path)
        if other_keyset is not None and other_key is None:
            raise SystemExit("another keyset is named only with another key")
        if other_key is not None:
            if len(other_key) != 33 or other_key[0] not in (0x02, 0x03):
                raise SystemExit("the other key is 33 bytes beginning 02 or 03")
            data += other_key
        if other_keyset is not None:
            if len(other_keyset) != 8:
                raise SystemExit(f"a keyset is 8 bytes, got {len(other_keyset)}")
            data += other_keyset
        self.send(INS_KEYSET_KEYS, p1=0x03, data=data, context=f"KEYSET_KEYS show opening {opening}")

    # ── the PIN ───────────────────────────────────────────────────────────────
    def verify_pin(self, pin: bytes) -> None:
        """VERIFY_PIN, sent again for as long as the card answers 6A98 (3.0, a card with no owner serving the wait its
        wrong tries left: keep holding it)."""
        self.held(INS_VERIFY_PIN, data=pin, context="VERIFY_PIN", most=PIN_WAIT_MOST,
                  note="the card is serving the wait its wrong tries left: keep holding it on the reader")

    def set_pin(self, pin: bytes) -> None:
        check_pin(pin)
        self.send(INS_SET_PIN, data=pin, context="SET_PIN")


def check_pin(pin: bytes) -> None:
    if not PIN_MIN_LEN <= len(pin) <= PIN_MAX_LEN:
        raise SystemExit(f"a PIN is {PIN_MIN_LEN} to {PIN_MAX_LEN} bytes, got {len(pin)}")


def limit_value(day: int, payment: Optional[int] = None, allowance: Optional[int] = None,
                budget: Optional[int] = None, rate: Optional[int] = None, no_pin_window: Optional[int] = None) -> bytes:
    """
    SET_LIMIT's value (spec/APDU.md, SET_LIMIT; the PIN form takes the same):
    the day's limit (4), then the limit on one payment (4), the no-PIN
    allowance (4), the rollover budget (1), the rate, sats to the dollar
    (4, 0 none), and the no-PIN window's switch (1: 0 the window of 24 hours,
    1 none). Every figure is in the card's unit (cents on a usd card). A
    longer form sets every field before it, so each needs the ones before it
    given: a budget alone would quietly set the other two to 0.
    """
    if no_pin_window is not None and rate is None:
        raise SystemExit("--no-pin-window is byte 17: give --rate too (0 for none)")
    if no_pin_window is not None and no_pin_window not in (0, 1):
        raise SystemExit(f"--no-pin-window is 0 (the window of 24 hours) or 1 (none), got {no_pin_window}")
    for name, v in (("day", day), ("payment", payment), ("allowance", allowance), ("rate", rate)):
        if v is not None and not 0 <= v < 2 ** 32:
            raise SystemExit(f"--{name} must fit four bytes, got {v}")
    if rate is not None and budget is None:
        raise SystemExit("--rate is bytes 13 to 16: give --budget too")
    if budget is not None and (payment is None or allowance is None):
        raise SystemExit("--budget is the thirteenth byte: give --payment and --allowance too (0 for none)")
    if allowance is not None and payment is None:
        raise SystemExit("--allowance is bytes 8 to 11: give --payment too (0 for none)")
    if budget is not None and not 1 <= budget <= ROLL_BUDGET_MOST:
        raise SystemExit(f"--budget is 1 to {ROLL_BUDGET_MOST} rolls between the owner's refreshes, got {budget}")
    value = day.to_bytes(4, "big")
    if payment is not None:
        value += payment.to_bytes(4, "big")
    if allowance is not None:
        value += allowance.to_bytes(4, "big")
    if budget is not None:
        value += bytes([budget])
    if rate is not None:
        value += rate.to_bytes(4, "big")
    if no_pin_window is not None:
        value += bytes([no_pin_window])
    return value


def decode_info(b: bytes) -> dict:
    """GET_INFO's answer (spec/APDU.md, GET_INFO): 30, 42, 43, 51 or 59 bytes, each form the one before it and more."""
    caps = b[6]
    info = {
        "version": f"{b[0]}.{b[1]}",
        "version_tuple": (b[0], b[1]),
        "max_slots": b[2],
        "unspent": b[3],
        "spent": b[4],
        "empty": b[5],
        "caps_raw": caps,
        "secp256k1_native": bool(caps & CAP_SECP256K1_NATIVE),
        "schnorr": bool(caps & CAP_SCHNORR),
        "pin_state": PIN_STATE_NAMES.get(b[7], f"unknown({b[7]})"),
        "format": b[8],
        "tries": b[9],
        "locked": bool(b[10]),
        "record_set": bool(b[11]),
        "daily_limit": int.from_bytes(b[12:16], "big"),
        "has_owner": bool(b[16]),
        "now": int.from_bytes(b[17:21], "big"),
        "window_start": int.from_bytes(b[21:25], "big"),
        "spent_today": int.from_bytes(b[25:29], "big"),
        "change_owed": bool(b[29]),
    }
    if len(b) >= 42:
        info["payment_limit"] = int.from_bytes(b[30:34], "big")
        info["allowance"] = int.from_bytes(b[34:38], "big")
        info["nopin_spent"] = int.from_bytes(b[38:42], "big")
    if len(b) >= 43:
        info["tag_off"] = bool(b[42])
    if len(b) >= 51:
        info["keyset_table"] = bool(b[43])
        info["rate"] = int.from_bytes(b[44:48], "big")
        info["entries"] = b[48]
        info["unmarked"] = b[49]
        info["last_unit"] = LAST_UNIT_NAMES.get(b[50], f"unknown({b[50]:02X})")
    if len(b) >= 55:
        info["nopin_window_start"] = int.from_bytes(b[51:55], "big")
    # a card that answers less than 57 bytes to P1 = 4 keeps none of the profiles
    if len(b) >= 57:
        info["profiles_raw"] = b[55:57]
        info["profiles"] = [name for at, bit, name in PROFILE_NAMES if b[at] >> bit & 1]
    if len(b) >= 59:
        info["loads_left"] = int.from_bytes(b[57:59], "big")
    return info


def decode_piece(b: bytes) -> dict:
    """A piece as GET_PROOF gives it after its status byte (81): keyset (8), amount (4), nonce (32), C (33), date (4)."""
    if len(b) != PROOF_SIZE - 1:
        raise SystemExit(f"a piece is {PROOF_SIZE - 1} bytes, got {len(b)}")
    return {"keyset_id": b[0:8].hex(), "amount": int.from_bytes(b[8:12], "big"), "nonce": b[12:44], "c": b[44:77],
            "date": int.from_bytes(b[77:81], "big")}


def decode_change(b: bytes) -> List[dict]:
    """GET_CHANGE's answer (3.0): a count, then that many openings of 83 bytes: the opening's number (1), amount (4),
    keyset (8), date (4), B_ (33) and K, the mint's key it is bound to (33)."""
    if not b or b[0] > CHANGE_PAGE or len(b) != 1 + b[0] * CHANGE_ROW_LEN:
        raise SystemExit(f"GET_CHANGE returned {len(b)} bytes, not a count of 0 to {CHANGE_PAGE} and "
                         f"{CHANGE_ROW_LEN}-byte openings: {_hex(b)}")
    rows = []
    for i in range(b[0]):
        r = b[1 + i * CHANGE_ROW_LEN:1 + (i + 1) * CHANGE_ROW_LEN]
        if r[0] >= CHANGE_MOST:
            raise SystemExit(f"GET_CHANGE named opening {r[0]}; a card has {CHANGE_MOST}")
        rows.append({"number": r[0], "amount": int.from_bytes(r[1:5], "big"), "keyset": r[5:13],
                     "date": int.from_bytes(r[13:17], "big"), "b_": r[17:50], "k": r[50:83]})
    return rows


def decode_card(b: bytes) -> dict:
    """GET_CARD's answer (spec/APDU.md, GET_CARD)."""
    if len(b) < 106:
        raise SystemExit(f"GET_CARD returned {len(b)} bytes, expected at least 106: {_hex(b)}")
    mint_len = b[105]
    budget = b[77]
    return {
        "format": b[0],
        "record_set": bool(b[1]),
        "unit": b[2],
        "daily_limit": int.from_bytes(b[3:7], "big"),
        "refund_key": b[7:40],
        "hardest_bits": b[40:44],
        "last_header": b[44:76].hex(),
        "rolls": b[76],
        "budget_raw": budget,
        "budget": budget or ROLL_BUDGET_DEFAULT,
        "armed": bool(b[78]),
        "no_pin_start": int.from_bytes(b[83:87], "big"),
        "no_pin_window": b[87],
        "mint": b[106:106 + mint_len].decode("ascii", errors="replace"),
        "design": b[106 + mint_len:109 + mint_len],
    }


def auth_message(reader_nonce: bytes, card_nonce: bytes, card_key: bytes) -> bytes:
    """What AUTH signs: SHA-256(T || T || reader (16) || card (16) || card key (33)), T = SHA-256("CashuCard/auth")."""
    return bip340.tagged_hash(AUTH_TAG, reader_nonce + card_nonce + card_key)


# ── helpers ───────────────────────────────────────────────────────────────────
def parse_hex(value: str, expected_len: Optional[int] = None, what: str = "value") -> bytes:
    # spec/CARD-FILE.md: hex is case-insensitive on read and `0x` prefixes are
    # tolerated. That has to include `0X` — a prefix check that is itself
    # case-sensitive would make the spec's claim false for exactly the values
    # the case-insensitivity claim invites.
    stripped = value[2:] if value[:2].lower() == "0x" else value
    try:
        b = bytes.fromhex(stripped)
    except ValueError:
        raise SystemExit(f"{what} is not valid hex: {value!r}")
    if expected_len is not None and len(b) != expected_len:
        raise SystemExit(f"{what} must be {expected_len} bytes ({expected_len*2} hex chars), got {len(b)}")
    return b


def connect(args) -> Card:
    """
    A card with the applet selected. The card file tools ask for the 0.x applet
    (`legacy`) and refuse a card that answers any other major version; every
    other command speaks majors 2 and 3 (PROTOCOL_MAJORS) and refuses any other.
    """
    legacy = bool(getattr(args, "legacy", False))
    card = Card(reader_index=args.reader, verbose=args.verbose)
    version = card.select(legacy=legacy)
    major = version[0] if version else None
    if legacy and major != 0:
        raise SystemExit(f"this card answers version {_version_text(version)}; card files are 0.x-only (spec/CARD-FILE.md)")
    if not legacy and major not in PROTOCOL_MAJORS:
        raise SystemExit(f"this card answers version {_version_text(version)}; cardctl speaks protocols 2.x and 3.x")
    return card


def _version_text(version: bytes) -> str:
    return f"{version[0]}.{version[1]}" if len(version) >= 2 else (_hex(version) or "nothing")


def owner_key(args) -> int:
    """
    The owner's private key for the owner's commands: `--owner-key HEX` (32
    bytes), or the fixed TEST key (p256.TEST_OWNER_PRIVATE) when none is given,
    with a warning: anyone with this repository holds that key.
    """
    value = getattr(args, "owner_key", None)
    if not value or value == "test":
        print("note: signing with cardctl's TEST owner key — bench cards only; anyone with this "
              "repository can administer a card owned by it", file=sys.stderr)
        return p256.TEST_OWNER_PRIVATE
    d = int.from_bytes(parse_hex(value, 32, "--owner-key"), "big")
    if not 0 < d < p256.N:
        raise SystemExit("--owner-key is not a P-256 private key (0 < d < n)")
    return d


def parse_header(value: str, what: str = "--header") -> bytes:
    return parse_hex(value, HEADER_LEN, what)


def header_time(header: bytes) -> int:
    """A block header's time, seconds (bytes 68 to 71, little-endian)."""
    return int.from_bytes(header[68:72], "little")


def clock_ahead_problem(now: int, tip: bytes) -> Optional[str]:
    """Why a card whose clock is `now` is not set up on the tip header `tip` (D203), or None: a clock more than two
    hours past the tip was set by a header far ahead, and the card cannot say whether that header was weak."""
    if now <= header_time(tip) + CLOCK_AHEAD_MOST:
        return None
    return (f"the card's clock ({now}) is more than two hours past the tip's time ({header_time(tip)}): a header far "
            "ahead set it, and the card's days would be held there. Bring it back first, while the card is empty, by "
            "the reset with the tip as its anchor (it takes about 45 seconds on the reader): python3 cardctl.py reset "
            "--pin <a PIN> --anchor <the tip header> (a card with no PIN is given that PIN for the reset alone; one "
            "with an owner: --owner-key <its owner key> in place of --pin). Then run setup")


def check_mint(mint: str, factory: bool = False) -> bytes:
    """The mint as the record carries it: 1 to 77 printable ASCII characters, no space. `-` alone is a factory record,
    taken only where `factory` says so."""
    if not all(0x21 <= ord(ch) <= 0x7E for ch in mint):
        raise SystemExit(f"the mint is printable ASCII with no space; got {mint!r}")
    if not 1 <= len(mint) <= MINT_MOST:
        raise SystemExit(f"the mint is 1 to {MINT_MOST} characters; got {len(mint)}")
    if mint == FACTORY_MINT and not factory:
        raise SystemExit("a mint of '-' alone is a factory record, not a holder's mint")
    return mint.encode("ascii")


def check_refund_key(b: bytes) -> bytes:
    """A refund key as SET_CARD takes it: 33 zeros (none), or 02/03 and the x of a point of secp256k1 (`6A80` at the
    card otherwise)."""
    if len(b) != 33:
        raise SystemExit(f"a refund key is 33 bytes; got {len(b)}")
    if any(b):
        point_from_bytes(b, "--refund")
    return b


def bits_target(bits: int) -> Optional[int]:
    """The target a header's `bits` name (Bitcoin's compact form), or None for bits no header could carry: a size of
    0 or past 32 bytes, or a mantissa with its top bit set."""
    size, mantissa = bits >> 24, bits & 0xFFFFFF
    if not 1 <= size <= 32 or mantissa & 0x800000:
        return None
    return mantissa << (8 * (size - 3)) if size >= 3 else mantissa >> (8 * (3 - size))


def header_work_problem(header: bytes, hardest_bits: Optional[bytes] = None) -> Optional[str]:
    """What the card would refuse in a block header (SET_HEADER, REFRESH and an anchored SET_OWNER, `6A93` or `6A80`),
    or None: the hash at or under its own bits' target, that target at or under the floor and, where the card has
    taken a header (`hardest_bits`, GET_CARD bytes 40 to 43, little-endian; zeros for none), at or under four times the
    target of the hardest taken."""
    if len(header) != HEADER_LEN:
        return f"a block header is {HEADER_LEN} bytes; got {len(header)}"
    target = bits_target(int.from_bytes(header[72:76], "little"))
    if target is None:
        return f"bits {header[72:76][::-1].hex()} name no target a header could carry (6A80 at the card)"
    work = int.from_bytes(hashlib.sha256(hashlib.sha256(header).digest()).digest(), "little")
    if work > target:
        return "the header's hash is over the target its own bits name: not a block's work (6A93 at the card)"
    if target > bits_target(FLOOR_BITS):
        return f"its target is over the floor the card is built with (bits {FLOOR_BITS:08X}) (6A93 at the card)"
    if hardest_bits and any(hardest_bits):
        hardest = bits_target(int.from_bytes(hardest_bits, "little"))
        if hardest is not None and target > min(4 * hardest, 2 ** 256 - 1):
            return ("its target is over a quarter of the work of the hardest header this card has taken (bits "
                    f"{hardest_bits[::-1].hex()}): use a recent tip (6A93 at the card)")
    return None


def header_is_weak(header: bytes, hardest_bits: Optional[bytes]) -> bool:
    """Whether the card holds a header that passes its checks to be weak (D201, D203): less than half the work of the
    hardest it has taken (its target over twice that one's), or, where it has taken none (`hardest_bits` zeros), less
    than twice the floor's work (its target over half the floor's). No `REFRESH` brings a clock back to a weak header."""
    target = bits_target(int.from_bytes(header[72:76], "little")) or 0
    if hardest_bits and any(hardest_bits):
        hardest = bits_target(int.from_bytes(hardest_bits, "little"))
        return hardest is not None and target > 2 * hardest
    return 2 * target > bits_target(FLOOR_BITS)


def check_signature(pubkey: bytes, message: bytes, sig: bytes) -> bool:
    return bip340.verify(bip340.x_only(pubkey), message, sig)


# ── secp256k1 for the keys per load and the seal (bip340.py's arithmetic) ────
def point_from_bytes(b: bytes, what: str = "point") -> Tuple[int, int]:
    """A point of secp256k1 from 33 bytes (02/03 || x) or 65 (04 || x || y); SystemExit for bytes that are not one."""
    if len(b) == 33 and b[0] in (0x02, 0x03):
        pt = bip340.lift_x(int.from_bytes(b[1:], "big"))
        if pt is not None:
            return pt if (pt[1] & 1) == (b[0] & 1) else (pt[0], bip340.P - pt[1])
    elif len(b) == EC_POINT_LEN and b[0] == 0x04:
        x, y = int.from_bytes(b[1:33], "big"), int.from_bytes(b[33:], "big")
        if x < bip340.P and y < bip340.P and (y * y - x * x * x - 7) % bip340.P == 0:
            return (x, y)
    raise SystemExit(f"{what} is not a point of secp256k1: {_hex(b)}")


def point_compressed(pt: Tuple[int, int]) -> bytes:
    return bytes([0x02 | (pt[1] & 1)]) + pt[0].to_bytes(32, "big")


def point_uncompressed(pt: Tuple[int, int]) -> bytes:
    return b"\x04" + pt[0].to_bytes(32, "big") + pt[1].to_bytes(32, "big")


def scalar_mul(k: int, pt: Tuple[int, int] = bip340.G) -> Tuple[int, int]:
    out = bip340._point_mul(pt, k % bip340.N)
    if out is None:
        raise SystemExit("a multiple of the curve's order: no point")
    return out


def date_tweak(label: str, c: bytes, date: int) -> int:
    """SHA-256(label || c || date (4)) mod n: t with LABEL_KEY, u with LABEL_REFUND_KEY (Keys per load)."""
    return int.from_bytes(hashlib.sha256(label.encode("ascii") + c + date.to_bytes(4, "big")).digest(), "big") % bip340.N


def date_keys(c: bytes, card_key: bytes, refund_key: bytes, date: int) -> dict:
    """A date's keys worked out from c, as GROUP_KEYS answers them: t, P + t*G, and R + u*G (33 zeros with no refund
    key or for the date 0)."""
    t = date_tweak(LABEL_KEY, c, date)
    key = point_compressed(bip340._point_add(point_from_bytes(card_key, "the card key"), scalar_mul(t)))
    refund = bytes(33)
    if any(refund_key) and date:
        u = date_tweak(LABEL_REFUND_KEY, c, date)
        refund = point_compressed(bip340._point_add(point_from_bytes(refund_key, "the refund key"), scalar_mul(u)))
    return {"t": t.to_bytes(32, "big"), "key": key, "refund": refund}


def seal_block(shared: Tuple[int, int], in_e_place: bytes, nonce: bytes, ins: int, i: int = 1) -> bytes:
    """Block i of the seal: SHA-256("CashuCard/seal" || i || x of the shared point || the key in E's place (65) ||
    the card's sixteen bytes || INS)."""
    return hashlib.sha256(SEAL_LABEL.encode("ascii") + bytes([i]) + shared[0].to_bytes(32, "big") + in_e_place
                          + nonce + bytes([ins])).digest()


def pin_key_signed(card_key: bytes, pin_key: bytes, sig: bytes) -> bool:
    """Whether GET_NONCE P1 = 1's signature is the card key's over SHA-256("CashuCard/pinkey" || PIN key)."""
    return check_signature(card_key, hashlib.sha256(PINKEY_LABEL.encode("ascii") + pin_key).digest(), sig)


def open_card_secret(answer: bytes, nonce: bytes, private: int, pin_key: Optional[bytes] = None) -> bytes:
    """
    c from GET_CARD P1 = 3's answer. 97 bytes (a card with a refund key): K (65) and the sealed c; `private` is the
    refund key's r, and the shared point r*K. 32 bytes (a card with none): the sealed c; `private` is the reader's
    one-time e, `pin_key` the card's PIN key, and the shared point e*PIN key, with E = e*G in E's place.
    """
    if len(answer) == EC_POINT_LEN + CARD_SECRET_LEN:
        in_e_place, sealed = answer[:EC_POINT_LEN], answer[EC_POINT_LEN:]
        shared = scalar_mul(private, point_from_bytes(in_e_place, "K"))
    elif len(answer) == CARD_SECRET_LEN and pin_key is not None:
        in_e_place, sealed = point_uncompressed(scalar_mul(private)), answer
        shared = scalar_mul(private, point_from_bytes(pin_key, "the PIN key"))
    else:
        raise SystemExit(f"GET_CARD P1 = 3: an answer of {len(answer)} bytes does not open here")
    block = seal_block(shared, in_e_place, nonce, INS_GET_CARD)
    return bytes(a ^ b for a, b in zip(sealed, block))


def seed_from_words(words: str, passphrase: str = "") -> bytes:
    """BIP-39's seed of a phrase: PBKDF2-HMAC-SHA512 over the words (NFKD), salt "mnemonic" and the passphrase, 2048
    rounds, 64 bytes. The words are not checked against the word list here."""
    import unicodedata
    w = unicodedata.normalize("NFKD", " ".join(words.split()))
    salt = ("mnemonic" + unicodedata.normalize("NFKD", passphrase)).encode("utf-8")
    return hashlib.pbkdf2_hmac("sha512", w.encode("utf-8"), salt, 2048)


def owner_s(seed: bytes, card_key: bytes) -> bytes:
    """The owner's s for one card (D202): HMAC-SHA256(the 64-byte BIP-39 seed, "CashuCard/c" || 00 || P (33))."""
    if len(seed) != BIP39_SEED_LEN:
        raise SystemExit(f"the owner's seed is the 64-byte BIP-39 seed, got {len(seed)} bytes")
    if len(card_key) != 33:
        raise SystemExit("the card key is 33 bytes, compressed")
    return hmac.new(seed, LABEL_C.encode("ascii") + b"\x00" + card_key, hashlib.sha256).digest()


def owner_c_check(s: bytes) -> bytes:
    """The check SET_OWNER's value ends with: SHA-256("CashuCard/c" || s)'s first sixteen bytes."""
    return hashlib.sha256(LABEL_C.encode("ascii") + s).digest()[:OWNER_C_CHECK_LEN]


def owner_c(s: bytes, n: int) -> bytes:
    """c = SHA-256("CashuCard/c" || s || n (4, big-endian)): the card's c when it is the n-th owner's c it took."""
    return hashlib.sha256(LABEL_C.encode("ascii") + s + n.to_bytes(4, "big")).digest()


def owner_c_count(s: bytes, c: bytes, most: int = 1 << 16) -> Optional[int]:
    """The n for which c is the owner's c of s (1, 2, ...), or None: a c that no n up to `most` makes."""
    for n in range(1, most + 1):
        if owner_c(s, n) == c:
            return n
    return None


def owner_c_count_on_card(card, s: bytes, most: int = 1 << 16) -> Optional[int]:
    """owner_c_count run on what the card answers (D202): the n for which the card's c is the owner's c of s, or
    None. c itself is sealed to the refund key, whose private key a set-up does not hold, so the card's c is read
    back through `GROUP_KEYS` for the date 0, whose t = SHA-256("CashuCard/key" || c || 00000000) mod n only that c
    gives. Wants the PIN given in this tap, or the owner's grant."""
    t = int.from_bytes(card.group_keys(0)["t"], "big")
    for n in range(1, most + 1):
        if date_tweak(LABEL_KEY, owner_c(s, n), 0) == t:
            return n
    return None


def _owner_c_line(n: Optional[int]) -> str:
    """What setup and set-owner say of the owner's c they gave, once read back from the card; SystemExit where the
    card's c is not it."""
    if n is None:
        raise SystemExit("the card's c is not the owner's c of --owner-seed for this card: another party's envelope "
                         "was taken (a reader in this tap, or at a hand-over the last owner's phone). Lock no dated "
                         "money to its keys and file nothing for it: reset it with the owner key (python3 cardctl.py "
                         "reset --owner-key <the owner key>) and set it up again")
    return f"; c is the owner's, from --owner-seed, read back from the card ({_ordinal(n)} owner's c it has taken)"


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def owner_c_block(i: int, x: bytes, e_pub: bytes, more: bytes = b"") -> bytes:
    return hashlib.sha256(LABEL_C.encode("ascii") + bytes([i]) + x + e_pub + more).digest()


def owner_c_envelope(s: bytes, pin_key: bytes, e: Optional[int] = None) -> bytes:
    """SET_OWNER P1 = 1's data (D202): E (65) || s XOR block 1 || block 0's first sixteen bytes, to the card's PIN key
    (GET_NONCE P1 = 1, its signature by the card key checked first), with a one-message scalar e (fresh where none is
    given)."""
    if len(s) != 32:
        raise SystemExit("s is 32 bytes")
    if e is None:
        e = secrets.randbelow(bip340.N - 1) + 1
    e_pub = point_uncompressed(scalar_mul(e))
    x = scalar_mul(e, point_from_bytes(pin_key, "the PIN key"))[0].to_bytes(32, "big")
    sealed = bytes(a ^ b for a, b in zip(s, owner_c_block(1, x, e_pub)))
    return e_pub + sealed + owner_c_block(0, x, e_pub, sealed)[:16]


def _owner_seed(args) -> Optional[bytes]:
    """--owner-seed HEX (3.0, D202): the owner's 64-byte BIP-39 seed, from which the card's c is worked out."""
    value = getattr(args, "owner_seed", None)
    return parse_hex(value, BIP39_SEED_LEN, "--owner-seed") if value else None


# ── a keyset's keys and the tree the card keeps of them (3.0, KEYSET_KEYS) ───
KEYSET_PAD = hashlib.sha256(b"\x02").digest()


def check_keyset_tail(version: int, tail: bytes) -> None:
    """The tail KEYSET_KEYS P1 0 takes after a keyset of `version`: none for 00; for 01, `|unit:sat` or `|unit:usd`,
    then the end or `|`, 64 bytes at most."""
    if version not in (0, 1):
        raise SystemExit(f"a keyset ID of version 00 or 01, got {version:02x}")
    if version == 0:
        if tail:
            raise SystemExit("a version 00 ID hashes the keys alone: no tail")
        return
    named = [u for u in KEYSET_UNITS if tail.startswith(b"|unit:" + u.encode())
             and tail[6 + len(u):7 + len(u)] in (b"", b"|")]
    if not named or len(tail) > KEYSET_TAIL_MOST:
        raise SystemExit(f"a version 01 tail names its unit first, |unit:sat or |unit:usd, then the end or |, "
                         f"{KEYSET_TAIL_MOST} bytes at most: {tail!r}")


def keyset_tail(unit: str, input_fee_ppk: int = 0, final_expiry: Optional[int] = None) -> bytes:
    """NUT-02's text after the keys for a version 01 ID: |unit:U, then |input_fee_ppk:F where the fee is not 0, then
    |final_expiry:T where the keyset has one."""
    tail = f"|unit:{unit}"
    if input_fee_ppk:
        tail += f"|input_fee_ppk:{input_fee_ppk}"
    if final_expiry is not None:
        tail += f"|final_expiry:{final_expiry}"
    return tail.encode("ascii")


def keyset_key_wire(amount: int, k33: bytes) -> bytes:
    """A key as KEYSET_KEYS P1 1 takes it: amount (8) || K (33, compressed)."""
    if not 0 < amount < 2 ** 64:
        raise SystemExit(f"a key's amount is 1 to 2^64 - 1, got {amount}")
    if len(k33) != 33 or k33[0] not in (0x02, 0x03):
        raise SystemExit("a keyset's key is 33 bytes beginning 02 or 03")
    return amount.to_bytes(8, "big") + k33


def keyset_id(version: int, keys: List[Tuple[int, bytes]], tail: bytes = b"") -> bytes:
    """NUT-02's ID of `keys`, in increasing order of amount: version 00, 00 || SHA-256(the keys end to end)[:7];
    version 01, 01 || SHA-256("amount:K hex" joined by "," || tail)."""
    if version == 0:
        return b"\x00" + hashlib.sha256(b"".join(k for _, k in keys)).digest()[:7]
    text = ",".join(f"{a}:{k.hex()}" for a, k in keys).encode("ascii") + tail
    return b"\x01" + hashlib.sha256(text).digest()


def keyset_leaf(amount: int, k33: bytes) -> bytes:
    """A leaf of the card's tree: SHA-256(00 || amount (8) || K)."""
    return hashlib.sha256(b"\x00" + keyset_key_wire(amount, k33)).digest()


def keyset_levels(keys: List[Tuple[int, bytes]]) -> List[List[bytes]]:
    """The tree's levels, the leaves first (padded to a power of two with SHA-256(02)), the top last; nodes
    SHA-256(01 || left || right)."""
    level = [keyset_leaf(a, k) for a, k in keys]
    size = 1
    while size < len(level):
        size *= 2
    level += [KEYSET_PAD] * (size - len(level))
    levels = [level]
    while len(level) > 1:
        level = [hashlib.sha256(b"\x01" + level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
        levels.append(level)
    return levels


def keyset_path(keys: List[Tuple[int, bytes]], index: int) -> List[bytes]:
    """The path of leaf `index`: its sibling, then each node's sibling up to the top."""
    levels = keyset_levels(keys)
    return [levels[h][(index >> h) ^ 1] for h in range(len(levels) - 1)]


def fold_path(leaf: bytes, index: int, path: List[bytes]) -> bytes:
    """The top a leaf and its path reach, as the card folds them: bit i of the index is 1 where the node at height i
    is a right child."""
    node = leaf
    for i, sibling in enumerate(path):
        pair = sibling + node if index >> i & 1 else node + sibling
        node = hashlib.sha256(b"\x01" + pair).digest()
    return node


def read_keyset_file(path: str, input_fee_ppk: Optional[int] = None) -> dict:
    """
    A mint's keyset as NUT-01 serves it, {"id": ..., "unit": ..., "keys": {"1": "02..", ...}} (or GET /v1/keys's
    {"keysets": [that]} with one keyset), with NUT-02's "input_fee_ppk" and "final_expiry" where the file has them
    (`input_fee_ppk` given here wins). Answers the ID (8 or 33 bytes), the unit, the keys in increasing order of
    amount and the tail, after checking the keys hash to the file's ID.
    """
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if isinstance(doc, dict) and "keysets" in doc:
        if not isinstance(doc["keysets"], list) or len(doc["keysets"]) != 1:
            raise SystemExit(f"{path}: give a file of one keyset (it holds {len(doc['keysets'])})")
        doc = doc["keysets"][0]
    if not isinstance(doc, dict) or not isinstance(doc.get("keys"), dict) or not isinstance(doc.get("id"), str):
        raise SystemExit(f"{path}: not a keyset of the NUT-01 shape {{\"id\", \"unit\", \"keys\"}}")
    want = parse_hex(doc["id"], None, "the keyset's id")
    if not (len(want) == 8 and want[0] == 0) and not (len(want) == 33 and want[0] == 1):
        raise SystemExit(f"{path}: a keyset id of version 00 (16 hex characters) or 01 (66), got {doc['id']!r}")
    keys = []
    for amount, key in doc["keys"].items():
        if not str(amount).isdigit():
            raise SystemExit(f"{path}: the amount {amount!r} is not a whole number")
        k = parse_hex(key, 33, f"the key for {amount}")
        point_from_bytes(k, f"the key for {amount}")
        keys.append((int(amount), k))
    keys.sort()
    if not 1 <= len(keys) <= KEYSET_KEYS_MOST:
        raise SystemExit(f"{path}: {len(keys)} keys; the card is taught 1 to {KEYSET_KEYS_MOST}")
    for a, k in keys:
        keyset_key_wire(a, k)
    version = want[0]
    unit = str(doc.get("unit", ""))
    tail = b""
    if version == 0:
        if [a for a, _ in keys] != [1 << i for i in range(len(keys))]:
            raise SystemExit(f"{path}: a version 00 keyset's n-th key is for 2^n, from 1, with none left out")
    else:
        if unit not in KEYSET_UNITS:
            raise SystemExit(f"{path}: the unit {unit!r}; the card holds keysets of {' and '.join(KEYSET_UNITS)}")
        fee = doc.get("input_fee_ppk", 0) if input_fee_ppk is None else input_fee_ppk
        tail = keyset_tail(unit, int(fee or 0), doc.get("final_expiry"))
        check_keyset_tail(version, tail)
    worked = keyset_id(version, keys, tail)
    if worked != want:
        raise SystemExit(f"{path}: the keys and the tail {tail.decode()!r} hash to {worked.hex()}, not the file's id "
                         f"{want.hex()}" + ("; a keyset with a fee needs its input_fee_ppk (GET /v1/keysets): "
                                           "--input-fee-ppk" if version == 1 else ""))
    return {"id": want, "unit": unit, "keys": keys, "tail": tail}


# ── the mint's proof for a blind signature (NUT-12), as LOAD_CHANGE checks it ─
def dleq_holds(b_: bytes, c_: bytes, k: bytes, e: bytes, s: bytes) -> bool:
    """Whether e and s prove C_ = k*B_ for the private key of K: R1 = s*G - e*K, R2 = s*B_ - e*C_, and e is the
    SHA-256 of R1, R2, K and C_, each uncompressed, as lowercase hex text."""
    big_b, big_c, big_k = (point_from_bytes(p, what) for p, what in ((b_, "B_"), (c_, "C_"), (k, "K")))
    e_int, s_int = int.from_bytes(e, "big") % bip340.N, int.from_bytes(s, "big") % bip340.N

    def minus(pt):
        return None if pt is None else (pt[0], bip340.P - pt[1])

    r1 = bip340._point_add(bip340._point_mul(bip340.G, s_int), minus(bip340._point_mul(big_k, e_int)))
    r2 = bip340._point_add(bip340._point_mul(big_b, s_int), minus(bip340._point_mul(big_c, e_int)))
    if r1 is None or r2 is None:
        return False
    text = "".join(point_uncompressed(p).hex() for p in (r1, r2, big_k, big_c))
    return hashlib.sha256(text.encode("ascii")).digest() == e


def placeholder_c(nonce: bytes) -> bytes:
    """A placeholder C for `load` without --c: a point of the curve (a 3.0 card refuses one that is not, 6A80), found
    from the nonce by SHA-256("cardctl/placeholder-C" || nonce || counter) until its x is on the curve. Nobody knows
    its discrete log and no mint signed it: it cannot be redeemed."""
    for counter in range(256):
        x = hashlib.sha256(b"cardctl/placeholder-C" + nonce + bytes([counter])).digest()
        if bip340.lift_x(int.from_bytes(x, "big")) is not None:
            return b"\x02" + x
    raise SystemExit("no placeholder point found")  # 2^-256: never


def card_secret(nonce: bytes, card_key: bytes) -> str:
    """An undated card proof secret (NUT-CCP), as the relay rebuilds it for a packet's input."""
    return ('["P2PK",{"nonce":"' + nonce.hex() + '","data":"' + card_key.hex()
            + '","tags":[["sigflag","SIG_ALL"]]}]')


def decode_outbox(packet: bytes) -> dict:
    """
    A GET_OUTBOX packet (spec/APDU.md, GET_OUTBOX), read in relay.js's order, with its two
    signatures checked here: the witness over the SIG_ALL message (each input's secret and
    C in hex, then each output's amount in decimal and B_ in hex), and the descriptor over
    SHA-256(tag || tag || body). Raises ValueError on a packet that does not parse; the
    signatures' results are `witness_valid` and `descriptor_valid`.
    """
    at = 0

    def take(n: int) -> bytes:
        nonlocal at
        if at + n > len(packet):
            raise ValueError(f"the packet ends at {len(packet)} bytes, short of a field at {at}")
        b = packet[at:at + n]
        at += n
        return b

    def number(n: int) -> int:
        return int.from_bytes(take(n), "big")

    if take(7) != OUTBOX_MAGIC:
        raise ValueError("not a CCP-AS 01 packet")
    card_key = take(33)
    installation = take(32)
    payment_id = number(8)
    index = number(1)
    generation = number(4)
    if number(1) != 1:
        raise ValueError("not profile 01")
    mint = take(number(2)).decode("ascii")
    unit = number(1)
    inputs = []
    for _ in range(number(1)):
        slot, gen, amount = number(1), number(4), number(4)
        keyset = take(number(1))
        inputs.append({"slot": slot, "generation": gen, "amount": amount, "keyset": keyset,
                       "nonce": take(32), "c": take(33)})
    outputs = []
    for _ in range(number(1)):
        amount = number(4)
        keyset = take(number(1))
        outputs.append({"amount": amount, "keyset": keyset, "b_": take(33)})
    witness = take(64)
    body = packet[:at]
    descriptor = take(64)
    if at != len(packet):
        raise ValueError(f"{len(packet) - at} bytes after the descriptor")
    for i in inputs:
        i["secret"] = card_secret(i["nonce"], card_key)
    transcript = "".join(i["secret"] + i["c"].hex() for i in inputs) + "".join(f"{o['amount']}{o['b_'].hex()}" for o in outputs)
    message = hashlib.sha256(transcript.encode("ascii")).digest()
    tag = hashlib.sha256(OUTBOX_TAG.encode("ascii")).digest()
    described = hashlib.sha256(tag + tag + body).digest()
    return {
        "card_key": card_key, "installation": installation, "payment_id": payment_id, "index": index,
        "generation": generation, "mint": mint, "unit": unit, "inputs": inputs, "outputs": outputs,
        "witness": witness, "descriptor": descriptor, "body": body, "payment_message": message,
        "scope": bytes([index]) + payment_id.to_bytes(8, "big") + generation.to_bytes(4, "big") + hashlib.sha256(body).digest(),
        "witness_valid": check_signature(card_key, message, witness),
        "descriptor_valid": check_signature(card_key, described, descriptor),
    }


def print_outbox(p: dict, card_key: Optional[bytes] = None, scope: Optional[bytes] = None) -> bool:
    """Print a decoded packet, field by field, and VALID or INVALID. True when valid."""
    print(f"card key     : {_hex(p['card_key'])}")
    print(f"installation : {_hex(p['installation'])}")
    print(f"payment id   : {p['payment_id']}   index {p['index']}   generation {p['generation']}")
    print(f"mint         : {p['mint']}   unit {p['unit']}")
    for i in p["inputs"]:
        print(f"input        : slot {i['slot']:3}  gen {i['generation']}  {i['amount']:>10}  keyset {_hex(i['keyset'])}  "
              f"nonce {_hex(i['nonce'])}  C {_hex(i['c'])}")
    for o in p["outputs"]:
        print(f"output       : {o['amount']:>10}  keyset {_hex(o['keyset'])}  B_ {_hex(o['b_'])}")
    print(f"payment msg  : {_hex(p['payment_message'])}")
    print(f"witness      : {_hex(p['witness'])}  {'verifies' if p['witness_valid'] else 'DOES NOT VERIFY'}")
    print(f"descriptor   : {_hex(p['descriptor'])}  {'verifies' if p['descriptor_valid'] else 'DOES NOT VERIFY'}")
    ok = p["witness_valid"] and p["descriptor_valid"]
    if card_key is not None and card_key != p["card_key"]:
        print("card key     : NOT the card's (GET_PUBKEY)")
        ok = False
    if scope is not None and scope != p["scope"]:
        print(f"scope        : {_hex(scope)} is NOT the packet's {_hex(p['scope'])}")
        ok = False
    print("VALID" if ok else "INVALID")
    return ok



# ── commands ──────────────────────────────────────────────────────────────────
def cmd_readers(args) -> int:
    readers_fn = _load_pyscard()
    found = readers_fn()
    if not found:
        print("No PC/SC readers found.")
        return 1
    for i, r in enumerate(found):
        print(f"[{i}] {r}")
    return 0


def cmd_info(args) -> int:
    card = connect(args)
    i = card.get_info()
    c = card.get_card()
    print(f"applet version   : {i['version']} (format {i['format']})")
    print(f"slots            : {i['max_slots']} total — "
          f"{i['unspent']} unspent, {i['spent']} spent, {i['empty']} empty")
    print(f"capabilities     : 0x{i['caps_raw']:02X} "
          f"(secp256k1 native={i['secp256k1_native']}, schnorr={i['schnorr']})")
    print(f"PIN              : {i['pin_state']} ({i['tries']} tries left)")
    print(f"owner            : {_owner_words(card, i)}")
    print(f"record           : {'set, mint ' + c['mint'] if i['record_set'] else 'not set'}")
    print(f"locked           : {'yes' if i['locked'] else 'no'}")
    print(f"clock            : {i['now'] or 'no block header taken yet'}")
    print(f"daily limit      : {i['daily_limit'] or 'none'} (window from {i['window_start']}, "
          f"{i['spent_today']} signed for in it)")
    if "allowance" in i:
        print(f"no-PIN allowance : {i['allowance'] or 'none'} ({i['nopin_spent']} signed for without the PIN)")
    for line in info_23_lines(i):
        print(line)
    print(f"rollover budget  : {c['rolls']} of {c['budget']} rolls since the owner's last refresh"
          f"{' (spent: the day stands until a refresh)' if c['rolls'] >= c['budget'] else ''}; "
          f"allowance {'armed' if c['armed'] else 'not armed'}")
    print(f"balance          : {card.get_balance()}")
    return 0


def _owner_words(card, i: dict) -> str:
    """`info`'s owner line. On 3.0 (D196) a card with no owner is open to a claim only in its first set-up: one with no
    PIN is open to the first phone that sets it up; one with a PIN is a holder's card with no phone, which takes an
    owner only after a reset by its PIN. A 2.2 card with no owner and nothing on it takes a claim at any time."""
    if i["has_owner"]:
        return "yes"
    if card.at_least(3, 0) and i["pin_state"] != "none":
        return ("none — a card with a PIN and no owner, past its first set-up: an owner comes only by a reset by its "
                "PIN and a new set-up")
    return "none — open to the first phone that sets it up"


def cmd_pubkey(args) -> int:
    card = connect(args)
    pk = card.get_pubkey()
    print(_hex(pk))
    if args.verbose:
        print(f"x-only: {_hex(bip340.x_only(pk))}", file=sys.stderr)
    return 0


def cmd_balance(args) -> int:
    print(connect(args).get_balance())
    return 0


def cmd_slots(args) -> int:
    card = connect(args)
    status = card.get_slot_status()
    print(f"{len(status)} slots ({card.get_proof_count()} non-empty)")
    for i, s in enumerate(status):
        if s != 0x00 or args.all:
            print(f"  [{i:3}] {STATUS_NAMES.get(s, f'unknown({s})')}")
    return 0


def cmd_proof(args) -> int:
    p = connect(args).get_proof(args.slot)
    print(f"slot      : {p['slot']}")
    print(f"status    : {p['status']}")
    print(f"keyset_id : {p['keyset_id']}")
    print(f"amount    : {p['amount']}")
    print(f"nonce     : {_hex(p['nonce'])}")
    print(f"C         : {_hex(p['c'])}")
    print(f"date      : {p.get('date', 0) or 'none'}")
    return 0


def cmd_auth(args) -> int:
    """AUTH: the card proves it holds its key, over 16 random bytes of ours; the BIP-340 signature is checked here."""
    card = connect(args)
    reader = secrets.token_bytes(AUTH_NONCE_LEN)
    card_nonce, sig = card.auth(reader)
    pk = card.get_pubkey()
    ok = check_signature(pk, auth_message(reader, card_nonce, pk), sig)
    print(f"card key  : {_hex(pk)}")
    print(f"signature : {_hex(sig)}")
    print(f"BIP-340   : {'VALID ✅' if ok else 'INVALID ❌'}")
    return 0 if ok else 1


def parse_keyset_id(value: str, what: str = "--keyset", versions: tuple = (0x00, 0x01)) -> bytes:
    """
    A NUT-02 keyset id is 16 hex characters, which is 8 bytes raw.

    Earlier versions accepted an 8-character value and ASCII-encoded it. That
    silently stored half an id — the resulting proof matches no keyset at the
    mint and the funds are stranded on the card. Reject it loudly instead.

    The truncation message only fires for a value that is plausibly half an id,
    i.e. actually hex. Anything else falls through to parse_hex's "not valid
    hex" error rather than sending the operator hunting for a truncation that
    never happened.

    `what` names the thing the operator has to go and fix. The same id arrives
    from two places — the `--keyset` flag and a card file's `keysetId` field —
    and pointing at a CLI flag that the failing command does not even have
    sends them looking in the wrong file.
    """
    v = value.strip().lower()
    if len(v) == 8 and all(c in "0123456789abcdef" for c in v):
        raise SystemExit(
            f"{what} {value!r} is 8 hex chars, but a NUT-02 keyset id is 16 "
            f"(e.g. 0059534ce0bfa19a). Eight characters is half an id; a proof "
            f"loaded with it cannot be spent. Pass the full id."
        )
    raw = parse_hex(v, 8, what.lstrip("-"))
    # NUT-02 ids begin with a version byte: 00, or 01, whose 33-byte id the card
    # keeps by its first 8 bytes (the 2.x load path). The 0.x card file path
    # (`versions=(0,)`) takes v0 alone: the 0.x client runs the same check
    # (`requireKeysetV0`), so an id this tool accepts and writes but the other
    # half refuses is a proof that dies at the boundary — after the slot is spent.
    if raw[0] not in versions:
        if versions == (0x00,):
            raise SystemExit(
                f"{what} {value!r} must be a NUT-02 v0 keyset id (00 version byte), "
                f"got 0x{raw[0]:02x}"
            )
        raise SystemExit(
            f"{what} {value!r} must be a NUT-02 keyset id of version 00 or 01, "
            f"got 0x{raw[0]:02x}"
        )
    return raw



def cmd_load(args) -> int:
    # Parse every argument before touching the reader. VERIFY_PIN decrements the
    # card's retry counter, so running it ahead of validation means a typo'd
    # --keyset costs a PIN attempt on a command that could never have succeeded.
    # Pure argument validation must never require a card tap.
    keyset = parse_keyset_id(args.keyset)
    validate_slot_amount(args.amount)
    nonce = parse_hex(args.nonce, 32, "nonce") if args.nonce else secrets.token_bytes(32)
    if args.c:
        # An explicit --c is claimed to be a real mint signature, so it gets the
        # same check the file path (`_slot_from_json`) runs: a C that is not a
        # compressed on-curve point is an unspendable proof, and LOAD_PROOF has
        # no undo.
        c = parse_hex(args.c, 33, "C")
        if c[0] not in (0x02, 0x03):
            raise SystemExit(
                f"--c must be a compressed secp256k1 point (02/03 prefix), "
                f"got 0x{c[0]:02x}"
            )
        if bip340.lift_x(int.from_bytes(c[1:], "big")) is None:
            raise SystemExit(f"--c is not on the secp256k1 curve: {_hex(c)}")
    else:
        # A placeholder for storage tests: a point of the curve (the card checks C), made from the nonce. No mint
        # signed it, so it can never be redeemed.
        c = placeholder_c(nonce)
    if not 0 <= args.date < 2 ** 32:
        raise SystemExit(f"--date must fit four bytes, got {args.date}")
    owner = owner_key(args) if args.owner else None
    card = connect(args)
    if owner is not None and not args.pin and card.at_least(3, 0):
        raise SystemExit("the owner's grant opens no load on this card: a load wants the PIN given in this tap (--pin)")
    if args.pin:
        card.verify_pin(args.pin.encode())
    if owner is not None:
        # the owner's grant (ALLOW_LOAD): on a card of 2.2 or earlier it opens a load with no PIN; on 3.0 it opens
        # none, and the PIN given above opens it
        card.allow_load(owner)
    try:
        slot = card.load_proof(keyset, args.amount, nonce, c, args.date, date_keys=args.date_keys)
    except CardError as exc:
        if exc.sw == 0x6A86 and not args.date_keys:
            raise SystemExit(
                "error: LOAD_PROOF answered 6A86, and nothing was written. A 3.0 card loads a piece only on the "
                "loader's word that it was minted locked to the card's key for its date, P + t*G (group-keys, or c "
                "from card-secret), never to the card's main key P. Pass --date-keys only when that is so: ecash "
                "locked to P alone can never be spent by the card.")
        raise
    print(f"loaded into slot {slot}")
    if not args.nonce:
        print(f"nonce  : {_hex(nonce)}")
    if not args.c:
        print(f"C      : {_hex(c)}  (placeholder: a point of the curve that no mint signed; it cannot be redeemed)")
    return 0


# ── card file (interchange with cashu-client) ─────────────────────────────────
#
# The mint protocol lives in TypeScript (cashucard/client) and this driver
# is Python, so proofs cross the boundary as a file. The schema is defined once,
# in cashu-client's `src/cardFile.ts`; this is the other half of it.
#
# The field names are the card's own vocabulary — `nonce`, not `secret`, and a
# 16-hex-char `keysetId`. A file that says `secret` was written against a wrong
# model: a NUT-10 P2PK secret is ~150 bytes of JSON and cannot live in a slot.
#
# The schema is published in spec/CARD-FILE.md and test_card_file.py asserts
# this parser against it, the same way test_spec_consistency.py asserts the APDU
# encodings against spec/APDU.md.

CARD_FILE_VERSION = 1

# The published field lists, mirroring cashu-client's SLOT_FIELDS / FILE_FIELDS.
# Kept as the exact names in spec/CARD-FILE.md's tables — test_card_file.py
# parses the document and asserts these against it, so a rename fails in CI.
SLOT_FIELDS = ("keysetId", "amount", "nonce", "C", "spent")
FILE_FIELDS = ("version", "mint", "unit", "cardPubkey", "slots", "note")


def _reject_unknown_fields(raw: dict, known, where: str) -> None:
    """
    Refuse a field this version does not know about.

    The format's whole claim is that a field which drifts fails at the boundary.
    Silently ignoring an unrecognised key is that drift: a future writer adds
    one, forgets to bump `version`, and this side discards it without a word —
    the failure then surfaces at the mint, or as money that quietly went
    nowhere. `version` exists precisely so an additive change announces itself.

    Strict on both sides on purpose: cashu-client's `rejectUnknownFields` does
    exactly this, and a format whose two halves disagree about forward
    compatibility is not one format.
    """
    extra = [k for k in raw if k not in known]
    if extra:
        raise SystemExit(
            f"{where}unknown field(s): {', '.join(sorted(extra))} — bump the "
            f"card file version rather than adding fields silently"
        )


def _slot_from_json(entry, index: int) -> dict:
    """Validate one slot from a card file. Mirrors parseCardSlot in cashu-client."""
    where = f"slot {index}: "
    if not isinstance(entry, dict):
        raise SystemExit(f"{where}expected an object, got {type(entry).__name__}")

    # A file that spells this `secret` was written against the wrong mental
    # model. Say so, rather than reporting it as an unknown field.
    if "nonce" not in entry and "secret" in entry:
        raise SystemExit(
            f'{where}has "secret" but no "nonce" — the card stores the 32-byte '
            f"P2PK nonce, not the secret string (~150 bytes of JSON). See NUT-CCP."
        )
    _reject_unknown_fields(entry, SLOT_FIELDS, where)

    amount = validate_slot_amount(entry.get("amount"), where)

    keyset = entry.get("keysetId")
    if not isinstance(keyset, str):
        raise SystemExit(f"{where}keysetId must be a hex string")
    c_hex = entry.get("C")
    if not isinstance(c_hex, str):
        raise SystemExit(f"{where}C must be a hex string")
    nonce_hex = entry.get("nonce")
    if not isinstance(nonce_hex, str):
        raise SystemExit(f"{where}nonce must be a hex string")

    # Required, never defaulted. A file that omits it is not a file of unspent
    # proofs, it is a file whose state is unknown — and guessing "unspent"
    # resurrects settled money as spendable balance. See spec/CARD-FILE.md.
    spent = entry.get("spent")
    if not isinstance(spent, bool):
        raise SystemExit(
            f"{where}spent must be a boolean — without it there is no way to "
            f"tell an unspent proof from one the card already burned, and "
            f"loading the file back would resurrect the spent ones. "
            f"Got {spent!r}."
        )

    try:
        keyset_id = parse_keyset_id(keyset, what="keysetId", versions=(0x00,))
        nonce = parse_hex(nonce_hex, 32, f"{where}nonce")
        c = parse_hex(c_hex, 33, f"{where}C")
    except SystemExit as exc:
        raise SystemExit(f"{where}{exc}" if not str(exc).startswith(where) else str(exc))

    # Same guard cardPubkey gets. A C that is not a compressed point is an
    # unspendable proof, which is the whole reason this validator exists.
    if c[0] not in (0x02, 0x03):
        raise SystemExit(
            f"{where}C must be a compressed secp256k1 point (02/03 prefix), "
            f"got 0x{c[0]:02x}"
        )
    # The prefix alone accepts ~half of all random x values. cashu-client's
    # parseCardFile checks curve membership too, so without this the two halves
    # disagree about one file — and load-file would burn a slot on money nothing
    # can ever spend. lift_x returns None for off-curve x and for x >= p.
    if bip340.lift_x(int.from_bytes(c[1:], "big")) is None:
        raise SystemExit(f"{where}C is not on the secp256k1 curve: {_hex(c)}")

    return {
        "keyset": keyset_id,
        "amount": amount,
        "nonce": nonce,
        "c": c,
        "spent": spent,
    }


def validate_card_doc(doc) -> dict:
    """
    Validate an already-decoded card file document.

    Split out of `read_card_file` so the *writer* can run it too: `cardctl dump`
    used to emit whatever it was handed — `dump --mint ""` exited 0, printed
    "wrote 2 slot(s)", and produced a file this same module refuses. The only
    off-card record of a card's proofs is not a thing to discover is unloadable
    later, possibly after the card has been re-provisioned. cashu-client's
    `serializeCardFile` round-trips through `parseCardFile` for the same reason.
    """
    if not isinstance(doc, dict):
        raise SystemExit("card file must be a JSON object")
    version = doc.get("version")
    # JSON has one number type: JSON.parse turns `1.0` into the number 1, so
    # cashu-client's `!== 1` accepts those bytes and refusing them here would
    # be the two halves disagreeing about one file — the same drift, in the
    # other direction. Integral floats collapse to their integer value; a
    # non-integral version (1.5) stays refused, on both sides.
    if isinstance(version, float) and version.is_integer():
        version = int(version)
    # The bool guard matters: True == 1 in Python, so `!= CARD_FILE_VERSION`
    # alone accepts `"version": true` — a file TypeScript's `!== 1` refuses.
    # Two halves disagreeing about one file is the drift this format exists to
    # prevent. Same trap validate_slot_amount already guards.
    if not isinstance(version, int) or isinstance(version, bool) \
            or version != CARD_FILE_VERSION:
        raise SystemExit(
            f"unsupported card file version {version!r}, "
            f"expected {CARD_FILE_VERSION}"
        )
    _reject_unknown_fields(doc, FILE_FIELDS, "card file: ")
    for field in ("mint", "unit"):
        if not isinstance(doc.get(field), str) or not doc[field]:
            raise SystemExit(f"card file {field} must be a non-empty string")
    pub = doc.get("cardPubkey")
    if not isinstance(pub, str):
        raise SystemExit("card file cardPubkey must be a hex string")
    card_pubkey = parse_hex(pub, 33, "cardPubkey")
    if card_pubkey[0] not in (0x02, 0x03):
        raise SystemExit(
            f"card file cardPubkey must be a compressed secp256k1 point "
            f"(02/03 prefix), got 0x{card_pubkey[0]:02x}"
        )
    if bip340.lift_x(int.from_bytes(card_pubkey[1:], "big")) is None:
        raise SystemExit(
            f"card file cardPubkey is not on the secp256k1 curve: {_hex(card_pubkey)}"
        )
    slots = doc.get("slots")
    if not isinstance(slots, list):
        raise SystemExit("card file slots must be an array")
    parsed_slots = [_slot_from_json(e, i) for i, e in enumerate(slots)]

    # A nonce identifies one proof, and C is the mint's signature over one
    # proof. A file carrying either twice — a hand-merge of two dumps, a
    # corrupted file — would make cmd_load_file write the first and report the
    # second as "already loaded, skipping" (nonce) or burn a slot on a proof
    # the mint rejects as already spent (C): the operator is told a proof is
    # safely on the card that was never written, or loses the slot outright.
    # cashu-client's parseCardFile refuses both kinds in the same pass
    # (seenNonce and seenC); refusing only one here would let the two halves
    # disagree about one file — the drift this format exists to prevent.
    seen = {}
    seen_c = {}
    for i, slot in enumerate(parsed_slots):
        nonce = slot["nonce"]
        if nonce in seen:
            raise SystemExit(
                f"slot {i}: duplicate nonce {_hex(nonce)} (also in slot "
                f"{seen[nonce]}) — a nonce identifies one proof; this file "
                f"claims two"
            )
        seen[nonce] = i
        c = slot["c"]
        if c in seen_c:
            raise SystemExit(
                f"slot {i}: duplicate C {_hex(c)} (also in slot {seen_c[c]}) "
                f"— C is the mint's signature over one proof; a repeat is "
                f"never a coincidence"
            )
        seen_c[c] = i

    return {
        "mint": doc["mint"],
        "unit": doc["unit"],
        "card_pubkey": card_pubkey,
        "slots": parsed_slots,
    }


def read_card_file(path: str) -> dict:
    """Parse and validate a card file. Refuses anything malformed."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        raise SystemExit(f"no such card file: {path}")
    except OSError as exc:
        # A directory, a permission problem, or any other unreadable path gets
        # the same clean exit a missing file does — not a raw traceback.
        raise SystemExit(f"cannot read card file {path}: {exc}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} is not valid JSON: {exc}")

    return validate_card_doc(doc)


def _nonces_on_card(card) -> dict:
    """
    {nonce: (slot index, status byte)} for every occupied slot.

    This is what makes `load-file` re-runnable. LOAD_PROOF commits one proof at
    a time with no transaction around the file, so any mid-file failure leaves
    part of it on the card; without this, the obvious recovery — run it again —
    writes the already-loaded proofs a second time into fresh slots, inflating
    the on-card balance with duplicates the mint rejects on redemption.

    The status byte comes back with the index because "already there" and
    "already burned" are different answers. A file slot marked unspent whose
    nonce the card has already spent used to be reported as "already loaded,
    skipping" — which reads as "your proof is safely on the card" when the truth
    is the opposite, and the money is gone.
    """
    found = {}
    for index, status in enumerate(card.get_slot_status()):
        if status == 0x00:
            continue
        found.setdefault(card.get_proof(index)["nonce"], (index, status))
    return found


def cmd_load_file(args) -> int:
    """Load every proof in a card file, in order."""
    doc = read_card_file(args.path)

    card = connect(args)
    on_card = card.get_pubkey()
    if on_card != doc["card_pubkey"]:
        # Proofs are P2PK-locked to one card. Loading them onto a different card
        # writes money nothing can ever spend. Checked before the PIN and before
        # any write: there is nothing to undo yet.
        raise SystemExit(
            f"card file is for {_hex(doc['card_pubkey'])}\n"
            f"but this card is  {_hex(on_card)}\n"
            "These proofs are locked to a different card and could never be spent."
        )
    if args.pin:
        card.verify_pin(args.pin.encode())

    # A spent proof has already been burned by the card. LOAD_PROOF has no spent
    # bit, so writing one back returns it as unspent — balance the holder cannot
    # actually move. Dump keeps them because they are still owed at the mint;
    # load must not put them back on a card.
    settled = [s for s in doc["slots"] if s["spent"]]
    loadable = [s for s in doc["slots"] if not s["spent"]]

    # Pre-flight. Everything checkable before the first write happens before the
    # first write, because after it there is no rollback.
    already = _nonces_on_card(card)
    pending = [s for s in loadable if s["nonce"] not in already]
    empty = card.get_info()["empty"]
    if len(pending) > empty:
        raise SystemExit(
            f"card file needs {len(pending)} free slot(s) but this card has "
            f"{empty}. Nothing was written. Free space with `cardctl clear-spent` "
            f"or split the file across cards."
        )

    total = 0
    loaded = 0
    burned = 0
    for slot in doc["slots"]:
        if slot["spent"]:
            continue
        if slot["nonce"] in already:
            index, status = already[slot["nonce"]]
            if status == 0x02:
                # The file says unspent, the card says burned. Reporting this as
                # "already loaded" tells the operator their money is safely on
                # the card when it is already gone — and the summary counts
                # would fold it in with the genuinely-present proofs.
                burned += 1
                print(f"slot {index}: already SPENT on this card, skipping "
                      f"({slot['amount']} {doc['unit']} — the file is stale)")
            else:
                print(f"slot {index}: already loaded, skipping")
            continue
        index = card.load_proof(slot["keyset"], slot["amount"], slot["nonce"], slot["c"])
        already[slot["nonce"]] = (index, 0x01)
        loaded += 1
        total += slot["amount"]
        print(f"slot {index}: {slot['amount']} {doc['unit']}")

    skipped = len(loadable) - loaded - burned
    print(f"loaded {loaded} proof(s), {total} {doc['unit']} total"
          + (f"; {skipped} already on the card" if skipped else "")
          + (f"; {burned} already SPENT on the card" if burned else "")
          + (f"; {len(settled)} spent slot(s) not loaded" if settled else ""))
    return 0


def cmd_dump(args) -> int:
    """
    Write every non-empty slot to a card file for the mint side to redeem,
    except a spent slot whose data fails the slot checks (most likely
    half-cleared by an interrupted CLEAR_SPENT).
    """
    card = connect(args)
    pubkey = card.get_pubkey()
    statuses = card.get_slot_status()

    slots = []
    half_cleared = []
    for index, status in enumerate(statuses):
        if status == 0x00:
            continue
        if status not in (0x01, 0x02):
            # A status byte this tool does not recognise — a newer applet
            # revision, or a corrupted read. Folding it through the spent check
            # below would write it into the file as `spent: false`: unknown
            # state recorded as spendable money, resurrected by the next
            # load-file. Unknown state is refused, never guessed at — the same
            # rule the reader applies to an unknown version. Checked before
            # --unspent-only so the flag cannot silently drop it either.
            raise SystemExit(
                f"slot {index}: unknown status byte 0x{status:02x} — this tool "
                f"knows unspent (0x01) and spent (0x02), and the v1 card file "
                f"cannot represent anything else. Nothing was written. Read "
                f"the slot out with `cardctl proof {index}`."
            )
        if args.unspent_only and status != 0x01:
            continue
        p = card.get_proof(index)
        entry = {
            "keysetId": p["keyset_id"],
            "amount": p["amount"],
            "nonce": _hex(p["nonce"]),
            "C": _hex(p["c"]),
            # The bit that says whether this money still moves. Dropping it
            # keeps the proof and loses the state needed to act on it: the mint
            # side gets N indistinguishable proofs, and a reload resurrects the
            # spent ones as spendable. See spec/CARD-FILE.md.
            "spent": p["status"] == "spent",
        }
        if entry["spent"]:
            # CLEAR_SPENT zeroes a spent slot's data before it marks the slot
            # empty (D14), and the fill is not atomic, so a card pulled
            # mid-CLEAR_SPENT leaves the slot spent with any part of its data
            # zeroed. GET_PROOF still returns it, but its bytes are no longer a
            # proof (spec/APDU.md, CLEAR_SPENT): an amount of 0, or a C that is
            # no longer a point, would make the round-trip check below refuse
            # the whole card over a slot the operator was already clearing.
            # Skip it and say so. A spent slot that fails for another reason (a
            # placeholder C from `load` without --c, a denomination an older
            # cardctl allowed) cannot be redeemed either, so skipping it loses
            # nothing. The slot checks catch a zeroed amount and a C that is
            # no longer a point. A tear that zeroed only keyset or nonce bytes,
            # or part of C whose x still lands on the curve, passes them, and
            # dump writes that slot as spent. Spent slots only: an unspent slot
            # that fails is money, and still refuses the dump.
            try:
                _slot_from_json(entry, index)
            except SystemExit as exc:
                reason = str(exc)
                if reason.startswith(f"slot {index}: "):
                    reason = reason[len(f"slot {index}: "):]
                half_cleared.append(index)
                # CLEAR_SPENT frees every spent slot on the card, so the advice
                # waits for the rest of them to settle: a spent slot is owed
                # until the mint has seen its proof.
                print(
                    f"slot {index}: skipped: spent, and its data is not a proof "
                    f"({reason}); most likely half-cleared by an interrupted "
                    f"CLEAR_SPENT; run clear-spent to free it once every other "
                    f"spent slot in this dump has settled at the mint. "
                    f"`cardctl proof {index}` prints what is left of it.",
                    file=sys.stderr,
                )
                continue
        slots.append(entry)

    note = f"dumped by cardctl from {len(slots)} slot(s)"
    if half_cleared:
        note += (
            f"; skipped spent slot(s) {', '.join(str(i) for i in half_cleared)}, "
            f"whose data is not a proof (most likely half-cleared by an "
            f"interrupted CLEAR_SPENT)"
        )
    doc = {
        "version": CARD_FILE_VERSION,
        "mint": args.mint,
        "unit": args.unit,
        "cardPubkey": _hex(pubkey),
        "slots": slots,
        "note": note,
    }

    # Never emit a document this module would refuse to read back. `dump --mint
    # ""` used to exit 0 and report success while producing an unloadable file —
    # and this file is the card's only off-card record, so the operator finds out
    # long after the card has moved on. The same round-trip cashu-client's
    # `serializeCardFile` does through `parseCardFile`.
    try:
        validate_card_doc(doc)
    except SystemExit as exc:
        # The failure can come from the arguments (fixable: pass a real --mint)
        # or from the card itself, if it was provisioned by an older cardctl that
        # allowed a denomination v1 cannot carry. Say which, and point at the
        # command that still gets the bytes out slot by slot.
        raise SystemExit(
            f"refusing to write a card file this tool could not read back: {exc}\n"
            f"Nothing was written. If the card holds a proof the v1 format "
            f"cannot represent, read it out with `cardctl proof <slot>`."
        )

    text = json.dumps(doc, indent=2)
    if args.out:
        # A card file is a bearer-money artifact and the only off-card record of
        # these proofs. Shell clobber semantics are the wrong default: dumping a
        # second card over card1.json would destroy the first card's only backup.
        if os.path.exists(args.out) and not args.force:
            raise SystemExit(
                f"{args.out} already exists; pass --force to overwrite. "
                f"(It may be the only copy of another card's proofs.)"
            )
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"wrote {len(slots)} slot(s) to {args.out}")
    else:
        print(text)
    return 0


def cmd_clear_spent(args) -> int:
    card = connect(args)
    if args.pin:
        card.verify_pin(args.pin.encode())
    print(f"freed {card.clear_spent()} slot(s)")
    return 0


def cmd_verify_pin(args) -> int:
    connect(args).verify_pin(args.pin.encode())
    print("PIN verified")
    return 0


def cmd_set_pin(args) -> int:
    pin = args.pin.encode()
    check_pin(pin)
    card = connect(args)
    if args.owner:
        if card.at_least(3, 0):
            raise SystemExit("a 3.0 card with an owner refuses SET_PIN (6A91): its PIN is changed by change-pin, "
                             "with the owner's proof")
        # ADD PIN, on a card of 2.2 or earlier: a card with an owner and no PIN takes one under the owner's grant
        card.allow_load(owner_key(args))
    elif card.at_least(3, 0) and card.get_info()["pin_state"] == "none":
        # D196: this SET_PIN would begin the card's first set-up, and the next selection would end it with no record
        # and no owner, which nothing but a reset by the PIN can then change
        raise SystemExit("a 3.0 card with no PIN is set up in one selection: run setup (PIN, record, owner and "
                         "limits); set-pin alone would leave a card with a PIN, no record and no owner")
    card.set_pin(pin)
    print("PIN set")
    return 0


def cmd_change_pin(args) -> int:
    """CHANGE_PIN, 2.0: the owner's proof and the new PIN. No old PIN; it unblocks a blocked card."""
    new = args.new.encode()
    check_pin(new)
    owner = owner_key(args)
    connect(args).change_pin(owner, new)
    print("PIN changed (the tries are full, and a blocked card is unblocked)")
    return 0


def cmd_set_owner(args) -> int:
    """
    SET_OWNER with the anchor header (D20); with --old-owner-key on a card that has an owner (a hand-over). The new
    owner's key is --owner-key, or cardctl's TEST key under --test-owner-key alone (`_holder_owner_key`).
    """
    anchor = parse_header(args.anchor, "--anchor") if args.anchor else None
    owner = _holder_owner_key(args, args.command)
    seed = _owner_seed(args)
    old = None
    if args.old_owner_key:
        old = int.from_bytes(parse_hex(args.old_owner_key, 32, "--old-owner-key"), "big")
    card = connect(args)
    if args.pin:
        # a claim (a card with no owner) wants the PIN given in this tap; the card holds for it (6A98, keep holding)
        card.verify_pin(args.pin.encode())
    # s from the card's own key, read in this tap (D202): never from a key handed over
    s = owner_s(seed, card.get_pubkey()) if seed is not None else None
    card.set_owner(p256.public_key(owner), anchor, old, s)
    checked = ""
    if s is not None:
        # the owner's c read back before anything is said of it: the claim's PIN is given in this tap; a hand-over's new
        # owner gives its grant
        if old is not None:
            card.allow_load(owner)
        checked = _owner_c_line(owner_c_count_on_card(card, s))
    print("owner set" + (f"; the clock is anchored at {card.get_info()['now']}" if anchor else
                         " (no anchor: the card's clock is as it was; pass --anchor with the tip header)") + checked)
    if old is not None and card.at_least(3, 0):
        # a hand-over (D197): the PIN the last owner knows opens nothing, and the refund key went with it
        print("handed over. Until the new owner's change-pin (python3 cardctl.py change-pin NEW --owner-key <the new "
              "owner key>), verify-pin answers 6982; until its set-card (python3 cardctl.py set-card --mint <the mint> "
              "--refund <its refund key> --owner-key <the new owner key>), a dated load answers 6A8E. Undated pieces "
              "load once the new PIN is set.")
    return 0


def cmd_set_card(args) -> int:
    refund = check_refund_key(parse_hex(args.refund, 33, "--refund")) if args.refund else bytes(33)
    check_mint(args.mint, factory=True)
    design = check_design(args.design) if args.design else None
    card = connect(args)
    info = card.get_info()
    record = card.get_card()
    # the unit given, or the one the record has: a record sent with another unit turns the card's numbers (SET_CARD)
    unit = UNITS[args.unit] if args.unit else record["unit"]
    # the design given, or the one the record has: SET_CARD zeroes a design the record it is sent does not carry
    if design is None:
        design = _design_kept(record)
    if args.pin:
        card.verify_pin(args.pin.encode())
    card.set_card(args.mint, refund, unit=unit, owner=owner_key(args) if info["has_owner"] else None, design=design)
    print("record set" + (f", design {design.decode()}" if design else ""))
    return 0


def check_design(value: str) -> bytes:
    """A card's design code as the record carries it: three capital letters or digits (FX1)."""
    design = value.encode("ascii", "replace")
    if len(design) != 3 or not all(chr(ch).isdigit() or "A" <= chr(ch) <= "Z" for ch in design):
        raise SystemExit(f"--design is three capital letters or digits (FX1), got {value!r}. Nothing was sent to the card.")
    return design


def _holder_owner_key(args, what: str) -> int:
    """
    The key a card is set up, claimed or handed over to (setup, set-owner, set-owner-url): --owner-key, the holder's;
    cardctl's TEST key only under --test-owner-key, which says so. No key, the word `test` and the TEST key's value
    are refused before anything is sent.
    """
    if getattr(args, "test_owner_key", False):
        print(f"note: {what} gives the card to cardctl's TEST owner key, as --test-owner-key asks, for a bench card "
              "only: anyone with this repository can change its PIN and spend what it holds", file=sys.stderr)
        return p256.TEST_OWNER_PRIVATE
    value = getattr(args, "owner_key", None)
    if not value or value == "test":
        raise SystemExit(f"{what} wants --owner-key HEX, the holder's own P-256 private key (32 bytes). A bench card "
                         "may be given cardctl's TEST key instead with --test-owner-key: anyone with this repository "
                         "holds that key, and can change the card's PIN and spend it. Nothing was sent to the card.")
    d = owner_key(args)
    if d == p256.TEST_OWNER_PRIVATE:
        raise SystemExit("--owner-key is cardctl's TEST key, which anyone with this repository holds: pass "
                         f"--test-owner-key to give a bench card to it, or the holder's own key. Nothing was sent.")
    return d


def _design_kept(record: dict) -> bytes:
    """A factory record's design, to carry into the holder's record: three capital letters or digits, else none."""
    design = bytes(record.get("design") or b"")
    if len(design) == 3 and any(design) and all(chr(ch).isdigit() or "A" <= chr(ch) <= "Z" for ch in design):
        return design
    return b""


def cmd_setup(args) -> int:
    """
    A card's first set-up in one selection (3.0, D196: the first set-up is the selection of the card's first SET_PIN,
    and every SELECT ends it, so separate commands cannot make it): SET_PIN, VERIFY_PIN, SET_CARD, the owner claimed
    (SET_OWNER, held for, with the anchor), then, with --day, the owner's limits. The anchor is required (D204): on a
    3.0 card the claim's anchor, the first set-up's of an empty card, is its clock even where the clock was later, and
    its hardest where it is harder. Everything that can be checked here is checked before the card is written to: the
    PIN, the owner key, the mint, the refund key, the anchor's work (its own, the floor, and a quarter of the hardest
    header the card has taken; on a card older than 3.0 the clock too) and the limits. A card that is not fresh
    from its install or a reset (a factory record allowed) is refused before anything is written. A failure after
    SET_PIN says what the card now holds and the way back.
    """
    pin = args.pin.encode()
    check_pin(pin)
    owner = _holder_owner_key(args, "setup")
    check_mint(args.mint)
    given_design = check_design(args.design) if args.design else None
    refund = check_refund_key(parse_hex(args.refund, 33, "--refund")) if args.refund else bytes(33)
    unit = UNITS[args.unit]
    seed = _owner_seed(args)
    if not args.anchor:
        # D204: every set-up gives the card the tip, whose claim's anchor is its clock and hardest before it holds anything
        raise SystemExit("setup wants --anchor <the tip header, 80 bytes hex> (python3 cardctl.py tip prints one): a "
                         "card set up without the tip keeps whatever clock and hardest a stranger's header gave it, "
                         "and one far header can then hold its day's limit for good. Nothing was sent to the card.")
    anchor = parse_header(args.anchor, "--anchor")
    problem = header_work_problem(anchor)
    if problem:
        raise SystemExit(f"--anchor: {problem}. Nothing was sent to the card.")
    value = None
    if args.day is not None:
        value = limit_value(args.day, args.payment, args.allowance, args.budget, args.rate, args.no_pin_window)
    card = connect(args)
    info = card.get_info()
    record = card.get_card()
    factory = info["record_set"] and record["mint"] == FACTORY_MINT
    if info["pin_state"] != "none" or info["has_owner"] or (info["record_set"] and not factory):
        raise SystemExit("setup is for a card fresh from its install or a reset (no PIN, no owner, and no record but "
                         f"a factory one); this one has PIN {info['pin_state']}, record "
                         f"{'none' if not info['record_set'] else record['mint']!r}, owner {info['has_owner']}")
    # a 3.0 card takes the claim's anchor even where it is older than its clock (D204); an older card moves it only forward
    problem = header_work_problem(anchor, record["hardest_bits"]) or (
        None if card.at_least(3, 0) else clock_ahead_problem(info["now"], anchor))
    if problem:
        raise SystemExit(f"--anchor: {problem}. Nothing was written to the card.")
    far = info["now"] > header_time(anchor) + CLOCK_AHEAD_MOST
    # the design given, or a factory record's
    design = given_design if given_design is not None else (_design_kept(record) if factory else b"")
    step = "SET_PIN"
    try:
        card.set_pin(pin)
        step = "VERIFY_PIN"
        card.verify_pin(pin)
        step = "SET_CARD"
        card.set_card(args.mint, refund, unit=unit, design=design)
        step = "SET_OWNER"
        s = owner_s(seed, card.get_pubkey()) if seed is not None else None
        card.set_owner(p256.public_key(owner), anchor, s=s)
        checked = ""
        if s is not None:
            step = "reading c back"
            checked = _owner_c_line(owner_c_count_on_card(card, s))
        if value is not None:
            step = "SET_LIMIT"
            card.set_limit(owner, args.day, args.payment, args.allowance, args.budget, args.rate, args.no_pin_window)
    except (Exception, SystemExit) as exc:  # noqa: BLE001 — every failure past SET_PIN is said with the way back
        raise SystemExit(_setup_stopped(card, step, exc, design))
    now = card.get_info()["now"]
    print("set up: PIN, record, owner" + (f", limits ({len(value)} bytes)" if value is not None else "")
          + f"; the clock is anchored at {now}"
          + (f" (it was at {info['now']}, set by a header far ahead: the claim's anchor brought it back)" if far else "")
          + checked)
    if now != header_time(anchor):
        print(f"warning: the card's clock is {now}, not the anchor's {header_time(anchor)}: this card did not take the "
              "claim's anchor as its clock. Load nothing onto it; reset it with the owner key and the tip as its "
              "anchor (python3 cardctl.py reset --owner-key <the owner key> --anchor <the tip header>)", file=sys.stderr)
    return 0


def _setup_stopped(card, step: str, exc: BaseException, design: bytes = b"") -> str:
    """What setup says when it stops at `step`: the card's state, read in the same selection where the card still
    answers, and the way on from it. A card older than 3.0 has no first set-up and no reset by the PIN: one with a PIN
    and no owner is claimed at any later tap (set-owner --pin)."""
    why = str(exc) or type(exc).__name__
    lines = [f"setup stopped at {step}: {why}"]
    # a reset clears the record, a factory record's design with it: the next setup is given it again
    again = f"setup again with --design {design.decode()}" if design else "setup again"
    if not card.at_least(3, 0):
        lines.append(f"This card answers version {_version_text(card.version)}: it has no reset by the PIN, and a card "
                     "with a PIN and no owner is claimed at any later tap.")
        claim = ("python3 cardctl.py set-owner --pin <the PIN> --owner-key <the owner key> --anchor <the tip header>, "
                 "then python3 cardctl.py set-limit --owner-key <the owner key> --day N ... for any limits")
        record = ("python3 cardctl.py set-card --mint <the mint> --pin <the PIN> (the record), then ")
        try:
            info = card.get_info()
        except (Exception, SystemExit) as gone:  # noqa: BLE001 — a card that left the field answers nothing
            lines.append(f"The card could not be read after it ({gone}). Put it back on the reader and read it: "
                         "python3 cardctl.py info. Then:")
            lines.append("  - owner yes: it is claimed; send any limits with python3 cardctl.py set-limit "
                         "--owner-key <the owner key> --day N ...")
            lines.append(f"  - a PIN and no owner: {record}{claim} (set-card only where the record is none)")
            lines.append("  - no PIN: nothing was kept; run setup again")
            return "\n".join(lines)
        lines.append(f"The card now: PIN {info['pin_state']}; record: {'set' if info['record_set'] else 'none'}; "
                     f"owner: {'yes' if info['has_owner'] else 'none'}.")
        if info["has_owner"]:
            lines.append("It is claimed: send any limits with python3 cardctl.py set-limit --owner-key <the owner key> "
                         "--day N ...")
        elif info["pin_state"] == "none":
            lines.append("Nothing was kept: run setup again once the cause is put right.")
        else:
            lines.append("Claim it: " + (record if not info["record_set"] else "") + claim + ".")
        return "\n".join(lines)
    if step == "SET_CARD" and isinstance(exc, CardError) and exc.sw == 0x6F00:
        lines.append("A 6F00 at the first SET_CARD is the chip's ECDH framing check failing "
                     "(docs/HARDWARE_DEPLOYMENT.md, ECDH framing probe): this chip cannot run the card.")
    try:
        info = card.get_info()
    except (Exception, SystemExit) as gone:  # noqa: BLE001 — a card that left the field answers nothing
        lines.append(f"The card could not be read after it ({gone}).")
        lines.append("Put it back on the reader and read it: python3 cardctl.py info. Then:")
        lines.append("  - owner yes: it is claimed, and set up; send any limits with python3 cardctl.py set-limit "
                     "--owner-key <the owner key> --day N ...")
        lines.append("  - a PIN and no owner: it holds nothing, and nothing more can be written to it until it is "
                     "reset by its PIN (about 45 seconds on the reader): python3 cardctl.py reset --pin <the PIN>, "
                     f"then run {again}")
        lines.append("  - no PIN: nothing was kept; run setup again")
        return "\n".join(lines)
    lines.append(f"The card now: PIN {info['pin_state']}; record: {'set' if info['record_set'] else 'none'}; "
                 f"owner: {'yes' if info['has_owner'] else 'none'}.")
    if info["has_owner"] and step == "reading c back":
        lines.append("It is claimed, but not with the owner's c: send it no limits and load nothing; reset it with the "
                     "owner key and set it up again (above).")
    elif info["has_owner"]:
        lines.append("It is claimed, and set up but for the limits: send them with python3 cardctl.py set-limit "
                     "--owner-key <the owner key> --day N ...")
    elif info["pin_state"] == "none":
        lines.append("Nothing was kept: run setup again once the cause is put right.")
    else:
        lines.append("A card with a PIN and no owner is past its first set-up once it leaves the reader: nothing more "
                     "can be written to it until it is reset. It holds nothing, so reset it by its PIN (about 45 "
                     f"seconds on the reader): python3 cardctl.py reset --pin <the PIN>, then run {again}.")
    return "\n".join(lines)


def cmd_reset(args) -> int:
    """
    RESET_CARD on a card with no owner (3.0, D196): the reset by the PIN. The PIN given, a held tap (GET_LOG held for),
    then RESET_CARD sixty times in a row, about 45 seconds on a chip, all in one selection. Only an empty card that is
    owed nothing: the card is then as from its install, with a new card key and a new c, for setup. With --owner-key, a
    card with an owner is reset by its owner's proof instead (the PIN too where the card is locked). With --anchor
    (D200), a block header that becomes the card's clock even where it is older: the way back from a clock moved far
    ahead; on an owned card it is under the owner's proof.
    """
    pin = args.pin.encode() if args.pin else None
    if pin is not None:
        check_pin(pin)
    anchor = parse_header(args.anchor, "--anchor") if args.anchor else None
    if anchor is not None:
        problem = header_work_problem(anchor)
        if problem:
            raise SystemExit(f"--anchor: {problem}. Nothing was sent to the card.")
    card = connect(args)
    _needs_23(card, "reset")
    info = card.get_info()
    if info["has_owner"]:
        if not args.owner_key:
            raise SystemExit("this card has an owner: it is reset by its owner's proof (--owner-key, and --pin where it "
                             "is locked; or the provisioner's reset, or ops local-reset), not by the PIN; nothing was sent")
        return _reset_by_owner(args, card, info, pin, anchor)
    if args.owner_key:
        raise SystemExit("this card has no owner: it is reset by its PIN (--pin), not by an owner's proof; nothing was sent")
    if pin is None:
        raise SystemExit("--pin: a card with no owner is reset by its PIN; nothing was sent")
    # a fresh card is reset only to bring a clock a far header set back to the anchor (D203): its PIN is set for it here
    fresh = info["pin_state"] == "none"
    if fresh and anchor is None:
        raise SystemExit("this card has no PIN: it is fresh already; run setup (a fresh card whose clock is far ahead "
                         "is reset with --anchor <the tip header>, the PIN given here set for the reset alone)")
    if info["unspent"] or info["change_owed"]:
        raise SystemExit(f"this card holds {info['unspent']} piece(s) or is owed change: a reset loses them. Spend "
                         "or move every piece and bring any change home first; nothing was sent")
    if anchor is not None:
        problem = header_work_problem(anchor, card.get_card()["hardest_bits"])
        if problem:
            raise SystemExit(f"--anchor: {problem}. Nothing was written to the card.")
    if not args.yes:
        print("RESET_CARD makes the card as new: no PIN, no record, a new card key. It holds nothing now.")
        if input("Type 'reset' to confirm: ").strip() != "reset":
            print("aborted")
            return 1
    if fresh:
        card.set_pin(pin)
    card.verify_pin(pin)
    card.hold_history()
    card.reset_by_pin(anchor)
    print("card reset: no PIN, no record, no owner, a new card key; set it up with setup"
          + (f"; the clock is at the anchor, {card.get_info()['now']}" if anchor else ""))
    return 0


def _reset_by_owner(args, card, info: dict, pin: Optional[bytes], anchor: Optional[bytes]) -> int:
    """The owner's reset (D200): its proof over the anchor, or over nothing. The empty card and the anchor's work are
    checked before anything is sent; a locked card wants the PIN given in this tap."""
    owner = owner_key(args)
    if info["unspent"] or info["change_owed"]:
        raise SystemExit(f"this card holds {info['unspent']} piece(s) or is owed change: a reset loses them. Spend "
                         "or move every piece and bring any change home first; nothing was sent")
    if info.get("locked") and pin is None:
        raise SystemExit("this card is locked: its owner's reset wants the PIN given in the same tap (--pin); nothing "
                         "was sent")
    if anchor is not None:
        problem = header_work_problem(anchor, card.get_card()["hardest_bits"])
        if problem:
            raise SystemExit(f"--anchor: {problem}. Nothing was written to the card.")
    if not args.yes:
        print("RESET_CARD makes the card as new: no PIN, no record, no owner, a new card key. It holds nothing now.")
        if input("Type 'reset' to confirm: ").strip() != "reset":
            print("aborted")
            return 1
    if pin is not None:
        card.verify_pin(pin)
    card.reset_by_owner(owner, anchor)
    print("card reset by its owner: no PIN, no record, no owner, a new card key; set it up with setup"
          + (f"; the clock is at the anchor, {card.get_info()['now']}" if anchor else ""))
    return 0


def cmd_set_limit(args) -> int:
    value = limit_value(args.day, args.payment, args.allowance, args.budget, args.rate, args.no_pin_window)  # checked before the reader
    owner = owner_key(args)
    card = connect(args)
    card.set_limit(owner, args.day, args.payment, args.allowance, args.budget, args.rate, args.no_pin_window)
    print(f"limits set ({len(value)} bytes)")
    return 0


def cmd_set_header(args) -> int:
    header = parse_header(args.header)
    print(f"clock: {connect(args).set_header(header)}")
    return 0


# ── the anchor tip feed (ENG-740) ─────────────────────────────────────────────
# GET /anchor/tip on the ops service returns {"header": "<160 hex>"}: the same
# 80-byte block header `set-owner --anchor` and `refresh --header` take. The
# route is public (a block header is public data) and the request carries no
# Authorization header — pinned on both sides (ops/test/sessions-clean.test.ts,
# test_tip.py). The fetcher is a module-level function so the tests can inject
# it and the no-network guarantee of this suite stays intact (test_tip.py).

DEFAULT_OPS_URL = "http://127.0.0.1:8821"


def fetch_tip(url: str) -> bytes:
    """GET {url}/anchor/tip and return the 80-byte header. Test-injectable.

    A 503 is the service's last-good answer, not a failure: its body carries
    the stale header (and the reason), which parse_header still validates.
    Only a connection error, a non-JSON body, or a header-less 503 stops the
    command.
    """
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url.rstrip("/") + "/anchor/tip")
    body = None
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The 503-with-last-good contract (ops/src/router.ts): the body names
        # the stale header. Other HTTP errors carry no usable header.
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 — a body we cannot read is no body
            body = None
        if exc.code != 503 or not isinstance(body, dict) or "header" not in body:
            raise SystemExit(f"the tip feed at {url} answered HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001 — surface the transport's words
        raise SystemExit(f"the tip feed at {url} did not answer: {exc}")
    header = body.get("header")
    if not isinstance(header, str):
        raise SystemExit(f"the tip feed at {url} named no header")
    return parse_header(header, "--anchor-url")


def cmd_tip(args) -> int:
    """Print the tip header's hex; validated to 80 bytes (parse_header)."""
    header = fetch_tip(args.url)
    print(header.hex())
    return 0


def cmd_set_owner_with_anchor_url(args) -> int:
    """set-owner, with the anchor fetched from the tip feed (sugar over --anchor)."""
    args.anchor = fetch_tip(args.url).hex()
    return cmd_set_owner(args)


def cmd_refresh(args) -> int:
    header = parse_header(args.header)
    if args.pin:
        # the holder's REFRESH on a card with no owner (P1 = 01): the PIN and a held tap stand for the owner's proof
        if args.back or args.owner_key:
            raise SystemExit("--pin is the holder's REFRESH of a card with no owner: it takes neither --owner-key nor "
                             "--back; nothing was sent")
        pin = args.pin.encode()
        check_pin(pin)
        card = connect(args)
        card.verify_pin(pin)
        card.hold_history()
        now = card.refresh_by_pin(header)
    else:
        owner = owner_key(args)
        card = connect(args)
        now = card.refresh(owner, header, back=args.back)
    if now == header_time(header):
        print(f"refreshed: the rollover budget is full; the clock is at the header, {now}")
        return 0
    # an older header the card did not take: 9000, and the clock as it was (D201)
    print(f"the rollover budget is full, but the clock did not move: it is at {now}, past the header's "
          f"{header_time(header)}.")
    if header_is_weak(header, card.get_card()["hardest_bits"]):
        print("This header is weak to the card: less than half the work of the hardest header it has taken (or, "
              "where it has taken none, less than twice the floor's), and no REFRESH brings the clock back to a weak "
              "header. Give it the network's tip.")
    elif args.pin:
        print("The holder's REFRESH brings back only a clock a weak header set. A card with no owner whose clock is "
              "not weak keeps it until it is empty and reset with the tip as its anchor: python3 cardctl.py reset "
              "--pin <the PIN> --anchor <the tip header>.")
    elif not args.back:
        print("An older header brings back only a weak clock; the owner's back form brings back any clock to a header "
              "that is not weak: python3 cardctl.py refresh --back --owner-key <the owner key> --header <the tip>.")
    else:
        print("The back form moves the clock only to a header that is not weak: give it the network's tip.")
    return 0


def cmd_lock(args) -> int:
    owner = owner_key(args)
    card = connect(args)
    if not args.yes:
        print("LOCK_CARD permanently and irreversibly disables all write operations.")
        if input("Type 'lock' to confirm: ").strip() != "lock":
            print("aborted")
            return 1
    if not args.pin:
        raise SystemExit("LOCK_CARD needs the PIN verified in this tap: pass --pin")
    card.verify_pin(args.pin.encode())
    card.lock_card(owner)
    print("card locked (irreversible)")
    return 0


def cmd_outbox(args) -> int:
    """GET_OUTBOX: the last payment's assisted-settlement packet, every field, both signatures checked here."""
    if args.file:
        with open(args.file, encoding="ascii") as f:
            packet = parse_hex(f.read().strip(), None, "packet")
        card_key = scope = None
    else:
        owner = owner_key(args) if args.owner else None
        card = connect(args)
        _holders_say(card, args, owner)
        packet, scope = card.get_outbox()
        # the packet names the card's key for the date 0, P + t*G, on 3.0 (GROUP_KEYS, under the PIN or the grant
        # given above); the card's main key P on 2.2
        card_key = card.group_keys(0)["key"] if card.at_least(3, 0) else card.get_pubkey()
    try:
        p = decode_outbox(packet)
    except (ValueError, UnicodeDecodeError) as exc:
        print(f"packet of {len(packet)} bytes: {exc}")
        print("INVALID")
        return 1
    print(f"packet       : {len(packet)} bytes")
    return 0 if print_outbox(p, card_key, scope) else 1


def _holders_say(card, args, owner: Optional[int]) -> None:
    """The PIN (--pin) and the owner's grant (`owner`, from --owner) for this tap, as GROUP_KEYS and the history want."""
    if args.pin:
        card.verify_pin(args.pin.encode())
    if owner is not None:
        card.allow_load(owner)


def cmd_group_keys(args) -> int:
    """GROUP_KEYS (3.0): the keys of one date's pieces, after the PIN or the owner's grant; checked against GET_PUBKEY."""
    if not 0 <= args.date < 2 ** 32:
        raise SystemExit(f"--date must fit four bytes, got {args.date}")
    if not args.pin and not args.owner:
        raise SystemExit("GROUP_KEYS wants the PIN given in this tap (--pin) or the owner's grant (--owner)")
    owner = owner_key(args) if args.owner else None  # checked before the reader
    card = connect(args)
    _holders_say(card, args, owner)
    keys = card.group_keys(args.date)
    t = int.from_bytes(keys["t"], "big")
    worked = point_compressed(bip340._point_add(point_from_bytes(card.get_pubkey(), "the card key"), scalar_mul(t)))
    print(f"date      : {args.date or '0 (undated)'}")
    print(f"t         : {_hex(keys['t'])}")
    print(f"P + t*G   : {_hex(keys['key'])}")
    print(f"R + u*G   : {_hex(keys['refund']) if any(keys['refund']) else 'none (no refund key, or the date 0)'}")
    if worked != keys["key"]:
        print(f"P + t*G is NOT the card key (GET_PUBKEY) plus t*G: {_hex(worked)}")
        return 1
    print("checked   : P + t*G is the card key (GET_PUBKEY) plus t*G")
    return 0


def _refund_private(args) -> Optional[int]:
    """The refund key's private key r, from --refund-key HEX or --refund-key-file PATH (hex), or None."""
    value = args.refund_key
    if args.refund_key_file:
        if value:
            raise SystemExit("give --refund-key or --refund-key-file, not both")
        with open(args.refund_key_file, encoding="ascii") as f:
            value = f.read().strip()
    if not value:
        return None
    r = int.from_bytes(parse_hex(value, 32, "the refund private key"), "big")
    if not 0 < r < bip340.N:
        raise SystemExit("the refund private key is not a secp256k1 private key (0 < r < n)")
    return r


def cmd_card_secret(args) -> int:
    """
    GET_CARD P1 = 3 (3.0): the card's secret c, sealed, opened here. On a card with a refund key the answer is sealed
    to the refund key and opened with its private key r (--refund-key or --refund-key-file); on a card with none it is
    sealed to the PIN key (GET_NONCE P1 = 1, checked by the card key's signature) under a one-time key this command
    makes. c is checked against GROUP_KEYS for the date 0 before anything is said of it, and printed only with --show.
    It never sends SET_PIN: a first set-up begun here would end with this command, leaving a card with a PIN and no
    owner. A card set up by `setup` is owned, and its owner's grant reads c at any tap.
    """
    r = _refund_private(args)
    seed = _owner_seed(args)
    if args.date is not None and (seed is None or r is None):
        raise SystemExit("--date checks the take-back key of a date from the c --owner-seed works out: it wants "
                         "--owner-seed and the refund key's private key")
    if args.owner_key:
        owner_key(args)  # a malformed key is refused before the reader
    card = connect(args)
    info = card.get_info()
    refund_key = card.get_card()["refund_key"]
    has_refund = any(refund_key)
    # everything that can be refused here is refused before a PIN try or a grant
    if has_refund:
        if r is None:
            raise SystemExit("this card has a refund key: c is sealed to it, and opened with its private key "
                             "(--refund-key HEX or --refund-key-file PATH)")
        if point_compressed(scalar_mul(r)) != bytes(refund_key):
            raise SystemExit("the refund private key given is not the private key of this card's refund key "
                             f"{_hex(refund_key)}")
    if info["has_owner"]:
        pass
    elif info["pin_state"] == "none":
        raise SystemExit("this card has no PIN and no owner: set it up first (setup, which claims an owner); its "
                         "owner's grant then reads c at any tap (card-secret --owner-key K)")
    elif not args.pin:
        raise SystemExit("on a card with no owner, c wants the PIN given in this tap (--pin)")
    elif not has_refund:
        raise SystemExit("on a card with no owner and no refund key, c was given only in the card's first set-up, to "
                         "the reader that set it up; cardctl cannot ask for it now. A card set up by setup has an "
                         "owner, whose grant reads c at any tap")
    if info["has_owner"]:
        card.allow_load(owner_key(args))
    else:
        card.verify_pin(args.pin.encode())
    card_key = card.get_pubkey()
    nonce, pin_key, sig = card.get_pin_key()
    if not pin_key_signed(card_key, pin_key, sig):
        raise SystemExit("GET_NONCE P1 = 1: the PIN key is not signed by the card key; nothing was asked for")
    if has_refund:
        c = open_card_secret(card.get_card_secret(None), nonce, r)
    else:
        e = secrets.randbelow(bip340.N - 1) + 1
        c = open_card_secret(card.get_card_secret(point_uncompressed(scalar_mul(e))), nonce, e, pin_key)
    keys = card.group_keys(0)
    if date_keys(c, card_key, refund_key, 0)["key"] != keys["key"]:
        raise SystemExit("c did not open to the card's keys (GROUP_KEYS for the date 0 answers other keys): not "
                         "shown, not kept")
    print("c         : opened, and checked: the card's key for the date 0 worked out from it is the one GROUP_KEYS "
          "answers")
    if seed is not None:
        # D202: the c a phone restored from the words works out, with no card: s from the seed and P, then n = 1, 2, ...
        n = owner_c_count(owner_s(seed, card_key), c)
        if n is None:
            raise SystemExit("c is not the owner's c of --owner-seed for this card: the card took another's, or drew its "
                             "own (a claim or hand-over with no c of the owner's)")
        print(f"owner's c : yes, worked out from --owner-seed alone: the {n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'} "
              "owner's c this card has taken")
        if args.date is not None:
            # the take-back key of a date's pieces, r + u, from the restored c: its public key is the card's R + u*G
            u = date_tweak(LABEL_REFUND_KEY, owner_c(owner_s(seed, card_key), n), args.date)
            mine = point_compressed(scalar_mul((r + u) % bip340.N))
            if mine != card.group_keys(args.date)["refund"]:
                raise SystemExit(f"the take-back key for {args.date} worked out from the restored c is not the card's "
                                 "refund key for that date")
            print(take_back_line(args.date, _hex(mine)))
    if args.show:
        print("warning: c ties every payment of this card to it; keep it with the refund key, as secret as the refund "
              "key's private key", file=sys.stderr)
        print(f"c         : {_hex(c)}")
    else:
        print("            (--show prints it)")
    return 0


def info_23_lines(i: dict) -> List[str]:
    """GET_INFO's fields of P1 = 3 and 4 (3.0), as `info` and `selftest` print them. The rate, the last unit, the
    no-PIN window's start and the loads left are zeros to a reader not given the PIN or the owner's grant."""
    lines = []
    if "keyset_table" in i:
        lines.append(f"keyset table     : {'kept' if i['keyset_table'] else 'none'}, {i['entries']} entries in use, "
                     f"{i['unmarked']} without the holder's mark; the last payment's unit: {i['last_unit']}")
        lines.append(f"rate             : {i['rate'] or 'none, or not said'} (sats to the dollar)")
    if "nopin_window_start" in i:
        lines.append(f"no-PIN window    : {'from ' + str(i['nopin_window_start']) if i['nopin_window_start'] else 'none running, or not said'}")
    if "profiles" in i:
        lines.append(f"profiles         : {i['profiles_raw'].hex().upper()} ({', '.join(i['profiles']) or 'none'})")
    if "loads_left" in i:
        # zeros to a reader not told, which say nothing (spec/APDU.md GET_INFO bytes 57 and 58): not read as none left
        left = f"{i['loads_left']} of 300" if i["loads_left"] else "none, or not said (zeros to a reader not given the PIN or the grant)"
        lines.append(f"loads left today : {left}")
    return lines


def parse_point_65(value: str, what: str) -> bytes:
    """A point of the curve given as 33 bytes (02/03) or 65 (04) of hex, in the 04 form LOAD_CHANGE takes."""
    b = parse_hex(value, None, what)
    if len(b) not in (33, 65):
        raise SystemExit(f"{what} is 33 bytes (02/03) or 65 (04) of hex, got {len(b)}")
    return point_uncompressed(point_from_bytes(b, what))


def _needs_23(card, what: str) -> None:
    if not card.at_least(3, 0):
        raise SystemExit(f"{what} is protocol 3.0's: this card answers version {_version_text(card.version)}")


def cmd_change(args) -> int:
    """GET_CHANGE (3.0): every opening of the card's own change owed, paging until a short answer."""
    card = connect(args)
    _needs_23(card, "change")
    rows = card.owed_change()
    if not rows:
        print("no change owed")
        return 0
    for r in rows:
        print(f"opening {r['number']} : {r['amount']}  keyset {_hex(r['keyset'])}  date {r['date'] or 'none'}")
        print(f"  B_      : {_hex(r['b_'])}")
        print(f"  K       : {_hex(r['k'])}  (the mint's key it is bound to)")
    print(f"{len(rows)} owed; ask the mint for each by its B_ (NUT-09 restore) and give its answer to load-change")
    return 0


# What a holder does next after LOAD_CHANGE refuses with these words.
LOAD_CHANGE_NEXT = {
    0x6A80: "check that the answer is the mint's for this opening's B_ (change lists it) and K its key for the "
            "opening's amount",
    0x6A86: "cardctl sends P2 02; a card that refuses it does not take this form of LOAD_CHANGE",
    0x6A9F: "show the opening's key first: keyset-keys FILE --show N, with the mint's keys for its keyset",
}


def cmd_load_change(args) -> int:
    """
    LOAD_CHANGE (3.0): opening N made into its piece from the mint's answer for its B_. C_ and K in either form, e and
    s in hex. The opening is read first (GET_CHANGE): K must be the key it is bound to and the mint's proof must hold
    for its B_, both checked here before the card is asked.
    """
    if not 0 <= args.opening < CHANGE_MOST:
        raise SystemExit(f"an opening is 0 to {CHANGE_MOST - 1}, got {args.opening}")
    c_ = parse_point_65(args.c, "C_")
    k = parse_point_65(args.k, "K")
    e = parse_hex(args.e, 32, "e")
    s = parse_hex(args.s, 32, "s")
    card = connect(args)
    _needs_23(card, "load-change")
    row = next((r for r in card.owed_change() if r["number"] == args.opening), None)
    if row is None:
        raise SystemExit(f"opening {args.opening} is not owed (change lists the openings that are)")
    if point_compressed(point_from_bytes(k, "K")) != row["k"]:
        raise SystemExit(f"K is not the key opening {args.opening} is bound to ({_hex(row['k'])}): a holder binds an "
                         "opening to the mint's key with keyset-keys --show N --rebind")
    if not dleq_holds(row["b_"], c_, k, e, s):
        raise SystemExit(f"the mint's proof (e, s) does not hold for opening {args.opening}'s B_ {_hex(row['b_'])} "
                         "and this C_: nothing was sent")
    try:
        got = card.load_change(args.opening, c_, k, e, s)
    except CardError as exc:
        if exc.sw in LOAD_CHANGE_NEXT:
            raise SystemExit(f"error: {exc}. {LOAD_CHANGE_NEXT[exc.sw]}")
        raise
    p = got["piece"]
    print(f"loaded into slot {got['slot']} (the mint's proof {'kept with it' if got['proof_kept'] else 'not kept: no room'})")
    print(f"keyset    : {p['keyset_id']}")
    print(f"amount    : {p['amount']}")
    print(f"nonce     : {_hex(p['nonce'])}")
    print(f"C         : {_hex(p['c'])}")
    print(f"date      : {p['date'] or 'none'}")
    return 0


def cmd_keyset_keys(args) -> int:
    """
    KEYSET_KEYS (3.0): teach the card a keyset's keys from a file of the mint's keys (P1 0 to 2, under --pin), the ID
    it answers checked against the file's; and with --show N, show opening N's key to be one of them by its path
    (P1 3, no PIN). --rebind binds the opening to the file's key for its amount, and moves it to the file's keyset
    where it is in another: under the PIN and the owner's grant, in a tap that paid nothing.
    """
    ks = read_keyset_file(args.file, args.input_fee_ppk)
    if args.show is None and not args.pin:
        raise SystemExit("teaching wants the PIN given in this tap (--pin); --show N alone shows an opening's key")
    if args.show is not None and not 0 <= args.show < CHANGE_MOST:
        raise SystemExit(f"an opening is 0 to {CHANGE_MOST - 1}, got {args.show}")
    if args.rebind and (args.show is None or not args.pin or not args.owner):
        raise SystemExit("--rebind binds opening --show N under the PIN (--pin) and the owner's grant (--owner); on a "
                         "card with no owner the holder's say is a held tap, which cardctl does not make")
    owner = owner_key(args) if args.owner else None
    card = connect(args)
    _needs_23(card, "keyset-keys")
    _holders_say(card, args, owner)
    id8, keys = ks["id"][:8], ks["keys"]
    if args.pin:
        card.keyset_keys_begin(id8, ks["tail"])
        for at in range(0, len(keys), KEYSET_KEYS_PER_COMMAND):
            card.keyset_keys_keys(keys[at:at + KEYSET_KEYS_PER_COMMAND])
        got = card.keyset_keys_finish()
        if got != ks["id"]:
            print(f"the card worked out the ID {_hex(got)}, not the file's {_hex(ks['id'])}: nothing kept")
            return 1
        print(f"taught    : {len(keys)} keys of keyset {_hex(ks['id'])}; the card worked out the same ID")
    if args.show is None:
        return 0
    row = next((r for r in card.owed_change() if r["number"] == args.show), None)
    if row is None:
        raise SystemExit(f"opening {args.show} is not owed (change lists the openings that are)")
    amounts = [a for a, _ in keys]
    if row["amount"] not in amounts:
        raise SystemExit(f"keyset {_hex(id8)} has no key for opening {args.show}'s amount {row['amount']}")
    index = amounts.index(row["amount"])
    key = keys[index][1]
    other_key = other_keyset = None
    if row["keyset"] != id8:
        if not args.rebind:
            raise SystemExit(f"opening {args.show} is in keyset {_hex(row['keyset'])}, the file is {_hex(id8)}: "
                             "--rebind moves it to the file's keyset")
        other_key, other_keyset = key, id8
    elif row["k"] != key:
        if not args.rebind:
            raise SystemExit(f"opening {args.show} is bound to {_hex(row['k'])}, not the file's key for "
                             f"{row['amount']} ({_hex(key)}): --rebind binds it to the file's key")
        other_key = key
    path = keyset_path(keys, index)
    if fold_path(keyset_leaf(row["amount"], key), index, path) != keyset_levels(keys)[-1][0]:
        raise SystemExit("the path does not reach the keyset's top")  # the arithmetic above disagrees with itself
    card.keyset_keys_show(args.show, index, path, other_key, other_keyset)
    print(f"shown     : opening {args.show}'s key {_hex(key)} is keyset {_hex(id8)}'s key for {row['amount']}"
          + (" (bound to it now)" if other_key else "") + (" (moved to that keyset)" if other_keyset else ""))
    return 0


def cmd_cert(args) -> int:
    """CERT_READ (3.0): the certificate's state and, where one is sealed, its container and the container's SHA-256."""
    card = connect(args)
    _needs_23(card, "cert")
    cert = card.cert_read()
    if not cert["sealed"]:
        print("certificate : none sealed")
        return 0
    print(f"certificate : sealed, version {cert['version']}, {cert['length']} bytes")
    print(f"container   : {_hex(cert['container'])}")
    print(f"sha256      : {hashlib.sha256(cert['container']).hexdigest()}")
    return 0


def cmd_apdu(args) -> int:
    card = Card(reader_index=args.reader, verbose=True)
    if not args.no_select:
        card.select()
    try:
        body = card.transmit(parse_hex(args.apdu, None, "apdu"), "raw APDU")
        print(_hex(body) if body else "(no data)")
        return 0
    except CardError as exc:
        print(exc, file=sys.stderr)
        return 1


def cmd_selftest(args) -> int:
    """
    The card-arrival test. Everything the applet claims, proven on real silicon.
    """
    results: List[Tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")

    card = Card(reader_index=args.reader, verbose=args.verbose)
    print(f"reader: {card.reader}\n")

    version = card.select()
    record("SELECT applet", *_select_verdict(version))

    info = card.get_info()
    record("GET_INFO", len(info) > 0 and info["max_slots"] == MAX_PROOFS,
           f"v{info['version']}, {info['max_slots']} slots, PIN {info['pin_state']}, "
           f"owner {'yes' if info['has_owner'] else 'none'}")
    # 3.0: format 5 is a card whose keyset table holds a keyset of the other unit (two units on one card)
    formats = (FORMAT, FORMAT_TWO_UNITS) if card.at_least(3, 0) else (FORMAT,)
    record("format 4 (SIG_ALL pieces)" + (", or 5 with two units" if len(formats) > 1 else ""),
           info["format"] in formats, f"format {info['format']}")
    record("Schnorr capability advertised", info["schnorr"], f"caps=0x{info['caps_raw']:02X}")
    # 3.0: GET_INFO P1 = 4 names the profiles the card keeps; keys per load (byte 56 bit 1) is part of every 3.0 card
    if card.at_least(3, 0):
        record("keys per load (GET_INFO byte 56 bit 1)", "keys per load" in info.get("profiles", []),
               f"profiles {info['profiles_raw'].hex().upper()}" if "profiles_raw" in info
               else "GET_INFO P1 4 answered fewer than 57 bytes: no profiles")
        for line in info_23_lines(info):
            print(f"note  {line}")

    # A blocked PIN (GET_INFO byte 7 = 2) pays nothing until the owner's
    # change-pin; AUTH needs no PIN, so the signing rounds still run.
    if info["pin_state"] == "blocked":
        record("PIN state", False, _blocked_pin_detail(info))
    elif info["pin_state"] == "set":
        if getattr(args, "pin", None):
            try:
                card.verify_pin(args.pin.encode())
                record("VERIFY_PIN", True, "the PIN verifies")
            except CardError as exc:
                record("VERIFY_PIN", False, str(exc))
        else:
            print("note  the card has a PIN; pass --pin to check it (AUTH needs none)")

    # Conformance, not mere parseability: spec/APDU.md fixes the wire format at
    # 33-byte compressed. selftest reads the raw bytes so an off-spec applet is
    # a FAIL rather than silently papered over.
    pk_raw = card.get_pubkey(raw=True)
    pk_spec = len(pk_raw) == 33 and pk_raw[0] in (0x02, 0x03)
    pk_form = {33: "compressed", 65: "uncompressed"}.get(len(pk_raw), "unknown")
    record("GET_PUBKEY well-formed", pk_spec,
           f"{_hex(pk_raw)[:20]}… ({len(pk_raw)} bytes, {pk_form})")
    try:
        pk = bip340.compress(pk_raw)
    except ValueError:
        pk = None

    record("GET_BALANCE", True, str(card.get_balance()))

    status = card.get_slot_status()
    record("GET_SLOT_STATUS", len(status) == info["max_slots"],
           f"{len(status)} status bytes")

    c = card.get_card()
    record("GET_CARD", c["format"] in formats,
           f"rolls {c['rolls']} of {c['budget']}, allowance {'armed' if c['armed'] else 'not armed'}")

    def verdict() -> int:
        failed = [n for n, ok, _ in results if not ok]
        print()
        if failed:
            print(f"{len(failed)} check(s) FAILED: {', '.join(failed)}")
            return 1
        print(f"All {len(results)} checks passed on physical hardware.")
        return 0

    # The whole point: does a signature off this card verify against BIP-340?
    all_sigs_ok = True
    for i in range(args.rounds):
        reader = secrets.token_bytes(AUTH_NONCE_LEN)
        card_nonce, sig = card.auth(reader)
        ok = pk is not None and check_signature(pk, auth_message(reader, card_nonce, pk), sig)
        all_sigs_ok &= ok
        record(f"AUTH + BIP-340 verify [{i + 1}/{args.rounds}]", ok,
               "" if ok else f"reader={_hex(reader)} card={_hex(card_nonce)} sig={_hex(sig)}")

    # A fresh nonce per signature is a BIP-340 requirement and a real security
    # property here: a nonce that is a pure function of (d, msg) leaks the key
    # to anyone who can fault-inject two signatures over the same message. The
    # same reader bytes twice must still give two R.
    if args.rounds >= 2:
        fixed = secrets.token_bytes(AUTH_NONCE_LEN)
        (n1, s1), (n2, s2) = card.auth(fixed), card.auth(fixed)
        record("fresh nonce across identical requests", s1[:32] != s2[:32] and n1 != n2,
               "R reused — aux randomness is not working" if s1[:32] == s2[:32] else "")

    rc = verdict()
    return rc if all_sigs_ok else 1


def _select_verdict(version: bytes) -> Tuple[bool, str]:
    """
    Whether the applet version SELECT answered is a build selftest can pass:
    protocol 2.1, 2.2 or 3.0 (SELFTEST_VERSIONS). The shared AID (D19) answers
    nothing below 2.0, and a 2.0 card is the v2.0.0 release, which D26 replaced:
    it is reinstalled. A later minor of a major this tool knows (2.3, 3.1), or a
    later major (4.0), is one it does not know, and is refused.
    """
    if len(version) < 2:
        return False, "SELECT returned no applet version"
    ver = tuple(version[:2])
    newest_of_major = max((v for v in SELFTEST_VERSIONS if v[0] == ver[0]), default=None)
    if ver > SELFTEST_VERSIONS[-1] or (newest_of_major is not None and ver > newest_of_major):
        return False, (f"applet {ver[0]}.{ver[1]} is a version this cardctl does not know (it knows 2.1, 2.2 and "
                       f"3.0): use a cardctl of that version")
    if ver not in SELFTEST_VERSIONS:
        return False, (f"applet {ver[0]}.{ver[1]} is not protocol 2.1, 2.2 or 3.0: sweep the balance, then "
                       f"reinstall the tracked CAP (docs/HARDWARE_DEPLOYMENT.md)")
    return True, f"version {ver[0]}.{ver[1]}"


def _blocked_pin_detail(info: dict) -> str:
    """What a blocked PIN (GET_INFO byte 7 = 2) means on a 2.0 card."""
    if info.get("has_owner"):
        return ("blocked (GET_INFO byte 7 = 2): no payment signs until the owner's phone, "
                "or `cardctl change-pin --owner-key …`, sets a new PIN (CHANGE_PIN unblocks)")
    return ("blocked (GET_INFO byte 7 = 2) on a card with no owner: it holds nothing, "
            "and `cardctl set-pin` sets a new PIN")


# ── argument parsing ──────────────────────────────────────────────────────────
def _owner_arg(s, required: bool = False) -> None:
    s.add_argument("--owner-key", required=required,
                   help="the owner's P-256 private key, 32 bytes hex (default: cardctl's TEST key)")


def _holder_owner_args(s) -> None:
    """--owner-key, the key the card is given, or --test-owner-key; one of them is asked for (`_holder_owner_key`)."""
    who = s.add_mutually_exclusive_group()
    who.add_argument("--owner-key", help="the holder's P-256 private key, 32 bytes hex: required, unless "
                                         "--test-owner-key")
    who.add_argument("--test-owner-key", action="store_true",
                     help="a bench card only: give it cardctl's TEST key, which anyone with this repository holds "
                          "(they can change its PIN and spend it)")


def _owner_seed_arg(s) -> None:
    s.add_argument("--owner-seed", help="3.0 (D202): the owner's 64-byte BIP-39 seed, hex; the card's c is worked out "
                                        "from it and the card's key, and given sealed with the claim or hand-over, so "
                                        "that a phone restored from the words has it (default: the card keeps its own)")


def _design_arg(s) -> None:
    s.add_argument("--design", help="the card's design code, three capital letters or digits (FX1)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cardctl",
        description="PC/SC driver for the Cashu card applet, protocol 2.0 (spec/APDU.md).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Start with:  cardctl readers   then   cardctl selftest",
    )
    p.add_argument("-r", "--reader", type=int, default=0, help="reader index (default 0)")
    p.add_argument("-v", "--verbose", action="store_true", help="log APDUs to stderr")
    p.add_argument("-t", "--timing", action="store_true",
                   help="time every APDU (reader round trip) to stderr, with a summary at exit")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("readers", help="list PC/SC readers").set_defaults(func=cmd_readers)
    sub.add_parser("info", help="version, slots, PIN, owner, clock, limits, rollover budget").set_defaults(func=cmd_info)
    sub.add_parser("pubkey", help="card's compressed secp256k1 public key").set_defaults(func=cmd_pubkey)
    sub.add_parser("balance", help="sum of unspent proof amounts").set_defaults(func=cmd_balance)
    sub.add_parser("auth", help="AUTH: the card proves its key; the signature is verified here").set_defaults(func=cmd_auth)

    s = sub.add_parser("slots", help="per-slot status")
    s.add_argument("--all", action="store_true", help="include empty slots")
    s.set_defaults(func=cmd_slots)

    s = sub.add_parser("proof", help="read a proof slot")
    s.add_argument("slot", type=int)
    s.set_defaults(func=cmd_proof)

    s = sub.add_parser("load", help="LOAD_PROOF into the next free slot")
    s.add_argument("--keyset", required=True,
                   help="NUT-02 keyset id, 16 hex chars (e.g. 0059534ce0bfa19a)")
    s.add_argument("--amount", type=int, required=True)
    s.add_argument("--nonce", help="32-byte P2PK nonce as hex (random if omitted)")
    s.add_argument("--c", help="33-byte C point as hex (placeholder if omitted)")
    s.add_argument("--date", type=int, default=0, help="the piece's locktime, seconds (default 0: none)")
    s.add_argument("--pin", help="verify this PIN first (a 3.0 card loads only under the PIN given in this tap)")
    s.add_argument("--owner", action="store_true",
                   help="the owner's grant (ALLOW_LOAD) too; on 3.0 it opens no load: give --pin")
    s.add_argument("--date-keys", action="store_true",
                   help="the piece was minted locked to the card's key for its date, P + t*G (from group-keys or "
                        "from c), never to the card's main key P: sends P2 02, which a 3.0 card wants (6A86 without)")
    _owner_arg(s)
    s.set_defaults(func=cmd_load)

    s = sub.add_parser("load-file", help="0.x only: LOAD_PROOF every proof in a card file (spec/CARD-FILE.md)")
    s.add_argument("path", help="card file written by cashu-client")
    s.add_argument("--pin", help="verify this PIN first")
    s.set_defaults(func=cmd_load_file, legacy=True)

    s = sub.add_parser("dump", help="0.x only: write the card's slots out as a card file (spec/CARD-FILE.md)")
    s.add_argument("--mint", required=True, help="mint URL these proofs belong to")
    s.add_argument("--unit", default="sat", help="keyset unit (default: sat)")
    s.add_argument("--out", help="write here instead of stdout")
    s.add_argument("--force", action="store_true",
                   help="overwrite --out if it already exists")
    s.add_argument("--unspent-only", action="store_true",
                   help="skip spent slots (they are still readable, and still owed)")
    s.set_defaults(func=cmd_dump, legacy=True)

    s = sub.add_parser("clear-spent", help="free all spent slots")
    s.add_argument("--pin")
    s.set_defaults(func=cmd_clear_spent)

    s = sub.add_parser("verify-pin", help="verify the PIN for this tap (sent again while the card answers 6A98, keep holding)")
    s.add_argument("pin")
    s.set_defaults(func=cmd_verify_pin)

    s = sub.add_parser("set-pin", help="set the PIN on a card with no owner; an owned card's PIN is changed by change-pin")
    s.add_argument("pin")
    s.add_argument("--owner", action="store_true",
                   help="2.2 and earlier: ADD PIN under the owner's grant; a 3.0 card with an owner refuses SET_PIN "
                        "(6A91): use change-pin")
    _owner_arg(s)
    s.set_defaults(func=cmd_set_pin)

    s = sub.add_parser("change-pin", help="the owner sets a new PIN: no old PIN, unblocks a blocked card")
    s.add_argument("new")
    _owner_arg(s)
    s.set_defaults(func=cmd_change_pin)

    s = sub.add_parser("set-owner", help="give the card its owner key, anchored at a block header")
    s.add_argument("--anchor", help="the tip block header, 80 bytes hex (the clock is anchored at it)")
    s.add_argument("--pin", help="a claim (a card with no owner) wants the PIN given in this tap; the card is held for "
                                 "(6A98, keep holding) and asked six times")
    s.add_argument("--old-owner-key", help="the current owner's private key, on a card that has one (only with nothing "
                                           "unspent and no change owed, 6A8D)")
    _owner_seed_arg(s)
    _holder_owner_args(s)
    s.set_defaults(func=cmd_set_owner)

    s = sub.add_parser("set-owner-url", help="set-owner with the anchor fetched from the ops service's tip feed")
    s.add_argument("--url", default=DEFAULT_OPS_URL, help=f"the ops service base URL (default {DEFAULT_OPS_URL})")
    s.add_argument("--pin", help="a claim (a card with no owner) wants the PIN given in this tap")
    s.add_argument("--old-owner-key", help="the current owner's private key, on a card that has one")
    _owner_seed_arg(s)
    _holder_owner_args(s)
    s.set_defaults(func=cmd_set_owner_with_anchor_url)

    s = sub.add_parser("set-card", help="write the card record (the mint)")
    s.add_argument("--mint", required=True)
    s.add_argument("--unit", choices=sorted(UNITS), help="the card's unit (default: the unit its record has, sat on a "
                                                         "new card)")
    s.add_argument("--refund", help="33-byte refund key hex (default: none)")
    s.add_argument("--pin", help="verify this PIN first (an open card with a PIN)")
    _design_arg(s)
    _owner_arg(s)
    s.set_defaults(func=cmd_set_card)

    s = sub.add_parser("setup", help="3.0: a fresh card's first set-up in one selection: PIN, record, owner (claimed, "
                                     "with the anchor), and the owner's limits with --day")
    s.add_argument("--pin", required=True, help="the card's PIN, 4 to 8 digits")
    s.add_argument("--mint", required=True, help="the mint's URL, 1 to 77 printable ASCII characters")
    s.add_argument("--unit", choices=sorted(UNITS), default="sat", help="the card's unit (default sat); a usd card's "
                                                                        "limits are in cents")
    s.add_argument("--refund", help="33-byte refund key hex (default: none)")
    s.add_argument("--anchor", help="the tip block header, 80 bytes hex (the clock is anchored at it)")
    s.add_argument("--day", type=int, help="a day's worth in the card's unit (0: none); without it no limits are sent")
    s.add_argument("--payment", type=int)
    s.add_argument("--allowance", type=int)
    s.add_argument("--budget", type=int)
    s.add_argument("--rate", type=int)
    s.add_argument("--no-pin-window", type=int, choices=(0, 1))
    _design_arg(s)
    _owner_seed_arg(s)
    _holder_owner_args(s)
    s.set_defaults(func=cmd_setup)

    s = sub.add_parser("reset", help="3.0: the reset of an empty card: by the PIN on a card with no owner (a held tap, "
                                     "then sixty askings, about 45 seconds), by the owner's proof (--owner-key) on one "
                                     "with an owner: no PIN, no record, a new card key, for setup")
    s.add_argument("--pin", help="the card's PIN: a card with no owner (on a fresh card reset with --anchor, set here "
                                 "for the reset alone), or a locked card with an owner")
    s.add_argument("--owner-key", help="a card with an owner: its owner's P-256 private key, 32 bytes hex ('test' for "
                                       "cardctl's TEST key)")
    s.add_argument("--anchor", help="a block header, 80 bytes hex: the card's clock after the reset, even where it is "
                                    "older than the card's (D200): the way back from a clock a header far ahead set")
    s.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    s.set_defaults(func=cmd_reset)

    s = sub.add_parser("set-limit", help="the owner's limits: day, one payment, no-PIN allowance, rollover budget, rate")
    s.add_argument("--day", type=int, required=True, help="a day's worth in the card's unit, sats or cents (0: none)")
    s.add_argument("--payment", type=int, help="what one payment may take without waiting, in the card's unit (0: none)")
    s.add_argument("--allowance", type=int, help="what is signed for without the PIN, in the card's unit (0: none)")
    s.add_argument("--budget", type=int, help=f"rolls between the owner's refreshes, 1-{ROLL_BUDGET_MOST} (default {ROLL_BUDGET_DEFAULT})")
    s.add_argument("--rate", type=int, help="sats to the dollar, for a payment in the other unit (0: none; needs --budget)")
    s.add_argument("--no-pin-window", type=int, choices=(0, 1),
                   help="0: the no-PIN allowance comes back no sooner than 24 hours after its window began, once armed; 1: at the next payment after it is armed (needs --rate)")
    _owner_arg(s)
    s.set_defaults(func=cmd_set_limit)

    s = sub.add_parser("set-header", help="SET_HEADER: show the card a block header (its clock moves forward)")
    s.add_argument("--header", required=True, help="80 bytes hex")
    s.set_defaults(func=cmd_set_header)

    s = sub.add_parser("tip", help="print the ops service's tip header (80 bytes hex), for --anchor")
    s.add_argument("--url", default=DEFAULT_OPS_URL, help=f"the ops service base URL (default {DEFAULT_OPS_URL})")
    s.set_defaults(func=cmd_tip)

    s = sub.add_parser("refresh", help="REFRESH: the owner's proof over the tip header (or, with --pin, the holder's on a "
                                       "card with no owner); the rollover budget is full again, and a weak clock comes back")
    s.add_argument("--header", required=True, help="the tip block header, 80 bytes hex")
    s.add_argument("--back", action="store_true", help="the owner's: bring the clock back to this older header, and the "
                                                       "day's windows begun after it with it (D201)")
    s.add_argument("--pin", help="the holder's REFRESH of a card with no owner (P1 01): its PIN, in a held tap")
    _owner_arg(s)
    s.set_defaults(func=cmd_refresh)

    s = sub.add_parser("lock", help="permanently disable writes (IRREVERSIBLE): the PIN and the owner's proof")
    s.add_argument("--pin")
    s.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    _owner_arg(s)
    s.set_defaults(func=cmd_lock)

    s = sub.add_parser("outbox", help="GET_OUTBOX (2.2): the last payment's settlement packet, its signatures checked; "
                                      "on 3.0 the scope wants the PIN or the owner's grant")
    s.add_argument("--file", help="decode a packet saved as hex instead of reading a card")
    s.add_argument("--pin", help="verify this PIN first (3.0: the scope; the packet wants the owner's grant, or on a "
                                 "card with no owner the PIN in a held tap, which cardctl does not make)")
    s.add_argument("--owner", action="store_true", help="the owner's grant (ALLOW_LOAD) first (3.0: the scope and the packet)")
    _owner_arg(s)
    s.set_defaults(func=cmd_outbox)

    s = sub.add_parser("group-keys", help="GROUP_KEYS (3.0): the keys of one date's pieces, t, P + t*G and R + u*G, "
                                          "under the PIN or the owner's grant")
    s.add_argument("--date", type=int, required=True, help="the pieces' date (locktime, seconds); 0 for undated pieces")
    s.add_argument("--pin", help="verify this PIN first")
    s.add_argument("--owner", action="store_true", help="the owner's grant (ALLOW_LOAD) first")
    _owner_arg(s)
    s.set_defaults(func=cmd_group_keys)

    s = sub.add_parser("card-secret", help="GET_CARD P1 3 (3.0): the card's secret c, sealed, opened here and checked "
                                           "against GROUP_KEYS; printed only with --show")
    s.add_argument("--refund-key", help="the refund key's private key r, 32 bytes hex (a card with a refund key: c is "
                                        "sealed to it)")
    s.add_argument("--refund-key-file", help="a file holding r as hex, in place of --refund-key")
    s.add_argument("--pin", help="a card with no owner and a refund key: verify this PIN first")
    s.add_argument("--owner-key", help="the owner's P-256 private key, 32 bytes hex, for the grant on an owned card "
                                       "(default: cardctl's TEST key)")
    s.add_argument("--show", action="store_true",
                   help="print c: it ties every payment of the card to it, and is kept with the refund key")
    s.add_argument("--owner-seed", help="the owner's 64-byte BIP-39 seed, hex: check that c is the owner's (D202), worked "
                                        "out from the seed alone, and say which owner's c of the card it is")
    s.add_argument("--date", type=int, help="with --owner-seed and the refund key: check the take-back key of this date "
                                            "(r + u, u from the restored c) against the card's refund key for it")
    s.set_defaults(func=cmd_card_secret)

    s = sub.add_parser("change", help="GET_CHANGE (3.0): the openings of the card's own change owed, every page")
    s.set_defaults(func=cmd_change)

    s = sub.add_parser("load-change", help="LOAD_CHANGE (3.0): an opening of the card's change made into its piece "
                                           "from the mint's answer for its B_; any reader, no PIN")
    s.add_argument("opening", type=int, help="the opening's number, 0 to 7, as change lists it")
    s.add_argument("--c", required=True, help="C_, the mint's blind signature: 33 bytes (02/03) or 65 (04) of hex")
    s.add_argument("--k", required=True, help="K, the mint's key for the opening's amount: 33 or 65 bytes of hex")
    s.add_argument("--e", required=True, help="e of the mint's proof (NUT-12), 32 bytes hex")
    s.add_argument("--s", required=True, help="s of the mint's proof (NUT-12), 32 bytes hex")
    s.set_defaults(func=cmd_load_change)

    s = sub.add_parser("keyset-keys", help="KEYSET_KEYS (3.0): teach the card a keyset's keys from the mint's (NUT-01 "
                                           "JSON) under --pin; --show N shows opening N's key to be one of them")
    s.add_argument("file", help="the mint's keys for one keyset: {\"id\", \"unit\", \"keys\": {\"1\": \"02..\", ...}}")
    s.add_argument("--pin", help="verify this PIN first: teaching wants it")
    s.add_argument("--show", type=int, help="show opening N's key (its path in the keyset's tree); no PIN")
    s.add_argument("--rebind", action="store_true",
                   help="with --show: bind the opening to the file's key for its amount, and move it to the file's "
                        "keyset where it is in another (the PIN and the owner's grant, in a tap that paid nothing)")
    s.add_argument("--owner", action="store_true", help="the owner's grant (ALLOW_LOAD) first: the holder's say")
    s.add_argument("--input-fee-ppk", type=int,
                   help="a version 01 keyset's fee, where the file has no input_fee_ppk (GET /v1/keysets says it)")
    _owner_arg(s)
    s.set_defaults(func=cmd_keyset_keys)

    sub.add_parser("cert", help="CERT_READ (3.0): the certificate's state, its container and the container's "
                                "SHA-256").set_defaults(func=cmd_cert)

    s = sub.add_parser("apdu", help="send a raw APDU (hex)")
    s.add_argument("apdu")
    s.add_argument("--no-select", action="store_true", help="skip SELECT first")
    s.set_defaults(func=cmd_apdu)

    s = sub.add_parser("selftest", help="full hardware check incl. BIP-340 verification of AUTH signatures")
    s.add_argument("--rounds", type=int, default=3, help="AUTH rounds (default 3)")
    s.add_argument("--pin", help="verify this PIN as well (AUTH needs none)")
    s.set_defaults(func=cmd_selftest)

    return p


def main() -> int:
    global TIMING_ENABLED
    args = build_parser().parse_args()
    TIMING_ENABLED = bool(getattr(args, "timing", False))
    try:
        return args.func(args)
    except CardError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    finally:
        # Summarise even on a CardError: the APDUs before the failure are the
        # ones worth knowing about.
        if TIMING_ENABLED and TIMINGS:
            print("\napdu timing (reader round trip):", file=sys.stderr)
            print(summarize_timings(TIMINGS), file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
