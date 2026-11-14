#!/usr/bin/env python3
"""
Asserts that spec/APDU.md, cardctl.py and CashuApplet.java still agree, and
that the applet builds the card proof secrets NUT-CCP states, for protocol 2.0.

This repo's characteristic bug is not a crash — it is a document and an
implementation drifting apart while both look fine on their own. It happened
three times on the 0.x wire:

  * `keyset_id` documented as ASCII bytes, so the driver ASCII-encoded it and
    stored half a NUT-02 id. Every test passed; every loaded proof was
    unspendable.
  * the 32-byte field documented as the "secret", which cannot fit — it is the
    nonce.
  * `SPEND_PROOF`'s message documented as something other than what the NUT
    specified.

Each one was found by a human reading two files side by side. These tests do
it on every push, for the 2.0 wire.

Three artefacts have to agree, so all three are read here:

  * spec/APDU.md is *parsed*, never imported from — a shared constant cannot
    catch a doc that lies, and the doc is what implementers read. The core,
    NUT-CCP, is CCP.md in cashucard/nut: its two card proof secrets are quoted
    below (CCP_SECRET_PLAIN, CCP_SECRET_DATED), and the applet is held to them.
  * cardctl.py is *driven*, not read: the documented header, Lc/Le, response
    sizes and field order are checked against the bytes the real encoder puts
    on the wire. Completeness ratchets fail the day a command cardctl drives is
    added to the doc and to cardctl but not to the case tables here.
  * CashuApplet.java's constants are scraped with a regex — no JVM needed —
    because the applet is the copy that writes EEPROM.

docs/HARDWARE_DEPLOYMENT.md is read for the version a good card answers.

Runs with no card, no reader and no pyscard.
"""
import json
import pathlib
import re
import sys
import traceback

import bip340
import cardctl
import p256
from test_apdu import make_card, INFO_43, INFO_59, CARD_ANSWER, _group_keys_answer

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC_DIR = ROOT / "spec"
APDU_MD = SPEC_DIR / "APDU.md"
# NUT-CCP's card proof secrets, as CCP.md states them under "Card proofs"
# (https://github.com/cashucard/nut/blob/main/CCP.md#card-proofs). A change to
# them starts there; this copy changes with the applet that implements it.
CCP_SECRET_PLAIN = '["P2PK",{"nonce":"<nonce>","data":"<date key>","tags":[["sigflag","SIG_ALL"]]}]'
CCP_SECRET_DATED = ('["P2PK",{"nonce":"<nonce>","data":"<date key>","tags":[["locktime","<date>"],'
                    '["refund","<date refund key>"],["sigflag","SIG_ALL"]]}]')
SECRET_JSON = SPEC_DIR / "vectors" / "secret.json"
APPLET_JAVA = ROOT / "applet" / "src" / "main" / "java" / "me" / "flashapp" / "cashu" / "CashuApplet.java"
DEPLOYMENT_MD = ROOT / "docs" / "HARDWARE_DEPLOYMENT.md"

_FIELD_KEYWORDS = (
    ("status", r"status"),
    ("keyset_id", r"keyset"),
    ("amount", r"amount"),
    ("nonce", r"nonce"),
    ("date", r"date"),
    ("c", r"\bc\b"),
)


def _apdu_text() -> str:
    return APDU_MD.read_text(encoding="utf-8")


def _applet_text() -> str:
    return APPLET_JAVA.read_text(encoding="utf-8")


def _heading_body(pattern: str) -> str:
    """The body of the first `##`/`###` heading matching `pattern`."""
    m = re.search(rf"^#{{2,3}} {pattern}\s*$(.*?)(?=^#{{2,3}} |\Z)", _apdu_text(), re.M | re.S)
    assert m, f"APDU.md has no section whose heading matches /{pattern}/"
    return m.group(1)


def _section(name: str) -> str:
    """The body of `### NAME (0xII)`, the opcode matched as a wildcard."""
    m = re.search(
        rf"^### {name} \(0x[0-9A-Fa-f]{{2}}\)\s*$(.*?)(?=^#{{2,3}} |\Z)",
        _apdu_text(), re.M | re.S,
    )
    assert m, f"APDU.md has no ### {name} section"
    return m.group(1)


def _row(section: str, field: str) -> str:
    """The value of `| field | value |` in a command's header table, backticks stripped."""
    m = re.search(rf"^\| {re.escape(field)} \| (.+?) \|$", section, re.M)
    assert m, f"no `{field}` row"
    return m.group(1).replace("`", "").strip()


def _hex_spans(text: str) -> list:
    """Every backticked run of hex pairs in `text`, as bytes."""
    spans = []
    for span in re.findall(r"`([0-9A-Fa-f][0-9A-Fa-f ]*)`", text):
        cleaned = span.replace(" ", "")
        if cleaned and len(cleaned) % 2 == 0:
            spans.append(bytes.fromhex(cleaned))
    return spans


def _command_headings() -> list:
    """Every `### NAME (0xII)` as (name, opcode). SELECT is a `##` heading."""
    headings = re.findall(r"^### ([A-Z_]+) \(0x([0-9A-Fa-f]{2})\)", _apdu_text(), re.M)
    assert headings, "no command headings found — did APDU.md's format change?"
    return headings


def _applet_ins() -> dict:
    return {n: int(v, 16) for n, v in re.findall(r"static final byte INS_(\w+)\s*=\s*\(byte\)\s*0x([0-9A-Fa-f]{2})", _applet_text())}


def _applet_shorts() -> dict:
    return {n: int(v) for n, v in re.findall(r"static final short (\w+)\s*=\s*\(short\)\s*(\d+)\s*;", _applet_text())}


def _applet_label(name: str) -> str:
    """A label byte array in the applet, as text: LABEL_X = { 'C','a', ... }."""
    m = re.search(rf"(?:static final byte\[\] {name}) = \{{(.*?)\}};", _applet_text(), re.S)
    assert m, f"no {name} in {APPLET_JAVA.name}"
    return "".join(re.findall(r"'(.)'", m.group(1)))


def _canonical(description: str, where: str) -> str:
    text = description.lower()
    for name, pattern in _FIELD_KEYWORDS:
        if re.search(pattern, text):
            return name
    raise AssertionError(f"{where}: cannot tell which field {description!r} describes")


# ── the command set ───────────────────────────────────────────────────────────
def test_every_documented_command_matches_its_ins_constant():
    """`### GET_PROOF (0x13)` must equal `INS_GET_PROOF = 0x13` in cardctl."""
    for name, hex_value in _command_headings():
        const = f"INS_{name}"
        assert hasattr(cardctl, const), f"{APDU_MD.name} documents {name} but cardctl has no {const}"
        assert getattr(cardctl, const) == int(hex_value, 16), (
            f"{name}: spec says 0x{hex_value}, cardctl.{const} is 0x{getattr(cardctl, const):02X}"
        )


def test_every_ins_constant_is_documented():
    """The other direction: an undocumented command is how a spec goes stale."""
    documented = {n for n, _ in _command_headings()}
    implemented = {n[4:] for n in dir(cardctl) if n.startswith("INS_")}
    missing = implemented - documented
    assert not missing, f"cardctl has undocumented commands: {sorted(missing)}"


def test_the_applet_opcodes_match_the_spec_and_the_driver():
    """
    The applet's INS constants, by opcode, against the spec's headings. Names may
    differ only where the applet says SET_LIMIT_OWNER for the owner's form, which
    the spec and cardctl call SET_LIMIT (and SET_LIMIT_PIN for the open card's).
    """
    applet = _applet_ins()
    rename = {"SET_LIMIT": "SET_LIMIT_PIN", "SET_LIMIT_OWNER": "SET_LIMIT"}
    applet = {rename.get(n, n): v for n, v in applet.items()}
    documented = {n: int(v, 16) for n, v in _command_headings()}
    assert applet == documented, (
        f"applet and spec disagree: only in applet {sorted(set(applet.items()) - set(documented.items()))}, "
        f"only in spec {sorted(set(documented.items()) - set(applet.items()))}"
    )


def test_the_ins_summary_table_matches_the_headings():
    body = _heading_body("Commands, by INS")
    rows = re.findall(r"^\| `([0-9A-F]{2})` \| ([A-Z_]+) \|", body, re.M)
    assert rows, "could not parse the INS summary table"
    assert sorted((n, int(v, 16)) for v, n in rows) == sorted((n, int(v, 16)) for n, v in _command_headings()), rows


def test_the_unassigned_opcodes_are_documented_and_absent():
    """0x.20 SPEND_PROOF, 0x21 SIGN_ARBITRARY and 0x35 SET_TIME are gone: documented as 6D00, in no constant anywhere."""
    body = _heading_body("Commands, by INS")
    for gone in ("`20`", "`21`", "`35`"):
        assert gone in body.split("Not assigned")[1], f"{gone} is not documented as unassigned"
    assert "6D00" in body
    used = set(_applet_ins().values()) | {getattr(cardctl, n) for n in dir(cardctl) if n.startswith("INS_")}
    assert not ({0x20, 0x21, 0x35} & used), sorted(hex(x) for x in {0x20, 0x21, 0x35} & used)


def test_the_cla_is_stated_and_every_command_table_repeats_it_and_its_ins():
    assert f"Class `{cardctl.CLA:02X}`" in _apdu_text(), "APDU.md no longer states the class byte"
    for name, hex_value in _command_headings():
        section = _section(name)
        assert int(_row(section, "CLA"), 16) == cardctl.CLA, f"{name}: wrong CLA"
        assert int(_row(section, "INS"), 16) == int(hex_value, 16), f"{name}: heading and table disagree"


# ── SELECT and the version ────────────────────────────────────────────────────
def test_select_application_matches_the_apdu_the_driver_sends():
    """
    SELECT is the one command that has to work before any other. A single wrong
    AID byte in this table selects nothing, and the driver then reports a card
    that needs an update.
    """
    body = _heading_body("SELECT APPLICATION")
    fields = {f: int(_row(body, f).split()[0], 16) for f in ("CLA", "INS", "P1", "P2", "Lc")}
    data = re.search(r"^\| Data \| `([0-9A-Fa-f ]+)`", body, re.M)
    assert data, "SELECT APPLICATION's table has no parsable Data row"
    aid = bytes.fromhex(data.group(1).replace(" ", ""))
    # D25: the table's AID is the applet's whole AID, the one cardctl selects first
    assert aid == cardctl.APPLET_AID, f"spec's AID {aid.hex()} != cardctl's {cardctl.APPLET_AID.hex()}"
    assert fields["Lc"] == len(cardctl.APPLET_AID)
    card = make_card([(b"\x02\x00", 0x9000)])
    card.select()
    documented = bytes([fields["CLA"], fields["INS"], fields["P1"], fields["P2"], fields["Lc"]]) + aid
    assert card.connection.sent == [documented], f"spec {documented.hex()} != cardctl {card.connection.last.hex()}"
    # the fallback cardctl tries, the opener a partial name reaches, and the withdrawn AIDs, are documented
    spans = _hex_spans(body)
    assert cardctl.PACKAGE_AID in spans, "the package AID (the fallback) is not documented"
    assert cardctl.PACKAGE_AID + b"\x4D" in spans, "the opener, which a SELECT by the package AID reaches on a chip, is not named"
    assert cardctl.LEGACY_PACKAGE_AID in spans, "the 0.x AID is not named as withdrawn"
    # and the build installs the card's applet under that AID
    build = (ROOT / "applet" / "build.xml").read_text(encoding="utf-8")
    assert 'aid="' + ":".join(f"{b:02X}" for b in cardctl.APPLET_AID) + '"' in build


