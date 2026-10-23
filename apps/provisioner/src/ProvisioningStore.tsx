/** Real workflow state, independent of the demo batch and legacy memory outbox. */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {AppState} from 'react-native';
import {ApiClient, ApiServiceError, ApiUnreachableError} from './api';
import {publicFailureContext} from './recoveryExport';
import {CASHU_PLAN, TransportError} from './cardkit';
import type {JournalStorage} from './journal';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
  type WorkflowSnapshot,
} from './provisioningWorkflow';
import {runReservedAttempt, type AttemptRunOptions} from './provisioningTap';
import {randomBytes, randomUuid} from './random';
import {PHASES} from './strings';
import {
  CARD_INSTALLATION_VALIDATED,
  RECOVERY_DRILLS_ENABLED,
} from './releaseGates';
import {
  RecoveryDrill,
  type DrillState,
  type RecoveryBoundary,
} from './recoveryDrills';
import {useApp, type AppSession, type BatchConfig} from './store';

// One writer and operation queue per store, including across React remounts.
// A new process rebuilds this cache from the same native snapshot.
const owners = new WeakMap<
  JournalStorage,
  {workflow?: Promise<ProvisioningWorkflow>; tail: Promise<unknown>}
>();
function exclusive<T>(
  storage: JournalStorage,
  uuid: () => string,
  work: (w: ProvisioningWorkflow) => Promise<T>,
): Promise<T> {
  let owner = owners.get(storage);
  if (!owner) {
    owner = {tail: Promise.resolve()};
    owners.set(storage, owner);
  }
  const entry = owner;
  const job = entry.tail.then(async () => {
    entry.workflow ??= ProvisioningWorkflow.open(storage, uuid);
    let w: ProvisioningWorkflow | undefined;
    try {
      w = await entry.workflow;
      return await work(w);
    } catch (e) {
      try {
        if (!w) {
          throw e;
        }
        w.snapshot();
      } catch {
        entry.workflow = undefined;
      } // Reopen poisoned/failed loads; never reset disk.
      throw e;
    }
  });
  entry.tail = job.catch(() => undefined);
  return job;
}

