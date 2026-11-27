const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

test("Setup uses the short name on both launchers and keeps its full Android app name", () => {
  execFileSync("python3", ["-c", `
import plistlib
import xml.etree.ElementTree as ET
from pathlib import Path

with Path("ios/CashuProvisioner/Info.plist").open("rb") as info:
    assert plistlib.load(info)["CFBundleDisplayName"] == "Cashu Setup"

base = Path("android/app/src/main")
app = ET.parse(base / "AndroidManifest.xml").find("application")
ns = {"android": "http://schemas.android.com/apk/res/android"}
launcher = app.find(
    "./activity/intent-filter/category[@android:name='android.intent.category.LAUNCHER']/../..", ns
)
strings = {s.get("name"): s.text for s in ET.parse(base / "res/values/strings.xml").findall("string")}
label = "{%s}label" % ns["android"]
assert strings[app.attrib[label].removeprefix("@string/")] == "Cashu Card Setup"
assert strings[launcher.attrib[label].removeprefix("@string/")] == "Cashu Setup"
`], { cwd: resolve(__dirname, "../../apps/provisioner") });
});

test("native preflight requires every candidate artifact and hash before store upload", () => {
  execFileSync(
    "python3",
    [
      "-c",
      `
import hashlib, importlib.util, json, os, tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('manifest', ${JSON.stringify(resolve(__dirname, "manifest.py"))})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=Path(d)
 for name in ('app-release.aab','CashuProvisioner.ipa','cashu-javacard-2.1.0.cap'):
  (root/name).write_bytes(b'original')
 os.environ.update(RELEASE_COMPONENT='provisioner',RELEASE_TAG='provisioner-v1.0.0-build.8',RELEASE_COMMIT='a'*40)
 m.write(root)
 m.verify(root,os.environ['RELEASE_TAG'],'a'*40,'provisioner')
 def rejects():
  try:m.verify(root,os.environ['RELEASE_TAG'],'a'*40,'provisioner')
  except (AssertionError,ValueError):pass
  else:raise AssertionError('incomplete/changed candidate accepted')
 # A real release manifest with an IPA modified after candidate verification.
 (root/'CashuProvisioner.ipa').write_bytes(b'changed');rejects()
 (root/'CashuProvisioner.ipa').write_bytes(b'original')
 # A checksum list that omits both mobile payloads must not be sufficient.
 (root/'SHA256SUMS').write_text(hashlib.sha256((root/'release.json').read_bytes()).hexdigest()+'  release.json\\n');rejects()
 m.write(root)
 # Matching hashes over an incomplete candidate still cannot approve it.
 (root/'CashuProvisioner.ipa').unlink();m.write(root);rejects()
 (root/'CashuProvisioner.ipa').write_bytes(b'original');m.write(root)
 data=json.loads((root/'release.json').read_text());data['files']={}
 (root/'release.json').write_text(json.dumps(data))
 (root/'SHA256SUMS').write_text(hashlib.sha256((root/'release.json').read_bytes()).hexdigest()+'  release.json\\n');rejects()
`,
    ],
    { stdio: "pipe" },
  );
});
