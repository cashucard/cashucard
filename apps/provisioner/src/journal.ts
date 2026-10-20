/** Nonsecret recovery state. One owner must serialize access to the storage key.
 * A storage adapter must atomically replace one value and resolve only after
 * commit. This module does not claim native power-loss durability.
 */
export interface JournalStorage {
  read(): Promise<string | null>;
  replace(value: string): Promise<void>;
}
export interface JournalScope {
  service_origin: string;
  operator_id: number;
  device_id: string;
  key_env: 'factory' | 'issued';
}
export interface AttemptIdentity {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  load_sha256: string;
}
export type Stage =
  | 'reserved'
  | 'install_intent'
  | 'installed'
  | 'rotation_intent'
  | 'rotated'
  | 'record_pending'
  | 'recorded'
  | 'quarantined';
export interface CompletionRecord
  extends Omit<JournalScope, 'service_origin'>,
    AttemptIdentity {
  chip_id: string;
  installation_id: string;
  display_id: string;
  gp_key_version: number;
  key_env: 'factory' | 'issued';
  configuration_revision: 1;
  verified_stage: 'rotated';
  verified_at: number;
}
export interface DispositionIntent {
  kind: 'quarantined' | 'abandoned';
  reason: string;
  revision: number;
}
export interface DispositionReceipt {
  attempt_id: string;
  kind: 'quarantined' | 'abandoned';
  reason: string;
  revision: number;
  acknowledged_at: number;
}
export interface AttemptJournal extends JournalScope, AttemptIdentity {
  schema: 1;
  stage: Stage;
  chip_id?: string;
  preinstall?: {
    installation_id: string | null;
    replacement_consent: boolean;
    inspection: 'absent' | 'empty-2.1-with-tag';
  };
  installation_id?: string;
  installation_verified?: true;
  frozen_record?: string;
  completion_receipt?: string;
  quarantine_reason?: string;
  gp_key_version?: number;
  disposition_intent?: DispositionIntent;
  disposition_receipt?: string;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^(02|03)[0-9a-f]{64}$/;
const CHIP = /^cplc-v1:[0-9a-f]{24}$/;
const fields = new Set([
  'schema',
  'stage',
  'service_origin',
  'operator_id',
  'device_id',
  'attempt_id',
  'batch_id',
  'ordinal',
  'load_sha256',
  'chip_id',
  'preinstall',
  'installation_id',
  'installation_verified',
  'key_env',
  'frozen_record',
  'completion_receipt',
  'quarantine_reason',
  'gp_key_version',
  'disposition_intent',
  'disposition_receipt',
]);
const reasons = [
  'identity-mismatch',
  'authentication-failed',
  'unsafe-partial-install',
  'verification-failed',
  'reconciliation-required',
];
const stages: Stage[] = [
  'reserved',
  'install_intent',
  'installed',
  'rotation_intent',
  'rotated',
  'record_pending',
  'recorded',
  'quarantined',
];
function requireState(ok: unknown): asserts ok {
  if (!ok) {
    throw new Error('journal requires reconciliation');
  }
}
function sameScope(a: JournalScope, b: JournalScope): boolean {
  return (
    a.service_origin === b.service_origin &&
    a.operator_id === b.operator_id &&
    a.device_id === b.device_id &&
    a.key_env === b.key_env
  );
}
export function assertJournalScope(j: JournalScope): void {
  // RN 0.77's URL.origin/protocol getters throw; accept a constrained ASCII
  // origin without depending on the browser URL implementation used by Jest.
  const origin =
    /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::([1-9][0-9]{0,4}))?$/.exec(
      j.service_origin,
    );
  requireState(origin);
  const port = origin[3] === undefined ? undefined : Number(origin[3]);
  requireState(
    port === undefined ||
      (port <= 65535 &&
        !(origin[1] === 'http' && port === 80) &&
        !(origin[1] === 'https' && port === 443)),
  );
  requireState(
    Number.isSafeInteger(j.operator_id) &&
      j.operator_id > 0 &&
      ['factory', 'issued'].includes(j.key_env) &&
      UUID.test(j.device_id),
  );
}
function validate(j: AttemptJournal): void {
  requireState(j && typeof j === 'object' && !Array.isArray(j));
  requireState(Object.keys(j).every(k => fields.has(k)));
  requireState(j.schema === 1 && stages.includes(j.stage));
  assertJournalScope(j);
  requireState(
    Number.isSafeInteger(j.operator_id) &&
      j.operator_id > 0 &&
      ['factory', 'issued'].includes(j.key_env) &&
      UUID.test(j.device_id) &&
      UUID.test(j.attempt_id) &&
      Number.isSafeInteger(j.batch_id) &&
      j.batch_id > 0 &&
      Number.isSafeInteger(j.ordinal) &&
      j.ordinal >= 0 &&
      /^[0-9a-f]{64}$/.test(j.load_sha256),
  );
  if (j.chip_id !== undefined) {
    requireState(
      CHIP.test(j.chip_id) &&
        !['00000000', 'ffffffff'].includes(j.chip_id.slice(20, 28)),
    );
  }
  if (j.installation_id !== undefined) {
    requireState(KEY.test(j.installation_id));
  }
  if (j.preinstall !== undefined) {
    requireState(
      j.preinstall &&
        typeof j.preinstall === 'object' &&
        Object.keys(j.preinstall).sort().join(',') ===
          'inspection,installation_id,replacement_consent' &&
        j.preinstall.inspection ===
          (j.preinstall.installation_id === null
            ? 'absent'
            : 'empty-2.1-with-tag') &&
        typeof j.preinstall.replacement_consent === 'boolean' &&
        (j.preinstall.installation_id === null ||
          (KEY.test(j.preinstall.installation_id) &&
            j.preinstall.replacement_consent)),
    );
  }
  if (!['reserved', 'quarantined'].includes(j.stage)) {
    requireState(j.chip_id && j.preinstall);
  }
  if (
    [
      'installed',
      'rotation_intent',
      'rotated',
      'record_pending',
      'recorded',
    ].includes(j.stage)
  ) {
    requireState(
      j.installation_id &&
        j.installation_verified === true &&
        j.installation_id !== j.preinstall?.installation_id,
    );
  }
  if (['record_pending', 'recorded'].includes(j.stage)) {
    requireState(typeof j.frozen_record === 'string');
  }
  if (j.frozen_record !== undefined) {
    requireState(typeof j.frozen_record === 'string');
    validateRecord(JSON.parse(j.frozen_record!), j);
  }
  if (j.stage === 'recorded') {
    requireState(typeof j.completion_receipt === 'string');
  }
  if (j.completion_receipt !== undefined) {
    requireState(typeof j.completion_receipt === 'string');
    validateReceipt(JSON.parse(j.completion_receipt!), j);
  }
  if (
    ['rotated', 'record_pending', 'recorded'].includes(j.stage) ||
    j.gp_key_version !== undefined
  ) {
    requireState(
      Number.isInteger(j.gp_key_version) &&
        j.gp_key_version! >= 0 &&
        j.gp_key_version! <= 255,
    );
  }
  if (j.disposition_intent !== undefined) {
    const d = j.disposition_intent;
    requireState(
      j.stage === 'quarantined' &&
        d &&
        typeof d === 'object' &&
        Object.keys(d).sort().join(',') === 'kind,reason,revision' &&
        ['quarantined', 'abandoned'].includes(d.kind) &&
        d.reason === j.quarantine_reason &&
        Number.isSafeInteger(d.revision) &&
        d.revision >= 0,
    );
  }
  if (j.disposition_receipt !== undefined) {
    requireState(typeof j.disposition_receipt === 'string');
    validateDisposition(JSON.parse(j.disposition_receipt), j);
  }
  if (j.stage === 'reserved') {
    requireState(
      j.preinstall === undefined &&
        j.installation_id === undefined &&
        j.installation_verified === undefined,
    );
  }
  if (j.stage === 'install_intent') {
    requireState(
      j.installation_id === undefined && j.installation_verified === undefined,
    );
  }
  requireState(
    j.frozen_record === undefined ||
      ['record_pending', 'recorded', 'quarantined'].includes(j.stage),
  );
  requireState(j.completion_receipt === undefined || j.stage === 'recorded');
  requireState(j.quarantine_reason === undefined || j.stage === 'quarantined');
  if (j.stage === 'quarantined') {
    requireState(
      typeof j.quarantine_reason === 'string' &&
        reasons.includes(j.quarantine_reason),
    );
  }
}
function validateRecord(r: CompletionRecord, j: AttemptJournal): void {
  const keys = [
    'attempt_id',
    'batch_id',
    'ordinal',
    'load_sha256',
    'operator_id',
    'device_id',
    'chip_id',
    'installation_id',
    'display_id',
    'gp_key_version',
    'key_env',
    'configuration_revision',
    'verified_stage',
    'verified_at',
  ];
  // service_origin is local scope, never a field in the wire record.
  requireState(
    r &&
      typeof r === 'object' &&
      Object.keys(r).length === keys.length &&
      Object.keys(r).every(k => keys.includes(k)),
  );
  for (const k of [
    'attempt_id',
    'batch_id',
    'ordinal',
    'load_sha256',
    'operator_id',
    'device_id',
    'key_env',
    'chip_id',
    'installation_id',
  ] as const) {
    requireState(r[k] === j[k]);
  }
  requireState(
    r.display_id === j.installation_id?.slice(-4) &&
      Number.isInteger(r.gp_key_version) &&
      r.gp_key_version === j.gp_key_version &&
      r.gp_key_version >= 0 &&
      r.gp_key_version <= 255 &&
      ['factory', 'issued'].includes(r.key_env) &&
      r.configuration_revision === 1 &&
      r.verified_stage === 'rotated' &&
      Number.isSafeInteger(r.verified_at) &&
      r.verified_at >= 0,
  );
}
export interface CompletionReceipt {
  attempt_id: string;
  installation_id: string;
  revision: number;
  recorded_at: number;
  verified_stage: 'rotated';
  ready_for_holder: false;
}
function validateReceipt(r: CompletionReceipt, j: AttemptJournal): void {
  requireState(
    r &&
      typeof r === 'object' &&
      Object.keys(r).sort().join(',') ===
        'attempt_id,installation_id,ready_for_holder,recorded_at,revision,verified_stage' &&
      r.attempt_id === j.attempt_id &&
      r.installation_id === j.installation_id &&
      Number.isSafeInteger(r.revision) &&
      r.revision >= 0 &&
      Number.isSafeInteger(r.recorded_at) &&
      r.recorded_at >= 0 &&
      r.verified_stage === 'rotated' &&
      r.ready_for_holder === false,
  );
}

