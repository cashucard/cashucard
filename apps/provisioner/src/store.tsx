/**
 * The designed app's whole shared state: the sign-in (real, against the ops
 * service — ENG-740), the demo switch, the open batch and its record rows.
 * A signed-in session holds its bearer token and key env in memory only; the
 * registry outbox re-posts pending rows on interval and app-foreground until
 * the service answers (the S4 retry contract). Demo rows never leave the
 * phone and are never pending.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {AppState, useColorScheme, type AppStateStatus} from 'react-native';

import {
  ApiClient,
  ApiServiceError,
  ApiUnreachableError,
  RegistryOutbox,
  type ApiClientOptions,
  type CardRegistryRow,
} from './api';
import type {DemoStateId} from './strings';
import {resolveTheme, ThemeProvider} from './theme';

export interface BatchConfig {
  mint: string;
  pinPolicy: 'batch' | 'perCard';
  pinBatch: string;
  dailyUsd: number;
  noPinUsd: number;
  count: number;
}

export interface RecordRow {
  id: string; // the card's short id, or the demo state's
  ok: boolean;
  demo?: DemoStateId;
  at: number; // epoch ms
  pending: boolean; // registry write outstanding (never in demo)
}

export type KeyEnv = 'factory' | 'issued';

export interface AppSession {
  readonly env: KeyEnv;
  /** The bearer token, in memory only (no Keychain in v1). */
  readonly token: string;
}

/** The default service base URL; the About screen shows it. */
export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8821';

export interface AppStateShape {
  signedIn: boolean;
  session: AppSession | null;
  demo: boolean;
  theme: 'system' | 'dark' | 'light';
  batch: (BatchConfig & {done: RecordRow[]}) | null;
  serviceUrl: string;
  signIn(
    name: string,
    password: string,
    options?: {client?: ApiClient},
  ): Promise<void>;
  signOut(): void;
  setDemo(on: boolean): void;
  setTheme(t: 'system' | 'dark' | 'light'): void;
  startBatch(config: BatchConfig): void;
  endBatch(): void;
  addRecord(row: RecordRow): void;
  /** The card row's registry POST: on failure the row enters the outbox. */
  postRegistryCard(row: CardRegistryRow): void;
  /** One retry pass over the pending rows (interval and foreground call this). */
  retryPending(): Promise<void>;
  /** A demo row: pending stays false forever. */
  addDemoRecord(row: RecordRow): void;
}

const Ctx = createContext<AppStateShape | null>(null);

export const DEMO_BATCH: BatchConfig = {
  mint: 'https://forge.flashapp.me',
  pinPolicy: 'perCard',
  pinBatch: '',
  dailyUsd: 25,
  noPinUsd: 5,
  count: 250,
};

const RETRY_INTERVAL_MS = 30_000;

