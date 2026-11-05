"""Closed five-command public memory snapshot and independent receipt replay."""
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
from compact_recovery_bridge import trim_cplc
import probe_bridge as common

PROFILE_FILE = HERE/'memory-07297620.json'
ENTRY_FILE = HERE/'memory_07297620.py'
JOURNAL_RELATIVE = '.cashucard/memory-07297620-2026-11-05/pass-1/memory.json'
PROFILE = json.loads(PROFILE_FILE.read_text())
ISD = common.select(common.ISD)
CPLC = bytes.fromhex('80ca9f7f00')
MEMORY=bytes.fromhex('80caff2100')
STAGES=['isd','cplc','memory','isd','cplc']


def decode_memory(data):
    if len(data)!=19 or data[:5]!=bytes.fromhex('ff21108102') or data[7:9]!=bytes.fromhex('8204') or data[13:15]!=bytes.fromhex('8304'):raise ValueError('memory format')
    return dict(source='isd-ff21',tag81=int.from_bytes(data[5:7],'big'),persistentBytes=int.from_bytes(data[9:13],'big'),volatileBytes=int.from_bytes(data[15:19],'big'))


class Policy:
    def __init__(self):
        self.index=0;self.total=0;self.pending=None;self.failed=False;self.memory=None

    @property
    def complete(self):
        return not self.failed and self.index==len(STAGES) and self.pending is None

    def before(self,value):
        try:
            if self.failed or self.pending is not None or self.index>=len(STAGES) or self.total>=5:
                raise ValueError('memory snapshot stopped')
            if not isinstance(value,list) or any(type(v) is not int or not 0<=v<=255 for v in value):
                raise ValueError('frame bytes')
            a=bytes(value);kind=STAGES[self.index];allowed=False
            if kind=='isd': allowed=a==ISD
            elif kind=='cplc': allowed=a==CPLC
            elif kind=='memory':allowed=a==MEMORY
            if not allowed: raise ValueError('command outside snapshot stage')
            self.pending=a;self.total+=1;return a
        except Exception:
            self.failed=True;raise

    def after(self,a,data,sw1,sw2):
        try:
            if self.failed or self.pending!=bytes(a): raise ValueError('reply order')
            if not isinstance(data,(bytes,bytearray,list)) or len(data)>256 or any(type(v) is not int or not 0<=v<=255 for v in data): raise ValueError('reply bytes')
            data=bytes(data);sw=bytes([sw1,sw2]).hex();kind=STAGES[self.index];self.pending=None
            if sw!='9000':raise ValueError('status mismatch')
            if kind=='cplc' and data!=bytes.fromhex(PROFILE['cplc']):raise ValueError('chip mismatch')
            if kind=='memory':self.memory=decode_memory(data)
            self.index+=1;return True
        except Exception:
            self.failed=True;return False


def verify_journal(value):
    if value['plan']!=PROFILE['planId'] or value['chip']!=PROFILE['chip'] or value['status']!='running':raise ValueError('premature outcome')
    if value['memoryVerified'] is not True or value['finalIdentityVerified'] is not True:raise ValueError('incomplete state')
    receipts=value['exchanges']
    if type(value['commands']) is not int or value['commands']!=5 or len(receipts)!=5:raise ValueError('receipts')
    policy=Policy()
    commands=[ISD,CPLC,MEMORY,ISD,CPLC]
    stages=['match-chip','match-chip','platform-memory','final-match-chip','final-match-chip']
    for i,e in enumerate(receipts):
        if e['command']!=i+1 or e['sw']!='9000' or e['stage']!=stages[i] or e['header']!=commands[i][:4].hex():raise ValueError('receipt order')
        data=bytes.fromhex(e['data'])
        if data.hex()!=e['data']:raise ValueError('receipt data')
        policy.before(list(commands[i]))
        if not policy.after(commands[i],list(data),0x90,0):raise ValueError('receipt refused')
    if not policy.complete or policy.memory!=value['memory']:raise ValueError('memory mismatch')
    return {'savedEvidenceVerified':True}


def request(args):
    v=private_json(args.request,args.sha256)
    if set(v)!={'format','planId','approved','profileSha256','python','sitePackages','files','marker','journal','campaignSha256'}:
        raise ValueError('request fields')
    if v['format']!='card-memory-request-v1' or v['planId']!=PROFILE['planId'] or v['approved'] is not True or PROFILE['approved'] is not True:
        raise ValueError('execution approval required')
    if v['profileSha256']!=hashlib.sha256(PROFILE_FILE.read_bytes()).hexdigest():raise ValueError('profile changed')
    if os.path.realpath(v['python'])!=os.path.realpath(sys.executable) or v['sitePackages']!=args.site_packages:raise ValueError('runtime changed')
    site=Path(args.site_packages)
    if not site.is_absolute() or site.resolve(strict=True)!=site or site.name!='site-packages' or not (site/'smartcard').is_dir():raise ValueError('package path')
    required=[str(ENTRY_FILE),str(PROFILE_FILE),str(HERE/'unset_up_bridge.py'),str(HERE/'compact_recovery_bridge.py'),str(HERE/'probe_bridge.py'),os.path.realpath(sys.executable)]
    if not isinstance(v['files'],dict) or len(v['files'])>2000 or any(p not in v['files'] for p in required):raise ValueError('runtime pins')
    for name,digest in v['files'].items():
        p=Path(name)
        if not p.is_absolute() or p.is_symlink() or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('runtime file changed')
    journal=str(Path.home()/JOURNAL_RELATIVE)
    if v['journal']!=journal or v['marker']['path']!=journal+'.consumed':raise ValueError('named journal required')
    marker=private_json(v['marker']['path'],v['marker']['sha256'])
    if marker!={'format':'card-memory-consumed-v1','planId':PROFILE['planId'],'campaignSha256':v['campaignSha256'],'journal':journal}:raise ValueError('consumption marker')
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
