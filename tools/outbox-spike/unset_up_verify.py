"""Decode newly saved public recovery evidence independently; no PC/SC imports."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unset_up_bridge import private_json
import unset_up_policy as p


def verify(value):
    if value['plan'] != p.PROFILE['planId'] or value['chip'] != p.PROFILE['chip'] or value['cardKey'] != p.PROFILE['key']:
        raise ValueError('identity')
    if value['status'] != 'running' or value['blankBaselineVerified'] is not False or value['registryBlankVerified'] is not True:
        raise ValueError('premature outcome')
    if value['deleted'] != p.PROFILE['deletionAids']:
        raise ValueError('deletion sequence')
    policy = p.UnsetUpPolicy()
    policy.index = p.STAGES.index(('diag', 0))
    policy.before(list(p.DIAG))
    if not policy.after(p.DIAG, bytes.fromhex(value['diagnostics']), 0x90, 0):
        raise ValueError('diagnostics')
    snapshots = value['registrySnapshots']
    if [s['name'] for s in snapshots] != ['before-recovery', 'before-delete', 'verify-blank']:
        raise ValueError('snapshots')
    for phase, snapshot in enumerate(snapshots):
        if snapshot['verified'] is not True or any(row['kind'] not in ('applications', 'load-files') for row in snapshot['pages']):
            raise ValueError('registry kinds')
        for kind in ('applications', 'load-files'):
            rows = [row for row in snapshot['pages'] if row['kind'] == kind]
            if not 1 <= len(rows) <= 4:
                raise ValueError('incomplete registry')
            raw = bytearray()
            for index, row in enumerate(rows):
                data = bytes.fromhex(row['data'])
                if len(data) > 255:
                    raise ValueError('registry page size')
                if index < len(rows)-1:
                    if row['sw'] != '6310' or not data:
                        raise ValueError('registry continuation')
                elif row['sw'] != '9000' and not (index == 0 and row['sw'] == '6a88' and not data):
                    raise ValueError('registry status')
                raw.extend(data)
            got = p.frames(bytes(raw))
            want = ([] if kind == 'applications' else p.BASELINE) if phase == 2 else p.EXPECTED[kind]
            if len(got) != len(want) or len(set(got)) != len(got) or set(got) != set(want):
                raise ValueError('registry mismatch')
    exchanges = value['exchanges']
    if not 24 <= value['commands'] <= 42 or len(exchanges) != value['commands'] or any(e['command'] != i+1 for i, e in enumerate(exchanges)):
        raise ValueError('command receipts')
    if any('data' in e for e in exchanges if e['header'][:4] in ('8050', '8482')):
        raise ValueError('authentication receipt')
    final = [e for e in exchanges if e['stage'] == 'final-match-chip']
    if len(final) != 2 or any(e['sw'] != '9000' for e in final) or final[1]['header'] != '80ca9f7f' or final[1]['data'] != p.PROFILE['cplc']:
        raise ValueError('final identity')
    return {'savedEvidenceVerified': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--journal', required=True)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    try:
        if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
            raise ValueError('isolated Python required')
        print(json.dumps(verify(private_json(args.journal, args.sha256))))
    except Exception:
        print(json.dumps({'error': 'saved-evidence-refused'}))
        sys.exit(1)
