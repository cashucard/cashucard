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
import {CASHU_PLAN, TransportError} from './cardkit';
import type {JournalStorage} from './journal';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
  type WorkflowSnapshot,
} from './provisioningWorkflow';
import {runReservedAttempt, type AttemptRunOptions} from './provisioningTap';
import {randomBytes, randomUuid} from './random';
import {CARD_INSTALLATION_VALIDATED} from './releaseGates';
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
  serviceFor?: (session: AppSession, origin: string) => CardProvisioningService;
  runCard?: typeof runReservedAttempt;
  withCard?: AttemptRunOptions['withCard'];
  cancelCard?: () => Promise<void>;
}
interface RealProvisioning {
  status: 'loading' | 'ready' | 'blocked';
  snapshot: WorkflowSnapshot | null;
  scopeMatches: boolean;
  busy: boolean;
  cardActive: boolean;
  phase: string;
  notice: string | null;
  hardwareValidated: boolean;
  reload(): Promise<void>;
  create(config: BatchConfig): Promise<boolean>;
  recover(): Promise<boolean>;
  program(): Promise<boolean>;
  quarantine(): Promise<boolean>;
  acknowledge(): Promise<boolean>;
  close(): Promise<boolean>;
  cancel(): void;
}
const Ctx = createContext<RealProvisioning | null>(null);
const message = (e: unknown): string => {
  if (e instanceof ApiUnreachableError) {
    return 'The service could not be reached. Your saved work is retained. Reconnect and retry.';
  }
  if (e instanceof ApiServiceError) {
    if (e.reason === 'recovery-required') {
      return 'The service is paused for recovery. Your saved work is retained. Contact your operator before continuing.';
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
  const [notice, setNotice] = useState<string | null>(null);
  const storage = useRef(options.storage);
  const settings = useRef(options).current;
  const hardwareValidated =
    settings.hardwareValidated ?? CARD_INSTALLATION_VALIDATED;
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const cancelRequested = useRef(false);
  const armedCancel = useRef<(() => Promise<void>) | null>(null);
  const actorGeneration = useRef(0);
  const invalidateCard = useCallback(() => {
    cancelRequested.current = true;
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

  const recover = useCallback(
    () =>
      operate(async (w, service) => {
        await w.reconcile(service);
        if (
          ['record_pending', 'recorded'].includes(
            w.snapshot().active?.journal?.stage ?? '',
          )
        ) {
          await w.postRecord(service);
        }
      }),
    [operate],
  );
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

  const value: RealProvisioning = {
    status,
    snapshot,
    busy,
    cardActive,
    phase,
    notice,
    hardwareValidated,
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
    program: () => {
      if (!hardwareValidated) {
        return Promise.resolve(false);
      }
      return operate(async (w, service) => {
        cancelRequested.current = false;
        const actor = latest.current;
        const generation = actorGeneration.current;
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
          }
        };
        const outcome = await (settings.runCard ?? runReservedAttempt)(
          w,
          service,
          {
            withCard,
            random: randomBytes,
            now: Date.now,
            verifiedAt: () => Math.floor(Date.now() / 1000),
            onEvent: event => {
              if (mounted.current && event.type === 'phase') {
                setPhase(event.phase);
              }
            },
          },
        );
        if (mounted.current && outcome === 'replacement-consent-required') {
          setNotice(
            'This card already has an installation. It has not been replaced. Ask your operator to review it before continuing.',
          );
        }
      });
    },
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
    cancel: () => {
      if (!hardwareValidated || !cardActive) {
        return;
      }
      cancelRequested.current = true;
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