def test_the_applet_version_is_the_one_the_spec_the_guide_and_selftest_expect():
    """
    SELECT's version is all an installed card reports about its build, so every
    copy of it must agree: the applet's, the spec's SELECT response, the guide's
    answers for a good card, and `cardctl selftest`'s floor, which passes it and
    nothing below.
    """
    version = dict(re.findall(r"static final byte VERSION_(MAJOR|MINOR)\s*=\s*\(byte\)\s*0x([0-9A-Fa-f]{2})", _applet_text()))
    major, minor = int(version["MAJOR"], 16), int(version["MINOR"], 16)
    assert (major, minor) == (2, 3)
    assert f"`{major:02X} {minor:02X}`" in _heading_body("SELECT APPLICATION"), "the spec's SELECT response"
    guide = DEPLOYMENT_MD.read_text(encoding="utf-8")
    tracked = re.search(r"The CAP tracked in this repo is \*\*applet version (\d+)\.(\d+)\*\*", guide)
    assert tracked and (int(tracked.group(1)), int(tracked.group(2))) == (major, minor), "the guide's tracked version"
    answers = re.findall(r"`SELECT` must answer `([0-9A-F]{2}) ([0-9A-F]{2})`", guide)
    answers += re.findall(r"^# Response: ([0-9A-F]{2})([0-9A-F]{2}) 9000\b", guide, re.M)
    answers += re.findall(r"^# Response: ([0-9A-F]{2}) ([0-9A-F]{2})(?: [0-9A-F]{2}){28}\s*$", guide, re.M)
    assert len(answers) == 3, f"expected the guide's three version answers, found {answers}"
    for hi, lo in answers:
        assert (int(hi, 16), int(lo, 16)) == (major, minor), f"the guide shows {hi} {lo}"
    ok, detail = cardctl._select_verdict(bytes([major, minor]))
    assert ok and detail == f"version {major}.{minor}", detail
    # 2.2 (D175) adds a read and changes nothing a 2.1 card does, so selftest's floor stays 2.1: a 2.1 card is not swept;
    # 2.3 moves no floor either: a 2.1 or 2.2 card in the field keeps what it holds
    assert cardctl.SELFTEST_MIN_VERSION == (2, 1) and cardctl.SELFTEST_MIN_VERSION <= (major, minor)
    assert cardctl._select_verdict(bytes([2, 1]))[0], "selftest passes a 2.1 card"
    assert not cardctl._select_verdict(bytes([1, 20]))[0], "selftest passes Foxy's 1.20"


# ── the slot ──────────────────────────────────────────────────────────────────
def _proof_layout() -> dict:
    rows = re.findall(r"^\| (\d+) \| (\d+) \| (.+?) \|$", _section("GET_PROOF"), re.M)
    assert rows, "could not parse the GET_PROOF response table"
    return {int(off): (int(ln), desc) for off, ln, desc in rows}


def _proof_slot_layout_block() -> dict:
    body = _heading_body("Proof Slot Layout")
    fence = re.search(r"```\n(.*?)```", body, re.S)
    assert fence, "the Proof Slot Layout section no longer contains a fenced layout block"
    rows = re.findall(r"^(\d+)\s+(\d+)\s+(.+)$", fence.group(1), re.M)
    return {int(off): (int(ln), desc.strip()) for off, ln, desc in rows}


def test_the_proof_layout_matches_the_parser_the_applet_and_its_other_copy():
    """
    The offsets the spec publishes must be the offsets get_proof slices and the
    applet writes. A symmetric offset change inside the applet passes the Java
    suite, so the applet is scraped here too.
    """
    table, block = _proof_layout(), _proof_slot_layout_block()
    expected = {0: 1, 1: 8, 9: 4, 13: 32, 45: 33, 78: 4}
    assert {o: l for o, (l, _) in table.items()} == expected, sorted(table.items())
    assert {o: l for o, (l, _) in block.items()} == expected, sorted(block.items())
    for layout, where in ((table, "GET_PROOF table"), (block, "slot layout block")):
        assert "raw" in layout[1][1].lower() and "ascii" not in layout[1][1].lower().replace("not ascii", ""), where
        assert "nonce" in layout[13][1].lower(), f"{where}: the 32-byte field is the nonce"
        assert "date" in layout[78][1].lower(), f"{where}: offset 78 is the date"
    body = (bytes([0x01]) + bytes.fromhex("0059534ce0bfa19a") + (1234).to_bytes(4, "big") + bytes(range(32))
            + b"\x02" + bytes(range(1, 33)) + (1900000000).to_bytes(4, "big"))
    assert len(body) == cardctl.PROOF_SIZE == 82
    p = make_card([(body, 0x9000)]).get_proof(0)
    assert (p["keyset_id"], p["amount"], p["nonce"], p["c"], p["date"]) == (
        "0059534ce0bfa19a", 1234, bytes(range(32)), b"\x02" + bytes(range(1, 33)), 1900000000)
    consts = _applet_shorts()
    java = {"status": "PROOF_STATUS_OFFSET", "keyset_id": "PROOF_KEYSET_OFFSET", "amount": "PROOF_AMOUNT_OFFSET",
            "nonce": "PROOF_NONCE_OFFSET", "c": "PROOF_C_OFFSET", "date": "PROOF_DATE_OFFSET"}
    for offset, (_, desc) in table.items():
        const = java[_canonical(desc, "GET_PROOF table")]
        assert consts[const] == offset, f"applet {const} is {consts[const]}, spec {offset}"
    assert consts["PROOF_SIZE"] == cardctl.PROOF_SIZE and consts["PROOF_DATA_LEN"] == cardctl.PROOF_SIZE - 1
    assert consts["MAX_PROOFS"] == cardctl.MAX_PROOFS == 128
    assert f"{cardctl.PROOF_SIZE} bytes per slot × {cardctl.MAX_PROOFS} slots" in _heading_body("Proof Slot Layout")


def test_load_proof_documents_the_fields_in_the_order_it_sends_them():
    """A misordered load strands money on a card for good."""
    section = _section("LOAD_PROOF")
    rows = re.findall(r"^\| (keyset_id|amount|nonce|C|date) \| (\d+) \|", section, re.M)
    assert [r[0] for r in rows] == ["keyset_id", "amount", "nonce", "C", "date"], rows
    sizes = [int(r[1]) for r in rows]
    assert sum(sizes) == cardctl.PROOF_SIZE - 1 == int(re.search(r"^51 \((\d+)\)", _row(section, "Lc")).group(1))
    card = make_card([(b"\x00", 0x9000)])
    card.load_proof(bytes.fromhex("0059534ce0bfa19a"), 4, bytes(range(32)), b"\x03" + bytes(range(32)), 7)
    data = card.connection.last[5:5 + 81]
    at = 0
    sent = {}
    for (name, _), size in zip(rows, sizes):
        sent[name] = data[at:at + size]
        at += size
    assert sent["keyset_id"] == bytes.fromhex("0059534ce0bfa19a") and int.from_bytes(sent["amount"], "big") == 4
    assert sent["nonce"] == bytes(range(32)) and sent["C"] == b"\x03" + bytes(range(32))
    assert int.from_bytes(sent["date"], "big") == 7


# ── the secret, which the card signs ────────────────────────────────────────
def _applet_secret_parts() -> dict:
    out = {}
    for name in ("SECRET_1", "SECRET_2", "SECRET_3", "SECRET_DATE", "SECRET_REFUND", "SECRET_END_DATED", "SECRET_END"):
        out[name] = _applet_label(name)
    return out


def test_the_card_proof_secret_is_the_one_the_applet_builds_and_the_vectors_sign():
    """
    The secret text is the wire between the card and every wallet that loads it:
    the card signs the hash of exactly this. NUT-CCP's two forms, the applet's
    byte arrays and the vectors the applet's suite wrote must be one text, each
    piece's with the keys of its date (t, P + t*G and R + u*G from c).
    """
    parts = _applet_secret_parts()
    nonce, key, refund, date = "ab" * 32, "02" + "cd" * 32, "03" + "ef" * 32, "1900000000"
    plain = parts["SECRET_1"] + nonce + parts["SECRET_2"] + key + parts["SECRET_3"] + parts["SECRET_END"]
    dated = (parts["SECRET_1"] + nonce + parts["SECRET_2"] + key + parts["SECRET_3"] + parts["SECRET_DATE"] + date
             + parts["SECRET_REFUND"] + refund + parts["SECRET_END_DATED"])
    assert CCP_SECRET_PLAIN.replace("<nonce>", nonce).replace("<date key>", key) == plain, \
        "the applet's secret without a date is not NUT-CCP's"
    assert (CCP_SECRET_DATED.replace("<nonce>", nonce).replace("<date key>", key)
            .replace("<date>", date).replace("<date refund key>", refund)) == dated, \
        "the applet's dated secret is not NUT-CCP's"
    # spec/vectors/secret.json: each piece is locked to its date's keys (Keys per load), worked out from c, the card
    # key P and the refund key R twice, by cardctl's date_keys and by test_apdu's own arithmetic
    vectors = json.loads(SECRET_JSON.read_text(encoding="utf-8"))
    c, card_key, refund_key = (bytes.fromhex(vectors[f]) for f in ("c", "cardKey", "refundKey"))
    for piece in vectors["pieces"]:
        mine = cardctl.date_keys(c, card_key, refund_key, piece["date"])
        other = _group_keys_answer(c, cardctl.point_from_bytes(card_key), cardctl.point_from_bytes(refund_key),
                                   piece["date"])
        assert (mine["t"] + mine["key"] + mine["refund"]) == other, piece["date"]
        assert (piece["t"], piece["key"], piece["refund"]) == (mine["t"].hex(), mine["key"].hex(), mine["refund"].hex()), \
            f"the piece of date {piece['date']} is not locked to its date's keys"
        if piece["date"]:
            want = (parts["SECRET_1"] + piece["nonce"] + parts["SECRET_2"] + piece["key"] + parts["SECRET_3"]
                    + parts["SECRET_DATE"] + str(piece["date"]) + parts["SECRET_REFUND"] + piece["refund"]
                    + parts["SECRET_END_DATED"])
        else:
            assert piece["refund"] == "00" * 33, "an undated piece names no refund key"
            want = parts["SECRET_1"] + piece["nonce"] + parts["SECRET_2"] + piece["key"] + parts["SECRET_3"] + parts["SECRET_END"]
        assert piece["secret"] == want, piece["secret"]


def test_the_sig_all_message_is_stated_as_the_card_hashes_it():
    assert "signature is over the NUT-11 `SIG_ALL` message: every piece's secret and `C`," in " ".join(_apdu_text().split()), \
        "APDU.md no longer says what the one signature is over"


# ── GET_INFO and GET_CARD ─────────────────────────────────────────────────────
def _byte_table(section: str) -> list:
    """`| 12–15 | name | meaning |` rows as (first, last, name)."""
    rows = []
    for a, b, name in re.findall(r"^\| (\d+)(?:[–-](\d+))? \| ([^|]+?) \|", section, re.M):
        rows.append((int(a), int(b) if b else int(a), name.strip()))
    assert rows, "no byte table"
    return rows


