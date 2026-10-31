"""Independent BIP-340 verification of public recovery evidence; no card access."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'cardctl'))
from bip340 import verify

def verify_evidence(value):
    if not isinstance(value,dict) or set(value)!={'key','paymentMessage','descriptorMessage','payment','descriptor'}:
        return {'payment':False,'descriptor':False}
    try:
        key=bytes.fromhex(value['key'])
        if len(key)!=33 or key[0] not in (2,3):raise ValueError('key')
        return {name:verify(key[1:],bytes.fromhex(value[name+'Message']),bytes.fromhex(value[name])) for name in ('payment','descriptor')}
    except (ValueError,TypeError):return {'payment':False,'descriptor':False}

if __name__=='__main__':
    text=sys.stdin.read(4097)
    try:result=verify_evidence(json.loads(text)) if len(text)<=4096 else {'payment':False,'descriptor':False}
    except (ValueError,TypeError):result={'payment':False,'descriptor':False}
    print(json.dumps(result))
