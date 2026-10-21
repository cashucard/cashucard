#!/usr/bin/env python3
"""Private stdin/stdout helper for StartOS issuer pairing and Nextcloud login."""
import argparse
import base64
import os
import stat
import tempfile
from pathlib import Path
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from issuer_source import https_origin, opener, UUID


def request(origin, path, data, *, empty=False):
    # Redirects are forbidden even for login-flow discovery and polling.
    encoded = b'' if empty else json.dumps(data).encode()
    req = urllib.request.Request(origin + path, data=encoded,
                                 headers={'Content-Type': 'application/json',
                                          'User-Agent': 'Atoll Recovery'})
    try:
        with opener().open(req, timeout=30) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('response too large')
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        code = e.code
        e.close()
        if code == 404:
            return {'pending': True}
        raise ValueError('connection rejected') from None


def connect(operation, config):
    origin = https_origin(config['origin'])
    if operation == 'pair-issuer':
        if not all(isinstance(config.get(k), str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', config[k]) for k in ('code', 'secret')):
            raise ValueError('invalid pairing')
        result = request(origin, '/recovery/claim', {'code': config['code'], 'secret': config['secret']})
        if not all(isinstance(result.get(k), str) and UUID.fullmatch(result[k]) for k in ('issuer_id', 'connection_id')):
            raise ValueError('invalid issuer confirmation')
        return result
    if operation == 'nextcloud-start':
        result = request(origin, '/index.php/login/v2', {}, empty=True)
        poll = urllib.parse.urlsplit(result['poll']['endpoint'])
        login = urllib.parse.urlsplit(result['login'])
        if (https_origin(urllib.parse.urlunsplit((poll.scheme, poll.netloc, '', '', ''))) != origin or
                poll.path not in ('/login/v2/poll', '/index.php/login/v2/poll') or poll.query or poll.fragment or
                login.scheme != 'https' or login.netloc != poll.netloc or
                not login.path.startswith(('/login/v2/flow/', '/index.php/login/v2/flow/')) or login.fragment or
                not isinstance(result['poll']['token'], str) or not 1 <= len(result['poll']['token']) <= 2048):
            raise ValueError('invalid authorization route')
        return {'origin': origin, 'login': result['login'], 'poll_path': poll.path, 'poll_token': result['poll']['token']}
    if operation == 'nextcloud-finish':
        path, token = config['poll_path'], config['poll_token']
        if path not in ('/login/v2/poll', '/index.php/login/v2/poll') or not isinstance(token, str) or not 1 <= len(token) <= 2048:
            raise ValueError('invalid pending authorization')
        # Login Flow v2's polling endpoint requires form encoding.
        req = urllib.request.Request(origin + path, data=urllib.parse.urlencode({'token': token}).encode(), headers={'User-Agent': 'Atoll Recovery'})
        try:
            with opener().open(req, timeout=30) as response:
                raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError('response too large')
            result = json.loads(raw)
        except urllib.error.HTTPError as e:
            code = e.code
            e.close()
            if code == 404:
                return {'pending': True}
            raise ValueError('authorization rejected') from None
        if (https_origin(result['server']) != origin or
                not isinstance(result['loginName'], str) or not result['loginName'] or
                any(c in result['loginName'] for c in '\r\n\0/') or
                not isinstance(result['appPassword'], str) or not 1 <= len(result['appPassword']) <= 1024 or
                any(c in result['appPassword'] for c in '\r\n\0')):
            raise ValueError('invalid authorization result')
        auth = base64.b64encode((result['loginName'] + ':' + result['appPassword']).encode()).decode()
        headers = {'Authorization': 'Basic ' + auth, 'OCS-APIRequest': 'true'}
        check = urllib.request.Request(origin + '/ocs/v2.php/cloud/user?format=json', headers=headers)
        with opener().open(check, timeout=30) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('response too large')
        user = json.loads(raw)['ocs']['data']
        if (user.get('id') != result['loginName'] or not isinstance(user.get('groups'), list) or
                'admin' in user['groups'] or user.get('subadmin')):
            # Do not leave an accidentally authorized administrator token active.
            revoke = urllib.request.Request(origin + '/ocs/v2.php/core/apppassword', headers=headers, method='DELETE')
            with opener().open(revoke, timeout=30):
                pass
            raise ValueError('authorize a dedicated non-admin account')
        return {'username': result['loginName'], 'app_password': result['appPassword'],
                'webdav_url': origin + '/remote.php/dav/files/' + urllib.parse.quote(result['loginName'], safe='') + '/'}
    raise ValueError('unknown operation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['pair-issuer', 'nextcloud-start', 'nextcloud-finish'])
    parser.add_argument('--result-file', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        raw = sys.stdin.read(8193)
        if len(raw) > 8192:
            raise ValueError('input too large')
        config = json.loads(raw)
        if args.result_file and args.operation != 'nextcloud-finish':
            raise ValueError('result file is only for completed authorization')
        if args.result_file and args.result_file.exists():
            info = args.result_file.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError('authorization record must be private')
            saved = json.loads(args.result_file.read_text())
            if saved['origin'] != config['origin'] or saved['poll_token'] != config['poll_token']:
                raise ValueError('authorization record belongs to another flow')
            result = saved['result']
        else:
            result = connect(args.operation, config)
            if args.result_file and not result.get('pending'):
                parent = args.result_file.parent
                if not parent.is_dir() or parent.stat().st_mode & 0o077:
                    raise ValueError('authorization directory must be private')
                fd, temp = tempfile.mkstemp(dir=parent)
                try:
                    with os.fdopen(fd, 'w') as out:
                        json.dump({'origin': config['origin'], 'poll_token': config['poll_token'], 'result': result}, out)
                        out.flush()
                        os.fsync(out.fileno())
                    os.replace(temp, args.result_file)
                finally:
                    Path(temp).unlink(missing_ok=True)
        # Successful output is a private machine channel, never ordinary logs.
        print(json.dumps(result))
        return 0
    except Exception:
        print('{"error":"Connection failed; check approval, origin and network access."}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
