/** Durable mobile reset coordinator. No PINs, proofs, tokens or keys on disk. */
import {
  cleanupSettledEntries,
  fromHex,
  resetOwnedCard,
  readResetReview,
  TransportError,
  type CleanupEvidence,
  type CleanupOptions,
  type ResetReview,
  type ResetResult,
  type ResetOptions,
  type Transceiver,
  type Random,
} from './cardkit';
import type {JournalScope, JournalStorage} from './journal';
import {
  loadResetJournal,
  writeResetJournal,
  type ResetJournal,
} from './resetJournal';

export interface ResetRequest {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  installation_id: string;
  consent: {erase_owner_and_proofs: true; value_handled: true};
  inspection: {
    unspent: 0;
    spent: 0;
    tag_present: true;
    has_owner: boolean;
    pin_present: boolean;
    record_present: boolean;
  };
}
export interface ResetReceipt {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  installation_id: string;
  operator_id: number;
  device_id: string;
  authorized_at: number;
}
export interface ResetCompletion {
  reset_id: string;
  source_attempt_id: string;
  chip_id: string;
  removed_installation_id: string;
  gp_key_version: number;
  manager_keys: 'factory';
  cashu_package: 'absent';
  verified_at: number;
}
export interface ResetDone {
  reset_id: string;
  chip_id: string;
  removed_installation_id: string;
  operator_id: number;
  device_id: string;
  completed_at: number;
  manager_keys: 'factory';
  cashu_package: 'absent';
}
export interface ResetLookup {
  can_reset: boolean;
  lookup: {status: string; source?: {attemptId: string; keySourceRef: string}};
}
export interface OwnedResetService {
  scope: Omit<JournalScope, 'device_id'>;
  lookup(chipId: string, installationId: string): Promise<ResetLookup>;
  authorize(deviceId: string, request: ResetRequest): Promise<ResetReceipt>;
  keys(
    deviceId: string,
    resetId: string,
  ): Promise<{
    reset_id: string;
    chip_id: string;
    installation_id: string;
    enc: string;
    mac: string;
    dek: string;
  }>;
  complete(
    deviceId: string,
    resetId: string,
    record: ResetCompletion,
  ): Promise<ResetDone>;
}
export interface OwnedResetState {
  schema: 1;
  journal: ResetJournal;
  review: ResetReview;
  cleanup: CleanupEvidence | null;
}
/** Explicit public allowlist, never a dump of an API response or exception. */
export function resetRecoveryDetails(s: OwnedResetState): string {
  const j = s.journal;
  return JSON.stringify(
    {
      format: 'cashu-reset-recovery-v1',
      service_origin: j.service_origin,
      operator_id: j.operator_id,
      device_id: j.device_id,
      key_env: j.key_env,
      reset_id: j.reset_id,
      source_attempt_id: j.source_attempt_id,
      chip_id: j.chip_id,
      removed_installation_id: j.installation_id,
      stage: j.stage,
      cleanup: s.cleanup
        ? {spent: s.cleanup.spent, proof_digest: s.cleanup.proofDigest}
        : null,
      factory_verification: j.factory_evidence ?? null,
      service_intent_saved: !!j.service_intent_receipt,
      completion_saved: !!j.reconciliation_receipt,
    },
    null,
    2,
  );
}
export interface OwnedResetRun {
  withCard<T>(run: (tx: Transceiver) => Promise<T>): Promise<T>;
  random: Random;
  now(): number;
  canContinue(): boolean;
  pin?: string;
  mintJson?: CleanupOptions['mintJson'];
  onPhase?(phase: string): void;
  /** Test seam; actual device uses cardkit's reviewed engine. */
  runReset?: (tx: Transceiver, options: ResetOptions) => Promise<ResetResult>;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function check(v: unknown): asserts v {
  if (!v) {
    throw new Error('Saved reset requires reconciliation');
  }
}
function fields(
  v: unknown,
  keys: string[],
): asserts v is Record<string, unknown> {
  check(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).sort().join(',') === keys.sort().join(','),
  );
}
const REVIEW = [
  'chipId',
  'installationId',
  'unspent',
  'spent',
  'owner',
  'pin',
  'pinBlocked',
  'tries',
  'locked',
  'record',
  'tag',
  'sealed',
  'mint',
  'recordDigest',
];
function validateReview(r: ResetReview) {
  fields(r, REVIEW);
  check(
    /^cplc-v1:[0-9a-f]{24}$/.test(r.chipId) &&
      /^0[23][0-9a-f]{64}$/.test(r.installationId) &&
      /^[0-9a-f]{64}$/.test(r.recordDigest),
  );
  check(
    [r.unspent, r.spent].every(
      n => Number.isInteger(n) && n >= 0 && n <= 128,
    ) && r.unspent + r.spent <= 128,
  );
  check(
    Number.isInteger(r.tries) &&
      r.tries >= 0 &&
      r.tries <= 3 &&
      typeof r.mint === 'string' &&
      r.mint.length <= 77,
  );
  check(
    ['owner', 'pin', 'pinBlocked', 'locked', 'record', 'tag', 'sealed'].every(
      k => typeof r[k as keyof ResetReview] === 'boolean',
    ),
  );
}
function request(s: OwnedResetState): ResetRequest {
  check(
    s.review.unspent === 0 &&
      s.review.spent === 0 &&
      s.review.tag &&
      !s.review.locked &&
      !s.review.pinBlocked,
  );
  const j = s.journal;
  return {
    reset_id: j.reset_id,
    source_attempt_id: j.source_attempt_id,
    chip_id: j.chip_id,
    installation_id: j.installation_id,
    consent: {...j.consent},
    inspection: {
      unspent: 0,
      spent: 0,
      tag_present: true,
      has_owner: s.review.owner,
      pin_present: s.review.pin,
      record_present: s.review.record,
    },
  };
}
function receipt(r: ResetReceipt, j: ResetJournal) {
  fields(r, [
    'reset_id',
    'source_attempt_id',
    'chip_id',
    'installation_id',
    'operator_id',
    'device_id',
    'authorized_at',
  ]);
  check(
    r.reset_id === j.reset_id &&
      r.source_attempt_id === j.source_attempt_id &&
      r.chip_id === j.chip_id &&
      r.installation_id === j.installation_id &&
      r.operator_id === j.operator_id &&
      r.device_id === j.device_id &&
      Number.isSafeInteger(r.authorized_at) &&
      r.authorized_at >= 0,
  );
}
function done(r: ResetDone, j: ResetJournal) {
  fields(r, [
    'reset_id',
    'chip_id',
    'removed_installation_id',
    'operator_id',
    'device_id',
    'completed_at',
    'manager_keys',
    'cashu_package',
  ]);
  check(
    r.reset_id === j.reset_id &&
      r.chip_id === j.chip_id &&
      r.removed_installation_id === j.installation_id &&
      r.operator_id === j.operator_id &&
      r.device_id === j.device_id &&
      r.manager_keys === 'factory' &&
      r.cashu_package === 'absent' &&
      Number.isSafeInteger(r.completed_at) &&
      r.completed_at >= 0,
  );
}
export class OwnedResetWorkflow {
  private state: OwnedResetState | null = null;
  private failed = false;
  private running = false;
  private constructor(private storage: JournalStorage) {}
  static async open(storage: JournalStorage): Promise<OwnedResetWorkflow> {
    const w = new OwnedResetWorkflow(storage),
      raw = await storage.read();
    if (raw !== null) {
      const s = JSON.parse(raw) as OwnedResetState;
      fields(s, ['schema', 'journal', 'review', 'cleanup']);
      check(s.schema === 1);
      const j = await loadResetJournal({
        read: async () => JSON.stringify(s.journal),
        replace: async () => {},
      });
      check(j);
      validateReview(s.review);
      check(
        j.service_origin === j.source_origin &&
          j.chip_id === s.review.chipId &&
          j.installation_id === s.review.installationId,
      );
      if (s.cleanup !== null) {
        fields(s.cleanup, ['chipId', 'installationId', 'spent', 'proofDigest']);
        check(
          s.cleanup.chipId === j.chip_id &&
            s.cleanup.installationId === j.installation_id &&
            Number.isInteger(s.cleanup.spent) &&
            s.cleanup.spent > 0 &&
            s.cleanup.spent <= 128 &&
            /^[0-9a-f]{64}$/.test(s.cleanup.proofDigest),
        );
      }
      if (j.service_intent_receipt) {
        receipt(JSON.parse(j.service_intent_receipt), j);
      }
      if (j.reconciliation_receipt) {
        done(JSON.parse(j.reconciliation_receipt), j);
      }
      if (j.stage !== 'reviewed') {
        request(s);
      }
      w.state = clone(s);
    }
    return w;
  }
  snapshot(): OwnedResetState | null {
    check(!this.failed);
    return clone(this.state);
  }
  private async save(s: OwnedResetState) {
    try {
      await this.storage.replace(JSON.stringify(s));
      this.state = clone(s);
    } catch {
      this.failed = true;
      throw new Error('Reset recovery could not be saved');
    }
  }
  private actor(service: OwnedResetService) {
    const j = this.snapshot()?.journal;
    check(j);
    check(
      j.operator_id === service.scope.operator_id &&
        j.key_env === service.scope.key_env &&
        j.service_origin === service.scope.service_origin,
    );
    return j;
  }
  async begin(
    service: OwnedResetService,
    deviceId: string,
    resetId: string,
    observed: ResetReview,
    consent: {erase: boolean; valueHandled: boolean},
  ) {
    check(
      !this.running && (!this.state || this.state.journal.stage === 'complete'),
    );
    const review = clone(observed);
    validateReview(review);
    check(
      consent.erase &&
        consent.valueHandled &&
        review.unspent === 0 &&
        !review.locked &&
        !review.pinBlocked &&
        review.tag,
    );
    this.running = true;
    try {
      const lookup = await service.lookup(review.chipId, review.installationId);
      check(
        lookup.can_reset === true &&
          lookup.lookup.status === 'found' &&
          lookup.lookup.source,
      );
      const source = lookup.lookup.source;
      check(source.keySourceRef === `escrow:${source.attemptId}`);
      const journal: ResetJournal = {
        schema: 1,
        stage: 'reviewed',
        ...service.scope,
        device_id: deviceId,
        reset_id: resetId,
        chip_id: review.chipId,
        installation_id: review.installationId,
        source_origin: service.scope.service_origin,
        source_attempt_id: source.attemptId,
        consent: {erase_owner_and_proofs: true, value_handled: true},
      };
      await writeResetJournal(
        {read: async () => null, replace: async () => {}},
        journal,
      );
      await this.save({schema: 1, journal, review, cleanup: null});
    } finally {
      this.running = false;
    }
  }
  async continue(
    service: OwnedResetService,
    options: OwnedResetRun,
  ): Promise<'prepared' | 'complete' | 'stopped'> {
    check(!this.running);
    this.actor(service);
    this.running = true;
    const active = () => {
      if (!options.canContinue()) {
        throw new TransportError('Reset cancelled');
      }
    };
    try {
      let s = this.snapshot()!;
      active();
      if (s.journal.stage === 'complete') {
        return 'complete';
      }
      check(s.journal.stage !== 'stopped');
      if (s.review.spent > 0) {
        const lookup = await service.lookup(
          s.review.chipId,
          s.review.installationId,
        );
        active();
        check(
          lookup.can_reset &&
            lookup.lookup.status === 'found' &&
            lookup.lookup.source?.attemptId === s.journal.source_attempt_id,
        );
        check(options.mintJson);
        options.onPhase?.('Checking settlement and clearing spent entries');
        const review = await options.withCard(tx =>
          cleanupSettledEntries(
            async a => {
              active();
              const r = await tx(a);
              active();
              return r;
            },
            s.review,
            {
              pin: options.pin ?? '',
              random: options.random,
              resumePartial: s.cleanup !== null,
              mintJson: options.mintJson!,
              persist: async evidence => {
                active();
                s = {...s, cleanup: evidence};
                await this.save(s);
                active();
              },
            },
          ),
        );
        active();
        await this.save({...s, review});
        return 'prepared';
      }
      const j = s.journal;
      if (j.stage === 'factory_verified') {
        await this.complete(service);
        return 'complete'; // No card/key fetch for a lost completion reply.
      }
      active();
      const authorized = await service.authorize(j.device_id, request(s));
      active();
      receipt(authorized, j);
      if (j.service_intent_receipt) {
        check(JSON.stringify(authorized) === j.service_intent_receipt);
      }
      const keys = await service.keys(j.device_id, j.reset_id);
      active();
      fields(keys, [
        'reset_id',
        'chip_id',
        'installation_id',
        'enc',
        'mac',
        'dek',
      ]);
      check(
        keys.reset_id === j.reset_id &&
          keys.chip_id === j.chip_id &&
          keys.installation_id === j.installation_id &&
          [keys.enc, keys.mac, keys.dek].every(
            k => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k),
          ),
      );
      const assigned = {
        enc: fromHex(keys.enc),
        mac: fromHex(keys.mac),
        dek: fromHex(keys.dek),
      };
      options.onPhase?.(
        'Removing the old installation and restoring manager keys',
      );
      try {
        const result = await options.withCard(async tx => {
          const guarded: Transceiver = async a => {
            active();
            const r = await tx(a);
            active();
            return r;
          };
          if (j.stage === 'reviewed' && !options.runReset) {
            const fresh = await readResetReview(guarded);
            check(
              Object.keys(s.review)
                .filter(k => k !== 'tries')
                .every(
                  k =>
                    s.review[k as keyof ResetReview] ===
                    fresh[k as keyof ResetReview],
                ),
            );
          }
          return (options.runReset ?? resetOwnedCard)(guarded, {
            random: options.random,
            now: () => options.now() * 1000,
            keys: assigned,
            stage: j.stage as ResetOptions['stage'],
            authority: {
              chipId: j.chip_id,
              installationId: j.installation_id,
              sourceRef: `escrow:${j.source_attempt_id}`,
              intentReceipt: JSON.stringify(authorized),
              eraseOwnerAndProofs: true,
              valueHandled: true,
            },
            persist: async (stage, evidence) => {
              active();
              const current = this.snapshot()!;
              const next: ResetJournal = {
                ...current.journal,
                stage,
                service_intent_receipt: JSON.stringify(authorized),
                ...(stage === 'factory_verified'
                  ? {
                      factory_evidence: {
                        gp_key_version: evidence!.keyVersion,
                        verified_at: options.now(),
                      },
                    }
                  : {}),
              };
              await writeResetJournal(
                {
                  read: async () => JSON.stringify(current.journal),
                  replace: async () => {},
                },
                next,
              );
              await this.save({...current, journal: next});
              active();
            },
          });
        });
        active();
        if (!result.ok) {
          return 'stopped';
        }
        check(this.snapshot()!.journal.stage === 'factory_verified');
      } finally {
        assigned.enc.fill(0);
        assigned.mac.fill(0);
        assigned.dek.fill(0);
      }
      await this.complete(service);
      return 'complete';
    } finally {
      this.running = false;
    }
  }
  private async complete(service: OwnedResetService) {
    const s = this.snapshot()!,
      j = s.journal,
      e = j.factory_evidence;
    check(j.stage === 'factory_verified' && e);
    const record: ResetCompletion = {
      reset_id: j.reset_id,
      source_attempt_id: j.source_attempt_id,
      chip_id: j.chip_id,
      removed_installation_id: j.installation_id,
      gp_key_version: e.gp_key_version,
      manager_keys: 'factory',
      cashu_package: 'absent',
      verified_at: e.verified_at,
    };
    const r = await service.complete(j.device_id, j.reset_id, record);
    done(r, j);
    const next: ResetJournal = {
      ...j,
      stage: 'complete',
      reconciliation_receipt: JSON.stringify(r),
    };
    await writeResetJournal(
      {read: async () => JSON.stringify(j), replace: async () => {}},
      next,
    );
    await this.save({...s, journal: next});
  }
}