export interface ProvisioningProviderOptions {
  storage?: JournalStorage;
  uuid?: () => string;
  /** Test seam; production uses the immutable release gate above. */
  hardwareValidated?: boolean;
  recoveryDrillsEnabled?: boolean;
  serviceFor?: (session: AppSession, origin: string) => CardProvisioningService;
  runCard?: typeof runReservedAttempt;
  withCard?: AttemptRunOptions['withCard'];
  cancelCard?: () => Promise<void>;
  cardMessage?: (message: string) => void;
}
interface ReplacementReview {
  attemptId: string;
  chipId: string;
  installationId: string;
  generation: number;
}
interface RealProvisioning {
  status: 'loading' | 'ready' | 'blocked';
  snapshot: WorkflowSnapshot | null;
  scopeMatches: boolean;
  busy: boolean;
  cardActive: boolean;
  phase: string;
  /** Last LOAD block acknowledged in this card run; never a timed estimate. */
  loadProgress: {index: number; of: number} | null;
  notice: string | null;
  hardwareValidated: boolean;
  drill?: DrillState & {
    arm(boundary: RecoveryBoundary | null): void;
    resume(): void;
    stop(): void;
  };
  reload(): Promise<void>;
  create(config: BatchConfig): Promise<boolean>;
  recover(): Promise<boolean>;
  replacement: ReplacementReview | null;
  program(): Promise<boolean>;
  confirmReplacement(): Promise<boolean>;
  dismissReplacement(): void;
  quarantine(): Promise<boolean>;
  acknowledge(): Promise<boolean>;
  close(): Promise<boolean>;
  end(): Promise<boolean>;
  cancel(): void;
}
const Ctx = createContext<RealProvisioning | null>(null);
const message = (e: unknown): string => {
  if (e instanceof ApiUnreachableError) {
    return 'The service could not be reached. Your saved work is retained. Reconnect and retry.';
  }
  if (e instanceof ApiServiceError) {
    if (e.reason === 'batch-active') {
      return 'An attempt is still active. Resolve and acknowledge it before ending this batch.';
    }
    if (e.reason === 'batch-ended') {
      return 'This batch is already ended in the service. Sync saved work before continuing.';
    }
    if (e.reason === 'independent-backup-stale') {
      return 'Provisioning is paused because the service needs a fresh independent backup. Your saved work is retained. Ask your operator to restore backup health, then retry.';
    }
    if (e.reason === 'recovery-required') {
      return 'The service is paused for recovery. Your saved work is retained. Contact your operator before continuing.';
    }
    if (e.reason === 'escrow-missing') {
      return 'The service cannot find the keys assigned to this attempt. Keep the card aside and ask your operator to restore escrow before continuing.';
    }
    if (e.reason === 'chip-unresolved') {
      return 'This chip has an unresolved attempt. Keep the card aside and ask your operator to reconcile its history. Do not start another attempt for it.';
    }
    if (
      [
        'batch-request-changed',
        'attempt-request-changed',
        'completion-record-changed',
        'disposition-changed',
        'completion-identity-mismatch',
        'chip-binding-changed',
      ].includes(e.reason)
    ) {
      return 'Saved attempt details differ from the service record. Keep this work on the phone and ask your operator to reconcile it.';
    }
    if (
      [
        'ordinal-not-next',
        'device-active',
        'attempt-terminal',
        'stale-revision',
        'installation-recorded',
        'reservation-required',
        'reservation-mismatch',
      ].includes(e.reason)
    ) {
      return 'The service rejected this attempt state. Keep the card aside and ask your operator to reconcile it before continuing.';
    }
    if (e.status === 401) {
      return 'Sign in again to continue your saved work.';
    }
    if (e.status === 404) {
      return 'The service does not recognize this saved attempt. Keep it on this phone and ask your operator to reconcile it.';
    }
    if (e.status === 409) {
      return 'The service could not confirm this saved work. Keep it on this phone and ask your operator to reconcile it.';
    }
  }
  return 'Saved work could not be confirmed. It remains on this phone. Retry or ask your operator to reconcile it.';
};
function sameActor(
  snapshot: WorkflowSnapshot | null,
  session: AppSession | null,
  origin: string,
): boolean {
  const scope = snapshot?.batch?.scope;
  return (
    !scope ||
    (!!session &&
      scope.operator_id === session.operator_id &&
      scope.key_env === session.env &&
      scope.service_origin === origin)
  );
}