def test_get_info_response_table_matches_the_decoder():
    """
    Every documented byte of GET_INFO is driven through decode_info with a body
    whose fields are all different, and each field must land where the table
    puts it: a swap of two rows (unspent and spent, say) fails here.
    """
    rows = _byte_table(_section("GET_INFO"))
    covered = sorted({i for a, b, _ in rows for i in range(a, b + 1)})
    assert covered == list(range(59)), f"GET_INFO's table covers {covered}"
    sizes = re.findall(r"(\d+) bytes with P1 = `00`.*?(\d+) with P1 = `01`, (\d+) with P1 = `02`", _section("GET_INFO"))
    assert sizes == [("30", "42", "43")], sizes
    longer = re.findall(r"43 with P1 = `02`, (\d+) with P1 = `03`, (\d+) with P1 = `04`", _section("GET_INFO"))
    assert longer == [("51", "59")], longer
    # 2.3's bytes 43..58 (P1 = 3 and 4)
    assert [(a, b, name) for a, b, name in rows if a >= 43] == [
        (43, 43, "keyset table"), (44, 47, "rate"), (48, 48, "entries"), (49, 49, "unmarked"), (50, 50, "last unit"),
        (51, 54, "no-PIN window"), (55, 56, "profiles"), (57, 58, "loads left")], [r for r in rows if r[0] >= 43]
    info = cardctl.decode_info(INFO_59)
    unit_byte = {name: code for code, name in cardctl.LAST_UNIT_NAMES.items()}
    expect = {
        "version major": info["version_tuple"][0], "version minor": info["version_tuple"][1],
        "max slots": info["max_slots"], "unspent": info["unspent"], "spent": info["spent"], "empty": info["empty"],
        "capabilities": info["caps_raw"], "PIN state": 1 if info["pin_state"] == "set" else None,
        "format": info["format"], "tries left": info["tries"], "locked": int(info["locked"]),
        "record set": int(info["record_set"]), "daily limit": info["daily_limit"], "has owner": int(info["has_owner"]),
        "now": info["now"], "window start": info["window_start"], "spent today": info["spent_today"],
        "change owed": int(info["change_owed"]), "payment limit": info["payment_limit"],
        "no-PIN allowance": info["allowance"], "no-PIN spent": info["nopin_spent"], "tag off": int(info["tag_off"]),
        "keyset table": int(info["keyset_table"]), "rate": info["rate"], "entries": info["entries"],
        "unmarked": info["unmarked"], "last unit": unit_byte[info["last_unit"]],
        "no-PIN window": info["nopin_window_start"], "profiles": int.from_bytes(info["profiles_raw"], "big"),
        "loads left": info["loads_left"],
    }
    for a, b, name in rows:
        assert name in expect, f"GET_INFO documents {name!r}, which decode_info does not decode"
        assert int.from_bytes(INFO_59[a:b + 1], "big") == expect[name], f"{name} at {a}..{b}"
    # the last unit's three values, as the row names them
    last = [r for r in re.findall(r"^\| 50 \| last unit \| (.+?) \|$", _section("GET_INFO"), re.M)][0]
    for code, words in cardctl.LAST_UNIT_NAMES.items():
        assert f"`{code:02X}` {words}" in last, (code, last)
    # the profile bits: each name cardctl gives a bit is the one the spec gives it, byte by byte
    profiles = " ".join(_section("GET_INFO").split("Profile bits (bytes 55 and 56, P1 = 4).")[1].split())
    byte55, byte56 = profiles.split("Byte 56:")
    for at, bit, name in cardctl.PROFILE_NAMES:
        part = byte55 if at == 55 else byte56
        assert f"bit {bit} [{name}]" in part or f"bit {bit} {name} " in part, (at, bit, name)
    assert len(cardctl.PROFILE_NAMES) == 10 and "bits 2 to 7 are `0`" in byte56
    assert cardctl.decode_info(INFO_59[:55] + b"\xff\x03" + INFO_59[57:])["profiles"] == [n for _, _, n in cardctl.PROFILE_NAMES]
    assert "less than 57 bytes to P1 = 4 keeps none of them" in profiles and "profiles" not in cardctl.decode_info(INFO_59[:56])
    # the applet answers the documented sizes
    src = _applet_text()
    assert "p1 == (byte) 2 ? (short) 43 : (short) 42" in src and "apdu.setOutgoingAndSend((short) 0, (short) 30);" in src
    assert "apdu.setOutgoingAndSend((short) 0, (short) 51);" in src, "P1 = 3's 51 bytes (D184)"
    assert "apdu.setOutgoingAndSend((short) 0, (short) 59);" in src, "P1 = 4's 59 bytes (D186, D195)"
    assert "buf[55] = (byte) 0xFF;" in src and "buf[56] = (byte) 0x03;" in src and "answers `FF 03`" in _section("GET_INFO"), "the profile bits"


def test_get_card_table_matches_the_decoder_and_the_applets_rollover_bytes():
    rows = {(a, b): name for a, b, name in
            [(int(o), int(o) + int(l) - 1, n.strip()) for o, l, n in
             re.findall(r"^\| (\d+) \| (\d+) \| ([^|]+?) \|", _section("GET_CARD"), re.M)]}
    assert rows[(76, 76)].startswith("rolls") and rows[(77, 77)].startswith("rollover budget") and rows[(78, 78)].startswith("allowance armed"), rows
    card = cardctl.decode_card(CARD_ANSWER)
    assert (CARD_ANSWER[76], CARD_ANSWER[77], CARD_ANSWER[78]) == (card["rolls"], card["budget_raw"], int(card["armed"]))
    consts = _applet_shorts()
    # GET_CARD's byte 40 is the record's CARD_BITS_OFFSET: its 65 bytes are copied whole
    shift = consts["CARD_BITS_OFFSET"] - 40
    assert consts["CARD_ROLLS_OFFSET"] - shift == 76
    assert consts["CARD_BUDGET_OFFSET"] - shift == 77
    assert consts["CARD_ARMED_OFFSET"] - shift == 78
    # the rate (D184) is kept after the arming and answered as zeros at 79..82
    assert consts["CARD_RATE_OFFSET"] - shift == 79
    assert rows[(79, 82)].startswith("zeros: the rate"), rows
    # the no-PIN window's start and its switch (D186), after the rate
    assert consts["CARD_NOPIN_START_OFFSET"] - shift == 83 and rows[(83, 86)].startswith("the no-PIN window's start"), rows
    assert consts["CARD_NOPIN_DAY_OFFSET"] - shift == 87 and rows[(87, 87)].startswith("no-PIN window switch"), rows
    assert (card["no_pin_start"], card["no_pin_window"]) == (int.from_bytes(CARD_ANSWER[83:87], "big"), CARD_ANSWER[87])
    assert "Util.arrayFillNonAtomic(buf, (short)(40 + CARD_RATE_OFFSET - CARD_BITS_OFFSET), (short) 4, (byte) 0);" in _applet_text()
    assert "Util.arrayCopyNonAtomic(cardRecord, CARD_BITS_OFFSET, buf, (short) 40, (short) 65);" in _applet_text()


# ── the owner's proof ─────────────────────────────────────────────────────────
def test_the_owner_labels_match_the_applet_and_the_driver():
    body = _heading_body("The owner's proof")
    rows = re.findall(r"^\| `([A-Z_]+)`[^|]*\| `(CashuCard/[a-z-]+)` \|", body, re.M)
    documented = {cmd: label for cmd, label in rows}
    expect = {"CHANGE_PIN": "CHANGE_PIN", "SET_LIMIT": "SET_LIMIT", "SET_OWNER": "SET_OWNER", "SET_CARD": "SET_CARD",
              "ALLOW_LOAD": "LOAD", "LOCK_CARD": "LOCK", "RESET_CARD": "RESET", "SET_TAG": "TAG", "REFRESH": "REFRESH"}
    assert set(documented) == set(expect), sorted(documented)
    for command, short in expect.items():
        label = documented[command]
        assert _applet_label(f"LABEL_{short}") == label, f"applet's LABEL_{short} is not {label}"
        assert getattr(cardctl, f"LABEL_{short}") == label, f"cardctl.LABEL_{short} is not {label}"
    assert _applet_label("AUTH_TAG") == cardctl.AUTH_TAG == "CashuCard/auth"
    assert _applet_label("SEAL_LABEL") == "CashuCard/seal" and _applet_label("PINKEY_LABEL") == "CashuCard/pinkey"
    for tag in ("`CashuCard/auth`", "`CashuCard/seal`", "`CashuCard/pinkey`"):
        assert tag in body, tag


def test_owner_commands_send_proof_length_proof_then_value():
    """The data layout the spec states for every owner's command, through the real encoder."""
    assert "proof length (1) ‖ proof (DER, at most 72) ‖ value" in _heading_body("The owner's proof")
    nonce = bytes(range(16))
    card = make_card([(nonce, 0x9000)])
    card.set_limit(p256.TEST_OWNER_PRIVATE, 100, 0, 0, 7)
    data = card.connection.last[5:]
    n = data[0]
    assert n <= 72 and data[1 + n:] == (100).to_bytes(4, "big") + bytes(8) + b"\x07"
    assert p256.verify(p256.public_key(p256.TEST_OWNER_PRIVATE), b"CashuCard/set-limit" + nonce + data[1 + n:], data[1:1 + n])


def test_set_limit_forms_and_the_budget_range_match_the_applet():
    section = _section("SET_LIMIT")
    assert "4, 8, 12, 13, 17 or 18" in section and "1 to 30" in section
    assert "4, 8, 12, 13, 17 or 18 bytes" in _row(_section("SET_LIMIT_PIN"), "Data")
    src = _applet_text()
    assert "len != (short) 4 && len != (short) 8 && len != (short) 12 && len != (short) 13 && len != (short) 17 && len != (short) 18)" in src
    most = re.search(r"static final byte\s+ROLL_BUDGET_MOST\s*=\s*\(byte\)\s*(\d+);", src)
    default = re.search(r"static final byte\s+ROLL_BUDGET_DEFAULT\s*=\s*\(byte\)\s*(\d+);", src)
    assert int(most.group(1)) == cardctl.ROLL_BUDGET_MOST == 30
    assert int(default.group(1)) == cardctl.ROLL_BUDGET_DEFAULT == 7
    assert "default 7" in _heading_body("The clock and the limits")
    assert [len(cardctl.limit_value(1)), len(cardctl.limit_value(1, 0)), len(cardctl.limit_value(1, 0, 0)),
            len(cardctl.limit_value(1, 0, 0, 7)), len(cardctl.limit_value(1, 0, 0, 7, 1000)),
            len(cardctl.limit_value(1, 0, 0, 7, 1000, 1))] == [4, 8, 12, 13, 17, 18]
    # one layout (D184): the rate is bytes 13 to 16, after the budget, in both forms
    assert cardctl.limit_value(1, 2, 3, 7, 1000)[13:] == (1000).to_bytes(4, "big")
    assert "| 13–16 | rate |" in section
    # the no-PIN window's switch (D186): byte 17, 00 or 01, the record's CARD_NOPIN_DAY_OFFSET
    assert cardctl.limit_value(1, 2, 3, 7, 1000, 1)[17:] == b"\x01"
    assert "| 17 | no-PIN window |" in section
    assert "if (len == (short) 18) cardRecord[CARD_NOPIN_DAY_OFFSET] = src[(short)(at + 17)];" in src
    assert "requireLimitLength(len);" in src and src.count("requireLimitLength(len);") == 2


def test_refresh_and_the_anchor_take_an_80_byte_header():
    assert int(_row(_section("SET_HEADER"), "Lc"), 16) == cardctl.HEADER_LEN == 80
    assert "a Bitcoin block header (80)" in _row(_section("REFRESH"), "Data")
    assert "an anchor header (80)" in _row(_section("SET_OWNER"), "Data")
    assert _applet_shorts()["HEADER_LEN"] == 80
    card = make_card([(bytes(16), 0x9000), (bytes(4), 0x9000)])
    card.refresh(p256.TEST_OWNER_PRIVATE, bytes(80))
    sent = card.connection.last
    assert sent[1] == 0x53 and sent[-1] == int(_row(_section("REFRESH"), "Le"), 16)


def test_the_floor_the_spec_states_is_the_applets():
    m = re.search(r"FLOOR_BITS = \{ \(byte\) 0x([0-9A-F]{2}), \(byte\) 0x([0-9A-F]{2}), \(byte\) 0x([0-9A-F]{2}), \(byte\) 0x([0-9A-F]{2}) \}", _applet_text())
    bits = "".join(reversed(m.groups()))
    assert f"`0x{bits}`" in _section("SET_HEADER"), bits


