#!/usr/bin/env python3
"""Atoll Recovery health notifications; reads no recovery identity or key escrow."""
import argparse
import importlib.util
import json
import math
import os
import stat
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('atoll_copy_runtime', Path(__file__).with_name('copy.py'))
copy_runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(copy_runtime)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post_webhook(url, payload, *, allow_loopback=False):
    """One bounded request; no redirects, raw errors, or disabled TLS checks."""
    parts = urllib.parse.urlsplit(url)
    local_test = allow_loopback and parts.scheme == 'http' and parts.hostname in ('127.0.0.1', '::1')
    if (parts.scheme != 'https' and not local_test) or not parts.hostname or parts.username or parts.password or parts.fragment:
        raise ValueError('expected an HTTPS webhook URL')
    request = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                    headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def load_delivery(path, generation):
    if path.exists():
        copy_runtime.private_file(path)
        saved = json.loads(path.read_text())
        if saved.get('version') != 1:
            raise ValueError('unknown delivery state')
        if saved.get('generation') == generation:
            return saved
    return {'version': 1, 'generation': generation, 'last_attempt': None,
            'last_delivered_at': None, 'last_delivered_status': None,
            'delivery_ok': False}


def run_check(config, check_copy, path, now=None, send=post_webhook):
    now = time.time() if now is None else now
    generation = config['generation']
    if not isinstance(generation, str) or not generation:
        raise ValueError('missing delivery generation')
    saved = load_delivery(path, generation)
    report = check_copy()
    status = report.get('status')
    if status not in ('healthy', 'warning', 'failed'):
        status = 'failed'
    age = report.get('source_age_seconds')
    if not isinstance(age, (int, float)) or not math.isfinite(age) or age < 0:
        age = None
    else:
        age = int(age)
    last = saved['last_delivered_at']
    interval = 86400 if status == 'healthy' else 3600
    due = (last is None or not saved['delivery_ok'] or
           status != saved['last_delivered_status'] or now - last >= interval)
    backoff = (not saved['delivery_ok'] and saved['last_attempt'] is not None and
               now - saved['last_attempt'] < 300)
    if due and not backoff:
        saved['last_attempt'] = now
        payload = {'event': 'atoll.recovery.health', 'status': status,
                   'source_age_seconds': age,
                   'text': 'Atoll Recovery: independent-copy health is ' + status + '.'}
        try:
            delivered = send(config['webhook_url'], payload) is True
        except Exception:
            delivered = False
        saved['delivery_ok'] = delivered
        if delivered:
            saved['last_delivered_at'] = now
            saved['last_delivered_status'] = status
    saved['checked_at'] = now
    saved['copy_status'] = status
    copy_runtime.save_state(path, saved)
    return saved


def delivery_health(path, generation, now=None):
    now = time.time() if now is None else now
    try:
        saved = load_delivery(path, generation)
        checked = now - saved.get('checked_at', 0)
        delivered = now - saved['last_delivered_at'] if saved['last_delivered_at'] is not None else None
        ok = (saved['delivery_ok'] and 0 <= checked < 180 and
              delivered is not None and 0 <= delivered < 25 * 3600)
        return {'status': 'healthy' if ok else 'failed',
                'last_delivered_at': saved['last_delivered_at'],
                'last_delivered_status': saved['last_delivered_status']}
    except Exception:
        return {'status': 'failed', 'last_delivered_at': None, 'last_delivered_status': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--copy-state', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        copy_runtime.private_file(args.config)
        config = json.loads(args.config.read_text())
        if args.health:
            report = delivery_health(args.state, config['generation'])
            print(json.dumps(report))
            return 0 if report['status'] == 'healthy' else 1
        # Validate before starting; test-only HTTP is never enabled by this CLI.
        url = urllib.parse.urlsplit(config['webhook_url'])
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError('expected an HTTPS webhook URL')
        args.state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent = args.state.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077:
            raise ValueError('delivery state directory must be private')
        import fcntl
        lock = args.state.with_suffix('.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            run_check(config, lambda: copy_runtime.health(args.copy_state), args.state)
            print(json.dumps(delivery_health(args.state, config['generation'])), flush=True)
            if args.once:
                return 0 if delivery_health(args.state, config['generation'])['status'] == 'healthy' else 1
            time.sleep(60)
    except Exception:
        print('{"status":"failed","reason":"alert configuration or runner failure"}', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
