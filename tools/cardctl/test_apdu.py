"""
APDU encoding tests for cardctl.

These assert the exact bytes cardctl puts on the wire against spec/APDU.md
(protocol 2.0).
Worth having because the alternative is discovering an off-by-one in P1 or a
missing Le byte while hunched over a card reader, where every iteration costs a
re-tap and the failure looks identical to a hardware problem.

No reader and no card required — the PC/SC connection is faked.

Run:  python3 -m pytest test_apdu.py -q     (or: python3 test_apdu.py)
"""

import contextlib
import io
import secrets
import sys
import traceback
import types

import bip340
import cardctl


class FakeConnection:
    """Records transmitted APDUs and replays canned responses."""

    def __init__(self, responses=None):
        self.sent = []
        self.responses = list(responses or [])

    def connect(self):
        pass

    def transmit(self, apdu):
        self.sent.append(bytes(apdu))
        if self.responses:
            data, sw = self.responses.pop(0)
            return list(data), sw >> 8, sw & 0xFF
        return [], 0x90, 0x00

    @property
    def last(self):
        return self.sent[-1]


def make_card(responses=None):
    """A Card wired to a FakeConnection, bypassing PC/SC discovery."""
    card = cardctl.Card.__new__(cardctl.Card)
    card.connection = FakeConnection(responses)
    card.verbose = False
    card.reader = "fake"
    return card


import p256

# A mint's GET /v1/info that says NUT-09 and NUT-12: SPEND_ALL_CHANGE is asked only at such a mint.
CHANGE_MINT = {"nuts": {"9": {"supported": True}, "12": {"supported": True}}}

# A GET_INFO answer of 2.0 (P1 = 2, 43 bytes): version 2.0, 128 slots, 3 unspent,
# 1 spent, 124 empty, caps FF, PIN set, format 4, 3 tries, not locked, record set,
# a daily limit of 5000, an owner, now 1791814824, window 1791800000, 100 spent
# today, no change owed; payment limit 0, allowance 250, 50 signed without the
# PIN; the tag on.
INFO_43 = (bytes([2, 0, 128, 3, 1, 124, 0xFF, 1, 4, 3, 0, 1]) + (5000).to_bytes(4, "big") + b"\x01"
           + (1791814824).to_bytes(4, "big") + (1791800000).to_bytes(4, "big") + (100).to_bytes(4, "big")
           + b"\x00" + (0).to_bytes(4, "big") + (250).to_bytes(4, "big") + (50).to_bytes(4, "big") + b"\x00")
assert len(INFO_43) == 43

# A GET_INFO answer of 3.0 (P1 = 4, 59 bytes): INFO_43's bytes as a 3.0 card says them, then the keyset table kept,
# a rate of 95000, 3 entries in use, 1 of them unmarked, the last payment in the card's unit (80), the no-PIN window
# begun at 1791700000, the profiles FF 03 and 298 loads left today.
INFO_59 = (b"\x03\x00" + INFO_43[2:] + b"\x01" + (95000).to_bytes(4, "big") + bytes([3, 1, 0x80])
           + (1791700000).to_bytes(4, "big") + bytes([0xFF, 0x03]) + (298).to_bytes(2, "big"))
assert len(INFO_59) == 59

# A GET_CARD answer: format 4, record set, sat, limit 5000, no refund key, the
# hardest bits, a header hash, 2 rolls, budget byte 0 (the default, 7), armed,
# 26 zeros, the mint, no design.
_MINT = b"https://forge.flashapp.me"
CARD_ANSWER = (bytes([4, 1, 0]) + (5000).to_bytes(4, "big") + bytes(33) + bytes.fromhex("f01e0217")
               + bytes(range(32)) + bytes([2, 0, 1]) + bytes(26) + bytes([len(_MINT)]) + _MINT + bytes(3))


# ── selection ─────────────────────────────────────────────────────────────────
def test_select_uses_the_11_byte_applet_aid_first():
    # D25: a reader selects the card's applet by its whole AID, F0 CASHUCARD 01.
    card = make_card([(b"\x02\x00", 0x9000)])
    assert card.select() == b"\x02\x00"
    assert card.connection.sent == [bytes.fromhex("00A404000BF043415348554341524401")], \
        [a.hex() for a in card.connection.sent]
    assert cardctl.PACKAGE_AID == b"\xF0" + b"CASHUCARD"
    assert cardctl.APPLET_AID == cardctl.PACKAGE_AID + b"\x01"
    assert cardctl.SELECT_AIDS == (cardctl.APPLET_AID, cardctl.PACKAGE_AID)


def test_select_falls_back_to_the_10_byte_package_aid():
    # The whole AID fails (6A82); the second SELECT is by the package AID.
    card = make_card([(b"", 0x6A82), (b"\x02\x00", 0x9000)])
    assert card.select() == b"\x02\x00"
    assert len(card.connection.sent) == 2
    assert card.connection.sent[1] == bytes.fromhex("00A404000AF0434153485543415244")


class ChipConnection(FakeConnection):
    """A J3R180 as v2.0.0-rc.1 left it (ENG-681): the opener (F0 CASHUCARD 4D)
    instantiated first, then the card's applet (F0 CASHUCARD 01). The chip
    gives a partial name to the first instance whose AID begins with it, so a
    SELECT by the package AID reaches the opener: 9000 with no body, and 6D00
    to the next command. The whole AID reaches the card's applet: 02 00."""

    OPENER = bytes.fromhex("F04341534855434152444D")
    CARD = bytes.fromhex("F043415348554341524401")
    INSTANCES = (OPENER, CARD)  # in the order the chip made them

    def __init__(self):
        super().__init__()
        self.selected = None

    def transmit(self, apdu):
        apdu = bytes(apdu)
        self.sent.append(apdu)
        if apdu[:4] == bytes.fromhex("00A40400"):
            name = apdu[5:5 + apdu[4]]
            match = next((aid for aid in self.INSTANCES if aid.startswith(name)), None)
            if match is None:
                return [], 0x6A, 0x82
            self.selected = match
            return ([0x02, 0x00] if match == self.CARD else []), 0x90, 0x00
        if self.selected == self.CARD and apdu[:2] == bytes([cardctl.CLA, cardctl.INS_GET_INFO]):
            return list(INFO_43), 0x90, 0x00
        return [], 0x6D, 0x00


def chip_card():
    card = make_card()
    card.connection = ChipConnection()
    return card


def test_on_the_chip_select_reaches_the_card_applet_not_the_opener():
    """The ENG-681 failure: selecting the package AID first took the opener's
    9000 for the card, and every command after it answered 6D00. Selecting the
    whole AID first answers 02 00, and GET_INFO then reaches the card."""
    card = chip_card()
    assert card.select() == b"\x02\x00"
    assert card.connection.selected == ChipConnection.CARD
    assert card.connection.sent == [bytes.fromhex("00A404000BF043415348554341524401")]
    assert card.get_info()["version"] == "2.0"

    # The order this replaced, against the same chip: the package AID's 9000
    # was returned as the version, and the opener was what answered next.
    old = chip_card()
    old_order_version = old.transmit(bytes.fromhex("00A404000AF0434153485543415244"), "SELECT")
    assert old_order_version == b"" and old.connection.selected == ChipConnection.OPENER
    try:
        old.get_info()
    except cardctl.CardError as exc:
        assert exc.sw == 0x6D00, exc
    else:
        raise AssertionError("the opener answered GET_INFO")


def test_a_package_aid_9000_with_no_version_falls_through():
    # The whole AID is not answered (6A82) and the package AID reaches the opener
    # (9000, no body): no 2.0 applet answered, so cardctl says the card needs an update
    # rather than returning an empty version.
    card = make_card([(b"", 0x6A82), (b"", 0x9000)])
    try:
        card.select()
    except SystemExit as exc:
        assert "no version" in str(exc) and "update" in str(exc), str(exc)
    else:
        raise AssertionError("a 9000 with no version was taken for the card's applet")
    # and an empty 9000 to the whole AID is passed over too, for the package AID's answer
    card = make_card([(b"", 0x9000), (b"\x02\x00", 0x9000)])
    assert card.select() == b"\x02\x00"
    assert [a[4] for a in card.connection.sent] == [11, 10]


def test_select_names_a_card_that_needs_an_update():
    card = make_card([(b"", 0x6A82), (b"", 0x6A82)])
    try:
        card.select()
    except SystemExit as exc:
        assert "needs an" in str(exc) and "update" in str(exc), str(exc)
    else:
        raise AssertionError("a card with no 2.0 applet was selected")


def test_the_card_file_tools_select_the_0x_aid_and_refuse_any_other_version():
    """dump and load-file are 0.x-only (spec/CARD-FILE.md): they select the 0.x AID,
    and refuse a card that answers it with any major version but 0."""
    card = make_card([(b"\x00\x06", 0x9000)])
    assert card.select(legacy=True) == b"\x00\x06"
    assert card.connection.last == bytes.fromhex("00A4040007D2760000850102")
    for sub, extra in (("dump", ["--mint", "https://forge.flashapp.me"]), ("load-file", ["x.json"])):
        args = cardctl.build_parser().parse_args([sub, *extra])
        assert args.legacy is True, sub
    for sub in ("info", "selftest", "load", "set-owner"):
        flags = {"load": ["--keyset", "0059534ce0bfa19a", "--amount", "1"]}.get(sub, [])
        assert getattr(cardctl.build_parser().parse_args([sub, *flags]), "legacy", False) is False, sub


def test_connect_refuses_a_card_of_the_wrong_major_version():
    class Args:
        reader = 0
        verbose = False
        legacy = False
    real = cardctl.Card
    for legacy, answer, ok in ((False, b"\x02\x00", True), (False, b"\x02\x02", True), (False, b"\x03\x00", True),
                                (False, b"\x01\x14", False), (False, b"\x04\x00", False),
                                (True, b"\x00\x06", True), (True, b"\x02\x00", False), (True, b"\x03\x00", False)):
        card = make_card([(answer, 0x9000)])
        cardctl.Card = lambda *a, **kw: card
        Args.legacy = legacy
        try:
            try:
                cardctl.connect(Args)
            except SystemExit as exc:
                assert not ok, (legacy, answer, str(exc))
            else:
                assert ok, (legacy, answer)
        finally:
            cardctl.Card = real


# ── read commands: exact bytes from spec/APDU.md ─────────────────────────────
def test_read_command_encodings():
    # Each canned response is long enough not to trip length checks; get_pubkey
    # additionally validates the point encoding, so its reply must parse.
    cases = [
        ("get_info", (), "B0010200 00", INFO_43),
        ("get_pubkey", (), "B0100000 21", b"\x02" + b"\x00" * 32),
        ("get_balance", (), "B0110000 04", b"\x00" * 40),
        ("get_proof_count", (), "B0120000 01", b"\x00" * 40),
        ("get_slot_status", (), "B0140000 80", b"\x00" * 128),
        ("get_card", (), "B0160000 00", CARD_ANSWER),
        ("get_nonce", (), "B0440000 10", bytes(16)),
    ]
    for method, args, expected, response in cases:
        card = make_card([(response, 0x9000)])
        getattr(card, method)(*args)
        assert card.connection.last == bytes.fromhex(expected.replace(" ", "")), \
            f"{method}: {card.connection.last.hex()} != {expected}"


def test_get_pubkey_normalises_a_65_byte_card_to_33_bytes():
    # An applet built before GET_PUBKEY was fixed returns getW()'s 65-byte
    # uncompressed point on real silicon. Every consumer (sign, dump, load-file)
    # goes through Card.get_pubkey(), so the normalisation has to live there —
    # not in the verifier alone, or `dump` would write a 65-byte lock into the
    # card file that validate_card_doc then refuses to read back.
    x = bytes.fromhex("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
    y = bytes.fromhex("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
    uncompressed = b"\x04" + x + y
    card = make_card([(uncompressed, 0x9000), (uncompressed, 0x9000)])
    assert card.get_pubkey() == b"\x02" + x
    assert card.get_pubkey(raw=True) == uncompressed

    compressed = b"\x03" + x
    card = make_card([(compressed, 0x9000)])
    assert card.get_pubkey() == compressed

    card = make_card([(b"\x05" + x + y, 0x9000)])
    try:
        card.get_pubkey()
    except SystemExit as exc:
        assert "GET_PUBKEY" in str(exc)
    else:
        raise AssertionError("get_pubkey accepted a 65-byte blob without 0x04")


def test_get_proof_puts_slot_in_p1_and_asks_for_82_bytes():
    card = make_card([(b"\x01" + b"\x00" * 81, 0x9000)])
    card.get_proof(100)
    assert card.connection.last == bytes.fromhex("B0136400" + "52")


def test_get_proof_parses_the_slot_layout_with_its_date():
    body = (
        b"\x01"                                   # status: unspent
        + bytes.fromhex("0059534ce0bfa19a")       # keyset id (8 RAW bytes)
        + (1234).to_bytes(4, "big")               # amount
        + bytes(range(32))                        # nonce
        + b"\x02" + bytes(range(32))              # C
        + (1900000000).to_bytes(4, "big")         # date
    )
    assert len(body) == 82
    card = make_card([(body, 0x9000)])
    p = card.get_proof(0)
    assert p["status"] == "unspent"
    assert p["amount"] == 1234
    assert p["nonce"] == bytes(range(32))
    assert p["c"][0] == 0x02 and len(p["c"]) == 33
    assert p["date"] == 1900000000


def test_get_proof_on_a_0x_card_asks_for_78_bytes_and_has_no_date():
    body = b"\x01" + bytes.fromhex("0059534ce0bfa19a") + (8).to_bytes(4, "big") + bytes(32) + b"\x02" + bytes(32)
    card = make_card([(b"\x00\x06", 0x9000), (body, 0x9000)])
    card.select(legacy=True)
    p = card.get_proof(3)
    assert card.connection.last == bytes.fromhex("B0130300" + "4E")
    assert "date" not in p and p["amount"] == 8


def test_get_proof_returns_the_full_16_char_keyset_id():
    """
    A NUT-02 keyset id is 16 hex chars. Decoding the 8 stored bytes as ASCII
    would yield only 8 chars — half an id, matching no keyset at the mint.
    """
    body = (
        b"\x01"
        + bytes.fromhex("0059534ce0bfa19a")
        + (1).to_bytes(4, "big")
        + bytes(32)
        + b"\x02" + bytes(32)
        + bytes(4)
    )
    p = make_card([(body, 0x9000)]).get_proof(0)
    assert p["keyset_id"] == "0059534ce0bfa19a", p["keyset_id"]
    assert len(p["keyset_id"]) == 16


def test_parse_keyset_id_rejects_a_half_length_id():
    """Eight hex chars used to be ASCII-encoded, silently stranding the funds."""
    try:
        cardctl.parse_keyset_id("0059534c")
    except SystemExit as exc:
        assert "16" in str(exc), str(exc)
    else:
        raise AssertionError("expected SystemExit for a truncated keyset id")


def test_parse_keyset_id_accepts_a_full_id():
    assert cardctl.parse_keyset_id("0059534ce0bfa19a") == bytes.fromhex("0059534ce0bfa19a")
    # a version 01 id, given by its first 8 bytes as the card keeps it (NUT-02): a fresh Nutshell keyset's
    assert cardctl.parse_keyset_id("01884a74bb2fc5ee") == bytes.fromhex("01884a74bb2fc5ee")
    # any other version byte is refused
    for bad in ("0259534ce0bfa19a", "ff59534ce0bfa19a"):
        try:
            cardctl.parse_keyset_id(bad)
        except SystemExit as exc:
            assert "version 00 or 01" in str(exc), str(exc)
        else:
            raise AssertionError(f"parse_keyset_id accepted {bad}")
    # case-insensitive
    assert cardctl.parse_keyset_id("0059534CE0BFA19A") == bytes.fromhex("0059534ce0bfa19a")


def test_parse_keyset_id_does_not_claim_truncation_for_non_hex():
    """An 8-char value that is not hex was never half an id. Saying so sends the
    operator hunting for a truncation that never happened."""
    try:
        cardctl.parse_keyset_id("hellooo1")
    except SystemExit as exc:
        assert "not valid hex" in str(exc), str(exc)
    else:
        raise AssertionError("expected SystemExit for a non-hex keyset id")


def test_get_info_decodes_the_43_byte_answer():
    i = make_card([(INFO_43, 0x9000)]).get_info()
    assert i["version"] == "2.0" and i["version_tuple"] == (2, 0) and i["max_slots"] == 128
    assert i["unspent"] == 3 and i["spent"] == 1 and i["empty"] == 124
    assert i["secp256k1_native"] and i["schnorr"] and i["caps_raw"] == 0xFF
    assert i["pin_state"] == "set" and i["format"] == 4 and i["tries"] == 3
    assert i["locked"] is False and i["record_set"] is True and i["has_owner"] is True
    assert i["daily_limit"] == 5000
    assert i["now"] == 1791814824 and i["window_start"] == 1791800000 and i["spent_today"] == 100
    assert i["change_owed"] is False
    assert i["payment_limit"] == 0 and i["allowance"] == 250 and i["nopin_spent"] == 50
    assert i["tag_off"] is False
    # the three PIN states (byte 7), and a blocked one is "blocked", never "none"
    for state, name in ((0, "none"), (1, "set"), (2, "blocked")):
        body = bytearray(INFO_43)
        body[7] = state
        assert make_card([(bytes(body), 0x9000)]).get_info()["pin_state"] == name
    # thirty bytes (a reader that asked P1 = 0) decodes without the long fields
    short = make_card([(INFO_43[:30], 0x9000)]).get_info()
    assert "allowance" not in short and short["daily_limit"] == 5000


def test_get_card_decodes_the_rollover_bytes():
    c = make_card([(CARD_ANSWER, 0x9000)]).get_card()
    assert c["format"] == 4 and c["record_set"] is True and c["daily_limit"] == 5000
    assert c["rolls"] == 2 and c["budget_raw"] == 0 and c["budget"] == 7, "0 is the default, 7"
    assert c["armed"] is True
    assert c["mint"] == "https://forge.flashapp.me"
    assert c["last_header"] == bytes(range(32)).hex()
    body = bytearray(CARD_ANSWER)
    body[77] = 30
    assert make_card([(bytes(body), 0x9000)]).get_card()["budget"] == 30


def test_cmd_info_says_the_owner_the_clock_and_the_rollover_budget():
    card = make_card([(INFO_43, 0x9000), (CARD_ANSWER, 0x9000), (bytes(4), 0x9000)])
    args = cardctl.build_parser().parse_args(["info"])
    with stubbed_connect(card) as out:
        assert args.func(args) == 0
    text = out.getvalue()
    assert "applet version   : 2.0 (format 4)" in text, text
    assert "owner            : yes" in text, text
    assert "1791814824" in text, text
    assert "rollover budget  : 2 of 7 rolls" in text, text
    assert "allowance armed" in text, text
    assert "no-PIN allowance : 250" in text, text


# ── AUTH ─────────────────────────────────────────────────────────────────────
def test_auth_encoding_and_the_message_it_signs():
    reader = bytes(range(16))
    card = make_card([(bytes(16) + bytes(64), 0x9000)])
    card_nonce, sig = card.auth(reader)
    assert card.connection.last == bytes.fromhex("B0150000") + bytes([16]) + reader + bytes([0x50])
    assert card_nonce == bytes(16) and sig == bytes(64)
    # SHA-256(T || T || reader || card || key), T = SHA-256("CashuCard/auth"): the vector the applet's suite wrote
    import json, pathlib
    vec = json.loads((pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "secret.json").read_text())
    a = vec["auth"]
    assert a["tag"] == cardctl.AUTH_TAG == "CashuCard/auth"
    msg = cardctl.auth_message(bytes.fromhex(a["readerNonce"]), bytes.fromhex(a["cardNonce"]), bytes.fromhex(vec["cardKey"]))
    assert msg.hex() == a["message"], msg.hex()
    assert cardctl.check_signature(bytes.fromhex(vec["cardKey"]), msg, bytes.fromhex(a["signature"]))


def test_auth_refuses_a_short_reader_nonce_before_sending():
    card = make_card()
    try:
        card.auth(bytes(15))
    except SystemExit:
        pass
    else:
        raise AssertionError("AUTH sent 15 bytes")
    assert card.connection.sent == []


# ── write commands ───────────────────────────────────────────────────────────
def test_load_proof_builds_an_81_byte_payload_with_the_date():
    card = make_card([(b"\x07", 0x9000)])
    keyset = bytes.fromhex("0059534ce0bfa19a")
    slot = card.load_proof(keyset, 4096, bytes(range(32)), b"\x02" + bytes(range(32)), 1900000000)
    assert slot == 7
    sent = card.connection.last
    assert sent[:4] == bytes.fromhex("B0300000"), "P2 00: no word on the date's keys unless the caller gives it"
    assert sent[4] == 0x51, f"Lc should be 81, got {sent[4]}"
    payload = sent[5:5 + 81]
    assert payload[:8] == keyset
    assert int.from_bytes(payload[8:12], "big") == 4096
    assert payload[12:44] == bytes(range(32))
    assert payload[44:77] == b"\x02" + bytes(range(32))
    assert int.from_bytes(payload[77:81], "big") == 1900000000
    assert sent[-1] == 0x01  # Le


def test_load_proof_on_a_0x_card_builds_77_bytes_and_takes_no_date():
    card = make_card([(b"\x00\x06", 0x9000), (b"\x02", 0x9000)])
    card.select(legacy=True)
    card.load_proof(bytes.fromhex("0059534ce0bfa19a"), 8, bytes(32), b"\x02" + bytes(32))
    assert card.connection.last[4] == 0x4D
    try:
        card.load_proof(bytes.fromhex("0059534ce0bfa19a"), 8, bytes(32), b"\x02" + bytes(32), 5)
    except SystemExit:
        pass
    else:
        raise AssertionError("a date was sent to a 0.x card")


def test_load_proof_round_trips_the_keyset_id_through_get_proof():
    """What load writes must be what get_proof reads back — the seam that
    decides whether a proof can be matched to a keyset at the mint."""
    keyset_hex = "008288762774ace1"
    keyset = cardctl.parse_keyset_id(keyset_hex)
    card = make_card([(b"\x00", 0x9000)])
    card.load_proof(keyset, 8, bytes(32), b"\x02" + bytes(32))
    written = card.connection.last[5:5 + 8]

    body = b"\x01" + written + (8).to_bytes(4, "big") + bytes(32) + b"\x02" + bytes(32) + bytes(4)
    read_back = make_card([(body, 0x9000)]).get_proof(0)
    assert read_back["keyset_id"] == keyset_hex, read_back["keyset_id"]


def test_clear_spent_encoding():
    card = make_card([(b"\x04", 0x9000)])
    assert card.clear_spent() == 4
    assert card.connection.last == bytes.fromhex("B0310000" + "01")


def test_set_header_encoding_answers_the_clock():
    header = bytes(range(80))
    card = make_card([((1791814824).to_bytes(4, "big"), 0x9000)])
    assert card.set_header(header) == 1791814824
    assert card.connection.last == bytes.fromhex("B0360000") + bytes([80]) + header + bytes([4])


def test_set_card_record_layout():
    card = make_card()
    card.set_card("https://forge.flashapp.me", bytes([2]) + bytes(32))
    sent = card.connection.last
    assert sent[:4] == bytes.fromhex("B0320000")
    data = sent[5:]
    m = b"https://forge.flashapp.me"
    assert data == bytes([0]) + bytes([2]) + bytes(32) + bytes(65) + bytes([len(m)]) + m, data.hex()


# ── the owner's proof ────────────────────────────────────────────────────────
OWNER = p256.TEST_OWNER_PRIVATE
NONCE = bytes(range(100, 116))


def _owner_card():
    """A card whose first answer is GET_NONCE's sixteen bytes, then 9000s."""
    return make_card([(NONCE, 0x9000)])


def _check_owner_command(card, ins, label, value, p2=0):
    """The last two APDUs are GET_NONCE, then the command with a proof over label || nonce || value."""
    assert card.connection.sent[-2] == bytes.fromhex("B0440000") + bytes([0x10]), card.connection.sent[-2].hex()
    sent = card.connection.sent[-1]
    assert sent[:4] == bytes([0xB0, ins, 0, p2]), sent[:4].hex()
    data = sent[5:5 + sent[4]]
    n = data[0]
    proof, rest = data[1:1 + n], data[1 + n:]
    assert rest == value, (rest.hex(), value.hex())
    assert p256.verify(p256.public_key(OWNER), label.encode() + NONCE + value, proof), label
    return sent


def test_change_pin_is_the_owners_proof_over_the_new_pin_and_no_old_pin():
    card = _owner_card()
    card.change_pin(OWNER, b"567890")
    _check_owner_command(card, 0x42, "CashuCard/change-pin", b"567890")


def test_set_limit_forms_4_8_12_and_13_bytes():
    for kwargs, value in (
        ({}, (5000).to_bytes(4, "big")),
        ({"payment": 1000}, (5000).to_bytes(4, "big") + (1000).to_bytes(4, "big")),
        ({"payment": 0, "allowance": 250}, (5000).to_bytes(4, "big") + bytes(4) + (250).to_bytes(4, "big")),
        ({"payment": 0, "allowance": 250, "budget": 7}, (5000).to_bytes(4, "big") + bytes(4) + (250).to_bytes(4, "big") + b"\x07"),
    ):
        card = _owner_card()
        card.set_limit(OWNER, 5000, **kwargs)
        _check_owner_command(card, 0x34, "CashuCard/set-limit", value)


def test_set_limit_refuses_a_form_that_would_zero_what_it_was_not_given():
    for kwargs in ({"budget": 7}, {"allowance": 5}, {"payment": 0, "budget": 7},
                   {"payment": 0, "allowance": 0, "budget": 0}, {"payment": 0, "allowance": 0, "budget": 31}):
        card = make_card()
        try:
            card.set_limit(OWNER, 5000, **kwargs)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"set_limit accepted {kwargs}")
        assert card.connection.sent == [], f"{kwargs} reached the card"


def test_set_owner_with_and_without_the_anchor_and_the_old_owners_proof():
    pub = p256.public_key(OWNER)
    header = bytes(range(80))
    card = make_card()
    card.set_owner(pub)
    assert card.connection.last == bytes.fromhex("B0430000") + bytes([65]) + pub
    card = make_card()
    card.set_owner(pub, header)
    assert card.connection.last == bytes.fromhex("B0430000") + bytes([145]) + pub + header
    card = _owner_card()
    card.set_owner(pub, header, old_owner=OWNER)
    _check_owner_command(card, 0x43, "CashuCard/set-owner", pub + header)
    for bad in ((pub[:64], None), (pub, header[:79])):
        card = make_card()
        try:
            card.set_owner(*bad)
        except SystemExit:
            pass
        else:
            raise AssertionError("a bad key or anchor was sent")


def test_a_claim_is_sent_again_while_the_card_says_keep_holding():
    """3.0 (D187): SET_OWNER on a card with no owner answers 6A98 to the first five askings; the claim is sent until it stops."""
    with contextlib.redirect_stderr(io.StringIO()):  # the hold note
        pub = p256.public_key(OWNER)
        card = make_card([(b"", 0x6A98)] * 5 + [(b"", 0x9000)])
        card.set_owner(pub)
        assert card.connection.sent == [bytes.fromhex("B0430000") + bytes([65]) + pub] * 6, "the same data, six times"
        card = make_card([(b"", 0x6A98)] * 2 + [(b"", 0x6985)])
        try:
            card.set_owner(pub)
        except cardctl.CardError as exc:
            assert exc.sw == 0x6985
        else:
            raise AssertionError("a refusal after the askings was not raised")
        card = make_card([(b"", 0x6A98)] * 20)
        try:
            card.set_owner(pub)
        except cardctl.CardError as exc:
            assert exc.sw == 0x6A98 and len(card.connection.sent) == 10, "no more askings than a held tap's most"
        else:
            raise AssertionError("a card that never stops holding was asked for ever")


def test_refresh_is_the_owners_proof_over_the_header_and_answers_the_clock():
    header = bytes(range(80))
    card = make_card([(NONCE, 0x9000), ((1791814824).to_bytes(4, "big"), 0x9000)])
    assert card.refresh(OWNER, header) == 1791814824
    sent = _check_owner_command(card, 0x53, "CashuCard/refresh", header)
    assert sent[-1] == 0x04, "Le 4: the clock"


def test_allow_load_and_lock_are_proofs_over_nothing():
    card = _owner_card()
    card.allow_load(OWNER)
    _check_owner_command(card, 0x45, "CashuCard/load", b"")
    card = _owner_card()
    card.lock_card(OWNER)
    _check_owner_command(card, 0x50, "CashuCard/lock", b"", p2=0xDE)


def test_verify_pin_and_set_pin_encodings():
    card = make_card()
    card.verify_pin(b"1234")
    assert card.connection.last == bytes.fromhex("B0400000") + bytes([4]) + b"1234"
    card.set_pin(b"12345678")
    assert card.connection.last == bytes.fromhex("B0410000") + bytes([8]) + b"12345678"
    for bad in (b"123", b"123456789"):
        try:
            make_card().set_pin(bad)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"a PIN of {len(bad)} bytes was sent")