function validateDisposition(r: DispositionReceipt, j: AttemptJournal): void {
  requireState(
    j.stage === 'quarantined' &&
      j.disposition_intent &&
      r &&
      typeof r === 'object' &&
      Object.keys(r).sort().join(',') ===
        'acknowledged_at,attempt_id,kind,reason,revision' &&
      r.attempt_id === j.attempt_id &&
      r.kind === j.disposition_intent.kind &&
      r.reason === j.disposition_intent.reason &&
      r.revision === j.disposition_intent.revision + 1 &&
      Number.isSafeInteger(r.acknowledged_at) &&
      r.acknowledged_at >= 0,
  );
}

/** A single writer; failed writes poison this instance until it is reopened.
 * A rejected native commit may still have reached disk, so memory is no basis
 * for retrying a destructive operation after storage failure.
 */
export class ProvisioningJournal {
  private queue: Promise<unknown> = Promise.resolve();
  private failed = false;
  private constructor(
    private readonly storage: JournalStorage,
    private current: AttemptJournal,
  ) {}

  static async open(
    storage: JournalStorage,
    scope: JournalScope,
    initial?: AttemptIdentity,
  ): Promise<ProvisioningJournal> {
    const saved = await storage.read();
    if (saved !== null) {
      const j = JSON.parse(saved) as AttemptJournal;
      validate(j);
      requireState(sameScope(j, scope));
      // An existing journal always wins; never silently replace a pending attempt.
      if (initial) {
        requireState(
          initial.attempt_id === j.attempt_id &&
            initial.batch_id === j.batch_id &&
            initial.ordinal === j.ordinal &&
            initial.load_sha256 === j.load_sha256,
        );
      }
      return new ProvisioningJournal(storage, j);
    }
    requireState(initial);
    const j: AttemptJournal = {
      schema: 1,
      ...scope,
      ...initial,
      stage: 'reserved',
    };
    validate(j);
    await storage.replace(JSON.stringify(j));
    return new ProvisioningJournal(storage, j);
  }

