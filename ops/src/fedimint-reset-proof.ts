/** Shared wire format for a custodian's offline attestation. Trust is deployment configuration. */
import {ed25519} from '@noble/curves/ed25519';

export const FEDIMINT_RESET_PURPOSE = 'cashu-card/fedimint-reset-reissue/v1';
export interface FedimintResetTrust {
  target_origin: string;
  source_origin: string;
  public_key_hex: string;
}
export interface FedimintResetTarget {
  target_origin: string;
  attempt_id: string;
  revision: number;
  chip_id: string;
  target_bound_at: number; // Cashu Ops stores whole Unix seconds.
  source_origin: string;
  short_id: string; // Fedimint slot-0 key suffix, not a Cashu installation key.
  operator_id: number; // Fedimint source operator.
}
export interface FedimintResetPayload extends FedimintResetTarget {
  purpose: typeof FEDIMINT_RESET_PURPOSE;
  gp_key_version: 1;
  manager_keys: 'factory';
  package: 'absent'; // Fedimint's retained package-removal record.
  verified_at_ms: number;
  completed_at_ms: number;
  cashu_select_sw: '6a82';
  fedimint_select_sw: '6a82';
  observed_at_ms: number;
  setup_journal_sha256: string;
  source_snapshot_sha256: string;
  source_snapshot_created_at_ms: number;
}
export interface FedimintResetProof {
  payload: FedimintResetPayload;
  signature_hex: string;
}
function bad(): never {
  throw new Error('Invalid Fedimint reset attestation');
}
const targetFields = [
  'target_origin',
  'attempt_id',
  'revision',
  'chip_id',
  'target_bound_at',
  'source_origin',
  'short_id',
  'operator_id',
] as const;
const signedFields = [
  'purpose',
  ...targetFields,
  'gp_key_version',
  'manager_keys',
  'package',
  'verified_at_ms',
  'completed_at_ms',
  'cashu_select_sw',
  'fedimint_select_sw',
  'observed_at_ms',
  'setup_journal_sha256',
  'source_snapshot_sha256',
  'source_snapshot_created_at_ms',
] as const;

function fields(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some(k => !Object.prototype.hasOwnProperty.call(v, k))
  )
    bad();
  return v as Record<string, unknown>;
}
const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
function origin(s: unknown): boolean {
  if (typeof s !== 'string' || s.length > 256) return false;
  try {
    const u = new URL(s);
    return (
      u.origin === s &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && u.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}
function targetValues(v: Record<string, unknown>): void {
  if (
    !origin(v.target_origin) ||
    !origin(v.source_origin) ||
    v.target_origin === v.source_origin ||
    typeof v.attempt_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      v.attempt_id,
    ) ||
    typeof v.chip_id !== 'string' ||
    !/^cplc-v1:[0-9a-f]{24}$/.test(v.chip_id) ||
    typeof v.short_id !== 'string' ||
    !/^[0-9a-f]{8}$/.test(v.short_id) ||
    !positive(v.revision) ||
    !positive(v.operator_id) ||
    !positive(v.target_bound_at)
  )
    bad();
}
export function assertFedimintResetTarget(
  v: unknown,
): asserts v is FedimintResetTarget {
  targetValues(fields(v, targetFields));
}
function assertPayload(v: unknown): asserts v is FedimintResetPayload {
  const p = fields(v, signedFields);
  targetValues(p);
  if (
    p.purpose !== FEDIMINT_RESET_PURPOSE ||
    p.gp_key_version !== 1 ||
    p.manager_keys !== 'factory' ||
    p.package !== 'absent' ||
    p.cashu_select_sw !== '6a82' ||
    p.fedimint_select_sw !== '6a82' ||
    !positive(p.verified_at_ms) ||
    !positive(p.completed_at_ms) ||
    !positive(p.observed_at_ms) ||
    typeof p.setup_journal_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(p.setup_journal_sha256) ||
    typeof p.source_snapshot_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(p.source_snapshot_sha256) ||
    !positive(p.source_snapshot_created_at_ms) ||
    // A whole-second binding must unambiguously precede the source event.
    (p.target_bound_at as number) >= Math.floor(p.verified_at_ms / 1000) ||
    p.verified_at_ms > p.completed_at_ms ||
    p.completed_at_ms > p.source_snapshot_created_at_ms ||
    p.source_snapshot_created_at_ms > p.observed_at_ms
  )
    bad();
}
/** The signed bytes are UTF-8 of this ordered compact JSON, including its purpose. */
export function canonicalFedimintResetPayload(
  payload: FedimintResetPayload,
): string {
  assertPayload(payload);
  return JSON.stringify(
    Object.fromEntries(signedFields.map(k => [k, payload[k]])),
  );
}
/** Check origin pins and strict Ed25519. The caller applies its own clock and database gates. */
export function verifyFedimintResetProof(
  value: unknown,
  trust: FedimintResetTrust,
): FedimintResetPayload {
  const p = fields(value, ['payload', 'signature_hex']);
  assertPayload(p.payload);
  if (
    !trust ||
    typeof trust.public_key_hex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(trust.public_key_hex) ||
    trust.source_origin !== p.payload.source_origin ||
    trust.target_origin !== p.payload.target_origin ||
    typeof p.signature_hex !== 'string' ||
    !/^[0-9a-f]{128}$/.test(p.signature_hex)
  )
    bad();
  if (
    !ed25519.verify(
      p.signature_hex,
      new TextEncoder().encode(canonicalFedimintResetPayload(p.payload)),
      trust.public_key_hex,
      {zip215: false},
    )
  )
    bad();
  return p.payload;
}