def test_the_owner_key_defaults_to_the_test_key_with_a_warning():
    class Args:
        owner_key = None
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        assert cardctl.owner_key(Args) == p256.TEST_OWNER_PRIVATE
    assert "TEST owner key" in err.getvalue(), err.getvalue()
    Args.owner_key = "11" * 32
    assert cardctl.owner_key(Args) == int("11" * 32, 16)
    for bad in ("11" * 31, "00" * 32, "ff" * 32):
        Args.owner_key = bad
        try:
            cardctl.owner_key(Args)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"--owner-key {bad} accepted")


# ── CLI wiring ───────────────────────────────────────────────────────────────
# The bug this file exists to prevent lived in cmd_load, not in the helpers it
# calls. Testing parse_keyset_id and Card.load_proof in isolation leaves the one
# line that carried the defect uncovered: a rename of --nonce, or a restored
# `args.keyset.encode()`, keeps every other test green while every loaded proof
# goes back to being unspendable. These drive the real parser into the real
# command, with only the PC/SC connection faked.

@contextlib.contextmanager
def stubbed_connect(card):
    """Point cardctl.connect at a FakeConnection-backed Card.

    Captures the command's own stdout — so the standalone runner's PASS/FAIL
    lines stay readable — and yields the buffer, so a test that cares what the
    command printed can assert on it.
    """
    real = cardctl.connect
    cardctl.connect = lambda args: card
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            yield buf
    finally:
        cardctl.connect = real


