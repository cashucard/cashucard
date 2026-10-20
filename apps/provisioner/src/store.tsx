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

  const retryPending = useCallback(async (): Promise<void> => {
    const outbox = outboxRef.current;
    const sess = session;
    if (!outbox || !sess || outbox.pendingRows.length === 0) {
      return;
    }
    await outbox.retryAll(sess.token);
    // Reflect answered rows in the batch view: pending flips where the outbox
    // says it did.
    const answered = new Set(
      outbox.all.filter(e => !e.pending).map(e => e.row),
    );
    setBatch(b =>
      b
        ? {
            ...b,
            done: b.done.map(r =>
              r.pending && answered.has(r as unknown as CardRegistryRow)
                ? {...r, pending: false}
                : r,
            ),
          }
        : b,
    );
  }, [session]);

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
          outboxRef.current = new RegistryOutbox(client);
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
      signOut: () => {
        clientRef.current = null;
        outboxRef.current = null;
        setSession(null);
        setSignedIn(false);
      },
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
        const outbox = outboxRef.current;
        const sess = session;
        if (!outbox || !sess) {
          // No session: the row is pending by definition and the next
          // sign-in's retry pass carries it? No — without a session there is
          // no outbox; the row stays pending on the batch view only.
          setBatch(b =>
            b
              ? {...b, done: [...b.done, {...row, pending: true} as RecordRow]}
              : b,
          );
          return;
        }
        outbox.add(row);
        setBatch(b =>
          b
            ? {...b, done: [...b.done, {...row, pending: true} as RecordRow]}
            : b,
        );
        (async () => {
          try {
            await outbox.retryAll(sess.token);
            setBatch(prev =>
              prev
                ? {
                    ...prev,
                    done: prev.done.map(r =>
                      r.pending &&
                      r.id === row.short_id &&
                      r.at === row.installed_at
                        ? {...r, pending: false}
                        : r,
                    ),
                  }
                : prev,
            );
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