# ── the bytes cardctl sends, against the tables ──────────────────────────────
# Every command cardctl drives, as (spec section, Card method, arguments, the
# answer to give it). The completeness ratchet below fails the day a Card
# method that sends a documented command is not in this table.
_DRIVEN = [
    ("GET_INFO", "get_info", (), [INFO_43]),
    ("GET_PUBKEY", "get_pubkey", (), [b"\x02" + bytes(32)]),
    ("GET_BALANCE", "get_balance", (), [bytes(4)]),
    ("GET_PROOF_COUNT", "get_proof_count", (), [b"\x00"]),
    ("GET_PROOF", "get_proof", (0,), [bytes(82)]),
    ("GET_SLOT_STATUS", "get_slot_status", (), [bytes(128)]),
    ("AUTH", "auth", (bytes(16),), [bytes(80)]),
    ("GET_CARD", "get_card", (), [CARD_ANSWER]),
    ("GET_CARD", "get_card_secret", (None,), [bytes(97)]),
    ("GROUP_KEYS", "group_keys", (0,), [bytes(98)]),
    ("GET_NONCE", "get_nonce", (), [bytes(16)]),
    ("GET_NONCE", "get_pin_key", (), [bytes(113)]),
    ("SET_HEADER", "set_header", (bytes(80),), [bytes(4)]),
    ("LOAD_PROOF", "load_proof", (bytes(8), 1, bytes(32), b"\x02" + bytes(32), 0, True), [b"\x00"]),
    ("CLEAR_SPENT", "clear_spent", (), [b"\x00"]),
    ("VERIFY_PIN", "verify_pin", (b"1234",), [b""]),
    ("SET_PIN", "set_pin", (b"1234",), [b""]),
    ("SET_CARD", "set_card", ("https://m",), [b""]),
    ("SET_OWNER", "set_owner", (p256.public_key(p256.TEST_OWNER_PRIVATE),), [b""]),
    ("SET_OWNER", "stage_owner_c", (bytes(32), cardctl.point_compressed(bip340.G)), [b""]),
    ("CHANGE_PIN", "change_pin", (p256.TEST_OWNER_PRIVATE, b"1234"), [bytes(16), b""]),
    ("SET_LIMIT", "set_limit", (p256.TEST_OWNER_PRIVATE, 1), [bytes(16), b""]),
    ("ALLOW_LOAD", "allow_load", (p256.TEST_OWNER_PRIVATE,), [bytes(16), b""]),
    ("REFRESH", "refresh", (p256.TEST_OWNER_PRIVATE, bytes(80)), [bytes(16), bytes(4)]),
    ("LOCK_CARD", "lock_card", (p256.TEST_OWNER_PRIVATE,), [bytes(16), b""]),
    ("GET_OUTBOX", "get_outbox_scope", (), [bytes(45)]),
    ("GET_OUTBOX", "get_outbox_page", (0,), [bytes(255)]),
    ("GET_CHANGE", "get_change", (0,), [b"\x00"]),
    ("LOAD_CHANGE", "load_change", (0, cardctl.point_uncompressed(bip340.G), cardctl.point_uncompressed(bip340.G),
                                    bytes(32), bytes(32)), [bytes(83)]),
    ("SPEND_ALL_CHANGE", "spend_all_change", (1, cardctl.point_compressed(bip340.G), bytes(8)), [bytes(33)]),
    ("KEYSET_KEYS", "keyset_keys_begin", (bytes(8),), [b""]),
    ("KEYSET_KEYS", "keyset_keys_keys", ([(1, cardctl.point_compressed(bip340.G))],), [b""]),
    ("KEYSET_KEYS", "keyset_keys_finish", (), [bytes(8)]),
    ("KEYSET_KEYS", "keyset_keys_show", (0, 0, []), [b""]),
    ("CERT_READ", "cert_read", (), [b"\x01\x01\x00\x10", bytes(16)]),
    ("GET_LOG", "hold_history", (), [bytes(16)]),
    ("RESET_CARD", "reset_by_pin", (), [b""]),
    ("RESET_CARD", "reset_by_owner", (p256.TEST_OWNER_PRIVATE, bytes(80)), [bytes(16), b""]),
    ("REFRESH", "refresh", (p256.TEST_OWNER_PRIVATE, bytes(80), True), [bytes(16), bytes(4)]),
    ("REFRESH", "refresh_by_pin", (bytes(80),), [bytes(4)]),
]


def _drive(method, args, answers):
    card = make_card([(a, 0x9000) for a in answers])
    getattr(card, method)(*args)
    return card.connection.last


def _apdu_parts(sent: bytes):
    """A short APDU as (Lc, data, Le): Lc and Le None where absent."""
    if len(sent) == 4:
        return None, b"", None
    if len(sent) == 5:
        return None, b"", sent[4]
    lc, rest = sent[4], sent[5 + sent[4]:]
    assert len(rest) <= 1, f"{sent.hex()}: {len(rest)} bytes after the data"
    return lc, sent[5:5 + lc], rest[0] if rest else None


def _forms(value: str) -> list:
    """The codes a P1 or P2 row names: `00; 01 sealed`, `02: bit 1`, `00 begin; 01 keys`, `00–03 a page; FF`."""
    forms = []
    for a, b in re.findall(r"(?:^|; )([0-9A-F]{2})(?:–([0-9A-F]{2}))?(?=;|$| |:)", value):
        forms += list(range(int(a, 16), int(b or a, 16) + 1))
    return forms


def test_every_driven_command_matches_its_header_table():
    """CLA, INS, a fixed P1/P2, a fixed Lc and the Le, each as the table has it: one of the forms a row lists
    (`00; 03 the card's secret c` is 00 or 03), as each driven method sends one form. An Le the table gives only with
    one P1 (`00` with P1 = 2) is sent with that P1 and with no other."""
    for name, method, args, answers in _DRIVEN:
        section = _section(name)
        sent = _drive(method, args, answers)
        lc, data, le = _apdu_parts(sent)
        assert sent[0] == cardctl.CLA and sent[1] == getattr(cardctl, f"INS_{name}"), name
        for field, at in (("P1", 2), ("P2", 3)):
            value = _row(section, field)
            if re.match(r"^([0-9A-F]{2})(?:;|$| \(|:| [a-z]|–)", value) and name != "GET_INFO":
                forms = _forms(value)
                assert forms and sent[at] in forms, f"{name}: {field} is {sent[at]:02X}, table says {value}"
        lc_row = re.search(r"^\| Lc \| `([0-9A-F]{2})`(?: \((\d+)\))? \|$", section, re.M)
        if lc_row:
            assert lc == int(lc_row.group(1), 16) == len(data), f"{name}: Lc {lc}, table says {lc_row.group(1)}"
            assert lc_row.group(2) is None or int(lc_row.group(2)) == lc, f"{name}: the table's Lc and its length"
        le_row = re.search(r"^\| Le \| (.+?) \|$", section, re.M)
        if le_row:
            only = re.fullmatch(r"`([0-9A-F]{2})` with P1 = (\d+)", le_row.group(1))
            if only:
                want = int(only.group(1), 16) if sent[2] == int(only.group(2)) else None
                assert le == want, f"{name} P1 {sent[2]:02X}: Le {le}, table says {le_row.group(1)}"
                continue
            if re.match(r"^`([0-9A-F]{2})`", le_row.group(1)):
                forms = [int(code, 16) for code in re.findall(r"`([0-9A-F]{2})`", le_row.group(1))]
                assert le in forms, f"{name}: Le {le}, table says {le_row.group(1)}"


def test_get_info_asks_the_longest_form_the_card_speaks():
    """P1 = 4 (59 bytes) from a card SELECT says is 2.3 or later, P1 = 2 (43 bytes) from an older one or before any
    SELECT: both forms are in the table."""
    p1_row = re.search(r"^\| P1 \| (.+?) \|$", _section("GET_INFO"), re.M).group(1)
    assert {2, 4} <= {int(c, 16) for c in re.findall(r"`([0-9A-F]{2})`", p1_row)}, p1_row
    assert _drive("get_info", (), [INFO_43])[2] == cardctl.INFO_P1_LONG == 2
    for version, p1 in ((b"\x02\x03", 4), (b"\x02\x09", 4), (b"\x02\x02", 2), (b"\x02\x01", 2)):
        card = make_card([(version, 0x9000), (INFO_59, 0x9000)])
        card.select()
        card.get_info()
        assert card.connection.last[2] == p1, (version.hex(), card.connection.last.hex())
    assert cardctl.INFO_P1_LONGEST == 4 and "59 with P1 = `04`" in _section("GET_INFO")


def test_every_command_cardctl_sends_is_in_the_driven_table():
    """The ratchet: a Card method that sends an instruction must be driven above."""
    import inspect
    driven = {m for _, m, _, _ in _DRIVEN}
    src = inspect.getsource(cardctl.Card)
    senders = set(re.findall(r"\n    def (\w+)\(self[^)]*\)[^:]*:(?:(?!\n    def ).)*?(?:self\.send\(INS_|owner_command\(INS_|self\.send\(\s*INS_|self\.held\(INS_)", src, re.S))
    senders -= {"owner_command", "send", "transmit", "select"}
    missing = senders - driven
    assert not missing, f"Card methods that send a command but are not driven here: {sorted(missing)}"


def test_pin_length_ranges_match_the_applet():
    shorts = _applet_shorts()
    assert (shorts["PIN_MIN_LEN"], shorts["PIN_MAX_LEN"]) == (cardctl.PIN_MIN_LEN, cardctl.PIN_MAX_LEN) == (4, 8)
    for name in ("VERIFY_PIN", "SET_PIN"):
        assert "4–8 bytes" in _row(_section(name), "Data"), name
    assert "the new PIN (4–8)" in _row(_section("CHANGE_PIN"), "Data")


def test_lock_card_p2_is_the_confirmation_byte():
    assert int(_row(_section("LOCK_CARD"), "P2").split()[0], 16) == cardctl.LOCK_CONFIRM_BYTE == 0xDE
    assert "static final byte LOCK_CONFIRM_BYTE = (byte) 0xDE;" in _applet_text()


# ── the card's own change, a keyset's keys and the certificate (2.3) ─────────
def _applet_bytes() -> dict:
    return {n: int(v, 16) for n, v in re.findall(r"static final byte\s+(\w+)\s*=\s*\(byte\)\s*0x([0-9A-Fa-f]{2})\s*;", _applet_text())}


def test_get_change_rows_are_the_tables_and_the_applets():
    """Each field of an 83-byte opening where the table puts it, through decode_change; the applet copies the amount,
    keyset and date of its opening whole, then B_ and K, three to a page of eight."""
    section = _section("GET_CHANGE")
    rows = [(int(o), int(n), d.strip()) for o, n, d in re.findall(r"^\| (\d+) \| (\d+) \| (.+?) \|$", section, re.M)]
    assert [(o, n) for o, n, _ in rows] == [(0, 1), (1, 4), (5, 8), (13, 4), (17, 33), (50, 33)], rows
    assert sum(n for _, n, _ in rows) == cardctl.CHANGE_ROW_LEN == 83
    assert "up to three openings of 83 bytes" in " ".join(section.split()) and cardctl.CHANGE_PAGE == 3
    row = bytes([6]) + bytes(range(1, 83))
    got = cardctl.decode_change(b"\x01" + row)[0]
    fields = {"number": "the opening's number", "amount": "amount", "keyset": "keyset", "date": "date",
              "b_": "the blinded message B_", "k": "K, the mint's key"}
    for (offset, size, desc), (key, words) in zip(rows, fields.items()):
        assert desc.startswith(words), (desc, words)
        value = got[key]
        assert (value if isinstance(value, bytes) else value.to_bytes(size, "big")) == row[offset:offset + size], key
    consts = _applet_shorts()
    assert (consts["CHANGE_REC"], consts["CHANGE_PAGE"], consts["CHANGE_MOST"]) == (83, 3, cardctl.CHANGE_MOST) == (83, 3, 8)
    assert (consts["OPEN_AMOUNT"], consts["OPEN_KEYSET"], consts["OPEN_DATE"], consts["OPEN_NONCE"]) == (0, 4, 12, 16)
    assert (consts["OPEN_KEYS_B"], consts["OPEN_KEYS_K"], consts["OPEN_KEYS_LEN"]) == (0, 33, 66)
    # a reader reads 83-byte openings and sends LOAD_CHANGE only to a card that answers 02 03 or later
    assert "A reader sends `LOAD_CHANGE` and reads 83-byte openings only from a card that answers `02 03` or later" \
        in " ".join(_heading_body("SELECT APPLICATION").split())
    for method, args in (("get_change", (0,)), ("load_change", _DRIVEN[[d[1] for d in _DRIVEN].index("load_change")][2])):
        card = make_card([(b"\x02\x02", 0x9000)])
        card.select()
        try:
            getattr(card, method)(*args)
        except SystemExit:
            pass
        else:
            raise AssertionError(f"{method} sent to a 2.2 card")
        assert len(card.connection.sent) == 1


