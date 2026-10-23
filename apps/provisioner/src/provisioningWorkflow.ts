/** Batch requests, reservation replay and attempt journal share one commit.
 * Single coordinator; no NFC, tokens or manager keys are persisted here.
 */
import {randomUuid} from './random';
import {isPublicFailureContext, type PublicFailureContext} from './recoveryExport';
import {
  ProvisioningJournal,
  assertJournalScope,
  type AttemptJournal,
  type CompletionReceipt,
  type DispositionIntent,
  type DispositionReceipt,
  type JournalScope,
  type JournalStorage,
} from './journal';

export interface BatchSettings {
  count: number;
  mint_url: string;
  pin_policy: 'batch' | 'perCard';
  daily_usd: number;
  no_pin_usd: number;
  load_sha256: string;
}
export interface BatchRequest extends BatchSettings {
  batch_request_id: string;
  device_id: string;
}
export interface ReservedAttempt {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  operator_id: number;
  device_id: string;
  revision: number;
  state: 'active' | 'recorded' | 'quarantined' | 'abandoned';
  chip_id: string | null;
  completion_receipt: CompletionReceipt | null;
  disposition_receipt?: DispositionReceipt | null;
}
export interface RemoteBatch {
  batch_id: number;
  batch_request_id: string;
  operator_id: number;
  device_id: string;
  next_ordinal: number;
  config: BatchSettings & {
    key_env: 'factory' | 'issued';
    configuration_revision: 1;
  };
}
/** Session-bound transport. Tokens remain inside this adapter, never in state. */
export interface ReservationService {
  scope: Omit<JournalScope, 'device_id'>;
  batch(request: BatchRequest): Promise<RemoteBatch>;
  reserve(request: {
    device_id: string;
    attempt_id: string;
    batch_id: number;
    ordinal: number;
  }): Promise<ReservedAttempt>;
  attempt(device_id: string, attempt_id: string): Promise<ReservedAttempt>;
}
export interface IssuedAttemptKeys {
  attempt_id: string;
  batch_id: number;
  ordinal: number;
  chip_id: string | null;
  enc: string;
  mac: string;
  dek: string;
}
export interface CardProvisioningService extends ReservationService {
  bind(
    device_id: string,
    attempt_id: string,
    input: {revision: number; chip_id: string},
  ): Promise<{
    attempt_id: string;
    chip_id: string;
    revision: number;
    bound_at: number;
  }>;
  keys(device_id: string, attempt_id: string): Promise<IssuedAttemptKeys>;
  record(
    device_id: string,
    attempt_id: string,
    revision: number,
    frozen: string,
  ): Promise<CompletionReceipt>;
  disposition(
    device_id: string,
    attempt_id: string,
    intent: DispositionIntent,
  ): Promise<DispositionReceipt>;
}
function terminal(j: AttemptJournal): boolean {
  return (
    j.stage === 'recorded' ||
    (j.stage === 'quarantined' && !!j.disposition_receipt)
  );
}

