"""Public release provenance; verifies every file before deployment. No secrets."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import tomllib


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(root):
    files = {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name not in ('release.json', 'SHA256SUMS')}
    data = dict(schema=1, component=os.environ['RELEASE_COMPONENT'], tag=os.environ['RELEASE_TAG'], commit=os.environ['RELEASE_COMMIT'], files=files)
    (root / 'release.json').write_text(json.dumps(data, indent=2) + '\n')
    (root / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.relative_to(root)}\n' for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))


def verify(root, tag, commit):
    data = json.loads((root / 'release.json').read_text())
    assert data['schema'] == 1 and data['tag'] == tag and data['commit'] == commit
    assert data['component'] == 'ops'
    assert set(data['files']) == {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} - {'release.json', 'SHA256SUMS'}
    for name, expected in data['files'].items():
        path = root / name
        assert not path.is_symlink() and path.resolve().is_relative_to(root.resolve())
        assert digest(path) == expected
    for target in ('staging', 'production'):
        assert (root / target / 'worker.js').is_file()
        assert (root / target / 'wrangler.toml').is_file()


def normalize(root):
    config = tomllib.loads((root / 'wrangler.toml').read_text())
    original = root / Path(config['main']).with_suffix('.js').name
    assert original.is_file() and not original.read_bytes().startswith(b'------')
    if original.name != 'worker.js':
        original.rename(root / 'worker.js')


def extract(archive, root):
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as source:
        for item in source.getmembers():
            name = Path(item.name)
            if name.is_absolute() or '..' in name.parts or not (item.isdir() or item.isreg()):
                raise ValueError('Unsafe release archive')
            if not (root / name).resolve().is_relative_to(root.resolve()):
                raise ValueError('Unsafe release path')
        source.extractall(root, filter='data')


if __name__ == '__main__':
    root = Path(sys.argv[2])
    if sys.argv[1] == 'write':
        write(root)
    elif sys.argv[1] == 'normalize':
        normalize(root)
    elif sys.argv[1] == 'extract':
        extract(root, Path(sys.argv[3]))
    elif sys.argv[1] == 'verify':
        verify(root, os.environ['RELEASE_TAG'], os.environ['RELEASE_COMMIT'])
    else:
        raise SystemExit('Unknown release operation')