def test_load_change_sends_the_mints_answer_in_the_tables_order_and_reads_the_piece():
    section = _section("LOAD_CHANGE")
    data = " ".join(_row(section, "Data").split())
    assert data == ("C_ (65, 04 ‖ x ‖ y) ‖ K, the mint's key for the opening's amount (65, the same form) ‖ e (32) ‖ "
                    "s (32)"), data
    sizes = [int(n) for n in re.findall(r"\((\d+)", data)]
    assert sizes == [65, 65, 32, 32] and sum(sizes) == cardctl.LOAD_CHANGE_LEN == 194
    assert _row(section, "P2").startswith(f"{cardctl.LOAD_DATE_KEYS:02X}: bit 1") and _applet_bytes()["LOAD_DATE_KEYS"] == 2
    consts = _applet_shorts()
    assert (consts["LC_C"], consts["LC_K"], consts["LC_E"], consts["LC_S"], consts["LOAD_CHANGE_LEN"]) == (0, 65, 130, 162, 194)
    g = cardctl.point_uncompressed(bip340.G)
    two = cardctl.point_uncompressed(bip340._point_add(bip340.G, bip340.G))
    piece = bytes(range(81))
    card = make_card([(bytes([3, 1]) + piece, 0x9000)])
    got = card.load_change(5, g, two, bytes([0xEE]) * 32, bytes([0x55]) * 32)
    sent = card.connection.last
    assert sent[2] == 5 and sent[3] == 0x02 and sent[5:5 + 194] == g + two + bytes([0xEE]) * 32 + bytes([0x55]) * 32
    # the answer: the slot, the kept byte and the piece as GET_PROOF gives it after its status byte
    answer = " ".join(section.split("**Response:**")[1].split("\n\n")[0].split())
    assert answer.startswith("83 bytes: the slot the piece went into (1), `01` where the mint's proof was kept with it") \
        and "after its status byte (81)" in answer, answer
    assert cardctl.LOAD_CHANGE_ANSWER_LEN == 83 == int(_row(section, "Le"), 16)
    assert "apdu.setOutgoingAndSend((short) 0, (short)(PROOF_DATA_LEN + 2));" in _applet_text()
    assert got["slot"] == 3 and got["proof_kept"] is True
    layout = _proof_layout()
    names = {"keyset_id": None, "amount": None, "nonce": None, "c": None, "date": None}
    for offset, (size, desc) in layout.items():
        name = _canonical(desc, "GET_PROOF table")
        if name == "status":
            continue
        value = got["piece"][name]
        value = bytes.fromhex(value) if name == "keyset_id" else value
        assert (value if isinstance(value, bytes) else value.to_bytes(size, "big")) == piece[offset - 1:offset - 1 + size], name
        names[name] = offset
    assert None not in names.values()


def test_spend_all_change_sends_its_45_bytes_in_the_tables_order():
    section = _section("SPEND_ALL_CHANGE")
    data = " ".join(_row(section, "Data").split())
    assert data == ("the change amount (4) ‖ K, the mint's key for that amount (33, compressed) ‖ the keyset the change "
                    "is signed in (8)"), data
    assert [int(n) for n in re.findall(r"\((\d+)", data)] == [4, 33, 8]
    assert cardctl.SPEND_ALL_CHANGE_LEN == 45 == int(_row(section, "Lc").split()[0], 16) == _applet_shorts()["CHANGE_ASK_KEYSET_LEN"]
    k = cardctl.point_compressed(bip340.G)
    sent = _drive("spend_all_change", (0x01020304, k, bytes(range(8))), [bytes(33)])
    assert sent[5:50] == bytes([1, 2, 3, 4]) + k + bytes(range(8)) and sent[-1] == 33 == int(_row(section, "Le"), 16)


def test_keyset_keys_steps_the_wire_and_the_tree_are_the_specs_and_the_applets():
    section = _section("KEYSET_KEYS")
    text = " ".join(section.split())
    steps = dict((word, int(code, 16)) for code, word in re.findall(r"([0-9A-F]{2}) (begin|keys|finish|show)", _row(section, "P1")))
    assert steps == {"begin": 0, "keys": 1, "finish": 2, "show": 3}, steps
    g = cardctl.point_compressed(bip340.G)
    for method, args, answers, step in (("keyset_keys_begin", (bytes(8),), [b""], "begin"),
                                        ("keyset_keys_keys", ([(1, g)],), [b""], "keys"),
                                        ("keyset_keys_finish", (), [bytes(8)], "finish"),
                                        ("keyset_keys_show", (0, 0, []), [b""], "show")):
        assert _drive(method, args, answers)[2] == steps[step], method
    data = " ".join(_row(section, "Data").split())
    assert "P1 = 1: one to six keys of 41 bytes, amount (8) ‖ K (33, compressed)" in data, data
    assert ("P1 = 3: the opening (1) ‖ the leaf's index (1) ‖ the depth (1) ‖ the path (32 × depth) ‖ [another key "
            "(33) ‖ [another keyset (8)]]") in data, data
    consts = _applet_shorts()
    assert cardctl.KEYSET_KEY_WIRE == consts["KEY_WIRE"] == 41 and cardctl.KEYSET_KEYS_PER_COMMAND == 6
    assert cardctl.KEYSET_TAIL_MOST == consts["TAIL_MOST"] == 64 and "at most 64" in text
    assert cardctl.KEYSET_KEYS_MOST == consts["KEYS_MOST"] == 64 and "64 at the most" in text
    assert cardctl.KEYSET_PATH_MOST == consts["PATH_MOST"] == 6 and "a depth of 0 to 6" in text
    # the tree, as the spec words it
    assert "leaves are `SHA-256(0x00 ‖ amount (8) ‖ K)`" in text
    assert "padded to the next power of two with `SHA-256(0x02)`, nodes `SHA-256(0x01 ‖ left ‖ right)`" in text
    assert "bit i of the index, from the lowest, is 1 where the node at height i is a right child" in text
    import hashlib
    sha = lambda b: hashlib.sha256(b).digest()
    assert cardctl.keyset_leaf(5, g) == sha(b"\x00" + (5).to_bytes(8, "big") + g) and cardctl.KEYSET_PAD == sha(b"\x02")
    leaf, a, b = sha(b"leaf"), sha(b"a"), sha(b"b")
    assert cardctl.fold_path(leaf, 0b01, [a, b]) == sha(b"\x01" + sha(b"\x01" + a + leaf) + b), "bit 0 set: a right child"
    assert cardctl.fold_path(leaf, 0b10, [a, b]) == sha(b"\x01" + b + sha(b"\x01" + leaf + a)), "bit 1 set, at height 1"
    # the tail: none for version 00, the unit first for version 01, as the spec and the applet have them
    assert "A version `01` tail names the unit first, `|unit:sat` or `|unit:usd` followed by the end or `|`" in text
    assert _applet_label("UNIT_TAILS") == "|unit:sat|unit:usd" and cardctl.KEYSET_UNITS == ("sat", "usd")
    assert "NUT-02 hashes after the keys for the ID's version (none for version `00`)" in text


def test_cert_read_reads_the_state_then_the_pages():
    section = _section("CERT_READ")
    text = " ".join(section.split())
    assert _row(section, "P1") == f"00–{cardctl.CERT_PAGES - 1:02X} a page; {cardctl.CERT_STATE:02X} the state"
    assert "**Response, P1 = `FF`:** 4 bytes: `01` when a certificate is sealed" in text
    assert f"{cardctl.CERT_PAGE} bytes of the container from offset P1 × {cardctl.CERT_PAGE}, fewer for the last page" in text
    card = make_card([(b"\x01\x01\x01\x2c", 0x9000), (bytes(256), 0x9000), (bytes(44), 0x9000)])
    assert len(card.cert_read()["container"]) == 300
    assert [a[2] for a in card.connection.sent] == [0xFF, 0x00, 0x01]
    assert "if (p1 == (byte) 0xFF) {" in _applet_text() and "short off = (short)(p1 << 8);" in _applet_text()


def test_the_words_cardctl_gives_a_commands_status_words_are_in_its_section():
    documented = {first + second for first, second in
                  re.findall(r"^\| (6[0-9A-F]|90) ?([0-9A-F]{2}|CX) \|", _heading_body("Error Code Summary"), re.M)}
    for command, words in cardctl.SW_COMMAND_MEANINGS.items():
        section = _section(command)
        for sw in words:
            assert f"{sw:04X}" in documented, f"{command}: {sw:04X} is not in the error summary"
            assert f"`{sw:04X}`" in section, f"{command}: {sw:04X} is not in its section"
            assert cardctl.describe_sw(sw, f"{command} x") == words[sw]


# ── status words ──────────────────────────────────────────────────────────────
def test_every_documented_status_word_is_translated_by_cardctl():
    documented = {first + second for first, second in
                  re.findall(r"^\| (6[0-9A-F]|90) ?([0-9A-F]{2}|CX) \|", _heading_body("Error Code Summary"), re.M)}
    assert {"9000", "63CX", "6982", "6983", "6986", "6A88", "6A8F", "6A90", "6A91", "6A93", "6A94"} <= documented, sorted(documented)
    for sw in sorted(documented):
        if sw == "63CX":
            for tries in range(4):
                assert f"{tries} retries remaining" in cardctl.describe_sw(0x63C0 | tries)
            continue
        assert cardctl.describe_sw(int(sw, 16)) != "unknown status word", f"cardctl cannot translate {sw}"
    undocumented = {f"{sw:04X}" for sw in cardctl.SW_MEANINGS} - documented
    assert not undocumented, f"cardctl translates status words the spec does not document: {sorted(undocumented)}"


def test_every_applet_status_word_is_documented():
    words = {v.upper() for v in re.findall(r"static final short SW_\w+\s*=\s*\(short\)\s*0x([0-9A-Fa-f]{4})", _applet_text())}
    words -= {"63C2", "63C1", "63C0"}   # 63CX
    words -= {"6A92", "6A95"}           # unused: never answered (CashuAppletTest checks)
    documented = {first + second for first, second in
                  re.findall(r"^\| (6[0-9A-F]|90) ?([0-9A-F]{2}|CX) \|", _heading_body("Error Code Summary"), re.M)}
    missing = words - documented
    assert not missing, f"the applet answers status words the spec does not document: {sorted(missing)}"


# ── the guides' cardctl lines ────────────────────────────────────────────────
GUIDE_HTML = ROOT / "website" / "dist" / "guide.html"