export function ProvisioningProvider({
  children,
  options = {},
}: {
  children: React.ReactNode;
  options?: ProvisioningProviderOptions;
}) {
  const app = useApp();
  const [status, setStatus] = useState<RealProvisioning['status']>('loading');
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardActive, setCardActive] = useState(false);
  const [phase, setPhase] = useState('');
  const [loadProgress, setLoadProgress] = useState<{
    index: number;
    of: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [interruption, setInterruption] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<ReplacementReview | null>(
    null,
  );
  const storage = useRef(options.storage);
  const settings = useRef(options).current;
  const hardwareValidated =
    settings.hardwareValidated ?? CARD_INSTALLATION_VALIDATED;
  const mounted = useRef(true);
  const [drillState, setDrillState] = useState<DrillState>({
    target: null,
    paused: null,
  });
  const drillsEnabled =
    settings.recoveryDrillsEnabled ?? RECOVERY_DRILLS_ENABLED;
  const armedMessage = useRef<((value: string) => void) | null>(null);
  const pauseStage = useRef('unconfirmed');
  const drill = useRef<RecoveryDrill | null>(null);
  drill.current ??= new RecoveryDrill(state => {
    if (mounted.current) {
      setDrillState(state);
      if (state.paused) {
        armedMessage.current?.(
          `Paused: ${state.paused}\nSaved: ${pauseStage.current}`,
        );
      }
    }
  });
  const busyRef = useRef(false);
  const cancelRequested = useRef(false);
  const armedCancel = useRef<(() => Promise<void>) | null>(null);
  const actorGeneration = useRef(0);
  const invalidateCard = useCallback(() => {
    cancelRequested.current = true;
    setInterruption(null);
    setReplacement(null);
    setLoadProgress(null);
    drill.current?.cancel();
    const cancel = armedCancel.current;
    if (cancel) {
      cancel().catch(() => undefined); // Command guard still prevents further APDUs.
    }
  }, []);
  useEffect(() => {
    actorGeneration.current++;
    invalidateCard();
  }, [app.session?.token, app.demo, app.serviceUrl, invalidateCard]);
  const latest = useRef(app);
  latest.current = app;
  const getStorage = useCallback(() => {
    // Older installed binaries may lack the newly added native module. Keep
    // sign-in/demo usable and stop real work, rather than failing at import.
    storage.current ??= (
      require('./journalStorage') as typeof import('./journalStorage')
    ).journalStorage;
    return storage.current;
  }, []);

  const reload = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setReplacement(null);
    setLoadProgress(null);
    setStatus('loading');
    try {
      const value = await exclusive(
        getStorage(),
        settings.uuid ?? randomUuid,
        async w => w.snapshot(),
      );
      if (mounted.current) {
        setSnapshot(value);
        setStatus('ready');
        setNotice(null);
      }
    } catch {
      if (mounted.current) {
        setStatus('blocked');
        setNotice(
          'Saved work could not be loaded. Card programming is paused. Retry loading it; do not start another batch.',
        );
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, [getStorage, settings]);
  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
      invalidateCard();
    };
  }, [reload, invalidateCard]);

  const operate = useCallback(
    async (
      work: (
        w: ProvisioningWorkflow,
        service: CardProvisioningService,
      ) => Promise<void>,
    ) => {
      const actor = latest.current;
      if (
        busyRef.current ||
        status !== 'ready' ||
        !actor.session ||
        actor.demo ||
        !sameActor(snapshot, actor.session, actor.serviceUrl)
      ) {
        return false;
      }
      const session = actor.session;
      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      setReplacement(null);
      try {
        const result = await exclusive(
          getStorage(),
          settings.uuid ?? randomUuid,
          async w => {
            const current = latest.current;
            if (
              !mounted.current ||
              current.demo ||
              current.session?.token !== session.token ||
              current.serviceUrl !== actor.serviceUrl
            ) {
              return {snapshot: w.snapshot(), ok: false};
            }
            const service =
              settings.serviceFor?.(session, actor.serviceUrl) ??
              new ApiClient({baseUrl: actor.serviceUrl}).reservations(session);
            try {
              await work(w, service);
              return {snapshot: w.snapshot(), ok: true};
            } catch (failure) {
              // Poisoned writes throw from snapshot and require a reload.
              const context = publicFailureContext(failure);
              if (context) {
                await w.rememberFailure(context);
              }
              return {snapshot: w.snapshot(), ok: false, failure};
            }
          },
        );
        if (mounted.current) {
          setSnapshot(result.snapshot);
          if ('failure' in result) {
            setNotice(message(result.failure));
            if (
              result.failure instanceof ApiServiceError &&
              result.failure.status === 401 &&
              latest.current.session?.token === session.token
            ) {
              latest.current.signOut();
            }
          }
        }
        return result.ok;
      } catch {
        if (mounted.current) {
          setStatus('blocked');
          setNotice(
            'Saved work could not be written safely. Card programming is paused. Reload saved work before continuing.',
          );
        }
        return false;
      } finally {
        drill.current?.cancel(); // An unvisited target must not carry into another run.
        busyRef.current = false;
        if (mounted.current) {
          setBusy(false);
          setCardActive(false);
          setPhase('');
        }
      }
    },
    [getStorage, settings, snapshot, status],
  );

  const recover = useCallback(async () => {
    const priorStage = snapshot?.active?.journal?.stage;
    const ok = await operate(async (w, service) => {
      await w.reconcile(service);
      if (
        ['record_pending', 'recorded'].includes(
          w.snapshot().active?.journal?.stage ?? '',
        )
      ) {
        await w.postRecord(service);
      }
    });
    if (ok && mounted.current && !interruption) {
      setNotice(
        priorStage === 'record_pending' || priorStage === 'recorded'
          ? 'Installation record confirmed by the service. No card tap was started.'
          : 'Saved work synced with the service. No card tap was started.',
      );
    }
    return ok;
  }, [operate, snapshot, interruption]);
  const retry = useRef(recover);
  retry.current = recover;
  const state = useRef(snapshot);
  state.current = snapshot;
  const ready = useRef(status);
  ready.current = status;
  useEffect(() => {
    const attempt = () => {
      const current = latest.current;
      const stage = state.current?.active?.journal?.stage;
      if (
        !current.demo &&
        current.session &&
        ready.current === 'ready' &&
        sameActor(state.current, current.session, current.serviceUrl) &&
        ['record_pending', 'recorded'].includes(stage ?? '')
      ) {
        retry.current();
      }
    };
    attempt(); // Reauthentication may finish a frozen record, never arm NFC.
    const timer = setInterval(attempt, 30_000);
    const sub = AppState.addEventListener('change', value => {
      if (value === 'active') {
        attempt();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [app.session?.token, app.demo, app.serviceUrl, status]);

  const program = (confirm = false): Promise<boolean> => {
    if (!hardwareValidated || (confirm && !replacement)) {
      return Promise.resolve(false);
    }
    return operate(async (w, service) => {
      cancelRequested.current = false;
      setInterruption(null);
      setLoadProgress(null);
      let lastPhase: string | undefined;
      const actor = latest.current;
      const generation = actorGeneration.current;
      const active = w.snapshot().active;
      const consent =
        confirm &&
        replacement &&
        replacement.generation === generation &&
        replacement.attemptId === active?.attempt_id &&
        replacement.chipId === active?.journal?.chip_id &&
        active?.journal?.stage === 'reserved'
          ? replacement.installationId
          : undefined;
      if (confirm && !consent) {
        throw new Error('replacement review expired');
      }
      let inspection: {chipId: string; installationId: string} | undefined;
      const allowed = () =>
        mounted.current &&
        !cancelRequested.current &&
        actorGeneration.current === generation &&
        !latest.current.demo &&
        latest.current.session?.token === actor.session?.token &&
        latest.current.serviceUrl === actor.serviceUrl;
      if (!w.snapshot().active) {
        await w.reserveNext(service);
      }
      if (mounted.current) {
        setCardActive(true);
      }
      const withCard: AttemptRunOptions['withCard'] = async run => {
        if (!allowed()) {
          return 'interrupted';
        }
        const guardedRun: typeof run = tx =>
          run(async apdu => {
            if (!allowed()) {
              throw new TransportError('Card session cancelled');
            }
            return tx(apdu);
          });
        const native = settings.withCard
          ? undefined
          : (require('./session') as typeof import('./session'));
        armedCancel.current =
          settings.cancelCard ??
          (native ? () => native.cancelCard() : async () => undefined);
        armedMessage.current =
          settings.cardMessage ?? native?.setCardMessage ?? null;
        try {
          if (settings.withCard) {
            return await settings.withCard(guardedRun);
          }
          return (
            await native!.withCard(
              'Hold the card still until installation finishes.',
              guardedRun,
            )
          ).value;
        } finally {
          armedCancel.current = null;
          armedMessage.current = null;
          if (mounted.current) {
            setCardActive(false);
          }
        }
      };
      const outcome = await (settings.runCard ?? runReservedAttempt)(
        w,
        service,
        {
          withCard,
          replacementInstallationId: consent,
          onReplacementRequired: value => {
            inspection = value;
          },
          checkpoint: drillsEnabled
            ? async boundary => {
                if (!allowed()) {
                  throw new TransportError('Card session cancelled');
                }
                const saved = w.snapshot();
                setSnapshot(saved);
                pauseStage.current =
                  saved.active?.journal?.stage ?? 'unconfirmed';
                await drill.current!.checkpoint(boundary);
                if (!allowed()) {
                  throw new TransportError('Card session cancelled');
                }
              }
            : undefined,
          random: randomBytes,
          now: Date.now,
          verifiedAt: () => Math.floor(Date.now() / 1000),
          onEvent: event => {
            if (!allowed()) {
              return;
            }
            if (event.type === 'phase') {
              lastPhase = Object.prototype.hasOwnProperty.call(
                PHASES,
                event.phase,
              )
                ? PHASES[event.phase]
                : undefined;
              setPhase(event.phase);
            } else if (
              event.type === 'block' &&
              Number.isInteger(event.index) &&
              Number.isInteger(event.of) &&
              event.of > 0 &&
              event.index >= 1 &&
              event.index <= event.of
            ) {
              setLoadProgress({index: event.index, of: event.of});
            }
          },
        },
      );
      if (allowed() && outcome === 'interrupted') {
        const stage = w.snapshot().active?.journal?.stage ?? 'unconfirmed';
        setInterruption(
          `Card connection interrupted. Last phase: ${
            lastPhase ?? 'Not reported'
          }. ` +
            `Saved stage: ${stage}. Card changes may be incomplete. ` +
            'Keep this card. Ask your operator before retrying.',
        );
      }
      if (
        allowed() &&
        outcome === 'replacement-consent-required' &&
        inspection
      ) {
        const current = w.snapshot().active;
        if (
          current?.journal?.stage === 'reserved' &&
          current.journal.chip_id === inspection.chipId
        ) {
          setReplacement({
            ...inspection,
            attemptId: current.attempt_id,
            generation,
          });
        }
        setNotice(
          'This card already has an installation. Review it before choosing replacement.',
        );
      }
    });
  };

  const value: RealProvisioning = {
    status,
    snapshot,
    busy,
    cardActive,
    phase,
    loadProgress,
    notice: notice ?? interruption,
    hardwareValidated,
    drill: drillsEnabled
      ? {
          ...drillState,
          arm: boundary => {
            if (
              !busyRef.current &&
              hardwareValidated &&
              !latest.current.demo &&
              latest.current.session &&
              sameActor(
                snapshot,
                latest.current.session,
                latest.current.serviceUrl,
              )
            ) {
              drill.current!.arm(boundary);
            }
          },
          resume: () => {
            if (
              latest.current.session &&
              !latest.current.demo &&
              sameActor(
                snapshot,
                latest.current.session,
                latest.current.serviceUrl,
              )
            ) {
              drill.current!.resume();
            }
          },
          stop: invalidateCard,
        }
      : undefined,
    scopeMatches: sameActor(snapshot, app.session, app.serviceUrl),
    reload,
    recover,
    create: config => {
      if (!hardwareValidated) {
        return Promise.resolve(false);
      }
      return operate((w, service) =>
        w.start(service, {
          count: config.count,
          mint_url: config.mint,
          pin_policy: config.pinPolicy,
          daily_usd: config.dailyUsd,
          no_pin_usd: config.noPinUsd,
          load_sha256: CASHU_PLAN.loadFile.sha256,
        }),
      );
    },
    replacement,
    program: () => program(),
    confirmReplacement: () => program(true),
    dismissReplacement: () => setReplacement(null),
    quarantine: () =>
      operate((w, service) =>
        w.withAttempt(service, async j => {
          if (
            ![
              'reserved',
              'install_intent',
              'installed',
              'rotation_intent',
              'rotated',
            ].includes(j.snapshot().stage)
          ) {
            throw new Error(
              'this stage requires record recovery instead of quarantine',
            );
          }
          await j.quarantine('reconciliation-required');
        }),
      ),
    acknowledge: () =>
      operate((w, service) =>
        w.acknowledgeQuarantine(
          service,
          w.snapshot().active?.journal?.disposition_intent?.kind ??
            'quarantined',
        ),
      ),
    close: () => operate((w, service) => w.closeBatch(service)),
    end: () => operate((w, service) => w.endBatch(service)),
    cancel: () => {
      if (!hardwareValidated || !cardActive) {
        return;
      }
      cancelRequested.current = true;
      drill.current?.cancel();
      if (armedCancel.current) {
        invalidateCard();
      } else if (settings.cancelCard) {
        settings.cancelCard().catch(() => undefined);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useProvisioning(): RealProvisioning {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('ProvisioningProvider is missing');
  }
  return value;
}
