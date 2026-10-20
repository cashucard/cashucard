"""
The `tip` subcommand (ENG-740): the ops service's 80-byte tip header, for
`set-owner --anchor` and `refresh --header` to stop being a manual copy.

The HTTP client (cardctl.fetch_tip's urlopen) is monkeypatched here — the
no-network guarantee of this suite is kept; no test opens a socket. The
header bytes are validated by the same parse_header the card commands use,
so a wrong-length answer fails here exactly as it would at the card.

Run:  python3 -m pytest test_tip.py -q     (or: python3 test_tip.py)
"""

import contextlib
import io
import json
import sys
import types

import cardctl

HEADER_80 = bytes(range(80))


def fake_urlopen(headers_or_error, status_body=None):
    """Patch cardctl's urlopen with a canned answer, or an exception type."""
    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps(status_body).encode("utf-8")

    def urlopen(req, timeout=None):
        if isinstance(headers_or_error, Exception):
            raise headers_or_error
        return Resp()

    return urlopen


def run_main(argv):
    """cardctl.main with argv, output captured; returns (code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    argv_backup = sys.argv
    sys.argv = ["cardctl.py"] + argv
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cardctl.main()
    finally:
        sys.argv = argv_backup
    return code, out.getvalue(), err.getvalue()


def test_tip_prints_the_80_byte_header_hex():
    """tip fetches, validates and prints the header hex."""
    calls = []

    def fake(url):
        calls.append(url)
        return HEADER_80

    saved = cardctl.fetch_tip
    cardctl.fetch_tip = fake
    try:
        code, out, err = run_main(["tip", "--url", "http://ops.test:1"])
    finally:
        cardctl.fetch_tip = saved
    assert code == 0
    assert out.strip() == HEADER_80.hex()
    assert calls == ["http://ops.test:1"]


def test_tip_defaults_to_the_local_service():
    calls = []

    def fake(url):
        calls.append(url)
        return HEADER_80

    saved = cardctl.fetch_tip
    cardctl.fetch_tip = fake
    try:
        code, out, _ = run_main(["tip"])
    finally:
        cardctl.fetch_tip = saved
    assert code == 0
    assert calls == [cardctl.DEFAULT_OPS_URL]


def test_tip_rejects_a_wrong_length_header():
    """Validation lives in fetch_tip (parse_header); mock at the urlopen seam."""
    import urllib.request

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen(None, {"header": bytes(range(79)).hex()})
    try:
        try:
            run_main(["tip"])
            raised = False
        except SystemExit as exc:
            raised = "80 bytes" in str(exc)
    finally:
        urllib.request.urlopen = real_urlopen
    assert raised


def test_fetch_tip_parses_hex_and_validates_length():
    """The fetcher itself (monkeypatched urlopen — still no socket)."""
    saved = cardctl.urlopen if hasattr(cardctl, "urlopen") else None
    # fetch_tip imports urllib inside the function; patch the module attribute
    import urllib.request

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen(None, {"header": HEADER_80.hex()})
    try:
        assert cardctl.fetch_tip("http://ops.test") == HEADER_80
    finally:
        urllib.request.urlopen = real_urlopen

    # a wrong-length header is a SystemExit naming the length
    urllib.request.urlopen = fake_urlopen(None, {"header": "ab" * 40})
    try:
        try:
            cardctl.fetch_tip("http://ops.test")
            raised = False
        except SystemExit as exc:
            raised = "80 bytes" in str(exc)
        assert raised
    finally:
        urllib.request.urlopen = real_urlopen


def test_fetch_tip_survives_a_dead_service_with_a_clear_error():
    import urllib.request

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen(ConnectionError("refused"))
    try:
        try:
            cardctl.fetch_tip("http://ops.test")
            raised = False
        except SystemExit as exc:
            raised = "did not answer" in str(exc)
        assert raised
    finally:
        urllib.request.urlopen = real_urlopen


def test_fetch_tip_sends_no_authorization_header():
    """GET /anchor/tip is public on the ops service; the request fetch_tip
    builds must carry no Authorization header, or the real service answers
    401 and tip / set-owner-url can never succeed (the seam this pins:
    ops/test/sessions-clean.test.ts drives the real router with the same
    headerless request)."""
    import urllib.request

    seen = {}

    def capture(req, timeout=None):
        seen["headers"] = dict(req.header_items())
        seen["has_auth"] = req.headers.get("Authorization") is not None
        return fake_urlopen(None, {"header": HEADER_80.hex()})(req, timeout)

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = capture
    try:
        assert cardctl.fetch_tip("http://ops.test") == HEADER_80
    finally:
        urllib.request.urlopen = real_urlopen
    assert not seen["has_auth"], "fetch_tip must send no Authorization header"
    assert not any(k.lower() == "authorization" for k in seen["headers"])


def test_set_owner_url_fetches_then_anchors():
    """set-owner-url: sugar that fills --anchor from the feed, then runs set-owner."""
    calls = []

    def fake(url):
        calls.append(url)
        return HEADER_80

    saved_fetch, saved_connect = cardctl.fetch_tip, cardctl.connect

    class FakeCard:
        def set_owner(self, pub, anchor, old):
            assert anchor == HEADER_80
            self.anchored = True

        def get_info(self):
            return {"now": 0, "has_owner": False}

    cardctl.fetch_tip = fake
    cardctl.connect = lambda args: FakeCard()
    try:
        code, out, _ = run_main(["set-owner-url", "--url", "http://ops.test"])
    finally:
        cardctl.fetch_tip, cardctl.connect = saved_fetch, saved_connect
    assert code == 0
    assert calls == ["http://ops.test"]


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(vars(sys.modules[__name__]).items()):
        if name.startswith("test_") and isinstance(fn, types.FunctionType):
            try:
                fn()
                print(f"ok {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
