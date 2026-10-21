import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location('atoll_alerts', Path(__file__).with_name('alerts.py'))
alerts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alerts)
CONFIG = {'generation': 'fixture-generation', 'webhook_url': 'https://fixture.invalid/private-route'}


class DeliveryChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'delivery.json'
        self.status = 'failed'
        self.sent = []

    def tearDown(self):
        self.temp.cleanup()

    def check(self, now, send=None, config=CONFIG):
        def delivered(url, payload):
            self.sent.append(payload)
            return True
        return alerts.run_check(config, lambda: {'status': self.status, 'source_age_seconds': 12},
                                self.path, now, send or delivered)

    def test_transitions_are_deduplicated_with_reminders_and_recovery(self):
        self.check(1000)
        self.check(1060)
        self.assertEqual(len(self.sent), 1)
        self.check(4600)
        self.assertEqual(len(self.sent), 2)
        self.status = 'warning'
        self.check(4660)
        self.status = 'healthy'
        self.check(4720)
        self.check(4780)
        self.assertEqual([x['status'] for x in self.sent], ['failed', 'failed', 'warning', 'healthy'])
        self.assertEqual(alerts.delivery_health(self.path, CONFIG['generation'], 4800)['status'], 'healthy')
        self.assertEqual(alerts.delivery_health(self.path, CONFIG['generation'], 5000)['status'], 'failed')
        self.check(4720 + 86400)
        self.assertEqual(len(self.sent), 5)
        self.assertNotIn('private-route', self.path.read_text())

    def test_failed_delivery_is_not_acknowledged_and_retry_is_bounded(self):
        self.check(1000)
        first = json.loads(self.path.read_text())['last_delivered_at']
        self.status = 'warning'
        calls = []
        def failed(url, payload):
            calls.append(1)
            raise RuntimeError('private-route must not escape')
        self.check(1060, failed)
        self.check(1120, failed)
        saved = json.loads(self.path.read_text())
        self.assertEqual(len(calls), 1)
        self.assertEqual(saved['last_delivered_at'], first)
        self.assertFalse(saved['delivery_ok'])
        self.assertNotIn('private-route', self.path.read_text())
        self.assertEqual(alerts.delivery_health(self.path, CONFIG['generation'], 1121)['status'], 'failed')
        self.check(1360)
        self.assertEqual(json.loads(self.path.read_text())['last_delivered_at'], 1360)

    def test_reconfigured_route_does_not_reuse_old_delivery_evidence(self):
        self.check(1000)
        changed = {**CONFIG, 'generation': 'another-route'}
        self.assertEqual(alerts.delivery_health(self.path, changed['generation'], 1001)['status'], 'failed')
        self.check(1001, config=changed)
        self.assertEqual(len(self.sent), 2)

    def test_actual_webhook_acceptance_failure_and_redirect_rejection(self):
        received = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(int(self.path[1:]))
                self.send_header('Location', '/204')
                self.end_headers()
            def log_message(self, *_):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            with self.assertRaises(ValueError):
                alerts.post_webhook(base + '/204', {})
            self.assertTrue(alerts.post_webhook(base + '/204', {'status': 'healthy'}, allow_loopback=True))
            self.assertFalse(alerts.post_webhook(base + '/500', {}, allow_loopback=True))
            self.assertFalse(alerts.post_webhook(base + '/302', {}, allow_loopback=True))
            self.assertEqual(len(received), 3)
        finally:
            server.shutdown(); thread.join(); server.server_close()


if __name__ == '__main__':
    unittest.main()