def test_cmd_load_puts_the_raw_16_char_keyset_id_on_the_wire():
    card = make_card([(b"\x03", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16"]
    )
    with stubbed_connect(card):
        assert args.func(args) == 0
    sent = card.connection.last
    assert sent[:4] == bytes.fromhex("B0300000"), "P2 00 without --date-keys"
    assert sent[5:13] == bytes.fromhex("0059534ce0bfa19a"), sent[5:13].hex()
    assert int.from_bytes(sent[13:17], "big") == 16, sent[13:17].hex()
    assert sent[4] == 81 and sent[5 + 77:5 + 81] == bytes(4), "a date of 0 by default"


def test_cmd_load_with_the_owners_grant_sends_allow_load_first_and_no_pin():
    card = make_card([(NONCE, 0x9000), (b"", 0x9000), (b"\x03", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--owner", "--date", "1900000000"]
    )
    err = io.StringIO()
    with stubbed_connect(card), contextlib.redirect_stderr(err):
        assert args.func(args) == 0
    ins = [apdu[1] for apdu in card.connection.sent]
    assert ins == [cardctl.INS_GET_NONCE, cardctl.INS_ALLOW_LOAD, cardctl.INS_LOAD_PROOF], ins
    assert int.from_bytes(card.connection.last[5 + 77:5 + 81], "big") == 1900000000


def test_cmd_load_accepts_an_on_curve_explicit_c_and_keeps_the_placeholder():
    """The curve check on --c must not break either legitimate path."""
    on_curve = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
    card = make_card([(b"\x03", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16",
         "--c", on_curve]
    )
    with stubbed_connect(card):
        assert args.func(args) == 0
    assert card.connection.last[5 + 44:5 + 77] == bytes.fromhex(on_curve), \
        card.connection.last.hex()

    card = make_card([(b"\x03", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16"]
    )
    with stubbed_connect(card):
        assert args.func(args) == 0, "placeholder default must still load"


def test_cmd_load_rejects_a_half_length_keyset_id():
    card = make_card([(b"\x03", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534c", "--amount", "16"]
    )
    with stubbed_connect(card):
        try:
            args.func(args)
        except SystemExit as exc:
            assert "16" in str(exc), str(exc)
        else:
            raise AssertionError("cmd_load accepted a half-length keyset id")
    assert card.connection.sent == [], "nothing should reach the card"


def test_cmd_load_validates_arguments_before_opening_the_reader():
    """A bad --keyset must cost nothing — not even a PIN attempt.

    VERIFY_PIN decrements the card's retry counter and locks the card after a
    few misses. If cmd_load connects and verifies before parsing, then
    `load --keyset 0059534c --pin 4321` burns a retry on a command that could
    never have succeeded. The previous test only proves this by accident: it
    passes no --pin, so the VERIFY_PIN branch is never reached regardless of
    ordering. This one passes one, and also asserts the reader was never opened
    — the transmit log alone cannot distinguish "did not connect" from
    "connected and sent nothing".
    """
    bad = [
        # a half-length keyset id, and a nonce that is 31 bytes instead of 32
        ["--keyset", "0059534c", "--amount", "16", "--pin", "4321"],
        ["--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "4321",
         "--nonce", "00" * 31],
        # ...and a C that is 32 bytes instead of the compressed-point 33
        ["--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "4321",
         "--c", "00" * 32],
        # ...and a 33-byte C with a bad prefix, and one whose x is not on the
        # curve. The file path (`_slot_from_json`) refuses both; an explicit
        # --c must be held to the same rule, or a typo burns a slot on money
        # nothing can spend and `dump` then refuses the whole card.
        ["--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "4321",
         "--c", "05" + "cd" * 32],
        ["--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "4321",
         "--c", "02" + "cd" * 32],
        # ...and the three amounts the card's 4-byte field or a mint keyset
        # cannot represent. These used to reach the card: 2**32 died on a bare
        # OverflowError out of load_proof, and 0 burned a slot on a worthless
        # proof, both after VERIFY_PIN had already spent a retry.
        ["--keyset", "0059534ce0bfa19a", "--amount", "4294967296", "--pin", "4321"],
        ["--keyset", "0059534ce0bfa19a", "--amount", "0", "--pin", "4321"],
        ["--keyset", "0059534ce0bfa19a", "--amount", "5", "--pin", "4321"],
    ]
    for flags in bad:
        card = make_card([(b"\x03", 0x9000)])
        args = cardctl.build_parser().parse_args(["load", *flags])
        connects = []
        real = cardctl.connect
        cardctl.connect = lambda a: (connects.append(a), card)[1]
        try:
            try:
                args.func(args)
            except SystemExit:
                pass
            else:
                raise AssertionError(f"cmd_load accepted bad arguments: {flags}")
        finally:
            cardctl.connect = real
        assert connects == [], f"cmd_load opened the reader before validating: {flags}"
        assert card.connection.sent == [], \
            f"cmd_load transmitted before validating {flags}: " \
            f"{[a.hex() for a in card.connection.sent]}"


def test_cmd_load_reads_the_nonce_flag_it_declares():
    """cmd_load reads args.nonce; build_parser must declare --nonce."""
    nonce = bytes(range(32))
    card = make_card([(b"\x00", 0x9000)])
    args = cardctl.build_parser().parse_args(
        ["load", "--keyset", "0059534ce0bfa19a", "--amount", "1", "--nonce", nonce.hex()]
    )
    with stubbed_connect(card):
        assert args.func(args) == 0
    assert card.connection.last[17:49] == nonce, card.connection.last[17:49].hex()


def test_cmd_load_generates_a_fresh_nonce_per_proof():
    """A constant nonce makes every rebuilt P2PK secret identical: the card
    refuses the second (6A94), and the mint would see one secret twice."""
    seen = []
    for _ in range(2):
        card = make_card([(b"\x00", 0x9000)])
        args = cardctl.build_parser().parse_args(
            ["load", "--keyset", "0059534ce0bfa19a", "--amount", "1"]
        )
        with stubbed_connect(card):
            assert args.func(args) == 0
        seen.append(card.connection.last[17:49])
    assert seen[0] != seen[1], f"nonce is not fresh per proof: {seen[0].hex()}"
    assert seen[0] != bytes(32), "nonce is all zeros"


def test_load_parser_no_longer_accepts_keyset_hex():
    """--keyset-hex selected the ASCII path this PR deleted. It must stay gone,
    or a stale runbook silently re-enables half-id encoding.

    A bare `except SystemExit: pass` would not prove that: argparse exits 2 for
    any parser failure, so renaming --keyset would keep this green while saying
    nothing about --keyset-hex. Assert on the message argparse actually wrote.
    """
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        try:
            cardctl.build_parser().parse_args(
                ["load", "--keyset", "0059534ce0bfa19a", "--amount", "1", "--keyset-hex"]
            )
        except SystemExit:
            pass
        else:
            raise AssertionError("--keyset-hex is still accepted")
    assert "unrecognized arguments: --keyset-hex" in buf.getvalue(), buf.getvalue()


def test_cmd_proof_prints_the_full_keyset_id_the_nonce_and_the_date():
    nonce = bytes(range(32, 64))
    body = (
        b"\x01"
        + bytes.fromhex("0059534ce0bfa19a")
        + (4242).to_bytes(4, "big")
        + nonce
        + b"\x02" + bytes(range(32))
        + (1900000000).to_bytes(4, "big")
    )
    assert len(body) == 82
    card = make_card([(body, 0x9000)])
    args = cardctl.build_parser().parse_args(["proof", "0"])
    with stubbed_connect(card) as out:
        assert args.func(args) == 0
    printed = out.getvalue()
    assert "0059534ce0bfa19a" in printed, printed
    assert nonce.hex() in printed.lower(), printed
    assert "4242" in printed, printed
    assert "1900000000" in printed, printed


def test_the_0x_commands_are_gone_from_the_parser():
    """SPEND_PROOF, SIGN_ARBITRARY, CLEAR_PIN, SET_PUK and UNBLOCK_PIN are not in
    2.0 (D18). Their subcommands must not come back: each would send a 2.0 card
    an opcode that now means something else (0x43 is SET_OWNER, 0x44 GET_NONCE,
    0x45 ALLOW_LOAD)."""
    for gone in ("spend", "sign", "clear-pin", "set-puk", "unblock-pin"):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            try:
                cardctl.build_parser().parse_args([gone])
            except SystemExit:
                pass
            else:
                raise AssertionError(f"`{gone}` still parses")
        assert "invalid choice" in err.getvalue(), err.getvalue()
    for name in ("INS_SPEND_PROOF", "INS_SIGN_ARBITRARY", "INS_CLEAR_PIN", "INS_SET_PUK", "INS_UNBLOCK_PIN"):
        assert not hasattr(cardctl, name), name


# ── selftest against a model of the 2.0 applet ───────────────────────────────
# selftest decides its next APDU from the last answer, so a list of canned
# responses cannot drive it. These tests run the real command against a small
# model of the applet: GET_INFO's PIN state, VERIFY_PIN's counter, and AUTH,
# which signs for real (BIP-340) over the tagged message.

_CARD_SECKEY = 0x1F0E2D3C4B5A69788796A5B4C3D2E1F00112233445566778899AABBCCDDEEFF0


def _bip340_sign(seckey: int, msg: bytes) -> bytes:
    """BIP-340 signing with fresh aux randomness, standing in for the card."""
    n = bip340.N
    pub = bip340._point_mul(bip340.G, seckey)
    d = seckey if pub[1] % 2 == 0 else n - seckey
    px = pub[0].to_bytes(32, "big")
    aux = bip340.tagged_hash("BIP0340/aux", secrets.token_bytes(32))
    t = (d ^ int.from_bytes(aux, "big")).to_bytes(32, "big")
    k0 = int.from_bytes(bip340.tagged_hash("BIP0340/nonce", t + px + msg), "big") % n
    r = bip340._point_mul(bip340.G, k0)
    k = k0 if r[1] % 2 == 0 else n - k0
    rx = r[0].to_bytes(32, "big")
    e = int.from_bytes(bip340.tagged_hash("BIP0340/challenge", rx + px + msg), "big") % n
    return rx + ((k + e * d) % n).to_bytes(32, "big")


class FakeApplet:
    """A PC/SC connection answering like the 2.1 applet, as far as selftest goes."""

    def __init__(self, version=(2, 1), pin_state=1, pin=b"1234", has_owner=True, fixed_aux=False):
        self.version = bytes(version)
        self.pin_state = pin_state
        self.pin = pin
        self.tries = 3 if pin_state == 1 else 0
        self.has_owner = has_owner
        self.fixed_aux = fixed_aux
        self.info_59 = INFO_59  # the answer to GET_INFO P1 = 4
        self.info_43 = INFO_43  # and to P1 = 2
        self.sent = []
        pub = bip340._point_mul(bip340.G, _CARD_SECKEY)
        self.pubkey = bytes([2 | (pub[1] & 1)]) + pub[0].to_bytes(32, "big")

    def connect(self):
        pass

    @property
    def ins_sent(self):
        """INS of every APDU after SELECT, in order."""
        return [apdu[1] for apdu in self.sent if apdu[:2] != b"\x00\xA4"]

    def transmit(self, apdu):
        apdu = bytes(apdu)
        self.sent.append(apdu)
        body, sw = self._answer(apdu)
        return list(body), sw >> 8, sw & 0xFF

    def _answer(self, apdu):
        if apdu[:2] == b"\x00\xA4":
            return self.version, 0x9000
        ins = apdu[1]
        if ins == cardctl.INS_GET_INFO:
            body = bytearray(self.info_59 if apdu[2] == 4 else self.info_43)
            body[0:2] = self.version
            body[7] = self.pin_state
            body[9] = self.tries
            body[16] = 1 if self.has_owner else 0
            return bytes(body), 0x9000
        if ins == cardctl.INS_GET_PUBKEY:
            return self.pubkey, 0x9000
        if ins == cardctl.INS_GET_BALANCE:
            return (21).to_bytes(4, "big"), 0x9000
        if ins == cardctl.INS_GET_SLOT_STATUS:
            return bytes(128), 0x9000
        if ins == cardctl.INS_GET_CARD:
            return CARD_ANSWER, 0x9000
        if ins == cardctl.INS_VERIFY_PIN:
            if self.pin_state == 0:
                return b"", 0x6984
            if self.pin_state == 2 or self.tries == 0:
                return b"", 0x6983
            if apdu[5:5 + apdu[4]] == self.pin:
                self.tries = 3
                return b"", 0x9000
            self.tries -= 1
            if self.tries == 0:
                self.pin_state = 2
                return b"", 0x6983
            return b"", 0x63C0 | self.tries
        if ins == cardctl.INS_AUTH:
            reader = apdu[5:5 + 16]
            card = bytes(16) if self.fixed_aux else secrets.token_bytes(16)
            msg = cardctl.auth_message(reader, card, self.pubkey)
            sig = _bip340_sign(_CARD_SECKEY, msg) if not self.fixed_aux else _bip340_sign_fixed(_CARD_SECKEY, msg)
            return card + sig, 0x9000
        return b"", 0x6D00


def _bip340_sign_fixed(seckey: int, msg: bytes) -> bytes:
    """BIP-340 with a constant aux and a constant card nonce: what a card with broken randomness would give."""
    n = bip340.N
    pub = bip340._point_mul(bip340.G, seckey)
    d = seckey if pub[1] % 2 == 0 else n - seckey
    px = pub[0].to_bytes(32, "big")
    t = (d ^ int.from_bytes(bip340.tagged_hash("BIP0340/aux", bytes(32)), "big")).to_bytes(32, "big")
    k0 = int.from_bytes(bip340.tagged_hash("BIP0340/nonce", t + px + msg), "big") % n
    r = bip340._point_mul(bip340.G, k0)
    k = k0 if r[1] % 2 == 0 else n - k0
    rx = r[0].to_bytes(32, "big")
    e = int.from_bytes(bip340.tagged_hash("BIP0340/challenge", rx + px + msg), "big") % n
    return rx + ((k + e * d) % n).to_bytes(32, "big")


def run_selftest(applet, *flags):
    """Run `cardctl selftest <flags>` against `applet`; (exit code, stdout)."""
    card = cardctl.Card.__new__(cardctl.Card)
    card.connection = applet
    card.verbose = False
    card.reader = "fake"
    args = cardctl.build_parser().parse_args(["selftest", *flags])
    real = cardctl.Card
    cardctl.Card = lambda *a, **kw: card
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            rc = args.func(args)
    finally:
        cardctl.Card = real
    return rc, buf.getvalue()


def test_selftest_passes_a_2_1_card_and_verifies_every_auth_signature():
    """Also proves the model signs for real, which the tests below rely on."""
    applet = FakeApplet(pin_state=1)
    rc, out = run_selftest(applet, "--pin", "1234")
    assert rc == 0, out
    assert "All 13 checks passed" in out, out
    ins = applet.ins_sent
    assert ins.count(cardctl.INS_AUTH) == 5, ins
    assert cardctl.INS_VERIFY_PIN in ins


def test_selftest_needs_no_pin_for_auth():
    applet = FakeApplet(pin_state=1)
    rc, out = run_selftest(applet)
    assert rc == 0, out
    assert cardctl.INS_VERIFY_PIN not in applet.ins_sent
    assert "pass --pin to check it" in out, out


def test_selftest_fails_a_blocked_pin_and_names_the_owners_change_pin():
    """GET_INFO byte 7 = 2 is a PIN that exists and cannot verify. selftest must
    not send VERIFY_PIN (it cannot succeed), must fail the card, and must say
    what unblocks it on 2.0: the owner's CHANGE_PIN. AUTH still runs."""
    applet = FakeApplet(pin_state=2)
    rc, out = run_selftest(applet, "--pin", "1234")
    assert rc == 1, out
    assert cardctl.INS_VERIFY_PIN not in applet.ins_sent, "VERIFY_PIN cannot succeed on a blocked card"
    assert "FAIL  PIN state" in out and "change-pin" in out and "CHANGE_PIN unblocks" in out, out
    assert "1 check(s) FAILED: PIN state" in out, out
    for ins in (cardctl.INS_GET_PUBKEY, cardctl.INS_GET_BALANCE, cardctl.INS_GET_SLOT_STATUS, cardctl.INS_AUTH):
        assert ins in applet.ins_sent, f"INS {ins:02X} was not sent"


def test_selftest_fails_a_card_of_a_version_it_does_not_know():
    for version in ((1, 20), (0, 6), (2, 0), (2, 3), (3, 1), (4, 0)):
        rc, out = run_selftest(FakeApplet(version=version, pin_state=0))
        assert rc == 1, (version, out)
        assert "FAIL  SELECT applet" in out, out


def test_selftest_fails_a_card_whose_signatures_repeat_their_nonce():
    rc, out = run_selftest(FakeApplet(pin_state=0, fixed_aux=True))
    assert rc == 1, out
    assert "FAIL  fresh nonce across identical requests" in out, out


def test_select_verdict_passes_only_2_1_2_2_and_3_0():
    assert cardctl._select_verdict(bytes([2, 1])) == (True, "version 2.1")
    assert cardctl._select_verdict(bytes([2, 2]))[0] is True
    assert cardctl._select_verdict(bytes([3, 0])) == (True, "version 3.0")
    # 2.0 is the v2.0.0 release, whose day a payment of nothing rolled (D26): swept and reinstalled
    for version in (bytes([2, 0]), bytes([1, 20]), bytes([0, 6])):
        ok, detail = cardctl._select_verdict(version)
        assert ok is False and "not protocol 2.1, 2.2 or 3.0" in detail and "reinstall the tracked CAP" in detail, detail
    # a later minor of a major this tool knows, or a later major, is a version it does not know: refused, not passed
    for version in (bytes([3, 1]), bytes([4, 0])):
        ok, detail = cardctl._select_verdict(version)
        assert ok is False and "a version this cardctl does not know" in detail, detail
    # a 2.x above 2.2 is no release: 02 03 is 3.0's wire before its renumbering (D205), said as such
    for version in (bytes([2, 3]), bytes([2, 4]), bytes([2, 0xFF])):
        ok, detail = cardctl._select_verdict(version)
        assert ok is False and "no released version" in detail and "02 03" in detail and "D205" in detail, detail
    ok, detail = cardctl._select_verdict(b"")
    assert ok is False and "no applet version" in detail, detail


# ── error handling ───────────────────────────────────────────────────────────
def test_status_words_are_translated():
    assert "already spent" in cardctl.describe_sw(0x6985)
    assert "slot is empty" in cardctl.describe_sw(0x6A88)
    assert "needs an update" in cardctl.describe_sw(0x6A82)
    assert "PIN blocked" in cardctl.describe_sw(0x6983) and "change-pin" in cardctl.describe_sw(0x6983)
    assert "2 retries remaining" in cardctl.describe_sw(0x63C2)
    assert "0 retries remaining" in cardctl.describe_sw(0x63C0)
    assert "LOCK_CARD" in cardctl.describe_sw(0x6986)
    assert "owner's grant" in cardctl.describe_sw(0x6982)
    assert "day's limit" in cardctl.describe_sw(0x6A8F)
    assert "no owner" in cardctl.describe_sw(0x6A90)
    assert "owner's proof" in cardctl.describe_sw(0x6A91)
    assert "work" in cardctl.describe_sw(0x6A93)
    assert "PIN needed" in cardctl.describe_sw(0x6A94)
    for sw in (0x6A8C, 0x6A8D, 0x6A8E, 0x6A96, 0x6B00, 0x6A86, 0x6A80):
        assert cardctl.describe_sw(sw) != "unknown status word", hex(sw)
    assert "PUK" not in " ".join(cardctl.SW_MEANINGS.values())


def test_non_9000_raises_carderror_with_context():
    card = make_card([(b"", 0x6A8F)])
    try:
        card.send(cardctl.INS_SPEND_ALL_SIGN, le=0x40, context="SPEND_ALL_SIGN")
    except cardctl.CardError as exc:
        assert exc.sw == 0x6A8F
        assert "SPEND_ALL_SIGN" in str(exc) and "day's limit" in str(exc)
    else:
        raise AssertionError("expected CardError")


# ── APDU timing (--timing) ───────────────────────────────────────────────────
def test_transmit_records_one_timing_row_per_apdu_named_by_context():
    cardctl.TIMINGS.clear()
    card = make_card([(b"\x02\x00", 0x9000), (INFO_43, 0x9000)])
    card.select()
    card.get_info()
    contexts = [ctx for ctx, _ in cardctl.TIMINGS]
    assert contexts == ["SELECT", "GET_INFO"], contexts
    assert all(ms >= 0.0 for _, ms in cardctl.TIMINGS)


def test_a_failed_apdu_is_still_timed():
    # The row lands before the status word is judged: a 6982 that took 700 ms
    # is exactly the kind of number a timing run exists to show.
    cardctl.TIMINGS.clear()
    card = make_card([(b"", 0x6982)])
    try:
        card.send(cardctl.INS_SPEND_ALL_SIGN, le=0x40, context="SPEND_ALL_SIGN")
    except cardctl.CardError:
        pass
    assert [ctx for ctx, _ in cardctl.TIMINGS] == ["SPEND_ALL_SIGN"]


def test_timing_flag_prints_each_apdu_only_when_enabled():
    cardctl.TIMINGS.clear()
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        make_card([(b"\x02\x00", 0x9000)]).select()
    assert "⏱" not in err.getvalue()

    cardctl.TIMING_ENABLED = True
    try:
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            make_card([(b"\x02\x00", 0x9000)]).select()
    finally:
        cardctl.TIMING_ENABLED = False
    assert "⏱ SELECT" in err.getvalue(), err.getvalue()
    assert err.getvalue().rstrip().endswith("ms")


def test_summarize_timings_groups_by_command_with_median_not_mean():
    rows = [("SELECT", 60.0),
            ("SPEND_ALL_SIGN", 700.0), ("SPEND_ALL_SIGN", 740.0), ("SPEND_ALL_SIGN", 3000.0)]
    text = cardctl.summarize_timings(rows)
    lines = text.splitlines()
    assert lines[0].split() == ["command", "n", "min", "median", "max", "total"]
    spend = next(l for l in lines if l.startswith("SPEND_ALL_SIGN")).split()
    # n=3, min 700, median 740 (a mean would say 1480), max 3000, total 4440
    assert spend[1:] == ["3", "700.0", "740.0", "3000.0", "4440.0"], spend
    assert lines[-1].startswith("4 APDU(s), 4500.0 ms")


def test_summarize_timings_with_no_rows_does_not_crash():
    assert cardctl.summarize_timings([]) == "no APDUs sent"


def test_timing_flag_is_global_and_off_by_default():
    parser = cardctl.build_parser()
    assert parser.parse_args(["info"]).timing is False
    assert parser.parse_args(["--timing", "selftest", "--rounds", "5"]).timing is True
    assert parser.parse_args(["-t", "auth"]).timing is True

# ── GET_OUTBOX (2.2, D175) ───────────────────────────────────────────────────
import pathlib  # noqa: E402

# A packet the cardsim outbox test verified with relay.js and recorded (tools/cardsim/outbox.test.cjs).
OUTBOX_FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "assisted-relay" / "fixtures" / "packet-2in2out-494.hex"


def _outbox_packet() -> bytes:
    return bytes.fromhex(OUTBOX_FIXTURE.read_text(encoding="ascii").strip())


def test_get_outbox_encodings():
    card = make_card([(bytes(45), 0x9000)])
    assert card.get_outbox_scope() == bytes(45)
    assert card.connection.last == bytes.fromhex("B01B000000")
    card = make_card([(b"\x01" * 7, 0x9000)])
    assert card.get_outbox_page(510, 49) == b"\x01" * 7
    assert card.connection.last == bytes.fromhex("B01B01000301FE3100")
    for bad in ((-1, 1), (0x10000, 1), (0, 0), (0, 256)):
        try:
            card.get_outbox_page(*bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad} was sent")


def test_get_outbox_reads_the_scope_the_pages_and_the_scope_again():
    packet = _outbox_packet()
    scope = bytes([7]) * 45
    card = make_card([(scope, 0x9000), (packet[:255], 0x9000), (packet[255:], 0x9000), (scope, 0x9000)])
    assert card.get_outbox() == (packet, scope)
    assert [a.hex().upper() for a in card.connection.sent] == ["B01B000000", "B01B0100030000FF00", "B01B01000300FFFF00", "B01B000000"]
    # a whole number of pages ends at 6A83
    whole = bytes(510)
    card = make_card([(scope, 0x9000), (whole[:255], 0x9000), (whole[255:], 0x9000), (b"", 0x6A83), (scope, 0x9000)])
    assert card.get_outbox() == (whole, scope)
    # a record that changed while it was read is refused
    card = make_card([(scope, 0x9000), (packet[:255], 0x9000), (packet[255:], 0x9000), (bytes(45), 0x9000)])
    try:
        card.get_outbox()
    except SystemExit as exc:
        assert "changed while it was read" in str(exc)
    else:
        raise AssertionError("a changed record was kept")
    # no record
    card = make_card([(b"", 0x6A88)])
    try:
        card.get_outbox()
    except cardctl.CardError as exc:
        assert exc.sw == 0x6A88
    else:
        raise AssertionError("6A88 was not raised")


def test_decode_outbox_verifies_the_recorded_packet():
    packet = _outbox_packet()
    p = cardctl.decode_outbox(packet)
    assert len(packet) == 494
    assert p["witness_valid"] and p["descriptor_valid"]
    assert p["mint"] == "https://mint.test" and p["payment_id"] == 1 and p["generation"] == 1 and p["index"] == 0
    assert [(i["slot"], i["amount"]) for i in p["inputs"]] == [(0, 8), (1, 4)]
    assert [o["amount"] for o in p["outputs"]] == [8, 4]
    assert all(o["keyset"] == p["inputs"][0]["keyset"] for o in p["outputs"]), "every output under the first input's keyset"
    assert p["scope"][13:] == __import__("hashlib").sha256(packet[:-64]).digest()
    # a byte of the body changed: the descriptor no longer verifies; a byte of an output: the witness neither
    torn = bytearray(packet)
    torn[90] ^= 1                                   # in the mint, which the payment's message does not cover
    q = cardctl.decode_outbox(bytes(torn))
    assert not q["descriptor_valid"] and q["witness_valid"]
    torn = bytearray(packet)
    torn[89 + 17 + 1 + 2 * 83 + 1 + 3] ^= 1         # the first output's amount, 8 to 9
    q = cardctl.decode_outbox(bytes(torn))
    assert q["outputs"][0]["amount"] == 9
    assert not q["descriptor_valid"] and not q["witness_valid"]
    for cut in (packet[:-1], packet + b"\x00", b"XCP-AS\x01" + packet[7:]):
        try:
            cardctl.decode_outbox(cut)
        except ValueError:
            continue
        raise AssertionError("a malformed packet was decoded")


def test_cmd_outbox_prints_valid_for_the_card_and_invalid_for_a_tampered_packet():
    packet = _outbox_packet()
    p = cardctl.decode_outbox(packet)
    card = make_card([(p["scope"], 0x9000), (packet[:255], 0x9000), (packet[255:], 0x9000), (p["scope"], 0x9000), (p["card_key"], 0x9000)])
    args = cardctl.build_parser().parse_args(["outbox"])
    with stubbed_connect(card) as out:
        assert args.func(args) == 0
    assert out.getvalue().rstrip().endswith("VALID") and "INVALID" not in out.getvalue()
    assert "https://mint.test" in out.getvalue()
    # a scope that is not the packet's
    card = make_card([(bytes(45), 0x9000), (packet[:255], 0x9000), (packet[255:], 0x9000), (bytes(45), 0x9000), (p["card_key"], 0x9000)])
    with stubbed_connect(card) as out:
        assert args.func(args) == 1
    assert out.getvalue().rstrip().endswith("INVALID")
    # a saved packet, tampered
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".hex", delete=False) as f:
        torn = bytearray(packet)
        torn[-1] ^= 1
        f.write(bytes(torn).hex())
    args = cardctl.build_parser().parse_args(["outbox", "--file", f.name])
    with stubbed_connect(None) as out:
        assert args.func(args) == 1
    assert "DOES NOT VERIFY" in out.getvalue() and out.getvalue().rstrip().endswith("INVALID")
    pathlib.Path(f.name).unlink()


# ── protocol 3.0: keys per load, the sealed c, the held PIN ───────────────────
# Independent secp256k1 for the vectors below: affine, most significant bit first, inverses by pow(x, -1, p). It shares
# no code with bip340.py, which cardctl uses, so a vector computed here checks cardctl's arithmetic, not repeats it.
_SP = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
_SN = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_SG = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
       0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _sadd(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % _SP == 0:
        return None
    if a == b:
        m = 3 * a[0] * a[0] * pow(2 * a[1], -1, _SP) % _SP
    else:
        m = (b[1] - a[1]) * pow(b[0] - a[0], -1, _SP) % _SP
    x = (m * m - a[0] - b[0]) % _SP
    return (x, (m * (a[0] - x) - a[1]) % _SP)


def _smul(k, pt=_SG):
    out = None
    for bit in bin(k % _SN)[2:]:
        out = _sadd(out, out)
        if bit == "1":
            out = _sadd(out, pt)
    return out


def _sec33(pt):
    return bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, "big")


def _sec65(pt):
    return b"\x04" + pt[0].to_bytes(32, "big") + pt[1].to_bytes(32, "big")


def _from65(b):
    return (int.from_bytes(b[1:33], "big"), int.from_bytes(b[33:65], "big"))


def _sha(*parts):
    import hashlib
    return hashlib.sha256(b"".join(parts)).digest()


def _seal(shared, in_e_place, nonce):
    """Block 1 of the seal over GET_CARD (16), as the card hashes it."""
    return _sha(b"CashuCard/seal", b"\x01", shared[0].to_bytes(32, "big"), in_e_place, nonce, b"\x16")


def _xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


_C = bytes.fromhex("c0ffee" * 10 + "01ab")             # the card's secret c, 32 bytes
_REFUND_R = 0x5EC12E7A11CE0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123
_PIN_SECKEY = 0x0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE0BADC0DE
_SEAL_NONCE = bytes(range(0xA0, 0xB0))


def _group_keys_answer(c, card_key, refund_key, date):
    """GROUP_KEYS's 98 bytes, worked out with the arithmetic above."""
    d = date.to_bytes(4, "big")
    t = int.from_bytes(_sha(b"CashuCard/key", c, d), "big") % _SN
    key = _sec33(_sadd(card_key, _smul(t)))
    refund = bytes(33)
    if refund_key is not None and date:
        u = int.from_bytes(_sha(b"CashuCard/refund-key", c, d), "big") % _SN
        refund = _sec33(_sadd(refund_key, _smul(u)))
    return t.to_bytes(32, "big") + key + refund


class Card23(FakeConnection):
    """
    A 3.0 card as far as card-secret, group-keys and the PIN go: SELECT 03 00, GET_INFO, GET_CARD P1 0 with or without
    a refund key, VERIFY_PIN and SET_PIN, ALLOW_LOAD (6200), GET_PUBKEY, GET_NONCE P1 1, GET_CARD P1 3 in both forms and
    GROUP_KEYS, each gated as the applet gates it. Its answers are worked out with the independent arithmetic above.
    """

    def __init__(self, has_owner=False, refund=True, pin_state=1, pin=b"1234"):
        super().__init__()
        self.has_owner = has_owner
        self.refund = _smul(_REFUND_R) if refund else None
        self.pin_state = pin_state
        self.pin = pin
        self.verified = self.grant = self.first = self.nonce_live = False
        self.card_pt = _smul(_CARD_SECKEY)
        self.pin_pt = _smul(_PIN_SECKEY)
        self.k = 0x7777777777777777777777777777777777777777777777777777777777777777

    def transmit(self, apdu):
        apdu = bytes(apdu)
        self.sent.append(apdu)
        body, sw = self._answer(apdu)
        return list(body), sw >> 8, sw & 0xFF

    def _answer(self, apdu):
        ins, p1 = apdu[1], apdu[2]
        data = apdu[5:5 + apdu[4]] if len(apdu) > 5 else b""
        if apdu[:2] == b"\x00\xA4":
            self.verified = self.grant = self.first = self.nonce_live = False
            return getattr(self, "version_answer", b"\x03\x00"), 0x9000
        if ins == cardctl.INS_GET_INFO:
            info = bytearray(INFO_59 if p1 == 4 else INFO_43[:43 if p1 == 2 else 30])
            info[0:2] = getattr(self, "version_answer", b"\x03\x00")
            info[7] = self.pin_state
            info[16] = int(self.has_owner)
            return bytes(info), 0x9000
        if ins == cardctl.INS_GET_CARD and p1 == 0:
            refund = _sec33(self.refund) if self.refund else bytes(33)
            return CARD_ANSWER[:7] + refund + CARD_ANSWER[40:], 0x9000
        if ins == cardctl.INS_GET_PUBKEY:
            return _sec33(self.card_pt), 0x9000
        if ins == cardctl.INS_GET_BALANCE:
            return bytes(4), 0x9000
        if ins == cardctl.INS_SET_PIN:
            if self.has_owner:
                return b"", 0x6A91
            if self.pin_state != 0:
                return b"", 0x6982
            self.pin, self.pin_state, self.first = data, 1, True
            return b"", 0x9000
        if ins == cardctl.INS_VERIFY_PIN:
            if data != self.pin:
                return b"", 0x63C2
            self.verified = True
            return b"", 0x9000
        if ins == cardctl.INS_GET_NONCE and p1 == 0:
            self.owner_nonce = NONCE
            return NONCE, 0x9000
        if ins == cardctl.INS_ALLOW_LOAD:
            n = data[0]
            if not p256.verify(getattr(self, "owner_pub", p256.public_key(OWNER)), b"CashuCard/load" + NONCE + data[1 + n:], data[1:1 + n]):
                return b"", 0x6A91
            self.grant = True
            return b"", 0x6200
        if ins == cardctl.INS_GET_NONCE and p1 == 1:
            self.nonce_live = True
            pin_key = _sec33(self.pin_pt)
            sig = _bip340_sign(_CARD_SECKEY, _sha(b"CashuCard/pinkey", pin_key))
            return _SEAL_NONCE + pin_key + sig, 0x9000
        if ins == cardctl.INS_GET_CARD and p1 == 3:
            told = self.grant if self.has_owner else self.verified and (self.refund is not None or self.first)
            if not told:
                return b"", 0x6982
            if self.refund is None and len(data) != 65:
                return b"", 0x6700
            if not self.nonce_live:
                return b"", 0x6985
            self.nonce_live = False
            if self.refund is not None:
                big_k = _sec65(_smul(self.k))
                return big_k + _xor(_C, _seal(_smul(self.k, self.refund), big_k, _SEAL_NONCE)), 0x9000
            e = _from65(data)
            if (e[1] * e[1] - e[0] ** 3 - 7) % _SP:
                return b"", 0x6A80
            return _xor(_C, _seal(_smul(_PIN_SECKEY, e), data, _SEAL_NONCE)), 0x9000
        if ins == cardctl.INS_GROUP_KEYS:
            if not (self.verified or self.grant):
                return b"", 0x6982
            if len(data) != 4:
                return b"", 0x6700
            return _group_keys_answer(getattr(self, "c", _C), self.card_pt, self.refund, int.from_bytes(data, "big")), 0x9000
        return b"", 0x6D00

    def stage(self, data):
        """SET_OWNER P1 01 (D202): the envelope opened with the PIN key's private half, as the applet opens it; s kept
        for the claim or the hand-over that comes next."""
        if len(data) != 113:
            return b"", 0x6700
        e_pub, ct, tag = data[:65], data[65:97], data[97:113]
        x = _smul(_PIN_SECKEY, _from65(e_pub))[0].to_bytes(32, "big")
        if _sha(b"CashuCard/c", b"\x00", x, e_pub, ct)[:16] != tag:
            return b"", 0x6A80
        self.staged = _xor(ct, _sha(b"CashuCard/c", b"\x01", x, e_pub))
        return b"", 0x9000

    def take_c(self, value):
        """The check at the end of a claim's or hand-over's value (D202): the kept s's, then c for the next n; 6985 with
        nothing kept, 6A80 for another check. None where the value carries no check (65 or 145 bytes)."""
        if len(value) not in (81, 161):
            return None
        s = getattr(self, "staged", None)
        if s is None:
            return 0x6985
        if _sha(b"CashuCard/c", s)[:16] != value[-16:]:
            return 0x6A80
        self.count = getattr(self, "count", 0) + 1
        self.c = cardctl.owner_c(getattr(self, "planted_s", None) or s, self.count)
        return 0x9000


def _card23(**kw):
    card = make_card()
    card.connection = Card23(**kw)
    card.select()
    return card


def _run(card, argv):
    """The real parser into the real command, against `card`; answers (exit code, stdout, stderr)."""
    args = cardctl.build_parser().parse_args(argv)
    err = io.StringIO()
    with stubbed_connect(card) as out, contextlib.redirect_stderr(err):
        code = args.func(args)
    return code, out.getvalue(), err.getvalue()



class FirstSetUpCard(Card23):
    """
    Card23, fresh from its install, as far as a first set-up goes (D196): SET_PIN begins the first set-up, which ends
    at the next selection; SET_CARD and the claim want it and the PIN given in this tap (6A91, 6982 otherwise); the
    claim is held for (6A98 to the first five askings); the owner's SET_LIMIT is taken after a nonce.
    """

    def __init__(self, factory=None, refuse=None, lift_at=None):
        super().__init__(has_owner=False, refund=False, pin_state=0)
        # a factory record (mint `-`, a design) written before any PIN; `refuse` {INS: SW} answers that command with
        # that word; `lift_at` N: the card leaves the field at the claim's N-th asking (the reader's transport fails)
        self.record = (bytes(1 + 33 + 65) + b"\x01-" + factory) if factory is not None else None
        self.limits = None
        self.askings = 0
        self.refuse = dict(refuse or {})
        self.lift_at = lift_at
        self.log_askings = self.reset_askings = 0
        self.held_tap = False
        self.hardest = bytes(4)   # GET_CARD 40-43: no header taken
        self.now = 0              # GET_INFO 17-20: the clock, none yet

    def transmit(self, apdu):
        if self.lift_at is not None and bytes(apdu)[1] == cardctl.INS_SET_OWNER and self.askings + 1 >= self.lift_at:
            self.gone = True
        if getattr(self, "gone", False):
            self.sent.append(bytes(apdu))
            raise OSError("the card left the field")
        return super().transmit(apdu)

    def _answer(self, apdu):
        ins = apdu[1]
        data = apdu[5:5 + apdu[4]] if len(apdu) > 5 else b""
        if apdu[:2] == b"\x00\xA4":
            self.log_askings = self.reset_askings = 0
            self.held_tap = False
        elif ins != cardctl.INS_GET_LOG:
            self.log_askings = 0
        if ins != cardctl.INS_RESET_CARD:
            self.reset_askings = 0
        if ins in self.refuse:
            return b"", self.refuse[ins]
        if ins == cardctl.INS_SET_CARD:
            if self.pin_state and not self.first:
                return b"", 0x6A91
            if self.pin_state and not self.verified:
                return b"", 0x6982
            self.record = data
            return b"", 0x9000
        if ins == cardctl.INS_GET_CARD and apdu[2] == 0:
            r = self.record or bytes(1 + 33 + 65) + b"\x00"
            mint = r[100:100 + r[99]]
            body = bytearray(CARD_ANSWER[:106])
            body[1], body[2] = int(self.record is not None), r[0]
            body[7:40] = r[1:34]
            body[40:44] = self.hardest
            body[105] = len(mint)
            return bytes(body) + mint + r[100 + r[99]:], 0x9000
        if ins == cardctl.INS_SET_OWNER and apdu[2] == 1:
            return self.stage(data)
        if ins == cardctl.INS_SET_OWNER:
            if not (self.verified and self.first and self.record):
                return b"", 0x6A91 if not self.first else 0x6982
            self.askings += 1
            if self.askings < 6:
                return b"", 0x6A98
            sw = self.take_c(data)
            if sw not in (None, 0x9000):
                return b"", sw
            self.has_owner = True
            if len(data) in (65 + 80, 65 + 80 + 16):
                # the claim's anchor: on 3.0 the first set-up's, the clock even where it is older (D204); before, forward only
                t = cardctl.header_time(data[65:145])
                self.now = t if getattr(self, "version_answer", b"\x03\x00") >= b"\x03\x00" else max(self.now, t)
            return b"", 0x9000
        if ins == cardctl.INS_SET_LIMIT:
            if not self.has_owner:
                return b"", 0x6A90
            self.limits = data
            return b"", 0x9000
        if ins == cardctl.INS_GET_LOG:
            if not self.verified:
                return b"", 0x6982
            self.log_askings += 1
            if self.log_askings < 10:
                return b"", 0x6A98
            self.held_tap = True
            return bytes(16), 0x9000
        if ins == cardctl.INS_RESET_CARD:
            if apdu[2] != 0 or apdu[3] != 0xAD:
                return b"", 0x6B00
            if self.has_owner:
                return b"", 0x6A91
            if not self.pin_state:
                return b"", 0x6A97
            if not (self.verified and self.held_tap):
                return b"", 0x6982
            # no data, or an anchor (D200): a block header of 80 bytes, the same at every asking
            if len(data) not in (0, 80):
                return b"", 0x6700
            self.reset_askings += 1
            if self.reset_askings < 60:
                return b"", 0x6A98
            self.pin_state, self.record, self.limits, self.first, self.verified = 0, None, None, False, False
            self.askings = 0
            if data:
                self.anchored_at = data
            return b"", 0x9000
        if ins == cardctl.INS_GET_INFO:
            body, sw = super()._answer(apdu)
            body = bytearray(body)
            body[11] = int(self.record is not None)
            body[3:6] = bytes([0, 0, 128])   # nothing on the card
            body[29] = 0                     # and nothing owed
            body[17:21] = self.now.to_bytes(4, "big")
            return bytes(body), sw
        return super()._answer(apdu)


def test_setup_is_one_selection_and_the_separate_commands_are_not():
    """
    3.0 (D196): a card's first set-up is the selection of its first SET_PIN. `setup` makes the PIN, the record, the
    owner (claimed, held for) and the owner's limits in that one selection; the same steps as separate commands each
    select the card again, and SET_CARD is then refused (6A91).
    """
    conn = FirstSetUpCard()
    card = make_card()
    card.connection = conn
    card.select()
    code, out, _ = _run(card, ["setup", "--pin", "1234", "--mint", "https://mint.test", "--owner-key",
                               f"{_SETUP_OWNER:064x}", "--anchor", _ANCHOR.hex(), "--day", "50000", "--payment",
                               "0", "--allowance", "0", "--budget", "7"])
    assert code == 0, out
    assert conn.record and conn.record[-17:] == b"https://mint.test", conn.record
    assert conn.has_owner and conn.askings == 6
    assert conn.limits and conn.limits.endswith((50000).to_bytes(4, "big") + bytes(8) + b"\x07"), conn.limits.hex()
    selects = [a for a in conn.sent if a[:2] == b"\x00\xA4"]
    assert len(selects) == 1, "one selection, the one the command began with"
    # the separate commands: each selects the card again, which ends the first set-up
    conn = FirstSetUpCard()
    card = make_card()
    card.connection = conn
    card.select()
    card.set_pin(b"1234")
    card.select()
    try:
        _run(card, ["set-card", "--mint", "https://mint.test", "--pin", "1234"])
    except (SystemExit, cardctl.CardError) as exc:
        assert "6A91" in str(exc).upper() or "first set-up" in str(exc), str(exc)
    else:
        raise AssertionError("a record was set outside the first set-up")


def test_setup_refuses_a_card_already_set_up_before_any_write():
    conn = FirstSetUpCard()
    conn.pin_state = 1   # a PIN and nothing else: no record, no owner
    card = make_card()
    card.connection = conn
    card.select()
    try:
        _run(card, ["setup", "--pin", "1234", "--mint", "https://mint.test", "--test-owner-key", "--anchor",
                    _ANCHOR.hex()])
    except SystemExit as exc:
        assert "fresh" in str(exc), str(exc)
    else:
        raise AssertionError("setup ran on a card with a PIN")
    assert not [a for a in conn.sent if a[1] in (cardctl.INS_SET_PIN, cardctl.INS_SET_CARD, cardctl.INS_SET_OWNER)]


# ── setup: everything checked before SET_PIN, and the way back from a late failure ──
# A real header (height 971,100, bits 0x17021EF0): its own work, at the floor.
_ANCHOR = bytes.fromhex("00c02133b973a14eab498ae41fd2054685e7250b36c4bd758ca801000000000000000000ba4fd6d57bfebf73fcf0552a"
                        "92d5430b78b735cf59c6c58243b2fc48d4669b5a75dcc96af01e021736a8ee8c")
_SETUP_OWNER = 0x2222222222222222222222222222222222222222222222222222222222222222


def _setup_card(**kw):
    conn = FirstSetUpCard(**kw)
    card = make_card()
    card.connection = conn
    card.select()
    return conn, card


def _setup_args(*extra, owner=True):
    argv = ["setup", "--pin", "1234", "--mint", "https://mint.test", "--anchor", _ANCHOR.hex()]
    if owner:
        argv += ["--owner-key", f"{_SETUP_OWNER:064x}"]
    return argv + list(extra)


def _writes(conn):
    return [a for a in conn.sent if a[1] in (cardctl.INS_SET_PIN, cardctl.INS_SET_CARD, cardctl.INS_SET_OWNER,
                                              cardctl.INS_SET_LIMIT, cardctl.INS_VERIFY_PIN)]


def test_setup_wants_the_owner_key_or_the_test_keys_own_flag():
    """A card set up under cardctl's TEST key is anyone's who has this repository: setup asks for --owner-key, and
    takes the TEST key only under --test-owner-key, which says so; nothing reaches the card otherwise."""
    for argv in (_setup_args(owner=False), _setup_args("--owner-key", "test", owner=False),
                 _setup_args("--owner-key", f"{p256.TEST_OWNER_PRIVATE:064x}", owner=False)):
        conn, card = _setup_card()
        try:
            _run(card, argv)
        except SystemExit as exc:
            assert "--test-owner-key" in str(exc) and "--owner-key" in str(exc), str(exc)
            # no key, or the word `test`: refused as no key, before cardctl's TEST key is taken up at all
            assert ("setup wants --owner-key" in str(exc)) == ("--owner-key" not in argv or "test" in argv), str(exc)
        else:
            raise AssertionError(f"setup ran with no owner key of the holder's: {argv}")
        assert not _writes(conn), [a.hex() for a in conn.sent]
    conn, card = _setup_card()
    code, out, err = _run(card, _setup_args("--test-owner-key", owner=False))
    assert code == 0 and conn.has_owner, out
    assert "TEST owner key" in err and "anyone with this repository" in err, err
    try:
        cardctl.build_parser().parse_args(_setup_args("--test-owner-key"))
    except SystemExit:
        pass
    else:
        raise AssertionError("--owner-key and --test-owner-key were both taken")


def test_setup_checks_the_mint_the_refund_key_and_the_anchor_before_set_pin():
    """Each of these would leave a card with a PIN and no owner if found at the card: the mint's length and
    characters, a refund key off the curve or in the 04 form, an anchor without its own work, and an anchor under a
    quarter of the hardest header the card has taken. Each is refused before SET_PIN, with nothing written."""
    off_curve = "02" + "00" * 31 + "05"
    assert pow(5 ** 3 + 7, (_SP - 1) // 2, _SP) != 1, "x = 5 is the x of no point"
    bad_work = bytearray(_ANCHOR)
    bad_work[76] ^= 0x01   # one digit of the nonce
    cases = [
        (["--mint", "https://" + "m" * 70], "77"),
        (["--mint", "https://mïnt.example"], "ASCII"),
        (["--mint", "https://mint .example"], "ASCII"),
        (["--mint", "-"], "factory record"),
        (["--refund", off_curve], "not a point"),
        (["--refund", "04" + "11" * 32], "not a point"),
        (["--anchor", bytes(bad_work).hex()], "work"),
    ]
    for extra, word in cases:
        conn, card = _setup_card()
        argv = _setup_args()
        for flag, value in zip(extra[::2], extra[1::2]):
            if flag in argv:
                argv[argv.index(flag) + 1] = value
            else:
                argv += [flag, value]
        try:
            _run(card, argv)
        except SystemExit as exc:
            assert word in str(exc), (extra, str(exc))
        else:
            raise AssertionError(f"setup took {extra}")
        assert not _writes(conn), (extra, [a.hex() for a in conn.sent])
    # the card's own ratchet: a card that has taken a much harder header (any reader may show it one) refuses an
    # anchor under a quarter of it (6A93) at the claim, after the PIN; setup reads it first
    conn, card = _setup_card()
    conn.hardest = bytes.fromhex("00010017")   # bits 0x17000100: a target far under the anchor's
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        assert "quarter" in str(exc), str(exc)
    else:
        raise AssertionError("an anchor the card would refuse was sent")
    assert not _writes(conn)
    # and the good ones go through
    conn, card = _setup_card()
    refund = _sec33(_smul(_REFUND_R)).hex()
    code, out, _ = _run(card, _setup_args("--refund", refund))
    assert code == 0 and conn.has_owner and conn.record[1:34].hex() == refund, out


def test_header_work_is_checked_as_the_card_checks_it():
    assert cardctl.header_work_problem(_ANCHOR) is None
    assert cardctl.header_work_problem(_ANCHOR, bytes.fromhex("f01e0217")) is None, "a quarter of its own: taken"
    bad = bytearray(_ANCHOR)
    bad[0] ^= 1
    assert "work" in cardctl.header_work_problem(bytes(bad))
    for bits in ("ffffff00", "00008021", "ffff7f00", "ffff7f21"):   # size 0, a negative mantissa, size past 32
        h = bytearray(_ANCHOR)
        h[72:76] = bytes.fromhex(bits)
        assert "bits" in cardctl.header_work_problem(bytes(h)), bits


def test_setup_with_a_unit_writes_it_and_refuses_another():
    conn, card = _setup_card()
    code, out, _ = _run(card, _setup_args("--unit", "usd"))
    assert code == 0 and conn.record[0] == 1, conn.record.hex()
    conn, card = _setup_card()
    assert _run(card, _setup_args())[0] == 0 and conn.record[0] == 0
    try:
        cardctl.build_parser().parse_args(_setup_args("--unit", "eur"))
    except SystemExit:
        pass
    else:
        raise AssertionError("a unit the card does not know was taken")


def test_setup_takes_a_card_with_a_factory_record_and_keeps_its_design():
    conn, card = _setup_card(factory=b"FX1")
    code, out, _ = _run(card, _setup_args())
    assert code == 0 and conn.has_owner, out
    assert conn.record.endswith(b"https://mint.test" + b"FX1") and conn.record[99] == len("https://mint.test"), \
        conn.record.hex()
    # a holder's record is not a factory record: refused before anything is written
    conn, card = _setup_card(factory=b"FX1")
    conn.record = bytes(99) + b"\x05https" + b"FX1"
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        assert "fresh" in str(exc), str(exc)
    else:
        raise AssertionError("setup wrote over a holder's record")
    assert not _writes(conn)


def test_setup_after_a_late_failure_says_the_cards_state_and_the_way_back():
    """A card refused at SET_CARD (6F00: the chip's framing) keeps its new PIN and no owner: setup says so and names
    the reset by the PIN. A card lifted during the claim may or may not be claimed: setup says to read it and both ways
    on. A card claimed whose limits were refused is set up: setup says the limits are still to send."""
    conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        text = str(exc)
        assert "6F00" in text and "PIN set" in text and "owner: none" in text, text
        assert "cardctl.py reset --pin" in text and "setup" in text, text
    else:
        raise AssertionError("a refused SET_CARD was not reported")
    conn, card = _setup_card(lift_at=3)
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        text = str(exc)
        assert "left the field" in text and "cardctl.py info" in text and "reset --pin" in text, text
        assert "set-limit" in text, text
    else:
        raise AssertionError("a card lifted during the claim was not reported")
    conn, card = _setup_card(refuse={cardctl.INS_SET_LIMIT: 0x6A80})
    try:
        _run(card, _setup_args("--day", "50000"))
    except SystemExit as exc:
        text = str(exc)
        assert "owner: yes" in text and "set-limit" in text and "reset --pin" not in text, text
    else:
        raise AssertionError("a refused SET_LIMIT was not reported")


class HandOverCard(Card23):
    """Card23 with an owner (OWNER) as far as a hand-over goes: SET_OWNER with OWNER's proof over the new key sets it."""

    def __init__(self):
        super().__init__(has_owner=True)
        self.new_owner = None

    def _answer(self, apdu):
        if apdu[1] == cardctl.INS_SET_OWNER and apdu[2] == 1:
            return self.stage(apdu[5:5 + apdu[4]])
        if apdu[1] == cardctl.INS_SET_OWNER:
            data = apdu[5:5 + apdu[4]]
            n = data[0]
            value = data[1 + n:]
            if not any(p256.verify(p256.public_key(OWNER), b"CashuCard/set-owner" + nonce + value, data[1:1 + n])
                       for nonce in (NONCE, _SEAL_NONCE)):
                return b"", 0x6A91
            sw = self.take_c(value)
            if sw not in (None, 0x9000):
                return b"", sw
            self.new_owner = value[:65]
            self.owner_pub = self.new_owner
            return b"", 0x9000
        return super()._answer(apdu)


_NEXT_OWNER = 0x3333333333333333333333333333333333333333333333333333333333333333


def test_set_owner_wants_the_new_owners_key_or_the_test_keys_own_flag():
    """A card handed over, or claimed, to cardctl's TEST key is anyone's who has this repository: set-owner and
    set-owner-url ask for --owner-key (the new owner's), take the TEST key only under --test-owner-key, which says so,
    and refuse the TEST key's value given as --owner-key; nothing reaches the card otherwise."""
    saved = cardctl.fetch_tip
    cardctl.fetch_tip = lambda url: _ANCHOR
    try:
        for cmd in (["set-owner"], ["set-owner-url", "--url", "http://ops.test"]):
            for key in ([], ["--owner-key", "test"], ["--owner-key", f"{p256.TEST_OWNER_PRIVATE:064x}"]):
                card = make_card()
                card.connection = HandOverCard()
                card.select()
                sent = len(card.connection.sent)
                try:
                    _run(card, cmd + ["--old-owner-key", f"{OWNER:064x}"] + key)
                except SystemExit as exc:
                    assert "--test-owner-key" in str(exc) and "--owner-key" in str(exc), (cmd, key, str(exc))
                else:
                    raise AssertionError(f"{cmd} {key}: the card was handed to no key of the new owner's")
                assert len(card.connection.sent) == sent and card.connection.new_owner is None, (cmd, key)
            card = make_card()
            card.connection = HandOverCard()
            card.select()
            code, out, err = _run(card, cmd + ["--old-owner-key", f"{OWNER:064x}", "--test-owner-key"])
            assert code == 0 and card.connection.new_owner == p256.public_key(p256.TEST_OWNER_PRIVATE), out
            assert "TEST owner key" in err and "anyone with this repository" in err, err
            card = make_card()
            card.connection = HandOverCard()
            card.select()
            code, out, err = _run(card, cmd + ["--old-owner-key", f"{OWNER:064x}", "--owner-key", f"{_NEXT_OWNER:064x}"])
            assert code == 0 and card.connection.new_owner == p256.public_key(_NEXT_OWNER), out
            try:
                cardctl.build_parser().parse_args(cmd + ["--owner-key", f"{_NEXT_OWNER:064x}", "--test-owner-key"])
            except SystemExit:
                pass
            else:
                raise AssertionError(f"{cmd}: --owner-key and --test-owner-key were both taken")
    finally:
        cardctl.fetch_tip = saved


def test_a_hand_over_says_what_waits_for_the_new_owner():
    """After a hand-over of a 3.0 card, cardctl says that verify-pin answers 6982 until the new owner's change-pin, and
    a dated load 6A8E until set-card --refund names the new owner's refund key."""
    card = make_card()
    card.connection = HandOverCard()
    card.select()
    code, out, _ = _run(card, ["set-owner", "--old-owner-key", f"{OWNER:064x}", "--owner-key", f"{_NEXT_OWNER:064x}"])
    assert code == 0, out
    for word in ("6982", "change-pin", "6A8E", "set-card", "--refund"):
        assert word in out, (word, out)
    # each command the note names runs as written, its placeholders filled in
    import re
    import shlex
    named = re.findall(r"python3 cardctl\.py ([^)]*)", out)
    assert [c.split()[0] for c in named] == ["change-pin", "set-card"], (named, out)
    for command in named:
        filled = (command.replace("<the new owner key>", f"{_NEXT_OWNER:064x}").replace("<the mint>", "https://mint.test")
                  .replace("<its refund key>", "02" + "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"))
        assert "<" not in filled and "--owner-key" in filled, filled
        try:
            cardctl.build_parser().parse_args(shlex.split(filled))
        except SystemExit as exc:
            raise AssertionError(f"the note's line does not run as written: {command}") from exc
    # a claim is no hand-over: nothing of it is said
    conn, card = _setup_card()
    card.set_pin(b"1234")
    card.verify_pin(b"1234")
    card.set_card("https://mint.test")
    code, out, _ = _run(card, ["set-owner", "--pin", "1234", "--owner-key", f"{_NEXT_OWNER:064x}"])
    assert code == 0 and conn.has_owner and "6A8E" not in out, out


def test_setup_and_set_card_take_a_design_and_set_card_keeps_the_records():
    """SET_CARD writes the design the record carries and zeroes one it does not: `setup --design` and
    `set-card --design` send the one given; set-card without it sends the design the card's record has. A design is
    three capital letters or digits, checked before anything is written."""
    conn, card = _setup_card()
    assert _run(card, _setup_args("--design", "EL1"))[0] == 0
    assert conn.record.endswith(b"https://mint.test" + b"EL1"), conn.record.hex()
    conn, card = _setup_card(factory=b"FX1")
    assert _run(card, _setup_args("--design", "EL1"))[0] == 0
    assert conn.record.endswith(b"EL1"), conn.record.hex()
    for bad in ("el1", "E1", "EL12", "E-1"):
        conn, card = _setup_card()
        try:
            _run(card, _setup_args("--design", bad))
        except SystemExit as exc:
            assert "design" in str(exc), str(exc)
        else:
            raise AssertionError(f"setup took the design {bad!r}")
        assert not _writes(conn), bad
    # set-card on a card whose record has a design: kept with no --design, replaced with one
    conn, card = _setup_card()
    conn.record = bytes(99) + b"\x05https" + b"FX1"
    assert _run(card, ["set-card", "--mint", "https://mint.test"])[0] == 0
    assert conn.record.endswith(b"https://mint.test" + b"FX1"), conn.record.hex()
    assert _run(card, ["set-card", "--mint", "https://mint.test", "--design", "EL1"])[0] == 0
    assert conn.record.endswith(b"https://mint.test" + b"EL1"), conn.record.hex()
    conn, card = _setup_card()
    try:
        _run(card, ["set-card", "--mint", "https://mint.test", "--design", "e"])
    except SystemExit as exc:
        assert "design" in str(exc), str(exc)
    else:
        raise AssertionError("set-card took the design 'e'")
    assert not _writes(conn)


def test_setup_that_stops_on_a_factory_card_names_its_design_for_the_next_setup():
    """The reset by the PIN clears the record, a factory record's design with it: setup's stop advice names the design,
    and the next setup given it writes it."""
    conn, card = _setup_card(factory=b"FX1", refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        assert "reset --pin" in str(exc) and "setup again with --design FX1" in str(exc), str(exc)
    else:
        raise AssertionError("a stopped setup was not reported")
    conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        assert "--design" not in str(exc), str(exc)


def test_setup_that_loses_the_card_at_set_card_still_names_its_design():
    """Where the card leaves the field at SET_CARD and cannot be read after the stop, the advice for a card with a PIN
    and no owner (reset it by its PIN, then setup again) still names the factory record's design, and says why the
    card could not be read."""
    conn, card = _setup_card(factory=b"FX1")
    real = conn.transmit

    def lifted(apdu):
        if bytes(apdu)[1] == cardctl.INS_SET_CARD:
            conn.gone = True
        return real(apdu)

    conn.transmit = lifted
    try:
        _run(card, _setup_args())
    except SystemExit as exc:
        text = str(exc)
        assert "could not be read after it (the card left the field)" in text, text
        assert "reset --pin <the PIN>, then run setup again with --design FX1" in text, text
    else:
        raise AssertionError("a card lifted at SET_CARD was not reported")


def test_setup_on_a_2_2_card_that_stops_names_the_claim_not_the_reset():
    """On a card older than 3.0 a card with a PIN and no owner may still be claimed (set-owner --pin): there is no
    reset by the PIN (reset is 3.0's), so setup's stop advice names the claim."""
    for lift in (False, True):
        conn = FirstSetUpCard(refuse=None if lift else {cardctl.INS_SET_CARD: 0x6F00}, lift_at=1 if lift else None)
        conn.version_answer = b"\x02\x02"
        card = make_card()
        card.connection = conn
        card.select()
        try:
            _run(card, _setup_args())
        except SystemExit as exc:
            text = str(exc)
            assert "set-owner --pin" in text and "reset --pin" not in text, text
            if not lift:
                assert "set-card" in text, text
        else:
            raise AssertionError("a stopped setup was not reported")


def test_reset_by_the_pin_holds_the_history_then_sixty_askings_and_frees_the_card_for_setup():
    conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit:
        pass
    assert conn.pin_state == 1 and not conn.has_owner
    card.select()
    code, out, err = _run(card, ["reset", "--pin", "1234", "--yes"])
    assert code == 0 and conn.pin_state == 0 and conn.record is None, (out, err)
    ins = [a[1] for a in conn.sent[-80:] if a[:2] != b"\x00\xA4"]
    assert ins.count(cardctl.INS_GET_LOG) == 10 and ins.count(cardctl.INS_RESET_CARD) == 60, ins
    assert all(a[2:4] == b"\x00\xAD" and len(a) == 4 for a in conn.sent if a[1] == cardctl.INS_RESET_CARD)
    conn.refuse = {}
    card.select()
    assert _run(card, _setup_args())[0] == 0 and conn.has_owner
    # an owned card is the owner's to reset: refused before anything is sent
    sent = len(conn.sent)
    try:
        _run(card, ["reset", "--pin", "1234", "--yes"])
    except SystemExit as exc:
        assert "owner" in str(exc), str(exc)
    else:
        raise AssertionError("the reset by the PIN was sent to an owned card")
    assert not [a for a in conn.sent[sent:] if a[1] in (cardctl.INS_RESET_CARD, cardctl.INS_VERIFY_PIN)]


def test_reset_by_the_pin_takes_an_anchor_in_every_asking_and_checks_its_work_first():
    """--anchor (D200): every RESET_CARD asking carries the 80-byte header, which the card takes as its clock even where
    it is older than its own; a header without its own work, or under a quarter of the hardest the card has taken, is
    refused before anything is sent to the card."""
    conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit:
        pass
    card.select()
    code, out, err = _run(card, ["reset", "--pin", "1234", "--yes", "--anchor", _ANCHOR.hex()])
    assert code == 0 and conn.pin_state == 0 and getattr(conn, "anchored_at", None) == _ANCHOR, (out, err)
    resets = [a for a in conn.sent if a[1] == cardctl.INS_RESET_CARD]
    assert len(resets) == 60 and all(a[2:5] == b"\x00\xAD\x50" and a[5:85] == _ANCHOR for a in resets), resets[:1]
    bad_work = bytearray(_ANCHOR)
    bad_work[76] ^= 0x01
    for anchor, hardest, word in ((bytes(bad_work), bytes(4), "work"), (_ANCHOR, bytes.fromhex("00010017"), "quarter")):
        conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
        try:
            _run(card, _setup_args())
        except SystemExit:
            pass
        conn.hardest = hardest
        card.select()
        sent = len(conn.sent)
        try:
            _run(card, ["reset", "--pin", "1234", "--yes", "--anchor", anchor.hex()])
        except SystemExit as exc:
            assert word in str(exc), str(exc)
        else:
            raise AssertionError("an anchor the card would refuse was sent")
        assert not [a for a in conn.sent[sent:] if a[1] in (cardctl.INS_RESET_CARD, cardctl.INS_VERIFY_PIN)]


class OwnedResetCard(Card23):
    """Card23 with an owner, empty and owed nothing, for the owner's reset (D200) and REFRESH (D201): each checks the owner's
    proof over label || nonce || value, and a locked card's reset wants the PIN given in the tap."""

    def __init__(self, locked=False):
        super().__init__(has_owner=True)
        self.locked = locked
        self.got = []

    def _answer(self, apdu):
        ins, p1 = apdu[1], apdu[2]
        data = apdu[5:5 + apdu[4]] if len(apdu) > 5 else b""
        if ins in (cardctl.INS_RESET_CARD, cardctl.INS_REFRESH) and p1 == 0:
            n = data[0]
            value = data[1 + n:]
            label = b"CashuCard/reset" if ins == cardctl.INS_RESET_CARD else b"CashuCard/refresh"
            if not p256.verify(p256.public_key(OWNER), label + NONCE + value, data[1:1 + n]):
                return b"", 0x6A91
            if ins == cardctl.INS_RESET_CARD and self.locked and not self.verified:
                return b"", 0x6982
            self.got.append((ins, apdu[3], value))
            # REFRESH answers the clock: the header's time where it took it, or a later clock it kept (`clock`)
            now = getattr(self, "clock", None) or int.from_bytes(value[68:72], "little")
            return (b"" if ins == cardctl.INS_RESET_CARD else now.to_bytes(4, "big")), 0x9000
        if ins == cardctl.INS_GET_INFO:
            body, sw = super()._answer(apdu)
            body = bytearray(body)
            body[3:6] = bytes([0, 0, 128])   # nothing on the card
            body[29] = 0                     # and nothing owed
            body[10] = int(self.locked)
            return bytes(body), sw
        return super()._answer(apdu)


def _owned_reset_card(locked=False):
    conn = OwnedResetCard(locked)
    card = make_card()
    card.connection = conn
    card.select()
    return conn, card


def test_the_owners_reset_signs_the_anchor_and_a_locked_card_wants_the_pin():
    """reset --owner-key (D200): on a card with an owner, RESET_CARD P2 AD with the owner's proof over the anchor (or over
    nothing), the anchor after the proof; a locked card wants --pin, given in the same tap before the reset."""
    conn, card = _owned_reset_card()
    code, out, err = _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--yes", "--anchor", _ANCHOR.hex()])
    assert code == 0 and conn.got == [(cardctl.INS_RESET_CARD, 0xAD, _ANCHOR)], (out, err, conn.got)
    conn, card = _owned_reset_card()
    assert _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--yes"])[0] == 0
    assert conn.got == [(cardctl.INS_RESET_CARD, 0xAD, b"")], conn.got
    conn, card = _owned_reset_card(locked=True)
    sent = len(conn.sent)
    try:
        _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--yes", "--anchor", _ANCHOR.hex()])
    except SystemExit as exc:
        assert "locked" in str(exc) and "--pin" in str(exc), str(exc)
    else:
        raise AssertionError("a locked card's reset was sent without the PIN")
    assert not [a for a in conn.sent[sent:] if a[1] == cardctl.INS_RESET_CARD]
    code, out, err = _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--pin", "1234", "--yes", "--anchor", _ANCHOR.hex()])
    assert code == 0 and conn.got == [(cardctl.INS_RESET_CARD, 0xAD, _ANCHOR)], (out, err, conn.got)
    ins = [a[1] for a in conn.sent[sent:] if a[:2] != b"\x00\xA4"]
    assert ins.index(cardctl.INS_VERIFY_PIN) < ins.index(cardctl.INS_RESET_CARD), ins
    # an anchor without its own work is refused before anything is sent
    bad = bytearray(_ANCHOR)
    bad[76] ^= 0x01
    conn, card = _owned_reset_card()
    try:
        _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--yes", "--anchor", bytes(bad).hex()])
    except SystemExit as exc:
        assert "work" in str(exc), str(exc)
    else:
        raise AssertionError("an anchor without its work was sent")
    assert conn.got == []


def test_refresh_back_puts_01_after_the_header_under_the_proof():
    """refresh --back (D201): the owner's REFRESH value is the header and the byte 01, both signed; without it, the
    header alone."""
    conn, card = _owned_reset_card()
    assert _run(card, ["refresh", "--owner-key", f"{OWNER:064x}", "--header", _ANCHOR.hex(), "--back"])[0] == 0
    assert _run(card, ["refresh", "--owner-key", f"{OWNER:064x}", "--header", _ANCHOR.hex()])[0] == 0
    assert conn.got == [(cardctl.INS_REFRESH, 0, _ANCHOR + b"\x01"), (cardctl.INS_REFRESH, 0, _ANCHOR)], conn.got
    try:
        _run(card, ["refresh", "--pin", "1234", "--back", "--header", _ANCHOR.hex()])
    except SystemExit as exc:
        assert "--back" in str(exc), str(exc)
    else:
        raise AssertionError("the holder's REFRESH took --back")


class HolderRefreshCard(FirstSetUpCard):
    """FirstSetUpCard past its set-up, with REFRESH P1 01 (D189): the PIN given and a held tap, the header alone."""

    def _answer(self, apdu):
        if apdu[1] == cardctl.INS_REFRESH and apdu[2] == 1:
            data = apdu[5:5 + apdu[4]]
            if not (self.verified and self.held_tap):
                return b"", 0x6982
            if len(data) != 80:
                return b"", 0x6700
            self.refreshed = data
            return (getattr(self, "clock", None) or int.from_bytes(data[68:72], "little")).to_bytes(4, "big"), 0x9000
        return super()._answer(apdu)


def test_the_holders_refresh_gives_the_pin_holds_the_history_and_sends_the_header_alone():
    """refresh --pin (D189, D201): VERIFY_PIN, the history held for (GET_LOG asked until it answers), then REFRESH P1 01
    with the 80-byte header and no proof."""
    conn = HolderRefreshCard()
    conn.pin, conn.pin_state = b"1234", 1
    card = make_card()
    card.connection = conn
    card.select()
    code, out, err = _run(card, ["refresh", "--pin", "1234", "--header", _ANCHOR.hex()])
    assert code == 0 and getattr(conn, "refreshed", None) == _ANCHOR, (out, err)
    ins = [a[1] for a in conn.sent if a[:2] != b"\x00\xA4"]
    assert ins[0] == cardctl.INS_VERIFY_PIN and ins.count(cardctl.INS_GET_LOG) == 10 and ins[-1] == cardctl.INS_REFRESH, ins
    refresh = [a for a in conn.sent if a[1] == cardctl.INS_REFRESH][0]
    assert refresh[2:5] == b"\x01\x00\x50" and refresh[5:85] == _ANCHOR, refresh.hex()


def test_refresh_says_whether_the_clock_moved_and_names_the_way_that_would():
    """refresh (D201, D203): the card answers 9000 and its clock for an older header it does not take. Where the clock
    is the header's time, refresh says so; where it is later, it says the clock did not move and names --back for the
    owner, and for the holder the empty card's reset with the tip as its anchor."""
    t = cardctl.header_time(_ANCHOR)
    conn, card = _owned_reset_card()
    code, out, _ = _run(card, ["refresh", "--owner-key", f"{OWNER:064x}", "--header", _ANCHOR.hex()])
    assert code == 0 and f"the clock is at the header, {t}" in out and "did not move" not in out, out
    conn.clock = 3_000_000_000
    code, out, _ = _run(card, ["refresh", "--owner-key", f"{OWNER:064x}", "--header", _ANCHOR.hex()])
    assert code == 0 and "did not move" in out and "3000000000" in out and "refresh --back" in out, out
    assert "refreshed" not in out, out
    code, out, _ = _run(card, ["refresh", "--owner-key", f"{OWNER:064x}", "--header", _ANCHOR.hex(), "--back"])
    assert "did not move" in out and "not weak" in out, out
    conn = HolderRefreshCard()
    conn.pin, conn.pin_state, conn.clock = b"1234", 1, 3_000_000_000
    card = make_card()
    card.connection = conn
    card.select()
    code, out, _ = _run(card, ["refresh", "--pin", "1234", "--header", _ANCHOR.hex()])
    assert code == 0 and "did not move" in out and "reset --pin" in out and "--anchor" in out, out


def test_setup_wants_the_anchor_and_sends_nothing_without_it():
    """setup (D204, r13b 7): every set-up gives the card the tip as the claim's anchor. Without --anchor nothing is
    sent to the card, not even a SELECT's next command, and the refusal names --anchor and `tip`."""
    conn, card = _setup_card()
    sent = len(conn.sent)
    argv = [a for a in _setup_args() if a not in ("--anchor", _ANCHOR.hex())]
    try:
        _run(card, argv)
    except SystemExit as exc:
        assert "--anchor" in str(exc) and "tip" in str(exc) and "Nothing was sent" in str(exc), str(exc)
    else:
        raise AssertionError("a card was set up with no anchor")
    assert conn.sent[sent:] == [], "nothing sent"


def test_setup_brings_back_a_far_clock_on_2_3_and_refuses_it_on_an_older_card():
    """setup (D204): on a 3.0 card the claim's anchor, the first set-up's of an empty card, is the clock even where
    the clock was later: a card a far header set is set up, and setup says the anchor brought the clock back. A card
    older than 3.0 moves its clock only forward: there a clock more than two hours past the anchor's time is refused
    before anything is written, naming the reset with the tip as its anchor (D203); two hours or less is set up."""
    t = cardctl.header_time(_ANCHOR)
    conn, card = _setup_card()
    conn.now = 3_000_000_000
    code, out, _ = _run(card, _setup_args())
    assert code == 0 and conn.has_owner and conn.now == t, out
    assert f"anchored at {t}" in out and "it was at 3000000000" in out and "brought it back" in out, out
    for ahead, refused in ((cardctl.CLOCK_AHEAD_MOST + 1, True), (cardctl.CLOCK_AHEAD_MOST, False)):
        conn, card = _setup_card()
        conn.version_answer = b"\x02\x02"
        card.select()
        conn.now = t + ahead
        try:
            code = _run(card, _setup_args())[0]
        except SystemExit as exc:
            assert refused, str(exc)
            assert "two hours" in str(exc) and "reset --pin" in str(exc) and "--anchor" in str(exc), str(exc)
            assert "Nothing was written" in str(exc), str(exc)
            assert not _writes(conn), "nothing written"
        else:
            assert not refused and code == 0 and conn.has_owner, "a 2.2 card whose clock is far ahead was set up"


def test_a_fresh_card_is_reset_with_an_anchor_its_pin_set_for_the_reset_alone():
    """reset --pin --anchor on a fresh card (D203): SET_PIN, VERIFY_PIN, the history held for and the reset's sixty
    askings with the anchor, in one selection, after which setup takes the card. Without --anchor a fresh card is not
    reset: nothing is sent, and setup is named."""
    conn, card = _setup_card()
    sent = len(conn.sent)
    try:
        _run(card, ["reset", "--pin", "1234", "--yes"])
    except SystemExit as exc:
        assert "setup" in str(exc) and "--anchor" in str(exc), str(exc)
    else:
        raise AssertionError("a fresh card was reset with no anchor")
    assert not [a for a in conn.sent[sent:] if a[1] in (cardctl.INS_SET_PIN, cardctl.INS_RESET_CARD)]
    code, out, err = _run(card, ["reset", "--pin", "1234", "--yes", "--anchor", _ANCHOR.hex()])
    assert code == 0 and conn.pin_state == 0 and getattr(conn, "anchored_at", None) == _ANCHOR, (out, err)
    ins = [a[1] for a in conn.sent[sent:] if a[:2] != b"\x00\xA4"]
    assert ins.index(cardctl.INS_SET_PIN) < ins.index(cardctl.INS_VERIFY_PIN) < ins.index(cardctl.INS_GET_LOG), ins
    assert ins.count(cardctl.INS_RESET_CARD) == 60, ins
    card.select()
    assert _run(card, _setup_args())[0] == 0 and conn.has_owner


def test_setup_and_set_owner_read_the_owners_c_back_before_they_say_it_is_the_owners():
    """setup and set-owner with --owner-seed (D202): s from the card's own key in this tap, the envelope, the claim or
    the hand-over with its check, then c read back from the card (GROUP_KEYS for the date 0) and its n found before
    the line says c is the owner's. A card that took another s's c is said to be so, naming the owner's reset."""
    seed = bytes(range(64))
    conn, card = _setup_card()
    code, out, err = _run(card, _setup_args("--owner-seed", seed.hex()))
    want = cardctl.owner_c(cardctl.owner_s(seed, _sec33(conn.card_pt)), 1)
    assert code == 0 and conn.c == want and "read back from the card (1st owner's c" in out, (out, err)
    assert any(a[1] == cardctl.INS_GROUP_KEYS for a in conn.sent), "c read back"
    conn, card = _setup_card()
    conn.planted_s = bytes(32)   # the card takes another s's c than the check's
    try:
        _run(card, _setup_args("--owner-seed", seed.hex()))
    except SystemExit as exc:
        assert "not the owner's c" in str(exc) and "reset --owner-key" in str(exc), str(exc)
    else:
        raise AssertionError("a c that is not the owner's was said to be")
    # a hand-over: the new owner's grant reads c back
    conn = HandOverCard()
    conn.count = 1
    card = make_card()
    card.connection = conn
    card.select()
    code, out, err = _run(card, ["set-owner", "--owner-key", f"{_NEXT_OWNER:064x}", "--old-owner-key", f"{OWNER:064x}",
                                 "--owner-seed", seed.hex()])
    want = cardctl.owner_c(cardctl.owner_s(seed, _sec33(conn.card_pt)), 2)
    assert code == 0 and conn.c == want and "(2nd owner's c" in out, (out, err)


def test_set_pin_on_a_fresh_2_3_card_is_refused_and_names_setup():
    """On 3.0 a SET_PIN on a card with no PIN begins its first set-up, which the next selection ends: alone, it leaves
    a card with a PIN, no record and no owner. set-pin names setup instead; a 2.2 card still takes it."""
    conn, card = _setup_card()
    try:
        _run(card, ["set-pin", "1234"])
    except SystemExit as exc:
        assert "setup" in str(exc), str(exc)
    else:
        raise AssertionError("set-pin began a first set-up it cannot finish")
    assert not _writes(conn)
    card = make_card([(b"\x02\x02", 0x9000), (INFO_43[:7] + b"\x00" + INFO_43[8:], 0x9000)])
    card.select()
    assert _run(card, ["set-pin", "1234"])[0] == 0
    assert card.connection.last[1] == cardctl.INS_SET_PIN


def test_card_secret_never_begins_a_first_set_up():
    """card-secret has no --set-pin: a SET_PIN that begins a first set-up and ends with it strands the card. On a card
    with no owner and no refund key it names the way c is read: setup, then the owner's grant."""
    try:
        cardctl.build_parser().parse_args(["card-secret", "--pin", "1234", "--set-pin"])
    except SystemExit:
        pass
    else:
        raise AssertionError("card-secret still takes --set-pin")
    card = _card23(refund=False, pin_state=0)
    try:
        _run(card, ["card-secret", "--pin", "1234"])
    except SystemExit as exc:
        assert "no PIN and no owner" in str(exc) and "setup" in str(exc) and "--owner-key" in str(exc), str(exc)
    else:
        raise AssertionError("c was asked for on a card with no PIN")
    assert cardctl.INS_SET_PIN not in [a[1] for a in card.connection.sent]


def test_info_says_open_to_the_first_phone_only_where_it_is():
    for pin_state, version, open_ in ((0, b"\x03\x00", True), (1, b"\x03\x00", False), (1, b"\x02\x02", True)):
        card = _card23(has_owner=False, pin_state=pin_state)
        card.connection.version_answer = version
        card.select()
        code, out, _ = _run(card, ["info"])
        assert code == 0
        assert ("open to the first phone" in out) == open_, (pin_state, version, out)
        if not open_:
            assert "reset" in out, out


def test_selftest_passes_a_2_3_card_of_two_units():
    applet = FakeApplet(version=(3, 0), pin_state=1)
    applet.info_59 = INFO_59[:8] + b"\x05" + INFO_59[9:]
    rc, out = run_selftest(applet, "--pin", "1234")
    assert "PASS  format" in out and rc == 0, out
    applet = FakeApplet(version=(2, 2), pin_state=1)
    applet.info_43 = INFO_43[:8] + b"\x05" + INFO_43[9:]
    rc, out = run_selftest(applet, "--pin", "1234")
    assert "FAIL  format" in out and rc == 1, out

def test_load_sends_p2_02_only_with_date_keys():
    """P2 bit 1 is the loader's word that the piece was minted to the card's key for its date: given only on request."""
    keyset = bytes.fromhex("0059534ce0bfa19a")
    card = make_card([(b"\x07", 0x9000)])
    card.load_proof(keyset, 8, bytes(32), cardctl.placeholder_c(bytes(32)), 0, date_keys=True)
    assert card.connection.last[:4] == bytes.fromhex("B0300002"), card.connection.last[:4].hex()
    card = make_card([(b"\x07", 0x9000)])
    card.load_proof(keyset, 8, bytes(32), cardctl.placeholder_c(bytes(32)))
    assert card.connection.last[:4] == bytes.fromhex("B0300000"), card.connection.last[:4].hex()
    for flags, p2 in (([], 0x00), (["--date-keys"], 0x02)):
        card = make_card([(b"\x03", 0x9000)])
        card.version = b"\x03\x00"
        assert _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", *flags])[0] == 0
        assert card.connection.last[3] == p2, (flags, card.connection.last.hex())


def test_load_without_date_keys_explains_the_6a86():
    card = make_card([(b"", 0x6A86)])
    try:
        _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16"])
    except SystemExit as exc:
        assert "6A86" in str(exc) and "--date-keys" in str(exc) and "P + t*G" in str(exc), str(exc)
    else:
        raise AssertionError("a 6A86 to a load without --date-keys was not explained")
    card = make_card([(b"", 0x6A86)])
    card.version = b"\x03\x00"
    try:
        _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--date-keys"])
    except cardctl.CardError as exc:
        assert exc.sw == 0x6A86
    else:
        raise AssertionError("a 6A86 with --date-keys was taken for success")


def test_the_placeholder_c_is_a_point_of_the_curve():
    """A 3.0 card refuses a C that is not a point (6A80): a random x is one only about half the time."""
    for i in range(64):
        nonce = secrets.token_bytes(32)
        card = make_card([(b"\x03", 0x9000)])
        assert _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--nonce", nonce.hex()])[0] == 0
        c = card.connection.last[5 + 44:5 + 77]
        x = int.from_bytes(c[1:], "big")
        # Euler's criterion: x^3 + 7 is a square mod p, so x is the x of a point
        assert c[0] == 0x02 and x < _SP and pow((x ** 3 + 7) % _SP, (_SP - 1) // 2, _SP) == 1, f"C {c.hex()} is no point"


def test_on_2_3_the_grant_alone_opens_no_load_and_6200_is_the_grant():
    card = _card23(has_owner=True)
    sent = len(card.connection.sent)
    try:
        _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--owner"])
    except SystemExit as exc:
        assert "--pin" in str(exc), str(exc)
    else:
        raise AssertionError("a load under the grant alone was sent to a 3.0 card")
    assert len(card.connection.sent) == sent, "nothing sent"
    card = make_card([(NONCE, 0x9000), (b"", 0x6200)])
    card.allow_load(OWNER)
    _check_owner_command(card, 0x45, "CashuCard/load", b"")


def test_set_pin_with_the_owner_is_refused_on_a_2_3_card_before_anything_is_sent():
    card = _card23(has_owner=True)
    sent = len(card.connection.sent)
    try:
        _run(card, ["set-pin", "5678", "--owner"])
    except SystemExit as exc:
        assert "change-pin" in str(exc), str(exc)
    else:
        raise AssertionError("set-pin --owner went to a 3.0 card")
    assert len(card.connection.sent) == sent


def test_set_owner_gives_the_pin_in_the_same_tap_before_the_held_claim():
    pub = p256.public_key(OWNER)
    card = make_card([(b"", 0x9000)] + [(b"", 0x6A98)] * 5 + [(b"", 0x9000)])
    assert _run(card, ["set-owner", "--pin", "1234", "--test-owner-key"])[0] == 0   # OWNER is cardctl's TEST key
    assert card.connection.sent == [bytes.fromhex("B040000004") + b"1234"] \
        + [bytes.fromhex("B0430000") + bytes([65]) + pub] * 6, [a.hex() for a in card.connection.sent]


def test_verify_pin_is_sent_again_while_the_card_says_keep_holding():
    apdu = bytes.fromhex("B0400000") + bytes([4]) + b"1234"
    card = make_card([(b"", 0x6A98)] * 40 + [(b"", 0x9000)])
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        card.verify_pin(b"1234")
    assert card.connection.sent == [apdu] * 41, len(card.connection.sent)
    assert err.getvalue().count("keep holding") == 1, err.getvalue()
    card = make_card([(b"", 0x6A98)] * 2 + [(b"", 0x63C1)])
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            card.verify_pin(b"1234")
    except cardctl.CardError as exc:
        assert exc.sw == 0x63C1 and len(card.connection.sent) == 3
    else:
        raise AssertionError("a wrong PIN after the wait was taken for a right one")
    # every command that gives the PIN goes through it: here, load --pin after a wait
    card = make_card([(b"", 0x6A98)] * 3 + [(b"", 0x9000), (b"\x05", 0x9000)])
    assert _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "1234"])[0] == 0
    assert [a[1] for a in card.connection.sent] == [0x40] * 4 + [0x30]


def test_group_keys_apdu_and_command():
    card = make_card([(bytes(98), 0x9000)])
    card.group_keys(1900000000)
    assert card.connection.last == bytes.fromhex("B01D000004") + (1900000000).to_bytes(4, "big") + b"\x62", \
        card.connection.last.hex()
    card = _card23(refund=True)
    code, out, _ = _run(card, ["group-keys", "--date", "1900000000", "--pin", "1234"])
    assert code == 0, out
    want = _group_keys_answer(_C, _smul(_CARD_SECKEY), _smul(_REFUND_R), 1900000000)
    assert f"t         : {want[:32].hex()}" in out and f"P + t*G   : {want[32:65].hex()}" in out, out
    assert f"R + u*G   : {want[65:].hex()}" in out and "checked" in out, out
    assert [a[1] for a in card.connection.sent[1:]] == [0x40, 0x1D, 0x10], [a.hex() for a in card.connection.sent]
    # the grant in place of the PIN; the date 0 has no refund key
    card = _card23(has_owner=True)
    code, out, _ = _run(card, ["group-keys", "--date", "0", "--owner", "--owner-key", f"{OWNER:064x}"])
    assert code == 0 and "R + u*G   : none" in out, out
    assert [a[1] for a in card.connection.sent[1:]] == [0x44, 0x45, 0x1D, 0x10]
    # neither: refused before the reader
    try:
        _run(make_card(), ["group-keys", "--date", "0"])
    except SystemExit as exc:
        assert "--pin" in str(exc)
    else:
        raise AssertionError("group-keys with neither the PIN nor the grant")


def test_card_secret_opens_the_refund_form_against_an_independent_vector():
    """A card with a refund key R: K = k*G and c XOR SHA-256(seal || 01 || x(k*R) || K || nonce || 16), opened by r*K."""
    k = 0x1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF
    big_k = _sec65(_smul(k))
    answer = big_k + _xor(_C, _seal(_smul(k, _smul(_REFUND_R)), big_k, _SEAL_NONCE))
    assert len(answer) == 97
    assert cardctl.open_card_secret(answer, _SEAL_NONCE, _REFUND_R) == _C
    assert cardctl.open_card_secret(answer, _SEAL_NONCE, _REFUND_R + 1) != _C, "another key opens nothing"
    # the whole command: the PIN (no owner, any tap), GET_NONCE P1 1, GET_CARD P1 3 with no data, checked by GROUP_KEYS
    card = _card23(refund=True)
    code, out, err = _run(card, ["card-secret", "--pin", "1234", "--refund-key", f"{_REFUND_R:064x}"])
    assert code == 0 and "checked" in out and _C.hex() not in out, out
    sent = card.connection.sent
    assert bytes.fromhex("B044010071") in sent and bytes.fromhex("B016030000") in sent, [a.hex() for a in sent]
    assert [a[1] for a in sent[1:]] == [0x01, 0x16, 0x40, 0x10, 0x44, 0x16, 0x1D], [a.hex() for a in sent]
    code, out, err = _run(_card23(refund=True), ["card-secret", "--pin", "1234", "--refund-key", f"{_REFUND_R:064x}",
                                                 "--show"])
    assert code == 0 and f"c         : {_C.hex()}" in out and "ties every payment" in err, (out, err)
    # an owned card: the grant, not the PIN
    card = _card23(has_owner=True, refund=True)
    code, out, _ = _run(card, ["card-secret", "--refund-key", f"{_REFUND_R:064x}", "--owner-key", f"{OWNER:064x}"])
    assert code == 0 and [a[1] for a in card.connection.sent[1:]][:5] == [0x01, 0x16, 0x44, 0x45, 0x10], out
    # a wrong refund key is refused before any PIN or grant
    card = _card23(refund=True)
    try:
        _run(card, ["card-secret", "--pin", "1234", "--refund-key", f"{_REFUND_R + 1:064x}"])
    except SystemExit as exc:
        assert "not the private key" in str(exc), str(exc)
    else:
        raise AssertionError("a wrong refund key was used")
    assert 0x40 not in [a[1] for a in card.connection.sent[1:]], "no PIN try spent"
    # n - r has the refund key's x and the other y: it would open c, and every refund signed with it would fail
    card = _card23(refund=True)
    try:
        _run(card, ["card-secret", "--pin", "1234", "--refund-key", f"{bip340.N - _REFUND_R:064x}"])
    except SystemExit as exc:
        assert "not the private key" in str(exc), str(exc)
    else:
        raise AssertionError("n - r, the refund key negated, was taken")
    assert 0x40 not in [a[1] for a in card.connection.sent[1:]], "no PIN try spent"


def test_card_secret_opens_the_e_form_against_an_independent_vector():
    """A card with no refund key: the reader's E (65), and c XOR SHA-256(seal || 01 || x(e*PIN key) || E || nonce || 16)."""
    e = 0x0FEDCBA987654321FEDCBA987654321FEDCBA987654321FEDCBA987654321F
    big_e = _sec65(_smul(e))
    answer = _xor(_C, _seal(_smul(e, _smul(_PIN_SECKEY)), big_e, _SEAL_NONCE))
    assert cardctl.open_card_secret(answer, _SEAL_NONCE, e, _sec33(_smul(_PIN_SECKEY))) == _C
    # the whole command, on an owned card with no refund key: the owner's grant, then the seal
    card = _card23(has_owner=True, refund=False)
    code, out, _ = _run(card, ["card-secret", "--owner-key", f"{OWNER:064x}", "--show"])
    assert code == 0 and f"c         : {_C.hex()}" in out, out
    sent = card.connection.sent
    assert [a[1] for a in sent[1:]] == [0x01, 0x16, 0x44, 0x45, 0x10, 0x44, 0x16, 0x1D], [a.hex() for a in sent]
    sealed = sent[-2]
    assert sealed[:5] == bytes.fromhex("B016030041") and sealed[5] == 0x04 and len(sealed) == 5 + 65 + 1, sealed.hex()
    # no owner, no refund key and not the first set-up: refused before the PIN
    card = _card23(refund=False)
    try:
        _run(card, ["card-secret", "--pin", "1234"])
    except SystemExit as exc:
        assert "first set-up" in str(exc), str(exc)
    else:
        raise AssertionError("c asked for outside the first set-up")
    assert 0x40 not in [a[1] for a in card.connection.sent[1:]]


# ── protocol 3.0: GET_INFO's longest form ────────────────────────────────────
def test_get_info_asks_p1_4_of_a_2_3_card_and_p1_2_of_an_older_one():
    for version, p1, answer in ((b"\x03\x00", 4, INFO_59), (b"\x03\x01", 4, INFO_59), (b"\x02\x02", 2, INFO_43),
                                (b"\x02\x01", 2, INFO_43)):
        card = make_card([(version, 0x9000), (answer, 0x9000)])
        card.select()
        card.get_info()
        assert card.connection.last == bytes([0xB0, 0x01, p1, 0x00, 0x00]), (version.hex(), card.connection.last.hex())
    # before any SELECT nothing is known of the card: the 2.0 form
    card = make_card([(INFO_43, 0x9000)])
    card.get_info()
    assert card.connection.last == bytes.fromhex("B001020000")


def test_get_info_decodes_the_59_and_51_byte_answers():
    i = cardctl.decode_info(INFO_59)
    assert i["version_tuple"] == (3, 0) and i["tag_off"] is False and i["allowance"] == 250
    assert i["keyset_table"] is True and i["rate"] == 95000 and i["entries"] == 3 and i["unmarked"] == 1
    assert i["last_unit"] == "the card's" and i["nopin_window_start"] == 1791700000
    assert i["profiles_raw"] == b"\xff\x03" and i["loads_left"] == 298
    assert i["profiles"] == ["PIN before money", "the no-PIN window", "the owner claimed slowly",
                             "the wait on every payment", "two units on one card", "a holder with no phone",
                             "keyset keys", "the paid list", "the certificate", "keys per load"], i["profiles"]
    body = bytearray(INFO_59)
    body[50], body[55], body[56] = 0xA0, 0x40, 0x02
    i = cardctl.decode_info(bytes(body))
    assert i["last_unit"] == "the other" and i["profiles"] == ["keyset keys", "keys per load"], i["profiles"]
    body[50] = 0
    assert cardctl.decode_info(bytes(body))["last_unit"] == "none"
    # P1 = 3's 51 bytes: the table, the rate, the entries and the last unit, and nothing of P1 = 4
    i = cardctl.decode_info(INFO_59[:51])
    assert i["rate"] == 95000 and i["last_unit"] == "the card's"
    assert "profiles" not in i and "loads_left" not in i and "nopin_window_start" not in i
    # fewer than 57 bytes to P1 = 4: no profiles
    assert "profiles" not in cardctl.decode_info(INFO_59[:56])
    assert "keyset_table" not in cardctl.decode_info(INFO_43)


def test_cmd_info_prints_the_2_3_fields():
    card = _change_card(has_owner=True)
    code, out, _ = _run(card, ["info"])
    assert code == 0, out
    assert "profiles         : FF03 (PIN before money," in out and "keys per load)" in out, out
    assert "loads left today : 298 of 300" in out and "rate             : 95000" in out, out
    assert "keyset table     : kept, 3 entries in use, 1 without the holder's mark" in out, out
    assert "no-PIN window    : from 1791700000" in out, out
    assert card.connection.sent[1] == bytes.fromhex("B001040000"), card.connection.sent[1].hex()


def test_selftest_on_a_2_3_card_checks_keys_per_load_and_prints_the_profiles():
    rc, out = run_selftest(FakeApplet(version=(3, 0)))
    assert rc == 0, out
    assert "PASS  keys per load (GET_INFO byte 56 bit 1)  — profiles FF03" in out, out
    assert "note  loads left today : 298 of 300" in out and "All 13 checks passed" in out, out
    applet = FakeApplet(version=(3, 0))
    applet.info_59 = INFO_59[:55] + b"\xff\x01" + INFO_59[57:]
    rc, out = run_selftest(applet)
    assert rc == 1 and "FAIL  keys per load" in out, out
    applet = FakeApplet(version=(3, 0))
    applet.info_59 = INFO_43
    rc, out = run_selftest(applet)
    assert rc == 1 and "fewer than 57 bytes" in out, out
    # a 2.1 card has no profiles to ask for, and no such check
    rc, out = run_selftest(FakeApplet(version=(2, 1)))
    assert rc == 0 and "keys per load" not in out and "All 12 checks passed" in out, out


# ── protocol 3.0: the card's own change ──────────────────────────────────────
def _change_row(n, amount, keyset, date, b_, k):
    return bytes([n]) + amount.to_bytes(4, "big") + keyset + date.to_bytes(4, "big") + b_ + k


_KS8 = bytes.fromhex("00ad268c4d1f5826")


def test_get_change_encoding_and_its_83_byte_rows():
    b_, k = _sec33(_smul(11)), _sec33(_smul(12))
    rows = _change_row(5, 64, _KS8, 1900000000, b_, k) + _change_row(7, 1, _KS8, 0, k, b_)
    card = make_card([(b"\x02" + rows, 0x9000)])
    got = card.get_change(1)
    assert card.connection.last == bytes.fromhex("B019010000"), card.connection.last.hex()
    assert got == [{"number": 5, "amount": 64, "keyset": _KS8, "date": 1900000000, "b_": b_, "k": k},
                   {"number": 7, "amount": 1, "keyset": _KS8, "date": 0, "b_": k, "k": b_}], got
    assert make_card([(b"\x00", 0x9000)]).get_change() == []
    # a count that does not match the bytes, an 80-byte opening of 2.2, an opening past 7: refused
    for body in (b"\x02" + rows[:83], b"\x01" + rows[:80], b"\x04" + rows * 2, _change_row(8, 1, _KS8, 0, k, b_)):
        try:
            make_card([(b"\x01" + body[1:] if body[0] == 8 else body, 0x9000)]).get_change()
        except SystemExit:
            pass
        else:
            raise AssertionError(f"GET_CHANGE answer {body[:2].hex()}… was taken")
    # a page past 255 and a card that SELECT says is 2.2 are refused before anything is sent
    for version, page in ((None, 256), (b"\x02\x02", 0)):
        card = make_card([(version, 0x9000)] if version else [])
        if version:
            card.select()
        sent = len(card.connection.sent)
        try:
            card.get_change(page)
        except SystemExit as exc:
            assert version is None or "2.2" in str(exc), str(exc)
        else:
            raise AssertionError(f"GET_CHANGE page {page} on {version}")
        assert len(card.connection.sent) == sent


def test_owed_change_pages_until_a_short_answer():
    k = _sec33(_smul(3))
    page = lambda *ns: bytes([len(ns)]) + b"".join(_change_row(n, 2 ** n, _KS8, 0, k, k) for n in ns)
    card = make_card([(page(0, 1, 2), 0x9000), (page(3, 4, 5), 0x9000), (page(6, 7), 0x9000)])
    assert [r["number"] for r in card.owed_change()] == list(range(8))
    assert [a[2] for a in card.connection.sent] == [0, 1, 2], "pages 0, 1 and 2, the last short"
    card = make_card([(page(0, 1, 2), 0x9000), (page(), 0x9000)])
    assert [r["number"] for r in card.owed_change()] == [0, 1, 2] and len(card.connection.sent) == 2
    # an opening let go between pages moves the rest up one: the one seen twice is listed once
    card = make_card([(page(0, 1, 2), 0x9000), (page(2, 4), 0x9000)])
    assert [r["number"] for r in card.owed_change()] == [0, 1, 2, 4]


def _g65(k):
    return _sec65(_smul(k))


def test_load_change_encoding_and_its_83_byte_answer():
    c_, k, e, s = _g65(5), _g65(6), bytes(range(32)), bytes(range(32, 64))
    piece = _KS8 + (8).to_bytes(4, "big") + bytes(range(100, 132)) + _sec33(_smul(7)) + (1900000000).to_bytes(4, "big")
    card = make_card([(bytes([9, 1]) + piece, 0x9000)])
    got = card.load_change(6, c_, k, e, s)
    assert card.connection.last == bytes.fromhex("B0270602C2") + c_ + k + e + s + b"\x53", card.connection.last.hex()
    assert got == {"slot": 9, "proof_kept": True, "piece": {
        "keyset_id": _KS8.hex(), "amount": 8, "nonce": bytes(range(100, 132)), "c": _sec33(_smul(7)),
        "date": 1900000000}}, got
    assert make_card([(bytes([9, 0]) + piece, 0x9000)]).load_change(0, c_, k, e, s)["proof_kept"] is False
    # every argument checked before anything is sent
    off_curve = b"\x04" + bytes(31) + b"\x01" + bytes(32)
    for args in ((8, c_, k, e, s), (-1, c_, k, e, s), (0, _sec33(_smul(5)), k, e, s), (0, c_, _sec33(_smul(6)), e, s),
                 (0, off_curve, k, e, s), (0, c_, off_curve, e, s), (0, c_, k, e[:31], s), (0, c_, k, e, s + b"\x00")):
        card = make_card([(bytes([9, 1]) + piece, 0x9000)])
        try:
            card.load_change(*args)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"LOAD_CHANGE sent with {args[0]}")
        assert card.connection.sent == []
    # a short answer is refused, and a 2.2 card is not asked
    try:
        make_card([(bytes([9, 1]) + piece[:80], 0x9000)]).load_change(0, c_, k, e, s)
    except SystemExit:
        pass
    else:
        raise AssertionError("an 82-byte answer was taken")
    card = make_card([(b"\x02\x02", 0x9000)])
    card.select()
    try:
        card.load_change(0, c_, k, e, s)
    except SystemExit as exc:
        assert "2.2" in str(exc)
    else:
        raise AssertionError("LOAD_CHANGE sent to a 2.2 card")
    assert len(card.connection.sent) == 1


def test_load_change_refusals_say_what_they_mean():
    for sw, words in ((0x6A86, "keys per load"), (0x6A9F, "keyset-keys FILE --show N"), (0x6A80, "mint's proof"),
                      (0x6A94, "let go"), (0x6A88, "not owed")):
        card = make_card([(b"", sw)])
        try:
            card.load_change(0, _g65(5), _g65(6), bytes(32), bytes(32))
        except cardctl.CardError as exc:
            assert exc.sw == sw and words in str(exc), str(exc)
        else:
            raise AssertionError(f"{sw:04X} was taken")
    # another command's words are its own
    assert cardctl.describe_sw(0x6A86, "LOAD_PROOF") == cardctl.SW_MEANINGS[0x6A86]
    assert "taught" in cardctl.describe_sw(0x6A9F, "KEYSET_KEYS begin")
    assert "no certificate" in cardctl.describe_sw(0x6A88, "CERT_READ page 0")
    assert "no payment begun" in cardctl.describe_sw(0x6985, "SPEND_ALL_CHANGE")
    # D200: LOAD_CHANGE is never refused for the day's loads, so it has no words of its own for 6A8F; SPEND_ALL_CHANGE has
    assert 0x6A8F not in cardctl.SW_COMMAND_MEANINGS["LOAD_CHANGE"] and 0x6A8F not in cardctl.LOAD_CHANGE_NEXT
    assert "300 loads" in cardctl.describe_sw(0x6A8F, "SPEND_ALL_CHANGE") and "no change" in cardctl.describe_sw(0x6A8F, "SPEND_ALL_CHANGE")


def test_spend_all_change_encoding_and_argument_checks():
    k = _sec33(_smul(9))
    card = make_card([(_sec33(_smul(10)), 0x9000)])
    assert card.spend_all_change(64, k, _KS8, CHANGE_MINT) == _sec33(_smul(10))
    assert card.connection.last == bytes.fromhex("B02600002D") + (64).to_bytes(4, "big") + k + _KS8 + b"\x21", \
        card.connection.last.hex()
    for args in ((0, k, _KS8), (2 ** 32, k, _KS8), (64, _g65(9), _KS8), (64, b"\x02" + bytes(32), _KS8),
                 (64, k, _KS8[:7])):
        card = make_card([(bytes(33), 0x9000)])
        try:
            card.spend_all_change(*args, CHANGE_MINT)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"SPEND_ALL_CHANGE sent with {args}")
        assert card.connection.sent == []
    try:
        make_card([(bytes(32), 0x9000)]).spend_all_change(64, k, _KS8, CHANGE_MINT)
    except SystemExit:
        pass
    else:
        raise AssertionError("a 32-byte B_ was taken")


# A whole LOAD_CHANGE as the applet's suite recorded it (CashuAppletTest, "A whole LOAD_CHANGE, recorded with a mint
# key whose private key is published"): the mint's key for 8 is 8*G, its DLEQ nonce 0x107; the card's APDUs and answers.
_LC_VECTOR = {
    "K": "022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01",
    "spend_all_change": "b02600002d00000008022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a0100f1e4f5c2b1a09021",
    "spend_all_change_response": "0214d74d45b98f556be3ecb84cb7b0570f0fa6815dca1d8251c43d7ae55b003758",
    "get_change_response": "01000000000800f1e4f5c2b1a090000000000214d74d45b98f556be3ecb84cb7b0570f0fa6815dca1d8251c43d7ae55b0037"
                           "58022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01",
    "load_change": "b0270002c2043d23f51fbd7a6e2e2d270450468fb69e0fb096ddf6ddc2a7744a2b69b4065de1b4fd673bf45286cd427f446da1f558"
                   "3195dcdd37fa71e0d276f0a2a4a49f454f042f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a015c4d"
                   "a8a741539949293d082a132d13b4c2e213d6ba5b7617b5da2cb76cbde90456befa8e9ead09858672757331d0c0375e961db21e"
                   "90868afd87ed1b62fba245b5f7d474f5684c2c3393ab998e8601bd7f5333c395f2f3e06c9aabc1777090ad53",
    "load_change_response": "020100f1e4f5c2b1a09000000008f60f52083006f305833a08f2d7b9a94614665a29cae239f8af980e36252db4"
                            "26030af3843a771002220ba6f792934279fb8bb1493f9f03e41b45c5bb4e498aeb1100000000",
    "C": "030af3843a771002220ba6f792934279fb8bb1493f9f03e41b45c5bb4e498aeb11",
}


def test_the_applets_recorded_load_change_is_the_wire_cardctl_speaks():
    v = {k: bytes.fromhex(h) for k, h in _LC_VECTOR.items()}
    assert v["K"] == _sec33(_smul(8)), "the mint's key for 8 is 8*G"
    keyset = v["spend_all_change"][-9:-1]
    card = make_card([(v["spend_all_change_response"], 0x9000)])
    assert card.spend_all_change(8, v["K"], keyset, CHANGE_MINT) == v["spend_all_change_response"]
    assert card.connection.last == v["spend_all_change"], card.connection.last.hex()
    row = make_card([(v["get_change_response"], 0x9000)]).get_change()[0]
    assert (row["number"], row["amount"], row["keyset"], row["date"]) == (0, 8, keyset, 0)
    assert row["b_"] == v["spend_all_change_response"] and row["k"] == v["K"]
    data = v["load_change"][5:-1]
    c_, k65, e, s = data[:65], data[65:130], data[130:162], data[162:]
    assert cardctl.dleq_holds(row["b_"], c_, k65, e, s), "the mint's proof holds for the opening's B_"
    card = make_card([(v["load_change_response"], 0x9000)])
    got = card.load_change(row["number"], c_, k65, e, s)
    assert card.connection.last == v["load_change"], card.connection.last.hex()
    assert got["slot"] == 2 and got["proof_kept"] and got["piece"]["c"] == v["C"] and got["piece"]["amount"] == 8
    # the mint's proof, made again here: e and s for k = 8 and the nonce 0x107
    mint_c_, mint_e, mint_s = _mint_answer(8, cardctl.point_from_bytes(row["b_"]), p=0x107)
    assert (_sec65(mint_c_), mint_e, mint_s) == (c_, e, s)


# The mint's answer for a blind message, worked out with the independent arithmetic above (NUT-12): C_ = k*B_,
# R1 = p*G, R2 = p*B_, e = SHA-256 of R1, R2, K and C_ uncompressed as lowercase hex text, s = p + e*k.
def _mint_answer(k, b_pt, p=0x6E0CE5):
    c_ = _smul(k, b_pt)
    r1, r2 = _smul(p), _smul(p, b_pt)
    e = _sha("".join(_sec65(pt).hex() for pt in (r1, r2, _smul(k), c_)).encode())
    s = (p + int.from_bytes(e, "big") * k) % _SN
    return c_, e, s.to_bytes(32, "big")


def test_dleq_holds_for_the_mints_proof_and_for_nothing_else():
    b_pt = _smul(0xB1)
    c_, e, s = _mint_answer(0x51, b_pt)
    k = _sec33(_smul(0x51))
    assert cardctl.dleq_holds(_sec33(b_pt), _sec65(c_), k, e, s)
    assert cardctl.dleq_holds(_sec33(b_pt), _sec33(c_), _sec65(_smul(0x51)), e, s), "either form of a point"
    assert not cardctl.dleq_holds(_sec33(_smul(0xB2)), _sec65(c_), k, e, s), "another B_"
    assert not cardctl.dleq_holds(_sec33(b_pt), _sec65(c_), _sec33(_smul(0x52)), e, s), "another K"
    assert not cardctl.dleq_holds(_sec33(b_pt), _sec65(c_), k, e, (int.from_bytes(s, "big") + 1).to_bytes(32, "big"))
    assert not cardctl.dleq_holds(_sec33(b_pt), _sec65(c_), k, _xor(e, b"\x01" + bytes(31)), s)


# ── protocol 3.0: a keyset's keys ─────────────────────────────────────────────
import hashlib as _hashlib
import pathlib as _pathlib
import re as _re

_KEYSET_TEST = (_pathlib.Path(__file__).resolve().parents[2] / "applet" / "src" / "test" / "java" / "me" / "flashapp"
                / "cashu" / "KeysetKeysTest.java")


def _ci_keysets():
    """The CI mint's keysets the applet's KeysetKeysTest records: the 64 keys for 2^0 to 2^63, the version 01 ID with
    its tail, and the version 00 ID of the same keys."""
    src = _KEYSET_TEST.read_text(encoding="utf-8")
    block = src[src.index("CI_KEYS = {"):src.index("};", src.index("CI_KEYS = {"))]
    keys = [(1 << i, bytes.fromhex(h)) for i, h in enumerate(_re.findall(r'"(0[23][0-9a-f]{64})"', block))]
    return (keys, _re.search(r'CI_V01_ID = "([0-9a-f]{66})"', src).group(1),
            _re.search(r'CI_V01_TAIL = "([^"]+)"', src).group(1), _re.search(r'CI_V00_ID = "([0-9a-f]{16})"', src).group(1))


def _leaf(amount, k):
    return _sha(b"\x00", amount.to_bytes(8, "big"), k)


def _subtree(leaves, lo, size):
    """The top of the subtree of `size` leaves from `lo`, the leaves padded with SHA-256(02): worked out by halves."""
    if size == 1:
        return leaves[lo] if lo < len(leaves) else _sha(b"\x02")
    half = size // 2
    return _sha(b"\x01", _subtree(leaves, lo, half), _subtree(leaves, lo + half, half))


def _width(n):
    return 1 << (n - 1).bit_length() if n > 1 else 1


def _ind_top(keys):
    leaves = [_leaf(a, k) for a, k in keys]
    return _subtree(leaves, 0, _width(len(leaves)))


def _ind_path(keys, index):
    """Leaf `index`'s path: at each height h, the top of the sibling subtree of 2^h leaves."""
    leaves = [_leaf(a, k) for a, k in keys]
    return [_subtree(leaves, ((index >> h) ^ 1) << h, 1 << h) for h in range(_width(len(leaves)).bit_length() - 1)]


def _ind_fold(leaf, index, path):
    for h, sib in enumerate(path):
        leaf = _sha(b"\x01", sib, leaf) if (index >> h) & 1 else _sha(b"\x01", leaf, sib)
    return leaf


def _mint_keys(n, salt, amounts=None):
    """A mint's keyset of n keys, private keys salt*1000 + i + 1, amounts 2^i unless given."""
    amounts = amounts or [1 << i for i in range(n)]
    priv = [salt * 1000 + i + 1 for i in range(n)]
    return [(a, _sec33(_smul(p))) for a, p in zip(amounts, priv)], dict(zip(amounts, priv))


def test_keyset_ids_are_the_ones_the_applets_vectors_record():
    keys, v01, tail, v00 = _ci_keysets()
    assert len(keys) == 64 and tail == "|unit:sat|input_fee_ppk:100"
    assert cardctl.keyset_id(1, keys, tail.encode()).hex() == v01
    assert cardctl.keyset_id(0, keys).hex() == v00
    assert cardctl.keyset_tail("sat", 100) == tail.encode()
    assert cardctl.keyset_id(1, keys, cardctl.keyset_tail("sat")).hex() != v01, "the fee is in the ID"
    assert cardctl.keyset_tail("usd", 0, 1900000000) == b"|unit:usd|final_expiry:1900000000"


def test_the_keyset_tree_against_an_independent_build():
    ci = _ci_keysets()[0]
    for keys in (ci, ci[:7], ci[:3], ci[:1], ci[:2], ci[:33], _mint_keys(7, 4, [1, 2, 5, 10, 20, 50, 100])[0]):
        top = cardctl.keyset_levels(keys)[-1][0]
        assert top == _ind_top(keys), len(keys)
        for i in range(len(keys)):
            path = cardctl.keyset_path(keys, i)
            assert path == _ind_path(keys, i), (len(keys), i)
            assert _ind_fold(_leaf(*keys[i]), i, path) == top, (len(keys), i)
            assert cardctl.fold_path(cardctl.keyset_leaf(*keys[i]), i, path) == top
        if len(keys) > 1:
            assert cardctl.fold_path(cardctl.keyset_leaf(*keys[0]), 1, cardctl.keyset_path(keys, 0)) != top, \
                "an index off by one does not reach the top"
    # a single key is its own top; seven keys pad one leaf with SHA-256(02)
    assert cardctl.keyset_levels(ci[:1])[-1][0] == _leaf(*ci[0]) and cardctl.keyset_path(ci[:1], 0) == []
    assert cardctl.keyset_levels(ci[:7])[0][7] == _hashlib.sha256(b"\x02").digest()


def test_keyset_keys_encodings():
    keys, v01, tail, v00 = _ci_keysets()
    card = make_card()
    card.keyset_keys_begin(bytes.fromhex(v01[:16]), tail.encode())
    card.keyset_keys_begin(bytes.fromhex(v00))
    card.keyset_keys_keys(keys[:6])
    card.keyset_keys_keys(keys[63:])
    sent = card.connection.sent
    assert sent[0] == bytes.fromhex("B0380000") + bytes([8 + len(tail)]) + bytes.fromhex(v01[:16]) + tail.encode()
    assert sent[1] == bytes.fromhex("B038000008") + bytes.fromhex(v00), "no Le, no tail"
    assert sent[2] == bytes.fromhex("B0380100F6") + b"".join(a.to_bytes(8, "big") + k for a, k in keys[:6])
    assert sent[3] == bytes.fromhex("B038010029") + (1 << 63).to_bytes(8, "big") + keys[63][1]
    card = make_card([(bytes.fromhex(v01), 0x9000)])
    assert card.keyset_keys_finish().hex() == v01 and card.connection.last == bytes.fromhex("B038020000")
    path = [bytes([i]) * 32 for i in range(3)]
    card = make_card()
    card.keyset_keys_show(4, 5, path)
    card.keyset_keys_show(4, 5, path, keys[2][1])
    card.keyset_keys_show(4, 5, path, keys[2][1], _KS8)
    card.keyset_keys_show(0, 0, [])
    sent = card.connection.sent
    assert sent[0] == bytes.fromhex("B0380300") + bytes([3 + 96, 4, 5, 3]) + b"".join(path)
    assert sent[1] == bytes.fromhex("B0380300") + bytes([3 + 96 + 33, 4, 5, 3]) + b"".join(path) + keys[2][1]
    assert sent[2] == bytes.fromhex("B0380300") + bytes([3 + 96 + 41, 4, 5, 3]) + b"".join(path) + keys[2][1] + _KS8
    assert sent[3] == bytes.fromhex("B038030003000000")


def test_keyset_keys_arguments_are_checked_before_anything_is_sent():
    keys = _ci_keysets()[0]
    path = [bytes(32)] * 2
    bad = (
        ("keyset_keys_begin", (bytes(7),)), ("keyset_keys_begin", (bytes(8), b"|unit:sat")),
        ("keyset_keys_begin", (b"\x02" + bytes(7),)), ("keyset_keys_begin", (b"\x01" + bytes(7), b"")),
        ("keyset_keys_begin", (b"\x01" + bytes(7), b"|unit:eur")), ("keyset_keys_begin", (b"\x01" + bytes(7), b"|unit:sats")),
        ("keyset_keys_begin", (b"\x01" + bytes(7), b"|unit:sat|" + b"x" * 55)),
        ("keyset_keys_keys", ([],)), ("keyset_keys_keys", (keys[:7],)), ("keyset_keys_keys", ([(0, keys[0][1])],)),
        ("keyset_keys_keys", ([(2 ** 64, keys[0][1])],)), ("keyset_keys_keys", ([(1, _g65(3))],)),
        ("keyset_keys_show", (8, 0, path)), ("keyset_keys_show", (0, 4, path)), ("keyset_keys_show", (0, 0, [bytes(32)] * 7)),
        ("keyset_keys_show", (0, 0, [bytes(31)])), ("keyset_keys_show", (0, 0, path, None, _KS8)),
        ("keyset_keys_show", (0, 0, path, _g65(3))), ("keyset_keys_show", (0, 0, path, keys[0][1], bytes(7))),
    )
    for method, args in bad:
        card = make_card()
        try:
            getattr(card, method)(*args)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"{method}{args!r:.80} was sent")
        assert card.connection.sent == [], method
    # the widest tail a version 01 ID takes, and the units it names
    for tail in (b"|unit:sat|" + b"x" * 54, b"|unit:usd", b"|unit:sat|input_fee_ppk:100"):
        make_card().keyset_keys_begin(b"\x01" + bytes(7), tail)
    try:
        make_card([(bytes(9), 0x9000)]).keyset_keys_finish()
    except SystemExit:
        pass
    else:
        raise AssertionError("a 9-byte ID was taken")


def _keyset_file(tmp, name, ks_id, unit, keys, **more):
    path = _pathlib.Path(tmp) / name
    doc = {"id": ks_id, "unit": unit, "keys": {str(a): k.hex() for a, k in keys}}
    doc.update(more)
    path.write_text(__import__("json").dumps(doc), encoding="utf-8")
    return str(path)


def test_read_keyset_file_checks_the_keys_against_the_id():
    import json as _json
    import tempfile
    keys, v01, tail, v00 = _ci_keysets()
    with tempfile.TemporaryDirectory() as tmp:
        got = cardctl.read_keyset_file(_keyset_file(tmp, "v01.json", v01, "sat", keys[::-1], input_fee_ppk=100))
        assert got["id"].hex() == v01 and got["keys"] == keys and got["tail"] == tail.encode() and got["unit"] == "sat"
        got = cardctl.read_keyset_file(_keyset_file(tmp, "v00.json", v00, "sat", keys))
        assert got["id"].hex() == v00 and got["tail"] == b""
        # GET /v1/keys's shape, one keyset; the fee from the command line
        p = _pathlib.Path(tmp) / "keys.json"
        p.write_text(_json.dumps({"keysets": [{"id": v01, "unit": "sat", "keys": {str(a): k.hex() for a, k in keys}}]}))
        assert cardctl.read_keyset_file(str(p), 100)["id"].hex() == v01
        for path, words in (
                (str(p), "--input-fee-ppk"),                                                 # the fee left out
                (_keyset_file(tmp, "a.json", v01, "usd", keys, input_fee_ppk=100), "hash to"),  # another unit
                (_keyset_file(tmp, "b.json", v01, "eur", keys, input_fee_ppk=100), "unit"),
                (_keyset_file(tmp, "c.json", v00, "sat", keys[1:]), "2^n"),
                (_keyset_file(tmp, "d.json", v00[:-2] + "00", "sat", keys), "hash to"),
                (_keyset_file(tmp, "e.json", v00, "sat", keys + [(1 << 64, keys[0][1])]), "1 to 64"),
                (_keyset_file(tmp, "f.json", v00, "sat", [(1, b"\x02" + bytes(32))]), "not a point"),
                (_keyset_file(tmp, "g.json", "02" + v00[2:], "sat", keys), "version 00"),
        ):
            try:
                cardctl.read_keyset_file(path)
            except SystemExit as exc:
                assert words in str(exc), (path, str(exc))
            else:
                raise AssertionError(f"{path} was taken")


# ── protocol 3.0: the certificate ─────────────────────────────────────────────
def test_cert_read_reads_the_state_then_the_pages_to_the_length():
    container = bytes(range(256)) * 2 + bytes(range(76))
    card = make_card([(b"\x01\x01\x02\x4c", 0x9000), (container[:256], 0x9000), (container[256:512], 0x9000),
                      (container[512:], 0x9000)])
    got = card.cert_read()
    assert got == {"sealed": True, "version": 1, "length": 588, "container": container}
    assert card.connection.sent == [bytes.fromhex(h) for h in ("B01CFF0000", "B01C000000", "B01C010000", "B01C020000")]
    card = make_card([(b"\x00\x00\x00\x00", 0x9000)])
    assert card.cert_read() == {"sealed": False, "version": 0, "length": 0, "container": b""}
    assert len(card.connection.sent) == 1, "no page asked of a card with none sealed"
    # exactly 256: one page
    card = make_card([(b"\x01\x01\x01\x00", 0x9000), (bytes(256), 0x9000)])
    assert len(card.cert_read()["container"]) == 256 and len(card.connection.sent) == 2
    for answers in ([(b"\x01\x01\x02\x4c", 0x9000), (bytes(255), 0x9000)],          # a short page
                    [(b"\x01\x01\x04\x01", 0x9000)],                                 # past four pages
                    [(b"\x01\x01\x00", 0x9000)],                                     # a state of 3 bytes
                    [(b"\x01\x01\x00\x10", 0x9000), (bytes(17), 0x9000)]):           # a page past the length
        try:
            make_card(answers).cert_read()
        except SystemExit:
            pass
        else:
            raise AssertionError(f"CERT_READ answers {answers[0][0].hex()} were taken")


# ── protocol 3.0: a model card that owes change and is taught keys ───────────
class Card23Change(Card23):
    """
    Card23, and as far as the card's own change goes: GET_CHANGE of its openings, LOAD_CHANGE checking the bound key,
    the mint's proof and unblinding with r, KEYSET_KEYS teaching (the ID and the tree's top worked out by the
    independent build above) and showing by folding a path, and CERT_READ. Any other command gives a teaching up.
    """

    def __init__(self, **kw):
        super().__init__(**kw)
        self.openings = {}
        self.entries = {}
        self.teaching = None
        self.paid = False
        self.cert = b""

    def owe(self, n, amount, keyset, k33, date=1900000000, r=0x2A2A, b=0xB_0B):
        self.openings[n] = {"amount": amount, "keyset": keyset, "date": date, "nonce": bytes([n]) * 32, "r": r,
                            "b": _smul(b), "k": k33, "shown": False}

    def _answer(self, apdu):
        ins, p1, p2 = apdu[1], apdu[2], apdu[3]
        data = apdu[5:5 + apdu[4]] if len(apdu) > 5 else b""
        if ins != cardctl.INS_KEYSET_KEYS:
            self.teaching = None
        if ins == cardctl.INS_GET_BALANCE:
            return (24).to_bytes(4, "big"), 0x9000
        if ins == cardctl.INS_GET_CHANGE:
            rows = [(n, o) for n, o in sorted(self.openings.items())][3 * p1:3 * p1 + 3]
            return bytes([len(rows)]) + b"".join(_change_row(n, o["amount"], o["keyset"], o["date"], _sec33(o["b"]),
                                                             o["k"]) for n, o in rows), 0x9000
        if ins == cardctl.INS_LOAD_CHANGE:
            return self._load_change(p1, p2, data)
        if ins == cardctl.INS_KEYSET_KEYS:
            return self._keyset_keys(p1, data)
        if ins == cardctl.INS_CERT_READ:
            if p2 or not (p1 <= 3 or p1 == 0xFF):
                return b"", 0x6A86
            if p1 == 0xFF:
                return bytes([int(bool(self.cert))] * 2) + len(self.cert).to_bytes(2, "big"), 0x9000
            if not self.cert:
                return b"", 0x6A88
            if p1 * 256 >= len(self.cert):
                return b"", 0x6A83
            return self.cert[p1 * 256:p1 * 256 + 256], 0x9000
        return super()._answer(apdu)

    def _load_change(self, p1, p2, data):
        if not p2 & 0x02:
            return b"", 0x6A86
        if p1 > 7:
            return b"", 0x6A83
        if p1 not in self.openings:
            return b"", 0x6A88
        if len(data) != 194:
            return b"", 0x6700
        o = self.openings[p1]
        if not o["shown"]:
            return b"", 0x6A9F
        c_, big_k = _from65(data[:65]), _from65(data[65:130])
        if data[65] != 4 or _sec33(big_k) != o["k"]:
            return b"", 0x6A80
        if any((p[1] * p[1] - p[0] ** 3 - 7) % _SP for p in (c_, big_k)):
            return b"", 0x6A80
        e, s = int.from_bytes(data[130:162], "big") % _SN, int.from_bytes(data[162:194], "big")
        r1 = _sadd(_smul(s), _smul(_SN - e, big_k))
        r2 = _sadd(_smul(s, o["b"]), _smul(_SN - e, c_))
        if _sha("".join(_sec65(p).hex() for p in (r1, r2, big_k, c_)).encode()) != data[130:162]:
            return b"", 0x6A80
        c = _sadd(c_, _smul(_SN - o["r"], big_k))
        del self.openings[p1]
        piece = o["keyset"] + o["amount"].to_bytes(4, "big") + o["nonce"] + _sec33(c) + o["date"].to_bytes(4, "big")
        return bytes([12, 1]) + piece, 0x9000

    def _keyset_keys(self, p1, data):
        if self.pin_state == 0:
            return b"", 0x6A97
        if p1 == 3:
            return self._show(data)
        if p1 > 2:
            self.teaching = None
            return b"", 0x6A86
        if not self.verified:
            return b"", 0x6982
        if p1 == 0:
            self.teaching = None
            if not 8 <= len(data) <= 72:
                return b"", 0x6700
            ks, tail = data[:8], data[8:]
            if ks not in self.entries:
                return b"", 0x6A88
            if ks[0] not in (0, 1):
                return b"", 0x6A80
            if ks[0] == 0 and tail:
                return b"", 0x6700
            if ks[0] == 1 and not (tail[:9] == b"|unit:sat" and tail[9:10] in (b"", b"|")):
                return b"", 0x6A80
            self.teaching = {"keyset": ks, "tail": tail, "keys": []}
            return b"", 0x9000
        t, self.teaching = self.teaching, None
        if t is None:
            return b"", 0x6985
        if p1 == 1:
            if not data or len(data) % 41 or len(data) > 246:
                return b"", 0x6700
            for at in range(0, len(data), 41):
                amount = int.from_bytes(data[at:at + 8], "big")
                if (t["keys"] and amount <= t["keys"][-1][0]) or amount == 0 or len(t["keys"]) == 64:
                    return b"", 0x6A80
                if t["keyset"][0] == 0 and amount != 1 << len(t["keys"]):
                    return b"", 0x6A80
                t["keys"].append((amount, data[at + 8:at + 41]))
            self.teaching = t
            return b"", 0x9000
        if not t["keys"]:
            return b"", 0x6A80
        if t["keyset"][0] == 0:
            worked = b"\x00" + _sha(*[k for _, k in t["keys"]])[:7]
        else:
            text = ",".join(str(a) + ":" + k.hex() for a, k in t["keys"]).encode() + t["tail"]
            worked = b"\x01" + _sha(text)
        if worked[:8] != t["keyset"]:
            return b"", 0x6A80
        self.entries[t["keyset"]] = _ind_top(t["keys"])
        return worked, 0x9000

    def _show(self, data):
        if len(data) < 3:
            return b"", 0x6700
        n, index, depth = data[0], data[1], data[2]
        if n > 7:
            return b"", 0x6A83
        if n not in self.openings:
            return b"", 0x6A88
        path, more = data[3:3 + 32 * depth], data[3 + 32 * depth:]
        if depth > 6 or len(more) not in (0, 33, 41):
            return b"", 0x6700
        o = self.openings[n]
        target = more[33:] if len(more) == 41 else o["keyset"]
        if o["keyset"] not in self.entries or self.entries.get(target) is None:
            return b"", 0x6A9F
        if more and not (self.verified and self.grant):
            return b"", 0x6982
        if more and self.paid:
            return b"", 0x6985
        key = more[:33] if more else o["k"]
        leaf = _leaf(o["amount"], key)
        if _ind_fold(leaf, index, [path[i:i + 32] for i in range(0, len(path), 32)]) != self.entries[target]:
            return b"", 0x6A80
        if more:
            o["k"], o["keyset"] = key, target
        o["shown"] = True
        return b"", 0x9000


def _change_card(**kw):
    card = make_card()
    card.connection = Card23Change(**kw)
    card.select()
    return card


def _mint_v01(salt=7, n=7):
    """A mint's version 01 keyset of n keys (no fee), its ID and its private keys by amount."""
    keys, priv = _mint_keys(n, salt)
    text = ",".join(f"{a}:{k.hex()}" for a, k in keys) + "|unit:sat"
    return keys, "01" + _sha(text.encode()).hex(), priv


def test_change_lists_every_opening_owed():
    keys, ks_id, _ = _mint_v01()
    card = _change_card()
    ks8 = bytes.fromhex(ks_id[:16])
    for n in (0, 2, 3, 5, 6):
        card.connection.owe(n, 1 << n, ks8, keys[n][1], b=0xB0 + n)
    code, out, _ = _run(card, ["change"])
    assert code == 0, out
    for n in (0, 2, 3, 5, 6):
        assert f"opening {n} : {1 << n}  keyset {ks_id[:16]}  date 1900000000" in out, out
        assert f"  B_      : {_sec33(_smul(0xB0 + n)).hex()}" in out and f"  K       : {keys[n][1].hex()}" in out
    assert "5 owed" in out, out
    assert [a[2] for a in card.connection.sent if a[1] == 0x19] == [0, 1], "two pages, the second short"
    code, out, _ = _run(_change_card(), ["change"])
    assert code == 0 and "no change owed" in out, out


def test_a_holder_teaches_the_keys_shows_the_key_and_loads_the_change():
    """The whole round on the model card: load-change refused until the key is shown (6A9F, explained), keyset-keys
    teaches under the PIN (the ID checked), --show folds the path with no PIN, and load-change writes the piece whose
    C is C_ - r*K, worked out here on its own."""
    import json as _json
    import tempfile
    keys, ks_id, priv = _mint_v01()
    ks8 = bytes.fromhex(ks_id[:16])
    card = _change_card()
    card.connection.entries[ks8] = None
    card.connection.owe(2, 8, ks8, keys[3][1], r=0x5151, b=0xB2)
    b_pt = _smul(0xB2)
    c_, e, s = _mint_answer(priv[8], b_pt)
    answer = ["load-change", "2", "--c", _sec33(c_).hex(), "--k", keys[3][1].hex(), "--e", e.hex(), "--s", s.hex()]
    try:
        _run(card, answer)
    except SystemExit as exc:
        assert "6A9F" in str(exc) and "keyset-keys FILE --show N" in str(exc), str(exc)
    else:
        raise AssertionError("LOAD_CHANGE taken with the key not shown")
    with tempfile.TemporaryDirectory() as tmp:
        path = _keyset_file(tmp, "mint.json", ks_id, "sat", keys)
        try:
            _run(card, ["keyset-keys", path])
        except SystemExit as exc:
            assert "--pin" in str(exc)
        else:
            raise AssertionError("taught with no PIN")
        before = len(card.connection.sent)
        code, out, _ = _run(card, ["keyset-keys", path, "--pin", "1234"])
        assert code == 0 and f"taught    : 7 keys of keyset {ks_id}" in out, out
        assert [(a[1], a[2]) for a in card.connection.sent[before:]] == [(0x40, 0), (0x38, 0), (0x38, 1), (0x38, 1),
                                                                         (0x38, 2)], "six keys, then one"
        assert card.connection.entries[ks8] == _ind_top(keys)
        code, out, _ = _run(card, ["keyset-keys", path, "--show", "2"])
        assert code == 0 and "shown     : opening 2's key" in out and card.connection.openings[2]["shown"], out
        show = card.connection.sent[-1]
        assert show[:4] == bytes.fromhex("B0380300") and show[5:8] == bytes([2, 3, 3]), show.hex()
        assert [show[8 + 32 * i:8 + 32 * i + 32] for i in range(3)] == _ind_path(keys, 3)
    code, out, _ = _run(card, answer)
    assert code == 0, out
    want_c = _sadd(_smul(priv[8], b_pt), _smul(_SN - 0x5151, _smul(priv[8])))
    assert f"C         : {_sec33(want_c).hex()}" in out and "loaded into slot 12" in out, out
    assert "amount    : 8" in out and "date      : 1900000000" in out and 2 not in card.connection.openings, out
    sent = card.connection.sent[-1]
    assert sent[:5] == bytes.fromhex("B0270202C2") and sent[5:70] == _sec65(c_) and sent[-1] == 0x53, sent.hex()


def test_load_change_checks_the_bound_key_and_the_mints_proof_before_the_card():
    keys, ks_id, priv = _mint_v01()
    ks8 = bytes.fromhex(ks_id[:16])
    card = _change_card()
    card.connection.owe(1, 4, ks8, keys[2][1], b=0xB1)
    c_, e, s = _mint_answer(priv[4], _smul(0xB1))
    for argv, words in (
            (["load-change", "3", "--c", _sec33(c_).hex(), "--k", keys[2][1].hex(), "--e", e.hex(), "--s", s.hex()],
             "not owed"),
            (["load-change", "1", "--c", _sec33(c_).hex(), "--k", keys[3][1].hex(), "--e", e.hex(), "--s", s.hex()],
             "not the key opening 1 is bound to"),
            (["load-change", "1", "--c", _sec33(_smul(5)).hex(), "--k", keys[2][1].hex(), "--e", e.hex(), "--s",
              s.hex()], "does not hold"),
    ):
        before = len(card.connection.sent)
        try:
            _run(card, argv)
        except SystemExit as exc:
            assert words in str(exc), str(exc)
        else:
            raise AssertionError(f"{argv} was taken")
        assert 0x27 not in [a[1] for a in card.connection.sent[before:]], "LOAD_CHANGE not sent"
    # malformed arguments: refused before the reader
    for argv in (["load-change", "8", "--c", "02" * 33, "--k", "02" * 33, "--e", "00" * 32, "--s", "00" * 32],
                 ["load-change", "1", "--c", "05" + "00" * 32, "--k", keys[2][1].hex(), "--e", e.hex(), "--s", s.hex()],
                 ["load-change", "1", "--c", _sec33(c_).hex(), "--k", keys[2][1].hex(), "--e", e.hex()[:62], "--s",
                  s.hex()]):
        fresh = make_card()
        try:
            _run(fresh, argv)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"{argv} was taken")
        assert fresh.connection.sent == []


# ── the card's change only at a mint that gives it back (NUT-12 and NUT-09) ───
# Nutshell 0.20.3's own GET /v1/info `nuts`, as a local FakeWallet mint answered it (2026-11-14).
NUTSHELL_INFO = {"name": "Cashu mint", "version": "Nutshell/0.20.3", "nuts": {
    "4": {"methods": [{"method": "bolt11", "unit": "sat"}], "disabled": False},
    "5": {"methods": [{"method": "bolt11", "unit": "sat"}], "disabled": False},
    "7": {"supported": True}, "8": {"supported": True}, "9": {"supported": True}, "10": {"supported": True},
    "11": {"supported": True}, "12": {"supported": True}, "14": {"supported": True}, "20": {"supported": True}}}


def _without(info, nut, value=None):
    """A copy of a mint's info whose `nuts` lack `nut`, or hold `value` for it."""
    import copy
    out = copy.deepcopy(info)
    if value is None:
        del out["nuts"][nut]
    else:
        out["nuts"][nut] = value
    return out


def test_the_cards_change_is_asked_only_at_a_mint_that_says_nut_12_and_nut_09():
    """A mint that gives no DLEQ burns the inputs and answers change nobody can load; one with no restore leaves a lost
    swap answer lost. SPEND_ALL_CHANGE is refused, with nothing sent, unless the mint's /v1/info says both."""
    k = _sec33(_smul(9))
    assert cardctl.change_mint_problem(NUTSHELL_INFO) is None
    card = make_card([(_sec33(_smul(10)), 0x9000)])
    assert card.spend_all_change(64, k, _KS8, NUTSHELL_INFO) == _sec33(_smul(10))
    for info, words in ((_without(NUTSHELL_INFO, "12"), "NUT-12"),
                        (_without(NUTSHELL_INFO, "12", {"supported": False}), "NUT-12"),
                        (_without(NUTSHELL_INFO, "12", {"supported": "yes"}), "NUT-12"),
                        (_without(NUTSHELL_INFO, "9"), "NUT-09"),
                        ({"name": "a mint", "nuts": {}}, "NUT-12, the DLEQ proof LOAD_CHANGE needs or NUT-09"),
                        ({"name": "a mint"}, "names no nuts"),
                        (None, "names no nuts")):
        assert words in (cardctl.change_mint_problem(info) or ""), (info, cardctl.change_mint_problem(info))
        card = make_card([(_sec33(_smul(10)), 0x9000)])
        try:
            card.spend_all_change(64, k, _KS8, info)
        except SystemExit as exc:
            assert words in str(exc) and "exact amount" in str(exc) and "lost for good" in str(exc), str(exc)
        else:
            raise AssertionError(f"SPEND_ALL_CHANGE asked at a mint whose info is {info}")
        assert card.connection.sent == [], "nothing sent"


def test_fetch_mint_info_reads_the_mints_own_word_on_its_nuts():
    """A till reads GET /v1/info before it asks for change: a fake mint that omits NUT-12 is refused by what it says."""
    import json as _json
    import urllib.request

    asked = []

    def fake(info):
        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return _json.dumps(info).encode()

        def urlopen(req, timeout=None):
            asked.append(req.full_url)
            return Resp()
        return urlopen

    real = urllib.request.urlopen
    try:
        urllib.request.urlopen = fake(_without(NUTSHELL_INFO, "12"))
        info = cardctl.fetch_mint_info("http://127.0.0.1:3338/")
        assert asked == ["http://127.0.0.1:3338/v1/info"], asked
        assert "NUT-12" in cardctl.change_mint_problem(info)
        urllib.request.urlopen = fake(NUTSHELL_INFO)
        assert cardctl.change_mint_problem(cardctl.fetch_mint_info("http://127.0.0.1:3338")) is None
        urllib.request.urlopen = fake(["not", "an", "object"])
        try:
            cardctl.fetch_mint_info("http://127.0.0.1:3338")
        except SystemExit as exc:
            assert "no object" in str(exc), str(exc)
        else:
            raise AssertionError("a /v1/info that is no object was taken")

        def down(req, timeout=None):
            raise OSError("connection refused")
        urllib.request.urlopen = down
        try:
            cardctl.fetch_mint_info("http://127.0.0.1:3338")
        except SystemExit as exc:
            assert "did not answer /v1/info" in str(exc) and "connection refused" in str(exc), str(exc)
        else:
            raise AssertionError("a mint that did not answer was taken")
    finally:
        urllib.request.urlopen = real


def test_load_change_takes_the_mints_answer_and_one_with_no_dleq_points_at_restore():
    """load-change --signature: one entry of the swap's (or a NUT-09 restore's) signatures. With its DLEQ the card loads
    it; without, cardctl says so plainly and names NUT-09 restore, with nothing sent to the card."""
    import json as _json
    import tempfile
    keys, ks_id, priv = _mint_v01()
    ks8 = bytes.fromhex(ks_id[:16])
    c_, e, s = _mint_answer(priv[8], _smul(0xB2))
    with_dleq = {"amount": 8, "id": ks_id, "C_": _sec33(c_).hex(), "dleq": {"e": e.hex(), "s": s.hex()}}
    no_dleq = {"amount": 8, "id": ks_id, "C_": _sec33(c_).hex()}
    for sig in (no_dleq, dict(no_dleq, dleq=None), dict(no_dleq, dleq={"e": e.hex()})):
        card = _change_card()
        card.connection.owe(2, 8, ks8, keys[3][1], r=0x5151, b=0xB2)
        before = len(card.connection.sent)
        try:
            _run(card, ["load-change", "2", "--k", keys[3][1].hex(), "--signature", _json.dumps(sig)])
        except SystemExit as exc:
            text = str(exc)
            assert "no DLEQ proof (NUT-12" in text and "NUT-09" in text and "/v1/restore" in text, text
            assert "opening 2" in text and "stays owed" in text, text
        else:
            raise AssertionError(f"a signature with no DLEQ was taken: {sig}")
        assert card.connection.sent[before:] == [], "nothing sent, not even SELECT"
        assert 2 in card.connection.openings
    # with its DLEQ, from a file as the mint's answer is kept: the card loads it
    card = _change_card()
    card.connection.owe(2, 8, ks8, keys[3][1], r=0x5151, b=0xB2)
    card.connection.openings[2]["shown"] = True
    with tempfile.TemporaryDirectory() as tmp:
        path = f"{tmp}/sig.json"
        with open(path, "w") as f:
            _json.dump(with_dleq, f)
        code, out, _ = _run(card, ["load-change", "2", "--k", keys[3][1].hex(), "--signature", path])
    assert code == 0 and "loaded into slot 12" in out and 2 not in card.connection.openings, out
    assert card.connection.sent[-1][5:70] == _sec65(c_)
    # the mint's answer is given once: --signature with --c, or neither, is refused before the reader
    for argv in (["load-change", "2", "--k", keys[3][1].hex(), "--signature", _json.dumps(with_dleq), "--c",
                  _sec33(c_).hex()],
                 ["load-change", "2", "--k", keys[3][1].hex(), "--c", _sec33(c_).hex()]):
        fresh = make_card()
        try:
            _run(fresh, argv)
        except SystemExit as exc:
            assert "--signature" in str(exc), str(exc)
        else:
            raise AssertionError(f"{argv} was taken")
        assert fresh.connection.sent == []


# ── the versions cardctl drives (D205) ───────────────────────────────────────
def _connect_with(answer, command):
    """The real connect, its SELECT answered `answer`, for `command`: (card or the SystemExit, stderr, APDUs sent)."""
    card = make_card([(answer, 0x9000)])
    real = cardctl.Card
    cardctl.Card = lambda *a, **kw: card
    err = io.StringIO()
    args = types.SimpleNamespace(reader=0, verbose=False, legacy=False, command=command)
    try:
        with contextlib.redirect_stderr(err):
            try:
                got = cardctl.connect(args)
            except SystemExit as exc:
                got = exc
    finally:
        cardctl.Card = real
    return got, err.getvalue(), card.connection.sent


def test_connect_drives_no_02_03_card_as_2_2_for_a_command_that_moves_money_or_sets_up():
    """A card answering 02 03 speaks 3.0's wire from before its renumbering (D205). Driven as 2.2 it would be read with
    GET_INFO P1 2, its outbox checked against GET_PUBKEY, and set up with the old clock check: every command that moves
    money or sets a card up is refused at SELECT, saying what it answered and what cardctl knows. The reads go on."""
    commands = set(cardctl.build_parser()._subparsers._group_actions[0].choices)
    writes = commands - cardctl.READ_ONLY_COMMANDS - {"readers", "tip", "selftest", "dump", "load-file"}
    assert {"load", "load-change", "keyset-keys", "clear-spent", "setup", "set-pin", "set-card", "set-owner",
            "set-owner-url", "set-limit", "change-pin", "reset", "refresh", "lock", "set-header"} == writes, writes
    for answer in (b"\x02\x03", b"\x02\x04", b"\x02\xFF"):
        for command in sorted(writes) + [None]:
            got, _, sent = _connect_with(answer, command)
            assert isinstance(got, SystemExit), (answer, command)
            text = str(got)
            assert f"answers version 2.{answer[1]}" in text and "knows 2.0, 2.1, 2.2, 3.0" in text, text
            assert "02 03" in text and "D205" in text and "nothing was sent after SELECT" in text, text
            assert len(sent) == 1 and sent[0][1] == 0xA4, [a.hex() for a in sent]
        for command in sorted(cardctl.READ_ONLY_COMMANDS):
            got, err, _ = _connect_with(answer, command)
            assert isinstance(got, cardctl.Card) and not got.at_least(3, 0), (answer, command)
            assert "note:" in err and "may be wrong" in err and "02 03" in err, err


def test_connect_takes_every_minor_of_3_as_3_0_and_the_known_versions_as_before():
    """D205: a reader takes every minor of a major it was built for. A 3.1 card is driven as 3.0 by every command
    (at_least(3, 0) holds), while selftest still refuses to pass a version it does not know: a statement about the test,
    not the wire. 2.0, 2.1, 2.2 and 3.0 connect for every command as before, with no note; 4.0 and 1.x for none."""
    for answer in (b"\x02\x00", b"\x02\x01", b"\x02\x02", b"\x03\x00", b"\x03\x01", b"\x03\x07"):
        for command in ("load", "setup", "reset", "info", None):
            got, err, _ = _connect_with(answer, command)
            assert isinstance(got, cardctl.Card), (answer, command, got)
            assert err == "", err
            assert got.at_least(3, 0) == (answer[0] == 3)
    assert cardctl.driven_as(b"\x03\x01") == (3, 1) and cardctl.driven_as(b"\x02\x03") is None
    assert cardctl._select_verdict(b"\x03\x01")[0] is False
    for answer in (b"\x04\x00", b"\x01\x14"):
        for command in ("load", "info"):
            got, _, _ = _connect_with(answer, command)
            assert isinstance(got, SystemExit) and "speaks protocols 2.x and 3.x" in str(got), (answer, command)


def test_load_with_date_keys_is_refused_on_a_card_older_than_3_0_before_the_pin():
    """--date-keys is 3.0's word (LOAD_PROOF P2 02). A 2.2 card signs with P alone, so a piece locked to a date's key is
    one it can never pay: refused before VERIFY_PIN, so no try is spent and nothing is written."""
    for version in (b"\x02\x01", b"\x02\x02"):
        card = make_card([(b"", 0x9000), (b"\x03", 0x9000)])
        card.version = version
        try:
            _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "1234", "--date-keys"])
        except SystemExit as exc:
            assert "--date-keys is protocol 3.0's" in str(exc) and f"version 2.{version[1]}" in str(exc), str(exc)
        else:
            raise AssertionError("a 2.x card was sent P2 02")
        assert card.connection.sent == [], [a.hex() for a in card.connection.sent]
        card = make_card([(b"\x03", 0x9000)])
        card.version = version
        try:
            card.load_proof(bytes.fromhex("0059534ce0bfa19a"), 8, bytes(32), cardctl.placeholder_c(bytes(32)), 0,
                            date_keys=True)
        except SystemExit as exc:
            assert "no keys per date" in str(exc), str(exc)
        else:
            raise AssertionError("load_proof sent P2 02 to a 2.x card")
        assert card.connection.sent == []
        # without --date-keys, a 2.2 card loads as it did (P2 00)
        card = make_card([(b"", 0x9000), (b"\x03", 0x9000)])
        card.version = version
        assert _run(card, ["load", "--keyset", "0059534ce0bfa19a", "--amount", "16", "--pin", "1234"])[0] == 0
        assert card.connection.last[:4] == bytes.fromhex("B0300000"), card.connection.last.hex()


def test_reset_warns_that_ecash_swapped_to_the_cards_keys_and_not_loaded_is_lost():
    """A reset draws a new c: eCash a wallet swapped to this card's keys and has not loaded can never be loaded after it,
    lost for good undated, the refund key's after its date where dated. Said before every reset, --yes or not, by the
    PIN and by the owner's proof."""
    def said(err):
        assert "warning:" in err and "new c" in err and "not yet loaded" in err, err
        assert "undated (the date 0), it is lost for good" in err and "refund key" in err and "card-secret" in err, err

    conn, card = _setup_card(refuse={cardctl.INS_SET_CARD: 0x6F00})
    try:
        _run(card, _setup_args())
    except SystemExit:
        pass
    card.select()
    code, _, err = _run(card, ["reset", "--pin", "1234", "--yes"])
    assert code == 0 and conn.pin_state == 0
    said(err)
    conn, card = _owned_reset_card()
    code, _, err = _run(card, ["reset", "--owner-key", f"{OWNER:064x}", "--yes"])
    assert code == 0 and conn.got
    said(err)
    # asked, and declined: the warning is given before the question, and nothing is reset
    import builtins
    conn, card = _owned_reset_card()
    real = builtins.input
    builtins.input = lambda prompt="": "no"
    try:
        code, out, err = _run(card, ["reset", "--owner-key", f"{OWNER:064x}"])
    finally:
        builtins.input = real
    assert code == 1 and "aborted" in out and not conn.got, (out, conn.got)
    said(err)


def test_a_holder_rebinds_an_opening_to_the_mints_key_and_moves_it_to_another_keyset():
    import tempfile
    keys, ks_id, priv = _mint_v01()
    ks8 = bytes.fromhex(ks_id[:16])
    old8 = bytes.fromhex("01" + "ee" * 7)
    made_up = _sec33(_smul(0x7A11))
    card = _change_card(has_owner=True)
    card.connection.entries[ks8] = None
    card.connection.entries[old8] = None
    card.connection.owe(4, 16, ks8, made_up)
    card.connection.owe(5, 32, old8, keys[5][1])
    with tempfile.TemporaryDirectory() as tmp:
        path = _keyset_file(tmp, "mint.json", ks_id, "sat", keys)
        assert _run(card, ["keyset-keys", path, "--pin", "1234"])[0] == 0
        for argv, words in ((["keyset-keys", path, "--show", "4"], "--rebind binds it"),
                            (["keyset-keys", path, "--show", "5"], "--rebind moves it"),
                            (["keyset-keys", path, "--show", "4", "--rebind", "--pin", "1234"], "--owner")):
            try:
                _run(card, argv)
            except SystemExit as exc:
                assert words in str(exc), str(exc)
            else:
                raise AssertionError(f"{argv} was taken")
        owner = ["--owner", "--owner-key", f"{OWNER:064x}"]
        code, out, _ = _run(card, ["keyset-keys", path, "--show", "4", "--rebind", "--pin", "1234", *owner])
        assert code == 0 and "(bound to it now)" in out, out
        assert card.connection.openings[4]["k"] == keys[4][1] and card.connection.openings[4]["shown"]
        assert card.connection.sent[-1][-33:] == keys[4][1]
        code, out, _ = _run(card, ["keyset-keys", path, "--show", "5", "--rebind", "--pin", "1234", *owner])
        assert code == 0 and "(moved to that keyset)" in out, out
        assert card.connection.openings[5]["keyset"] == ks8 and card.connection.sent[-1][-41:] == keys[5][1] + ks8


def test_keyset_keys_refuses_a_2_2_card_and_a_card_that_works_out_another_id():
    import tempfile
    keys, ks_id, _ = _mint_v01()
    with tempfile.TemporaryDirectory() as tmp:
        path = _keyset_file(tmp, "mint.json", ks_id, "sat", keys)
        card = make_card([(b"\x02\x02", 0x9000)])
        card.select()
        try:
            _run(card, ["keyset-keys", path, "--pin", "1234"])
        except SystemExit as exc:
            assert "3.0" in str(exc), str(exc)
        else:
            raise AssertionError("a 2.2 card was taught")
        assert len(card.connection.sent) == 1
        card = make_card([(b"\x03\x00", 0x9000)] + [(b"", 0x9000)] * 4 + [(bytes(33), 0x9000)])
        card.select()
        code, out, _ = _run(card, ["keyset-keys", path, "--pin", "1234"])
        assert code == 1 and "not the file's" in out, out


def test_cert_prints_the_container_and_its_sha256():
    card = _change_card()
    card.connection.cert = bytes(range(256)) + b"CCP-CERT" * 10
    code, out, _ = _run(card, ["cert"])
    assert code == 0, out
    assert f"sealed, version 1, {len(card.connection.cert)} bytes" in out, out
    assert f"container   : {card.connection.cert.hex()}" in out, out
    assert f"sha256      : {_hashlib.sha256(card.connection.cert).hexdigest()}" in out, out
    assert [a[2] for a in card.connection.sent if a[1] == 0x1C] == [0xFF, 0, 1]
    code, out, _ = _run(_change_card(), ["cert"])
    assert code == 0 and "none sealed" in out, out


def test_the_vectors_pieces_carry_their_dates_keys_worked_out_from_c():
    """spec/vectors/secret.json: each piece's t, key P + t*G and refund key R + u*G (33 zeros for the date 0) are the
    ones c, the card key and the refund key give for its date, by the independent arithmetic here and by cardctl's
    date_keys; and each piece's signature is by its date's key."""
    import json as _json
    vec = _json.loads((_pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "secret.json").read_text())
    c, card_key, refund_key = bytes.fromhex(vec["c"]), bytes.fromhex(vec["cardKey"]), bytes.fromhex(vec["refundKey"])
    assert c == bytes(range(32))
    card_pt = cardctl.point_from_bytes(card_key)
    refund_pt = cardctl.point_from_bytes(refund_key)
    dates = set()
    for piece in vec["pieces"]:
        ind = _group_keys_answer(c, card_pt, refund_pt, piece["date"])
        assert (piece["t"], piece["key"], piece["refund"]) == (ind[:32].hex(), ind[32:65].hex(), ind[65:].hex()), piece
        mine = cardctl.date_keys(c, card_key, refund_key, piece["date"])
        assert (mine["t"].hex(), mine["key"].hex(), mine["refund"].hex()) == (piece["t"], piece["key"], piece["refund"])
        assert piece["key"] != vec["cardKey"], "never the card key itself"
        if "signature" in piece:
            assert _sha((piece["secret"] + piece["C"]).encode()).hex() == piece["message"], piece["date"]
            assert cardctl.check_signature(bytes.fromhex(piece["key"]), bytes.fromhex(piece["message"]),
                                           bytes.fromhex(piece["signature"])), piece["date"]
        dates.add(piece["date"])
    assert 0 in dates and len(dates) > 1, "an undated piece and a dated one"


def test_the_inbox_vector_is_the_label_c_and_w_as_four_bytes_big_endian():
    """spec/vectors/inbox.json: for each week, the name is SHA-256("CashuCard/inbox" || c || W), W the week as four bytes,
    big-endian; the bytes hashed, the name and the card's answer (the name, then W, then 9000) agree, for two weeks."""
    import json as _json
    vec = _json.loads((_pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "inbox.json").read_text())
    c = bytes.fromhex(vec["c"])
    assert c == bytes(range(32)) and vec["label"] == "CashuCard/inbox"
    assert vec["command"] == "%02x%02x000024" % (0xB0, cardctl.INS_INBOX)
    weeks = vec["weeks"]
    assert len(weeks) == 2 and weeks[1]["week"] == weeks[0]["week"] + 1, "two weeks in a row"
    for w in weeks:
        assert w["week"] == w["time"] // 604800
        wb = w["week"].to_bytes(4, "big")
        assert w["W"] == wb.hex()
        assert w["hashed"] == (b"CashuCard/inbox" + c + wb).hex()
        assert w["name"] == _sha(b"CashuCard/inbox" + c + wb).hex()
        assert w["response"] == w["name"] + wb.hex() + "9000"


def test_info_reads_no_loads_left_from_the_zeros_a_reader_not_told_is_given():
    """GET_INFO P1 4 bytes 57 and 58 are zeros to a reader not given the PIN or the grant (D198): `info` says "none, or
    not said" for them, never "0 of 300", and the count where the card says one."""
    assert cardctl.info_23_lines({"loads_left": 0}) == ["loads left today : none, or not said (zeros to a reader not given the PIN or the grant)"]
    assert cardctl.info_23_lines({"loads_left": 298}) == ["loads left today : 298 of 300"]


def test_the_pickup_vector_is_the_label_the_nonces_and_rand16_and_the_auth_verifies():
    """spec/vectors/pickup.json (D199): m is the first 16 bytes of SHA-256("CashuCard/pickup" || the nonces in the order
    loaded || rand16); the proof is k || the nonces || rand16 || the card's AUTH answer, whose signature verifies under the
    card key over SHA-256(T || T || m || the card's 16 bytes || P), T = SHA-256("CashuCard/auth")."""
    import hashlib
    import json as _json
    vec = _json.loads((pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "pickup.json").read_text())
    assert vec["label"] == "CashuCard/pickup"
    nonces = [bytes.fromhex(n) for n in vec["nonces"]]
    rand16 = bytes.fromhex(vec["rand16"])
    assert len(nonces) == 2 and all(len(n) == 32 for n in nonces) and len(rand16) == 16
    hashed = b"CashuCard/pickup" + b"".join(nonces) + rand16
    assert vec["hashed"] == hashed.hex()
    m = hashlib.sha256(hashed).digest()[:16]
    assert vec["m"] == m.hex()
    assert vec["auth"] == "b0150000" + "10" + m.hex() + "50"
    answer = bytes.fromhex(vec["answer"])
    proof = bytes.fromhex(vec["proof"])
    assert proof == bytes([len(nonces)]) + b"".join(nonces) + rand16 + answer and len(answer) == 80
    p = bytes.fromhex(vec["cardKey"])
    t = hashlib.sha256(b"CashuCard/auth").digest()
    msg = hashlib.sha256(t + t + m + answer[:16] + p).digest()
    assert bip340.verify(p[1:], msg, answer[16:]), "the AUTH answer's signature, under P"
    assert not bip340.verify(p[1:], hashlib.sha256(t + t + bytes(16) + answer[:16] + p).digest(), answer[16:]), "and over m only"


# ── the owner's c (3.0, D202) ────────────────────────────────────────────────
def _owner_c_vector():
    import json as _json_c
    import pathlib as _pathlib_c
    return _json_c.loads((_pathlib_c.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "owner-c.json").read_text())


def test_the_owner_c_vector_is_worked_out_again_here_from_the_words():
    """spec/vectors/owner-c.json (one run of the card's own test, kept): the seed from the words, s, the PIN key
    signed by the card key, the envelope to the PIN key with the vector's e, the check, c for n = 1, and the card's own
    GROUP_KEYS answer for the date, all made again here by cardctl's own code, which shares none of the card's or the
    Java test's."""
    v = _owner_c_vector()
    seed = cardctl.seed_from_words(v["words"])
    assert seed.hex() == v["seed"], "BIP-39's seed of the words"
    p = bytes.fromhex(v["cardKey"])
    s = cardctl.owner_s(seed, p)
    assert s.hex() == v["s"]
    q = bytes.fromhex(v["pinKey"])
    assert q != p and cardctl.pin_key_signed(p, q, bytes.fromhex(v["pinKeySig"])), "the PIN key, signed by the card key"
    assert cardctl.scalar_mul(int(v["e"], 16), cardctl.point_from_bytes(q))[0].to_bytes(32, "big").hex() == v["x"], "x(e*Q)"
    env = cardctl.owner_c_envelope(s, q, int(v["e"], 16))
    assert env.hex() == v["envelope"] and env[:65].hex() == v["E"] and len(env) == cardctl.OWNER_C_ENVELOPE_LEN
    assert bytes.fromhex(v["stage"]) == bytes.fromhex("B0430100") + bytes([113]) + env, "SET_OWNER P1 1 and the envelope"
    assert cardctl.owner_c_check(s).hex() == v["check"]
    c = cardctl.owner_c(s, v["n"])
    assert c.hex() == v["c"]
    assert cardctl.owner_c_count(s, c) == 1
    # the card's own keys for the date, under that c: t, P + t*G, and R + u*G, R the vector's refund key (G: r = 1)
    keys = cardctl.date_keys(c, p, bytes.fromhex(v["refundKey"]), v["date"])
    assert keys["t"] + keys["key"] + keys["refund"] == bytes.fromhex(v["groupKeys"]), "the card's GROUP_KEYS answer"
    u = cardctl.date_tweak(cardctl.LABEL_REFUND_KEY, c, v["date"])
    assert cardctl.point_compressed(cardctl.scalar_mul((1 + u) % bip340.N)) == keys["refund"], "r + u spends the date's refund key"


def test_the_owner_c_from_other_words_or_another_card_or_another_count_is_another_c():
    v = _owner_c_vector()
    p = bytes.fromhex(v["cardKey"])
    s = cardctl.owner_s(bytes.fromhex(v["seed"]), p)
    other_words = cardctl.owner_s(cardctl.seed_from_words("legal winner thank year wave sausage worth useful legal winner thank yellow"), p)
    other_card = cardctl.owner_s(bytes.fromhex(v["seed"]), cardctl.point_compressed(cardctl.scalar_mul(7)))
    seen = {cardctl.owner_c(x, n) for x in (s, other_words, other_card) for n in (1, 2, 3)}
    assert len(seen) == 9, "nine different c"
    assert cardctl.owner_c_count(other_words, cardctl.owner_c(s, 1), most=64) is None
    assert cardctl.owner_c_count(s, cardctl.owner_c(s, 5)) == 5
    for bad in (bytes(63), bytes(65)):
        try:
            cardctl.owner_s(bad, p)
        except SystemExit:
            pass
        else:
            raise AssertionError("a seed that is not 64 bytes was taken")
    # an envelope opens to s with the card's private key: d*E = e*P
    d = 0x1234
    pk = cardctl.point_compressed(cardctl.scalar_mul(d))   # a PIN key
    env = cardctl.owner_c_envelope(s, pk)
    x = cardctl.scalar_mul(d, cardctl.point_from_bytes(env[:65]))[0].to_bytes(32, "big")
    assert cardctl.owner_c_block(0, x, env[:65], env[65:97])[:16] == env[97:], "the tag"
    assert bytes(a ^ b for a, b in zip(env[65:97], cardctl.owner_c_block(1, x, env[:65]))) == s, "s opened"
    assert cardctl.owner_c_envelope(s, pk)[:65] != env[:65], "a fresh e each time"


def test_a_claim_with_the_owners_c_sends_the_envelope_then_the_held_claim_with_the_check():
    """setup / set-owner --owner-seed on a card with no owner: GET_PUBKEY, SET_OWNER P1 1 with the envelope to that
    key, then the claim, held, its value the key and the check (and the anchor between them where one is given)."""
    with contextlib.redirect_stderr(io.StringIO()):
        v = _owner_c_vector()
        p = bytes.fromhex(v["cardKey"])
        s = bytes.fromhex(v["s"])
        pub = p256.public_key(OWNER)
        header = bytes(range(80))
        pin_answer = NONCE + bytes.fromhex(v["pinKey"]) + bytes.fromhex(v["pinKeySig"])
        card = make_card([(p, 0x9000), (pin_answer, 0x9000), (b"", 0x9000)] + [(b"", 0x6A98)] * 5 + [(b"", 0x9000)])
        card.set_owner(pub, header, s=s)
        sent = card.connection.sent
        assert sent[0][:4] == bytes.fromhex("B0100000"), sent[0].hex()
        assert sent[1] == bytes.fromhex("B0440100") + bytes([113]), "GET_NONCE P1 1: the PIN key"
        assert sent[2][:5] == bytes.fromhex("B043010071") and len(sent[2]) == 5 + 113, sent[2][:5].hex()
        claim = bytes.fromhex("B0430000") + bytes([65 + 80 + 16]) + pub + header + bytes.fromhex(v["check"])
        assert sent[3:] == [claim] * 6, "the claim, the same data six times"
        env = sent[2][5:]
        assert env[0] == 4 and env[:65] != bytes.fromhex(v["E"]), "a fresh e"
        # a card whose PIN key is not signed by its key is sent no envelope
        bad = NONCE + bytes.fromhex(v["pinKey"]) + bytes(64)
        card = make_card([(p, 0x9000), (bad, 0x9000)])
        try:
            card.set_owner(pub, header, s=s)
        except SystemExit:
            pass
        else:
            raise AssertionError("an envelope to an unsigned PIN key was sent")
        assert len(card.connection.sent) == 2, "nothing after GET_NONCE P1 1"


def test_a_hand_over_with_the_next_owners_c_puts_the_envelope_between_the_nonce_and_the_proof():
    """--old-owner-key with --owner-seed: GET_PUBKEY, GET_NONCE P1 1 (the PIN key, and the sixteen bytes the proof is
    over), SET_OWNER P1 1 (nothing between it and SET_OWNER, which would let it go), then SET_OWNER with the last owner's
    proof over the key and the check."""
    v = _owner_c_vector()
    p = bytes.fromhex(v["cardKey"])
    s = bytes.fromhex(v["s"])
    pub = p256.public_key(OWNER)
    card = make_card([(p, 0x9000), (NONCE + bytes.fromhex(v["pinKey"]) + bytes.fromhex(v["pinKeySig"]), 0x9000)])
    card.set_owner(pub, None, old_owner=OWNER, s=s)
    sent = card.connection.sent
    assert sent[0][:4] == bytes.fromhex("B0100000")
    assert sent[1] == bytes.fromhex("B0440100") + bytes([113]), "the PIN key and the nonce first"
    assert sent[2][:5] == bytes.fromhex("B043010071"), "then the envelope"
    last = sent[3]
    data = last[5:5 + last[4]]
    proof, rest = data[1:1 + data[0]], data[1 + data[0]:]
    assert rest == pub + bytes.fromhex(v["check"]), "the key and the check after the proof"
    assert p256.verify(p256.public_key(OWNER), b"CashuCard/set-owner" + NONCE + rest, proof), "the proof covers the check"


def test_set_owner_and_setup_take_owner_seed_and_card_secret_checks_it():
    parser = cardctl.build_parser()
    for argv in (["set-owner", "--test-owner-key", "--owner-seed", "00" * 64],
                 ["setup", "--pin", "1234", "--mint", "https://m", "--test-owner-key", "--owner-seed", "00" * 64],
                 ["set-owner-url", "--test-owner-key", "--owner-seed", "00" * 64],
                 ["card-secret", "--refund-key", "01" * 32, "--owner-seed", "00" * 64, "--date", "1900000000"]):
        args = parser.parse_args(argv)
        assert cardctl._owner_seed(args) == bytes(64), argv[0]
    args = parser.parse_args(["set-owner", "--test-owner-key", "--owner-seed", "00" * 63])
    try:
        cardctl._owner_seed(args)
    except SystemExit:
        pass
    else:
        raise AssertionError("a seed of 63 bytes was taken")
    # --date wants the seed and the refund key, refused before the reader
    args = parser.parse_args(["card-secret", "--date", "1900000000"])
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            cardctl.cmd_card_secret(args)
    except SystemExit as exc:
        assert "--owner-seed" in str(exc)
    else:
        raise AssertionError("--date with no seed went on")


def test_a_setup_whose_c_is_not_the_owners_names_the_reset_and_not_the_limits():
    """r13b 7: where the c read back is not the owner's, setup stops naming the owner's reset, and its state line does
    not then say the card is set up but for the limits, nor ask for them."""
    seed = bytes(range(64))
    conn, card = _setup_card()
    conn.planted_s = bytes(32)
    try:
        _run(card, _setup_args("--owner-seed", seed.hex(), "--day", "50000", "--payment", "0", "--allowance", "0",
                               "--budget", "7"))
    except SystemExit as exc:
        text = str(exc)
        assert "reset --owner-key" in text and "send it no limits" in text, text
        assert "set up but for the limits" not in text and "set-limit" not in text, text
    else:
        raise AssertionError("a c that is not the owner's was said to be")
    assert conn.limits is None, "no limits sent"


def test_refresh_says_when_the_header_itself_is_weak():
    """r13b 7: a REFRESH whose header is weak to the card (less than half the work of its hardest, or before any less
    than twice the floor's) moves no clock, and refresh says the header is weak, not that the clock is."""
    weak = bytearray(_ANCHOR)
    weak[72:76] = cardctl.FLOOR_BITS.to_bytes(4, "little")
    assert cardctl.header_is_weak(bytes(weak), bytes(4)) and cardctl.header_is_weak(bytes(weak), _ANCHOR[72:76])
    assert not cardctl.header_is_weak(_ANCHOR, bytes(4)) and not cardctl.header_is_weak(_ANCHOR, _ANCHOR[72:76])
    # two thirds of the hardest's work (its target half again the hardest's): not weak; just over twice its target: weak
    two_thirds = bytearray(_ANCHOR)
    two_thirds[72:76] = (0x17032E68).to_bytes(4, "little")
    assert not cardctl.header_is_weak(bytes(two_thirds), _ANCHOR[72:76])
    over = bytearray(_ANCHOR)
    over[72:76] = (0x17043DE1).to_bytes(4, "little")
    assert cardctl.header_is_weak(bytes(over), _ANCHOR[72:76])
    conn = HolderRefreshCard()
    conn.pin, conn.pin_state, conn.clock = b"1234", 1, 3_000_000_000
    card = make_card()
    card.connection = conn
    card.select()
    code, out, _ = _run(card, ["refresh", "--pin", "1234", "--header", bytes(weak).hex()])
    assert code == 0 and "did not move" in out and "header is weak" in out and "reset --pin" not in out, out


def test_the_take_back_line_names_both_margins_and_a_reader_two_days_slow():
    """r13b 1 and 7: card-secret --date says the owner takes back from D + 86,400 by the network's tip, before which
    only a reader two days slow pays a piece (one a day slow leaves it out at D + 86,400), and that readers leave the
    date's pieces out from D - 86,400, before which the holder's move ends."""
    line = cardctl.take_back_line(1_900_000_000, "02" + "ab" * 32)
    assert "1900086400" in line and "1899913600" in line, line
    assert "two days slow" in line and "a day slow" not in line, line
    assert "move" in line, line


def test_6b00_is_said_for_the_command_that_got_it():
    """r13b 7: 6B00 names what was wrong for each command, and only RESET_CARD and LOCK_CARD a confirming byte."""
    reset = cardctl.describe_sw(0x6B00, "RESET_CARD")
    assert "AD" in reset and "confirming" in reset, reset
    assert "DE" in cardctl.describe_sw(0x6B00, "LOCK_CARD")
    for command, want in (("REFRESH", "01 (the holder's)"), ("SET_OWNER", "a P2 other than 00")):
        text = cardctl.describe_sw(0x6B00, command)
        assert want in text and "confirm" not in text, (command, text)
    assert "confirm" not in cardctl.describe_sw(0x6B00, "GET_CARD")
    assert "confirm" not in str(cardctl.CardError(0x6B00, "REFRESH")), str(cardctl.CardError(0x6B00, "REFRESH"))


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and isinstance(fn, types.FunctionType):
            try:
                fn()
                print(f"PASS  {name}")
            # Not just AssertionError. cardctl reports operator errors by raising
            # SystemExit, and a parser/command mismatch surfaces as AttributeError
            # — both were verified to escape an AssertionError-only handler, kill
            # the run with no summary line, and silently skip every later test.
            # A detected regression must read as a FAIL, not as a crash.
            # SystemExit is spelled out because it derives from BaseException, not
            # Exception; everything else a test can raise is already covered.
            except (SystemExit, Exception) as exc:
                failures += 1
                print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
                if not isinstance(exc, (AssertionError, SystemExit)):
                    traceback.print_exc()
    print(f"\n{'all tests passed' if not failures else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)

