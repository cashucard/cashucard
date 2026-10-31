"""Fixed recovery/export/retirement policy; SIGN and installation are excluded."""
import argparse
import json
import re
import sys
import compact_bridge as b

PAGES={a for a in b.FIXTURES[b.MAX] if a[1]==0x75}
UNPUBLISHED=bytes([64,90,128,0,0,0])
CONSUMED=bytes([63,45,0,128,0,0])
RETIRED=bytes([64,90,0,0,128,0])
EXPECTED_KEY=bytes.fromhex('03c1d456043ca7d52155e2f99b5e84af043d63bfa1fe8c346b2ab9d98f32552cda')

class Policy:
    def __init__(self,expected_key=EXPECTED_KEY):
        self.selected=False;self.failed=False;self.total=0;self.sent={}
        self.status=None;self.scope=None;self.scope_absent=False
        self.pages=set();self.retire_ack=False
        self.expected_key=expected_key;self.key_matched=False;self.diagnostics_matched=False
    def cleanup_ready(self):
        return self.key_matched and self.diagnostics_matched and ((self.status==UNPUBLISHED and self.scope_absent) or (self.retire_ack and self.status==RETIRED))
    def before(self,value):
        if self.failed or self.total>=160:raise ValueError('recovery stopped')
        if not isinstance(value,list) or any(type(v) is not int or not 0<=v<=255 for v in value):raise ValueError('invalid APDU')
        a=bytes(value)
        if len(a)<5 or len(a)>261:raise ValueError('short frame required')
        if a in [b.common.select(b.common.ISD),b.common.select(b.PRIVATE[0]),bytes.fromhex('80ca9f7f00')]:
            limit=4 if a==b.common.select(b.common.ISD) else 2 if a[1]==0xca else 1
        elif a[:1]==b'\xb0':
            if not self.selected:raise ValueError('private applet not selected')
            if a==b.cmd(0x76):limit=2
            elif a in [b.cmd(0x7a),b.cmd(0x7d),b.cmd(0x7c,b'\0')]:limit=1
            elif a in PAGES:
                if self.scope is None or self.status!=CONSUMED or not self.key_matched or not self.diagnostics_matched:raise ValueError('verified committed scope required')
                limit=1
            elif self.scope is not None and a==b.cmd(0x77,self.scope):
                if self.pages!=PAGES or self.status!=CONSUMED or not self.key_matched or not self.diagnostics_matched:raise ValueError('complete export required')
                limit=1
            else:raise ValueError('recovery command refused')
        else:
            if (a[0],a[1]) not in ((0x80,0x50),(0x84,0x82),(0x84,0xf2),(0x84,0xe4)):
                raise ValueError('recovery management command refused')
            b.validate(value,cleanup_only=True,workload=b.MAX)
            if a[:2]==bytes.fromhex('84e4') and not self.cleanup_ready():raise ValueError('recovery deletion blocked')
            # Authentication challenges/MACs vary; command classes are separately bounded below.
            limit=24 if a[1]==0xf2 else 1
        count_key=a if a[1] not in (0x50,0x82,0xf2) else a[:4]
        if a[1]==0xe4:count_key=a[:4]+a[5:-9]
        if a[1] in (0x50,0x82):limit=2
        if a[1] in (0x50,0x82) and self.sent.get(count_key,0)>=1 and not self.cleanup_ready():
            raise ValueError('authentication retry refused')
        if self.sent.get(count_key,0)>=limit:raise ValueError('bounded recovery command already sent')
        self.sent[count_key]=self.sent.get(count_key,0)+1;self.total+=1
        return a
    def after(self,a,data,sw1,sw2):
        data=bytes(data);sw=(sw1,sw2)
        if a[:2]==b'\0\xa4':
            self.selected=a==b.common.select(b.PRIVATE[0]) and data==b'CPROT\x02' and sw==(0x90,0)
        if a[:1]!=b'\xb0':
            if sw!=(0x90,0) and not (a[1]==0xf2 and sw in ((0x63,0x10),(0x6a,0x88))):self.failed=True
            return
        if a==b.cmd(0x7c,b'\0') and sw==(0x69,0x85) and not data:
            if self.status!=UNPUBLISHED:self.failed=True
            else:self.scope_absent=True
            return
        if sw!=(0x90,0):self.failed=True;return
        if a==b.cmd(0x7a):
            self.key_matched=data==self.expected_key
            if not self.key_matched:self.failed=True
        elif a==b.cmd(0x7d):
            self.diagnostics_matched=len(data)==16 and data[10:]==bytes.fromhex('400030000205') and min(int.from_bytes(data[6:8],'big'),int.from_bytes(data[8:10],'big'))>=128
            if not self.diagnostics_matched:self.failed=True
        elif a==b.cmd(0x76):
            if data not in (UNPUBLISHED,CONSUMED,RETIRED):self.failed=True
            self.status=data
        elif a==b.cmd(0x7c,b'\0'):
            if len(data)!=45 or data[:13]!=b'\0'+(1).to_bytes(8,'big')+(1).to_bytes(4,'big'):self.failed=True
            else:self.scope=data
        elif a in PAGES:
            if len(data)!=a[8]:self.failed=True
            else:self.pages.add(a)
        elif a[1]==0x77:
            if data!=b'\1':self.failed=True
            else:self.retire_ack=True

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--reader',required=True);p.add_argument('--expected-key',default=EXPECTED_KEY.hex());args=p.parse_args()
    if args.reader!='ACS ACR122U PICC Interface':raise ValueError('named reader required')
    if not re.fullmatch(r'(02|03)[0-9a-f]{64}',args.expected_key):raise ValueError('compressed public key required')
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD,SCARD_SHARE_EXCLUSIVE
    matches=[r for r in b.common.checked('reader-enumeration-failed',readers) if str(r)==args.reader]
    if len(matches)!=1:raise b.common.BridgeFailure('reader-unavailable')
    c=b.common.checked('reader-connect-failed',matches[0].createConnection);connected=False
    try:
        b.common.checked('reader-connect-failed',lambda:c.connect(mode=SCARD_SHARE_EXCLUSIVE,disposition=SCARD_LEAVE_CARD));connected=True
        b.common.emit({'ready':True});policy=Policy(expected_key=bytes.fromhex(args.expected_key))
        while True:
            line=sys.stdin.readline(4097)
            if not line:return
            if len(line)>4096 or not line.endswith('\n'):raise b.common.BridgeFailure('bridge-input-invalid')
            message=b.common.checked('bridge-input-invalid',lambda:json.loads(line))
            if message=={'close':True}:return
            if not isinstance(message,dict) or set(message)!={'apdu'}:raise b.common.BridgeFailure('bridge-input-invalid')
            a=b.common.checked('bridge-command-refused',lambda:policy.before(message['apdu']))
            data,sw1,sw2=b.common.checked('reader-transmit-failed',lambda:c.transmit(list(a)))
            policy.after(a,data,sw1,sw2);b.common.emit({'reply':data+[sw1,sw2]})
    finally:
        if connected:
            prior=sys.exc_info()[0] is not None
            try:b.common.checked('reader-close-failed',c.disconnect)
            except b.common.BridgeFailure:
                if not prior:raise

if __name__=='__main__':
    try:main()
    except Exception as e:b.common.emit(b.common.failure_message(e));sys.exit(1)
