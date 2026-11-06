"""No PC/SC imports, card or reader: the registry readout's allowlist and dry-run plan."""
import contextlib
import io
import sys
import unittest
from unittest import mock

import read_registry as r

PLAN = [
    ('cplc', '80ca9f7f00'),
    ('get-data', '80ca00e200'),
    ('select-isd', '00a4040007a000000151000000'),
    ('load-files-0', '80f22002024f0000'),
    ('load-files-1', '80f22003024f0000'),
    ('applications-0', '80f24002024f0000'),
    ('applications-1', '80f24003024f0000'),
]


class AllowlistTest(unittest.TestCase):
    def test_admits_exactly_the_planned_reads(self):
        for _, apdu in PLAN:
            with self.subTest(apdu=apdu):
                self.assertTrue(r.allowed(bytes.fromhex(apdu)))

    def test_refuses_writes_other_reads_and_near_misses(self):
        refused = [
            '80e400000d4f0bf04341534855434d50544d00',  # DELETE
            '80e60c00',  # INSTALL
            '80e8000000',  # LOAD
            '80d8000000',  # PUT KEY
            '8050000008' + '00' * 8,  # INITIALIZE UPDATE
            '80f28002024f0000',  # GET STATUS of the ISD itself
            '80f21002024f0000',  # GET STATUS of load files and modules
            '80f22002024f00',  # no Le
            '80f2200202' + '4f00' + '01',  # different Le
            '80f22002044f02a0000000',  # an AID filter
            '80ca9f7f',  # CPLC without Le
            '80ca9f7f0000',  # CPLC with a trailing byte
            '00ca9f7f00',  # CPLC on the wrong class
            '80ca006600',  # another GET DATA tag
            '00a4040007a000000151000001',  # SELECT of another AID
            '00a40400',  # truncated SELECT
            '',
        ]
        for apdu in refused:
            with self.subTest(apdu=apdu):
                self.assertFalse(r.allowed(bytes.fromhex(apdu)))

    def test_transcribe_refuses_before_the_reader(self):
        connection = mock.Mock()
        with self.assertRaises(r.Refused):
            r.transcribe(connection, 'delete', bytes.fromhex('80e400000d4f0bf04341534855434d50544d00'))
        connection.transmit.assert_not_called()


class DryRunTest(unittest.TestCase):
    def test_plan_is_the_seven_allowlisted_reads_in_order(self):
        plan = r.dry_run()
        self.assertEqual([(row['label'], row['apdu']) for row in plan], PLAN)
        self.assertTrue(all(r.allowed(bytes.fromhex(row['apdu'])) for row in plan))

    def test_dry_run_flag_prints_the_plan_without_opening_a_reader(self):
        out = io.StringIO()
        # A None entry makes any `import smartcard...` raise, so a dry run that
        # reached for the reader would fail here rather than touch PC/SC.
        blocked = {'smartcard': None, 'smartcard.System': None}
        with mock.patch.object(sys, 'argv', ['read_registry.py', '--dry-run']), \
                mock.patch.dict(sys.modules, blocked), \
                mock.patch.object(r, 'connect', side_effect=AssertionError('reader opened')), \
                contextlib.redirect_stdout(out):
            self.assertEqual(r.main(), 0)
        rows = [line.split() for line in out.getvalue().splitlines()]
        self.assertEqual([tuple(row) for row in rows], PLAN)


if __name__ == '__main__':
    unittest.main()
