"""Backup-only HTTPS source; no Cloudflare credential or recovery identity."""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 256 * 1024 * 1024
EXPORT = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.age$')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

class IneligibleExport(ValueError):
    """A verified archive has no issuer-bound source metadata for attestation."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def https_origin(value):
    u = urllib.parse.urlsplit(value)
    if (u.scheme != 'https' or not u.hostname or u.username or u.password or
            u.query or u.fragment or u.path not in ('', '/') or
            any(c in value for c in '\r\n\0')):
        raise ValueError('expected an HTTPS origin')
    return value.rstrip('/')


def opener():
    return urllib.request.build_opener(NoRedirect())


class IssuerTransfer:
    def __init__(self, config, destination, http=None):
        self.origin = https_origin(config['issuer_origin'])
        self.issuer_id = config['issuer_id']
        self.secret = config['issuer_secret']
        if (not UUID.fullmatch(self.issuer_id) or
                not re.fullmatch(r'[A-Za-z0-9_-]{43}', self.secret) or
                config['source'] != 'issuer:' + self.issuer_id):
            raise ValueError('invalid issuer configuration')
        if type(config.get('attest_copies', False)) is not bool:
            raise ValueError('invalid copy attestation setting')
        self.attest_copies = config.get('attest_copies', False)
        self.destination = destination
        self.http = http or opener()

    def request(self, path, data=None):
        req = urllib.request.Request(self.origin + path, data=data, headers={
            'Authorization': 'Bearer recovery-v1.' + self.secret,
            'User-Agent': 'Atoll Recovery', 'Content-Type': 'application/json'})
        return self.http.open(req, timeout=30)

    def list(self):
        entries, cursor, seen = [], None, set()
        for _ in range(16):
            path = '/recovery/exports'
            if cursor:
                path += '?' + urllib.parse.urlencode({'cursor': cursor})
            with self.request(path) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('oversized export listing')
            page = json.loads(raw)
            if page['issuer_id'] != self.issuer_id or not isinstance(page['objects'], list):
                raise ValueError('issuer identity changed')
            for item in page['objects']:
                if (not isinstance(item, dict) or not isinstance(item.get('Name'), str) or
                        not EXPORT.fullmatch(item['Name']) or
                        not isinstance(item.get('Size'), int) or
                        isinstance(item['Size'], bool) or not 0 < item['Size'] <= MAX_BYTES or
                        item.get('IsDir') is not False or item['Name'] in seen):
                    raise ValueError('invalid export metadata')
                seen.add(item['Name'])
                entries.append(item)
            cursor = page.get('cursor')
            if cursor is None:
                return entries
            if not isinstance(cursor, str) or not 0 < len(cursor) <= 1024:
                raise ValueError('invalid export cursor')
        raise ValueError('export listing exceeds page budget')

    def get(self, side, name, path):
        if side != 'source':
            return self.destination.get(side, name, path)
        if not EXPORT.fullmatch(name):
            raise ValueError('invalid export name')
        started, size = time.monotonic(), 0
        with self.request('/recovery/exports/' + urllib.parse.quote(name, safe='')) as response:
            with path.open('wb') as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES or time.monotonic() - started > 300:
                        raise ValueError('export exceeds download budget')
                    output.write(chunk)

    def put(self, path, name):
        return self.destination.put(path, name)

    def confirm_copy(self, receipt):
        """Called only after destination artifact AND manifest read-back succeed."""
        if not self.attest_copies:
            return None
        name = receipt['name']
        if not EXPORT.fullmatch(name):
            raise ValueError('invalid export name')
        try:
            with self.request('/recovery/metadata/' + urllib.parse.quote(name, safe='')) as response:
                raw = response.read(4097)
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
            raw = error.read(4097)
            error.close()
            if len(raw) <= 4096 and json.loads(raw) == {'reason': 'source-metadata-unavailable'}:
                raise IneligibleExport('source metadata unavailable') from None
            raise ValueError('source metadata request failed') from None
        if len(raw) > 4096:
            raise ValueError('oversized source metadata')
        metadata = json.loads(raw)
        if (not isinstance(metadata, dict) or
                set(metadata) != {'issuer_id', 'name', 'exported_at', 'sha256', 'bytes'} or
                metadata['issuer_id'] != self.issuer_id or metadata['name'] != name or
                type(metadata['exported_at']) is not int or
                not 0 < metadata['exported_at'] <= time.time() or
                type(metadata['bytes']) is not int or not 0 < metadata['bytes'] <= MAX_BYTES or
                metadata['bytes'] != receipt['size'] or
                not isinstance(metadata['sha256'], str) or
                not re.fullmatch(r'[0-9a-f]{64}', metadata['sha256']) or
                metadata['sha256'] != receipt['sha256']):
            raise ValueError('source evidence mismatch')
        body = {k: metadata[k] for k in ('name', 'exported_at', 'sha256', 'bytes')}
        with self.request('/recovery/copy-receipts', json.dumps(body).encode()) as response:
            raw = response.read(4097)
        if len(raw) > 4096:
            raise ValueError('copy receipt not accepted')
        result = json.loads(raw)
        if not isinstance(result, dict) or set(result) != {'accepted'} or result['accepted'] is not True:
            raise ValueError('copy receipt not accepted')
        return metadata['exported_at']
