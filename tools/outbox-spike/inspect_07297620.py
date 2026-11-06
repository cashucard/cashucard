"""Closed read-only 07297620 inspection and independent receipt replay."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from unset_up_bridge import private_json
from unset_up_policy import frames, secure
from compact_recovery_bridge import trim_cplc
import probe_bridge as common

PROFILE_FILE = HERE/'inspect-07297620.json'
ENTRY_FILE = HERE/'inspect_07297620.py'
JOURNAL_RELATIVE = '.cashucard/inspect-07297620-2026-11-05/pass-1/inspection.json'
PROFILE = json.loads(PROFILE_FILE.read_text())
ISD = common.select(common.ISD)
CPLC = bytes.fromhex('80ca9f7f00')
BASELINE = frames(bytes.fromhex(next(p['data'] for p in PROFILE['baselinePages'] if p['kind']=='load-files')))
STAGES = ['isd','cplc','isd','init','auth','applications','load-files','isd','cplc']


PRIVATE = {v['kind']: frames(bytes.fromhex(v['data'])) for v in PROFILE['installedPrivatePages']}


def verify_kind(pages,kind):
    rows=[p for p in pages if p['kind']==kind]
    if not 1<=len(rows)<=4:raise ValueError('registry incomplete')
    raw=bytearray()
    for i,row in enumerate(rows):
        data=bytes.fromhex(row['data'])
        if row['data']!=data.hex() or len(data)>255:raise ValueError('registry framing')
        if i<len(rows)-1:
            if row['sw']!='6310' or not data:raise ValueError('registry continuation')
        elif row['sw']!='9000' and not (i==0 and row['sw']=='6a88' and not data):raise ValueError('registry status')
        raw.extend(data)
    got=frames(bytes(raw))
    main=kind=='applications' and PRIVATE['applications'][1] in got
    want=([PRIVATE['applications'][0]]+([PRIVATE['applications'][1]] if main else [])) if kind=='applications' else BASELINE+PRIVATE['load-files']
    if len(got)!=len(want) or len(set(got))!=len(got) or set(got)!=set(want):raise ValueError('registry mismatch')
    return main


def verify_pages(pages):
    if not isinstance(pages,list) or any(p['kind'] not in ('applications','load-files') for p in pages):raise ValueError('registry kinds')
    main=verify_kind(pages,'applications');verify_kind(pages,'load-files');return main


class Policy:
    def __init__(self):
        self.index=0;self.total=0;self.pending=None;self.failed=False;self.page=0;self.rows=[]

    @property
    def complete(self):
        return not self.failed and self.index==len(STAGES) and self.pending is None

    def before(self,value):
        try:
            if self.failed or self.pending is not None or self.index>=len(STAGES) or self.total>=15:
                raise ValueError('inspection stopped')
            if not isinstance(value,list) or any(type(v) is not int or not 0<=v<=255 for v in value):
                raise ValueError('frame bytes')
            a=bytes(value);kind=STAGES[self.index];allowed=False
            if kind=='isd': allowed=a==ISD
            elif kind=='cplc': allowed=a==CPLC
            elif kind=='init': allowed=len(a)==14 and a[:5]==bytes.fromhex('8050010008') and a[-1]==0
            elif kind=='auth': allowed=len(a)==22 and a[:5]==bytes.fromhex('8482010010') and a[-1]==0
            elif kind in ('applications','load-files'):
                allowed=self.page<4 and secure(a,0xf2,0x40 if kind=='applications' else 0x20,2 if self.page==0 else 3,bytes.fromhex('4f00'))
            if not allowed: raise ValueError('command outside inspection stage')
            self.pending=a;self.total+=1;return a
        except Exception:
            self.failed=True;raise

    def after(self,a,data,sw1,sw2):
        try:
            if self.failed or self.pending!=bytes(a): raise ValueError('reply order')
            if not isinstance(data,(bytes,bytearray,list)) or len(data)>256 or any(type(v) is not int or not 0<=v<=255 for v in data): raise ValueError('reply bytes')
            data=bytes(data);sw=bytes([sw1,sw2]).hex();kind=STAGES[self.index];self.pending=None
            if kind in ('applications','load-files'):
                if sw=='6310':
                    if not data or self.page>=3: raise ValueError('registry continuation')
                elif sw!='9000' and not (self.page==0 and sw=='6a88' and not data):raise ValueError('registry status')
                self.rows.append({'kind':kind,'data':data.hex(),'sw':sw})
                if sw=='6310':self.page+=1;return True
                # Verify this complete kind before admitting another stage.
                verify_kind(self.rows,kind)
                self.page=0
            else:
                if sw!='9000':raise ValueError('status mismatch')
                if kind=='cplc' and data!=bytes.fromhex(PROFILE['cplc']):raise ValueError('chip mismatch')
                if kind=='init' and (len(data)!=28 or data[10:12]!=b'\x01\x02'):raise ValueError('factory handshake')
                if kind=='auth' and data:raise ValueError('authentication receipt')
            self.index+=1;return True
        except Exception:
            self.failed=True;return False


def verify_journal(value):
    if value['plan']!=PROFILE['planId'] or value['chip']!=PROFILE['chip'] or value['status']!='running':raise ValueError('premature outcome')
    if value['registryVerified'] is not True or value['finalIdentityVerified'] is not True:raise ValueError('incomplete state')
    main=verify_pages(value['pages'])
    if type(value['mainPresent']) is not bool or value['mainPresent']!=main:raise ValueError('membership claim')
    receipts=value['exchanges']
    if type(value['commands']) is not int or not 9<=value['commands']<=15 or len(receipts)!=value['commands']:raise ValueError('receipts')
    policy=Policy()
    for i,e in enumerate(receipts):
        if e['command']!=i+1 or e['sw'] is None:raise ValueError('receipt order')
        kind=STAGES[policy.index]
        stage='match-chip' if policy.index<2 else ('factory-authentication' if policy.index<5 else ('registry-'+kind+'-'+str(policy.page) if kind in ('applications','load-files') else 'final-match-chip'))
        if e['stage']!=stage:raise ValueError('receipt stage')
        if kind=='isd':a=ISD
        elif kind=='cplc':a=CPLC
        elif kind=='init':a=bytes.fromhex('8050010008')+bytes(9)
        elif kind=='auth':a=bytes.fromhex('8482010010')+bytes(17)
        else:a=bytes([0x84,0xf2,0x40 if kind=='applications' else 0x20,2 if policy.page==0 else 3,10,0x4f,0])+bytes(9)
        if e['header']!=a[:4].hex():raise ValueError('receipt header')
        if kind in ('init','auth'):
            if 'data' in e:raise ValueError('authentication evidence')
            data=bytes(10)+b'\x01\x02'+bytes(16) if kind=='init' else b''
        else:
            data=bytes.fromhex(e['data'])
            if data.hex()!=e['data']:raise ValueError('receipt data')
        sw=bytes.fromhex(e['sw'])
        if len(sw)!=2 or sw.hex()!=e['sw']:raise ValueError('receipt status')
        policy.before(list(a))
        if not policy.after(a,list(data),*sw):raise ValueError('receipt refused')
    if not policy.complete or policy.rows!=value['pages']:raise ValueError('receipt registry mismatch')
    return {'savedEvidenceVerified':True,'mainPresent':main}


def request(args):
    v=private_json(args.request,args.sha256)
    if set(v)!={'format','planId','approved','profileSha256','python','sitePackages','files','marker','journal','campaignSha256'}:
        raise ValueError('request fields')
    if v['format']!='card-inspection-request-v1' or v['planId']!=PROFILE['planId'] or v['approved'] is not True or PROFILE['approved'] is not True:
        raise ValueError('execution approval required')
    if v['profileSha256']!=hashlib.sha256(PROFILE_FILE.read_bytes()).hexdigest():raise ValueError('profile changed')
    if os.path.realpath(v['python'])!=os.path.realpath(sys.executable) or v['sitePackages']!=args.site_packages:raise ValueError('runtime changed')
    site=Path(args.site_packages)
    if not site.is_absolute() or site.resolve(strict=True)!=site or site.name!='site-packages' or not (site/'smartcard').is_dir():raise ValueError('package path')
    required=[str(ENTRY_FILE),str(PROFILE_FILE),str(HERE/'unset_up_bridge.py'),str(HERE/'unset_up_policy.py'),str(HERE/'compact_recovery_bridge.py'),str(HERE/'probe_bridge.py'),os.path.realpath(sys.executable)]
    if not isinstance(v['files'],dict) or len(v['files'])>2000 or any(p not in v['files'] for p in required):raise ValueError('runtime pins')
    for name,digest in v['files'].items():
        p=Path(name)
        if not p.is_absolute() or p.is_symlink() or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('runtime file changed')
    journal=str(Path.home()/JOURNAL_RELATIVE)
    if v['journal']!=journal or v['marker']['path']!=journal+'.consumed':raise ValueError('named journal required')
    marker=private_json(v['marker']['path'],v['marker']['sha256'])
    if marker!={'format':'card-inspection-consumed-v1','planId':PROFILE['planId'],'campaignSha256':v['campaignSha256'],'journal':journal}:raise ValueError('consumption marker')
    return site


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request');parser.add_argument('--sha256',required=True);parser.add_argument('--site-packages');parser.add_argument('--verify-journal')
    args=parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:raise ValueError('isolated Python required')
    if args.verify_journal:
        if args.request or args.site_packages:raise ValueError('verification arguments')
        common.emit(verify_journal(private_json(args.verify_journal,args.sha256)));return
    site=request(args);sys.path.append(str(site))
    from smartcard.System import readers
    from smartcard.scard import SCARD_SHARE_EXCLUSIVE,SCARD_LEAVE_CARD
    began=time.monotonic()
    matches=[r for r in common.checked('reader-enumeration-failed',readers) if str(r)==PROFILE['reader']]
    if len(matches)!=1:raise common.BridgeFailure('reader-unavailable')
    connection=common.checked('reader-connect-failed',matches[0].createConnection);connected=False;requested_close=False;policy=Policy()
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
