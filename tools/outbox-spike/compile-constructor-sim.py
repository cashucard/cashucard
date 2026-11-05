#!/usr/bin/env python3
"""Compile copied diagnostic sources with host-only fault injection. No devices."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('artifact',type=Path);a=p.parse_args();out=a.artifact.resolve()
m=json.loads((out/'manifest.json').read_text());assert m['kind']=='constructor-trace-diagnostic-v1'
src=out/'sim-src';src.mkdir();classes=out/'sim-classes';classes.mkdir()
for name,digest in m['generatedSources'].items():
    f=out/'src/me/flashapp/cashu'/name;raw=f.read_bytes();assert hashlib.sha256(raw).hexdigest()==digest
    text=raw.decode()
    if name=='ConstructorTrace.java':
        anchor='static void before(byte value) { stage=value; outcome=1; }'
        assert text.count(anchor)==1
        text=text.replace(anchor,'static void before(byte value) { stage=value; outcome=1; ConstructorFault.check(value); }')
    (src/name).write_text(text)
(src/'ConstructorFault.java').write_text('''package me.flashapp.cashu;
import javacard.framework.*;
import javacard.security.CryptoException;
public final class ConstructorFault {
    public static short target;
    public static byte kind;
    static void check(byte stage) {
        if(target==0 || target!=(short)(stage & 255))return;
        if(kind==1)CryptoException.throwIt((short)3);
        if(kind==2)SystemException.throwIt((short)1);
        if(kind==3)TransactionException.throwIt((short)1);
        if(kind==4)ISOException.throwIt((short)0x6F00);
        if(kind==5)PINException.throwIt((short)1);
        if(kind==6)throw new CardRuntimeException((short)2);
        if(kind==7)throw new NullPointerException();
    }
}
''')
subprocess.run(['javac','--release','11','-cp',str(ROOT/'tools/cardsim/target/cardsim.jar'),'-d',str(classes),*[str(f) for f in src.glob('*.java')],str(HERE/'java/ConstructorTraceHarness.java')],check=True)
print('Copied simulator-only fault source compiled; converted CAP sources unchanged.')