interface BatchState {
  scope: JournalScope;
  request: BatchRequest;
  batch_id: number | null;
  next_ordinal: number;
}
interface PendingAttempt {
  attempt_id: string;
  ordinal: number;
  revision: number | null;
  journal: AttemptJournal | null;
}
export interface WorkflowSnapshot {
  schema: 2;
  device_id: string;
  batch: BatchState | null;
  active: PendingAttempt | null;
  history: AttemptJournal[];
  last_failure?: PublicFailureContext | null;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const settings = [
  'count',
  'mint_url',
  'pin_policy',
  'daily_usd',
  'no_pin_usd',
  'load_sha256',
] as const;
function check(ok: unknown): asserts ok {
  if (!ok) {
    throw new Error('provisioning requires reconciliation');
  }
}
const uint = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function exact(v: object, keys: readonly string[]): void {
  check(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      Object.keys(v).every(k => keys.includes(k)),
  );
}
function validateSettings(v: BatchSettings): void {
  check(
    v &&
      uint(v.count) &&
      v.count > 0 &&
      v.count <= 100000 &&
      typeof v.mint_url === 'string' &&
      /^https?:\/\/[^\s@#]+$/.test(v.mint_url) &&
      ['batch', 'perCard'].includes(v.pin_policy) &&
      Number.isFinite(v.daily_usd) &&
      v.daily_usd >= 0 &&
      Number.isFinite(v.no_pin_usd) &&
      v.no_pin_usd >= 0 &&
      /^[0-9a-f]{64}$/.test(v.load_sha256),
  );
}
function sameScope(a: JournalScope, b: JournalScope): boolean {
  return (
    a.service_origin === b.service_origin &&
    a.operator_id === b.operator_id &&
    a.device_id === b.device_id &&
    a.key_env === b.key_env
  );
}

export class ProvisioningWorkflow {
  private tail: Promise<unknown> = Promise.resolve();
  private failed = false;
  private constructor(
    private readonly storage: JournalStorage,
    private state: WorkflowSnapshot,
    private readonly uuid: () => string,
  ) {}

  static async open(
    storage: JournalStorage,
    uuid: () => string = randomUuid,
  ): Promise<ProvisioningWorkflow> {
    const raw = await storage.read(); // Failure never means a fresh installation.
    const state: WorkflowSnapshot =
      raw === null
        ? {
            schema: 2,
            device_id: uuid(),
            batch: null,
            active: null,
            history: [],
          }
        : JSON.parse(raw);
    const workflow = new ProvisioningWorkflow(storage, state, uuid);
    await workflow.validate(state);
    if (raw === null) {
      await workflow.commit(state);
    }
    return workflow;
  }

  snapshot(): WorkflowSnapshot {
    check(!this.failed);
    return clone(this.state);
  }

  private async validate(s: WorkflowSnapshot): Promise<void> {
    exact(s, [
      'schema', 'device_id', 'batch', 'active', 'history',
      ...(s && Object.prototype.hasOwnProperty.call(s, 'last_failure')
        ? ['last_failure']
        : []),
    ]);
    check(s.schema === 2 && UUID.test(s.device_id) && Array.isArray(s.history));
    if (s.last_failure !== undefined && s.last_failure !== null) {
      check(isPublicFailureContext(s.last_failure));
    }
    if (!s.batch) {
      check(s.active === null && s.history.length === 0);
      return;
    }
    const b = s.batch;
    exact(b, ['scope', 'request', 'batch_id', 'next_ordinal']);
    exact(b.scope, ['service_origin', 'operator_id', 'device_id', 'key_env']);
    assertJournalScope(b.scope);
    check(
      b.scope.device_id === s.device_id &&
        /^https?:\/\/[^\s/@?#]+$/.test(b.scope.service_origin) &&
        uint(b.scope.operator_id) &&
        b.scope.operator_id > 0 &&
        ['factory', 'issued'].includes(b.scope.key_env),
    );
    exact(b.request, [...settings, 'batch_request_id', 'device_id']);
    validateSettings(b.request);
    check(
      UUID.test(b.request.batch_request_id) &&
        b.request.device_id === s.device_id &&
        (b.batch_id === null || (uint(b.batch_id) && b.batch_id > 0)) &&
        uint(b.next_ordinal) &&
        b.next_ordinal <= b.request.count,
    );
    for (const j of [
      ...s.history,
      ...(s.active?.journal ? [s.active.journal] : []),
    ]) {
      await ProvisioningJournal.open(
        {
          read: async () => JSON.stringify(j),
          replace: async () => {
            throw new Error('read only');
          },
        },
        b.scope,
      );
      check(
        j.batch_id === b.batch_id && j.load_sha256 === b.request.load_sha256,
      );
    }
    check(s.history.length === b.next_ordinal);
    s.history.forEach((j, ordinal) =>
      check(terminal(j) && j.ordinal === ordinal),
    );
    check(new Set(s.history.map(j => j.attempt_id)).size === s.history.length);
    if (s.active) {
      exact(s.active, ['attempt_id', 'ordinal', 'revision', 'journal']);
      check(
        b.batch_id !== null &&
          UUID.test(s.active.attempt_id) &&
          s.active.ordinal === b.next_ordinal &&
          s.active.ordinal < b.request.count &&
          !s.history.some(j => j.attempt_id === s.active!.attempt_id) &&
          (s.active.revision === null || uint(s.active.revision)),
      );
      check((s.active.revision === null) === (s.active.journal === null));
      if (s.active.journal) {
        check(
          s.active.journal.attempt_id === s.active.attempt_id &&
            s.active.journal.ordinal === s.active.ordinal,
        );
      }
    }
  }

  private async commit(next: WorkflowSnapshot): Promise<void> {
    await this.validate(next);
    try {
      await this.storage.replace(JSON.stringify(next));
    } catch (e) {
      this.failed = true;
      throw e;
    }
    this.state = next;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(() => {
      check(!this.failed);
      return work();
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  private actor(service: ReservationService): BatchState {
    const b = this.state.batch;
    check(
      b &&
        sameScope(b.scope, {...service.scope, device_id: this.state.device_id}),
    );
    return b;
  }

  /** Persist only bounded public context; never a raw service error. */
  rememberFailure(context: PublicFailureContext): Promise<void> {
    return this.serial(async () => {
      check(isPublicFailureContext(context));
      await this.commit({...this.snapshot(), last_failure: context});
    });
  }

  /** Persist request identity and exact PIN-free settings before the first POST. */
  start(service: ReservationService, input: BatchSettings): Promise<void> {
    const captured = clone(input);
    return this.serial(async () => {
      check(this.state.batch === null);
      exact(captured, settings);
      validateSettings(captured);
      const next = this.snapshot();
      next.batch = {
        scope: {...service.scope, device_id: next.device_id},
        request: {
          ...captured,
          batch_request_id: this.uuid(),
          device_id: next.device_id,
        },
        batch_id: null,
        next_ordinal: 0,
      };
      await this.commit(next);
      await this.syncBatch(service);
    });
  }

  private async syncBatch(service: ReservationService): Promise<void> {
    const b = this.actor(service);
    const result = await service.batch(clone(b.request));
    check(
      result &&
        uint(result.batch_id) &&
        result.batch_id > 0 &&
        result.batch_request_id === b.request.batch_request_id &&
        result.operator_id === b.scope.operator_id &&
        result.device_id === b.scope.device_id &&
        result.config &&
        result.config.key_env === b.scope.key_env &&
        result.config.configuration_revision === 1 &&
        settings.every(k => result.config[k] === b.request[k]) &&
        uint(result.next_ordinal),
    );
    check(b.batch_id === null || b.batch_id === result.batch_id);
    const expectedNext = b.next_ordinal;
    check(
      result.next_ordinal === expectedNext ||
        (this.state.active && result.next_ordinal === expectedNext + 1),
    );
    const next = this.snapshot();
    next.batch!.batch_id = result.batch_id;
    await this.commit(next);
  }

  reconcile(service: ReservationService): Promise<void> {
    return this.serial(async () => {
      await this.syncBatch(service);
      if (this.state.active) {
        await this.syncAttempt(service);
      }
    });
  }

  reserveNext(service: ReservationService): Promise<void> {
    return this.serial(async () => {
      const b = this.actor(service);
      check(
        b.batch_id !== null &&
          !this.state.active &&
          b.next_ordinal < b.request.count,
      );
      const next = this.snapshot();
      next.active = {
        attempt_id: this.uuid(),
        ordinal: b.next_ordinal,
        revision: null,
        journal: null,
      };
      await this.commit(next); // Crash or lost POST response reuses this identity.
      await this.syncAttempt(service);
    });
  }

  private async syncAttempt(service: ReservationService): Promise<void> {
    const b = this.actor(service);
    const active = this.state.active;
    check(active && b.batch_id !== null);
    // Once acknowledged, a 404 is reconciliation, never permission to recreate.
    const remote =
      active.revision === null
        ? await service.reserve({
            device_id: this.state.device_id,
            attempt_id: active.attempt_id,
            batch_id: b.batch_id,
            ordinal: active.ordinal,
          })
        : await service.attempt(this.state.device_id, active.attempt_id);
    check(
      remote &&
        remote.attempt_id === active.attempt_id &&
        remote.batch_id === b.batch_id &&
        remote.ordinal === active.ordinal &&
        remote.operator_id === b.scope.operator_id &&
        remote.device_id === this.state.device_id &&
        uint(remote.revision) &&
        (active.revision === null || remote.revision >= active.revision),
    );
    check(
      ['active', 'recorded', 'quarantined', 'abandoned'].includes(remote.state),
    );
    let saved = active.journal;
    const journal = await ProvisioningJournal.open(
      {
        read: async () => (saved ? JSON.stringify(saved) : null),
        replace: async value => {
          saved = JSON.parse(value) as AttemptJournal;
        },
      },
      b.scope,
      {
        attempt_id: active.attempt_id,
        batch_id: b.batch_id,
        ordinal: active.ordinal,
        load_sha256: b.request.load_sha256,
      },
    );
    if (remote.chip_id !== null) {
      if (journal.snapshot().chip_id) {
        check(journal.snapshot().chip_id === remote.chip_id);
      } else {
        await journal.bind(remote.chip_id);
      }
    } else {
      check(!journal.snapshot().chip_id);
    }
    if (remote.state === 'quarantined' || remote.state === 'abandoned') {
      check(
        journal.snapshot().stage === 'quarantined' &&
          remote.disposition_receipt &&
          remote.disposition_receipt.kind === remote.state,
      );
      await journal.acknowledgeDisposition(remote.disposition_receipt);
    } else if (remote.state === 'recorded') {
      check(remote.completion_receipt);
      if (journal.snapshot().stage === 'record_pending') {
        await journal.acknowledge(remote.completion_receipt);
      }
      check(
        journal.snapshot().stage === 'recorded' &&
          Object.keys(remote.completion_receipt).length === 6 &&
          Object.entries(
            JSON.parse(journal.snapshot().completion_receipt!),
          ).every(
            ([k, v]) =>
              (remote.completion_receipt as unknown as Record<string, unknown>)[
                k
              ] === v,
          ),
      );
    } else {
      check(
        remote.completion_receipt === null &&
          journal.snapshot().stage !== 'recorded' &&
          !journal.snapshot().disposition_receipt,
      );
    }
    const next = this.snapshot();
    next.active = {
      ...active,
      revision: remote.revision,
      journal: journal.snapshot(),
    };
    await this.commit(next);
  }

  /** Serialized access to the same snapshot; intent commits precede callbacks'
   * dependent actions. The callback must not call workflow methods recursively.
   */
  withAttempt<T>(
    service: ReservationService,
    run: (journal: ProvisioningJournal) => Promise<T>,
  ): Promise<T> {
    return this.serial(async () => {
      const b = this.actor(service);
      check(this.state.active?.journal);
      const journal = await this.openActiveJournal(b.scope);
      return run(journal);
    });
  }

  private openActiveJournal(scope: JournalScope): Promise<ProvisioningJournal> {
    check(this.state.active?.journal);
    return ProvisioningJournal.open(
      {
        read: async () => JSON.stringify(this.state.active!.journal),
        replace: async value => {
          const next = this.snapshot();
          next.active!.journal = JSON.parse(value) as AttemptJournal;
          await this.commit(next);
        },
      },
      scope,
    );
  }

  private async archiveActive(): Promise<void> {
    const next = this.snapshot();
    check(next.active?.journal && terminal(next.active.journal));
    next.history.push(next.active.journal);
    next.batch!.next_ordinal++;
    next.active = null;
    await this.commit(next);
  }

  /** Explicit operator acknowledgement; durable intent precedes its POST. */
  acknowledgeQuarantine(
    service: ReservationService & Pick<CardProvisioningService, 'disposition'>,
    kind: DispositionIntent['kind'],
  ): Promise<void> {
    return this.serial(async () => {
      await this.syncBatch(service);
      await this.syncAttempt(service);
      const b = this.actor(service);
      const journal = await this.openActiveJournal(b.scope);
      if (journal.snapshot().disposition_receipt) {
        check(journal.snapshot().disposition_intent?.kind === kind);
      } else {
        await journal.beginDisposition(kind, this.state.active!.revision!);
        const receipt = await service.disposition(
          this.state.device_id,
          this.state.active!.attempt_id,
          journal.snapshot().disposition_intent!,
        );
        await journal.acknowledgeDisposition(receipt);
      }
      await this.archiveActive();
    });
  }

  /** Replay only the frozen body; a lost completion reply never needs NFC. */
  postRecord(
    service: ReservationService & Pick<CardProvisioningService, 'record'>,
  ): Promise<void> {
    return this.serial(async () => {
      await this.syncBatch(service);
      await this.syncAttempt(service);
      const b = this.actor(service);
      const journal = await this.openActiveJournal(b.scope);
      if (journal.snapshot().stage === 'record_pending') {
        const receipt = await service.record(
          this.state.device_id,
          this.state.active!.attempt_id,
          this.state.active!.revision!,
          journal.snapshot().frozen_record!,
        );
        await journal.acknowledge(receipt);
      }
      check(journal.snapshot().stage === 'recorded');
      await this.archiveActive();
    });
  }

  /** Explicit summary acknowledgement; only a complete, server-recognized batch
   * may release its local records. Device identity survives for the next batch.
   */
  closeBatch(service: ReservationService): Promise<void> {
    return this.serial(async () => {
      await this.syncBatch(service);
      const b = this.actor(service);
      check(!this.state.active && b.next_ordinal === b.request.count);
      const next = this.snapshot();
      delete next.last_failure;
      await this.commit({...next, batch: null, history: []});
    });
  }

  /** Reconcile server receipt first, then archive and advance in one commit. */
  advance(service: ReservationService): Promise<void> {
    return this.serial(async () => {
      await this.syncAttempt(service);
      await this.archiveActive();
    });
  }
}
