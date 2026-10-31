#!/usr/bin/env python3
"""Instrument scratch simulator sources; generated CAP sources remain unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('artifact',type=Path);a=p.parse_args()
out=a.artifact.resolve()
manifest=json.loads((out/'manifest.json').read_text())
assert manifest['kind']=='compact-javacard-prototype'
for name,expected in manifest['generatedSources'].items():
 assert hashlib.sha256((out/'src/me/flashapp/cashu'/name).read_bytes()).hexdigest()==expected, 'generated source changed'
src=out/'sim-src';src.mkdir();classes=out/'sim-classes';classes.mkdir()
for file in (out/'src/me/flashapp/cashu').glob('*.java'):
 text=file.read_text()
 text=re.sub(r'/\* SIM-CUT ([a-z-]+) \*/',lambda m:'CompactCut.check("'+m.group(1)+'");',text)
 text=re.sub(r'// SIM-CUT ([a-z-]+)',lambda m:'CompactCut.check("'+m.group(1)+'");',text)
 if file.name=='CompactState.java':
  # Count actual page-link dereferences and byte writes in host copies only.
  assert text.count('u(p[(short)(NEXT+page)])')>0
  text=text.replace('u(p[(short)(NEXT+page)])','CompactCut.next(p[(short)(NEXT+page)])')
  assert 'u(p[(short)(NEXT+' not in text, 'unmetered page-link expression'
  assert text.count('a[at]=value;')==1
  text=text.replace('a[at]=value;','a[at]=value; CompactCut.write(a);')
  assert text.count('md.update(')>0
  text=text.replace('md.update(','CompactCut.digestUpdate(md,')
 (src/file.name).write_text(text)
shutil.copyfile(HERE/'java/CompactCut.java',src/'CompactCut.java')
subprocess.run(['javac','--release','11','-cp',str(ROOT/'tools/cardsim/target/cardsim.jar'),'-d',str(classes),
 *[str(f) for f in src.glob('*.java')],str(HERE/'java/CompactHarness.java'),str(HERE/'java/CompactAccessChecks.java')],check=True)
print('Simulator instrumentation compiled separately; CAP sources unchanged.')
