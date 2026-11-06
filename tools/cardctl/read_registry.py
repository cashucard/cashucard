#!/usr/bin/env python3
"""Read-only registry readout for an installed lab card.

Sends exactly the allowlisted APDUs and nothing else: the CPLC, two GET DATA
reads, SELECT of the ISD, and the GET STATUS listing pages for load files and
applications. There is no key material here and no secure channel, so no frame
this program can build is authenticated, and the allowlist refuses anything
outside the table before it reaches the reader.

    python3 read_registry.py --dry-run           # print the plan, no reader
    python3 read_registry.py --out report.json   # one pass against the reader
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time

# (label, APDU bytes). Le is the final 0x00 on every command that takes one.
FILTER = bytes([0x4F, 0x00])  # no AID filter, as sdk.registryCommand sends it
CPLC = bytes([0x80, 0xCA, 0x9F, 0x7F, 0x00])
GET_DATA = bytes([0x80, 0xCA, 0x00, 0xE2, 0x00])
SELECT_ISD = bytes([0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x01, 0x51, 0x00, 0x00, 0x00])


def listing(kind: int, more: bool) -> bytes:
    """GET STATUS for one kind: 0x20 load files, 0x40 applications."""
    return bytes([0x80, 0xF2, kind, 0x03 if more else 0x02, 0x02]) + FILTER + b"\x00"


def allowed(apdu: bytes) -> bool:
    if apdu in (CPLC, GET_DATA, SELECT_ISD):
        return True
    return apdu in {
        listing(0x20, False),
        listing(0x20, True),
        listing(0x40, False),
        listing(0x40, True),
    }


def dry_run() -> list[dict]:
    return [
        {"label": "cplc", "apdu": CPLC.hex()},
        {"label": "get-data", "apdu": GET_DATA.hex()},
        {"label": "select-isd", "apdu": SELECT_ISD.hex()},
        {"label": "load-files-0", "apdu": listing(0x20, False).hex()},
        {"label": "load-files-1", "apdu": listing(0x20, True).hex()},
        {"label": "applications-0", "apdu": listing(0x40, False).hex()},
        {"label": "applications-1", "apdu": listing(0x40, True).hex()},
    ]


class Refused(Exception):
    pass


EXPECTED_CPLC = "cplc-v1:4790d3213041093361205547"


def cplc_id(data: bytes) -> str:
    """The installed chip's identity string, as cardkit's parseCplc builds it."""
    if len(data) != 45 or data[:3] != b"\x9f\x7f\x2a":
        return ""
    field = lambda a, b: data[3 + a : 3 + b].hex()
    return "cplc-v1:" + "".join(
        (
            field(0, 2),
            field(2, 4),
            field(10, 12),
            field(12, 16),
            field(16, 18),
        )
    )


def connect():
    from smartcard.System import readers

    found = readers()
    if not found:
        raise SystemExit("no PC/SC readers found; is the ACR122U plugged in?")
    for reader in found:
        if "ACR122" in str(reader).upper():
            connection = reader.createConnection()
            connection.connect()
            return str(reader), connection
    raise SystemExit(f"no ACR122U among {[str(r) for r in found]}")


def transcribe(connection, label: str, apdu: bytes) -> dict:
    if not allowed(apdu):
        raise Refused(f"refusing {apdu.hex()}: not a read-only allowlisted command")
    started = time.perf_counter()
    data, sw1, sw2 = connection.transmit(list(apdu))
    return {
        "label": label,
        "apdu": apdu.hex(),
        "data": bytes(data).hex(),
        "sw": f"{sw1:02x}{sw2:02x}",
        "ms": round((time.perf_counter() - started) * 1000, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out", help="write the transcript here")
    args = parser.parse_args()

    if args.dry_run:
        for row in dry_run():
            print(f"{row['label']:<16} {row['apdu']}")
        return 0

    reader_name, connection = connect()
    transcript: list[dict] = []
    cplc = ""

    def send(label: str, apdu: bytes) -> dict:
        row = transcribe(connection, label, apdu)
        transcript.append(row)
        print(f"{row['label']:<16} {row['sw']}  {row['data']}", flush=True)
        return row

    try:
        # The CPLC is the identity gate; GET DATA and SELECT only need to be
        # attempted, and their status words are recorded either way (an
        # installed card is not the empty one the 00E2 read describes).
        send("cplc", CPLC)
        cplc = cplc_id(bytes.fromhex(transcript[0]["data"]))
        for label, apdu in (("get-data", GET_DATA), ("select-isd", SELECT_ISD)):
            send(label, apdu)
        if cplc != EXPECTED_CPLC:
            raise Refused(f"CPLC {cplc or 'unparsed'} is not {EXPECTED_CPLC}")
        for kind, name in ((0x20, "load-files"), (0x40, "applications")):
            page = send(f"{name}-0", listing(kind, False))
            if page["sw"] in ("6a88",):
                continue
            if page["sw"] == "6310":
                more = send(f"{name}-1", listing(kind, True))
                if more["sw"] not in ("9000", "6a88"):
                    raise Refused(f"{name} page 1 answered {more['sw']}")
            elif page["sw"] != "9000":
                raise Refused(f"{name} page 0 answered {page['sw']}")
    except Refused as error:
        print(f"\nstopped: {error}", file=sys.stderr)
        transcript_row = {"stopped": str(error)}
    except Exception as error:  # noqa: BLE001 — the transcript is evidence; keep it
        print(f"\nstopped: {type(error).__name__}: {error}", file=sys.stderr)
        transcript_row = {"stopped": f"{type(error).__name__}: {error}"}
    else:
        transcript_row = {}

    body = {
        "plan": "registry-readout-v1",
        "reader": reader_name,
        "readAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cplc": cplc if transcript else "",
        "commands": len(transcript),
        "transcript": transcript,
        **transcript_row,
    }
    raw = json.dumps(body, indent=2, sort_keys=True)
    body["transcriptSha256"] = hashlib.sha256(raw.encode()).hexdigest()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(body, indent=2, sort_keys=True) + "\n")
        print(f"\nwrote {args.out}")
    else:
        print(json.dumps(body, indent=2, sort_keys=True))
    return 0 if not transcript_row else 1


if __name__ == "__main__":
    sys.exit(main())
