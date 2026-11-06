"""One fixed post-reset readiness invocation. Reuses unchanged wire restrictions."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import readiness_07297620 as b


def activate():
    file=b.HERE/'readiness-07297620-v2.json'
    profile=json.loads(file.read_text())
    if profile['planId']!='readiness-07297620-v2':raise ValueError('successor plan')
    for name in ('format','reader','chip','cplc','baselinePages'):
        if profile[name]!=b.PROFILE[name]:raise ValueError('successor changed device or baseline')
    b.PROFILE=profile
    b.PROFILE_FILE=file
    b.ENTRY_FILE=Path(__file__).resolve()
    b.JOURNAL_RELATIVE='.cashucard/readiness-07297620-2026-11-05/pass-2/readiness.json'


if __name__=='__main__':
    try:activate();b.main()
    except Exception as error:b.common.emit(b.common.failure_message(error));sys.exit(1)