def _cardctl_lines(text: str) -> list:
    """Every `python3 cardctl.py ...` line of a guide's command blocks (```bash in markdown, <pre><code> in HTML),
    as (block number, the arguments after cardctl.py), with its placeholders filled in."""
    import html
    import shlex
    blocks = re.findall(r"```bash\n(.*?)```", text, re.S) + [html.unescape(b) for b in
                                                            re.findall(r"<pre><code>(.*?)</code></pre>", text, re.S)]
    fill = {"header": "00" * 80, "url": "https://mint.example", "hex": "22" * 32, "…": "22" * 32}
    out = []
    for n, block in enumerate(blocks):
        for line in block.splitlines():
            if not line.startswith("python3 cardctl.py "):
                continue
            def placeholder(m):
                word = m.group(1).lower()
                return next((v for k, v in fill.items() if k in word), "x")
            out.append((n, shlex.split(re.sub(r"<([^>]*)>", placeholder, line))[2:]))
    return out


def test_the_guides_set_a_card_up_with_setup_alone_and_every_cardctl_line_parses():
    """docs/HARDWARE_DEPLOYMENT.md and the site's guide (guide.html): every cardctl line parses with cardctl's own
    parser; a card is set up by one `setup` with the holder's --owner-key, never by the separate commands (each
    selects the card again, which ends a 2.3 card's first set-up, D196); and a block that sets a card up holds no
    other writing command."""
    separate = {"set-pin", "verify-pin", "set-card", "set-owner", "set-owner-url", "set-limit"}
    for path in (DEPLOYMENT_MD, GUIDE_HTML):
        lines = _cardctl_lines(path.read_text(encoding="utf-8"))
        assert any(argv[0] == "setup" for _, argv in lines), f"{path.name}: no cardctl setup"
        for n, argv in lines:
            try:
                cardctl.build_parser().parse_args(argv)
            except SystemExit:
                raise AssertionError(f"{path.name}: `cardctl.py {' '.join(argv)}` does not parse")
            assert argv[0] not in separate, f"{path.name}: a card set up by separate commands ({argv[0]})"
            if argv[0] == "setup":
                assert "--owner-key" in argv and "--test-owner-key" not in argv, f"{path.name}: {argv}"
                others = [a[0] for m, a in lines if m == n and a[0] not in ("setup", "info", "selftest")]
                assert not others, f"{path.name}: the set-up block also sends {others}"


#: What none of the three places may say beside the sentence refcheck gives of a file no chip has run: an install, a chip
#: run, a pass, or that the sentence no longer holds, in any words.
UNTRIED_REFUSES = ("installed", "installs", "install went", "chip run", "proven", "proved", "passed", "passes its",
                   "safe to install", "has run on", "ran on", "runs on a", "tested on", "works on a", "loaded it",
                   "loads it", "loaded on", "verified on the chip", "verified on a chip", "verified on a card",
                   "verified on the card", "ready for cards", "ready for a card", "cleared for", "now runs",
                   "runs this file", "pays real mints", "pays a real mint", "paid a real mint", "real payments",
                   "has since", "since been", "out of date", "no longer", "is old", "updated", "on silicon",
                   "chip-tested", "tried on", "checked on", "went onto", "is done", "ready for production")
#: What the whole of each file may never say while the file is untried, whatever it names.
UNTRIED_NEVER = ("safe to install", "ready for cards", "ready for a card", "cleared for cards", "pays real mints",
                 "now runs this file", "has run on a chip", "has run on a card", "has run on silicon",
                 "ready for production")
#: The words that name the tracked file without its size or hash: a sentence with one is held to the untried rule.
UNTRIED_NAMES = ("tracked file", "tracked cap", "current cap", "current file")
#: The honest hedges, which say a claim's words with "not yet" or "to be" before them: taken out before a sentence is read.
UNTRIED_QUIET = ("not yet tried on", "to be tried on", "never tried on", "not yet checked on", "not tried on")
#: Once the file has run on a chip, what its run did not cover: no sentence in the three files says any of these
#: (refcheck's PROVEN says what ran: real signatures and real change, at a test mint, on one J3R180 in one configuration).
PROVEN_NEVER = (r"cleared for production", r"ready for production", r"production[- ]ready", r"fit for production",
                r"safe for production", r"in production use", r"from any seller", r"in the field has",
                r"\b(?:any|every|all|each)\b[^.;:]{0,24}\bj3r180", r"\bj3r180s\b",
                r"\b(?:any|every|all|each)\b[^.;:]{0,24}\bconfigurations?\b")
#: What the run did not cover, by name: a sentence that names one, claims a run of it (PROVEN_CLAIMS) and does not say
#: it is not covered (PROVEN_NOT) is refused; "torn on purpose" is a claim by itself.
PROVEN_BEYOND = ("production mint", "production mints", "a phone", "phones", "torn", "tears", "torn on purpose")
PROVEN_CLAIMS = ("tested with", "tested on", "tested at", "tried with", "tried at", "has run with", "has run at",
                 "ran with", "ran at", "run with", "runs with", "run at", "ran on", "has run on", "paid", "pays",
                 "verified with", "verified at", "verified on", "proven", "proved", "passed", "works with",
                 "worked with", "survived", "torn on purpose", "ready for", "safe to")
PROVEN_NOT = ("not", "no ", "never", "nor ", "yet", "untested", "until", "still to", "to come", "waits", "without")
#: Letters of other scripts that look like Latin ones, folded to the Latin letter before a text is read.
LOOKALIKES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ї": "i", "ј": "j", "ѕ": "s",
    "ԁ": "d", "ӏ": "l", "һ": "h", "ԛ": "q", "ԝ": "w", "ɑ": "a", "ı": "i", "ɡ": "g",
    "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t", "Х": "x",
    "І": "i", "Ј": "j", "Ѕ": "s", "Ү": "y",
    "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
    "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p",
    "Τ": "t", "Υ": "y", "Χ": "x",
    "‘": "'", "’": "'", "“": '"', "”": '"',
})
#: Tags that end a sentence or a block where a reader sees one (others join the words around them, as a browser does).
_BLOCK_TAG = re.compile(r"</?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|br|tr|td|th|table|section|article|header|footer|pre|"
                        r"blockquote|nav|main|aside|figure|figcaption|hr|title|head|body|html|meta|link|script|style)\b"
                        r"[^>]*>", re.I)
_PARAGRAPH = "¶"


