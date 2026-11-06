"""Closed read-only PC/SC bridge for one card's installation public key.

Plan: docs/reports/HARDWARE_PLAN_2026-11-02.recover-installed.md
(`recover-installed-v1`), reader pass A.

The recovery bridge cannot serve this pass: it requires the expected key before
it opens the reader, so it cannot be the thing that reads it. This policy admits
four frames in one order — ISD select, CPLC, SELECT of the private main, and one
INS 7A read —
and refuses every other command class, including all of `84 xx` (no
authentication, no deletion). The key read is refused unless the select returned
the private applet's protocol selector, so a key read from the ISD or from a
foreign applet cannot happen.

Nothing is written to the card: no PUT KEY, no LOAD, no INSTALL, no secure
channel exists in this program.
"""
import argparse
import json
import re
import sys
sys.path.insert(0, __import__('pathlib').Path(__file__).resolve().parent)
import probe_bridge as common
import compact_bridge as b

READER = 'ACS ACR122U PICC Interface'
# This card answers CPLC only from the ISD applet: on a fresh connection, with
# no applet selected, the same frame is 6A86 (see HARDWARE_PLAN § Outcome).
# So the pass opens with the ISD select and reads the chip from there.
SELECT_ISD = common.select(common.ISD)
CPLC = bytes.fromhex('80ca9f7f00')
SELECT = common.select(b.PRIVATE[0])
KEY = b.cmd(0x7a)
KEY_RESPONSE = re.compile(r'(02|03)[0-9a-f]{64}')

class Policy:
    def __init__(self):
        self.isd = False
        self.selected = False
        self.sent = {}
        self.total = 0
        self.failed = False

    def before(self, value):
        if self.failed or self.total >= 5: raise ValueError('read stopped')
        if not isinstance(value, list) or any(type(v) is not int or not 0 <= v <= 255 for v in value):
            raise ValueError('invalid APDU')
        a = bytes(value)
        if a not in (SELECT_ISD, CPLC, SELECT, KEY): raise ValueError('read-only command refused')
        limit = {SELECT_ISD: 1, CPLC: 1, SELECT: 1, KEY: 2}[a]
        if self.sent.get(a, 0) >= limit: raise ValueError('bounded read already sent')
        if a == CPLC and not self.isd: raise ValueError('security domain not selected')
        if a == KEY and not self.selected: raise ValueError('private applet not selected')
        self.sent[a] = self.sent.get(a, 0) + 1
        self.total += 1
        return a

    def after(self, a, data, sw1, sw2):
        data = bytes(data); sw = (sw1, sw2)
        if a == SELECT_ISD:
            self.isd = data.startswith(b'\x6f') and sw == (0x90, 0)
            if not self.isd: self.failed = True
        elif a == SELECT:
            self.selected = data == b'CPROT\x02' and sw == (0x90, 0)
            if not self.selected: self.failed = True
        elif a == KEY:
            if sw != (0x90, 0) or not KEY_RESPONSE.fullmatch(data.hex()): self.failed = True
        elif sw != (0x90, 0):
            self.failed = True

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reader', required=True)
    args = p.parse_args()
    if args.reader != READER: raise ValueError('named reader required')
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD, SCARD_SHARE_EXCLUSIVE
    matches = [r for r in common.checked('reader-enumeration-failed', readers) if str(r) == args.reader]
    if len(matches) != 1: raise common.BridgeFailure('reader-unavailable')
    c = common.checked('reader-connect-failed', matches[0].createConnection)
    connected = False
    try:
        common.checked('reader-connect-failed', lambda: c.connect(mode=SCARD_SHARE_EXCLUSIVE, disposition=SCARD_LEAVE_CARD))
        connected = True
        common.emit({'ready': True})
        policy = Policy()
        while True:
            line = sys.stdin.readline(4097)
            if not line: return
            if len(line) > 4096 or not line.endswith('\n'): raise common.BridgeFailure('bridge-input-invalid')
            message = common.checked('bridge-input-invalid', lambda: json.loads(line))
            if message == {'close': True}: return
            if not isinstance(message, dict) or set(message) != {'apdu'}: raise common.BridgeFailure('bridge-input-invalid')
            a = common.checked('read-command-refused', lambda: policy.before(message['apdu']))
            data, sw1, sw2 = common.checked('reader-transmit-failed', lambda: c.transmit(list(a)))
            policy.after(a, data, sw1, sw2)
            common.emit({'reply': data + [sw1, sw2]})
    finally:
        if connected:
            prior = sys.exc_info()[0] is not None
            try: common.checked('reader-close-failed', c.disconnect)
            except common.BridgeFailure:
                if not prior: raise

if __name__ == '__main__':
    try: main()
    except Exception as error:
        common.emit(common.failure_message(error)); sys.exit(1)