  snapshot(): AttemptJournal {
    requireState(!this.failed);
    return JSON.parse(JSON.stringify(this.current)) as AttemptJournal;
  }

  private change(update: (j: AttemptJournal) => AttemptJournal): Promise<void> {
    const next = this.queue.then(async () => {
      requireState(!this.failed);
      const j = update(this.snapshot());
      validate(j);
      try {
        await this.storage.replace(JSON.stringify(j));
      } catch (e) {
        this.failed = true;
        throw e;
      }
      this.current = j;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  bind(chip_id: string): Promise<void> {
    return this.change(j => {
      requireState(
        j.stage === 'reserved' && (!j.chip_id || j.chip_id === chip_id),
      );
      return {...j, chip_id};
    });
  }

  /** Caller must have inspected absence, or an empty 2.1 applet and its tag. */
  installIntent(
    preinstall: Pick<
      NonNullable<AttemptJournal['preinstall']>,
      'installation_id' | 'replacement_consent'
    >,
  ): Promise<void> {
    const captured = {...preinstall};
    return this.change(j => {
      requireState(
        j.stage === 'reserved' &&
          j.chip_id &&
          (captured.installation_id === null || captured.replacement_consent),
      );
      return {
        ...j,
        stage: 'install_intent',
        preinstall: {
          ...captured,
          inspection:
            captured.installation_id === null ? 'absent' : 'empty-2.1-with-tag',
        },
      };
    });
  }

  /** Caller must complete all applet, tag and empty-card verification first. */
  installed(
    installation_id: string,
    verification: {complete: true},
  ): Promise<void> {
    return this.change(j => {
      requireState(
        verification.complete === true &&
          j.stage === 'install_intent' &&
          installation_id !== j.preinstall?.installation_id,
      );
      return {
        ...j,
        stage: 'installed',
        installation_id,
        installation_verified: true,
      };
    });
  }

  rotationIntent(): Promise<void> {
    return this.change(j => {
      requireState(j.stage === 'installed');
      return {...j, stage: 'rotation_intent'};
    });
  }

  rotated(gp_key_version: number): Promise<void> {
    return this.change(j => {
      requireState(j.stage === 'rotation_intent');
      return {...j, stage: 'rotated', gp_key_version};
    });
  }

  freezeRecord(record: CompletionRecord): Promise<void> {
    // Capture now, before a caller can change its object while the queue waits.
    const frozen_record = JSON.stringify(record);
    return this.change(j => {
      requireState(j.stage === 'rotated');
      return {...j, stage: 'record_pending', frozen_record};
    });
  }

  acknowledge(receipt: CompletionReceipt): Promise<void> {
    const completion_receipt = JSON.stringify(receipt);
    return this.change(j => {
      requireState(j.stage === 'record_pending');
      return {...j, stage: 'recorded', completion_receipt};
    });
  }

  beginDisposition(
    kind: DispositionIntent['kind'],
    revision: number,
  ): Promise<void> {
    return this.change(j => {
      requireState(j.stage === 'quarantined' && !j.disposition_receipt);
      if (j.disposition_intent) {
        requireState(j.disposition_intent.kind === kind);
        return j;
      }
      return {
        ...j,
        disposition_intent: {kind, revision, reason: j.quarantine_reason!},
      };
    });
  }

  acknowledgeDisposition(receipt: DispositionReceipt): Promise<void> {
    const disposition_receipt = JSON.stringify(receipt);
    return this.change(j => {
      validateDisposition(JSON.parse(disposition_receipt), j);
      if (j.disposition_receipt) {
        const old = JSON.parse(j.disposition_receipt) as DispositionReceipt;
        requireState(
          Object.entries(old).every(
            ([k, v]) =>
              (receipt as unknown as Record<string, unknown>)[k] === v,
          ),
        );
        return j;
      }
      return {...j, disposition_receipt};
    });
  }

  quarantine(reason: string): Promise<void> {
    return this.change(j => {
      requireState(j.stage !== 'recorded' && j.stage !== 'quarantined');
      // Use controlled reason codes, never error messages or APDU transcripts.
      requireState(reasons.includes(reason));
      return {...j, stage: 'quarantined', quarantine_reason: reason};
    });
  }
}

export type RecoveryAction =
  | 'inspect-install'
  | 'verify-installed'
  | 'recover-rotation'
  | 'verify-rotated'
  | 'replay-record'
  | 'show-receipt'
  | 'stop';
/** Pure policy: caller must read chip/key before invoking any authentication.
 * Inspecting a partial install never grants DELETE/LOAD authorization.
 */
export function recoveryAction(
  j: AttemptJournal,
  observed?: {chip_id: string; installation_id: string | null},
): RecoveryAction {
  validate(j);
  if (j.stage === 'recorded') {
    return 'show-receipt';
  }
  if (j.stage === 'record_pending') {
    return 'replay-record';
  }
  if (j.stage === 'quarantined') {
    return 'stop';
  }
  if (
    !observed ||
    (j.chip_id && j.chip_id !== observed.chip_id) ||
    (j.installation_id && j.installation_id !== observed.installation_id)
  ) {
    return 'stop';
  }
  if (j.stage === 'reserved' || j.stage === 'install_intent') {
    return 'inspect-install';
  }
  if (j.stage === 'installed') {
    return 'verify-installed';
  }
  if (j.stage === 'rotation_intent') {
    return 'recover-rotation';
  }
  return 'verify-rotated';
}
