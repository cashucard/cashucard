import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync, sign} from 'node:crypto';
import {
  canonicalFedimintResetPayload,
  verifyFedimintResetProof,
  type FedimintResetPayload,
} from '../src/fedimint-reset-proof';
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const pin = Buffer.from(
  publicKey.export({format: 'jwk'}).x!,
  'base64url',
).toString('hex');
const target = {
  target_origin: 'https://cashu.example',
  attempt_id: '01234567-1234-4123-8123-012345678901',
  revision: 2,
  chip_id: 'cplc-v1:0123456789abcdef00010002',
  target_bound_at: 1790000000,
  source_origin: 'https://fedimint.example',
  short_id: '01234567',
  operator_id: 7,
};
const trust = {
  source_origin: target.source_origin,
  target_origin: target.target_origin,
  public_key_hex: pin,
};
const verified = (target.target_bound_at + 5) * 1000 + 2;
const received = verified + 3;
const observed = received + 7;
const payload: FedimintResetPayload = {
  purpose: 'cashu-card/fedimint-reset-reissue/v1',
  ...target,
  gp_key_version: 1,
  manager_keys: 'factory',
  package: 'absent',
  verified_at_ms: verified,
  completed_at_ms: received,
  cashu_select_sw: '6a82',
  fedimint_select_sw: '6a82',
  observed_at_ms: observed,
  setup_journal_sha256: '89'.repeat(32),
  source_snapshot_sha256: '67'.repeat(32),
  source_snapshot_created_at_ms: received,
};
test('the verifier accepts only the exact signed message from the independently configured source for this service', () => {
  const signature_hex = sign(
    null,
    Buffer.from(canonicalFedimintResetPayload(payload)),
    privateKey,
  ).toString('hex');
  const proof = {payload, signature_hex};
  assert.deepEqual(verifyFedimintResetProof(proof, trust), payload);
  assert.throws(() =>
    verifyFedimintResetProof(
      {...proof, payload: {...payload, revision: 3}},
      trust,
    ),
  );
  assert.throws(() =>
    verifyFedimintResetProof(
      {...proof, payload: {...payload, private_data: 'extra'}},
      trust,
    ),
  );
  assert.throws(() =>
    verifyFedimintResetProof({...proof, purpose: payload.purpose}, trust),
  );
  assert.throws(() =>
    verifyFedimintResetProof(proof, {
      ...trust,
      source_origin: 'https://other.example',
    }),
  );
  assert.throws(() =>
    verifyFedimintResetProof(proof, {
      ...trust,
      target_origin: 'https://other.example',
    }),
  );
  assert.throws(() =>
    verifyFedimintResetProof(proof, {
      ...trust,
      public_key_hex: '11'.repeat(32),
    }),
  );
  assert.throws(() =>
    verifyFedimintResetProof({...proof, signature_hex: '00'.repeat(64)}, trust),
  );
});
test('the same signed bytes are reconstructed regardless of input object ordering', () => {
  const reversed = Object.fromEntries(
    Object.entries(payload).reverse(),
  ) as unknown as FedimintResetPayload;
  assert.equal(
    canonicalFedimintResetPayload(reversed),
    canonicalFedimintResetPayload(payload),
  );
});
