#!/usr/bin/env python3
"""Convert a private compact fixture prototype. Contains no reader/device operations."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('resource',HERE/'build-probe.py')
resource=importlib.util.module_from_spec(s);s.loader.exec_module(resource)
ROOT=resource.ROOT
PACKAGE='F0:43:41:53:48:55:43:4D:50:54'

def source_compact(source):
    if source.count('        schnorrHW.init();')!=1:raise ValueError('constructor anchor changed')
    dispatch=(HERE/'java/CompactDispatch.txt').read_text()
    constants=[]
    for at,data in [(16336,hashlib.sha256(b'CashuCard/assisted-settlement/v1').digest()),(16368,b'CCP-AS\x01')]:
        constants.extend('            cardReceipts[(short) %d] = (byte) 0x%02X;'%(at+i,b) for i,b in enumerate(data))
    dispatch=dispatch.replace('__CONSTANTS__','\n'.join(constants))
    generated,count=re.subn(r'    public void process\(APDU apdu\) \{.*?\n    }',lambda _:dispatch.rstrip(),source,flags=re.S)
    if count!=1:raise ValueError('dispatch anchor changed')
    return generated

def prepare(output):
    hashes=resource.prepare(output,0)
    app=output/'src/me/flashapp/cashu/CashuApplet.java'
    app.write_text(source_compact((ROOT/'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text()))
    shutil.copyfile(HERE/'java/CompactState.java',app.with_name('CompactState.java'))
    tree=ET.parse(output/'build.xml');cap=tree.find("target[@name='cap']/javacard/cap")
    cap.set('aid',PACKAGE)
    for item in cap.findall('applet'):item.set('aid',PACKAGE+':'+item.get('aid').split(':')[-1])
    tree.write(output/'build.xml',encoding='unicode')
    return hashes

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--sdk',type=Path,default=Path.home()/'.javacard/sdks/jc305u4_kit')
    args=parser.parse_args();out=args.output.resolve();sdk=args.sdk.resolve()
    if not (sdk/'lib/api_classic.jar').is_file():parser.error('3.0.5 SDK required')
    hashes=prepare(out)
    cap=out/'resource-probe.cap'
    subprocess.run(['ant','-f',str(out/'build.xml'),'cap','-Djc.sdk='+str(sdk)],check=True)
    inspect=out/'inspect-classes';inspect.mkdir()
    subprocess.run(['javac','-proc:none','--release','11','-cp',str(sdk/'lib/tools.jar'),'-d',str(inspect),str(HERE/'CashuProbeShape.java')],check=True)
    shape=json.loads(subprocess.check_output(['java','-cp',os.pathsep.join([str(inspect),str(sdk/'lib/tools.jar')]),'com.sun.javacard.offcardverifier.CashuProbeShape',str(cap)],text=True))
    if shape!={'declaredInstanceSize':50,'firstReferenceToken':0,'referenceCount':50}:raise ValueError('original instance shape changed')
    spec=importlib.util.spec_from_file_location('assets',ROOT/'tools/cardkit/make-assets.py')
    assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
    load=assets.load_file(str(cap));(out/'load-file.bin').write_bytes(load)
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest=dict(kind='compact-javacard-prototype',probeFormat=4,sourceCommit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),
        packageAid=PACKAGE.replace(':',''),constructorSources=hashes,classShape=shape,poolBytes=16384,deferredDleqBytes=12288,
        generatedSources={f.name:sha(f) for f in (out/'src/me/flashapp/cashu').glob('*.java')},
        sdkApiSha256=sha(sdk/'lib/api_classic.jar'),sdkToolsSha256=sha(sdk/'lib/tools.jar'),
        shapeInspectorSha256=sha(HERE/'CashuProbeShape.java'),
        helperSha256=sha(HERE/'java/CompactState.java'),dispatchSha256=sha(HERE/'java/CompactDispatch.txt'),builderSha256=sha(Path(__file__)),
        capSha256=sha(cap),loadFileSize=len(load),loadFileSha256=hashlib.sha256(load).hexdigest())
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Private compact prototype converted; no device was accessed.')

if __name__=='__main__':main()
