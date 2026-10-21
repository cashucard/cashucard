import importlib.util
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_copy', Path(__file__).with_name('copy.py'))
copy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copy)
NAME = '2026-10-21T03:17:00.000Z-00000000-0000-4000-8000-000000000001.age'
DEST_NAME = NAME.replace(':', '-')
DATA = b'encrypted fixture, not a real escrow export'
NOW = copy.source_time(NAME) + 3600


class MemoryTransfer:
    def __init__(self):
        self.source = {NAME: DATA}
        self.dest = {'older.age': b'keep me'}
        self.corrupt = False
        self.interrupt = False

    def list(self):
        return [{'Name': n, 'Size': len(b), 'IsDir': False} for n, b in self.source.items()]

    def get(self, side, name, path):
        body = (self.source if side == 'source' else self.dest)[name]
        path.write_bytes(body + (b'corruption' if side == 'dest' and self.corrupt and name.endswith('.age') else b''))

    def put(self, path, name):
        if self.interrupt:
            raise RuntimeError('secret transport error must not escape')
        body = path.read_bytes()
        if name in self.dest and self.dest[name] != body:
            raise RuntimeError('immutable destination differs')
        self.dest[name] = body


class CopyChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name) / 'state.json'
        self.transfer = MemoryTransfer()

    def tearDown(self):
        self.temp.cleanup()

    def run_copy(self, now=NOW):
        return copy.run_once(self.transfer, self.state, now)

    def test_verified_copy_is_additive_idempotent_and_uses_source_age(self):
        self.assertTrue(self.run_copy())
        first = json.loads(self.state.read_text())
        self.assertEqual(first['latest']['source_time'], copy.source_time(NAME))
        self.assertEqual(self.transfer.dest['older.age'], b'keep me')
        self.assertEqual(self.transfer.dest[DEST_NAME], DATA)
        manifest = self.transfer.dest[DEST_NAME + '.json']
        self.assertTrue(self.run_copy(NOW + 60))
        self.assertEqual(manifest, self.transfer.dest[DEST_NAME + '.json'])
        self.assertTrue(self.run_copy(NOW + 18 * 3600))
        self.assertEqual(copy.health(self.state, NOW + 18 * 3600)['status'], 'warning')
        self.assertTrue(self.run_copy(NOW + 24 * 3600))
        self.assertEqual(copy.health(self.state, NOW + 24 * 3600)['status'], 'failed')
        self.assertEqual(copy.health(self.state, NOW + 24 * 3600 + 1800)['status'], 'failed')

    def test_interruption_and_wrong_readback_never_advance_success(self):
        for mode in ('interrupt', 'corrupt'):
            with self.subTest(mode=mode):
                setattr(self.transfer, mode, True)
                self.assertFalse(self.run_copy())
                saved = json.loads(self.state.read_text())
                self.assertIsNone(saved['latest'])
                self.assertNotIn('secret', self.state.read_text())
                self.assertEqual(copy.health(self.state, NOW)['status'], 'failed')
                setattr(self.transfer, mode, False)

    def test_failed_cycle_preserves_last_success_but_is_unhealthy(self):
        self.assertTrue(self.run_copy())
        last = json.loads(self.state.read_text())['latest']
        self.transfer.corrupt = True
        self.assertFalse(self.run_copy(NOW + 60))
        self.assertEqual(json.loads(self.state.read_text())['latest'], last)
        self.assertEqual(copy.health(self.state, NOW + 60)['status'], 'failed')
        self.transfer.corrupt = False
        self.transfer.source.clear()
        self.assertFalse(self.run_copy(NOW + 120))
        self.assertEqual(self.transfer.dest[DEST_NAME], DATA)

    def test_rejects_paths_and_future_sources(self):
        for name in ('../' + NAME, 'subdir/' + NAME, 'not-an-export.age'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                copy.source_time(name)
        self.assertFalse(self.run_copy(copy.source_time(NAME) - 600))
        self.assertEqual(self.transfer.dest, {'older.age': b'keep me'})


@unittest.skipUnless(shutil.which('rclone'), 'local rclone required for WebDAV compatibility')
class WebDavRoundTrip(unittest.TestCase):
    def test_actual_upload_readback_and_retry_preserve_older_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, destination = root / 'source', root / 'destination'
            source.mkdir()
            destination.mkdir()
            (source / NAME).write_bytes(DATA)
            (destination / 'older.age').write_bytes(b'keep me')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            address = f'http://127.0.0.1:{port}/'
            server = subprocess.Popen(['rclone', 'serve', 'webdav', str(destination),
                                       '--addr', f'127.0.0.1:{port}'],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(address, timeout=0.2):
                            break
                    except OSError:
                        if server.poll() is not None:
                            self.fail('local WebDAV server exited')
                        time.sleep(0.05)
                else:
                    self.fail('local WebDAV server did not start')
                config = root / 'rclone.conf'
                config.write_text('[fixture]\ntype = local\n\n[dav]\ntype = webdav\n'
                                  f'url = {address}\nvendor = other\n')
                config.chmod(0o600)
                transfer = copy.Rclone({'rclone_config': str(config),
                                        'source': 'fixture:' + str(source),
                                        'destination': 'dav:backups'})
                state = root / 'state.json'
                self.assertTrue(copy.run_once(transfer, state, NOW))
                # A fresh manifest mtime must not break immutable idempotence.
                time.sleep(1.1)
                self.assertTrue(copy.run_once(transfer, state, NOW + 2))
                self.assertEqual((destination / 'backups' / DEST_NAME).read_bytes(), DATA)
                self.assertEqual((destination / 'older.age').read_bytes(), b'keep me')
                # Preserve size and mtime: read-back must still fetch real bytes.
                stored = destination / 'backups' / DEST_NAME
                before = stored.stat()
                stored.write_bytes(b'x' * len(DATA))
                os.utime(stored, (before.st_atime, before.st_mtime))
                self.assertFalse(copy.run_once(transfer, state, NOW + 3))
                self.assertEqual(json.loads(state.read_text())['latest']['verified_at'], NOW + 2)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == '__main__':
    unittest.main()
