const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");
test("release manifests reject changed files and archives cannot escape their directory", () => {
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util, io, os, tarfile, tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('manifest', ${JSON.stringify(resolve(__dirname, "manifest.py"))})
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=Path(d)/'release'; root.mkdir()
 for target in ('staging','production'):
  (root/target).mkdir()
  (root/target/'worker.js').write_text('export default {}')
  (root/target/'wrangler.toml').write_text('name="fixture"')
 os.environ.update(RELEASE_COMPONENT='ops', RELEASE_TAG='ops-v0.1.0', RELEASE_COMMIT='a'*40)
 m.write(root); m.verify(root,'ops-v0.1.0','a'*40)
 bundle=Path(d)/'bundle';bundle.mkdir()
 (bundle/'wrangler.toml').write_text('main="src/staging-entry.workers.ts"')
 (bundle/'staging-entry.workers.js').write_text('export default {}')
 m.normalize(bundle)
 assert (bundle/'worker.js').read_text()=='export default {}'
 (bundle/'staging-entry.workers.js').write_text('------formdata; not JavaScript')
 try:m.normalize(bundle)
 except AssertionError:pass
 else:raise AssertionError('multipart upload body accepted as a Worker')
 (root/'production'/'worker.js').write_text('changed')
 try: m.verify(root,'ops-v0.1.0','a'*40)
 except AssertionError: pass
 else: raise AssertionError('changed worker accepted')
 for name, kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
  archive=Path(d)/'bad.tar.gz'
  with tarfile.open(archive,'w:gz') as t:
   info=tarfile.TarInfo(name); info.type=kind
   if kind==tarfile.SYMTYPE: info.linkname='../escape'
   t.addfile(info, io.BytesIO(b''))
  try: m.extract(archive, Path(d)/'out')
  except ValueError: pass
  else: raise AssertionError('unsafe archive accepted')
`,
    ],
    { stdio: "pipe" },
  );
  assert.ok(true);
});
