/** Real workflow state, independent of the legacy memory outbox. */
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
import {
  CASHU_PLAN,
  TransportError,
  CleanupError,
  CardError,
  readResetReview,
  type ResetReview,
  type Transceiver,
} from './cardkit';
import {
  OwnedResetWorkflow,
  type OwnedResetState,
  type OwnedResetService,
  type ResetLookup,
  type OwnedResetRun,
} from './ownedResetWorkflow';
import {mintSettlementJson, MintSettlementError} from './mintSettlement';
import {readCardStatus, type CardReadout} from './cardStatus';
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
  resetStorage?: JournalStorage;
  resetServiceFor?: (session: AppSession, origin: string) => OwnedResetService;
  resetWithCard?: OwnedResetRun['withCard'];
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
  dismissReplacement(): void;
  quarantine(): Promise<boolean>;
  acknowledge(): Promise<boolean>;
  close(): Promise<boolean>;
  end(): Promise<boolean>;
  cancel(): void;
  resetState: OwnedResetState | null;
  resetReview: {card: ResetReview; source: ResetLookup} | null;
  inspectReset(): Promise<boolean>;
  prepareReset(consent: {
    erase: boolean;
    valueHandled: boolean;
  }): Promise<boolean>;
  continueReset(pin?: string): Promise<boolean>;
  dismissResetReview(): void;
  cardReadout: {readout: CardReadout; source?: ResetLookup} | null;
  inspectStatus(): Promise<boolean>;
  dismissCardReadout(): void;
}
const Ctx = createContext<RealProvisioning | null>(null);
const message = (e: unknown): string => {
  if (e instanceof MintSettlementError) {
    return 'The mint could not confirm settlement. No entries were cleared. Keep the card, reconnect and retry the settlement check.';
  }
  if (e instanceof CleanupError) {
    if (e.code === 'cleanup-unconfirmed') {
      return 'Cleanup may be incomplete. Keep this card with this phone. Continue the saved reset to check what finished; if it stops again, share reset details with your administrator.';
    }
    if (e.code === 'settlement-pending') {
      return 'Some card entries are not confirmed settled. Keep the card unchanged. Reconnect the merchant terminal and finish its pending payments before trying reset again.';
    }
    if (e.code === 'holder-pin-required') {
      return 'The current card PIN is needed to clear settled entries. Enter it on this phone; no PIN is sent to the service.';
    }
    return 'Card checks stopped. Keep this card and the saved reset details for administrator review before further changes.';
  }
  if (e instanceof CardError && e.ins === 0x40) {
    return e.sw === 0x6983
      ? 'The card PIN is blocked. Use the holder wallet to recover it before continuing.'
      : Math.floor(e.sw / 16) === 0x63c
      ? `The PIN was incorrect. ${
          e.sw % 16
        } tries remain. No entries were cleared. Stop if you are unsure of the PIN.`
      : 'The card refused PIN verification. No entries were cleared. Check the card in its holder wallet.';
  }
  if (e instanceof ApiUnreachableError) {
    return 'The service could not be reached. Your saved work is retained. Reconnect and retry.';
  }
  if (e instanceof ApiServiceError) {
    if (e.reason === 'reset-unresolved') {
      return 'Finish the saved card reset before starting another installation. Open Reset a card in Settings.';
    }
    if (e.reason === 'batch-active') {
      return 'The current card attempt is unfinished. Finish it or save its stop before ending this batch.';
    }
    if (e.reason === 'batch-ended') {
      return 'This batch is already closed online. Check saved work to update this phone.';
    }
    if (e.reason === 'independent-backup-stale') {
      return 'Card changes are paused until the service has a fresh independent backup. Your work is saved. Ask your administrator to check backups, then retry.';
    }
    if (e.reason === 'recovery-required') {
      return 'The service is being recovered. Keep the saved work on this phone. Ask your administrator when it is ready to continue.';
    }
    if (e.reason === 'escrow-missing') {
      return 'The service cannot find this card’s saved manager keys. Keep the card aside and ask your administrator to check its key history.';
    }
    if (e.reason === 'chip-unresolved') {
      return 'This card has unfinished installation history. Keep it aside and share support details with your administrator before another installation.';
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
      return 'This phone and the service have different saved details. Keep this work and share support details with your administrator.';
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
      return 'The service could not accept this saved attempt. Keep the card aside and share support details with your administrator.';
    }
    if (e.status === 401) {
      return 'Sign in again to continue your saved work.';
    }
    if (e.status === 404) {
      return 'This service cannot find the saved attempt. Keep it on this phone and share support details with your administrator.';
    }
    if (e.status === 409) {
      return 'This phone and the service could not confirm the same saved work. Keep the phone and card; share support details with your administrator.';
    }
  }
  return 'The operation stopped. Keep this phone and card. Reload saved work, or share support details with your administrator.';
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
  const [resetState, setResetState] = useState<OwnedResetState | null>(null);
  const [cardReadout, setCardReadout] = useState<{
    readout: CardReadout;
    source?: ResetLookup;
  } | null>(null);
  const [resetReview, setResetReview] = useState<{
    card: ResetReview;
    source: ResetLookup;
  } | null>(null);
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
  const resetDisk = useRef(options.resetStorage);
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
  const pausedByUser = useRef(false);
  const armedCancel = useRef<(() => Promise<void>) | null>(null);
  const actorGeneration = useRef(0);
  const operationAbort = useRef<AbortController | null>(null);
  const invalidateCard = useCallback(() => {
    actorGeneration.current++;
    operationAbort.current?.abort();
    cancelRequested.current = true;
    setInterruption(null);
    setReplacement(null);
    setResetReview(null);
    setCardReadout(null);
    setLoadProgress(null);
    drill.current?.cancel();
    const cancel = armedCancel.current;
    if (cancel) {
      cancel().catch(() => undefined); // Command guard still prevents further APDUs.
    }
  }, []);
  useEffect(() => {
    invalidateCard();
  }, [app.session?.token, app.serviceUrl, invalidateCard]);
  const latest = useRef(app);
  latest.current = app;
  const getStorage = useCallback(() => {
    // Older installed binaries may lack the newly added native module. Keep
    // sign-in usable and stop real work, rather than failing at import.
    storage.current ??= (
      require('./journalStorage') as typeof import('./journalStorage')
    ).journalStorage;
    return storage.current;
  }, []);
  const getResetStorage = useCallback(() => {
    resetDisk.current ??= (
      require('./journalStorage') as typeof import('./journalStorage')
    ).resetStorage;
    return resetDisk.current;
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
        async w => ({
          workflow: w.snapshot(),
          reset: (await OwnedResetWorkflow.open(getResetStorage())).snapshot(),
        }),
      );
      if (mounted.current) {
        setSnapshot(value.workflow);
        setResetState(value.reset);
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
  }, [getStorage, getResetStorage, settings]);
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
        reset: OwnedResetWorkflow,
      ) => Promise<void>,
      resetOperation = false,
    ) => {
      const actor = latest.current;
      if (
        busyRef.current ||
        status !== 'ready' ||
        !actor.session ||
        !sameActor(snapshot, actor.session, actor.serviceUrl)
      ) {
        return false;
      }
      const session = actor.session;
      busyRef.current = true;
      cancelRequested.current = false;
      if (!resetOperation) {
        pausedByUser.current = false;
      }
      const controller = new AbortController();
      operationAbort.current = controller;
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
              current.session?.token !== session.token ||
              current.serviceUrl !== actor.serviceUrl
            ) {
              return {snapshot: w.snapshot(), ok: false};
            }
            const service =
              settings.serviceFor?.(session, actor.serviceUrl) ??
              new ApiClient({
                baseUrl: actor.serviceUrl,
                signal: controller.signal,
              }).reservations(session);
            const reset = await OwnedResetWorkflow.open(getResetStorage());
            try {
              const pending = reset.snapshot()?.journal;
              if (!resetOperation && pending && pending.stage !== 'complete') {
                throw new ApiServiceError('reset-unresolved', 409);
              }
              await work(w, service, reset);
              return {
                snapshot: w.snapshot(),
                reset: reset.snapshot(),
                ok: true,
              };
            } catch (failure) {
              // Poisoned writes throw from snapshot and require a reload.
              const context = publicFailureContext(failure);
              if (context) {
                await w.rememberFailure(context);
              }
              return {
                snapshot: w.snapshot(),
                reset: reset.snapshot(),
                ok: false,
                failure,
              };
            }
          },
        );
        if (mounted.current) {
          setSnapshot(result.snapshot);
          if ('reset' in result) {
            setResetState(result.reset!);
          }
          if ('failure' in result) {
            setNotice(
              cancelRequested.current
                ? 'Stopped. Saved work stays on this phone. Continue with the same card, account and service.'
                : message(result.failure),
            );
            if (
              result.failure instanceof ApiServiceError &&
              result.failure.status === 401 &&
              latest.current.session?.token === session.token
            ) {
              latest.current.signOut();
            }
          }
        }
        return result.ok && !cancelRequested.current;
      } catch {
        if (mounted.current) {
          setStatus('blocked');
          setNotice(
            'Saved work could not be written safely. Card programming is paused. Reload saved work before continuing.',
          );
        }
        return false;
      } finally {
        if (operationAbort.current === controller) {
          operationAbort.current = null;
        }
        drill.current?.cancel(); // An unvisited target must not carry into another run.
        busyRef.current = false;
        if (mounted.current) {
          setBusy(false);
          setCardActive(false);
          setPhase('');
        }
      }
    },
    [getStorage, getResetStorage, settings, snapshot, status],
  );

  const resetService = () => {
    const actor = latest.current;
    if (!actor.session) {
      throw new Error('Sign in to reset a card');
    }
    return (
      settings.resetServiceFor?.(actor.session, actor.serviceUrl) ??
      new ApiClient({
        baseUrl: actor.serviceUrl,
        signal: operationAbort.current?.signal,
      }).resets(actor.session)
    );
  };
  const resetCard = async <T,>(
    run: (tx: Transceiver) => Promise<T>,
  ): Promise<T> => {
    const actor = latest.current,
      generation = actorGeneration.current;
    const allowed = () =>
      mounted.current &&
      !cancelRequested.current &&
      latest.current.session?.token === actor.session?.token &&
      latest.current.serviceUrl === actor.serviceUrl &&
      actorGeneration.current === generation;
    cancelRequested.current = false;
    if (settings.resetWithCard) {
      return settings.resetWithCard(run);
    }
    const session = (
      require('./session') as typeof import('./session')
    ).createCardSession();
    armedCancel.current = () => session.cancel();
    setCardActive(true);
    try {
      const result = await session.run(
        'Hold this same card still until the check or reset finishes.',
        tx =>
          run(async a => {
            if (!allowed()) {
              throw new TransportError('Reset cancelled');
            }
            const r = await tx(a);
            if (!allowed()) {
              throw new TransportError('Reset cancelled');
            }
            return r;
          }),
      );
      if (!allowed()) {
        throw new TransportError('Reset cancelled');
      }
      return result.value;
    } finally {
      armedCancel.current = null;
      setCardActive(false);
    }
  };

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
          ? 'Installation saved online. No card tap was started.'
          : 'Saved work checked. No card tap was started.',
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
        !pausedByUser.current &&
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
  }, [app.session?.token, app.serviceUrl, status]);

  const program = (): Promise<boolean> => {
    if (!hardwareValidated) {
      return Promise.resolve(false);
    }
    return operate(async (w, service) => {
      cancelRequested.current = false;
      setInterruption(null);
      setLoadProgress(null);
      let lastPhase: string | undefined;
      const actor = latest.current;
      const generation = actorGeneration.current;
      let inspection: {chipId: string; installationId: string} | undefined;
      const allowed = () =>
        mounted.current &&
        !cancelRequested.current &&
        actorGeneration.current === generation &&
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
        setInterruption(
          `Card connection lost. Last step: ${
            lastPhase ?? 'Not reported'
          }. Keep this card with this phone. Choose Continue with the same card to check what finished. If it stops again, share support details with your administrator.`,
        );
      }
      if (allowed() && outcome === 'reset-required' && inspection) {
        const current = w.snapshot().active;
        if (
          current?.journal?.stage === 'reserved' &&
          (!current.journal.chip_id ||
            current.journal.chip_id === inspection.chipId)
        ) {
          setReplacement({
            ...inspection,
            attemptId: current.attempt_id,
            generation,
          });
        }
        setNotice(
          'This card is already installed. Stop the unused attempt and close this batch, then open Settings → Reset a card.',
        );
      }
    });
  };

  const value: RealProvisioning = {
    cardReadout,
    dismissCardReadout: () => setCardReadout(null),
    inspectStatus: () =>
      operate(async () => {
        setCardReadout(null);
        const generation = actorGeneration.current;
        const readout = await resetCard(readCardStatus);
        if (generation !== actorGeneration.current) {
          throw new TransportError('Read cancelled');
        }
        setCardReadout({readout});
        if (readout.state === 'present') {
          const source = await resetService().lookup(
            readout.chipId,
            readout.card.installationId,
          );
          if (generation === actorGeneration.current) {
            setCardReadout({readout, source});
          }
        }
      }, true),
    resetState,
    resetReview,
    dismissResetReview: () => setResetReview(null),
    inspectReset: () =>
      operate(async (w, _service, reset) => {
        if (
          w.snapshot().batch ||
          (reset.snapshot() && reset.snapshot()!.journal.stage !== 'complete')
        ) {
          throw new Error('Finish saved work first');
        }
        const generation = actorGeneration.current;
        const card = await resetCard(readResetReview);
        const source = await resetService().lookup(
          card.chipId,
          card.installationId,
        );
        if (generation === actorGeneration.current) {
          setResetReview({card, source});
        }
      }, true),
    prepareReset: consent =>
      operate(async (w, _service, reset) => {
        if (w.snapshot().batch || !resetReview) {
          throw new Error('Check the card first');
        }
        await reset.begin(
          resetService(),
          w.snapshot().device_id,
          (settings.uuid ?? randomUuid)(),
          resetReview.card,
          consent,
        );
        setResetReview(null);
      }, true),
    continueReset: pin =>
      operate(async (w, _service, reset) => {
        if (
          !hardwareValidated ||
          w.snapshot().batch ||
          reset.snapshot()?.journal.device_id !== w.snapshot().device_id
        ) {
          throw new Error('Reset unavailable');
        }
        const actor = latest.current,
          generation = actorGeneration.current;
        cancelRequested.current = false;
        const outcome = await reset.continue(resetService(), {
          withCard: resetCard,
          pin,
          random: randomBytes,
          now: () => Math.floor(Date.now() / 1000),
          mintJson: (origin, path, body) =>
            mintSettlementJson(
              origin,
              path,
              body,
              operationAbort.current?.signal,
            ),
          canContinue: () =>
            mounted.current &&
            !cancelRequested.current &&
            actorGeneration.current === generation &&
            latest.current.session?.token === actor.session?.token,
          onPhase: resetPhase => setPhase(resetPhase),
        });
        if (outcome === 'stopped') {
          setNotice(
            'The reset stopped. Keep this card and its saved work. Continue with the same card to check what completed; do not start a new installation.',
          );
        }
      }, true),
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
    scopeMatches:
      sameActor(snapshot, app.session, app.serviceUrl) &&
      (!resetState ||
        resetState.journal.stage === 'complete' ||
        (resetState.journal.operator_id === app.session?.operator_id &&
          resetState.journal.key_env === app.session?.env &&
          resetState.journal.service_origin === app.serviceUrl)),
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
      pausedByUser.current = true;
      if (!busyRef.current) {
        invalidateCard();
        return;
      }
      if (cancelRequested.current) {
        return;
      }
      const hasOwnedSession = !!armedCancel.current;
      invalidateCard();
      setNotice('Stopping. Saved work stays on this phone.');
      if (!hasOwnedSession && cardActive && settings.cancelCard) {
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
