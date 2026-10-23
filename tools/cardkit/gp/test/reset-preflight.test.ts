import assert from 'node:assert/strict';
import test from 'node:test';
import {assessResetPreflight} from '../reset-preflight';

const chipId = 'cplc-v1:4790d3213041093363205547';
const installationId = '02' + '5a'.repeat(32);
const evidence = {
  chipId,
  installation: {
    state: 'present' as const,
    installationId,
    tagVerified: true,
    empty: false,
    publicState: {unspent: 0, spent: 0, owner: true, pin: true, record: false},
  },
  provenance: {chipId, installationId, keySourceRef: 'local-escrow:batch-1:0'},
  consent: {
    chipId,
    installationId,
    eraseOwnerAndProofs: true,
    valueHandled: true,
  },
};

test('known owned card with zero proof slots may enter an explicit reset review', () => {
  assert.deepEqual(assessResetPreflight(evidence), {ok: true});
});

test('every missing or mismatched authority stops before manager authentication', () => {
  const cases = [
    {...evidence, provenance: undefined},
    {...evidence, provenance: {...evidence.provenance, chipId: 'other'}},
    {
      ...evidence,
      provenance: {...evidence.provenance, installationId: 'other'},
    },
    {...evidence, provenance: {...evidence.provenance, keySourceRef: ''}},
    {...evidence, consent: undefined},
    {...evidence, consent: {...evidence.consent, chipId: 'other'}},
    {...evidence, consent: {...evidence.consent, installationId: 'other'}},
    {...evidence, consent: {...evidence.consent, eraseOwnerAndProofs: false}},
    {...evidence, consent: {...evidence.consent, valueHandled: false}},
    {...evidence, unresolvedAttempt: true},
    {...evidence, installation: {...evidence.installation, tagVerified: false}},
  ];
  for (const input of cases)
    assert.equal(assessResetPreflight(input).ok, false);
});

test('proofs, missing applet and a different installation all stop', () => {
  for (const publicState of [
    {...evidence.installation.publicState, unspent: 1},
    {...evidence.installation.publicState, spent: 1},
  ]) {
    assert.equal(
      assessResetPreflight({
        ...evidence,
        installation: {...evidence.installation, publicState},
      }).ok,
      false,
    );
  }
  assert.equal(
    assessResetPreflight({...evidence, installation: {state: 'absent'}}).ok,
    false,
  );
  assert.equal(
    assessResetPreflight({
      ...evidence,
      installation: {...evidence.installation, installationId: 'other'},
    }).ok,
    false,
  );
});
