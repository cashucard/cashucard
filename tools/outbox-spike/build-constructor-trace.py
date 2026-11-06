#!/usr/bin/env python3
"""Build a private catchable-constructor diagnostic; no device operations."""
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
s=importlib.util.spec_from_file_location('trace_resource',HERE/'build-probe.py')
resource=importlib.util.module_from_spec(s);s.loader.exec_module(resource)
ROOT=resource.ROOT
PACKAGE='F0:43:41:53:48:55:43:54:52:43'


def uncomment(text):
    return re.sub(r'/\*.*?\*/|//[^\n]*',lambda m:' '*len(m.group()),text,flags=re.S)


def body(text,declaration):
    if text.count(declaration)!=1:raise ValueError('method declaration changed')
    code=uncomment(text);start=code.index('{',code.index(declaration));depth=1;at=start+1
    while at<len(code) and depth:
        if code[at]=='{':depth+=1
        elif code[at]=='}':depth-=1
        at+=1
    if depth:raise ValueError('method body changed')
    return start,at-1,text[start+1:at-1]


def statements(text):
    code=uncomment(text)
    if any(c in code for c in '{}\"\''):raise ValueError('constructor nesting or literal changed')
    items=[];start=0;depth=0
    for i,c in enumerate(code):
        if c in '([':depth+=1
        elif c in ')]':depth-=1
        if depth<0:raise ValueError('constructor framing')
        if c==';' and depth==0:
            items.append(code[start:i+1].strip());start=i+1
    if depth or code[start:].strip() or not items:raise ValueError('constructor framing')
    return items


def instrument(app,signer):
    if app.count('        schnorrHW.init();')!=1:raise ValueError('constructor anchor changed')
    stages=[];generated={}
    for file,text,declaration in [('CashuApplet.java',app,'    private CashuApplet()'),('SchnorrHW.java',signer,'    SchnorrHW(')]:
        start,end,code=body(text,declaration);lines=[]
        for statement in statements(code):
            number=len(stages)+1
            if number>=128:raise ValueError('stage bound')
            stages.append(dict(id=number,file=file,statement=statement,statementSha256=hashlib.sha256(statement.encode()).hexdigest()))
            lines.extend(['            ConstructorTrace.before((byte)%d);'%number,'            '+statement,'            ConstructorTrace.after((byte)%d);'%number])
        if file=='CashuApplet.java':
            lines=['        try {',*lines,'            ConstructorTrace.complete();','        } catch (CardRuntimeException error) {','            ConstructorTrace.record(error);','        } catch (RuntimeException error) {','            ConstructorTrace.runtimeFailure();','        }']
        generated[file]=text[:start+1]+'\n'+'\n'.join(lines)+'\n    '+text[end:]
    text=generated['CashuApplet.java']
    for declaration,replacement in [
        ('    public boolean select()','\n        return true;\n    '),
        ('    public Shareable getShareableInterfaceObject(','\n        return null;\n    ')]:
        start,end,_=body(text,declaration);text=text[:start+1]+replacement+text[end:]
    start,end,_=body(text,'    public void process(APDU apdu)')
    dispatch=(HERE/'java/ConstructorDispatch.txt').read_text().rstrip()
    method_start=text.index('    public void process(APDU apdu)')
    generated['CashuApplet.java']=text[:method_start]+dispatch+text[end+1:]
    return generated,stages


def prepare(output):
    hashes=resource.prepare(output,0)
    sources=resource.CONTROL;dest=output/'src/me/flashapp/cashu'
    generated,stages=instrument((sources/'CashuApplet.java').read_text(),(sources/'SchnorrHW.java').read_text())
    for name,text in generated.items():(dest/name).write_text(text)
    helper=(HERE/'java/ConstructorTrace.java').read_text();(dest/'ConstructorTrace.java').write_text(helper)
    dispatch=(HERE/'java/ConstructorDispatch.txt').read_text().rstrip()
    (dest/'Opener.java').write_text('''package me.flashapp.cashu;
import javacard.framework.*;
public final class Opener extends Applet {
    public static void install(byte[] bArray, short bOffset, byte bLength) { new Opener().register(); }
    private Opener() { ConstructorTrace.reset(); }
'''+dispatch+'\n}\n')
    tree=ET.parse(output/'build.xml');tree.find("property[@name='cap.file']").set('value',str(output/'constructor-trace.cap'))
    cap=tree.find("target[@name='cap']/javacard/cap");cap.set('aid',PACKAGE)
    for item in cap.findall('applet'):item.set('aid',PACKAGE+':'+item.get('aid').split(':')[-1])
    # No tag instance is part of this diagnostic. Its original source remains unmodified.
    for item in list(cap.findall('applet')):
        if item.get('class','').endswith('.Tag'):cap.remove(item)
    tree.write(output/'build.xml',encoding='unicode')
    (output/'stages.json').write_text(json.dumps(stages,indent=2)+'\n')
    return stages


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    parser.add_argument('--sdk',type=Path,default=Path.home()/'.javacard/sdks/jc305u4_kit');args=parser.parse_args()
    out=args.output.resolve();sdk=args.sdk.resolve();stages=prepare(out)
    subprocess.run(['ant','-f',str(out/'build.xml'),'cap','-Djc.sdk='+str(sdk)],check=True)
    cap=out/'constructor-trace.cap';inspect=out/'inspect-classes';inspect.mkdir()
    subprocess.run(['javac','-proc:none','--release','11','-cp',str(sdk/'lib/tools.jar'),'-d',str(inspect),str(HERE/'CashuProbeShape.java')],check=True)
    shape=json.loads(subprocess.check_output(['java','-cp',str(inspect)+os.pathsep+str(sdk/'lib/tools.jar'),'com.sun.javacard.offcardverifier.CashuProbeShape',str(cap)],text=True))
    if shape!={'declaredInstanceSize':50,'firstReferenceToken':0,'referenceCount':50}:raise ValueError('instance shape changed')
    spec=importlib.util.spec_from_file_location('trace_assets',ROOT/'tools/cardkit/make-assets.py');assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
    load=assets.load_file(str(cap));(out/'load-file.bin').write_bytes(load)
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest=dict(kind='constructor-trace-diagnostic-v1',format=1,sourceCommit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),sourceDirty=bool(subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain'],text=True).strip()),packageAid=PACKAGE.replace(':',''),classShape=shape,stageCount=len(stages),terminalStage=next(v['id'] for v in stages if v['statement']=='schnorrHW.init();'),
        stagesSha256=sha(out/'stages.json'),generatedSources={f.name:sha(f) for f in (out/'src/me/flashapp/cashu').glob('*.java')},originalSources={f.name:sha(f) for f in resource.CONTROL.glob('*.java')},builderSha256=sha(Path(__file__)),baseBuilderSha256=sha(HERE/'build-probe.py'),helperSha256=sha(HERE/'java/ConstructorTrace.java'),dispatchSha256=sha(HERE/'java/ConstructorDispatch.txt'),sdkApiSha256=sha(sdk/'lib/api_classic.jar'),sdkToolsSha256=sha(sdk/'lib/tools.jar'),capSha256=sha(cap),loadFileSize=len(load),loadFileSha256=hashlib.sha256(load).hexdigest(),hardwareAccessed=False)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Private constructor diagnostic converted; no device accessed.')


if __name__=='__main__':main()
