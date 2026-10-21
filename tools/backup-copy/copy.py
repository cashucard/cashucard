#!/usr/bin/env python3
"""Additive encrypted-export copies through rclone; no decryption keys needed."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

EXPORT = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.age$')
MAX_BYTES = 256 * 1024 * 1024


def source_time(name):
    match = EXPORT.fullmatch(name)
    if not match:
        raise ValueError('invalid export name')
    return datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc).timestamp()


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('configuration must be a private regular file')


def digest(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
        return result.hexdigest()


def load_state(path):
    if not path.exists():
        return {'version': 1, 'latest': None, 'verified': {}, 'last_cycle_ok': False}
    private_file(path)
    state = json.loads(path.read_text())
    if state['version'] != 1 or not isinstance(state['verified'], dict):
        raise ValueError('invalid state')
    return state


def save_state(path, state):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('state directory must be private')
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class Rclone:
    def __init__(self, config):
        self.config = Path(config['rclone_config']).resolve()
        private_file(self.config)
        self.source = config['source'].rstrip('/')
        self.dest = config['destination'].rstrip('/')
        for remote in (self.source, self.dest):
            if not re.fullmatch(r'[A-Za-z0-9_-]+:[^\r\n]+', remote):
                raise ValueError('expected configured remote and scoped directory')
            if any(p in ('.', '..') for p in remote.split(':', 1)[1].split('/')):
                raise ValueError('invalid remote path')
        if self.source == self.dest:
            raise ValueError('source and destination must differ')

    def command(self, *args):
        # Credentials live only in the private rclone file, never argv/env/logs.
        # Capture child output: provider errors can echo credential-bearing URLs.
        return subprocess.run(['rclone', '--config', str(self.config),
                               '--retries', '1', '--low-level-retries', '1',
                               '--contimeout', '20s', '--timeout', '120s',
                               *args], check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=300).stdout

    def list(self):
        return json.loads(self.command('lsjson', self.source, '--files-only'))

    def get(self, side, name, path):
        root = self.source if side == 'source' else self.dest
        self.command('copyto', root + '/' + name, str(path), '--ignore-times')

    def put(self, path, name):
        self.command('copyto', str(path), self.dest + '/' + name, '--immutable', '--size-only')


def run_once(transfer, state_path, now=None):
    now = time.time() if now is None else now
    state = load_state(state_path)
    state['last_cycle_ok'] = False
    try:
        entries = []
        for item in transfer.list():
            name = item['Name']
            # Ignore unrelated objects; never traverse directories or guess names.
            if item.get('IsDir') or not EXPORT.fullmatch(name):
                continue
            created = source_time(name)
            if created > now + 300 or not 0 < item['Size'] <= MAX_BYTES:
                raise ValueError('invalid source metadata')
            entries.append((created, name, item['Size']))
        entries.sort(reverse=True)
        if not entries:
            raise ValueError('no exports available')
        if state['latest'] and state['latest']['name'] not in {e[1] for e in entries}:
            raise ValueError('latest verified source disappeared')
        # Always re-read the newest export, even when recorded previously. This
        # detects destination loss/corruption without freshening its source age.
        pending = [e for i, e in enumerate(entries)
                   if i == 0 or e[1] not in state['verified']][:8]
        with tempfile.TemporaryDirectory(prefix='cashu-copy-') as scratch:
            root = Path(scratch)
            for created, name, size in pending:
                source, readback = root / 'source.age', root / 'readback.age'
                transfer.get('source', name, source)
                if source.stat().st_size != size:
                    raise ValueError('source size mismatch')
                sha = digest(source)
                destination_name = name.replace(':', '-')
                receipt = {'name': name, 'source_time': created,
                           'size': size, 'sha256': sha, 'destination_name': destination_name}
                previous = state['verified'].get(name)
                if previous and previous != receipt:
                    raise ValueError('previously verified source changed')
                transfer.put(source, destination_name)
                transfer.get('dest', destination_name, readback)
                if readback.stat().st_size != size or digest(readback) != sha:
                    raise ValueError('read-back verification failed')
                manifest = root / 'manifest.json'
                manifest.write_text(json.dumps(receipt, sort_keys=True) + '\n')
                transfer.put(manifest, destination_name + '.json')
                transfer.get('dest', destination_name + '.json', readback)
                if readback.read_bytes() != manifest.read_bytes():
                    raise ValueError('manifest read-back failed')
                state['verified'][name] = receipt
                if not state['latest'] or created >= state['latest']['source_time']:
                    state['latest'] = {**receipt, 'verified_at': now}
        state['last_cycle_ok'] = True
    except Exception:
        # Preserve last verified evidence; never serialize raw provider errors.
        state['last_cycle_ok'] = False
    state['checked_at'] = now
    save_state(state_path, state)
    return state['last_cycle_ok']


def health(state_path, now=None):
    now = time.time() if now is None else now
    try:
        state = load_state(state_path)
        age = now - state['latest']['source_time'] if state['latest'] else None
        checked_age = now - state.get('checked_at', 0)
        failed = (not state['last_cycle_ok'] or age is None or age < -300 or
                  age >= 24 * 3600 or checked_age < -300 or checked_age >= 30 * 60)
        status = 'failed' if failed else 'warning' if age >= 18 * 3600 else 'healthy'
        return {'status': status, 'source_age_seconds': age}
    except Exception:
        return {'status': 'failed', 'source_age_seconds': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if args.health:
        report = health(args.state)
        print(json.dumps(report))
        return 0 if report['status'] == 'healthy' else 1
    try:
        private_file(args.config)
        transfer = Rclone(json.loads(args.config.read_text()))
        args.state.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent = args.state.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077:
            raise ValueError('state directory must be private')
        # One writer per state path; health readers see atomic state replacements.
        lock = args.state.with_suffix('.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            ok = run_once(transfer, args.state)
            print(json.dumps(health(args.state)), flush=True)
            if args.once:
                return 0 if ok else 1
            time.sleep(15 * 60)
    except Exception:
        print('{"status":"failed","reason":"configuration or runner failure"}', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
