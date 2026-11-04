"""Closed unset-up bridge. All local admission precedes PC/SC import."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
import probe_bridge as common
from compact_recovery_bridge import trim_cplc
from unset_up_policy import UnsetUpPolicy, PROFILE

def private_json(file,digest):
    p=Path(file)
    if not p.is_absolute() or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest): raise ValueError('request path/hash')
    parent=p.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode&0o077:raise ValueError('private directory')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        s=os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_nlink!=1 or s.st_mode&0o077 or s.st_size>1024*1024:raise ValueError('private request')
        raw=stream.read(1024*1024+1)
    if len(raw)>1024*1024 or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('request changed')
    return json.loads(raw)

def request(file,digest,site_packages):
    v=private_json(file,digest)
    if set(v)!={'format','planId','approved','chip','key','reader','campaignSha256','profileSha256','files','marker','journal','python','sitePackages'}:raise ValueError('request fields')
    if v['format']!='unset-up-recovery-request-v1' or v['approved'] is not True or v['planId']!=PROFILE['planId'] or v['chip']!=PROFILE['chip'] or v['key']!=PROFILE['key'] or v['reader']!=PROFILE['reader']:raise ValueError('named execution approval required')
    if v['profileSha256']!=hashlib.sha256((Path(__file__).parent/'unset-up-profile.json').read_bytes()).hexdigest():raise ValueError('profile changed')
    if os.path.realpath(v['python'])!=os.path.realpath(sys.executable) or v['sitePackages']!=site_packages:raise ValueError('runtime changed')
    site=Path(site_packages)
    if not site.is_absolute() or site.resolve(strict=True)!=site or site.name!='site-packages' or not (site/'smartcard').is_dir():raise ValueError('isolated package directory')
    if not isinstance(v['files'],dict) or len(v['files'])>2000:raise ValueError('runtime files')
    required=[str(Path(__file__).resolve()),str(Path(__file__).with_name('unset_up_policy.py').resolve()),str(Path(__file__).with_name('unset-up-profile.json').resolve()),os.path.realpath(sys.executable)]
    if any(name not in v['files'] for name in required):raise ValueError('missing runtime pin')
    for name,expected in v['files'].items():
        p=Path(name)
        if not p.is_absolute() or not p.is_file() or p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise ValueError('runtime file changed')
    marker=private_json(v['marker']['path'],v['marker']['sha256'])
    if marker!={'format':'unset-up-recovery-consumed-v1','planId':PROFILE['planId'],'campaignSha256':v['campaignSha256'],'journal':v['journal']}:raise ValueError('consumption marker')
    return site

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',required=True);parser.add_argument('--sha256',required=True);parser.add_argument('--site-packages',required=True)
    args=parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:raise ValueError('isolated Python required')
    site=request(args.request,args.sha256,args.site_packages)
    sys.path.append(str(site))
    from smartcard.System import readers
    from smartcard.scard import SCARD_LEAVE_CARD,SCARD_SHARE_EXCLUSIVE
    began=time.monotonic()
    matches=[r for r in common.checked('reader-enumeration-failed',readers) if str(r)==PROFILE['reader']]
    if len(matches)!=1:raise common.BridgeFailure('reader-unavailable')
    connection=common.checked('reader-connect-failed',matches[0].createConnection)
    connected=False;requested_close=False;policy=UnsetUpPolicy()
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
            if time.monotonic()-began>120:raise common.BridgeFailure('drill-bound-exceeded')
            a=common.checked('bridge-command-refused',lambda:policy.before(value['apdu']))
            result=common.checked('reader-transmit-failed',lambda:connection.transmit(list(a)))
            data,sw1,sw2=trim_cplc(a,result)
            policy.after(a,data,sw1,sw2)
            if len(data)>256:raise common.BridgeFailure('reader-protocol-error')
            common.emit({'reply':data+[sw1,sw2]})
    finally:
        if connected:common.checked('reader-close-failed',connection.disconnect)
    if requested_close:common.emit({'closed':True,'complete':policy.complete})

if __name__=='__main__':
    try:main()
    except Exception as error:common.emit(common.failure_message(error));sys.exit(1)