def plain(text, html_text=False):
    """The text as a reader sees it, for the untried rule: tags taken out (a block's as a paragraph's end), entities
    decoded, NFKC, every format character (soft hyphens and zero-width ones among them) dropped, letters of other scripts
    that look Latin folded, markdown's emphasis and code marks dropped, lower case, paragraphs marked and spaces made
    one."""
    import html
    import unicodedata
    if html_text:
        text = re.sub(r"<(script|style)\b.*?</\1\s*>", "\n\n", text, flags=re.S | re.I)
        text = _BLOCK_TAG.sub("\n\n", text)
        text = re.sub(r"<[^>]*>", "", text)
    for _ in range(4):
        text = html.unescape(text)
    text = unicodedata.normalize("NFKC", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")
    text = text.translate(LOOKALIKES).lower()
    text = re.sub(r"[*_`]", "", text)
    # a quotation's marks: a line of ">" alone ends a paragraph, as a blank line does, and the marks go
    text = re.sub(r"(?m)^[ \t]*>[ \t]*$", "", text)
    text = re.sub(r"(?m)^[ \t]*>[ \t]?", "", text)
    text = re.sub(r"\n[ \t]*(?:\n[ \t]*)+|\n[ \t]*(?:[-+]|\d+\.)[ \t]+|\n#+[ \t]+", f" {_PARAGRAPH} ", text)
    return re.sub(r"\s+", " ", text)


def untried_claims(text, said, html_text=False):
    """The claims a text makes of an install or a chip run (UNTRIED_REFUSES), read as plain() reads it, with refcheck's
    sentence for the file (`said`) and its negation ("no card has installed this exact file ...") taken out."""
    flat = plain(text, html_text)
    for quiet in (said, negated(said)) + UNTRIED_QUIET:
        flat = flat.replace(quiet, " ")
    return [c for c in UNTRIED_REFUSES if re.search(r"(?<![\w-])" + re.escape(c) + r"(?![\w-])", flat)]


def negated(said):
    """The guides' other way of saying it, in their troubleshooting: "no card has installed this exact file", and "or a
    file of its size" where refcheck says that too."""
    return "no card has installed this exact file" + (" or a file of its size" if said.endswith("of its size") else "")


def file_claims(text, said, names, html_text=False):
    """Over a whole file: each sentence that names the file (`names`: "this exact file", "the 2.3 build", its size, its
    hashes...) and claims an install or a chip run, and each that says anything in UNTRIED_NEVER, whatever it names."""
    flat = plain(text, html_text)
    out = []
    for sentence in re.split(rf"\s*{_PARAGRAPH}\s*|(?<=[.!?;])\s+", flat):
        for quiet in (said, negated(said)) + UNTRIED_QUIET:
            sentence = sentence.replace(quiet, " ")
        never = [c for c in UNTRIED_NEVER if c in sentence]
        named = [n for n in names if n in sentence]
        claims = [c for c in UNTRIED_REFUSES if re.search(r"(?<![\w-])" + re.escape(c) + r"(?![\w-])", sentence)]
        if never or (named and claims):
            out.append((sentence.strip()[:160], never + claims))
    return out


def proven_overclaims(text, html_text=False, about=None):
    """Over a whole file: each sentence that says anything in PROVEN_NEVER, or names something a chip run did not cover
    (PROVEN_BEYOND) and claims a run of it (PROVEN_CLAIMS) without saying it is not covered (PROVEN_NOT), each read as a
    reader sees it (plain()); with `about`, only the sentences that say it (README and the release notes speak of other
    versions' runs too, with phones)."""
    flat = plain(text, html_text)
    out = []
    for sentence in re.split(rf"\s*{_PARAGRAPH}\s*|(?<=[.!?;])\s+", flat):
        if about is not None and about not in sentence:
            continue
        never = [n for n in PROVEN_NEVER if re.search(n, sentence)]
        beyond = [b for b in PROVEN_BEYOND if re.search(r"(?<![\w-])" + re.escape(b) + r"(?![\w-])", sentence)]
        claims = [c for c in PROVEN_CLAIMS if re.search(r"(?<![\w-])" + re.escape(c) + r"(?![\w-])", sentence)]
        negated = any(re.search(r"(?<![\w-])" + re.escape(n.strip()) + r"(?![\w-])", sentence) for n in PROVEN_NOT)
        if never or (beyond and claims and not negated):
            out.append((sentence.strip()[:160], never + (beyond + claims if beyond and claims and not negated else [])))
    return out


def _refcheck():
    import importlib.util
    spec = importlib.util.spec_from_file_location("refcheck", ROOT / "tools" / "refcheck.py")
    refcheck = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(refcheck)
    return refcheck


def guide_findings(refcheck, cap_bytes, guide_md, guide_html, deployment, readme=None, notes=None):
    """What the untried rule finds wrong in the three texts for the CAP `cap_bytes`, as a list of findings (empty when
    they say what refcheck knows): each place where a reader meets it first (the agents' guide before its rules, the
    site's guide in step 2's note, the deployment guide's paragraph on the 2.3 build) gives refcheck's sentence for the
    file, worked out from PROVEN and SIZES (refcheck.said), word for word; while the file is untried those places say
    nothing else of an install, a chip run or a pass (UNTRIED_REFUSES), no sentence anywhere in the three that names the
    file (its size, its hashes, "this exact file", "the 2.3 build") claims one, and none says UNTRIED_NEVER, each read as a
    reader sees it (plain()); and the chip run's checklist gives refcheck's rule for PROVEN (PROVEN_NEEDS). At all times,
    proven or not, no sentence in the three, nor in README.md and RELEASE-NOTES.md (`readme`, `notes`: read from the tree
    where not given), claims what a chip run did not cover (proven_overclaims): a file proven earlier stays in the
    texts' history, and what its run did not cover is not claimed of it either; and while the file is untried, the two
    are held to the untried rule as the three are."""
    import hashlib
    parts = _cap_parts(cap_bytes)
    size = refcheck.load_file_size(parts)
    sha = hashlib.sha256(refcheck.load_file(parts)).hexdigest()
    cap_sha = hashlib.sha256(cap_bytes).hexdigest()
    untried = not refcheck.proven(parts)
    said = refcheck.said(parts)
    found = []
    if untried != said.startswith("this exact file has run only in a simulator"):
        found.append(f"refcheck: proven {not untried} but says {said!r}")
    if refcheck.unverified():
        found.append(f"refcheck's PROVEN has entries without {refcheck.PROVEN_NEEDS!r}: {refcheck.unverified()}")
    # the note's label fits the file: "Not yet on a card." while it has run only in a simulator, "On a card." once proven
    label = "Not yet on a card" if untried else "On a card"
    guide_html_note = re.search(r'<p class="note"><b>' + re.escape(label) + r'\.</b>(.*?)</p>', guide_html, re.S)
    try:
        deployment_size = deployment[deployment.index("The 2.3 build is"):deployment.index("On 2026-11-13 a J3R180")]
    except ValueError:
        deployment_size = ""
    for name, text, is_html in (("guide.md", guide_md.split("## Rules")[0], False),
                                ("guide.html", guide_html_note.group(1) if guide_html_note else "", True),
                                ("HARDWARE_DEPLOYMENT.md", deployment_size, False)):
        if said not in plain(text, is_html):
            found.append(f"{name}: does not say {said!r} (refcheck's sentence for {sha})")
        if untried:
            claims = untried_claims(text, said, is_html)
            if claims:
                found.append(f"{name}: says {claims} of a file that has run only in a simulator")
    if readme is None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if notes is None:
        notes = (ROOT / "docs" / "RELEASE-NOTES.md").read_text(encoding="utf-8")
    texts = (("guide.md", guide_md, False), ("guide.html", guide_html, True), ("HARDWARE_DEPLOYMENT.md", deployment, False),
             ("README.md", readme, False), ("RELEASE-NOTES.md", notes, False))
    if untried:
        names = ("this exact file", "this exact", "2.3 file", "2.3 build", "2.3 cap", "2.3.0.cap", f"{size:,}", str(size),
                 sha[:8], cap_sha[:8]) + UNTRIED_NAMES
        for name, text, is_html in texts:
            claims = file_claims(text, said, names, is_html)
            if claims:
                found.append(f"{name}: claims of a file that has run only in a simulator: {claims}")
    for name, text, is_html in texts:
        claims = proven_overclaims(text, is_html, "2.3" if name in ("README.md", "RELEASE-NOTES.md") else None)
        if claims:
            found.append(f"{name}: claims beyond what the chip run proved: {claims}")
    head = "### The 2.3 chip run's checklist"
    checklist = deployment[deployment.index(head):] if head in deployment else ""
    if "\n### " in checklist[len(head):]:
        checklist = checklist[:checklist.index("\n### ", len(head))]
    if refcheck.PROVEN_NEEDS not in plain(checklist) or "proven" not in plain(checklist):
        found.append("HARDWARE_DEPLOYMENT.md: the chip run's checklist does not give refcheck's rule for PROVEN")
    if f"{size:,}" not in deployment:
        found.append(f"HARDWARE_DEPLOYMENT.md does not give the load file's size, {size:,}")
    return found


def test_the_guides_say_what_refcheck_knows_of_the_tracked_file_and_where_the_framing_is_checked():
    """guide_findings finds nothing in the site's guides (guide.md, guide.html) and docs/HARDWARE_DEPLOYMENT.md for the
    tracked CAP; and the ECDH framing is checked at SET_CARD, not at install: the install's 6F00 points at the order and
    the size, the first SET_CARD's at the framing."""
    refcheck = _refcheck()
    cap = ROOT / "applet" / "target" / "cashu-javacard-2.3.0.cap"
    guide_md = (ROOT / "website" / "dist" / "guide.md").read_text(encoding="utf-8")
    guide_html = GUIDE_HTML.read_text(encoding="utf-8")
    deployment = DEPLOYMENT_MD.read_text(encoding="utf-8")
    found = guide_findings(refcheck, cap.read_bytes(), guide_md, guide_html, deployment)
    assert not found, found
    faults = re.search(r'<dl class="faults">(.*?)</dl>', guide_html, re.S).group(1)
    rows = dict(re.findall(r"<dt>(.*?)</dt><dd>(.*?)</dd>", faults, re.S))
    install = next(dd for dt, dd in rows.items() if "gp --install" in dt and "6F00" in dt)
    assert "fram" not in install, "the install's 6F00 names the ECDH framing, which is checked at SET_CARD"
    first_set_card = [dd for dt, dd in rows.items() if "SET_CARD" in dt and "6F00" in dt]
    assert first_set_card and "framing" in first_set_card[0], "no row for a first SET_CARD answering 6F00"
    md_install = next(l for l in guide_md.splitlines() if l.startswith("- `gp --install` fails with `6F00`"))
    assert "fram" not in md_install, md_install


def test_the_untried_rule_finds_each_planted_claim_in_the_three_files():
    """guide_findings, given the three files with one false claim planted (in the checked places or anywhere else in
    them, in other words, as a flip, or hidden by entities, soft hyphens, zero-width characters, look-alike letters or
    full-width forms), finds it; and finds a checklist without refcheck's rule for PROVEN."""
    refcheck = _refcheck()
    cap = (ROOT / "applet" / "target" / "cashu-javacard-2.3.0.cap").read_bytes()
    md = (ROOT / "website" / "dist" / "guide.md").read_text(encoding="utf-8")
    html_ = GUIDE_HTML.read_text(encoding="utf-8")
    hd = DEPLOYMENT_MD.read_text(encoding="utf-8")
    assert guide_findings(refcheck, cap, md, html_, hd) == []
    said = refcheck.said(_cap_parts(cap))
    if not said.startswith("this exact file has run only in a simulator"):
        # a file that has run: what its run did not cover, claimed anywhere in the three files, in other words or hidden
        s = said + "."
        plants = [
            ("md", s, s + " It is ready for production mints, tested with phones, torn on purpose, and safe to install on "
                          "any J3R180."),
            ("md", s, s + " Every 2.3 card in the field has been verified with real money at a production mint."),
            ("hd", "## Install", "## Install\n\nThis exact file has been torn on purpose and has paid a production mint "
                                 "with a phone; it is ready for cards.\n"),
            ("html", "</body>", "<p>The 2.3 build is cleared for production and has run on every J3R180 configuration."
                                "</p></body>"),
            ("md", s, s + " It has paid a production mint."),
            ("md", s, s + " It was tested with a phone."),
            ("md", s, s + " It has been torn on purpose."),
            ("md", s, s + " It installs on any J3R180."),
            ("hd", "## Install", "## Install\n\nEvery configuration of the chip runs it.\n"),
            ("hd", "## Install", "## Install\n\nIt works on all configurations.\n"),
            ("html", "</body>", "<p>The 2.3 build is cleared for production.</p></body>"),
            ("html", "</body>", "<p>It has paid a pr&shy;oduction mint.</p></body>"),
            ("md", s, s + " It was tested with a ph\u200bone."),
            ("md", s, s + " It is \u0440roduction-ready."),
            ("md", s, s + " J3R180s from any seller run it."),
        ]
        for where, old, new in plants:
            texts = {"md": md, "html": html_, "hd": hd}
            assert old in texts[where], (where, old)
            texts[where] = texts[where].replace(old, new, 1)
            assert guide_findings(refcheck, cap, texts["md"], texts["html"], texts["hd"]), (where, new)
        for fine in ("Not covered: a phone, a production mint, or a card torn on purpose.",
                     "It has not yet paid a production mint or run with a phone.",
                     "Read the NFC tag the way a phone does."):
            assert proven_overclaims(fine) == [], fine
        return
    s = said + "."
    size = refcheck.load_file_size(_cap_parts(cap))
    flip = " (Updated: the line above is old. The card now runs this file and pays real mints from it.)"
    plants = [
        ("md", s, s + " It was then installed on a J3R180 and passed its chip run."),
        ("md", s, s + " That was true until 2026-11-13: a J3R180 has since loaded it, and real payments from it were "
                      "verified on the chip. It is ready for cards."),
        ("md", s, s + " That note is out of date: the chip run is done and the file is cleared for cards."),
        ("md", s, s + flip), ("html", s, s + flip), ("hd", "file of its size.", "file of its size." + flip),
        ("html", s, s + " It has since been &#105;nstalled on a J3R180 and pa&#115;sed its c&#104;ip run."),
        ("html", s, s + " It has since been in&shy;stalled."),
        ("html", s, s + " It was <span>in</span>stalled."),
        ("md", s, s + " It has since been in\u00adstalled on a J3R180 and pas\u00adsed its chip\u00ad run."),
        ("md", s, s + " It has since been in\u200bstalled."),
        ("md", s, s + " It has since been \u0456nstalled on a J3R180."),
        ("md", s, s + " It was veri\ufb01ed on the chip."),
        ("md", s, s + " It was \uff49nstalled."),
        ("hd", "adds its answer to\nrefcheck's table.", "adds its answer to\nrefcheck's table. On 2026-11-14 this exact "
               f"{size:,}-byte file installed on a J3R180 and passed its chip run."),
        ("md", "## Rules", "## Rules\n\nThe 2.3 file installed and passed its chip run on a J3R180; it is safe to install.\n"),
        ("html", "</body>", "<p>The 2.3 build has since been verified on the chip.</p></body>"),
        ("hd", "## Install", "## Install\n\nThis exact file is ready for cards.\n"),
        # what the run of an earlier file did not cover, and the words a file tried somewhere is said in
        ("md", s, s + " The fix-15 file was tried on the bench J3R180 and every payment worked."),
        ("md", s, s + " D200's change rule and the anchored reset were checked on a chip."),
        ("hd", "## Install", "## Install\n\nThe current CAP went onto the bench card and paid testnut.\n"),
        ("html", "</body>", "<p>The tracked file has been tried on a chip; its run is done.</p></body>"),
        ("hd", "## Install", "## Install\n\nThe 2.3 file of 35,466 bytes has paid a production mint with a phone and was torn "
                             "on purpose.\n"),
        ("md", s, s + " Protocol 2.3 is ready for production on any J3R180 from any seller."),
        ("hd", "## Install", "## Install\n\nThe earlier 2.3 file has paid a production mint.\n"),
        ("readme", "## ", "## Status\n\nThe tracked file has run on a chip and is ready for production.\n\n## "),
        ("notes", "## ", "## Run\n\nThe earlier 2.3 file paid a production mint with a phone.\n\n## "),
    ]
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    notes = (ROOT / "docs" / "RELEASE-NOTES.md").read_text(encoding="utf-8")
    assert guide_findings(refcheck, cap, md, html_, hd, readme, notes) == []
    for where, old, new in plants:
        texts = {"md": md, "html": html_, "hd": hd, "readme": readme, "notes": notes}
        assert old in texts[where], (where, old)
        texts[where] = texts[where].replace(old, new, 1)
        assert guide_findings(refcheck, cap, texts["md"], texts["html"], texts["hd"], texts["readme"], texts["notes"]), (where, new)
    head = "### The 2.3 chip run's checklist"
    checklist = hd[hd.index(head):]
    checklist = checklist[:checklist.index("\n### ", len(head))]
    bullet = next(b for b in checklist.split("\n- ") if "PROVEN" in b)
    assert guide_findings(refcheck, cap, md, html_, hd.replace("\n- " + bullet, "", 1)), "a checklist without the rule"


def _cap_parts(cap_bytes):
    import io
    import zipfile
    with zipfile.ZipFile(io.BytesIO(cap_bytes)) as z:
        return {n.rsplit("/", 1)[-1][:-4]: z.read(n) for n in z.namelist() if n.endswith(".cap")}


def test_the_untried_rule_refuses_a_claim_of_an_install_or_a_chip_run():
    """The untried rule reads a text as a reader sees it and finds each claim of an install, a chip run or a pass beside
    refcheck's sentence, however it is written (other words, a flip, entities, soft hyphens, zero-width characters,
    look-alike letters, markdown marks); over a whole file it finds a sentence that names the file and claims one, and
    the sentence alone, its negation and the guides' own words claim nothing."""
    said = "this exact file has run only in a simulator so far, and no card has installed it or a file of its size"
    plant = ("until 2026-11-13 this exact file has run only in a simulator; it was then installed on a J3R180 and passed "
             "its chip run, so it is safe to install")
    assert said not in plain(plant), "a hedge cut short is not the sentence"
    assert {"installed", "passed", "chip run", "safe to install"} <= set(untried_claims(plant, said)), untried_claims(plant, said)
    assert untried_claims("The 2.3 build: " + said.replace(" so far", "\n so far") + ". If the install in step 4 fails, stop.", said) == []
    assert untried_claims("No card has installed this exact file or a file of its size. Stop.", said) == []
    for claim in ("It installs on a J3R180.", "Proven on silicon.", "It has run on a card.", "The chip run went well.",
                  "It passed.", "Now safe to install.", "Tested on a J3R452.", "It ran on a card.",
                  # other words
                  "That was true until 2026-11-13: a J3R180 has since loaded it, and real payments from it were verified "
                  "on the chip. It is ready for cards.",
                  "A J3R180 loaded it.", "Verified on the chip.", "It is ready for cards.",
                  # the plain-words flip
                  "(Updated: the line above is old. The card now runs this file and pays real mints from it.)",
                  "The card now runs this file.", "It pays real mints.", "That note is out of date.",
                  # hidden: entities, a soft hyphen, a zero-width space, a Cyrillic i, a Greek o, markdown marks
                  "It has since been &#105;nstalled on a J3R180 and pa&#115;sed its c&#104;ip run.",
                  "It has been in­stalled.", "It has been in​stalled.", "It has been іnstalled.",
                  "Prοven.", "It was in**stall**ed.", "It was <b>in</b>stalled.", "It was &amp;#105;nstalled."):
        html_text = "<" in claim
        assert untried_claims(said + ". " + claim, said, html_text), claim
    names = ("this exact file", "this exact", "2.3 file", "2.3 build", "35,466", "48b8597c")
    for doc in ("On 2026-11-14 this exact 35,466-byte file installed on a J3R180 and passed its chip run.",
                "## Rules\n\nThe 2.3 file installed and passed its chip run on a J3R180; it is safe to install.\n",
                "The load file 48b8597c­ has since been loaded on a card.",
                "Some words. It is safe to install."):
        assert file_claims(doc, said, names), doc
    for doc in ("The 2.3 build is **35,466 bytes**: " + said + ". The chip run that releases it installs it first.",
                "- `gp --install` fails with `6F00`: no card has installed this exact file or a file of its size.",
                "On 2026-11-13 a J3R180 installed the files of 33,647 and 35,213 bytes.",
                "Add the load file's sha256 to PROVEN only once real signatures and real change verified on the chip."):
        assert file_claims(doc, said, names) == [], doc


# ---- A wallet built from the text alone (D202, the pickup proof, the owner's proofs) --------------------------------
# Its own curve arithmetic, not cardctl's nor the applet's: what the text says each vector is, worked out again.

def _t_h(*b):
    import hashlib
    return hashlib.sha256(b"".join(b)).digest()


_K1 = (2**256 - 2**32 - 977, 0, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
       (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
        0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8))
_R1 = (0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff,
       0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc,
       0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551,
       (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
        0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5))


def _t_add(c, P, Q):
    p, a = c[0], c[1]
    if P is None:
        return Q
    if Q is None:
        return P
    if P[0] == Q[0] and (P[1] + Q[1]) % p == 0:
        return None
    if P == Q:
        lam = (3 * P[0] * P[0] + a) * pow(2 * P[1], -1, p) % p
    else:
        lam = (Q[1] - P[1]) * pow(Q[0] - P[0], -1, p) % p
    x = (lam * lam - P[0] - Q[0]) % p
    return (x, (lam * (P[0] - x) - P[1]) % p)


def _t_mul(c, k, P):
    R = None
    while k:
        if k & 1:
            R = _t_add(c, R, P)
        P = _t_add(c, P, P)
        k >>= 1
    return R


def _t_k1(b):
    p = _K1[0]
    if b[0] == 4:
        return (int.from_bytes(b[1:33], "big"), int.from_bytes(b[33:65], "big"))
    x = int.from_bytes(b[1:], "big")
    y = pow((x ** 3 + 7) % p, (p + 1) // 4, p)
    return (x, y if (y & 1) == (b[0] == 3) else p - y)


def _t_bip340(px, msg, sig):
    n = _K1[2]
    tag = _t_h(b"BIP0340/challenge")
    e = int.from_bytes(_t_h(tag, tag, sig[:32], px.to_bytes(32, "big"), msg), "big") % n
    R = _t_add(_K1, _t_mul(_K1, int.from_bytes(sig[32:], "big"), _K1[3]), _t_mul(_K1, n - e, _t_k1(b"\x02" + px.to_bytes(32, "big"))))
    return R is not None and R[1] % 2 == 0 and R[0] == int.from_bytes(sig[:32], "big")


def _t_ecdsa(Q, msg, sig):
    n = _R1[2]
    assert sig[0] == 0x30 and sig[1] == len(sig) - 2
    i, rs = 2, []
    for _ in range(2):
        assert sig[i] == 2
        rs.append(int.from_bytes(sig[i + 2:i + 2 + sig[i + 1]], "big"))
        i += 2 + sig[i + 1]
    r, s = rs
    w = pow(s, -1, n)
    X = _t_add(_R1, _t_mul(_R1, int.from_bytes(_t_h(msg), "big") * w % n, _R1[3]), _t_mul(_R1, r * w % n, Q))
    return X is not None and X[0] % n == r


def test_the_vectors_are_worked_out_again_from_the_text_alone():
    """
    A wallet written from spec/APDU.md and NUT-CCP alone, with its own curve arithmetic, works out every value of
    owner-c.json (the seed, s, the PIN key's signature, E, x, the envelope with i one byte and the tag, its APDU, the
    check, c for n = 1, the date's keys), pickup.json (m, the bytes hashed, the AUTH signature, the proof, the APDU)
    and verifies every proof of owner.json; and owner.json has a proof for every value the owner's-proof table lists.
    """
    import hashlib, hmac, unicodedata
    V = SPEC_DIR / "vectors"
    hx = bytes.fromhex
    oc = json.loads((V / "owner-c.json").read_text(encoding="utf-8"))
    seed = hashlib.pbkdf2_hmac("sha512", unicodedata.normalize("NFKD", oc["words"]).encode(), b"mnemonic", 2048)
    assert seed.hex() == oc["seed"], "the seed from the words"
    P, Q, L = hx(oc["cardKey"]), hx(oc["pinKey"]), b"CashuCard/c"
    s = hmac.new(seed, L + b"\x00" + P, hashlib.sha256).digest()
    assert s.hex() == oc["s"], "s = HMAC-SHA256(seed, label || 00 || P)"
    assert _t_bip340(_t_k1(P)[0], _t_h(b"CashuCard/pinkey", Q), hx(oc["pinKeySig"])), "the PIN key's signature"
    e = int.from_bytes(hx(oc["e"]), "big")
    Ept = _t_mul(_K1, e, _K1[3])
    E = b"\x04" + Ept[0].to_bytes(32, "big") + Ept[1].to_bytes(32, "big")
    assert E.hex() == oc["E"], "E = e*G"
    x = _t_mul(_K1, e, _t_k1(Q))[0].to_bytes(32, "big")
    assert x.hex() == oc["x"], "x of e*Q"
    sealed = bytes(a ^ b for a, b in zip(s, _t_h(L, b"\x01", x, E)))      # block i, i one byte
    env = E + sealed + _t_h(L, b"\x00", x, E, sealed)[:16]                   # the tag: block 0's first sixteen bytes
    assert env.hex() == oc["envelope"], "the envelope"
    assert (bytes([0xB0, 0x43, 1, 0, len(env)]) + env).hex() == oc["stage"], "SET_OWNER P1 01"
    assert _t_h(L, s)[:16].hex() == oc["check"], "the check"
    c = _t_h(L, s, (1).to_bytes(4, "big"))
    assert c.hex() == oc["c"], "c for n = 1"
    D = oc["date"].to_bytes(4, "big")
    t = int.from_bytes(_t_h(b"CashuCard/key", c, D), "big") % _K1[2]
    u = int.from_bytes(_t_h(b"CashuCard/refund-key", c, D), "big") % _K1[2]
    comp = lambda pt: bytes([2 + (pt[1] & 1)]) + pt[0].to_bytes(32, "big")
    gk = (t.to_bytes(32, "big") + comp(_t_add(_K1, _t_k1(P), _t_mul(_K1, t, _K1[3])))
          + comp(_t_add(_K1, _t_k1(hx(oc["refundKey"])), _t_mul(_K1, u, _K1[3]))))
    assert gk.hex() == oc["groupKeys"], "the date's keys under the owner's c"
    pk = json.loads((V / "pickup.json").read_text(encoding="utf-8"))
    nonces, r16 = [hx(z) for z in pk["nonces"]], hx(pk["rand16"])
    m = _t_h(b"CashuCard/pickup", *nonces, r16)[:16]
    assert m.hex() == pk["m"] and (b"CashuCard/pickup" + b"".join(nonces) + r16).hex() == pk["hashed"], "the pickup m"
    ans, Pp, T = hx(pk["answer"]), hx(pk["cardKey"]), _t_h(b"CashuCard/auth")
    assert _t_bip340(_t_k1(Pp)[0], _t_h(T, T, m, ans[:16], Pp), ans[16:]), "the pickup's AUTH signature"
    assert (bytes([len(nonces)]) + b"".join(nonces) + r16 + ans).hex() == pk["proof"], "the pickup proof"
    assert (bytes([0xB0, 0x15, 0, 0, 16]) + m + b"\x50").hex() == pk["auth"], "the pickup's AUTH APDU"
    ow = json.loads((V / "owner.json").read_text(encoding="utf-8"))
    OK = (int.from_bytes(hx(ow["ownerKey"])[1:33], "big"), int.from_bytes(hx(ow["ownerKey"])[33:65], "big"))
    seen = {}
    for pr in ow["proofs"]:
        assert _t_ecdsa(OK, pr["label"].encode() + hx(pr["nonce"]) + hx(pr["value"]), hx(pr["signature"])), pr["label"]
        seen.setdefault(pr["label"], set()).add(len(pr["value"]) // 2)
    # every value the owner's-proof table lists (spec/APDU.md, The owner's proof)
    want = {"CashuCard/change-pin": {4}, "CashuCard/set-limit": {4, 8, 12, 13, 17, 18}, "CashuCard/load": {0},
            "CashuCard/lock": {0}, "CashuCard/tag": {1}, "CashuCard/reset": {0, 1, 80}, "CashuCard/refresh": {80, 81},
            "CashuCard/set-owner": {65, 81, 145, 161}}
    for label, lengths in want.items():
        assert lengths <= seen.get(label, set()), (label, sorted(seen.get(label, set())), "wanted", sorted(lengths))
    assert "CashuCard/set-card" in seen


if __name__ == "__main__":
    import types

    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and isinstance(fn, types.FunctionType):
            try:
                fn()
                print(f"PASS  {name}")
            except (SystemExit, Exception) as exc:
                failures += 1
                print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
                if not isinstance(exc, (AssertionError, SystemExit)):
                    traceback.print_exc()
    print(f"\n{'all tests passed' if not failures else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
