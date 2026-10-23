/** Nonsecret, single-owner reset intent. Storage must commit before card work. */
import {
  assertJournalScope,
  type JournalScope,
  type JournalStorage,
} from './journal';

export type ResetStage =
  | 'reviewed'
  | 'delete_intent'
  | 'deletion_observed'
  | 'rotation_intent'
  | 'factory_verified'
  | 'complete'
  | 'stopped';

export interface ResetJournal extends JournalScope {
  schema: 1;
  stage: ResetStage;
  reset_id: string;
  chip_id: string;
  installation_id: string;
  source_origin: string;
  source_attempt_id: string;
  consent: {erase_owner_and_proofs: true; value_handled: true};
  service_intent_receipt?: string;
  factory_evidence?: {gp_key_version: number; verified_at: number};
  reconciliation_receipt?: string;
  stopped_reason?:
    | 'identity-mismatch'
    | 'source-missing'
    | 'inspection-uncertain'
    | 'card-refused'
    | 'operator-stopped';
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHIP = /^cplc-v1:[0-9a-f]{24}$/;
const KEY = /^0[23][0-9a-f]{64}$/;
const ORDER: ResetStage[] = [
  'reviewed',
  'delete_intent',
  'deletion_observed',
  'rotation_intent',
  'factory_verified',
  'complete',
];
const FIELDS = new Set([
  'schema',
  'stage',
  'service_origin',
  'operator_id',
  'device_id',
  'key_env',
  'reset_id',
  'chip_id',
  'installation_id',
  'source_origin',
  'source_attempt_id',
  'consent',
  'service_intent_receipt',
  'factory_evidence',
  'reconciliation_receipt',
  'stopped_reason',
]);
const BINDING: (keyof ResetJournal)[] = [
  'service_origin',
  'operator_id',
  'device_id',
  'key_env',
  'reset_id',
  'chip_id',
  'installation_id',
  'source_origin',
  'source_attempt_id',
];

function validate(value: unknown): ResetJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('reset journal requires reconciliation');
  }
  const j = value as ResetJournal;
  if (
    Object.keys(j).some(k => !FIELDS.has(k)) ||
    j.schema !== 1 ||
    (!ORDER.includes(j.stage) && j.stage !== 'stopped') ||
    !UUID.test(j.reset_id) ||
    !UUID.test(j.source_attempt_id) ||
    !CHIP.test(j.chip_id) ||
    ['00000000', 'ffffffff'].includes(j.chip_id.slice(20, 28)) ||
    !KEY.test(j.installation_id) ||
    !j.consent ||
    Object.keys(j.consent).sort().join(',') !==
      'erase_owner_and_proofs,value_handled' ||
    j.consent.erase_owner_and_proofs !== true ||
    j.consent.value_handled !== true
  ) {
    throw new Error('reset journal requires reconciliation');
  }
  assertJournalScope(j);
  assertJournalScope({...j, service_origin: j.source_origin});
  const evidence = j.factory_evidence;
  if (
    evidence !== undefined &&
    (!evidence ||
      Object.keys(evidence).sort().join(',') !== 'gp_key_version,verified_at' ||
      !Number.isInteger(evidence.gp_key_version) ||
      evidence.gp_key_version < 0 ||
      evidence.gp_key_version > 255 ||
      !Number.isSafeInteger(evidence.verified_at) ||
      evidence.verified_at < 0)
  ) {
    throw new Error('reset journal requires reconciliation');
  }
  if (
    ['factory_verified', 'complete'].includes(j.stage)
      ? !evidence
      : evidence !== undefined && j.stage !== 'stopped'
  ) {
    throw new Error('reset journal requires factory verification evidence');
  }
  if (
    j.service_intent_receipt !== undefined &&
    (typeof j.service_intent_receipt !== 'string' ||
      !j.service_intent_receipt ||
      j.service_intent_receipt.length > 4096)
  ) {
    throw new Error('reset journal requires reconciliation');
  }
  if (!['reviewed', 'stopped'].includes(j.stage) && !j.service_intent_receipt) {
    throw new Error('reset journal requires a service intent');
  }
  if (
    j.stage === 'complete'
      ? typeof j.reconciliation_receipt !== 'string' ||
        !j.reconciliation_receipt ||
        j.reconciliation_receipt.length > 4096
      : j.reconciliation_receipt !== undefined
  ) {
    throw new Error('reset journal requires reconciliation');
  }
  if (
    j.stage === 'stopped'
      ? ![
          'identity-mismatch',
          'source-missing',
          'inspection-uncertain',
          'card-refused',
          'operator-stopped',
        ].includes(j.stopped_reason!)
      : j.stopped_reason !== undefined
  ) {
    throw new Error('reset journal requires reconciliation');
  }
  return j;
}

export async function loadResetJournal(
  storage: JournalStorage,
): Promise<ResetJournal | null> {
  const raw = await storage.read();
  if (raw === null) {
    return null;
  }
  return validate(JSON.parse(raw));
}

/** One durable state transition. Same-state writes must be byte-identical. */
export async function writeResetJournal(
  storage: JournalStorage,
  next: ResetJournal,
): Promise<void> {
  validate(next);
  const previous = await loadResetJournal(storage);
  if (!previous) {
    if (next.stage !== 'reviewed') {
      throw new Error('reset must start with review');
    }
  } else {
    if (
      BINDING.some(k => previous[k] !== next[k]) ||
      previous.consent.erase_owner_and_proofs !==
        next.consent.erase_owner_and_proofs ||
      previous.consent.value_handled !== next.consent.value_handled ||
      (previous.service_intent_receipt !== undefined &&
        previous.service_intent_receipt !== next.service_intent_receipt) ||
      (previous.factory_evidence !== undefined &&
        JSON.stringify(previous.factory_evidence) !==
          JSON.stringify(next.factory_evidence))
    ) {
      throw new Error('reset identity or consent changed');
    }
    if (previous.stage === next.stage) {
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        throw new Error('reset state changed');
      }
      return;
    }
    if (
      previous.stage === 'complete' ||
      previous.stage === 'stopped' ||
      (next.stage !== 'stopped' &&
        ORDER.indexOf(next.stage) !== ORDER.indexOf(previous.stage) + 1)
    ) {
      throw new Error('reset requires reconciliation before advancing');
    }
  }
  await storage.replace(JSON.stringify(next));
}