export function AppStore({
  children,
  clientOptions,
}: {
  children: React.ReactNode;
  /** Injectable for tests; the real client in the app. */
  clientOptions?: ApiClientOptions;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const [session, setSession] = useState<AppSession | null>(null);
  const [demo, setDemo] = useState(false);
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const [batch, setBatch] = useState<
    (BatchConfig & {done: RecordRow[]}) | null
  >(null);
  const system = useColorScheme();

  const clientRef = useRef<ApiClient | null>(null);
  const outboxRef = useRef<RegistryOutbox | null>(null);
  const makeClient = useCallback(
    (): ApiClient =>
      new ApiClient(clientOptions ?? {baseUrl: DEFAULT_SERVICE_URL}),
    [clientOptions],
  );

  /**
   * Reflects the outbox's answered rows onto the batch view: every view row
   * still pending whose (id, at) matches an outbox row that is no longer
   * pending flips to pending: false. The outbox stores {...row} copies and
   * the batch view stores separate view rows, so the match is by the row's
   * own fields, never object identity (the bug that kept flags pending
   * forever) — and the flag only ever flips when the service answered.
   */
  const reflectAnswered = useCallback((): void => {
    const outbox = outboxRef.current;
    if (!outbox) {
      return;
    }
    const answered = outbox.all
      .filter(e => !e.pending)
      .map(e => ({id: e.row.short_id, at: e.row.installed_at}));
    setBatch(b =>
      b
        ? {
            ...b,
            done: b.done.map(r =>
              r.pending && answered.some(a => a.id === r.id && a.at === r.at)
                ? {...r, pending: false}
                : r,
            ),
          }
        : b,
    );
  }, []);

  const retryPending = useCallback(async (): Promise<void> => {
    const outbox = outboxRef.current;
    const sess = session;
    if (!outbox || !sess) {
      return;
    }
    // No pendingRows short-circuit here: the reflection below is the point —
    // rows the inline post path already answered must still flip the batch
    // view's pending flags on this pass, even when nothing is pending now.
    let expired = false;
    try {
      await outbox.retryAll(sess.token);
    } catch (e) {
      // retryAll resolves per-row; a throw here is a transport-level one.
      // A 401 means the 12 h token is dead — the token, not the outbox: the
      // frozen row bodies are still exactly what the service should receive.
      // Expire the session but keep the outbox, so the next sign-in's retry
      // pass re-posts the surviving rows instead of orphaning them.
      if (e instanceof ApiServiceError && e.status === 401) {
        expired = true;
      } else {
        throw e;
      }
    }
    reflectAnswered();
    if (expired) {
      // expireSession is a stable closure over the setters; the ref carries
      // it so retryPending (declared before it) can call it without a cycle.
      expireSessionRef.current();
    }
  }, [session, reflectAnswered]);

  // The retry cadence: on an interval, and when the app returns to the
  // foreground (the plan's "re-post on interval and app-foreground").
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const timer = setInterval(() => {
      retryPending();
    }, RETRY_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        retryPending();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, session]);

  /** Token died (the 401 path): clear the session, keep the outbox — its
   * frozen bodies are still valid and the next sign-in's retry pass re-posts
   * them. The outbox's client is the signed-in one; signIn reuses it rather
   * than building a fresh one over pending rows. */
  const expireSession = useCallback(() => {
    clientRef.current = null;
    setSession(null);
    setSignedIn(false);
  }, []);
  const expireSessionRef = useRef<() => void>(() => undefined);
  expireSessionRef.current = expireSession;

  const signOut = useCallback(() => {
    clientRef.current = null;
    outboxRef.current = null;
    setSession(null);
    setSignedIn(false);
  }, []);

  const value = useMemo<AppStateShape>(
    () => ({
      signedIn,
      session,
      demo,
      theme,
      batch,
      serviceUrl: clientOptions?.baseUrl ?? DEFAULT_SERVICE_URL,
      signIn: async (name, password, options) => {
        const client = options?.client ?? makeClient();
        try {
          const s = await client.operatorSession(name, password);
          clientRef.current = client;
          // Reuse an outbox that is still holding rows (a 401 expiry keeps
          // it alive for exactly this); a fresh outbox here would orphan
          // them — pending forever, never re-posted, never flipped.
          if (!outboxRef.current) {
            outboxRef.current = new RegistryOutbox(client);
          }
          setSession({env: s.env, token: s.token});
          setSignedIn(true);
        } catch (e) {
          // The screen renders SIGNIN.failed(reason): the service's reason,
          // or the unreachable note. Never improvised.
          throw e instanceof ApiUnreachableError
            ? e
            : e instanceof Error
            ? e
            : new Error('sign-in failed');
        }
      },
      signOut,
      setDemo,
      setTheme,
      startBatch: config => setBatch({...config, done: []}),
      endBatch: () => setBatch(null),
      addRecord: row => setBatch(b => (b ? {...b, done: [...b.done, row]} : b)),
      addDemoRecord: row =>
        setBatch(b =>
          b ? {...b, done: [...b.done, {...row, pending: false}]} : b,
        ),
      postRegistryCard: row => {
        // The batch view's row shape (RecordRow) differs from the wire row's
        // (CardRegistryRow): id = short_id, at = installed_at. Spreading the
        // wire row produced a view row with no id/at, which no retry pass
        // could ever match — the flag stayed pending forever.
        const view: RecordRow = {
          id: row.short_id,
          ok: true,
          at: row.installed_at,
          pending: true,
        };
        const outbox = outboxRef.current;
        const sess = session;
        if (!outbox || !sess) {
          // Signed out with no outbox (the manual sign-out path nulls it):
          // there is nowhere to freeze the body, so the row stays pending on
          // the batch view only. A 401 expiry is different — it keeps the
          // outbox alive, so rows added after it DO re-post on the next
          // sign-in's retry pass (expireSession, above).
          setBatch(b => (b ? {...b, done: [...b.done, view]} : b));
          return;
        }
        outbox.add(row);
        setBatch(b => (b ? {...b, done: [...b.done, view]} : b));
        (async () => {
          try {
            await outbox.retryAll(sess.token);
            // Same reflection as the retry pass: only rows the outbox says
            // were answered flip, so a 503 keeps the flag pending.
            reflectAnswered();
          } catch {
            // the outbox holds it; the interval pass retries
          }
        })();
      },
      retryPending,
    }),
    [
      signedIn,
      session,
      demo,
      theme,
      batch,
      clientOptions,
      makeClient,
      retryPending,
      reflectAnswered,
      signOut,
    ],
  );
  return (
    <ThemeProvider value={resolveTheme(theme, system)}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ThemeProvider>
  );
}

export function useApp(): AppStateShape {
  const s = useContext(Ctx);
  if (!s) {
    throw new Error('AppState outside its provider');
  }
  return s;
}

/** The card's screen id: the last bytes of its applet public key, hex. */
export function shortIdOf(pubkey: readonly number[]): string {
  return pubkey
    .slice(-2)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
