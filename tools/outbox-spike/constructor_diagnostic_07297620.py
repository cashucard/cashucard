"""Closed diagnostic installation policy; request validation precedes PC/SC."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from unset_up_bridge import private_json
from unset_up_policy import frames,secure
from compact_recovery_bridge import trim_cplc
import probe_bridge as common

PROFILE_FILE=HERE/'constructor-trace-07297620.json'
ENTRY_FILE=Path(__file__).resolve()
JOURNAL_RELATIVE='.cashucard/constructor-trace-07297620-2026-11-05/pass-1/diagnostic.json'
PROFILE=json.loads(PROFILE_FILE.read_text())
ISD=common.select(common.ISD)
CPLC=bytes.fromhex('80ca9f7f00')
DIAG=bytes.fromhex('b07d000000')
SELECT_DATA=bytes.fromhex('43545241434501')


def artifact():
    directory=Path(PROFILE['artifactDir']);raw=(directory/'manifest.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=PROFILE['manifestSha256']:raise ValueError('artifact manifest')
    m=json.loads(raw)
    if m['kind']!='constructor-trace-diagnostic-v1' or m['format']!=1 or m['sourceDirty'] is not False or m['packageAid']!=PROFILE['package'] or m['classShape']!={'declaredInstanceSize':50,'firstReferenceToken':0,'referenceCount':50}:raise ValueError('artifact profile')
    for field,pin in [('capSha256','cap'),('loadFileSha256','load'),('loadFileSize','bytes'),('stageCount','stageCount'),('terminalStage','terminalStage')]:
        if m[field]!=PROFILE[pin]:raise ValueError('artifact binding')
    if set(m['generatedSources'])!={'CashuApplet.java','ConstructorTrace.java','Opener.java','SchnorrHW.java','Tag.java','TagSwitch.java'}:raise ValueError('generated source set')
    for n,h in m['generatedSources'].items():
        if n not in ['CashuApplet.java','ConstructorTrace.java','Opener.java','SchnorrHW.java','Tag.java','TagSwitch.java'] or hashlib.sha256((directory/'src/me/flashapp/cashu'/n).read_bytes()).hexdigest()!=h:raise ValueError('generated source')
    for name,pin in [('constructor-trace.cap','capSha256'),('load-file.bin','loadFileSha256'),('stages.json','stagesSha256')]:
        if hashlib.sha256((directory/name).read_bytes()).hexdigest()!=m[pin]:raise ValueError('artifact bytes')
    load=(directory/'load-file.bin').read_bytes();stages=json.loads((directory/'stages.json').read_text())
    if len(load)!=PROFILE['bytes'] or len(stages)!=PROFILE['stageCount'] or len(stages)>=128:raise ValueError('artifact sizes')
    for i,s in enumerate(stages):
        if s['id']!=i+1 or s['file'] not in ('CashuApplet.java','SchnorrHW.java') or hashlib.sha256(s['statement'].encode()).hexdigest()!=s['statementSha256']:raise ValueError('stage program')
    if stages[PROFILE['terminalStage']-1]['statement']!='schnorrHW.init();':raise ValueError('terminal stage')
    return load,stages


def decode(data,stages):
    if len(data)!=6 or data[0]!=1:raise ValueError('diagnostic format')
    _,outcome,stage,kind,hi,lo=data;reason=(hi<<8)|lo
    if not 1<=stage<=len(stages):raise ValueError('diagnostic stage')
    operation=stages[stage-1]
    if outcome==4 and stage==PROFILE['terminalStage'] and kind==reason==0:return dict(outcome='constructor-complete',stage=stage,operation=operation['statement'])
    if outcome!=3 or not 1<=kind<=7 or (kind==7 and reason):raise ValueError('diagnostic outcome')
    return dict(outcome='caught-constructor-fault',stage=stage,file=operation['file'],operation=operation['statement'],kind=['','crypto','system','transaction','iso','pin','card-runtime','runtime'][kind],reason=reason)


def verify_kind(pages,kind,installed):
    rows=[p for p in pages if p['kind']==kind]
    if not 1<=len(rows)<=4:raise ValueError('registry incomplete')
    raw=bytearray()
    for i,p in enumerate(rows):
        data=bytes.fromhex(p['data'])
        if data.hex()!=p['data'] or len(data)>255:raise ValueError('registry framing')
        if i<len(rows)-1:
            if p['sw']!='6310' or not data:raise ValueError('registry continuation')
        elif p['sw']!='9000' and not(i==0 and p['sw']=='6a88' and not data):raise ValueError('registry status')
        raw.extend(data)
    got=frames(bytes(raw));want=frames(bytes.fromhex(next(p['data'] for p in PROFILE['initialPages'] if p['kind']==kind)+(next(p['data'] for p in PROFILE['addedPages'] if p['kind']==kind) if installed else '')))
    if len(got)!=len(want) or len(set(got))!=len(got) or set(got)!=set(want):raise ValueError('registry mismatch')


def plain(ins,p1,p2,body):return bytes([0x80,ins,p1,p2,len(body)])+body+b'\0'


def program(load):
    field=lambda b:bytes([len(b)])+b
    pkg=bytes.fromhex(PROFILE['package'])
    result=[('match-chip','raw',ISD,'isd'),('match-chip','raw',CPLC,'cplc'),('factory-authentication','raw',ISD,'isd'),('factory-authentication','init',None,'init'),('factory-authentication','auth',None,'auth'),('initial-applications','registry','applications',False),('initial-load-files','registry','load-files',False)]
    result.append(('install-for-load','secure',plain(0xe6,2,0,field(pkg)+field(common.ISD)+b'\0\0\0'),'ack'))
    blocks=[load[i:i+247] for i in range(0,len(load),247)]
    if len(blocks)!=PROFILE['blocks']:raise ValueError('block count')
    result += [('load-'+str(i+1),'secure',plain(0xe8,0x80 if i==len(blocks)-1 else 0,i,b),'ack') for i,b in enumerate(blocks)]
    for name,suffix in [('create-opener','4d'),('create-main','01')]:
        aid=pkg+bytes.fromhex(suffix)
        result.append((name,'secure',plain(0xe6,0x0c,0,field(pkg)+field(aid)+field(aid)+bytes.fromhex('010002c90000')),'ack'))
    return result+[('installed-applications','registry','applications',True),('installed-load-files','registry','load-files',True),('select-diagnostic','raw',common.select(pkg+b'\x01'),'select'),('read-diagnostic','raw',DIAG,'diagnostic'),('final-match-chip','raw',ISD,'isd'),('final-match-chip','raw',CPLC,'cplc')]


class Policy:
    def __init__(self,load,stages):
        self.program=program(load);self.stages=stages;self.index=0;self.total=0;self.page=0;self.pending=None;self.failed=False;self.registries={'initial':[],'installed':[]};self.diagnostic=None

    @property
    def complete(self):return not self.failed and self.index==len(self.program) and self.pending is None

    def expected(self):
        name,mode,command,check=self.program[self.index]
        if mode=='init':return bytes.fromhex('8050010008')+bytes(9)
        if mode=='auth':return bytes.fromhex('8482010010')+bytes(17)
        if mode=='registry':return plain(0xf2,0x40 if command=='applications' else 0x20,2 if self.page==0 else 3,bytes.fromhex('4f00'))
        return command

    def stage(self):
        name,mode,_,_=self.program[self.index];return name+'-'+str(self.page) if mode=='registry' else name

    def before(self,value):
        try:
            if self.failed or self.pending is not None or self.index>=len(self.program) or self.total>=128:raise ValueError('diagnostic stopped')
            if not isinstance(value,list) or any(type(v) is not int or not 0<=v<=255 for v in value):raise ValueError('APDU bytes')
            a=bytes(value);_,mode,_,_=self.program[self.index];expected=self.expected()
            if mode in ('registry','secure'):allowed=secure(a,expected[1],expected[2],expected[3],expected[5:-1])
            elif mode in ('init','auth'):allowed=len(a)==len(expected) and a[:5]==expected[:5] and a[-1]==0
            else:allowed=a==expected
            if not allowed:raise ValueError('command outside diagnostic stage')
            self.pending=a;self.total+=1;return a
        except Exception:self.failed=True;raise

    def after(self,a,data,sw1,sw2):
        try:
            if self.failed or self.pending!=bytes(a):raise ValueError('reply order')
            if not isinstance(data,(bytes,bytearray,list)) or len(data)>256 or any(type(v) is not int or not 0<=v<=255 for v in data):raise ValueError('reply bytes')
            data=bytes(data);sw=bytes([sw1,sw2]).hex();name,mode,command,check=self.program[self.index];self.pending=None
            if mode=='registry':
                if sw=='6310':
                    if not data or self.page>=3:raise ValueError('registry continuation')
                elif sw!='9000' and not(self.page==0 and sw=='6a88' and not data):raise ValueError('registry status')
                phase='installed' if check else 'initial';self.registries[phase].append(dict(kind=command,data=data.hex(),sw=sw))
                if sw=='6310':self.page+=1;return True
                verify_kind(self.registries[phase],command,check);self.page=0
            else:
                if sw!='9000':raise ValueError('status mismatch')
                if check=='cplc' and data!=bytes.fromhex(PROFILE['cplc']):raise ValueError('chip mismatch')
                if check=='init' and (len(data)!=28 or data[10:12]!=bytes.fromhex('0102')):raise ValueError('factory handshake')
                if check=='auth' and data:raise ValueError('authentication reply')
                if check=='ack' and data not in (b'',b'\0'):raise ValueError('management reply')
                if check=='select' and data!=SELECT_DATA:raise ValueError('diagnostic selection')
                if check=='diagnostic':self.diagnostic=decode(data,self.stages)
            self.index+=1;return True
        except Exception:self.failed=True;return False


def verify_journal(value):
    load,stages=artifact();p=Policy(load,stages)
    if value['plan']!=PROFILE['planId'] or value['chip']!=PROFILE['chip'] or value['status']!='running':raise ValueError('journal binding')
    if value['artifact']!={'manifest':PROFILE['manifestSha256'],'cap':PROFILE['cap'],'load':PROFILE['load']} or value['factoryVersionVerified']!=1:raise ValueError('image or factory binding')
    for k in ['initialRegistryVerified','installedRegistryVerified','finalIdentityVerified']:
        if value[k] is not True:raise ValueError('incomplete state')
    receipts=value['exchanges']
    if type(value['commands']) is not int or not PROFILE['blocks']+16<=value['commands']<=PROFILE['blocks']+28 or len(receipts)!=value['commands']:raise ValueError('receipts')
    for i,e in enumerate(receipts):
        if e['command']!=i+1 or e['stage']!=p.stage():raise ValueError('receipt order')
        _,mode,_,check=p.program[p.index];a=p.expected()
        if check not in ('init','auth') and e.get('intentSha256')!=hashlib.sha256(a).hexdigest():raise ValueError('command intent digest')
        if mode in ('registry','secure'):a=bytes([0x84])+a[1:4]+bytes([a[4]+8])+a[5:-1]+bytes(8)+b'\0'
        if e['header']!=a[:4].hex():raise ValueError('receipt header')
        if check in ('init','auth'):
            if 'data' in e or 'intentSha256' in e:raise ValueError('authentication evidence')
            data=bytes(10)+bytes.fromhex('0102')+bytes(16) if check=='init' else b''
        else:
            data=bytes.fromhex(e['data'])
            if data.hex()!=e['data']:raise ValueError('receipt framing')
        sw=bytes.fromhex(e['sw'])
        if len(sw)!=2 or sw.hex()!=e['sw']:raise ValueError('receipt status')
        if type(e['elapsedMs']) not in (int,float) or not 0<=e['elapsedMs']<=120000:raise ValueError('receipt timing')
        p.before(list(a))
        if not p.after(a,list(data),*sw):raise ValueError('receipt refused')
    snapshots=[dict(name=name,pages=rows,verified=True) for name,rows in p.registries.items()]
    if not p.complete or snapshots!=value['registries'] or p.diagnostic!=value['constructorResult']:raise ValueError('saved result mismatch')
    return dict(savedEvidenceVerified=True)


def request(args):
    v=private_json(args.request,args.sha256)
    if set(v)!={'format','planId','approved','profileSha256','python','sitePackages','files','marker','journal','campaignSha256'}:
        raise ValueError('request fields')
    if v['format']!='card-constructor-diagnostic-request-v1' or v['planId']!=PROFILE['planId'] or v['approved'] is not True or PROFILE['approved'] is not True:
        raise ValueError('execution approval required')
    if v['profileSha256']!=hashlib.sha256(PROFILE_FILE.read_bytes()).hexdigest():raise ValueError('profile changed')
    if os.path.realpath(v['python'])!=os.path.realpath(sys.executable) or v['sitePackages']!=args.site_packages:raise ValueError('runtime changed')
    site=Path(args.site_packages)
    if not site.is_absolute() or site.resolve(strict=True)!=site or site.name!='site-packages' or not (site/'smartcard').is_dir():raise ValueError('package path')
    required=[str(ENTRY_FILE),str(PROFILE_FILE),str(HERE/'unset_up_bridge.py'),str(HERE/'unset_up_policy.py'),str(HERE/'compact_recovery_bridge.py'),str(HERE/'probe_bridge.py'),os.path.realpath(sys.executable),*[str(Path(PROFILE['artifactDir'])/n) for n in ['manifest.json','constructor-trace.cap','load-file.bin','stages.json']]]
    if not isinstance(v['files'],dict) or len(v['files'])>2000 or any(p not in v['files'] for p in required):raise ValueError('runtime pins')
    for name,digest in v['files'].items():
        p=Path(name)
        if not p.is_absolute() or p.is_symlink() or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('runtime file changed')
    journal=str(Path.home()/JOURNAL_RELATIVE)
    if v['journal']!=journal or v['marker']['path']!=journal+'.consumed':raise ValueError('named journal required')
    marker=private_json(v['marker']['path'],v['marker']['sha256'])
    if marker!={'format':'card-constructor-diagnostic-consumed-v1','planId':PROFILE['planId'],'campaignSha256':v['campaignSha256'],'journal':journal}:raise ValueError('consumption marker')
    return site


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request');parser.add_argument('--sha256',required=True);parser.add_argument('--site-packages');parser.add_argument('--verify-journal')
    args=parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:raise ValueError('isolated Python required')
    if args.verify_journal:
        if args.request or args.site_packages:raise ValueError('verification arguments')
        common.emit(verify_journal(private_json(args.verify_journal,args.sha256)));return
    site=request(args);load,stages=artifact();policy=Policy(load,stages);sys.path.append(str(site))
    from smartcard.System import readers
    from smartcard.scard import SCARD_SHARE_EXCLUSIVE,SCARD_LEAVE_CARD
    began=time.monotonic()
    matches=[r for r in common.checked('reader-enumeration-failed',readers) if str(r)==PROFILE['reader']]
    if len(matches)!=1:raise common.BridgeFailure('reader-unavailable')
    connection=common.checked('reader-connect-failed',matches[0].createConnection);connected=False;requested_close=False
    try:
        common.checked('reader-connect-failed',lambda:connection.connect(mode=SCARD_SHARE_EXCLUSIVE,disposition=SCARD_LEAVE_CARD));connected=True
        common.emit({'ready':True})
        while True:
            line=sys.stdin.readline(4097)
            if not line:return
            if len(line)>4096 or not line.endswith('\n'):raise common.BridgeFailure('bridge-input-invalid')
            value=common.checked('bridge-input-invalid',lambda:json.loads(line))
            if value=={'close':True}:requested_close=True;break
            if not isinstance(value,dict) or set(value)!={'apdu'}:raise common.BridgeFailure('bridge-input-invalid')
            if time.monotonic()-began>=120:raise common.BridgeFailure('drill-bound-exceeded')
            a=common.checked('bridge-command-refused',lambda:policy.before(value['apdu']))
            r=common.checked('reader-transmit-failed',lambda:connection.transmit(list(a)))
            data,sw1,sw2=trim_cplc(a,r);policy.after(a,data,sw1,sw2)
            if len(data)>256:raise common.BridgeFailure('reader-protocol-error')
            common.emit({'reply':list(data)+[sw1,sw2]})
    finally:
        if connected:common.checked('reader-close-failed',connection.disconnect)
    if requested_close:common.emit({'closed':True,'complete':policy.complete})


if __name__=='__main__':
    try:main()
    except Exception as error:common.emit(common.failure_message(error));sys.exit(1)
