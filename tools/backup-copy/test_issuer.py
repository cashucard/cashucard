import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from issuer_source import IssuerTransfer, https_origin, IneligibleExport
import connect

ISSUER = '11111111-2222-4333-8444-555555555555'
NAME = '2026-10-21T00:00:00.000Z-' + ISSUER + '.age'
CONFIG = {'issuer_origin': 'https://issuer.invalid', 'issuer_id': ISSUER,
          'issuer_secret': 'a' * 43, 'source': 'issuer:' + ISSUER}

class Http:
    def __init__(self, responses):
        self.responses, self.requests = iter(responses), []
    def open(self, request, **kwargs):
        self.requests.append(request)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(response if isinstance(response, bytes) else json.dumps(response).encode())

class Checks(unittest.TestCase):
    def test_source_pagination_identity_download_and_destination_delegation(self):
        class Destination:
            def put(self, path, name): self.saved = name
        dest = Destination()
        http = Http([{'issuer_id': ISSUER, 'objects': [{'Name': NAME, 'Size': 10, 'IsDir': False}], 'cursor': 'next'},
                     {'issuer_id': ISSUER, 'objects': [], 'cursor': None}, b'ciphertext'])
        transfer = IssuerTransfer(CONFIG, dest, http)
        self.assertEqual(len(transfer.list()), 1)
        self.assertTrue(http.requests[1].full_url.endswith('?cursor=next'))
        self.assertEqual(http.requests[0].get_header('Authorization'), 'Bearer recovery-v1.' + 'a' * 43)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'copy.age'
            transfer.get('source', NAME, path)
            self.assertEqual(path.read_bytes(), b'ciphertext')
            transfer.put(path, NAME)
            self.assertEqual(dest.saved, NAME)
        self.assertTrue(all(request.get_header('User-agent') == 'Atoll Recovery'
                            for request in http.requests))
        with self.assertRaises(ValueError): transfer.get('source', '../outside', Path('/unused'))
        wrong = Http([{'issuer_id': 'different', 'objects': [], 'cursor': None}])
        with self.assertRaises(ValueError): IssuerTransfer(CONFIG, dest, wrong).list()

    def test_explicit_copy_attestation_binds_snapshot_and_ciphertext(self):
        receipt = {'name': NAME, 'sha256': 'a' * 64, 'size': 10}
        metadata = {'issuer_id': ISSUER, 'name': NAME, 'exported_at': 1700000000,
                    'sha256': receipt['sha256'], 'bytes': 10}
        http = Http([metadata, {'accepted': True}])
        transfer = IssuerTransfer({**CONFIG, 'attest_copies': True}, None, http)
        self.assertEqual(transfer.confirm_copy(receipt), 1700000000)
        request = http.requests[1]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'name': NAME, 'exported_at': 1700000000,
                                                   'sha256': 'a' * 64, 'bytes': 10})
        bad = IssuerTransfer({**CONFIG, 'attest_copies': True}, None,
                             Http([{**metadata, 'sha256': 'b' * 64}]))
        with self.assertRaises(ValueError): bad.confirm_copy(receipt)
        legacy_http = Http([])
        self.assertIsNone(IssuerTransfer(CONFIG, None, legacy_http).confirm_copy(receipt))
        self.assertEqual(legacy_http.requests, [])

    def test_only_explicit_missing_source_metadata_is_an_ineligible_archive(self):
        receipt = {'name': NAME, 'sha256': 'a' * 64, 'size': 10}
        for status, reason, expected in [
                (409, 'source-metadata-unavailable', IneligibleExport),
                (403, 'attestation-required', urllib.error.HTTPError),
                (404, 'not-found', urllib.error.HTTPError)]:
            error = urllib.error.HTTPError('https://issuer.invalid', status, '', {},
                                           io.BytesIO(json.dumps({'reason': reason}).encode()))
            transfer = IssuerTransfer({**CONFIG, 'attest_copies': True}, None, Http([error]))
            with self.assertRaises(expected): transfer.confirm_copy(receipt)

    def test_https_only_routes_and_bounded_metadata(self):
        for origin in ['http://issuer.invalid', 'https://user:pass@issuer.invalid', 'https://issuer.invalid/path', 'https://issuer.invalid?token=secret', 'https://issuer.invalid#fragment']:
            with self.assertRaises(ValueError): https_origin(origin)
        duplicate = {'issuer_id': ISSUER, 'objects': [{'Name': NAME, 'Size': 10, 'IsDir': False}] * 2}
        with self.assertRaises(ValueError): IssuerTransfer(CONFIG, None, Http([duplicate])).list()
        self.assertIsNone(__import__('issuer_source').NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid'))

    def test_pairing_and_nextcloud_authorization_use_private_channels_and_reject_redirected_origins(self):
        with patch.object(connect, 'request', return_value={'issuer_id': ISSUER, 'connection_id': ISSUER}):
            self.assertEqual(connect.connect('pair-issuer', {'origin': CONFIG['issuer_origin'], 'code': 'b' * 43, 'secret': 'a' * 43})['issuer_id'], ISSUER)
        flow = {'poll': {'endpoint': 'https://cloud.invalid/index.php/login/v2/poll', 'token': 'private-flow-token'},
                'login': 'https://cloud.invalid/index.php/login/v2/flow/private-login-token'}
        with patch.object(connect, 'request', return_value=flow):
            self.assertEqual(connect.connect('nextcloud-start', {'origin': 'https://cloud.invalid'})['poll_token'], 'private-flow-token')
            flow['poll']['endpoint'] = 'https://evil.invalid/login/v2/poll'
            with self.assertRaises(ValueError): connect.connect('nextcloud-start', {'origin': 'https://cloud.invalid'})

    def test_nextcloud_pending_approval_and_admin_token_rejection(self):
        pending = Http([urllib.error.HTTPError('https://cloud.invalid', 404, '', {}, io.BytesIO())])
        config = {'origin': 'https://cloud.invalid', 'poll_path': '/login/v2/poll', 'poll_token': 'private-flow-token'}
        with patch.object(connect, 'opener', return_value=pending):
            self.assertEqual(connect.connect('nextcloud-finish', config), {'pending': True})
        approval = {'server': config['origin'], 'loginName': 'dedicated', 'appPassword': 'private-app-password'}
        for groups, accepted in [([], True), (['admin'], False)]:
            http = Http([approval, {'ocs': {'data': {'id': 'dedicated', 'groups': groups, 'subadmin': []}}}, b''])
            with patch.object(connect, 'opener', return_value=http):
                if accepted:
                    self.assertEqual(connect.connect('nextcloud-finish', config)['username'], 'dedicated')
                else:
                    self.assertEqual(connect.connect('nextcloud-finish', config), {'wrong_account': True})
                    self.assertEqual(http.requests[-1].method, 'DELETE')

    def test_completed_authorization_is_replayed_from_a_private_journal(self):
        result = {'username': 'dedicated', 'app_password': 'fixture-secret', 'webdav_url': 'https://cloud.invalid/remote.php/dav/files/dedicated/'}
        config = {'origin': 'https://cloud.invalid', 'poll_path': '/login/v2/poll', 'poll_token': 'fixture-flow'}
        with tempfile.TemporaryDirectory() as temp:
            record = Path(temp) / 'authorized.json'
            argv = ['connect.py', 'nextcloud-finish', '--result-file', str(record)]
            with patch.object(connect, 'connect', return_value=result) as authorize:
                for _ in range(2):
                    with patch('sys.argv', argv), patch('sys.stdin', io.StringIO(json.dumps(config))), patch('sys.stdout', io.StringIO()):
                        self.assertEqual(connect.main(), 0)
                self.assertEqual(authorize.call_count, 1)
            self.assertEqual(record.stat().st_mode & 0o777, 0o600)
            config['poll_token'] = 'different-flow'
            with patch('sys.argv', argv), patch('sys.stdin', io.StringIO(json.dumps(config))), patch('sys.stdout', io.StringIO()):
                self.assertEqual(connect.main(), 1)

if __name__ == '__main__': unittest.main()
