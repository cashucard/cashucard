"""Bounded PC/SC policy for explicitly selected private synthetic fixtures."""
import argparse
import json
from pathlib import Path
import sys
import probe_bridge as common

PACKAGE=bytes.fromhex('F04341534855434D5054')
PRIVATE=[PACKAGE+b'\x01',PACKAGE+b'\x4d',PACKAGE]
OLD=[common.PACKAGE,common.PACKAGE+b'\x4d',common.PACKAGE+b'\x01']
SELECTS={common.select(aid) for aid in [common.ISD]+common.PRODUCTION+PRIVATE+OLD}
DATA={bytes.fromhex('80CA9F7F00')}
SMALL='two-input-two-output-v1'
MAX='128-input-128-output-v1'
FILES={SMALL:'assisted-settlement-v1.json',MAX:'compact-capacity-v1.json'}

def cmd(ins,body=b''):
    return bytes([0xb0,ins,0,0])+(bytes([len(body)])+body+b'\0' if body else b'\0')

def fixture_commands(workload=SMALL):
    if not isinstance(workload,str) or workload not in FILES:raise ValueError('unknown fixed workload')
    v=json.loads((Path(__file__).parent/'fixtures'/FILES[workload]).read_text())
    n32=lambda n:n.to_bytes(4,'big')
    counter=(int(v['identity']['id'])-1).to_bytes(8,'big')
    setup=cmd(0x7e,counter+bytes.fromhex(v['context']['installation'])+bytes([len(v['context']['mint'].encode())])+v['context']['mint'].encode())
    keysets=[cmd(0x78,bytes([i,len(k)//2])+bytes.fromhex(k)) for i,k in enumerate(v['keysets'])]
    loads=[cmd(0x71,bytes([p['slot']])+n32(p['generation'])+bytes([p['keysetRef']])+n32(p['amount'])+bytes.fromhex(p['nonce']+p['C'])) for p in v['proofs']]
    outputs=[cmd(0x73,b''.join(n32(o['amount'])+bytes([o['keysetRef']])+bytes.fromhex(o['B_']) for o in v['outputs'][at:at+6])) for at in range(0,len(v['outputs']),6)]
    begin=cmd(0x72,bytes([len(v['proofs']),len(v['outputs'])]+[p['slot'] for p in v['proofs']]))
    length=7+33+32+13+3+len(v['context']['mint'].encode())+2+sum(75+len(v['keysets'][p['keysetRef']])//2 for p in v['proofs'])+1+sum(38+len(v['keysets'][o['keysetRef']])//2 for o in v['outputs'])+128
    pages=[cmd(0x75,bytes([0,at>>8,at&255,min(255,length-at)])) for at in range(0,length,255)]
    return [setup]+keysets+loads+[begin]+outputs+[cmd(0x74),cmd(0x7c,b'\0')]+pages

FIXTURES={name:set(fixture_commands(name)) for name in FILES}

def validate(value,cleanup_only=False,workload=SMALL):
    if not isinstance(workload,str) or workload not in FIXTURES:raise ValueError('unknown fixed workload')
    if not isinstance(value,list) or any(type(b) is not int or not 0<=b<=255 for b in value):raise ValueError('invalid APDU')
    a=bytes(value)
    if a in SELECTS or a in DATA:return a
    if not cleanup_only and (a in FIXTURES[workload] or a in [cmd(0x76),cmd(0x7a),cmd(0x7d)]):return a
    if not cleanup_only and len(a)==51 and a[:5]==bytes.fromhex('b07700002d') and a[-1]==0:return a
    if len(a)<6 or len(a)!=a[4]+6 or a[-1]!=0:raise ValueError('framing')
    cla,ins,p1,p2,lc=a[:5]
    if cla==0x80 and ins==0x50 and p1==1 and p2==0 and lc==8:return a
    if cla!=0x84 or lc<8:raise ValueError('secure command required')
    body=a[5:-9]
    if ins==0x82 and p1==1 and p2==0 and lc==16:return a
    if ins==0xf2 and p1 in (0x20,0x40) and p2 in (2,3) and body==b'\x4f\0':return a
    if ins==0xe4 and p1==p2==0 and body in [b'\x4f'+common.field(aid) for aid in PRIVATE]:return a
    if not cleanup_only:
        if ins==0xe8 and p1 in (0,0x80) and body:return a
        if ins==0xe6 and p2==0:
            if p1==2 and body==common.field(PACKAGE)+common.field(common.ISD)+b'\0\0\0':return a
            for aid in PRIVATE[:2]:
                if p1==0x0c and body==common.field(PACKAGE)+common.field(aid)+common.field(aid)+b'\x01\0\x02\xc9\0\0':return a
    raise ValueError('command refused')

class Policy:
    def __init__(self,cleanup_only=False,workload=SMALL):
        if workload not in FIXTURES:raise ValueError('unknown fixed workload')
        self.cleanup_only=cleanup_only
        self.workload=workload
        self.selected=False
        self.sent={}
        self.scope=None
    def before(self,value):
        a=validate(value,self.cleanup_only,self.workload)
        if a[:1]==b'\xb0':
            if not self.selected:raise ValueError('private applet not selected')
            limit=3 if a==cmd(0x76) else 2 if a==cmd(0x7d) else 1
            if self.sent.get(a,0)>=limit:raise ValueError('bounded command already sent')
            if a[1]==0x77 and (self.scope is None or a!=cmd(0x77,self.scope)):raise ValueError('scope mismatch')
            self.sent[a]=self.sent.get(a,0)+1
        return a
    def after(self,a,data,sw1,sw2):
        if a[:2]==b'\0\xa4':self.selected=a==common.select(PRIVATE[0]) and bytes(data)==b'CPROT\x02' and (sw1,sw2)==(0x90,0)
        if a==cmd(0x74) and (sw1,sw2)==(0x90,0) and len(data)==45:self.scope=bytes(data)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--reader',required=True);p.add_argument('--cleanup-only',action='store_true');p.add_argument('--workload',choices=list(FILES),default=SMALL);a=p.parse_args()
    if a.reader!='ACS ACR122U PICC Interface':raise ValueError('named reader required')
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD, SCARD_SHARE_EXCLUSIVE
    matches=[r for r in common.checked('reader-enumeration-failed',readers) if str(r)==a.reader]
    if len(matches)!=1:raise common.BridgeFailure('reader-unavailable')
    connection=common.checked('reader-connect-failed',matches[0].createConnection);connected=False
    try:
        common.checked('reader-connect-failed',lambda:connection.connect(mode=SCARD_SHARE_EXCLUSIVE,disposition=SCARD_LEAVE_CARD));connected=True
        common.emit({'ready':True});policy=Policy(a.cleanup_only,a.workload)
        while True:
            line=sys.stdin.readline(4097)
            if not line:return
            if len(line)>4096 or not line.endswith('\n'):raise common.BridgeFailure('bridge-input-invalid')
            message=common.checked('bridge-input-invalid',lambda:json.loads(line))
            if message=={'close':True}:return
            if not isinstance(message,dict) or set(message)!={'apdu'}:raise common.BridgeFailure('bridge-input-invalid')
            command=common.checked('bridge-command-refused',lambda:policy.before(message['apdu']))
            data,sw1,sw2=common.checked('reader-transmit-failed',lambda:connection.transmit(list(command)))
            policy.after(command,data,sw1,sw2);common.emit({'reply':data+[sw1,sw2]})
    finally:
        if connected:
            prior=sys.exc_info()[0] is not None
            try:common.checked('reader-close-failed',connection.disconnect)
            except common.BridgeFailure:
                if not prior:raise

if __name__=='__main__':
    try:main()
    except Exception as e:common.emit(common.failure_message(e));sys.exit(1)
