"""Fixed successor after host-only zero-command stop; no wire predicate changes."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import constructor_diagnostic_07297620 as b


def activate():
    file=b.HERE/'constructor-trace-07297620-v2.json'
    profile=json.loads(file.read_text())
    if profile['planId']!='constructor-trace-07297620-v2' or set(profile)!=set(b.PROFILE):raise ValueError('successor profile')
    for name,value in b.PROFILE.items():
        if name not in ('planId','approved','auditSha256') and profile[name]!=value:raise ValueError('successor changed device or image')
    b.PROFILE=profile;b.PROFILE_FILE=file;b.ENTRY_FILE=Path(__file__).resolve()
    b.JOURNAL_RELATIVE='.cashucard/constructor-trace-07297620-2026-11-05/pass-2/diagnostic.json'


if __name__=='__main__':
    try:activate();b.main()
    except Exception as error:b.common.emit(b.common.failure_message(error));sys.exit(1)
